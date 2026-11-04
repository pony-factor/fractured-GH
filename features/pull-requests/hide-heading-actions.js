(() => {
  'use strict';

  const ATTRIBUTE = 'data-fractured-hidden-pr-heading-action';
  const SETTINGS = {
    'merge-status': 'hidePullRequestMergeStatus',
    code: 'hidePullRequestCodeButton',
  };
  let preferences = {};
  let queued = false;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isPullRequestPage() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(window.location.pathname);
  }

  function findPullRequestTitle() {
    return document.querySelector(
      'h1.gh-header-title, #partial-discussion-header h1, '
      + '[data-testid="pull-request-title"], [data-testid="pull-request-header"] h1, main h1',
    );
  }

  function actionName(control) {
    const labels = [
      control.textContent,
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
    ].map(normalizeText);
    if (labels.includes('merge status')) return 'merge-status';
    if (labels.includes('code')) return 'code';
    return null;
  }

  function isHeadingAction(control, title) {
    // Repository navigation also contains a “Code” link. Never hide that tab.
    if (control.closest('nav, [role="navigation"], #repository-container-header, .UnderlineNav')) {
      return false;
    }
    // Both controls sit above the PR title, not in the discussion or file views.
    return Boolean(control.compareDocumentPosition(title) & 4);
  }

  function refresh() {
    queued = false;
    for (const marked of document.querySelectorAll('[' + ATTRIBUTE + ']')) {
      marked.removeAttribute(ATTRIBUTE);
    }

    if (!isPullRequestPage()
      || (!preferences.hidePullRequestMergeStatus && !preferences.hidePullRequestCodeButton)) return;

    const title = findPullRequestTitle();
    if (!title) return;

    for (const control of document.querySelectorAll('button, summary, [role="button"]')) {
      const action = actionName(control);
      if (!action || !preferences[SETTINGS[action]] || !isHeadingAction(control, title)) continue;

      // Hide the dropdown shell as well as its summary to avoid a blank menu.
      const target = control.matches('summary') ? control.closest('details') || control : control;
      target.setAttribute(ATTRIBUTE, action);
    }
  }

  function scheduleRefresh() {
    if (queued) return;
    queued = true;
    queueMicrotask(refresh);
  }

  const style = document.createElement('style');
  style.textContent = '[' + ATTRIBUTE + '] { display: none !important; }';
  (document.head || document.documentElement).append(style);

  new MutationObserver(scheduleRefresh).observe(document, { childList: true, subtree: true });
  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !Object.values(SETTINGS).some(key => key in changes)) return;
    for (const key of Object.values(SETTINGS)) {
      if (key in changes) preferences[key] = Boolean(changes[key].newValue);
    }
    scheduleRefresh();
  });

  void chrome.storage.local.get({
    hidePullRequestMergeStatus: false,
    hidePullRequestCodeButton: false,
  }).then(settings => {
    preferences = settings;
    scheduleRefresh();
  });
})();
