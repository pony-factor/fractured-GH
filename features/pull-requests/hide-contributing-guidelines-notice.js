(async () => {
  'use strict';

  const { hideContributingGuidelinesNotice = true } = await chrome.storage.local.get({
    hideContributingGuidelinesNotice: true,
  });
  if (!hideContributingGuidelinesNotice) return;

  const NOTICES = [
    {
      text: 'Remember, contributions to this repository should follow its contributing guidelines.',
      matchesLink: (link) => /\/CONTRIBUTING\.md(?:[?#]|$)/i.test(link.getAttribute('href') || ''),
    },
    {
      text: 'Remember, contributions to this repository should follow our GitHub Community Guidelines.',
      matchesLink: (link) => normalizeText(link.textContent) === 'GitHub Community Guidelines'
        && /github-community-guidelines(?:[/?#]|$)/i.test(link.getAttribute('href') || ''),
    },
  ];
  const NOTICE_SELECTOR = 'p, div, span, small';

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isNotice(element) {
    const text = normalizeText(element.textContent);
    return NOTICES.some((notice) => (
      text === notice.text && [...element.querySelectorAll('a')].some(notice.matchesLink)
    ));
  }

  function hideMatchingNotices(root = document) {
    const candidates = [];

    if (root instanceof Element && root.matches(NOTICE_SELECTOR)) {
      candidates.push(root);
    }

    if (typeof root.querySelectorAll === 'function') {
      candidates.push(...root.querySelectorAll(NOTICE_SELECTOR));
    }

    // Handle both the legacy paragraph and the newer icon + text wrapper.
    // Hide the outermost notice-only container without removing adjacent form controls.
    for (const candidate of candidates.reverse()) {
      if (candidate.hidden || !isNotice(candidate)) continue;

      let notice = candidate;
      while (notice.parentElement?.matches(NOTICE_SELECTOR) && isNotice(notice.parentElement)) {
        notice = notice.parentElement;
      }
      notice.hidden = true;
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
