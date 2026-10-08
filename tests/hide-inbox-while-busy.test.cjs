const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../features/hide-inbox-while-busy.js'), 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function startFeature(fetch) {
  let now = 0;
  let requests = 0;
  const attributes = new Map();
  const cache = new Map([['github-viewer-busy', 'true']]);
  const events = {};
  const timers = new Map();
  const warnings = [];
  let timerId = 0;
  let poll;
  const navigator = { onLine: true };
  const document = {
    hidden: false,
    documentElement: {
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: (key) => attributes.delete(key),
      append() {},
    },
    getElementById: () => true,
    addEventListener: (name, callback) => { events[name] = callback; },
  };
  const window = {
    location: { origin: 'https://github.com' },
    localStorage: {
      getItem: (key) => cache.get(key),
      setItem: (key, value) => cache.set(key, value),
    },
    fetch: (...args) => { requests++; return fetch(...args); },
    addEventListener: (name, callback) => { events[name] = callback; },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback) => { poll = callback; },
  };
  vm.runInNewContext(source, {
    chrome: { storage: { local: { get: async () => ({ hideInboxWhileBusy: true }) } } },
    window, document, navigator, URL, AbortController,
    Date: { now: () => now },
    console: { warn: (...args) => warnings.push(args) },
    MutationObserver: class { observe() {} },
    DOMParser: class {
      parseFromString(markup) {
        return { querySelector: () => ({ checked: markup === 'busy', hasAttribute: () => false, getAttribute: () => null }) };
      }
    },
  });
  await settle();
  return {
    attributes, cache, events, timers, warnings, navigator, document,
    get requests() { return requests; },
    advance(ms) { now += ms; },
    async poll() { void poll(); await settle(); },
  };
}

test('network failures preserve Busy state, stay quiet, back off, and recover', async () => {
  let failing = true;
  const feature = await startFeature(async () => {
    if (failing) throw new TypeError('Failed to fetch');
    return { ok: true, text: async () => 'available' };
  });
  assert.equal(feature.attributes.get('data-github-viewer-busy'), 'true');
  feature.events.focus();
  await settle();
  assert.equal(feature.requests, 1);
  feature.advance(60_000);
  await feature.poll();
  feature.advance(60_000);
  await feature.poll();
  assert.equal(feature.requests, 2);
  assert.deepEqual(feature.warnings, []);
  failing = false;
  feature.events.online();
  await settle();
  assert.equal(feature.requests, 3);
  assert.equal(feature.attributes.has('data-github-viewer-busy'), false);
  assert.equal(feature.cache.get('github-viewer-busy'), 'false');
  assert.equal(feature.timers.size, 0);
});

test('coalesces requests and aborts a stalled fetch without warning', async () => {
  const feature = await startFeature((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  feature.events.focus();
  feature.events['turbo:load']();
  await settle();
  assert.equal(feature.requests, 1);
  const timeout = [...feature.timers.values()].find(({ delay }) => delay === 15_000);
  timeout.callback();
  await settle();
  assert.deepEqual(feature.warnings, []);
  assert.equal(feature.timers.size, 0);
  feature.advance(60_000);
  await feature.poll();
  assert.equal(feature.requests, 2);
});

test('skips offline and hidden tabs and refreshes when visible again', async () => {
  const feature = await startFeature(async () => ({ ok: true, text: async () => 'busy' }));
  feature.navigator.onLine = false;
  await feature.poll();
  feature.navigator.onLine = true;
  feature.document.hidden = true;
  await feature.poll();
  assert.equal(feature.requests, 1);
  feature.document.hidden = false;
  feature.events.visibilitychange();
  await settle();
  assert.equal(feature.requests, 2);
});
