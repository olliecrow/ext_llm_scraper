import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownBuilder } from '../src/background/markdownBuilder.js';

describe('Markdown Builder', () => {
  test('generates markdown with single page', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      ['https://example.com', { title: 'Example Page', textContent: 'This is the content.' }],
    ]);

    builder.addFromContentMap(contentMap);
    const result = builder.build();

    assert.ok(result.includes('# Table of Contents'));
    assert.ok(result.includes('1. [Example Page](<https://example.com>)'));
    assert.ok(result.includes('# Example Page'));
    assert.ok(result.includes('**URL:** https://example.com'));
    assert.ok(result.includes('This is the content.'));
  });

  test('generates markdown with multiple pages', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      ['https://example.com/page1', { title: 'Page 1', textContent: 'Content 1' }],
      ['https://example.com/page2', { title: 'Page 2', textContent: 'Content 2' }],
      ['https://example.com/page3', { title: 'Page 3', textContent: 'Content 3' }],
    ]);

    builder.addFromContentMap(contentMap);
    const result = builder.build();

    assert.ok(result.includes('1. [Page 1](<https://example.com/page1>)'));
    assert.ok(result.includes('2. [Page 2](<https://example.com/page2>)'));
    assert.ok(result.includes('3. [Page 3](<https://example.com/page3>)'));

    assert.ok(result.includes('# Page 1'));
    assert.ok(result.includes('**URL:** https://example.com/page1'));
    assert.ok(result.includes('Content 1'));
  });

  test('handles empty content map', () => {
    const builder = new MarkdownBuilder();
    const result = builder.build();

    assert.ok(result.includes('# No Content'));
    assert.ok(result.includes('No pages were successfully scraped.'));
  });

  test('handles special characters in titles', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      [
        'https://example.com',
        { title: 'Title with [brackets] & symbols!', textContent: 'Content' },
      ],
    ]);

    builder.addFromContentMap(contentMap);
    const result = builder.build();

    assert.ok(result.includes('[Title with \\[brackets\\] & symbols!]'));
  });

  test('handles empty title', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      ['https://example.com', { title: '', textContent: 'Content without title' }],
    ]);

    builder.addFromContentMap(contentMap);
    const result = builder.build();

    assert.ok(result.includes('1. [https://example.com](<https://example.com>)'));
    assert.ok(result.includes('# https://example.com'));
  });

  test('handles multi-line content', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      [
        'https://example.com',
        {
          title: 'Multi-line Page',
          textContent: 'Line 1\nLine 2\n\nParagraph 2',
        },
      ],
    ]);

    builder.addFromContentMap(contentMap);
    const result = builder.build();

    assert.ok(result.includes('Line 1\nLine 2\n\nParagraph 2'));
  });

  test('keeps a newline title on one line and preserves parentheses in the link', () => {
    const builder = new MarkdownBuilder();
    builder.addPage('https://example.com/a)b>c', 'Hello\nWorld [x]', 'Body stays\nraw');
    const result = builder.build();
    const tocLine = result.split('\n').find((line) => line.startsWith('1. '));

    assert.equal(tocLine, '1. [Hello World \\[x\\]](<https://example.com/a)b%3Ec>)');
    assert.ok(result.includes('# Hello World \\[x\\]'));
    assert.ok(result.includes('Body stays\nraw'));
  });

  test('preserves page order', () => {
    const builder = new MarkdownBuilder();
    const contentMap = new Map([
      ['https://example.com/z', { title: 'Z Page', textContent: 'Z' }],
      ['https://example.com/a', { title: 'A Page', textContent: 'A' }],
      ['https://example.com/m', { title: 'M Page', textContent: 'M' }],
    ]);

    builder.addFromContentMap(contentMap);
    const result = builder.build();
    const tocSection = result.split('---')[0];

    assert.ok(tocSection.includes('1. [Z Page]'));
    assert.ok(tocSection.includes('2. [A Page]'));
    assert.ok(tocSection.includes('3. [M Page]'));
  });
});
