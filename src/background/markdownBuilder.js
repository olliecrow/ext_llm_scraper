/**
 * Builds markdown output from scraped content
 */
export class MarkdownBuilder {
  constructor() {
    this.pages = [];
  }

  /**
   * Adds a page to the builder
   * @param {string} url - The page URL
   * @param {string} title - The page title
   * @param {string} content - The page content
   */
  addPage(url, title, content) {
    this.pages.push({
      url,
      title: title || url,
      content: content || '',
    });
  }

  /**
   * Adds multiple pages from a content map
   * @param {Map} contentMap - Map of URL to content data
   */
  addFromContentMap(contentMap) {
    for (const [url, data] of contentMap) {
      this.addPage(url, data.title, data.textContent);
    }
  }

  /**
   * Builds the markdown string
   * @returns {string} - The complete markdown document
   */
  build() {
    if (this.pages.length === 0) {
      return '# No Content\n\nNo pages were successfully scraped.';
    }

    let markdown = this.buildTableOfContents();
    markdown += this.buildContent();

    return markdown;
  }

  /**
   * Builds the table of contents section
   * @returns {string}
   */
  buildTableOfContents() {
    let toc = '# Table of Contents\n\n';

    this.pages.forEach((page, index) => {
      toc += `${index + 1}. [${this.escapeMarkdown(page.title)}](${page.url})\n`;
    });

    toc += '\n---\n\n';
    return toc;
  }

  /**
   * Builds the content section
   * @returns {string}
   */
  buildContent() {
    let content = '';

    this.pages.forEach((page) => {
      content += `# ${this.escapeMarkdown(page.title)}\n`;
      content += `**URL:** ${page.url}\n\n`;
      content += `${page.content}\n\n`;
      content += '---\n\n';
    });

    return content;
  }

  /**
   * Escapes special markdown characters in text
   * @param {string} text - Text to escape
   * @returns {string}
   */
  escapeMarkdown(text) {
    if (!text) {
      return '';
    }
    // Only escape characters that would break markdown structure
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Gets statistics about the scraped content
   * @returns {Object}
   */
  getStats() {
    const totalCharacters = this.pages.reduce((sum, page) => sum + page.content.length, 0);
    const avgContentLength =
      this.pages.length > 0 ? Math.round(totalCharacters / this.pages.length) : 0;

    return {
      pageCount: this.pages.length,
      totalCharacters,
      avgContentLength,
    };
  }
}
