import { TaskManager } from './taskManager.js';
import { PageScraper } from './scraper.js';
import { MarkdownBuilder } from './markdownBuilder.js';
import { isValidUrl, generateFilename } from '../shared/utils.js';
import { SafeChromeAPI } from '../shared/safeChromeAPI.js';
import { QueueManager } from './queueManager.js';

// Service Worker Keepalive Mechanism
// Prevents service worker from being terminated during long operations
chrome.alarms.create('serviceWorkerKeepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'serviceWorkerKeepalive') {
    // Simple keepalive - just acknowledge the alarm
    // This prevents the service worker from being terminated
    console.debug('Service worker keepalive ping');
  }
});

// Initialize managers
const taskManager = new TaskManager();
const scraper = new PageScraper(taskManager);

// Initialize queue manager with enhanced features
const queueManager = new QueueManager({
  enablePriorityProcessing: true,
  enableAdaptiveConcurrency: true,
  baseConcurrency: 5,
  enablePerformanceMonitoring: true,
  maxQueueSize: 500
});

/**
 * Enhanced task queue processing with intelligent scheduling and priority management
 * @param {TaskState} task - The task
 */
async function processTaskQueue(task) {
  taskManager.sendStatus(task.taskId, {
    debug: `🔥 DEBUG: processTaskQueue() called for task ${task.taskId}`,
  });

  if (task.abort) {
    taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: Task ${task.taskId} already aborted, exiting`,
    });
    return;
  }

  try {
    taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: About to populate queue from task`,
    });

    // Initialize queue with all URLs from the task
    await populateQueueFromTask(task);
    
    taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: Queue populated, setting up processing function`,
    });
    
    // Process the queue with intelligent scheduling
    const processingFunction = async (url, metadata) => {
      taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG: Processing URL: ${url}`,
      });
      
      if (task.abort) {
        throw new Error('Task aborted');
      }
      
      return await scraper.scrapePage(task, url);
    };

    taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: About to start enhanced queue processing`,
    });

    // Use enhanced queue processing
    await processEnhancedTaskQueue(task, processingFunction);

    taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: Queue processing complete, checking if task should finish`,
    });

    // Check if task is complete (atomic completion check)
    if (task.markAsFinishing()) {
      taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG [${new Date().toLocaleTimeString()}]: Task marked as finishing, calling finishTask()`,
      });
      await finishTask(task);
    } else {
      taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG [${new Date().toLocaleTimeString()}]: Task not ready to finish yet - processed:${task.processed}, inProgress:${task.inProgress}, queueSize:${task.queue.length}, maxPages:${task.settings.maxPages}`,
      });
    }
  } catch (error) {
    console.error('Error in enhanced task queue processing:', error);
    taskManager.sendStatus(task.taskId, {
      status: 'Error processing task queue',
      debug: `🔥 DEBUG: ERROR in processTaskQueue: ${error.message}`,
    });
  }
}

/**
 * Populate queue manager with URLs from task
 * @param {TaskState} task - The task state
 */
async function populateQueueFromTask(task) {
  taskManager.sendStatus(task.taskId, {
    debug: `🔥 DEBUG [${new Date().toLocaleTimeString()}]: populateQueueFromTask() - clearing queue`,
  });

  // Clear queue for this task
  queueManager.clear();
  
  taskManager.sendStatus(task.taskId, {
    debug: `🔥 DEBUG: Queue cleared, task.queue.length=${task.queue.length}`,
  });
  
  let urlCount = 0;
  // Add URLs to queue - don't use canSchedule() since we're moving URLs to queueManager
  while (task.queue.length > 0 && !task.abort) {
    const nextUrl = task.getNextUrl();
    if (!nextUrl) {
      taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG: task.getNextUrl() returned null, breaking loop`,
      });
      break;
    }

    // Determine priority based on URL characteristics and task state
    const metadata = {
      taskId: task.taskId,
      depth: task.getUrlDepth ? task.getUrlDepth(nextUrl) : 0,
      isUserInitiated: task.processed === 0, // First URL is user-initiated
    };

    taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: Adding URL to queue: ${nextUrl} (depth: ${metadata.depth})`,
    });

    queueManager.enqueue(nextUrl, metadata);
    urlCount++;
  }
  
  taskManager.sendStatus(task.taskId, {
    debug: `🔥 DEBUG: populateQueueFromTask() complete - added ${urlCount} URLs to queue`,
  });
  
  taskManager.sendStatus(task.taskId, {
    debug: `🔥 DEBUG: Queue size: ${queueManager.priorityQueue.size}, task.queue.length: ${task.queue.length}`,
  });
}

/**
 * Process task queue using enhanced queue manager
 * @param {TaskState} task - The task state
 * @param {Function} processingFunction - Function to process each URL
 */
async function processEnhancedTaskQueue(task, processingFunction) {
  const maxIdleTime = 100;
  let consecutiveIdleCycles = 0;
  const maxIdleCycles = 50; // Prevent infinite loops
  
  taskManager.sendStatus(task.taskId, {
    debug: `🔥 DEBUG: processEnhancedTaskQueue() starting main loop`,
  });
  
  let loopIteration = 0;
  while (!task.abort && (queueManager.priorityQueue.size > 0 || queueManager.activeRequests.size > 0 || task.hasActiveScraping() || task.queue.length > 0)) {
    loopIteration++;
    taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG [${new Date().toLocaleTimeString()}]: Loop iteration ${loopIteration}: queueMgr=${queueManager.priorityQueue.size}, active=${queueManager.activeRequests.size}, hasActiveScraping=${task.hasActiveScraping()}, taskQueue=${task.queue.length}`,
    });
    
    let processedAnyItems = false;
    
    // Try to start new requests using queue manager
    let requestAttempts = 0;
    while (true) {
      requestAttempts++;
      const nextRequest = queueManager.getNextItem();
      if (!nextRequest) {
        taskManager.sendStatus(task.taskId, {
          debug: `🔥 DEBUG: queueManager.getNextItem() returned null after ${requestAttempts} attempts`,
        });
        break; // No more items available right now
      }

      taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG: Got next request: ${nextRequest.url}`,
      });

      // For enhanced queue processing, check different conditions than canSchedule()
      // since we've moved URLs out of task.queue into queueManager
      const canProcess = (
        !task.abort &&
        task.inProgress < task.settings.concurrency &&
        task.processed + task.inProgress < task.settings.maxPages
      );
      
      taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG [${new Date().toLocaleTimeString()}]: canProcess check - abort:${!task.abort}, inProgress:${task.inProgress}<${task.settings.concurrency}, maxPages:${task.processed}+${task.inProgress}<${task.settings.maxPages}`,
      });
      
      if (!canProcess) {
        taskManager.sendStatus(task.taskId, {
          debug: `🔥 DEBUG: Cannot process request - abort:${task.abort}, inProgress:${task.inProgress}<${task.settings.concurrency}, processed:${task.processed}+${task.inProgress}<${task.settings.maxPages}`,
        });
        // Put the item back in queue
        queueManager.priorityQueue.enqueue(nextRequest.item, nextRequest.item.priority);
        break;
      }

      taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG: Starting processing function for ${nextRequest.url}`,
      });

      // Start processing with queue manager tracking
      const promise = processingFunction(nextRequest.url, nextRequest.metadata);
      queueManager.markRequestStarted(nextRequest, promise);
      processedAnyItems = true;
      
      taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG: Request started for ${nextRequest.url}`,
      });
    }

    // Add newly discovered URLs to queue if any
    await addNewUrlsToQueue(task);

    // Wait for completion if we have active requests
    if (queueManager.activeRequests.size > 0) {
      const promises = Array.from(queueManager.activeRequests.values()).map(req => req.promise);
      await Promise.race(promises);
      processedAnyItems = true;
      consecutiveIdleCycles = 0;
    } else if (queueManager.priorityQueue.size > 0 || task.hasActiveScraping()) {
      // Queue has items but we can't process them yet, or task has other active scraping
      await new Promise((resolve) => setTimeout(resolve, maxIdleTime));
      consecutiveIdleCycles++;
      
      if (consecutiveIdleCycles > maxIdleCycles) {
        console.warn('ProcessTaskQueue: Breaking due to excessive idle cycles');
        break;
      }
    } else {
      // Nothing left to process
      break;
    }
    
    if (processedAnyItems) {
      consecutiveIdleCycles = 0;
    }
  }

  // Log queue statistics for debugging
  const stats = queueManager.getStats();
  console.debug('Enhanced task queue completed:', stats);
}

/**
 * Add newly discovered URLs from task to queue
 * @param {TaskState} task - The task state
 */
async function addNewUrlsToQueue(task) {
  let addedUrls = 0;
  
  // Don't use canSchedule() - just check if we have URLs and aren't aborting
  while (task.queue.length > 0 && !task.abort && addedUrls < 10) { // Limit to prevent infinite loops
    const nextUrl = task.getNextUrl();
    if (!nextUrl) {
      break;
    }

    const metadata = {
      taskId: task.taskId,
      depth: task.getUrlDepth ? task.getUrlDepth(nextUrl) : (task.processed > 0 ? 1 : 0),
      isUserInitiated: false,
    };

    if (queueManager.enqueue(nextUrl, metadata)) {
      addedUrls++;
      taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG [${new Date().toLocaleTimeString()}]: Added new URL to queue: ${nextUrl}`,
      });
    }
  }
  
  if (addedUrls > 0) {
    taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: Added ${addedUrls} new URLs to queue`,
    });
  }
}

/**
 * Legacy task queue processing (fallback)
 * @param {TaskState} task - The task
 */
async function processTaskQueueLegacy(task) {
  if (task.abort) {
    return;
  }

  try {
    while (!task.abort && (task.canSchedule() || task.hasActiveScraping())) {
      // Use a Set to track active promises and prevent memory leaks
      const activePromises = new Set();

      while (task.canSchedule() && activePromises.size < task.settings.concurrency) {
        const nextUrl = task.getNextUrl();
        if (!nextUrl) {
          break;
        }

        const promise = scraper.scrapePage(task, nextUrl);
        activePromises.add(promise);
        
        // CRITICAL FIX: Remove promise from set when it completes to prevent memory leak
        promise.finally(() => {
          activePromises.delete(promise);
        });
      }

      // Wait for at least one scraping operation to complete if we have any active
      if (activePromises.size > 0) {
        await Promise.race(Array.from(activePromises));
        // No manual clearing needed - promises remove themselves via .finally()
      } else if (task.hasActiveScraping()) {
        // Wait a bit if there are active scraping operations but we can't start new ones
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else {
        // No active scraping and can't start new ones - we're done
        break;
      }
    }

    // Check if task is complete (atomic completion check)
    if (task.markAsFinishing()) {
      await finishTask(task);
    }
  } catch (error) {
    console.error('Error in task queue processing:', error);
    taskManager.sendStatus(task.taskId, {
      status: 'Error processing task queue',
      debug: error.message,
    });
  }
}

/**
 * Finishes a task and generates output
 * @param {TaskState} task - The task
 */
async function finishTask(task) {
  taskManager.sendStatus(task.taskId, {
    status: 'Generating output...',
    processed: task.processed,
    total: task.processed,
    debug: 'Finalizing output...',
  });

  // Build markdown
  const builder = new MarkdownBuilder();
  builder.addFromContentMap(task.contentMap);
  const content = builder.build();
  const stats = builder.getStats();

  taskManager.sendStatus(task.taskId, {
    debug: `Generated markdown: ${stats.pageCount} pages, ${stats.totalCharacters} characters`,
  });

  // Copy to clipboard if requested
  if (task.settings.copyToClipboard) {
    await copyToClipboard(content);
  }

  // Download file if requested
  if (task.settings.downloadFile) {
    await downloadFile(task.startingDomain, content);
  }

  // Send completion message
  taskManager.sendStatus(task.taskId, {
    done: true,
    copyToClipboard: task.settings.copyToClipboard,
    content,
  });

  // Mark as completely finished
  task.markAsFinished();

  // Cleanup
  await taskManager.cleanupTask(task.taskId);
}

/**
 * Copies content to clipboard using multiple methods
 * @param {string} text - Text to copy
 */
async function copyToClipboard(text) {
  const methods = [];
  let success = false;

  // Try to inject into active tab and copy
  try {
    const [activeTab] = await SafeChromeAPI.tabs('query', { active: true, currentWindow: true });
    if (activeTab) {
      await SafeChromeAPI.scripting('executeScript', {
        target: { tabId: activeTab.id },
        func: (content) => {
          const textarea = document.createElement('textarea');
          textarea.value = content;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          return true;
        },
        args: [text],
      });
      methods.push('Copied via active tab');
      success = true;
    }
  } catch (e) {
    methods.push(`Active tab method failed: ${e.message}`);
  }

  // Method 3: Offscreen document (future enhancement)
  if (!success && chrome.offscreen) {
    methods.push('Offscreen API available - future enhancement');
  }

  taskManager.sendStatus(undefined, {
    debug: `Clipboard attempts: ${methods.join('; ')}`,
  });

  return success;
}

/**
 * Downloads content as a file using multiple methods
 * @param {string} domain - The domain name
 * @param {string} content - The content to download
 */
async function downloadFile(domain, content) {
  const filename = generateFilename(domain);
  const methods = [];
  let success = false;

  // Method 1: Try blob URL download (more reliable than data URL)
  try {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    const downloadId = await SafeChromeAPI.downloads('download', {
      url: blobUrl,
      filename,
      saveAs: false,
    });

    methods.push(`Download initiated: ID=${downloadId}`);
    success = true;

    // Clean up blob URL after a delay
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (e) {
    methods.push(`Blob download failed: ${e.message}`);
  }

  // Method 2: Try data URL download
  if (!success) {
    try {
      const dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;

      const downloadId = await SafeChromeAPI.downloads('download', {
        url: dataUrl,
        filename,
        saveAs: false,
      });

      methods.push(`Data URL download: ID=${downloadId}`);
      success = true;
    } catch (e) {
      methods.push(`Data URL download failed: ${e.message}`);
    }
  }

  // Method 3: Open as data URL in new tab (last resort)
  if (!success) {
    try {
      const dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;
      await SafeChromeAPI.tabs('create', { url: dataUrl, active: false });
      methods.push('Opened as data URL in new tab');
      success = true;
    } catch (e) {
      methods.push(`Tab creation failed: ${e.message}`);
    }
  }

  taskManager.sendStatus(undefined, {
    debug: `Download attempts: ${methods.join('; ')}`,
  });

  return success;
}

// Message handlers with debugging
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('🔥 [BACKGROUND] RAW MESSAGE RECEIVED:', {
    message: message,
    sender: _sender,
    timestamp: Date.now()
  });
  
  handleMessage(message, _sender, sendResponse);
  return true; // Indicate that we will respond asynchronously
});

/**
 * Validates incoming message structure
 * @param {Object} message - The message to validate
 * @returns {boolean} Whether the message is valid
 */
function validateMessage(message) {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.action === 'start') {
    return (
      typeof message.tabId === 'number' &&
      typeof message.startingUrl === 'string' &&
      message.settings &&
      typeof message.settings === 'object'
    );
  }

  if (message.action === 'stop') {
    return typeof message.tabId === 'number';
  }

  if (message.content || message.skip) {
    return typeof message.taskId === 'number' && typeof message.url === 'string';
  }
  
  // Validate auth wall messages
  if (message.authWall) {
    return typeof message.taskId === 'number' && 
           typeof message.url === 'string' &&
           typeof message.authType === 'string';
  }
  
  // Validate test messages
  if (message.test) {
    return true; // Allow all test messages
  }
  
  // Validate ping messages
  if (message.action === 'ping') {
    return true;
  }

  // Allow messages with taskId and url (our content script messages)
  if (message.taskId && message.url) {
    return typeof message.taskId === 'number' && typeof message.url === 'string';
  }

  return false;
}

/**
 * Sanitizes user settings to safe values
 * @param {Object} settings - Raw settings from user
 * @returns {Object} Sanitized settings
 */
function sanitizeSettings(settings) {
  return {
    concurrency: Math.max(1, Math.min(parseInt(settings.concurrency) || 10, 15)),
    maxPages: Math.max(1, Math.min(parseInt(settings.maxPages) || 1000, 1000)),
    delay: Math.max(0, parseInt(settings.delay) || 0),
    crawlMode: Boolean(settings.crawlMode),
    copyToClipboard: Boolean(settings.copyToClipboard),
    downloadFile: Boolean(settings.downloadFile),
  };
}

/**
 * Handles incoming messages
 * @param {Object} message - The message
 * @param {Object} sender - The sender
 * @param {Function} sendResponse - Response callback
 */
async function handleMessage(message, _sender, sendResponse) {
  console.log('🔥 [BACKGROUND] HANDLING MESSAGE:', {
    action: message.action,
    hasContent: !!message.content,
    hasTest: !!message.test,
    keys: Object.keys(message),
    messageType: typeof message
  });
  
  // Validate message structure
  if (!validateMessage(message)) {
    console.warn('🔥 [BACKGROUND] INVALID MESSAGE:', message);
    sendResponse({ success: false, error: 'Invalid message format' });
    return;
  }

  // Handle start action
  if (message.action === 'start') {
    const { tabId, startingUrl } = message;
    const settings = sanitizeSettings(message.settings);

    // Validate URL format and protocol
    if (!isValidUrl(startingUrl)) {
      taskManager.sendStatus(tabId, {
        status: 'Invalid starting URL: not HTTP or HTTPS.',
      });
      sendResponse({ success: false, error: 'Invalid starting URL: not HTTP or HTTPS.' });
      return;
    }

    // Additional URL validation
    try {
      const url = new URL(startingUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Invalid protocol');
      }
      // Prevent localhost and private IP ranges for security
      if (
        url.hostname === 'localhost' ||
        url.hostname.startsWith('127.') ||
        url.hostname.startsWith('192.168.') ||
        url.hostname.startsWith('10.')
      ) {
        taskManager.sendStatus(tabId, {
          status: 'Private/local URLs are not allowed for security reasons.',
        });
        sendResponse({ success: false, error: 'Private/local URLs are not allowed for security reasons.' });
        return;
      }
    } catch (e) {
      taskManager.sendStatus(tabId, {
        status: 'Invalid URL format.',
      });
      sendResponse({ success: false, error: 'Invalid URL format.' });
      return;
    }

    // Check if task already exists
    if (taskManager.getTask(tabId)) {
      taskManager.sendStatus(tabId, {
        status: 'Task already running.',
      });
      sendResponse({ success: false, error: 'Task already running.' });
      return;
    }

    // Create task with sanitized settings
    const task = taskManager.createTask(tabId, startingUrl, settings);
    taskManager.sendStatus(tabId, {
      status: 'Starting...',
    });

    // Reset content filter for new task
    if (scraper.contentFilter) {
      scraper.contentFilter.reset();
    }

    // Start scraping
    taskManager.sendStatus(tabId, {
      debug: `🔥 DEBUG: Starting task processing for ${startingUrl}`,
    });
    
    taskManager.sendStatus(tabId, {
      debug: `🔥 DEBUG: Task settings - concurrency:${settings.concurrency}, maxPages:${settings.maxPages}, crawlMode:${settings.crawlMode}`,
    });
    
    processTaskQueue(task);
    
    // Send success response
    sendResponse({ success: true, message: 'Task started successfully' });
  }

  // Handle stop action
  else if (message.action === 'stop') {
    const task = taskManager.getTask(message.tabId);
    if (task) {
      taskManager.sendStatus(message.tabId, {
        debug: 'Stop requested by user.',
      });
      task.abort = true;
      task.queue = [];

      // Emergency cleanup of tabs before task cleanup
      await scraper.emergencyCleanup(task);
      await taskManager.cleanupTask(message.tabId);
      
      sendResponse({ success: true, message: 'Task stopped successfully' });
    } else {
      sendResponse({ success: false, error: 'No active task found' });
    }
  }

  // Handle content from content script
  else if (message.content || message.skip) {
    const task = taskManager.getTask(message.taskId);
    if (task) {
      scraper.processPageContent(task, message);
      sendResponse({ success: true, message: 'Content processed' });
    } else {
      sendResponse({ success: false, error: 'Task not found for content processing' });
    }
  }
  
  // Handle ping messages for extension reload detection
  else if (message.action === 'ping') {
    sendResponse({ success: true, message: 'Background script is active' });
  }
  
  // Handle test messages from simple script injection
  else if (message.test) {
    console.log('[BACKGROUND] ✅ RECEIVED TEST MESSAGE:', message);
    const response = { 
      success: true, 
      message: 'Test message received successfully',
      receivedAt: Date.now(),
      echo: message
    };
    console.log('[BACKGROUND] ✅ SENDING RESPONSE:', response);
    sendResponse(response);
  }
  
  // Handle content messages that don't match exact format
  else if (message.taskId && message.url && message.content) {
    console.log('[BACKGROUND] ✅ RECEIVED CONTENT MESSAGE:', {
      taskId: message.taskId,
      url: message.url,
      contentLength: message.content ? message.content.length : 0,
      linkCount: message.links ? message.links.length : 0
    });
    
    const task = taskManager.getTask(message.taskId);
    if (task) {
      scraper.processPageContent(task, message);
      sendResponse({ success: true, message: 'Content processed successfully' });
    } else {
      console.warn('[BACKGROUND] Task not found for content message:', message.taskId);
      sendResponse({ success: false, error: 'Task not found for content processing' });
    }
  }
  
  // Handle any other message types
  else {
    console.log('[BACKGROUND] 🚫 UNKNOWN MESSAGE TYPE:', message);
    sendResponse({ success: false, error: 'Unknown message action' });
  }
}

// Port connection handlers
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    port.onMessage.addListener((msg) => {
      // Validate port message
      if (
        msg &&
        typeof msg === 'object' &&
        msg.action === 'subscribe' &&
        typeof msg.tabId === 'number'
      ) {
        taskManager.subscribe(msg.tabId, port);
      } else {
        console.warn('Invalid port message received:', msg);
      }
    });

    port.onDisconnect.addListener(() => {
      taskManager.unsubscribe(port);
    });
  }
});

// Handle extension startup - check for interrupted tasks
chrome.runtime.onStartup.addListener(async () => {
  // Task recovery will be implemented in future version
});
