import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initPopup } from '../src/popup/popup.js';
import { createChromeMock } from './chrome-mock.js';

const POPUP_HTML = `
  <label><input type="checkbox" id="crawlMode"> Crawl sub-pages</label>
  <p id="crawlWarning" hidden>Crawl opens each link on this site. A link can change your account or log you out.</p>
  <input type="number" id="maxPages" value="50">
  <input type="number" id="concurrency" value="3">
  <input type="number" id="delay" value="0">
  <button id="startButton">Start</button>
  <button id="stopButton" disabled>Stop</button>
  <button id="clearLogButton">Clear Log</button>
  <div id="status" aria-live="polite">Ready</div>
  <span id="processed">0</span>
  <span id="total">0</span>
  <div id="debugLog"></div>
`;

function sendMessageResponse(chromeApi, response) {
  chromeApi.runtime.sendMessage.mock.mockImplementation((message, callback) => {
    const payload = message?.action === 'status' ? { success: true, running: false } : response;
    if (typeof callback === 'function') {
      callback(payload);
      return undefined;
    }
    return Promise.resolve(payload);
  });
}

async function flushPopupClick() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function loadPopup(chromeApi) {
  const dom = new JSDOM(`<!doctype html><body>${POPUP_HTML}</body>`, {
    url: 'https://example.com/',
  });
  initPopup(dom.window.document, chromeApi);
  return flushPopupClick().then(() => dom);
}

describe('popup controls', () => {
  let chromeApi;

  beforeEach(() => {
    chromeApi = createChromeMock();
  });

  test('does not switch to running state when start fails', async () => {
    sendMessageResponse(chromeApi, { success: false, error: 'A task already exists for this tab' });
    const dom = await loadPopup(chromeApi);
    const { document } = dom.window;

    document.getElementById('startButton').click();
    await flushPopupClick();

    assert.equal(document.getElementById('startButton').disabled, false);
    assert.equal(document.getElementById('stopButton').disabled, true);
    assert.ok(
      document
        .getElementById('status')
        .textContent.includes('Error starting task: A task already exists for this tab')
    );
    assert.ok(
      document
        .getElementById('debugLog')
        .textContent.includes('Error starting task: A task already exists for this tab')
    );
  });

  test('switches to running state when start succeeds', async () => {
    sendMessageResponse(chromeApi, { success: true });
    const dom = await loadPopup(chromeApi);
    const { document } = dom.window;

    document.getElementById('startButton').click();
    await flushPopupClick();

    assert.equal(document.getElementById('startButton').disabled, true);
    assert.equal(document.getElementById('stopButton').disabled, false);
    const request = chromeApi.permissions.request.mock.calls[0].arguments;
    assert.deepEqual(request[0], {
      origins: [
        'http://example.com/*',
        'https://example.com/*',
        'http://www.example.com/*',
        'https://www.example.com/*',
      ],
    });
    assert.equal(typeof request[1], 'function');
  });

  test('does not send start when site access is denied', async () => {
    sendMessageResponse(chromeApi, { success: true });
    chromeApi.permissions.request.mock.mockImplementation((_permissions, callback) => {
      callback(false);
    });
    const dom = await loadPopup(chromeApi);
    const { document } = dom.window;

    document.getElementById('startButton').click();
    await flushPopupClick();

    const starts = chromeApi.runtime.sendMessage.mock.calls.filter(
      (call) => call.arguments[0]?.action === 'start'
    );
    assert.equal(starts.length, 0);
    assert.equal(document.getElementById('status').textContent, 'Site access was not granted');
    assert.equal(document.getElementById('startButton').disabled, false);
  });

  test('asks for the www pair of the open site', async () => {
    sendMessageResponse(chromeApi, { success: true });
    chromeApi.tabs.query.mock.mockImplementation(() =>
      Promise.resolve([{ id: 4, active: true, url: 'https://www.example.com/a' }])
    );
    const dom = await loadPopup(chromeApi);
    const { document } = dom.window;

    document.getElementById('startButton').click();
    await flushPopupClick();

    const request = chromeApi.permissions.request.mock.calls[0].arguments;
    assert.deepEqual(request[0], {
      origins: [
        'http://www.example.com/*',
        'https://www.example.com/*',
        'http://example.com/*',
        'https://example.com/*',
      ],
    });
    assert.equal(typeof request[1], 'function');
  });

  test('asks only for the address itself on an IP host', async () => {
    sendMessageResponse(chromeApi, { success: true });
    for (const [url, host] of [
      ['http://127.0.0.1:8080/a', '127.0.0.1'],
      ['http://[::1]:8080/a', '[::1]'],
    ]) {
      chromeApi.permissions.request.mock.resetCalls();
      chromeApi.tabs.query.mock.mockImplementation(() =>
        Promise.resolve([{ id: 5, active: true, url }])
      );
      const dom = await loadPopup(chromeApi);
      dom.window.document.getElementById('startButton').click();
      await flushPopupClick();

      const request = chromeApi.permissions.request.mock.calls[0].arguments;
      assert.deepEqual(request[0], { origins: [`http://${host}/*`, `https://${host}/*`] });
    }
  });

  test('disables start on a non-http page', async () => {
    chromeApi.tabs.query.mock.mockImplementation(() =>
      Promise.resolve([{ id: 1, active: true, url: 'chrome://extensions' }])
    );
    const dom = await loadPopup(chromeApi);
    const { document } = dom.window;

    assert.equal(document.getElementById('status').textContent, 'Open a normal web page first');
    assert.equal(document.getElementById('startButton').disabled, true);
  });

  test('restores a running task when the popup opens', async () => {
    chromeApi.runtime.sendMessage.mock.mockImplementation((message, callback) => {
      const response =
        message?.action === 'status'
          ? { success: true, running: true, status: 'Scraping', processed: 2, total: 50 }
          : { success: true };
      if (typeof callback === 'function') {
        callback(response);
      }
      return Promise.resolve(response);
    });
    const dom = await loadPopup(chromeApi);
    const { document } = dom.window;

    assert.equal(document.getElementById('startButton').disabled, true);
    assert.equal(document.getElementById('stopButton').disabled, false);
    assert.equal(document.getElementById('status').textContent, 'Scraping');
    assert.equal(document.getElementById('processed').textContent, '2');
    assert.equal(document.getElementById('total').textContent, '50');
  });

  test('shows the crawl warning only while crawl is checked', async () => {
    sendMessageResponse(chromeApi, { success: true });
    const dom = await loadPopup(chromeApi);
    const { document } = dom.window;

    const warning = document.getElementById('crawlWarning');
    assert.equal(warning.hidden, true);
    document.getElementById('crawlMode').checked = true;
    document.getElementById('crawlMode').dispatchEvent(new dom.window.Event('change'));
    assert.equal(warning.hidden, false);
    assert.ok(warning.textContent.includes('A link can change your account or log you out.'));
  });

  test('keeps start disabled after stop until the task is done', async () => {
    sendMessageResponse(chromeApi, { success: true });
    const dom = await loadPopup(chromeApi);
    const { document } = dom.window;

    document.getElementById('startButton').click();
    await flushPopupClick();
    document.getElementById('stopButton').click();
    await flushPopupClick();

    assert.equal(document.getElementById('startButton').disabled, true);
    assert.equal(document.getElementById('stopButton').disabled, false);
    assert.ok(document.getElementById('debugLog').textContent.includes('Stop requested by user.'));

    const port = chromeApi.runtime.connect.mock.calls.at(-1).result;
    const listener = port.onMessage.addListener.mock.calls[0].arguments[0];
    listener({ done: true, status: 'Stopped. Saved 1 page(s).' });

    assert.equal(document.getElementById('status').textContent, 'Stopped. Saved 1 page(s).');
    assert.equal(document.getElementById('startButton').disabled, false);
    assert.equal(document.getElementById('stopButton').disabled, true);
  });

  test('keeps running state when stop fails', async () => {
    sendMessageResponse(chromeApi, { success: false, error: 'No active task' });
    const dom = await loadPopup(chromeApi);
    const { document } = dom.window;

    document.getElementById('startButton').disabled = true;
    document.getElementById('stopButton').disabled = false;
    document.getElementById('stopButton').click();
    await flushPopupClick();

    assert.equal(document.getElementById('startButton').disabled, true);
    assert.equal(document.getElementById('stopButton').disabled, false);
    assert.ok(
      document.getElementById('status').textContent.includes('Error stopping task: No active task')
    );
    assert.ok(
      document
        .getElementById('debugLog')
        .textContent.includes('Error stopping task: No active task')
    );
  });
});
