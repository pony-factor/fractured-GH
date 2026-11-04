const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../features/notifications/main-inbox.js'), 'utf8');
const { normalizeOrganizations, isMainInbox, ownerFromHref, notificationOwner } = require('../../features/notifications/main-inbox.js');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function row(links, repositoryText = null) {
  const attributes = new Map();
  return {
    attributes,
    querySelector() { return repositoryText === null ? null : { textContent: repositoryText }; },
    querySelectorAll() { return links.map((href) => ({ getAttribute: () => href })); },
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
  };
}

function inbox(query = '') {
  return { hostname: 'github.com', pathname: '/notifications', search: query };
}

test('extracts the repository owner without confusing notification or external links', () => {
  assert.equal(ownerFromHref('/Acme/widget/pull/12'), 'acme');
  assert.equal(ownerFromHref('https://github.com/Other/repo/issues/2'), 'other');
  assert.equal(ownerFromHref('/notifications/123'), null);
  assert.equal(ownerFromHref('/settings/profile'), null);
  assert.equal(ownerFromHref('https://example.com/Acme/repo'), null);
  assert.equal(notificationOwner(row(['/notifications/123', '/Acme/widget/issues/3'])), 'acme');
  assert.equal(notificationOwner(row(['/Other/repo/pull/1'], 'Acme/widget')), 'acme');
  assert.equal(notificationOwner(row(['/notifications/123'])), null);
});

test('filters only default, read and unread inbox pages, never organization or custom searches', () => {
  assert.equal(isMainInbox(inbox()), true);
  assert.equal(isMainInbox(inbox('?query=is%3Aunread')), true);
  assert.equal(isMainInbox(inbox('?query=is%3Aread')), true);
  assert.equal(isMainInbox(inbox('?query=org%3AAcme')), false);
  assert.equal(isMainInbox(inbox('?query=reason%3Amention')), false);
  assert.equal(isMainInbox({ hostname: 'github.com', pathname: '/Acme/repo', search: '' }), false);
  assert.deepEqual([...normalizeOrganizations(['Acme', '@ACME', 'https://github.com/Other/', ''])], ['acme', 'other']);
});

async function featureHarness() {
  const rows = [row(['/Acme/tool/issues/1']), row(['/other/widget/pull/2']), row(['/AcMe/other/pull/1'])];
  let settings = {
    organizationNotificationInboxesEnabled: true,
    excludeOrganizationNotificationsFromMainInbox: false,
    notificationOrganizations: ['Acme'],
  };
  const location = inbox();
  const handlers = {};
  const styles = [];
  const timers = new Map();
  let nextTimer = 0;
  let mutation;
  const doc = {
    documentElement: { append: (style) => styles.push(style) },
    querySelectorAll: () => rows,
    getElementById: (id) => styles.find((s) => s.id === id),
    createElement: () => ({}),
    addEventListener: (event, callback) => { handlers[event] = callback; },
  };
  const window = {
    location,
    clearTimeout: (id) => timers.delete(id),
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
  };
  vm.runInNewContext(script, {
    chrome: { storage: {
      local: { get: async () => settings },
      onChanged: { addListener: (fn) => { handlers.storage = fn; } },
    } },
    document: doc, window, URL, URLSearchParams,
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
  });
  await flush();
  function refresh() {
    for (const fn of [...timers.values()]) fn();
    timers.clear();
  }
  async function changeSettings(values) {
    settings = { ...settings, ...values };
    handlers.storage({ excludeOrganizationNotificationsFromMainInbox: {} }, 'local');
    await flush();
  }
  return { rows, styles, location, handlers, refresh, changeSettings, get mutation() { return mutation; } };
}

test('toggle filters configured owners, restores them, and honors navigation and dynamic rows', async () => {
  const feature = await featureHarness();
  const hidden = 'data-fractured-main-inbox-hidden';
  assert.equal(feature.rows.every((r) => !r.attributes.has(hidden)), true);

  await feature.changeSettings({ excludeOrganizationNotificationsFromMainInbox: true });
  assert.deepEqual(feature.rows.map((r) => r.attributes.has(hidden)), [true, false, true]);
  assert.equal(feature.styles.length, 1);

  feature.location.search = '?query=org%3AAcme';
  feature.handlers['turbo:load']();
  feature.refresh();
  assert.equal(feature.rows.every((r) => !r.attributes.has(hidden)), true);

  feature.location.search = '?query=is%3Aunread';
  feature.mutation();
  feature.refresh();
  assert.deepEqual(feature.rows.map((r) => r.attributes.has(hidden)), [true, false, true]);

  await feature.changeSettings({ notificationOrganizations: ['Other'] });
  assert.deepEqual(feature.rows.map((r) => r.attributes.has(hidden)), [false, true, false]);
  await feature.changeSettings({ excludeOrganizationNotificationsFromMainInbox: false });
  assert.equal(feature.rows.every((r) => !r.attributes.has(hidden)), true);
  await feature.changeSettings({ excludeOrganizationNotificationsFromMainInbox: true, organizationNotificationInboxesEnabled: false });
  assert.equal(feature.rows.every((r) => !r.attributes.has(hidden)), true);
});
