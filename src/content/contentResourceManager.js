/**
 * Content Resource Manager for better memory management in content scripts
 * Tracks and cleans up resources to prevent memory leaks
 */

export class ContentResourceManager {
  constructor() {
    this.timers = new Set();
    this.observers = new Set();
    this.eventListeners = new Map();
    this.cleanup = this.cleanup.bind(this);
    this.isCleanedUp = false;
    
    // Setup cleanup handlers
    this.setupCleanupHandlers();
  }

  /**
   * Setup automatic cleanup on page unload
   */
  setupCleanupHandlers() {
    // Listen for various unload events
    const events = ['beforeunload', 'pagehide', 'unload', 'visibilitychange'];
    
    events.forEach(event => {
      const handler = () => {
        if (event === 'visibilitychange' && document.visibilityState === 'visible') {
          return; // Don't cleanup when page becomes visible
        }
        this.cleanup();
      };
      
      window.addEventListener(event, handler, { once: true, passive: true });
      this.trackEventListener(window, event, handler);
    });

    // Also cleanup if extension context becomes invalid
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        chrome.runtime.onConnect.addListener(() => {
          // Connection is still valid
        });
      } catch (error) {
        // Extension context invalid, cleanup
        this.cleanup();
      }
    }
  }

  /**
   * Create a managed timeout that will be automatically cleaned up
   * @param {Function} callback - Function to call
   * @param {number} delay - Delay in milliseconds
   * @returns {number} - Timer ID
   */
  setTimeout(callback, delay) {
    if (this.isCleanedUp) {
      console.warn('ContentResourceManager: Cannot create timer after cleanup');
      return null;
    }

    const timerId = setTimeout(() => {
      this.timers.delete(timerId);
      try {
        callback();
      } catch (error) {
        console.error('ContentResourceManager: Timer callback error:', error);
      }
    }, delay);
    
    this.timers.add(timerId);
    return timerId;
  }

  /**
   * Create a managed interval that will be automatically cleaned up
   * @param {Function} callback - Function to call
   * @param {number} delay - Interval in milliseconds
   * @returns {number} - Timer ID
   */
  setInterval(callback, delay) {
    if (this.isCleanedUp) {
      console.warn('ContentResourceManager: Cannot create interval after cleanup');
      return null;
    }

    const timerId = setInterval(() => {
      try {
        callback();
      } catch (error) {
        console.error('ContentResourceManager: Interval callback error:', error);
        this.clearInterval(timerId);
      }
    }, delay);
    
    this.timers.add(timerId);
    return timerId;
  }

  /**
   * Clear a managed timeout/interval
   * @param {number} timerId - Timer ID to clear
   */
  clearTimeout(timerId) {
    if (timerId && this.timers.has(timerId)) {
      clearTimeout(timerId);
      this.timers.delete(timerId);
    }
  }

  /**
   * Clear a managed interval
   * @param {number} timerId - Timer ID to clear
   */
  clearInterval(timerId) {
    if (timerId && this.timers.has(timerId)) {
      clearInterval(timerId);
      this.timers.delete(timerId);
    }
  }

  /**
   * Create a managed MutationObserver
   * @param {Function} callback - Observer callback
   * @returns {MutationObserver} - Observer instance
   */
  createMutationObserver(callback) {
    if (this.isCleanedUp) {
      console.warn('ContentResourceManager: Cannot create observer after cleanup');
      return null;
    }

    const observer = new MutationObserver((mutations) => {
      try {
        callback(mutations);
      } catch (error) {
        console.error('ContentResourceManager: Observer callback error:', error);
        this.destroyObserver(observer);
      }
    });

    this.observers.add(observer);
    return observer;
  }

  /**
   * Destroy a managed observer
   * @param {MutationObserver} observer - Observer to destroy
   */
  destroyObserver(observer) {
    if (observer && this.observers.has(observer)) {
      observer.disconnect();
      this.observers.delete(observer);
    }
  }

  /**
   * Add a managed event listener
   * @param {EventTarget} target - Target to listen on
   * @param {string} event - Event type
   * @param {Function} handler - Event handler
   * @param {Object} options - Event listener options
   */
  addEventListener(target, event, handler, options = {}) {
    if (this.isCleanedUp) {
      console.warn('ContentResourceManager: Cannot add event listener after cleanup');
      return;
    }

    target.addEventListener(event, handler, options);
    this.trackEventListener(target, event, handler);
  }

  /**
   * Track an event listener for cleanup
   * @param {EventTarget} target - Target element
   * @param {string} event - Event type  
   * @param {Function} handler - Event handler
   */
  trackEventListener(target, event, handler) {
    if (!this.eventListeners.has(target)) {
      this.eventListeners.set(target, []);
    }
    this.eventListeners.get(target).push({ event, handler });
  }

  /**
   * Remove a managed event listener
   * @param {EventTarget} target - Target to remove from
   * @param {string} event - Event type
   * @param {Function} handler - Event handler
   */
  removeEventListener(target, event, handler) {
    target.removeEventListener(event, handler);
    
    if (this.eventListeners.has(target)) {
      const listeners = this.eventListeners.get(target);
      const index = listeners.findIndex(l => l.event === event && l.handler === handler);
      if (index !== -1) {
        listeners.splice(index, 1);
        if (listeners.length === 0) {
          this.eventListeners.delete(target);
        }
      }
    }
  }

  /**
   * Get memory usage statistics
   * @returns {Object} - Memory usage stats
   */
  getMemoryStats() {
    return {
      timers: this.timers.size,
      observers: this.observers.size,
      eventTargets: this.eventListeners.size,
      totalEventListeners: Array.from(this.eventListeners.values())
        .reduce((sum, listeners) => sum + listeners.length, 0),
      isCleanedUp: this.isCleanedUp
    };
  }

  /**
   * Check if extension context is still valid
   * @returns {boolean} - Whether context is valid
   */
  isExtensionContextValid() {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return false;
    }

    try {
      // Try to access extension ID - if context is invalid, this will throw
      const id = chrome.runtime.id;
      return !!id;
    } catch (error) {
      return false;
    }
  }

  /**
   * Cleanup all managed resources
   */
  cleanup() {
    if (this.isCleanedUp) {
      return; // Already cleaned up
    }

    console.debug('ContentResourceManager: Cleaning up resources');
    
    // Clear all timers
    for (const timerId of this.timers) {
      clearTimeout(timerId);
      clearInterval(timerId);
    }
    this.timers.clear();

    // Disconnect all observers
    for (const observer of this.observers) {
      observer.disconnect();
    }
    this.observers.clear();

    // Remove all event listeners
    for (const [target, listeners] of this.eventListeners.entries()) {
      for (const { event, handler } of listeners) {
        try {
          target.removeEventListener(event, handler);
        } catch (error) {
          // Target might be invalid, ignore
        }
      }
    }
    this.eventListeners.clear();

    this.isCleanedUp = true;
    console.debug('ContentResourceManager: Cleanup completed');
  }

  /**
   * Force cleanup and prevent further usage
   */
  destroy() {
    this.cleanup();
    // Make methods throw to prevent accidental usage
    const throwError = () => {
      throw new Error('ContentResourceManager has been destroyed');
    };
    
    this.setTimeout = throwError;
    this.setInterval = throwError;
    this.createMutationObserver = throwError;
    this.addEventListener = throwError;
  }
}

/**
 * Global instance for content scripts to use
 * Automatically cleaned up on page unload
 */
export const contentResourceManager = new ContentResourceManager();