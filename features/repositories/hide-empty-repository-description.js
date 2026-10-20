(() => {
  'use strict';

  const EMPTY_TEXT = 'No description, website, or topics provided.';
  const ATTRIBUTE = 'data-fractured-empty-repository-description';
  let scheduled = false;

  function refresh() {
    scheduled = false;
    for (const element of document.querySelectorAll(`[${ATTRIBUTE}]`)) {
      element.removeAttribute(ATTRIBUTE);
    }

    const repository = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')
      ?.getAttribute('content');
    if (!repository || location.pathname.replace(/\/+$/, '') !== `/${repository}`) return;

    for (const element of document.querySelectorAll(
      '[class*="SidebarAbout"][class*="noDescription"], .BorderGrid-row p, aside p',
    )) {
      if (element.textContent.replace(/\s+/g, ' ').trim() === EMPTY_TEXT) {
        element.setAttribute(ATTRIBUTE, '');
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  function start() {
    const style = document.createElement('style');
    style.textContent = `[${ATTRIBUTE}] { display: none !important; }`;
    (document.head || document.documentElement).append(style);
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    document.addEventListener('turbo:load', schedule);
    document.addEventListener('pjax:end', schedule);
    window.addEventListener('popstate', schedule);
    schedule();
  }

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
