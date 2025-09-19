# Webpage Scraper Chrome Extension

A lightweight Chrome extension that collects readable content from a site and exports it as Markdown.

## Features
- Scrape the current page or crawl same-domain links.
- Clean Markdown output with a table of contents and per-page sections.
- Automatically downloads Markdown on completion.
- Sensible defaults (5 concurrent tabs, 2000 page cap) with configurable limits.
- Built on Mozilla Readability for consistent extraction.

## Setup
```bash
npm install
npm test
npm run build
```
The build command creates a `dist/` folder that can be loaded via `chrome://extensions` (Developer Mode → Load unpacked → choose `dist`).

## Usage
1. Open the page you want to archive.
2. Click the extension action button and adjust options if needed:
   - Crawl sub-pages (same domain only)
   - Maximum pages (1–2000)
   - Concurrent tabs (1–10)
   - Optional delay between requests
3. Press **Start**. Progress and debug messages stream in the popup.
4. Press **Stop** to cancel the task.

## Output
The generated Markdown contains:
- A table of contents linking to each captured URL.
- A section per page with the title, canonical URL, and extracted text.

## Testing & QA
- Unit tests cover task state, scraper workflow, core utilities, and Chrome wrapper logic (`npm test`).
- Manual smoke tests were run against:
  - https://robotjames.substack.com/archive
  - https://www.olliecrow.io/
  - https://developers.binance.com/en
- `npm run build` verifies the packaging step.

## Notes
- Host permissions are limited to pages the user activates through the popup.
- Default concurrency and page limits are conservative to keep Chrome responsive.
- The repository intentionally omits historical builds and debug bundles to keep the public release tidy.
