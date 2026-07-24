// Clear log button
document.getElementById('clearLogButton').addEventListener('click', () => {
  document.getElementById('debugLog').textContent = '';
});

let port;
try {
  port = chrome.runtime.connect({ name: 'popup' });
} catch (error) {
  console.warn('Error connecting to background script:', error.message);
  port = null;
}

// Start scraping
document.getElementById('startButton').addEventListener('click', async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      addDebugLog('Error: No active tab found');
      return;
    }

    const tabId = tabs[0].id;
    const settings = {
      crawlMode: document.getElementById('crawlMode').checked,
      maxPages: document.getElementById('maxPages').valueAsNumber,
      concurrency: document.getElementById('concurrency').valueAsNumber,
      delay: document.getElementById('delay').valueAsNumber,
    };

    const response = await chrome.runtime.sendMessage({
      action: 'start',
      tabId,
      startingUrl: tabs[0].url,
      settings,
    });
    if (response?.success) {
      document.getElementById('startButton').disabled = true;
      document.getElementById('stopButton').disabled = false;
      addDebugLog('User pressed Start. Task started...');
    } else {
      addDebugLog(`Error starting task: ${response?.error || 'Unknown background error'}`);
    }
  } catch (error) {
    addDebugLog(`Error starting task: ${error.message}`);
  }
});

// Stop scraping
document.getElementById('stopButton').addEventListener('click', async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      addDebugLog('Error: No active tab found');
      return;
    }

    const tabId = tabs[0].id;
    const response = await chrome.runtime.sendMessage({ action: 'stop', tabId });

    if (response?.success) {
      document.getElementById('startButton').disabled = false;
      document.getElementById('stopButton').disabled = true;
      addDebugLog('Stop requested by user.');
    } else {
      addDebugLog(`Error stopping task: ${response?.error || 'Unknown background error'}`);
    }
  } catch (error) {
    addDebugLog(`Error stopping task: ${error.message}`);
  }
});

// Subscribe to updates
(async () => {
  try {
    if (!port) {
      addDebugLog('Background connection not available - real-time updates disabled');
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      const tabId = tabs[0].id;
      port.postMessage({ action: 'subscribe', tabId });
    }
  } catch (error) {
    addDebugLog(`Error subscribing to updates: ${error.message}`);
    console.error('Subscribe error details:', error);
  }
})();

// Listen for messages
if (port && port.onMessage) {
  port.onMessage.addListener((msg) => {
    // If we see a status
    if (msg.status) {
      document.getElementById('status').textContent = msg.status;
      if (msg.processed !== undefined && msg.total !== undefined) {
        document.getElementById('processed').textContent = msg.processed;
        document.getElementById('total').textContent = msg.total;
      }
    }
    // If we have a debug message
    if (msg.debug) {
      addDebugLog(msg.debug);
    }
    // If we are done
    if (msg.done) {
      document.getElementById('startButton').disabled = false;
      document.getElementById('stopButton').disabled = true;
    }
  });
} else {
  addDebugLog('Real-time status updates unavailable - background connection failed');
}

// Helper for debug output
function addDebugLog(text) {
  const dbg = document.getElementById('debugLog');
  dbg.textContent += `${text}\n`;
  dbg.scrollTop = dbg.scrollHeight;
}
