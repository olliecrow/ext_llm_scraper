import { safeRuntime } from '../shared/safeChromeAPI.js';
import { contentResourceManager } from './contentResourceManager.js';

// Enhanced content script with better memory management
(async () => {
  // Add performance monitoring
  const startTime = performance.now();
  
  try {
    // Check if extension context is still valid before proceeding
    if (!contentResourceManager.isExtensionContextValid()) {
      console.debug('Extension context invalid, skipping content script execution');
      return;
    }

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
      
      // Element covers significant portion of viewport
      const coverageThreshold = 0.4;
      const coverage = (rect.width * rect.height) / (viewportWidth * viewportHeight);
      
      if (coverage > coverageThreshold) {
        // Check if element is positioned to block content
        const style = window.getComputedStyle(element);
        const isFixed = style.position === 'fixed';
        const isAbsolute = style.position === 'absolute';
        const hasHighZIndex = parseInt(style.zIndex) > 100;
        
        if ((isFixed || isAbsolute) && hasHighZIndex) {
          return true;
        }
      }
      
      return false;
    }

    // Helper function to check for authentication keywords
    function containsAuthKeywords(text) {
      const authKeywords = [
        'sign in', 'sign up', 'log in', 'login', 'subscribe', 'create account',
        'register', 'join now', 'get access', 'unlock', 'premium', 'paywall',
        'subscription required', 'members only', 'please login', 'authentication required'
      ];
      
      return authKeywords.some(keyword => text.includes(keyword));
    }

    // Enhanced element waiting with resource management
    function waitForElement(selector, timeout = 5000) {
      return new Promise((resolve) => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }

        let attempts = 0;
        const maxAttempts = timeout / 50;
        
        const checkElement = () => {
          attempts++;
          const element = document.querySelector(selector);
          if (element) {
            resolve(element);
          } else if (attempts < maxAttempts) {
            // Use resource manager for timeout
            contentResourceManager.setTimeout(checkElement, 50);
          } else {
            resolve(null);
          }
        };

        contentResourceManager.setTimeout(checkElement, 50);
      });
    }

    // Check for authentication wall first
    const authWall = detectAuthenticationWall();
    if (authWall) {
      console.debug(`Authentication wall detected: ${authWall.reason}`);
      try {
        await safeRuntime.sendMessage({
          taskId: window.taskId,
          url: window.location.href,
          authWall: authWall
        });
      } catch (error) {
        console.warn('Failed to send auth wall message:', error.message);
      }
      return;
    }

    // Wait for content to load, but with timeout
    if (document.readyState !== 'complete') {
      console.debug('Waiting for document to load...');
      
      // Use resource manager to wait with timeout
      await new Promise(resolve => {
        if (document.readyState === 'complete') {
          resolve();
          return;
        }

        const onLoad = () => {
          contentResourceManager.removeEventListener(document, 'readystatechange', onLoad);
          resolve();
        };

        contentResourceManager.addEventListener(document, 'readystatechange', onLoad);
        
        // Fallback timeout
        contentResourceManager.setTimeout(resolve, 10000);
      });
    }

    // Additional wait for dynamic content (with resource manager)
    await new Promise(resolve => contentResourceManager.setTimeout(resolve, 1000));

    // Get page title
    const title = document.title?.trim() || 'Untitled';

    // Extract main content with enhanced selectors
    const contentSelectors = [
      'main article',
      'main',
      'article',
      '[role="main"]',
      '.main-content',
      '.content',
      '#content',
      '.post-content',
      '.entry-content',
      '.article-content',
      'body'
    ];

    let content = '';
    let contentElement = null;

    for (const selector of contentSelectors) {
      contentElement = document.querySelector(selector);
      if (contentElement && contentElement.textContent?.trim()) {
        content = contentElement.textContent.trim();
        if (content.length > 100) {
          break;
        }
      }
    }

    if (!content && document.body) {
      content = document.body.textContent?.trim() || '';
    }

    // Extract links with improved filtering and resource management
    const linkElements = Array.from(document.querySelectorAll('a[href]'));
    const baseUrl = new URL(window.location.href);
    const currentDomain = baseUrl.hostname;

    const links = linkElements
      .map(link => {
        try {
          const href = link.href;
          if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) {
            return null;
          }

          const url = new URL(href, baseUrl);
          
          // Filter out non-content URLs
          const excludePatterns = [
            'wp-admin', 'admin', 'login', 'register', 'signin', 'signup',
            'auth', 'account', 'profile', 'settings', 'dashboard',
            'cart', 'checkout', 'payment', 'subscribe', 'donation',
            'contact', 'about', 'privacy', 'terms', 'legal',
            'search', 'tag', 'category', 'archive', 'feed', 'rss',
            'api/', '/api', 'ajax', 'json', 'xml'
          ];

          const lowercaseUrl = url.pathname.toLowerCase();
          if (excludePatterns.some(pattern => lowercaseUrl.includes(pattern))) {
            return null;
          }

          // Filter out file downloads
          const downloadPatterns = ['.pdf', '.doc', '.zip', '.exe', '.dmg', '.app'];
          if (downloadPatterns.some(pattern => lowercaseUrl.includes(pattern))) {
            return null;
          }

          return url.href;
        } catch {
          return null;
        }
      })
      .filter(link => link !== null)
      .filter(Boolean);

    // Send the extracted content with error handling
    try {
      await safeRuntime.sendMessage({
        taskId: window.taskId,
        url: window.location.href,
        title,
        content,
        links,
      });

      // Log performance metrics
      const endTime = performance.now();
      const executionTime = endTime - startTime;
      
      if (executionTime > 2000) { // Slow execution > 2s
        console.warn(`Content script slow execution: ${executionTime.toFixed(2)}ms for ${window.location.href}`);
      }

      console.debug(`Content script completed in ${executionTime.toFixed(2)}ms`, {
        title: title.substring(0, 50),
        contentLength: content.length,
        linksCount: links.length,
        memoryStats: contentResourceManager.getMemoryStats()
      });

    } catch (error) {
      console.warn('Failed to send content message:', error.message);
    }

  } catch (error) {
    console.error(`Error in enhanced content script for ${window.location.href}:`, error);
    
    // Send error message with fallback
    try {
      await safeRuntime.sendMessage({ 
        taskId: window.taskId, 
        url: window.location.href, 
        skip: true,
        error: error.message 
      });
    } catch (sendError) {
      console.warn('Failed to send error skip message:', sendError.message);
    }
  } finally {
    // Clean up resources
    console.debug('Content script execution finished, cleaning up resources');
  }
})();