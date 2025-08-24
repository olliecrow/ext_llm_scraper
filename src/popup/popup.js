// popup.js
import { safeTabs, safeRuntime } from '../shared/safeChromeAPI.js';

// Reset popup state when extension is reloaded
function resetPopupState() {
  // Clear debug log
  const debugLog = document.getElementById('debugLog');
  if (debugLog) {
    debugLog.textContent = '';
  }
  
  // Reset status
  document.getElementById('status').textContent = 'Ready';
  document.getElementById('processed').textContent = '0';
  document.getElementById('total').textContent = '0';
  
  // Reset buttons
  document.getElementById('startButton').disabled = false;
  document.getElementById('stopButton').disabled = true;
  
  // Add reset notification
  addDebugLog('🔄 Extension reloaded - popup state reset');
}

// Check if extension was reloaded by testing if background script is accessible
async function checkExtensionReload() {
  try {
    // Try to ping the background script
    const response = await chrome.runtime.sendMessage({ action: 'ping' });
    // If we get a response, extension is working normally
    if (response && response.success) {
      addDebugLog('✅ Extension background script is active');
    }
  } catch (error) {
    // If we get an error, the extension was likely reloaded
    if (error.message.includes('Extension context invalidated') || 
        error.message.includes('message port closed')) {
      addDebugLog('🔄 Extension was reloaded, resetting popup state');
      resetPopupState();
      
      // Wait a moment for background script to initialize, then try again
      setTimeout(async () => {
        try {
          await chrome.runtime.sendMessage({ action: 'ping' });
          addDebugLog('✅ Extension background script is now active');
        } catch (e) {
          addDebugLog('⚠️ Background script may still be initializing');
        }
      }, 1000);
    }
  }
}

// Set default values (no saved preferences)
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('crawlMode').checked = true;
  document.getElementById('maxPages').value = 1000;
  document.getElementById('concurrency').value = 10;
  document.getElementById('delay').value = 0;
  document.getElementById('copyToClipboard').checked = false;
  document.getElementById('downloadFile').checked = true;
  
  // Check if extension was reloaded
  checkExtensionReload();
});

// Clear log button
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('clearLogButton').addEventListener('click', () => {
    const debugLog = document.getElementById('debugLog');
    if (debugLog) {
      debugLog.textContent = '';
    }
    addDebugLog('🗑️ Debug log cleared manually');
  });
});

// Connect to background script with defensive programming
let port;
try {
  // Use direct Chrome API for more reliable connection
  if (chrome?.runtime?.connect) {
    port = chrome.runtime.connect({ name: 'popup' });
    console.log('Port connection established:', port);
  } else {
    console.warn('Chrome runtime connect unavailable');
    port = null;
  }
} catch (error) {
  console.warn('Error connecting to background script:', error.message);
  port = null;
}

// Start scraping
document.getElementById('startButton').addEventListener('click', async () => {
  try {
    const tabs = await safeTabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      addDebugLog('Error: No active tab found');
      return;
    }
    
    const tabId = tabs[0].id;
    const settings = {
      crawlMode: document.getElementById('crawlMode').checked,
      maxPages: parseInt(document.getElementById('maxPages').value) || 600,
      concurrency: parseInt(document.getElementById('concurrency').value) || 5,
      delay: parseInt(document.getElementById('delay').value) || 0,
      copyToClipboard: document.getElementById('copyToClipboard').checked,
      downloadFile: document.getElementById('downloadFile').checked,
    };
    // Enforce caps
    settings.maxPages = Math.min(settings.maxPages, 600);
    settings.concurrency = Math.min(settings.concurrency, 10);
    settings.delay = Math.max(settings.delay, 0);

    const response = await safeRuntime.sendMessage({
      action: 'start',
      tabId,
      startingUrl: tabs[0].url,
      settings,
    });
    
    if (response === null) {
      addDebugLog('Warning: Background script unavailable - task may not start properly');
      addDebugLog('Try reloading the extension or refreshing the page');
    } else {
      document.getElementById('startButton').disabled = true;
      document.getElementById('stopButton').disabled = false;
      addDebugLog('User pressed Start. Task started...');
    }
  } catch (error) {
    addDebugLog(`Error starting task: ${error.message}`);
  }
});

// Stop scraping
document.getElementById('stopButton').addEventListener('click', async () => {
  try {
    const tabs = await safeTabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      addDebugLog('Error: No active tab found');
      return;
    }
    
    const tabId = tabs[0].id;
    const response = await safeRuntime.sendMessage({ action: 'stop', tabId });
    
    if (response === null) {
      addDebugLog('Warning: Background script unavailable - stop command may not be received');
      addDebugLog('Try reloading the extension if task continues running');
    } else {
      document.getElementById('startButton').disabled = false;
      document.getElementById('stopButton').disabled = true;
      addDebugLog('Stop requested by user.');
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
    
    // Verify port has required methods
    if (!port.postMessage || typeof port.postMessage !== 'function') {
      addDebugLog('Port connection invalid - postMessage not available');
      console.warn('Invalid port object:', port);
      return;
    }
    
    const tabs = await safeTabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      const tabId = tabs[0].id;
      console.log('Sending subscribe message to background:', { action: 'subscribe', tabId });
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
      if (msg.copyToClipboard) {
        // Try to copy to clipboard
        navigator.clipboard
          .writeText(msg.content)
          .then(() => {
            addDebugLog('Copied final output to clipboard.');
          })
          .catch((err) => {
            addDebugLog(`Clipboard copy failed: ${err.message}`);
          });
      }
    }
  });
} else {
  addDebugLog('Real-time status updates unavailable - background connection failed');
}

// Helper for debug output
function addDebugLog(text) {
  // Handle case where DOM might not be ready yet
  const dbg = document.getElementById('debugLog');
  if (dbg) {
    dbg.textContent += `${text}\n`;
    dbg.scrollTop = dbg.scrollHeight;
  } else {
    // Fallback to console if DOM not ready
    console.log('[DEBUG]', text);
    // Queue message for when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
      addDebugLog(text);
    }, { once: true });
  }
}
