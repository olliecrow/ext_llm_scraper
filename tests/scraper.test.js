import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PageScraper, extractPageContent } from '../src/background/scraper.js';
import { TaskManager } from '../src/background/taskManager.js';
import { TaskState } from '../src/background/taskState.js';
import { createChromeMock } from './chrome-mock.js';

const createTask = () =>
  new TaskState(1, 'https://example.com', { maxPages: 5, concurrency: 1, crawlMode: true });

function queueExecuteScript(chromeApi, results) {
  results.forEach((result, index) => {
    chromeApi.scripting.executeScript.mock.mockImplementationOnce(
      () => Promise.resolve(result),
      index
    );
  });
}

function withDom(html, run) {
  const dom = new JSDOM(
    `<!doctype html><html><head><title>Original title</title></head><body>${html}</body></html>`,
    {
      url: 'https://example.com/',
    }
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    return run(dom);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

describe('PageScraper', () => {
  let scraper;
  let taskManager;
  let task;

  beforeEach(() => {
    globalThis.chrome = createChromeMock();
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('no static fetch')));
    taskManager = new TaskManager();
    scraper = new PageScraper(taskManager);
    task = createTask();
  });

  test('reserves start offsets before any timer fires', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
    try {
      task.settings.delay = 1000;
      const starts = [
        scraper.reserveStart(task),
        scraper.reserveStart(task),
        scraper.reserveStart(task),
      ];
      assert.deepEqual(starts, [1_000_000, 1_001_000, 1_002_000]);
    } finally {
      mock.timers.reset();
    }
  });

  test('does not count a failed tab as a saved page', async () => {
    chrome.tabs.create.mock.mockImplementationOnce(() => Promise.reject(new Error('no tab')), 0);

    const result = await scraper.scrape(task, 'https://example.com/missing');

    assert.equal(result, false);
    assert.equal(task.processed, 0);
    assert.equal(task.attempts, 1);
    assert.equal(task.contentMap.size, 0);
  });

  test('reports one saved page after a failed attempt', async () => {
    chrome.tabs.create.mock.mockImplementationOnce(() => Promise.reject(new Error('no tab')), 0);
    await scraper.scrape(task, 'https://example.com/missing');
    scraper.nextStart = 0;
    queueExecuteScript(chrome, [
      [{ result: null }],
      [
        {
          result: {
            title: 'Ok',
            content: 'Body text',
            links: [],
          },
        },
      ],
    ]);
    const statuses = [];
    taskManager.sendStatus = (_id, data) => {
      statuses.push(data);
    };

    const ok = await scraper.scrape(task, 'https://example.com/ok');

    assert.equal(ok, true);
    assert.equal(task.processed, 1);
    assert.equal(task.attempts, 2);
    assert.ok(
      statuses.some((status) => status.status === 'Scraped 1 page(s)' && status.processed === 1)
    );
  });

  test('returns false for invalid URLs', async () => {
    const result = await scraper.scrape(task, 'not-a-url');
    assert.equal(result, false);
    assert.equal(task.processed, 0);
  });

  test('skips excluded extensions', async () => {
    const result = await scraper.scrape(task, 'https://example.com/file.pdf');
    assert.equal(result, false);
    assert.equal(task.processed, 0);
  });

  test('extracts content and queues links', async () => {
    queueExecuteScript(chrome, [
      [{ result: null }],
      [
        {
          result: {
            url: 'https://example.com/about',
            title: 'About',
            content: 'About page content',
            links: ['https://example.com/team', 'https://other.com/skip'],
          },
        },
      ],
    ]);

    const result = await scraper.scrape(task, 'https://example.com/about');

    assert.equal(result, true);
    assert.equal(task.processed, 1);
    assert.deepEqual(task.contentMap.get('https://example.com/about'), {
      title: 'About',
      textContent: 'About page content',
    });
    assert.ok(task.queue.includes('https://example.com/team'));
    assert.equal(task.queue.includes('https://other.com/skip'), false);
  });

  test('does not scrape when task is already aborted', async () => {
    task.abort = true;

    const result = await scraper.scrape(task, 'https://example.com/about');

    assert.equal(result, false);
    assert.equal(chrome.tabs.create.mock.callCount(), 0);
  });

  test('stops before extraction when cancellation arrives during page load', async () => {
    mock.method(scraper, 'waitForTabLoad', async () => {
      task.abort = true;
    });

    const result = await scraper.scrape(task, 'https://example.com/about');

    assert.equal(result, false);
    assert.equal(chrome.scripting.executeScript.mock.callCount(), 0);
    assert.deepEqual(chrome.tabs.remove.mock.calls[0].arguments, [1]);
  });

  test('queues the www pair and standard ports, and drops other hosts and ports', () => {
    scraper.enqueueDiscoveredLinks(task, [
      'https://www.example.com/about',
      'https://other.example.com/',
      'https://other.com/',
      'https://example.com:8443/admin',
      'https://example.com:443/explicit',
      'https://example.com/explicit',
      'http://example.com/plain',
    ]);

    assert.ok(task.queue.includes('https://www.example.com/about'));
    assert.ok(task.queue.includes('http://example.com/plain'));
    assert.equal(task.queue.filter((url) => url === 'https://example.com/explicit').length, 1);
    assert.equal(task.queue.includes('https://other.example.com/'), false);
    assert.equal(task.queue.includes('https://other.com/'), false);
    assert.equal(task.queue.includes('https://example.com:8443/admin'), false);

    const wwwTask = new TaskState(2, 'https://www.example.com/', {
      maxPages: 5,
      crawlMode: true,
    });
    scraper.enqueueDiscoveredLinks(wwwTask, [
      'https://example.com/about',
      'https://blog.example.com/no',
    ]);
    assert.ok(wwwTask.queue.includes('https://example.com/about'));
    assert.equal(wwwTask.queue.includes('https://blog.example.com/no'), false);

    const custom = new TaskState(3, 'https://example.com:8443/', {
      maxPages: 5,
      crawlMode: true,
    });
    scraper.enqueueDiscoveredLinks(custom, [
      'https://example.com/home',
      'https://example.com:8443/admin',
      'http://example.com:8443/also',
    ]);
    assert.ok(custom.queue.includes('https://example.com:8443/admin'));
    assert.ok(custom.queue.includes('http://example.com:8443/also'));
    assert.equal(custom.queue.includes('https://example.com/home'), false);
  });

  test('queues only valid same-domain links when crawl mode is enabled', () => {
    scraper.enqueueDiscoveredLinks(task, [
      'https://example.com/team',
      'https://example.com/team?ref=1',
      'https://example.com/report.pdf',
      'https://other.com/skip',
      'mailto:test@example.com',
      null,
    ]);

    assert.ok(task.queue.includes('https://example.com/team'));
    assert.equal(task.queue.filter((url) => url === 'https://example.com/team').length, 1);
    assert.equal(task.queue.includes('https://example.com/report.pdf'), false);
    assert.equal(task.queue.includes('https://other.com/skip'), false);
  });

  test('fetches a long article without opening a tab', async () => {
    const sentence = 'Alpha beta gamma delta epsilon. ';
    const html = `<!DOCTYPE html><html><head><title>Fetched title</title></head><body><article><p>${sentence.repeat(12)}</p><a href="https://example.com/next">Next</a><a href="mailto:person@example.com">Mail</a></article></body></html>`;
    globalThis.fetch = mock.fn(async () => ({
      url: 'https://example.com/article',
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => html,
    }));
    chrome.runtime.sendMessage.mock.mockImplementation(async (message) => {
      assert.equal(message.action, 'parse-html');
      return {
        title: 'Fetched title',
        content: sentence.repeat(12),
        links: ['https://example.com/next'],
      };
    });

    const result = await scraper.scrape(task, 'https://example.com/article');

    assert.equal(result, true);
    assert.equal(chrome.tabs.create.mock.callCount(), 0);
    assert.equal(task.contentMap.get('https://example.com/article').title, 'Fetched title');
    assert.match(
      task.contentMap.get('https://example.com/article').textContent,
      /Alpha beta gamma delta epsilon/
    );
    assert.ok(task.queue.includes('https://example.com/next'));
    assert.equal(
      task.queue.every((link) => link.startsWith('https://') || link.startsWith('http://')),
      true
    );
    assert.equal(
      task.queue.some((link) => link.startsWith('mailto:')),
      false
    );
  });

  test('opens a tab when the fetched body is twenty characters', async () => {
    globalThis.fetch = mock.fn(async () => ({
      url: 'https://example.com/short',
      headers: { get: () => 'text/html' },
      text: async () => '<html><body>12345678901234567890</body></html>',
    }));
    chrome.runtime.sendMessage.mock.mockImplementation(async (message) => ({
      title: 'Short',
      content: '12345678901234567890',
      links: [],
      action: message.action,
    }));

    const result = await scraper.scrape(task, 'https://example.com/short');

    assert.equal(result, true);
    assert.equal(chrome.tabs.create.mock.callCount(), 1);
  });

  test('discards a fetch that redirects off the site', async () => {
    globalThis.fetch = mock.fn(async () => ({
      url: 'https://other.example/landed',
      headers: { get: () => 'text/html' },
      text: async () => '<html><body>not used</body></html>',
    }));

    const result = await scraper.scrape(task, 'https://example.com/start');

    assert.equal(result, false);
    assert.equal(chrome.tabs.create.mock.callCount(), 0);
    assert.equal(task.contentMap.size, 0);
  });

  test('logs when Readability is not injected', async () => {
    const statuses = [];
    taskManager.sendStatus = (_id, data) => {
      statuses.push(data);
    };
    chrome.scripting.executeScript.mock.mockImplementation((options) => {
      if (options.files) {
        return Promise.reject(new Error('injection failed'));
      }
      return Promise.resolve([
        {
          result: {
            title: 'Tab title',
            content: 'Tab body with enough text',
            links: [],
          },
        },
      ]);
    });

    const result = await scraper.scrape(task, 'https://example.com/page');

    assert.equal(result, true);
    assert.ok(statuses.some((status) => status.debug === 'Readability was not injected'));
  });
});

describe('extractPageContent', () => {
  test('uses Readability when it returns useful text', () => {
    withDom(
      `
      <main>Fallback content</main>
      <a href="https://example.com/a">A</a>
      <a href="mailto:test@example.com">Mail</a>
    `,
      () => {
        window.Readability = class {
          parse() {
            return {
              title: 'Readable title',
              textContent: 'Readable content with enough text to use. '.repeat(5),
            };
          }
        };

        const result = extractPageContent();

        assert.equal(result.title, 'Readable title');
        assert.ok(result.content.includes('Readable content with enough text to use.'));
        assert.deepEqual(result.links, ['https://example.com/a']);
      }
    );
  });

  test('falls back to main page text when Readability is missing', () => {
    withDom('<main></main>', () => {
      document.querySelector('main').innerText = 'Main content '.repeat(30);

      const result = extractPageContent();

      assert.ok(result.content.includes('Main content'));
    });
  });

  test('runs inside a page without module helpers', () => {
    withDom(
      `
      <a href="https://example.com/a">A</a>
      <a href="mailto:test@example.com">Mail</a>
    `,
      () => {
        const isolated = new Function(`return (${extractPageContent.toString()})`)();
        const result = isolated();
        assert.equal(result.title, 'Original title');
        assert.deepEqual(result.links, ['https://example.com/a']);
      }
    );
  });

  test('uses body text as the last content fallback', () => {
    withDom('<section>No main content</section>', () => {
      document.body.innerText = 'Body text fallback';

      const result = extractPageContent();

      assert.equal(result.content, 'Body text fallback');
    });
  });
});
