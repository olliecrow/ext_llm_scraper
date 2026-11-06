import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PageScraper, extractPageContent } from '../src/background/scraper.js';
import { TaskManager } from '../src/background/taskManager.js';
import { TaskState } from '../src/background/taskState.js';
import { createChromeMock } from './chrome-mock.js';
import { CONFIG } from '../src/shared/config.js';

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
    assert.equal(task.contentMap.size, 0);
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
            url: 'https://example.com/ok',
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
    assert.equal(task.contentMap.size, 1);
    assert.equal(task.attempts, 2);
    assert.ok(
      statuses.some((status) => status.status === 'Scraped 1 page(s)' && status.processed === 1)
    );
  });

  test('returns false for invalid URLs', async () => {
    const result = await scraper.scrape(task, 'not-a-url');
    assert.equal(result, false);
    assert.equal(task.contentMap.size, 0);
  });

  test('skips excluded extensions', async () => {
    const result = await scraper.scrape(task, 'https://example.com/file.pdf');
    assert.equal(result, false);
    assert.equal(task.contentMap.size, 0);
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
    assert.equal(task.contentMap.size, 1);
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

  test('decodes a streamed Latin-1 response using the header charset', async () => {
    const text = 'Café déjà vu. '.repeat(30);
    globalThis.fetch = mock.fn(async (url) => ({
      url,
      headers: { get: () => 'text/html; charset="ISO-8859-1"' },
      body: new Response(Buffer.from(`<article>${text}</article>`, 'latin1')).body,
    }));
    chrome.runtime.sendMessage.mock.mockImplementation(async ({ html }) => {
      assert.ok(html.includes(text));
      return { url: 'https://example.com/', title: 'Latin', content: text, links: [] };
    });
    assert.equal(await scraper.scrape(task, 'https://example.com/'), true);
    assert.equal(chrome.tabs.create.mock.callCount(), 0);
    assert.equal(task.contentMap.get('https://example.com/').textContent, text);
  });

  for (const type of ['', 'text/html']) {
    test(`uses the browser encoding rules for meta charset with type ${type}`, async () => {
      globalThis.fetch = mock.fn(async (url) => ({
        url,
        headers: { get: () => type },
        body: new Response(
          Buffer.from(
            `<meta charset="iso-8859-1"><article>${'Café '.repeat(40)}</article>`,
            'latin1'
          )
        ).body,
      }));
      chrome.runtime.sendMessage.mock.mockImplementation(async ({ html }) => ({
        url: 'https://example.com/',
        title: 'Static',
        content: html,
        links: [],
      }));
      const text = 'Café '.repeat(40);
      queueExecuteScript(chrome, [
        [{ result: null }],
        [
          {
            result: {
              url: 'https://example.com/',
              title: 'Latin meta',
              content: text,
              links: [],
            },
          },
        ],
      ]);
      assert.equal(await scraper.scrape(task, 'https://example.com/'), true);
      assert.equal(chrome.tabs.create.mock.callCount(), 1);
      assert.equal(task.contentMap.get('https://example.com/').textContent, text);
    });
  }

  test('keeps a utf-8 meta page on the static path', async () => {
    const cases = [
      '<meta charset="utf-8">',
      '<meta charset="utf8">',
      '<meta charset="UTF-8">',
      '<meta charset="unicode-1-1-utf-8">',
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
      '<meta http-equiv="content-type" content="text/html">',
      '<meta name="description" content="charset=iso-8859-1">',
    ];
    for (const [index, meta] of cases.entries()) {
      const text = `Café static ${index} `.repeat(12);
      const pageUrl = `https://example.com/utf8-meta-${index}`;
      const html = `<!doctype html><html><head>${meta}<title>Meta</title></head><body><article><p>${text}</p></article></body></html>`;
      globalThis.fetch = mock.fn(async (url) => ({
        url,
        headers: { get: () => 'text/html' },
        body: new Response(Buffer.from(html, 'utf8')).body,
      }));
      chrome.runtime.sendMessage.mock.mockImplementation(async ({ html: body }) => {
        assert.match(body, /Café/);
        return { url: pageUrl, title: 'Meta', content: text, links: [] };
      });
      scraper.nextStart = 0;
      const tabsBefore = chrome.tabs.create.mock.callCount();

      assert.equal(await scraper.scrape(task, pageUrl), true, meta);
      assert.equal(chrome.tabs.create.mock.callCount(), tabsBefore, meta);
      assert.equal(task.contentMap.get(pageUrl).textContent, text, meta);
    }
  });

  test('opens a tab when a meta charset names another encoding', async () => {
    const text = 'Euro mark '.repeat(20);
    const html =
      '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">' +
      `<article>${text}</article>`;
    globalThis.fetch = mock.fn(async (url) => ({
      url,
      headers: { get: () => 'text/html' },
      body: new Response(Buffer.from(html, 'utf8')).body,
    }));
    queueExecuteScript(chrome, [
      [{ result: null }],
      [
        {
          result: {
            url: 'https://example.com/equiv',
            title: 'Equiv',
            content: text,
            links: [],
          },
        },
      ],
    ]);

    assert.equal(await scraper.scrape(task, 'https://example.com/equiv'), true);
    assert.equal(chrome.tabs.create.mock.callCount(), 1);
    assert.equal(task.contentMap.get('https://example.com/equiv').textContent, text);
  });

  test('opens a tab when the meta charset label is invalid', async () => {
    const cases = ['<meta charset="x-not-a-charset">', '<meta charset="">', '<meta charset=>'];
    const pages = cases.map((meta, index) => {
      const text = `Plain static page ${index}. `.repeat(12);
      return { meta, text, pageUrl: `https://example.com/bad-meta-${index}` };
    });
    queueExecuteScript(
      chrome,
      pages.flatMap(({ text, pageUrl }) => [
        [{ result: null }],
        [{ result: { url: pageUrl, title: 'Bad meta', content: text, links: [] } }],
      ])
    );
    for (const { meta, text, pageUrl } of pages) {
      const html = `<head>${meta}</head><article>${text}</article>`;
      globalThis.fetch = mock.fn(async (url) => ({
        url,
        headers: { get: () => 'text/html' },
        body: new Response(Buffer.from(html, 'utf8')).body,
      }));
      scraper.nextStart = 0;

      assert.equal(await scraper.scrape(task, pageUrl), true, meta);
      assert.equal(task.contentMap.get(pageUrl).textContent, text, meta);
    }
    assert.equal(chrome.tabs.create.mock.callCount(), pages.length);
  });

  test('keeps a header charset when the meta charset names a different encoding', async () => {
    const text = 'Café '.repeat(40);
    const html = `<meta charset="utf-8"><article>${text}</article>`;
    globalThis.fetch = mock.fn(async (url) => ({
      url,
      headers: { get: () => 'text/html; charset=iso-8859-1' },
      body: new Response(Buffer.from(html, 'latin1')).body,
    }));
    chrome.runtime.sendMessage.mock.mockImplementation(async ({ html: body }) => {
      assert.match(body, /Café/);
      return {
        url: 'https://example.com/header-wins',
        title: 'Header',
        content: text,
        links: [],
      };
    });

    assert.equal(await scraper.scrape(task, 'https://example.com/header-wins'), true);
    assert.equal(chrome.tabs.create.mock.callCount(), 0);
    assert.equal(task.contentMap.get('https://example.com/header-wins').textContent, text);
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

  test('stop ends a fetch whose headers never arrive', async () => {
    task.addContent('https://example.com/saved', { title: 'Saved', textContent: 'kept' });
    globalThis.fetch = mock.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        })
    );

    const run = scraper.scrape(task, 'https://example.com/stalled');
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    assert.equal(task.inProgress, 1);
    task.stop();

    assert.equal(await run, false);
    assert.equal(task.inProgress, 0);
    assert.equal(task.contentMap.size, 1);
    assert.equal(chrome.tabs.create.mock.callCount(), 0);
  });

  test('stop ends a body read that stalls after the first chunk', async () => {
    globalThis.fetch = mock.fn(async (url, { signal }) => {
      let sent = false;
      return {
        url,
        headers: { get: () => 'text/html' },
        body: {
          getReader: () => ({
            read: () => {
              if (!sent) {
                sent = true;
                return Promise.resolve({ done: false, value: new TextEncoder().encode('<p>') });
              }
              return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason));
              });
            },
            cancel: () => Promise.resolve(),
          }),
        },
      };
    });

    const run = scraper.scrape(task, 'https://example.com/slow-body');
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    task.stop();

    assert.equal(await run, false);
    assert.equal(task.inProgress, 0);
    assert.equal(chrome.tabs.create.mock.callCount(), 0);
  });

  test('stop ends the wait for a reserved start', async () => {
    task.settings.delay = 60000;
    scraper.nextStart = Date.now() + 60000;
    const run = scraper.scrape(task, 'https://example.com/later');
    task.stop();

    assert.equal(await run, false);
    assert.equal(globalThis.fetch.mock.callCount(), 0);
  });

  test('stop ends the wait for a tab to load', async () => {
    chrome.tabs.get.mock.mockImplementation((tabId, callback) => {
      callback({ id: tabId, status: 'loading' });
    });
    const run = scraper.scrape(task, 'https://example.com/tab');
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    task.stop();

    assert.equal(await run, false);
    assert.equal(chrome.scripting.executeScript.mock.callCount(), 0);
    assert.deepEqual(chrome.tabs.remove.mock.calls[0].arguments, [1]);
  });

  test('a fetch past its deadline falls back to a tab', async () => {
    const original = CONFIG.TIMEOUTS.STATIC_FETCH;
    CONFIG.TIMEOUTS.STATIC_FETCH = 10;
    // AbortSignal.timeout does not keep Node's event loop alive.
    const keepAlive = setTimeout(() => undefined, 5000);
    try {
      globalThis.fetch = mock.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
          })
      );
      queueExecuteScript(chrome, [
        [{ result: null }],
        [
          {
            result: {
              url: 'https://example.com/slow',
              title: 'Slow',
              content: 'Tab body',
              links: [],
            },
          },
        ],
      ]);

      const result = await scraper.scrape(task, 'https://example.com/slow');

      assert.equal(result, true);
      assert.equal(chrome.tabs.create.mock.callCount(), 1);
    } finally {
      clearTimeout(keepAlive);
      CONFIG.TIMEOUTS.STATIC_FETCH = original;
    }
  });

  test('drops a tab that a redirect took to another site', async () => {
    const statuses = [];
    taskManager.sendStatus = (_id, data) => {
      statuses.push(data);
    };
    chrome.tabs.get.mock.mockImplementation((tabId, callback) => {
      const tab = { id: tabId, status: 'complete', url: 'https://other.example/' };
      if (callback) {
        callback(tab);
        return undefined;
      }
      return Promise.resolve(tab);
    });

    const result = await scraper.scrape(task, 'https://example.com/moved');

    assert.equal(result, false);
    assert.equal(chrome.scripting.executeScript.mock.callCount(), 0);
    assert.equal(task.contentMap.size, 0);
    assert.deepEqual(chrome.tabs.remove.mock.calls[0].arguments, [1]);
    assert.ok(statuses.some((status) => status.status === 'Skipping redirect off this site'));
  });

  test('drops a tab whose URL is hidden because the site has no access', async () => {
    chrome.tabs.get.mock.mockImplementation((tabId, callback) => {
      const tab = { id: tabId, status: 'complete' };
      if (callback) {
        callback(tab);
        return undefined;
      }
      return Promise.resolve(tab);
    });

    const result = await scraper.scrape(task, 'https://example.com/moved');

    assert.equal(result, false);
    assert.equal(chrome.scripting.executeScript.mock.callCount(), 0);
  });

  test('drops content that was extracted from another site', async () => {
    queueExecuteScript(chrome, [
      [{ result: null }],
      [
        {
          result: {
            url: 'https://other.example/',
            title: 'Other site',
            content: 'Foreign site content',
            links: [],
          },
        },
      ],
    ]);

    const result = await scraper.scrape(task, 'https://example.com/');

    assert.equal(result, false);
    assert.equal(task.contentMap.size, 0);
  });

  test('skips style sheets and scripts served without a file extension', async () => {
    for (const type of ['text/css', 'text/javascript; charset=utf-8', 'application/json']) {
      globalThis.fetch = mock.fn(async (url) => ({
        url,
        headers: { get: () => type },
        text: async () => 'body { color: red; }'.repeat(20),
      }));
      scraper.nextStart = 0;

      const result = await scraper.scrape(task, 'https://example.com/asset');

      assert.equal(result, false, type);
    }
    assert.equal(chrome.tabs.create.mock.callCount(), 0);
    assert.equal(task.contentMap.size, 0);
  });

  test('renders a hash route in a tab instead of fetching the app shell', async () => {
    queueExecuteScript(chrome, [
      [{ result: null }],
      [
        {
          result: {
            url: 'https://example.com/#/about',
            title: 'About route',
            content: 'Rendered route',
            links: [],
          },
        },
      ],
    ]);

    const result = await scraper.scrape(task, 'https://example.com/#/about');

    assert.equal(result, true);
    assert.equal(globalThis.fetch.mock.callCount(), 0);
    assert.equal(chrome.tabs.create.mock.callCount(), 1);
    assert.equal(task.contentMap.get('https://example.com/#/about').title, 'About route');
  });

  test('stores the final URL after a same-site redirect', async () => {
    globalThis.fetch = mock.fn(async () => ({
      url: 'https://example.com/new',
      headers: { get: () => 'text/html' },
      text: async () => '<article>Final text</article>',
    }));
    chrome.runtime.sendMessage.mock.mockImplementation(async () => ({
      title: 'Final',
      content: 'Final text '.repeat(20),
      links: [],
    }));
    assert.equal(await scraper.scrape(task, 'https://example.com/old'), true);
    assert.equal(task.contentMap.has('https://example.com/new'), true);
    assert.equal(task.contentMap.has('https://example.com/old'), false);
  });

  test('allows a hash route to render after the load event', async () => {
    let text = 'Shell placeholder';
    const timer = setTimeout(() => {
      text = 'Rendered route';
    }, 100);
    try {
      scraper.extractContent = async () => ({
        url: 'https://example.com/#/async',
        title: 'Async',
        content: text,
        links: [],
      });
      assert.equal(await scraper.scrape(task, 'https://example.com/#/async'), true);
      assert.equal(
        task.contentMap.get('https://example.com/#/async').textContent,
        'Rendered route'
      );
    } finally {
      clearTimeout(timer);
    }
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
            url: 'https://example.com/page',
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

  test('resolves links against the base element', () => {
    const cases = [
      ['<base href="https://example.com/docs/">', 'https://example.com/docs/next'],
      ['<base href="/guide/">', 'https://example.com/guide/next'],
      ['<base href="http://[bad">', 'https://example.com/next'],
      ['', 'https://example.com/next'],
    ];
    for (const [base, expected] of cases) {
      const dom = new JSDOM(
        `<!doctype html><html><head>${base}</head><body><a href="next">Next</a></body></html>`,
        { url: 'https://example.com/start' }
      );
      const result = extractPageContent(dom.window.document, 'https://example.com/start');
      assert.deepEqual(result.links, [expected], base);
    }
  });

  test('resolves base links in a parsed copy with no page URL of its own', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'chrome-extension://ext-id/offscreen.html',
    });
    const parsed = new dom.window.DOMParser().parseFromString(
      '<base href="/docs/"><a href="next">Next</a><a href="https://example.com/abs">Abs</a>',
      'text/html'
    );

    const result = extractPageContent(parsed, 'https://example.com/start');

    assert.deepEqual(result.links, ['https://example.com/docs/next', 'https://example.com/abs']);
  });

  test('uses body text as the last content fallback', () => {
    withDom('<section>No main content</section>', () => {
      document.body.innerText = 'Body text fallback';

      const result = extractPageContent();

      assert.equal(result.content, 'Body text fallback');
    });
  });
});
