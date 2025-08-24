#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const srcDir = path.join(rootDir, 'src');

/**
 * Recursively copies files from source to destination
 */
function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  
  if (stats.isDirectory()) {
    // Create directory if it doesn't exist
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    // Copy all files in directory
    const files = fs.readdirSync(src);
    for (const file of files) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    // Copy file
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${path.relative(rootDir, src)} -> ${path.relative(rootDir, dest)}`);
  }
}

/**
 * Main build function
 */
function build() {
  console.log('Building extension...\n');
  
  // Clean dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
    console.log('Cleaned dist directory');
  }
  
  // Create dist directory
  fs.mkdirSync(distDir, { recursive: true });
  
  // Copy src directory
  copyRecursive(srcDir, path.join(distDir, 'src'));
  
  // Copy manifest.json
  fs.copyFileSync(
    path.join(rootDir, 'manifest.json'),
    path.join(distDir, 'manifest.json')
  );
  console.log('Copied: manifest.json');
  
  // Create a simple README for the dist folder
  const readmeContent = `# Webpage Scraper Extension - Distribution Build

This is the distribution build of the Webpage Scraper Chrome Extension.

## Installation

1. Open Chrome and navigate to chrome://extensions/
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select this dist folder

## Build Date
${new Date().toISOString()}
`;
  
  fs.writeFileSync(path.join(distDir, 'README.md'), readmeContent);
  console.log('Created: dist/README.md');
  
  console.log('\n✅ Build complete!');
  console.log(`Extension ready in: ${path.relative(rootDir, distDir)}`);
}

// Run build
try {
  build();
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}