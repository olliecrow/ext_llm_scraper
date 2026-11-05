import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { handleOffscreenMessage } from '../src/offscreen/offscreen.js';

describe('offscreen downloads', () => {
  test('creates a blob URL for this extension and rejects other senders', () => {
    const revoked = [];
    const urlApi = {
      createObjectURL: (blob) => {
        assert.ok(blob instanceof Blob);
        return 'blob:local/markdown';
      },
      revokeObjectURL: (url) => {
        revoked.push(url);
      },
    };

    assert.deepEqual(
      handleOffscreenMessage(
        { action: 'create-download-url', content: '# Hi', mime: 'text/markdown' },
        { id: 'other' },
        'ext-id',
        urlApi
      ),
      { error: 'Rejected sender' }
    );

    assert.deepEqual(
      handleOffscreenMessage(
        { action: 'create-download-url', content: '# Hi', mime: 'text/markdown' },
        { id: 'ext-id' },
        'ext-id',
        urlApi
      ),
      { url: 'blob:local/markdown' }
    );

    assert.deepEqual(
      handleOffscreenMessage(
        { action: 'revoke-download-url', url: 'blob:local/markdown' },
        { id: 'ext-id' },
        'ext-id',
        urlApi
      ),
      { ok: true }
    );
    assert.deepEqual(revoked, ['blob:local/markdown']);
  });

  test('parses html and keeps only http links', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://example.com/',
    });
    globalThis.DOMParser = dom.window.DOMParser;
    const sentence = 'Alpha beta gamma delta epsilon. ';
    const html = `<!DOCTYPE html><html><head><title>Fetched title</title></head><body><article><p>${sentence.repeat(12)}</p><a href="https://example.com/next">Next</a><a href="/rel">Rel</a><a href="mailto:person@example.com">Mail</a></article></body></html>`;

    const result = handleOffscreenMessage(
      { action: 'parse-html', html, url: 'https://example.com/article' },
      { id: 'ext-id' },
      'ext-id'
    );

    assert.equal(result.title, 'Fetched title');
    assert.match(result.content, /Alpha beta gamma delta epsilon/);
    assert.deepEqual(result.links, ['https://example.com/next', 'https://example.com/rel']);
  });
});
