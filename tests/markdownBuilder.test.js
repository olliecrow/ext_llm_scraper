// Tests for markdown building functionality
import { MarkdownBuilder } from '../src/background/markdownBuilder.js';

describe('Markdown Builder', () => {

  test('generates markdown with single page', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      ['https://example.com', { title: 'Example Page', textContent: 'This is the content.' }]
    ]);
    
    builder.addFromContentMap(contentMap);
    const result = builder.build();
    
    expect(result).toContain('# Table of Contents');
    expect(result).toContain('1. [Example Page](https://example.com)');
    expect(result).toContain('# Example Page');
    expect(result).toContain('**URL:** https://example.com');
    expect(result).toContain('This is the content.');
  });

  test('generates markdown with multiple pages', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      ['https://example.com/page1', { title: 'Page 1', textContent: 'Content 1' }],
      ['https://example.com/page2', { title: 'Page 2', textContent: 'Content 2' }],
      ['https://example.com/page3', { title: 'Page 3', textContent: 'Content 3' }]
    ]);
    
    builder.addFromContentMap(contentMap);
    const result = builder.build();
    
    expect(result).toContain('1. [Page 1](https://example.com/page1)');
    expect(result).toContain('2. [Page 2](https://example.com/page2)');
    expect(result).toContain('3. [Page 3](https://example.com/page3)');
    
    expect(result).toContain('# Page 1');
    expect(result).toContain('**URL:** https://example.com/page1');
    expect(result).toContain('Content 1');
  });

  test('handles empty content map', () => {
    const builder = new MarkdownBuilder();
    const result = builder.build();
    
    expect(result).toContain('# No Content');
    expect(result).toContain('No pages were successfully scraped.');
  });

  test('handles special characters in titles', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      ['https://example.com', { title: 'Title with [brackets] & symbols!', textContent: 'Content' }]
    ]);
    
    builder.addFromContentMap(contentMap);
    const result = builder.build();
    
    expect(result).toContain('[Title with \\[brackets\\] & symbols!]');
  });

  test('handles empty title', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      ['https://example.com', { title: '', textContent: 'Content without title' }]
    ]);
    
    builder.addFromContentMap(contentMap);
    const result = builder.build();
    
    expect(result).toContain('1. [https://example.com](https://example.com)');
    expect(result).toContain('# https://example.com');
  });

  test('handles multi-line content', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      ['https://example.com', { 
        title: 'Multi-line Page', 
        textContent: 'Line 1\nLine 2\n\nParagraph 2' 
      }]
    ]);
    
    builder.addFromContentMap(contentMap);
    const result = builder.build();
    
    expect(result).toContain('Line 1\nLine 2\n\nParagraph 2');
  });

  test('preserves page order', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      ['https://example.com/z', { title: 'Z Page', textContent: 'Z' }],
      ['https://example.com/a', { title: 'A Page', textContent: 'A' }],
      ['https://example.com/m', { title: 'M Page', textContent: 'M' }]
    ]);
    
    builder.addFromContentMap(contentMap);
    const result = builder.build();
    const tocSection = result.split('---')[0];
    
    expect(tocSection).toContain('1. [Z Page]');
    expect(tocSection).toContain('2. [A Page]');
    expect(tocSection).toContain('3. [M Page]');
  });

  test('calculates statistics correctly', () => {
    const builder = new MarkdownBuilder();
    builder.addPage('https://example.com/1', 'Page 1', 'Short content');
    builder.addPage('https://example.com/2', 'Page 2', 'Much longer content with more text');
    
    const stats = builder.getStats();
    
    expect(stats.pageCount).toBe(2);
    expect(stats.totalCharacters).toBe(47); // 13 + 34
    expect(stats.avgContentLength).toBe(24); // 47 / 2 rounded
  });
});