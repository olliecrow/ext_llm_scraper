import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve('.');

describe('extension build', () => {
  test('copies the offscreen page into dist', async () => {
    await execFileAsync('node', ['scripts/build.js'], { cwd: rootDir });

    assert.equal(fs.existsSync(path.join(rootDir, 'dist/src/offscreen/offscreen.html')), true);
    assert.equal(fs.existsSync(path.join(rootDir, 'dist/src/offscreen/offscreen.js')), true);
    assert.equal(fs.existsSync(path.join(rootDir, 'dist/manifest.json')), true);
  });
});
