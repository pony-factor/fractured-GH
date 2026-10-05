(async () => {
  'use strict';

  const ENABLED_KEY = 'userNicknamesEnabled';
  const MAPPINGS_KEY = 'userNicknames';
  const NICKNAME_ATTR = 'data-fractured-user-nickname';
  const ORIGINAL_TEXT_ATTR = 'data-fractured-original-username-text';
  const REAL_USERNAME_ATTR = 'data-fractured-real-username';
  const LINK_ATTR = 'data-fractured-nickname-link';
  const STYLE_ID = 'fractured-user-nicknames-style';

  let enabled = false;
  let nicknameByUsername = new Map();
  let observer = null;
  let refreshQueued = false;

  function normalizeUsername(value) {
    return String(value || '')
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/^@+/, '')
      .replace(/\/+$/, '')
      .replace(/\s+/g, '');
  }

  function normalizeNickname(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function mappingFromSettings(value) {
    const mappings = new Map();

    if (!Array.isArray(value)) return mappings;

    for (const entry of value) {
      const username = normalizeUsername(entry?.username);
      const nickname = normalizeNickname(entry?.nickname);
      if (!username || !nickname) continue;
      mappings.set(username.toLowerCase(), { username, nickname });
    }

    return mappings;
  }

  function usernameFromLink(link) {
    if (!(link instanceof HTMLAnchorElement)) return '';

    try {
      const url = new URL(link.getAttribute('href') || '', location.origin);
      if (url.origin !== location.origin) return '';

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) return '';

      return normalizeUsername(decodeURIComponent(parts[0]));
    } catch {
      return '';
    }
  }

  function renderedNickname(originalText, nickname) {
    const leading = originalText.match(/^\s*/)?.[0] || '';
    const trailing = originalText.match(/\s*$/)?.[0] || '';
    const trimmed = originalText.trim();
    const prefix = trimmed.startsWith('@') ? '@' : '';
    return `${leading}${prefix}${nickname}${trailing}`;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${NICKNAME_ATTR}] {
        position: relative;
      }

      [${NICKNAME_ATTR}]:hover::after,
      a[${LINK_ATTR}]:focus-visible [${NICKNAME_ATTR}]::after {
        content: attr(${REAL_USERNAME_ATTR});
        position: absolute;
        left: 50%;
        bottom: calc(100% + 6px);
        z-index: 2147483647;
        transform: translateX(-50%);
        width: max-content;
        max-width: 280px;
        padding: 5px 7px;
        border: 1px solid var(--borderColor-default, var(--color-border-default, #d0d7de));
        border-radius: 6px;
        background: var(--bgColor-emphasis, var(--color-neutral-emphasis-plus, #24292f));
        color: var(--fgColor-onEmphasis, var(--color-fg-on-emphasis, #ffffff));
        box-shadow: var(--shadow-resting-small, 0 1px 3px rgba(31, 35, 40, 0.12));
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: nowrap;
        pointer-events: none;
      }
    `;

    (document.head || document.documentElement)?.append(style);
  }

  function restoreSpan(span) {
    const originalText = span.getAttribute(ORIGINAL_TEXT_ATTR);
    span.replaceWith(document.createTextNode(originalText ?? span.textContent ?? ''));
  }

  function restoreNicknames(root = document) {
    if (
      !(root instanceof Document)
      && !(root instanceof DocumentFragment)
      && !(root instanceof Element)
    ) {
      return;
    }

    const spans = [];
    if (root instanceof Element && root.hasAttribute(NICKNAME_ATTR)) spans.push(root);
    root.querySelectorAll?.(`[${NICKNAME_ATTR}]`).forEach((span) => spans.push(span));
    for (const span of spans) restoreSpan(span);

    const links = [];
    if (root instanceof Element && root.matches(`a[${LINK_ATTR}]`)) links.push(root);
    root.querySelectorAll?.(`a[${LINK_ATTR}]`).forEach((link) => links.push(link));
    for (const link of links) link.removeAttribute(LINK_ATTR);
  }

  function matchingTextNode(link, username) {
    const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
    const usernameKey = username.toLowerCase();

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest(`[${NICKNAME_ATTR}]`)) continue;

      const trimmed = (node.textContent || '').trim();
      const candidate = trimmed.replace(/^@/, '').toLowerCase();
      if (candidate === usernameKey) return node;
    }

    return null;
  }

  function applyNickname(link) {
    if (!enabled || !(link instanceof HTMLAnchorElement)) return;

    const username = usernameFromLink(link);
    const mapping = nicknameByUsername.get(username.toLowerCase());
    const existing = link.querySelector(`[${NICKNAME_ATTR}]`);

    if (
      existing
      && (
        !username
        || !mapping
        || existing.getAttribute(NICKNAME_ATTR)?.toLowerCase() !== username.toLowerCase()
      )
    ) {
      restoreNicknames(link);
    }

    if (!username || !mapping) return;

    const current = link.querySelector(`[${NICKNAME_ATTR}]`);
    if (current) {
      const originalText = current.getAttribute(ORIGINAL_TEXT_ATTR) ?? current.textContent ?? '';
      const nextText = renderedNickname(originalText, mapping.nickname);
      if (current.textContent !== nextText) current.textContent = nextText;
      current.setAttribute(REAL_USERNAME_ATTR, `@${username}`);
      link.setAttribute(LINK_ATTR, username);
      return;
    }

    const textNode = matchingTextNode(link, username);
    if (!textNode) return;

    const originalText = textNode.textContent || '';
    const nickname = document.createElement('span');
    nickname.setAttribute(NICKNAME_ATTR, username);
    nickname.setAttribute(ORIGINAL_TEXT_ATTR, originalText);
    nickname.setAttribute(REAL_USERNAME_ATTR, `@${username}`);
    nickname.textContent = renderedNickname(originalText, mapping.nickname);

    textNode.replaceWith(nickname);
    link.setAttribute(LINK_ATTR, username);
  }

  function processTree(root = document) {
    if (!enabled) return;

    if (root instanceof HTMLAnchorElement) applyNickname(root);

    if (
      root instanceof Document
      || root instanceof DocumentFragment
      || root instanceof Element
    ) {
      for (const link of root.querySelectorAll('a[href]')) {
        applyNickname(link);
      }
    }
  }

  function queueRefresh() {
    if (!enabled || refreshQueued) return;

    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      processTree();
    });
  }

  function ensureObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (!enabled) return;

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          applyNickname(mutation.target);
          continue;
        }

        if (mutation.type === 'characterData') {
          applyNickname(mutation.target.parentElement?.closest('a[href]'));
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node instanceof Element || node instanceof DocumentFragment) {
            processTree(node);
          }
        }
      }
    });
  }

  function start() {
    enabled = true;
    ensureStyle();
    ensureObserver();
    observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href'],
    });
    processTree();
  }

  function stop() {
    enabled = false;
    observer?.disconnect();
    restoreNicknames();
    document.getElementById(STYLE_ID)?.remove();
  }

  async function loadSettings() {
    const settings = await chrome.storage.local.get({
      [ENABLED_KEY]: true,
      [MAPPINGS_KEY]: [],
    });

    const nextMappings = mappingFromSettings(settings[MAPPINGS_KEY]);
    const shouldEnable = Boolean(settings[ENABLED_KEY]);

    if (enabled) restoreNicknames();
    nicknameByUsername = nextMappings;

    if (shouldEnable) start();
    else stop();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName !== 'local'
      || (!(ENABLED_KEY in changes) && !(MAPPINGS_KEY in changes))
    ) {
      return;
    }

    void loadSettings();
  });

  document.addEventListener('turbo:load', queueRefresh);
  document.addEventListener('pjax:end', queueRefresh);
  window.addEventListener('popstate', queueRefresh);

  await loadSettings();
})();
