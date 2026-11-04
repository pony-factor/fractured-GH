const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../features/repositories/hide-social-actions.js'),
  'utf8',
);
const hidden = 'data-fractured-hidden-repository-control';
const compact = 'data-fractured-compact-repository-action';
const repository = 'pony-factor/fractured-GH';

function setup(preferences = {}) {
  const nodes = [];
  const groups = [];
  const frames = [];
  const events = {};
  const settings = { ...preferences };
  let onChange;
  let onMutation;

  function element(text = '', { tag = 'button', href = null, arrow = false, icon = false } = {}) {
    const attributes = new Map();
    const node = {
      tag, textContent: text, href,
      getAttribute: key => attributes.get(key) ?? null,
      setAttribute: (key, value) => { attributes.set(key, value); },
      removeAttribute: key => { attributes.delete(key); },
      hasAttribute: key => attributes.has(key),
      matches: selector => selector === tag,
      closest: () => null,
      querySelector(selector) {
        if (selector.startsWith('svg.octicon-triangle-down')) return this.arrow || null;
        if (selector.includes('svg.octicon-eye')) return icon ? {} : null;
        return null;
      },
    };
    if (arrow) {
      node.arrow = element('', { tag: 'svg' });
    }
    nodes.push(node);
    return node;
  }

  function addAction(name, { count = '23', mainArrow = false, menu = true } = {}) {
    const endpoints = { Watch: 'watchers', Star: 'stargazers', Fork: 'forks' };
    const main = element(name, { arrow: mainArrow });
    const counter = element(count, {
      tag: 'a',
      href: 'https://github.com/' + repository + '/' + endpoints[name],
    });
    const shell = element('', { tag: 'details' });
    const toggle = element('', { tag: 'summary', arrow: menu });
    toggle.closest = selector => selector === 'details' ? shell : null;
    const controls = [main, counter, ...(menu ? [toggle] : [])];
    groups.push({
      querySelectorAll(selector) {
        if (selector === 'a, button, summary') return controls;
        if (selector === 'a[href]') return [counter];
        if (selector === 'button, summary, [role="button"]') return [main, ...(menu ? [toggle] : [])];
        if (selector.startsWith('.Counter,')) return [];
        throw new Error('Unknown group query: ' + selector);
      },
    });
    return { main, counter, shell, toggle };
  }


  // GitHub renders Pin as its own button in the repository header.
  function addHeaderButton(label, { ariaLabel = '', title = '' } = {}) {
    const control = element(label);
    if (ariaLabel) control.setAttribute('aria-label', ariaLabel);
    if (title) control.setAttribute('title', title);
    const group = element('', { tag: 'div' });
    group.querySelectorAll = selector => selector === 'a, button, summary' ? [control] : [];
    groups.push(group);
    return { control, group };
  }

  const document = {
    head: { append() {} },
    documentElement: {},
    createElement() { return { textContent: '' }; },
    querySelector(selector) {
      if (selector.includes('octolytics-dimension-repository_nwo')) {
        return { getAttribute() { return repository; } };
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[' + hidden + '], [' + compact + ']') {
        return nodes.filter(node => node.hasAttribute(hidden) || node.hasAttribute(compact));
      }
      if (selector.startsWith('a[href*=')) return [];
      if (selector.startsWith('[data-testid="repo-header-actions"]')) {
        return [{ children: groups }];
      }
      return [];
    },
    addEventListener(name, listener) { events[name] = listener; },
  };
  vm.runInNewContext(source, {
    document, URL,
    location: { origin: 'https://github.com', pathname: '/' + repository },
    requestAnimationFrame(fn) { frames.push(fn); },
    MutationObserver: class {
      constructor(fn) { onMutation = fn; }
      observe() {}
    },
    window: { addEventListener(name, fn) { events[name] = fn; } },
    chrome: { storage: {
      local: { async get() { return { ...settings }; } },
      onChanged: { addListener(fn) { onChange = fn; } },
    } },
  });

  async function settle() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    while (frames.length) {
      frames.shift()();
      for (let i = 0; i < 4; i++) await Promise.resolve();
    }
  }
  return {
    addAction, addHeaderButton, settings, settle,
    async toggle(name, enabled) {
      settings[name] = enabled;
      onChange({ [name]: { newValue: enabled } }, 'local');
      await settle();
    },
    async rerender() { onMutation(); await settle(); },
    async navigate() { events['turbo:load'](); await settle(); },
  };
}

test('Watch, Star, and Fork retain primary buttons while losing counters and split menus', async () => {
  const app = setup({
    hideRepositoryWatch: true, hideRepositoryStar: true, hideRepositoryFork: true,
  });
  const actions = [app.addAction('Watch'), app.addAction('Star'), app.addAction('Fork')];
  await app.settle();
  for (const action of actions) {
    assert.equal(action.main.hasAttribute(hidden), false);
    assert.equal(action.main.hasAttribute(compact), true);
    assert.equal(action.counter.getAttribute(hidden)?.endsWith('-count'), true);
    assert.equal(action.shell.getAttribute(hidden)?.endsWith('-menu'), true);
  }
});

test('hides an integrated arrow on the Watch primary button without disabling Watch', async () => {
  const app = setup({ hideRepositoryWatch: true });
  const watch = app.addAction('Watch', { mainArrow: true, menu: false });
  await app.settle();
  assert.equal(watch.main.hasAttribute(hidden), false);
  assert.equal(watch.main.arrow.getAttribute(hidden), 'watch-chevron');
});

test('each preference works independently and can restore the native header', async () => {
  const app = setup({ hideRepositoryWatch: false, hideRepositoryStar: true, hideRepositoryFork: false });
  const watch = app.addAction('Watch');
  const star = app.addAction('Star');
  const fork = app.addAction('Fork');
  await app.settle();
  assert.equal(star.counter.getAttribute(hidden), 'star-count');
  assert.equal(star.shell.getAttribute(hidden), 'star-menu');
  assert.equal(watch.counter.hasAttribute(hidden), false);
  assert.equal(fork.counter.hasAttribute(hidden), false);

  await app.toggle('hideRepositoryStar', false);
  assert.equal(star.main.hasAttribute(compact), false);
  assert.equal(star.counter.hasAttribute(hidden), false);
  assert.equal(star.shell.hasAttribute(hidden), false);

  await app.toggle('hideRepositoryFork', true);
  assert.equal(fork.counter.getAttribute(hidden), 'fork-count');
  assert.equal(fork.shell.getAttribute(hidden), 'fork-menu');
});

test('ignores nonnumeric destination links but updates after GitHub replaces header controls', async () => {
  const app = setup({ hideRepositoryStar: true });
  const original = app.addAction('Star', { count: 'View stargazers' });
  await app.settle();
  assert.equal(original.counter.hasAttribute(hidden), false);

  const later = app.addAction('Star', { count: '1.2k' });
  await app.rerender();
  assert.equal(later.counter.getAttribute(hidden), 'star-count');
  assert.equal(later.shell.getAttribute(hidden), 'star-menu');
  await app.navigate();
  assert.equal(later.main.hasAttribute(hidden), false);
});

test('hides the short Pin button while preserving Star and Fork and responds to preference changes', async () => {
  const app = setup({ hideRepositoryStar: true, hideRepositoryFork: true });
  const pin = app.addHeaderButton('Pin');
  const star = app.addAction('Star');
  const fork = app.addAction('Fork');
  await app.settle();

  assert.equal(pin.group.getAttribute(hidden), 'pins-button');
  assert.equal(star.main.hasAttribute(hidden), false);
  assert.equal(fork.main.hasAttribute(hidden), false);

  await app.toggle('hideRepositoryPins', false);
  assert.equal(pin.group.hasAttribute(hidden), false);
  assert.equal(star.main.hasAttribute(hidden), false);
  assert.equal(fork.main.hasAttribute(hidden), false);

  await app.toggle('hideRepositoryPins', true);
  assert.equal(pin.group.getAttribute(hidden), 'pins-button');
});

test('recognizes Pin, Unpin, and Edit pins labels including accessible-only buttons', async () => {
  const app = setup();
  const pinByTitle = app.addHeaderButton('', { title: 'Pin' });
  const pinByAria = app.addHeaderButton('', { ariaLabel: 'Pin repository' });
  const unpin = app.addHeaderButton('Unpin');
  const editPins = app.addHeaderButton('Edit pins');
  const unrelated = app.addHeaderButton('Pinned');

  await app.settle();
  for (const action of [pinByTitle, pinByAria, unpin, editPins]) {
    assert.equal(action.group.getAttribute(hidden), 'pins-button');
  }
  assert.equal(unrelated.group.hasAttribute(hidden), false);

  await app.rerender();
  assert.equal(pinByTitle.group.getAttribute(hidden), 'pins-button');
  await app.navigate();
  assert.equal(pinByAria.group.getAttribute(hidden), 'pins-button');
});
