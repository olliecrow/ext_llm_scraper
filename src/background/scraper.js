import { CONFIG } from '../shared/config.js';
import { delay, isValidUrl, hasExcludedExtension, isSameSite } from '../shared/utils.js';
import { ensureOffscreenDocument } from './offscreenDoc.js';

const STATIC_TEXT_LIMIT = 2_000_000;
const STATIC_TEXT_MINIMUM = 100;
const PAGE_CONTENT_TYPE = /^\s*(text\/html|application\/xhtml\+xml|text\/plain)\s*(;|$)/i;

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

  // Resolve links like the browser does: against the first <base href>,
  // which resolves against the page URL. A parsed copy has no page URL of
  // its own, so anchor.href would be wrong there.
  let baseUrl = pageUrl;
  const baseHref = rootDocument.querySelector('base[href]')?.getAttribute('href');
  if (baseHref) {
    try {
      baseUrl = new URL(baseHref, pageUrl || undefined).href;
    } catch {
      // An invalid base leaves the page URL in place.
    }
  }

  response.links = Array.from(rootDocument.querySelectorAll('a[href]'))
    .map((anchor) => absoluteHttpUrl(anchor.getAttribute('href'), baseUrl))
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
        await delay(startAt - now, task.signal);
      }
      if (task.abort) {
        return false;
      }

      // A server never sees a hash route, so a fetch returns only the app
      // shell. Normalized URLs keep a hash only for such routes.
      const fetched = new URL(url).hash ? null : await this.fetchStaticPage(task, url);
      if (fetched === false) {
        return false;
      }

      let content = fetched;
      if (!content) {
        if (task.abort) {
          return false;
        }
        tab = await chrome.tabs.create({ url, active: false });
        if (!tab || typeof tab.id !== 'number') {
          throw new Error('Failed to create background tab');
        }

        await this.waitForTabLoad(tab.id, task.signal);
        if (task.abort) {
          return false;
        }

        // A redirect can land on another site. Chrome hides tab.url for a
        // site without access, so a missing URL also counts as off the site.
        const loaded = await chrome.tabs.get(tab.id);
        if (this.leftSite(task, url, loaded?.url)) {
          return false;
        }

        if (new URL(url).hash) {
          await delay(600, task.signal);
          if (task.abort) {
            return false;
          }
        }
        await this.injectReadability(task, tab.id);
        content = await this.extractContent(tab.id);
        if (content && this.leftSite(task, url, content.url)) {
          return false;
        }
      }

      if (!content || !content.content || content.content.trim().length === 0) {
        throw new Error('Content extraction returned empty result');
      }

      task.addContent(content.url || url, {
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

  leftSite(task, url, landedUrl) {
    if (isSameSite(task.startingUrl, landedUrl || '')) {
      return false;
    }
    this.taskManager.sendStatus(task.taskId, {
      status: 'Skipping redirect off this site',
      debug: `Redirect left the site: ${url} -> ${landedUrl || 'a site without access'}`,
    });
    return true;
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

  waitForTabLoad(tabId, signal) {
    return new Promise((resolve, reject) => {
      let completed = false;

      // Stop ends the wait. The caller checks task.abort next.
      const handleAbort = () => {
        if (!completed) {
          completed = true;
          cleanup();
          resolve();
        }
      };

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
        signal?.removeEventListener('abort', handleAbort);
      };

      if (signal?.aborted) {
        handleAbort();
        return;
      }
      signal?.addEventListener('abort', handleAbort, { once: true });
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

  // Returns parsed content, null to fall back to a tab, or false to skip the URL.
  async fetchStaticPage(task, url) {
    // One signal covers the headers and the body. Stop or the deadline aborts both.
    const signal = AbortSignal.any([
      task.signal,
      AbortSignal.timeout(CONFIG.TIMEOUTS.STATIC_FETCH),
    ]);
    let response;
    let html;
    try {
      response = await fetch(url, {
        credentials: 'include',
        redirect: 'follow',
        cache: 'no-store',
        signal,
      });

      if (this.leftSite(task, url, response.url)) {
        return false;
      }

      const contentType = response.headers?.get?.('content-type') || '';
      if (!contentType.trim()) {
        return null;
      }
      if (!PAGE_CONTENT_TYPE.test(contentType)) {
        this.taskManager.sendStatus(task.taskId, {
          status: 'Skipping non-HTML resource',
          debug: `Ignored by content type: ${url}`,
        });
        return false;
      }

      const charset = /;\s*charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
      const decoded = await readCappedText(response, STATIC_TEXT_LIMIT, charset);
      html = decoded.text;
      // No transport charset: compare the meta label with the encoding that
      // actually read the body (UTF-8, or a byte-order mark). An invalid
      // label, or a different one, needs Chrome's HTML encoding rules.
      // A transport charset already won, so a disagreeing meta does not.
      if (!charset && metaCharsetNeedsTab(html, decoded.encoding)) {
        return null;
      }
    } catch (error) {
      if (task.abort) {
        return false;
      }
      this.taskManager.sendStatus(task.taskId, {
        debug: `Static fetch failed, opening a tab: ${error.message}`,
      });
      return null;
    }

    let parsed;
    try {
      await ensureOffscreenDocument(chrome);
      parsed = await chrome.runtime.sendMessage({
        action: 'parse-html',
        html,
        url: response.url,
      });
    } catch (error) {
      this.taskManager.sendStatus(task.taskId, {
        debug: `Static parse failed, opening a tab: ${error.message}`,
      });
      return null;
    }
    if (!parsed || parsed.error || typeof parsed.content !== 'string') {
      return null;
    }
    if (parsed.content.trim().length >= STATIC_TEXT_MINIMUM) {
      return { ...parsed, url: response.url };
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

// First encoding declaration in document order. Null when the page
// names none. A charset attribute wins over http-equiv on the same tag.
function firstMetaCharsetLabel(html) {
  for (const tag of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = metaAttributes(tag[1]);
    if (attrs.has('charset')) {
      return attrs.get('charset');
    }
    const equiv = (attrs.get('http-equiv') || '').trim().toLowerCase();
    if (equiv === 'content-type') {
      const found = /charset\s*=\s*["']?\s*([^\s;"']*)/i.exec(attrs.get('content') || '');
      if (found) {
        return found[1];
      }
    }
  }
  return null;
}

function metaAttributes(source) {
  const attrs = new Map();
  const re = /([^\s"'>=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;
  for (const found of source.matchAll(re)) {
    const name = found[1].toLowerCase();
    if (!attrs.has(name)) {
      attrs.set(name, found[2] ?? found[3] ?? found[4] ?? '');
    }
  }
  return attrs;
}

function metaCharsetNeedsTab(html, usedEncoding) {
  const label = firstMetaCharsetLabel(html);
  if (label === null) {
    return false;
  }
  try {
    return new TextDecoder(label).encoding !== usedEncoding;
  } catch {
    return true;
  }
}

async function readCappedText(response, limit, charset) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = typeof response.text === 'function' ? await response.text() : '';
    return { text: String(text).slice(0, limit), encoding: 'utf-8' };
  }

  let text = '';
  let encoding = 'utf-8';
  try {
    // A BOM outranks the header, as in a browser. The decoder is created
    // inside this try so an unknown label still cancels the locked body.
    let lead = new Uint8Array(0);
    let decoder = null;
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = value ?? new Uint8Array(0);
      if (!decoder) {
        lead = concatBytes(lead, chunk);
        if (leadNeedsMore(lead)) {
          continue;
        }
        decoder = decoderForLead(lead, charset);
        encoding = decoder.encoding;
        text += decoder.decode(lead, { stream: true });
        continue;
      }
      text += decoder.decode(chunk, { stream: true });
    }
    if (!decoder) {
      decoder = decoderForLead(lead, charset);
      encoding = decoder.encoding;
      if (lead.length > 0) {
        text += decoder.decode(lead, { stream: true });
      }
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { text: text.slice(0, limit), encoding };
}

function decoderForLead(lead, charset) {
  return new TextDecoder(bomEncoding(lead) || charset || 'utf-8');
}

function concatBytes(left, right) {
  if (left.length === 0) {
    return right;
  }
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

function bomEncoding(lead) {
  if (lead.length >= 3 && lead[0] === 0xef && lead[1] === 0xbb && lead[2] === 0xbf) {
    return 'utf-8';
  }
  if (lead.length >= 2 && lead[0] === 0xff && lead[1] === 0xfe) {
    return 'utf-16le';
  }
  if (lead.length >= 2 && lead[0] === 0xfe && lead[1] === 0xff) {
    return 'utf-16be';
  }
  return null;
}

// Wait until the leading bytes can prove or rule out a BOM.
function leadNeedsMore(lead) {
  if (lead.length === 0) {
    return true;
  }
  if (lead.length >= 3) {
    return false;
  }
  if (lead[0] === 0xef) {
    return lead.length < 2 || lead[1] === 0xbb;
  }
  if (lead[0] === 0xff || lead[0] === 0xfe) {
    return lead.length < 2;
  }
  return false;
}
