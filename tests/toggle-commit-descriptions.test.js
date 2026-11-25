const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const script = readFileSync('features/pull-requests/toggle-commit-descriptions.js', 'utf8');

function fixture(pathname, initial) {
  let holder = null;
  const queue = [];
  const anchor = {
    parentElement: {},
    before(node) { holder = node; node.nextElementSibling = this; },
  };
  const rows = initial.map(({ open = false, hidden = false, text = 'Details', legacy = false }) => {
    const row = { open, hidden, text, clicks: 0 };
    const description = {
      textContent: text,
      closest: () => hidden ? {} : null,
      getClientRects: () => row.open ? [{}] : [],
    };
    const button = {
      disabled: false,
      closest: () => hidden ? {} : null,
      getClientRects: () => hidden ? [] : [{}],
      getAttribute: () => legacy ? null : String(row.open),
      click() { row.clicks++; row.open = !row.open; },
    };
    row.message = {
      querySelector: selector => selector === '.commit-desc' ? description : button,
      closest: () => anchor,
    };
    return row;
  });
  const location = { pathname };
  const document = {
    querySelectorAll: () => rows.map(row => row.message),
    getElementById: () => holder,
    createElement: tag => tag === 'div' ? {
      append(child) { this.firstElementChild = child; },
      remove() { holder = null; },
    } : {
      addEventListener(type, callback) { this.click = callback; },
    },
    addEventListener() {},
  };
  let mutation;
  vm.runInNewContext(script, {
    location, document, window: { addEventListener() {} },
    MutationObserver: class {
      constructor(callback) { mutation = callback; }
      observe() {}
    },
    queueMicrotask: callback => queue.push(callback),
    getComputedStyle: () => ({ visibility: 'visible' }),
  });
  const flush = () => { while (queue.length) queue.shift()(); };
  flush();
  return {
    rows, location,
    get button() { return holder?.firstElementChild; },
    refresh() { mutation(); flush(); },
    click() { holder.firstElementChild.click(); flush(); },
  };
}

test('bulk toggle expands only closed descriptions and then collapses all', () => {
  const page = fixture('/owner/repo/pull/42/commits', [
    { open: true }, { legacy: true }, { hidden: true }, { text: '' },
  ]);
  assert.equal(page.button.textContent, 'Expand all commit descriptions');
  page.click();
  assert.deepEqual(page.rows.map(row => row.clicks), [0, 1, 0, 0]);
  assert.equal(page.button.textContent, 'Collapse all commit descriptions');
  page.click();
  assert.deepEqual(page.rows.map(row => row.clicks), [1, 2, 0, 0]);
  assert.equal(page.button.textContent, 'Expand all commit descriptions');
});

test('individual changes update the label and navigation removes the control', () => {
  const page = fixture('/owner/repo/pull/42/commits/', [{}]);
  page.rows[0].open = true;
  page.refresh();
  assert.equal(page.button.textContent, 'Collapse all commit descriptions');
  page.location.pathname = '/owner/repo/pull/42/commits/abc';
  page.refresh();
  assert.equal(page.button, undefined);
  page.location.pathname = '/owner/repo/pull/42/commits';
  page.refresh();
  assert.equal(page.button.textContent, 'Collapse all commit descriptions');
});

test('no control appears outside the commit list or without eligible descriptions', () => {
  assert.equal(fixture('/owner/repo/pull/42', [{}]).button, undefined);
  assert.equal(fixture('/owner/repo/pull/42/commits', [{ hidden: true }]).button, undefined);
});
