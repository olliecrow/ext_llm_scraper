import { mock } from 'node:test';

export function createChromeMock() {
  const offscreenUrl = 'chrome-extension://ext-test/src/offscreen/offscreen.html';
  let offscreenOpen = false;
  return {
    runtime: {
      id: 'ext-test',
      getURL: (path) => `chrome-extension://ext-test/${path}`,
      getContexts: mock.fn(async () =>
        offscreenOpen ? [{ contextType: 'OFFSCREEN_DOCUMENT', documentUrl: offscreenUrl }] : []
      ),
      onMessage: {
        addListener: mock.fn(),
        removeListener: mock.fn(),
      },
      onConnect: {
        addListener: mock.fn(),
        removeListener: mock.fn(),
      },
      onStartup: {
        addListener: mock.fn(),
      },
      sendMessage: mock.fn((message, callback) => {
        if (typeof callback === 'function') {
          callback({ ok: true, echo: message });
          return undefined;
        }
        return Promise.resolve({ ok: true, echo: message });
      }),
      connect: mock.fn(() => ({
        postMessage: mock.fn(),
        onMessage: {
          addListener: mock.fn(),
        },
        onDisconnect: {
          addListener: mock.fn(),
        },
        name: 'popup',
      })),
      lastError: null,
    },
    tabs: {
      create: mock.fn(() => Promise.resolve({ id: 1, url: 'https://example.com' })),
      remove: mock.fn(() => Promise.resolve()),
      get: mock.fn((tabId, callback) => {
        const tab = { id: tabId, status: 'complete', url: 'https://example.com' };
        if (typeof callback === 'function') {
          callback(tab);
          return undefined;
        }
        return Promise.resolve(tab);
      }),
      query: mock.fn(() => Promise.resolve([{ id: 1, active: true, url: 'https://example.com' }])),
      onUpdated: {
        addListener: mock.fn(),
        removeListener: mock.fn(),
      },
      onRemoved: {
        addListener: mock.fn(),
        removeListener: mock.fn(),
      },
    },
    scripting: {
      executeScript: mock.fn(() =>
        Promise.resolve([
          {
            result: {
              url: 'https://example.com',
              title: 'Example',
              content: 'Example content',
              links: [],
            },
          },
        ])
      ),
    },
    downloads: {
      download: mock.fn(() => Promise.resolve(123)),
    },
    permissions: {
      request: mock.fn((_permissions, callback) => {
        callback(true);
      }),
    },
    // Matches Chrome: one document at most, and closing needs an open document.
    offscreen: {
      createDocument: mock.fn(async () => {
        if (offscreenOpen) {
          throw new Error('Only a single offscreen document may be created.');
        }
        offscreenOpen = true;
      }),
      closeDocument: mock.fn(async () => {
        if (!offscreenOpen) {
          throw new Error('No current offscreen document.');
        }
        offscreenOpen = false;
      }),
      isOpen: () => offscreenOpen,
    },
  };
}
