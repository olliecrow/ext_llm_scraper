/**
 * Utility functions for the webpage scraper extension
 */

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
  } catch (_) {
    return url;
  }
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
  } catch (_) {
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
