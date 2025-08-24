#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version info
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

console.log(`
╔════════════════════════════════════════════════════════════════╗
║           Webpage Scraper Extension - v${packageJson.version}              ║
╚════════════════════════════════════════════════════════════════╝

📚 Quick Commands:
─────────────────

Development:
  npm run dev          → Build and watch for changes
  npm run build        → Build extension to dist/
  npm run build:watch  → Watch and rebuild on changes
  
Testing:
  npm test             → Run all tests with coverage
  npm run test:watch   → Run tests in watch mode
  npm run test:unit    → Run tests without coverage
  
Code Quality:
  npm run check        → Run all checks (format, lint, test)
  npm run check:all    → Run all checks with coverage
  npm run lint         → Check for linting issues
  npm run lint:fix     → Fix linting issues
  npm run format       → Format code with Prettier
  
Distribution:
  npm run package      → Create .zip for Chrome Web Store
  npm run clean        → Remove build artifacts
  
📂 Project Structure:
─────────────────────

  src/
    ├── background/    → Service worker modules
    ├── content/       → Content script
    ├── popup/         → Extension popup UI
    ├── lib/           → Third-party libraries
    └── shared/        → Shared utilities
  
  dist/              → Built extension (load this in Chrome)
  tests/             → Unit tests

🚀 Getting Started:
───────────────────

  1. Install dependencies:    npm install
  2. Build the extension:      npm run build
  3. Load in Chrome:
     • Open chrome://extensions/
     • Enable Developer mode
     • Click "Load unpacked"
     • Select the dist/ folder
  
🧪 Before Committing:
─────────────────────

  Run: npm run precommit
  
  This will check formatting, linting, and run tests.

📦 Creating a Release:
──────────────────────

  1. Update version in package.json
  2. Run tests: npm test
  3. Build: npm run build
  4. Package: npm run package
  5. Upload .zip to Chrome Web Store

💡 Tips:
────────

  • Use npm run dev for active development
  • Run npm run check before pushing changes
  • Keep test coverage above 80%

═══════════════════════════════════════════════════════════════════
`);

// Show current Node version
console.log(`Node Version: ${process.version}`);
console.log(`NPM Version: ${process.env.npm_version || 'Run npm -v to check'}\n`);