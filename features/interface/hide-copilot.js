(() => {
  'use strict';

  const STYLE_ID = 'github-tweaks-hide-copilot-style';
  const HIDDEN_ATTR = 'data-fractured-copilot-control';
  const CONTROL_SELECTOR = 'button, [role="button"], [role="menuitem"]';
  const CSS = `
    [${HIDDEN_ATTR}],
    li:has(> [${HIDDEN_ATTR}]),
    a[href="/copilot"],
    a[href^="/copilot/"],
    a[href^="/copilot?"],
    a[href="https://github.com/copilot"],
    a[href^="https://github.com/copilot/"],
    a[href^="https://github.com/copilot?"],
    a[href^="/features/copilot"],
    a[href^="https://github.com/features/copilot"],
    a[href^="https://githubcopilot.com"],
    button[aria-label*="copilot" i],
    [role="button"][aria-label*="copilot" i],
    [role="menuitem"][aria-label*="copilot" i],
    a:has(.octicon-copilot),
    button:has(.octicon-copilot),
    [role="button"]:has(.octicon-copilot),
    [role="menuitem"]:has(.octicon-copilot),
    [data-component="ButtonGroup"]:has(.octicon-copilot),
    [class*="CopilotItems-module__Wrapper__"],
    li:has(> a[href="/copilot"]),
    li:has(> a[href^="/copilot/"]),
    li:has(> a[href^="/copilot?"]),
    [data-testid^="copilot-"],
    #copilot-chat,
    #copilot-chat-panel,
    copilot-chat,
    react-app[app-name="copilot-chat"],
    aside[aria-label*="copilot" i],
    [role="dialog"][aria-label*="copilot" i] {
      display: none !important;
    }
  `;

  let rootObserver = null;
  let controlObserver = null;

  function updateControl(control) {
    const labelIds = (control.getAttribute('aria-labelledby') || '').split(/\s+/);
    const name = [
      control.getAttribute('aria-label'),
      ...labelIds.map((id) => document.getElementById(id)?.textContent),
      control.textContent,
    ].join(' ');
    control.toggleAttribute(HIDDEN_ATTR, /\bcopilot\b/i.test(name));
  }

  function updateControls(root) {
    if (root instanceof Element && root.matches(CONTROL_SELECTOR)) updateControl(root);
    for (const control of root.querySelectorAll(CONTROL_SELECTOR)) updateControl(control);
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return true;
    const root = document.head || document.documentElement;
    if (!root) return false;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    root.append(style);
    return true;
  }

  function setEnabled(enabled) {
    rootObserver?.disconnect();
    rootObserver = null;
    controlObserver?.disconnect();
    controlObserver = null;

    if (!enabled) {
      document.getElementById(STYLE_ID)?.remove();
      for (const control of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) {
        control.removeAttribute(HIDDEN_ATTR);
      }
      return;
    }

    updateControls(document);
    controlObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const element = mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement;
        const control = element?.closest(CONTROL_SELECTOR);
        if (control) updateControl(control);
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) updateControls(node);
        }
      }
    });
    controlObserver.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'aria-labelledby'],
    });

    if (!installStyle()) {
      rootObserver = new MutationObserver(() => {
        if (installStyle()) {
          rootObserver.disconnect();
          rootObserver = null;
        }
      });
      rootObserver.observe(document, { childList: true, subtree: true });
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.hideCopilot) {
      setEnabled(Boolean(changes.hideCopilot.newValue));
    }
  });

  void chrome.storage.local.get({ hideCopilot: true }).then(({ hideCopilot }) => {
    setEnabled(hideCopilot);
  });
})();
