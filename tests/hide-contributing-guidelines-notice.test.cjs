const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/pull-requests/hide-contributing-guidelines-notice.js'), 'utf8',
);

class TextNode {
  constructor(value) { this.textContent = value; }
}

class ElementMock {
  constructor(tagName, children = [], attrs = {}) {
    this.tagName = tagName.toLowerCase();
    this.attrs = attrs;
    this.hidden = false;
    this.children = [];
    this.append(...children);
  }
  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === 'string' ? new TextNode(node) : node;
      child.parentElement = this;
      this.children.push(child);
    }
  }
  matches(selector) {
    return selector.split(',').map(x => x.trim()).includes(this.tagName);
  }
  get textContent() {
    return this.children.map(child => child.textContent).join('');
  }
  getAttribute(name) { return this.attrs[name] || null; }
  querySelectorAll(selector) {
    const found = [];
    function walk(root) {
      for (const child of root.children) {
        if (!(child instanceof ElementMock)) continue;
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    }
    walk(this);
    return found;
  }
}

function el(tag, ...children) { return new ElementMock(tag, children); }
function anchor(text, href) { return new ElementMock('a', [text], { href }); }
function legacyNotice() {
  return el('p', 'Remember, contributions to this repository should follow its ',
    anchor('contributing guidelines', 'https://github.com/pony-factor/fractured-GH/blob/main/CONTRIBUTING.md'), '.');
}
function communityNotice() {
  return el('div', el('svg'), el('span',
    'Remember, contributions to this repository should follow our ',
    anchor('GitHub Community Guidelines', 'https://docs.github.com/en/site-policy/github-terms/github-community-guidelines'), '.'));
}

async function setup(enabled = true) {
  const container = el('main');
  const listeners = {};
  let onMutation;
  const document = {
    documentElement: container,
    querySelectorAll: selector => container.querySelectorAll(selector),
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  vm.runInNewContext(source, {
    chrome: { storage: { local: { get: async () => ({ hideContributingGuidelinesNotice: enabled }) } } },
    document,
    Element: ElementMock,
    MutationObserver: class {
      constructor(callback) { onMutation = callback; }
      observe() {}
    },
  });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  return {
    container,
    emit(node) { onMutation?.([{ addedNodes: [node] }]); },
    navigate(name) { listeners[name]?.(); },
  };
}

test('hides the original CONTRIBUTING.md paragraph but not unrelated text', async () => {
  const app = await setup();
  const legacy = legacyNotice();
  const unrelated = el('p', 'Remember, contributions to this repository should follow the rules.');
  app.container.append(legacy, unrelated);
  app.navigate('turbo:load');
  assert.equal(legacy.hidden, true);
  assert.equal(unrelated.hidden, false);
});

test('hides the entire icon-and-text GitHub Community Guidelines notice', async () => {
  const app = await setup();
  const community = communityNotice();
  const submit = el('button', 'Create pull request');
  app.container.append(community, submit);
  app.emit(community);
  assert.equal(community.hidden, true);
  assert.equal(submit.hidden, false);
});

test('does not hide the notice if it lacks the expected guideline link', async () => {
  const app = await setup();
  const wrongLink = el('p', 'Remember, contributions to this repository should follow our ',
    anchor('GitHub Community Guidelines', 'https://example.com/other'), '.');
  const plainText = el('p', 'Remember, contributions to this repository should follow our GitHub Community Guidelines.');
  app.container.append(wrongLink, plainText);
  app.navigate('pjax:end');
  assert.equal(wrongLink.hidden, false);
  assert.equal(plainText.hidden, false);
});

test('respects the off setting and handles newly inserted notices', async () => {
  const disabled = await setup(false);
  const untouched = communityNotice();
  disabled.container.append(untouched);
  disabled.navigate('turbo:load');
  assert.equal(untouched.hidden, false);

  const enabled = await setup(true);
  const dynamic = communityNotice();
  enabled.container.append(dynamic);
  enabled.emit(dynamic);
  assert.equal(dynamic.hidden, true);
});
