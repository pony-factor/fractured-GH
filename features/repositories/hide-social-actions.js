(() => {
  'use strict';

  const ATTRIBUTE = 'data-fractured-hidden-repository-control';
  const KEYS = ['hideRepositoryWatch', 'hideRepositoryStar', 'hideRepositoryFork',
    'hideRepositoryWatchButton', 'hideRepositoryStarButton', 'hideRepositoryForkButton',
    'hideRepositoryPins', 'hideRepositoryOverviewName', 'hideRepositorySocialActions',
    'hideRepositoryCustomProperties', 'hideReportRepository'];
  let settings = {};
  let scheduled = false;

  const COMPACT_ATTRIBUTE = 'data-fractured-compact-repository-action';

  function headerActionMode(action, preferences) {
    if (action === 'pins') return (preferences.hideRepositoryPins ?? true) ? 'hide' : 'show';
    const controls = {
      watch: ['hideRepositoryWatch', 'hideRepositoryWatchButton'],
      star: ['hideRepositoryStar', 'hideRepositoryStarButton'],
      fork: ['hideRepositoryFork', 'hideRepositoryForkButton'],
    };
    const keys = controls[action];
    if (!keys) return 'show';
    if (preferences[keys[1]]) return 'hide';
    return (preferences[keys[0]] ?? preferences.hideRepositorySocialActions)
      ? 'compact' : 'show';
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { headerActionMode };
    return;
  }

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


    // Profile cards and organization repository rows can render star/fork
    // counts as icon + plain text, without a /stargazers or /forks link.
    // Only hide isolated metrics, never their row or mixed metadata footer.
    const organizationRepositories =
      /^\/(?:orgs|organizations)\/[^/]+\/repositories\/?$/.test(location.pathname);
    const cardSelector = '.pinned-item-list-item, .repo-list-item, '
      + '[data-testid="repository-card"], [data-testid="repository-list-item"]';
    const rowSelector = '.Box-row, [data-testid="repository-row"], [role="row"], li, tr, article';
    const rowBoundary = cardSelector + ', ' + rowSelector;
    const isCount = value => /^\s*\d[\d,.]*[kmb]?\s*$/i.test(value || '');

    function isRepositoryListingMetric(icon) {
      if (icon.closest(cardSelector)) return true;
      if (!organizationRepositories) return false;

      // GitHub may use plain divs instead of list items for these rows.
      // Search only nearby ancestors, and stop before the shared container
      // holding multiple repositories to avoid capturing unrelated icons.
      for (let row = icon.parentElement, depth = 0; row && depth < 8;
        row = row.parentElement, depth++) {
        const repositoryLinks = [...row.querySelectorAll('a[href]')].filter(link => {
          try {
            const url = new URL(link.href, location.origin);
            return url.origin === location.origin
              && /^\/(?!orgs\/|organizations\/|users\/)[^/]+\/[^/]+\/?$/.test(url.pathname);
          } catch {
            return false;
          }
        });
        if (repositoryLinks.length === 1) return true;
        if (repositoryLinks.length > 1) return false;
      }
      return false;
    }

    for (const [action, key, iconSelector, classifiedSelector] of [
      ['star', 'hideRepositoryStar',
        'svg.octicon-star, [data-testid="star-icon"]',
        '.pinned-item-meta, [data-testid="repository-stars"], '
          + '[data-testid="repository-star-count"]'],
      ['fork', 'hideRepositoryFork',
        'svg.octicon-repo-forked, [data-testid="fork-icon"]',
        '[data-testid="repository-forks"], [data-testid="repository-fork-count"]'],
    ]) {
      if (!(settings[key] ?? settings.hideRepositorySocialActions)) continue;
      for (const icon of document.querySelectorAll(iconSelector)) {
        if (!isRepositoryListingMetric(icon)) continue;

        const classified = icon.closest(classifiedSelector);
        if (classified && isCount(classified.textContent)
          && classified.querySelectorAll('svg, [data-testid$="-icon"]').length === 1) {
          classified.setAttribute(ATTRIBUTE, action);
          continue;
        }

        // Walk past nested SVG/span wrappers until the smallest isolated
        // numeric metric is found. Never hide a repository row or entire card.
        for (let wrapper = icon.parentElement, depth = 0;
          wrapper && depth < 4 && !wrapper.matches(rowBoundary);
          wrapper = wrapper.parentElement, depth++) {
          if (isCount(wrapper.textContent)
            && wrapper.querySelectorAll('svg, [data-testid$="-icon"]').length === 1) {
            wrapper.setAttribute(ATTRIBUTE, action);
            break;
          }
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
          ['pins', 'hideRepositoryPins', /^(?:edit pins|(?:un)?pin(?: repository)?)(?:\s|:|$)/i],
        ]) {
          const mode = headerActionMode(action, settings);
          if (mode === 'show' || !labels.some(label => pattern.test(label))) continue;
          if (mode === 'hide') item.setAttribute(ATTRIBUTE, action + '-button');
          else compactHeaderAction(item, action, repository);
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
