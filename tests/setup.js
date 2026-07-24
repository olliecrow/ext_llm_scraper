// Mock Chrome API for testing
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onConnect: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onStartup: {
      addListener: jest.fn(),
    },
    sendMessage: jest.fn((message, callback) => {
      if (typeof callback === 'function') {
        callback({ ok: true, echo: message });
        return undefined;
      }
      return Promise.resolve({ ok: true, echo: message });
    }),
    connect: jest.fn(() => ({
      postMessage: jest.fn(),
      onMessage: {
        addListener: jest.fn(),
      },
      onDisconnect: {
        addListener: jest.fn(),
      },
      name: 'popup',
    })),
    lastError: null,
  },
  tabs: {
    create: jest.fn(() => Promise.resolve({ id: 1, url: 'https://example.com' })),
    remove: jest.fn(() => Promise.resolve()),
    get: jest.fn((tabId, callback) => {
      const tab = { id: tabId, status: 'complete', url: 'https://example.com' };
      if (typeof callback === 'function') {
        callback(tab);
        return undefined;
      }
      return Promise.resolve(tab);
    }),
    query: jest.fn(() => Promise.resolve([{ id: 1, active: true, url: 'https://example.com' }])),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  scripting: {
    executeScript: jest.fn(() =>
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
    download: jest.fn(() => Promise.resolve(123)),
  },
};

// Mock Readability
globalThis.Readability = jest.fn().mockImplementation(() => ({
  parse: jest.fn().mockReturnValue({
    title: 'Test Title',
    textContent: 'Test content',
  }),
}));

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
