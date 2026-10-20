const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/writing/spellcheck-image-attachments.js'), 'utf8',
);

function setup() {
  const drawing = [];
  const alerts = [];
  let uploadCount = 0;
  let id = 0;

  class MockEvent {
    constructor(type, options) { this.type = type; this.options = options; }
  }
  class MockTextarea {
    constructor() {
      this._value = 'An example draft.\n';
      this.selectionStart = this._value.length;
      this.selectionEnd = this.selectionStart;
      this.isConnected = true;
      this.parentElement = {};
    }
    get value() { return this._value; }
    set value(next) { this._value = next; }
    focus() {}
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
    dispatchEvent() {}
    closest() { return form; }
  }
  class MockFile {
    constructor(bits, name, options) {
      this.name = name;
      this.type = options.type;
      this.size = bits.reduce((size, bit) => size + (bit.size || 0), 0);
    }
  }
  class MockDataTransfer {
    constructor() {
      this.files = [];
      this.items = { add: (file) => { this.files.push(file); } };
    }
  }

  const editor = new MockTextarea();
  const nativeInput = {
    classList: { contains: () => false },
    accept: 'image/*',
    files: [],
    closest: () => true,
    dispatchEvent() {
      uploadCount += 1;
      editor.value += '\n![native](https://github.com/user-attachments/assets/uploaded-once)';
    },
  };
  const form = { querySelectorAll: () => [nativeInput] };
  const context = {
    beginPath() {},
    moveTo(...args) { drawing.push(['moveTo', ...args]); },
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    clip() { drawing.push(['clip']); },
    drawImage() { drawing.push(['drawImage']); },
  };
  const canvas = {
    getContext: () => context,
    toBlob: callback => callback({ size: 1024 }),
  };
  const sandbox = {
    HTMLTextAreaElement: MockTextarea,
    File: MockFile,
    DataTransfer: MockDataTransfer,
    Event: MockEvent,
    InputEvent: MockEvent,
    setTimeout,
    createImageBitmap: async () => ({ width: 400, height: 200, close() {} }),
    crypto: { randomUUID: () => `test-${++id}` },
    document: { createElement: () => canvas },
    alert: message => alerts.push(message),
  };

  vm.runInNewContext(source, sandbox);
  return {
    api: sandbox.fracturedSpellcheckImages,
    editor, nativeInput, drawing, alerts,
    get uploadCount() { return uploadCount; },
  };
}

test('stages rounded PNG with a 64 pt radius and does not upload during drafting', async () => {
  const app = setup();
  const token = await app.api.add(app.editor, { name: 'Screenshot.jpg', type: 'image/jpeg' });
  assert.match(token, /^!\[Screenshot\]\(fractured-pending-image:test-1\)$/);
  assert.match(app.editor.value, /fractured-pending-image:test-1/);
  assert.equal(app.uploadCount, 0);
  assert.ok(app.drawing.some(step => step[0] === 'clip'));
  assert.ok(app.drawing.some(step => step[0] === 'drawImage'));
  assert.ok(Math.abs(app.drawing.find(step => step[0] === 'moveTo')[1] - 64 * 96 / 72) < 0.01);
});

test('preserves image placeholders through spellcheck, including their multiplicity', async () => {
  const app = setup();
  await app.api.add(app.editor, { name: 'Screenshot.jpg', type: 'image/jpeg' });
  const before = app.editor.value;
  assert.equal(app.api.validate(before, before.replace('example', 'example!')), true);
  assert.equal(app.api.validate(before, before.replace('fractured-pending-image:', 'broken-image:')), false);
  assert.equal(app.api.validate(before, before + ' fractured-pending-image:unknown'), false);
});

test('uploads only after spellcheck and leaves exactly one final inline URL', async () => {
  const app = setup();
  await app.api.add(app.editor, { name: 'Screenshot.jpg', type: 'image/jpeg' });
  assert.equal(app.api.hasUnresolved(app.editor), true);
  assert.equal(await app.api.finalize(app.editor), 1);
  assert.equal(app.uploadCount, 1);
  assert.equal(app.api.hasUnresolved(app.editor), false);
  assert.ok(app.editor.value.includes('![Screenshot](https://github.com/user-attachments/assets/uploaded-once)'));
  assert.equal(app.editor.value.match(/https:\/\/github.com\/user-attachments\/assets\/uploaded-once/g).length, 1);
  assert.equal(await app.api.finalize(app.editor), 0);
  assert.equal(app.uploadCount, 1, 'never upload the same attachment twice');
  assert.equal(app.nativeInput.files[0].type, 'image/png');
  assert.match(app.nativeInput.files[0].name, /-rounded\.png$/);
});

test('prevents submitting a draft with pending image placeholders', async () => {
  const app = setup();
  await app.api.add(app.editor, { name: 'Screenshot.jpg', type: 'image/jpeg' });
  const calls = [];
  app.api.preventUnresolvedSubmission({
    preventDefault() { calls.push('prevent'); },
    stopImmediatePropagation() { calls.push('stop'); },
  }, app.editor);
  assert.deepEqual(calls, ['prevent', 'stop']);
  assert.equal(app.alerts.length, 1);
});

test('a removed placeholder is not uploaded or appended to the final draft', async () => {
  const app = setup();
  const token = await app.api.add(app.editor, { name: 'Screenshot.jpg', type: 'image/jpeg' });
  app.editor.value = app.editor.value.replace(token, '');
  assert.equal(await app.api.finalize(app.editor), 0);
  assert.equal(app.uploadCount, 0);
});
