/**
 * Utility functions for the webpage scraper extension
 */

import { CONFIG } from './config.js';

const TRACKING_PARAM_SET = new Set(CONFIG.TRACKING_PARAMS.map((name) => name.toLowerCase()));

/**
 * Checks if a hash fragment represents a SPA route rather than an anchor
 * @param {string} hash - The hash fragment to check (including #)
 * @returns {boolean} - Whether this looks like a SPA route
 */
function isSPARoute(hash) {
  if (!hash || hash === '#') {
    return false;
  }

  // Common SPA route patterns:
  // - Starts with #/ (hash routing)
  // - Starts with #! (hashbang routing)
  // - Contains path-like segments but not simple anchors
  const spaPatterns = [
    /^#\//, // Hash routing: #/about, #/projects
    /^#!/, // Hashbang: #!/about
    /^#[a-zA-Z0-9-_]+\//, // Named routes with paths: #app/view
  ];

  // Check if it matches SPA patterns
  if (spaPatterns.some((pattern) => pattern.test(hash))) {
    return true;
  }

  // Additional check: if hash contains multiple segments, likely a route
  const segments = hash
    .slice(1)
    .split('/')
    .filter((s) => s.length > 0);
  if (segments.length > 1) {
    return true;
  }

  // Check if it looks like a complex route (has special chars suggesting routing)
  if (hash.includes('?') || hash.includes('=')) {
    return true;
  }

  return false;
}

function compareText(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Normalizes a URL for crawl identity.
 * Tracking parameters are removed. Other query parameters stay, in sorted order.
 * One trailing slash is removed from a non-root path.
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
    const kept = [];

    for (const [key, value] of urlObj.searchParams.entries()) {
      if (!TRACKING_PARAM_SET.has(key.toLowerCase())) {
        kept.push([key, value]);
      }
    }

    kept.sort((left, right) => compareText(left[0], right[0]) || compareText(left[1], right[1]));
    urlObj.search = '';
    for (const [key, value] of kept) {
      urlObj.searchParams.append(key, value);
    }

    if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

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
  } catch {
    return url;
  }
}

/**
 * Returns true when two hostnames are equal, or one is the www form of the other.
 * Other subdomains stay distinct.
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function sameSiteHost(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (!a || !b) {
    return false;
  }
  return a === b || a === `www.${b}` || b === `www.${a}`;
}

function explicitPort(urlObj) {
  if (urlObj.port) {
    return urlObj.port;
  }
  if (urlObj.protocol === 'https:') {
    return '443';
  }
  if (urlObj.protocol === 'http:') {
    return '80';
  }
  return '';
}

/**
 * Same site means the www/apex host pair and a matching port.
 * HTTP and HTTPS are both allowed. A non-default port must match exactly,
 * so a crawl on port 443 does not follow port 8443, and a custom-port crawl
 * does not follow ports 80 or 443.
 * @param {string} leftUrl
 * @param {string} rightUrl
 * @returns {boolean}
 */
export function isSameSite(leftUrl, rightUrl) {
  let left;
  let right;
  try {
    left = new URL(leftUrl);
    right = new URL(rightUrl);
  } catch {
    return false;
  }

  if (!sameSiteHost(left.hostname, right.hostname)) {
    return false;
  }

  const leftPort = explicitPort(left);
  const rightPort = explicitPort(right);
  if (leftPort === rightPort) {
    return true;
  }

  const standard = new Set(['80', '443']);
  return standard.has(leftPort) && standard.has(rightPort);
}

/**
 * Validates whether a URL can be opened by the scraper.
 * @param {string} url - The URL to validate
 * @returns {boolean} - Whether the URL is valid
 */
export function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return ['http:', 'https:'].includes(urlObj.protocol);
  } catch {
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
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return excludedExtensions.some((ext) => pathname.endsWith(ext));
  } catch {
    const lowercaseUrl = String(url).toLowerCase();
    return excludedExtensions.some((ext) => lowercaseUrl.endsWith(ext));
  }
}

/**
 * Extracts the domain from a URL
 * @param {string} url - The URL to extract domain from
 * @returns {string} - The domain
 */
export function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
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
