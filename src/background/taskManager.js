import { TaskState } from './taskState.js';
import { CONFIG } from '../shared/config.js';
import { SafeChromeAPI } from '../shared/safeChromeAPI.js';

/**
 * Manages all scraping tasks
 */
export class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.subscribers = new Map();
  }

  /**
   * Creates a new task
   * @param {number} tabId - The tab ID
   * @param {string} url - The starting URL
   * @param {Object} settings - Task settings
   * @returns {TaskState} - The created task
   */
  createTask(tabId, url, settings) {
    if (this.tasks.has(tabId)) {
      throw new Error('Task already exists for this tab');
    }

    const task = new TaskState(tabId, url, settings);
    this.tasks.set(tabId, task);

    // Set up debounced save callback
    task.setSaveCallback((taskToSave) => {
      this.saveTaskState(taskToSave);
    });
    
    // Set up progressive save callback
    task.setProgressiveSaveCallback((taskId, newContent) => {
      this.saveProgressiveContent(taskId, newContent);
    });
    
    // Check storage quota on task creation
    this.checkStorageQuota();

    return task;
  }

  /**
   * Gets a task by ID
   * @param {number} taskId - The task ID
   * @returns {TaskState|null}
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Removes a task
   * @param {number} taskId - The task ID
   */
  removeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      // Force save any pending changes before removal
      task.forceSave();
      this.tasks.delete(taskId);
    }
  }

  /**
   * Gets all active tasks
   * @returns {Array<TaskState>}
   */
  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  /**
   * Subscribes to task updates
   * @param {number} taskId - The task ID
   * @param {Object} port - The message port
   */
  subscribe(taskId, port) {
    if (!this.subscribers.has(taskId)) {
      this.subscribers.set(taskId, new Set());
    }
    this.subscribers.get(taskId).add(port);
  }

  /**
   * Unsubscribes from task updates
   * @param {Object} port - The message port
   */
  unsubscribe(port) {
    for (const ports of this.subscribers.values()) {
      ports.delete(port);
    }
  }

  /**
   * Sends a status update to all subscribers
   * @param {number} taskId - The task ID
   * @param {Object} data - The status data
   */
  sendStatus(taskId, data) {
    if (!this.subscribers.has(taskId)) {
      return;
    }

    const ports = this.subscribers.get(taskId);
    const deadPorts = [];

    for (const port of ports) {
      try {
        port.postMessage(data);
      } catch (e) {
        // Mark for removal
        deadPorts.push(port);
      }
    }

    // Clean up dead ports
    for (const port of deadPorts) {
      ports.delete(port);
    }

    // Remove taskId entry if no subscribers left
    if (ports.size === 0) {
      this.subscribers.delete(taskId);
    }
  }

  /**
   * Saves task state to storage with quota handling
   * @param {TaskState} task - The task to save
   */
  async saveTaskState(task) {
    // Check storage quota before saving
    const quotaStatus = await this.checkStorageQuota();
    
    let saveOptions = {};
    
    // If storage is getting full, limit what we save
    if (quotaStatus.percentage > 80) {
      // Only save most recent content when approaching limit
      const maxItems = Math.max(50, Math.floor((100 - quotaStatus.percentage) * 5));
      saveOptions = { limitContent: true, maxContentItems: maxItems };
      
      if (!task.storageWarningIssued) {
        this.sendStatus(task.taskId, {
          status: 'Storage usage high',
          debug: `Storage ${quotaStatus.percentage}% full. Keeping only ${maxItems} most recent pages.`,
        });
        task.storageWarningIssued = true;
      }
    }
    
    const key = `${CONFIG.STORAGE_KEYS.TASK_PREFIX}${task.taskId}`;
    const data = task.toJSON(saveOptions);

    try {
      await SafeChromeAPI.storage('set', { [key]: data });
    } catch (e) {
      console.error(`Failed to save task state: ${e.message}`);

      // Check if it's a quota exceeded error
      if (e.message && e.message.includes('QUOTA_EXCEEDED')) {
        await this.handleStorageQuotaExceeded(task);
      } else {
        // Send error notification to UI
        this.sendStatus(task.taskId, {
          status: 'Storage error occurred',
          debug: `Failed to save progress: ${e.message}`,
        });
      }
    }
  }

  /**
   * Handles storage quota exceeded scenarios
   * @param {TaskState} task - The current task
   */
  async handleStorageQuotaExceeded(task) {
    this.sendStatus(task.taskId, {
      status: 'Storage quota exceeded',
      debug: 'Storage limit reached. Applying data rotation to continue...',
    });

    try {
      // First, try to evict LRU content from the task
      const evicted = task.evictLRUContent(20); // Keep only 20 most recent
      
      if (evicted > 0) {
        this.sendStatus(task.taskId, {
          debug: `Removed ${evicted} old pages to free space. Retrying save...`,
        });
        
        // Try to save with reduced content
        const data = task.toJSON({ limitContent: true, maxContentItems: 20 });
        const key = `${CONFIG.STORAGE_KEYS.TASK_PREFIX}${task.taskId}`;
        await SafeChromeAPI.storage('set', { [key]: data });
        
        this.sendStatus(task.taskId, {
          status: 'Storage recovered',
          debug: 'Successfully saved after data rotation. Continuing with limited storage.',
        });
        return;
      }
      
      // If that didn't work, try to clean up old task states
      await this.cleanupOldTaskStates();

      // Attempt to save again with minimal data
      const minimalData = task.toJSON({ limitContent: true, maxContentItems: 10 });
      const key = `${CONFIG.STORAGE_KEYS.TASK_PREFIX}${task.taskId}`;
      await SafeChromeAPI.storage('set', { [key]: minimalData });

      this.sendStatus(task.taskId, {
        debug: 'Saved with minimal data after cleanup. Consider downloading results.',
      });
    } catch (retryError) {
      this.sendStatus(task.taskId, {
        status: 'Critical storage error',
        debug: 'Unable to save progress. Download results immediately to prevent data loss.',
      });
    }
  }

  /**
   * Cleans up old task states to free storage space
   */
  async cleanupOldTaskStates() {
    try {
      const allData = await SafeChromeAPI.storage('get', null);
      const taskKeys = Object.keys(allData).filter((key) =>
        key.startsWith(CONFIG.STORAGE_KEYS.TASK_PREFIX)
      );

      // Remove old task states (keep only the most recent 3)
      if (taskKeys.length > 3) {
        const keysToRemove = taskKeys.slice(0, taskKeys.length - 3);
        await SafeChromeAPI.storage('remove', keysToRemove);
      }
    } catch (e) {
      console.warn('Failed to cleanup old task states:', e);
    }
  }

  /**
   * Gets current storage usage information
   * @returns {Promise<Object>} Storage usage stats
   */
  async getStorageUsage() {
    try {
      const usage = await SafeChromeAPI.storage('getBytesInUse');
      const quota = await SafeChromeAPI.getActualQuota();

      return {
        used: usage,
        quota,
        percentage: Math.round((usage / quota) * 100),
        available: quota - usage,
        formattedUsed: this.formatBytes(usage),
        formattedQuota: this.formatBytes(quota),
        formattedAvailable: this.formatBytes(quota - usage),
      };
    } catch (e) {
      console.warn('Failed to get storage usage:', e);
      return { 
        used: 0, 
        quota: 0, 
        percentage: 0, 
        available: 0,
        formattedUsed: '0 B',
        formattedQuota: '0 B',
        formattedAvailable: '0 B',
      };
    }
  }
  
  /**
   * Formats bytes to human readable format
   * @param {number} bytes
   * @returns {string}
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  /**
   * Checks storage quota and sends warnings
   * @returns {Promise<Object>} Storage usage stats
   */
  async checkStorageQuota() {
    const usage = await this.getStorageUsage();
    
    // Send different warnings based on usage level
    if (usage.percentage >= 95) {
      // Critical - almost full
      for (const task of this.tasks.values()) {
        this.sendStatus(task.taskId, {
          status: 'CRITICAL: Storage almost full',
          debug: `Storage ${usage.percentage}% full (${usage.formattedUsed}/${usage.formattedQuota}). Data rotation active.`,
        });
      }
    } else if (usage.percentage >= 90) {
      // Warning - getting full
      for (const task of this.tasks.values()) {
        if (!task.storageWarningIssued || Date.now() - task.lastStorageCheck > 60000) {
          this.sendStatus(task.taskId, {
            status: 'Warning: Storage nearly full',
            debug: `Storage ${usage.percentage}% full (${usage.formattedUsed}/${usage.formattedQuota}). Old pages will be removed if needed.`,
          });
          task.lastStorageCheck = Date.now();
        }
      }
    } else if (usage.percentage >= 80) {
      // Notice - monitor closely
      for (const task of this.tasks.values()) {
        if (Date.now() - task.lastStorageCheck > 120000) { // Every 2 minutes
          this.sendStatus(task.taskId, {
            debug: `Storage usage: ${usage.percentage}% (${usage.formattedUsed}/${usage.formattedQuota})`,
          });
          task.lastStorageCheck = Date.now();
        }
      }
    }
    
    return usage;
  }
  
  /**
   * Saves progressive content incrementally
   * @param {number} taskId
   * @param {Map} newContent
   */
  async saveProgressiveContent(taskId, newContent) {
    const key = `${CONFIG.STORAGE_KEYS.TASK_PREFIX}${taskId}_progressive_${Date.now()}`;
    
    try {
      // Check quota before saving
      const usage = await this.getStorageUsage();
      if (usage.percentage > 90) {
        console.warn('Storage nearly full, skipping progressive save');
        return;
      }
      
      // Convert Map to array for storage
      const data = {
        taskId,
        timestamp: Date.now(),
        content: Array.from(newContent.entries()),
      };
      
      await SafeChromeAPI.storage('set', { [key]: data });
      
      // Schedule cleanup of old progressive saves
      setTimeout(() => this.cleanupProgressiveSaves(taskId), 60000);
    } catch (e) {
      console.warn('Failed to save progressive content:', e);
    }
  }
  
  /**
   * Cleans up old progressive save chunks
   * @param {number} taskId
   */
  async cleanupProgressiveSaves(taskId) {
    try {
      const allKeys = await SafeChromeAPI.storage('get', null);
      const progressiveKeys = Object.keys(allKeys)
        .filter(key => key.startsWith(`${CONFIG.STORAGE_KEYS.TASK_PREFIX}${taskId}_progressive_`))
        .sort();
      
      // Keep only the most recent 3 progressive saves
      if (progressiveKeys.length > 3) {
        const toRemove = progressiveKeys.slice(0, progressiveKeys.length - 3);
        await SafeChromeAPI.storage('remove', toRemove);
      }
    } catch (e) {
      console.warn('Failed to cleanup progressive saves:', e);
    }
  }

  /**
   * Loads task state from storage with validation
   * @param {number} taskId - The task ID
   * @returns {Promise<TaskState|null>}
   */
  async loadTaskState(taskId) {
    const key = `${CONFIG.STORAGE_KEYS.TASK_PREFIX}${taskId}`;

    try {
      const result = await SafeChromeAPI.storage('get', key);
      if (result[key]) {
        const task = TaskState.fromJSON(result[key]);

        if (!task) {
          // If restoration failed, clean up the corrupted data
          console.warn(`Corrupted task data for ${taskId}, cleaning up`);
          await this.clearTaskState(taskId);
        }

        return task;
      }
    } catch (e) {
      console.error(`Failed to load task state: ${e.message}`);

      // If there's a parsing error, clean up the corrupted data
      try {
        await this.clearTaskState(taskId);
      } catch (cleanupError) {
        console.warn('Failed to cleanup corrupted task state:', cleanupError);
      }
    }

    return null;
  }

  /**
   * Clears saved task state
   * @param {number} taskId - The task ID
   */
  async clearTaskState(taskId) {
    const key = `${CONFIG.STORAGE_KEYS.TASK_PREFIX}${taskId}`;

    try {
      await SafeChromeAPI.storage('remove', key);
    } catch (e) {
      console.error(`Failed to clear task state: ${e}`);
    }
  }

  /**
   * Cleans up a task completely
   * @param {number} taskId - The task ID
   */
  async cleanupTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) {
      return;
    }

    // Mark as aborted
    task.abort = true;

    // Force save any final changes before cleanup
    task.forceSave();

    // Close all tabs
    await this.closeAllTabs(task);

    // Clear saved state
    await this.clearTaskState(taskId);

    // Remove from manager
    this.removeTask(taskId);

    // Clear subscribers
    this.subscribers.delete(taskId);
  }

  /**
   * Closes all tabs associated with a task
   * @param {TaskState} task - The task
   */
  async closeAllTabs(task) {
    const closePromises = [];

    for (const tabId of task.tabIds) {
      closePromises.push(
        SafeChromeAPI.tabs('remove', tabId).catch((e) => {
          console.warn(`Failed to close tab ${tabId}: ${e}`);
        })
      );
    }

    await Promise.all(closePromises);
    task.tabIds.clear();
  }
}
