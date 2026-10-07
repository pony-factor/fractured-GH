const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../features/relative-times.js'), 'utf8');

function fixture(blockTooltips) {
  const updates = [];
  class TimeElement {
    attributes = new Map([['datetime', '2020-01-01T00:00:00Z']]);
    textContent = 'Jan 1, 2020';
    shadowRoot = { textContent: this.textContent };
    matches() { return true; }
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
    document: { getElementById: () => blockTooltips ? {} : null },
  });
  const prefix = source.slice(0, source.indexOf('  function processTree('));
  vm.runInContext(`${prefix}\n globalThis.applyRelativeTime = applyRelativeTime;\n})();`, context);
  return { element: new TimeElement(), updates };
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
