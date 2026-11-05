import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve('.');

describe('extension build', () => {
  test('copies the offscreen page into dist', async () => {
    await execFileAsync('node', ['scripts/build.js'], { cwd: rootDir });

    expect(fs.existsSync(path.join(rootDir, 'dist/src/offscreen/offscreen.html'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, 'dist/src/offscreen/offscreen.js'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, 'dist/manifest.json'))).toBe(true);
  });
});
