(() => {
  'use strict';

  const SETTING_KEY = 'preferDisplayNamesEnabled';
  const ROOT_ATTRIBUTE = 'data-fractured-prefer-display-names';
  const PRIMARY_CLASS = 'fractured-display-name-primary';
  const SECONDARY_CLASS = 'fractured-username-secondary';
  const GENERATED_ATTRIBUTE = 'data-fractured-generated-display-name';
  const SURFACE_SELECTOR = [
    '.js-hovercard-content',
    '[data-testid*="hovercard" i]',
    '[data-test-selector*="hovercard" i]',
    '.Popover-message',
    '#global-user-nav-drawer',
    '[data-testid*="global-user-nav" i]',
    '[data-testid*="user-menu" i]',
    '[data-testid*="account-menu" i]',
    '.AppHeader-user .Overlay',
    '.AppHeader-user .dropdown-menu',
    '[data-testid*="contributor" i]',
    '[class*="contributor" i]',
    '[id*="contributor" i]',
  ].join(',');

  let enabled = false;
  let nicknames = new Map();
  let observer = null;
  let scanScheduled = false;
  const displayNameCache = new Map();
  const pendingLinks = new WeakSet();

  function plainText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function usernameFromLink(link) {
    if (!(link instanceof HTMLAnchorElement)) return '';
    try {
      const url = new URL(link.getAttribute('href') || '', location.origin);
      if (url.origin !== location.origin) return '';
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) return '';
      const username = decodeURIComponent(parts[0]);
      return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username) ? username : '';
    } catch {
      return '';
    }
  }

  function isUsernameLabel(element, username) {
    return plainText(element.textContent).replace(/^@/, '').toLowerCase() === username.toLowerCase();
  }

  function isContributorRoute() {
    return /^\/[^/]+\/[^/]+\/graphs\/contributors(?:\/|$)/.test(location.pathname);
  }

  function isMenuSurface(surface) {
    return surface.matches([
      '#global-user-nav-drawer',
      '[data-testid*="global-user-nav" i]',
      '[data-testid*="user-menu" i]',
      '[data-testid*="account-menu" i]',
      '.AppHeader-user .Overlay',
      '.AppHeader-user .dropdown-menu',
    ].join(','));
  }

  async function fetchedDisplayName(username) {
    const key = username.toLowerCase();
    if (displayNameCache.has(key)) return displayNameCache.get(key);

    const pending = (async () => {
      try {
        const response = await fetch('/' + encodeURIComponent(username), {
          credentials: 'same-origin',
          headers: { Accept: 'text/html' },
        });
        if (!response.ok) return '';
        const profile = new DOMParser().parseFromString(await response.text(), 'text/html');
        const name = plainText(profile.querySelector('[itemprop="name"], [data-testid="profile-name"], .p-name')?.textContent);
        return name || '';
      } catch {
        return '';
      }
    })();

    displayNameCache.set(key, pending);
    return pending;
  }

  function existingDisplayName(scope, name, handle) {
    const expected = plainText(name).toLowerCase();
    if (!expected) return null;

    // Find the smallest existing element with the matching name, rather than
    // styling a whole card and accidentally enlarging its bio or controls.
    for (const element of scope.querySelectorAll('span, strong, b, a, p, h1, h2, h3, h4, div')) {
      if (element === handle || element.contains(handle) || handle.contains(element)) continue;
      if (plainText(element.textContent).toLowerCase() !== expected) continue;
      if ([...element.children].some((child) => plainText(child.textContent).toLowerCase() === expected)) continue;
      return element;
    }
    return null;
  }

  function styleIdentity(handle, scope, displayName) {
    if (!enabled || !handle.isConnected || !scope.isConnected) return;
    if (!displayName || plainText(displayName).toLowerCase() === plainText(handle.textContent).toLowerCase()) return;

    let nameElement = existingDisplayName(scope, displayName, handle);
    if (!nameElement) {
      nameElement = document.createElement('span');
      nameElement.setAttribute(GENERATED_ATTRIBUTE, '');
      nameElement.textContent = displayName;
      handle.before(nameElement);
    }
    nameElement.classList.add(PRIMARY_CLASS);
    handle.classList.add(SECONDARY_CLASS);
  }

  async function styleProfileLink(link, scope) {
    const username = usernameFromLink(link);
    if (!username || !isUsernameLabel(link, username) || pendingLinks.has(link)) return;

    pendingLinks.add(link);
    try {
      const fetchedName = await fetchedDisplayName(username);
      if (!enabled || !link.isConnected || usernameFromLink(link).toLowerCase() !== username.toLowerCase()) return;
      const nickname = nicknames.get(username.toLowerCase());
      const displayName = nickname || fetchedName;
      if (!displayName) return;
      // If a configured nickname was not rendered yet, fall back to the
      // real visible profile name before inserting a duplicate.
      if (nickname && !existingDisplayName(scope, nickname, link) && fetchedName
        && existingDisplayName(scope, fetchedName, link)) {
        styleIdentity(link, scope, fetchedName);
      } else {
        styleIdentity(link, scope, displayName);
      }
    } finally {
      pendingLinks.delete(link);
    }
  }

  function styleAccountMenu(surface) {
    // GitHub's "Signed in as <username>" menu header may have no profile link.
    const lines = [...surface.querySelectorAll('li, p, div, span')]
      .filter((item) => {
        const text = plainText(item.textContent);
        return /^signed in as\s+@?[a-z\d-]+$/i.test(text) && text.length < 90;
      })
      .sort((a, b) => plainText(a.textContent).length - plainText(b.textContent).length);

    const line = lines[0];
    if (!line) return;
    const match = plainText(line.textContent).match(/^signed in as\s+@?([a-z\d-]+)$/i);
    const username = match?.[1];
    if (!username) return;

    const handle = [...line.querySelectorAll('strong, b, span, a')]
      .find((element) => isUsernameLabel(element, username)) || line;
    const scope = line.parentElement || line;

    void fetchedDisplayName(username).then((name) => {
      if (!enabled || !line.isConnected) return;
      styleIdentity(handle, scope, nicknames.get(username.toLowerCase()) || name);
    });
  }

  function scan() {
    if (!enabled) return;
    const scopes = [...document.querySelectorAll(SURFACE_SELECTOR)];

    if (isContributorRoute()) {
      scopes.push(document.querySelector('main') || document.body);
    }

    for (const scope of new Set(scopes.filter(Boolean))) {
      if (isMenuSurface(scope)) styleAccountMenu(scope);

      for (const link of scope.querySelectorAll('a[href]')) {
        const username = usernameFromLink(link);
        if (!username || !isUsernameLabel(link, username)) continue;

        const row = isContributorRoute() || /contributor/i.test(scope.className || '')
          ? link.closest('li, tr, .Box-row, [data-testid*="contributor" i]') || link.parentElement?.parentElement || scope
          : scope;
        void styleProfileLink(link, row);
      }
    }
  }

  function scheduleScan() {
    if (!enabled || scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (enabled && !document.documentElement) {
      document.addEventListener('DOMContentLoaded', () => setEnabled(enabled), { once: true });
      return;
    }
    if (enabled) {
      document.documentElement.setAttribute(ROOT_ATTRIBUTE, 'true');
      if (!observer) {
        observer = new MutationObserver(scheduleScan);
        observer.observe(document.documentElement, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
      scheduleScan();
    } else {
      observer?.disconnect();
      observer = null;
      document.documentElement?.removeAttribute(ROOT_ATTRIBUTE);
      document.querySelectorAll('[' + GENERATED_ATTRIBUTE + ']').forEach((node) => node.remove());
      document.querySelectorAll('.' + PRIMARY_CLASS + ', .' + SECONDARY_CLASS).forEach((node) => {
        node.classList.remove(PRIMARY_CLASS, SECONDARY_CLASS);
      });
    }
  }

  function updateSettings(settings) {
    // Discard generated labels when a nickname changes instead of stacking them.
    if (enabled) setEnabled(false);
    nicknames = new Map(
      (Array.isArray(settings.userNicknames) ? settings.userNicknames : [])
        .filter((entry) => entry && entry.username && entry.nickname)
        .map((entry) => [String(entry.username).toLowerCase(), plainText(entry.nickname)]),
    );
    setEnabled(settings[SETTING_KEY]);
  }

  chrome.storage.local.get({
    [SETTING_KEY]: false,
    userNicknames: [],
  }).then(updateSettings);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !([SETTING_KEY, 'userNicknames'].some((key) => key in changes))) return;
    void chrome.storage.local.get({
      [SETTING_KEY]: false,
      userNicknames: [],
    }).then(updateSettings);
  });

  document.addEventListener('turbo:load', scheduleScan);
  document.addEventListener('pjax:end', scheduleScan);
})();