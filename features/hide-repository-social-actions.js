(() => {
  'use strict';

  const ATTRIBUTE = 'data-fractured-hidden-repository-control';
  const KEYS = ['hideRepositoryWatch', 'hideRepositoryStar', 'hideRepositoryFork',
    'hideRepositoryOverviewName', 'hideRepositorySocialActions'];
  let settings = {};
  let scheduled = false;

  function refresh() {
    scheduled = false;
    for (const element of document.querySelectorAll(`[${ATTRIBUTE}]`)) {
      element.removeAttribute(ATTRIBUTE);
    }

    const repository = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')
      ?.getAttribute('content');
    if (!repository) return;

    const actions = document.querySelectorAll(
      '[data-testid="repo-header-actions"], [class*="RepoHeaderActions"], #repository-container-header .pagehead-actions',
    );
    for (const list of actions) {
      for (const item of list.children) {
        const labels = [...item.querySelectorAll('a, button, summary')].map(element =>
          [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]
            .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
        );
        for (const [action, key, pattern] of [
          ['watch', 'hideRepositoryWatch', /^(?:unwatch|watch)(?:\s|:|$)/i],
          ['star', 'hideRepositoryStar', /^(?:unstar|star)(?:\s|:|$)/i],
          ['fork', 'hideRepositoryFork', /^fork(?:\s|:|$)/i],
        ]) {
          if ((settings[key] ?? settings.hideRepositorySocialActions) && labels.some(label => pattern.test(label))) {
            item.setAttribute(ATTRIBUTE, action);
          }
        }
      }
    }

    if (settings.hideRepositoryOverviewName && location.pathname.replace(/\/+$/, '') === `/${repository}`) {
      for (const name of document.querySelectorAll('#repo-title-component [data-testid="repo-name-wrapper"], #repository-container-header [itemprop="name"]')) {
        name.setAttribute(ATTRIBUTE, 'name');
        const avatar = name.parentElement.querySelector('img[data-component="Avatar"], img.avatar');
        avatar?.setAttribute(ATTRIBUTE, 'avatar');
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  async function loadSettings() {
    settings = await chrome.storage.local.get(KEYS);
    schedule();
  }

  const style = document.createElement('style');
  style.textContent = `[${ATTRIBUTE}] { display: none !important; }`;
  (document.head || document.documentElement).append(style);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEYS.some(key => key in changes)) void loadSettings();
  });
  document.addEventListener('turbo:load', schedule);
  document.addEventListener('pjax:end', schedule);
  window.addEventListener('popstate', schedule);
  void loadSettings();
})();
