const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../../features/writing/spellcheck/issue-pr-drafts.js'), 'utf8',
);
const instrumented = source.replace(
  '  const observer = new MutationObserver(scheduleScan);',
  '  globalThis.__testUndo = { showSidebar, undoSpellcheck };\n  const observer = new MutationObserver(scheduleScan);',
);

function setup({ confirm = false } = {}) {
  class Field {
    constructor(value) { this._value = value; this.isConnected = true; this.events = []; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    dispatchEvent(event) { this.events.push(event.type); }
  }
  class TextArea extends Field {}
  class Input extends Field {}
  class Node {
    constructor() { this.children = []; this.handlers = {}; this.className = ''; this.attributes = new Map(); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(type, listener) { this.handlers[type] = listener; }
  }
  const content = new Node();
  const aside = new Node();
  const wrapInput = { checked: true };
  aside.querySelector = selector => selector === '.fractured-spellcheck-content'
    ? content : selector === '.fractured-spellcheck-wrap input' ? wrapInput : null;
  const document = {
    body: {},
    documentElement: { append() {} },
    getElementById(id) {
      if (id === 'fractured-spellcheck-styles') return {};
      if (id === 'fractured-spellcheck-sidebar') return aside;
      return null;
    },
    createElement: () => new Node(),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const restored = [];
  const sandbox = {
    document,
    location: { href: 'https://github.com/pony-factor/fractured-GH/issues/new' },
    window: { confirm: () => confirm, addEventListener() {} },
    chrome: { storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } } },
    Element: Node,
    Document: class {},
    HTMLTextAreaElement: TextArea,
    HTMLInputElement: Input,
    Event: class { constructor(type) { this.type = type; } },
    InputEvent: class { constructor(type) { this.type = type; } },
    MutationObserver: class { observe() {} },
    queueMicrotask: callback => callback(),
    fracturedSpellcheckImages: { restorePending: (...args) => restored.push(args) },
  };
  vm.runInNewContext(instrumented, sandbox);
  return { api: sandbox.__testUndo, content, title: new Input('Corrected title'),
    body: new TextArea('Corrected body'), restored };
}

test('shows Undo to the right of Applied spellcheck and restores the entire draft', () => {
  const app = setup();
  const fields = { title: app.title, body: app.body };
  const original = { title: 'Original title', body: 'Original body' };
  const applied = { title: app.title.value, body: app.body.value };
  const staged = [{ id: 'first-image' }];
  app.api.showSidebar({
    status: 'Applied spellcheck.',
    undo: () => app.api.undoSpellcheck(fields, original, applied, staged),
  });
  const row = app.content.children[0];
  assert.equal(row.className, 'fractured-spellcheck-status-row');
  assert.equal(row.children[0].textContent, 'Applied spellcheck.');
  assert.equal(row.children[1].textContent, 'Undo');
  assert.match(row.children[1].className, /fractured-spellcheck-undo/);

  row.children[1].handlers.click();
  assert.equal(app.title.value, 'Original title');
  assert.equal(app.body.value, 'Original body');
  assert.ok(app.title.events.includes('input'));
  assert.ok(app.body.events.includes('input'));
  assert.equal(app.restored.length, 1);
  assert.equal(app.restored[0][0], app.body);
  assert.equal(app.restored[0][1], staged);
  assert.equal(app.content.children[0].children.length, 1, 'undo is removed after restoring');
  assert.match(app.content.children[0].children[0].textContent, /Undid spellcheck/);
});

test('undo never silently overwrites edits made after applying spellcheck', () => {
  const app = setup();
  app.body.value = 'Newer manual edits';
  app.api.undoSpellcheck(
    { title: app.title, body: app.body },
    { title: 'Original title', body: 'Original body' },
    { title: 'Corrected title', body: 'Corrected body' }, [],
  );
  assert.equal(app.body.value, 'Newer manual edits');
  assert.equal(app.restored.length, 0);
});

test('undo can restore after explicit confirmation when edits are newer', () => {
  const app = setup({ confirm: true });
  app.body.value = 'Newer manual edits';
  app.api.undoSpellcheck(
    { title: app.title, body: app.body },
    { title: 'Original title', body: 'Original body' },
    { title: 'Corrected title', body: 'Corrected body' }, [],
  );
  assert.equal(app.body.value, 'Original body');
  assert.equal(app.title.value, 'Original title');
});

test('undo does not restore into a disconnected editor', () => {
  const app = setup();
  app.body.isConnected = false;
  app.api.undoSpellcheck(
    { title: app.title, body: app.body },
    { title: 'Original title', body: 'Original body' },
    { title: 'Corrected title', body: 'Corrected body' }, [],
  );
  assert.equal(app.body.value, 'Corrected body');
  assert.equal(app.restored.length, 0);
  assert.match(app.content.children[0].children[0].textContent, /no longer open/);
});
