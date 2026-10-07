(async () => {
  'use strict';

  const { hidePullRequestProtip = false } = await chrome.storage.local.get({
    hidePullRequestProtip: false,
  });
  if (!hidePullRequestProtip) return;

  const PROTIP_PATTERN = /^ProTip!\s+Add comments to specific lines under Files changed\.?$/;
  const FILES_CHANGED_PATTERN = /^Files changed\.?$/;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function matchesProtip(element) {
    if (!PROTIP_PATTERN.test(normalizeText(element.textContent))) return false;

    return [...element.querySelectorAll('a')].some((link) => (
      FILES_CHANGED_PATTERN.test(normalizeText(link.textContent))
    ));
  }

  function hideMatchingProtips(root = document) {
    const candidates = [];

    if (root instanceof Element && (root.matches('p') || root.matches('div'))) {
      candidates.push(root);
    }

    if (typeof root.querySelectorAll === 'function') {
      candidates.push(...root.querySelectorAll('p, div'));
    }

    for (const candidate of candidates) {
      if (candidate.hidden || !matchesProtip(candidate)) continue;

      const matchingChild = [...candidate.children].some((child) => (
        (child.matches('p') || child.matches('div')) && matchesProtip(child)
      ));
      if (matchingChild) continue;

      candidate.hidden = true;
    }
  }

  hideMatchingProtips();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) hideMatchingProtips(node);
      }
    }
  });

  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
  });

  document.addEventListener('turbo:load', () => hideMatchingProtips());
  document.addEventListener('pjax:end', () => hideMatchingProtips());
})();
