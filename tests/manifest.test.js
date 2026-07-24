import fs from 'fs';
import path from 'path';

const rootDir = path.resolve('.');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));

describe('extension manifest', () => {
  test('declares only the permissions used by the extension', () => {
    expect(manifest.permissions).toEqual(['downloads', 'scripting']);
    expect(manifest.host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(manifest).not.toHaveProperty('web_accessible_resources');
  });

  test('references files included in the source tree', () => {
    expect(fs.existsSync(path.join(rootDir, manifest.background.service_worker))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, manifest.action.default_popup))).toBe(true);
  });
});
