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

test('code styling covers main, sticky, and list PR titles without changing body or branch code', () => {
  assert.ok(inlineCode, 'expected a heading-specific rule');
  const selectors = inlineCode[1].split(',\n').map(selector => selector.trim());
  assert.deepEqual(selectors, [
    '.markdown-body :is(h1, h2, h3) :is(code, tt)',
    ':is(h1, h2, h3) :is(code, tt)',
    '.js-issue-title :is(code, tt)',
  ]);
});

test('PR numbers receive the display font without changing their size', () => {
  const rule = css.split('/* Match the pony display font on PR/issue numbers beside their titles. */')[1]?.split('}')[0];
  assert.ok(rule, 'expected the PR number font rule');
  for (const selector of ['.gh-header-number', '[data-testid="issue-number"]', '[data-testid="pull-request-number"]']) {
    assert.ok(rule.includes(selector), `missing selector: ${selector}`);
  }
  assert.match(rule, /font-family:\s*"Celestia Medium Redux"[^;]*!important\s*;/);
  assert.doesNotMatch(rule, /font-size\s*:/);
});

test('PR sidebar section labels use the display font without styling all sidebar content', () => {
  const rule = css.split('/* Match sidebar section labels, not assignees, labels, or other section values. */')[1]?.split('}')[0];
  assert.ok(rule, 'expected the sidebar label font rule');
  for (const selector of [
    '#partial-discussion-sidebar',
    '.discussion-sidebar',
    '[data-testid="pr-sidebar"]',
    '[data-testid="issue-viewer-sidebar"]',
    '.discussion-sidebar-heading',
    '[data-testid$="-section"] > :first-child :is(span, strong, button)',
  ]) {
    assert.ok(rule.includes(selector), `missing selector: ${selector}`);
  }
  assert.match(rule, /font-family:\s*"Celestia Medium Redux"[^;]*!important\s*;/);
  assert.doesNotMatch(rule, /font-size\s*:/);
});
