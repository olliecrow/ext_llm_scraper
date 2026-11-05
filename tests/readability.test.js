import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../src/lib/readability.js', import.meta.url), 'utf8');

describe('vendored Readability', () => {
  test('parses an article title and sentence without a module object', () => {
    const sentence = 'The tomato vines kept the south wall warm through the afternoon.';
    const html = `<!DOCTYPE html>
<html>
  <head>
    <title>Garden notes</title>
  </head>
  <body>
    <article>
      <h1>Garden notes</h1>
      <p>${`${sentence} `.repeat(12)}</p>
    </article>
  </body>
</html>`;
    // A classic script matches extension injection. window.eval does not publish this function.
    const dom = new JSDOM(html, {
      url: 'https://example.com/garden',
      runScripts: 'dangerously',
    });
    const script = dom.window.document.createElement('script');
    script.textContent = source;
    dom.window.document.body.appendChild(script);

    assert.equal(typeof dom.window.module, 'undefined');
    assert.equal(typeof dom.window.Readability, 'function');

    const article = new dom.window.Readability(dom.window.document).parse();

    assert.ok(article);
    assert.equal(article.title, 'Garden notes');
    assert.match(article.textContent, /The tomato vines kept the south wall warm/);
  });
});
