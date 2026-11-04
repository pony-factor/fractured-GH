(function () {
  'use strict';

  const NOTIFICATION_REASONS = new Set([
    "You're receiving notifications because you authored the thread.",
    "You're receiving notifications because you modified the open/close state.",
  ]);

  function normalizeText(value) {
    return String(value || '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hideAuthoredThreadReason(root = document) {
    const paragraphs = [];

    if (root instanceof Element && root.matches('p')) {
      paragraphs.push(root);
    }

    if (typeof root.querySelectorAll === 'function') {
      paragraphs.push(...root.querySelectorAll('p'));
    }

    for (const paragraph of paragraphs) {
      if (paragraph.hidden) continue;
      if (!NOTIFICATION_REASONS.has(normalizeText(paragraph.textContent))) continue;
      paragraph.hidden = true;
    }
  }

  hideAuthoredThreadReason();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') {
        const paragraph = record.target.parentElement?.closest('p');
        if (paragraph) hideAuthoredThreadReason(paragraph);
      }
      if (record.target instanceof Element) hideAuthoredThreadReason(record.target.closest('p') || record.target);
      for (const node of record.addedNodes) {
        if (node instanceof Element) hideAuthoredThreadReason(node);
      }
    }
  });

  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  document.addEventListener('turbo:load', () => hideAuthoredThreadReason());
  document.addEventListener('pjax:end', () => hideAuthoredThreadReason());
})();
