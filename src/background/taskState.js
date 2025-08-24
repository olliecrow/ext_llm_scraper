import { normalizeUrl, extractDomain } from '../shared/utils.js';
import { CONFIG } from '../shared/config.js';

/**
 * Simple LZ-string compression for storage efficiency
 * Using a simplified LZ compression algorithm
 */
class SimpleCompressor {
  static compress(str) {
    if (!str) return '';
    const dict = {};
    const data = (str + '').split('');
    const out = [];
    let phrase = data[0];
    let code = 256;
    
    for (let i = 1; i < data.length; i++) {
      const currChar = data[i];
      if (dict[phrase + currChar] != null) {
        phrase += currChar;
      } else {
        out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
        dict[phrase + currChar] = code;
        code++;
        phrase = currChar;
      }
    }
    out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
    
    // Convert to string for storage
    return out.map(v => String.fromCharCode(v)).join('');
  }
  
  static decompress(compressed) {
    if (!compressed) return '';
    const dict = {};
    const data = (compressed + '').split('');
    let currChar = data[0];
    let oldPhrase = currChar;
    const out = [currChar];
    let code = 256;
    let phrase;
    
    for (let i = 1; i < data.length; i++) {
      const currCode = data[i].charCodeAt(0);
      if (currCode < 256) {
        phrase = data[i];
      } else {
        phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
      }
      out.push(phrase);
      currChar = phrase.charAt(0);
      dict[code] = oldPhrase + currChar;
      code++;
      oldPhrase = phrase;
    }
    return out.join('');
  }
}

/**
 * Represents the state of a scraping task
 */
export class TaskState {
  constructor(taskId, startingUrl, settings) {
    this.taskId = taskId;
    const normalizedStartingUrl = normalizeUrl(startingUrl);
    this.startingUrl = normalizedStartingUrl;
    this.startingDomain = extractDomain(startingUrl);

    // Apply settings with limits
    this.settings = {
      ...settings,
      concurrency: Math.min(
        Math.max(
          settings.concurrency || CONFIG.DEFAULTS.CONCURRENCY,
          CONFIG.LIMITS.MIN_CONCURRENCY
        ),
        CONFIG.LIMITS.MAX_CONCURRENCY
      ),
      maxPages: Math.min(
        Math.max(settings.maxPages || CONFIG.DEFAULTS.MAX_PAGES, CONFIG.LIMITS.MIN_PAGES),
        CONFIG.LIMITS.MAX_PAGES
      ),
      delay: Math.max(settings.delay || CONFIG.DEFAULTS.DELAY, 0),
      crawlMode: settings.crawlMode ?? CONFIG.DEFAULTS.CRAWL_MODE,
      copyToClipboard: settings.copyToClipboard ?? CONFIG.DEFAULTS.COPY_TO_CLIPBOARD,
      downloadFile: settings.downloadFile ?? CONFIG.DEFAULTS.DOWNLOAD_FILE,
    };

    // Initialize task state
    this.queue = [normalizedStartingUrl];
    this.visited = new Set([normalizedStartingUrl]);
    this.processed = 0;
    this.inProgress = 0;
    this.abort = false;
    this.contentMap = new Map();
    this.pendingContent = new Map();
    this.tabIds = new Set();

    // For progress persistence
    this.lastSaveTime = Date.now();
    this.saveInterval = null;
    this.hasUnsavedChanges = false;
    this.saveDebounceTimer = null;

    // For completion race condition protection
    this.isFinishing = false;
    this.isFinished = false;
    this.isCompletionInProgress = false;
    
    // Storage management
    this.contentAccessOrder = new Map(); // Track access times for LRU
    this.storageWarningIssued = false;
    this.compressionEnabled = true;
    this.progressivelySaved = new Set(); // Track what's already saved
    this.lastStorageCheck = 0;
    this.storageCheckInterval = 5000; // Check every 5 seconds
  }

  /**
   * Checks if the task is complete
   * @returns {boolean}
   */
  isComplete() {
    return (
      !this.isFinishing &&
      !this.isFinished &&
      this.inProgress === 0 &&
      (this.processed >= this.settings.maxPages || this.queue.length === 0)
    );
  }

  /**
   * Atomically marks the task as finishing to prevent race conditions
   * @returns {boolean} True if this call successfully claimed completion, false if already finishing/finished
   */
  markAsFinishing() {
    // Atomic check-and-set - prevent race conditions
    if (this.isCompletionInProgress || this.isFinishing || this.isFinished) {
      return false;
    }

    // Verify completion conditions atomically (preserve original logic)
    if (this.inProgress > 0) {
      return false;
    }
    
    // Task is complete if max pages reached OR queue is empty
    const maxPagesReached = this.processed >= this.settings.maxPages;
    const queueEmpty = this.queue.length === 0;
    
    if (!maxPagesReached && !queueEmpty) {
      return false; // Neither condition met
    }

    // Additional validation - must have processed at least one page if queue is empty
    if (queueEmpty && this.processed === 0) {
      return false; // Edge case: no pages to process
    }

    // Set completion flag atomically BEFORE any other operations
    this.isCompletionInProgress = true;
    
    // Final validation after setting flag - check if conditions changed
    if (this.inProgress > 0) {
      // Conditions changed during flag setting - rollback
      this.isCompletionInProgress = false;
      return false;
    }
    
    // Re-check completion conditions
    const finalMaxPagesReached = this.processed >= this.settings.maxPages;
    const finalQueueEmpty = this.queue.length === 0;
    
    if (!finalMaxPagesReached && !finalQueueEmpty) {
      // Conditions changed during flag setting - rollback
      this.isCompletionInProgress = false;
      return false;
    }
    
    // Successfully claimed completion
    this.isFinishing = true;
    return true;
  }

  /**
   * Marks the task as completely finished
   */
  markAsFinished() {
    this.isCompletionInProgress = false; // Clear completion flag
    this.isFinishing = false;
    this.isFinished = true;
  }

  /**
   * Checks if we can schedule more pages to scrape
   * @returns {boolean}
   */
  canSchedule() {
    const abortCheck = !this.abort;
    const concurrencyCheck = this.inProgress < this.settings.concurrency;
    const queueCheck = this.queue.length > 0;
    const maxPagesCheck = this.processed + this.inProgress < this.settings.maxPages;
    
    // Send debug info about canSchedule conditions
    if (this.taskManager) {
      this.taskManager.sendStatus(this.taskId, {
        debug: `🔥 DEBUG: canSchedule() checks - abort:${abortCheck}, concurrency:${concurrencyCheck} (${this.inProgress}<${this.settings.concurrency}), queue:${queueCheck} (${this.queue.length}>0), maxPages:${maxPagesCheck} (${this.processed}+${this.inProgress}<${this.settings.maxPages})`,
      });
    }
    
    return (
      abortCheck &&
      concurrencyCheck &&
      queueCheck &&
      maxPagesCheck
    );
  }

  /**
   * Checks if there are active scraping operations in progress
   * @returns {boolean}
   */
  hasActiveScraping() {
    return this.inProgress > 0;
  }

  /**
   * Adds a URL to the queue if it hasn't been visited
   * @param {string} url - The URL to add
   * @returns {boolean} - Whether the URL was added
   */
  addToQueue(url) {
    // Prevent additions during completion to avoid race conditions
    if (this.isCompletionInProgress || this.isFinishing || this.isFinished) {
      return false;
    }
    
    const normalizedUrl = normalizeUrl(url);
    if (!this.visited.has(normalizedUrl)) {
      this.visited.add(normalizedUrl);
      this.queue.push(normalizedUrl);
      this.markChanged();
      return true;
    }
    return false;
  }

  /**
   * Gets the next URL from the queue
   * @returns {string|null} - The next URL or null if queue is empty
   */
  getNextUrl() {
    const url = this.queue.shift() || null;
    if (url) {
      this.markChanged();
    }
    return url;
  }

  /**
   * Adds scraped content to the task with compression and progressive saving
   * @param {string} url - The URL of the page
   * @param {Object} content - The scraped content
   */
  addContent(url, content) {
    const normalizedUrl = normalizeUrl(url);
    if (!this.contentMap.has(normalizedUrl)) {
      // Compress content if enabled
      let processedContent = content;
      if (this.compressionEnabled && content.markdown) {
        try {
          processedContent = {
            ...content,
            markdown: SimpleCompressor.compress(content.markdown),
            compressed: true
          };
        } catch (e) {
          console.warn('Compression failed, storing uncompressed:', e);
        }
      }
      
      this.contentMap.set(normalizedUrl, processedContent);
      this.contentAccessOrder.set(normalizedUrl, Date.now());
      
      // Check if we should trigger progressive save
      if (this.shouldProgressivelySave()) {
        this.triggerProgressiveSave();
      }
      
      this.markChanged();
    }
  }
  
  /**
   * Checks if progressive save should be triggered
   * @returns {boolean}
   */
  shouldProgressivelySave() {
    // Save every 10 pages or if we haven't saved in 30 seconds
    const unsavedCount = this.contentMap.size - this.progressivelySaved.size;
    const timeSinceLastSave = Date.now() - this.lastSaveTime;
    return unsavedCount >= 10 || (unsavedCount > 0 && timeSinceLastSave > 30000);
  }
  
  /**
   * Triggers progressive save of new content
   */
  triggerProgressiveSave() {
    if (this.onProgressiveSaveCallback) {
      const newContent = new Map();
      for (const [url, content] of this.contentMap.entries()) {
        if (!this.progressivelySaved.has(url)) {
          newContent.set(url, content);
          this.progressivelySaved.add(url);
        }
      }
      if (newContent.size > 0) {
        this.onProgressiveSaveCallback(this.taskId, newContent);
        this.lastSaveTime = Date.now();
      }
    }
  }
  
  /**
   * Sets progressive save callback
   * @param {Function} callback
   */
  setProgressiveSaveCallback(callback) {
    this.onProgressiveSaveCallback = callback;
  }
  
  /**
   * Gets content with LRU tracking
   * @param {string} url
   * @returns {Object|null}
   */
  getContent(url) {
    const normalizedUrl = normalizeUrl(url);
    if (this.contentMap.has(normalizedUrl)) {
      this.contentAccessOrder.set(normalizedUrl, Date.now());
      const content = this.contentMap.get(normalizedUrl);
      
      // Decompress if needed
      if (content.compressed && content.markdown) {
        try {
          return {
            ...content,
            markdown: SimpleCompressor.decompress(content.markdown),
            compressed: undefined
          };
        } catch (e) {
          console.warn('Decompression failed:', e);
          return content;
        }
      }
      return content;
    }
    return null;
  }
  
  /**
   * Evicts least recently used content to free space
   * @param {number} targetCount - Number of items to keep
   */
  evictLRUContent(targetCount) {
    if (this.contentMap.size <= targetCount) return;
    
    // Sort by access time
    const sorted = Array.from(this.contentAccessOrder.entries())
      .sort((a, b) => a[1] - b[1]);
    
    // Evict oldest items
    const toEvict = sorted.slice(0, this.contentMap.size - targetCount);
    let evictedCount = 0;
    
    for (const [url] of toEvict) {
      this.contentMap.delete(url);
      this.contentAccessOrder.delete(url);
      this.progressivelySaved.delete(url);
      evictedCount++;
    }
    
    console.log(`Evicted ${evictedCount} items to free storage space`);
    return evictedCount;
  }

  /**
   * Marks the task as having unsaved changes and schedules a debounced save
   */
  markChanged() {
    this.hasUnsavedChanges = true;

    // Clear existing debounce timer
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    // Schedule a debounced save (2 seconds after last change)
    this.saveDebounceTimer = setTimeout(() => {
      if (this.onSaveCallback && this.hasUnsavedChanges) {
        this.onSaveCallback(this);
        this.hasUnsavedChanges = false;
      }
      this.saveDebounceTimer = null;
    }, 2000);
  }

  /**
   * Sets the callback function to call when save is needed
   * @param {Function} callback - The save callback function
   */
  setSaveCallback(callback) {
    this.onSaveCallback = callback;
  }

  /**
   * Forces an immediate save if there are unsaved changes
   * @returns {boolean} Whether there were unsaved changes to save
   */
  forceSave() {
    if (this.hasUnsavedChanges && this.onSaveCallback) {
      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = null;
      }
      this.onSaveCallback(this);
      this.hasUnsavedChanges = false;
      return true;
    }
    return false;
  }

  /**
   * Converts task state to a serializable object for storage
   * @param {Object} options - Serialization options
   * @returns {Object}
   */
  toJSON(options = {}) {
    const { limitContent = false, maxContentItems = null } = options;
    
    let contentEntries = Array.from(this.contentMap.entries());
    
    // Apply content limits if needed
    if (limitContent && maxContentItems !== null) {
      // Sort by access time (most recent first)
      const sortedUrls = Array.from(this.contentAccessOrder.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxContentItems)
        .map(([url]) => url);
      
      const urlSet = new Set(sortedUrls);
      contentEntries = contentEntries.filter(([url]) => urlSet.has(url));
    }
    
    return {
      taskId: this.taskId,
      startingUrl: this.startingUrl,
      startingDomain: this.startingDomain,
      settings: this.settings,
      queue: Array.from(this.queue),
      visited: Array.from(this.visited),
      processed: this.processed,
      contentMap: contentEntries,
      contentAccessOrder: limitContent ? 
        Array.from(this.contentAccessOrder.entries()).slice(0, maxContentItems) : 
        Array.from(this.contentAccessOrder.entries()),
      compressionEnabled: this.compressionEnabled,
      progressivelySaved: Array.from(this.progressivelySaved),
    };
  }
  
  /**
   * Estimates the serialized size of the task state
   * @returns {number} Estimated size in bytes
   */
  estimateSize() {
    try {
      const data = this.toJSON();
      return JSON.stringify(data).length;
    } catch (e) {
      console.warn('Failed to estimate task size:', e);
      return 0;
    }
  }

  /**
   * Validates task data structure
   * @param {any} data - The data to validate
   * @returns {boolean} Whether the data is valid
   */
  static validateTaskData(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Required fields
    if (typeof data.taskId !== 'number' && typeof data.taskId !== 'string') {
      return false;
    }
    if (typeof data.startingUrl !== 'string') {
      return false;
    }
    if (!data.settings || typeof data.settings !== 'object') {
      return false;
    }

    // Optional but validated fields
    if (data.queue && !Array.isArray(data.queue)) {
      return false;
    }
    if (data.visited && !Array.isArray(data.visited)) {
      return false;
    }
    if (data.processed && typeof data.processed !== 'number') {
      return false;
    }
    if (data.contentMap && !Array.isArray(data.contentMap)) {
      return false;
    }

    // Validate settings structure
    const { settings } = data;
    if (settings.concurrency !== undefined && typeof settings.concurrency !== 'number') {
      return false;
    }
    if (settings.maxPages !== undefined && typeof settings.maxPages !== 'number') {
      return false;
    }
    if (settings.delay !== undefined && typeof settings.delay !== 'number') {
      return false;
    }
    if (settings.crawlMode !== undefined && typeof settings.crawlMode !== 'boolean') {
      return false;
    }

    return true;
  }

  /**
   * Sanitizes task data to safe defaults
   * @param {Object} data - The data to sanitize
   * @returns {Object} Sanitized data
   */
  static sanitizeTaskData(data) {
    const sanitized = {
      taskId: data.taskId,
      startingUrl: data.startingUrl,
      settings: {
        concurrency: Math.max(
          1,
          Math.min(
            data.settings.concurrency || CONFIG.DEFAULTS.CONCURRENCY,
            CONFIG.LIMITS.MAX_CONCURRENCY
          )
        ),
        maxPages: Math.max(
          1,
          Math.min(data.settings.maxPages || CONFIG.DEFAULTS.MAX_PAGES, CONFIG.LIMITS.MAX_PAGES)
        ),
        delay: Math.max(0, data.settings.delay || CONFIG.DEFAULTS.DELAY),
        crawlMode: Boolean(data.settings.crawlMode ?? CONFIG.DEFAULTS.CRAWL_MODE),
        copyToClipboard: Boolean(
          data.settings.copyToClipboard ?? CONFIG.DEFAULTS.COPY_TO_CLIPBOARD
        ),
        downloadFile: Boolean(data.settings.downloadFile ?? CONFIG.DEFAULTS.DOWNLOAD_FILE),
      },
      queue: Array.isArray(data.queue) ? data.queue.filter((url) => typeof url === 'string') : [],
      visited: Array.isArray(data.visited)
        ? data.visited.filter((url) => typeof url === 'string')
        : [],
      processed: Math.max(0, Math.min(data.processed || 0, CONFIG.LIMITS.MAX_PAGES)),
      contentMap: Array.isArray(data.contentMap)
        ? data.contentMap.filter(
            (entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string'
          )
        : [],
    };

    return sanitized;
  }

  /**
   * Creates a TaskState from a stored object with validation
   * @param {Object} data - The stored task data
   * @returns {TaskState|null} TaskState instance or null if invalid
   */
  static fromJSON(data) {
    try {
      let validatedData = data;

      // Validate the data structure
      if (!TaskState.validateTaskData(validatedData)) {
        console.warn('Invalid task data structure, attempting to sanitize');

        // Try to sanitize the data
        try {
          validatedData = TaskState.sanitizeTaskData(validatedData);
        } catch (sanitizeError) {
          console.error('Failed to sanitize task data:', sanitizeError);
          return null;
        }
      }

      const task = new TaskState(
        validatedData.taskId,
        validatedData.startingUrl,
        validatedData.settings
      );

      // Safely restore arrays and sets
      task.queue = Array.isArray(validatedData.queue) ? [...validatedData.queue] : [];
      task.visited = new Set(Array.isArray(validatedData.visited) ? validatedData.visited : []);
      task.processed = Math.max(0, parseInt(validatedData.processed) || 0);

      // Safely restore contentMap
      if (Array.isArray(validatedData.contentMap)) {
        task.contentMap = new Map();
        for (const entry of validatedData.contentMap) {
          if (Array.isArray(entry) && entry.length === 2) {
            const [url, content] = entry;
            if (typeof url === 'string' && content) {
              task.contentMap.set(url, content);
            }
          }
        }
      }
      
      // Restore content access order
      if (Array.isArray(validatedData.contentAccessOrder)) {
        task.contentAccessOrder = new Map(validatedData.contentAccessOrder);
      } else {
        // Initialize with current time for all existing content
        task.contentAccessOrder = new Map();
        for (const url of task.contentMap.keys()) {
          task.contentAccessOrder.set(url, Date.now());
        }
      }
      
      // Restore compression and progressive save state
      task.compressionEnabled = validatedData.compressionEnabled !== false;
      task.progressivelySaved = new Set(
        Array.isArray(validatedData.progressivelySaved) ? validatedData.progressivelySaved : []
      );

      return task;
    } catch (error) {
      console.error('Failed to restore task from JSON:', error);
      return null;
    }
  }
}
