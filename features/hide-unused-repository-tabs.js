(() => {
  'use strict';

  const HIDDEN_REPOSITORY_TABS = [
    { label: 'agents', route: 'agents' },
    { label: 'security and quality', route: 'security' },
    { label: 'wiki', route: 'wiki' },
  ];

  const DISCUSSIONS_CACHE_TTL = 5 * 60 * 1000;
  const discussionsCache = new Map();

  function repositoryPrefix() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return `/${parts[0]}/${parts[1]}`;
  }

  function normalizedLabel(link) {
    return (link.getAttribute('aria-label') || link.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isHiddenRepositoryTab(link, prefix) {
    let url;
    try {
      url = new URL(link.href, window.location.origin);
    } catch {
      return false;
    }

    if (url.origin !== window.location.origin) return false;

    const label = normalizedLabel(link);
    return HIDDEN_REPOSITORY_TABS.some(({ label: expectedLabel, route }) => {
      if (label !== expectedLabel) return false;
      const tabPath = `${prefix}/${route}`;
      return url.pathname === tabPath || url.pathname.startsWith(`${tabPath}/`);
    });
  }

  function isDiscussionsTab(link, prefix) {
    try {
      const url = new URL(link.href, window.location.origin);
      return url.origin === window.location.origin
        && (url.pathname === `${prefix}/discussions` || url.pathname === `${prefix}/discussions/`);
    } catch {
      return false;
    }
  }

  function discussionsEnabled(prefix) {
    const repository = prefix.slice(1);
    const cached = discussionsCache.get(repository);
    if (cached && (cached.loading || Date.now() - cached.checkedAt < DISCUSSIONS_CACHE_TTL)) {
      return cached.enabled;
    }

    const entry = { enabled: null, loading: true, checkedAt: Date.now() };
    discussionsCache.set(repository, entry);

    // Only hide on explicit GitHub metadata; keep tabs visible if an API
    // response is inaccessible (for example, a private repository).
    void fetch(`https://api.github.com/repos/${repository.split('/').map(encodeURIComponent).join('/')}`, {
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        entry.enabled = typeof data?.has_discussions === 'boolean' ? data.has_discussions : null;
      })
      .catch(() => { entry.enabled = null; })
      .finally(() => {
        entry.loading = false;
        entry.checkedAt = Date.now();
        scheduleUpdate();
      });
    return null;
  }

  function restorePreviouslyHiddenTabs(navigation) {
    for (const item of navigation.querySelectorAll('[data-fractured-hidden-repository-tab]')) {
      item.hidden = false;
      delete item.dataset.fracturedHiddenRepositoryTab;
    }
  }

  function hideUnusedRepositoryTabs() {
    const prefix = repositoryPrefix();
    if (!prefix) return;

    const navigations = document.querySelectorAll(
      '#repository-container-header nav, nav[aria-label="Repository"]',
    );

    for (const navigation of navigations) {
      restorePreviouslyHiddenTabs(navigation);

      const links = [...navigation.querySelectorAll('a[href]')];
      const hideDiscussions = links.some(link => isDiscussionsTab(link, prefix))
        && discussionsEnabled(prefix) === false;

      for (const link of links) {
        if (!isHiddenRepositoryTab(link, prefix)
          && !(hideDiscussions && isDiscussionsTab(link, prefix))) continue;

        const item = link.closest('li') || link.closest('[role="tab"]') || link;
        item.hidden = true;
        item.dataset.fracturedHiddenRepositoryTab = 'true';
      }
    }
  }

  let scheduled = false;
  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      hideUnusedRepositoryTabs();
    });
  }

  const observer = new MutationObserver(scheduleUpdate);

  function start() {
    scheduleUpdate();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });

  document.addEventListener('turbo:load', scheduleUpdate);
  document.addEventListener('pjax:end', scheduleUpdate);
  window.addEventListener('popstate', scheduleUpdate);
})();
