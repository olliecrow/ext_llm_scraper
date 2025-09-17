import { PageScraper } from '../src/background/scraper.js';
import { TaskManager } from '../src/background/taskManager.js';
import { TaskState } from '../src/background/taskState.js';

const createTask = () => new TaskState(1, 'https://example.com', { maxPages: 5, concurrency: 1 });

describe('PageScraper', () => {
  let scraper;
  let taskManager;
  let task;

  beforeEach(() => {
    taskManager = new TaskManager();
    scraper = new PageScraper(taskManager);
    task = createTask();
  });

  test('returns false for invalid URLs', async () => {
    const result = await scraper.scrape(task, 'not-a-url');
    expect(result).toBe(false);
    expect(task.processed).toBe(0);
  });

  test('skips excluded extensions', async () => {
    const result = await scraper.scrape(task, 'https://example.com/file.pdf');
    expect(result).toBe(false);
    expect(task.processed).toBe(0);
  });

  test('extracts content and queues links', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([{ result: null }])
      .mockResolvedValueOnce([
      {
        result: {
          url: 'https://example.com/about',
          title: 'About',
          content: 'About page content',
          links: ['https://example.com/team', 'https://other.com/skip'],
        },
      },
    ]);

    const result = await scraper.scrape(task, 'https://example.com/about');

    expect(result).toBe(true);
    expect(task.processed).toBe(1);
    expect(task.contentMap.get('https://example.com/about')).toEqual({
      title: 'About',
      textContent: 'About page content',
    });
    expect(task.queue).toContain('https://example.com/team');
    expect(task.queue).not.toContain('https://other.com/skip');
  });
});
