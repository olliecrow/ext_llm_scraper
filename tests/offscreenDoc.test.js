import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createChromeMock } from './chrome-mock.js';
import {
  ensureOffscreenDocument,
  holdOffscreenDocument,
  OFFSCREEN_OPTIONS,
} from '../src/background/offscreenDoc.js';

describe('offscreen document lifetime', () => {
  test('two first users create one document and close nothing', async () => {
    const chromeApi = createChromeMock();

    await Promise.all([ensureOffscreenDocument(chromeApi), ensureOffscreenDocument(chromeApi)]);

    assert.equal(chromeApi.offscreen.createDocument.mock.callCount(), 1);
    assert.equal(chromeApi.offscreen.closeDocument.mock.callCount(), 0);
    assert.equal(chromeApi.offscreen.isOpen(), true);
    assert.deepEqual(OFFSCREEN_OPTIONS.reasons, ['DOM_PARSER', 'BLOBS']);
  });

  test('closes only after the last holder finishes', async () => {
    const chromeApi = createChromeMock();
    let releaseFirst;
    const first = holdOffscreenDocument(chromeApi, async () => {
      await ensureOffscreenDocument(chromeApi);
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
    });
    await holdOffscreenDocument(chromeApi, () => ensureOffscreenDocument(chromeApi));

    assert.equal(chromeApi.offscreen.isOpen(), true);
    releaseFirst();
    await first;
    assert.equal(chromeApi.offscreen.isOpen(), false);
    assert.equal(chromeApi.offscreen.closeDocument.mock.callCount(), 1);
  });

  test('a failed close does not fail the holder', async () => {
    const chromeApi = createChromeMock();
    chromeApi.offscreen.closeDocument.mock.mockImplementation(() => {
      throw new Error('close failed');
    });

    const result = await holdOffscreenDocument(chromeApi, async () => {
      await ensureOffscreenDocument(chromeApi);
      return 'done';
    });

    assert.equal(result, 'done');
  });
});
