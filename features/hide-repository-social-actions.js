(async () => {
  'use strict';

  const { hideRepositorySocialActions = false } = await chrome.storage.local.get({
    hideRepositorySocialActions: false,
  });
  if (!hideRepositorySocialActions) return;

  const ACTIONS = new Set(['watch', 'star', 'fork']);

  function repositoryPrefix() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length < 2 || ['settings', 'orgs', 'topics', 'collections', 'features', 'marketplace', 'notifications'].includes(parts[0])) return null;
    return `/${parts[0]}/${parts[1]}`;
  }

  function removeSocialActions() {
    const prefix = repositoryPrefix();
    if (!prefix) return;

    const header = document.querySelector('#repository-container-header');
    if (!header) return;

    // GitHub renders these as list items containing actionable Watch/Star/Fork buttons.
    // Scope to the repository header to preserve stars, forks, and other links elsewhere.
    for (const item of header.querySelectorAll('li, [data-testid="repository-action-menu"]')) {
      if (item.closest('[data-fractured-hidden-social-action]')) continue;
      const text = (item.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const labels = [...item.querySelectorAll('a, button, summary')].map((el) =>
        (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
          .replace(/\\s+/g, ' ').trim().toLowerCase()
      );
      const isAction = labels.some((label) =>
        /^(?:unwatch|watch|star|unstar|fork)(?:\\s|$)/.test(label)
      );
      if (!isAction || (!ACTIONS.has(text.split(' ')[0]) && !labels.some((label) =>
        /^(?:unwatch|watch|star|unstar|fork)(?:\\s|$)/.test(label)
      ))) continue;
      // Only remove the smallest header list item containing the action (and its count).
      if (item.querySelector('li')) continue;
      item.hidden = true;
      item.setAttribute('data-fractured-hidden-social-action', 'true');
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      removeSocialActions();
    });
  }

  const observer = new MutationObserver(schedule);
  function start() {
    schedule();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  document.addEventListener('turbo:load', schedule);
  document.addEventListener('pjax:end', schedule);
})();
