/**
 * Configuration constants for the webpage scraper extension
 */

export const CONFIG = {
  TIMEOUTS: {
    TAB_LOAD: 15000, // 15 seconds
    CONTENT_RETRIEVAL: 10000, // 10 seconds (reduced for faster testing)
    ELEMENT_WAIT: 5000, // 5 seconds
  },

  LIMITS: {
    MAX_PAGES: 1000,
    MAX_CONCURRENCY: 15,
    MAX_RETRIES: 3,
    MIN_CONCURRENCY: 1,
    MIN_PAGES: 1,
  },

  DEFAULTS: {
    CONCURRENCY: 10,
    MAX_PAGES: 1000,
    DELAY: 0,
    COPY_TO_CLIPBOARD: false,
    DOWNLOAD_FILE: true,
    CRAWL_MODE: true,
  },

  RETRY_DELAYS: [1000, 2000, 4000], // Exponential backoff

  EXCLUDED_EXTENSIONS: [
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
  ],

  SITE_SPECIFIC_SELECTORS: {
    'twitter.com': '.tweet',
    'youtube.com': '#content',
    'github.com': '.markdown-body',
    'stackoverflow.com': '.answercell',
    'chatgpt.com': '.chat-container',
  },

  STORAGE_KEYS: {
    SETTINGS: 'scraper_settings',
    TASK_PREFIX: 'task_',
  },
  
  STORAGE_MANAGEMENT: {
    WARNING_THRESHOLD: 80, // Percentage of storage to trigger warning
    CRITICAL_THRESHOLD: 90, // Percentage to trigger data rotation
    EMERGENCY_THRESHOLD: 95, // Percentage for emergency measures
    MIN_CONTENT_TO_KEEP: 10, // Minimum number of pages to keep
    DEFAULT_CONTENT_LIMIT: 50, // Default pages to keep when limiting
    PROGRESSIVE_SAVE_BATCH: 10, // Pages to save in each batch
    PROGRESSIVE_SAVE_INTERVAL: 30000, // 30 seconds
    COMPRESSION_ENABLED: true, // Enable content compression by default
  },

  CONTENT_FILTERING: {
    ENABLED: true,
    MIN_CONFIDENCE: 0.7,
    MAX_REPETITIONS: 2,
    MAX_PROCESSING_TIME: 100, // ms
    MIN_CONTENT_LENGTH: 10, // Don't filter very short content
  },
};
