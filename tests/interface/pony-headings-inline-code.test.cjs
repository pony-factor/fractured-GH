const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../features/pony-headings.css'), 'utf8');
const inlineCode = css.match(/(\.markdown-body\s+:is\(h1,\s*h2,\s*h3\)\s+:is\(code,\s*tt\)[^{]*)\{([^}]+)\}/);

test('Markdown heading code inherits heading typography instead of the GitHub chip', () => {
  assert.ok(inlineCode, 'heading inline code needs a scoped style rule');
  const declarations = inlineCode[2];
  for (const property of ['font-family', 'font-size', 'font-weight', 'line-height']) {
    assert.match(declarations, new RegExp(`${property}:\\s*inherit\\s*!important\\s*;`));
  }
  assert.match(declarations, /background:\s*transparent\s*!important\s*;/);
  assert.match(declarations, /padding:\s*0\s*!important\s*;/);
});

test('code styling covers main and sticky PR titles without changing body or branch code', () => {
  assert.ok(inlineCode, 'expected a heading-specific rule');
  const selectors = inlineCode[1].split(',\n').map(selector => selector.trim());
  assert.deepEqual(selectors, [
    '.markdown-body :is(h1, h2, h3) :is(code, tt)',
    ':is(h1, h2) .markdown-title :is(code, tt)',
    '.js-issue-title :is(code, tt)',
  ]);
});
