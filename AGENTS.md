# Webpage Scraper repository guidance

## Purpose and layout

- This public Manifest V3 Chrome extension captures one page or same-domain crawl results as Markdown.
- Extension source lives under `src/`, automated checks under `tests/`, and build tooling under `scripts/`. `manifest.json` is the canonical permission and packaging contract.

## Product contracts

- Preserve popup behavior and the Markdown output structure unless a change is intentional and documented in `README.md`.
- Crawl only links on the starting page's domain. Keep page limits, concurrency limits, delays, cancellation, and task state explicit and tested.
- The broad HTTP/HTTPS host permissions are intentional because a user-started crawl may visit same-domain pages. Keep permission documentation aligned with `manifest.json` and do not widen permissions without a concrete feature need.
- Keep user data local to the browser and generated download. Do not add remote collection, analytics, credentials, or hidden network services.
- Keep source, tests, and scripts canonical; do not restore historical builds, debug bundles, or one-off test-extension copies.

## Development

- Use the package scripts in `package.json`. Run `npm run check:all` for material source changes and `npm run build` for packaging or manifest changes.
- Use a manual Chrome smoke test for popup, cancellation, crawl, and Markdown download behavior when those browser-dependent paths change.
- Run `npm audit --audit-level=moderate` after dependency or lockfile changes.
- Keep `README.md` current for user-visible behavior, permissions, setup, and testing.
