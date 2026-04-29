async function loadPopup() {
  document.body.innerHTML = `
    <label><input type="checkbox" id="crawlMode" checked> Crawl sub-pages</label>
    <input type="number" id="maxPages" value="2000">
    <input type="number" id="concurrency" value="10">
    <input type="number" id="delay" value="0">
    <button id="startButton">Start</button>
    <button id="stopButton" disabled>Stop</button>
    <button id="clearLogButton">Clear Log</button>
    <div id="status">Ready</div>
    <span id="processed">0</span>
    <span id="total">0</span>
    <div id="debugLog"></div>
  `;

  await import('../src/popup/popup.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

function sendMessageResponse(response) {
  chrome.runtime.sendMessage.mockImplementation((_message, callback) => {
    if (typeof callback === 'function') {
      callback(response);
      return undefined;
    }
    return Promise.resolve(response);
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
  });

  test('does not switch to running state when start fails', async () => {
    sendMessageResponse({ success: false, error: 'A task already exists for this tab' });
    await loadPopup();

    document.getElementById('startButton').click();
    await flushPopupClick();

    expect(document.getElementById('startButton').disabled).toBe(false);
    expect(document.getElementById('stopButton').disabled).toBe(true);
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
    expect(document.getElementById('debugLog').textContent).toContain(
      'Error stopping task: No active task'
    );
  });
});
