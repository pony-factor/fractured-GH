(() => {
  'use strict';

  const KEY = 'hideRepositoryLanguages';
  const ATTRIBUTE = 'data-fractured-hidden-languages';
  let enabled = false;
  let scheduled = false;

  function isRepositoryHome() {
    const repository = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')
      ?.getAttribute('content');
    return repository && location.pathname.replace(/\/+$/, '') === `/${repository}`;
  }

  function refresh() {
    scheduled = false;
    for (const section of document.querySelectorAll(`[${ATTRIBUTE}]`)) {
      section.removeAttribute(ATTRIBUTE);
    }
    if (!enabled || !isRepositoryHome()) return;

    // React's sidebar sections replaced the older BorderGrid rows.
    for (const heading of document.querySelectorAll(
      '[class*="SidebarSection"] h2, [class*="SidebarSection"] h3, .BorderGrid-row h2, .BorderGrid-row h3, aside h2, aside h3',
    )) {
      if (heading.textContent.trim() !== 'Languages') continue;
      const section = heading.closest('[class*="SidebarSection"][class*="sidebarSection"], .BorderGrid-row, aside section');
      section?.setAttribute(ATTRIBUTE, '');
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  async function loadSettings() {
    const settings = await chrome.storage.local.get({ [KEY]: false });
    enabled = Boolean(settings[KEY]);
    schedule();
  }

  const style = document.createElement('style');
  style.textContent = `[${ATTRIBUTE}] { display: none !important; }`;
  (document.head || document.documentElement).append(style);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) void loadSettings();
  });
  document.addEventListener('turbo:load', schedule);
  document.addEventListener('pjax:end', schedule);
  window.addEventListener('popstate', schedule);
  void loadSettings();
})();
