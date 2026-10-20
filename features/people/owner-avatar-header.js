(() => {
  'use strict';

  const ENABLED_KEY = 'ownerAvatarHeaderEnabled';
  const STYLE_ID = 'fractured-owner-avatar-header-style';
  const LOGO_ATTRIBUTE = 'data-fractured-owner-logo';
  const AVATAR_ATTRIBUTE = 'data-fractured-owner-avatar';
  const HIDDEN_ATTRIBUTE = 'data-fractured-owner-heading-hidden';
  const ORIGINAL_HREF_ATTRIBUTE = 'data-fractured-owner-logo-original-href';
  const ORIGINAL_LABEL_ATTRIBUTE = 'data-fractured-owner-logo-original-label';

  let enabled = false;
  let currentOwner = '';
  let observer = null;
  let refreshQueued = false;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function repositoryOwner() {
    // GitHub can preserve stale octolytics metadata across Turbo/PJAX navigation,
    // especially when following a fork back to a different repository owner.
    // The current route is the source of truth for repository-page branding.
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return '';

    const reservedRoots = new Set([
      'about', 'account', 'apps', 'codespaces', 'collections', 'dashboard',
      'enterprise', 'events', 'explore', 'features', 'issues', 'login',
      'marketplace', 'new', 'notifications', 'organizations', 'orgs',
      'pricing', 'pulls', 'search', 'security', 'sessions', 'settings',
      'signup', 'site', 'sponsors', 'stars', 'topics', 'trending', 'users',
    ]);
    if (reservedRoots.has(parts[0].toLowerCase())) return '';

    try {
      const owner = decodeURIComponent(parts[0]);
      return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner) ? owner : '';
    } catch {
      return '';
    }
  }

  function appHeader() {
    const globalNav = document.querySelector('.GlobalNav, #global-nav');
    if (globalNav) return globalNav;

    return document.querySelector([
      '.AppHeader',
      '[data-component="AppHeader"]',
      '[data-testid="AppHeader"]',
      '#github-header',
      'header[role="banner"]',
    ].join(','));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${LOGO_ATTRIBUTE}] > :not([${AVATAR_ATTRIBUTE}]) {
        display: none !important;
      }

      /* Match the navigation hit target and hover shape to the square owner avatar. */
      [${LOGO_ATTRIBUTE}] {
        width: 28px !important;
        height: 28px !important;
        min-width: 28px !important;
        min-height: 28px !important;
        padding: 0 !important;
        border-radius: 6px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
      }

      [${LOGO_ATTRIBUTE}]::before,
      [${LOGO_ATTRIBUTE}]::after {
        border-radius: inherit !important;
      }

      [${AVATAR_ATTRIBUTE}] {
        width: 28px !important;
        height: 28px !important;
        border-radius: 6px !important;
        display: block !important;
        object-fit: cover !important;
      }

      /* Keep the private-repository lock level with the enlarged repository name. */
      :is(.GlobalNav, #global-nav, .AppHeader, #github-header, header[role="banner"]):has([${LOGO_ATTRIBUTE}])
        :is(.AppHeader-context, [data-component="Breadcrumbs"], nav[aria-label="Breadcrumb"], nav[aria-label="Breadcrumbs"])
        li:has(svg.octicon-lock, svg[data-octicon="lock"]) {
        display: inline-flex !important;
        align-items: center !important;
      }

      :is(.GlobalNav, #global-nav, .AppHeader, #github-header, header[role="banner"]):has([${LOGO_ATTRIBUTE}])
        :is(.AppHeader-context, [data-component="Breadcrumbs"], nav[aria-label="Breadcrumb"], nav[aria-label="Breadcrumbs"])
        :is(svg.octicon-lock, svg[data-octicon="lock"]) {
        width: 16px !important;
        height: 16px !important;
        flex-shrink: 0 !important;
        vertical-align: middle !important;
      }

      [${HIDDEN_ATTRIBUTE}] {
        display: none !important;
      }

      li:has(> [data-component="Breadcrumbs.Item"][${HIDDEN_ATTRIBUTE}]) {
        display: none !important;
      }
    `;

    (document.head || document.documentElement)?.append(style);
  }

  function findGitHubLogo(header) {
    const existing = header.querySelector(`[${LOGO_ATTRIBUTE}]`);
    if (existing instanceof HTMLAnchorElement) return existing;

    const appLogo = header.querySelector([
      'a.AppHeader-logo',
      'a[data-testid="AppHeader-logo"]',
      'a[aria-label="Homepage"][href="/"]',
      'a[href="/"][aria-label*="GitHub" i]',
    ].join(','));
    if (appLogo instanceof HTMLAnchorElement) return appLogo;

    for (const link of header.querySelectorAll('a[href]')) {
      if (
        link.querySelector('.octicon-mark-github')
        || link.querySelector('[data-octicon="mark-github"]')
      ) {
        return link;
      }

      let url;
      try {
        url = new URL(link.href, window.location.origin);
      } catch {
        continue;
      }

      const label = normalizeText(link.getAttribute('aria-label'));
      if (
        url.origin === window.location.origin
        && url.pathname === '/'
        && (label.includes('homepage') || label === 'github')
      ) {
        return link;
      }
    }

    return null;
  }

  function restoreLogo() {
    const logo = document.querySelector(`[${LOGO_ATTRIBUTE}]`);
    if (!(logo instanceof HTMLAnchorElement)) return;

    const originalHref = logo.getAttribute(ORIGINAL_HREF_ATTRIBUTE);
    if (originalHref !== null) logo.setAttribute('href', originalHref);

    const originalLabel = logo.getAttribute(ORIGINAL_LABEL_ATTRIBUTE);
    if (originalLabel === '') logo.removeAttribute('aria-label');
    else if (originalLabel !== null) logo.setAttribute('aria-label', originalLabel);

    logo.querySelector(`[${AVATAR_ATTRIBUTE}]`)?.remove();
    logo.removeAttribute(LOGO_ATTRIBUTE);
    logo.removeAttribute(ORIGINAL_HREF_ATTRIBUTE);
    logo.removeAttribute(ORIGINAL_LABEL_ATTRIBUTE);
  }

  function clearHiddenOwnerNames() {
    for (const element of document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)) {
      element.removeAttribute(HIDDEN_ATTRIBUTE);
    }
  }

  function reset() {
    restoreLogo();
    clearHiddenOwnerNames();
    currentOwner = '';
  }

  function installOwnerAvatar(header, owner) {
    const logo = findGitHubLogo(header);
    if (!(logo instanceof HTMLAnchorElement)) return;

    if (!logo.hasAttribute(ORIGINAL_HREF_ATTRIBUTE)) {
      logo.setAttribute(ORIGINAL_HREF_ATTRIBUTE, logo.getAttribute('href') || '/');
    }
    if (!logo.hasAttribute(ORIGINAL_LABEL_ATTRIBUTE)) {
      logo.setAttribute(ORIGINAL_LABEL_ATTRIBUTE, logo.getAttribute('aria-label') || '');
    }

    logo.setAttribute(LOGO_ATTRIBUTE, owner);

    const ownerHref = `/${owner}`;
    if (logo.getAttribute('href') !== ownerHref) logo.setAttribute('href', ownerHref);
    if (logo.getAttribute('aria-label') !== owner) logo.setAttribute('aria-label', owner);

    let avatar = logo.querySelector(`[${AVATAR_ATTRIBUTE}]`);
    if (!(avatar instanceof HTMLImageElement)) {
      avatar = document.createElement('img');
      avatar.setAttribute(AVATAR_ATTRIBUTE, '');
      avatar.alt = '';
      logo.append(avatar);
    }

    const avatarUrl = `https://github.com/${encodeURIComponent(owner)}.png?size=64`;
    if (avatar.src !== avatarUrl) avatar.src = avatarUrl;
  }

  function exactOwnerElement(element, ownerKey) {
    return normalizeText(element.textContent) === ownerKey
      || normalizeText(element.getAttribute('aria-label')) === ownerKey;
  }

  function hideOwnerName(header, owner) {
    const ownerKey = normalizeText(owner);
    const ownerPath = `/${owner.toLowerCase()}`;
    const contextSelector = [
      '[data-component="Breadcrumbs.Item"]',
      '.AppHeader-context-item',
      '[data-testid="AppHeader-context-item"]',
      '[class*="AppHeader-context-item"]',
    ].join(',');

    for (const link of header.querySelectorAll('a[href]')) {
      if (link.hasAttribute(LOGO_ATTRIBUTE)) continue;

      let url;
      try {
        url = new URL(link.href, window.location.origin);
      } catch {
        continue;
      }

      if (
        url.origin !== window.location.origin
        || url.pathname.replace(/\/+$/, '').toLowerCase() !== ownerPath
      ) {
        continue;
      }

      const contextItem = link.closest(contextSelector);
      (contextItem || link).setAttribute(HIDDEN_ATTRIBUTE, owner);
    }

    const labels = header.querySelectorAll([
      '.AppHeader-context-item-label',
      '[data-testid="AppHeader-context-item-label"]',
      '[data-component="AppHeader"] [class*="context-item-label" i]',
      '[class*="AppHeader-context"] [class*="label" i]',
    ].join(','));

    for (const label of labels) {
      if (!exactOwnerElement(label, ownerKey)) continue;

      const contextItem = label.closest(contextSelector);
      (contextItem || label).setAttribute(HIDDEN_ATTRIBUTE, owner);
    }
  }

  function refresh() {
    refreshQueued = false;

    if (!enabled) {
      if (currentOwner) reset();
      return;
    }

    const owner = repositoryOwner();
    const header = appHeader();

    if (!owner || !header) {
      if (currentOwner) reset();
      return;
    }

    if (currentOwner && currentOwner.toLowerCase() !== owner.toLowerCase()) {
      reset();
    }

    ensureStyle();
    currentOwner = owner;
    installOwnerAvatar(header, owner);
    hideOwnerName(header, owner);
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  async function loadSettings() {
    const settings = await chrome.storage.local.get({
      [ENABLED_KEY]: true,
    });

    const nextEnabled = Boolean(settings[ENABLED_KEY]);
    if (enabled === nextEnabled) {
      if (enabled) queueRefresh();
      return;
    }

    enabled = nextEnabled;
    if (enabled) queueRefresh();
    else reset();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(ENABLED_KEY in changes)) return;
    void loadSettings();
  });

  document.addEventListener('turbo:load', queueRefresh);
  document.addEventListener('pjax:end', queueRefresh);
  window.addEventListener('popstate', queueRefresh);

  function observeDocument() {
    if (!document.documentElement) {
      window.setTimeout(observeDocument, 50);
      return;
    }

    observer = new MutationObserver(queueRefresh);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['content', 'href', 'aria-label'],
    });

    queueRefresh();
  }

  observeDocument();
  void loadSettings();
})();
