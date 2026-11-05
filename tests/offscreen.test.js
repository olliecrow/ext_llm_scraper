import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
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
});
