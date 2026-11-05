import { normalizeUrl, extractDomain, isValidUrl } from '../shared/utils.js';
import { CONFIG } from '../shared/config.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export class TaskState {
  constructor(taskId, startingUrl, settings = {}) {
    this.taskId = taskId;
    this.startingUrl = normalizeUrl(startingUrl);
    if (!isValidUrl(this.startingUrl)) {
      throw new Error('Starting URL must use HTTP or HTTPS');
    }

    this.startingDomain = extractDomain(this.startingUrl);

    const requestedPages = Math.trunc(Number(settings.maxPages ?? CONFIG.DEFAULTS.MAX_PAGES));
    const requestedConcurrency = Math.trunc(
      Number(settings.concurrency ?? CONFIG.DEFAULTS.CONCURRENCY)
    );
    const requestedDelay = Number(settings.delay ?? CONFIG.DEFAULTS.DELAY_MS);

    this.settings = {
      crawlMode:
        typeof settings.crawlMode === 'boolean' ? settings.crawlMode : CONFIG.DEFAULTS.CRAWL_MODE,
      maxPages: clamp(
        Number.isFinite(requestedPages) ? requestedPages : CONFIG.DEFAULTS.MAX_PAGES,
        CONFIG.LIMITS.MIN_PAGES,
        CONFIG.LIMITS.MAX_PAGES
      ),
      concurrency: clamp(
        Number.isFinite(requestedConcurrency) ? requestedConcurrency : CONFIG.DEFAULTS.CONCURRENCY,
        CONFIG.LIMITS.MIN_CONCURRENCY,
        CONFIG.LIMITS.MAX_CONCURRENCY
      ),
      delay:
        Number.isFinite(requestedDelay) && requestedDelay > 0
          ? clamp(requestedDelay, 0, CONFIG.LIMITS.MAX_DELAY_MS)
          : 0,
    };

    this.queue = [this.startingUrl];
    this.visited = new Set([this.startingUrl]);
    this.processed = 0;
    this.attempts = 0;
    this.inProgress = 0;
    this.abort = false;
    this.abortController = new AbortController();
    this.isFinishing = false;
    this.isFinished = false;

    this.contentMap = new Map();
  }

  canSchedule() {
    if (this.abort || this.queue.length === 0) {
      return false;
    }

    if (this.contentMap.size + this.inProgress >= this.settings.maxPages) {
      return false;
    }

    if (this.attempts >= this.settings.maxPages * 2) {
      return false;
    }

    return true;
  }

  get signal() {
    return this.abortController.signal;
  }

  // Stop scheduling and cancel waits, fetches, and body reads in flight.
  stop() {
    this.abort = true;
    this.queue = [];
    this.abortController.abort();
  }

  getNextUrl() {
    return this.queue.shift() ?? null;
  }

  addToQueue(url) {
    if (!url) {
      return false;
    }

    const normalized = normalizeUrl(url);
    if (!normalized || this.visited.has(normalized)) {
      return false;
    }

    const backlogCap = Math.min(CONFIG.LIMITS.MAX_PAGES, this.settings.maxPages * 4);
    if (this.queue.length >= backlogCap) {
      return false;
    }

    this.queue.push(normalized);
    this.visited.add(normalized);
    return true;
  }

  addContent(url, content) {
    const normalized = normalizeUrl(url);
    if (!normalized || this.contentMap.has(normalized)) {
      return false;
    }

    this.contentMap.set(normalized, {
      title: content?.title ?? url,
      textContent: content?.textContent ?? '',
    });
    this.processed = this.contentMap.size;

    return true;
  }

  isComplete() {
    return !this.abort && this.queue.length === 0 && this.inProgress === 0;
  }

  markAsFinishing() {
    if (this.isFinished || this.isFinishing) {
      return false;
    }

    if (!this.isComplete()) {
      return false;
    }

    this.isFinishing = true;
    return true;
  }

  markAsFinished() {
    this.isFinishing = false;
    this.isFinished = true;
  }
}
