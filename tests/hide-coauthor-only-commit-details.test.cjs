const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '../features/pull-requests/hide-coauthor-only-commit-details.js'), 'utf8',
);
const MARKER = 'data-fractured-coauthor-only-details';

function commitRow(body) {
  const hidden = new Set();
  const expander = {
    setAttribute: name => hidden.add(name),
    removeAttribute: name => hidden.delete(name),
  };
  const description = {
    textContent: body,
    setAttribute: name => hidden.add('description:' + name),
    removeAttribute: name => hidden.delete('description:' + name),
  };
  const button = { closest: () => expander };
  const message = {
    querySelector(selector) {
      return selector === '.commit-desc' ? description : button;
    },
  };
  return { message, expander, description, hidden };
}

async function mount(rows, { enabled = true, pathname = '/pony-factor/fractured-GH/pull/12/commits' } = {}) {
  let settingChange;
  let mutationCallback;
  const style = { remove() {}, id: '', textContent: '' };
  const document = {
    head: { append() {} },
    documentElement: {},
    createElement: () => style,
    getElementById: () => null,
    querySelectorAll(selector) {
      if (selector === '.commit-message') return rows.map(row => row.message);
      if (selector === `[${MARKER}]`) {
        return rows.flatMap(row => [
          ...(row.hidden.has(MARKER) ? [row.expander] : []),
          ...(row.hidden.has('description:' + MARKER) ? [row.description] : []),
        ]);
      }
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const context = vm.createContext({
    document,
    window: {
      location: { pathname },
      addEventListener() {},
      removeEventListener() {},
    },
    queueMicrotask,
    MutationObserver: class {
      constructor(callback) { mutationCallback = callback; }
      observe() {}
      disconnect() {}
    },
    chrome: { storage: {
      onChanged: { addListener(callback) { settingChange = callback; } },
      local: { get: async () => ({ hideCoauthorOnlyCommitDetails: enabled }) },
    } },
  });
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.testHelpers = { isCoauthorOnly };\n})();'), context);
  await Promise.resolve();
  await Promise.resolve();
  return {
    isCoauthorOnly: context.testHelpers.isCoauthorOnly,
    toggle(value) {
      settingChange({ hideCoauthorOnlyCommitDetails: { newValue: value } }, 'local');
    },
    update() { mutationCallback?.(); },
    location: context.window.location,
  };
}

test('recognizes one or multiple co-author trailers, with blank lines and CRLF', async () => {
  const { isCoauthorOnly } = await mount([], { enabled: false });
  assert.equal(isCoauthorOnly('Co-authored-by: Codex <noreply@openai.com>'), true);
  assert.equal(isCoauthorOnly('Co-authored-by: A <a@example.org>\r\n\r\nCo-authored-by: B <b@example.org>'), true);
  for (const text of [
    '', 'Some explanation\n\nCo-authored-by: Codex <noreply@openai.com>',
    'Signed-off-by: Codex <noreply@openai.com>',
    'Co-authored-by: Codex <noreply@openai.com>\nReviewed-by: Reviewer <r@example.com>',
    'Co-authored-by: Codex',
  ]) assert.equal(isCoauthorOnly(text), false, text);
});

test('hides only the ellipsis and details of co-author-only PR commits', async () => {
  const rows = [
    commitRow('Co-authored-by: Codex <noreply@openai.com>'),
    commitRow('A substantive summary\n\nCo-authored-by: Codex <noreply@openai.com>'),
    commitRow('Reviewed-by: B <b@example.org>'),
  ];
  await mount(rows);
  assert.equal(rows[0].hidden.has(MARKER), true);
  assert.equal(rows[0].hidden.has('description:' + MARKER), true);
  assert.equal(rows[1].hidden.size, 0);
  assert.equal(rows[2].hidden.size, 0);
});

test('turning setting off restores native controls without deleting attribution', async () => {
  const row = commitRow('Co-authored-by: Codex <noreply@openai.com>');
  const instance = await mount([row]);
  instance.toggle(false);
  assert.equal(row.hidden.size, 0);
  assert.match(row.description.textContent, /Co-authored-by/);
  instance.toggle(true);
  assert.equal(row.hidden.has(MARKER), true);
});

test('only affects pull request pages and rescans after changing body text', async () => {
  const row = commitRow('Co-authored-by: Codex <noreply@openai.com>');
  const instance = await mount([row], { pathname: '/pony-factor/fractured-GH/issues/12' });
  assert.equal(row.hidden.size, 0);
  instance.location.pathname = '/pony-factor/fractured-GH/pull/12';
  instance.update();
  await Promise.resolve();
  assert.equal(row.hidden.has(MARKER), true);
  row.description.textContent = 'Important explanation\n\n' + row.description.textContent;
  instance.update();
  await Promise.resolve();
  assert.equal(row.hidden.size, 0);
});
