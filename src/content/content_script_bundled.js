// Bundled content script without ES6 imports - compatible with chrome.scripting.executeScript

console.log('[CONTENT_SCRIPT] Bundled content script starting execution');
console.log('[CONTENT_SCRIPT] Current URL:', window.location.href);
console.log('[CONTENT_SCRIPT] Task ID:', window.taskId);

// Inline SafeRuntime implementation (simplified for content script use)
const safeRuntime = {
  sendMessage: async function(message) {
    console.log('[CONTENT_SCRIPT] Attempting to send message:', message);
    
    if (!chrome?.runtime?.sendMessage) {
      console.error('[CONTENT_SCRIPT] Chrome runtime sendMessage not available');
      throw new Error('Chrome runtime sendMessage not available');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('[CONTENT_SCRIPT] Message timeout after 5 seconds');
        reject(new Error('Message send timeout'));
      }, 5000);
      
      try {
        chrome.runtime.sendMessage(message, (response) => {
          clearTimeout(timeout);
          
          if (chrome.runtime.lastError) {
            console.error('[CONTENT_SCRIPT] Runtime error:', chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log('[CONTENT_SCRIPT] Message sent successfully, response:', response);
            resolve(response);
          }
        });
      } catch (error) {
        clearTimeout(timeout);
        console.error('[CONTENT_SCRIPT] Error sending message:', error);
        reject(error);
      }
    });
  }
};

// Inline ContentResourceManager (simplified)
const contentResourceManager = {
  timers: new Set(),
  
  setTimeout: function(callback, delay) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, delay);
    this.timers.add(id);
    return id;
  },
  
  clearTimeout: function(id) {
    clearTimeout(id);
    this.timers.delete(id);
  }
};

// Detect various types of authentication walls
function detectAuthenticationWall() {
  // Check for modal overlays that block content
  const modalSelectors = [
    '[role="dialog"]',
    '.modal',
    '.overlay',
    '.popup',
    '[data-testid*="modal"]',
    '.subscription-modal',
    '.paywall',
    '.signin-wall'
  ];
  
  for (const selector of modalSelectors) {
    const modal = document.querySelector(selector);
    if (modal && isBlockingElement(modal)) {
      // Check if it contains auth-related content
      const modalText = modal.innerText?.toLowerCase() || '';
      if (containsAuthKeywords(modalText)) {
        return { type: 'modal', reason: `Blocking modal with auth content detected` };
      }
    }
  }

  // Check for Substack-specific patterns
  if (window.location.hostname.includes('substack.com')) {
    // Substack shows a subscription prompt after a few free articles
    const subscribePrompt = document.querySelector('.subscription-widget-wrap, .paywall-content, .subscribe-dialog');
    if (subscribePrompt) {
      return { type: 'substack-paywall', reason: 'Substack subscription wall detected' };
    }
    
    // Check for the "Let me read it first" modal
    const letMeReadModal = Array.from(document.querySelectorAll('button')).find(
      btn => btn.innerText?.toLowerCase().includes('let me read')
    );
    if (letMeReadModal) {
      return { type: 'substack-modal', reason: 'Substack "Let me read" modal detected' };
    }
  }

  // Check page title and body for auth indicators
  const pageTitle = document.title?.toLowerCase() || '';
  const bodyText = document.body?.innerText?.toLowerCase() || '';
  
  // Strong indicators in title
  const titleAuthKeywords = ['sign in', 'sign up', 'log in', 'login', 'subscribe', 'create account', 'register'];
  if (titleAuthKeywords.some(keyword => pageTitle.includes(keyword))) {
    return { type: 'auth-page', reason: `Auth page detected in title: "${document.title}"` };
  }
  
  // Check for forms that look like login/signup
  const forms = document.querySelectorAll('form');
  for (const form of forms) {
    const formText = form.innerText?.toLowerCase() || '';
    const hasEmailInput = form.querySelector('input[type="email"], input[name*="email"]');
    const hasPasswordInput = form.querySelector('input[type="password"]');
    
    if ((hasEmailInput || hasPasswordInput) && containsAuthKeywords(formText)) {
      // Check if this form is blocking the main content
      if (isBlockingElement(form.closest('.modal, .overlay, [role="dialog"]') || form)) {
        return { type: 'auth-form', reason: 'Blocking authentication form detected' };
      }
    }
  }
  
  // Check for cookie consent that blocks interaction
  const cookieSelectors = ['.cookie-consent', '.cookie-banner', '#cookie-notice', '[class*="cookie"]', '[id*="cookie"]'];
  for (const selector of cookieSelectors) {
    const element = document.querySelector(selector);
    if (element && isBlockingElement(element)) {
      return { type: 'cookie-wall', reason: 'Blocking cookie consent detected' };
    }
  }
  
  // Check if main content area is obscured or disabled
  const mainContent = document.querySelector('main, article, [role="main"], .content, #content');
  if (mainContent) {
    const computedStyle = window.getComputedStyle(mainContent);
    if (computedStyle.pointerEvents === 'none' || 
        computedStyle.userSelect === 'none' ||
        parseFloat(computedStyle.opacity) < 0.5) {
      return { type: 'content-blocked', reason: 'Main content is disabled or obscured' };
    }
  }
  
  return null;
}

// Helper function to check if an element is blocking content
function isBlockingElement(element) {
  if (!element) return false;
  
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  
  // Check if element covers significant portion of viewport
  const coverage = (rect.width * rect.height) / (viewportWidth * viewportHeight);
  if (coverage > 0.5) return true;
  
  // Check if element has high z-index (likely overlay)
  const computedStyle = window.getComputedStyle(element);
  const zIndex = parseInt(computedStyle.zIndex, 10);
  if (zIndex > 1000) return true;
  
  // Check for fixed/sticky positioning that might block scrolling
  if (computedStyle.position === 'fixed' && coverage > 0.3) return true;
  
  return false;
}

// Helper function to check for auth-related keywords
function containsAuthKeywords(text) {
  if (!text) return false;
  
  const keywords = [
    'sign in', 'signin', 'sign up', 'signup', 'log in', 'login',
    'subscribe', 'subscription', 'create account', 'register',
    'continue reading', 'unlock', 'premium', 'members only',
    'paywall', 'paid content', 'exclusive access', 'free trial',
    'already a member', 'not a member', 'join now', 'get access'
  ];
  
  return keywords.some(keyword => text.includes(keyword));
}

(async () => {
  try {
    console.log('[CONTENT_SCRIPT] Starting main execution');
    
    // Wait for a specific element to ensure the page is loaded
    const waitForElement = (selector, timeout = 5000) =>
      new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkElement = () => {
          if (document.querySelector(selector)) {
            console.log('[CONTENT_SCRIPT] Found element:', selector);
            resolve();
          } else if (Date.now() - startTime > timeout) {
            console.log('[CONTENT_SCRIPT] Timeout waiting for:', selector);
            reject(new Error(`Timeout waiting for ${selector}`));
          } else {
            contentResourceManager.setTimeout(checkElement, 50);
          }
        };
        checkElement();
      });

    // Define selectors for specific sites
    const selectors = {
      'twitter.com': '.tweet',
      'youtube.com': '#content',
      'chatgpt.com': '.chat-container',
    };

    const hostname = new URL(window.location.href).hostname;
    let selector = selectors[hostname];

    // Check for Docsify and wait for dynamic content
    if (window.$docsify) {
      selector = '#app > *'; // Wait for #app to have child elements
    }
    
    // Substack-specific content loading
    if (hostname.includes('substack.com')) {
      console.log('[CONTENT_SCRIPT] Detected Substack, using specific selectors');
      selector = '.post, .post-preview, .single-post, .archive-item, .pencraft';
      
      // Wait longer for Substack's JavaScript content to load
      console.log('[CONTENT_SCRIPT] Waiting extra time for Substack content...');
      await new Promise(resolve => contentResourceManager.setTimeout(resolve, 3000));
    }

    // Check if this is a SPA with hash routing
    const isSPARoute = window.location.hash && (
      window.location.hash.startsWith('#/') || 
      window.location.hash.startsWith('#!')
    );
    
    if (isSPARoute) {
      console.log('[CONTENT_SCRIPT] Detected SPA route:', window.location.hash);
      // For SPAs with hash routing, wait for main content area
      const spaSelectors = [
        '[data-page]',
        '.route-content',
        '.view-container',
        '#main-content',
        '#app main',
        '#root main',
        '.page-content',
        'main',
        '#app',
        '#root',
        '.container',
      ];
      
      // Try to find a SPA-specific selector
      for (const spaSelector of spaSelectors) {
        if (document.querySelector(spaSelector)) {
          selector = spaSelector;
          console.log('[CONTENT_SCRIPT] Using SPA selector:', selector);
          break;
        }
      }
      
      // Add extra delay for SPA content to render
      await new Promise(resolve => contentResourceManager.setTimeout(resolve, 1000));
    }

    // Default to 'body' if no specific selector is set
    if (!selector) {
      selector = 'body';
    }

    console.log('[CONTENT_SCRIPT] Waiting for element:', selector);
    try {
      await waitForElement(selector);
    } catch (error) {
      console.warn(`[CONTENT_SCRIPT] Failed to wait for element: ${error.message}`);
      // Proceed anyway, as some content might still be scrapeable
    }

    console.log('[CONTENT_SCRIPT] Checking for authentication walls');
    // Enhanced authentication wall detection
    const authWallDetected = detectAuthenticationWall();
    if (authWallDetected) {
      console.log('[CONTENT_SCRIPT] Auth wall detected:', authWallDetected);
      try {
        await safeRuntime.sendMessage({ 
          taskId: window.taskId, 
          url: window.location.href, 
          skip: true,
          authWall: true,
          authType: authWallDetected.type,
          debug: `Auth wall detected: ${authWallDetected.reason}`
        });
        console.log('[CONTENT_SCRIPT] Auth wall message sent');
      } catch (error) {
        console.warn('[CONTENT_SCRIPT] Failed to send auth wall message:', error.message);
      }
      return;
    }

    console.log('[CONTENT_SCRIPT] Processing page content with Readability');
    let doc;
    try {
      // Check if Readability is available
      if (typeof Readability === 'undefined') {
        throw new Error('Readability library not available');
      }
      
      doc = new Readability(document.cloneNode(true)).parse();
      if (!doc || !doc.textContent) {
        throw new Error('Readability failed to parse the page');
      }
      console.log('[CONTENT_SCRIPT] Readability parsing successful, content length:', doc.textContent.length);
    } catch (parseError) {
      console.warn(`[CONTENT_SCRIPT] Readability parse failed: ${parseError.message}`);
      
      // Enhanced fallback extraction for Substack and other JS-heavy sites
      let fallbackContent = '';
      let fallbackTitle = document.title || window.location.href;
      
      // Try Substack-specific selectors
      if (hostname.includes('substack.com')) {
        console.log('[CONTENT_SCRIPT] Trying Substack-specific content extraction');
        const substackSelectors = [
          '.single-post .body', // Individual post body
          '.post-content', // Post content
          '.markup', // Substack markup content
          '.pencraft', // New Substack editor content
          'article', // HTML5 article tag
          '[data-testid="post-content"]', // Test ID based
          '.post .body.markup' // Nested post body
        ];
        
        for (const sel of substackSelectors) {
          const element = document.querySelector(sel);
          if (element && element.innerText.trim().length > 100) {
            fallbackContent = element.innerText.trim();
            console.log('[CONTENT_SCRIPT] Found content using selector:', sel, 'length:', fallbackContent.length);
            break;
          }
        }
      }
      
      // Generic fallback
      if (!fallbackContent) {
        console.log('[CONTENT_SCRIPT] Trying generic content extraction');
        const genericSelectors = [
          'main', 'article', '.content', '#content', '.post', '.entry'
        ];
        
        for (const sel of genericSelectors) {
          const element = document.querySelector(sel);
          if (element && element.innerText.trim().length > 100) {
            fallbackContent = element.innerText.trim();
            console.log('[CONTENT_SCRIPT] Found content using generic selector:', sel, 'length:', fallbackContent.length);
            break;
          }
        }
      }
      
      // Last resort: body text
      if (!fallbackContent) {
        fallbackContent = document.body.innerText.trim();
        console.log('[CONTENT_SCRIPT] Using body text as last resort, length:', fallbackContent.length);
      }
      
      if (fallbackContent && fallbackContent.length > 50) {
        doc = { title: fallbackTitle, textContent: fallbackContent };
        console.log('[CONTENT_SCRIPT] Using fallback text extraction, final length:', fallbackContent.length);
      } else {
        console.log('[CONTENT_SCRIPT] No meaningful content found, sending skip message');
        try {
          await safeRuntime.sendMessage({
            taskId: window.taskId,
            url: window.location.href,
            skip: true,
            debug: `No content found - body length: ${document.body.innerText.length}`
          });
          console.log('[CONTENT_SCRIPT] Skip message sent');
        } catch (error) {
          console.warn('[CONTENT_SCRIPT] Failed to send skip message:', error.message);
        }
        return;
      }
    }

    // Safely extract title with fallbacks
    const title = doc.title || document.title || window.location.href;
    const content = doc.textContent.trim();
    
    console.log('[CONTENT_SCRIPT] Extracting links');
    const links = Array.from(document.querySelectorAll('a'))
      .map((a) => a.href)
      .filter((href) => {
        try {
          const url = new URL(href, window.location.href);
          if (url.protocol === 'mailto:') {
            return false;
          }
          
          // Include SPA hash routes even if they're on the same page
          const currentUrl = new URL(window.location.href);
          if (url.hostname === currentUrl.hostname && 
              url.pathname === currentUrl.pathname &&
              url.hash && (url.hash.startsWith('#/') || url.hash.startsWith('#!'))) {
            return true;
          }

          // Check for excluded file extensions
          const lowercaseUrl = href.toLowerCase();
          const excludedExtensions = [
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.rtf', '.odt', '.ods', '.odp',
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.svg', '.webp', '.ico',
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
            '.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.appimage',
            '.mp4', '.avi', '.mov', '.wmv', '.mkv', '.mp3', '.wav', '.flac', '.ogg',
            '.iso', '.bin', '.torrent',
          ];

          if (excludedExtensions.some((ext) => lowercaseUrl.endsWith(ext))) {
            return false;
          }

          // Check for common download URL patterns
          const downloadPatterns = [
            '/download/', '/attachment/', '/file/', '/media/', '/uploads/',
            'download=', 'attachment=', 'action=download',
          ];

          if (downloadPatterns.some((pattern) => lowercaseUrl.includes(pattern))) {
            return false;
          }

          return true;
        } catch {
          return false;
        }
      });

    console.log('[CONTENT_SCRIPT] Sending content message for:', window.location.href);
    console.log('[CONTENT_SCRIPT] Content length:', content?.length || 0);
    console.log('[CONTENT_SCRIPT] Links found:', links?.length || 0);
    
    const contentMessage = {
      taskId: window.taskId,
      url: window.location.href,
      title,
      content,
      links,
    };
    
    // Try multiple methods to send the content
    let messageSent = false;
    
    // Method 1: safeRuntime with timeout
    try {
      await safeRuntime.sendMessage(contentMessage);
      console.log('[CONTENT_SCRIPT] Content message sent successfully via safeRuntime');
      messageSent = true;
    } catch (error) {
      console.warn('[CONTENT_SCRIPT] safeRuntime method failed:', error.message);
    }
    
    // Method 2: Direct chrome.runtime.sendMessage (fallback)
    if (!messageSent && chrome?.runtime?.sendMessage) {
      try {
        console.log('[CONTENT_SCRIPT] Trying direct chrome.runtime.sendMessage');
        chrome.runtime.sendMessage(contentMessage, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[CONTENT_SCRIPT] Direct method error:', chrome.runtime.lastError.message);
          } else {
            console.log('[CONTENT_SCRIPT] Direct method success, response:', response);
            messageSent = true;
          }
        });
        
        // Give direct method a moment
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (messageSent) {
          console.log('[CONTENT_SCRIPT] Content message sent successfully via direct method');
        }
      } catch (directError) {
        console.warn('[CONTENT_SCRIPT] Direct method also failed:', directError.message);
      }
    }
    
    if (!messageSent) {
      console.error('[CONTENT_SCRIPT] All message sending methods failed');
    }
  } catch (error) {
    console.error(`[CONTENT_SCRIPT] Error in content_script for ${window.location.href}:`, error);
    try {
      await safeRuntime.sendMessage({ taskId: window.taskId, url: window.location.href, skip: true });
      console.log('[CONTENT_SCRIPT] Error skip message sent');
    } catch (sendError) {
      console.warn('[CONTENT_SCRIPT] Failed to send error skip message:', sendError.message);
    }
  }
})();