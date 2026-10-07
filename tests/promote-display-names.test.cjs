const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/promote-display-names.js'), 'utf8',
);

function startFeature(initial = {}) {
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
