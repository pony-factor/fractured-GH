(async () => {
  'use strict';

  const ENABLED_KEY = 'userNicknamesEnabled';
  const MAPPINGS_KEY = 'userNicknames';
  const CONVERSATION_FIRST_NAMES_KEY = 'conversationFirstNamesEnabled';
  const NICKNAME_ATTR = 'data-fractured-user-nickname';
  const CONVERSATION_NAME_ATTR = 'data-fractured-conversation-first-name';
  const ORIGINAL_TEXT_ATTR = 'data-fractured-original-username-text';
  const ORIGINAL_ATTR_PREFIX = 'data-fractured-original-';
  const NO_ATTRIBUTE = '__fractured_none__';
  const DISPLAY_ATTRIBUTES = ['title', 'aria-label', 'alt'];
  const HOVERCARD_ATTRIBUTES = [
    'data-hovercard-type',
    'data-hovercard-url',
    'data-hovercard-subject-tag',
  ];
  const CONVERSATION_BODY_SELECTOR = [
    '[data-testid="issue-body"]',
    '[data-testid="pull-request-body"]',
    '[data-testid="comment-body"]',
    '[data-testid="comment-content"]',
    '[data-testid="discussion-body"]',
    '[data-testid="discussion-comment-body"]',
    '.comment-body',
    '.markdown-body',
  ].join(',');

  const CONVERSATION_CONTAINER_SELECTOR = [
    '[data-testid="issue-body-container"]',
    '[data-testid="comment"]',
    '[data-testid="comment-container"]',
    '[data-testid="timeline-comment"]',
    '[data-testid="discussion-comment"]',
    '[data-testid="discussion-comment-container"]',
    '.js-comment',
    '.timeline-comment',
    '.review-comment',
    '.js-timeline-item',
    'article',
  ].join(',');

  const CONVERSATION_AUTHOR_SELECTOR = [
    'a.author[href]',
    'a[data-testid="author-link"][href]',
    'a[data-hovercard-type="user"].author[href]',
  ].join(',');

  const PROFILE_DISPLAY_NAME_SELECTOR = [
    '[itemprop="name"]',
    '[data-testid="profile-name"]',
    '.p-name',
  ].join(',');

  const HOVERCARD_CONTAINER_SELECTOR = [
    '.js-hovercard-content',
    '[data-testid*="hovercard" i]',
    '[data-test-selector*="hovercard" i]',
    '.Popover-message',
  ].join(',');

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
  let nicknameReplacementEnabled = false;
  let conversationFirstNamesEnabled = false;
  let nicknameByUsername = new Map();
  const profileDisplayNameCache = new Map();
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

  function firstWord(value) {
    return normalizeNickname(value).split(/\s+/)[0] || '';
  }

  function isConversationPage() {
    return /^\/[^/]+\/[^/]+\/(?:issues|pull|discussions|commit)(?:\/|$)/i.test(location.pathname)
      || /^\/orgs\/[^/]+\/discussions(?:\/|$)/i.test(location.pathname);
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

  function commitAuthorFromLink(link) {
    if (!(link instanceof HTMLAnchorElement)) return '';
    try {
      const url = new URL(link.getAttribute('href') || '', location.origin);
      if (url.origin !== location.origin
        || !/^\/[^/]+\/[^/]+\/commits(?:\/|$)/i.test(url.pathname)) return '';
      return normalizeUsername(url.searchParams.get('author'));
    } catch {
      return '';
    }
  }

  function usernameFromLink(link) {
    if (!(link instanceof HTMLAnchorElement)) return '';

    const hovercardUrl = link.getAttribute('data-hovercard-url') || '';
    const hovercardMatch = hovercardUrl.match(/\/users\/([^/?#]+)\/hovercard/i);
    if (hovercardMatch?.[1]) {
      try {
        return normalizeUsername(decodeURIComponent(hovercardMatch[1]));
      } catch {
        return normalizeUsername(hovercardMatch[1]);
      }
    }

    try {
      const url = new URL(link.getAttribute('href') || '', location.origin);
      if (url.origin !== location.origin) return '';

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) return commitAuthorFromLink(link);

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
      const pattern = new RegExp(`(^|[^A-Za-z0-9-])(@?${usernamePattern})(?![A-Za-z0-9-])`, 'gi');
      nextValue = nextValue.replace(pattern, (_match, prefix, account) => (
        `${prefix}${account.startsWith('@') ? `@${mapping.nickname}` : mapping.nickname}`
      ));
    }

    return nextValue;
  }

  function replaceUsernameWithDisplayName(value, username, displayName) {
    const usernamePattern = escapeRegExp(username);
    const pattern = new RegExp(`(^|[^A-Za-z0-9-])@?${usernamePattern}(?![A-Za-z0-9-])`, 'gi');
    return String(value || '').replace(pattern, (_match, prefix) => `${prefix}${displayName}`);
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
    if (
      root instanceof Element
      && (root.hasAttribute(NICKNAME_ATTR) || root.hasAttribute(CONVERSATION_NAME_ATTR))
    ) {
      spans.push(root);
    }
    root.querySelectorAll?.(
      `[${NICKNAME_ATTR}], [${CONVERSATION_NAME_ATTR}]`,
    ).forEach((span) => spans.push(span));
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

  function replaceTextNodeContents(node, replacementText) {
    if (!(node instanceof Text)) return;

    const originalText = node.textContent || '';
    const replacement = document.createElement('span');
    replacement.setAttribute(NICKNAME_ATTR, 'text');
    replacement.setAttribute(ORIGINAL_TEXT_ATTR, originalText);
    replacement.textContent = replacementText;
    node.replaceWith(replacement);
  }

  function replaceConversationTextNode(node, username, firstName) {
    if (!(node instanceof Text)) return;

    const originalText = node.textContent || '';
    const replacement = document.createElement('span');
    replacement.setAttribute(CONVERSATION_NAME_ATTR, username);
    replacement.setAttribute(ORIGINAL_TEXT_ATTR, originalText);
    replacement.textContent = renderedNickname(originalText, firstName);
    node.replaceWith(replacement);
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

  function matchingExactTextNode(root, value) {
    if (!(root instanceof Element) || !value) return null;

    const expected = normalizeNickname(value).toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest(`[${NICKNAME_ATTR}]`)) continue;
      if (normalizeNickname(node.textContent).toLowerCase() === expected) return node;
    }

    return null;
  }

  function isIssueOrPullCommentAuthor(link) {
    if (!(link instanceof HTMLAnchorElement)) return false;
    if (!/^\/[^/]+\/[^/]+\/(?:issues|pull)\/[^/]+(?:\/|$)/i.test(location.pathname)) {
      return false;
    }

    return link.matches(CONVERSATION_AUTHOR_SELECTOR);
  }

  async function applyNicknameToProfileLink(link) {
    if (!enabled || !nicknameReplacementEnabled || !(link instanceof HTMLAnchorElement)) return;

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

    const displayName = await fetchedProfileDisplayName(username);
    if (
      !enabled
      || !nicknameReplacementEnabled
      || !link.isConnected
      || usernameFromLink(link).toLowerCase() !== username.toLowerCase()
    ) {
      return;
    }

    const current = link.querySelector(`[${NICKNAME_ATTR}]`);
    if (current) {
      const originalText = current.getAttribute(ORIGINAL_TEXT_ATTR) ?? current.textContent ?? '';
      const nextText = renderedNickname(originalText, mapping.nickname);
      if (current.textContent !== nextText) current.textContent = nextText;
      return;
    }

    const displayNameNode = matchingExactTextNode(link, displayName);
    if (displayNameNode) {
      replaceTextNode(displayNameNode, {
        username,
        nickname: mapping.nickname,
      });
      return;
    }

    const hovercard = link.closest(HOVERCARD_CONTAINER_SELECTOR);
    const hovercardDisplayNameNode = hovercard
      ? matchingExactTextNode(hovercard, displayName)
      : null;
    if (hovercardDisplayNameNode) {
      replaceTextNode(hovercardDisplayNameNode, {
        username,
        nickname: mapping.nickname,
      });
      return;
    }

    if (!isIssueOrPullCommentAuthor(link)) return;

    const textNode = matchingTextNode(link, username);
    if (textNode) {
      replaceTextNode(textNode, {
        username,
        nickname: mapping.nickname,
      });
    }
  }

  function isConversationIdentity(link, username) {
    if (!conversationFirstNamesEnabled) return false;
    if (!(link instanceof HTMLAnchorElement) || !username) return false;

    if (commitAuthorFromLink(link).toLowerCase() === username.toLowerCase()) return true;
    if (!isConversationPage()) return false;

    const visible = (link.textContent || '').trim().replace(/^@/, '').toLowerCase();
    const exactHandle = visible === username.toLowerCase();
    const isBodyMention = Boolean(link.closest(CONVERSATION_BODY_SELECTOR))
      && (
        exactHandle
        || link.classList.contains('user-mention')
        || link.matches('[data-hovercard-type="user"]')
        || Boolean(link.querySelector(`[${NICKNAME_ATTR}]`))
      );

    const isAuthor = link.matches(CONVERSATION_AUTHOR_SELECTOR)
      || (exactHandle && Boolean(link.closest(CONVERSATION_CONTAINER_SELECTOR)));

    return isBodyMention || isAuthor;
  }

  async function fetchedProfileDisplayName(username) {
    const key = username.toLowerCase();
    if (profileDisplayNameCache.has(key)) return profileDisplayNameCache.get(key);

    const pending = (async () => {
      try {
        const response = await fetch(`/${encodeURIComponent(username)}`, {
          credentials: 'same-origin',
          headers: { Accept: 'text/html' },
        });
        if (!response.ok) return '';

        const documentText = await response.text();
        const profileDocument = new DOMParser().parseFromString(documentText, 'text/html');
        const displayName = profileDocument
          .querySelector(PROFILE_DISPLAY_NAME_SELECTOR)
          ?.textContent
          ?.trim();

        if (displayName) return normalizeNickname(displayName);

        const title = profileDocument.querySelector('title')?.textContent?.trim() || '';
        const escapedUsername = escapeRegExp(username);
        const titleMatch = title.match(new RegExp(
          `^(.+?)\\s+\\(@?${escapedUsername}\\)\\s+·\\s+GitHub$`,
          'i',
        ));
        return normalizeNickname(titleMatch?.[1]);
      } catch {
        return '';
      }
    })();

    profileDisplayNameCache.set(key, pending);
    return pending;
  }

  async function fetchedProfileFirstName(username) {
    return firstWord(await fetchedProfileDisplayName(username));
  }

  async function firstNameForUser(username) {
    const mapping = nicknameByUsername.get(username.toLowerCase());
    const nicknameFirstName = firstWord(mapping?.nickname);
    if (nicknameFirstName) return nicknameFirstName;
    return fetchedProfileFirstName(username);
  }

  function replaceConversationAttributes(link, username, firstName) {
    for (const element of [link, ...link.querySelectorAll('*')]) {
      for (const attribute of DISPLAY_ATTRIBUTES) {
        if (!element.hasAttribute(attribute)) continue;
        const current = element.getAttribute(attribute) || '';
        const replacement = replaceUsernameWithDisplayName(current, username, firstName);
        if (replacement === current) continue;
        rememberAttribute(element, attribute);
        element.setAttribute(attribute, replacement);
      }
    }
  }

  async function applyConversationFirstName(link) {
    if (!enabled || !conversationFirstNamesEnabled || !(link instanceof HTMLAnchorElement)) return;

    const username = usernameFromLink(link);
    if (!isConversationIdentity(link, username)) return;

    const firstName = await firstNameForUser(username);
    if (
      !firstName
      || !enabled
      || !conversationFirstNamesEnabled
      || !link.isConnected
      || usernameFromLink(link).toLowerCase() !== username.toLowerCase()
    ) {
      return;
    }

    const existing = link.querySelector(`[${CONVERSATION_NAME_ATTR}]`);
    if (existing) {
      const originalText = existing.getAttribute(ORIGINAL_TEXT_ATTR) ?? existing.textContent ?? '';
      const nextText = renderedNickname(originalText, firstName);
      if (existing.textContent !== nextText) existing.textContent = nextText;
    } else {
      const nicknameSpan = link.querySelector(`[${NICKNAME_ATTR}]`);
      if (nicknameSpan) {
        const originalText = nicknameSpan.getAttribute(ORIGINAL_TEXT_ATTR) ?? '';
        nicknameSpan.textContent = renderedNickname(originalText, firstName);
      } else {
        const textNode = matchingTextNode(link, username)
          || [...link.childNodes].find((node) => node instanceof Text && node.textContent?.trim());
        if (textNode instanceof Text) replaceConversationTextNode(textNode, username, firstName);
      }
    }

    replaceConversationAttributes(link, username, firstName);
  }

  async function applyNicknameToCurrentProfile() {
    if (!enabled || !nicknameReplacementEnabled) return;

    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return;

    let username = '';
    try {
      username = normalizeUsername(decodeURIComponent(parts[0]));
    } catch {
      username = normalizeUsername(parts[0]);
    }

    const mapping = nicknameByUsername.get(username.toLowerCase());
    if (!mapping) return;

    const displayName = await fetchedProfileDisplayName(username);
    if (!displayName || !enabled || !nicknameReplacementEnabled) return;

    for (const element of document.querySelectorAll(PROFILE_DISPLAY_NAME_SELECTOR)) {
      const existing = element.querySelector(`[${NICKNAME_ATTR}]`);
      if (existing) {
        const originalText = existing.getAttribute(ORIGINAL_TEXT_ATTR) ?? existing.textContent ?? '';
        const nextText = renderedNickname(originalText, mapping.nickname);
        if (existing.textContent !== nextText) existing.textContent = nextText;
        continue;
      }

      const textNode = matchingExactTextNode(element, displayName);
      if (!textNode) continue;

      replaceTextNode(textNode, {
        username,
        nickname: mapping.nickname,
      });
    }
  }

  function replaceStandaloneUsernameText(root) {
    if (!nicknameReplacementEnabled) return;

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

      const originalText = node.textContent || '';
      const replacementText = replaceMappedUsernames(originalText);
      if (replacementText !== originalText) {
        matches.push({ node, replacementText });
      }
    }

    for (const { node, replacementText } of matches) {
      if (node.isConnected) replaceTextNodeContents(node, replacementText);
    }
  }

  function replaceVisibleAttributes(root) {
    if (!nicknameReplacementEnabled) return;

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

    if (root instanceof HTMLAnchorElement) {
      void applyNicknameToProfileLink(root);
      void applyConversationFirstName(root);
    }

    if (
      root instanceof Document
      || root instanceof DocumentFragment
      || root instanceof Element
    ) {
      for (const link of root.querySelectorAll('a[href]')) {
        void applyNicknameToProfileLink(link);
        void applyConversationFirstName(link);
      }
    }

    void applyNicknameToCurrentProfile();
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
          const link = element instanceof HTMLAnchorElement ? element : element.closest?.('a[href]');
          void applyNicknameToProfileLink(link);
          void applyConversationFirstName(link);
          continue;
        }

        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          const link = parent?.closest('a[href]');
          void applyNicknameToProfileLink(link);
          void applyConversationFirstName(link);
          processTree(parent || document);
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node instanceof Element || node instanceof DocumentFragment) {
            processTree(node);
          } else if (node instanceof Text) {
            processTree(node.parentElement || document);
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
      [CONVERSATION_FIRST_NAMES_KEY]: false,
    });

    const nextMappings = mappingFromSettings(settings[MAPPINGS_KEY]);
    const nextNicknameReplacementEnabled = Boolean(settings[ENABLED_KEY]);
    const nextConversationFirstNamesEnabled = Boolean(settings[CONVERSATION_FIRST_NAMES_KEY]);
    const shouldRun = nextNicknameReplacementEnabled || nextConversationFirstNamesEnabled;

    if (enabled) restoreNicknames();
    nicknameByUsername = nextMappings;
    nicknameReplacementEnabled = nextNicknameReplacementEnabled;
    conversationFirstNamesEnabled = nextConversationFirstNamesEnabled;

    if (shouldRun) start();
    else stop();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName !== 'local'
      || (
        !(ENABLED_KEY in changes)
        && !(MAPPINGS_KEY in changes)
        && !(CONVERSATION_FIRST_NAMES_KEY in changes)
      )
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
