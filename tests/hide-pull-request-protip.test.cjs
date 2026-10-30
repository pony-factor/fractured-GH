const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/pull-requests/hide-pull-request-protip.js'), 'utf8',
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
  get textContent() { return this.children.map(child => child.textContent).join(''); }
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
function anchor(text) { return new ElementMock('a', [text], { href: '#tip' }); }
function lineTip() {
  return el('div', el('span', 'ProTip! Add comments to specific lines under ',
    anchor('Files changed'), '.'));
}
function patchTip() {
  return el('div', el('svg'), el('p', 'ProTip! Add ',
    anchor('.patch'), ' or ', anchor('.diff'),
    ' to the end of URLs for Git’s plaintext views.'));
}

async function setup(enabled = true) {
  const container = el('main');
  const listeners = {};
  let onMutation;
  let onStorageChange;
  const document = {
    documentElement: container,
    querySelectorAll: selector => container.querySelectorAll(selector),
    addEventListener(name, callback) { listeners[name] = callback; },
  };
  vm.runInNewContext(source, {
    chrome: { storage: {
      local: { get: async () => ({ hidePullRequestProtip: enabled }) },
      onChanged: { addListener(callback) { onStorageChange = callback; } },
    } },
    document,
    Element: ElementMock,
    queueMicrotask,
    MutationObserver: class {
      constructor(callback) { onMutation = callback; }
      observe() {}
    },
  });
  async function flush() { for (let i = 0; i < 4; i++) await Promise.resolve(); }
  await flush();
  return {
    container,
    async emit(node) { onMutation?.([{ addedNodes: [node] }]); await flush(); },
    async navigate(name) { listeners[name]?.(); await flush(); },
    async toggle(value, area = 'local') {
      onStorageChange?.({ hidePullRequestProtip: { newValue: value } }, area);
      await flush();
    },
  };
}

test('hides both line-comment and patch/diff tips while leaving unrelated text visible', async () => {
  const page = await setup();
  const line = lineTip();
  const patch = patchTip();
  const unrelated = el('p', 'ProTip! Keep a copy of your notes.');
  page.container.append(line, patch, unrelated);
  await page.navigate('turbo:load');
  assert.equal(line.hidden, true);
  assert.equal(patch.hidden, true);
  assert.equal(unrelated.hidden, false);
});

test('hides tips inserted after initial load and restores them when disabled', async () => {
  const page = await setup(true);
  const patch = patchTip();
  const form = el('div', el('textarea'), patch, el('button', 'Comment'));
  page.container.append(form);
  await page.emit(patch);
  assert.equal(patch.hidden, true);
  assert.equal(form.hidden, false);
  await page.toggle(false);
  assert.equal(patch.hidden, false);
  await page.toggle(true);
  assert.equal(patch.hidden, true);
});

test('respects a disabled preference and ignores unrelated storage changes', async () => {
  const page = await setup(false);
  const patch = patchTip();
  page.container.append(patch);
  await page.navigate('turbo:load');
  assert.equal(patch.hidden, false);
  await page.toggle(true, 'sync');
  assert.equal(patch.hidden, false);
  await page.toggle(true);
  assert.equal(patch.hidden, true);
});

test('both notice switches appear only under General > Footer', () => {
  const html = fs.readFileSync(path.join(__dirname, '../options.html'), 'utf8');
  const footer = html.split('<span>Footer</span>')[1].split('</details>')[0];
  const pullRequests = html.split('id="settings-panel-pull-requests"')[1];
  for (const setting of ['hide-contributing-guidelines-notice', 'hide-pull-request-protip']) {
    assert.equal((html.match(new RegExp('id="' + setting + '"', 'g')) || []).length, 1);
    assert.ok(footer.includes('id="' + setting + '"'));
    assert.ok(!pullRequests.includes('id="' + setting + '"'));
  }
});
