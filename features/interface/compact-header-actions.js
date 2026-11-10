(() => {
  'use strict';

  const HIDE_ATTRIBUTE = 'data-fractured-hide-notifications-button';
  const NATIVE_ATTRIBUTE = 'data-fractured-header-native-create';
  const STYLE_ID = 'fractured-header-actions-style';
  const HEADER_SELECTOR = '.AppHeader, header[role="banner"], header.GlobalNav, #global-nav';
  let compactEnabled = false;
  let hideNotifications = false;
  let nativeCreate = null;
  let host = null;
  let previousPosition = null;
  let rail = null;
  let refreshTimer = null;

  function findCreateControl(root = document) {
    const header = root.querySelector(HEADER_SELECTOR);
    if (!header) return null;
    for (const control of header.querySelectorAll('button, summary, [role="button"]')) {
      if (control.closest('[data-fractured-header-actions]')) continue;
      if (control.querySelector('svg.octicon-plus')) return control;
    }
    return null;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { findCreateControl };
    return;
  }

  const CSS = [
    'html[' + HIDE_ATTRIBUTE + '] #AppHeader-notifications-button,',
    'html[' + HIDE_ATTRIBUTE + '] .AppHeader a[href="/notifications"]:not(.fractured-header-inbox),',
    'html[' + HIDE_ATTRIBUTE + '] .AppHeader a[href^="/notifications?"]:not(.fractured-header-inbox),',
    'html[' + HIDE_ATTRIBUTE + '] .GlobalNav a[href="/notifications"]:not(.fractured-header-inbox),',
    'html[' + HIDE_ATTRIBUTE + '] header[role="banner"] a[href="/notifications"]:not(.fractured-header-inbox),',
    'html[' + HIDE_ATTRIBUTE + '] header[role="banner"] :is(a, button)[aria-label*="notification" i]:not(.fractured-header-inbox) {',
    '  display: none !important;',
    '}',
    '[' + NATIVE_ATTRIBUTE + '] { visibility: hidden !important; }',
    '.fractured-header-actions {',
    '  position: absolute; right: 0; top: 50%; transform: translateY(-50%);',
    '  display: flex; flex-direction: row; align-items: center; gap: 4px;',
    '  z-index: 80; white-space: nowrap;',
    '}',
    '.fractured-header-actions button, .fractured-header-actions a {',
    '  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;',
    '  min-height: 32px; padding: 0 10px; border-radius: 6px;',
    '  border: 1px solid var(--borderColor-default, #d1d9e0);',
    '  background: var(--bgColor-default, #fff); color: var(--fgColor-default, #1f2328);',
    '  font: inherit; text-decoration: none; cursor: pointer;',
    '}',
    '.fractured-header-actions button:hover, .fractured-header-actions a:hover {',
    '  background: var(--bgColor-muted, #f6f8fa); text-decoration: none;',
    '}',
    '.fractured-header-actions button:focus-visible, .fractured-header-actions a:focus-visible {',
    '  outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: 2px;',
    '}',
    '.fractured-header-actions-toggle { width: 32px; padding: 0 !important; }',
    '.fractured-header-actions-panel { display: inline-flex; align-items: center; gap: 4px; }',
    '.fractured-header-actions-panel[hidden] { display: none !important; }',
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const parent = document.head || document.documentElement;
    if (!parent) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    parent.append(style);
  }

  function setExpanded(expanded) {
    if (!rail) return;
    const panel = rail.querySelector('.fractured-header-actions-panel');
    const toggle = rail.querySelector('.fractured-header-actions-toggle');
    panel.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Collapse actions' : 'Expand actions');
  }

  function cleanup() {
    rail?.remove();
    rail = null;
    nativeCreate?.removeAttribute(NATIVE_ATTRIBUTE);
    nativeCreate = null;
    if (host && previousPosition !== null) host.style.position = previousPosition;
    host = null;
    previousPosition = null;
  }

  function installRail(control) {
    cleanup();
    if (!control.parentElement) return;
    nativeCreate = control;
    host = control.parentElement;
    previousPosition = host.style.position;
    if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    control.setAttribute(NATIVE_ATTRIBUTE, '');

    const actions = document.createElement('div');
    actions.className = 'fractured-header-actions';
    actions.setAttribute('data-fractured-header-actions', '');

    const panel = document.createElement('div');
    panel.id = 'fractured-header-actions-panel';
    panel.className = 'fractured-header-actions-panel';
    panel.hidden = true;

    const inbox = document.createElement('a');
    inbox.className = 'fractured-header-inbox';
    inbox.href = '/notifications';
    inbox.textContent = 'Inbox';
    panel.append(inbox);

    const create = document.createElement('button');
    create.type = 'button';
    create.textContent = 'Create';
    create.setAttribute('aria-label', 'Open GitHub create menu');
    create.addEventListener('click', () => {
      setExpanded(false);
      if (nativeCreate?.isConnected) nativeCreate.click();
    });
    panel.append(create);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'fractured-header-actions-toggle';
    toggle.setAttribute('aria-controls', panel.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Expand actions');
    toggle.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1 3h14v2H1zm0 4h14v2H1zm0 4h14v2H1z"></path></svg>';
    toggle.addEventListener('click', () => {
      setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
    });
    actions.append(panel, toggle);
    control.after(actions);
    rail = actions;
  }

  function render() {
    ensureStyle();
    document.documentElement?.toggleAttribute(HIDE_ATTRIBUTE, hideNotifications);
    if (!compactEnabled) {
      cleanup();
      return;
    }
    const control = findCreateControl();
    if (!control) {
      cleanup();
      return;
    }
    if (nativeCreate === control && rail?.isConnected) return;
    installRail(control);
  }

  function scheduleRender() {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      render();
    }, 80);
  }

  document.addEventListener('pointerdown', (event) => {
    if (rail && !rail.contains(event.target)) setExpanded(false);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !rail) return;
    const toggle = rail.querySelector('.fractured-header-actions-toggle');
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    setExpanded(false);
    toggle.focus();
  });
  document.addEventListener('turbo:load', scheduleRender);
  document.addEventListener('pjax:end', scheduleRender);

  new MutationObserver(scheduleRender).observe(document, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.compactTopRightActions) {
      compactEnabled = changes.compactTopRightActions.newValue === true;
    }
    if (changes.hideNotificationsButton) {
      hideNotifications = changes.hideNotificationsButton.newValue === true;
    }
    if (changes.compactTopRightActions || changes.hideNotificationsButton) render();
  });
  void chrome.storage.local.get({
    compactTopRightActions: false,
    hideNotificationsButton: false,
  }).then((settings) => {
    compactEnabled = settings.compactTopRightActions === true;
    hideNotifications = settings.hideNotificationsButton === true;
    render();
  });
})();
