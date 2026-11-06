(() => {
  'use strict';

  const ROW_SELECTOR = '.notifications-list-item, li[data-notification-id], [data-testid="notification-row"], [data-testid="notification-list-item"]';
  const HIDDEN_ATTRIBUTE = 'data-fractured-muted-inbox-account';
  const STYLE_ID = 'fractured-muted-inbox-accounts-style';

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

  function notificationActor(row) {
    // Only an explicit actor or a sole avatar can identify the sender.
    // A multi-person AvatarStack lists participants, not the triggering author.
    for (const attribute of ['data-notification-actor', 'data-notification-sender']) {
      const actor = normalizeAccount(row.getAttribute(attribute));
      if (actor) return actor;
    }
    const links = row.querySelectorAll('.AvatarStack-body a[href]');
    if (links.length !== 1) return null;
    return accountFromHref(links[0].getAttribute('href'));
  }

  function isMutedActor(actor, mutedAccounts) {
    if (!actor) return false;
    return mutedAccounts.has(actor)
      || (actor.endsWith('[bot]') && mutedAccounts.has(actor.slice(0, -5)));
  }

  function isInbox(location) {
    return location.hostname === 'github.com'
      && location.pathname.replace(/\/$/, '') === '/notifications'
      && !(new URLSearchParams(location.search).get('query') || '').match(/\bis:(?:done|saved)\b/i);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeAccount, accountFromHref, notificationActor, isMutedActor, isInbox };
    return;
  }

  let enabled = false;
  let mutedAccounts = new Set();
  let refreshTimer = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID) || !document.documentElement) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '[' + HIDDEN_ATTRIBUTE + '] { display: none !important; }';
    document.documentElement.append(style);
  }

  function updateInbox() {
    const active = enabled && mutedAccounts.size > 0 && isInbox(window.location);
    if (active) ensureStyle();
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      const hide = active && isMutedActor(notificationActor(row), mutedAccounts);
      if (hide) row.setAttribute(HIDDEN_ATTRIBUTE, '');
      else row.removeAttribute(HIDDEN_ATTRIBUTE);
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(updateInbox, 100);
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
    updateInbox();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes.muteInboxAccountsEnabled && !changes.mutedInboxAccounts)) return;
    void loadSettings();
  });

  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);
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
})();
