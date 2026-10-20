const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const source = fs.readFileSync(require.resolve('../features/writing/spellcheck-issue-pr-drafts.js'), 'utf8');
  const input = {};
  const aside = { setAttribute(key, value) { this[key] = value; }, querySelector: () => input };
  function node() {
    return {
      children: [], textContent: '', className: '',
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
    };
  }
  const context = { document: { createElement: node, createTextNode: text => ({ textContent: text }), getElementById: () => aside } };
  vm.runInNewContext(source.slice(0, source.indexOf('  chrome.storage.onChanged.addListener'))
    + 'globalThis.api = { changedCharacters, renderDiff, setDiffWrap, draftDiff }; })();', context);
  return { ...context.api, node, aside, input };
}

test('highlights only inserted and removed characters, preserving Unicode', () => {
  const app = setup();
  const result = app.changedCharacters('🙂 teh cat', '🙂 the cat!');
  assert.equal(result.removed.size, 1);
  assert.equal(result.added.size, 2);
  assert.equal(Array.from('🙂 teh cat').filter((_, i) => !result.removed.has(i)).join(''),
    Array.from('🙂 the cat!').filter((_, i) => !result.added.has(i)).join(''));
});

test('renders stronger character spans while treating markup as text', () => {
  const app = setup();
  const pre = app.node();
  app.renderDiff(pre, '-<b>cat</b>\n+<b>cats</b>');
  const highlighted = pre.children.flatMap(line => line.children)
    .filter(child => child.className === 'fractured-diff-character');
  assert.deepEqual(highlighted.map(child => child.textContent), ['s']);
});

test('wrap defaults on and can be switched off and restored', () => {
  const app = setup();
  app.setDiffWrap(undefined);
  assert.equal(app.aside['data-wrap'], 'true');
  assert.equal(app.input.checked, true);
  app.setDiffWrap(false);
  assert.equal(app.aside['data-wrap'], 'false');
  app.setDiffWrap(true);
  assert.equal(app.aside['data-wrap'], 'true');
});

test('comment diffs omit file headers and unchanged comments have no diff', () => {
  const app = setup();
  assert.equal(app.draftDiff({ body: 'cat' }, { body: 'cats' }, 'comment'), '+cats\n-cat');
  assert.equal(app.draftDiff({ body: 'cat' }, { body: 'cat' }, 'comment'), '');
});
