(() => {
  'use strict';

  const ATTRIBUTE = 'data-fractured-hidden-repository-control';
  const KEYS = ['hideRepositoryWatch', 'hideRepositoryStar', 'hideRepositoryFork',
    'hideRepositoryPins', 'hideRepositoryOverviewName', 'hideRepositorySocialActions',
    'hideRepositoryCustomProperties', 'hideReportRepository'];
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
          ['pins', 'hideRepositoryPins', /^(?:edit pins|pin repository|unpin repository)(?:\s|:|$)/i],
        ]) {
          const hide = key === 'hideRepositoryPins'
            ? (settings[key] ?? true)
            : (settings[key] ?? settings.hideRepositorySocialActions);
          if (hide && labels.some(label => pattern.test(label))) {
            item.setAttribute(ATTRIBUTE, action);
          }
        }
      }
    }

    // Cover the About statistics in both wide and narrow repository layouts.
    for (const [action, key, destination] of [
      ['watch', 'hideRepositoryWatch', 'watchers'],
      ['star', 'hideRepositoryStar', 'stargazers'],
      ['fork', 'hideRepositoryFork', 'forks'],
    ]) {
      if (!(settings[key] ?? settings.hideRepositorySocialActions)) continue;
      for (const link of document.querySelectorAll(
        '[class*="SidebarAbout"] a[href], .BorderGrid-cell a[href]',
      )) {
        const url = new URL(link.href, location.origin);
        if (url.origin !== location.origin
          || url.pathname.replace(/\/+$/, '') !== `/${repository}/${destination}`) continue;
        const row = link.closest('[class*="insightItem"], .mt-2') || link;
        row.setAttribute(ATTRIBUTE, action);
        const heading = row.previousElementSibling;
        if (heading?.matches('h3') && /^(Stars|Watchers|Forks)$/.test(heading.textContent.trim())) {
          heading.setAttribute(ATTRIBUTE, action);
        }
      }
    }

    if (settings.hideRepositoryCustomProperties) {
      for (const link of document.querySelectorAll(
        '[class*="SidebarSection"] a[href], .BorderGrid-cell a[href], aside a[href]',
      )) {
        const url = new URL(link.href, location.origin);
        if (url.origin !== location.origin
          || url.pathname.replace(/\/+$/, '') !== `/${repository}/custom-properties`) continue;
        const row = link.closest('[class*="insightItem"], .mt-2') || link;
        row.setAttribute(ATTRIBUTE, 'custom-properties');
      }
    }

    if (settings.hideReportRepository) {
      for (const link of document.querySelectorAll(
        '[class*="SidebarSection"] a[href], .BorderGrid-cell a[href], aside a[href]',
      )) {
        const url = new URL(link.href, location.origin);
        const reportedContent = url.searchParams.get('content_url');
        if (url.origin !== location.origin || url.pathname !== '/contact/report-content'
          || reportedContent !== `${location.origin}/${repository}`) continue;
        const row = link.closest('[class*="insightItem"], .mt-2') || link;
        row.setAttribute(ATTRIBUTE, 'report-repository');
      }
    }

    if (settings.hideRepositoryOverviewName && location.pathname.replace(/\/+$/, '') === `/${repository}`) {
      for (const name of document.querySelectorAll('#repo-title-component [data-testid="repo-name-wrapper"], #repository-container-header [itemprop="name"]')) {
        name.setAttribute(ATTRIBUTE, 'name');
        const avatar = name.parentElement.querySelector('img[data-component="Avatar"], img.avatar');
        avatar?.setAttribute(ATTRIBUTE, 'avatar');
        const visibility = name.parentElement.querySelector('[data-testid="repo-visibility-label"], .Label');
        visibility?.setAttribute(ATTRIBUTE, 'visibility');

        const row = name.closest('.border-bottom');
        if (row && !row.innerText.trim()) {
          const hasVisibleControl = [...row.querySelectorAll('a, button, summary, input, img, svg, [role="button"]')]
            .some(element => element.getClientRects().length > 0
              && getComputedStyle(element).visibility !== 'hidden');
          if (!hasVisibleControl) row.setAttribute(ATTRIBUTE, 'empty-header');
        }
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
