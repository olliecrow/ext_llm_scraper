import { TaskManager } from './taskManager.js';
import { PageScraper } from './scraper.js';
import { MarkdownBuilder } from './markdownBuilder.js';
import { generateFilename } from '../shared/utils.js';
import { ensureOffscreenDocument, holdOffscreenDocument } from './offscreenDoc.js';

let downloadChain = Promise.resolve();

export function installBackground(chromeApi, services = {}) {
  const taskManager = services.taskManager ?? new TaskManager();
  const scraper = services.scraper ?? new PageScraper(taskManager);

  function processTask(task) {
    return holdOffscreenDocument(chromeApi, async () => {
      try {
        await crawl(task);
      } finally {
        await finishTask(task);
      }
    });
  }

  async function crawl(task) {
    const active = new Set();

    while (!task.abort) {
      while (task.canSchedule() && active.size < task.settings.concurrency && !task.abort) {
        const nextUrl = task.getNextUrl();
        if (!nextUrl) {
          break;
        }

        const run = scraper
          .scrape(task, nextUrl)
          .catch((error) => {
            taskManager.sendStatus(task.taskId, {
              status: 'Scraping error',
              debug: error.message,
            });
            return false;
          })
          .finally(() => {
            active.delete(run);
          });

        active.add(run);
      }

      if (active.size === 0) {
        break;
      }

      await Promise.race(active);
    }

    await Promise.allSettled(active);
  }

  async function finishTask(task) {
    if (task.isFinished || task.isFinishing) {
      return;
    }
    task.isFinishing = true;
    try {
      await saveResults(task);
    } finally {
      task.markAsFinished();
      taskManager.cleanupTask(task.taskId);
    }
  }

  async function saveResults(task) {
    const saved = task.contentMap.size;
    if (saved > 0) {
      const builder = new MarkdownBuilder();
      builder.addFromContentMap(task.contentMap);
      const result = await attemptDownload(task, builder.build());
      if (result.ok) {
        const base = task.abort ? `Stopped. Saved ${saved} page(s).` : 'Scraping complete';
        taskManager.sendStatus(task.taskId, {
          done: true,
          status: `${base} ${result.filename}`,
          processed: saved,
          total: saved,
        });
      } else {
        taskManager.sendStatus(task.taskId, {
          done: true,
          status: 'Scraping finished, but the download failed',
          debug: result.error,
          processed: saved,
          total: saved,
        });
      }
    } else {
      taskManager.sendStatus(task.taskId, {
        done: true,
        status: task.abort ? 'Stopped' : 'No pages saved',
        processed: 0,
        total: 0,
      });
    }
  }

  async function performDownload(task, content) {
    const filename = generateFilename(task.startingDomain);
    try {
      await ensureOffscreenDocument(chromeApi);
      const response = await chromeApi.runtime.sendMessage({
        action: 'create-download-url',
        content,
        mime: 'text/markdown',
      });
      if (!response?.url || !String(response.url).startsWith('blob:')) {
        throw new Error(response?.error || 'Download URL was not created');
      }

      await chromeApi.downloads.download({
        url: response.url,
        filename,
        saveAs: false,
      });
      await chromeApi.runtime
        .sendMessage({ action: 'revoke-download-url', url: response.url })
        .catch(() => undefined);
      taskManager.sendStatus(task.taskId, {
        debug: `Download started: ${filename}`,
      });
      return { ok: true, filename };
    } catch (error) {
      return { ok: false, error: error?.message || 'Download failed' };
    }
  }

  function attemptDownload(task, content) {
    const run = downloadChain.then(() => performDownload(task, content));
    downloadChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chromeApi.runtime.id) {
      sendResponse({ success: false, error: 'Rejected sender' });
      return false;
    }

    if (!message || typeof message !== 'object') {
      sendResponse({ success: false, error: 'Invalid message payload' });
      return false;
    }

    if (message.action === 'start') {
      const { tabId, startingUrl, settings } = message;
      if (typeof tabId !== 'number' || !startingUrl) {
        sendResponse({ success: false, error: 'Missing task parameters' });
        return false;
      }

      try {
        const task = taskManager.createTask(tabId, startingUrl, settings ?? {});
        taskManager.sendStatus(tabId, { status: 'Starting scraping task...' });
        processTask(task).catch((error) => {
          taskManager.sendStatus(tabId, {
            status: 'Task failed',
            debug: error.message,
          });
        });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }

      return true;
    }

    if (message.action === 'stop') {
      const task = taskManager.getTask(message.tabId);
      if (task) {
        task.stop();
        taskManager.sendStatus(task.taskId, { status: 'Stopping task...' });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No active task' });
      }
      return false;
    }

    if (
      message.action === 'create-download-url' ||
      message.action === 'revoke-download-url' ||
      message.action === 'parse-html'
    ) {
      return false;
    }

    if (message.action === 'status') {
      const task = typeof message.tabId === 'number' ? taskManager.getTask(message.tabId) : null;
      if (!task) {
        sendResponse({ success: true, running: false, status: 'Ready', processed: 0, total: 0 });
      } else {
        const saved = task.contentMap.size;
        sendResponse({
          success: true,
          running: true,
          status: saved > 0 ? `Scraped ${saved} page(s)` : 'Scraping',
          processed: saved,
          total: task.settings.maxPages,
        });
      }
      return false;
    }

    if (message.action === 'ping') {
      sendResponse({ success: true });
      return false;
    }

    sendResponse({ success: false, error: 'Unknown action' });
    return false;
  });

  chromeApi.runtime.onConnect.addListener((port) => {
    if (port.sender?.id !== chromeApi.runtime.id || port.name !== 'popup') {
      return;
    }

    port.onMessage.addListener((msg) => {
      if (msg?.action === 'subscribe' && typeof msg.tabId === 'number') {
        taskManager.subscribe(msg.tabId, port);
      }
    });

    port.onDisconnect.addListener(() => {
      taskManager.unsubscribe(port);
    });
  });

  return { taskManager, scraper, processTask };
}
