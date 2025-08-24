// Tests for TaskState class from the existing codebase
import { TaskState } from '../src/background/taskState.js';

describe('TaskState', () => {
  test('initializes with normalized URL', () => {
    const task = new TaskState(1, 'https://example.com/page?query=test#hash', {});
    expect(task.startingUrl).toBe('https://example.com/page');
  });

  test('extracts domain correctly', () => {
    const task = new TaskState(1, 'https://subdomain.example.com/page', {});
    expect(task.startingDomain).toBe('subdomain.example.com');
  });

  test('enforces maximum pages limit', () => {
    const task = new TaskState(1, 'https://example.com', { maxPages: 2000 });
    expect(task.settings.maxPages).toBe(600);
  });

  test('enforces minimum pages limit', () => {
    const task = new TaskState(1, 'https://example.com', { maxPages: 0 });
    expect(task.settings.maxPages).toBe(600); // Uses CONFIG.DEFAULTS.MAX_PAGES when maxPages is falsy
  });

  test('enforces concurrency limits', () => {
    const taskMax = new TaskState(1, 'https://example.com', { concurrency: 20 });
    expect(taskMax.settings.concurrency).toBe(10);
    
    const taskMin = new TaskState(2, 'https://example.com', { concurrency: 0 });
    expect(taskMin.settings.concurrency).toBe(5); // Uses CONFIG.DEFAULTS.CONCURRENCY when concurrency is falsy
  });

  test('initializes with starting URL in queue and visited', () => {
    const task = new TaskState(1, 'https://example.com', {});
    expect(task.queue).toContain('https://example.com/'); // URL gets normalized with trailing slash
    expect(task.visited.has('https://example.com/')).toBe(true);
  });

  test('isComplete returns true when no in progress and conditions met', () => {
    const task = new TaskState(1, 'https://example.com', { maxPages: 1 });
    task.processed = 1;
    task.inProgress = 0;
    expect(task.isComplete()).toBe(true);
  });

  test('isComplete returns false when scraping in progress', () => {
    const task = new TaskState(1, 'https://example.com', {});
    task.inProgress = 1;
    expect(task.isComplete()).toBe(false);
  });

  test('canSchedule respects concurrency limit', () => {
    const task = new TaskState(1, 'https://example.com', { concurrency: 2 });
    task.inProgress = 2;
    expect(task.canSchedule()).toBe(false);
  });

  test('canSchedule returns false when aborted', () => {
    const task = new TaskState(1, 'https://example.com', {});
    task.abort = true;
    expect(task.canSchedule()).toBe(false);
  });

  test('canSchedule returns false when queue is empty', () => {
    const task = new TaskState(1, 'https://example.com', {});
    task.queue = [];
    expect(task.canSchedule()).toBe(false);
  });

  test('addToQueue adds new URL and returns true', () => {
    const task = new TaskState(1, 'https://example.com', {});
    const added = task.addToQueue('https://example.com/page2');
    expect(added).toBe(true);
    expect(task.queue).toContain('https://example.com/page2');
    expect(task.visited.has('https://example.com/page2')).toBe(true);
  });

  test('addToQueue rejects duplicate URL', () => {
    const task = new TaskState(1, 'https://example.com', {});
    const added = task.addToQueue('https://example.com'); // Same as starting URL
    expect(added).toBe(false);
  });

  test('getNextUrl removes and returns URL from queue', () => {
    const task = new TaskState(1, 'https://example.com', {});
    task.addToQueue('https://example.com/page2');
    
    const url = task.getNextUrl();
    expect(url).toBe('https://example.com/'); // URL gets normalized with trailing slash
    expect(task.queue).not.toContain('https://example.com/');
  });

  test('getNextUrl returns null when queue is empty', () => {
    const task = new TaskState(1, 'https://example.com', {});
    task.queue = [];
    const url = task.getNextUrl();
    expect(url).toBe(null);
  });

  test('addContent stores content for URL', () => {
    const task = new TaskState(1, 'https://example.com', {});
    const content = { title: 'Test', textContent: 'Test content' };
    
    task.addContent('https://example.com', content);
    expect(task.contentMap.get('https://example.com/')).toBe(content); // URL gets normalized
  });

  test('addContent ignores duplicate content for same URL', () => {
    const task = new TaskState(1, 'https://example.com', {});
    const content1 = { title: 'Test 1', textContent: 'Content 1' };
    const content2 = { title: 'Test 2', textContent: 'Content 2' };
    
    task.addContent('https://example.com', content1);
    task.addContent('https://example.com', content2);
    
    expect(task.contentMap.get('https://example.com/')).toBe(content1); // URL gets normalized
  });

  test('markAsFinishing prevents race conditions', () => {
    const task = new TaskState(1, 'https://example.com', { maxPages: 1 });
    task.processed = 1;
    task.inProgress = 0;
    
    // First call should succeed
    expect(task.markAsFinishing()).toBe(true);
    expect(task.isFinishing).toBe(true);
    
    // Second call should fail
    expect(task.markAsFinishing()).toBe(false);
  });

  test('markAsFinished sets final state', () => {
    const task = new TaskState(1, 'https://example.com', {});
    task.markAsFinishing();
    task.markAsFinished();
    
    expect(task.isFinishing).toBe(false);
    expect(task.isFinished).toBe(true);
  });

  test('hasActiveScraping returns correct status', () => {
    const task = new TaskState(1, 'https://example.com', {});
    
    expect(task.hasActiveScraping()).toBe(false);
    
    task.inProgress = 2;
    expect(task.hasActiveScraping()).toBe(true);
  });

  test('toJSON serializes task state correctly', () => {
    const task = new TaskState(1, 'https://example.com', { maxPages: 10 });
    task.addContent('https://example.com', { title: 'Test', textContent: 'Content' });
    task.processed = 1;
    
    const json = task.toJSON();
    
    expect(json.taskId).toBe(1);
    expect(json.startingUrl).toBe('https://example.com/'); // URL gets normalized
    expect(json.processed).toBe(1);
    expect(json.contentMap).toEqual([['https://example.com/', { title: 'Test', textContent: 'Content' }]]); // URL gets normalized
  });

  test('fromJSON restores task state correctly', () => {
    const data = {
      taskId: 1,
      startingUrl: 'https://example.com',
      startingDomain: 'example.com',
      settings: { maxPages: 10, concurrency: 2 },
      queue: ['https://example.com/page2'],
      visited: ['https://example.com', 'https://example.com/page2'],
      processed: 1,
      contentMap: [['https://example.com', { title: 'Test', textContent: 'Content' }]],
    };
    
    const task = TaskState.fromJSON(data);
    
    expect(task.taskId).toBe(1);
    expect(task.processed).toBe(1);
    expect(task.queue).toContain('https://example.com/page2');
    expect(task.visited.has('https://example.com')).toBe(true);
    expect(task.contentMap.get('https://example.com')).toEqual({ title: 'Test', textContent: 'Content' });
  });

  test('fromJSON handles invalid data gracefully', () => {
    const invalidData = null; // Completely invalid - null data
    const task = TaskState.fromJSON(invalidData);
    
    expect(task).toBe(null);
  });

  test('fromJSON sanitizes corrupted data', () => {
    const corruptedData = {
      taskId: 1,
      startingUrl: 'https://example.com',
      settings: { maxPages: 5000, concurrency: 50 }, // Invalid values
      queue: ['invalid-url', 'https://example.com/valid'],
      visited: ['invalid-url', 'https://example.com'],
      processed: -5, // Invalid value
    };
    
    const task = TaskState.fromJSON(corruptedData);
    
    expect(task).not.toBe(null);
    expect(task.settings.maxPages).toBe(600); // Clamped to max
    expect(task.settings.concurrency).toBe(10); // Clamped to max
    expect(task.processed).toBe(0); // Clamped to minimum
  });

  test('markChanged triggers save callback after timeout', (done) => {
    const task = new TaskState(1, 'https://example.com', {});
    const mockSaveCallback = jest.fn();
    task.setSaveCallback(mockSaveCallback);
    
    task.markChanged();
    
    // Should not be called immediately
    expect(mockSaveCallback).not.toHaveBeenCalled();
    
    // Should be called after timeout
    setTimeout(() => {
      expect(mockSaveCallback).toHaveBeenCalledWith(task);
      done();
    }, 2100);
  });

  test('forceSave calls callback immediately', () => {
    const task = new TaskState(1, 'https://example.com', {});
    const mockSaveCallback = jest.fn();
    task.setSaveCallback(mockSaveCallback);
    
    task.markChanged();
    const result = task.forceSave();
    
    expect(result).toBe(true);
    expect(mockSaveCallback).toHaveBeenCalledWith(task);
    expect(task.hasUnsavedChanges).toBe(false);
  });
});