const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/promote-display-names.js'), 'utf8',
);

function startFeature(initial = {}, dom = {}) {
  const settings = { ...initial };
  const attributes = new Map();
  const callbacks = [];
  let observations = 0;
  let disconnections = 0;

  const document = {
    documentElement: {
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: (key) => attributes.delete(key),
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
    ...dom,
  };

  const chrome = {
    storage: {
      local: {
        get: async (defaults) => ({ ...defaults, ...settings }),
      },
      onChanged: {
        addListener: (callback) => callbacks.push(callback),
      },
    },
  };

  class MutationObserver {
    observe() { observations += 1; }
    disconnect() { disconnections += 1; }
  }

  vm.runInNewContext(source, {
    chrome,
    document,
    MutationObserver,
    location: { pathname: '/owner/repository', origin: 'https://github.com' },
    requestAnimationFrame: (callback) => callback(),
    HTMLAnchorElement: class {},
    fetch: async () => ({ ok: true, text: async () => '' }),
    DOMParser: class {
      parseFromString() {
        return { querySelector: () => ({ textContent: 'John Wooten' }) };
      }
    },
  });

  return {
    attributes,
    get observations() { return observations; },
    get disconnections() { return disconnections; },
    async change(value) {
      settings.preferDisplayNamesEnabled = value;
      callbacks[0]({ preferDisplayNamesEnabled: { newValue: value } }, 'local');
      await new Promise((resolve) => setImmediate(resolve));
    },
    async ready() {
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('defaults to GitHub styling and does not observe the DOM', async () => {
  const feature = startFeature();
  await feature.ready();
  assert.equal(feature.attributes.has('data-fractured-prefer-display-names'), false);
  assert.equal(feature.observations, 0);
});

test('enabling then disabling the preference updates the DOM and observer', async () => {
  const feature = startFeature({ preferDisplayNamesEnabled: true });
  await feature.ready();
  assert.equal(feature.attributes.get('data-fractured-prefer-display-names'), 'true');
  assert.equal(feature.observations, 1);
  await feature.change(false);
  assert.equal(feature.attributes.has('data-fractured-prefer-display-names'), false);
  assert.equal(feature.disconnections, 1);
  await feature.change(true);
  assert.equal(feature.attributes.get('data-fractured-prefer-display-names'), 'true');
  assert.equal(feature.observations, 2);
});

test('the two-line account header shows the nickname above the username and restores both', async () => {
  function label(text) {
    const classes = new Set();
    return {
      childNodes: [{ textContent: text }],
      children: [],
      isConnected: true,
      get textContent() { return this.childNodes.map((node) => node.textContent).join(''); },
      set textContent(value) { this.childNodes = [{ textContent: value }]; },
      replaceChildren(...nodes) { this.childNodes = nodes; },
      contains: (node) => false,
      classList: {
        add: (value) => classes.add(value),
        contains: (value) => classes.has(value),
        remove: (...values) => values.forEach((value) => classes.delete(value)),
      },
    };
  }
  const handle = label('JFWooten4');
  const name = label('John Wooten');
  const originalNameNode = name.childNodes[0];
  const surface = {
    isConnected: true,
    matches: () => true,
    querySelectorAll: (selector) => selector === 'a[href]' || selector === 'li, p, div, span'
      ? [] : [handle, name],
  };
  handle.parentElement = name.parentElement = surface;
  const feature = startFeature({
    preferDisplayNamesEnabled: true,
    userNicknames: [{ username: 'JFWooten4', nickname: 'Windsor Filth' }],
  }, {
    querySelector: () => ({ content: 'JFWooten4' }),
    querySelectorAll: (selector) => selector.includes('.fractured-display-name-primary') ? [handle, name]
      : selector.startsWith('[') ? [] : [surface],
  });
  await feature.ready();
  assert.equal(handle.textContent, 'Windsor Filth');
  assert.equal(name.textContent, 'JFWooten4');
  assert.equal(handle.classList.contains('fractured-display-name-primary'), true);
  assert.equal(name.classList.contains('fractured-username-secondary'), true);
  await feature.change(false);
  assert.equal(handle.textContent, 'JFWooten4');
  assert.equal(name.textContent, 'John Wooten');
  assert.equal(name.childNodes[0], originalNameNode);
  await feature.change(true);
  assert.equal(handle.textContent, 'Windsor Filth');
  assert.equal(name.textContent, 'JFWooten4');
});
