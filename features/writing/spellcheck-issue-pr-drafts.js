(() => {
  'use strict';

  const JOB_KEY = 'fracturedSpellcheckJobV1';
  const BUTTON_CLASS = 'fractured-spellcheck-enhancer';
  const BUTTON_BOUND = 'data-fractured-spellcheck-bound';
  const SIDEBAR_ID = 'fractured-spellcheck-sidebar';
  const STYLE_ID = 'fractured-spellcheck-styles';
  const WRAP_KEY = 'spellcheckWrapDiffLines';
  let wrapDiffLines = true;

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
      .fractured-spellcheck-actions {
        align-items: center;
        display: inline-flex;
        gap: 8px;
        margin-inline-end: 8px;
        vertical-align: middle;
      }
      .${BUTTON_CLASS}, .fractured-rounded-image-button {
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
        margin: 0;
        min-width: 32px;
        padding: 0 7px;
        vertical-align: middle;
      }
      .${BUTTON_CLASS}:hover, .fractured-rounded-image-button:hover {
        background: var(--button-default-bgColor-hover, #f3f4f6);
        color: var(--fgColor-default, #1f2328);
      }
      .${BUTTON_CLASS}:focus-visible, .fractured-rounded-image-button:focus-visible {
        outline: 2px solid var(--focus-outlineColor, #0969da);
        outline-offset: 2px;
      }
      .${BUTTON_CLASS}[disabled], .fractured-rounded-image-button[disabled] {
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
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      #${SIDEBAR_ID}[data-wrap="false"] .fractured-spellcheck-diff { white-space: pre; overflow-wrap: normal; }
      #${SIDEBAR_ID} .fractured-spellcheck-wrap { align-items: center; display: flex; gap: 5px; font-size: 12px; }
      #${SIDEBAR_ID} .fractured-diff-add { background: rgba(46,160,67,.15); display: block; }
      #${SIDEBAR_ID} .fractured-diff-del { background: rgba(248,81,73,.15); display: block; }
      #${SIDEBAR_ID} .fractured-diff-add .fractured-diff-character { background: rgba(46,160,67,.4); border-radius: 2px; }
      #${SIDEBAR_ID} .fractured-diff-del .fractured-diff-character { background: rgba(248,81,73,.4); border-radius: 2px; }
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
    // Comment composers have a body but no title on both issue and PR pages.
    if (!/^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:\/|$)/.test(location.pathname)
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
    // Form/dialog controls must own their editor. Never fall through to an
    // unrelated composer elsewhere on the issue or PR page.
    if (direct) return fieldsFor(direct, control) ? direct : null;

    // Some GitHub composers do not use a form. Search only the nearby editor
    // wrapper, and stop at published comment cards so their Reply/Comment
    // menus cannot borrow the separate new-comment editor farther down.
    const publishedComment = '.timeline-comment, .js-comment, .react-issue-comment, '
      + '[data-testid="issue-comment"], [data-testid="comment-view"], [data-testid="comment-container"]';
    let depth = 0;
    for (let parent = control.parentElement;
      parent && parent !== document.body && depth < 5;
      parent = parent.parentElement, depth += 1) {
      if (parent.matches?.(publishedComment)) break;
      const fields = fieldsFor(parent, control);
      if (fields && visible(fields.body)) return parent;
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
    // "Comment actions", "Quote reply", etc. on published comments are not
    // submission buttons; their text used to match the loose word search.
    return (/^(create|submit|open|update|save)\b/i.test(text)
      || /^(comment|reply|add single comment|start a review)$/i.test(text))
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
    aside.setAttribute('data-wrap', String(wrapDiffLines));
    aside.setAttribute('aria-live', 'polite');
    aside.innerHTML = `
      <div class="fractured-spellcheck-header">
        <strong>✨ Spellcheck Only</strong>
        <label class="fractured-spellcheck-wrap"><input type="checkbox"> Wrap lines</label>
        <button class="fractured-spellcheck-close" type="button" aria-label="Close spellcheck changes">×</button>
      </div>
      <div class="fractured-spellcheck-content"></div>
    `;
    aside.querySelector('.fractured-spellcheck-close').addEventListener('click', () => aside.remove());
    const wrapInput = aside.querySelector('.fractured-spellcheck-wrap input');
    wrapInput.checked = wrapDiffLines;
    wrapInput.addEventListener('change', () => {
      setDiffWrap(wrapInput.checked);
      void chrome.storage.local.set({ [WRAP_KEY]: wrapDiffLines });
    });
    document.body.append(aside);
    return aside;
  }

  function setDiffWrap(enabled) {
    wrapDiffLines = enabled !== false;
    const aside = document.getElementById(SIDEBAR_ID);
    if (!aside) return;
    aside.setAttribute('data-wrap', String(wrapDiffLines));
    aside.querySelector('.fractured-spellcheck-wrap input').checked = wrapDiffLines;
  }

  function changedCharacters(before, after) {
    const a = Array.from(before);
    const b = Array.from(after);
    const removed = new Set();
    const added = new Set();
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
    const rows = endA - start;
    const cols = endB - start;
    // Bound memory for unusually large replacements while retaining shared edges.
    if (rows * cols > 250000) {
      for (let i = start; i < endA; i += 1) removed.add(i);
      for (let j = start; j < endB; j += 1) added.add(j);
      return { removed, added };
    }
    const table = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = cols - 1; j >= 0; j -= 1) {
        table[i][j] = a[start + i] === b[start + j]
          ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows || j < cols) {
      if (i < rows && j < cols && a[start + i] === b[start + j]) { i += 1; j += 1; }
      else if (j < cols && (i >= rows || table[i][j + 1] >= table[i + 1][j])) { added.add(start + j); j += 1; }
      else { removed.add(start + i); i += 1; }
    }
    return { removed, added };
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
    const lines = text.split('\n');
    const highlights = new Map();
    for (let i = 0; i < lines.length;) {
      if (!/^fractured-diff-(add|del)$/.test(lineClass(lines[i]))) { i += 1; continue; }
      const additions = [];
      const deletions = [];
      while (i < lines.length && /^fractured-diff-(add|del)$/.test(lineClass(lines[i]))) {
        (lines[i][0] === '+' ? additions : deletions).push(i++);
      }
      for (let pair = 0; pair < Math.max(additions.length, deletions.length); pair += 1) {
        const del = deletions[pair];
        const add = additions[pair];
        const { removed, added } = changedCharacters(del === undefined ? '' : lines[del].slice(1), add === undefined ? '' : lines[add].slice(1));
        if (del !== undefined) highlights.set(del, removed);
        if (add !== undefined) highlights.set(add, added);
      }
    }
    for (const [index, line] of lines.entries()) {
      const span = document.createElement('span');
      span.className = lineClass(line);
      const changed = highlights.get(index);
      if (changed?.size) {
        span.append(document.createTextNode(line[0]));
        let segment = '';
        let marked = false;
        const flush = () => {
          if (!segment) return;
          const part = document.createElement('span');
          if (marked) part.className = 'fractured-diff-character';
          part.textContent = segment;
          span.append(part);
          segment = '';
        };
        Array.from(line.slice(1)).forEach((character, offset) => {
          if (changed.has(offset) !== marked) { flush(); marked = changed.has(offset); }
          segment += character;
        });
        flush();
        span.append(document.createTextNode('\n'));
      } else span.textContent = `${line}\n`;
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
    if (kind === 'comment') {
      if (original.body === result.body) return '';
      return lineOperations(original.body, result.body)
        .map(([prefix, line]) => `${prefix}${line}`).join('\n');
    }
    return [
      fileDiff('title.txt', original.title, result.title),
      fileDiff('body.md', original.body, result.body),
    ].filter(Boolean).join('\n');
  }

  function resetEnhancerButtons() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
      button.disabled = false;
      button.textContent = '✨';
    });
  }

  function previewIsSelected(scope) {
    return [...scope.querySelectorAll('button, [role="tab"]')].some((tab) =>
      /^Preview$/i.test(controlText(tab))
      && (tab.getAttribute('aria-selected') === 'true'
        || tab.getAttribute('aria-pressed') === 'true'
        || tab.getAttribute('data-state') === 'active'
        || tab.matches?.('[aria-current="page"], .selected, .active')));
  }

  async function writableFieldsFor(submitControl) {
    let scope = scopeFor(submitControl) || submitControl.closest('form, [role="dialog"]');
    if (!scope) return null;

    let fields = fieldsFor(scope, submitControl);
    if (fields && visible(fields.body) && !previewIsSelected(scope)) return fields;

    // GitHub hides or replaces the Markdown textarea while Preview is open.
    // Return to Write before reading it, so spelling is checked against the
    // editable source rather than an absent or stale preview.
    const writeTab = [...scope.querySelectorAll('button, [role="tab"], a')]
      .find((tab) => /^Write$/i.test(controlText(tab)));
    if (!writeTab) return fields && visible(fields.body) ? fields : null;

    writeTab.click();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      scope = scopeFor(submitControl) || submitControl.closest('form, [role="dialog"]') || scope;
      fields = fieldsFor(scope, submitControl);
      if (fields && visible(fields.body)) return fields;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return null;
  }

  async function launchSpellcheck(control, submitControl) {
    const fields = await writableFieldsFor(submitControl);
    if (!fields) {
      showSidebar({ status: 'Switch to Write to spellcheck this draft.', error: true });
      return;
    }

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
      ? 'Correcting the comment…'
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

  async function applyResult(job, { force = false } = {}) {
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
    const images = globalThis.fracturedSpellcheckImages;
    if (images && !images.validate(activeJob.original.body, result.body)) {
      showSidebar({
        status: 'Spellcheck altered an image placeholder. No changes were applied; your staged image remains safe.',
        error: true, diff,
      });
      resetEnhancerButtons();
      return;
    }

    if (!force && !unchanged) {
      showSidebar({
        status: 'Spellcheck finished, but the draft changed while it was running, so Fractured did not overwrite your newer edits.',
        diff,
        apply: () => void applyResult(job, { force: true }),
      });
      resetEnhancerButtons();
      return;
    }

    if (activeFields.title) setControlValue(activeFields.title, result.title);
    setControlValue(activeFields.body, result.body);
    try {
      const uploaded = await images?.finalize(activeFields.body) || 0;
      if (images?.hasUnresolved(activeFields.body)) {
        throw new Error('One or more image placeholders still need their original files; attach them again before submitting.');
      }
      showSidebar({
        status: `${diff ? 'Applied spellcheck.' : 'Spellcheck found no changes.'}${uploaded ? ` Uploaded ${uploaded} rounded image${uploaded === 1 ? '' : 's'} and inserted the final GitHub link${uploaded === 1 ? '' : 's'}.` : ''}`,
        diff,
      });
    } catch (error) {
      showSidebar({
        status: `Spellcheck applied, but image upload was not completed: ${error.message}`,
        error: true, diff,
      });
    }
    resetEnhancerButtons();
  }

  function handleJob(job) {
    if (!activeJob || !job || job.id !== activeJob.id) return;
    if (job.status === 'complete') {
      void applyResult(job);
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
    // Stage rounded images in the same editor; no network upload happens while
    // the user writes or while ChatGPT works on the draft.
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.multiple = true;
    picker.className = 'fractured-rounded-image-picker';
    picker.hidden = true;
    const attach = document.createElement('button');
    attach.type = 'button';
    attach.className = 'fractured-rounded-image-button';
    attach.textContent = '🖼️';
    attach.title = 'Attach rounded image (upload after spellcheck)';
    attach.setAttribute('aria-label', attach.title);
    attach.addEventListener('click', () => picker.click());
    picker.addEventListener('change', async () => {
      attach.disabled = true;
      try {
        for (const file of Array.from(picker.files || [])) {
          await globalThis.fracturedSpellcheckImages.add(fields.body, file);
        }
        showSidebar({ status: 'Image inserted as a local placeholder. Run ✨ Spellcheck Only to upload the rounded PNG and replace the placeholder with its final link.' });
      } catch (error) {
        showSidebar({ status: `Could not attach image: ${error.message}`, error: true });
      } finally {
        picker.value = '';
        attach.disabled = false;
      }
    });
    // Treat the two draft actions as one toolbar group. Match the native
    // flex/grid gap when present; otherwise provide the same 8px gap before
    // GitHub's submit control, without double-spacing in flex toolbars.
    const actions = document.createElement('span');
    actions.className = 'fractured-spellcheck-actions';
    actions.append(attach, picker, button);
    const layout = control.parentElement && typeof getComputedStyle === 'function'
      ? getComputedStyle(control.parentElement) : null;
    if (layout && /^(inline-)?(flex|grid)$/.test(layout.display)) {
      const nativeGap = parseFloat(layout.columnGap);
      if (nativeGap > 0) {
        actions.style.gap = `${nativeGap}px`;
        actions.style.marginInlineEnd = '0';
      }
    }
    control.before(actions);
    // Prevent publishing provisional URLs, including with keyboard submission.
    const scope = scopeFor(control);
    scope?.addEventListener('submit', (event) => {
      globalThis.fracturedSpellcheckImages?.preventUnresolvedSubmission(event, fields.body);
    }, true);
    control.addEventListener('click', (event) => {
      globalThis.fracturedSpellcheckImages?.preventUnresolvedSubmission(event, fields.body);
    }, true);
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
    if (areaName !== 'local') return;
    if (changes[WRAP_KEY]) setDiffWrap(changes[WRAP_KEY].newValue);
    if (changes[JOB_KEY]) handleJob(changes[JOB_KEY].newValue);
  });
  chrome.storage.local?.get?.(WRAP_KEY).then((stored) => setDiffWrap(stored[WRAP_KEY]));

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('turbo:load', scheduleScan);
  document.addEventListener('pjax:end', scheduleScan);
  window.addEventListener('popstate', scheduleScan);
  scan();
})();
