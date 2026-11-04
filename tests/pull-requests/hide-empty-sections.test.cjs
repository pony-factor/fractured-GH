const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../features/pull-requests/hide-empty-sections.js'), 'utf8',
);
const MARKER = 'data-fractured-empty-sidebar-section';

class ElementMock {
  constructor(tag, attributes = {}, children = []) {
    this.tagName = tag.toLowerCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this.text = '';
    this.append(...children);
  }
  append(...children) {
    for (const child of children) {
      if (typeof child === 'string') this.text += child;
      else { child.parentElement = this; this.children.push(child); }
    }
  }
  contains(element) {
    return element === this || this.children.some(child => child.contains(element));
  }
  get id() { return this.attributes.id; }
  set id(value) { this.attributes.id = value; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(text) { this.text = String(text); this.children = []; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  hasAttribute(key) { return Object.hasOwn(this.attributes, key); }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const s = part.trim();
      if (s.startsWith('#')) return this.id === s.slice(1);
      if (s.startsWith('.')) return (this.attributes.class || '').split(' ').includes(s.slice(1));
      const attribute = /^\[([\w-]+)(?:(\*=|=)"?([^"\]]+)"?)?\]$/.exec(s);
      if (attribute) {
        const value = this.attributes[attribute[1]];
        if (attribute[2] === '=') return value === attribute[3];
        if (attribute[2] === '*=') return String(value || '').includes(attribute[3]);
        return value !== undefined;
      }
      return this.tagName === s.toLowerCase();
    });
  }
  querySelectorAll(selector) {
    const result = [];
    const walk = node => {
      for (const child of node.children) {
        if (child.matches(selector)) result.push(child);
        walk(child);
      }
    };
    walk(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  cloneNode() {
    const result = new ElementMock(this.tagName, this.attributes);
    result.text = this.text;
    result.append(...this.children.map(child => child.cloneNode(true)));
    return result;
  }
}

function node(tag, attributes, ...children) {
  return new ElementMock(tag, attributes || {}, children);
}
function legacySection(title, ...contents) {
  return node('div', { class: 'discussion-sidebar-item' },
    node('div', { class: 'discussion-sidebar-heading' }, title), ...contents);
}
function modernSection(title, ...contents) {
  return node('section', { 'data-testid': `sidebar-${title.toLowerCase()}-section` },
    node('h3', {}, title), ...contents);
}
async function setup({ enabled = true, route = '/pony/repo/pull/5' } = {}) {
  const sidebar = node('aside', { id: 'partial-discussion-sidebar' });
  const root = node('html', {}, sidebar);
  const head = node('head');
  let mutation;
  let changed;
  const listeners = {};
  const document = {
    documentElement: root,
    head,
    createElement: tag => node(tag),
    querySelectorAll: selector => root.querySelectorAll(selector),
    getElementById: id => [...head.querySelectorAll(`[id="${id}"]`), ...root.querySelectorAll(`[id="${id}"]`)][0],
    addEventListener(name, fn) { listeners[name] = fn; },
    removeEventListener(name) { delete listeners[name]; },
  };
  const location = { pathname: route };
  vm.runInNewContext(source, {
    document,
    location,
    window: {
      addEventListener() {},
      removeEventListener() {},
    },
    chrome: { storage: {
      local: { get: async () => ({ hideEmptySidebarSections: enabled }) },
      onChanged: { addListener(fn) { changed = fn; } },
    } },
    MutationObserver: class {
      constructor(fn) { mutation = fn; }
      observe() {}
      disconnect() { mutation = null; }
    },
    queueMicrotask,
  });
  async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
  await flush();
  return {
    sidebar,
    async mutate() { mutation?.([]); await flush(); },
    async navigate(pathname) { location.pathname = pathname; listeners['turbo:load']?.(); await flush(); },
    async toggle(value, area = 'local') {
      changed({ hideEmptySidebarSections: { newValue: value } }, area);
      await flush();
    },
  };
}

test('hides empty Labels, Projects, and Development as full sections', async () => {
  const app = await setup();
  const labels = legacySection('Labels', node('span', {}, 'None yet'));
  const projects = legacySection('Projects');
  const development = legacySection('Development', node('p', {}, 'None yet'),
    node('p', {}, 'Successfully merging this pull request may close these issues.'));
  const other = legacySection('Reviewers', node('p', {}, 'None yet'));
  app.sidebar.append(labels, projects, development, other);
  await app.mutate();
  assert.equal(labels.attributes[MARKER], 'labels');
  assert.equal(projects.attributes[MARKER], 'projects');
  assert.equal(development.attributes[MARKER], 'development');
  assert.ok(!other.hasAttribute(MARKER));
});

test('keeps populated sections and delayed/loading content visible', async () => {
  const app = await setup();
  const labels = modernSection('Labels', node('a', { href: '/org/repo/labels/bug' }, 'bug'));
  const projects = modernSection('Projects', node('a', { href: '/orgs/pony/projects/2' }, 'Roadmap'));
  const development = modernSection('Development', node('div', { 'aria-busy': 'true' }));
  app.sidebar.append(labels, projects, development);
  await app.mutate();
  for (const section of [labels, projects, development]) assert.ok(!section.hasAttribute(MARKER));
  development.children[1].removeAttribute('aria-busy');
  await app.mutate();
  assert.equal(development.attributes[MARKER], 'development');
});

test('restores when content arrives, setting is disabled, or route changes', async () => {
  const app = await setup();
  const labels = legacySection('Labels');
  app.sidebar.append(labels);
  await app.mutate();
  assert.equal(labels.attributes[MARKER], 'labels');
  labels.append(node('a', { href: '/labels/enhancement' }, 'enhancement'));
  await app.mutate();
  assert.ok(!labels.hasAttribute(MARKER));
  labels.children[1].remove();
  await app.mutate();
  assert.equal(labels.attributes[MARKER], 'labels');
  await app.toggle(false);
  assert.ok(!labels.hasAttribute(MARKER));
  await app.toggle(true);
  assert.equal(labels.attributes[MARKER], 'labels');
  await app.navigate('/pony/repo/actions');
  assert.ok(!labels.hasAttribute(MARKER));
});

test('does nothing unless enabled and ignores nonlocal preference changes', async () => {
  const app = await setup({ enabled: false, route: '/pony/repo/issues/7' });
  const projects = legacySection('Projects', node('span', {}, 'None yet'));
  app.sidebar.append(projects);
  await app.mutate();
  assert.ok(!projects.hasAttribute(MARKER));
  await app.toggle(true, 'sync');
  assert.ok(!projects.hasAttribute(MARKER));
  await app.toggle(true);
  assert.equal(projects.attributes[MARKER], 'projects');
});

test('handles nested heading markup without hiding unrelated parent wrappers', async () => {
  const app = await setup();
  const labels = node('section', {},
    node('div', { class: 'discussion-sidebar-heading' }, node('h3', {}, 'Labels')),
    node('span', {}, 'None yet'));
  const parent = node('section', {}, labels, modernSection('Projects', node('a', { href: '/projects/1' }, 'Plan')));
  app.sidebar.append(parent);
  await app.mutate();
  assert.equal(labels.attributes[MARKER], 'labels');
  assert.ok(!parent.hasAttribute(MARKER));
});
