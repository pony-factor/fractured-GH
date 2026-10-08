(async () => {
  'use strict';

  const MERGE_HINT = 'Successfully merging this pull request may close these issues.';
  const EMPTY_TEXT = 'None yet';
  const MARKER = 'data-fractured-empty-development-copy';
  const TEXT_ELEMENT_SELECTOR = 'p, span, div, li, h1, h2, h3, h4, h5, h6, button, summary';
  const SIDEBAR_SELECTOR = '#partial-discussion-sidebar, .discussion-sidebar, [data-testid="issue-viewer-sidebar"], [data-testid="pr-sidebar"]';
  const SIDEBAR_COPY_MARKER = 'data-fractured-empty-sidebar-copy';
  const EMPTY_SIDEBAR_TEXT = new Set([
    'None yet', 'No reviews', 'No reviewers', 'Still in progress?', 'No one', 'No one—', 'No one —',
  ]);

  function tidySidebarCopy() {
    if (!/^\/[^/]+\/[^/]+\/(?:pull|issues)\/\d+(?:\/|$)/.test(location.pathname)) return;

    for (const sidebar of document.querySelectorAll(SIDEBAR_SELECTOR)) {
      for (const copy of sidebar.querySelectorAll(`[${SIDEBAR_COPY_MARKER}]`)) {
        if (!EMPTY_SIDEBAR_TEXT.has(normalizeText(copy.textContent))) {
          copy.replaceWith(...copy.childNodes);
        }
      }
      const walker = document.createTreeWalker(sidebar, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);

      for (const node of nodes) {
        const parent = node.parentElement;
        if (!parent || parent.closest(`[${SIDEBAR_COPY_MARKER}], script, style, textarea, input, [contenteditable="true"]`)) continue;
        const text = normalizeText(node.textContent);
        if (text === 'assign yourself' && parent.closest('a, button')) {
          node.textContent = node.textContent.replace('assign yourself', 'Assign yourself');
          continue;
        }
        if (parent.closest('a, button, summary')) continue;
        if (!EMPTY_SIDEBAR_TEXT.has(text)) continue;

        const hiddenCopy = document.createElement('span');
        hiddenCopy.setAttribute(SIDEBAR_COPY_MARKER, '');
        hiddenCopy.hidden = true;
        node.replaceWith(hiddenCopy);
        hiddenCopy.append(node);
      }
    }
  }

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
      tidySidebarCopy();
    });
  }

  function start() {
    scheduleUpdate();

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
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
