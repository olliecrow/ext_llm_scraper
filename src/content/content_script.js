import { safeRuntime } from '../shared/safeChromeAPI.js';
import { contentResourceManager } from './contentResourceManager.js';

console.log('[CONTENT_SCRIPT] Content script starting execution');
console.log('[CONTENT_SCRIPT] Current URL:', window.location.href);
console.log('[CONTENT_SCRIPT] Task ID:', window.taskId);

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
    // Wait for a specific element to ensure the page is loaded
    const waitForElement = (selector, timeout = 5000) =>
      new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkElement = () => {
          if (document.querySelector(selector)) {
            resolve();
          } else if (Date.now() - startTime > timeout) {
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

    // Check if this is a SPA with hash routing
    const isSPARoute = window.location.hash && (
      window.location.hash.startsWith('#/') || 
      window.location.hash.startsWith('#!')
    );
    
    if (isSPARoute) {
      // For SPAs with hash routing, wait for main content area
      // Common SPA containers
      const spaSelectors = [
        '[data-page]',        // Data attribute based
        '.route-content',     // Class based routing content
        '.view-container',    // View containers
        '#main-content',      // ID based content
        '#app main',          // App with main element
        '#root main',         // Root with main element
        '.page-content',      // Page content class
        'main',               // HTML5 main element
        '#app',               // Common Vue/React container
        '#root',              // Common React container
        '.container',         // Bootstrap-style container
      ];
      
      // Try to find a SPA-specific selector
      for (const spaSelector of spaSelectors) {
        if (document.querySelector(spaSelector)) {
          selector = spaSelector;
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

    try {
      await waitForElement(selector);
    } catch (error) {
      console.warn(`Failed to wait for element: ${error.message}`);
      // Proceed anyway, as some content might still be scrapeable
    }

    // Enhanced authentication wall detection
    const authWallDetected = detectAuthenticationWall();
    if (authWallDetected) {
      try {
        await safeRuntime.sendMessage({ 
          taskId: window.taskId, 
          url: window.location.href, 
          skip: true,
          authWall: true,
          authType: authWallDetected.type,
          debug: `Auth wall detected: ${authWallDetected.reason}`
        });
      } catch (error) {
        console.warn('Failed to send auth wall message:', error.message);
      }
      return;
    }

    let doc;
    try {
      doc = new Readability(document.cloneNode(true)).parse();
      if (!doc || !doc.textContent) {
        throw new Error('Readability failed to parse the page');
      }
    } catch (parseError) {
      console.warn(`Readability parse failed: ${parseError.message}`);
      // Fallback: extract text from body
      const bodyText = document.body.innerText.trim();
      if (bodyText) {
        doc = { title: document.title, textContent: bodyText };
      } else {
        try {
          await safeRuntime.sendMessage({
            taskId: window.taskId,
            url: window.location.href,
            skip: true,
          });
        } catch (error) {
          console.warn('Failed to send skip message:', error.message);
        }
        return;
      }
    }

    // Safely extract title with fallbacks
    const title = doc.title || document.title || window.location.href;
    const content = doc.textContent.trim();
    const links = Array.from(document.querySelectorAll('a'))
      .map((a) => a.href)
      .filter((href) => {
        try {
          const url = new URL(href, window.location.href);
          if (url.protocol === 'mailto:') {
            return false;
          }
          
          // Include SPA hash routes even if they're on the same page
          // This ensures routes like #/projects and #/about are both crawled
          const currentUrl = new URL(window.location.href);
          if (url.hostname === currentUrl.hostname && 
              url.pathname === currentUrl.pathname &&
              url.hash && (url.hash.startsWith('#/') || url.hash.startsWith('#!'))) {
            // This is a SPA route on the same page - include it
            return true;
          }

          // Check for excluded file extensions
          const lowercaseUrl = href.toLowerCase();
          const excludedExtensions = [
            // Documents
            '.pdf',
            '.doc',
            '.docx',
            '.xls',
            '.xlsx',
            '.ppt',
            '.pptx',
            '.rtf',
            '.odt',
            '.ods',
            '.odp',
            // Images
            '.jpg',
            '.jpeg',
            '.png',
            '.gif',
            '.bmp',
            '.tiff',
            '.svg',
            '.webp',
            '.ico',
            // Archives
            '.zip',
            '.rar',
            '.7z',
            '.tar',
            '.gz',
            '.bz2',
            '.xz',
            // Executables
            '.exe',
            '.msi',
            '.dmg',
            '.pkg',
            '.deb',
            '.rpm',
            '.appimage',
            // Media
            '.mp4',
            '.avi',
            '.mov',
            '.wmv',
            '.mkv',
            '.mp3',
            '.wav',
            '.flac',
            '.ogg',
            // Other
            '.iso',
            '.bin',
            '.torrent',
          ];

          // Check file extensions
          if (excludedExtensions.some((ext) => lowercaseUrl.endsWith(ext))) {
            return false;
          }

          // Check for common download URL patterns
          const downloadPatterns = [
            '/download/',
            '/attachment/',
            '/file/',
            '/media/',
            '/uploads/',
            'download=',
            'attachment=',
            'action=download',
          ];

          if (downloadPatterns.some((pattern) => lowercaseUrl.includes(pattern))) {
            return false;
          }

          return true;
        } catch {
          return false;
        }
      });

    try {
      console.log('[CONTENT_SCRIPT] Sending content message for:', window.location.href);
      console.log('[CONTENT_SCRIPT] Content length:', content?.length || 0);
      console.log('[CONTENT_SCRIPT] Links found:', links?.length || 0);
      
      await safeRuntime.sendMessage({
        taskId: window.taskId,
        url: window.location.href,
        title,
        content,
        links,
      });
      
      console.log('[CONTENT_SCRIPT] Content message sent successfully');
    } catch (error) {
      console.warn('[CONTENT_SCRIPT] Failed to send content message:', error.message);
    }
  } catch (error) {
    console.error(`Error in content_script for ${window.location.href}:`, error);
    try {
      await safeRuntime.sendMessage({ taskId: window.taskId, url: window.location.href, skip: true });
    } catch (sendError) {
      console.warn('Failed to send error skip message:', sendError.message);
    }
  }
})();
