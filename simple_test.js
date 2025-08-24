// Simple test to inject into the page
console.log('=== SIMPLE TEST SCRIPT STARTED ===');
console.log('URL:', window.location.href);
console.log('Title:', document.title);
console.log('Body text length:', document.body.innerText.length);

// Try to send a simple message
try {
  chrome.runtime.sendMessage({
    test: true,
    url: window.location.href,
    message: 'Simple test message from injected script'
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Message send error:', chrome.runtime.lastError.message);
    } else {
      console.log('Message sent successfully, response:', response);
    }
  });
} catch (error) {
  console.error('Error sending message:', error);
}

console.log('=== SIMPLE TEST SCRIPT COMPLETED ===');