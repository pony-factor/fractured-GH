(async () => {
  'use strict';

  const ENABLED_KEY = 'userNicknamesEnabled';
  const MAPPINGS_KEY = 'userNicknames';
  const NICKNAME_ATTR = 'data-fractured-user-nickname';
  const ORIGINAL_TEXT_ATTR = 'data-fractured-original-username-text';
  const ORIGINAL_ATTR_PREFIX = 'data-fractured-original-';
  const NO_ATTRIBUTE = '__fractured_none__';
  const DISPLAY_ATTRIBUTES = ['title', 'aria-label', 'alt'];
  const HOVERCARD_ATTRIBUTES = [
    'data-hovercard-type',
    'data-hovercard-url',
    'data-hovercard-subject-tag',
  ];
  const EXCLUDED_TEXT_CONTAINERS = [
    'script',
    'style',
    'textarea',
    'input',
    'pre',
    'code',
    'kbd',
    'samp',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
  ].join(',');

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

  function nicknameForExactText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;

    const hadAt = trimmed.startsWith('@');
    const username = normalizeUsername(trimmed);
    const mapping = nicknameByUsername.get(username.toLowerCase());
    if (!mapping) return null;

    return {
      username: mapping.username,
      nickname: `${hadAt ? '@' : ''}${mapping.nickname}`,
    };
  }

  function renderedNickname(originalText, nickname) {
    const leading = originalText.match(/^\s*/)?.[0] || '';
    const trailing = originalText.match(/\s*$/)?.[0] || '';
    return `${leading}${nickname}${trailing}`;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function replaceMappedUsernames(value) {
    let nextValue = String(value || '');

    for (const mapping of nicknameByUsername.values()) {
      const usernamePattern = escapeRegExp(mapping.username);
      const pattern = new RegExp(`@?${usernamePattern}(?![A-Za-z0-9-])`, 'gi');
      nextValue = nextValue.replace(pattern, (match) => (
        match.startsWith('@') ? `@${mapping.nickname}` : mapping.nickname
      ));
    }

    return nextValue;
  }

  function originalAttributeMarker(attribute) {
    return `${ORIGINAL_ATTR_PREFIX}${attribute.replace(/[^a-z0-9-]/gi, '-')}`;
  }

  function rememberAttribute(element, attribute) {
    const marker = originalAttributeMarker(attribute);
    if (element.hasAttribute(marker)) return;

    element.setAttribute(
      marker,
      element.hasAttribute(attribute) ? element.getAttribute(attribute) : NO_ATTRIBUTE,
    );
  }

  function restoreAttribute(element, attribute) {
    const marker = originalAttributeMarker(attribute);
    if (!element.hasAttribute(marker)) return;

    const original = element.getAttribute(marker);
    if (original === NO_ATTRIBUTE) element.removeAttribute(attribute);
    else element.setAttribute(attribute, original || '');
    element.removeAttribute(marker);
  }

  function replaceDisplayAttributes(element) {
    if (!(element instanceof Element)) return;

    for (const attribute of DISPLAY_ATTRIBUTES) {
      if (!element.hasAttribute(attribute)) continue;

      const current = element.getAttribute(attribute) || '';
      const replacement = replaceMappedUsernames(current);
      if (replacement === current) continue;

      rememberAttribute(element, attribute);
      element.setAttribute(attribute, replacement);
    }
  }

  function suppressHovercard(link) {
    for (const attribute of HOVERCARD_ATTRIBUTES) {
      if (!link.hasAttribute(attribute)) continue;
      rememberAttribute(link, attribute);
      link.removeAttribute(attribute);
    }
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

    const all = [];
    if (root instanceof Element) all.push(root);
    root.querySelectorAll?.('*').forEach((element) => all.push(element));

    for (const element of all) {
      for (const attribute of [...DISPLAY_ATTRIBUTES, ...HOVERCARD_ATTRIBUTES]) {
        restoreAttribute(element, attribute);
      }
    }
  }

  function replaceTextNode(node, mapping) {
    if (!(node instanceof Text)) return;

    const originalText = node.textContent || '';
    const nickname = document.createElement('span');
    nickname.setAttribute(NICKNAME_ATTR, mapping.username);
    nickname.setAttribute(ORIGINAL_TEXT_ATTR, originalText);
    nickname.textContent = renderedNickname(originalText, mapping.nickname);
    node.replaceWith(nickname);
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

  function applyNicknameToProfileLink(link) {
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
      const prefix = originalText.trim().startsWith('@') ? '@' : '';
      const nextText = renderedNickname(originalText, `${prefix}${mapping.nickname}`);
      if (current.textContent !== nextText) current.textContent = nextText;
    } else {
      const textNode = matchingTextNode(link, username);
      if (textNode) {
        replaceTextNode(textNode, {
          username,
          nickname: `${(textNode.textContent || '').trim().startsWith('@') ? '@' : ''}${mapping.nickname}`,
        });
      }
    }

    replaceDisplayAttributes(link);
    link.querySelectorAll('*').forEach(replaceDisplayAttributes);
    suppressHovercard(link);
  }

  function replaceStandaloneUsernameText(root) {
    let walkerRoot = null;

    if (root instanceof Document) {
      walkerRoot = root.body || root.documentElement;
    } else if (root instanceof DocumentFragment || root instanceof Element) {
      walkerRoot = root;
    }

    if (!walkerRoot) return;

    const matches = [];
    const walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest(`[${NICKNAME_ATTR}]`)) continue;
      if (parent.closest(EXCLUDED_TEXT_CONTAINERS)) continue;

      const mapping = nicknameForExactText(node.textContent);
      if (mapping) matches.push({ node, mapping });
    }

    for (const { node, mapping } of matches) {
      if (node.isConnected) replaceTextNode(node, mapping);
    }
  }

  function replaceVisibleAttributes(root) {
    if (root instanceof Element) replaceDisplayAttributes(root);

    if (
      root instanceof Document
      || root instanceof DocumentFragment
      || root instanceof Element
    ) {
      for (const element of root.querySelectorAll('[title], [aria-label], [alt]')) {
        replaceDisplayAttributes(element);
      }
    }
  }

  function processTree(root = document) {
    if (!enabled) return;

    if (root instanceof HTMLAnchorElement) applyNicknameToProfileLink(root);

    if (
      root instanceof Document
      || root instanceof DocumentFragment
      || root instanceof Element
    ) {
      for (const link of root.querySelectorAll('a[href]')) {
        applyNicknameToProfileLink(link);
      }
    }

    replaceStandaloneUsernameText(root);
    replaceVisibleAttributes(root);
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
          const element = mutation.target;
          applyNicknameToProfileLink(element instanceof HTMLAnchorElement ? element : element.closest?.('a[href]'));
          replaceDisplayAttributes(element);
          continue;
        }

        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          applyNicknameToProfileLink(parent?.closest('a[href]'));
          replaceStandaloneUsernameText(parent || document);
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node instanceof Element || node instanceof DocumentFragment) {
            processTree(node);
          } else if (node instanceof Text) {
            replaceStandaloneUsernameText(node.parentElement || document);
          }
        }
      }
    });
  }

  function start() {
    enabled = true;
    ensureObserver();
    observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'href',
        'title',
        'aria-label',
        'alt',
        ...HOVERCARD_ATTRIBUTES,
      ],
    });
    processTree();
  }

  function stop() {
    enabled = false;
    observer?.disconnect();
    restoreNicknames();
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
