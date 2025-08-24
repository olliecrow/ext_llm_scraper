# Webpage Scraper Chrome Extension

A robust Chrome extension that scrapes webpage content and converts it to Markdown format for data analysis.

NOTE: use at your own risk.

## Features

- **Single Page Scraping**: Extract content from the current webpage
- **Multi-Page Crawling**: Automatically crawl and scrape multiple pages within the same domain
- **Robust Error Handling**: Continues crawling even when individual pages fail
- **Multiple Output Methods**: 
  - Download as Markdown file
  - Copy to clipboard
- **Smart Content Extraction**: Uses Mozilla's Readability.js for intelligent content parsing
- **Configurable Settings**:
  - Max pages limit (up to 1000)
  - Concurrent tabs (1-10)
  - Request delay
  - Crawl mode toggle

## Installation

### From Source

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Open Chrome and navigate to `chrome://extensions/`
5. Enable "Developer mode" in the top right
6. Click "Load unpacked"
7. Select the `dist/` folder from this project

## Usage

1. Navigate to the webpage you want to scrape
2. Click the extension icon in Chrome toolbar
3. Configure settings:
   - **Crawl sub-pages**: Enable to scrape linked pages from the same domain
   - **Max pages**: Maximum number of pages to scrape (1-1000)
   - **Concurrency**: Number of simultaneous tabs (1-10)
   - **Delay**: Milliseconds to wait between requests
   - **Copy to clipboard**: Enable to copy output to clipboard
   - **Download as file**: Enable to download as .md file
4. Click "Start" to begin scraping
5. Monitor progress in the popup
6. Output will be downloaded/copied when complete

## Development

### Project Structure

```
src/
├── background/     # Service worker and core logic
├── content/        # Content script for page extraction
├── popup/          # Extension popup UI
├── lib/            # Third-party libraries (Readability.js)
└── shared/         # Shared utilities and configuration
```

### Scripts

- `npm test` - Run unit tests
- `npm run build` - Build extension to dist/
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Output Format

The extension generates a Markdown file with:
1. Table of Contents with links to each page
2. Full content of each scraped page
3. Page URLs and titles

Example output structure:
```markdown
# Table of Contents
1. [Page Title 1](https://example.com/page1)
2. [Page Title 2](https://example.com/page2)

---

# Page Title 1
**URL:** https://example.com/page1

[Page content...]

---

# Page Title 2
**URL:** https://example.com/page2

[Page content...]
```