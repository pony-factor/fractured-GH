const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/promote-display-names.js'), 'utf8',
);

function startFeature(initial = {}, dom = {}, runtime = {}) {
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
    URL,
    fetch: async () => ({ ok: true, text: async () => '' }),
    DOMParser: class {
      parseFromString() {
        return { querySelector: () => ({ textContent: 'John Wooten' }) };
      }
    },
    FracturedProfileNameCache: { getDisplayName: async () => 'John Wooten' },
    ...runtime,
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

test('repository contributor links promote nested names and restore their original order', async () => {
  function label(text) {
    const classes = new Set();
    return {
      textContent: text, children: [], isConnected: true,
      contains: () => false,
      classList: {
        add: (value) => classes.add(value),
        contains: (value) => classes.has(value),
        remove: (...values) => values.forEach((value) => classes.delete(value)),
      },
    };
  }
  const handle = label('JFWooten4');
  const name = label('Windsor Flight');
  class Anchor {
    constructor() {
      this.childNodes = [handle, name];
      this.isConnected = true;
      this.classList = label('').classList;
      handle.parentElement = name.parentElement = this;
    }
    get children() { return this.childNodes; }
    get firstElementChild() { return this.children[0]; }
    get textContent() { return this.children.map((node) => node.textContent).join(''); }
    getAttribute() { return '/JFWooten4'; }
    querySelectorAll() { return this.children; }
    querySelector() { return this.children.find((node) => node.classList.contains('fractured-display-name-primary')); }
    insertBefore(node, before) {
      this.childNodes = this.childNodes.filter((child) => child !== node);
      this.childNodes.splice(this.childNodes.indexOf(before), 0, node);
    }
    replaceChildren(...nodes) { this.childNodes = nodes; }
    closest() { return surface; }
  }
  const link = new Anchor();
  const surface = {
    className: 'SidebarContributors',
    matches: () => false,
    querySelectorAll: () => [link],
  };
  const feature = startFeature({
    preferDisplayNamesEnabled: true,
    userNicknames: [{ username: 'JFWooten4', nickname: 'Windsor Flight' }],
  }, {
    querySelectorAll: (selector) => selector === '.fractured-display-name-row' ? [link]
      : selector.includes('.fractured-display-name-primary') ? [handle, name]
        : selector.startsWith('[') ? [] : [surface],
  }, { HTMLAnchorElement: Anchor });
  await feature.ready();
  assert.deepEqual(link.children, [name, handle]);
  assert.equal(name.classList.contains('fractured-display-name-primary'), true);
  assert.equal(handle.classList.contains('fractured-username-secondary'), true);
  await feature.change(false);
  assert.deepEqual(link.children, [handle, name]);
  assert.equal(link.classList.contains('fractured-display-name-row'), false);
  await feature.change(true);
  assert.deepEqual(link.children, [name, handle]);
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

test('the current anchored account menu shows the nickname above the username and restores both', async () => {
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
    matches: (selector) => selector.includes('[role="dialog"][aria-labelledby="global-nav-user-menu-header"]'),
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
      : selector.includes('[role="dialog"][aria-labelledby="global-nav-user-menu-header"]') ? [surface] : [],
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
