import { TaskManager } from './taskManager.js';
import { PageScraper } from './scraper.js';
import { MarkdownBuilder } from './markdownBuilder.js';
import { SafeChromeAPI } from '../shared/safeChromeAPI.js';
import { generateFilename } from '../shared/utils.js';

const taskManager = new TaskManager();
const scraper = new PageScraper(taskManager);

async function processTask(task) {
  const active = new Set();

  while (!task.abort) {
    while (
      task.canSchedule() &&
      active.size < task.settings.concurrency &&
      !task.abort
    ) {
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

  if (!task.abort && task.isComplete() && task.markAsFinishing()) {
    await finishTask(task);
  }
}

async function finishTask(task) {
  const builder = new MarkdownBuilder();
  builder.addFromContentMap(task.contentMap);
  const markdown = builder.build();

  await attemptDownload(task, markdown);

  taskManager.sendStatus(task.taskId, {
    done: true,
    status: 'Scraping complete',
    processed: task.processed,
    total: task.processed,
    content: markdown,
  });

  task.markAsFinished();
  taskManager.cleanupTask(task.taskId);
}

async function attemptDownload(task, content) {
  try {
    const filename = generateFilename(task.startingDomain);
    const dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;

    await SafeChromeAPI.downloads('download', {
      url: dataUrl,
      filename,
      saveAs: false,
    });

    taskManager.sendStatus(task.taskId, {
      debug: `Download started: ${filename}`,
    });
  } catch (error) {
    console.warn('Download failed:', error.message);
    taskManager.sendStatus(task.taskId, {
      debug: `Download failed: ${error.message}`,
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      task.abort = true;
      task.queue = [];
      taskManager.sendStatus(task.taskId, { status: 'Stopping task...' });
      taskManager.cleanupTask(task.taskId);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'No active task' });
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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') {
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
