/**
 * Content filtering configuration
 * Defines patterns for removing boilerplate content from scraped pages
 */

export function getDefaultFilterConfig() {
  return {
    minConfidence: 0.7,
    maxRepetitions: 2,
    patterns: [
      // High confidence exact matches
      {
        id: 'cookie-policy-exact',
        type: 'exact',
        priority: 100,
        confidence: 0.99,
        pattern:
          'Cookie PolicyWe use necessary cookies to make our site work. With your consent, we also set performance and functionality cookies that help us make improvements by measuring traffic on our site and we process respective personal data. You can withdraw your consent at any time. For more detailed information about the cookies, your personal data and your rights, please see our privacy policy.',
        replacement: '',
        skipInCode: true,
      },
      {
        id: 'cookie-policy-start',
        type: 'smart',
        priority: 95,
        confidence: 0.9,
        pattern: /^Cookie Policy/,
        skipInCode: true,
      },

      // Subscription prompts
      {
        id: 'subscription-cta',
        type: 'regex',
        priority: 90,
        confidence: 0.85,
        source: 'Why subscribe\\?[\\s\\S]{0,500}',
        flags: 'gi',
        replacement: '',
        skipInCode: true,
      },
      {
        id: 'subscribe-simple',
        type: 'smart',
        priority: 85,
        confidence: 0.8,
        pattern: /^Subscribe to .{0,100}$/,
        skipInCode: true,
      },

      // Privacy and legal
      {
        id: 'privacy-footer',
        type: 'smart',
        priority: 80,
        confidence: 0.75,
        pattern: /For more detailed information about the cookies.*privacy policy\.?$/i,
        skipInCode: true,
      },
      {
        id: 'terms-of-service',
        type: 'smart',
        priority: 75,
        confidence: 0.75,
        pattern: /^Terms of Service|^Privacy Policy|^Cookie Policy$/i,
        skipInCode: true,
      },

      // Author bio blocks
      {
        id: 'author-bio',
        type: 'regex',
        priority: 70,
        confidence: 0.85,
        source: 'PeopleQuantitative Researcher[\\s\\S]{0,200}Break the exchange',
        flags: 'g',
        replacement: '',
        skipInCode: true,
      },
      {
        id: 'not-financial-advice',
        type: 'regex',
        priority: 72,
        confidence: 0.9,
        source: 'Not financial advice\\. Views solely my own\\.',
        flags: 'g',
        replacement: '',
        skipInCode: true,
      },

      // Navigation elements
      {
        id: 'navigation-links',
        type: 'smart',
        priority: 60,
        confidence: 0.65,
        pattern: /^(Home|About|Archive|Contact|Sitemap) - /,
        skipInCode: true,
      },
    ],
  };
}

/**
 * Site-specific configurations
 * Extends default config with site-specific patterns
 */
export const SITE_CONFIGS = {
  'algos.org': {
    extends: 'default',
    patterns: [
      {
        id: 'quant-stack-promo',
        type: 'exact',
        priority: 95,
        confidence: 0.98,
        pattern: 'Subscribe to The Quant Stack',
        replacement: '',
        skipInCode: true,
      },
      {
        id: 'quant-stack-header',
        type: 'smart',
        priority: 92,
        confidence: 0.9,
        pattern: /^The Quant Stack \| Quant Arb \| Substack$/,
        skipInCode: true,
      },
    ],
  },
  'medium.com': {
    extends: 'default',
    patterns: [
      {
        id: 'medium-clap',
        type: 'regex',
        priority: 85,
        confidence: 0.8,
        source: '👏{1,}\\s*\\d+',
        flags: 'g',
        replacement: '',
        skipInCode: false,
      },
      {
        id: 'medium-signup',
        type: 'smart',
        priority: 88,
        confidence: 0.85,
        pattern: /Sign up with Google|Open in app/,
        skipInCode: true,
      },
    ],
  },
  'substack.com': {
    extends: 'default',
    patterns: [
      {
        id: 'substack-subscribe',
        type: 'smart',
        priority: 90,
        confidence: 0.85,
        pattern: /Subscribe now|Upgrade to paid/,
        skipInCode: true,
      },
    ],
  },
};

/**
 * Get configuration for a specific site
 * @param {string} hostname - The hostname of the site
 * @returns {Object} Configuration object
 */
export function getSiteConfig(hostname) {
  // Check for exact match first
  if (SITE_CONFIGS[hostname]) {
    const siteConfig = SITE_CONFIGS[hostname];
    if (siteConfig.extends === 'default') {
      const defaultConfig = getDefaultFilterConfig();
      return {
        ...defaultConfig,
        patterns: [...defaultConfig.patterns, ...siteConfig.patterns],
      };
    }
    return siteConfig;
  }

  // Check for partial match (e.g., "blog.example.com" matches "example.com")
  for (const [domain, config] of Object.entries(SITE_CONFIGS)) {
    if (hostname.includes(domain)) {
      if (config.extends === 'default') {
        const defaultConfig = getDefaultFilterConfig();
        return {
          ...defaultConfig,
          patterns: [...defaultConfig.patterns, ...config.patterns],
        };
      }
      return config;
    }
  }

  // Return default config
  return getDefaultFilterConfig();
}
