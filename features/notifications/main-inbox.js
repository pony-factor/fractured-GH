(() => {
  'use strict';

  const HIDDEN_ATTRIBUTE = 'data-fractured-main-inbox-hidden';
  const NO_UNREAD_ATTRIBUTE = 'data-fractured-main-inbox-no-unread';
  const STYLE_ID = 'fractured-main-inbox-style';
  const ROW_SELECTOR = '.notifications-list-item, li[data-notification-id], [data-testid="notification-row"], [data-testid="notification-list-item"]';
  const REPOSITORY_SELECTOR = '.notifications-list-item-repository, .notification-list-item-repository, [data-testid="notification-repository"]';
  const NEXT_PAGE_SELECTOR = 'a[rel="next"], .pagination a[href*="after="], a[aria-label="Next"][href*="after="]';
  const INBOX_BUTTON_SELECTOR = '#AppHeader-notifications-button, :is(.AppHeader, .GlobalNav, header[role="banner"], header[aria-label="Global navigation menu"]) a:has(svg.octicon-inbox)';
  const REFRESH_INTERVAL_MS = 60_000;
  const REQUEST_TIMEOUT_MS = 15_000;
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

  async function hasVisibleUnread(organizations, { origin, fetchPage, parsePage, signal }) {
    let page = new URL('/notifications?query=is%3Aunread', origin);
    const visited = new Set();
    while (page && !visited.has(page.href)) {
      visited.add(page.href);
      const response = await fetchPage(page, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' },
        signal,
      });
      if (!response.ok || (response.url && new URL(response.url).pathname !== '/notifications')) {
        throw new Error('Could not load the unread inbox');
      }
      const inbox = parsePage(await response.text());
      if ([...inbox.querySelectorAll(ROW_SELECTOR)].some((row) => !organizations.has(notificationOwner(row)))) {
        return true;
      }

      const nextLink = inbox.querySelector(NEXT_PAGE_SELECTOR)?.getAttribute('href');
      if (!nextLink) return false;
      page = new URL(nextLink, page);
      if (page.origin !== origin || page.pathname !== '/notifications'
        || page.searchParams.get('query') !== 'is:unread' || !page.searchParams.has('after')) {
        throw new Error('Unexpected unread inbox pagination');
      }
    }
    throw new Error('Unread inbox pagination repeated');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeOrganizations, isMainInbox, ownerFromHref, notificationOwner, hasVisibleUnread };
    return;
  }

  let enabled = false;
  let exclude = false;
  let organizations = new Set();
  let refreshTimer = null;
  let unread = null;
  let unreadRequest = null;
  let lastUnreadCheck = -Infinity;
  let relabeled = null;

  function filteringEnabled() {
    return enabled && exclude && organizations.size > 0;
  }

  function ensureStyle() {
    if (!document.documentElement || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${HIDDEN_ATTRIBUTE}] { display: none !important; }
      html[${NO_UNREAD_ATTRIBUTE}] :is(${INBOX_BUTTON_SELECTOR})[class*="notificationIndicator"]::before {
        content: none !important;
      }
      html[${NO_UNREAD_ATTRIBUTE}] :is(${INBOX_BUTTON_SELECTOR}) .mail-status {
        display: none !important;
      }
    `;
    document.documentElement.append(style);
  }

  function updateUnreadIndicator() {
    const suppress = filteringEnabled() && unread === false;
    const root = document.documentElement;
    if (!root) return;
    root.toggleAttribute(NO_UNREAD_ATTRIBUTE, suppress);
    const button = suppress ? document.querySelector(INBOX_BUTTON_SELECTOR) : null;
    const labelId = button?.getAttribute('aria-labelledby');
    const labelElement = labelId ? document.getElementById(labelId) : null;
    const labelNode = [...(labelElement?.childNodes ?? [])].find((node) => node.nodeType === 3);
    const target = labelNode ?? button;
    if (relabeled && relabeled.target !== target) {
      if (relabeled.read() === relabeled.quiet) relabeled.write(relabeled.original);
      relabeled = null;
    }
    if (!target) return;

    // GitHub's current header shares a label node with the shortcut description.
    const read = labelNode ? () => labelNode.data : () => target.getAttribute('aria-label');
    const write = labelNode
      ? (value) => { labelNode.data = value; }
      : (value) => target.setAttribute('aria-label', value);
    const label = read();
    if (label && /you have unread notifications/i.test(label)) {
      const quiet = label.replace(/you have unread notifications/i, 'Notifications');
      relabeled = { target, read, write, original: label, quiet };
      write(quiet);
    }
  }

  async function refreshUnreadIndicator() {
    if (!filteringEnabled() || unreadRequest || document.hidden || navigator.onLine === false
      || Date.now() - lastUnreadCheck < 1_000) return;
    lastUnreadCheck = Date.now();
    const request = new AbortController();
    unreadRequest = request;
    const timeout = window.setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
    try {
      const result = await hasVisibleUnread(organizations, {
        origin: window.location.origin,
        fetchPage: (url, options) => window.fetch(url, options),
        parsePage: (markup) => new DOMParser().parseFromString(markup, 'text/html'),
        signal: request.signal,
      });
      if (unreadRequest === request) {
        unread = result;
        updateUnreadIndicator();
      }
    } catch {
      // Keep the last verified state until the unread inbox can be checked again.
    } finally {
      window.clearTimeout(timeout);
      if (unreadRequest === request) unreadRequest = null;
    }
  }

  function updateInbox() {
    const shouldExclude = filteringEnabled() && isMainInbox(window.location);
    if (filteringEnabled()) ensureStyle();
    updateUnreadIndicator();
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
    unreadRequest?.abort();
    unreadRequest = null;
    unread = null;
    lastUnreadCheck = -Infinity;
    updateInbox();
    void refreshUnreadIndicator();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.organizationNotificationInboxesEnabled
      || changes.excludeOrganizationNotificationsFromMainInbox
      || changes.notificationOrganizations) void loadSettings();
  });

  function onNavigation() {
    scheduleRefresh();
    void refreshUnreadIndicator();
  }

  document.addEventListener('turbo:load', onNavigation);
  document.addEventListener('pjax:end', onNavigation);
  document.addEventListener('visibilitychange', refreshUnreadIndicator);
  window.addEventListener('focus', refreshUnreadIndicator);
  window.addEventListener('online', refreshUnreadIndicator);
  window.setInterval(refreshUnreadIndicator, REFRESH_INTERVAL_MS);

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
