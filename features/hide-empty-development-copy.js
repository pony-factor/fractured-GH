(async () => {
  'use strict';

  const MERGE_HINT = 'Successfully merging this pull request may close these issues.';
  const EMPTY_TEXT = 'None yet';
  const MARKER = 'data-fractured-empty-development-copy';
  const TEXT_ELEMENT_SELECTOR = 'p, span, div, li, h1, h2, h3, h4, h5, h6, button, summary';

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isPullRequestRoute() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(location.pathname);
  }

  function exactTextElements(root, text) {
    const matches = [];

    if (root instanceof Element && normalizeText(root.textContent) === text) {
      matches.push(root);
    }

    if (typeof root.querySelectorAll === 'function') {
      for (const element of root.querySelectorAll(TEXT_ELEMENT_SELECTOR)) {
        if (normalizeText(element.textContent) === text) matches.push(element);
      }
    }

    return matches.filter((element) => {
      return ![...element.children].some((child) => normalizeText(child.textContent) === text);
    });
  }

  function hasDevelopmentLabel(root) {
    return exactTextElements(root, 'Development').length > 0;
  }

  function findDevelopmentSection(hint) {
    let current = hint.parentElement;

    while (current && current !== document.body) {
      if (hasDevelopmentLabel(current)) {
        return exactTextElements(current, EMPTY_TEXT).length > 0 ? current : null;
      }
      current = current.parentElement;
    }

    return null;
  }

  function restoreHiddenCopy() {
    for (const element of document.querySelectorAll(`[${MARKER}]`)) {
      element.hidden = false;
      element.removeAttribute(MARKER);
    }
  }

  function updateEmptyDevelopmentCopy() {
    restoreHiddenCopy();
    if (!isPullRequestRoute()) return;

    for (const hint of exactTextElements(document, MERGE_HINT)) {
      const section = findDevelopmentSection(hint);
      if (!section) continue;

      const emptyStates = exactTextElements(section, EMPTY_TEXT);
      if (emptyStates.length === 0) continue;

      hint.hidden = true;
      hint.setAttribute(MARKER, '');

      for (const emptyState of emptyStates) {
        emptyState.hidden = true;
        emptyState.setAttribute(MARKER, '');
      }
    }
  }

  let scheduled = false;

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;

    queueMicrotask(() => {
      scheduled = false;
      updateEmptyDevelopmentCopy();
    });
  }

  function start() {
    scheduleUpdate();

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    document.addEventListener('turbo:load', scheduleUpdate);
    document.addEventListener('pjax:end', scheduleUpdate);
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
