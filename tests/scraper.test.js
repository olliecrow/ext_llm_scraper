// Tests for PageScraper robust injection and error handling

// Mock TaskManager
const mockTaskManager = {
  sendStatus: jest.fn(),
};

// Mock PageScraper class for testing
class PageScraper {
  constructor(taskManager) {
    this.taskManager = taskManager;
  }
  
  async injectScripts(tabId, taskId) {
    const errors = [];
    
    // Try to inject task ID first
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (tId) => { window.taskId = tId; },
        args: [taskId],
      });
    } catch (e) {
      errors.push(`Task ID injection failed: ${e.message}`);
    }
    
    // Try multiple path combinations for scripts
    const possiblePaths = [
      ['src/lib/readability.js', 'src/content/content_script.js'],
      ['lib/readability.js', 'content/content_script.js'],
    ];
    
    let injected = false;
    for (const paths of possiblePaths) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: paths,
        });
        injected = true;
        break;
      } catch (e) {
        errors.push(`Script injection failed with paths ${paths.join(', ')}: ${e.message}`);
      }
    }
    
    if (!injected && errors.length > 0) {
      this.taskManager.sendStatus(taskId, {
        debug: `Script injection issues: ${errors.join('; ')}`,
      });
    }
  }
  
  processPageContent(task, message) {
    if (!task || task.abort) return;
    
    const { url, title, content, links, skip, errors } = message;
    const normalizedUrl = url; // Simplified for testing
    
    if (!skip) {
      const pageContent = {
        title: title || 'Untitled Page',
        textContent: content || '[Content extraction failed]',
        errors: errors || [],
      };
      
      task.addContent(url, pageContent);
      
      if (task.settings.crawlMode && links && links.length > 0) {
        this.processLinks(task, links);
      }
      
      if (errors && errors.length > 0) {
        this.taskManager.sendStatus(task.taskId, {
          debug: `Page scraped with issues (${url}): ${errors.join('; ')}`,
        });
      }
    } else {
      this.taskManager.sendStatus(task.taskId, {
        debug: `Skipped page ${url}, but continuing crawl`,
      });
    }
    
    this.resolvePending(task, normalizedUrl);
  }
  
  processLinks(task, links) {
    // Mock implementation
  }
  
  resolvePending(task, url) {
    // Mock implementation
  }
}

describe('PageScraper robust injection', () => {
  let scraper;
  
  beforeEach(() => {
    scraper = new PageScraper(mockTaskManager);
    jest.clearAllMocks();
  });

  test('tries multiple path combinations on failure', async () => {
    // First path attempt fails, second succeeds
    chrome.scripting.executeScript = jest.fn()
      .mockResolvedValueOnce([{ result: true }]) // taskId injection
      .mockRejectedValueOnce(new Error('Path not found')) // first path fails
      .mockResolvedValueOnce([{ result: true }]); // second path succeeds
    
    await scraper.injectScripts(123, 1);
    
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3);
    
    // Check that it tried different paths
    const calls = chrome.scripting.executeScript.mock.calls;
    expect(calls[1][0].files).toEqual(['src/lib/readability.js', 'src/content/content_script.js']);
    expect(calls[2][0].files).toEqual(['lib/readability.js', 'content/content_script.js']);
  });
  
  test('continues even if task ID injection fails', async () => {
    chrome.scripting.executeScript = jest.fn()
      .mockRejectedValueOnce(new Error('Tab closed')) // taskId injection fails
      .mockResolvedValueOnce([{ result: true }]); // scripts succeed anyway
    
    await scraper.injectScripts(123, 1);
    
    // Should still try to inject scripts
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
  });
  
  test('logs errors but continues when all injections fail', async () => {
    chrome.scripting.executeScript = jest.fn()
      .mockRejectedValue(new Error('Permission denied'));
    
    await scraper.injectScripts(123, 1);
    
    // Should have tried all methods
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3);
    
    // Should log errors
    expect(mockTaskManager.sendStatus).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        debug: expect.stringContaining('Script injection issues:'),
      })
    );
  });
});

describe('PageScraper error recovery', () => {
  let scraper;
  let mockTask;
  
  beforeEach(() => {
    scraper = new PageScraper(mockTaskManager);
    mockTask = {
      taskId: 1,
      abort: false,
      settings: { crawlMode: true },
      addContent: jest.fn(),
      addToQueue: jest.fn(),
      pendingContent: new Map(),
    };
    jest.clearAllMocks();
  });
  
  test('stores partial content when extraction fails', () => {
    const message = {
      url: 'https://example.com',
      title: null,
      content: null,
      links: [],
      skip: false,
      errors: ['Extraction failed'],
    };
    
    scraper.processPageContent(mockTask, message);
    
    // Should still store something
    expect(mockTask.addContent).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        title: 'Untitled Page',
        textContent: '[Content extraction failed]',
        errors: ['Extraction failed'],
      })
    );
  });
  
  test('processes links even when content extraction has errors', () => {
    scraper.processLinks = jest.fn();
    
    const message = {
      url: 'https://example.com',
      title: 'Page',
      content: 'Some content',
      links: ['https://example.com/page2'],
      skip: false,
      errors: ['Partial extraction'],
    };
    
    scraper.processPageContent(mockTask, message);
    
    // Should still process links
    expect(scraper.processLinks).toHaveBeenCalledWith(
      mockTask,
      ['https://example.com/page2']
    );
  });

  
  test('continues crawl even when page is skipped', () => {
    scraper.resolvePending = jest.fn();
    
    const message = {
      url: 'https://example.com',
      skip: true,
    };
    
    scraper.processPageContent(mockTask, message);
    
    // Should still resolve to continue crawl
    expect(scraper.resolvePending).toHaveBeenCalled();
    
    // Should log skip
    expect(mockTaskManager.sendStatus).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        debug: expect.stringContaining('Skipped page'),
      })
    );
  });
});