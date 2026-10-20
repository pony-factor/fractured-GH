(async () => {
  'use strict';

  const { hideContributingGuidelinesNotice = true } = await chrome.storage.local.get({
    hideContributingGuidelinesNotice: true,
  });
  if (!hideContributingGuidelinesNotice) return;

  const NOTICE_TEXT = 'Remember, contributions to this repository should follow its contributing guidelines.';
  const LINK_SELECTOR = 'a[href*="/CONTRIBUTING.md"]';

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function hideMatchingNotices(root = document) {
    const paragraphs = [];

    if (root instanceof Element && root.matches('p')) {
      paragraphs.push(root);
    }

    if (typeof root.querySelectorAll === 'function') {
      paragraphs.push(...root.querySelectorAll('p'));
    }

    for (const paragraph of paragraphs) {
      if (paragraph.hidden) continue;
      if (normalizeText(paragraph.textContent) !== NOTICE_TEXT) continue;
      if (!paragraph.querySelector(LINK_SELECTOR)) continue;
      paragraph.hidden = true;
    }
  }

  hideMatchingNotices();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) hideMatchingNotices(node);
      }
    }
  });

  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
  });

  document.addEventListener('turbo:load', () => hideMatchingNotices());
  document.addEventListener('pjax:end', () => hideMatchingNotices());
})();
