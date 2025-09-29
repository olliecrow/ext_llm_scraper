import { TaskState } from '../src/background/taskState.js';

const START_URL = 'https://example.com/posts/welcome?ref=123#top';

describe('TaskState', () => {
  test('normalises starting URL and domain', () => {
    const task = new TaskState(1, START_URL, {});
    expect(task.startingUrl).toBe('https://example.com/posts/welcome');
    expect(task.startingDomain).toBe('example.com');
    expect(task.settings.concurrency).toBe(10);
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

  test('tracks visited URLs and prevents duplicates', () => {
    const task = new TaskState(1, START_URL, {});
    const addedFirst = task.addToQueue('https://example.com/about');
    const addedDuplicate = task.addToQueue('https://example.com/about');

    expect(addedFirst).toBe(true);
    expect(addedDuplicate).toBe(false);
    expect(task.queue).toContain('https://example.com/about');
  });

  test('respects max page limit when queuing links', () => {
    const task = new TaskState(1, START_URL, { maxPages: 3 });
    expect(task.addToQueue('https://example.com/page-1')).toBe(true);
    expect(task.addToQueue('https://example.com/page-2')).toBe(true);
    expect(task.addToQueue('https://example.com/page-3')).toBe(false);
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

  test('serialises and deserialises state', () => {
    const task = new TaskState(1, START_URL, { maxPages: 5 });
    task.addContent('https://example.com/posts/welcome', {
      title: 'Welcome',
      textContent: 'Hello world',
    });
    task.addToQueue('https://example.com/about');
    task.processed = 1;

    const serialised = task.toJSON();
    const revived = TaskState.fromJSON(serialised);

    expect(revived).not.toBeNull();
    expect(revived?.queue).toContain('https://example.com/about');
    expect(revived?.contentMap.get('https://example.com/posts/welcome')).toEqual({
      title: 'Welcome',
      textContent: 'Hello world',
    });
  });
});
