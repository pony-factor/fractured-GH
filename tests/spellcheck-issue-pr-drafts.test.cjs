const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/spellcheck-issue-pr-drafts.js'), 'utf8',
);

function setup({ pathname, submit = 'Comment', bodySelector = 'textarea[name="comment[body]"]', draft = false, secondSubmit = null }) {
  const events = {};
  const enhancers = [];

  class Element {
    constructor(text = '') {
      this.textContent = text;
      this.value = text;
      this.isConnected = true;
      this.parentElement = null;
      this.attributes = {};
    }
    getClientRects() { return [1]; }
    getAttribute(name) { return this.attributes[name] || null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    addEventListener() {}
    closest(selector) { return selector === 'form, [role="dialog"]' ? this.form : null; }
    before(button) { this.form.enhancer = button; enhancers.push(button); }
    querySelector(selector) {
      return selector === '.fractured-spellcheck-enhancer' ? this.enhancer || null : null;
    }
    querySelectorAll(selector) {
      if (draft && selector === 'input[name="issue[title]"]') return [title];
      if (draft && selector === 'textarea[name="issue[body]"]') return [body];
      if (!draft && selector === bodySelector) return [body];
      if (!draft && selector === 'textarea') return [body];
      return [];
    }
    append() {}
  }

  const form = new Element();
  const body = new Element('Original text');
  const title = new Element('Issue title');
  const controls = [new Element(submit)];
  if (secondSubmit) controls.push(new Element(secondSubmit));
  for (const control of controls) control.form = form;

  const document = {
    body: {},
    documentElement: { append() {} },
    getElementById: () => null,
    createElement: () => new Element(),
    querySelectorAll(selector) {
      return selector === 'button, input[type="submit"]' ? controls : [];
    },
    addEventListener(name, callback) { events[name] = callback; },
  };
  const window = { addEventListener(name, callback) { events[name] = callback; } };
  const chrome = { storage: { onChanged: { addListener() {} } } };

  vm.runInNewContext(source, {
    document, window, chrome,
    Element, Document: class {},
    MutationObserver: class { observe() {} },
    location: { pathname, href: 'https://github.com' + pathname },
    queueMicrotask: callback => callback(),
  });

  return { enhancers, events };
}

test('adds spellcheck to a newly composed PR conversation comment', () => {
  const app = setup({ pathname: '/pony-factor/fractured-GH/pull/51' });
  assert.equal(app.enhancers.length, 1);
  assert.equal(app.enhancers[0].title, 'Spellcheck this comment');
  app.events['turbo:load']();
  assert.equal(app.enhancers.length, 1, 'navigation does not create duplicate buttons');
});

test('supports new inline review comments and review submissions', () => {
  for (const submit of ['Add single comment', 'Start a review', 'Submit review', 'Reply']) {
    const app = setup({
      pathname: '/pony-factor/fractured-GH/pull/51/files',
      submit,
      bodySelector: 'textarea[name="pull_request_review[body]"]',
    });
    assert.equal(app.enhancers.length, 1, submit);
  }
});

test('adds one spellcheck control for two comment actions sharing a form', () => {
  const app = setup({
    pathname: '/pony-factor/fractured-GH/pull/51',
    submit: 'Comment',
    secondSubmit: 'Submit review',
  });
  assert.equal(app.enhancers.length, 1);
});

test('supports a PR textarea without known comment-specific attributes', () => {
  const app = setup({
    pathname: '/pony-factor/fractured-GH/pull/51',
    bodySelector: 'textarea[data-target="markdown-editor.input"]',
  });
  assert.equal(app.enhancers.length, 1);
});

test('preserves spellcheck on issue title and description drafts', () => {
  const app = setup({
    pathname: '/pony-factor/fractured-GH/issues/new',
    submit: 'Submit new issue',
    draft: true,
  });
  assert.equal(app.enhancers.length, 1);
  assert.equal(app.enhancers[0].title, 'Enhance title and body with Spellcheck Only');
});

test('does not add comment-only spellcheck to issues or unrelated actions', () => {
  const issue = setup({ pathname: '/pony-factor/fractured-GH/issues/51' });
  const cancel = setup({ pathname: '/pony-factor/fractured-GH/pull/51', submit: 'Cancel' });
  assert.equal(issue.enhancers.length, 0);
  assert.equal(cancel.enhancers.length, 0);
});
