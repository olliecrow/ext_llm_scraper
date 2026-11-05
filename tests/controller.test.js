import { installBackground } from '../src/background/controller.js';
import { TaskManager } from '../src/background/taskManager.js';

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

function dispatch(listener, message) {
  let response;
  listener(message, {}, (value) => {
    response = value;
  });
  return response;
}

describe('background controller', () => {
  let downloads;
  let messages;

  beforeEach(() => {
    downloads = [];
    messages = [];
    chrome.offscreen = {
      createDocument: jest.fn(() => Promise.resolve()),
      closeDocument: jest.fn(() => Promise.resolve()),
    };
    chrome.runtime.sendMessage.mockImplementation(async (message) => {
      messages.push(message);
      if (message?.action === 'create-download-url') {
        return { url: 'blob:https://download/markdown' };
      }
      return { ok: true };
    });
    chrome.downloads.download.mockImplementation((options) => {
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
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const started = dispatch(listener, {
      action: 'start',
      tabId: 7,
      startingUrl: 'https://example.com/first',
      settings: { maxPages: 5, concurrency: 1, crawlMode: true },
    });

    expect(started).toEqual({ success: true });
    await waitFor(() => typeof releaseSecond === 'function');

    const stopped = dispatch(listener, { action: 'stop', tabId: 7 });
    expect(stopped).toEqual({ success: true });
    expect(taskManager.getTask(7)).not.toBeNull();
    expect(downloads).toHaveLength(0);

    releaseSecond();
    await waitFor(() => taskManager.getTask(7) === null);

    expect(downloads).toHaveLength(1);
    expect(downloads[0].url.startsWith('blob:')).toBe(true);
    const created = messages.find((message) => message.action === 'create-download-url');
    expect(created.content).toContain('first body');
    expect(created.content).not.toContain('second body');
    expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
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
    const listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)[0];
    dispatch(listener, {
      action: 'start',
      tabId: 3,
      startingUrl: 'https://example.com/only',
      settings: { maxPages: 1, concurrency: 1, crawlMode: false },
    });

    await waitFor(() => taskManager.getTask(3) === null);
    const done = statuses.find((data) => data.done);
    expect(done.processed).toBe(1);
    expect(done.total).toBe(1);
    expect(done.status.startsWith('Scraping complete')).toBe(true);
    expect(done.status).toContain('.md');
    expect(downloads).toHaveLength(1);
    expect(downloads[0].url.startsWith('blob:')).toBe(true);
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
    const listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)[0];
    dispatch(listener, {
      action: 'start',
      tabId: 4,
      startingUrl: 'https://example.com/empty',
      settings: { maxPages: 1, concurrency: 1 },
    });

    await waitFor(() => statuses.some((data) => data.done));
    expect(statuses).toContainEqual(
      expect.objectContaining({ done: true, status: 'No pages saved' })
    );
    expect(downloads).toHaveLength(0);
  });

  test('rejects invalid control messages', () => {
    installBackground(chrome, {
      taskManager: new TaskManager(),
      scraper: { scrape: async () => false },
    });
    const listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)[0];

    expect(dispatch(listener, null)).toEqual({
      success: false,
      error: 'Invalid message payload',
    });
    expect(dispatch(listener, { action: 'start', tabId: 'x' })).toEqual({
      success: false,
      error: 'Missing task parameters',
    });
    expect(
      dispatch(listener, { action: 'start', tabId: 1, startingUrl: 'chrome://extensions' }).success
    ).toBe(false);
    expect(dispatch(listener, { action: 'stop', tabId: 123 })).toEqual({
      success: false,
      error: 'No active task',
    });
    expect(dispatch(listener, { action: 'ping' })).toEqual({ success: true });
    expect(dispatch(listener, { action: 'nope' })).toEqual({
      success: false,
      error: 'Unknown action',
    });
  });

  test('reports a failed download and still closes the offscreen document', async () => {
    chrome.downloads.download.mockRejectedValueOnce(new Error('disk full'));
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
    const listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)[0];
    dispatch(listener, {
      action: 'start',
      tabId: 8,
      startingUrl: 'https://example.com/fail',
      settings: { maxPages: 1, concurrency: 1, crawlMode: false },
    });

    await waitFor(() => statuses.some((data) => data.done));
    expect(statuses).toContainEqual(
      expect.objectContaining({
        done: true,
        status: 'Scraping finished, but the download failed',
        debug: 'disk full',
      })
    );
    expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
  });

  test('recreates the offscreen document when one is already open', async () => {
    chrome.offscreen.createDocument
      .mockRejectedValueOnce(new Error('Only a single offscreen document may be created'))
      .mockResolvedValueOnce(undefined);
    const taskManager = new TaskManager();
    installBackground(chrome, {
      taskManager,
      scraper: {
        async scrape(task, url) {
          task.addContent(url, { title: 'T', textContent: 'body' });
          return true;
        },
      },
    });
    const listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)[0];
    dispatch(listener, {
      action: 'start',
      tabId: 9,
      startingUrl: 'https://example.com/retry',
      settings: { maxPages: 1, concurrency: 1, crawlMode: false },
    });

    await waitFor(() => taskManager.getTask(9) === null);
    expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(2);
    expect(downloads[0].url.startsWith('blob:')).toBe(true);
  });
});
