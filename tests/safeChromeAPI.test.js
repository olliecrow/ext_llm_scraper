/**
 * Comprehensive tests for SafeChromeAPI - Critical component with 0% coverage
 */

// Mock Chrome APIs for testing
const mockChrome = {
  storage: {
    local: {
      set: jest.fn(),
      get: jest.fn(),
      remove: jest.fn(),
      getBytesInUse: jest.fn(),
      QUOTA_BYTES: 5242880 // 5MB
    }
  },
  tabs: {
    create: jest.fn(),
    remove: jest.fn(),
    query: jest.fn()
  },
  runtime: {
    sendMessage: jest.fn(),
    connect: jest.fn(),
    lastError: null
  },
  scripting: {
    executeScript: jest.fn()
  },
  downloads: {
    download: jest.fn()
  }
};

// Setup global chrome mock
global.chrome = mockChrome;

const { SafeChromeAPI } = require('../src/shared/safeChromeAPI.js');

describe('SafeChromeAPI Core Functionality', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Clear SafeChromeAPI memory storage between tests
    if (SafeChromeAPI._memoryStorage) {
      SafeChromeAPI._memoryStorage.clear();
    }
    
    // Ensure chrome object exists and restore all APIs
    global.chrome = {
      storage: {
        local: {
          set: jest.fn(),
          get: jest.fn(),
          remove: jest.fn(),
          getBytesInUse: jest.fn(),
          QUOTA_BYTES: 5242880
        }
      },
      tabs: {
        create: jest.fn(),
        remove: jest.fn(),
        query: jest.fn()
      },
      runtime: {
        sendMessage: jest.fn(),
        connect: jest.fn(),
        lastError: null
      },
      scripting: {
        executeScript: jest.fn()
      },
      downloads: {
        download: jest.fn()
      }
    };
  });

  describe('Storage Operations', () => {
    test('should handle successful storage set operation', async () => {
      chrome.storage.local.set.mockResolvedValue();
      
      await SafeChromeAPI.storage('set', { key: 'value' });
      
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ key: 'value' });
    });

    test('should handle storage get operation', async () => {
      chrome.storage.local.get.mockResolvedValue({ key: 'value' });
      
      const result = await SafeChromeAPI.storage('get', 'key');
      
      expect(chrome.storage.local.get).toHaveBeenCalledWith('key');
      expect(result).toEqual({ key: 'value' });
    });

    test('should fallback to memory storage when Chrome storage unavailable', async () => {
      // Temporarily remove chrome.storage
      delete chrome.storage;
      
      await SafeChromeAPI.storage('set', { testKey: 'testValue' });
      const result = await SafeChromeAPI.storage('get', 'testKey');
      
      expect(result.testKey).toBe('testValue');
      
      // Note: beforeEach will restore chrome for next test
    });

    test('should handle storage quota exceeded with cleanup', async () => {
      // Mock quota exceeded error on first call, success on second
      chrome.storage.local.set
        .mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'))
        .mockResolvedValueOnce();
      
      // Mock get to return some task data for cleanup
      chrome.storage.local.get.mockResolvedValue({ 
        task_old1: 'data1', 
        task_old2: 'data2', 
        task_new: 'data3' 
      });
      chrome.storage.local.remove.mockResolvedValue();
      
      // The storage operation should succeed after cleanup
      await SafeChromeAPI.storage('set', { newData: 'test' });
      
      // Verify cleanup was attempted
      expect(chrome.storage.local.get).toHaveBeenCalledWith(null);
      // Note: remove gets called for task cleanup
    });

    test('should handle unknown storage operation', async () => {
      await expect(SafeChromeAPI.storage('invalid', {}))
        .rejects.toThrow('Unknown storage operation: invalid');
    });
  });

  describe('Tabs Operations', () => {
    test('should handle successful tab query', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      
      const result = await SafeChromeAPI.tabs('query', { active: true });
      
      expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true });
      expect(result).toEqual([{ id: 1, url: 'https://example.com' }]);
    });

    test('should handle tab creation', async () => {
      chrome.tabs.create.mockResolvedValue({ id: 2, url: 'https://test.com' });
      
      const result = await SafeChromeAPI.tabs('create', { url: 'https://test.com' });
      
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://test.com' });
      expect(result.id).toBe(2);
    });

    test('should gracefully handle tab already closed error', async () => {
      chrome.tabs.remove.mockRejectedValue(new Error('No tab with id: 999'));
      
      const result = await SafeChromeAPI.tabs('remove', 999);
      
      expect(result).toBeNull();
    });

    test('should handle permission denied gracefully', async () => {
      chrome.tabs.query.mockRejectedValue(new Error('permission denied'));
      
      const result = await SafeChromeAPI.tabs('query', {});
      
      expect(result).toBeNull();
    });

    test('should throw error when tabs API unavailable', async () => {
      delete chrome.tabs;
      
      await expect(SafeChromeAPI.tabs('query', {}))
        .rejects.toThrow('Tabs API unavailable');
    });
  });

  describe('Runtime Operations', () => {
    test('should handle successful sendMessage', async () => {
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        setTimeout(() => callback({ success: true }), 0);
      });
      
      const result = await SafeChromeAPI.runtime('sendMessage', { action: 'test' });
      
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'test' }, expect.any(Function));
      expect(result).toEqual({ success: true });
    });

    test('should handle runtime lastError', async () => {
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        chrome.runtime.lastError = { message: 'Connection closed' };
        setTimeout(() => callback(), 0);
      });
      
      await expect(SafeChromeAPI.runtime('sendMessage', { action: 'test' }))
        .rejects.toThrow('Connection closed');
    });

    test('should handle runtime connect', async () => {
      const mockPort = { postMessage: jest.fn() };
      chrome.runtime.connect.mockReturnValue(mockPort);
      
      const result = await SafeChromeAPI.runtime('connect', { name: 'test' });
      
      expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'test' });
      expect(result).toEqual(mockPort);
    });

    test('should handle disconnected runtime', async () => {
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        chrome.runtime.lastError = { message: 'disconnected port' };
        setTimeout(() => callback(), 0);
      });
      
      await expect(SafeChromeAPI.runtime('sendMessage', { test: 'data' }))
        .rejects.toThrow('disconnected port');
    });
  });

  describe('Quota Management', () => {
    test('should return Chrome quota when available', async () => {
      const quota = await SafeChromeAPI.getActualQuota();
      
      expect(quota).toBe(5242880); // 5MB
    });

    test('should fallback when quota detection fails', async () => {
      // Remove QUOTA_BYTES and make storage operations fail to test ultimate fallback
      delete chrome.storage.local.QUOTA_BYTES;
      
      // Mock storage operations to fail (simulating complete storage failure)
      const originalStorage = SafeChromeAPI.storage;
      SafeChromeAPI.storage = jest.fn().mockRejectedValue(new Error('Storage completely unavailable'));
      
      const quota = await SafeChromeAPI.getActualQuota();
      
      expect(quota).toBe(1048576); // 1MB conservative fallback
      
      // Restore original storage method
      SafeChromeAPI.storage = originalStorage;
    });

    test('should test quota with write when QUOTA_BYTES unavailable', async () => {
      chrome.storage.local.QUOTA_BYTES = undefined;
      chrome.storage.local.set.mockResolvedValue();
      chrome.storage.local.remove.mockResolvedValue();
      
      const quota = await SafeChromeAPI.getActualQuota();
      
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ quota_test: expect.any(String) });
      expect(chrome.storage.local.remove).toHaveBeenCalledWith('quota_test');
      expect(quota).toBe(5242880); // 5MB safe minimum
    });
  });

  describe('Environment Detection', () => {
    test('should detect normal environment capabilities', async () => {
      const capabilities = await SafeChromeAPI.checkEnvironmentCapabilities();
      
      expect(capabilities.storage).toBe(true);
      expect(capabilities.tabs).toBe(true);
      expect(capabilities.scripting).toBe(true);
      expect(capabilities.downloads).toBe(true);
      expect(capabilities.restrictedEnvironment).toBe(false);
    });

    test('should detect restricted environment', async () => {
      delete chrome.storage;
      delete chrome.tabs;
      delete chrome.scripting;
      
      const capabilities = await SafeChromeAPI.checkEnvironmentCapabilities();
      
      expect(capabilities.restrictedEnvironment).toBe(true);
    });
  });

  describe('Memory Fallback', () => {
    test('should handle set and get operations', async () => {
      await SafeChromeAPI.memoryFallback('set', { key1: 'value1' });
      const result = await SafeChromeAPI.memoryFallback('get', 'key1');
      
      expect(result.key1).toBe('value1');
    });

    test('should handle get all operation', async () => {
      await SafeChromeAPI.memoryFallback('set', { key1: 'value1', key2: 'value2' });
      const result = await SafeChromeAPI.memoryFallback('get', null);
      
      expect(result).toEqual({ key1: 'value1', key2: 'value2' });
    });

    test('should handle remove operation', async () => {
      await SafeChromeAPI.memoryFallback('set', { key1: 'value1', key2: 'value2' });
      await SafeChromeAPI.memoryFallback('remove', 'key1');
      const result = await SafeChromeAPI.memoryFallback('get', null);
      
      expect(result.key1).toBeUndefined();
      expect(result.key2).toBe('value2');
    });

    test('should estimate bytes in use', async () => {
      await SafeChromeAPI.memoryFallback('set', { testKey: 'testValue123' });
      const bytes = await SafeChromeAPI.memoryFallback('getBytesInUse');
      
      expect(bytes).toBeGreaterThan(0);
    });
  });
});