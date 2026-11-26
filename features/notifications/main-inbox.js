(() => {
  'use strict';

  const FILTERED_ATTRIBUTE = 'data-fractured-main-inbox-filtered';
  const NO_UNREAD_ATTRIBUTE = 'data-fractured-main-inbox-no-unread';
  const NATIVE_PAGINATION_ATTRIBUTE = 'data-fractured-main-inbox-native-pagination';
  const STYLE_ID = 'fractured-main-inbox-style';
  const ROW_SELECTOR = '.notifications-list-item, li[data-notification-id], [data-testid="notification-row"], [data-testid="notification-list-item"]';
  const REPOSITORY_SELECTOR = '.notifications-list-item-repository, .notification-list-item-repository, [data-testid="notification-repository"]';
  const NEXT_PAGE_SELECTOR = 'a[rel="next"], .pagination a[href*="after="], a[aria-label="Next"][href*="after="]';
  const GROUP_SELECTOR = '.js-notifications-list';
  const GROUP_ROW_SELECTOR = `${GROUP_SELECTOR} :is(${ROW_SELECTOR})`;
  const PAGINATOR_SELECTOR = '.js-notifications-list-paginator-buttons';
  const COUNTS_SELECTOR = '.js-notifications-list-paginator-counts';
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
    if (segments[0] === 'orgs' && segments[2] === 'discussions' && segments[3]) {
      return segments[1].toLowerCase();
    }
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

  async function fetchInboxPage(page, { fetchPage, parsePage, signal }) {
    const response = await fetchPage(page, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' },
      signal,
    });
    const responseUrl = response.url && new URL(response.url);
    if (!response.ok || (responseUrl && (responseUrl.origin !== page.origin || responseUrl.pathname !== '/notifications'))) {
      throw new Error('Could not load the inbox page');
    }
    return parsePage(await response.text());
  }

  function nextInboxPage(inbox, current) {
    const href = inbox.querySelector(NEXT_PAGE_SELECTOR)?.getAttribute('href');
    if (!href) return null;
    const next = new URL(href, current);
    const query = (url) => (url.searchParams.get('query') ?? '').trim().toLowerCase();
    if (next.origin !== current.origin || next.pathname !== '/notifications'
      || query(next) !== query(current) || !next.searchParams.has('after')) {
      throw new Error('Unexpected inbox pagination');
    }
    return next;
  }

  async function hasVisibleUnread(organizations, { origin, fetchPage, parsePage, signal }) {
    let page = new URL('/notifications?query=is%3Aunread', origin);
    const visited = new Set();
    while (page && !visited.has(page.href)) {
      visited.add(page.href);
      const inbox = await fetchInboxPage(page, { fetchPage, parsePage, signal });
      if ([...inbox.querySelectorAll(ROW_SELECTOR)].some((row) => !organizations.has(notificationOwner(row)))) {
        return true;
      }

      page = nextInboxPage(inbox, page);
      if (!page) return false;
    }
    throw new Error('Unread inbox pagination repeated');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeOrganizations, isMainInbox, ownerFromHref, notificationOwner, hasVisibleUnread, nextInboxPage };
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
  let pagination = null;
  const excludedRows = new Map();

  function filteringEnabled() {
    return enabled && exclude && organizations.size > 0;
  }

  function ensureStyle() {
    if (!document.documentElement || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html[${FILTERED_ATTRIBUTE}] ${GROUP_SELECTOR}:not(:has(:is(${ROW_SELECTOR}))) { display: none !important; }
      [${NATIVE_PAGINATION_ATTRIBUTE}] { display: none !important; }
      html[${NO_UNREAD_ATTRIBUTE}] :is(${INBOX_BUTTON_SELECTOR})[class*="notificationIndicator"]::before {
        content: none !important;
      }
      html[${NO_UNREAD_ATTRIBUTE}] :is(${INBOX_BUTTON_SELECTOR}) .mail-status {
        display: none !important;
      }
    `;
    document.documentElement.append(style);
  }

  function stopPagination() {
    if (!pagination) return;
    pagination.request?.abort();
    for (const group of pagination.addedGroups) group.remove();
    pagination.nativeNext.removeAttribute(NATIVE_PAGINATION_ATTRIBUTE);
    pagination.nativeCounts?.removeAttribute(NATIVE_PAGINATION_ATTRIBUTE);
    pagination.more.remove();
    pagination.status.remove();
    pagination = null;
  }

  function appendInboxGroups(page, state) {
    let added = 0;
    const knownIds = new Set(
      [...state.container.querySelectorAll(ROW_SELECTOR)].map((row) => row.getAttribute('data-notification-id')).filter(Boolean),
    );
    const groups = [];
    for (const group of page.querySelectorAll(GROUP_SELECTOR)) {
      for (const row of group.querySelectorAll(ROW_SELECTOR)) {
        const id = row.getAttribute('data-notification-id');
        if (organizations.has(notificationOwner(row)) || (id && knownIds.has(id))) {
          row.remove();
        } else {
          if (id) knownIds.add(id);
          added++;
        }
      }
      if (group.querySelector(ROW_SELECTOR)) groups.push(document.importNode(group, true));
    }
    const lastGroup = state.addedGroups.at(-1) ?? state.lastNativeGroup;
    lastGroup.after(...groups);
    state.addedGroups.push(...groups);
    return added;
  }

  async function loadInboxRows(state, needed) {
    if (state.request || !state.next) return;
    const request = new AbortController();
    state.request = request;
    state.more.disabled = true;
    state.more.textContent = 'Loading…';
    const timeout = window.setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
    let failed = false;
    try {
      let added = 0;
      while (state.next && added < needed) {
        const pageUrl = state.next;
        if (state.visited.has(pageUrl.href)) throw new Error('Inbox pagination repeated');
        const page = await fetchInboxPage(pageUrl, {
          fetchPage: (url, options) => window.fetch(url, options),
          parsePage: (markup) => new DOMParser().parseFromString(markup, 'text/html'),
          signal: request.signal,
        });
        if (pagination !== state || !state.lastNativeGroup.isConnected || state.url !== window.location.href) return;
        const next = nextInboxPage(page, pageUrl);
        if (page.querySelector(ROW_SELECTOR) && !page.querySelector(GROUP_SELECTOR)) {
          throw new Error('Unexpected inbox list markup');
        }
        added += appendInboxGroups(page, state);
        state.visited.add(pageUrl.href);
        state.next = next;
      }
    } catch {
      failed = true;
    } finally {
      window.clearTimeout(timeout);
      if (pagination === state) {
        state.request = null;
        state.more.disabled = false;
        state.more.hidden = !state.next;
        state.more.textContent = failed ? 'Retry loading notifications' : 'Load more notifications';
        updatePaginationCount(state);
      }
    }
  }

  function updatePaginationCount(state) {
    const count = state.container.querySelectorAll(GROUP_ROW_SELECTOR).length;
    const label = count === 0 && !state.next ? 'No notifications match' : `${count} shown`;
    if (state.status.textContent !== label) state.status.textContent = label;
  }

  function updatePagination(shouldExclude) {
    const url = window.location.href;
    if (pagination && (!shouldExclude || pagination.url !== url
      || !pagination.nativeNext.isConnected || !pagination.lastNativeGroup.isConnected)) stopPagination();
    if (!shouldExclude || !url) return;
    if (pagination) {
      updatePaginationCount(pagination);
      return;
    }

    const pager = document.querySelector(PAGINATOR_SELECTOR);
    const nativeNext = pager?.querySelector('a[aria-label="Next"], button[aria-label="Next"]');
    const groups = [...document.querySelectorAll(GROUP_SELECTOR)];
    const lastNativeGroup = groups.at(-1);
    if (!nativeNext || !lastNativeGroup?.parentElement?.contains(pager)) return;

    let next;
    try { next = nextInboxPage(pager, new URL(url)); } catch { return; }
    const container = lastNativeGroup.parentElement;
    const rows = groups.flatMap((group) => [...group.querySelectorAll(ROW_SELECTOR)]);
    const hiddenCount = [...excludedRows.values()].filter((placeholder) => container.contains(placeholder)).length;
    const pageSize = rows.length + hiddenCount;
    if (!pageSize) return;
    const nativeCounts = pager.parentElement.querySelector(COUNTS_SELECTOR);
    const status = document.createElement('span');
    status.className = 'mr-2 color-fg-muted';
    status.setAttribute('role', 'status');
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn BtnGroup-item';
    more.textContent = 'Load more notifications';
    more.hidden = !next;
    nativeNext.setAttribute(NATIVE_PAGINATION_ATTRIBUTE, '');
    nativeCounts?.setAttribute(NATIVE_PAGINATION_ATTRIBUTE, '');
    pager.before(status);
    pager.append(more);

    const state = { url, container, nativeNext, nativeCounts, lastNativeGroup, next, status, more,
      addedGroups: [], visited: new Set([url]), request: null };
    pagination = state;
    more.addEventListener('click', () => void loadInboxRows(state, pageSize));
    updatePaginationCount(state);
    if (hiddenCount && next) void loadInboxRows(state, hiddenCount);
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
    document.documentElement?.toggleAttribute(FILTERED_ATTRIBUTE, shouldExclude);
    for (const [row, placeholder] of excludedRows) {
      if (!placeholder.isConnected) {
        excludedRows.delete(row);
      } else if (!shouldExclude || !organizations.has(notificationOwner(row))) {
        placeholder.replaceWith(row);
        excludedRows.delete(row);
      }
    }
    // GitHub's bulk selection includes CSS-hidden rows, so keep excluded rows off the live list.
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      if (!shouldExclude || !organizations.has(notificationOwner(row))) continue;
      const placeholder = document.createComment('Excluded organization notification');
      row.replaceWith(placeholder);
      excludedRows.set(row, placeholder);
    }
    updatePagination(shouldExclude);
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
    stopPagination();
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
