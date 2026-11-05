import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const rootDir = path.resolve('.');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));

describe('extension manifest', () => {
  test('declares only the permissions used by the extension', () => {
    assert.equal(manifest.minimum_chrome_version, '116');
    assert.equal(
      manifest.content_security_policy.extension_pages,
      "script-src 'self'; object-src 'none'; base-uri 'none'"
    );
    assert.deepEqual(manifest.permissions, ['activeTab', 'downloads', 'offscreen', 'scripting']);
    assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(Object.hasOwn(manifest, 'web_accessible_resources'), false);
  });

  test('references files included in the source tree', () => {
    assert.equal(fs.existsSync(path.join(rootDir, manifest.background.service_worker)), true);
    assert.equal(fs.existsSync(path.join(rootDir, manifest.action.default_popup)), true);
  });
});
