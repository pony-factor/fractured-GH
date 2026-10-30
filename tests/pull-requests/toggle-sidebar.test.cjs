const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../features/pull-requests/toggle-pull-request-sidebar.js'), 'utf8',
);

function setup() {
  const settings = { pullRequestSidebarToggleEnabled: true, pullRequestSidebarCollapsed: false };
  const location = { pathname: '/owner/repo/pull/68' };
  const listeners = new Map();
  const attrs = new Map();
  const styles = new Map();
  const root = {
    setAttribute(key, value) { attrs.set(key, value); },
    removeAttribute(key) { attrs.delete(key); },
    getAttribute(key) { return attrs.get(key); },
  };
  class Element {
    constructor() {
      this.children = [];
      this.attrs = new Map();
      this.parentElement = null;
      this.isConnected = true;
    }
    append(child) {
      child.parentElement = this;
      child.isConnected = true;
      this.children.push(child);
    }
    prepend(child) {
      child.parentElement = this;
      child.isConnected = true;
      this.children.unshift(child);
    }
    setAttribute(key, value) { this.attrs.set(key, value); }
    getAttribute(key) { return this.attrs.get(key); }
    removeAttribute(key) { this.attrs.delete(key); }
    addEventListener(type, cb) { this['on' + type] = cb; }
    contains(child) {
      return this.children.includes(child)
        || this.children.some(c => c.contains?.(child));
    }
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(c => c !== this);
      }
      this.isConnected = false;
    }
  }
  const layout = new Element();
  const main = new Element();
  const column = new Element();
  const sidebar = new Element();
  layout.append(main);
  layout.append(column);
  column.append(sidebar);
  sidebar.closest = selector => selector === '.Layout-sidebar' ? column : null;
  layout.querySelector = selector => selector.includes('.Layout-main') ? main : null;
  layout.closest = () => null;
  let onChanged;
  let mutationCallback;
  let observer;
  const document = {
    documentElement: root,
    body: {},
    head: { append(node) { styles.set(node.id, node); } },
    createElement() { return new Element(); },
    createElementNS() { return new Element(); },
    getElementById(id) { return styles.get(id) || null; },
    querySelectorAll() { return [sidebar]; },
    addEventListener(name, cb) { listeners.set(name, cb); },
  };
  const chrome = {
    storage: {
      local: {
        async get(defaults) { return { ...defaults, ...settings }; },
        async set(changes) { Object.assign(settings, changes); },
      },
      onChanged: { addListener(cb) { onChanged = cb; } },
    },
  };
  vm.runInNewContext(source, {
    chrome, document, location, queueMicrotask,
    window: { addEventListener(name, cb) { listeners.set(name, cb); } },
    MutationObserver: class {
      constructor(cb) { mutationCallback = cb; }
      observe() { observer = this; }
      disconnect() { observer = null; }
    },
  });
  return {
    settings, location, root, main, column, styles, listeners,
    async settle() { await Promise.resolve(); await Promise.resolve(); },
    async click() { main.children[0].children[0].onclick(); await Promise.resolve(); },
    button() { return main.children[0]?.children[0]; },
    async route(route) {
      location.pathname = route;
      listeners.get('popstate')();
      await Promise.resolve();
    },
    async storage(changes) {
      Object.assign(settings, changes);
      onChanged(Object.fromEntries(Object.entries(changes).map(([key, value]) =>
        [key, { newValue: value }])), 'local');
      await Promise.resolve();
    },
    async rerender() { mutationCallback?.(); await Promise.resolve(); },
    observing() { return Boolean(observer); },
  };
}

test('a sidebar hamburger hides the entire column and restores it', async () => {
  const app = setup();
  await app.settle();
  assert.equal(app.button().getAttribute('aria-label'), 'Hide pull request sidebar');
  assert.equal(app.root.getAttribute('data-fractured-pr-sidebar-collapsed'), undefined);
  await app.click();
  assert.equal(app.settings.pullRequestSidebarCollapsed, true);
  assert.equal(app.root.getAttribute('data-fractured-pr-sidebar-collapsed'), 'true');
  assert.equal(app.button().getAttribute('aria-label'), 'Show pull request sidebar');
  assert.equal(app.button().getAttribute('aria-expanded'), 'false');
  assert.ok(app.column.attrs.has('data-fractured-pr-sidebar-column'));
  assert.match(app.styles.get('fractured-pr-sidebar-toggle-style').textContent,
    /display:none !important/);
  await app.click();
  assert.equal(app.root.getAttribute('data-fractured-pr-sidebar-collapsed'), undefined);
  assert.equal(app.button().getAttribute('aria-expanded'), 'true');
});

test('navigation and disabling the feature clean up the injected elements', async () => {
  const app = setup();
  await app.settle();
  await app.click();
  await app.route('/owner/repo/issues/68');
  assert.equal(app.main.children.length, 0);
  assert.equal(app.root.getAttribute('data-fractured-pr-sidebar-collapsed'), undefined);
  assert.equal(app.observing(), false);
  await app.route('/owner/repo/pull/70');
  assert.ok(app.button());
  assert.equal(app.root.getAttribute('data-fractured-pr-sidebar-collapsed'), 'true');
  await app.storage({ pullRequestSidebarToggleEnabled: false });
  assert.equal(app.main.children.length, 0);
  assert.equal(app.root.getAttribute('data-fractured-pr-sidebar-collapsed'), undefined);
});

test('mutation redraws do not duplicate controls and stored state updates', async () => {
  const app = setup();
  await app.settle();
  await app.rerender();
  assert.equal(app.main.children.length, 1);
  await app.storage({ pullRequestSidebarCollapsed: true });
  assert.equal(app.root.getAttribute('data-fractured-pr-sidebar-collapsed'), 'true');
  await app.storage({ pullRequestSidebarCollapsed: false });
  assert.equal(app.root.getAttribute('data-fractured-pr-sidebar-collapsed'), undefined);
});
