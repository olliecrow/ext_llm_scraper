import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installBackground } from '../src/background/controller.js';
import { TaskManager } from '../src/background/taskManager.js';
import { createChromeMock } from './chrome-mock.js';
import { ensureOffscreenDocument } from '../src/background/offscreenDoc.js';

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error('condition was not met');
}

function dispatch(listener, message, sender = { id: chrome.runtime.id }) {
  let response;
  listener(message, sender, (value) => {
    response = value;
  });
  return response;
}

function lastCallArg(fn) {
  const { calls } = fn.mock;
  return calls[calls.length - 1].arguments[0];
}

function includesPartial(items, expected) {
  return items.some((item) => {
    try {
      assert.partialDeepStrictEqual(item, expected);
      return true;
    } catch {
      return false;
    }
  });
}

describe('background controller', () => {
  let downloads;
  let messages;

  beforeEach(() => {
    downloads = [];
    messages = [];
    globalThis.chrome = createChromeMock();
    chrome.runtime.sendMessage.mock.mockImplementation(async (message) => {
      messages.push(message);
      if (message?.action === 'create-download-url') {
        return { url: 'blob:https://download/markdown' };
      }
      return { ok: true };
    });
    chrome.downloads.download.mock.mockImplementation((options) => {
      downloads.push(options);
      return Promise.resolve(1);
    });
  });

  test('saves a partial file after in-flight work finishes', async () => {
    let releaseSecond;
    const taskManager = new TaskManager();
    const scraper = {
      async scrape(task, url) {
        task.inProgress += 1;
        try {
          if (url.endsWith('/second')) {
            await new Promise((resolve) => {
              releaseSecond = resolve;
            });
            if (task.abort) {
              return false;
            }
          }
          task.addContent(url, {
            title: url.endsWith('/second') ? 'Second' : 'First',
            textContent: url.endsWith('/second') ? 'second body' : 'first body',
          });
          if (!url.endsWith('/second')) {
            task.addToQueue('https://example.com/second');
          }
          return true;
        } finally {
          task.inProgress = Math.max(0, task.inProgress - 1);
          task.attempts += 1;
        }
      },
    };

    installBackground(chrome, { taskManager, scraper });
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0].arguments[0];
    const started = dispatch(listener, {
      action: 'start',
      tabId: 7,
      startingUrl: 'https://example.com/first',
      settings: { maxPages: 5, concurrency: 1, crawlMode: true },
    });

    assert.deepEqual(started, { success: true });
    await waitFor(() => typeof releaseSecond === 'function');

    const stopped = dispatch(listener, { action: 'stop', tabId: 7 });
    assert.deepEqual(stopped, { success: true });
    assert.notEqual(taskManager.getTask(7), null);
    assert.equal(taskManager.getTask(7).signal.aborted, true);
    assert.equal(downloads.length, 0);

    releaseSecond();
    await waitFor(() => taskManager.getTask(7) === null);

    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].url.startsWith('blob:'), true);
    const created = messages.find((message) => message.action === 'create-download-url');
    assert.ok(created.content.includes('first body'));
    assert.equal(created.content.includes('second body'), false);
    assert.ok(chrome.offscreen.closeDocument.mock.callCount() >= 1);
  });

  test('reports scraping complete after the last page', async () => {
    const taskManager = new TaskManager();
    const statuses = [];
    const originalSend = taskManager.sendStatus.bind(taskManager);
    taskManager.sendStatus = (taskId, data) => {
      statuses.push(data);
      originalSend(taskId, data);
    };
    const scraper = {
      async scrape(task, url) {
        task.addContent(url, { title: 'Done', textContent: 'all done' });
        return true;
      },
    };

    installBackground(chrome, { taskManager, scraper });
    const listener = lastCallArg(chrome.runtime.onMessage.addListener);
    dispatch(listener, {
      action: 'start',
      tabId: 3,
      startingUrl: 'https://example.com/only',
      settings: { maxPages: 1, concurrency: 1, crawlMode: false },
    });

    await waitFor(() => taskManager.getTask(3) === null);
    const done = statuses.find((data) => data.done);
    assert.equal(done.processed, 1);
    assert.equal(done.total, 1);
    assert.equal(done.status.startsWith('Scraping complete'), true);
    assert.ok(done.status.includes('.md'));
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].url.startsWith('blob:'), true);
  });

  test('reports that no pages were saved', async () => {
    const taskManager = new TaskManager();
    const statuses = [];
    taskManager.sendStatus = (_taskId, data) => {
      statuses.push(data);
    };
    installBackground(chrome, {
      taskManager,
      scraper: { scrape: async () => false },
    });
    const listener = lastCallArg(chrome.runtime.onMessage.addListener);
    dispatch(listener, {
      action: 'start',
      tabId: 4,
      startingUrl: 'https://example.com/empty',
      settings: { maxPages: 1, concurrency: 1 },
    });

    await waitFor(() => statuses.some((data) => data.done));
    assert.equal(includesPartial(statuses, { done: true, status: 'No pages saved' }), true);
    assert.equal(downloads.length, 0);
  });

  test('rejects invalid control messages', () => {
    installBackground(chrome, {
      taskManager: new TaskManager(),
      scraper: { scrape: async () => false },
    });
    const listener = lastCallArg(chrome.runtime.onMessage.addListener);

    assert.deepEqual(dispatch(listener, null), {
      success: false,
      error: 'Invalid message payload',
    });
    assert.deepEqual(dispatch(listener, { action: 'start', tabId: 'x' }), {
      success: false,
      error: 'Missing task parameters',
    });
    assert.equal(
      dispatch(listener, { action: 'start', tabId: 1, startingUrl: 'chrome://extensions' }).success,
      false
    );
    assert.deepEqual(dispatch(listener, { action: 'stop', tabId: 123 }), {
      success: false,
      error: 'No active task',
    });
    assert.equal(dispatch(listener, { action: 'parse-html', html: '<p>Hi</p>' }), undefined);
    assert.equal(dispatch(listener, { action: 'create-download-url' }), undefined);
    assert.deepEqual(dispatch(listener, { action: 'ping' }), { success: true });
    assert.deepEqual(dispatch(listener, { action: 'nope' }), {
      success: false,
      error: 'Unknown action',
    });
  });

  test('reports running status for the current tab', () => {
    const taskManager = new TaskManager();
    installBackground(chrome, {
      taskManager,
      scraper: { scrape: () => new Promise(() => undefined) },
    });
    const listener = lastCallArg(chrome.runtime.onMessage.addListener);

    assert.deepEqual(dispatch(listener, { action: 'status', tabId: 11 }), {
      success: true,
      running: false,
      status: 'Ready',
      processed: 0,
      total: 0,
    });

    dispatch(listener, {
      action: 'start',
      tabId: 11,
      startingUrl: 'https://example.com/live',
      settings: { maxPages: 4, concurrency: 1, crawlMode: false },
    });

    assert.partialDeepStrictEqual(dispatch(listener, { action: 'status', tabId: 11 }), {
      success: true,
      running: true,
      processed: 0,
      total: 4,
    });
  });

  test('does not start a task for a foreign sender', () => {
    const taskManager = new TaskManager();
    installBackground(chrome, {
      taskManager,
      scraper: { scrape: async () => false },
    });
    const listener = lastCallArg(chrome.runtime.onMessage.addListener);
    const response = dispatch(
      listener,
      { action: 'start', tabId: 1, startingUrl: 'https://example.com/a' },
      { id: 'other-extension' }
    );

    assert.deepEqual(response, { success: false, error: 'Rejected sender' });
    assert.equal(taskManager.getTask(1), null);

    const connect = lastCallArg(chrome.runtime.onConnect.addListener);
    let listened = false;
    connect({
      name: 'popup',
      sender: { id: 'other-extension' },
      onMessage: {
        addListener: () => {
          listened = true;
        },
      },
      onDisconnect: { addListener: () => undefined },
    });
    assert.equal(listened, false);
  });

  test('reports a failed download and still closes the offscreen document', async () => {
    chrome.downloads.download.mock.mockImplementationOnce(
      () => Promise.reject(new Error('disk full')),
      0
    );
    const taskManager = new TaskManager();
    const statuses = [];
    taskManager.sendStatus = (_taskId, data) => {
      statuses.push(data);
    };
    installBackground(chrome, {
      taskManager,
      scraper: {
        async scrape(task) {
          task.addContent('https://example.com/fail', { title: 'T', textContent: 'body' });
          return true;
        },
      },
    });
    const listener = lastCallArg(chrome.runtime.onMessage.addListener);
    dispatch(listener, {
      action: 'start',
      tabId: 8,
      startingUrl: 'https://example.com/fail',
      settings: { maxPages: 1, concurrency: 1, crawlMode: false },
    });

    await waitFor(() => statuses.some((data) => data.done));
    assert.equal(
      includesPartial(statuses, {
        done: true,
        status: 'Scraping finished, but the download failed',
        debug: 'disk full',
      }),
      true
    );
    assert.ok(chrome.offscreen.closeDocument.mock.callCount() >= 1);
  });

  test('keeps the offscreen document open until the last task finishes', async () => {
    let releaseSlow;
    const taskManager = new TaskManager();
    installBackground(chrome, {
      taskManager,
      scraper: {
        async scrape(task, url) {
          await ensureOffscreenDocument(chrome);
          if (url.endsWith('/slow')) {
            await new Promise((resolve) => {
              releaseSlow = resolve;
            });
          }
          task.addContent(url, { title: 'T', textContent: 'body' });
          return true;
        },
      },
    });
    const listener = lastCallArg(chrome.runtime.onMessage.addListener);
    const settings = { maxPages: 1, concurrency: 1, crawlMode: false };
    dispatch(listener, {
      action: 'start',
      tabId: 20,
      startingUrl: 'https://example.com/slow',
      settings,
    });
    dispatch(listener, {
      action: 'start',
      tabId: 21,
      startingUrl: 'https://example.com/fast',
      settings,
    });

    await waitFor(() => taskManager.getTask(21) === null);
    assert.notEqual(taskManager.getTask(20), null);
    assert.equal(chrome.offscreen.isOpen(), true);
    assert.equal(chrome.offscreen.closeDocument.mock.callCount(), 0);

    releaseSlow();
    await waitFor(() => taskManager.getTask(20) === null);
    await waitFor(() => !chrome.offscreen.isOpen());
    assert.equal(chrome.offscreen.createDocument.mock.callCount(), 1);
    assert.equal(chrome.offscreen.closeDocument.mock.callCount(), 1);
    assert.equal(downloads.length, 2);
  });

  test('removes the task when the download and offscreen cleanup both fail', async () => {
    chrome.runtime.sendMessage.mock.mockImplementation(async () => {
      throw new Error('offscreen unavailable');
    });
    chrome.offscreen.closeDocument.mock.mockImplementation(() => {
      throw new TypeError('closeDocument failed');
    });
    const taskManager = new TaskManager();
    const statuses = [];
    taskManager.sendStatus = (_taskId, data) => {
      statuses.push(data);
    };
    installBackground(chrome, {
      taskManager,
      scraper: {
        async scrape(task, url) {
          task.addContent(url, { title: 'T', textContent: 'body' });
          return true;
        },
      },
    });
    const listener = lastCallArg(chrome.runtime.onMessage.addListener);
    const start = {
      action: 'start',
      tabId: 10,
      startingUrl: 'https://example.com/again',
      settings: { maxPages: 1, concurrency: 1, crawlMode: false },
    };
    dispatch(listener, start);

    await waitFor(() => taskManager.getTask(10) === null);
    assert.equal(
      includesPartial(statuses, {
        done: true,
        status: 'Scraping finished, but the download failed',
      }),
      true
    );
    assert.deepEqual(dispatch(listener, start), { success: true });
  });

  test('registers listeners when the service worker loads', async () => {
    const workerChrome = createChromeMock();
    globalThis.chrome = workerChrome;
    await import('../src/background/index.js');
    assert.equal(workerChrome.runtime.onMessage.addListener.mock.callCount(), 1);
    assert.equal(workerChrome.runtime.onConnect.addListener.mock.callCount(), 1);
  });
});
