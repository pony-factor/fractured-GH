(() => {
  'use strict';

  const REFRESH_INTERVAL_MS = 60_000;
  const DOM_REFRESH_DELAY_MS = 100;
  const REQUEST_TIMEOUT_MS = 15_000;
  const MAX_RETRY_MS = 5 * REFRESH_INTERVAL_MS;
  const CONTROL_ATTRIBUTE = 'data-fractured-github-organization-notification';
  const UNREAD_ATTRIBUTE = 'data-fractured-github-organization-unread';
  const DOT_ATTRIBUTE = 'data-fractured-github-organization-dot';
  const DOT_STYLE_ID = 'fractured-notification-dot-color';
  const HEADER_SELECTOR = ':is(.AppHeader, .GlobalNav, header[role="banner"], header[aria-label="Global navigation menu"])';
  const DEFAULT_CONTROL_SELECTORS = [
    '#AppHeader-notifications-button',
    `${HEADER_SELECTOR} a:is([aria-label*="unread notifications" i], [data-hotkey="g n"], :has(svg.octicon-inbox))`,
    '.AppHeader a[href="/notifications"]',
    '.AppHeader a[href^="/notifications?"]',
    '.GlobalNav a[href="/notifications"]',
    'header[role="banner"] a[href="/notifications"]',
    'header[role="banner"] a[href^="/notifications?"]',
  ];

  let enabled = false;
  let showUnreadOnly = false;
  let organizations = [];
  let unreadOrganizations = new Set();
  let refreshGeneration = 0;
  let domRefreshTimer = null;
  let activeRefresh = null;
  let retryDelay = REFRESH_INTERVAL_MS;
  let nextCheckAt = 0;
  let dotColor = '';

  function applyDotColor() {
    const current = document.getElementById(DOT_STYLE_ID);
    if (!dotColor) {
      current?.remove();
      return;
    }
    if (!document.documentElement) return;
    const style = current || document.createElement('style');
    style.id = DOT_STYLE_ID;
    style.textContent = `
      a[href="/notifications"][class*="notificationIndicator__"]::before,
      .notification-indicator .mail-status.unread,
      [${DOT_ATTRIBUTE}] { background-color: ${dotColor} !important; }
    `;
    if (!current) document.documentElement.append(style);
  }

  function setDotColor(color) {
    dotColor = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : '';
    applyDotColor();
  }

  function normalizeOrganization(value) {
    return String(value || '')
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/^@+/, '')
      .replace(/\/+$/, '')
      .replace(/\s+/g, '');
  }

  function normalizeOrganizations(values) {
    if (!Array.isArray(values)) return [];

    const normalized = [];
    const seen = new Set();

    for (const value of values) {
      const organization = normalizeOrganization(value);
      const key = organization.toLowerCase();
      if (!organization || seen.has(key)) continue;
      seen.add(key);
      normalized.push(organization);
    }

    return normalized;
  }

  function notificationUrl(organization, { unreadOnly = false } = {}) {
    const url = new URL('/notifications', window.location.origin);
    const query = [`org:${organization}`];
    if (unreadOnly) query.push('is:unread');
    url.searchParams.set('query', query.join(' '));
    return url;
  }

  function findDefaultNotificationControl() {
    for (const selector of DEFAULT_CONTROL_SELECTORS) {
      const control = document.querySelector(selector);
      if (control instanceof HTMLAnchorElement) return control;
    }
    return null;
  }

  function removeOrganizationControls() {
    for (const control of document.querySelectorAll(`[${CONTROL_ATTRIBUTE}]`)) {
      control.remove();
    }
  }

  function copySafeControlAttributes(source, target) {
    target.className = source.className;

    for (const attribute of ['role', 'tabindex']) {
      if (source.hasAttribute(attribute)) {
        target.setAttribute(attribute, source.getAttribute(attribute));
      }
    }
  }

  function createOrganizationControl(defaultControl, organization, unread) {
    const control = document.createElement('a');
    copySafeControlAttributes(defaultControl, control);
    control.setAttribute(CONTROL_ATTRIBUTE, organization);
    control.href = notificationUrl(organization).toString();
    const label = `${organization} notifications${unread ? ' (unread)' : ''}`;
    control.setAttribute('aria-label', label);
    control.title = label;
    control.style.alignItems = 'center';
    control.style.justifyContent = 'center';
    control.style.position = 'relative';

    const avatar = document.createElement('img');
    avatar.alt = '';
    avatar.height = 20;
    avatar.width = 20;
    avatar.src = `https://github.com/${encodeURIComponent(organization)}.png?size=40`;
    avatar.style.borderRadius = '4px';
    avatar.style.display = 'block';
    avatar.style.objectFit = 'cover';

    control.replaceChildren(avatar);
    if (unread) {
      control.setAttribute(UNREAD_ATTRIBUTE, '');
      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.setAttribute(DOT_ATTRIBUTE, '');
      dot.style.cssText = 'position:absolute;top:2px;right:2px;width:8px;height:8px;'
        + 'border-radius:50%;background:var(--fgColor-accent,#0969da);'
        + 'box-shadow:0 0 0 1px var(--bgColor-default,#fff);pointer-events:none';
      control.append(dot);
    }
    return control;
  }

  function renderOrganizationControls() {
    const defaultControl = enabled && organizations.length ? findDefaultNotificationControl() : null;
    if (!defaultControl?.parentNode) {
      removeOrganizationControls();
      return;
    }

    const visibleOrganizations = showUnreadOnly
      ? organizations.filter((organization) => unreadOrganizations.has(organization.toLowerCase()))
      : organizations;
    const controls = [...document.querySelectorAll(`[${CONTROL_ATTRIBUTE}]`)];
    if (controls.length === visibleOrganizations.length && controls.every((control, index) => (
      control.parentNode === defaultControl.parentNode
      && control.getAttribute(CONTROL_ATTRIBUTE) === visibleOrganizations[index]
      && control.hasAttribute(UNREAD_ATTRIBUTE) === unreadOrganizations.has(visibleOrganizations[index].toLowerCase())
    ))) return;

    removeOrganizationControls();
    for (const organization of visibleOrganizations) {
      defaultControl.parentNode.insertBefore(
        createOrganizationControl(defaultControl, organization, unreadOrganizations.has(organization.toLowerCase())),
        defaultControl,
      );
    }
  }

  function responseHasNotifications(markup) {
    const notificationDocument = new DOMParser().parseFromString(markup, 'text/html');
    return Boolean(notificationDocument.querySelector([
      '.notifications-list-item',
      '[data-notification-id]',
      'input[name="notification_ids[]"]',
    ].join(',')));
  }

  async function hasUnreadNotifications(organization) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await window.fetch(
        notificationUrl(organization, { unreadOnly: true }),
        {
          signal: controller.signal,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'text/html',
            'X-Requested-With': 'XMLHttpRequest',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Notification request returned ${response.status}`);
      }

      return responseHasNotifications(await response.text());
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function refreshOrganizationNotifications() {
    if (activeRefresh?.generation === refreshGeneration) return;
    const generation = ++refreshGeneration;

    if (!enabled || organizations.length === 0) {
      unreadOrganizations = new Set();
      renderOrganizationControls();
      return;
    }

    // Repeated focus/navigation events must not trigger requests while offline,
    // hidden, or within the backoff window after a failed request.
    if (document.hidden === true ||
        (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        Date.now() < nextCheckAt) return;

    const refresh = { generation };
    activeRefresh = refresh;
    try {
      const results = await Promise.all(organizations.map(async (organization) => {
        try {
          return [organization, await hasUnreadNotifications(organization), false];
        } catch {
          // Network and transient HTTP failures do not mean that the inbox is empty.
          return [organization, unreadOrganizations.has(organization.toLowerCase()), true];
        }
      }));

      if (generation !== refreshGeneration) return;

      if (results.some(([, , failed]) => failed)) {
        nextCheckAt = Date.now() + retryDelay;
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      } else {
        nextCheckAt = 0;
        retryDelay = REFRESH_INTERVAL_MS;
      }

      unreadOrganizations = new Set(
        results
          .filter(([, hasUnread]) => hasUnread)
          .map(([organization]) => organization.toLowerCase()),
      );
      renderOrganizationControls();
    } finally {
      if (activeRefresh === refresh) activeRefresh = null;
    }
  }

  async function loadSettings() {
    const settings = await chrome.storage.local.get({
      organizationNotificationInboxesEnabled: false,
      organizationInboxesUnreadOnly: false,
      notificationOrganizations: [],
    });

    // Invalidate requests made with the previous settings.
    ++refreshGeneration;
    nextCheckAt = 0;
    retryDelay = REFRESH_INTERVAL_MS;
    enabled = Boolean(settings.organizationNotificationInboxesEnabled);
    showUnreadOnly = Boolean(settings.organizationInboxesUnreadOnly);
    organizations = normalizeOrganizations(settings.notificationOrganizations);
    renderOrganizationControls();
    void refreshOrganizationNotifications();
  }

  function scheduleDomRefresh() {
    window.clearTimeout(domRefreshTimer);
    domRefreshTimer = window.setTimeout(renderOrganizationControls, DOM_REFRESH_DELAY_MS);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.notificationDotColor) setDotColor(changes.notificationDotColor.newValue);
    if (
      !changes.organizationNotificationInboxesEnabled
      && !changes.organizationInboxesUnreadOnly
      && !changes.notificationOrganizations
    ) return;
    void loadSettings();
  });

  document.addEventListener('turbo:load', () => {
    scheduleDomRefresh();
    void refreshOrganizationNotifications();
  });
  document.addEventListener('pjax:end', () => {
    scheduleDomRefresh();
    void refreshOrganizationNotifications();
  });
  window.addEventListener('focus', () => void refreshOrganizationNotifications());
  window.addEventListener('online', () => {
    nextCheckAt = 0;
    void refreshOrganizationNotifications();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshOrganizationNotifications();
  });

  const observer = new MutationObserver(() => {
    if (!enabled || organizations.length === 0) return;
    scheduleDomRefresh();
  });

  function observeDocument() {
    if (!document.documentElement) {
      window.setTimeout(observeDocument, DOM_REFRESH_DELAY_MS);
      return;
    }

    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (dotColor) applyDotColor();
  }

  observeDocument();
  void chrome.storage.local.get({ notificationDotColor: '' })
    .then((settings) => setDotColor(settings.notificationDotColor));
  void loadSettings();
  window.setInterval(() => void refreshOrganizationNotifications(), REFRESH_INTERVAL_MS);
})();
