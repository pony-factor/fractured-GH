(() => {
  'use strict';

  const DEFAULTS = {
    openCodeInVsCodeWeb: true,
    hideRepositoryTagsShortcut: true,
    hideUnprotectedBranchWarning: true,
  };
  const CODE_ATTRIBUTE = 'data-fractured-vscode-code';
  const TAG_ATTRIBUTE = 'data-fractured-hidden-tags-shortcut';
  const WARNING_ATTRIBUTE = 'data-fractured-hidden-branch-warning';
  let settings = { ...DEFAULTS };
  let scheduled = false;

  function currentRepository() {
    const repository = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')
      ?.getAttribute('content');
    if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return null;
    const prefix = '/' + repository.toLowerCase();
    const pathname = location.pathname.replace(/\/+$/, '').toLowerCase();
    if (pathname !== prefix && !pathname.startsWith(prefix + '/tree/')
      && !pathname.startsWith(prefix + '/blob/')) return null;
    return repository;
  }

  function isCodeTrigger(element) {
    if (!element.matches('button, summary, [role="button"]')) return false;
    if ((element.textContent || '').replace(/\s+/g, ' ').trim() !== 'Code') return false;
    return element.matches('[data-testid="code-button"], [aria-haspopup="menu"]')
      || Boolean(element.closest(
        '.file-navigation, #repo-content-pjax-container, #repository-content, [data-testid="repo-file-view"]',
      ))
      || Boolean(element.querySelector('svg.octicon-code'));
  }

  function isTagShortcut(link, repository) {
    let url;
    try {
      url = new URL(link.href, location.origin);
    } catch {
      return false;
    }
    if (url.origin !== location.origin
      || url.pathname.toLowerCase() !== ('/' + repository + '/tags').toLowerCase()) return false;
    // Keep full Tags pages and plain text links: remove only the icon shortcut.
    return Boolean(link.querySelector('svg.octicon-tag')
      || (link.querySelector('svg')
        && /^(?:tags?|view tags)$/i.test(
          link.getAttribute('aria-label') || link.getAttribute('title') || '',
        )));
  }

  function hideBranchWarnings() {
    for (const action of document.querySelectorAll('a, button')) {
      if (!/^\s*protect this branch\s*$/i.test(action.textContent || '')) continue;
      // The compact card contains both the title and the protection action.
      // Never hide its larger repository-page ancestors.
      let container = action.parentElement;
      for (let depth = 0; container && depth < 8; depth++, container = container.parentElement) {
        const text = (container.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 1400) break;
        if (/\byour\s+.+?\s+branch\s+(?:isn't|isn’t|is not)\s+protected\b/i.test(text)) {
          container.setAttribute(WARNING_ATTRIBUTE, '');
          break;
        }
      }
    }
  }

  function refresh() {
    scheduled = false;
    for (const element of document.querySelectorAll(
      '[' + CODE_ATTRIBUTE + '], [' + TAG_ATTRIBUTE + '], [' + WARNING_ATTRIBUTE + ']',
    )) {
      element.removeAttribute(CODE_ATTRIBUTE);
      element.removeAttribute(TAG_ATTRIBUTE);
      element.removeAttribute(WARNING_ATTRIBUTE);
    }
    const repository = currentRepository();
    if (!repository) return;

    if (settings.openCodeInVsCodeWeb) {
      for (const button of document.querySelectorAll('button, summary, [role="button"]')) {
        if (isCodeTrigger(button)) button.setAttribute(CODE_ATTRIBUTE, '');
      }
    }
    if (settings.hideRepositoryTagsShortcut) {
      for (const link of document.querySelectorAll('a[href]')) {
        if (isTagShortcut(link, repository)) link.setAttribute(TAG_ATTRIBUTE, '');
      }
    }
    if (settings.hideUnprotectedBranchWarning) hideBranchWarnings();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  // Capture before GitHub's menu listeners: the primary Code button opens the
  // repository in VS Code for the Web, not the clone/Codespaces dropdown.
  document.addEventListener('click', event => {
    if (!settings.openCodeInVsCodeWeb) return;
    const repository = currentRepository();
    const button = event.target?.closest?.('button, summary, [role="button"]');
    if (!repository || !button || !isCodeTrigger(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.open('https://vscode.dev/github/' + repository, '_blank', 'noopener,noreferrer');
  }, true);

  const style = document.createElement('style');
  style.textContent =
    '[' + TAG_ATTRIBUTE + '], [' + WARNING_ATTRIBUTE + '] { display: none !important; }\n'
    + '[' + CODE_ATTRIBUTE + '] svg.octicon-triangle-down { display: none !important; }';
  (document.head || document.documentElement).append(style);

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  async function loadSettings() {
    try {
      settings = await chrome.storage.local.get(DEFAULTS);
    } catch {
      settings = { ...DEFAULTS };
    }
    schedule();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(DEFAULTS).some(key => key in changes)) {
      void loadSettings();
    }
  });
  document.addEventListener('turbo:load', schedule);
  document.addEventListener('pjax:end', schedule);
  window.addEventListener('popstate', schedule);
  void loadSettings();
})();
