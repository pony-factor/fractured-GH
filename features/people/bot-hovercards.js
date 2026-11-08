(() => {
  'use strict';

  const MARKER = 'data-fractured-bot-profile';
  const CARD_ID = 'fractured-bot-hovercard';
  const CANDIDATES = `a[href*="[bot]" i], a[href*="%5bbot%5d" i], a[${MARKER}]`;
  let card;
  let activeLink;
  let closeTimer;
  let scheduled = false;

  function botSlug(link) {
    try {
      const url = new URL(link.getAttribute('href'), location.origin);
      if (url.origin !== location.origin) return '';
      const pathname = decodeURIComponent(url.pathname);
      const bot = pathname.match(/^\/([a-z\d][a-z\d-]*)\[bot\]\/?$/i);
      if (bot) return bot[1];
      const saved = link.getAttribute(MARKER);
      return saved && pathname === '/apps/' + saved ? saved : '';
    } catch {
      return '';
    }
  }

  function repair(link) {
    const slug = botSlug(link);
    if (!slug) {
      link.removeAttribute(MARKER);
      return '';
    }
    // GitHub's contributor list treats app bots as users, but those profile
    // pages and user hovercard endpoints return 404. Keep the app identity.
    if (link.getAttribute(MARKER) !== slug) link.setAttribute(MARKER, slug);
    const href = '/apps/' + slug;
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    for (const attribute of ['data-hovercard-url', 'data-hovercard-type']) {
      if (link.hasAttribute(attribute)) link.removeAttribute(attribute);
    }
    return slug;
  }

  function close() {
    clearTimeout(closeTimer);
    if (card) card.hidePopover();
    activeLink = null;
  }

  function ensureCard() {
    if (card) return;
    const style = document.createElement('style');
    style.textContent = `
      #${CARD_ID} {
        position: fixed; inset: auto; margin: 0; box-sizing: border-box;
        width: 300px; max-width: calc(100vw - 16px); padding: 16px;
        color: var(--fgColor-default, #1f2328);
        background: var(--bgColor-default, #fff);
        border: 1px solid var(--borderColor-default, #d1d9e0);
        border-radius: 8px; box-shadow: 0 8px 24px #0003;
      }
      #${CARD_ID} a { display: flex; align-items: center; gap: 12px; }
      #${CARD_ID} img { width: 48px; height: 48px; border-radius: 6px; }
      #${CARD_ID} p { margin: 12px 0 0; color: var(--fgColor-muted, #59636e); }
    `;
    card = document.createElement('div');
    card.id = CARD_ID;
    card.setAttribute('popover', 'manual');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Bot profile');
    document.documentElement.append(style, card);
    card.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    card.addEventListener('pointerleave', leave);
    card.addEventListener('focusout', leave);
  }

  function open(link, slug) {
    clearTimeout(closeTimer);
    ensureCard();
    if (activeLink === link && card.matches(':popover-open')) return;
    const profile = document.createElement('a');
    profile.href = '/apps/' + slug;
    const avatar = link.querySelector('img') || link.closest('li')?.querySelector('img');
    if (avatar) {
      const image = document.createElement('img');
      image.src = avatar.src;
      image.alt = '';
      profile.append(image);
    }
    const name = document.createElement('strong');
    name.textContent = slug + '[bot]';
    profile.append(name);
    const description = document.createElement('p');
    description.textContent = 'GitHub App · View app profile';
    card.replaceChildren(profile, description);
    activeLink = link;
    card.showPopover();
    const rect = link.getBoundingClientRect();
    card.style.left = Math.max(8, Math.min(rect.left, innerWidth - card.offsetWidth - 8)) + 'px';
    const below = rect.bottom + 8;
    card.style.top = Math.max(8, below + card.offsetHeight <= innerHeight
      ? below : rect.top - card.offsetHeight - 8) + 'px';
  }

  function enter(event) {
    const link = event.target.closest?.('a[href]');
    if (!link || link.closest('#' + CARD_ID)) return;
    const slug = repair(link);
    if (slug) open(link, slug);
  }

  function leave(event) {
    const next = event.relatedTarget;
    if (next && (activeLink?.contains(next) || card?.contains(next))) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, 150);
  }

  function scan() {
    scheduled = false;
    document.querySelectorAll(CANDIDATES).forEach(repair);
    if (activeLink && (!activeLink.isConnected || !botSlug(activeLink))) close();
  }

  document.addEventListener('pointerover', enter, true);
  document.addEventListener('focusin', enter, true);
  document.addEventListener('pointerout', (event) => {
    if (activeLink?.contains(event.target)) leave(event);
  }, true);
  document.addEventListener('focusout', (event) => {
    if (activeLink?.contains(event.target)) leave(event);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  addEventListener('scroll', close, true);
  addEventListener('resize', close);
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(scan);
    }
  }).observe(document, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['href', 'data-hovercard-url', 'data-hovercard-type'],
  });
  scan();
})();
