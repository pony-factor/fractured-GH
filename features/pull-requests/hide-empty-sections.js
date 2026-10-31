(() => {
  'use strict';

  const SETTING_KEY = 'hideEmptySidebarSections';
  const MARKER = 'data-fractured-empty-sidebar-section';
  const STYLE_ID = 'fractured-empty-sidebar-section-style';
  const SIDEBARS = '#partial-discussion-sidebar, .discussion-sidebar, '
    + '[data-testid="issue-viewer-sidebar"], [data-testid="pr-sidebar"]';
  const SECTION_SELECTOR = '.discussion-sidebar-item, [data-testid="sidebar-labels-section"], '
    + '[data-testid="sidebar-projects-section"], [data-testid="sidebar-development-section"], '
    + '[data-testid="issue-labels-section"], [data-testid="issue-projects-section"], '
    + '[data-testid="issue-development-section"], section';
  const HEADING_SELECTOR = '.discussion-sidebar-heading, [data-testid="sidebar-section-heading"], '
    + 'h3, h4, [role="heading"]';
  const TYPES = new Set(['labels', 'projects', 'development']);
  const EMPTY_CONTENT = /^(?:none yet|none|no labels(?: yet| assigned)?|no projects(?: yet| assigned)?|no linked (?:issues|pull requests|branches)(?: yet)?|no linked issues or pull requests|nothing yet|not yet assigned)?$/i;
  const MERGE_HINT = /successfully merging this pull request may close these issues\.?/gi;
  let enabled = false;
  let observer = null;
  let queued = false;

  function isConversationPage() {
    return /^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:\/|$)/.test(location.pathname);
  }

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sectionType(section) {
    const heading = section.querySelector(HEADING_SELECTOR);
    if (!heading) return null;
    const name = normalize(heading.textContent).toLowerCase();
    if (!TYPES.has(name)) return null;
    // Never collapse a wrapper enclosing multiple independent sidebar sections.
    for (const other of section.querySelectorAll(HEADING_SELECTOR)) {
      if (other !== heading && !heading.contains(other)) return null;
    }
    return name;
  }

  function isEmpty(section, type) {
    if (section.matches('[aria-busy="true"]')
      || section.querySelector('[aria-busy="true"], [role="progressbar"], '
        + '[data-testid*="loading"], .Skeleton, .skeleton')) return false;

    // Work on a detached copy so the page's interactive controls stay intact.
    const copy = section.cloneNode(true);
    for (const control of copy.querySelectorAll(
      `${HEADING_SELECTOR}, button, summary, [role="button"], [role="menu"], `
      + 'script, style, svg, [hidden]',
    )) control.remove();

    // A linked label, project, branch, or issue remains meaningful even if icon-only.
    if (copy.querySelector('a[href], img, .IssueLabel, '
      + '[data-testid*="label-item"], [data-testid*="project-item"], '
      + '[data-testid*="linked-issue"], [data-testid*="linked-pull"]')) return false;

    let content = normalize(copy.textContent);
    if (type === 'development') content = normalize(content.replace(MERGE_HINT, ''));
    return EMPTY_CONTENT.test(content);
  }

  function refresh() {
    queued = false;
    for (const section of document.querySelectorAll(`[${MARKER}]`)) {
      section.removeAttribute(MARKER);
    }
    if (!enabled || !isConversationPage()) return;

    for (const sidebar of document.querySelectorAll(SIDEBARS)) {
      for (const section of sidebar.querySelectorAll(SECTION_SELECTOR)) {
        const type = sectionType(section);
        if (type && isEmpty(section, type)) section.setAttribute(MARKER, type);
      }
    }
  }

  function scheduleRefresh() {
    if (!enabled || queued) return;
    queued = true;
    queueMicrotask(refresh);
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `[${MARKER}] { display: none !important; }`;
    (document.head || document.documentElement).append(style);
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-busy', 'data-testid'],
    });
    document.addEventListener('turbo:load', scheduleRefresh);
    document.addEventListener('pjax:end', scheduleRefresh);
    window.addEventListener('popstate', scheduleRefresh);
    refresh();
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    observer?.disconnect();
    observer = null;
    document.removeEventListener('turbo:load', scheduleRefresh);
    document.removeEventListener('pjax:end', scheduleRefresh);
    window.removeEventListener('popstate', scheduleRefresh);
    document.getElementById(STYLE_ID)?.remove();
    refresh();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTING_KEY]) return;
    if (changes[SETTING_KEY].newValue) enable();
    else disable();
  });

  void chrome.storage.local.get({ [SETTING_KEY]: false }).then(settings => {
    if (settings[SETTING_KEY]) enable();
  });
})();
