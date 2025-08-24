/**
 * Advanced Queue Manager for intelligent request scheduling and concurrency control
 * Implements priority-based processing with adaptive concurrency limits
 */

/**
 * Priority Queue implementation for URL processing
 */
class PriorityQueue {
  constructor() {
    this.high = [];     // User-initiated or important pages
    this.normal = [];   // Regular discovered links  
    this.low = [];      // Background/prefetch requests
  }

  /**
   * Enqueue a URL with priority
   * @param {Object} item - URL item with metadata
   * @param {string} priority - Priority level: 'high', 'normal', 'low'
   */
  enqueue(item, priority = 'normal') {
    const queue = this.getQueue(priority);
    
    // Check for duplicates before adding
    if (!queue.find(existingItem => existingItem.url === item.url)) {
      queue.push(item);
    }
  }

  /**
   * Dequeue highest priority item
   * @returns {Object|null} - Next item or null if empty
   */
  dequeue() {
    if (this.high.length > 0) return this.high.shift();
    if (this.normal.length > 0) return this.normal.shift();
    if (this.low.length > 0) return this.low.shift();
    return null;
  }

  /**
   * Get queue by priority name
   * @param {string} priority - Priority level
   * @returns {Array} - Queue array
   */
  getQueue(priority) {
    switch (priority) {
      case 'high': return this.high;
      case 'low': return this.low;
      default: return this.normal;
    }
  }

  /**
   * Get total queue size
   * @returns {number} - Total items in all queues
   */
  get size() {
    return this.high.length + this.normal.length + this.low.length;
  }

  /**
   * Check if queue is empty
   * @returns {boolean} - Whether all queues are empty
   */
  get isEmpty() {
    return this.size === 0;
  }

  /**
   * Get queue statistics
   * @returns {Object} - Queue stats
   */
  getStats() {
    return {
      high: this.high.length,
      normal: this.normal.length,
      low: this.low.length,
      total: this.size
    };
  }

  /**
   * Clear all queues
   */
  clear() {
    this.high.length = 0;
    this.normal.length = 0;
    this.low.length = 0;
  }
}

/**
 * Adaptive Concurrency Manager
 * Adjusts concurrency based on performance metrics and resource availability
 */
class AdaptiveConcurrencyManager {
  constructor(baseLimit = 5) {
    this.baseLimit = baseLimit;
    this.currentLimit = baseLimit;
    this.minLimit = 1;
    this.maxLimit = 10;
    
    // Performance tracking
    this.recentTimes = [];
    this.maxRecentTimes = 10;
    this.performanceThreshold = 3000; // 3 seconds
    
    // Error tracking
    this.recentErrors = 0;
    this.errorThreshold = 3;
    this.errorResetTime = 60000; // 1 minute
    this.lastErrorReset = Date.now();
  }

  /**
   * Record completion time for adaptive adjustment
   * @param {number} duration - Time taken in milliseconds
   * @param {boolean} success - Whether operation was successful
   */
  recordCompletion(duration, success = true) {
    if (!success) {
      this.recentErrors++;
    }
    
    // Reset error count periodically
    const now = Date.now();
    if (now - this.lastErrorReset > this.errorResetTime) {
      this.recentErrors = 0;
      this.lastErrorReset = now;
    }
    
    // Track recent performance
    this.recentTimes.push(duration);
    if (this.recentTimes.length > this.maxRecentTimes) {
      this.recentTimes.shift();
    }
    
    // Adjust concurrency based on performance
    this.adjustConcurrency();
  }

  /**
   * Adjust concurrency limit based on recent performance
   */
  adjustConcurrency() {
    if (this.recentTimes.length < 3) {
      return; // Not enough data yet
    }

    // Calculate average recent performance
    const avgTime = this.recentTimes.reduce((sum, time) => sum + time, 0) / this.recentTimes.length;
    
    // Reduce concurrency if too many errors
    if (this.recentErrors >= this.errorThreshold) {
      this.currentLimit = Math.max(this.minLimit, this.currentLimit - 1);
      console.debug(`AdaptiveConcurrency: Reduced limit to ${this.currentLimit} due to errors`);
      return;
    }
    
    // Adjust based on performance
    if (avgTime > this.performanceThreshold) {
      // Performance is slow, reduce concurrency
      this.currentLimit = Math.max(this.minLimit, this.currentLimit - 1);
      console.debug(`AdaptiveConcurrency: Reduced limit to ${this.currentLimit} due to slow performance (${avgTime}ms avg)`);
    } else if (avgTime < this.performanceThreshold / 2 && this.recentErrors === 0) {
      // Performance is good and no errors, can increase concurrency
      this.currentLimit = Math.min(this.maxLimit, this.currentLimit + 1);
      console.debug(`AdaptiveConcurrency: Increased limit to ${this.currentLimit} due to good performance (${avgTime}ms avg)`);
    }
  }

  /**
   * Get current concurrency limit
   * @returns {number} - Current concurrency limit
   */
  getLimit() {
    return this.currentLimit;
  }

  /**
   * Get performance statistics
   * @returns {Object} - Performance stats
   */
  getStats() {
    const avgTime = this.recentTimes.length > 0 
      ? this.recentTimes.reduce((sum, time) => sum + time, 0) / this.recentTimes.length 
      : 0;

    return {
      currentLimit: this.currentLimit,
      baseLimit: this.baseLimit,
      avgResponseTime: avgTime.toFixed(2),
      recentErrors: this.recentErrors,
      recentSamples: this.recentTimes.length
    };
  }

  /**
   * Reset to base configuration
   */
  reset() {
    this.currentLimit = this.baseLimit;
    this.recentTimes = [];
    this.recentErrors = 0;
    this.lastErrorReset = Date.now();
  }
}

/**
 * Enhanced Queue Manager with priority processing and adaptive concurrency
 */
export class QueueManager {
  constructor(options = {}) {
    this.options = {
      enablePriorityProcessing: options.enablePriorityProcessing ?? true,
      enableAdaptiveConcurrency: options.enableAdaptiveConcurrency ?? true,
      baseConcurrency: options.baseConcurrency ?? 5,
      enablePerformanceMonitoring: options.enablePerformanceMonitoring ?? true,
      maxQueueSize: options.maxQueueSize ?? 1000,
    };

    // Core components
    this.priorityQueue = new PriorityQueue();
    this.concurrencyManager = new AdaptiveConcurrencyManager(this.options.baseConcurrency);
    
    // Active processing tracking
    this.activeRequests = new Map(); // requestId -> { promise, startTime, url }
    this.requestCounter = 0;
    
    // Statistics
    this.stats = {
      totalProcessed: 0,
      totalErrors: 0,
      queueFullDrops: 0,
      priorityUpgrades: 0,
    };

    console.debug('QueueManager initialized with options:', this.options);
  }

  /**
   * Add URL to processing queue with automatic priority detection
   * @param {string} url - URL to process
   * @param {Object} metadata - Additional metadata for the URL
   * @param {string} explicitPriority - Explicit priority override
   * @returns {boolean} - Whether item was successfully queued
   */
  enqueue(url, metadata = {}, explicitPriority = null) {
    if (!this.options.enablePriorityProcessing) {
      // Fallback to simple queuing if priority processing is disabled
      return this.enqueueSimple(url, metadata);
    }

    // Check queue size limit
    if (this.priorityQueue.size >= this.options.maxQueueSize) {
      this.stats.queueFullDrops++;
      console.warn(`QueueManager: Queue full, dropping ${url}`);
      return false;
    }

    // Determine priority
    const priority = explicitPriority || this.determinePriority(url, metadata);
    
    // Create queue item
    const item = {
      url: url,
      priority: priority,
      metadata: metadata,
      enqueueTime: Date.now(),
      retries: 0,
    };

    this.priorityQueue.enqueue(item, priority);
    
    console.debug(`QueueManager: Enqueued ${url} with priority ${priority}, queue size: ${this.priorityQueue.size}`);
    return true;
  }

  /**
   * Simple enqueue without priority processing (fallback mode)
   * @param {string} url - URL to process
   * @param {Object} metadata - Additional metadata
   * @returns {boolean} - Success
   */
  enqueueSimple(url, metadata) {
    const item = { url, metadata, enqueueTime: Date.now(), retries: 0 };
    this.priorityQueue.enqueue(item, 'normal');
    return true;
  }

  /**
   * Determine priority for a URL based on heuristics
   * @param {string} url - URL to analyze
   * @param {Object} metadata - URL metadata
   * @returns {string} - Determined priority ('high', 'normal', 'low')
   */
  determinePriority(url, metadata) {
    try {
      const urlObj = new URL(url);
      
      // High priority conditions
      if (metadata.isUserInitiated) return 'high';
      if (metadata.depth === 0) return 'high'; // Starting page
      if (urlObj.pathname === '/' || urlObj.pathname === '') return 'high'; // Home page
      
      // Low priority conditions  
      if (metadata.depth > 3) return 'low'; // Deep links
      if (urlObj.pathname.includes('/tag/') || urlObj.pathname.includes('/category/')) return 'low';
      if (urlObj.pathname.includes('/archive/') || urlObj.pathname.includes('/page/')) return 'low';
      
      // Check for content-rich indicators (higher priority)
      const contentIndicators = ['/article/', '/post/', '/blog/', '/news/', '/story/'];
      if (contentIndicators.some(indicator => urlObj.pathname.includes(indicator))) {
        return 'high';
      }
      
      // Default to normal priority
      return 'normal';
      
    } catch (error) {
      console.debug(`QueueManager: Priority determination failed for ${url}:`, error);
      return 'normal';
    }
  }

  /**
   * Get next item to process based on priority and concurrency limits
   * @returns {Object|null} - Next item to process or null if should wait
   */
  getNextItem() {
    // Check if we can process more items
    const concurrencyLimit = this.options.enableAdaptiveConcurrency 
      ? this.concurrencyManager.getLimit()
      : this.options.baseConcurrency;
      
    if (this.activeRequests.size >= concurrencyLimit) {
      return null; // At capacity
    }

    // Get highest priority item
    const item = this.priorityQueue.dequeue();
    if (!item) {
      return null; // Queue empty
    }

    // Track active request
    const requestId = ++this.requestCounter;
    const activeRequest = {
      id: requestId,
      url: item.url,
      startTime: Date.now(),
      item: item,
    };

    return activeRequest;
  }

  /**
   * Mark request as started
   * @param {Object} activeRequest - Active request object
   * @param {Promise} promise - Processing promise
   */
  markRequestStarted(activeRequest, promise) {
    this.activeRequests.set(activeRequest.id, {
      ...activeRequest,
      promise: promise
    });

    // Clean up when promise completes
    promise.finally(() => {
      this.markRequestCompleted(activeRequest.id);
    });
  }

  /**
   * Mark request as completed and update statistics
   * @param {number} requestId - Request ID
   * @param {boolean} success - Whether request was successful  
   */
  markRequestCompleted(requestId, success = true) {
    const activeRequest = this.activeRequests.get(requestId);
    if (!activeRequest) {
      return;
    }

    const duration = Date.now() - activeRequest.startTime;
    this.activeRequests.delete(requestId);
    
    // Update statistics
    this.stats.totalProcessed++;
    if (!success) {
      this.stats.totalErrors++;
    }

    // Record performance for adaptive concurrency
    if (this.options.enableAdaptiveConcurrency) {
      this.concurrencyManager.recordCompletion(duration, success);
    }

    // Log slow requests
    if (this.options.enablePerformanceMonitoring && duration > 5000) {
      console.warn(`QueueManager: Slow request completed: ${activeRequest.url} took ${duration}ms`);
    }
  }

  /**
   * Process queue with intelligent scheduling
   * @param {Function} processingFunction - Function to process each URL
   * @returns {Promise<void>} - Completion promise
   */
  async processQueue(processingFunction) {
    const maxIdleTime = 100; // Max time to wait when queue is empty
    
    while (!this.priorityQueue.isEmpty || this.activeRequests.size > 0) {
      // Try to start new requests
      while (true) {
        const nextRequest = this.getNextItem();
        if (!nextRequest) {
          break; // No more items to process right now
        }

        // Start processing
        const promise = this.processItem(nextRequest, processingFunction);
        this.markRequestStarted(nextRequest, promise);
      }

      // Wait for at least one request to complete if we have active requests
      if (this.activeRequests.size > 0) {
        const promises = Array.from(this.activeRequests.values()).map(req => req.promise);
        await Promise.race(promises);
      } else if (!this.priorityQueue.isEmpty) {
        // Queue has items but we can't process them yet, wait a bit
        await new Promise(resolve => setTimeout(resolve, maxIdleTime));
      } else {
        // Queue is empty and no active requests, we're done
        break;
      }
    }
  }

  /**
   * Process individual queue item
   * @param {Object} activeRequest - Active request object
   * @param {Function} processingFunction - Processing function
   * @returns {Promise} - Processing promise
   */
  async processItem(activeRequest, processingFunction) {
    try {
      const result = await processingFunction(activeRequest.item.url, activeRequest.item.metadata);
      this.markRequestCompleted(activeRequest.id, true);
      return result;
    } catch (error) {
      console.error(`QueueManager: Processing failed for ${activeRequest.item.url}:`, error);
      
      // Handle retries
      const item = activeRequest.item;
      item.retries++;
      
      if (item.retries < 3) {
        // Requeue with lower priority
        const newPriority = item.priority === 'high' ? 'normal' : 'low';
        this.priorityQueue.enqueue(item, newPriority);
      }
      
      this.markRequestCompleted(activeRequest.id, false);
      throw error;
    }
  }

  /**
   * Get comprehensive queue statistics
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      queue: this.priorityQueue.getStats(),
      activeRequests: this.activeRequests.size,
      concurrency: this.options.enableAdaptiveConcurrency 
        ? this.concurrencyManager.getStats()
        : { currentLimit: this.options.baseConcurrency },
      avgQueueWaitTime: this.calculateAverageWaitTime(),
    };
  }

  /**
   * Calculate average wait time for items in queue
   * @returns {number} - Average wait time in milliseconds
   */
  calculateAverageWaitTime() {
    const now = Date.now();
    const allItems = [...this.priorityQueue.high, ...this.priorityQueue.normal, ...this.priorityQueue.low];
    
    if (allItems.length === 0) return 0;
    
    const totalWaitTime = allItems.reduce((sum, item) => sum + (now - item.enqueueTime), 0);
    return totalWaitTime / allItems.length;
  }

  /**
   * Clear queue and reset state
   */
  clear() {
    this.priorityQueue.clear();
    this.activeRequests.clear();
    this.concurrencyManager.reset();
    this.stats = {
      totalProcessed: 0,
      totalErrors: 0,
      queueFullDrops: 0,
      priorityUpgrades: 0,
    };
  }

  /**
   * Cleanup and shutdown queue manager
   */
  cleanup() {
    console.debug('QueueManager: Cleaning up');
    this.clear();
  }
}