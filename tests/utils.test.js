import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrl,
  isValidUrl,
  extractDomain,
  hasExcludedExtension,
  generateFilename,
  sameSiteHost,
  isSameSite,
  splitText,
  delay,
} from '../src/shared/utils.js';

describe('URL Normalization', () => {
  test('removes hash fragments', () => {
    const url = 'https://example.com/page#section';
    assert.equal(normalizeUrl(url), 'https://example.com/page');
  });

  test('removes tracking parameters and keeps page parameters', () => {
    assert.equal(
      normalizeUrl('https://example.com/page?utm_source=x&id=1'),
      'https://example.com/page?id=1'
    );
    assert.notEqual(
      normalizeUrl('https://example.com/item?id=1'),
      normalizeUrl('https://example.com/item?id=2')
    );
    assert.equal(
      normalizeUrl('https://example.com/item?id=1&utm_source=x'),
      'https://example.com/item?id=1'
    );
    assert.equal(normalizeUrl('https://example.com/p?b=2&a=1'), 'https://example.com/p?a=1&b=2');
    assert.equal(
      normalizeUrl('https://example.com/p?FbClId=abc&id=9'),
      'https://example.com/p?id=9'
    );
  });

  test('removes anchors and tracking parameters', () => {
    assert.equal(
      normalizeUrl('https://example.com/page?utm_campaign=a&id=1#section'),
      'https://example.com/page?id=1'
    );
  });

  test('preserves path structure', () => {
    const url = 'https://example.com/path/to/page';
    assert.equal(normalizeUrl(url), 'https://example.com/path/to/page');
  });

  test('handles URLs with port numbers', () => {
    assert.equal(
      normalizeUrl('https://example.com:8080/page?test=1'),
      'https://example.com:8080/page?test=1'
    );
    assert.equal(normalizeUrl('https://example.com:443/page'), 'https://example.com/page');
  });

  test('returns original URL if invalid', () => {
    const invalidUrl = 'not-a-valid-url';
    assert.equal(normalizeUrl(invalidUrl), invalidUrl);
  });

  test('collapses one trailing slash and keeps the root', () => {
    assert.equal(normalizeUrl('https://example.com/docs/'), 'https://example.com/docs');
    assert.equal(normalizeUrl('https://example.com/page/?id=1'), 'https://example.com/page?id=1');
    assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
    assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
  });
});

describe('same site', () => {
  test('matches a host with its www form only', () => {
    assert.equal(sameSiteHost('example.com', 'www.example.com'), true);
    assert.equal(sameSiteHost('WWW.Example.com', 'example.com'), true);
    assert.equal(sameSiteHost('example.com', 'example.com'), true);
    assert.equal(sameSiteHost('blog.example.com', 'example.com'), false);
    assert.equal(sameSiteHost('', 'example.com'), false);
  });

  test('allows http and https on the standard ports and rejects a different port', () => {
    assert.equal(isSameSite('https://example.com/a', 'http://www.example.com/b'), true);
    assert.equal(isSameSite('https://example.com/a', 'https://example.com:443/b'), true);
    assert.equal(isSameSite('https://example.com/a', 'https://example.com:8443/admin'), false);
    assert.equal(isSameSite('https://example.com:8443/start', 'https://example.com/home'), false);
    assert.equal(
      isSameSite('https://example.com:8443/start', 'http://example.com:8443/also'),
      true
    );
    assert.equal(isSameSite('https://example.com/a', 'https://other.example.com/'), false);
    assert.equal(isSameSite('not a url', 'https://example.com/'), false);
  });
});

describe('URL Validation', () => {
  test('accepts valid HTTP URLs', () => {
    assert.equal(isValidUrl('http://example.com'), true);
  });

  test('accepts valid HTTPS URLs', () => {
    assert.equal(isValidUrl('https://example.com'), true);
  });

  test('accepts local HTTP URLs selected by the user', () => {
    assert.equal(isValidUrl('http://localhost:3000'), true);
    assert.equal(isValidUrl('http://192.168.1.10'), true);
  });

  test('rejects non-HTTP protocols', () => {
    assert.equal(isValidUrl('ftp://example.com'), false);
    assert.equal(isValidUrl('file:///path/to/file'), false);
    assert.equal(isValidUrl('javascript:alert(1)'), false);
  });

  test('rejects invalid URLs', () => {
    assert.equal(isValidUrl('not-a-url'), false);
    assert.equal(isValidUrl(''), false);
    assert.equal(isValidUrl(null), false);
  });
});

describe('Domain Extraction', () => {
  test('extracts domain from simple URL', () => {
    assert.equal(extractDomain('https://example.com/path'), 'example.com');
  });

  test('extracts domain with subdomain', () => {
    assert.equal(extractDomain('https://www.example.com/path'), 'www.example.com');
  });

  test('handles URLs with port', () => {
    assert.equal(extractDomain('https://example.com:8080/path'), 'example.com');
  });

  test('handles invalid URLs gracefully', () => {
    assert.equal(extractDomain('invalid-url'), '');
  });
});

describe('File Extension Filtering', () => {
  const excludedExtensions = ['.pdf', '.jpg', '.zip'];

  test('detects excluded extensions', () => {
    assert.equal(hasExcludedExtension('https://example.com/file.pdf', excludedExtensions), true);
    assert.equal(hasExcludedExtension('https://example.com/image.jpg', excludedExtensions), true);
    assert.equal(hasExcludedExtension('https://example.com/archive.zip', excludedExtensions), true);
  });

  test('allows non-excluded extensions', () => {
    assert.equal(hasExcludedExtension('https://example.com/page.html', excludedExtensions), false);
    assert.equal(hasExcludedExtension('https://example.com/script.js', excludedExtensions), false);
    assert.equal(hasExcludedExtension('https://example.com/page', excludedExtensions), false);
  });

  test('is case insensitive', () => {
    assert.equal(hasExcludedExtension('https://example.com/FILE.PDF', excludedExtensions), true);
    assert.equal(hasExcludedExtension('https://example.com/IMAGE.JPG', excludedExtensions), true);
  });

  test('detects excluded extensions before query strings and hashes', () => {
    assert.equal(
      hasExcludedExtension('https://example.com/file.pdf?download=1', excludedExtensions),
      true
    );
    assert.equal(
      hasExcludedExtension('https://example.com/archive.zip#top', excludedExtensions),
      true
    );
  });
});

describe('SPA hash routes', () => {
  test('keeps hash routes but removes normal anchors', () => {
    assert.equal(normalizeUrl('https://example.com/#/docs?tab=1'), 'https://example.com/#/docs');
    assert.equal(normalizeUrl('https://example.com/page#section'), 'https://example.com/page');
  });
});

describe('Filename Generation', () => {
  test('generates filename with domain and timestamp', () => {
    const domain = 'example.com';
    const filename = generateFilename(domain);

    assert.match(filename, /^example\.com_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/);
  });

  test('handles domain with subdomain', () => {
    const domain = 'blog.example.com';
    const filename = generateFilename(domain);

    assert.match(filename, /^blog\.example\.com_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/);
  });
});

describe('splitText', () => {
  test('keeps every piece within the size and never splits a surrogate pair', () => {
    const text = `ab😀cd😀`;
    const pieces = splitText(text, 3);
    assert.equal(pieces.join(''), text);
    assert.deepEqual(pieces, ['ab', '😀c', 'd😀']);
    assert.deepEqual(splitText('', 4), []);
    assert.deepEqual(splitText('abcdef', 4), ['abcd', 'ef']);
  });
});

describe('delay', () => {
  test('ends early when the signal aborts', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const wait = delay(60000, controller.signal);
    controller.abort();
    await wait;
    assert.ok(Date.now() - started < 1000);
    await delay(60000, controller.signal);
  });
});
