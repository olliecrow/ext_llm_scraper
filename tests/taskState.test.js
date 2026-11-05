import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskState } from '../src/background/taskState.js';

const START_URL = 'https://example.com/posts/welcome?ref=123#top';

describe('TaskState', () => {
  test('normalises starting URL and domain', () => {
    const task = new TaskState(1, START_URL, {});
    assert.equal(task.startingUrl, 'https://example.com/posts/welcome');
    assert.equal(task.startingDomain, 'example.com');
    assert.equal(task.settings.concurrency, 3);
    assert.equal(task.settings.maxPages, 50);
    assert.equal(task.settings.crawlMode, false);
  });

  test('clamps settings to configured limits', () => {
    const task = new TaskState(1, START_URL, {
      maxPages: 9999,
      concurrency: 9999,
      delay: -10,
    });

    assert.equal(task.settings.maxPages, 2000);
    assert.equal(task.settings.concurrency, 15);
    assert.equal(task.settings.delay, 0);
  });

  test('normalises numeric settings to whole pages and workers', () => {
    const task = new TaskState(1, START_URL, {
      maxPages: 3.9,
      concurrency: 2.8,
      crawlMode: 'false',
    });

    assert.equal(task.settings.maxPages, 3);
    assert.equal(task.settings.concurrency, 2);
    assert.equal(task.settings.crawlMode, false);
  });

  test('keeps functional query strings distinct and collapses a trailing slash', () => {
    const task = new TaskState(1, 'https://example.com/docs', { maxPages: 10 });

    assert.equal(task.addToQueue('https://example.com/docs/'), false);
    assert.equal(task.addToQueue('https://example.com/item?id=1'), true);
    assert.equal(task.addToQueue('https://example.com/item?id=2'), true);
    assert.equal(task.addToQueue('https://example.com/item?id=1&utm_source=x'), false);
    assert.deepEqual(task.queue, [
      'https://example.com/docs',
      'https://example.com/item?id=1',
      'https://example.com/item?id=2',
    ]);
  });

  test('tracks visited URLs and prevents duplicates', () => {
    const task = new TaskState(1, START_URL, {});
    const addedFirst = task.addToQueue('https://example.com/about');
    const addedDuplicate = task.addToQueue('https://example.com/about');

    assert.equal(addedFirst, true);
    assert.equal(addedDuplicate, false);
    assert.ok(task.queue.includes('https://example.com/about'));
  });

  test('keeps a backlog past the saved-page cap', () => {
    const task = new TaskState(1, START_URL, { maxPages: 2 });
    assert.equal(task.addToQueue('https://example.com/page-1'), true);
    assert.equal(task.addToQueue('https://example.com/page-2'), true);
    assert.equal(task.addToQueue('https://example.com/page-3'), true);
    assert.equal(task.addToQueue('https://example.com/page-4'), true);
    assert.equal(task.queue.length, 5);
  });

  test('stops scheduling once enough pages are in progress', () => {
    const task = new TaskState(1, START_URL, { maxPages: 2 });
    task.addToQueue('https://example.com/page-1');
    task.addToQueue('https://example.com/page-2');
    task.getNextUrl();
    task.getNextUrl();
    task.inProgress = 2;

    assert.ok(task.queue.length > 0);
    assert.equal(task.canSchedule(), false);
  });

  test('schedules a replacement after a failed attempt', () => {
    const task = new TaskState(1, START_URL, { maxPages: 2 });
    task.addToQueue('https://example.com/next');
    task.attempts = 1;

    assert.equal(task.contentMap.size, 0);
    assert.equal(task.inProgress, 0);
    assert.equal(task.canSchedule(), true);
  });

  test('clamps a huge delay to one minute', () => {
    const task = new TaskState(1, START_URL, { delay: 999999999 });
    assert.equal(task.settings.delay, 60000);
  });

  test('stops scheduling after twice as many attempts as the page cap', () => {
    const task = new TaskState(1, START_URL, { maxPages: 2 });
    task.attempts = 4;

    assert.equal(task.canSchedule(), false);
    assert.equal(task.queue.length, 1);
  });

  test('refuses links once the backlog cap is full', () => {
    const task = new TaskState(1, START_URL, { maxPages: 1 });

    assert.equal(task.addToQueue('https://example.com/a'), true);
    assert.equal(task.addToQueue('https://example.com/b'), true);
    assert.equal(task.addToQueue('https://example.com/c'), true);
    assert.equal(task.addToQueue('https://example.com/d'), false);
  });

  test('canSchedule requires queue capacity and respects abort flag', () => {
    const task = new TaskState(1, START_URL, { concurrency: 1, maxPages: 1 });

    assert.equal(task.canSchedule(), true);
    task.abort = true;
    assert.equal(task.canSchedule(), false);
  });

  test('getNextUrl shifts queue safely', () => {
    const task = new TaskState(1, START_URL, {});
    task.addToQueue('https://example.com/next');

    assert.equal(task.getNextUrl(), 'https://example.com/posts/welcome');
    assert.equal(task.getNextUrl(), 'https://example.com/next');
    assert.equal(task.getNextUrl(), null);
  });

  test('tracks completion state correctly', () => {
    const task = new TaskState(1, START_URL, { maxPages: 1 });

    assert.equal(task.isComplete(), false);
    task.queue = [];
    task.inProgress = 0;
    assert.equal(task.isComplete(), true);
    assert.equal(task.markAsFinishing(), true);
    assert.equal(task.markAsFinishing(), false);
    task.markAsFinished();
    assert.equal(task.isFinished, true);
  });
});
