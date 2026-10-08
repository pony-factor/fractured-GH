const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/hide-repository-languages.js'), 'utf8',
);

const ATTRIBUTE = 'data-fractured-hidden-languages';

function setup() {
  const sections = [];
  const frames = [];
  const location = { pathname: '/pony-factor/fractured-GH' };
  const settings = { hideRepositoryLanguages: true };
  let onMutation;
  let onStorageChange;

  function addSection(label) {
    const attributes = new Set();
    const section = {
      setAttribute(name) { attributes.add(name); },
      removeAttribute(name) { attributes.delete(name); },
      hasAttribute(name) { return attributes.has(name); },
      querySelectorAll(selector) {
        assert.equal(selector, 'h2, h3');
        return [heading];
      },
    };
    const heading = {
      textContent: label,
      closest() { return section; },
    };
    sections.push({ section, heading });
    return { section, heading };
  }

  const document = {
    documentElement: {},
    head: { append() {} },
    createElement() { return { textContent: '' }; },
    querySelector(selector) {
      assert.equal(selector, 'meta[name="octolytics-dimension-repository_nwo"]');
      return { getAttribute() { return 'pony-factor/fractured-GH'; } };
    },
    querySelectorAll(selector) {
      if (selector === `[${ATTRIBUTE}]`) {
        return sections.map(entry => entry.section)
          .filter(section => section.hasAttribute(ATTRIBUTE));
      }
      if (selector.includes('[class*="SidebarSection"] h2')) {
        return sections.map(entry => entry.heading);
      }
      throw Error('Unexpected selector: ' + selector);
    },
    addEventListener() {},
  };

  const chrome = {
    storage: {
      local: { async get() { return { ...settings }; } },
      onChanged: { addListener(listener) { onStorageChange = listener; } },
    },
  };

  vm.runInNewContext(source, {
    chrome, document, location,
    window: { addEventListener() {} },
    requestAnimationFrame: callback => frames.push(callback),
    MutationObserver: class {
      constructor(callback) { onMutation = callback; }
      observe() {}
    },
  });

  function flushFrames() {
    while (frames.length) frames.shift()();
  }

  async function settleSettings() {
    await Promise.resolve();
    await Promise.resolve();
    flushFrames();
  }

  return {
    addSection, location, settings, settleSettings, flushFrames,
    mutate() { onMutation(); },
    updateSettings() { onStorageChange({ hideRepositoryLanguages: {} }, 'local'); },
  };
}

test('hides dynamically inserted Languages sections before the next animation frame', async () => {
  const app = setup();
  await app.settleSettings();
  const languages = app.addSection('Languages');
  const about = app.addSection('About');
  app.mutate();
  assert.equal(languages.section.hasAttribute(ATTRIBUTE), true);
  assert.equal(about.section.hasAttribute(ATTRIBUTE), false);
});

test('keeps Languages hidden while navigating from repository home into a file', async () => {
  const app = setup();
  const languages = app.addSection('Languages');
  await app.settleSettings();
  assert.equal(languages.section.hasAttribute(ATTRIBUTE), true);

  // GitHub updates the URL before unmounting the old repository sidebar.
  app.location.pathname = '/pony-factor/fractured-GH/blob/main/README.md';
  app.mutate();
  assert.equal(languages.section.hasAttribute(ATTRIBUTE), true);

  // Fresh sidebar markup must also be hidden without waiting for a frame.
  const replacement = app.addSection('Languages');
  app.mutate();
  assert.equal(replacement.section.hasAttribute(ATTRIBUTE), true);

  // React can recycle the old sidebar for unrelated file information.
  languages.heading.textContent = 'File information';
  app.mutate();
  assert.equal(languages.section.hasAttribute(ATTRIBUTE), false);
  assert.equal(replacement.section.hasAttribute(ATTRIBUTE), true);
});

test('restores Languages when disabled and does not hide unrelated pages', async () => {
  const app = setup();
  const languages = app.addSection('Languages');
  await app.settleSettings();
  assert.equal(languages.section.hasAttribute(ATTRIBUTE), true);

  app.settings.hideRepositoryLanguages = false;
  app.updateSettings();
  await app.settleSettings();
  assert.equal(languages.section.hasAttribute(ATTRIBUTE), false);

  app.settings.hideRepositoryLanguages = true;
  app.location.pathname = '/settings/profile';
  app.updateSettings();
  await app.settleSettings();
  app.mutate();
  assert.equal(languages.section.hasAttribute(ATTRIBUTE), false);
});
