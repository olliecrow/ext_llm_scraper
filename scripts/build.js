#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const srcDir = path.join(rootDir, 'src');

function shouldSkipEntry(name) {
  return name === '.DS_Store' || name === 'Thumbs.db' || name.startsWith('._');
}

function build() {
  console.log('Building extension...');

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  fs.cpSync(srcDir, path.join(distDir, 'src'), {
    recursive: true,
    filter: (source) => !shouldSkipEntry(path.basename(source)),
  });
  fs.copyFileSync(path.join(rootDir, 'manifest.json'), path.join(distDir, 'manifest.json'));

  console.log('Build complete.');
  console.log(`Extension ready in: ${path.relative(rootDir, distDir)}`);
}

try {
  build();
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
