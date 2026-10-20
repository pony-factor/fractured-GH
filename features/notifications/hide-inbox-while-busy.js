(async () => {
  'use strict';

  const { hideInboxWhileBusy = true } = await chrome.storage.local.get({
    hideInboxWhileBusy: true,
  });
  if (!hideInboxWhileBusy) return;

  const STYLE_ID = 'github-extension-hide-inbox-style';
  const BUSY_ATTR = 'data-github-viewer-busy';
  const BUSY_CACHE_KEY = 'github-viewer-busy';
  let currentBusy = null;
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
    html[${BUSY_ATTR}="true"] #AppHeader-notifications-button,
    html[${BUSY_ATTR}="true"] .AppHeader a[href="/notifications"],
    html[${BUSY_ATTR}="true"] .AppHeader a[href^="/notifications?"],
    html[${BUSY_ATTR}="true"] .GlobalNav a[href="/notifications"],
    html[${BUSY_ATTR}="true"] .GlobalNav a[href^="/notifications?"],
    html[${BUSY_ATTR}="true"] .AppHeader a[aria-label*="notification" i],
    html[${BUSY_ATTR}="true"] .AppHeader button[aria-label*="notification" i],
    html[${BUSY_ATTR}="true"] header[role="banner"] a[href="/notifications"],
    html[${BUSY_ATTR}="true"] header[role="banner"] a[href^="/notifications?"],
    html[${BUSY_ATTR}="true"] header[role="banner"] a[aria-label*="notification" i],
    html[${BUSY_ATTR}="true"] header[role="banner"] button[aria-label*="notification" i],
    html[${BUSY_ATTR}="true"] header[role="banner"] a:has(.octicon-inbox),
    html[${BUSY_ATTR}="true"] header[role="banner"] button:has(.octicon-inbox),
    html[${BUSY_ATTR}="true"] header[role="banner"] a:has(.octicon-bell),
    html[${BUSY_ATTR}="true"] header[role="banner"] button:has(.octicon-bell) {
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

  function readCachedBusyStatus() {
    try {
      const value = window.localStorage.getItem(BUSY_CACHE_KEY);
      if (value === 'true') return true;
      if (value === 'false') return false;
    } catch (error) {
      console.warn('[GitHub Extension]', error.message);
    }

    return null;
  }

  function cacheBusyStatus(isBusy) {
    try {
      window.localStorage.setItem(BUSY_CACHE_KEY, String(isBusy));
    } catch (error) {
      console.warn('[GitHub Extension]', error.message);
    }
  }

  function applyBusyStatus(isBusy) {
    currentBusy = isBusy;
    cacheBusyStatus(isBusy);
    setBusy(isBusy);
  }

  function restoreCachedBusyStatus() {
    const cachedBusy = readCachedBusyStatus();
    if (cachedBusy === null) return;
    currentBusy = cachedBusy;

    if (document.documentElement) {
      setBusy(cachedBusy);
      return;
    }

    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      observer.disconnect();
      setBusy(cachedBusy);
    });

    observer.observe(document, { childList: true });
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
        console.warn('[GitHub Extension]', error.message);
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

  restoreCachedBusyStatus();

  // GitHub can reset root attributes or replace the head during navigation.
  // Keep the last known status applied without another network round trip.
  const presentationObserver = new MutationObserver(() => {
    installStyle();
    if (currentBusy !== null) setBusy(currentBusy);
  });
  presentationObserver.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [BUSY_ATTR],
  });
  installStyle();

  void checkBusyStatus();
  window.setInterval(checkBusyStatus, CHECK_INTERVAL_MS);
})();
