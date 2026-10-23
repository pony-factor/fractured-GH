const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/writing/spellcheck-image-dialog.js'), 'utf8',
);

function setup(add = async () => {}) {
  const events = {};
  const added = [];
  const calls = [];
  let document;

  class Element {
    constructor(tag = 'div') {
      this.tagName = tag;
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.dataset = {};
      this.style = {};
      this.className = '';
      this.textContent = '';
      this.value = '';
      this.isConnected = true;
      this.classNames = new Set();
      this.classList = {
        add: name => this.classNames.add(name),
        remove: name => this.classNames.delete(name),
        contains: name => this.classNames.has(name),
      };
    }
    append(...nodes) {
      nodes.forEach(node => { node.parentElement = this; this.children.push(node); });
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
    async emit(name, event = {}) {
      event.target ||= this;
      event.preventDefault ||= () => {};
      for (const callback of this.listeners[name] || []) await callback(event);
    }
    click() {
      this.clickCount = (this.clickCount || 0) + 1;
      return this.emit('click');
    }
    focus() { document.activeElement = this; }
    remove() {
      const siblings = this.parentElement?.children;
      if (siblings) siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
      this.isConnected = false;
    }
  }

  function traverse(node, predicate) {
    if (predicate(node)) return node;
    for (const child of node.children) {
      const found = traverse(child, predicate);
      if (found) return found;
    }
    return null;
  }

  document = {
    body: new Element('body'),
    documentElement: new Element('html'),
    createElement: tag => new Element(tag),
    getElementById(id) {
      return traverse(this.body, node => node.id === id)
        || traverse(this.documentElement, node => node.id === id);
    },
    addEventListener(name, callback) { events[name] = callback; },
  };
  const window = { addEventListener(name, callback) { events[name] = callback; } };
  const sandbox = { document, window };
  vm.runInNewContext(source, sandbox);
  const trigger = new Element('button');
  const editor = { isConnected: true };
  function open() {
    sandbox.fracturedSpellcheckImageDialog.open({
      trigger, editor,
      add: async file => { added.push(file.name); await add(file); },
      onAdded: count => calls.push(count),
    });
    const overlay = document.getElementById('fractured-image-dialog');
    return {
      overlay,
      panel: traverse(overlay, node => node.attributes.role === 'dialog'),
      zone: traverse(overlay, node => node.className === 'fractured-image-drop-zone'),
      picker: traverse(overlay, node => node.tagName === 'input'),
      status: traverse(overlay, node => node.className === 'fractured-image-status'),
      dismiss: traverse(overlay, node => node.className === 'fractured-image-close'),
    };
  }
  return { open, added, calls, trigger, editor, document, events };
}

test('Add Image opens accessible modal with click-to-browse file selection', async () => {
  const app = setup();
  const dialog = app.open();
  assert.equal(dialog.panel.attributes.role, 'dialog');
  assert.equal(dialog.panel.attributes['aria-modal'], 'true');
  assert.equal(app.document.activeElement, dialog.zone);
  await dialog.zone.click();
  assert.equal(dialog.picker.clickCount, 1);
  assert.equal(dialog.picker.accept, 'image/*');
  assert.equal(dialog.picker.multiple, true);
  dialog.picker.files = [{ name: 'photo.png', type: 'image/png' }];
  await dialog.picker.emit('change');
  assert.deepEqual(app.added, ['photo.png']);
  assert.deepEqual(app.calls, [1]);
  assert.equal(app.document.getElementById('fractured-image-dialog'), null);
  assert.equal(app.document.activeElement, app.trigger, 'focus returns to toolbar');
});

test('supports dropping multiple images and prevents browser navigation', async () => {
  const app = setup();
  const dialog = app.open();
  const prevent = [];
  await dialog.zone.emit('dragenter', { preventDefault: () => prevent.push('enter') });
  assert.equal(dialog.zone.classList.contains('is-dragover'), true);
  await dialog.zone.emit('drop', {
    preventDefault: () => prevent.push('drop'),
    dataTransfer: { files: [
      { name: 'one.png', type: 'image/png' },
      { name: 'two.jpg', type: 'image/jpeg' },
    ] },
  });
  assert.deepEqual(prevent, ['enter', 'drop']);
  assert.deepEqual(app.added, ['one.png', 'two.jpg']);
  assert.deepEqual(app.calls, [2]);
  assert.equal(app.document.getElementById('fractured-image-dialog'), null);
});

test('rejects non-images without staging or closing the picker', async () => {
  const app = setup();
  const dialog = app.open();
  dialog.picker.files = [{ name: 'notes.txt', type: 'text/plain' }];
  await dialog.picker.emit('change');
  assert.deepEqual(app.added, []);
  assert.equal(dialog.status.dataset.error, 'true');
  assert.match(dialog.status.textContent, /image files only/i);
  assert.ok(app.document.getElementById('fractured-image-dialog'));
});

test('partial processing errors keep the picker open and report staged count', async () => {
  const app = setup(async file => {
    if (file.name === 'bad.png') throw new Error('Cannot process bitmap');
  });
  const dialog = app.open();
  dialog.picker.files = [
    { name: 'good.png', type: 'image/png' },
    { name: 'bad.png', type: 'image/png' },
  ];
  await dialog.picker.emit('change');
  assert.deepEqual(app.calls, [1]);
  assert.match(dialog.status.textContent, /1 image.s. added/);
  assert.match(dialog.status.textContent, /Cannot process bitmap/);
  assert.equal(dialog.zone.disabled, false);
  assert.ok(app.document.getElementById('fractured-image-dialog'));
});

test('escape and backdrop dismiss modal; navigation discards stale popups', async () => {
  const app = setup();
  let dialog = app.open();
  await dialog.panel.emit('keydown', { key: 'Escape' });
  assert.equal(app.document.getElementById('fractured-image-dialog'), null);
  dialog = app.open();
  await dialog.overlay.emit('click', { target: dialog.overlay });
  assert.equal(app.document.getElementById('fractured-image-dialog'), null);
  dialog = app.open();
  app.events['turbo:before-cache']();
  assert.equal(app.document.getElementById('fractured-image-dialog'), null);
});

test('focus stays in dialog with Tab and busy picker cannot be dismissed', async () => {
  let release;
  const app = setup(() => new Promise(resolve => { release = resolve; }));
  const dialog = app.open();
  app.document.activeElement = dialog.zone;
  await dialog.panel.emit('keydown', { key: 'Tab' });
  assert.equal(app.document.activeElement, dialog.dismiss);
  await dialog.panel.emit('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(app.document.activeElement, dialog.zone);
  dialog.picker.files = [{ name: 'slow.png', type: 'image/png' }];
  const processing = dialog.picker.emit('change');
  await Promise.resolve();
  await dialog.panel.emit('keydown', { key: 'Escape' });
  assert.ok(app.document.getElementById('fractured-image-dialog'));
  release();
  await processing;
  assert.equal(app.document.getElementById('fractured-image-dialog'), null);
});
