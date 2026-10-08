(() => {
  'use strict';

  const STYLE_ID = 'fractured-wrap-diff-lines-style';
  const CSS = `
    .diff-table .blob-code-inner:not(.blob-code-hunk),
    .file-diff .blob-code-inner:not(.blob-code-hunk),
    [data-testid="diff-view"] .blob-code-inner:not(.blob-code-hunk),
    [data-testid="diff-file"] .blob-code-inner:not(.blob-code-hunk),
    .diff-line-row .diff-text-cell:not(.hunk) .diff-text,
    .diff-line-row .diff-text-cell:not(.hunk) .diff-text-inner {
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
      word-break: normal !important;
    }
    .file-diff-split {
      table-layout: fixed !important;
    }
  `;
  let rootObserver = null;

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
    if (!enabled) {
      document.getElementById(STYLE_ID)?.remove();
      return;
    }
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
    if (areaName === 'local' && changes.wrapDiffLines) {
      setEnabled(Boolean(changes.wrapDiffLines.newValue));
    }
  });
  void chrome.storage.local.get({ wrapDiffLines: true }).then(({ wrapDiffLines }) => {
    setEnabled(wrapDiffLines);
  });
})();
