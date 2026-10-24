(() => {
  'use strict';

  const OWN_REVIEW_ATTR = 'data-fractured-own-review';
  const LINKED_ATTR = 'data-fractured-linked-comment';
  const LABEL_CLASS = 'fractured-linked-comment-label';
  const COMMENT_SELECTOR = [
    '.timeline-comment', '.review-comment', '.js-comment',
    '[data-testid="comment"]', '[data-testid="timeline-comment"]',
    '[data-testid="review-comment"]',
  ].join(',');
  const REVIEW_SELECTOR = [
    '.review-comment', '.pull-request-review-comment',
    '[data-testid="review-comment"]',
    '.js-resolvable-timeline-thread-container .timeline-comment',
    '.js-resolvable-timeline-thread-container [data-testid="comment"]',
    '.js-timeline-item:has([id^="pullrequestreview-"])',
    '[id^="pullrequestreview-"]',
  ].join(',');
  const REVIEW_ITEM_SELECTOR = [
    '.js-timeline-item', '.TimelineItem',
    '.js-resolvable-timeline-thread-container',
    '[data-testid="review-thread"]',
  ].join(',');
  const AUTHOR_SELECTOR = [
    '.timeline-comment-header a.author[href]',
    '.review-comment-header a.author[href]',
    '[data-testid="comment-header"] a.author[href]',
    '[data-testid="comment-header"] a[data-hovercard-type="user"][href]',
    '.TimelineItem-body a.author[href]',
    'a.author[href]',
  ].join(',');
  const HEADER_SELECTOR = [
    '.timeline-comment-header', '.review-comment-header',
    '[data-testid="comment-header"]',
  ].join(',');

  let linkedCard = null;
  let pendingRefresh = false;

  function isConversationRoute(pathname) {
    return /^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:\/|$)/i.test(pathname);
  }

  function commentIdFromHash(hash) {
    return /^#(?:issuecomment-\d+|discussion_r\d+|pullrequestreview-\d+|discussioncomment-\d+)$/i.test(hash)
      ? hash.slice(1) : '';
  }

  function authorLogin(link, origin) {
    const href = link?.getAttribute('href');
    if (!href) return '';
    try {
      const url = new URL(href, origin);
      const parts = url.pathname.split('/').filter(Boolean);
      return url.origin === origin && parts.length === 1 && /^[a-z\d-]+$/i.test(parts[0])
        ? parts[0].toLowerCase() : '';
    } catch {
      return '';
    }
  }

  function reviewAuthoredBy(card, login, origin) {
    if (!login) return false;
    for (const author of card.querySelectorAll(AUTHOR_SELECTOR)) {
      if (author.closest('.comment-body, .markdown-body, [data-testid="comment-body"], blockquote')) continue;
      // A review event can contain other reviewers' nested comments. Don't
      // paint the whole event as ours because one nested reply happens to be ours.
      const nearestComment = author.closest(COMMENT_SELECTOR);
      if (nearestComment && nearestComment !== card) continue;
      return authorLogin(author, origin) === login;
    }
    return false;
  }

  function commentCardForTarget(target) {
    if (!target) return null;
    return target.closest(COMMENT_SELECTOR)
      || target.querySelector(COMMENT_SELECTOR)
      || target.closest(REVIEW_ITEM_SELECTOR)
      || (target.matches(REVIEW_ITEM_SELECTOR) ? target : null);
  }

  function clearLinkedCard() {
    linkedCard?.removeAttribute(LINKED_ATTR);
    document.querySelectorAll('.' + LABEL_CLASS).forEach((label) => label.remove());
    linkedCard = null;
  }

  function markLinkedCard(card) {
    if (linkedCard === card && card?.querySelector('.' + LABEL_CLASS)) return;
    clearLinkedCard();
    if (!card) return;

    linkedCard = card;
    card.setAttribute(LINKED_ATTR, 'true');
    const label = document.createElement('span');
    label.className = LABEL_CLASS;
    label.textContent = '🔗 Linked comment';
    // Add a visible explanation: color alone must not indicate the permalink.
    (card.querySelector(HEADER_SELECTOR) || card).prepend(label);
  }

  function refresh() {
    if (!isConversationRoute(location.pathname)) {
      clearLinkedCard();
      document.querySelectorAll('[' + OWN_REVIEW_ATTR + ']').forEach((card) => card.removeAttribute(OWN_REVIEW_ATTR));
      return;
    }

    const login = (document.querySelector('meta[name="user-login"]')?.content || '').toLowerCase();
    for (const card of document.querySelectorAll(REVIEW_SELECTOR)) {
      const own = reviewAuthoredBy(card, login, location.origin);
      if (own && !card.hasAttribute(OWN_REVIEW_ATTR)) card.setAttribute(OWN_REVIEW_ATTR, 'true');
      else if (!own && card.hasAttribute(OWN_REVIEW_ATTR)) card.removeAttribute(OWN_REVIEW_ATTR);
    }

    const id = commentIdFromHash(location.hash);
    const target = id && document.getElementById(id);
    markLinkedCard(commentCardForTarget(target));
  }

  function scheduleRefresh() {
    if (pendingRefresh) return;
    pendingRefresh = true;
    requestAnimationFrame(() => {
      pendingRefresh = false;
      refresh();
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isConversationRoute, commentIdFromHash, authorLogin, reviewAuthoredBy, commentCardForTarget, markLinkedCard };
  }

  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);
  window.addEventListener('hashchange', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);
  const observe = () => {
    new MutationObserver(scheduleRefresh).observe(document, { childList: true, subtree: true });
    scheduleRefresh();
  };
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });
})();
