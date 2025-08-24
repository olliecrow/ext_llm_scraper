console.log('[TEST_BG] Background script loaded');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[TEST_BG] Received message:', message);
  console.log('[TEST_BG] From sender:', sender);
  
  // Send response back
  sendResponse({ 
    received: true, 
    timestamp: Date.now(),
    messageReceived: message 
  });
  
  return true; // Keep message channel open
});