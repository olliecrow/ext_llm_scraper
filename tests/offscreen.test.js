import { handleOffscreenMessage } from '../src/offscreen/offscreen.js';

describe('offscreen downloads', () => {
  test('creates a blob URL for this extension and rejects other senders', () => {
    const revoked = [];
    const urlApi = {
      createObjectURL: (blob) => {
        expect(blob).toBeInstanceOf(Blob);
        return 'blob:local/markdown';
      },
      revokeObjectURL: (url) => {
        revoked.push(url);
      },
    };

    expect(
      handleOffscreenMessage(
        { action: 'create-download-url', content: '# Hi', mime: 'text/markdown' },
        { id: 'other' },
        'ext-id',
        urlApi
      )
    ).toEqual({ error: 'Rejected sender' });

    expect(
      handleOffscreenMessage(
        { action: 'create-download-url', content: '# Hi', mime: 'text/markdown' },
        { id: 'ext-id' },
        'ext-id',
        urlApi
      )
    ).toEqual({ url: 'blob:local/markdown' });

    expect(
      handleOffscreenMessage(
        { action: 'revoke-download-url', url: 'blob:local/markdown' },
        { id: 'ext-id' },
        'ext-id',
        urlApi
      )
    ).toEqual({ ok: true });
    expect(revoked).toEqual(['blob:local/markdown']);
  });
});
