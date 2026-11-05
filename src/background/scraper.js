import { CONFIG } from '../shared/config.js';
import { delay, isValidUrl, hasExcludedExtension, isSameSite } from '../shared/utils.js';

export function extractPageContent() {
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
      const text = element?.innerText?.trim() || element?.textContent?.trim() || '';
      if (text.length > 200) {
        response.content = text;
        break;
      }
    }
  }

  if (!response.content) {
    response.content = document.body?.innerText?.trim() || document.body?.textContent?.trim() || '';
  }

  response.links = Array.from(document.querySelectorAll('a[href]'))
    .map((anchor) => anchor.href)
    .filter((href) => {
      try {
        return ['http:', 'https:'].includes(new URL(href).protocol);
      } catch (_) {
        return false;
      }
    });

  return response;
}

export class PageScraper {
  constructor(taskManager) {
    this.taskManager = taskManager;
    this.nextStart = 0;
  }

  reserveStart(task) {
    const gap = task.settings.delay > 0 ? task.settings.delay : CONFIG.TIMEOUTS.BETWEEN_REQUESTS;
    const now = Date.now();
    const startAt = Math.max(now, this.nextStart ?? 0);
    this.nextStart = startAt + gap;
    return startAt;
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

    const now = Date.now();
    const startAt = this.reserveStart(task);
    let tab = null;
    task.inProgress += 1;

    try {
      if (startAt > now) {
        await delay(startAt - now);
      }
      if (task.abort) {
        return false;
      }

      tab = await chrome.tabs.create({ url, active: false });
      if (!tab || typeof tab.id !== 'number') {
        throw new Error('Failed to create background tab');
      }

      await this.waitForTabLoad(tab.id);
      if (task.abort) {
        return false;
      }

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

      const saved = task.contentMap.size;
      this.taskManager.sendStatus(task.taskId, {
        status: `Scraped ${saved} page(s)`,
        processed: saved,
        total: Math.min(
          task.settings.maxPages,
          saved + task.queue.length + Math.max(0, task.inProgress - 1)
        ),
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
      task.attempts += 1;

      if (tab?.id !== undefined) {
        await chrome.tabs.remove(tab.id).catch(() => undefined);
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

      if (hasExcludedExtension(link, CONFIG.EXCLUDED_EXTENSIONS)) {
        continue;
      }

      if (!isSameSite(task.startingUrl, link)) {
        continue;
      }

      if (task.addToQueue(link)) {
        added += 1;
      }
    }

    if (added > 0) {
      this.taskManager.sendStatus(task.taskId, {
        debug: `Queued ${added} additional page(s)`,
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
      func: extractPageContent,
    });

    return result?.result ?? null;
  }
}
