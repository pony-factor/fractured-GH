const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../features/notifications/organization.js'), 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const response = (unread) => ({ ok: true, text: async () => unread ? 'unread' : 'empty' });

async function startFeature(fetch) {
  let settings = { organizationNotificationInboxesEnabled: true, notificationOrganizations: ['Acme'] };
  const controls = [];
  const events = {};
  const timers = new Map();
  const warnings = [];
  let timerId = 0;
  let now = 0;
  const navigator = { onLine: true };
  let requests = 0;
  class Anchor {
    constructor() { this.style = {}; this.attributes = new Map(); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key); }
    hasAttribute(key) { return this.attributes.has(key); }
    replaceChildren() {}
    remove() { controls.splice(controls.indexOf(this), 1); }
  }
  const documentFixture = {
    hidden: false,
    documentElement: {},
    querySelectorAll: () => [...controls],
    querySelector: () => defaultControl,
    createElement: (tag) => tag === 'a' ? new Anchor() : { style: {} },
    addEventListener: (name, callback) => { events[name] = callback; },
  };
  const defaultControl = new Anchor();
  defaultControl.parentNode = { insertBefore: (control) => controls.push(control) };
  vm.runInNewContext(source, {
    chrome: { storage: {
      local: { get: async () => settings },
      onChanged: { addListener: (callback) => { events.storage = callback; } },
    } },
    window: {
      location: { origin: 'https://github.com' },
      fetch: (...args) => { requests++; return fetch(...args); },
      addEventListener: (name, callback) => { events[name] = callback; },
      setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
      clearTimeout: (id) => timers.delete(id),
      setInterval: (callback) => { events.poll = callback; },
    },
    document: documentFixture,
    URL, AbortController, HTMLAnchorElement: Anchor, navigator,
    Date: { now: () => now },
    MutationObserver: class { observe() {} },
    DOMParser: class {
      parseFromString(markup) { return { querySelector: () => markup === 'unread' ? {} : null }; }
    },
    console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
  });
  await settle();
  return {
    controls, events, timers, warnings,
    get requests() { return requests; },
    navigator,
    get document() { return documentFixture; },
    advance(ms) { now += ms; },
    async poll() { events.poll(); await settle(); },
    async change(values) {
      settings = { ...settings, ...values };
      events.storage({ notificationOrganizations: {} }, 'local');
      await settle();
    },
  };
}

test('failed polls preserve unread badges, stay quiet, and recover on the next poll', async () => {
  let mode = 'unread';
  const feature = await startFeature(async () => {
    if (mode === 'network') throw new TypeError('Failed to fetch');
    if (mode === 'http') return { ok: false, status: 503 };
    if (mode === 'body') return { ok: true, text: async () => { throw new TypeError('Failed to fetch'); } };
    return response(mode === 'unread');
  });
  assert.equal(feature.controls.length, 1);
  for (mode of ['network', 'http', 'body']) {
    feature.advance(300_000);
    await feature.poll();
    assert.equal(feature.controls.length, 1);
    assert.equal(feature.timers.size, 0);
  }
  assert.deepEqual(feature.warnings, []);
  mode = 'empty';
  feature.advance(300_000);
  await feature.poll();
  assert.equal(feature.controls.length, 0);
});

test('an initial network failure does not invent unread notifications', async () => {
  const feature = await startFeature(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(feature.controls.length, 0);
  assert.deepEqual(feature.warnings, []);
});

test('focus and navigation share the pending poll; timeouts allow retry', async () => {
  let hang = true;
  let signal;
  const feature = await startFeature(async (_url, options) => {
    signal = options.signal;
    if (!hang) return response(true);
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
    });
  });
  feature.events.focus();
  feature.events['turbo:load']();
  feature.events['pjax:end']();
  await feature.poll();
  assert.equal(feature.requests, 1);
  [...feature.timers.values()].find(({ delay }) => delay === 15_000).callback();
  await settle();
  assert.equal(signal.aborted, true);
  assert.deepEqual(feature.warnings, []);
  hang = false;
  feature.advance(60_000);
  await feature.poll();
  assert.equal(feature.requests, 2);
  assert.equal(feature.controls.length, 1);
});

test('settings changes supersede pending polls and disabled badges stay removed', async () => {
  const pending = [];
  const feature = await startFeature(() => new Promise((resolve) => pending.push(resolve)));
  await feature.change({ notificationOrganizations: ['Other'] });
  assert.equal(feature.requests, 2);
  pending[1](response(true));
  await settle();
  assert.equal(feature.controls[0].getAttribute('data-fractured-github-organization-notification'), 'Other');
  pending[0](response(true));
  await settle();
  assert.equal(feature.controls.length, 1);
  assert.equal(feature.controls[0].getAttribute('data-fractured-github-organization-notification'), 'Other');
  feature.events.poll();
  await feature.change({ organizationNotificationInboxesEnabled: false });
  assert.equal(feature.controls.length, 0);
  pending[2](response(true));
  await settle();
  assert.equal(feature.controls.length, 0);
});

test('failures back off without losing state and online resumes immediately', async () => {
  let failing = true;
  const feature = await startFeature(async () => {
    if (failing) throw new TypeError('Failed to fetch');
    return response(true);
  });
  assert.equal(feature.requests, 1);
  await feature.poll();
  assert.equal(feature.requests, 1);
  feature.advance(60_000);
  await feature.poll();
  assert.equal(feature.requests, 2);
  feature.advance(60_000);
  await feature.poll();
  assert.equal(feature.requests, 2);
  failing = false;
  feature.events.online();
  await settle();
  assert.equal(feature.requests, 3);
  assert.equal(feature.controls.length, 1);
  assert.deepEqual(feature.warnings, []);
});

test('offline and hidden tabs do not poll until connection or visibility resumes', async () => {
  const feature = await startFeature(async () => response(true));
  assert.equal(feature.requests, 1);
  feature.navigator.onLine = false;
  await feature.poll();
  assert.equal(feature.requests, 1);
  feature.navigator.onLine = true;
  feature.document.hidden = true;
  await feature.poll();
  assert.equal(feature.requests, 1);
  feature.document.hidden = false;
  feature.events.visibilitychange();
  await settle();
  assert.equal(feature.requests, 2);
});
