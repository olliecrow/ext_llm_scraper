#!/usr/bin/env node

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.join(__dirname, '..', 'dist');
const ROOT_DIR = path.join(__dirname, '..');

const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const version = packageJson.version;
const extensionName = 'webpage-scraper';

if (!fs.existsSync(DIST_DIR)) {
  console.error('dist/ directory not found. Run "npm run build" first.');
  process.exit(1);
}

const outputFilename = `${extensionName}-v${version}.zip`;
const outputPath = path.join(ROOT_DIR, outputFilename);

if (fs.existsSync(outputPath)) {
  fs.unlinkSync(outputPath);
}

execFile('zip', ['-r', '-q', outputPath, '.'], { cwd: DIST_DIR }, (error) => {
  if (error) {
    if (error.code === 'ENOENT') {
      console.error('Install the zip command to package the extension.');
      process.exit(1);
    }
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Package created: ${outputFilename}`);
});
