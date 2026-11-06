const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../features/notifications/mute-accounts-inbox.js'), 'utf8');
const {
  normalizeAccount, accountFromHref, isMutedActor, notificationParticipants,
  isBotOnlyNotification, isInbox, notificationId, doneButton, createDoneRequest,
} = require('../../features/notifications/mute-accounts-inbox.js');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function row(avatars = [], { more = '', saved = false, actor = null, id = '123', button = null, form = null } = {}) {
  const attributes = new Map([['data-notification-id', id]]);
  if (actor) attributes.set('data-notification-actor', actor);
  const links = avatars.map((href) => ({ getAttribute: () => href }));
  const stack = { textContent: more };
  const checkedButton = button || { disabled: false, clicks: 0, click() { this.clicks++; } };
  const doneForm = form || {
    getAttribute: () => '/notifications/beta/archive',
    querySelector: (selector) => selector === 'button[type="submit"]' ? checkedButton : null,
  };
  return {
    attributes, checkedButton, doneForm,
    classList: { contains: (name) => name === 'notification-starred' && saved },
    getAttribute: (name) => attributes.get(name) || null,
    querySelector: (selector) => {
      if (selector === '.AvatarStack') return stack;
      if (selector.startsWith('.notification-starred')) return saved ? {} : null;
      if (selector === 'input[name="notification_ids[]"]') return null;
      if (selector === 'relative-time') return { getAttribute: () => '2026-11-06T16:00:00Z' };
      if (selector === 'form[action="/notifications/beta/archive"]') return doneForm;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === '.AvatarStack-body a[href]') return links;
      if (selector === 'form[action]') return [doneForm];
      return [];
    },
  };
}

test('normalizes app logins and does not mistake repository paths for account names', () => {
  assert.equal(normalizeAccount('@Vercel[bot]'), 'vercel[bot]');
  assert.equal(normalizeAccount('https://github.com/apps/Vercel'), 'vercel');
  assert.equal(normalizeAccount('pony-factor/repo'), '');
  assert.equal(accountFromHref('/apps/vercel'), 'vercel[bot]');
  assert.equal(accountFromHref('/kefania-pony%5Bbot%5D'), 'kefania-pony[bot]');
  assert.equal(accountFromHref('/pony-factor/repo/pull/1'), null);
  assert.equal(isMutedActor('vercel[bot]', new Set(['vercel'])), true);
});

test('leaves human participation, hidden avatars, unknown actors and saved notifications intact', () => {
  const muted = new Set(['vercel[bot]', 'kefania-pony[bot]']);
  assert.deepEqual(notificationParticipants(row(['/apps/vercel', '/kefania-pony%5Bbot%5D'])), ['vercel[bot]', 'kefania-pony[bot]']);
  assert.equal(isBotOnlyNotification(row(['/apps/vercel']), muted), true);
  assert.equal(isBotOnlyNotification(row(['/apps/vercel', '/alice']), muted), false);
  assert.equal(isBotOnlyNotification(row(['/apps/vercel'], { more: '+2' }), muted), false);
  assert.equal(isBotOnlyNotification(row(['/apps/vercel', '/unknown/repo']), muted), false);
  assert.equal(isBotOnlyNotification(row(['/apps/vercel'], { saved: true }), muted), false);
  assert.equal(isBotOnlyNotification(row([], { actor: 'vercel[bot]' }), muted), false);
});

test('only acts on regular inbox views', () => {
  const location = { hostname: 'github.com', pathname: '/notifications', search: '' };
  assert.equal(isInbox(location), true);
  assert.equal(isInbox({ ...location, search: '?query=is%3Aunread' }), true);
  assert.equal(isInbox({ ...location, search: '?query=org%3Apony-factor' }), false);
  assert.equal(isInbox({ ...location, search: '?query=is%3Adone' }), false);
  assert.equal(isInbox({ ...location, pathname: '/pony-factor/repo/pull/1' }), false);
});

test('requires a per-thread Done form, real numeric ID and CSRF token', () => {
  const bot = row(['/apps/vercel']);
  const page = { querySelector: () => null };
  assert.equal(notificationId(bot), '123');
  assert.equal(doneButton(bot), bot.checkedButton);
  assert.equal(createDoneRequest(bot, page), null);
  const form = {
    getAttribute: () => '/notifications/beta/archive',
    querySelector: (selector) => {
      if (selector === 'button[type="submit"]') return bot.checkedButton;
      if (selector === 'input[name="authenticity_token"]') return { value: 'secret-test-token' };
      return null;
    },
  };
  const trusted = row(['/apps/vercel'], { form });
  assert.equal(createDoneRequest(trusted, page).toString(), 'authenticity_token=secret-test-token&notification_ids%5B%5D=123');
  assert.equal(createDoneRequest(row(['/apps/vercel'], { form, id: 'all' }), page), null);
});

test('uses native Done only for exclusively muted bot notifications, without mutating other rows', async () => {
  const rows = [
    row(['/apps/vercel']),
    row(['/alice', '/apps/vercel']),
    row(['/alice']),
    row(['/kefania-pony%5Bbot%5D'], { id: '124' }),
  ];
  let settings = { muteInboxAccountsEnabled: true, mutedInboxAccounts: ['vercel[bot]', 'kefania-pony[bot]'] };
  const handlers = {};
  const timers = new Map();
  let id = 0;
  const location = { hostname: 'github.com', pathname: '/notifications', search: '' };
  const document = {
    documentElement: {},
    hidden: false,
    querySelectorAll: () => rows,
    addEventListener: (name, fn) => { handlers[name] = fn; },
  };
  const window = {
    location,
    setTimeout: (fn) => { timers.set(++id, fn); return id; },
    clearTimeout: (key) => timers.delete(key),
    setInterval() {},
    fetch() { throw new Error('No background polling in the inbox'); },
  };
  const runTimers = () => {
    const todo = [...timers.values()];
    timers.clear();
    todo.forEach((fn) => fn());
  };
  vm.runInNewContext(script, {
    window, document, chrome: { storage: {
      local: { get: async () => settings },
      onChanged: { addListener: (fn) => { handlers.storage = fn; } },
    } },
    URL, URLSearchParams, Date,
    MutationObserver: class { observe() {} },
  });
  await flush();
  runTimers();
  assert.deepEqual(rows.map((r) => r.checkedButton.clicks), [1, 0, 0, 1]);
  runTimers();
  assert.deepEqual(rows.map((r) => r.checkedButton.clicks), [1, 0, 0, 1]);

  settings = { muteInboxAccountsEnabled: false, mutedInboxAccounts: settings.mutedInboxAccounts };
  handlers.storage({ muteInboxAccountsEnabled: {} }, 'local');
  await flush();
  runTimers();
  assert.deepEqual(rows.map((r) => r.checkedButton.clicks), [1, 0, 0, 1]);
});
