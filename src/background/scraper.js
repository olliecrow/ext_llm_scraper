import { CONFIG } from '../shared/config.js';
import {
  delay,
  isValidUrl,
  hasExcludedExtension,
} from '../shared/utils.js';
import { SafeChromeAPI } from '../shared/safeChromeAPI.js';

export class PageScraper {
  constructor(taskManager) {
    this.taskManager = taskManager;
  }

  async scrape(task, url) {
    if (!task || task.abort) {
      return false;
    }

    if (!isValidUrl(url)) {
      this.taskManager.sendStatus(task.taskId, {
        status: 'Skipping invalid URL',
        debug: `Invalid URL: ${url}`,
      });
      return false;
    }

    if (hasExcludedExtension(url, CONFIG.EXCLUDED_EXTENSIONS)) {
      this.taskManager.sendStatus(task.taskId, {
        status: 'Skipping non-HTML resource',
        debug: `Ignored by extension filter: ${url}`,
      });
      return false;
    }

    let tab = null;
    task.inProgress += 1;
    task.markChanged();

    try {
      tab = await SafeChromeAPI.tabs('create', { url, active: false });
      if (!tab || typeof tab.id !== 'number') {
        throw new Error('Failed to create background tab');
      }

      await this.waitForTabLoad(tab.id);
      await this.injectReadability(tab.id);
      const content = await this.extractContent(tab.id);

      if (!content || !content.content || content.content.trim().length === 0) {
        throw new Error('Content extraction returned empty result');
      }

      task.addContent(url, {
        title: content.title,
        textContent: content.content,
      });

      this.enqueueDiscoveredLinks(task, content.links);

      this.taskManager.sendStatus(task.taskId, {
        status: `Scraped ${task.processed + 1} page(s)` ,
        processed: task.processed + 1,
        total: Math.min(task.settings.maxPages, task.processed + task.queue.length + task.inProgress),
        debug: `Captured ${url}`,
      });

      return true;
    } catch (error) {
      this.taskManager.sendStatus(task.taskId, {
        status: 'Page scraping failed',
        debug: `Failed to scrape ${url}: ${error.message}`,
      });
      return false;
    } finally {
      task.inProgress = Math.max(0, task.inProgress - 1);
      task.processed += 1;
      task.markChanged();

      if (tab?.id !== undefined) {
        await SafeChromeAPI.tabs('remove', tab.id).catch(() => undefined);
      }

      if (task.settings.delay > 0) {
        await delay(task.settings.delay);
      } else if (CONFIG.TIMEOUTS.BETWEEN_REQUESTS > 0) {
        await delay(CONFIG.TIMEOUTS.BETWEEN_REQUESTS);
      }
    }
  }

  enqueueDiscoveredLinks(task, links) {
    if (!task || !task.settings.crawlMode || !Array.isArray(links)) {
      return;
    }

    let added = 0;

    for (const link of links) {
      if (typeof link !== 'string' || !isValidUrl(link)) {
        continue;
      }

      try {
        const linkUrl = new URL(link);
        if (linkUrl.hostname !== task.startingDomain) {
          continue;
        }
      } catch (_) {
        continue;
      }

      if (task.addToQueue(link)) {
        added += 1;
      }
    }

    if (added > 0) {
      this.taskManager.sendStatus(task.taskId, {
        debug: `Queued ${added} additional page(s)`
      });
    }
  }

  waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
      let completed = false;

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          cleanup();
          reject(new Error('Tab load timeout'));
        }
      }, CONFIG.TIMEOUTS.TAB_LOAD);

      const handleUpdate = (updatedId, info) => {
        if (updatedId === tabId && info.status === 'complete' && !completed) {
          completed = true;
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(handleUpdate);
      };

      chrome.tabs.onUpdated.addListener(handleUpdate);

      chrome.tabs.get(tabId, (tab) => {
        if (!completed && chrome.runtime.lastError) {
          return;
        }
        if (!completed && tab?.status === 'complete') {
          completed = true;
          cleanup();
          resolve();
        }
      });
    });
  }

  async injectReadability(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/lib/readability.js'],
      });
    } catch (_) {
      // Continue without readability
    }
  }

  async extractContent(tabId) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const response = {
          url: window.location.href,
          title: document.title || window.location.href,
          content: '',
          links: [],
        };

        try {
          if (window.Readability) {
            const parsed = new window.Readability(document.cloneNode(true)).parse();
            if (parsed?.textContent) {
              response.content = parsed.textContent.trim();
              response.title = parsed.title || response.title;
            }
          }
        } catch (error) {
          console.warn('Readability extraction failed:', error.message);
        }

        if (!response.content || response.content.length < 100) {
          const candidates = ['article', 'main', '[role="main"]', '.content', '.post'];
          for (const selector of candidates) {
            const element = document.querySelector(selector);
            if (element && element.innerText.trim().length > 200) {
              response.content = element.innerText.trim();
              break;
            }
          }
        }

        if (!response.content) {
          response.content = document.body?.innerText?.trim() ?? '';
        }

        const links = Array.from(document.querySelectorAll('a[href]'));
        response.links = links
          .map((anchor) => anchor.href)
          .filter(Boolean);

        return response;
      },
    });

    return result?.result ?? null;
  }
}
