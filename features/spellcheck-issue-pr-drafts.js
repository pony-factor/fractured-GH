(() => {
  'use strict';

  const JOB_KEY = 'fracturedSpellcheckJobV1';
  const BUTTON_CLASS = 'fractured-spellcheck-enhancer';
  const BUTTON_BOUND = 'data-fractured-spellcheck-bound';
  const SIDEBAR_ID = 'fractured-spellcheck-sidebar';
  const STYLE_ID = 'fractured-spellcheck-styles';

  const TITLE_SELECTORS = [
    'input[name="issue[title]"]',
    'input[name="pull_request[title]"]',
    'input[aria-label="Issue title"]',
    'input[aria-label="Pull request title"]',
    'input[placeholder="Title"]',
  ];

  const BODY_SELECTORS = [
    'textarea[name="issue[body]"]',
    'textarea[name="pull_request[body]"]',
    'textarea[aria-label="Add a description"]',
    'textarea[aria-label*="body" i]',
    'textarea[placeholder*="description" i]',
    'textarea[data-testid*="body" i]',
  ];

  const COMMENT_SELECTORS = [
    'textarea[name="comment[body]"]',
    'textarea[name="pull_request_review[body]"]',
    'textarea[name="review[body]"]',
    'textarea[id="new_comment_field"]',
    'textarea[aria-label*="comment" i]',
    'textarea[placeholder*="comment" i]',
    'textarea[aria-label*="reply" i]',
    'textarea[placeholder*="reply" i]',
    'textarea[name="body"]',
  ];

  let activeJob = null;
  let activeFields = null;
  let scanQueued = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${BUTTON_CLASS} {
        align-items: center;
        background: transparent;
        border: 1px solid var(--borderColor-default, #d0d7de);
        border-radius: 6px;
        color: var(--fgColor-muted, #59636e);
        cursor: pointer;
        display: inline-flex;
        font-size: 14px;
        height: 32px;
        justify-content: center;
        margin-right: 6px;
        min-width: 32px;
        padding: 0 7px;
        vertical-align: middle;
      }
      .${BUTTON_CLASS}:hover {
        background: var(--button-default-bgColor-hover, #f3f4f6);
        color: var(--fgColor-default, #1f2328);
      }
      .${BUTTON_CLASS}:focus-visible {
        outline: 2px solid var(--focus-outlineColor, #0969da);
        outline-offset: 2px;
      }
      .${BUTTON_CLASS}[disabled] {
        cursor: progress;
        opacity: .6;
      }
      #${SIDEBAR_ID} {
        background: var(--bgColor-default, #fff);
        border: 1px solid var(--borderColor-default, #d0d7de);
        border-radius: 10px;
        box-shadow: 0 8px 28px rgba(27,31,36,.18);
        color: var(--fgColor-default, #1f2328);
        max-height: calc(100vh - 112px);
        overflow: hidden;
        position: fixed;
        right: 16px;
        top: 80px;
        width: min(430px, calc(100vw - 32px));
        z-index: 100000;
      }
      #${SIDEBAR_ID} .fractured-spellcheck-header {
        align-items: center;
        border-bottom: 1px solid var(--borderColor-default, #d0d7de);
        display: flex;
        gap: 8px;
        justify-content: space-between;
        padding: 10px 12px;
      }
      #${SIDEBAR_ID} .fractured-spellcheck-header strong { font-size: 13px; }
      #${SIDEBAR_ID} .fractured-spellcheck-close {
        background: transparent;
        border: 0;
        color: inherit;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 2px 5px;
      }
      #${SIDEBAR_ID} .fractured-spellcheck-content {
        max-height: calc(100vh - 170px);
        overflow: auto;
        padding: 10px 12px 12px;
      }
      #${SIDEBAR_ID} .fractured-spellcheck-status {
        color: var(--fgColor-muted, #59636e);
        font-size: 12px;
        margin: 0 0 9px;
      }
      #${SIDEBAR_ID} .fractured-spellcheck-error { color: var(--fgColor-danger, #cf222e); }
      #${SIDEBAR_ID} .fractured-spellcheck-diff {
        background: var(--bgColor-muted, #f6f8fa);
        border: 1px solid var(--borderColor-muted, #d8dee4);
        border-radius: 6px;
        font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        margin: 0;
        overflow: auto;
        padding: 8px;
        white-space: pre;
      }
      #${SIDEBAR_ID} .fractured-diff-add { background: rgba(46,160,67,.15); display: block; }
      #${SIDEBAR_ID} .fractured-diff-del { background: rgba(248,81,73,.15); display: block; }
      #${SIDEBAR_ID} .fractured-diff-meta { color: var(--fgColor-accent, #0969da); display: block; }
      #${SIDEBAR_ID} .fractured-spellcheck-apply {
        margin-bottom: 10px;
      }
      @media (max-width: 720px) {
        #${SIDEBAR_ID} {
          bottom: 12px;
          left: 12px;
          max-height: 58vh;
          right: 12px;
          top: auto;
          width: auto;
        }
        #${SIDEBAR_ID} .fractured-spellcheck-content { max-height: calc(58vh - 48px); }
      }
    `;
    document.documentElement.append(style);
  }

  function visible(element) {
    return Boolean(element?.isConnected && element.getClientRects().length);
  }

  function pickField(scope, selectors) {
    const candidates = selectors.flatMap((selector) => Array.from(scope.querySelectorAll(selector)));
    return candidates.find(visible) || candidates[0] || null;
  }

  function draftFields(scope) {
    if (!(scope instanceof Element || scope instanceof Document)) return null;
    const title = pickField(scope, TITLE_SELECTORS);
    const body = pickField(scope, BODY_SELECTORS);
    return title && body ? { title, body } : null;
  }

  function commentFields(scope, control) {
    // Comment composers have a body but no title. Keep this path limited to PR pages.
    if (!/^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(location.pathname)
      || !/\b(comment|reply|review)\b/i.test(controlText(control))) return null;

    let body = pickField(scope, COMMENT_SELECTORS);
    if (!body) {
      // GitHub sometimes gives new comment textareas no comment-specific attributes.
      const visibleTextareas = Array.from(scope.querySelectorAll('textarea')).filter(visible);
      if (visibleTextareas.length === 1) body = visibleTextareas[0];
    }
    return body ? { kind: 'comment', title: null, body } : null;
  }

  function fieldsFor(scope, control) {
    return draftFields(scope) || commentFields(scope, control);
  }

  function scopeFor(control) {
    const direct = control.closest('form, [role="dialog"]');
    if (direct && fieldsFor(direct, control)) return direct;

    for (let parent = control.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (fieldsFor(parent, control)) return parent;
    }
    return null;
  }

  function controlText(control) {
    return (control.textContent || control.value || control.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isSubmitControl(control) {
    const text = controlText(control);
    return /\b(create|submit|open|update|save|comment|reply|review)\b/i.test(text)
      && !/\b(cancel|preview|close)\b/i.test(text);
  }

  function setControlValue(control, value) {
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(control, value); else control.value = value;
    control.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value,
    }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function randomJobId() {
    return globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function sidebar() {
    injectStyles();
    let aside = document.getElementById(SIDEBAR_ID);
    if (aside) return aside;

    aside = document.createElement('aside');
    aside.id = SIDEBAR_ID;
    aside.setAttribute('aria-live', 'polite');
    aside.innerHTML = `
      <div class="fractured-spellcheck-header">
        <strong>✨ Spellcheck Only</strong>
        <button class="fractured-spellcheck-close" type="button" aria-label="Close spellcheck changes">×</button>
      </div>
      <div class="fractured-spellcheck-content"></div>
    `;
    aside.querySelector('.fractured-spellcheck-close').addEventListener('click', () => aside.remove());
    document.body.append(aside);
    return aside;
  }

  function lineClass(line) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('@@')) {
      return 'fractured-diff-meta';
    }
    if (line.startsWith('+')) return 'fractured-diff-add';
    if (line.startsWith('-')) return 'fractured-diff-del';
    return '';
  }

  function renderDiff(pre, text) {
    pre.replaceChildren();
    for (const line of text.split('\n')) {
      const span = document.createElement('span');
      span.className = lineClass(line);
      span.textContent = `${line}\n`;
      pre.append(span);
    }
  }

  function showSidebar({ status, diff = '', error = false, apply = null }) {
    const aside = sidebar();
    const content = aside.querySelector('.fractured-spellcheck-content');
    content.replaceChildren();

    const statusNode = document.createElement('p');
    statusNode.className = `fractured-spellcheck-status${error ? ' fractured-spellcheck-error' : ''}`;
    statusNode.textContent = status;
    content.append(statusNode);

    if (apply) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'Button--secondary Button--small fractured-spellcheck-apply';
      button.textContent = 'Apply spellcheck anyway';
      button.addEventListener('click', apply, { once: true });
      content.append(button);
    }

    if (diff) {
      const pre = document.createElement('pre');
      pre.className = 'fractured-spellcheck-diff';
      renderDiff(pre, diff);
      content.append(pre);
    }
  }

  function splitLines(value) {
    return String(value ?? '').replace(/\r\n/g, '\n').split('\n');
  }

  function lineOperations(before, after) {
    const a = splitLines(before);
    const b = splitLines(after);
    if (a.join('\n') === b.join('\n')) return a.map((line) => [' ', line]);

    if (a.length * b.length > 40000) {
      return [
        ...a.map((line) => ['-', line]),
        ...b.map((line) => ['+', line]),
      ];
    }

    const rows = a.length + 1;
    const cols = b.length + 1;
    const table = Array.from({ length: rows }, () => new Uint16Array(cols));

    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i][j] = a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }

    const operations = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        operations.push([' ', a[i]]);
        i += 1;
        j += 1;
      } else if (j < b.length && (i >= a.length || table[i][j + 1] >= table[i + 1][j])) {
        operations.push(['+', b[j]]);
        j += 1;
      } else {
        operations.push(['-', a[i]]);
        i += 1;
      }
    }
    return operations;
  }

  function fileDiff(name, before, after) {
    if (String(before ?? '') === String(after ?? '')) return '';
    const oldLines = splitLines(before);
    const newLines = splitLines(after);
    const header = [
      `diff --git a/${name} b/${name}`,
      `--- a/${name}`,
      `+++ b/${name}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ];
    const body = lineOperations(before, after).map(([prefix, line]) => `${prefix}${line}`);
    return [...header, ...body].join('\n');
  }

  function draftDiff(original, result, kind = 'draft') {
    return [
      kind === 'comment' ? '' : fileDiff('title.txt', original.title, result.title),
      fileDiff(kind === 'comment' ? 'comment.md' : 'body.md', original.body, result.body),
    ].filter(Boolean).join('\n');
  }

  function resetEnhancerButtons() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
      button.disabled = false;
      button.textContent = '✨';
    });
  }

  async function launchSpellcheck(control, submitControl) {
    const scope = scopeFor(submitControl);
    const fields = scope && fieldsFor(scope, submitControl);
    if (!fields) return;

    const original = {
      title: fields.title?.value ?? '',
      body: fields.body.value,
    };
    if (!original.title.trim() && !original.body.trim()) return;

    const job = {
      id: randomJobId(),
      status: 'pending',
      sourceUrl: location.href,
      createdAt: Date.now(),
      kind: fields.kind || 'draft',
      original,
    };

    activeJob = job;
    activeFields = fields;
    control.disabled = true;
    control.textContent = '…';
    showSidebar({ status: fields.kind === 'comment'
      ? 'Running Spellcheck Only on the comment…'
      : 'Running Spellcheck Only on the title and body…' });

    await chrome.storage.local.set({ [JOB_KEY]: job });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'fractured:open-spellcheck',
        jobId: job.id,
      });
      if (!response?.ok) throw new Error(response?.error || 'Could not open ChatGPT for spellcheck.');
    } catch (error) {
      await chrome.storage.local.set({
        [JOB_KEY]: {
          ...job,
          status: 'error',
          error: error?.message || 'Could not open ChatGPT for spellcheck.',
        },
      });
    }
  }

  function applyResult(job, { force = false } = {}) {
    if (!activeFields || !activeJob || activeJob.id !== job.id) return;
    const result = job.result;
    if (!result || typeof result.title !== 'string' || typeof result.body !== 'string') return;

    if (!activeFields.body.isConnected || (activeFields.title && !activeFields.title.isConnected)) {
      showSidebar({ status: 'The original editor was closed before spellcheck finished. No changes were applied.', error: true });
      resetEnhancerButtons();
      return;
    }
    const current = {
      title: activeFields.title?.value ?? '',
      body: activeFields.body.value,
    };
    const unchanged = current.title === activeJob.original.title && current.body === activeJob.original.body;
    const diff = draftDiff(activeJob.original, result, activeJob.kind);

    if (!force && !unchanged) {
      showSidebar({
        status: 'Spellcheck finished, but the draft changed while it was running, so Fractured did not overwrite your newer edits.',
        diff,
        apply: () => applyResult(job, { force: true }),
      });
      resetEnhancerButtons();
      return;
    }

    if (activeFields.title) setControlValue(activeFields.title, result.title);
    setControlValue(activeFields.body, result.body);
    showSidebar({
      status: diff ? 'Applied the spellcheck changes to your draft.' : 'Spellcheck found no changes.',
      diff,
    });
    resetEnhancerButtons();
  }

  function handleJob(job) {
    if (!activeJob || !job || job.id !== activeJob.id) return;
    if (job.status === 'complete') {
      applyResult(job);
      return;
    }
    if (job.status === 'error') {
      showSidebar({
        status: job.error || 'Spellcheck Only could not finish this draft.',
        error: true,
      });
      resetEnhancerButtons();
    }
  }

  function createEnhancer(control, fields) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.textContent = '✨';
    button.title = fields.kind === 'comment'
      ? 'Spellcheck this comment'
      : 'Enhance title and body with Spellcheck Only';
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', () => void launchSpellcheck(button, control));
    control.before(button);
  }

  function scan() {
    injectStyles();
    const controls = document.querySelectorAll('button, input[type="submit"]');
    for (const control of controls) {
      if (control.hasAttribute(BUTTON_BOUND) || !isSubmitControl(control)) continue;
      const scope = scopeFor(control);
      const fields = scope && fieldsFor(scope, control);
      if (!fields || scope.querySelector(`.${BUTTON_CLASS}`)) continue;
      control.setAttribute(BUTTON_BOUND, 'true');
      createEnhancer(control, fields);
    }
  }

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(() => {
      scanQueued = false;
      scan();
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[JOB_KEY]) return;
    handleJob(changes[JOB_KEY].newValue);
  });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('turbo:load', scheduleScan);
  document.addEventListener('pjax:end', scheduleScan);
  window.addEventListener('popstate', scheduleScan);
  scan();
})();
