(async () => {
  'use strict';

  const SETTING = 'hidePullRequestProtip';
  const NOTICE_SELECTOR = 'p, div, span, small';
  const CONTROL_SELECTOR = 'button, input, textarea, select, form, [role="button"]';
  const hiddenTips = new Set();
  let enabled = false;
  let scheduled = false;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isProtip(element) {
    const text = normalizeText(element.textContent);
    if (/^(?:ProTip|Tip)!\s+Add \.patch or \.diff to the end of URLs for Git['’]s plaintext views\.?$/i.test(text)) {
      return true;
    }
    if (!/^(?:ProTip|Tip)!\s+Add comments to specific lines under Files changed\.?$/i.test(text)) {
      return false;
    }
    return [...element.querySelectorAll('a')].some((link) => (
      /^Files changed\.?$/i.test(normalizeText(link.textContent))
    ));
  }

  function hasControls(element) {
    return element.querySelectorAll(CONTROL_SELECTOR).length > 0;
  }

  function hideMatchingProtips(root = document) {
    if (!enabled) return;

    const candidates = [];
    if (root instanceof Element && root.matches(NOTICE_SELECTOR)) candidates.push(root);
    if (typeof root.querySelectorAll === 'function') {
      candidates.push(...root.querySelectorAll(NOTICE_SELECTOR));
    }

    for (const candidate of candidates) {
      if (candidate.hidden || !isProtip(candidate) || hasControls(candidate)) continue;

      // Hide the icon and tip together, without hiding the neighboring comment editor.
      let tip = candidate;
      while (tip.parentElement?.matches(NOTICE_SELECTOR)
        && isProtip(tip.parentElement) && !hasControls(tip.parentElement)) {
        tip = tip.parentElement;
      }
      if (tip.hidden) continue;
      tip.hidden = true;
      hiddenTips.add(tip);
    }
  }

  function refresh() {
    scheduled = false;
    if (enabled) hideMatchingProtips();
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
    for (const tip of hiddenTips) tip.hidden = false;
    hiddenTips.clear();
  }

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

  const settings = await chrome.storage.local.get({ [SETTING]: false });
  setEnabled(settings[SETTING]);
})();
