import { TaskState } from '../src/background/taskState.js';

const START_URL = 'https://example.com/posts/welcome?ref=123#top';

describe('TaskState', () => {
  test('normalises starting URL and domain', () => {
    const task = new TaskState(1, START_URL, {});
    expect(task.startingUrl).toBe('https://example.com/posts/welcome');
    expect(task.startingDomain).toBe('example.com');
    expect(task.settings.concurrency).toBe(3);
    expect(task.settings.maxPages).toBe(50);
    expect(task.settings.crawlMode).toBe(false);
  });

  test('clamps settings to configured limits', () => {
    const task = new TaskState(1, START_URL, {
      maxPages: 9999,
      concurrency: 9999,
      delay: -10,
    });

    expect(task.settings.maxPages).toBe(2000);
    expect(task.settings.concurrency).toBe(15);
    expect(task.settings.delay).toBe(0);
  });

  test('normalises numeric settings to whole pages and workers', () => {
    const task = new TaskState(1, START_URL, {
      maxPages: 3.9,
      concurrency: 2.8,
      crawlMode: 'false',
    });

    expect(task.settings.maxPages).toBe(3);
    expect(task.settings.concurrency).toBe(2);
    expect(task.settings.crawlMode).toBe(false);
  });

  test('keeps functional query strings distinct and collapses a trailing slash', () => {
    const task = new TaskState(1, 'https://example.com/docs', { maxPages: 10 });

    expect(task.addToQueue('https://example.com/docs/')).toBe(false);
    expect(task.addToQueue('https://example.com/item?id=1')).toBe(true);
    expect(task.addToQueue('https://example.com/item?id=2')).toBe(true);
    expect(task.addToQueue('https://example.com/item?id=1&utm_source=x')).toBe(false);
    expect(task.queue).toEqual([
      'https://example.com/docs',
      'https://example.com/item?id=1',
      'https://example.com/item?id=2',
    ]);
  });

  test('tracks visited URLs and prevents duplicates', () => {
    const task = new TaskState(1, START_URL, {});
    const addedFirst = task.addToQueue('https://example.com/about');
    const addedDuplicate = task.addToQueue('https://example.com/about');

    expect(addedFirst).toBe(true);
    expect(addedDuplicate).toBe(false);
    expect(task.queue).toContain('https://example.com/about');
  });

  test('keeps a backlog past the saved-page cap', () => {
    const task = new TaskState(1, START_URL, { maxPages: 2 });
    expect(task.addToQueue('https://example.com/page-1')).toBe(true);
    expect(task.addToQueue('https://example.com/page-2')).toBe(true);
    expect(task.addToQueue('https://example.com/page-3')).toBe(true);
    expect(task.addToQueue('https://example.com/page-4')).toBe(true);
    expect(task.queue).toHaveLength(5);
  });

  test('stops scheduling once enough pages are in progress', () => {
    const task = new TaskState(1, START_URL, { maxPages: 2 });
    task.addToQueue('https://example.com/page-1');
    task.addToQueue('https://example.com/page-2');
    task.getNextUrl();
    task.getNextUrl();
    task.inProgress = 2;

    expect(task.queue.length).toBeGreaterThan(0);
    expect(task.canSchedule()).toBe(false);
  });

  test('schedules a replacement after a failed attempt', () => {
    const task = new TaskState(1, START_URL, { maxPages: 2 });
    task.addToQueue('https://example.com/next');
    task.attempts = 1;

    expect(task.contentMap.size).toBe(0);
    expect(task.inProgress).toBe(0);
    expect(task.canSchedule()).toBe(true);
  });

  test('clamps a huge delay to one minute', () => {
    const task = new TaskState(1, START_URL, { delay: 999999999 });
    expect(task.settings.delay).toBe(60000);
  });

  test('stops scheduling after twice as many attempts as the page cap', () => {
    const task = new TaskState(1, START_URL, { maxPages: 2 });
    task.attempts = 4;

    expect(task.canSchedule()).toBe(false);
    expect(task.queue).toHaveLength(1);
  });

  test('refuses links once the backlog cap is full', () => {
    const task = new TaskState(1, START_URL, { maxPages: 1 });

    expect(task.addToQueue('https://example.com/a')).toBe(true);
    expect(task.addToQueue('https://example.com/b')).toBe(true);
    expect(task.addToQueue('https://example.com/c')).toBe(true);
    expect(task.addToQueue('https://example.com/d')).toBe(false);
  });

  test('canSchedule requires queue capacity and respects abort flag', () => {
    const task = new TaskState(1, START_URL, { concurrency: 1, maxPages: 1 });

    expect(task.canSchedule()).toBe(true);
    task.abort = true;
    expect(task.canSchedule()).toBe(false);
  });

  test('getNextUrl shifts queue safely', () => {
    const task = new TaskState(1, START_URL, {});
    task.addToQueue('https://example.com/next');

    expect(task.getNextUrl()).toBe('https://example.com/posts/welcome');
    expect(task.getNextUrl()).toBe('https://example.com/next');
    expect(task.getNextUrl()).toBeNull();
  });

  test('tracks completion state correctly', () => {
    const task = new TaskState(1, START_URL, { maxPages: 1 });

    expect(task.isComplete()).toBe(false);
    task.queue = [];
    task.inProgress = 0;
    expect(task.isComplete()).toBe(true);
    expect(task.markAsFinishing()).toBe(true);
    expect(task.markAsFinishing()).toBe(false);
    task.markAsFinished();
    expect(task.isFinished).toBe(true);
  });
});
