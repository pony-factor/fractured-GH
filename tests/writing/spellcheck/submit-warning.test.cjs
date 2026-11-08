const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../../features/writing/spellcheck/submit-confirmation.js'),
  'utf8',
);

function setup({ imagesPending = false } = {}) {
  const listeners = {};
  const state = { dialog: null, controls: [], imageBlocks: 0 };

  function event(type, target, extra = {}) {
    return {
      type, target, defaultPrevented: false, ...extra,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
  }

  class Node {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.listeners = {};
      this.isConnected = true;
      this.value = '';
      this.clicks = 0;
      this.submissions = 0;
    }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(type, callback) {
      (this.listeners[type] ||= []).push(callback);
    }
    append(...nodes) { this.children.push(...nodes); }
    contains(child) { return this.children.includes(child); }
    focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() {
      this.isConnected = false;
      if (state.dialog === this) state.dialog = null;
    }
    dispatch(evt) {
      for (const callback of this.listeners[evt.type] || []) {
        callback(evt);
        if (evt.stopped) break;
      }
      return evt;
    }
    click() {
      this.clicks += 1;
      const evt = this.dispatch(event('click', this));
      if (this.isSubmit && !evt.defaultPrevented) this.submissions += 1;
    }
  }

  const document = {
    body: { append(node) { state.dialog = node; } },
    documentElement: { append() {} },
    getElementById(id) {
      if (id === 'fractured-spellcheck-submit-warning') return state.dialog;
      if (id === 'fractured-spellcheck-submit-warning-styles') return {};
      return null;
    },
    createElement: (tag) => new Node(tag),
    addEventListener(type, callback) { listeners[type] = callback; },
    querySelectorAll(selector) {
      return selector === '[data-fractured-spellcheck-bound]' ? state.controls : [];
    },
  };
  const sandbox = {
    document,
    queueMicrotask,
    fracturedSpellcheckImages: {
      hasUnresolved: () => imagesPending,
      preventUnresolvedSubmission(evt) {
        state.imageBlocks += 1;
        evt.preventDefault();
        evt.stopImmediatePropagation();
      },
    },
  };
  vm.runInNewContext(source, sandbox);

  const fields = { title: new Node('input'), body: new Node('textarea') };
  fields.title.value = 'Draft title';
  fields.body.value = 'Draft body';
  const submit = new Node('button');
  submit.isSubmit = true;
  const spellcheck = new Node('button');
  const form = new Node('form');
  sandbox.fracturedSpellcheckSubmitConfirmation.bind(submit, fields, spellcheck, form);
  state.controls.push(submit);

  const actions = () => {
    assert.ok(state.dialog, 'submission warning is open');
    return state.dialog.children[2].children;
  };
  const choose = (label) => {
    const action = actions().find((button) => button.textContent === label);
    assert.ok(action, 'expected choice: ' + label);
    action.click();
  };
  const shortcut = (extra = {}) => {
    const evt = event('keydown', fields.body, {
      key: 'Enter', metaKey: true, ctrlKey: false, ...extra,
    });
    listeners.keydown(evt);
    return evt;
  };
  return { state, fields, submit, spellcheck, form, sandbox, event, choose, shortcut };
}

test('Cmd+Enter shows a warning and Cancel does not submit', () => {
  const app = setup();
  const evt = app.shortcut();
  assert.equal(evt.defaultPrevented, true);
  assert.equal(app.submit.submissions, 0);
  app.choose('Cancel');
  assert.equal(app.state.dialog, null);
  assert.equal(app.submit.submissions, 0);
});

test('normal submit click warns and explicit approval resumes native submit', () => {
  const app = setup();
  app.submit.click();
  assert.equal(app.submit.submissions, 0);
  app.choose('Submit without spellcheck');
  assert.equal(app.submit.submissions, 1);
  assert.equal(app.state.dialog, null);
});

test('Run Spellcheck Only starts spellchecking without submitting', () => {
  const app = setup();
  app.shortcut();
  app.choose('Run Spellcheck Only');
  assert.equal(app.spellcheck.clicks, 1);
  assert.equal(app.submit.submissions, 0);
  assert.equal(app.state.dialog, null);
  app.sandbox.fracturedSpellcheckSubmitConfirmation.markChecked(app.fields);
  app.submit.click();
  assert.equal(app.submit.submissions, 1);
  assert.equal(app.state.dialog, null);
});

test('spellchecked drafts do not warn again until text changes', () => {
  const app = setup();
  app.sandbox.fracturedSpellcheckSubmitConfirmation.markChecked(app.fields);
  assert.equal(app.shortcut().defaultPrevented, false);
  app.fields.body.value = 'New edits after spellchecking';
  assert.equal(app.shortcut().defaultPrevented, true);
  app.choose('Cancel');
  app.sandbox.fracturedSpellcheckSubmitConfirmation.markUnchecked(app.fields);
  assert.equal(app.shortcut().defaultPrevented, true);
});

test('unresolved images remain blocked even when the user previously spellchecked', () => {
  const app = setup({ imagesPending: true });
  app.sandbox.fracturedSpellcheckSubmitConfirmation.markChecked(app.fields);
  const evt = app.shortcut();
  assert.equal(evt.defaultPrevented, true);
  assert.equal(app.state.imageBlocks, 1);
  assert.equal(app.state.dialog, null);
  assert.equal(app.submit.submissions, 0);
});

test('only editor shortcuts are intercepted, and Ctrl+Enter works too', () => {
  const app = setup();
  const unrelated = app.event('keydown', { tag: 'textarea' }, {
    key: 'Enter', metaKey: true,
  });
  app.shortcut({ metaKey: false, ctrlKey: true });
  assert.ok(app.state.dialog);
  app.choose('Cancel');
  // A keyboard event outside this composer must not be captured.
  assert.equal(unrelated.defaultPrevented, false);
  assert.equal(app.shortcut({ altKey: true }).defaultPrevented, false);
  assert.equal(app.shortcut({ shiftKey: true }).defaultPrevented, false);
  assert.equal(app.shortcut({ key: 'a' }).defaultPrevented, false);
});

test('form submit events also require review and respect the chosen action', () => {
  const app = setup();
  const evt = app.event('submit', app.form, { submitter: app.submit });
  app.form.dispatch(evt);
  assert.equal(evt.defaultPrevented, true);
  app.choose('Submit without spellcheck');
  assert.equal(app.submit.submissions, 1);
});
