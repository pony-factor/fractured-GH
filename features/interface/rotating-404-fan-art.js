(() => {
  'use strict';

  const KEY = 'rotate404FanArtEnabled';
  const PANEL_ID = 'fractured-404-fan-art';
  const STYLE_ID = 'fractured-404-fan-art-style';
  const REPLACED = 'data-fractured-original-404-hidden';
  const ROTATION_MS = 90000;
  let enabled = false;
  let timer = null;
  let frameQueued = false;
  let generation = 0;
  let lastArtId = null;
  let loading = false;
  let unavailable = false;
  let currentPageUrl = location.href;

  function is404Page() {
    if (document.querySelector('#parallax_wrapper, .container-404, .error-404, .illustration-404')) {
      return true;
    }
    return /(?:404|page not found)/i.test(document.title)
      && /find code, projects, and people on github/i.test(document.body?.textContent || '');
  }

  function originalArtwork() {
    return document.querySelector(
      '#parallax_wrapper, .illustration-404, .container-404 #parallax, .error-404 #parallax'
    ) || [...document.querySelectorAll('img[src]')].find(image =>
      /\/(?:404|parallax)(?:[/.?-]|$)/i.test(image.getAttribute('src') || '')
      && image.closest('main, #parallax_wrapper, .container-404')
    ) || null;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '[' + REPLACED + '] { display: none !important; }',
      '#' + PANEL_ID + ' { box-sizing: border-box; width: 100%; max-width: 1040px; padding: 24px 18px; margin: 0 auto 14px; text-align: center; }',
      '#' + PANEL_ID + ' h1 { margin: 0 0 12px; font-size: clamp(34px, 6vw, 64px); line-height: 1.1; }',
      '#' + PANEL_ID + ' .fractured-404-image { width: 100%; height: auto; max-height: 500px; object-fit: contain; border-radius: 12px; }',
      '#' + PANEL_ID + ' .fractured-404-credits { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px 12px; margin: 12px auto 0; font-size: 12px; color: var(--fgColor-muted, #6e7781); }',
      '#' + PANEL_ID + ' .fractured-404-credits a { color: var(--fgColor-accent, #0969da); }',
      '#' + PANEL_ID + ' button { color: var(--fgColor-default, inherit); background: transparent; border: 1px solid var(--borderColor-default, #8c959f); border-radius: 6px; padding: 4px 10px; cursor: pointer; }',
      '@media (prefers-reduced-motion: reduce) { #' + PANEL_ID + ' * { transition: none !important; animation: none !important; } }',
    ].join('\n');
    (document.head || document.documentElement).append(style);
  }

  function cleanup() {
    generation++;
    loading = false;
    unavailable = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
    document.getElementById(PANEL_ID)?.remove();
    document.querySelectorAll('[' + REPLACED + ']').forEach(node => node.removeAttribute(REPLACED));
  }

  function makeLink(href, text) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = text;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  async function rotate() {
    if (!enabled || !is404Page() || loading || unavailable) return;
    const original = originalArtwork();
    if (!original || !original.isConnected) return;
    loading = true;
    const currentGeneration = generation;
    try {
      const art = await chrome.runtime.sendMessage({
        type: 'fractured:load-404-fan-art',
        excludeId: lastArtId,
      });
      if (!art?.ok) throw new Error(art?.error || 'Artwork unavailable');
      if (!enabled || !is404Page() || currentGeneration !== generation || !original.isConnected) return;
      const image = new Image();
      image.className = 'fractured-404-image';
      image.alt = 'My Little Pony fan artwork by ' + art.artist;
      image.decoding = 'async';
      // Decode before hiding GitHub's original art, to prevent an empty 404.
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = art.imageDataUrl;
      });
      if (!enabled || !is404Page() || currentGeneration !== generation || !original.isConnected) return;
      let panel = document.getElementById(PANEL_ID);
      if (!panel) {
        panel = document.createElement('section');
        panel.id = PANEL_ID;
        panel.setAttribute('aria-label', '404 fan artwork');
      }
      const heading = document.createElement('h1');
      heading.textContent = '404 · Page not found';
      const credits = document.createElement('div');
      credits.className = 'fractured-404-credits';
      const author = document.createElement('span');
      author.textContent = 'Artwork by ' + art.artist;
      credits.append(author, makeLink(art.postUrl, 'Artwork and credit'));
      if (art.sourceUrl) credits.append(makeLink(art.sourceUrl, 'Original source'));
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = 'Another artwork';
      next.addEventListener('click', () => {
        unavailable = false;
        void rotate();
      });
      credits.append(next);
      panel.replaceChildren(heading, image, credits);
      original.before(panel);
      original.setAttribute(REPLACED, '');
      lastArtId = art.id;
      ensureStyle();
      if (timer === null) {
        timer = setInterval(() => {
          if (document.visibilityState === 'visible') void rotate();
        }, ROTATION_MS);
      }
    } catch (error) {
      // Keep the previously rendered art, or the original GitHub illustration.
      if (!document.getElementById(PANEL_ID)) {
        original.removeAttribute(REPLACED);
        unavailable = true;
      }
      console.warn('[Fractured GitHub] 404 fan art unavailable:', error);
    } finally {
      loading = false;
    }
  }

  function refresh() {
    frameQueued = false;
    if (currentPageUrl !== location.href) {
      currentPageUrl = location.href;
      cleanup();
    }
    if (!enabled || !is404Page()) {
      if (timer !== null || document.getElementById(PANEL_ID) || unavailable) cleanup();
      return;
    }
    if (document.getElementById(PANEL_ID)) return;
    void rotate();
  }

  function scheduleRefresh() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(refresh);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    enabled = Boolean(changes[KEY].newValue);
    if (!enabled) cleanup();
    else scheduleRefresh();
  });
  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefresh();
  });

  function observe() {
    if (!document.documentElement) {
      setTimeout(observe, 50);
      return;
    }
    new MutationObserver(scheduleRefresh).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    scheduleRefresh();
  }
  void chrome.storage.local.get({ [KEY]: true }).then(values => {
    enabled = Boolean(values[KEY]);
    scheduleRefresh();
  });
  observe();
})();
