const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../features/notifications/mute-accounts-inbox.js'), 'utf8');
const { normalizeAccount, accountFromHref, notificationActor, isMutedActor, isInbox } =
  require('../../features/notifications/mute-accounts-inbox.js');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function row(avatars = [], actor = null) {
  const attributes = new Map(actor ? [['data-notification-actor', actor]] : []);
  return {
    attributes,
    getAttribute: (name) => attributes.get(name) || null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    querySelectorAll: () => avatars.map((href) => ({ getAttribute: () => href })),
  };
}

test('normalizes bot logins, user links and app links without matching repo owners', () => {
  assert.equal(normalizeAccount('  @Vercel[bot] '), 'vercel[bot]');
  assert.equal(normalizeAccount('https://github.com/apps/Vercel'), 'vercel');
  assert.equal(normalizeAccount('pony-factor/repo'), '');
  assert.equal(accountFromHref('/apps/vercel'), 'vercel[bot]');
  assert.equal(accountFromHref('/kefania-pony%5Bbot%5D'), 'kefania-pony[bot]');
  assert.equal(accountFromHref('/pony-factor/repo/pull/1'), null);
  assert.equal(accountFromHref('https://not-github.com/apps/vercel'), null);
  assert.equal(isMutedActor('vercel[bot]', new Set(['vercel'])), true);
  assert.equal(isMutedActor('vercel', new Set(['vercel[bot]'])), false);
});

test('only identifies a sender when there is an unambiguous actor', () => {
  assert.equal(notificationActor(row(['/apps/vercel'])), 'vercel[bot]');
  assert.equal(notificationActor(row(['/alice', '/apps/vercel'])), null);
  assert.equal(notificationActor(row([], 'Lindsey[bot]')), 'lindsey[bot]');
  assert.equal(notificationActor(row(['/pony-factor/repo/pull/1'])), null);
  assert.equal(notificationActor(row([])), null);
});

test('matches inbox views but never arbitrary pages or done/saved views', () => {
  assert.equal(isInbox({ hostname: 'github.com', pathname: '/notifications', search: '' }), true);
  assert.equal(isInbox({ hostname: 'github.com', pathname: '/notifications', search: '?query=is%3Aunread' }), true);
  assert.equal(isInbox({ hostname: 'github.com', pathname: '/notifications', search: '?query=is%3Adone' }), false);
  assert.equal(isInbox({ hostname: 'github.com', pathname: '/pony-factor/repo/pull/1', search: '' }), false);
});

test('only hides clear muted senders and restores rows when disabled or settings change', async () => {
  const rows = [row(['/apps/vercel']), row(['/alice', '/apps/vercel']), row(['/alice']), row([], 'Lindsey[bot]')];
  let settings = { muteInboxAccountsEnabled: true, mutedInboxAccounts: ['vercel[bot]', 'lindsey[bot]'] };
  const handlers = {};
  const styles = [];
  const timers = new Map();
  let id = 0;
  const doc = {
    documentElement: { append: (element) => styles.push(element) },
    getElementById: (value) => styles.find((element) => element.id === value),
    createElement: () => ({}),
    querySelectorAll: () => rows,
    addEventListener: (event, fn) => { handlers[event] = fn; },
  };
  const window = {
    location: { hostname: 'github.com', pathname: '/notifications', search: '' },
    setTimeout: (fn) => { timers.set(++id, fn); return id; },
    clearTimeout: (key) => timers.delete(key),
  };
  let observe;
  vm.runInNewContext(script, {
    window, document: doc, chrome: { storage: {
      local: { get: async () => settings },
      onChanged: { addListener: (fn) => { handlers.storage = fn; } },
    } },
    URL, URLSearchParams,
    MutationObserver: class { constructor(fn) { observe = fn; } observe() {} },
  });
  await flush();
  const hidden = 'data-fractured-muted-inbox-account';
  assert.deepEqual(rows.map((r) => r.attributes.has(hidden)), [true, false, false, true]);
  assert.equal(styles.length, 1);
  settings = { ...settings, muteInboxAccountsEnabled: false };
  handlers.storage({ muteInboxAccountsEnabled: {} }, 'local');
  await flush();
  assert.deepEqual(rows.map((r) => r.attributes.has(hidden)), [false, false, false, false]);
  settings = { muteInboxAccountsEnabled: true, mutedInboxAccounts: ['alice'] };
  handlers.storage({ mutedInboxAccounts: {} }, 'local');
  await flush();
  assert.deepEqual(rows.map((r) => r.attributes.has(hidden)), [false, false, true, false]);
  window.location.search = '?query=is%3Adone';
  handlers['turbo:load']();
  [...timers.values()].forEach((fn) => fn());
  assert.deepEqual(rows.map((r) => r.attributes.has(hidden)), [false, false, false, false]);
  window.location.search = '';
  observe();
  [...timers.values()].forEach((fn) => fn());
  assert.deepEqual(rows.map((r) => r.attributes.has(hidden)), [false, false, true, false]);
});
