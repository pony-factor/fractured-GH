const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../features/notifications/main-inbox.js'), 'utf8');
const { normalizeOrganizations, isMainInbox, ownerFromHref, notificationOwner, hasVisibleUnread, nextInboxPage } = require('../../features/notifications/main-inbox.js');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function row(links, repositoryText = null) {
  const attributes = new Map();
  return {
    attributes,
    isConnected: true,
    querySelector() { return repositoryText === null ? null : { textContent: repositoryText }; },
    querySelectorAll() { return links.map((href) => ({ getAttribute: () => href })); },
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
    replaceWith(placeholder) {
      this.isConnected = false;
      placeholder.isConnected = true;
    },
  };
}

function inbox(query = '') {
  return { hostname: 'github.com', pathname: '/notifications', search: query };
}

test('extracts the repository owner without confusing notification or external links', () => {
  assert.equal(ownerFromHref('/Acme/widget/pull/12'), 'acme');
  assert.equal(ownerFromHref('https://github.com/Other/repo/issues/2'), 'other');
  assert.equal(ownerFromHref('/orgs/Acme/discussions/17'), 'acme');
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

async function featureHarness({ referencedLabel = false } = {}) {
  const rows = [row(['/Acme/tool/issues/1']), row(['/other/widget/pull/2']), row(['/AcMe/other/pull/1'])];
  let settings = {
    organizationNotificationInboxesEnabled: true,
    excludeOrganizationNotificationsFromMainInbox: false,
    notificationOrganizations: ['Acme'],
  };
  const location = inbox();
  const handlers = {};
  const styles = [];
  const rootAttributes = new Set();
  const button = row([]);
  const nativeLabel = 'You have unread notifications ( g then n )';
  const labelNode = { nodeType: 3, data: 'You have unread notifications' };
  const shortcutNode = { nodeType: 1, textContent: '(g then n)' };
  if (referencedLabel) button.setAttribute('aria-labelledby', 'inbox-label');
  else button.setAttribute('aria-label', nativeLabel);
  button.getAttribute = (name) => button.attributes.get(name);
  let unreadRows = rows.filter((_row, index) => index !== 1);
  const timers = new Map();
  let nextTimer = 0;
  let mutation;
  const doc = {
    documentElement: {
      append: (style) => styles.push(style),
      toggleAttribute: (name, present) => present ? rootAttributes.add(name) : rootAttributes.delete(name),
    },
    querySelector: () => button,
    querySelectorAll: () => rows.filter((row) => row.isConnected),
    getElementById: (id) => id === 'inbox-label'
      ? { childNodes: [labelNode, shortcutNode] }
      : styles.find((s) => s.id === id),
    createElement: () => ({}),
    createComment: () => ({
      replaceWith(row) {
        this.isConnected = false;
        row.isConnected = true;
      },
    }),
    addEventListener: (event, callback) => { handlers[event] = callback; },
  };
  const window = {
    location: Object.assign(location, { origin: 'https://github.com' }),
    clearTimeout: (id) => timers.delete(id),
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    setInterval: (fn) => { handlers.poll = fn; },
    addEventListener: (event, callback) => { handlers[event] = callback; },
    fetch: async () => ({ ok: true, text: async () => '' }),
  };
  let clock = 0;
  vm.runInNewContext(script, {
    chrome: { storage: {
      local: { get: async () => settings },
      onChanged: { addListener: (fn) => { handlers.storage = fn; } },
    } },
    document: doc, window, URL, URLSearchParams, AbortController,
    navigator: { onLine: true },
    Date: { now: () => clock },
    DOMParser: class {
      parseFromString() { return { querySelectorAll: () => unreadRows, querySelector: () => null }; }
    },
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
  return {
    rows, styles, location, handlers, refresh, changeSettings, rootAttributes, button, nativeLabel, labelNode, shortcutNode,
    get mutation() { return mutation; },
    async pollUnread(nextRows) {
      unreadRows = nextRows;
      clock += 60_000;
      await handlers.poll();
    },
  };
}

test('toggle filters configured owners, restores them, and honors navigation and dynamic rows', async () => {
  const feature = await featureHarness();
  assert.equal(feature.rows.every((row) => row.isConnected), true);

  await feature.changeSettings({ excludeOrganizationNotificationsFromMainInbox: true });
  assert.deepEqual(feature.rows.map((row) => row.isConnected), [false, true, false]);
  assert.equal(feature.styles.length, 1);

  feature.location.search = '?query=org%3AAcme';
  feature.handlers['turbo:load']();
  feature.refresh();
  assert.equal(feature.rows.every((row) => row.isConnected), true);

  feature.location.search = '?query=is%3Aunread';
  feature.mutation();
  feature.refresh();
  assert.deepEqual(feature.rows.map((row) => row.isConnected), [false, true, false]);

  await feature.changeSettings({ notificationOrganizations: ['Other'] });
  assert.deepEqual(feature.rows.map((row) => row.isConnected), [true, false, true]);
  await feature.changeSettings({ excludeOrganizationNotificationsFromMainInbox: false });
  assert.equal(feature.rows.every((row) => row.isConnected), true);
  await feature.changeSettings({ excludeOrganizationNotificationsFromMainInbox: true, organizationNotificationInboxesEnabled: false });
  assert.equal(feature.rows.every((row) => row.isConnected), true);
});

test('suppresses the native dot and unread label only when all unread items belong to excluded owners', async () => {
  const feature = await featureHarness();
  const suppressed = 'data-fractured-main-inbox-no-unread';
  assert.equal(feature.rootAttributes.has(suppressed), false);

  await feature.changeSettings({ excludeOrganizationNotificationsFromMainInbox: true });
  assert.equal(feature.rootAttributes.has(suppressed), true);
  assert.equal(feature.button.getAttribute('aria-label'), 'Notifications ( g then n )');

  await feature.pollUnread([feature.rows[0], feature.rows[1]]);
  assert.equal(feature.rootAttributes.has(suppressed), false);
  assert.equal(feature.button.getAttribute('aria-label'), feature.nativeLabel);

  await feature.pollUnread([feature.rows[0]]);
  assert.equal(feature.rootAttributes.has(suppressed), true);
  await feature.changeSettings({ excludeOrganizationNotificationsFromMainInbox: false });
  assert.equal(feature.rootAttributes.has(suppressed), false);
  assert.equal(feature.button.getAttribute('aria-label'), feature.nativeLabel);
});

test('updates GitHub’s referenced Inbox label while preserving its keyboard shortcut', async () => {
  const feature = await featureHarness({ referencedLabel: true });
  await feature.changeSettings({ excludeOrganizationNotificationsFromMainInbox: true });
  assert.equal(feature.labelNode.data, 'Notifications');
  assert.equal(feature.shortcutNode.textContent, '(g then n)');
  await feature.pollUnread([feature.rows[1]]);
  assert.equal(feature.labelNode.data, 'You have unread notifications');
});

test('checks later unread pages before hiding the main Inbox dot', async () => {
  const pages = [
    { rows: [row(['/acme/tool/issues/1'])], next: '/notifications?after=second&query=is%3Aunread' },
    { rows: [row(['/other/tool/pull/2'])] },
  ];
  const requested = [];
  const result = await hasVisibleUnread(new Set(['acme']), {
    origin: 'https://github.com',
    fetchPage: async (url) => {
      const index = requested.length;
      requested.push(url.searchParams.get('after'));
      return { ok: true, text: async () => index };
    },
    parsePage: (index) => ({
      querySelectorAll: () => pages[index].rows,
      querySelector: () => pages[index].next && { getAttribute: () => pages[index].next },
    }),
  });
  assert.equal(result, true);
  assert.deepEqual(requested, [null, 'second']);
});

test('continues with GitHub’s cursor and filter for All, Read and Unread', () => {
  const withNext = (href) => ({ querySelector: () => href && { getAttribute: () => href } });
  for (const query of ['', 'is:read', 'is:unread']) {
    const current = new URL('https://github.com/notifications');
    if (query) current.searchParams.set('query', query);
    const href = `/notifications?after=cursor&query=${encodeURIComponent(query)}&sort=oldest`;
    assert.equal(nextInboxPage(withNext(href), current).href, `https://github.com${href}`);
    assert.equal(nextInboxPage(withNext(null), current), null);
  }
  const current = new URL('https://github.com/notifications?query=is%3Aunread');
  assert.throws(() => nextInboxPage(withNext('/notifications?after=cursor&query=is%3Aread'), current), /Unexpected inbox pagination/);
  assert.throws(() => nextInboxPage(withNext('https://example.com/notifications?after=cursor&query=is%3Aunread'), current), /Unexpected inbox pagination/);
});
