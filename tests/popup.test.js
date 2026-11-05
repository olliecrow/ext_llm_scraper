async function loadPopup() {
  document.body.innerHTML = `
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

  await import('../src/popup/popup.js');
  await flushPopupClick();
}

function sendMessageResponse(response) {
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
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
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('popup controls', () => {
  beforeEach(() => {
    jest.resetModules();
    chrome.tabs.query.mockReset();
    chrome.tabs.query.mockResolvedValue([{ id: 1, active: true, url: 'https://example.com' }]);
    chrome.permissions = {
      request: jest.fn((_permissions, callback) => {
        callback(true);
      }),
    };
  });

  test('does not switch to running state when start fails', async () => {
    sendMessageResponse({ success: false, error: 'A task already exists for this tab' });
    await loadPopup();

    document.getElementById('startButton').click();
    await flushPopupClick();

    expect(document.getElementById('startButton').disabled).toBe(false);
    expect(document.getElementById('stopButton').disabled).toBe(true);
    expect(document.getElementById('status').textContent).toContain(
      'Error starting task: A task already exists for this tab'
    );
    expect(document.getElementById('debugLog').textContent).toContain(
      'Error starting task: A task already exists for this tab'
    );
  });

  test('switches to running state when start succeeds', async () => {
    sendMessageResponse({ success: true });
    await loadPopup();

    document.getElementById('startButton').click();
    await flushPopupClick();

    expect(document.getElementById('startButton').disabled).toBe(true);
    expect(document.getElementById('stopButton').disabled).toBe(false);
    expect(chrome.permissions.request).toHaveBeenCalledWith(
      {
        origins: [
          'http://example.com/*',
          'https://example.com/*',
          'http://www.example.com/*',
          'https://www.example.com/*',
        ],
      },
      expect.any(Function)
    );
  });

  test('does not send start when site access is denied', async () => {
    sendMessageResponse({ success: true });
    chrome.permissions.request.mockImplementation((_permissions, callback) => {
      callback(false);
    });
    await loadPopup();

    document.getElementById('startButton').click();
    await flushPopupClick();

    const starts = chrome.runtime.sendMessage.mock.calls.filter(
      (call) => call[0]?.action === 'start'
    );
    expect(starts).toHaveLength(0);
    expect(document.getElementById('status').textContent).toBe('Site access was not granted');
    expect(document.getElementById('startButton').disabled).toBe(false);
  });

  test('asks for the www pair of the open site', async () => {
    sendMessageResponse({ success: true });
    chrome.tabs.query.mockResolvedValue([
      { id: 4, active: true, url: 'https://www.example.com/a' },
    ]);
    await loadPopup();

    document.getElementById('startButton').click();
    await flushPopupClick();

    expect(chrome.permissions.request).toHaveBeenCalledWith(
      {
        origins: [
          'http://www.example.com/*',
          'https://www.example.com/*',
          'http://example.com/*',
          'https://example.com/*',
        ],
      },
      expect.any(Function)
    );
  });

  test('disables start on a non-http page', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, active: true, url: 'chrome://extensions' }]);
    await loadPopup();

    expect(document.getElementById('status').textContent).toBe('Open a normal web page first');
    expect(document.getElementById('startButton').disabled).toBe(true);
  });

  test('restores a running task when the popup opens', async () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      const response =
        message?.action === 'status'
          ? { success: true, running: true, status: 'Scraping', processed: 2, total: 50 }
          : { success: true };
      if (typeof callback === 'function') {
        callback(response);
      }
      return Promise.resolve(response);
    });
    await loadPopup();

    expect(document.getElementById('startButton').disabled).toBe(true);
    expect(document.getElementById('stopButton').disabled).toBe(false);
    expect(document.getElementById('status').textContent).toBe('Scraping');
    expect(document.getElementById('processed').textContent).toBe('2');
    expect(document.getElementById('total').textContent).toBe('50');
  });

  test('shows the crawl warning only while crawl is checked', async () => {
    sendMessageResponse({ success: true });
    await loadPopup();

    const warning = document.getElementById('crawlWarning');
    expect(warning.hidden).toBe(true);
    document.getElementById('crawlMode').checked = true;
    document.getElementById('crawlMode').dispatchEvent(new Event('change'));
    expect(warning.hidden).toBe(false);
    expect(warning.textContent).toContain('A link can change your account or log you out.');
  });

  test('keeps start disabled after stop until the task is done', async () => {
    sendMessageResponse({ success: true });
    await loadPopup();

    document.getElementById('startButton').click();
    await flushPopupClick();
    document.getElementById('stopButton').click();
    await flushPopupClick();

    expect(document.getElementById('startButton').disabled).toBe(true);
    expect(document.getElementById('stopButton').disabled).toBe(false);
    expect(document.getElementById('debugLog').textContent).toContain('Stop requested by user.');

    const port = chrome.runtime.connect.mock.results.at(-1).value;
    const listener = port.onMessage.addListener.mock.calls[0][0];
    listener({ done: true, status: 'Stopped. Saved 1 page(s).' });

    expect(document.getElementById('status').textContent).toBe('Stopped. Saved 1 page(s).');
    expect(document.getElementById('startButton').disabled).toBe(false);
    expect(document.getElementById('stopButton').disabled).toBe(true);
  });

  test('keeps running state when stop fails', async () => {
    sendMessageResponse({ success: false, error: 'No active task' });
    await loadPopup();

    document.getElementById('startButton').disabled = true;
    document.getElementById('stopButton').disabled = false;
    document.getElementById('stopButton').click();
    await flushPopupClick();

    expect(document.getElementById('startButton').disabled).toBe(true);
    expect(document.getElementById('stopButton').disabled).toBe(false);
    expect(document.getElementById('status').textContent).toContain(
      'Error stopping task: No active task'
    );
    expect(document.getElementById('debugLog').textContent).toContain(
      'Error stopping task: No active task'
    );
  });
});
