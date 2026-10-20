const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/interface/block-tooltips.js'), 'utf8',
);

class FakeElement {
  constructor(tag, text = '') {
    this.tag = tag;
    this.text = text;
    this.attributes = new Map();
    this.children = [];
  }

  get textContent() {
    return this.text + this.children.map(child => child.textContent).join('');
  }

  append(child) {
    this.children.push(child);
    child.parent = this;
  }

  matches(selector) {
    return selector.split(',').map(part => part.trim()).includes(this.tag);
  }

  closest(selector) {
    const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1];
    for (let node = this; node; node = node.parent) {
      if (attribute && node.hasAttribute(attribute)) return node;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1];

    const visit = node => {
      for (const child of node.children) {
        if (attribute ? child.hasAttribute(attribute) : child.matches(selector)) {
          results.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
}

function setup({ enabled, pathname = '/orgs/blocktransfer/repositories' }) {
  const body = new FakeElement('html');
  const styles = new Map();
  const listeners = new Map();
  let storageListener;
  let mutationListener;

  const document = {
    documentElement: body,
    head: { append(style) {
      styles.set(style.id, style);
      style.remove = () => styles.delete(style.id);
    } },
    createElement: () => ({ id: '', textContent: '' }),
    getElementById: id => styles.get(id) || null,
    querySelectorAll: selector => body.querySelectorAll(selector),
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
  };
  const location = { pathname };
  vm.runInNewContext(source, {
    document, location, Element: FakeElement,
    chrome: {
      storage: {
        local: { async get() { return { blockTooltips: enabled }; } },
        onChanged: { addListener(listener) { storageListener = listener; } },
      },
    },
    MutationObserver: class {
      constructor(listener) { mutationListener = listener; }
      observe() {}
      disconnect() {}
    },
  });

  return {
    body, styles, listeners, location,
    async settle() { await Promise.resolve(); await Promise.resolve(); },
    insert(node) {
      body.append(node);
      mutationListener?.([{ type: 'childList', target: body, addedNodes: [node] }]);
    },
    changeSetting(nextEnabled) {
      storageListener({ blockTooltips: { newValue: nextEnabled } }, 'local');
    },
  };
}

const tipText = "ProTip! When viewing an organization's repositories, you can use the props. filter to filter by custom property.";

test('blocks only the organization repository ProTip when tooltip blocking is enabled', async () => {
  const app = setup({ enabled: true });
  const listing = new FakeElement('div', '2 repositories TAD3-protocol TAD2');
  const tip = new FakeElement('div', tipText);
  app.body.append(listing);
  app.body.append(tip);
  await app.settle();
  // Content inserted after startup is handled by the mutation observer.
  app.insert(new FakeElement('div', tipText.replace('organization\'s', 'organization’s')));
  assert.equal(listing.hasAttribute('data-github-tweaks-blocked-org-protip'), false);
  assert.equal(tip.hasAttribute('data-github-tweaks-blocked-org-protip'), true);
  assert.ok(app.styles.get('github-tweaks-block-tooltips-style').textContent.includes(
    '[data-github-tweaks-blocked-org-protip]'));
});

test('restores the notice when disabled, and ignores other routes', async () => {
  const app = setup({ enabled: false });
  const tip = new FakeElement('div', tipText);
  app.body.append(tip);
  await app.settle();
  assert.equal(tip.hasAttribute('data-github-tweaks-blocked-org-protip'), false);

  app.changeSetting(true);
  assert.equal(tip.hasAttribute('data-github-tweaks-blocked-org-protip'), true);
  app.location.pathname = '/orgs/blocktransfer/people';
  app.listeners.get('turbo:load')();
  assert.equal(tip.hasAttribute('data-github-tweaks-blocked-org-protip'), false);

  app.location.pathname = '/orgs/blocktransfer/repositories';
  app.listeners.get('pjax:end')();
  assert.equal(tip.hasAttribute('data-github-tweaks-blocked-org-protip'), true);
  app.changeSetting(false);
  assert.equal(tip.hasAttribute('data-github-tweaks-blocked-org-protip'), false);
  assert.equal(app.styles.size, 0);
});

test('leaves unrelated ProTips and content alone', async () => {
  const app = setup({ enabled: true });
  await app.settle();
  const other = new FakeElement('p', 'ProTip! Use shortcuts to navigate GitHub.');
  const container = new FakeElement('div');
  container.append(other);
  app.insert(container);
  assert.equal(container.hasAttribute('data-github-tweaks-blocked-org-protip'), false);
  assert.equal(other.hasAttribute('data-github-tweaks-blocked-org-protip'), false);
});
