(() => {
  'use strict';

  const SETTING_KEY = 'hideMyNavigationLinks';
  const STYLE_ID = 'fractured-hide-my-navigation-links-style';
  const HIDDEN_ATTRIBUTE = 'data-fractured-hidden-my-navigation-link';
  const NAVIGATION_SELECTOR = [
    'header[role="banner"]',
    'header.AppHeader',
    'header.GlobalNav',
    'header[aria-label="Global navigation menu"]',
    '[data-component="AppHeader"]',
    '#global-nav',
    'nav[aria-label="Global"]',
  ].join(', ');
  const MY_LINK_LABELS = new Set([
    'my prs',
    'my pull requests',
    'my issues',
    'my repos',
    'my repositories',
  ]);

  let enabled = false;
  let observer = null;
  let refreshQueued = false;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function accessibleName(link) {
    const labelledBy = (link.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent || '')
      .join(' ');

    return normalizeText([
      link.getAttribute('aria-label'),
      labelledBy,
      link.textContent,
    ].filter(Boolean).join(' '));
  }

  function matchesMyNavigationLink(link) {
    const name = accessibleName(link);
    if (MY_LINK_LABELS.has(name)) return true;

    let url;
    try {
      url = new URL(link.href, window.location.origin);
    } catch {
      return false;
    }

    if (url.origin !== window.location.origin) return false;
    if (url.pathname === '/pulls' || url.pathname === '/issues'
      || url.pathname === '/repos' || url.pathname === '/repositories') {
      return true;
    }

    // Profile tabs also live inside GitHub's global header. Keep their
    // repositories links visible; only the global shortcuts belong here.
    return false;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const root = document.head || document.documentElement;
    if (!root) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '[' + HIDDEN_ATTRIBUTE + '] { display: none !important; }';
    root.append(style);
  }

  function clearMarkers() {
    for (const element of document.querySelectorAll('[' + HIDDEN_ATTRIBUTE + ']')) {
      element.removeAttribute(HIDDEN_ATTRIBUTE);
    }
  }

  function refresh() {
    refreshQueued = false;
    clearMarkers();
    if (!enabled) return;

    ensureStyle();

    for (const navigation of document.querySelectorAll(NAVIGATION_SELECTOR)) {
      for (const link of navigation.querySelectorAll('a[href]')) {
        if (!matchesMyNavigationLink(link)) continue;
        (link.closest('li') || link).setAttribute(HIDDEN_ATTRIBUTE, '');
      }
    }
  }

  function queueRefresh() {
    if (!enabled || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(refresh);
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    refreshQueued = false;

    observer?.disconnect();
    observer = null;
    document.removeEventListener('turbo:load', queueRefresh);
    document.removeEventListener('pjax:end', queueRefresh);

    if (!enabled) {
      clearMarkers();
      document.getElementById(STYLE_ID)?.remove();
      return;
    }

    refresh();
    observer = new MutationObserver(queueRefresh);
    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'aria-label', 'aria-labelledby'],
    });
    document.addEventListener('turbo:load', queueRefresh);
    document.addEventListener('pjax:end', queueRefresh);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTING_KEY]) return;
    setEnabled(changes[SETTING_KEY].newValue);
  });

  void chrome.storage.local.get({ [SETTING_KEY]: false }).then((settings) => {
    setEnabled(settings[SETTING_KEY]);
  });
})();
