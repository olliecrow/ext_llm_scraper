// Tests for utility functions from the existing codebase
import {
  normalizeUrl,
  isValidUrl,
  extractDomain,
  hasExcludedExtension,
  generateFilename,
  sameSiteHost,
  isSameSite,
} from '../src/shared/utils.js';

describe('URL Normalization', () => {
  test('removes hash fragments', () => {
    const url = 'https://example.com/page#section';
    expect(normalizeUrl(url)).toBe('https://example.com/page');
  });

  test('removes tracking parameters and keeps page parameters', () => {
    expect(normalizeUrl('https://example.com/page?utm_source=x&id=1')).toBe(
      'https://example.com/page?id=1'
    );
    expect(normalizeUrl('https://example.com/item?id=1')).not.toBe(
      normalizeUrl('https://example.com/item?id=2')
    );
    expect(normalizeUrl('https://example.com/item?id=1&utm_source=x')).toBe(
      'https://example.com/item?id=1'
    );
    expect(normalizeUrl('https://example.com/p?b=2&a=1')).toBe('https://example.com/p?a=1&b=2');
    expect(normalizeUrl('https://example.com/p?FbClId=abc&id=9')).toBe(
      'https://example.com/p?id=9'
    );
  });

  test('removes anchors and tracking parameters', () => {
    expect(normalizeUrl('https://example.com/page?utm_campaign=a&id=1#section')).toBe(
      'https://example.com/page?id=1'
    );
  });

  test('preserves path structure', () => {
    const url = 'https://example.com/path/to/page';
    expect(normalizeUrl(url)).toBe('https://example.com/path/to/page');
  });

  test('handles URLs with port numbers', () => {
    expect(normalizeUrl('https://example.com:8080/page?test=1')).toBe(
      'https://example.com:8080/page?test=1'
    );
    expect(normalizeUrl('https://example.com:443/page')).toBe('https://example.com/page');
  });

  test('returns original URL if invalid', () => {
    const invalidUrl = 'not-a-valid-url';
    expect(normalizeUrl(invalidUrl)).toBe(invalidUrl);
  });

  test('collapses one trailing slash and keeps the root', () => {
    expect(normalizeUrl('https://example.com/docs/')).toBe('https://example.com/docs');
    expect(normalizeUrl('https://example.com/page/?id=1')).toBe('https://example.com/page?id=1');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });
});

describe('same site', () => {
  test('matches a host with its www form only', () => {
    expect(sameSiteHost('example.com', 'www.example.com')).toBe(true);
    expect(sameSiteHost('WWW.Example.com', 'example.com')).toBe(true);
    expect(sameSiteHost('example.com', 'example.com')).toBe(true);
    expect(sameSiteHost('blog.example.com', 'example.com')).toBe(false);
    expect(sameSiteHost('', 'example.com')).toBe(false);
  });

  test('allows http and https on the standard ports and rejects a different port', () => {
    expect(isSameSite('https://example.com/a', 'http://www.example.com/b')).toBe(true);
    expect(isSameSite('https://example.com/a', 'https://example.com:443/b')).toBe(true);
    expect(isSameSite('https://example.com/a', 'https://example.com:8443/admin')).toBe(false);
    expect(isSameSite('https://example.com:8443/start', 'https://example.com/home')).toBe(false);
    expect(isSameSite('https://example.com:8443/start', 'http://example.com:8443/also')).toBe(true);
    expect(isSameSite('https://example.com/a', 'https://other.example.com/')).toBe(false);
    expect(isSameSite('not a url', 'https://example.com/')).toBe(false);
  });
});

describe('URL Validation', () => {
  test('accepts valid HTTP URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  test('accepts valid HTTPS URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
  });

  test('accepts local HTTP URLs selected by the user', () => {
    expect(isValidUrl('http://localhost:3000')).toBe(true);
    expect(isValidUrl('http://192.168.1.10')).toBe(true);
  });

  test('rejects non-HTTP protocols', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false);
    expect(isValidUrl('file:///path/to/file')).toBe(false);
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
  });

  test('rejects invalid URLs', () => {
    expect(isValidUrl('not-a-url')).toBe(false);
    expect(isValidUrl('')).toBe(false);
    expect(isValidUrl(null)).toBe(false);
  });
});

describe('Domain Extraction', () => {
  test('extracts domain from simple URL', () => {
    expect(extractDomain('https://example.com/path')).toBe('example.com');
  });

  test('extracts domain with subdomain', () => {
    expect(extractDomain('https://www.example.com/path')).toBe('www.example.com');
  });

  test('handles URLs with port', () => {
    expect(extractDomain('https://example.com:8080/path')).toBe('example.com');
  });

  test('handles invalid URLs gracefully', () => {
    expect(extractDomain('invalid-url')).toBe('');
  });
});

describe('File Extension Filtering', () => {
  const excludedExtensions = ['.pdf', '.jpg', '.zip'];

  test('detects excluded extensions', () => {
    expect(hasExcludedExtension('https://example.com/file.pdf', excludedExtensions)).toBe(true);
    expect(hasExcludedExtension('https://example.com/image.jpg', excludedExtensions)).toBe(true);
    expect(hasExcludedExtension('https://example.com/archive.zip', excludedExtensions)).toBe(true);
  });

  test('allows non-excluded extensions', () => {
    expect(hasExcludedExtension('https://example.com/page.html', excludedExtensions)).toBe(false);
    expect(hasExcludedExtension('https://example.com/script.js', excludedExtensions)).toBe(false);
    expect(hasExcludedExtension('https://example.com/page', excludedExtensions)).toBe(false);
  });

  test('is case insensitive', () => {
    expect(hasExcludedExtension('https://example.com/FILE.PDF', excludedExtensions)).toBe(true);
    expect(hasExcludedExtension('https://example.com/IMAGE.JPG', excludedExtensions)).toBe(true);
  });

  test('detects excluded extensions before query strings and hashes', () => {
    expect(
      hasExcludedExtension('https://example.com/file.pdf?download=1', excludedExtensions)
    ).toBe(true);
    expect(hasExcludedExtension('https://example.com/archive.zip#top', excludedExtensions)).toBe(
      true
    );
  });
});

describe('SPA hash routes', () => {
  test('keeps hash routes but removes normal anchors', () => {
    expect(normalizeUrl('https://example.com/#/docs?tab=1')).toBe('https://example.com/#/docs');
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });
});

describe('Filename Generation', () => {
  test('generates filename with domain and timestamp', () => {
    const domain = 'example.com';
    const filename = generateFilename(domain);

    expect(filename).toMatch(/^example\.com_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/);
  });

  test('handles domain with subdomain', () => {
    const domain = 'blog.example.com';
    const filename = generateFilename(domain);

    expect(filename).toMatch(/^blog\.example\.com_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/);
  });
});
