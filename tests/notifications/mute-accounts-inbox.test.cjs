const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../features/notifications/mute-accounts-inbox.js'), 'utf8');
const {
  normalizeAccount, accountFromHref, isMutedActor, notificationParticipants,
  isMutedAccountNotification, isInbox, notificationComment, notificationId, doneButton, createDoneRequest,
} = require('../../features/notifications/mute-accounts-inbox.js');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function row(avatars = [], { more = '', saved = false, actor = null, id = '123', button = null, form = null, href = null } = {}) {
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
      if (selector === 'a[href*="notification_referrer_id="]' && href) return { getAttribute: () => href };
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
  assert.equal(isMutedAccountNotification(row(['/apps/vercel']), muted), true);
  assert.equal(isMutedAccountNotification(row(['/apps/vercel', '/alice']), muted), false);
  assert.equal(isMutedAccountNotification(row(['/apps/vercel'], { more: '+2' }), muted), false);
  assert.equal(isMutedAccountNotification(row(['/apps/vercel', '/unknown/repo']), muted), false);
  assert.equal(isMutedAccountNotification(row(['/apps/vercel'], { saved: true }), muted), false);
  assert.equal(isMutedAccountNotification(row([], { actor: 'vercel[bot]' }), muted), false);
});

test('acts on filtered inboxes and skips Done and Saved views', () => {
  const location = { hostname: 'github.com', pathname: '/notifications', search: '' };
  assert.equal(isInbox(location), true);
  assert.equal(isInbox({ ...location, search: '?query=is%3Aunread' }), true);
  assert.equal(isInbox({ ...location, search: '?query=org%3Ablocktransfer' }), true);
  assert.equal(isInbox({ ...location, search: '?query=org%3Ablocktransfer+is%3Asaved' }), false);
  assert.equal(isInbox({ ...location, search: '?query=is%3Adone' }), false);
  assert.equal(isInbox({ ...location, pathname: '/pony-factor/repo/pull/1' }), false);
});

test('only follows a GitHub issue or pull request notification permalink', () => {
  const href = '/blocktransfer/issuer-disclosures/pull/12?notification_referrer_id=NT_example&notifications_query=org%3Ablocktransfer#issuecomment-123';
  assert.deepEqual(notificationComment(row([], { href })), {
    path: '/blocktransfer/issuer-disclosures/pull/12',
    id: 'issuecomment-123',
  });
  assert.equal(notificationComment(row([], { href: 'https://example.com' + href })), null);
  assert.equal(notificationComment(row([], { href: href.replace('#issuecomment-123', '#event-123') })), null);
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

test('uses native Done for muted comment authors in an organization inbox', async () => {
  const linkedComment = (pr, comment) => `/blocktransfer/issuer-disclosures/pull/${pr}?notification_referrer_id=NT_example#issuecomment-${comment}`;
  const mixed = ['/apps/netlify', '/contributor'];
  const rows = [
    row(['/apps/vercel']),
    row(['/bob', '/apps/vercel'], { id: '127' }),
    row(['/alice'], { id: '125' }),
    row(['/kefania-pony%5Bbot%5D'], { id: '124' }),
    row(mixed, { id: '128', more: '+1', href: linkedComment(12, 123) }),
    row(mixed, { id: '129', href: linkedComment(8, 456) }),
    row(mixed, { id: '130', href: linkedComment(7, 789) }),
    row(mixed, { id: '131', saved: true, href: linkedComment(6, 123) }),
  ];
  let settings = { mutedInboxAccounts: [] };
  const handlers = {};
  const timers = new Map();
  let id = 0;
  const location = new URL('https://github.com/notifications?query=org%3Ablocktransfer');
  const fetched = [];
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
    async fetch(url, settings) {
      fetched.push([url, settings.credentials]);
      const bot = url.endsWith('/12') && settings.credentials === 'omit';
      const human = url.endsWith('/8');
      const authors = bot ? { 'issuecomment-123': '/apps/netlify' } : human ? { 'issuecomment-456': '/bob' } : {};
      return { ok: true, text: async () => JSON.stringify(authors) };
    },
  };
  const runTimers = async () => {
    const todo = [...timers.values()];
    timers.clear();
    todo.forEach((fn) => fn());
    await flush();
  };
  vm.runInNewContext(script, {
    window, document, chrome: { storage: {
      local: { get: async () => settings },
      onChanged: { addListener: (fn) => { handlers.storage = fn; } },
    } },
    URL, URLSearchParams, Date,
    DOMParser: class {
      parseFromString(text) {
        const authors = JSON.parse(text);
        return {
          getElementById: (key) => authors[key] ? {
            querySelector: (selector) => selector === '.timeline-comment-header a.author[href]'
              ? { getAttribute: () => authors[key] } : null,
          } : null,
        };
      }
    },
    MutationObserver: class { observe() {} },
  });
  await flush();
  await runTimers();
  assert.deepEqual(rows.map((r) => r.checkedButton.clicks), [0, 0, 0, 0, 0, 0, 0, 0]);

  settings = { muteInboxAccountsEnabled: false, mutedInboxAccounts: ['vercel[bot]', 'kefania-pony[bot]', 'alice', 'netlify'] };
  handlers.storage({ mutedInboxAccounts: {} }, 'local');
  await flush();
  await runTimers();
  assert.deepEqual(rows.map((r) => r.checkedButton.clicks), [1, 0, 1, 1, 1, 0, 0, 0]);
  assert.deepEqual(fetched, [
    ['/blocktransfer/issuer-disclosures/pull/12', 'same-origin'],
    ['/blocktransfer/issuer-disclosures/pull/12', 'omit'],
    ['/blocktransfer/issuer-disclosures/pull/8', 'same-origin'],
    ['/blocktransfer/issuer-disclosures/pull/7', 'same-origin'],
    ['/blocktransfer/issuer-disclosures/pull/7', 'omit'],
  ]);

  rows.push(row(['/alice'], { id: '126' }));
  settings = { mutedInboxAccounts: [] };
  handlers.storage({ mutedInboxAccounts: {} }, 'local');
  await flush();
  await runTimers();
  assert.deepEqual(rows.map((r) => r.checkedButton.clicks), [1, 0, 1, 1, 1, 0, 0, 0, 0]);
});
