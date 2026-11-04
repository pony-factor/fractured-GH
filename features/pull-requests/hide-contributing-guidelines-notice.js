(async () => {
  'use strict';

  const SETTING = 'hideContributingGuidelinesNotice';
  const NOTICE_SELECTOR = 'p, div, span, small';
  const CONTROL_SELECTOR = 'button, input, textarea, select, form, [role="button"]';
  const hiddenNotices = new Set();
  let enabled = false;
  let scheduled = false;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isNotice(element) {
    const text = normalizeText(element.textContent);
    const contributing = /\bcontributions to this repository should follow its contributing guidelines\.?$/i.test(text);
    const community = /\bcontributions to this repository should follow our GitHub Community Guidelines\.?$/i.test(text);
    if (!contributing && !community) return false;

    return [...element.querySelectorAll('a')].some((link) => {
      const href = link.getAttribute('href') || '';
      const label = normalizeText(link.textContent);
      return contributing
        ? /(?:^|\/)CONTRIBUTING\.md(?:[?#]|$)/i.test(href) && /contributing guidelines/i.test(label)
        : /github-community-guidelines(?:[/?#]|$)/i.test(href)
          && /GitHub Community Guidelines/i.test(label);
    });
  }

  function hasControls(element) {
    return element.querySelectorAll(CONTROL_SELECTOR).length > 0;
  }

  function hideMatchingNotices(root = document) {
    if (!enabled) return;

    const candidates = [];
    if (root instanceof Element && root.matches(NOTICE_SELECTOR)) candidates.push(root);
    if (typeof root.querySelectorAll === 'function') {
      candidates.push(...root.querySelectorAll(NOTICE_SELECTOR));
    }

    for (const candidate of candidates) {
      if (candidate.hidden || !isNotice(candidate) || hasControls(candidate)) continue;

      // Include the notice icon, but never hide an enclosing comment form or other controls.
      let notice = candidate;
      while (notice.parentElement?.matches(NOTICE_SELECTOR)
        && isNotice(notice.parentElement) && !hasControls(notice.parentElement)) {
        notice = notice.parentElement;
      }
      if (notice.hidden) continue;
      notice.hidden = true;
      hiddenNotices.add(notice);
    }
  }

  function refresh() {
    scheduled = false;
    if (enabled) hideMatchingNotices();
  }

  function scheduleRefresh() {
    if (scheduled || !enabled) return;
    scheduled = true;
    queueMicrotask(refresh);
  }

  function setEnabled(next) {
    enabled = Boolean(next);
    if (enabled) {
      scheduleRefresh();
      return;
    }
    for (const notice of hiddenNotices) notice.hidden = false;
    hiddenNotices.clear();
  }

  // GitHub can insert an empty notice shell and fill its text later.
  new MutationObserver(scheduleRefresh).observe(document.documentElement || document, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);

  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[SETTING]) setEnabled(changes[SETTING].newValue);
  });

  const settings = await chrome.storage.local.get({ [SETTING]: true });
  setEnabled(settings[SETTING]);
})();
