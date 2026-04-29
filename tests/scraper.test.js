import { PageScraper, extractPageContent } from '../src/background/scraper.js';
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
    chrome.scripting.executeScript.mockResolvedValueOnce([{ result: null }]).mockResolvedValueOnce([
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

  test('does not scrape when task is already aborted', async () => {
    task.abort = true;

    const result = await scraper.scrape(task, 'https://example.com/about');

    expect(result).toBe(false);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  test('queues only valid same-domain links when crawl mode is enabled', () => {
    scraper.enqueueDiscoveredLinks(task, [
      'https://example.com/team',
      'https://example.com/team?ref=1',
      'https://other.com/skip',
      'mailto:test@example.com',
      null,
    ]);

    expect(task.queue).toContain('https://example.com/team');
    expect(task.queue.filter((url) => url === 'https://example.com/team')).toHaveLength(1);
    expect(task.queue).not.toContain('https://other.com/skip');
  });
});

describe('extractPageContent', () => {
  afterEach(() => {
    delete window.Readability;
  });

  test('uses Readability when it returns useful text', () => {
    document.body.innerHTML = `
      <main>Fallback content</main>
      <a href="https://example.com/a">A</a>
      <a href="mailto:test@example.com">Mail</a>
    `;
    document.title = 'Original title';
    window.Readability = class {
      parse() {
        return {
          title: 'Readable title',
          textContent: 'Readable content with enough text to use. '.repeat(5),
        };
      }
    };

    const result = extractPageContent();

    expect(result.title).toBe('Readable title');
    expect(result.content).toContain('Readable content with enough text to use.');
    expect(result.links).toEqual(['https://example.com/a']);
  });

  test('falls back to main page text when Readability is missing', () => {
    document.body.innerHTML = '<main></main>';
    document.querySelector('main').innerText = 'Main content '.repeat(30);

    const result = extractPageContent();

    expect(result.content).toContain('Main content');
  });

  test('uses body text as the last content fallback', () => {
    document.body.innerHTML = '<section>No main content</section>';
    document.body.innerText = 'Body text fallback';

    const result = extractPageContent();

    expect(result.content).toBe('Body text fallback');
  });
});
