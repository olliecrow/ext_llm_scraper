// Mock Chrome API for testing
global.chrome = {
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
      }
      return undefined;
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
    executeScript: jest.fn(() => Promise.resolve([
      {
        result: {
          url: 'https://example.com',
          title: 'Example',
          content: 'Example content',
          links: [],
        },
      },
    ])),
  },
  storage: {
    local: {
      get: jest.fn(() => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve()),
      remove: jest.fn(() => Promise.resolve()),
      clear: jest.fn(() => Promise.resolve()),
      getBytesInUse: jest.fn(() => Promise.resolve(1024)),
      QUOTA_BYTES: 10485760, // 10MB
    },
  },
  downloads: {
    download: jest.fn(() => Promise.resolve(123)),
  },
  offscreen: {
    createDocument: jest.fn(),
    closeDocument: jest.fn(),
  },
};

// Mock Readability
global.Readability = jest.fn().mockImplementation(() => ({
  parse: jest.fn().mockReturnValue({
    title: 'Test Title',
    textContent: 'Test content',
  }),
}));

// Mock URL methods for blob handling
global.URL.createObjectURL = jest.fn(() => 'mocked-blob-url');
global.URL.revokeObjectURL = jest.fn();

// Mock Blob constructor
global.Blob = jest.fn((content, options) => ({
  size: content[0].length,
  type: options?.type || 'text/plain',
}));

// Mock performance for content filtering
global.performance = {
  now: jest.fn(() => Date.now()),
};

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
