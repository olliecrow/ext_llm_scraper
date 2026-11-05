import { CONFIG } from '../shared/config.js';
import { delay, isValidUrl, hasExcludedExtension, isSameSite } from '../shared/utils.js';
import { ensureOffscreenDocument } from './offscreenDoc.js';

const STATIC_TEXT_LIMIT = 2_000_000;
const STATIC_TEXT_MINIMUM = 100;

export function extractPageContent(
  rootDocument = document,
  pageUrl = rootDocument.location?.href || ''
) {
  function absoluteHttpUrl(href, baseUrl) {
    if (!href) {
      return '';
    }
    try {
      const absolute = new URL(href, baseUrl || undefined);
      return ['http:', 'https:'].includes(absolute.protocol) ? absolute.href : '';
    } catch {
      return '';
    }
  }

  const response = {
    url: pageUrl,
    title: rootDocument.title || pageUrl,
    content: '',
    links: [],
  };

  try {
    const Reader = typeof window === 'undefined' ? undefined : window.Readability;
    if (Reader) {
      const parsed = new Reader(rootDocument.cloneNode(true)).parse();
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
      const element = rootDocument.querySelector(selector);
      const text = element?.innerText?.trim() || element?.textContent?.trim() || '';
      if (text.length > 200) {
        response.content = text;
        break;
      }
    }
  }

  if (!response.content) {
    response.content =
      rootDocument.body?.innerText?.trim() || rootDocument.body?.textContent?.trim() || '';
  }

  response.links = Array.from(rootDocument.querySelectorAll('a[href]'))
    .map((anchor) => absoluteHttpUrl(anchor.getAttribute('href'), pageUrl))
    .filter(Boolean);

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

      const fetched = await this.fetchStaticPage(task, url);
      if (fetched === false) {
        return false;
      }

      let content = fetched;
      if (!content) {
        tab = await chrome.tabs.create({ url, active: false });
        if (!tab || typeof tab.id !== 'number') {
          throw new Error('Failed to create background tab');
        }

        await this.waitForTabLoad(tab.id);
        if (task.abort) {
          return false;
        }

        await this.injectReadability(task, tab.id);
        content = await this.extractContent(tab.id);
      }

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

  async fetchStaticPage(task, url) {
    let response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        redirect: 'follow',
        cache: 'no-store',
      });
    } catch (error) {
      this.taskManager.sendStatus(task.taskId, {
        debug: `Static fetch failed, opening a tab: ${error.message}`,
      });
      return null;
    }

    if (!isSameSite(url, response.url)) {
      this.taskManager.sendStatus(task.taskId, {
        status: 'Skipping redirect off this site',
        debug: `Redirect left the site: ${response.url}`,
      });
      return false;
    }

    const contentType = response.headers?.get?.('content-type') || '';
    if (!/html|text/i.test(contentType)) {
      this.taskManager.sendStatus(task.taskId, {
        status: 'Skipping non-HTML resource',
        debug: `Ignored by content type: ${url}`,
      });
      return false;
    }

    const html = await readCappedText(response, STATIC_TEXT_LIMIT);
    await ensureOffscreenDocument(chrome);
    const parsed = await chrome.runtime.sendMessage({
      action: 'parse-html',
      html,
      url: response.url,
    });
    if (!parsed || parsed.error || typeof parsed.content !== 'string') {
      return null;
    }
    if (parsed.content.trim().length >= STATIC_TEXT_MINIMUM) {
      return parsed;
    }
    return null;
  }

  async injectReadability(task, tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/lib/readability.js'],
      });
    } catch {
      this.taskManager.sendStatus(task.taskId, {
        debug: 'Readability was not injected',
      });
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

async function readCappedText(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = typeof response.text === 'function' ? await response.text() : '';
    return String(text).slice(0, limit);
  }

  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text.slice(0, limit);
}
