#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

const SRC_DIR = path.join(__dirname, '..', 'src');
const DEBOUNCE_DELAY = 1000; // 1 second debounce

let debounceTimer = null;
let isBuilding = false;

console.log('🔍 Watching for changes in src/ directory...');
console.log('Press Ctrl+C to stop\n');

async function rebuild() {
  if (isBuilding) {
    console.log('⏳ Build already in progress, skipping...');
    return;
  }

  isBuilding = true;
  console.log('🔨 Rebuilding extension...');
  
  try {
    const startTime = Date.now();
    await execAsync('npm run build');
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Build completed in ${duration}s\n`);
  } catch (error) {
    console.error('❌ Build failed:', error.message);
  } finally {
    isBuilding = false;
  }
}

function watchDirectory(dir) {
  fs.watch(dir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    
    // Ignore certain files
    if (filename.includes('.test.js') || 
        filename.includes('.spec.js') ||
        filename.startsWith('.') ||
        filename.includes('node_modules')) {
      return;
    }

    console.log(`📝 ${eventType}: ${filename}`);
    
    // Debounce rebuilds to avoid multiple rapid builds
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(rebuild, DEBOUNCE_DELAY);
  });
}

// Watch the src directory
watchDirectory(SRC_DIR);

// Also watch manifest.json
fs.watch(path.join(__dirname, '..', 'manifest.json'), (eventType) => {
  console.log(`📝 ${eventType}: manifest.json`);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(rebuild, DEBOUNCE_DELAY);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Stopping file watcher...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Stopping file watcher...');
  process.exit(0);
});