(() => {
  'use strict';

  const ATTRIBUTE = 'data-fractured-hidden-repository-control';
  const KEYS = ['hideRepositoryWatch', 'hideRepositoryStar', 'hideRepositoryFork',
    'hideRepositoryPins', 'hideRepositoryOverviewName', 'hideRepositorySocialActions',
    'hideRepositoryCustomProperties', 'hideReportRepository'];
  let settings = {};
  let scheduled = false;

  const COMPACT_ATTRIBUTE = 'data-fractured-compact-repository-action';

  function compactHeaderAction(item, action, repository) {
    const destinations = { watch: 'watchers', star: 'stargazers', fork: 'forks' };
    const path = `/${repository}/${destinations[action]}`.toLowerCase();
    const isCount = value => /^\s*\d[\d,.]*[kmb]?\s*$/i.test(value || '');

    // GitHub renders counters as links on some headers and as inline spans
    // on others. Only hide numeric counters belonging to this action.
    for (const link of item.querySelectorAll('a[href]')) {
      let url;
      try {
        url = new URL(link.href, location.origin);
      } catch {
        continue;
      }
      if (url.origin === location.origin
        && url.pathname.replace(/\/+$/, '').toLowerCase() === path
        && isCount(link.textContent)) {
        link.setAttribute(ATTRIBUTE, `${action}-count`);
      }
    }
    for (const counter of item.querySelectorAll(
      '.Counter, [id*="counter"], [data-testid*="count"]',
    )) {
      if (isCount(counter.textContent)) {
        counter.setAttribute(ATTRIBUTE, `${action}-count`);
      }
    }

    for (const trigger of item.querySelectorAll('button, summary, [role="button"]')) {
      const arrow = trigger.querySelector('svg.octicon-triangle-down, svg.octicon-chevron-down');
      if (!arrow) continue;

      const label = (trigger.textContent || '').replace(/\s+/g, ' ').trim();
      const isPrimary = /^(?:watch|unwatch|star|unstar|fork)(?:\s+\d[\d,.]*[kmb]?)?$/i.test(label)
        || Boolean(trigger.querySelector(
          'svg.octicon-eye, svg.octicon-bell, svg.octicon-star, svg.octicon-repo-forked',
        ));
      if (isPrimary) {
        // Watch can use its *main* button to open notification settings.
        // Never remove that button or prevent its default click behavior.
        arrow.setAttribute(ATTRIBUTE, `${action}-chevron`);
      } else {
        // Split-button menus have their own arrow-only button or summary.
        const menu = trigger.matches('summary') ? trigger.closest('details') || trigger : trigger;
        menu.setAttribute(ATTRIBUTE, `${action}-menu`);
      }
    }

    // Restore the rounded right edge left behind by split-button groups.
    for (const control of item.querySelectorAll('a, button, summary')) {
      const label = (control.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(?:watch|unwatch|star|unstar|fork)(?:\s+\d[\d,.]*[kmb]?)?$/i.test(label)
        && !control.hasAttribute(ATTRIBUTE)) {
        control.setAttribute(COMPACT_ATTRIBUTE, action);
        break;
      }
    }
  }

  function refresh() {
    scheduled = false;
    for (const element of document.querySelectorAll(`[${ATTRIBUTE}], [${COMPACT_ATTRIBUTE}]`)) {
      element.removeAttribute(ATTRIBUTE);
      element.removeAttribute(COMPACT_ATTRIBUTE);
    }

    // Organization/profile cards and repository lists have no repository metadata.
    // Hide the statistic link itself so adjacent language and issue links remain.
    for (const [action, key, destination] of [
      ['star', 'hideRepositoryStar', 'stargazers'],
      ['fork', 'hideRepositoryFork', 'forks'],
    ]) {
      if (!(settings[key] ?? settings.hideRepositorySocialActions)) continue;
      for (const link of document.querySelectorAll(`a[href*="/${destination}"]`)) {
        const url = new URL(link.href, location.origin);
        if (url.origin === location.origin
          && new RegExp(`^/(?!orgs/|organizations/|users/)[^/]+/[^/]+/${destination}/?$`).test(url.pathname)) {
          link.setAttribute(ATTRIBUTE, action);
        }
      }
    }


    // Pinned and other repository cards sometimes show stars as icon + count
    // without a /stargazers link. Hide only the star statistic, not its card.
    if (settings.hideRepositoryStar ?? settings.hideRepositorySocialActions) {
      for (const icon of document.querySelectorAll(
        '.pinned-item-list-item svg.octicon-star, '
        + '.pinned-item-list-item [data-testid="star-icon"], '
        + '.repo-list-item svg.octicon-star, '
        + '[data-testid="repository-card"] svg.octicon-star, '
        + '[data-testid="repository-card"] [data-testid="star-icon"]',
      )) {
        const metric = icon.closest(
          '.pinned-item-meta, [data-testid="repository-stars"], '
          + '[data-testid="repository-star-count"]',
        );
        if (metric) {
          metric.setAttribute(ATTRIBUTE, 'star');
          continue;
        }

        // Some cards have an unclassified wrapper. Only hide it when it
        // contains a single icon and a numeric count; never hide the footer.
        const wrapper = icon.parentElement;
        if (wrapper && wrapper.querySelectorAll('svg, [data-testid="star-icon"]').length === 1
          && /^\d[\d,.]*[kmb]?$/i.test(wrapper.textContent.trim())) {
          wrapper.setAttribute(ATTRIBUTE, 'star');
        }
      }
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
          ['fork', 'hideRepositoryFork', /^(?:fork|cannot fork|can't fork|unable to fork)(?:\s|:|$)/i],
          ['pins', 'hideRepositoryPins', /^(?:edit pins|pin repository|unpin repository)(?:\s|:|$)/i],
        ]) {
          const hide = key === 'hideRepositoryPins'
            ? (settings[key] ?? true)
            : (settings[key] ?? settings.hideRepositorySocialActions);
          if (!hide || !labels.some(label => pattern.test(label))) continue;
          if (action === 'pins') {
            item.setAttribute(ATTRIBUTE, action);
          } else {
            compactHeaderAction(item, action, repository);
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
  style.textContent = `[${ATTRIBUTE}] { display: none !important; }
    [${COMPACT_ATTRIBUTE}] {
      border-top-right-radius: var(--borderRadius-medium, 6px) !important;
      border-bottom-right-radius: var(--borderRadius-medium, 6px) !important;
    }`;
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
