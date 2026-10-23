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
  assert.equal(app.draftDiff({ body: 'cat' }, { body: 'cats' }, 'comment'), '-cat\n+cats');
  assert.equal(app.draftDiff({ body: 'cat' }, { body: 'cat' }, 'comment'), '');
});

test('shows removed lines before added lines in title and body previews', () => {
  const app = setup();
  const diff = app.draftDiff(
    { title: 'Old title', body: 'Old body' },
    { title: 'New title', body: 'New body' },
  );
  assert.equal(diff, 'Title\n-Old title\n+New title\nBody\n-Old body\n+New body');
  const preview = app.node();
  app.renderDiff(preview, diff);
  assert.deepEqual(preview.children.map(line => line.className), [
    'fractured-diff-meta', 'fractured-diff-del', 'fractured-diff-add',
    'fractured-diff-meta', 'fractured-diff-del', 'fractured-diff-add',
  ]);
});

test('orders every replacement block while keeping unchanged context intact', () => {
  const app = setup();
  assert.equal(
    app.draftDiff(
      { body: 'start\nold one\nold two\nkeep\nold three\nend' },
      { body: 'start\nnew one\nnew two\nkeep\nnew three\nend' },
      'comment',
    ),
    ' start\n-old one\n-old two\n+new one\n+new two\n keep\n-old three\n+new three\n end',
  );
});

test('keeps standalone insertions and deletions in position', () => {
  const app = setup();
  assert.equal(app.draftDiff({ body: 'a\nb' }, { body: 'a\nb\nc' }, 'comment'), ' a\n b\n+c');
  assert.equal(app.draftDiff({ body: 'a\nb\nc' }, { body: 'a\nc' }, 'comment'), ' a\n-b\n c');
});
