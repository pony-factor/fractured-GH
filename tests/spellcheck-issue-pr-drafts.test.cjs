const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/writing/spellcheck-issue-pr-drafts.js'), 'utf8',
);

function setup({
  pathname, submit = 'Comment', bodySelector = 'textarea[name="comment[body]"]',
  draft = false, secondSubmit = null, publishedControls = false, toolbarLayout = 'block',
}) {
  const events = {};
  const enhancers = [];

  class Element {
    constructor(text = '') {
      this.textContent = text;
      this.value = text;
      this.isConnected = true;
      this.parentElement = null;
      this.attributes = {};
      this.children = [];
      this.style = {};
    }
    matches() { return Boolean(this.publishedCard); }
    getClientRects() { return [1]; }
    getAttribute(name) { return this.attributes[name] || null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    addEventListener() {}
    closest(selector) { return selector === 'form, [role="dialog"]' ? this.form : null; }
    before(actions) {
      if (actions.className !== 'fractured-spellcheck-actions') return;
      assert.ok(this.form, 'published comment controls must never be enhanced');
      this.form.actions = actions;
      this.form.enhancer = actions.children.find(node => node.className === 'fractured-spellcheck-enhancer');
      enhancers.push(this.form.enhancer);
    }
    querySelector(selector) {
      return selector === '.fractured-spellcheck-enhancer' ? this.enhancer || null : null;
    }
    querySelectorAll(selector) {
      // Only the composer form contains the draft fields. Published comment
      // cards and unrelated ancestors must not pretend to own that textarea.
      if (this !== form) return [];
      if (draft && selector === 'input[name="issue[title]"]') return [title];
      if (draft && selector === 'textarea[name="issue[body]"]') return [body];
      if (!draft && selector === bodySelector) return [body];
      if (!draft && selector === 'textarea') return [body];
      return [];
    }
    append(...nodes) { this.children.push(...nodes); }
  }

  const form = new Element();
  const body = new Element('Original text');
  const title = new Element('Issue title');
  const controls = [new Element(submit)];
  if (secondSubmit) controls.push(new Element(secondSubmit));
  for (const control of controls) {
    control.form = form;
    control.parentElement = form;
  }

  if (publishedControls) {
    // Both buttons belong to a *published* comment above the composer.
    // Its parent eventually includes the draft textarea, but the enhancer
    // must not escape the comment card to find it.
    const publishedCard = new Element();
    publishedCard.publishedCard = true;
    publishedCard.parentElement = form;
    for (const label of ['Reply', 'Comment actions']) {
      const postedButton = new Element(label);
      postedButton.parentElement = publishedCard;
      controls.push(postedButton);
    }

    // Even without a recognized comment class, do not climb through an
    // arbitrary number of ancestors to an unrelated editor.
    let ancestor = form;
    for (let i = 0; i < 7; i += 1) {
      const wrapper = new Element();
      wrapper.parentElement = ancestor;
      ancestor = wrapper;
    }
    const unrelatedButton = new Element('Reply');
    unrelatedButton.parentElement = ancestor;
    controls.push(unrelatedButton);
  }

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
    getComputedStyle: () => ({ display: toolbarLayout, columnGap: '12px' }),
  });

  return { enhancers, events, actions: form.actions };
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
  assert.equal(app.enhancers[0].title, 'Spellcheck title and body; generate a title if blank');
});

test('adds spellcheck to an existing issue comment', () => {
  const issue = setup({ pathname: '/pony-factor/fractured-GH/issues/51' });
  assert.equal(issue.enhancers.length, 1);
  assert.equal(issue.enhancers[0].title, 'Spellcheck this comment');
  issue.events['turbo:load']();
  assert.equal(issue.enhancers.length, 1);
});

test('does not add comment-only spellcheck to unrelated pages or actions', () => {
  const unrelated = setup({ pathname: '/pony-factor/fractured-GH/discussions/51' });
  const cancel = setup({ pathname: '/pony-factor/fractured-GH/pull/51', submit: 'Cancel' });
  const close = setup({ pathname: '/pony-factor/fractured-GH/issues/51', submit: 'Close with comment' });
  assert.equal(unrelated.enhancers.length, 0);
  assert.equal(cancel.enhancers.length, 0);
  assert.equal(close.enhancers.length, 0);
});

test('never adds draft controls to published comment headers or their reply menus', () => {
  const app = setup({ pathname: '/pony-factor/fractured-GH/pull/51', publishedControls: true });
  assert.equal(app.enhancers.length, 1, 'only the actual composer is enhanced');
  app.events['turbo:load']();
  assert.equal(app.enhancers.length, 1);
});

test('groups image and spellcheck controls with the same gap as the native toolbar', () => {
  const app = setup({ pathname: '/pony-factor/fractured-GH/pull/51', toolbarLayout: 'flex' });
  assert.deepEqual(app.actions.children.map(node => node.className), [
    'fractured-rounded-image-button',
    'fractured-rounded-image-picker',
    'fractured-spellcheck-enhancer',
  ]);
  assert.equal(app.actions.style.gap, '12px');
  assert.equal(app.actions.style.marginInlineEnd, '0', 'the parent flex gap already separates submit');
});

test('uses matching spacing beside non-flex composer buttons', () => {
  const app = setup({ pathname: '/pony-factor/fractured-GH/pull/51' });
  assert.equal(app.actions.className, 'fractured-spellcheck-actions');
  assert.equal(app.actions.style.marginInlineEnd ?? '', '');
});
