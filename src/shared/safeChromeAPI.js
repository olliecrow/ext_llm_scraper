/**
 * Safe Chrome API wrapper with defensive programming
 * Handles Chrome API failures gracefully with fallbacks
 */

/**
 * Defensive Chrome API wrapper class with fallback mechanisms
 */
export class SafeChromeAPI {
  /**
   * Safe storage API operations with quota handling and fallbacks
   * @param {string} operation - 'set', 'get', 'remove', or 'getBytesInUse'
   * @param {*} data - Data for the operation
   * @returns {Promise<*>} Result of the operation
   */
  static async storage(operation, data) {
    // Check if Chrome storage API is available
    if (!chrome?.storage?.local) {
      console.warn('Chrome storage API unavailable, using memory fallback');
      return this.memoryFallback(operation, data);
    }

    try {
      switch (operation) {
        case 'set':
          return await chrome.storage.local.set(data);
        case 'get':
          return await chrome.storage.local.get(data);
        case 'remove':
          return await chrome.storage.local.remove(data);
        case 'getBytesInUse':
          return await chrome.storage.local.getBytesInUse(data);
        default:
          throw new Error(`Unknown storage operation: ${operation}`);
      }
    } catch (error) {
      // Handle specific Chrome storage errors
      if (error.message.includes('QUOTA')) {
        return this.handleQuotaExceeded(operation, data);
      }
      
      if (error.message.includes('permissions')) {
        console.warn('Storage permissions missing, using memory fallback');
        return this.memoryFallback(operation, data);
      }
      
      // Re-throw unexpected errors
      throw error;
    }
  }

  /**
   * Safe tabs API operations with permission and availability checks
   * @param {string} operation - 'create', 'remove', 'query'
   * @param {*} options - Options for the operation
   * @returns {Promise<*>} Result of the operation
   */
  static async tabs(operation, options) {
    // Check if tabs API is available
    if (!chrome?.tabs) {
      throw new Error('Tabs API unavailable - extension permissions insufficient');
    }

    try {
      switch (operation) {
        case 'create':
          if (!chrome.tabs.create) {
            throw new Error('Tab creation permission missing');
          }
          return await chrome.tabs.create(options);
        case 'remove':
          if (!chrome.tabs.remove) {
            throw new Error('Tab removal permission missing');
          }
          return await chrome.tabs.remove(options);
        case 'query':
          if (!chrome.tabs.query) {
            throw new Error('Tab query permission missing');
          }
          return await chrome.tabs.query(options);
        default:
          throw new Error(`Unknown tabs operation: ${operation}`);
      }
    } catch (error) {
      // Handle specific tab errors gracefully
      if (error.message.includes('No tab with id')) {
        console.debug(`Tab ${options} already closed or invalid`);
        return null; // Tab already closed, not an error
      }
      
      if (error.message.includes('permission')) {
        console.warn(`Tab ${operation} permission denied:`, error.message);
        return null; // Graceful degradation
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Safe scripting API operations with permission checks
   * @param {string} operation - 'executeScript'
   * @param {*} options - Script execution options
   * @returns {Promise<*>} Result of the operation
   */
  static async scripting(operation, options) {
    if (!chrome?.scripting) {
      throw new Error('Scripting API unavailable - extension permissions insufficient');
    }

    try {
      switch (operation) {
        case 'executeScript':
          if (!chrome.scripting.executeScript) {
            throw new Error('Script execution permission missing');
          }
          return await chrome.scripting.executeScript(options);
        default:
          throw new Error(`Unknown scripting operation: ${operation}`);
      }
    } catch (error) {
      // Handle script injection failures
      if (error.message.includes('Cannot access contents of the page')) {
        console.warn('Script injection blocked by page permissions');
        return null; // Graceful failure
      }
      
      throw error;
    }
  }

  /**
   * Safe downloads API operations with permission checks
   * @param {string} operation - 'download'
   * @param {*} options - Download options
   * @returns {Promise<*>} Result of the operation
   */
  static async downloads(operation, options) {
    if (!chrome?.downloads) {
      throw new Error('Downloads API unavailable - extension permissions insufficient');
    }

    try {
      switch (operation) {
        case 'download':
          if (!chrome.downloads.download) {
            throw new Error('Download permission missing');
          }
          return await chrome.downloads.download(options);
        default:
          throw new Error(`Unknown downloads operation: ${operation}`);
      }
    } catch (error) {
      // Handle download restrictions
      if (error.message.includes('Download interrupted') || error.message.includes('USER_CANCELED')) {
        console.debug('Download was interrupted or canceled');
        return null; // Not a critical error
      }
      
      throw error;
    }
  }

  /**
   * Safe runtime API operations with error handling and retry logic
   * @param {string} operation - 'sendMessage', 'connect'
   * @param {*} options - Options for the operation
   * @returns {Promise<*>} Result of the operation
   */
  static async runtime(operation, options) {
    if (!chrome?.runtime) {
      throw new Error('Runtime API unavailable');
    }

    try {
      switch (operation) {
        case 'sendMessage':
          if (!chrome.runtime.sendMessage) {
            throw new Error('Runtime sendMessage unavailable');
          }
          return await this.sendMessageWithRetry(options);
        case 'connect':
          if (!chrome.runtime.connect) {
            throw new Error('Runtime connect unavailable');
          }
          return chrome.runtime.connect(options);
        default:
          throw new Error(`Unknown runtime operation: ${operation}`);
      }
    } catch (error) {
      // Handle runtime API failures gracefully
      if (error.message.includes('disconnected') || error.message.includes('closed')) {
        console.warn('Runtime disconnected, attempting to reconnect');
        return null; // Allow caller to handle reconnection
      }
      
      throw error;
    }
  }

  /**
   * Send message with retry logic for service worker lifecycle issues
   * @param {*} message - Message to send
   * @param {number} maxRetries - Maximum retry attempts
   * @param {number} attempt - Current attempt number
   * @returns {Promise<*>} Response from background script or null
   */
  static async sendMessageWithRetry(message, maxRetries = 3, attempt = 1) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, async (response) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message;
          console.warn(`Runtime sendMessage error (attempt ${attempt}/${maxRetries}):`, errorMessage);
          
          // Handle specific service worker inactivity errors
          if (errorMessage.includes('message port closed') || 
              errorMessage.includes('receiving end does not exist')) {
            
            if (attempt < maxRetries) {
              // Calculate exponential backoff delay (100ms, 200ms, 400ms)
              const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
              console.debug(`Service worker inactive, retrying in ${delay}ms...`);
              
              setTimeout(async () => {
                try {
                  const retryResult = await this.sendMessageWithRetry(message, maxRetries, attempt + 1);
                  resolve(retryResult);
                } catch (retryError) {
                  reject(retryError);
                }
              }, delay);
              return;
            } else {
              // Max retries reached - return null instead of throwing
              console.warn('Service worker unavailable after retries, continuing without response');
              resolve(null);
              return;
            }
          }
          
          // Handle other runtime errors
          if (errorMessage.includes('Extension context invalidated')) {
            console.warn('Extension reloaded, operation cancelled');
            resolve(null);
            return;
          }
          
          // For other errors, reject after max retries
          if (attempt >= maxRetries) {
            reject(new Error(errorMessage));
          } else {
            // Retry other errors once
            setTimeout(async () => {
              try {
                const retryResult = await this.sendMessageWithRetry(message, maxRetries, attempt + 1);
                resolve(retryResult);
              } catch (retryError) {
                reject(retryError);
              }
            }, 100);
          }
        } else {
          // Success - resolve with response
          resolve(response);
        }
      });
    });
  }

  /**
   * Get actual Chrome storage quota with fallbacks
   * @returns {Promise<number>} Storage quota in bytes
   */
  static async getActualQuota() {
    try {
      // Method 1: Use Chrome's actual API
      if (chrome?.storage?.local?.QUOTA_BYTES) {
        return chrome.storage.local.QUOTA_BYTES;
      }

      // Method 2: Conservative detection by testing small write
      const testData = 'x'.repeat(1024); // 1KB test
      try {
        await this.storage('set', { quota_test: testData });
        await this.storage('remove', 'quota_test');
        
        // If 1KB works, assume 5MB safe minimum (enterprise environments)
        return 5 * 1024 * 1024;
      } catch (e) {
        // Very restrictive environment detected
        return 1 * 1024 * 1024; // 1MB ultra-safe
      }
    } catch (error) {
      console.warn('Failed to detect storage quota:', error);
      return 1 * 1024 * 1024; // Conservative fallback
    }
  }

  /**
   * Memory fallback for storage operations when Chrome API unavailable
   * @param {string} operation - Storage operation
   * @param {*} data - Operation data
   * @returns {*} Fallback result
   */
  static memoryFallback(operation, data) {
    // Initialize memory storage if not exists
    if (!this._memoryStorage) {
      this._memoryStorage = new Map();
    }

    switch (operation) {
      case 'set':
        if (typeof data === 'object') {
          Object.entries(data).forEach(([key, value]) => {
            this._memoryStorage.set(key, value);
          });
        }
        return Promise.resolve();

      case 'get':
        if (typeof data === 'string') {
          const result = {};
          result[data] = this._memoryStorage.get(data);
          return Promise.resolve(result);
        }
        if (Array.isArray(data)) {
          const result = {};
          data.forEach(key => {
            result[key] = this._memoryStorage.get(key);
          });
          return Promise.resolve(result);
        }
        if (data === null || data === undefined) {
          // Get all data
          const result = {};
          this._memoryStorage.forEach((value, key) => {
            result[key] = value;
          });
          return Promise.resolve(result);
        }
        break;

      case 'remove':
        if (typeof data === 'string') {
          this._memoryStorage.delete(data);
        }
        if (Array.isArray(data)) {
          data.forEach(key => this._memoryStorage.delete(key));
        }
        return Promise.resolve();

      case 'getBytesInUse':
        // Estimate memory usage (rough approximation)
        let totalBytes = 0;
        this._memoryStorage.forEach((value, key) => {
          totalBytes += JSON.stringify({[key]: value}).length * 2; // UTF-16 approximation
        });
        return Promise.resolve(totalBytes);

      default:
        return Promise.reject(new Error(`Unknown operation: ${operation}`));
    }
  }

  /**
   * Handle storage quota exceeded scenarios
   * @param {string} operation - Original operation
   * @param {*} data - Original data
   * @returns {Promise<*>} Result after quota handling
   */
  static async handleQuotaExceeded(operation, data) {
    console.warn('Storage quota exceeded, attempting recovery');
    
    try {
      // Try to clean up old data first
      const allData = await chrome.storage.local.get(null);
      const keys = Object.keys(allData);
      
      // Remove old task data (keep only most recent)
      const taskKeys = keys.filter(key => key.startsWith('task_'));
      if (taskKeys.length > 3) {
        const keysToRemove = taskKeys.slice(0, taskKeys.length - 3);
        await chrome.storage.local.remove(keysToRemove);
        console.info(`Cleaned up ${keysToRemove.length} old task entries`);
      }
      
      // Try the original operation again
      if (operation === 'set') {
        return await chrome.storage.local.set(data);
      }
    } catch (retryError) {
      console.error('Failed to recover from quota exceeded:', retryError);
      // Fall back to memory storage
      return this.memoryFallback(operation, data);
    }
  }

  /**
   * Check if extension is running in a restricted environment
   * @returns {Promise<Object>} Environment capabilities
   */
  static async checkEnvironmentCapabilities() {
    const capabilities = {
      storage: false,
      tabs: false,
      scripting: false,
      downloads: false,
      restrictedEnvironment: false
    };

    try {
      // Test storage access
      if (chrome?.storage?.local) {
        await chrome.storage.local.get('test');
        capabilities.storage = true;
      }
    } catch (e) {
      console.debug('Storage API restricted');
    }

    try {
      // Test tabs access
      if (chrome?.tabs?.query) {
        await chrome.tabs.query({});
        capabilities.tabs = true;
      }
    } catch (e) {
      console.debug('Tabs API restricted');
    }

    try {
      // Test scripting access
      if (chrome?.scripting) {
        capabilities.scripting = true;
      }
    } catch (e) {
      console.debug('Scripting API restricted');
    }

    try {
      // Test downloads access
      if (chrome?.downloads) {
        capabilities.downloads = true;
      }
    } catch (e) {
      console.debug('Downloads API restricted');
    }

    // Determine if we're in a restricted environment
    const restrictedCount = Object.values(capabilities).filter(cap => !cap).length;
    capabilities.restrictedEnvironment = restrictedCount > 1;

    return capabilities;
  }

  /**
   * Initialize safe Chrome API with environment detection
   * @returns {Promise<Object>} Initialization result
   */
  static async initialize() {
    const capabilities = await this.checkEnvironmentCapabilities();
    
    if (capabilities.restrictedEnvironment) {
      console.warn('Running in restricted Chrome environment. Some features may be limited.');
    }
    
    return {
      initialized: true,
      capabilities,
      fallbacksActive: capabilities.restrictedEnvironment
    };
  }
}

/**
 * Legacy wrapper functions for backward compatibility
 */

/**
 * Safe wrapper for chrome.storage.local operations
 */
export const safeStorage = {
  async set(data) {
    return SafeChromeAPI.storage('set', data);
  },
  
  async get(keys) {
    return SafeChromeAPI.storage('get', keys);
  },
  
  async remove(keys) {
    return SafeChromeAPI.storage('remove', keys);
  },
  
  async getBytesInUse(keys) {
    return SafeChromeAPI.storage('getBytesInUse', keys);
  }
};

/**
 * Safe wrapper for chrome.tabs operations
 */
export const safeTabs = {
  async create(options) {
    return SafeChromeAPI.tabs('create', options);
  },
  
  async remove(tabId) {
    return SafeChromeAPI.tabs('remove', tabId);
  },
  
  async query(queryInfo) {
    return SafeChromeAPI.tabs('query', queryInfo);
  }
};

/**
 * Safe wrapper for chrome.scripting operations
 */
export const safeScripting = {
  async executeScript(options) {
    return SafeChromeAPI.scripting('executeScript', options);
  }
};

/**
 * Safe wrapper for chrome.downloads operations
 */
export const safeDownloads = {
  async download(options) {
    return SafeChromeAPI.downloads('download', options);
  }
};

/**
 * Safe wrapper for chrome.runtime operations
 */
export const safeRuntime = {
  async sendMessage(message) {
    return SafeChromeAPI.runtime('sendMessage', message);
  },
  
  connect(options) {
    return SafeChromeAPI.runtime('connect', options);
  }
};