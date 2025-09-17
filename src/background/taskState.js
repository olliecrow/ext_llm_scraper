import { normalizeUrl, extractDomain } from '../shared/utils.js';
import { CONFIG } from '../shared/config.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export class TaskState {
  constructor(taskId, startingUrl, settings = {}) {
    this.taskId = taskId;
    this.startingUrl = normalizeUrl(startingUrl);
    this.startingDomain = extractDomain(this.startingUrl);

    const requestedPages = Number(settings.maxPages ?? CONFIG.DEFAULTS.MAX_PAGES);
    const requestedConcurrency = Number(settings.concurrency ?? CONFIG.DEFAULTS.CONCURRENCY);
    const requestedDelay = Number(settings.delay ?? CONFIG.DEFAULTS.DELAY_MS);

    this.settings = {
      crawlMode: settings.crawlMode ?? CONFIG.DEFAULTS.CRAWL_MODE,
      maxPages: clamp(
        Number.isFinite(requestedPages) ? requestedPages : CONFIG.DEFAULTS.MAX_PAGES,
        CONFIG.LIMITS.MIN_PAGES,
        CONFIG.LIMITS.MAX_PAGES,
      ),
      concurrency: clamp(
        Number.isFinite(requestedConcurrency) ? requestedConcurrency : CONFIG.DEFAULTS.CONCURRENCY,
        CONFIG.LIMITS.MIN_CONCURRENCY,
        CONFIG.LIMITS.MAX_CONCURRENCY,
      ),
      delay: Number.isFinite(requestedDelay) && requestedDelay > 0 ? requestedDelay : 0,
    };

    this.queue = [this.startingUrl];
    this.visited = new Set([this.startingUrl]);
    this.processed = 0;
    this.inProgress = 0;
    this.abort = false;
    this.isFinishing = false;
    this.isFinished = false;

    this.contentMap = new Map();

    this.saveCallback = null;
    this.saveTimer = null;
    this.hasUnsavedChanges = false;
  }

  setSaveCallback(callback) {
    this.saveCallback = typeof callback === 'function' ? callback : null;
  }

  markChanged() {
    if (!this.saveCallback) {
      return;
    }

    this.hasUnsavedChanges = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.hasUnsavedChanges = false;
      this.saveCallback?.(this);
    }, 2000);
  }

  forceSave() {
    if (!this.saveCallback || !this.hasUnsavedChanges) {
      return false;
    }

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    this.hasUnsavedChanges = false;
    this.saveCallback(this);
    return true;
  }

  canSchedule() {
    if (this.abort) {
      return false;
    }

    if (!Array.isArray(this.queue) || this.queue.length === 0) {
      return false;
    }

    if (this.processed + this.inProgress >= this.settings.maxPages) {
      return false;
    }

    return true;
  }

  getNextUrl() {
    if (!Array.isArray(this.queue) || this.queue.length === 0) {
      return null;
    }

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

    if (this.processed + this.queue.length >= this.settings.maxPages) {
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

    this.markChanged();
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

  hasActiveScraping() {
    return this.inProgress > 0;
  }

  toJSON() {
    return {
      taskId: this.taskId,
      startingUrl: this.startingUrl,
      startingDomain: this.startingDomain,
      settings: { ...this.settings },
      queue: [...this.queue],
      visited: [...this.visited],
      processed: this.processed,
      contentMap: Array.from(this.contentMap.entries()),
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const task = new TaskState(data.taskId, data.startingUrl, data.settings);

    if (Array.isArray(data.queue) && data.queue.length > 0) {
      task.queue = data.queue.map(normalizeUrl);
    }

    if (Array.isArray(data.visited) && data.visited.length > 0) {
      task.visited = new Set(data.visited.map(normalizeUrl));
    }

    if (Array.isArray(data.contentMap)) {
      task.contentMap = new Map(
        data.contentMap.map(([url, content]) => [normalizeUrl(url), content])
      );
    }

    if (typeof data.processed === 'number' && data.processed > 0) {
      task.processed = Math.max(0, data.processed);
    }

    return task;
  }
}
