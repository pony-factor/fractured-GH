(() => {
  'use strict';

  const ROW_SELECTOR = '.notifications-list-item, li[data-notification-id], [data-testid="notification-row"], [data-testid="notification-list-item"]';
  const DONE_PATH = '/notifications/beta/archive';
  const POLL_INTERVAL_MS = 60_000;
  const MIN_RETRY_MS = 5 * 60_000;
  const MAX_DONE_PER_POLL = 10;

  function normalizeAccount(value) {
    const account = String(value || '').trim()
      .replace(/^https?:\/\/github\.com\/(?:apps\/)?/i, '')
      .replace(/^@+/, '').replace(/\/+$/, '').toLowerCase();
    return /^[a-z0-9][a-z0-9-]*(?:\[bot\])?$/.test(account) ? account : '';
  }

  function accountFromHref(href) {
    if (!href) return null;
    try {
      const url = new URL(href, 'https://github.com');
      if (url.hostname !== 'github.com') return null;
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length === 2 && segments[0] === 'apps') {
        const name = normalizeAccount(segments[1]);
        return name ? name + '[bot]' : null;
      }
      if (segments.length !== 1) return null;
      return normalizeAccount(decodeURIComponent(segments[0])) || null;
    } catch {
      return null;
    }
  }

  function isMutedActor(actor, mutedAccounts) {
    if (!actor) return false;
    return mutedAccounts.has(actor)
      || (actor.endsWith('[bot]') && mutedAccounts.has(actor.slice(0, -5)));
  }

  function notificationParticipants(row) {
    const stack = row.querySelector('.AvatarStack');
    if (!stack) return null;
    // Avatar stacks are participants, not "last actor". A +N means that
    // GitHub has hidden other participants, potentially including a human.
    if (/\+\s*\d+\b/.test(stack.textContent || '')) return null;
    const links = row.querySelectorAll('.AvatarStack-body a[href]');
    if (!links.length) return null;
    const accounts = [...links].map((link) => accountFromHref(link.getAttribute('href')));
    return accounts.every(Boolean) ? accounts : null;
  }

  function isBotOnlyNotification(row, mutedAccounts) {
    if (!mutedAccounts.size || row.classList?.contains('notification-starred')) return false;
    if (row.querySelector('.notification-starred, [aria-label="Saved"], [data-state="saved"]')) return false;
    const participants = notificationParticipants(row);
    // Do not archive a conversation involving a human or an unknown sender,
    // even if its latest comment appears to have been posted by a muted bot.
    return Boolean(participants?.length && participants.every((account) => isMutedActor(account, mutedAccounts)));
  }

  function isInbox(location) {
    if (location.hostname !== 'github.com'
      || location.pathname.replace(/\/$/, '') !== '/notifications') return false;
    const query = (new URLSearchParams(location.search).get('query') || '').trim();
    return !query || /^is:(?:read|unread)$/i.test(query);
  }

  function notificationId(row) {
    const id = row.getAttribute('data-notification-id')
      || row.querySelector('input[name="notification_ids[]"]')?.value;
    return /^\d+$/.test(String(id || '')) ? String(id) : null;
  }

  function doneButton(row) {
    for (const form of row.querySelectorAll('form[action]')) {
      try {
        const action = new URL(form.getAttribute('action'), 'https://github.com');
        if (action.origin !== 'https://github.com' || action.pathname !== DONE_PATH) continue;
        const button = form.querySelector('button[type="submit"]');
        if (button && !button.disabled) return button;
      } catch {
        // Unknown form actions must never be invoked automatically.
      }
    }
    return null;
  }

  function createDoneRequest(row, page) {
    const id = notificationId(row);
    if (!id) return null;
    const form = row.querySelector('form[action="/notifications/beta/archive"]')
      || page.querySelector('.js-notification-bulk-action form[action="/notifications/beta/archive"]');
    if (!form) return null;
    const token = form.querySelector('input[name="authenticity_token"]')?.value
      || page.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (!token) return null;
    // Always send exactly one verified notification ID. Never reuse a
    // bulk form's selected rows, and never submit a "mark all" action.
    const params = new URLSearchParams();
    params.set('authenticity_token', token);
    params.append('notification_ids[]', id);
    return params;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalizeAccount, accountFromHref, isMutedActor,
      notificationParticipants, isBotOnlyNotification, isInbox,
      notificationId, doneButton, createDoneRequest,
    };
    return;
  }

  let enabled = false;
  let mutedAccounts = new Set();
  let refreshTimer = null;
  let polling = false;
  const attempted = new Map();

  function attemptKey(row) {
    const id = notificationId(row);
    const time = row.querySelector('relative-time')?.getAttribute('datetime') || '';
    return id ? id + ':' + time : null;
  }

  function mayAttempt(row) {
    const key = attemptKey(row);
    if (!key) return false;
    const previous = attempted.get(key);
    if (previous && Date.now() - previous < MIN_RETRY_MS) return false;
    attempted.set(key, Date.now());
    return true;
  }

  function checkVisibleInbox() {
    if (!enabled || !isInbox(window.location)) return;
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      if (!isBotOnlyNotification(row, mutedAccounts)) continue;
      const button = doneButton(row);
      if (!button || !mayAttempt(row)) continue;
      // Use GitHub's native per-thread Done action; it marks the thread
      // done/read on GitHub rather than just hiding its DOM node.
      button.click();
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(checkVisibleInbox, 100);
  }

  async function pollInbox() {
    if (!enabled || polling || document.hidden || window.location.hostname !== 'github.com'
      || isInbox(window.location)) return;
    polling = true;
    try {
      const response = await window.fetch('/notifications?query=is%3Aunread', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!response.ok || response.redirected) return;
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      let completed = 0;
      for (const row of page.querySelectorAll(ROW_SELECTOR)) {
        if (completed >= MAX_DONE_PER_POLL) break;
        if (!isBotOnlyNotification(row, mutedAccounts)) continue;
        const body = createDoneRequest(row, page);
        if (!body || !mayAttempt(row)) continue;
        const result = await window.fetch(DONE_PATH, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'text/html',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: body.toString(),
          redirect: 'manual',
        });
        // A failed or unknown response is not proof that a thread is done.
        if (result.ok) completed++;
      }
    } catch {
      // Network failures must not change the notification state locally.
    } finally {
      polling = false;
    }
  }

  async function loadSettings() {
    const settings = await chrome.storage.local.get({
      muteInboxAccountsEnabled: false,
      mutedInboxAccounts: [],
    });
    enabled = settings.muteInboxAccountsEnabled === true;
    mutedAccounts = new Set(
      (Array.isArray(settings.mutedInboxAccounts) ? settings.mutedInboxAccounts : [])
        .map(normalizeAccount).filter(Boolean),
    );
    scheduleRefresh();
    if (enabled) void pollInbox();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes.muteInboxAccountsEnabled && !changes.mutedInboxAccounts)) return;
    void loadSettings();
  });

  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void pollInbox();
  });
  const observer = new MutationObserver(scheduleRefresh);
  function start() {
    if (!document.documentElement) {
      window.setTimeout(start, 100);
      return;
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleRefresh();
  }
  start();
  void loadSettings();
  window.setInterval(() => void pollInbox(), POLL_INTERVAL_MS);
})();
