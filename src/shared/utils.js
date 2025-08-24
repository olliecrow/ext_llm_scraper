/**
 * Utility functions for the webpage scraper extension
 */

/**
 * Checks if a hash fragment represents a SPA route rather than an anchor
 * @param {string} hash - The hash fragment to check (including #)
 * @returns {boolean} - Whether this looks like a SPA route
 */
function isSPARoute(hash) {
  if (!hash || hash === '#') return false;
  
  // Common SPA route patterns:
  // - Starts with #/ (hash routing)
  // - Starts with #! (hashbang routing)
  // - Contains path-like segments but not simple anchors
  const spaPatterns = [
    /^#\//,           // Hash routing: #/about, #/projects
    /^#!/,            // Hashbang: #!/about
    /^#[a-zA-Z0-9-_]+\// // Named routes with paths: #app/view
  ];
  
  // Check if it matches SPA patterns
  if (spaPatterns.some(pattern => pattern.test(hash))) {
    return true;
  }
  
  // Additional check: if hash contains multiple segments, likely a route
  const segments = hash.slice(1).split('/').filter(s => s.length > 0);
  if (segments.length > 1) {
    return true;
  }
  
  // Check if it looks like a complex route (has special chars suggesting routing)
  if (hash.includes('?') || hash.includes('=')) {
    return true;
  }
  
  return false;
}

/**
 * Normalizes a URL by removing query parameters and optionally hash fragments
 * @param {string} url - The URL to normalize
 * @param {Object} options - Normalization options
 * @param {boolean} options.preserveSPARoutes - Whether to preserve SPA hash routes (default: true)
 * @returns {string} - The normalized URL
 */
export function normalizeUrl(url, options = {}) {
  const { preserveSPARoutes = true } = options;
  
  try {
    const urlObj = new URL(url);
    const originalHash = urlObj.hash;
    
    // Always remove query parameters
    urlObj.search = '';
    
    // Handle hash fragments based on whether they're SPA routes
    if (preserveSPARoutes && isSPARoute(originalHash)) {
      // Keep SPA routes but normalize them
      // Remove any query params within the hash
      if (originalHash.includes('?')) {
        const hashBase = originalHash.split('?')[0];
        urlObj.hash = hashBase;
      }
      // Otherwise keep the hash as-is for SPA routing
    } else {
      // Remove regular anchor hashes
      urlObj.hash = '';
    }
    
    return urlObj.toString();
  } catch (e) {
    console.warn(`Invalid URL: ${url}`);
    return url;
  }
}

/**
 * Validates if a URL is valid for scraping with SSRF protection
 * @param {string} url - The URL to validate
 * @returns {boolean} - Whether the URL is valid
 */
export function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // Protocol validation
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return false;
    }
    
    // SSRF protection: Block private IP ranges and dangerous hostnames
    const hostname = urlObj.hostname.toLowerCase();
    
    // Block localhost and loopback addresses (IPv4)
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      console.warn(`Blocked dangerous hostname: ${hostname}`);
      return false;
    }
    
    // Block IPv6 localhost and loopback addresses
    if (hostname === '::1' || hostname === '[::1]') {
      console.warn(`Blocked IPv6 localhost: ${hostname}`);
      return false;
    }
    
    // Block IPv6-mapped IPv4 addresses (critical security fix)
    if (hostname.includes('::ffff:') || hostname.includes('[::ffff:')) {
      console.warn(`Blocked IPv6-mapped IPv4 address: ${hostname}`);
      return false;
    }
    
    // Block IPv4-compatible IPv6 addresses (browsers convert [::127.0.0.1] to [::7f00:1])
    if (hostname.includes('::')) {
      // Check for dangerous hex patterns that represent private/localhost IPs
      const dangerousHexPatterns = [
        /::7f00:/,          // 127.0.0.x (localhost) 
        /::7f01:/,          // 127.1.0.x
        /::7fff:/,          // 127.255.x.x
        /::a00:/,           // 10.0.x.x (Class A private)
        /::a01:/,           // 10.1.x.x
        /::aff:/,           // 10.255.x.x
        /::c0a8:/,          // 192.168.x.x (Class C private)
        /::ac1[0-9a-f]:/,   // 172.16-31.x.x (Class B private)
        /::a9fe:/,          // 169.254.x.x (link-local)
      ];
      
      for (const pattern of dangerousHexPatterns) {
        if (pattern.test(hostname)) {
          console.warn(`Blocked IPv4-compatible IPv6 with dangerous hex pattern: ${hostname}`);
          return false;
        }
      }
      
      // Also block specific dangerous endpoints in hex
      const dangerousHexAddresses = [
        '::7f00:1',         // 127.0.0.1
        '::a9fe:a9fe',      // 169.254.169.254 (AWS metadata)
      ];
      
      for (const addr of dangerousHexAddresses) {
        if (hostname.includes(addr)) {
          console.warn(`Blocked IPv4-compatible IPv6 with dangerous address: ${hostname}`);
          return false;
        }
      }
    }
    
    // Block private IP ranges (RFC 1918)
    const privateIPPatterns = [
      /^127\./,                    // Loopback
      /^10\./,                     // Class A private
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B private  
      /^192\.168\./,               // Class C private
      /^169\.254\./,               // Link-local
      /^0\.0\.0\.0$/,              // Null address
    ];
    
    for (const pattern of privateIPPatterns) {
      if (pattern.test(hostname)) {
        console.warn(`Blocked private IP: ${hostname}`);
        return false;
      }
    }
    
    // Block common metadata service endpoints
    const blockedHostnames = [
      'metadata.google.internal',
      'metadata',
      'mds.amazonaws.com',
      '169.254.169.254'
    ];
    
    if (blockedHostnames.includes(hostname)) {
      console.warn(`Blocked metadata endpoint: ${hostname}`);
      return false;
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Checks if a URL has an excluded file extension
 * @param {string} url - The URL to check
 * @param {string[]} excludedExtensions - List of excluded extensions
 * @returns {boolean} - Whether the URL has an excluded extension
 */
export function hasExcludedExtension(url, excludedExtensions) {
  const lowercaseUrl = url.toLowerCase();
  return excludedExtensions.some((ext) => lowercaseUrl.endsWith(ext));
}

/**
 * Extracts the domain from a URL
 * @param {string} url - The URL to extract domain from
 * @returns {string} - The domain
 */
export function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

/**
 * Creates a delay promise
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} - Promise that resolves after delay
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a filename for the scraped content
 * @param {string} domain - The domain of the scraped site
 * @returns {string} - The generated filename
 */
export function generateFilename(domain) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${domain}_${timestamp}.md`;
}

/**
 * Detects if a URL uses SPA hash routing
 * @param {string} url - The URL to check
 * @returns {boolean} - Whether the URL uses SPA hash routing
 */
export function usesSPAHashRouting(url) {
  try {
    const urlObj = new URL(url);
    return isSPARoute(urlObj.hash);
  } catch (e) {
    return false;
  }
}

/**
 * Gets a delay time for SPA route changes to complete
 * @param {string} url - The URL being navigated to
 * @returns {number} - Delay in milliseconds
 */
export function getSPANavigationDelay(url) {
  if (usesSPAHashRouting(url)) {
    // Longer delay for SPA routes to ensure content loads
    return 2000;
  }
  // Standard delay for regular pages
  return 500;
}
