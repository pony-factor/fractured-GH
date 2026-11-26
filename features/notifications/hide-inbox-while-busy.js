(async () => {
  'use strict';

  const { hideInboxWhileBusy, inboxesPaused } = await chrome.storage.local.get({
    hideInboxWhileBusy: true,
    inboxesPaused: false,
  });

  const STYLE_ID = 'fractured-github-hide-inbox-style';
  const BUSY_ATTR = 'data-fractured-github-busy';
  const PAUSED_ATTR = 'data-fractured-github-inboxes-paused';
  const HIDDEN_ROOT = `html:is([${BUSY_ATTR}="true"], [${PAUSED_ATTR}])`;
  const BUSY_CACHE_KEY = 'fractured-github-busy';
  const LEGACY_BUSY_CACHE_KEY = 'github-viewer-busy';
  let currentBusy = null;
  let manuallyPaused = inboxesPaused === true;
  const CHECK_INTERVAL_MS = 60_000;
  const MAX_RETRY_MS = 5 * CHECK_INTERVAL_MS;
  const REQUEST_TIMEOUT_MS = 15_000;
  let requestPending = false;
  let retryDelay = CHECK_INTERVAL_MS;
  let nextCheckAt = 0;
  let lastWarning = null;
  const STATUS_URL = '/users/status?circle=0&compact=1&link_mentions=1&truncate=0';
  const BUSY_CONTROL_SELECTOR = [
    'input[name="limited_availability"]',
    'input.js-user-status-limited-availability-checkbox',
  ].join(',');
  const CSS = `
    ${HIDDEN_ROOT} [data-fractured-github-organization-notification],
    ${HIDDEN_ROOT} #AppHeader-notifications-button,
    ${HIDDEN_ROOT} .AppHeader a[href="/notifications"],
    ${HIDDEN_ROOT} .AppHeader a[href^="/notifications?"],
    ${HIDDEN_ROOT} .GlobalNav a[href="/notifications"],
    ${HIDDEN_ROOT} .GlobalNav a[href^="/notifications?"],
    ${HIDDEN_ROOT} .AppHeader a[aria-label*="notification" i],
    ${HIDDEN_ROOT} .AppHeader button[aria-label*="notification" i],
    ${HIDDEN_ROOT} header[role="banner"] a[href="/notifications"],
    ${HIDDEN_ROOT} header[role="banner"] a[href^="/notifications?"],
    ${HIDDEN_ROOT} header[role="banner"] a[aria-label*="notification" i],
    ${HIDDEN_ROOT} header[role="banner"] button[aria-label*="notification" i],
    ${HIDDEN_ROOT} header[role="banner"] a:has(.octicon-inbox),
    ${HIDDEN_ROOT} header[role="banner"] button:has(.octicon-inbox),
    ${HIDDEN_ROOT} header[role="banner"] a:has(.octicon-bell),
    ${HIDDEN_ROOT} header[role="banner"] button:has(.octicon-bell) {
      display: none !important;
    }
  `;

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return true;

    const root = document.head || document.documentElement;
    if (!root) return false;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    root.append(style);
    return true;
  }

  function setBusy(isBusy) {
    if (!document.documentElement) return;

    if (isBusy) {
      if (document.documentElement.getAttribute(BUSY_ATTR) !== 'true') {
        document.documentElement.setAttribute(BUSY_ATTR, 'true');
      }
    } else {
      document.documentElement.removeAttribute(BUSY_ATTR);
    }
  }

  function applyVisibility() {
    document.documentElement?.toggleAttribute(PAUSED_ATTR, manuallyPaused);
    if (currentBusy !== null) setBusy(currentBusy);
  }

  function readCachedBusyStatus() {
    try {
      const value = window.localStorage.getItem(BUSY_CACHE_KEY)
        ?? window.localStorage.getItem(LEGACY_BUSY_CACHE_KEY);
      if (value === 'true') return true;
      if (value === 'false') return false;
    } catch (error) {
      console.warn('[Fractured GitHub]', error.message);
    }

    return null;
  }

  function cacheBusyStatus(isBusy) {
    try {
      window.localStorage.setItem(BUSY_CACHE_KEY, String(isBusy));
    } catch (error) {
      console.warn('[Fractured GitHub]', error.message);
    }
  }

  function applyBusyStatus(isBusy) {
    currentBusy = isBusy;
    cacheBusyStatus(isBusy);
    setBusy(isBusy);
  }

  function parseBusyStatus(statusDocument) {
    const busyControl = statusDocument.querySelector(BUSY_CONTROL_SELECTOR);
    if (busyControl) {
      return (
        busyControl.checked ||
        busyControl.hasAttribute('checked') ||
        busyControl.getAttribute('aria-checked') === 'true'
      );
    }

    const legacyStatus = statusDocument.querySelector('.js-user-status-container');
    if (legacyStatus) {
      return legacyStatus.classList.contains('user-status-busy');
    }

    throw new Error('GitHub status response did not contain a Busy status control');
  }

  async function fetchBusyStatus(signal) {
    const statusUrl = new URL(STATUS_URL, window.location.origin);
    statusUrl.searchParams.set('_', String(Date.now()));

    const response = await window.fetch(statusUrl, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'text/html',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub status request returned ${response.status}`);
    }

    const markup = await response.text();
    const statusDocument = new DOMParser().parseFromString(markup, 'text/html');
    return parseBusyStatus(statusDocument);
  }

  async function checkBusyStatus() {
    if (requestPending || navigator.onLine === false || document.hidden ||
        Date.now() < nextCheckAt) return;

    requestPending = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      applyBusyStatus(await fetchBusyStatus(controller.signal));
      retryDelay = CHECK_INTERVAL_MS;
      nextCheckAt = 0;
      lastWarning = null;
    } catch (error) {
      // Fetch rejects during offline periods, navigation, and request timeouts.
      // Keep the cached presentation and retry without filling extension Errors.
      nextCheckAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      if (error.name !== 'TypeError' && error.name !== 'AbortError' &&
          error.message !== lastWarning) {
        console.warn('[Fractured GitHub]', error.message);
        lastWarning = error.message;
      }
    } finally {
      window.clearTimeout(timeout);
      requestPending = false;
    }
  }

  function scheduleStatusRefresh() {
    window.setTimeout(() => void checkBusyStatus(), 500);
    window.setTimeout(() => void checkBusyStatus(), 1_500);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.inboxesPaused) return;
    manuallyPaused = changes.inboxesPaused.newValue === true;
    applyVisibility();
  });

  if (hideInboxWhileBusy) {
    currentBusy = readCachedBusyStatus();
    if (currentBusy !== null) cacheBusyStatus(currentBusy);
  }

  // GitHub can reset root attributes or replace the head during navigation.
  const presentationObserver = new MutationObserver(() => {
    installStyle();
    applyVisibility();
  });
  presentationObserver.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [BUSY_ATTR, PAUSED_ATTR],
  });
  installStyle();
  applyVisibility();

  if (!hideInboxWhileBusy) return;

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement && form.matches('.js-user-status-form')) {
      scheduleStatusRefresh();
    }
  }, true);

  document.addEventListener('turbo:load', () => void checkBusyStatus());
  document.addEventListener('pjax:end', () => void checkBusyStatus());
  window.addEventListener('focus', () => void checkBusyStatus());
  window.addEventListener('online', () => {
    nextCheckAt = 0;
    void checkBusyStatus();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void checkBusyStatus();
  });

  void checkBusyStatus();
  window.setInterval(checkBusyStatus, CHECK_INTERVAL_MS);
})();
