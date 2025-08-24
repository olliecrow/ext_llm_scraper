document.addEventListener('DOMContentLoaded', () => {
  const log = document.getElementById('log');
  
  function addLog(message) {
    log.innerHTML += message + '<br>';
    log.scrollTop = log.scrollHeight;
  }
  
  document.getElementById('testBtn').addEventListener('click', async () => {
    addLog('=== Starting Test ===');
    
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      addLog(`Testing on: ${tab.url}`);
      
      // Inject simple content script
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          console.log('[TEST] Content script executed');
          
          // Try to send message back
          return new Promise((resolve) => {
            const testData = {
              url: window.location.href,
              title: document.title,
              bodyLength: document.body.innerText.length
            };
            
            console.log('[TEST] Sending message:', testData);
            
            chrome.runtime.sendMessage(testData, (response) => {
              if (chrome.runtime.lastError) {
                console.error('[TEST] Message error:', chrome.runtime.lastError.message);
                resolve({ error: chrome.runtime.lastError.message });
              } else {
                console.log('[TEST] Message success:', response);
                resolve({ success: true, response });
              }
            });
          });
        }
      });
      
      addLog(`Script result: ${JSON.stringify(results[0].result, null, 2)}`);
      
    } catch (error) {
      addLog(`Error: ${error.message}`);
    }
  });
});