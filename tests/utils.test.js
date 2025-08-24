// Tests for utility functions from the existing codebase
import { normalizeUrl, isValidUrl, extractDomain, hasExcludedExtension, generateFilename } from '../src/shared/utils.js';

describe('URL Normalization', () => {

  test('removes hash fragments', () => {
    const url = 'https://example.com/page#section';
    expect(normalizeUrl(url)).toBe('https://example.com/page');
  });

  test('removes query parameters', () => {
    const url = 'https://example.com/page?param=value&other=123';
    expect(normalizeUrl(url)).toBe('https://example.com/page');
  });

  test('removes both hash and query parameters', () => {
    const url = 'https://example.com/page?param=value#section';
    expect(normalizeUrl(url)).toBe('https://example.com/page');
  });

  test('preserves path structure', () => {
    const url = 'https://example.com/path/to/page';
    expect(normalizeUrl(url)).toBe('https://example.com/path/to/page');
  });

  test('handles URLs with port numbers', () => {
    const url = 'https://example.com:8080/page?test=1';
    expect(normalizeUrl(url)).toBe('https://example.com:8080/page');
  });

  test('returns original URL if invalid', () => {
    const invalidUrl = 'not-a-valid-url';
    expect(normalizeUrl(invalidUrl)).toBe(invalidUrl);
  });

  test('handles URLs with trailing slash', () => {
    const url = 'https://example.com/page/?query=test';
    expect(normalizeUrl(url)).toBe('https://example.com/page/');
  });
});

describe('URL Validation', () => {
  test('accepts valid HTTP URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  test('accepts valid HTTPS URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
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