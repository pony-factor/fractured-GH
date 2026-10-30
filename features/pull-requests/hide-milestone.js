(() => {
  'use strict';

  const SETTING_KEY = 'hidePullRequestMilestone';
  const STYLE_ID = 'fractured-hide-pull-request-milestone-style';
  const ROOT_ATTRIBUTE = 'data-fractured-hide-pull-request-milestone';
  const LEGACY_ATTRIBUTE = 'data-fractured-pull-request-milestone-section';

  let enabled = false;
  let observer = null;
  let refreshQueued = false;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isPullRequestRoute() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(window.location.pathname);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const parent = document.head || document.documentElement;
    if (!parent) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html[${ROOT_ATTRIBUTE}="true"] [data-testid="sidebar-milestones-section"],
      html[${ROOT_ATTRIBUTE}="true"] [${LEGACY_ATTRIBUTE}="true"] {
        display: none !important;
      }
    `;
    parent.append(style);
  }

  function clearLegacyMarkers() {
    for (const element of document.querySelectorAll(`[${LEGACY_ATTRIBUTE}]`)) {
      element.removeAttribute(LEGACY_ATTRIBUTE);
    }
  }

  function markLegacyMilestoneSections() {
    const sections = document.querySelectorAll(
      '#partial-discussion-sidebar .discussion-sidebar-item',
    );

    for (const section of sections) {
      const selectableMilestone = section.querySelector('[aria-label="Select milestones"]');
      const heading = section.querySelector('.discussion-sidebar-heading');
      const headingText = normalizeText(heading?.textContent).toLowerCase();

      if (selectableMilestone || headingText === 'milestone' || headingText === 'milestones') {
        section.setAttribute(LEGACY_ATTRIBUTE, 'true');
      }
    }
  }

  function refresh() {
    refreshQueued = false;
    ensureStyle();

    const root = document.documentElement;
    if (!root) return;

    if (!enabled || !isPullRequestRoute()) {
      root.removeAttribute(ROOT_ATTRIBUTE);
      clearLegacyMarkers();
      return;
    }

    root.setAttribute(ROOT_ATTRIBUTE, 'true');
    markLegacyMilestoneSections();
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
    observer.observe(document, {
      childList: true,
      subtree: true,
    });

    document.addEventListener('turbo:load', queueRefresh);
    document.addEventListener('pjax:end', queueRefresh);
  }

  function disableHiding() {
    if (!enabled) return;
    enabled = false;
    refreshQueued = false;

    observer?.disconnect();
    observer = null;
    document.removeEventListener('turbo:load', queueRefresh);
    document.removeEventListener('pjax:end', queueRefresh);
    document.documentElement?.removeAttribute(ROOT_ATTRIBUTE);
    clearLegacyMarkers();
    document.getElementById(STYLE_ID)?.remove();
  }

  async function loadSetting() {
    const settings = await chrome.storage.local.get({ [SETTING_KEY]: false });
    if (settings[SETTING_KEY]) enableHiding();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTING_KEY]) return;
    if (changes[SETTING_KEY].newValue) enableHiding();
    else disableHiding();
  });

  void loadSetting();
})();
