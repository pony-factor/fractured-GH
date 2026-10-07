(async () => {
  'use strict';

  const { hideRepositoryLanguages = false } = await chrome.storage.local.get({
    hideRepositoryLanguages: false,
  });
  if (!hideRepositoryLanguages) return;

  function isRepositoryHome() {
    // Avoid profile, dashboard, issue, and other non-repository views.
    const parts = location.pathname.split('/').filter(Boolean);
    const reserved = new Set(['settings', 'notifications', 'organizations', 'orgs', 'topics',
      'explore', 'marketplace', 'features', 'pricing', 'search', 'new', 'login', 'signup']);
    return parts.length === 2 && !reserved.has(parts[0].toLowerCase());
  }

  function hideLanguages() {
    if (!isRepositoryHome()) return;

    // GitHub's repository sidebar currently groups Languages in a BorderGrid row.
    // Match the exact heading, not arbitrary occurrences of the word in repository content.
    const headings = document.querySelectorAll(
      '.BorderGrid-row h2, .BorderGrid-row h3, aside h2, aside h3',
    );
    for (const heading of headings) {
      if (heading.textContent.trim() !== 'Languages') continue;
      const row = heading.closest('.BorderGrid-row');
      if (row) {
        row.hidden = true;
      } else {
        const section = heading.closest('section');
        if (section && section.closest('aside')) section.hidden = true;
      }
    }
  }

  hideLanguages();
  const observer = new MutationObserver(() => hideLanguages());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('turbo:load', hideLanguages);
  document.addEventListener('pjax:end', hideLanguages);
})();
