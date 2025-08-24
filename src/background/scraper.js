import { CONFIG } from '../shared/config.js';
import { 
  normalizeUrl, 
  delay, 
  isValidUrl, 
  hasExcludedExtension,
  usesSPAHashRouting,
  getSPANavigationDelay 
} from '../shared/utils.js';
import { ContentFilter } from '../shared/contentFilter.js';
import { SafeChromeAPI } from '../shared/safeChromeAPI.js';
import { URLManager } from './urlManager.js';

/**
 * Robust tab manager with memory leak prevention
 */
class RobustTabManager {
  constructor() {
    this.activeTabs = new Map(); // Track tab info and cleanup timers
    this.globalRemovalListener = null;
    this.setupGlobalListener();
  }
  
  /**
   * Sets up a single global listener instead of per-tab listeners
   */
  setupGlobalListener() {
    // Single global listener prevents memory leaks from multiple listeners
    this.globalRemovalListener = (tabId) => {
      if (this.activeTabs.has(tabId)) {
        const tabInfo = this.activeTabs.get(tabId);
        if (tabInfo.cleanup) {
          clearTimeout(tabInfo.cleanup);
        }
        this.activeTabs.delete(tabId);
      }
    };
    
    // Use SafeChromeAPI to handle cases where tabs API might not be available
    if (chrome?.tabs?.onRemoved) {
      chrome.tabs.onRemoved.addListener(this.globalRemovalListener);
    }
  }

  /**
   * Creates a managed tab with automatic cleanup and error handling
   * @param {string} url - URL to load
   * @returns {Promise<Object>} Tab object
   */
  async createManagedTab(url) {
    try {
      const tab = await SafeChromeAPI.tabs('create', { url, active: false });
      
      // Store tab info with cleanup timer
      this.activeTabs.set(tab.id, {
        created: Date.now(),
        url: url,
        cleanup: setTimeout(() => {
          this.forceCleanup(tab.id);
        }, 120000) // Force cleanup after 2 minutes
      });
      
      return tab;
    } catch (error) {
      console.error('Tab creation failed:', error);
      throw error;
    }
  }

  /**
   * Safely removes a managed tab with comprehensive cleanup
   * @param {number} tabId - Tab ID to remove
   */
  async removeManagedTab(tabId) {
    const tabInfo = this.activeTabs.get(tabId);
    if (tabInfo) {
      // Clear cleanup timer
      if (tabInfo.cleanup) {
        clearTimeout(tabInfo.cleanup);
      }
      this.activeTabs.delete(tabId);
    }

    // Attempt tab removal with SafeChromeAPI error handling
    try {
      await SafeChromeAPI.tabs('remove', tabId);
    } catch (error) {
      // Tab already closed, browser crash, or API unavailable - not critical errors
      console.debug(`Tab ${tabId} removal handled gracefully:`, error.message);
    }
  }
  
  /**
   * Force cleanup for tabs that have been open too long
   * @param {number} tabId - Tab ID to force cleanup
   */
  async forceCleanup(tabId) {
    console.warn(`Force cleaning up tab ${tabId} due to timeout`);
    await this.removeManagedTab(tabId);
  }

  /**
   * Emergency cleanup of all managed tabs with comprehensive cleanup
   */
  async cleanupAllTabs() {
    const tabsToCleanup = Array.from(this.activeTabs.keys());
    const cleanupPromises = tabsToCleanup.map((tabId) => this.removeManagedTab(tabId));

    // Wait for all cleanup operations with timeout
    try {
      await Promise.allSettled(cleanupPromises);
    } catch (e) {
      console.warn('Error during emergency tab cleanup:', e);
    }
    
    // Ensure all timers are cleared
    for (const [tabId, tabInfo] of this.activeTabs.entries()) {
      if (tabInfo.cleanup) {
        clearTimeout(tabInfo.cleanup);
      }
    }
    this.activeTabs.clear();
  }
  
  /**
   * Cleanup method to be called when service worker terminates
   */
  cleanup() {
    // Remove global listener to prevent memory leaks
    if (this.globalRemovalListener && chrome?.tabs?.onRemoved) {
      chrome.tabs.onRemoved.removeListener(this.globalRemovalListener);
    }
    
    // Clear all timers and tabs
    for (const [tabId, info] of this.activeTabs.entries()) {
      if (info.cleanup) {
        clearTimeout(info.cleanup);
      }
      // Attempt graceful tab closure
      this.removeManagedTab(tabId).catch(() => {});
    }
    
    this.activeTabs.clear();
    this.globalRemovalListener = null;
  }
}

/**
 * Handles page scraping operations
 */
export class PageScraper {
  constructor(taskManager) {
    this.taskManager = taskManager;
    this.contentFilter = CONFIG.CONTENT_FILTERING?.ENABLED ? new ContentFilter() : null;
    this.tabManager = new RobustTabManager();
    
    // Initialize URL manager for performance optimizations
    this.urlManager = new URLManager({
      enableDeduplication: true,
      enableCaching: true,
      enablePerformanceMonitoring: true,
      cacheTTL: 5 * 60 * 1000, // 5 minutes
      maxCacheSize: 50
    });
  }

  /**
   * Scrapes a single page with URL deduplication and caching
   * @param {TaskState} task - The task state
   * @param {string} url - The URL to scrape
   * @returns {Promise<boolean>} - Whether scraping was successful
   */
  async scrapePage(task, url) {
    this.taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG [${new Date().toLocaleTimeString()}]: scraper.scrapePage() called for ${url}`,
    });

    if (task.abort) {
      this.taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG: Task aborted, skipping ${url}`,
      });
      return false;
    }

    this.taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: Using URLManager to scrape ${url}`,
    });

    // Use URLManager for deduplication and caching
    const result = await this.urlManager.scrapeURL(
      url, 
      (scrapeUrl) => this.scrapePageInternal(task, scrapeUrl),
      { skipCache: false }
    );
    
    this.taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: scrapePage() result for ${url}: ${result}`,
    });
    
    return result;
  }

  /**
   * Internal scraping method that performs the actual scraping work
   * @param {TaskState} task - The task state
   * @param {string} url - The URL to scrape
   * @returns {Promise<boolean>} - Whether scraping was successful
   */
  async scrapePageInternal(task, url) {
    this.taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: scrapePageInternal() called for ${url}`,
    });

    if (task.abort) {
      this.taskManager.sendStatus(task.taskId, {
        debug: `🔥 DEBUG: Task aborted in scrapePageInternal, skipping ${url}`,
      });
      return false;
    }

    this.taskManager.sendStatus(task.taskId, {
      debug: `🔥 DEBUG: Incrementing inProgress counter for ${url}`,
    });

    task.inProgress++;
    task.markChanged();
    let success = false;
    let tabId = null;

    // Try scraping with retries
    for (let attempt = 0; attempt < CONFIG.LIMITS.MAX_RETRIES; attempt++) {
      if (task.abort) {
        break;
      }

      try {
        // Apply delay if configured
        if (task.settings.delay > 0) {
          await delay(task.settings.delay);
        }

        // Apply exponential backoff for retries
        if (attempt > 0) {
          await delay(CONFIG.RETRY_DELAYS[attempt - 1]);
          this.taskManager.sendStatus(task.taskId, {
            debug: `Retrying ${url} (attempt ${attempt + 1}/${CONFIG.LIMITS.MAX_RETRIES})`,
          });
        }

        // Create managed tab
        const tab = await this.tabManager.createManagedTab(url);
        tabId = tab.id;
        task.tabIds.add(tabId);

        // Wait for tab to load
        await this.waitForTabLoad(tabId);

        // Verify tab loaded successfully
        const tabStatus = await chrome.tabs.get(tabId);
        if (tabStatus.status !== 'complete') {
          throw new Error(`Tab failed to load: ${url}`);
        }

        // Add extra delay for SPA route changes to complete
        if (usesSPAHashRouting(url)) {
          const spaDelay = getSPANavigationDelay(url);
          this.taskManager.sendStatus(task.taskId, {
            debug: `Waiting ${spaDelay}ms for SPA route to load: ${url}`,
          });
          await delay(spaDelay);
        }

        // Inject scripts
        await this.injectScripts(tabId, task.taskId);

        // Extract content directly from executeScript result instead of waiting for messages
        const contentData = await this.extractContentDirectly(tabId, task.taskId);
        
        if (contentData && contentData.content) {
          // Process the content directly
          this.processContentData(task, url, contentData);
          success = true;
        } else {
          throw new Error('No content extracted');
        }
        
        break;
      } catch (err) {
        this.taskManager.sendStatus(task.taskId, {
          debug: `Attempt ${attempt + 1} failed for ${url}: ${err.message}`,
        });

        if (attempt === CONFIG.LIMITS.MAX_RETRIES - 1) {
          this.taskManager.sendStatus(task.taskId, {
            debug: `Failed to scrape ${url} after ${CONFIG.LIMITS.MAX_RETRIES} attempts`,
          });
        }
      } finally {
        // Clean up tab using TabManager
        if (tabId && task.tabIds.has(tabId)) {
          task.tabIds.delete(tabId);
          await this.tabManager.removeManagedTab(tabId);
        }
      }
    }

    // Update task state
    task.processed++;
    task.inProgress--;
    task.markChanged();

    // Send status update
    this.taskManager.sendStatus(task.taskId, {
      status: `Scraped ${task.processed} page(s)...`,
      processed: task.processed,
      total: Math.min(task.processed + task.queue.length + task.inProgress, task.settings.maxPages),
      debug: success ? `Finished: ${url}` : `Failed: ${url}`,
    });

    return success;
  }

  /**
   * Waits for a tab to finish loading
   * @param {number} tabId - The tab ID
   * @returns {Promise<void>}
   */
  waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Tab ${tabId} load timed out`));
        }
      }, CONFIG.TIMEOUTS.TAB_LOAD);

      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === 'complete' && !resolved) {
          resolved = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      // Check if already loaded
      chrome.tabs.get(tabId, (tab) => {
        if (!resolved && tab?.status === 'complete') {
          resolved = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
  }

  /**
   * Injects only the Readability library - much simpler now
   * @param {number} tabId - The tab ID
   * @param {number} taskId - The task ID
   */
  async injectScripts(tabId, taskId) {
    this.taskManager.sendStatus(taskId, {
      debug: `🔥 DEBUG: Injecting Readability library into tab ${tabId}`,
    });

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/lib/readability.js'],
      });
      
      this.taskManager.sendStatus(taskId, {
        debug: `🔥 DEBUG: Readability library injected successfully`,
      });
    } catch (e) {
      this.taskManager.sendStatus(taskId, {
        debug: `🔥 DEBUG: Readability injection failed: ${e.message} - will use fallback extraction`,
      });
      // Continue without Readability - we have fallbacks
    }
  }

  /**
   * Waits for content from the injected script
   * @param {TaskState} task - The task
   * @param {string} url - The URL being scraped
   */
  waitForContent(task, url) {
    return new Promise((resolve, reject) => {
      const normalizedUrl = normalizeUrl(url);

      // Set up resolver
      task.pendingContent.set(normalizedUrl, resolve);

      // Set up timeout
      setTimeout(() => {
        if (task.pendingContent.has(normalizedUrl)) {
          task.pendingContent.delete(normalizedUrl);
          reject(new Error(`Content timeout for ${url}`));
        }
      }, CONFIG.TIMEOUTS.CONTENT_RETRIEVAL);
    });
  }

  /**
   * Processes content received from a page
   * @param {TaskState} task - The task
   * @param {Object} message - The message from content script
   */
  processPageContent(task, message) {
    if (!task || task.abort) {
      return;
    }

    const { url, title, content, links, skip, errors, authWall, authType, debug } = message;
    const normalizedUrl = normalizeUrl(url);

    // Always try to extract something, even if there were errors
    if (!skip) {
      // Apply content filtering if enabled
      let filteredContent = content;
      if (this.contentFilter && content) {
        try {
          const context = {
            url,
            domain: new URL(url).hostname,
          };

          // Update filter config for site-specific patterns
          this.contentFilter.updateConfig(context.domain);

          // Filter the content
          filteredContent = this.contentFilter.filterContent(content, context);

          // Log metrics
          const metrics = this.contentFilter.getMetrics();
          if (metrics.bytesFiltered > 0) {
            this.taskManager.sendStatus(task.taskId, {
              debug: `Filtered ${metrics.reductionPercent} of boilerplate from ${url}`,
            });
          }
        } catch (filterError) {
          // If filtering fails, use original content
          console.warn('Content filtering failed:', filterError);
          filteredContent = content;
        }
      }

      // Store whatever content we got, even if partial
      // Only show failure message if content extraction actually failed (content is null/undefined)
      // Otherwise use filteredContent if filtering was applied, or original content
      let finalContent;
      if (content === undefined || content === null) {
        // Content extraction actually failed
        finalContent = '[Content extraction failed]';
      } else {
        // Content was extracted, use filtered version or original
        finalContent = filteredContent !== undefined ? filteredContent : content;
      }

      const pageContent = {
        title: title || 'Untitled Page',
        textContent: finalContent,
        errors: errors || [],
      };

      task.addContent(url, pageContent);

      // Process links if in crawl mode, even with errors
      if (task.settings.crawlMode && links && links.length > 0) {
        this.processLinks(task, links);
      }

      // Log any errors but continue
      if (errors && errors.length > 0) {
        this.taskManager.sendStatus(task.taskId, {
          debug: `Page scraped with issues (${url}): ${errors.join('; ')}`,
        });
      }
    } else {
      // Handle authentication walls gracefully
      if (authWall) {
        this.taskManager.sendStatus(task.taskId, {
          debug: debug || `Authentication wall (${authType}) detected at ${url}. Continuing crawl...`,
          warning: `Skipped ${url} due to authentication requirement`
        });
        
        // Store a placeholder to indicate the page was encountered but inaccessible
        const placeholderContent = {
          title: title || 'Authentication Required',
          textContent: `[Content requires authentication - Type: ${authType}]`,
          errors: [`Authentication wall detected: ${authType}`]
        };
        task.addContent(url, placeholderContent);
        
        // In crawl mode, still try to get any visible links if they were extracted
        if (task.settings.crawlMode && links && links.length > 0) {
          this.taskManager.sendStatus(task.taskId, {
            debug: `Attempting to extract ${links.length} links from auth-blocked page`
          });
          this.processLinks(task, links);
        }
      } else {
        // Regular skip (non-auth related)
        this.taskManager.sendStatus(task.taskId, {
          debug: `Skipped page ${url}, continuing crawl`,
        });
      }
    }

    // Always resolve to keep crawl going
    this.resolvePending(task, normalizedUrl);
  }

  /**
   * Processes links found on a page
   * @param {TaskState} task - The task
   * @param {string[]} links - Array of link URLs
   */
  processLinks(task, links) {
    let addedCount = 0;

    for (const link of links) {
      // Validate link
      if (!isValidUrl(link)) {
        continue;
      }
      if (hasExcludedExtension(link, CONFIG.EXCLUDED_EXTENSIONS)) {
        continue;
      }

      // Check if same domain
      try {
        const linkDomain = new URL(link).hostname;
        if (linkDomain !== task.startingDomain) {
          continue;
        }
      } catch (e) {
        continue;
      }

      // Add to queue
      if (task.addToQueue(link)) {
        addedCount++;
      }
    }

    if (addedCount > 0) {
      this.taskManager.sendStatus(task.taskId, {
        debug: `Added ${addedCount} new links to queue`,
      });
    }
  }

  /**
   * Resolves a pending content promise
   * @param {TaskState} task - The task
   * @param {string} url - The normalized URL
   */
  resolvePending(task, url) {
    const resolve = task.pendingContent.get(url);
    if (resolve) {
      resolve();
      task.pendingContent.delete(url);
    }
  }

  /**
   * Emergency cleanup of all tabs for a task
   * @param {TaskState} task - The task to clean up
   */
  async emergencyCleanup(task) {
    if (task && task.tabIds.size > 0) {
      // Clean up all tabs associated with this task
      const tabCleanupPromises = Array.from(task.tabIds).map((tabId) =>
        this.tabManager.removeManagedTab(tabId)
      );

      await Promise.allSettled(tabCleanupPromises);
      task.tabIds.clear();
    }
  }

  /**
   * Get performance statistics from URLManager
   * @returns {Object} - Statistics object with deduplication and cache metrics
   */
  getURLManagerStats() {
    return this.urlManager.getStats();
  }

  /**
   * Extract content directly from a tab using executeScript return value
   * @param {number} tabId - The tab ID
   * @param {number} taskId - The task ID
   * @returns {Promise<Object>} Content data
   */
  async extractContentDirectly(tabId, taskId) {
    this.taskManager.sendStatus(taskId, {
      debug: `🔥 DEBUG [${new Date().toLocaleTimeString()}]: Extracting content directly from tab ${tabId}`,
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: function() {
        console.log('[DIRECT_EXTRACT] Starting content extraction');
        
        // Extract content immediately
        let content = '';
        let title = document.title || window.location.href;
        let extractionMethod = 'unknown';
        
        // Try Readability first if available
        if (typeof Readability !== 'undefined') {
          try {
            const doc = new Readability(document.cloneNode(true)).parse();
            if (doc && doc.textContent && doc.textContent.length > 50) {
              content = doc.textContent.trim();
              title = doc.title || title;
              extractionMethod = 'readability';
            }
          } catch (e) {
            console.warn('[DIRECT_EXTRACT] Readability failed:', e.message);
          }
        }
        
        // Fallback content extraction
        if (!content || content.length < 100) {
          const selectors = ['main', 'article', '.post', '.content', '#content', '.markup', '.pencraft'];
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.innerText.trim().length > 100) {
              content = element.innerText.trim();
              extractionMethod = `selector: ${selector}`;
              break;
            }
          }
          
          // Last resort: body text
          if (!content || content.length < 50) {
            content = document.body.innerText.trim();
            extractionMethod = 'body text';
          }
        }
        
        // Extract links
        const links = Array.from(document.querySelectorAll('a'))
          .map(a => a.href)
          .filter(href => {
            try {
              const url = new URL(href);
              return url.protocol === 'http:' || url.protocol === 'https:';
            } catch {
              return false;
            }
          });
        
        console.log('[DIRECT_EXTRACT] Extraction complete:', {
          contentLength: content.length,
          linkCount: links.length,
          method: extractionMethod
        });
        
        // Return data directly - no message passing needed!
        return {
          url: window.location.href,
          title: title,
          content: content,
          links: links,
          extractionMethod: extractionMethod,
          timestamp: Date.now()
        };
      }
    });

    const contentData = results[0]?.result;
    
    this.taskManager.sendStatus(taskId, {
      debug: `🔥 DEBUG: Direct extraction result: ${contentData ? `${contentData.content?.length || 0} chars, ${contentData.links?.length || 0} links` : 'null'}`,
    });

    return contentData;
  }

  /**
   * Process content data extracted directly
   * @param {TaskState} task - The task state
   * @param {string} url - The URL
   * @param {Object} contentData - The extracted content data
   */
  processContentData(task, url, contentData) {
    this.taskManager.sendStatus(task.taskId, {
      debug: `Processing content for ${url}: ${contentData.content?.length || 0} characters, ${contentData.links?.length || 0} links`,
    });

    // Apply content filtering if enabled
    let filteredContent = contentData.content;
    if (this.contentFilter && contentData.content) {
      try {
        const context = {
          url,
          domain: new URL(url).hostname,
        };
        
        filteredContent = this.contentFilter.filterContent(contentData.content, context);
        
        // Log filtering metrics if content was reduced
        if (filteredContent.length < contentData.content.length) {
          const reductionPercent = ((contentData.content.length - filteredContent.length) / contentData.content.length * 100).toFixed(1);
          this.taskManager.sendStatus(task.taskId, {
            debug: `Filtered ${reductionPercent}% of boilerplate from ${url}`,
          });
        }
      } catch (filterError) {
        console.warn('Content filtering failed:', filterError);
      }
    }

    // Store content
    const processedContent = {
      title: contentData.title,
      textContent: filteredContent,
      extractionMethod: contentData.extractionMethod
    };
    
    task.addContent(url, processedContent);

    // Process links for crawling
    if (task.settings.crawlMode && contentData.links && contentData.links.length > 0) {
      this.processLinks(task, contentData.links);
    }
  }

  /**
   * Cleanup method for PageScraper - should be called on extension shutdown
   */
  cleanup() {
    // Clean up tab manager
    this.tabManager.cleanup();
    
    // Clean up URL manager  
    this.urlManager.cleanup();
    
    console.debug('PageScraper cleanup completed');
  }
}
