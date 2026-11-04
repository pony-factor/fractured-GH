(() => {
  'use strict';

  const REFRESH_INTERVAL_MS = 60_000;
  const DOM_REFRESH_DELAY_MS = 100;
  const CONTROL_ATTRIBUTE = 'data-github-tweaks-organization-notification';
  const DEFAULT_CONTROL_SELECTORS = [
    '#AppHeader-notifications-button',
    '.AppHeader a[href="/notifications"]',
    '.AppHeader a[href^="/notifications?"]',
    'header[role="banner"] a[href="/notifications"]',
    'header[role="banner"] a[href^="/notifications?"]',
  ];

  let enabled = false;
  let organizations = [];
  let unreadOrganizations = new Set();
  let refreshGeneration = 0;
  let domRefreshTimer = null;

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

  function createOrganizationControl(defaultControl, organization) {
    const control = document.createElement('a');
    copySafeControlAttributes(defaultControl, control);
    control.setAttribute(CONTROL_ATTRIBUTE, organization);
    control.href = notificationUrl(organization).toString();
    control.setAttribute('aria-label', `${organization} notifications`);
    control.title = `${organization} notifications`;
    control.style.alignItems = 'center';
    control.style.justifyContent = 'center';
    control.style.overflow = 'hidden';

    const avatar = document.createElement('img');
    avatar.alt = '';
    avatar.height = 20;
    avatar.width = 20;
    avatar.src = `https://github.com/${encodeURIComponent(organization)}.png?size=40`;
    avatar.style.borderRadius = '4px';
    avatar.style.display = 'block';
    avatar.style.objectFit = 'cover';

    control.replaceChildren(avatar);
    return control;
  }

  function renderOrganizationControls() {
    removeOrganizationControls();

    if (!enabled || unreadOrganizations.size === 0) return;

    const defaultControl = findDefaultNotificationControl();
    if (!defaultControl?.parentNode) return;

    for (const organization of organizations) {
      if (!unreadOrganizations.has(organization.toLowerCase())) continue;
      defaultControl.parentNode.insertBefore(
        createOrganizationControl(defaultControl, organization),
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
    const response = await window.fetch(
      notificationUrl(organization, { unreadOnly: true }),
      {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'text/html',
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Notification request for ${organization} returned ${response.status}`,
      );
    }

    return responseHasNotifications(await response.text());
  }

  async function refreshOrganizationNotifications() {
    const generation = ++refreshGeneration;

    if (!enabled || organizations.length === 0) {
      unreadOrganizations = new Set();
      renderOrganizationControls();
      return;
    }

    const results = await Promise.all(organizations.map(async (organization) => {
      try {
        return [organization, await hasUnreadNotifications(organization)];
      } catch (error) {
        console.warn('[GitHub Tweaks]', error.message);
        return [organization, false];
      }
    }));

    if (generation !== refreshGeneration) return;

    unreadOrganizations = new Set(
      results
        .filter(([, hasUnread]) => hasUnread)
        .map(([organization]) => organization.toLowerCase()),
    );
    renderOrganizationControls();
  }

  async function loadSettings() {
    const settings = await chrome.storage.local.get({
      organizationNotificationInboxesEnabled: false,
      notificationOrganizations: [],
    });

    enabled = Boolean(settings.organizationNotificationInboxesEnabled);
    organizations = normalizeOrganizations(settings.notificationOrganizations);
    void refreshOrganizationNotifications();
  }

  function scheduleDomRefresh() {
    window.clearTimeout(domRefreshTimer);
    domRefreshTimer = window.setTimeout(renderOrganizationControls, DOM_REFRESH_DELAY_MS);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (
      !changes.organizationNotificationInboxesEnabled
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

  const observer = new MutationObserver(() => {
    if (!enabled || unreadOrganizations.size === 0) return;
    if (document.querySelector(`[${CONTROL_ATTRIBUTE}]`)) return;
    scheduleDomRefresh();
  });

  function observeDocument() {
    if (!document.documentElement) {
      window.setTimeout(observeDocument, DOM_REFRESH_DELAY_MS);
      return;
    }

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  observeDocument();
  void loadSettings();
  window.setInterval(() => void refreshOrganizationNotifications(), REFRESH_INTERVAL_MS);
})();
