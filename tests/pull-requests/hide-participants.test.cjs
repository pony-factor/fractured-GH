const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../features/pull-requests/hide-participants.js'), 'utf8',
);

const ROOT = 'data-fractured-hide-pull-request-participants';
const MARKER = 'data-fractured-pull-request-participants-section';
const STYLE_ID = 'fractured-hide-pull-request-participants-style';

function setup(initialEnabled = false) {
  const settings = { hidePullRequestParticipants: initialEnabled };
  const location = { pathname: '/owner/repo/pull/123' };
  const legacySections = [];
  const styles = new Map();
  const attrs = new Set();
  const root = {
    setAttribute(name) { attrs.add(name); },
    removeAttribute(name) { attrs.delete(name); },
    hasAttribute(name) { return attrs.has(name); },
  };
  const head = { append(style) { styles.set(style.id, style); } };
  let onMutation;
  let onStorageChange;

  function addLegacy(headingText) {
    const attributes = new Set();
    const heading = { textContent: headingText };
    const section = {
      heading,
      hasAttribute(name) { return attributes.has(name); },
      setAttribute(name) { attributes.add(name); },
      removeAttribute(name) { attributes.delete(name); },
      querySelector() { return heading; },
    };
    legacySections.push(section);
    return section;
  }

  const document = {
    documentElement: root,
    head,
    createElement() { return { id: '', textContent: '' }; },
    getElementById(id) {
      const style = styles.get(id);
      return style && { ...style, remove() { styles.delete(id); } };
    },
    querySelectorAll(selector) {
      if (selector === `[${MARKER}]`) {
        return legacySections.filter(section => section.hasAttribute(MARKER));
      }
      if (selector.includes('#partial-discussion-sidebar .discussion-sidebar-item')) {
        return legacySections;
      }
      throw Error('Unexpected selector ' + selector);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const chrome = {
    storage: {
      local: { async get() { return { ...settings }; } },
      onChanged: { addListener(listener) { onStorageChange = listener; } },
    },
  };
  vm.runInNewContext(source, {
    document, chrome, location,
    window: { addEventListener() {}, removeEventListener() {} },
    queueMicrotask,
    MutationObserver: class {
      constructor(callback) { onMutation = callback; }
      observe() {}
      disconnect() {}
    },
  });

  return {
    addLegacy, root, styles, settings, location,
    async settle() { await Promise.resolve(); await Promise.resolve(); },
    async mutate() { onMutation?.(); await Promise.resolve(); },
    async toggle(value) {
      settings.hidePullRequestParticipants = value;
      onStorageChange({ hidePullRequestParticipants: { newValue: value } }, 'local');
      await Promise.resolve();
    },
  };
}

test('setting defaults off and toggles a scoped Participants CSS rule', async () => {
  const app = setup();
  await app.settle();
  assert.equal(app.root.hasAttribute(ROOT), false);
  assert.equal(app.styles.size, 0);

  await app.toggle(true);
  assert.equal(app.root.hasAttribute(ROOT), true);
  assert.match(app.styles.get(STYLE_ID).textContent, /sidebar-participants-section/);

  await app.toggle(false);
  assert.equal(app.root.hasAttribute(ROOT), false);
  assert.equal(app.styles.size, 0);
});

test('hides only legacy participant rows, including singular and plural counts', async () => {
  const app = setup(true);
  const singular = app.addLegacy('1 participant');
  const milestone = app.addLegacy('Milestone');
  await app.settle();
  assert.equal(singular.hasAttribute(MARKER), true);
  assert.equal(milestone.hasAttribute(MARKER), false);

  const plural = app.addLegacy('3 participants');
  await app.mutate();
  assert.equal(plural.hasAttribute(MARKER), true);

  singular.heading.textContent = 'Assignees';
  await app.mutate();
  assert.equal(singular.hasAttribute(MARKER), false);
  assert.equal(milestone.hasAttribute(MARKER), false);
});

test('restores all sections on issue navigation or when switched off', async () => {
  const app = setup(true);
  const people = app.addLegacy('Participants');
  await app.settle();
  assert.equal(people.hasAttribute(MARKER), true);

  app.location.pathname = '/owner/repo/issues/123';
  await app.mutate();
  assert.equal(app.root.hasAttribute(ROOT), false);
  assert.equal(people.hasAttribute(MARKER), false);

  app.location.pathname = '/owner/repo/pull/123';
  await app.mutate();
  assert.equal(people.hasAttribute(MARKER), true);
  await app.toggle(false);
  assert.equal(people.hasAttribute(MARKER), false);
});
