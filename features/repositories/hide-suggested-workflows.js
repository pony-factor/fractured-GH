(() => {
  'use strict';

  const SETTING_KEY = 'hideSuggestedWorkflows';
  const STYLE_ID = 'fractured-hide-suggested-workflows-style';
  const TARGET_ATTRIBUTE = 'data-fractured-hide-suggested-workflows';
  const HEADING_TEXT = 'Suggested workflows';
  const CONTEXT_TEXT = ['Based on your tech stack', 'More workflows'];

  let enabled = false;
  let observer = null;
  let refreshQueued = false;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isRepositoryHome() {
    return window.location.pathname.split('/').filter(Boolean).length === 2;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const parent = document.head || document.documentElement;
    if (!parent) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${TARGET_ATTRIBUTE}="true"] {
        display: none !important;
      }
    `;
    parent.append(style);
  }

  function restoreSuggestedWorkflows() {
    for (const element of document.querySelectorAll(`[${TARGET_ATTRIBUTE}]`)) {
      element.removeAttribute(TARGET_ATTRIBUTE);
    }
  }

  function findSuggestedWorkflowsContainer(heading) {
    let candidate = heading.parentElement;

    for (let depth = 0; candidate && depth < 8 && candidate !== document.body; depth += 1) {
      const text = normalizeText(candidate.textContent);
      if (CONTEXT_TEXT.every((fragment) => text.includes(fragment))) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    return null;
  }

  function hideSuggestedWorkflows(root = document) {
    if (!enabled) return;

    ensureStyle();

    if (!isRepositoryHome()) {
      restoreSuggestedWorkflows();
      return;
    }

    const headings = [];
    if (root instanceof Element && root.matches('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
      headings.push(root);
    }

    if (typeof root.querySelectorAll === 'function') {
      headings.push(...root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'));
    }

    for (const heading of headings) {
      if (normalizeText(heading.textContent) !== HEADING_TEXT) continue;

      const container = findSuggestedWorkflowsContainer(heading);
      if (container) container.setAttribute(TARGET_ATTRIBUTE, 'true');
    }
  }

  function refresh() {
    refreshQueued = false;
    hideSuggestedWorkflows();
  }

  function queueRefresh() {
    if (!enabled || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(refresh);
  }

  function enableHiding() {
    if (enabled) return;
    enabled = true;

    hideSuggestedWorkflows();

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
    document.getElementById(STYLE_ID)?.remove();
    restoreSuggestedWorkflows();
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
