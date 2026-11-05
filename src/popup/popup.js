export function initPopup(doc, chromeApi) {
  let activeTab = null;
  let port = null;

  function setStatus(text) {
    doc.getElementById('status').textContent = text;
  }

  function addDebugLog(text) {
    const dbg = doc.getElementById('debugLog');
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
      crawlMode: doc.getElementById('crawlMode').checked,
      maxPages: doc.getElementById('maxPages').valueAsNumber,
      concurrency: doc.getElementById('concurrency').valueAsNumber,
      delay: doc.getElementById('delay').valueAsNumber,
    };
  }

  function updateCrawlWarning() {
    const warning = doc.getElementById('crawlWarning');
    if (!warning) {
      return;
    }
    warning.hidden = !doc.getElementById('crawlMode').checked;
  }

  function setRunning(running) {
    doc.getElementById('startButton').disabled = running;
    doc.getElementById('stopButton').disabled = !running;
  }

  function applyPage(tab) {
    activeTab = tab ?? null;
    if (!activeTab || !isHttpUrl(activeTab.url)) {
      setStatus('Open a normal web page first');
      doc.getElementById('startButton').disabled = true;
      return;
    }

    if (port) {
      port.postMessage({ action: 'subscribe', tabId: activeTab.id });
    }

    chromeApi.runtime.sendMessage({ action: 'status', tabId: activeTab.id }, (response) => {
      if (!response?.running) {
        return;
      }
      setRunning(true);
      if (response.status) {
        setStatus(response.status);
      }
      if (response.processed !== undefined && response.total !== undefined) {
        doc.getElementById('processed').textContent = response.processed;
        doc.getElementById('total').textContent = response.total;
      }
    });
  }

  doc.getElementById('clearLogButton').addEventListener('click', () => {
    doc.getElementById('debugLog').textContent = '';
  });

  doc.getElementById('crawlMode').addEventListener('change', updateCrawlWarning);
  updateCrawlWarning();

  try {
    port = chromeApi.runtime.connect({ name: 'popup' });
  } catch (error) {
    console.warn('Error connecting to background script:', error.message);
    port = null;
  }

  doc.getElementById('startButton').addEventListener('click', () => {
    if (!activeTab || !isHttpUrl(activeTab.url)) {
      setStatus('Open a normal web page first');
      addDebugLog('Error: No active tab found');
      return;
    }

    const origins = siteOrigins(activeTab.url);
    const settings = readSettings();
    const tabId = activeTab.id;
    const startingUrl = activeTab.url;

    chromeApi.permissions.request({ origins }, (granted) => {
      if (chromeApi.runtime.lastError || !granted) {
        addDebugLog('Site access was not granted');
        setStatus('Site access was not granted');
        return;
      }

      chromeApi.runtime.sendMessage(
        { action: 'start', tabId, startingUrl, settings },
        (response) => {
          if (response?.success) {
            setRunning(true);
            addDebugLog('User pressed Start. Task started...');
            return;
          }
          const error = response?.error || 'Unknown background error';
          addDebugLog(`Error starting task: ${error}`);
          setStatus(`Error starting task: ${error}`);
        }
      );
    });
  });

  doc.getElementById('stopButton').addEventListener('click', () => {
    if (!activeTab) {
      addDebugLog('Error: No active tab found');
      setStatus('Error: No active tab found');
      return;
    }

    chromeApi.runtime.sendMessage({ action: 'stop', tabId: activeTab.id }, (response) => {
      if (response?.success) {
        addDebugLog('Stop requested by user.');
        return;
      }
      const error = response?.error || 'Unknown background error';
      addDebugLog(`Error stopping task: ${error}`);
      setStatus(`Error stopping task: ${error}`);
    });
  });

  chromeApi.tabs
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
          doc.getElementById('processed').textContent = msg.processed;
          doc.getElementById('total').textContent = msg.total;
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
}

if (typeof document !== 'undefined' && document.getElementById('startButton')) {
  initPopup(document, chrome);
}
