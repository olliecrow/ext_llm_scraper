# Webpage Scraper Chrome Extension

A robust Chrome extension that scrapes webpage content and converts it to Markdown format for data analysis.

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

### Security Considerations for Development

When contributing to this project:
- **Never hardcode API keys, tokens, or secrets** in the source code
- **Validate all user inputs** and external data
- **Follow Chrome extension security best practices** (Manifest V3)
- **Avoid using `eval()` or `innerHTML`** with untrusted content
- **Keep dependencies up to date** and audit for vulnerabilities
- **Use Content Security Policy** to prevent injection attacks

### Testing

The project includes comprehensive unit tests:

```bash
npm test
```

Currently 40+ tests covering:
- URL normalization
- Task state management
- Markdown generation
- Error handling
- Output methods

## Architecture

### Modular Design
- **TaskManager**: Orchestrates scraping tasks
- **PageScraper**: Handles individual page scraping
- **MarkdownBuilder**: Generates formatted output
- **TaskState**: Manages task state and queue

### Robustness Features
- **Multiple fallback methods** for critical operations
- **Continues on errors** to maximize data capture
- **Memory leak prevention** with proper resource cleanup
- **Clear debug logging** for troubleshooting

### Error Recovery
- Retries failed pages up to 3 times with exponential backoff
- Captures partial content when available
- Continues crawling even when individual pages fail
- Logs all errors for debugging

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

## Browser Compatibility

- Chrome/Chromium 88+ (Manifest V3 support required)
- Edge 88+ (Chromium-based)

## Privacy & Security

### Data Collection
This extension operates entirely locally on your device and **does not collect, transmit, or store any personal data on external servers**. Here's what the extension accesses and why:

### Permissions Explained
The extension requires these permissions for legitimate functionality:

- **`<all_urls>` (Access to all websites)**: Required to scrape content from any website you choose to visit. The extension only processes pages you explicitly start scraping on.
- **`activeTab`**: Allows the extension to interact with the currently active browser tab.
- **`tabs`**: Enables creating and managing tabs for the scraping process.
- **`storage`**: Stores user preferences and temporary task progress locally on your device.
- **`downloads`**: Enables downloading the scraped content as markdown files.
- **`scripting`**: Required to inject content extraction scripts into web pages.

### Data Processing
- **Local Only**: All content processing happens locally in your browser
- **No External Communication**: The extension does not send any data to external servers
- **Temporary Storage**: Scraped content is stored temporarily in browser local storage and automatically cleaned up
- **User Control**: You can clear all stored data by removing the extension

### Security Features
- **Input Validation**: All user inputs and URLs are validated for security
- **Protocol Restrictions**: Only HTTP and HTTPS URLs are allowed
- **Local Network Protection**: Private/local network URLs (localhost, 192.168.x.x, etc.) are blocked for security
- **Content Sanitization**: All scraped content is processed safely without executing scripts
- **Resource Limits**: Built-in limits prevent excessive resource usage

### Ethical Usage Guidelines
When using this extension, please:
- **Respect website terms of service** and robots.txt files
- **Use reasonable delays** between requests to avoid overloading servers
- **Avoid scraping copyrighted content** without permission
- **Be mindful of rate limits** and website policies
- **Only scrape publicly available content** that you have the right to access

The extension includes ethical safeguards like request delays and concurrency limits to promote responsible usage.

## Known Limitations

- Maximum 1000 pages per crawl (configurable)
- Memory usage increases with number of pages (IndexedDB storage coming in v2)
- Some dynamic content may not be captured
- Rate-limited sites may block rapid crawling

## License

MIT License - See LICENSE file for details

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Troubleshooting

### Extension doesn't load
- Ensure you've built the project with `npm run build`
- Check that Developer mode is enabled in Chrome
- Look for errors in chrome://extensions/

### Scraping fails
- Check the debug log in the extension popup
- Some sites may block automated scraping
- Try adjusting the delay between requests
- Reduce concurrency for rate-limited sites

### Clipboard doesn't work
- Ensure the extension has necessary permissions
- Try the download option as an alternative
- Check browser console for errors

## Future Enhancements

- IndexedDB storage for large crawls
- Progress persistence across browser restarts
- Offscreen document for improved clipboard support
- Pause/resume functionality
- Rate limit detection and auto-adjustment

## Support

For issues or questions, please open an issue on the project repository.