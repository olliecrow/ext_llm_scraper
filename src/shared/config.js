export const CONFIG = {
  TIMEOUTS: {
    TAB_LOAD: 12000,
    CONTENT_EXTRACTION: 7000,
    BETWEEN_REQUESTS: 150,
  },
  LIMITS: {
    MAX_PAGES: 2000,
    MIN_PAGES: 1,
    MAX_CONCURRENCY: 10,
    MIN_CONCURRENCY: 1,
    MAX_RETRIES: 3,
  },
  DEFAULTS: {
    CONCURRENCY: 5,
    MAX_PAGES: 2000,
    DELAY_MS: 0,
    CRAWL_MODE: true,
  },
  RETRY_DELAYS: [750, 1500, 3000],
  EXCLUDED_EXTENSIONS: [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.rtf', '.odt', '.ods', '.odp',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.svg', '.webp', '.ico',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
    '.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.appimage',
    '.mp4', '.avi', '.mov', '.wmv', '.mkv', '.mp3', '.wav', '.flac', '.ogg',
    '.iso', '.bin', '.torrent'
  ],
};
