const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/pull-requests/hide-pr-heading-actions.js'), 'utf8',
);
const attribute = 'data-fractured-hidden-pr-heading-action';

function element(label, { tag = 'button', nav = false, beforeTitle = true } = {}) {
  const attributes = {};
  const shell = {
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
    get marked() { return attributes[attribute]; },
  };
  return {
    tag,
    shell,
    textContent: label,
    getAttribute() { return null; },
    matches(value) { return value === tag; },
    closest(selector) {
      if (selector.startsWith('nav,')) return nav ? {} : null;
      if (selector === 'details') return tag === 'summary' ? shell : null;
      return null;
    },
    compareDocumentPosition() { return beforeTitle ? 4 : 2; },
    setAttribute: (...args) => shell.setAttribute(...args),
    removeAttribute: (...args) => shell.removeAttribute(...args),
    get marked() { return shell.marked; },
  };
}

async function setup({ controls, settings, pathname = '/oliverjessner/PineFetch/pull/23' }) {
  let onChange;
  let mutation;
  const events = {};
  const title = {};
  const document = {
    head: { append() {} },
    createElement() { return { textContent: '' }; },
    querySelector() { return title; },
    querySelectorAll(selector) {
      if (selector === '[' + attribute + ']') return controls.flatMap(c => [c, c.shell]).filter(c => c.marked);
      if (selector.startsWith('button, summary')) return controls;
      return [];
    },
    addEventListener(name, cb) { events[name] = cb; },
  };
  const window = { location: { pathname }, addEventListener(name, cb) { events[name] = cb; } };
  vm.runInNewContext(source, {
    document, window, queueMicrotask,
    MutationObserver: class { constructor(cb) { mutation = cb; } observe() {} },
    chrome: { storage: {
      local: { get: async () => settings },
      onChanged: { addListener(cb) { onChange = cb; } },
    } },
  });
  async function flush() { for (let i = 0; i < 4; i++) await Promise.resolve(); }
  await flush();
  return {
    controls, events,
    async settings(changes, area = 'local') {
      onChange(Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, { newValue: value }])), area);
      await flush();
    },
    async rerender() { mutation(); await flush(); },
    async route(path) { window.location.pathname = path; events.popstate(); await flush(); },
  };
}

test('can hide the two PR heading buttons independently without hiding repository Code navigation', async () => {
  const merge = element('Merge status');
  const code = element('Code', { tag: 'summary' });
  const navigation = element('Code', { nav: true });
  const laterCode = element('Code', { beforeTitle: false });
  const page = await setup({
    controls: [merge, code, navigation, laterCode],
    settings: { hidePullRequestMergeStatus: true, hidePullRequestCodeButton: false },
  });
  assert.equal(merge.marked, 'merge-status');
  assert.equal(code.shell.marked, undefined);
  await page.settings({ hidePullRequestMergeStatus: false, hidePullRequestCodeButton: true });
  assert.equal(merge.marked, undefined);
  assert.equal(code.shell.marked, 'code');
  assert.equal(navigation.marked, undefined);
  assert.equal(laterCode.marked, undefined);
});

test('restores both controls when preferences are disabled', async () => {
  const merge = element('Merge status');
  const code = element('Code');
  const page = await setup({ controls: [merge, code], settings: {
    hidePullRequestMergeStatus: true, hidePullRequestCodeButton: true,
  } });
  assert.equal(merge.marked, 'merge-status');
  assert.equal(code.marked, 'code');
  await page.settings({ hidePullRequestMergeStatus: false, hidePullRequestCodeButton: false });
  assert.equal(merge.marked, undefined);
  assert.equal(code.marked, undefined);
});

test('only operates on PR routes and responds to client-side navigation', async () => {
  const merge = element('Merge status');
  const page = await setup({
    controls: [merge],
    settings: { hidePullRequestMergeStatus: true },
    pathname: '/oliverjessner/PineFetch',
  });
  assert.equal(merge.marked, undefined);
  await page.route('/oliverjessner/PineFetch/pull/23');
  assert.equal(merge.marked, 'merge-status');
  await page.route('/oliverjessner/PineFetch/issues/23');
  assert.equal(merge.marked, undefined);
});

test('notices actions inserted after the initial render', async () => {
  const controls = [];
  const page = await setup({ controls, settings: { hidePullRequestCodeButton: true } });
  const code = element('Code');
  controls.push(code);
  await page.rerender();
  assert.equal(code.marked, 'code');
});
