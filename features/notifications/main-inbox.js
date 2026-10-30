(() => {
  'use strict';

  const HIDDEN_ATTRIBUTE = 'data-fractured-main-inbox-hidden';
  const STYLE_ID = 'fractured-main-inbox-style';
  const ROW_SELECTOR = '.notifications-list-item, li[data-notification-id], [data-testid="notification-row"], [data-testid="notification-list-item"]';
  const REPOSITORY_SELECTOR = '.notifications-list-item-repository, .notification-list-item-repository, [data-testid="notification-repository"]';
  const RESERVED_OWNERS = new Set([
    'about', 'apps', 'codespaces', 'dashboard', 'explore', 'features', 'issues',
    'login', 'marketplace', 'new', 'notifications', 'orgs', 'organizations',
    'pulls', 'search', 'security', 'settings', 'sponsors', 'topics', 'users',
  ]);

  function normalizeOrganizations(values) {
    if (!Array.isArray(values)) return new Set();
    return new Set(values.map((value) => String(value || '')
      .trim().replace(/^https?:\/\/github\.com\//i, '').replace(/^@+/, '')
      .replace(/\/+$/, '').toLowerCase()).filter(Boolean));
  }

  function isMainInbox(location) {
    if (location.hostname !== 'github.com' || location.pathname.replace(/\/$/, '') !== '/notifications') return false;
    const query = new URLSearchParams(location.search).get('query');
    return !query || /^(is:unread|is:read)$/i.test(query.trim());
  }

  function ownerFromHref(href) {
    if (!href) return null;
    let url;
    try { url = new URL(href, 'https://github.com'); } catch { return null; }
    if (url.hostname !== 'github.com') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2 || RESERVED_OWNERS.has(segments[0].toLowerCase())) return null;
    return segments[0].toLowerCase();
  }

  function notificationOwner(row) {
    const repository = row.querySelector(REPOSITORY_SELECTOR);
    const match = repository?.textContent?.trim().match(/^([\w-]+)\/[\w.-]+/);
    if (match) return match[1].toLowerCase();

    for (const anchor of row.querySelectorAll('a[href]')) {
      const owner = ownerFromHref(anchor.getAttribute('href'));
      if (owner) return owner;
    }
    return null;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeOrganizations, isMainInbox, ownerFromHref, notificationOwner };
    return;
  }

  let enabled = false;
  let exclude = false;
  let organizations = new Set();
  let refreshTimer = null;

  function ensureStyle() {
    if (!document.documentElement || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '[' + HIDDEN_ATTRIBUTE + '] { display: none !important; }';
    document.documentElement.append(style);
  }

  function updateInbox() {
    const shouldExclude = enabled && exclude && organizations.size > 0 && isMainInbox(window.location);
    if (shouldExclude) ensureStyle();
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      const shouldHide = shouldExclude && organizations.has(notificationOwner(row));
      if (shouldHide) row.setAttribute(HIDDEN_ATTRIBUTE, '');
      else row.removeAttribute(HIDDEN_ATTRIBUTE);
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(updateInbox, 100);
  }

  async function loadSettings() {
    const settings = await chrome.storage.local.get({
      organizationNotificationInboxesEnabled: false,
      excludeOrganizationNotificationsFromMainInbox: false,
      notificationOrganizations: [],
    });
    enabled = Boolean(settings.organizationNotificationInboxesEnabled);
    exclude = Boolean(settings.excludeOrganizationNotificationsFromMainInbox);
    organizations = normalizeOrganizations(settings.notificationOrganizations);
    updateInbox();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.organizationNotificationInboxesEnabled
      || changes.excludeOrganizationNotificationsFromMainInbox
      || changes.notificationOrganizations) void loadSettings();
  });

  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);

  const observer = new MutationObserver(scheduleRefresh);
  function startObserver() {
    if (!document.documentElement) {
      window.setTimeout(startObserver, 100);
      return;
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleRefresh();
  }
  startObserver();
  void loadSettings();
})();
