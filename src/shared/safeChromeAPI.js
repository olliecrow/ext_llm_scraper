/**
 * Safe Chrome API wrapper.
 */

/**
 * Defensive Chrome API wrapper class.
 */
export class SafeChromeAPI {
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
      if (
        error.message.includes('Download interrupted') ||
        error.message.includes('USER_CANCELED')
      ) {
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
          console.warn(
            `Runtime sendMessage error (attempt ${attempt}/${maxRetries}):`,
            errorMessage
          );

          // Handle specific service worker inactivity errors
          if (
            errorMessage.includes('message port closed') ||
            errorMessage.includes('receiving end does not exist')
          ) {
            if (attempt < maxRetries) {
              // Calculate exponential backoff delay (100ms, 200ms, 400ms)
              const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);

              setTimeout(async () => {
                try {
                  const retryResult = await this.sendMessageWithRetry(
                    message,
                    maxRetries,
                    attempt + 1
                  );
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
                const retryResult = await this.sendMessageWithRetry(
                  message,
                  maxRetries,
                  attempt + 1
                );
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
}

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
  },
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
  },
};
