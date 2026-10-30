const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../features/interface/relative-times.js'), 'utf8');

function fixture(blockTooltips, ageCellWidth = null) {
  const updates = [];
  const ageCell = ageCellWidth === null ? null : {
    clientWidth: ageCellWidth,
    getBoundingClientRect: () => ({ width: ageCellWidth }),
  };
  class TimeElement {
    attributes = new Map([['datetime', '2020-01-01T00:00:00Z']]);
    textContent = 'Jan 1, 2020';
    shadowRoot = { textContent: this.textContent };
    matches() { return true; }
    closest() { return ageCell; }
    hasAttribute(name) { return this.attributes.has(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) {
      const old = this.getAttribute(name);
      this.attributes.set(name, value);
      if (name === 'no-title' && old !== value) updates.push(() => this.update());
    }
    removeAttribute(name) {
      if (!this.attributes.delete(name)) return;
      // GitHub schedules a new render when a generated title is removed.
      if (name === 'title') updates.push(() => this.update());
    }
    update() {
      if (!this.hasAttribute('no-title') && !this.hasAttribute('title')) {
        this.setAttribute('title', 'Jan 1, 2020, 12:00 AM UTC');
      }
      this.shadowRoot.textContent = 'on Jan 1, 2020';
      context.applyRelativeTime(this);
    }
  }
  const context = vm.createContext({
    Element: TimeElement,
    document: {
      getElementById: () => blockTooltips ? {} : null,
      createElement: () => ({
        getContext: () => ({ font: '', measureText: (text) => ({ width: text.length * 8 }) }),
      }),
    },
    getComputedStyle: () => ({
      font: '14px sans-serif', paddingLeft: '0px', paddingRight: '0px',
    }),
    Date: class FixedDate extends Date {
      constructor(...args) { super(...(args.length ? args : ['2026-10-23T16:00:00Z'])); }
    },
  });
  const prefix = source.slice(0, source.indexOf('  function processTree('));
  vm.runInContext(`${prefix}\n globalThis.applyRelativeTime = applyRelativeTime; globalThis.compactRelativeVariants = compactRelativeVariants;\n})();`, context);
  return { element: new TimeElement(), updates, compactRelativeVariants: context.compactRelativeVariants };
}

test('relative times and blocked tooltips settle after native timestamp updates', () => {
  const { element, updates } = fixture(true);
  element.update();
  let renders = 0;
  while (updates.length && renders < 20) {
    updates.shift()();
    renders++;
  }
  assert.equal(updates.length, 0, 'timestamp updates must not keep regenerating titles');
  assert.ok(renders < 3);
  assert.equal(element.hasAttribute('title'), false);
  assert.equal(element.hasAttribute('no-title'), true);
  assert.equal(element.getAttribute('data-github-tweaks-added-no-title'), 'true');
  assert.match(element.shadowRoot.textContent, /years?.*ago$/);
});

test('relative times retain titles when tooltips are enabled', () => {
  const { element, updates } = fixture(false);
  element.update();
  assert.equal(element.hasAttribute('no-title'), false);
  assert.equal(element.getAttribute('title'), element.textContent);
  assert.equal(updates.length, 0);
});

test('short labels distinguish years, months, weeks, days and minutes', () => {
  const { compactRelativeVariants } = fixture(false);
  assert.deepEqual(Array.from(compactRelativeVariants('2 years, 11 months ago')),
    ['2y 11mo ago', '2y 11mo', '2y']);
  assert.deepEqual(Array.from(compactRelativeVariants('in 3 days')),
    ['in 3d', '3d']);
  assert.deepEqual(Array.from(compactRelativeVariants('5 weeks ago')),
    ['5w ago', '5w']);
  assert.deepEqual(Array.from(compactRelativeVariants('1 minute ago')),
    ['1m ago', '1m']);
});

test('repository file ages use full text until the column becomes cramped', () => {
  const wide = fixture(false, 240);
  wide.element.update();
  assert.match(wide.element.textContent, /years?, .*months? ago$/);
  assert.equal(wide.element.getAttribute('title'), wide.element.textContent);

  const narrow = fixture(false, 96);
  narrow.element.update();
  assert.match(narrow.element.textContent, /^\d+y(?: \d+mo)?(?: ago)?$/);
  assert.match(narrow.element.getAttribute('title'), /years?.*ago$/);
  assert.notEqual(narrow.element.textContent, narrow.element.getAttribute('title'));

  const tiny = fixture(false, 26);
  tiny.element.update();
  assert.match(tiny.element.textContent, /^\d+y$/);
});
