#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.join(__dirname, '..', 'dist');
const ROOT_DIR = path.join(__dirname, '..');

// Check if archiver is installed, if not, suggest installation
try {
  await import('archiver');
} catch (error) {
  console.error('❌ archiver package not found. Please install it:');
  console.error('   npm install --save-dev archiver');
  process.exit(1);
}

// Get version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const version = packageJson.version;
const extensionName = 'webpage-scraper';

// Check if dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  console.error('❌ dist/ directory not found. Please run "npm run build" first.');
  process.exit(1);
}

const outputFilename = `${extensionName}-v${version}.zip`;
const outputPath = path.join(ROOT_DIR, outputFilename);

// Remove existing zip if it exists
if (fs.existsSync(outputPath)) {
  fs.unlinkSync(outputPath);
  console.log(`🗑️  Removed existing ${outputFilename}`);
}

console.log(`📦 Creating extension package: ${outputFilename}`);

// Create a write stream for the zip file
const output = createWriteStream(outputPath);
const archive = archiver('zip', {
  zlib: { level: 9 } // Maximum compression
});

// Listen for archive warnings
archive.on('warning', (err) => {
  if (err.code === 'ENOENT') {
    console.warn('⚠️  Warning:', err.message);
  } else {
    throw err;
  }
});

// Listen for errors
archive.on('error', (err) => {
  console.error('❌ Error creating archive:', err.message);
  throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// Add the dist directory contents to the zip
archive.directory(DIST_DIR, false);

// Listen for completion
output.on('close', () => {
  const size = (archive.pointer() / 1024).toFixed(2);
  console.log(`✅ Package created: ${outputFilename} (${size} KB)`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Test the extension by loading ${outputFilename} in Chrome`);
  console.log(`   2. Upload to Chrome Web Store Developer Dashboard`);
  console.log(`   3. Or distribute the .zip file directly\n`);
});

// Finalize the archive
await archive.finalize();