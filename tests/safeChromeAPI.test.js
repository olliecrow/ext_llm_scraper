import { SafeChromeAPI, safeRuntime, safeTabs } from '../src/shared/safeChromeAPI.js';

describe('SafeChromeAPI wrappers', () => {
  beforeEach(() => {
    chrome.runtime.lastError = null;
  });

  test('wraps tab creation', async () => {
    const tab = await SafeChromeAPI.tabs('create', { url: 'https://example.com' });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com' });
    expect(tab.id).toBe(1);
  });

  test('returns null when tab removal fails gracefully', async () => {
    chrome.tabs.remove.mockRejectedValueOnce(new Error('No tab with id: 99'));
    const result = await SafeChromeAPI.tabs('remove', 99);
    expect(result).toBeNull();
  });

  test('propagates runtime messages through helper', async () => {
    const response = await safeRuntime.sendMessage({ action: 'ping' });
    expect(response).toEqual({ ok: true, echo: { action: 'ping' } });
  });

  test('handles missing APIs by throwing', async () => {
    const originalTabs = chrome.tabs;
    delete chrome.tabs;

    await expect(SafeChromeAPI.tabs('create', {})).rejects.toThrow('Tabs API unavailable');

    chrome.tabs = originalTabs;
  });

  test('safeTabs query uses wrapper', async () => {
    const tabs = await safeTabs.query({ active: true });
    expect(tabs[0].url).toBe('https://example.com');
  });

  test('wraps scripting and download APIs', async () => {
    await expect(
      SafeChromeAPI.scripting('executeScript', { target: { tabId: 1 }, func: () => null })
    ).resolves.toEqual([
      {
        result: {
          url: 'https://example.com',
          title: 'Example',
          content: 'Example content',
          links: [],
        },
      },
    ]);

    await expect(
      SafeChromeAPI.downloads('download', { url: 'data:text/plain,hello', filename: 'hello.txt' })
    ).resolves.toBe(123);
  });

  test('returns null when runtime sendMessage cannot reach the background worker', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.runtime.sendMessage.mockImplementationOnce((_message, callback) => {
      chrome.runtime.lastError = { message: 'receiving end does not exist' };
      callback();
      chrome.runtime.lastError = null;
    });

    const response = await SafeChromeAPI.sendMessageWithRetry({ action: 'ping' }, 1);
    expect(response).toBeNull();
    warnSpy.mockRestore();
  });
});
