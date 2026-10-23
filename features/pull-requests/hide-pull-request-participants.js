(() => {
  'use strict';

  const SETTING_KEY = 'hidePullRequestParticipants';
  const STYLE_ID = 'fractured-hide-pull-request-participants-style';
  const ROOT_ATTRIBUTE = 'data-fractured-hide-pull-request-participants';
  const LEGACY_ATTRIBUTE = 'data-fractured-pull-request-participants-section';

  let enabled = false;
  let observer = null;
  let refreshQueued = false;

  function isPullRequestRoute() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(location.pathname);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const parent = document.head || document.documentElement;
    if (!parent) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html[${ROOT_ATTRIBUTE}="true"] [data-testid="sidebar-participants-section"],
      html[${ROOT_ATTRIBUTE}="true"] [${LEGACY_ATTRIBUTE}="true"] {
        display: none !important;
      }
    `;
    parent.append(style);
  }

  function clearLegacyMarkers() {
    for (const section of document.querySelectorAll(`[${LEGACY_ATTRIBUTE}]`)) {
      section.removeAttribute(LEGACY_ATTRIBUTE);
    }
  }

  function markLegacyParticipants() {
    for (const section of document.querySelectorAll(
      '#partial-discussion-sidebar .discussion-sidebar-item, .discussion-sidebar .discussion-sidebar-item',
    )) {
      const heading = section.querySelector('.discussion-sidebar-heading, h3, h4');
      const label = normalizeText(heading?.textContent);
      const isParticipants = /^(?:participants?|\d+ participants?)$/.test(label);

      if (isParticipants && !section.hasAttribute(LEGACY_ATTRIBUTE)) {
        section.setAttribute(LEGACY_ATTRIBUTE, 'true');
      } else if (!isParticipants && section.hasAttribute(LEGACY_ATTRIBUTE)) {
        section.removeAttribute(LEGACY_ATTRIBUTE);
      }
    }
  }

  function refresh() {
    refreshQueued = false;
    if (!enabled) return;

    ensureStyle();
    const root = document.documentElement;
    if (!root) return;

    if (!isPullRequestRoute()) {
      root.removeAttribute(ROOT_ATTRIBUTE);
      clearLegacyMarkers();
      return;
    }

    root.setAttribute(ROOT_ATTRIBUTE, 'true');
    markLegacyParticipants();
  }

  function queueRefresh() {
    if (!enabled || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(refresh);
  }

  function enableHiding() {
    if (enabled) return;
    enabled = true;
    refresh();

    observer = new MutationObserver(queueRefresh);
    observer.observe(document, { childList: true, subtree: true });

    document.addEventListener('turbo:load', queueRefresh);
    document.addEventListener('pjax:end', queueRefresh);
    window.addEventListener('popstate', queueRefresh);
  }

  function disableHiding() {
    if (!enabled) return;
    enabled = false;
    refreshQueued = false;

    observer?.disconnect();
    observer = null;
    document.removeEventListener('turbo:load', queueRefresh);
    document.removeEventListener('pjax:end', queueRefresh);
    window.removeEventListener('popstate', queueRefresh);
    document.documentElement?.removeAttribute(ROOT_ATTRIBUTE);
    clearLegacyMarkers();
    document.getElementById(STYLE_ID)?.remove();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTING_KEY]) return;
    if (changes[SETTING_KEY].newValue) enableHiding();
    else disableHiding();
  });

  void chrome.storage.local.get({ [SETTING_KEY]: false }).then(settings => {
    if (settings[SETTING_KEY]) enableHiding();
  });
})();
