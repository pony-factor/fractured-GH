const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../features/pony-headings.css'), 'utf8');
const inlineCode = css.match(/\.markdown-body\s+:is\(h1,\s*h2,\s*h3\)\s+:is\(code,\s*tt\)\s*\{([^}]+)\}/);

test('Markdown heading code inherits heading typography instead of the GitHub chip', () => {
  assert.ok(inlineCode, 'heading inline code needs a Markdown-only style rule');
  const declarations = inlineCode[1];
  for (const property of ['font-family', 'font-size', 'font-weight', 'line-height']) {
    assert.match(declarations, new RegExp(`${property}:\\s*inherit\\s*!important\\s*;`));
  }
  assert.match(declarations, /background:\s*transparent\s*!important\s*;/);
  assert.match(declarations, /padding:\s*0\s*!important\s*;/);
});

test('the inline code styling is restricted to rendered Markdown headings', () => {
  assert.ok(inlineCode, 'expected a heading-specific rule');
  const selector = inlineCode[0].split('{')[0];
  assert.match(selector, /^\.markdown-body /);
  assert.match(selector, /:is\(h1,\s*h2,\s*h3\)/);
  assert.doesNotMatch(selector, /\bpre\b/);
});
