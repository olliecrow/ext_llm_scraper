let activeTab = null;
let port = null;

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function addDebugLog(text) {
  const dbg = document.getElementById('debugLog');
  dbg.textContent += `${text}\n`;
  dbg.scrollTop = dbg.scrollHeight;
}

function isHttpUrl(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function siteOrigins(url) {
  const { hostname } = new URL(url);
  const bare = hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  const hosts = hostname === bare ? [hostname, `www.${hostname}`] : [hostname, bare];
  return hosts.flatMap((host) => [`http://${host}/*`, `https://${host}/*`]);
}

function readSettings() {
  return {
    crawlMode: document.getElementById('crawlMode').checked,
    maxPages: document.getElementById('maxPages').valueAsNumber,
    concurrency: document.getElementById('concurrency').valueAsNumber,
    delay: document.getElementById('delay').valueAsNumber,
  };
}

function updateCrawlWarning() {
  const warning = document.getElementById('crawlWarning');
  if (!warning) {
    return;
  }
  warning.hidden = !document.getElementById('crawlMode').checked;
}

function setRunning(running) {
  document.getElementById('startButton').disabled = running;
  document.getElementById('stopButton').disabled = !running;
}

function applyPage(tab) {
  activeTab = tab ?? null;
  if (!activeTab || !isHttpUrl(activeTab.url)) {
    setStatus('Open a normal web page first');
    document.getElementById('startButton').disabled = true;
    return;
  }

  if (port) {
    port.postMessage({ action: 'subscribe', tabId: activeTab.id });
  }

  chrome.runtime.sendMessage({ action: 'status', tabId: activeTab.id }, (response) => {
    if (!response?.running) {
      return;
    }
    setRunning(true);
    if (response.status) {
      setStatus(response.status);
    }
    if (response.processed !== undefined && response.total !== undefined) {
      document.getElementById('processed').textContent = response.processed;
      document.getElementById('total').textContent = response.total;
    }
  });
}

document.getElementById('clearLogButton').addEventListener('click', () => {
  document.getElementById('debugLog').textContent = '';
});

document.getElementById('crawlMode').addEventListener('change', updateCrawlWarning);
updateCrawlWarning();

try {
  port = chrome.runtime.connect({ name: 'popup' });
} catch (error) {
  console.warn('Error connecting to background script:', error.message);
  port = null;
}

document.getElementById('startButton').addEventListener('click', () => {
  if (!activeTab || !isHttpUrl(activeTab.url)) {
    setStatus('Open a normal web page first');
    addDebugLog('Error: No active tab found');
    return;
  }

  const origins = siteOrigins(activeTab.url);
  const settings = readSettings();
  const tabId = activeTab.id;
  const startingUrl = activeTab.url;

  chrome.permissions.request({ origins }, (granted) => {
    if (chrome.runtime.lastError || !granted) {
      addDebugLog('Site access was not granted');
      setStatus('Site access was not granted');
      return;
    }

    chrome.runtime.sendMessage({ action: 'start', tabId, startingUrl, settings }, (response) => {
      if (response?.success) {
        setRunning(true);
        addDebugLog('User pressed Start. Task started...');
        return;
      }
      const error = response?.error || 'Unknown background error';
      addDebugLog(`Error starting task: ${error}`);
      setStatus(`Error starting task: ${error}`);
    });
  });
});

document.getElementById('stopButton').addEventListener('click', () => {
  if (!activeTab) {
    addDebugLog('Error: No active tab found');
    setStatus('Error: No active tab found');
    return;
  }

  chrome.runtime.sendMessage({ action: 'stop', tabId: activeTab.id }, (response) => {
    if (response?.success) {
      addDebugLog('Stop requested by user.');
      return;
    }
    const error = response?.error || 'Unknown background error';
    addDebugLog(`Error stopping task: ${error}`);
    setStatus(`Error stopping task: ${error}`);
  });
});

chrome.tabs
  .query({ active: true, currentWindow: true })
  .then((tabs) => {
    applyPage(tabs?.[0]);
  })
  .catch((error) => {
    addDebugLog(`Error subscribing to updates: ${error.message}`);
  });

if (port && port.onMessage) {
  port.onMessage.addListener((msg) => {
    if (msg.status) {
      setStatus(msg.status);
      if (msg.processed !== undefined && msg.total !== undefined) {
        document.getElementById('processed').textContent = msg.processed;
        document.getElementById('total').textContent = msg.total;
      }
    }
    if (msg.debug) {
      addDebugLog(msg.debug);
    }
    if (msg.done) {
      setRunning(false);
    }
  });
} else {
  addDebugLog('Real-time status updates unavailable - background connection failed');
}
