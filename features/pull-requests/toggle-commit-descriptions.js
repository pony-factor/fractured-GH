(() => {
  'use strict';

  const HOLDER_ID = 'fractured-pr-commit-details-toggle';
  const EXPANDER = 'button.ellipsis-expander, .hidden-text-expander button, button[aria-label="Expand commit message"], button[aria-label="Collapse commit message"]';
  const HIDDEN = '[data-fractured-coauthor-only-details]';
  let queued = false;

  function onCommitsPage() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+\/commits\/?$/.test(location.pathname);
  }

  function entries() {
    return Array.from(document.querySelectorAll('.commit-message')).flatMap(message => {
      const description = message.querySelector('.commit-desc');
      const button = message.querySelector(EXPANDER);
      if (!description || !button || button.disabled || button.closest(HIDDEN)
        || description.closest(HIDDEN) || !button.getClientRects().length
        || !description.textContent.trim()) return [];
      const expanded = button.getAttribute('aria-expanded');
      const open = expanded === 'true' || (expanded !== 'false'
        && description.getClientRects().length > 0
        && getComputedStyle(description).visibility !== 'hidden');
      return [{ message, button, open }];
    });
  }

  function toggleAll() {
    const rows = entries();
    if (!rows.length || !onCommitsPage()) return;
    const expand = rows.some(row => !row.open);
    for (const row of rows) {
      if (row.open !== expand) row.button.click();
    }
    schedule();
  }

  function refresh() {
    queued = false;
    let holder = document.getElementById(HOLDER_ID);
    const rows = onCommitsPage() ? entries() : [];
    if (!rows.length) {
      holder?.remove();
      return;
    }

    const first = rows[0].message;
    const anchor = first.closest('.commit-group, ol, ul')
      || first.closest('.Box-row, .TimelineItem') || first;
    if (!anchor.parentElement) return;
    if (!holder) {
      holder = document.createElement('div');
      holder.id = HOLDER_ID;
      holder.className = 'd-flex flex-justify-end mb-2';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm';
      button.addEventListener('click', toggleAll);
      holder.append(button);
    }
    if (holder.nextElementSibling !== anchor) anchor.before(holder);
    const button = holder.firstElementChild;
    const label = rows.every(row => row.open) ? 'Collapse all commit descriptions' : 'Expand all commit descriptions';
    if (button.textContent !== label) button.textContent = label;
  }

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(refresh);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'aria-label',
      'disabled', 'data-fractured-coauthor-only-details'],
  });
  document.addEventListener('turbo:load', schedule);
  document.addEventListener('pjax:end', schedule);
  window.addEventListener('popstate', schedule);
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
  schedule();
})();
