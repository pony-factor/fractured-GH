(() => {
  'use strict';

  const ROW_SELECTOR = '.notifications-list-item, li[data-notification-id], [data-testid="notification-row"], [data-testid="notification-list-item"]';
  const DONE_PATH = '/notifications/beta/archive';
  const POLL_INTERVAL_MS = 60_000;
  const MIN_RETRY_MS = 5 * 60_000;
  const MAX_DONE_PER_POLL = 10;

  function normalizeAccount(value) {
    const account = String(value || '').trim()
      .replace(/^https?:\/\/github\.com\/(?:apps\/)?/i, '')
      .replace(/^@+/, '').replace(/\/+$/, '').toLowerCase();
    return /^[a-z0-9][a-z0-9-]*(?:\[bot\])?$/.test(account) ? account : '';
  }

  function accountFromHref(href) {
    if (!href) return null;
    try {
      const url = new URL(href, 'https://github.com');
      if (url.hostname !== 'github.com') return null;
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length === 2 && segments[0] === 'apps') {
        const name = normalizeAccount(segments[1]);
        return name ? name + '[bot]' : null;
      }
      if (segments.length !== 1) return null;
      return normalizeAccount(decodeURIComponent(segments[0])) || null;
    } catch {
      return null;
    }
  }

  function isMutedActor(actor, mutedAccounts) {
    if (!actor) return false;
    return mutedAccounts.has(actor)
      || (actor.endsWith('[bot]') && mutedAccounts.has(actor.slice(0, -5)));
  }

  function notificationParticipants(row) {
    const stack = row.querySelector('.AvatarStack');
    if (!stack) return null;
    // Avatar stacks are participants, not "last actor". A +N means that
    // GitHub has hidden other participants, potentially including a human.
    if (/\+\s*\d+\b/.test(stack.textContent || '')) return null;
    const accounts = visibleParticipants(row);
    return accounts.length && accounts.every(Boolean) ? accounts : null;
  }

  function visibleParticipants(row) {
    return [...row.querySelectorAll('.AvatarStack-body a[href]')]
      .map((link) => accountFromHref(link.getAttribute('href')));
  }

  function isSaved(row) {
    return row.classList?.contains('notification-starred')
      || Boolean(row.querySelector('.notification-starred, [aria-label="Saved"], [data-state="saved"]'));
  }

  function isMutedAccountNotification(row, mutedAccounts) {
    if (!mutedAccounts.size || isSaved(row)) return false;
    const participants = notificationParticipants(row);
    return Boolean(participants?.length && participants.every((account) => isMutedActor(account, mutedAccounts)));
  }

  function notificationLink(row) {
    const href = row.querySelector('a[href*="notification_referrer_id="]')?.getAttribute('href');
    if (!href) return null;
    try {
      const url = new URL(href, 'https://github.com');
      return url.origin === 'https://github.com' && url.searchParams.get('notification_referrer_id') ? url : null;
    } catch {
      return null;
    }
  }

  function notificationComment(url) {
    if (!url || !/^\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+$/.test(url.pathname)
      || !/^#issuecomment-\d+$/.test(url.hash)) return null;
    // The notification referrer can mark the thread read. Fetch the plain page.
    return { path: url.pathname, id: url.hash.slice(1) };
  }

  function pullRequestActivity(url) {
    if (!url) return null;
    const event = /^#event-(\d+)$/.exec(url.hash);
    if (event && /^\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url.pathname)) {
      return { kind: 'merge', path: url.pathname, id: 'IssueEvent_' + event[1] };
    }
    if (url.hash) return null;
    const changes = /^\/[\w.-]+\/[\w.-]+\/pull\/\d+\/changes\/(?:(?<base>[a-f0-9]{40})\.\.)?(?<head>[a-f0-9]{40})$/.exec(url.pathname);
    if (changes) return { kind: 'changes', path: url.pathname, ...changes.groups };
    const commit = /^\/[\w.-]+\/[\w.-]+\/commit\/([a-f0-9]{40})$/.exec(url.pathname);
    return commit ? { kind: 'commit', path: url.pathname, head: commit[1] } : null;
  }

  function mergeActor(data, id) {
    if (!Array.isArray(data?.timeline)) return '';
    const item = data.timeline.find((item) => item?.id === id);
    if (item?.additionalInfo?.issueEvent?.eventType !== 'merged') return '';
    return normalizeAccount(item.user?.displayLogin);
  }

  function commitActors(data, { kind, base, head }) {
    if (kind === 'commit') {
      const commit = data?.payload?.commitRoute?.commit;
      return commit?.oid === head && Array.isArray(commit.authors)
        ? commit.authors.map((author) => normalizeAccount(author?.login)) : [];
    }
    const route = data?.payload?.pullRequestsChangesWithRangeRoute;
    if (!Array.isArray(route?.commits)) return [];
    const last = route.commits.findIndex((commit) => commit?.oid === head);
    if (last < 0) return [];
    if (!base) {
      return route.commit?.oid === head ? [normalizeAccount(route.commits[last].actorLogin)] : [];
    }
    const range = route?.comparison?.selectedRange;
    if (range?.baseOid !== base || range.headOid !== head) return [];
    const first = route.commits.findIndex((commit) => commit?.oid === base);
    if (first < 0 || last <= first) return [];
    return route.commits.slice(first + 1, last + 1).map((commit) => normalizeAccount(commit?.actorLogin));
  }

  function commentAuthor(page, id) {
    const comment = page.getElementById(id);
    const link = comment?.querySelector('.timeline-comment-header a.author[href]');
    return accountFromHref(link?.getAttribute('href'));
  }

  function isInbox(location) {
    if (location.hostname !== 'github.com'
      || location.pathname.replace(/\/$/, '') !== '/notifications') return false;
    const query = (new URLSearchParams(location.search).get('query') || '').trim();
    return !/(?:^|\s|")is:(?:done|saved)(?=$|\s|")/i.test(query);
  }

  function notificationId(row) {
    const id = row.getAttribute('data-notification-id')
      || row.querySelector('input[name="notification_ids[]"]')?.value;
    return /^(?:\d+|NT_[A-Za-z0-9_-]+)$/.test(String(id || '')) ? String(id) : null;
  }

  function doneButton(row) {
    for (const form of row.querySelectorAll('form[action]')) {
      try {
        const action = new URL(form.getAttribute('action'), 'https://github.com');
        if (action.origin !== 'https://github.com' || action.pathname !== DONE_PATH) continue;
        const button = form.querySelector('button[type="submit"]');
        if (button && !button.disabled) return button;
      } catch {
        // Unknown form actions must never be invoked automatically.
      }
    }
    return null;
  }

  function createDoneRequest(row, page) {
    const id = notificationId(row);
    if (!id) return null;
    const form = row.querySelector('form[action="/notifications/beta/archive"]')
      || page.querySelector('.js-notification-bulk-action form[action="/notifications/beta/archive"]');
    if (!form) return null;
    const token = form.querySelector('input[name="authenticity_token"]')?.value
      || page.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (!token) return null;
    // Always send exactly one verified notification ID. Never reuse a
    // bulk form's selected rows, and never submit a "mark all" action.
    const params = new URLSearchParams();
    params.set('authenticity_token', token);
    params.append('notification_ids[]', id);
    return params;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalizeAccount, accountFromHref, isMutedActor,
      notificationParticipants, isMutedAccountNotification, isInbox,
      notificationLink, notificationComment,
      notificationId, doneButton, createDoneRequest,
    };
    return;
  }

  let mutedAccounts = new Set();
  let refreshTimer = null;
  let polling = false;
  const attempted = new Map();
  const actorLookups = new Map();

  async function fetchCommentAuthor({ path, id }) {
    try {
      // Signed-in and public GitHub can serve different versions of the timeline.
      for (const credentials of ['same-origin', 'omit']) {
        const response = await window.fetch(path, { credentials, redirect: 'manual' });
        if (!response.ok) continue;
        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
        const author = commentAuthor(page, id);
        if (author) return author;
      }
    } catch {
      // Leave the notification alone if its author cannot be verified.
    }
    return null;
  }

  async function fetchActivityActors(activity, timestamp) {
    try {
      let path = activity.path;
      if (activity.kind === 'merge') {
        const time = Date.parse(timestamp);
        if (!Number.isFinite(time)) return [];
        // GitHub's unread timestamp can trail the corresponding timeline event.
        const query = new URLSearchParams({ since: new Date(time - MIN_RETRY_MS).toISOString() });
        path += '/page_data/catch_up?' + query;
      }
      const response = await window.fetch(path, {
        credentials: 'same-origin', redirect: 'manual',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return activity.kind === 'merge' ? [mergeActor(data, activity.id)] : commitActors(data, activity);
    } catch {
      return [];
    }
  }

  function lookupActors(key, lookup) {
    const cached = actorLookups.get(key);
    if (cached && Date.now() - cached.time < MIN_RETRY_MS) return cached.result;
    actorLookups.delete(key);
    if (actorLookups.size >= 100) actorLookups.delete(actorLookups.keys().next().value);
    const result = lookup();
    actorLookups.set(key, { time: Date.now(), result });
    return result;
  }

  async function matchesMutedNotification(row, accounts) {
    if (isSaved(row)) return false;
    const url = notificationLink(row);
    const activity = pullRequestActivity(url);
    if (activity) {
      const timestamp = notificationTime(row);
      const key = url.pathname + url.hash + ':' + timestamp;
      const actors = await lookupActors(key, () => fetchActivityActors(activity, timestamp));
      return url.href === notificationLink(row)?.href && timestamp === notificationTime(row) && !isSaved(row)
        && actors.length > 0 && actors.every((actor) => isMutedActor(actor, accounts));
    }
    const comment = notificationComment(url);
    if (!comment) return isMutedAccountNotification(row, accounts);
    if (!visibleParticipants(row).some((actor) => isMutedActor(actor, accounts))) return false;
    const author = await lookupActors(url.pathname + url.hash, () => fetchCommentAuthor(comment));
    const current = notificationComment(notificationLink(row));
    return current?.id === comment.id && current.path === comment.path && !isSaved(row)
      && (author ? isMutedActor(author, accounts) : isMutedAccountNotification(row, accounts));
  }

  function notificationTime(row) {
    return row.querySelector('relative-time')?.getAttribute('datetime') || '';
  }

  function attemptKey(row) {
    const id = notificationId(row);
    return id ? id + ':' + notificationTime(row) : null;
  }

  function mayAttempt(row) {
    const key = attemptKey(row);
    if (!key) return false;
    const previous = attempted.get(key);
    if (previous && Date.now() - previous < MIN_RETRY_MS) return false;
    attempted.set(key, Date.now());
    return true;
  }

  async function checkVisibleInbox() {
    if (!mutedAccounts.size || !isInbox(window.location)) return;
    const accounts = mutedAccounts;
    const pageUrl = window.location.href;
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      if (accounts !== mutedAccounts || pageUrl !== window.location.href) return;
      const key = attemptKey(row);
      if (!key || !await matchesMutedNotification(row, accounts)) continue;
      if (accounts !== mutedAccounts || pageUrl !== window.location.href) return;
      if (row.isConnected === false || attemptKey(row) !== key) continue;
      const button = doneButton(row);
      if (!button || !mayAttempt(row)) continue;
      // Use GitHub's native per-thread Done action; it marks the thread
      // done/read on GitHub rather than just hiding its DOM node.
      button.click();
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(checkVisibleInbox, 100);
  }

  async function pollInbox() {
    if (!mutedAccounts.size || polling || document.hidden || window.location.hostname !== 'github.com'
      || isInbox(window.location)) return;
    polling = true;
    try {
      const response = await window.fetch('/notifications?query=is%3Aunread', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!response.ok || response.redirected) return;
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const accounts = mutedAccounts;
      let completed = 0;
      for (const row of page.querySelectorAll(ROW_SELECTOR)) {
        if (completed >= MAX_DONE_PER_POLL) break;
        if (accounts !== mutedAccounts) break;
        if (!await matchesMutedNotification(row, accounts)) continue;
        if (accounts !== mutedAccounts || isInbox(window.location)) break;
        const body = createDoneRequest(row, page);
        if (!body || !mayAttempt(row)) continue;
        const result = await window.fetch(DONE_PATH, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'text/html',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: body.toString(),
          redirect: 'manual',
        });
        // A failed or unknown response is not proof that a thread is done.
        if (result.ok) completed++;
      }
    } catch {
      // Network failures must not change the notification state locally.
    } finally {
      polling = false;
    }
  }

  async function loadSettings() {
    const settings = await chrome.storage.local.get({
      mutedInboxAccounts: [],
    });
    mutedAccounts = new Set(
      (Array.isArray(settings.mutedInboxAccounts) ? settings.mutedInboxAccounts : [])
        .map(normalizeAccount).filter(Boolean),
    );
    scheduleRefresh();
    if (mutedAccounts.size) void pollInbox();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.mutedInboxAccounts) return;
    void loadSettings();
  });

  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void pollInbox();
  });
  const observer = new MutationObserver(scheduleRefresh);
  function start() {
    if (!document.documentElement) {
      window.setTimeout(start, 100);
      return;
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleRefresh();
  }
  start();
  void loadSettings();
  window.setInterval(() => void pollInbox(), POLL_INTERVAL_MS);
})();
