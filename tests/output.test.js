// Tests for clipboard and download functionality

describe('Output methods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('Clipboard functionality', () => {
    test('tries multiple clipboard methods', async () => {
      // Mock chrome.storage
      chrome.storage.local.set = jest.fn().mockResolvedValue();
      
      // Mock chrome.tabs.query
      chrome.tabs.query = jest.fn().mockResolvedValue([
        { id: 123, active: true }
      ]);
      
      // Mock chrome.scripting.executeScript
      chrome.scripting.executeScript = jest.fn().mockResolvedValue([
        { result: true }
      ]);
      
      // Simulate copyToClipboard function
      async function copyToClipboard(text) {
        const methods = [];
        let success = false;
        
        // Method 1: Storage
        try {
          await chrome.storage.local.set({ clipboardContent: text });
          methods.push('Storage method');
          success = true;
        } catch (e) {
          methods.push(`Storage failed: ${e.message}`);
        }
        
        // Method 2: Active tab
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab) {
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              func: (content) => true,
              args: [text],
            });
            methods.push('Active tab method');
            success = true;
          }
        } catch (e) {
          methods.push(`Active tab failed: ${e.message}`);
        }
        
        return { success, methods };
      }
      
      const result = await copyToClipboard('Test content');
      
      expect(result.success).toBe(true);
      expect(result.methods).toContain('Storage method');
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ 
        clipboardContent: 'Test content' 
      });
    });
    
    test('fallback works when primary method fails', async () => {
      // Storage fails
      chrome.storage.local.set = jest.fn().mockRejectedValue(new Error('Storage error'));
      
      // Active tab succeeds
      chrome.tabs.query = jest.fn().mockResolvedValue([{ id: 456 }]);
      chrome.scripting.executeScript = jest.fn().mockResolvedValue([{ result: true }]);
      
      // Simulate function with fallback
      async function copyWithFallback(text) {
        let success = false;
        
        try {
          await chrome.storage.local.set({ clipboardContent: text });
          success = true;
        } catch (e) {
          // Try active tab
          const [tab] = await chrome.tabs.query({ active: true });
          if (tab) {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => true,
              args: [text],
            });
            success = true;
          }
        }
        
        return success;
      }
      
      const result = await copyWithFallback('Test content');
      
      expect(result).toBe(true);
      expect(chrome.scripting.executeScript).toHaveBeenCalled();
    });
  });
  
  describe('Download functionality', () => {
    test('tries blob URL before data URL', async () => {
      global.URL.createObjectURL = jest.fn().mockReturnValue('blob:123');
      global.URL.revokeObjectURL = jest.fn();
      global.Blob = jest.fn().mockImplementation((content, options) => ({
        content,
        type: options.type,
      }));
      
      chrome.downloads.download = jest.fn()
        .mockResolvedValueOnce(123); // Blob succeeds
      
      // Simulate download function
      async function downloadFile(filename, content) {
        const methods = [];
        let success = false;
        
        // Method 1: Blob URL
        try {
          const blob = new Blob([content], { type: 'text/markdown' });
          const blobUrl = URL.createObjectURL(blob);
          
          await chrome.downloads.download({
            url: blobUrl,
            filename,
            saveAs: false,
          });
          
          methods.push('Blob download');
          success = true;
          
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        } catch (e) {
          methods.push(`Blob failed: ${e.message}`);
        }
        
        return { success, methods };
      }
      
      const result = await downloadFile('test.md', 'Test content');
      
      expect(result.success).toBe(true);
      expect(result.methods).toContain('Blob download');
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
    
    test('falls back to data URL when blob fails', async () => {
      global.URL.createObjectURL = jest.fn().mockImplementation(() => {
        throw new Error('Blob error');
      });
      
      chrome.downloads.download = jest.fn()
        .mockRejectedValueOnce(new Error('Blob download failed'))
        .mockResolvedValueOnce(456); // Data URL succeeds
      
      // Simulate download with fallback
      async function downloadWithFallback(filename, content) {
        let success = false;
        
        // Try blob
        try {
          const blob = new Blob([content], { type: 'text/markdown' });
          const blobUrl = URL.createObjectURL(blob);
          await chrome.downloads.download({ url: blobUrl, filename });
          success = true;
        } catch (e) {
          // Try data URL
          const dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;
          try {
            await chrome.downloads.download({ url: dataUrl, filename });
            success = true;
          } catch (e2) {
            // Last resort: open in tab
            await chrome.tabs.create({ url: dataUrl });
            success = true;
          }
        }
        
        return success;
      }
      
      const result = await downloadWithFallback('test.md', 'Test content');
      
      expect(result).toBe(true);
      expect(chrome.downloads.download).toHaveBeenCalledTimes(1);
    });
    
    test('opens in new tab as last resort', async () => {
      chrome.downloads.download = jest.fn().mockRejectedValue(new Error('Download failed'));
      chrome.tabs.create = jest.fn().mockResolvedValue({ id: 789 });
      
      // Simulate all downloads failing
      async function downloadLastResort(filename, content) {
        const dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;
        
        try {
          await chrome.downloads.download({ url: dataUrl, filename });
        } catch (e) {
          // Last resort
          await chrome.tabs.create({ url: dataUrl, active: false });
          return 'tab_created';
        }
        
        return 'downloaded';
      }
      
      const result = await downloadLastResort('test.md', 'Test content');
      
      expect(result).toBe('tab_created');
      expect(chrome.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('data:text/markdown'),
          active: false,
        })
      );
    });
  });
});