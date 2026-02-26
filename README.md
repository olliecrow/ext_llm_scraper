# Webpage Scraper Chrome Extension

A lightweight Chrome extension that collects readable content from a site and exports it as Markdown.

## What this project is trying to achieve

Help you archive a page, or a set of related pages on the same domain, into one clean Markdown file.

## What you experience as a user

1. Open the page you want to capture.
2. Choose whether to scrape just this page or crawl same-domain links.
3. Click start and watch progress in the popup.
4. Download one Markdown file with a table of contents and page sections.

## Quick start

```bash
npm install
npm test
npm run build
```

Load `dist/` in Chrome.

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Choose `dist`.

## Usage

1. Open the page you want to archive.
2. Click the extension action button and adjust options if needed.
3. Press Start.
4. Press Stop to cancel.

Available options.

- crawl sub-pages on the same domain
- maximum pages, from 1 to 2000
- concurrent tabs, from 1 to 15
- optional delay between requests

## Output

The generated Markdown includes.

- a table of contents with captured URLs
- one section per page with title, canonical URL, and extracted text

## Testing and QA

- Unit tests cover state flow, scraper workflow, utility functions, and Chrome wrappers.
- Manual smoke tests were run against representative sites.
- `npm run build` verifies packaging.

## Notes

- Host permissions are limited to pages you activate through the popup.
- Default concurrency is 10 tabs, max is 15.
- The repo omits historical builds and debug bundles to keep the public release tidy.

## Documentation map

- `README.md`: human-facing project overview and usage
- `docs/README.md`: docs index and routing
- `docs/project-preferences.md`: durable maintenance and verification preferences
