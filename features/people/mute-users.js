(async () => {
  'use strict';

  const DEFAULT_MUTED_USERS = [];
  const settings = await chrome.storage.local.get({
    muteUsersEnabled: true,
    mutedUsers: DEFAULT_MUTED_USERS,
  });
  if (!settings.muteUsersEnabled) return;

  const MUTED_USERS = new Set(
    (Array.isArray(settings.mutedUsers) ? settings.mutedUsers : DEFAULT_MUTED_USERS)
      .map((username) => String(username).trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean),
  );
  if (MUTED_USERS.size === 0) return;

  const PROCESSED_ATTR = 'data-gh-muted-user-processed';
  const AVATAR_PROCESSED_ATTR = 'data-gh-muted-avatar-processed';
  const CONTENT_REVEALED_ATTR = 'data-gh-muted-content-revealed';
  const MUTED_PAGE_ATTR = 'data-gh-muted-page';
  const MUTED_REPOSITORY_ATTR = 'data-gh-muted-repository';
  const REPOSITORY_REVEALED_ATTR = 'data-gh-muted-repository-revealed';
  const MUTED_CONTENT_CLASS = 'gh-muted-user-content';
  const MUTED_OVERLAY_CLASS = 'gh-muted-user-overlay';
  const PLACEHOLDER_CLASS = 'gh-muted-user-placeholder';
  const MUTED_PAGE_NOTICE_CLASS = 'gh-muted-page-notice';
  const STYLE_ID = 'gh-muted-users-style';

  const CONTENT_BODY_SELECTOR = [
    '.markdown-body',
    '[data-testid="issue-body"]',
    '[data-testid="pull-request-body"]',
    '[data-testid="comment-body"]',
    '[data-testid="comment-content"]',
    '[data-testid="discussion-body"]',
    '[data-testid="discussion-comment-body"]',
  ].join(',');

  const PROFILE_LINK_SELECTOR = [
    'a.author[href^="/"]',
    'a[data-hovercard-type="user"][href^="/"]',
  ].join(',');

  const ISSUE_PR_ITEM_SELECTORS = [
    '[data-testid="issue-body-container"]',
    '[data-testid="comment"]',
    '[data-testid="comment-container"]',
    '[data-testid="timeline-comment"]',
    '.js-comment',
    '.timeline-comment',
    '.review-comment',
    'article',
  ];

  const ISSUE_PR_LIST_SELECTORS = [
    '[data-testid="issue-list-item"]',
    '[data-testid="issue-row"]',
    '[data-testid="pull-request-row"]',
    '.js-issue-row',
    '.Box-row',
  ];

  const DISCUSSION_ITEM_SELECTORS = [
    '[data-testid="discussion-comment"]',
    '[data-testid="discussion-comment-container"]',
    '[data-testid="comment"]',
    '[data-testid="comment-container"]',
    '.js-discussion-comment',
    '.discussion-comment',
    '.js-comment',
    '.timeline-comment',
    'article',
    '[data-testid="discussion-list-item"]',
    '[data-testid="discussion-row"]',
    '.Box-row',
  ];

  const REPOSITORY_COMMIT_SELECTORS = [
    '[data-testid="latest-commit-details"]',
  ];

  const OVERLAY_SELECTORS = [
    '.Popover',
    '[role="tooltip"]',
    '[data-testid*="hovercard" i]',
  ];

  const STANDARD_AUTHOR_SELECTORS = [
    'a.author[href^="/"]',
    'a.Link--primary.author[href^="/"]',
    'a[data-hovercard-type="user"].author[href^="/"]',
    '.timeline-comment-header a[href^="/"][data-hovercard-type="user"]',
    '.TimelineItem-badge + .TimelineItem-body a.author[href^="/"]',
    '[data-testid="comment-header"] a[href^="/"][data-hovercard-type="user"]',
  ];

  const STANDARD_CONTAINER_SELECTORS = [
    '.js-comment',
    '.timeline-comment',
    '.review-comment',
    '.js-inline-comments-container',
    '[data-testid="comment"]',
    '[data-testid="comment-container"]',
    'article',
    '.TimelineItem',
    '.Box-row',
    '.js-timeline-item',
  ];

  function normalizeUsernameFromHref(href) {
    if (!href) return null;

    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return null;

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) return null;

      return decodeURIComponent(parts[0]).toLowerCase();
    } catch {
      return null;
    }
  }

  function isIssueOrPullThread() {
    return /^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:\/|$)/i.test(location.pathname);
  }

  function isIssueOrPullList() {
    return /^\/[^/]+\/[^/]+\/(?:issues|pulls)(?:\/|$)/i.test(location.pathname);
  }

  function isDiscussionPage() {
    const path = location.pathname;
    if (/^\/[^/]+\/[^/]+\/discussions(?:\/|$)/i.test(path)) return true;
    return /^\/orgs\/[^/]+\/discussions(?:\/|$)/i.test(path);
  }

  function mutedNamespacePage() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length < 1) return null;

    const username = decodeURIComponent(parts[0]).toLowerCase();
    if (!MUTED_USERS.has(username)) return null;

    return {
      username,
      repository: parts.length >= 2 ? decodeURIComponent(parts[1]) : null,
    };
  }

  function repositoryStorageKey(page) {
    return `gh-muted-repository-revealed:${page.username}/${page.repository.toLowerCase()}`;
  }

  function repositoryIsRevealed(page) {
    if (!page?.repository) return false;

    try {
      return sessionStorage.getItem(repositoryStorageKey(page)) === '1';
    } catch {
      return false;
    }
  }

  function setRepositoryRevealed(page, revealed) {
    if (!page?.repository) return;

    try {
      if (revealed) {
        sessionStorage.setItem(repositoryStorageKey(page), '1');
      } else {
        sessionStorage.removeItem(repositoryStorageKey(page));
      }
    } catch {
      // Persistence across navigation is optional.
    }

    if (revealed) {
      document.documentElement.setAttribute(REPOSITORY_REVEALED_ATTR, 'true');
    } else {
      document.documentElement.removeAttribute(REPOSITORY_REVEALED_ATTR);
    }
  }

  function updateMutedPageFlag() {
    if (!document.documentElement) return null;

    const page = mutedNamespacePage();
    if (!page) {
      document.documentElement.removeAttribute(MUTED_PAGE_ATTR);
      document.documentElement.removeAttribute(MUTED_REPOSITORY_ATTR);
      document.documentElement.removeAttribute(REPOSITORY_REVEALED_ATTR);
      return null;
    }

    document.documentElement.setAttribute(MUTED_PAGE_ATTR, page.username);

    if (page.repository) {
      document.documentElement.setAttribute(
        MUTED_REPOSITORY_ATTR,
        `${page.username}/${page.repository}`,
      );

      if (repositoryIsRevealed(page)) {
        document.documentElement.setAttribute(REPOSITORY_REVEALED_ATTR, 'true');
      } else {
        document.documentElement.removeAttribute(REPOSITORY_REVEALED_ATTR);
      }
    } else {
      document.documentElement.removeAttribute(MUTED_REPOSITORY_ATTR);
      document.documentElement.removeAttribute(REPOSITORY_REVEALED_ATTR);
    }

    return page;
  }

  function isInsideRenderedContent(link) {
    return Boolean(link.closest(CONTENT_BODY_SELECTOR));
  }

  function mutedUsernameFromLink(link) {
    const username = normalizeUsernameFromHref(link?.getAttribute('href'));
    return username && MUTED_USERS.has(username) ? username : null;
  }

  function mutedAuthorOfContainer(container, requireBody = true) {
    if (!container) return null;

    if (requireBody && !container.querySelector(CONTENT_BODY_SELECTOR)) {
      return null;
    }

    const links = container.querySelectorAll(PROFILE_LINK_SELECTOR);
    for (const link of links) {
      if (isInsideRenderedContent(link)) continue;

      const username = mutedUsernameFromLink(link);
      if (username) return username;
    }

    return null;
  }

  function usernameFromAvatar(image) {
    const alt = (image.getAttribute('alt') || '').trim();
    if (alt.startsWith('@')) {
      const username = alt.slice(1).toLowerCase();
      if (MUTED_USERS.has(username)) return username;
    }

    const profileLink = image.closest('a[href]');
    if (!profileLink) return null;

    return mutedUsernameFromLink(profileLink);
  }

  function hideMutedAvatar(image, username) {
    if (!image || image.hasAttribute(AVATAR_PROCESSED_ATTR)) return;

    image.setAttribute(AVATAR_PROCESSED_ATTR, username);
    image.style.setProperty('display', 'none', 'important');

    const profileLink = image.closest('a[href]');
    if (
      profileLink &&
      normalizeUsernameFromHref(profileLink.getAttribute('href')) === username &&
      profileLink.textContent.trim() === ''
    ) {
      profileLink.style.setProperty('display', 'none', 'important');
    }
  }

  function hideMutedAvatars(root = document) {
    const images = new Set();

    if (root instanceof HTMLImageElement) images.add(root);
    root.querySelectorAll?.('img').forEach((image) => images.add(image));

    for (const image of images) {
      const username = usernameFromAvatar(image);
      if (username) hideMutedAvatar(image, username);
    }
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html[${MUTED_PAGE_ATTR}]:not([${REPOSITORY_REVEALED_ATTR}]) main,
      html[${MUTED_PAGE_ATTR}]:not([${REPOSITORY_REVEALED_ATTR}]) #repository-container-header {
        display: none !important;
      }

      .${MUTED_CONTENT_CLASS}:not([${CONTENT_REVEALED_ATTR}="true"]) {
        display: none !important;
      }

      .${MUTED_OVERLAY_CLASS} {
        display: none !important;
      }

      .${MUTED_PAGE_NOTICE_CLASS} {
        box-sizing: border-box;
        width: min(1012px, calc(100% - 32px));
        margin: 32px auto;
        padding: 16px;
        border: 1px solid var(--borderColor-default, var(--color-border-default, #30363d));
        border-radius: 6px;
        background: var(--bgColor-muted, var(--color-canvas-subtle, #161b22));
        color: var(--fgColor-muted, var(--color-fg-muted, #8b949e));
        font-size: 14px;
        text-align: center;
      }

      .${PLACEHOLDER_CLASS} {
        box-sizing: border-box;
        width: 100%;
        margin: 8px 0;
        padding: 8px 12px;
        border: 1px solid var(--borderColor-default, var(--color-border-default, #d0d7de));
        border-radius: 6px;
        background: var(--bgColor-muted, var(--color-canvas-subtle, #f6f8fa));
        color: var(--fgColor-muted, var(--color-fg-muted, #656d76));
        font-size: 12px;
        line-height: 20px;
      }

      .${MUTED_PAGE_NOTICE_CLASS} button,
      .${PLACEHOLDER_CLASS} button {
        appearance: none;
        margin-left: 8px;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .${MUTED_PAGE_NOTICE_CLASS} button {
        color: var(--fgColor-accent, var(--color-accent-fg, #0969da));
      }

      .${PLACEHOLDER_CLASS} button {
        color: var(--fgColor-muted, var(--color-fg-muted, #656d76));
        font-weight: 400;
      }

      .${MUTED_PAGE_NOTICE_CLASS} button:hover,
      .${PLACEHOLDER_CLASS} button:hover {
        text-decoration: underline;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function suppressMutedNamespace() {
    const page = updateMutedPageFlag();
    let notice = document.querySelector(`.${MUTED_PAGE_NOTICE_CLASS}`);

    if (!page) {
      notice?.remove();
      return;
    }

    const pageKey = page.repository
      ? `${page.username}/${page.repository}`
      : page.username;

    if (notice && notice.getAttribute('data-muted-page') !== pageKey) {
      notice.remove();
      notice = null;
    }

    const main = document.querySelector('main');
    if (!main) return;

    // Keep the existing notice and its focused button across DOM updates.
    if (notice) return;

    if (!notice) {
      notice = document.createElement('div');
      notice.className = MUTED_PAGE_NOTICE_CLASS;
      notice.setAttribute('data-muted-page', pageKey);
      main.before(notice);
    }

    notice.replaceChildren();

    const label = document.createElement('span');
    label.textContent = page.repository
      ? `Muted repository ${page.username}/${page.repository}`
      : `Muted @${page.username}`;
    notice.append(label);

    if (!page.repository) return;

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';

    const updateButton = () => {
      const revealed = document.documentElement.hasAttribute(REPOSITORY_REVEALED_ATTR);
      toggleButton.textContent = revealed ? 'Hide repository' : 'Show repository';
      toggleButton.setAttribute('aria-expanded', String(revealed));
    };

    updateButton();

    toggleButton.addEventListener('click', () => {
      const revealed = document.documentElement.hasAttribute(REPOSITORY_REVEALED_ATTR);
      setRepositoryRevealed(page, !revealed);
      updateButton();
    });

    notice.append(toggleButton);
  }

  function muteContainer(container, username) {
    if (!container || container.hasAttribute(PROCESSED_ATTR)) return;

    container.setAttribute(PROCESSED_ATTR, username);
    container.classList.add(MUTED_CONTENT_CLASS);
    container.removeAttribute(CONTENT_REVEALED_ATTR);

    const placeholder = document.createElement('div');
    placeholder.className = PLACEHOLDER_CLASS;
    placeholder.setAttribute('data-muted-username', username);

    const label = document.createElement('span');
    label.textContent = `Muted @${username}`;

    const showButton = document.createElement('button');
    showButton.type = 'button';

    const updateButton = () => {
      const revealed = container.getAttribute(CONTENT_REVEALED_ATTR) === 'true';
      showButton.textContent = revealed ? 'Hide' : 'Show';
      showButton.setAttribute('aria-expanded', String(revealed));
    };

    updateButton();

    showButton.addEventListener('click', () => {
      const revealed = container.getAttribute(CONTENT_REVEALED_ATTR) === 'true';

      if (revealed) {
        container.removeAttribute(CONTENT_REVEALED_ATTR);
      } else {
        container.setAttribute(CONTENT_REVEALED_ATTR, 'true');
      }

      updateButton();
    });

    placeholder.append(label, showButton);
    container.before(placeholder);
  }

  function elementDepth(element) {
    let depth = 0;
    let current = element;

    while (current?.parentElement) {
      depth += 1;
      current = current.parentElement;
    }

    return depth;
  }

  function collectContainers(root, selectors) {
    const selector = selectors.join(',');
    const containers = new Set();

    if (root.matches?.(selector)) containers.add(root);
    root.querySelectorAll?.(selector).forEach((container) => containers.add(container));

    return [...containers].sort((a, b) => elementDepth(b) - elementDepth(a));
  }

  function muteAuthoredContainers(root, selectors, requireBody) {
    for (const container of collectContainers(root, selectors)) {
      if (container.hasAttribute(PROCESSED_ATTR)) continue;
      if (container.querySelector(`[${PROCESSED_ATTR}]`)) continue;

      const username = mutedAuthorOfContainer(container, requireBody);
      if (username) muteContainer(container, username);
    }
  }

  function muteIssueAndPullThread(root) {
    if (!isIssueOrPullThread()) return;
    muteAuthoredContainers(root, ISSUE_PR_ITEM_SELECTORS, true);
  }

  function muteIssueAndPullList(root) {
    if (!isIssueOrPullList()) return;
    muteAuthoredContainers(root, ISSUE_PR_LIST_SELECTORS, false);
  }

  function muteDiscussions(root) {
    if (!isDiscussionPage()) return;
    muteAuthoredContainers(root, DISCUSSION_ITEM_SELECTORS, false);
  }

  function muteRepositoryCommits(root) {
    muteAuthoredContainers(root, REPOSITORY_COMMIT_SELECTORS, false);
  }

  function hideMutedOverlays(root) {
    for (const overlay of collectContainers(root, OVERLAY_SELECTORS)) {
      if (overlay.classList.contains(MUTED_OVERLAY_CLASS)) continue;

      const username = mutedAuthorOfContainer(overlay, false);
      if (username) {
        overlay.classList.add(MUTED_OVERLAY_CLASS);
        overlay.setAttribute('data-muted-username', username);
      }
    }
  }

  function findClosestContainer(authorLink, selectors) {
    for (const selector of selectors) {
      const container = authorLink.closest(selector);
      if (container) return container;
    }
    return null;
  }

  function muteStandardContent(root) {
    if (isIssueOrPullThread() || isIssueOrPullList() || isDiscussionPage()) return;

    const links = new Set();
    const selector = STANDARD_AUTHOR_SELECTORS.join(',');

    if (root.matches?.(selector)) links.add(root);
    root.querySelectorAll?.(selector).forEach((link) => links.add(link));

    for (const link of links) {
      const username = mutedUsernameFromLink(link);
      if (!username || isInsideRenderedContent(link)) continue;

      const container = findClosestContainer(link, STANDARD_CONTAINER_SELECTORS);
      if (container) muteContainer(container, username);
    }
  }

  function scan(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    addStyles();
    suppressMutedNamespace();
    hideMutedAvatars(root);
    muteIssueAndPullThread(root);
    muteIssueAndPullList(root);
    muteDiscussions(root);
    muteRepositoryCommits(root);
    hideMutedOverlays(root);
    muteStandardContent(root);
  }

  let scanQueued = false;
  let observer = null;

  function scanPage() {
    // Extension-owned placeholders and notices must not schedule another scan.
    observer?.disconnect();
    try {
      scan(document);
    } finally {
      observer?.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;

    requestAnimationFrame(() => {
      scanQueued = false;
      scanPage();
    });
  }

  function start() {
    observer = new MutationObserver(queueScan);
    scanPage();

    document.addEventListener('turbo:load', queueScan);
    document.addEventListener('pjax:end', queueScan);
  }

  function earlyShield() {
    updateMutedPageFlag();
    addStyles();
  }

  if (document.documentElement) {
    earlyShield();
  } else {
    const bootstrapObserver = new MutationObserver(() => {
      if (!document.documentElement) return;
      bootstrapObserver.disconnect();
      earlyShield();
    });

    bootstrapObserver.observe(document, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
