const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,
  '../../features/repositories/repository-code-shortcuts.js'), 'utf8');

function setup(pathname = '/pony-factor/fractured-GH') {
  const navigations = [];
  const location = {
    origin: 'https://github.com', pathname,
    get href() { return this.origin + this.pathname; },
    assign(url) { navigations.push(url); },
  };
  const settings = {
    openCodeInVsCodeWeb: true,
    hideRepositoryTagsShortcut: true,
    hideUnprotectedBranchWarning: true,
  };
  const frames = [], opens = [], events = {}, nodes = [];
  let observer, onStorageChange;

  function node(kind, text, extra = {}) {
    const attributes = new Set();
    const element = {
      kind, textContent: text, parentElement: extra.parent || null,
      href: extra.href,
      getAttribute(name) { return extra[name] || null; },
      setAttribute(name) { attributes.add(name); },
      removeAttribute(name) { attributes.delete(name); },
      hasAttribute(name) { return attributes.has(name); },
      matches(selector) {
        if (selector.includes('button') && kind === 'button') return true;
        if (selector.includes('summary') && kind === 'summary') return true;
        return selector.includes('[data-testid="code-button"]')
          && extra['data-testid'] === 'code-button';
      },
      closest(selector) {
        if (selector.includes('button, summary')) return kind === 'button' ? this : null;
        if (selector.includes('.file-navigation')) return extra.fileNavigation ? this : null;
        return null;
      },
      querySelector(selector) {
        if (selector === 'svg.octicon-tag' || selector === 'svg') return extra.icon ? {} : null;
        if (selector === 'svg.octicon-code') return extra.codeIcon ? {} : null;
        return null;
      },
    };
    nodes.push(element);
    return element;
  }
  const code = node('button', 'Code', { 'data-testid': 'code-button' });
  const tag = node('a', '', {
    href: 'https://github.com/pony-factor/fractured-GH/tags', icon: true,
  });
  const warning = node('div', "Your main branch isn't protected. Protect this branch Dismiss");
  node('button', 'Protect this branch', { parent: warning });
  const unrelated = node('a', 'Tags', {
    href: 'https://github.com/pony-factor/fractured-GH/tags',
  });
  const document = {
    head: { append() {} }, documentElement: {},
    createElement() { return { textContent: '' }; },
    querySelector(selector) {
      if (selector === 'meta[name="octolytics-dimension-repository_nwo"]') {
        return { getAttribute() { return 'pony-factor/fractured-GH'; } };
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith('[')) {
        const attrs = ['data-fractured-vscode-code',
          'data-fractured-hidden-tags-shortcut', 'data-fractured-hidden-branch-warning'];
        return nodes.filter(item => attrs.some(attr => item.hasAttribute(attr)));
      }
      if (selector === 'a[href]') return nodes.filter(item => item.kind === 'a');
      if (selector === 'a, button') return nodes.filter(item =>
        item.kind === 'a' || item.kind === 'button');
      if (selector === 'button, summary, [role="button"]') return nodes.filter(item =>
        item.kind === 'button' || item.kind === 'summary');
      throw Error('Unknown selector ' + selector);
    },
    addEventListener(event, callback) { events[event] = callback; },
  };
  const chrome = {
    storage: {
      local: { async get() { return { ...settings }; } },
      onChanged: { addListener(listener) { onStorageChange = listener; } },
    },
  };
  const window = {
    open(...args) { opens.push(args); },
    addEventListener(event, callback) { events[event] = callback; },
  };
  vm.runInNewContext(source, {
    window, document, chrome, location, URL,
    requestAnimationFrame(callback) { frames.push(callback); },
    MutationObserver: class {
      constructor(callback) { observer = callback; }
      observe() {}
    },
  });
  async function settle() {
    await new Promise(resolve => setImmediate(resolve));
    while (frames.length) frames.shift()();
  }
  function click(target) {
    let prevented = false, stopped = false;
    events.click({
      target,
      preventDefault() { prevented = true; },
      stopImmediatePropagation() { stopped = true; },
    });
    return { prevented, stopped };
  }
  function keydown(overrides = {}) {
    let prevented = false, stopped = false;
    events.keydown({
      key: '.', target: code,
      preventDefault() { prevented = true; },
      stopImmediatePropagation() { stopped = true; },
      ...overrides,
    });
    return { prevented, stopped };
  }
  return {
    code, tag, warning, unrelated, settings, location, opens, click, settle,
    keydown, navigations,
    async changeSettings() {
      onStorageChange({ openCodeInVsCodeWeb: {}, hideRepositoryTagsShortcut: {},
        hideUnprotectedBranchWarning: {} }, 'local');
      await settle();
    },
    async mutate() { observer(); await settle(); },
  };
}

test('Code opens vscode.dev instead of the GitHub dropdown', async () => {
  const app = setup();
  await app.settle();
  assert.equal(app.code.hasAttribute('data-fractured-vscode-code'), true);
  assert.deepEqual(app.click(app.code), { prevented: true, stopped: true });
  assert.deepEqual(Array.from(app.opens[0]), [
    'https://vscode.dev/github/pony-factor/fractured-GH', '_blank', 'noopener,noreferrer',
  ]);
  assert.deepEqual(app.click(app.unrelated), { prevented: false, stopped: false });
});

test('period opens the current repository, branch, file or PR in github.dev', async () => {
  for (const pathname of ['/pony-factor/fractured-GH',
    '/pony-factor/fractured-GH/tree/my-branch',
    '/pony-factor/fractured-GH/blob/main/README.md?plain=1#L12',
    '/pony-factor/fractured-GH/pull/42']) {
    const app = setup(pathname);
    await app.settle();
    assert.deepEqual(app.keydown(), { prevented: true, stopped: true });
    assert.deepEqual(app.navigations, ['https://github.dev' + pathname]);
    assert.equal(app.opens.length, 0);
  }
});

test('period leaves typing, modified keys, disabled settings and other pages alone', async () => {
  const app = setup();
  await app.settle();
  for (const overrides of [
    { target: { closest() { return {}; } } },
    { target: { isContentEditable: true } },
    { target: app.code, composedPath() { return [{ isContentEditable: true }]; } },
    { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    { repeat: true }, { isComposing: true }, { defaultPrevented: true }, { key: 'a' },
  ]) {
    assert.deepEqual(app.keydown(overrides), { prevented: false, stopped: false });
  }
  app.location.pathname = '/pony-factor/fractured-GH-other';
  assert.deepEqual(app.keydown(), { prevented: false, stopped: false });
  app.location.pathname = '/pony-factor/fractured-GH';
  app.settings.openCodeInVsCodeWeb = false;
  await app.changeSettings();
  assert.deepEqual(app.keydown(), { prevented: false, stopped: false });
  assert.deepEqual(app.navigations, []);
});

test('hides only the tag icon and the unprotected-branch banner', async () => {
  const app = setup();
  await app.settle();
  assert.equal(app.tag.hasAttribute('data-fractured-hidden-tags-shortcut'), true);
  assert.equal(app.unrelated.hasAttribute('data-fractured-hidden-tags-shortcut'), false);
  assert.equal(app.warning.hasAttribute('data-fractured-hidden-branch-warning'), true);
  await app.mutate();
  assert.equal(app.warning.hasAttribute('data-fractured-hidden-branch-warning'), true);
});

test('settings and GitHub navigation restore native repository controls', async () => {
  const app = setup();
  await app.settle();
  app.settings.openCodeInVsCodeWeb = false;
  app.settings.hideRepositoryTagsShortcut = false;
  app.settings.hideUnprotectedBranchWarning = false;
  await app.changeSettings();
  assert.equal(app.code.hasAttribute('data-fractured-vscode-code'), false);
  assert.equal(app.tag.hasAttribute('data-fractured-hidden-tags-shortcut'), false);
  assert.equal(app.warning.hasAttribute('data-fractured-hidden-branch-warning'), false);
  assert.deepEqual(app.click(app.code), { prevented: false, stopped: false });
  app.settings.openCodeInVsCodeWeb = true;
  app.settings.hideRepositoryTagsShortcut = true;
  app.settings.hideUnprotectedBranchWarning = true;
  app.location.pathname = '/pony-factor/fractured-GH/issues/42';
  await app.changeSettings();
  assert.deepEqual(app.click(app.code), { prevented: false, stopped: false });
  assert.equal(app.tag.hasAttribute('data-fractured-hidden-tags-shortcut'), false);
  assert.equal(app.warning.hasAttribute('data-fractured-hidden-branch-warning'), false);
});
