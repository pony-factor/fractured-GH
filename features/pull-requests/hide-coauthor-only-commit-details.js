(() => {
  'use strict';

  const SETTING_KEY = 'hideCoauthorOnlyCommitDetails';
  const MARKER = 'data-fractured-coauthor-only-details';
  const STYLE_ID = 'fractured-coauthor-only-details-style';

  let enabled = false;
  let observer = null;
  let queued = false;

  // Do not hide mixed messages, other Git trailers, or malformed attribution.
  function isCoauthorOnly(body) {
    const lines = String(body || '').replace(/\r\n?/g, '\n')
      .split('\n').map(line => line.trim()).filter(Boolean);
    return lines.length > 0 && lines.every(line =>
      /^Co-authored-by:\s*[^<>\r\n]+?\s+<[^<>\s]+@[^<>\s]+>$/i.test(line));
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
    style.textContent = `[${MARKER}] { display: none !important; }`;
    parent.append(style);
  }

  function clearMarkers() {
    for (const element of document.querySelectorAll(`[${MARKER}]`)) {
      element.removeAttribute(MARKER);
    }
  }

  function refresh() {
    queued = false;
    clearMarkers();
    if (!enabled || !isPullRequestRoute()) return;

    // GitHub's PR commit rows keep the full message in .commit-desc and
    // show it via the adjacent ellipsis-expander; do not touch other menus.
    for (const message of document.querySelectorAll('.commit-message')) {
      const description = message.querySelector('.commit-desc');
      const button = message.querySelector(
        'button.ellipsis-expander, .hidden-text-expander button, button[aria-label="Expand commit message"]',
      );
      if (!description || !button || !isCoauthorOnly(description.textContent)) continue;

      const expander = button.closest('.hidden-text-expander') || button;
      expander.setAttribute(MARKER, '');
      description.setAttribute(MARKER, '');
    }
  }

  function scheduleRefresh() {
    if (!enabled || queued) return;
    queued = true;
    queueMicrotask(refresh);
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    ensureStyle();
    refresh();
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    document.addEventListener('turbo:load', scheduleRefresh);
    document.addEventListener('pjax:end', scheduleRefresh);
    window.addEventListener('popstate', scheduleRefresh);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    queued = false;
    observer?.disconnect();
    observer = null;
    document.removeEventListener('turbo:load', scheduleRefresh);
    document.removeEventListener('pjax:end', scheduleRefresh);
    window.removeEventListener('popstate', scheduleRefresh);
    clearMarkers();
    document.getElementById(STYLE_ID)?.remove();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTING_KEY]) return;
    if (changes[SETTING_KEY].newValue) enable();
    else disable();
  });

  void chrome.storage.local.get({ [SETTING_KEY]: false }).then(settings => {
    if (settings[SETTING_KEY]) enable();
  });
})();
