export function handleOffscreenMessage(message, sender, runtimeId, urlApi = URL) {
  if (!sender || sender.id !== runtimeId) {
    return { error: 'Rejected sender' };
  }

  if (!message || typeof message !== 'object') {
    return { error: 'Invalid message payload' };
  }

  if (message.action === 'create-download-url') {
    const blob = new Blob([message.content ?? ''], {
      type: message.mime || 'text/markdown',
    });
    return { url: urlApi.createObjectURL(blob) };
  }

  if (message.action === 'revoke-download-url' && typeof message.url === 'string') {
    urlApi.revokeObjectURL(message.url);
    return { ok: true };
  }

  return null;
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const result = handleOffscreenMessage(message, sender, chrome.runtime.id);
    if (result) {
      sendResponse(result);
    }
    return false;
  });
}
