# Webpage Scraper Chrome Extension

A lightweight Chrome extension that collects readable content from a site and exports it as Markdown.

## What this project is trying to achieve

Help you archive the page you are reading, or a limited set of pages on that site, into one Markdown file. Processing stays in the browser. The extension does not send page text anywhere else.

## Quick start

Use Node.js 22 or newer. CI uses Node.js 24.

```bash
npm ci --ignore-scripts
npm test
npm run build
```

Load `dist/` in Chrome.

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Choose `dist`.

The install prompt does not ask for access to every site. Access is requested for the open site when you press Start.

## Usage

1. Open a normal http or https page.
2. Click the extension action and adjust options if needed.
3. Press Start and accept the site-access prompt.
4. Press Stop to cancel. Pages already captured are saved.

Available options.

- Crawl sub-pages. Off by default. When it is on, the extension opens each link on this site. A link can change your account or log you out.
- Maximum pages, from 1 to 2000. Default 50.
- Concurrent tabs, from 1 to 15. Default 3.
- Delay between request starts, from 0 to 60000 ms. Default 0. A 150 ms gap still applies when the delay is 0.

## Output

The generated Markdown includes.

- a table of contents with captured URLs
- one section per page with title, final page URL, and extracted text

Static fetches use the response charset. A leading byte-order mark overrides that charset. Pages with no Content-Type use a tab. A page with no response charset uses a tab when its meta charset is invalid or names an encoding other than the one used to read the body. Hash routes keep their query and wait 600 ms after load for rendering. Pages that render later can still save incomplete text.

Download names use safe characters. A filename rejection retries the same captured file as `scraped-pages.md`.

## Testing and QA

- Unit tests cover state flow, scraper workflow, utility functions, and Chrome wrappers.
- `npm run check:all` covers the core modules that can run outside Chrome.
- Browser smoke checks cover popup, permission, crawl, cancel, and download behavior because those paths depend on Chrome extension APIs.
- `npm run build` verifies packaging.

## Privacy and permissions

- Scraping and Markdown generation happen locally in the browser. The extension has no analytics, remote collection, credentials, or hidden services.
- Permissions are `activeTab`, `downloads`, `offscreen`, and `scripting`. Host access is optional. Pressing Start requests the current site and its `www` pair over http and https.
- `downloads` saves the Markdown file. `offscreen` parses fetched pages and builds the file in a hidden extension page. `scripting` reads a page that needs a tab. `activeTab` lets the popup see the tab you opened it from.
- Stop saves the pages already captured.
- If the service worker restarts, the in-memory crawl is lost and the current tab can stay open. Start the crawl again.

## Notes

- Default concurrency is 3 tabs. The maximum is 15.
- The repo omits historical builds and debug bundles to keep the public release tidy.

## License

Apache-2.0. See `LICENSE`.
