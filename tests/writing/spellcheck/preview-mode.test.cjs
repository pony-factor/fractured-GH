const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../../features/writing/spellcheck/issue-pr-drafts.js'), 'utf8',
);
const start = source.indexOf('  function previewIsSelected(');
const end = source.indexOf('  async function launchSpellcheck(', start);
assert.ok(start >= 0 && end > start, 'preview handling helpers exist in the draft script');
const helpers = source.slice(start, end);

function setup({ preview = true, deferred = false, missingBody = false, writeAvailable = true } = {}) {
  let inPreview = preview;
  let editorVisible = !preview;
  let clicks = 0;
  let frames = 0;
  const title = { value: 'PR title' };
  const body = { value: 'Thsi text should stay as wrtiten' };
  const write = {
    textContent: 'Write',
    click() {
      clicks += 1;
      if (!deferred) {
        inPreview = false;
        editorVisible = true;
      }
    },
    getAttribute: () => null,
    matches: () => false,
  };
  const previewTab = {
    textContent: 'Preview',
    getAttribute: name => name === 'aria-selected' && inPreview ? 'true' : null,
    matches: () => false,
  };
  const scope = {
    querySelectorAll: () => writeAvailable ? [write, previewTab] : [previewTab],
  };
  const submitControl = { closest: () => scope };
  const funcs = vm.runInNewContext(`${helpers}\n({ previewIsSelected, writableFieldsFor })`, {
    scopeFor: () => missingBody && !editorVisible ? null : scope,
    fieldsFor: () => missingBody && !editorVisible ? null : { title, body },
    visible: () => editorVisible,
    controlText: control => control.textContent,
    requestAnimationFrame(callback) {
      frames += 1;
      if (deferred && frames === 2) {
        inPreview = false;
        editorVisible = true;
      }
      callback();
    },
  });
  return {
    ...funcs,
    submitControl, title, body,
    get clicks() { return clicks; },
    get frames() { return frames; },
  };
}

test('clicking Spellcheck from Preview restores Write and retains the source', async () => {
  const app = setup();
  assert.equal(app.previewIsSelected({ querySelectorAll: () => [{
    textContent: 'Preview', getAttribute: () => 'true',
  }] }), true);
  const fields = await app.writableFieldsFor(app.submitControl);
  assert.equal(fields.title, app.title);
  assert.equal(fields.body, app.body);
  assert.equal(app.body.value, 'Thsi text should stay as wrtiten');
  assert.equal(app.clicks, 1);
});

test('Spellcheck in Write mode does not change tabs', async () => {
  const app = setup({ preview: false });
  const fields = await app.writableFieldsFor(app.submitControl);
  assert.equal(fields.body, app.body);
  assert.equal(app.clicks, 0);
});

test('retrieves the Markdown textarea when Preview temporarily removes it', async () => {
  const app = setup({ missingBody: true });
  const fields = await app.writableFieldsFor(app.submitControl);
  assert.equal(fields.body, app.body);
  assert.equal(app.clicks, 1);
});

test('waits for asynchronous GitHub editor rendering after switching tabs', async () => {
  const app = setup({ deferred: true });
  const fields = await app.writableFieldsFor(app.submitControl);
  assert.equal(fields.body, app.body);
  assert.equal(app.clicks, 1);
  assert.equal(app.frames, 2);
});

test('does not attempt spellcheck against an unavailable hidden editor', async () => {
  const app = setup({ writeAvailable: false });
  const fields = await app.writableFieldsFor(app.submitControl);
  assert.equal(fields, null);
  assert.equal(app.clicks, 0);
});
