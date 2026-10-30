(() => {
  'use strict';

  const ENABLE_KEY = 'pullRequestSidebarToggleEnabled';
  const COLLAPSE_KEY = 'pullRequestSidebarCollapsed';
  const ROOT_ATTR = 'data-fractured-pr-sidebar-collapsed';
  const LAYOUT_ATTR = 'data-fractured-pr-sidebar-layout';
  const COLUMN_ATTR = 'data-fractured-pr-sidebar-column';
  const MAIN_ATTR = 'data-fractured-pr-sidebar-main';
  const WIDTH_ATTR = 'data-fractured-pr-sidebar-width';
  const STYLE_ID = 'fractured-pr-sidebar-toggle-style';
  const HOLDER_ID = 'fractured-pr-sidebar-toggle-holder';
  const SIDEBARS = '#partial-discussion-sidebar, [data-testid="pr-sidebar"], .discussion-sidebar, [data-testid="issue-viewer-sidebar"]';
  const CONTENT = '.Layout-main, [data-testid="issue-viewer-main"], #discussion_bucket, .discussion-timeline';

  let enabled = true;
  let collapsed = false;
  let active = null;
  let observer = null;
  let queued = false;

  function onConversation() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(location.pathname);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#fractured-pr-sidebar-toggle-holder { display:flex; justify-content:flex-end; margin:0 0 8px; }',
      '#fractured-pr-sidebar-toggle-holder button { display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; width:32px; height:32px; padding:6px; border:1px solid var(--borderColor-default,var(--color-border-default,#30363d)); border-radius:6px; background:var(--bgColor-default,var(--color-canvas-default,#0d1117)); color:var(--fgColor-default,var(--color-fg-default,#f0f6fc)); cursor:pointer; }',
      '#fractured-pr-sidebar-toggle-holder button:hover { background:var(--bgColor-muted,var(--color-canvas-subtle,#161b22)); }',
      '#fractured-pr-sidebar-toggle-holder button:focus-visible { outline:2px solid var(--focus-outlineColor,#0969da); outline-offset:2px; }',
      '#fractured-pr-sidebar-toggle-holder svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; }',
      'html[data-fractured-pr-sidebar-collapsed="true"] [data-fractured-pr-sidebar-column] { display:none !important; }',
      'html[data-fractured-pr-sidebar-collapsed="true"] [data-fractured-pr-sidebar-layout] { grid-template-columns:minmax(0,1fr) !important; --Layout-sidebar-width:0px; }',
      'html[data-fractured-pr-sidebar-collapsed="true"] [data-fractured-pr-sidebar-main] { grid-column:1 / -1 !important; flex:1 1 100% !important; width:100% !important; min-width:0 !important; max-width:none !important; }',
      'html[data-fractured-pr-sidebar-collapsed="true"] [data-fractured-pr-sidebar-width], html[data-fractured-pr-sidebar-collapsed="true"] [data-fractured-pr-sidebar-main] :is(#discussion_bucket,.discussion-timeline) { max-width:none !important; width:100% !important; }',
    ].join('\n');
    (document.head || document.documentElement).append(style);
  }

  function findColumns() {
    for (const sidebar of document.querySelectorAll(SIDEBARS)) {
      if (!sidebar.isConnected) continue;
      let column = sidebar.closest('.Layout-sidebar') || sidebar;
      let layout = column.parentElement;
      // Follow GitHub's legacy Layout grid and newer wrapping flex containers.
      while (layout && layout !== document.body) {
        const main = layout.querySelector(CONTENT);
        if (main && !column.contains(main) && !main.contains(column)) {
          // Hide the entire grid/flex child, not only an inner sidebar widget.
          while (column.parentElement && column.parentElement !== layout) {
            column = column.parentElement;
          }
          return { layout, main, column };
        }
        layout = layout.parentElement;
      }
    }
    return null;
  }

  function clearActive() {
    if (!active) return;
    active.layout.removeAttribute(LAYOUT_ATTR);
    active.column.removeAttribute(COLUMN_ATTR);
    active.main.removeAttribute(MAIN_ATTR);
    if (active.wide) active.wide.removeAttribute(WIDTH_ATTR);
    active.holder.remove();
    active = null;
    document.documentElement.removeAttribute(ROOT_ATTR);
  }

  function applyState() {
    if (!active) return;
    if (collapsed) document.documentElement.setAttribute(ROOT_ATTR, 'true');
    else document.documentElement.removeAttribute(ROOT_ATTR);
    const label = collapsed ? 'Show pull request sidebar' : 'Hide pull request sidebar';
    active.button.setAttribute('aria-label', label);
    active.button.setAttribute('title', label);
    active.button.setAttribute('aria-expanded', String(!collapsed));
    active.button.setAttribute('aria-pressed', String(collapsed));
  }

  function createToggle() {
    const holder = document.createElement('div');
    holder.id = HOLDER_ID;
    const button = document.createElement('button');
    button.type = 'button';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    for (const y of [3.5, 8, 12.5]) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', 'M2 ' + y + ' H14');
      svg.append(line);
    }
    button.append(svg);
    button.addEventListener('click', () => {
      collapsed = !collapsed;
      applyState();
      void chrome.storage.local.set({ [COLLAPSE_KEY]: collapsed });
    });
    holder.append(button);
    return { holder, button };
  }

  function render() {
    queued = false;
    if (!enabled || !onConversation()) {
      clearActive();
      return;
    }
    const columns = findColumns();
    if (!columns) {
      clearActive();
      return;
    }
    if (active && active.layout === columns.layout
      && active.column === columns.column && active.main === columns.main
      && active.holder.isConnected) {
      applyState();
      return;
    }
    clearActive();
    ensureStyle();
    const { holder, button } = createToggle();
    const wide = columns.layout.closest('.container-xl, .container-lg, .container-md');
    columns.layout.setAttribute(LAYOUT_ATTR, '');
    columns.column.setAttribute(COLUMN_ATTR, '');
    columns.main.setAttribute(MAIN_ATTR, '');
    if (wide) wide.setAttribute(WIDTH_ATTR, '');
    columns.main.prepend(holder);
    active = { ...columns, holder, button, wide };
    applyState();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(render);
  }

  function onRouteChange() {
    if (enabled && onConversation()) {
      if (!observer && document.documentElement) {
        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
    } else {
      if (observer) observer.disconnect();
      observer = null;
    }
    schedule();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[ENABLE_KEY]) enabled = Boolean(changes[ENABLE_KEY].newValue);
    if (changes[COLLAPSE_KEY]) collapsed = Boolean(changes[COLLAPSE_KEY].newValue);
    if (changes[ENABLE_KEY]) onRouteChange();
    else if (changes[COLLAPSE_KEY]) schedule();
  });
  document.addEventListener('turbo:load', onRouteChange);
  document.addEventListener('pjax:end', onRouteChange);
  window.addEventListener('popstate', onRouteChange);
  document.addEventListener('DOMContentLoaded', onRouteChange, { once: true });
  void chrome.storage.local.get({
    [ENABLE_KEY]: true,
    [COLLAPSE_KEY]: false,
  }).then(settings => {
    enabled = Boolean(settings[ENABLE_KEY]);
    collapsed = Boolean(settings[COLLAPSE_KEY]);
    onRouteChange();
  });
})();
