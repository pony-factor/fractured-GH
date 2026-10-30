(() => {
  'use strict';

  let enabled = false;

  const ACTION_RE = /\b(commit changes|propose changes|merge pull request|squash and merge|rebase and merge|confirm merge|confirm squash|confirm rebase)\b/i;
  const EMOJI_RE = /^\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?)*\s+/u;
  const FIELD_SELECTOR = 'input:not([type]), input[type="text"], textarea';
  const TITLE_BOUND = 'data-fractured-simplify-title';
  const BODY_BOUND = 'data-fractured-simplify-body';
  const WRITING = 'data-fractured-simplify-writing';

  function descriptor(field) {
    const labels = field.labels ? Array.from(field.labels, (label) => label.textContent || '') : [];
    return [field.getAttribute('aria-label') || '', field.getAttribute('placeholder') || '', field.getAttribute('name') || '', field.id || '', ...labels]
      .join(' ').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function scopeFor(field) {
    return field.closest('form, [role="dialog"], [data-testid*="commit" i], [data-testid*="merge" i]') || field.parentElement;
  }

  function hasAction(scope) {
    if (!scope) return false;
    return Array.from(scope.querySelectorAll('button, input[type="submit"], input[type="button"]'))
      .some((control) => ACTION_RE.test(control.textContent || control.value || ''));
  }

  function isTitle(field) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
    const text = descriptor(field);
    if (/\b(description|body|extended|details)\b/.test(text)) return false;
    const match = /\bcommit (?:message|title|summary)\b/.test(text) || /\b(commitmessage|committitle)\b/.test(text) || /^(?:message|summary)$/.test(text);
    return match && (hasAction(scopeFor(field)) || /\b(commit|merge|squash|rebase|propose)\b/i.test(scopeFor(field)?.textContent || ''));
  }

  function isBody(field) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || isTitle(field)) return false;
    if (!/\b(description|body|extended|details)\b/.test(descriptor(field))) return false;
    const scope = scopeFor(field);
    return hasAction(scope) || /\b(commit|merge|squash|rebase|propose)\b/i.test(scope?.textContent || '');
  }

  function fields(scope, predicate) {
    if (!(scope instanceof Document || scope instanceof DocumentFragment || scope instanceof Element)) return [];
    return Array.from(scope.querySelectorAll(FIELD_SELECTOR)).filter(predicate);
  }

  function bodyText(title) {
    return fields(scopeFor(title), isBody).map((field) => field.value.trim()).filter(Boolean).join('\n');
  }

  function bodySummary(body) {
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim().replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/, '').trim();
      if (!line || /^```/.test(line) || /^<\/?(?:details|summary)\b/i.test(line)) continue;
      if (/^(?:summary|changes|what changed|description|details|implementation|verification|testing)$/i.test(line)) continue;
      return line;
    }
    return '';
  }

  function splitEmoji(value) {
    const match = value.match(EMOJI_RE);
    return { emoji: match ? match[0].trim() : '', text: value.replace(EMOJI_RE, '').trim() };
  }

  function simplify(value) {
    let text = splitEmoji(value).text.replace(/\s+/g, ' ').trim()
      .replace(/^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([^)]+\))?!?:\s*/i, '')
      .replace(/^please\s+/i, '')
      .replace(/^this (?:commit|change|patch|update)\s+/i, '');

    const rewrites = [
      [/^(?:adds?|added|implements?|implemented)\s+support\s+for\s+/i, 'Support '],
      [/^(?:adds?|added)\s+the ability to\s+/i, 'Allow '],
      [/^(?:adds?|added)\s+/i, 'Add '],
      [/^(?:fixes?|fixed)\s+(?:an?\s+)?(?:issue|bug)\s+(?:where|that|with)\s+/i, 'Fix '],
      [/^(?:fixes?|fixed)\s+/i, 'Fix '],
      [/^(?:removes?|removed)\s+/i, 'Remove '],
      [/^(?:updates?|updated)\s+/i, 'Update '],
      [/^(?:changes?|changed)\s+/i, 'Change '],
      [/^(?:implements?|implemented)\s+/i, 'Implement '],
      [/^(?:improves?|improved)\s+/i, 'Improve '],
      [/^(?:refactors?|refactored)\s+/i, 'Refactor '],
      [/^(?:ensures?|ensured)\s+/i, 'Ensure '],
      [/^(?:allows?|allowed|enables?|enabled)\s+/i, 'Allow '],
      [/^(?:uses?|used)\s+/i, 'Use '],
      [/^(?:makes?|made)\s+/i, 'Make '],
      [/^(?:moves?|moved)\s+/i, 'Move '],
      [/^(?:renames?|renamed)\s+/i, 'Rename '],
      [/^(?:simplifies?|simplified)\s+/i, 'Simplify '],
    ];
    for (const [pattern, replacement] of rewrites) text = text.replace(pattern, replacement);
    text = text.replace(/\bin order to\b/gi, 'to').replace(/\bwith the goal of\b/gi, 'to').replace(/\bfor the purpose of\b/gi, 'to').replace(/[.;:]+$/, '').trim();
    if (/^[a-z]/.test(text)) text = text[0].toUpperCase() + text.slice(1);
    return text;
  }

  function weak(title) {
    return /^(?:update|changes?|misc(?:ellaneous)? changes?|commit changes?|apply changes?|fix(?: issue| bug)?|wip|work in progress)$/i.test(title)
      || /^update (?:files?|code|project|repository|repo)$/i.test(title)
      || /^update [^\s]+\.[a-z0-9]{1,8}$/i.test(title);
  }

  function finalTitle(field) {
    const { emoji, text } = splitEmoji(field.value.trim());
    let next = simplify(text);
    const context = simplify(bodySummary(bodyText(field)));
    if (context && weak(next) && !weak(context)) next = context;
    if (!next) next = text;
    return emoji ? `${emoji} ${next}` : next;
  }

  function setValue(field, value) {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(field, value); else field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function rewrite(field) {
    if (!enabled || !isTitle(field) || field.hasAttribute(WRITING) || !field.value.trim()) return;
    const next = finalTitle(field);
    if (!next || next === field.value.trim()) return;
    field.setAttribute(WRITING, 'true');
    try { setValue(field, next); } finally { field.removeAttribute(WRITING); }
  }

  function prepare(scope) {
    if (!enabled) return;
    const titles = fields(scope, isTitle);
    for (const title of titles) rewrite(title);
    // Clear only descriptions paired with a detected commit title.
    for (const titleScope of new Set(titles.map(scopeFor))) {
      for (const body of fields(titleScope, isBody)) if (body.value) setValue(body, '');
    }
  }

  function bind(field) {
    if (isTitle(field) && !field.hasAttribute(TITLE_BOUND)) {
      field.setAttribute(TITLE_BOUND, 'true');
      const refresh = () => requestAnimationFrame(() => rewrite(field));
      field.addEventListener('change', refresh);
      field.addEventListener('blur', refresh);
    }
    if (isTitle(field)) rewrite(field);
    if (isBody(field) && !field.hasAttribute(BODY_BOUND)) {
      field.setAttribute(BODY_BOUND, 'true');
      const refresh = () => {
        const title = fields(scopeFor(field), isTitle)[0];
        if (title) requestAnimationFrame(() => rewrite(title));
      };
      field.addEventListener('change', refresh);
      field.addEventListener('blur', refresh);
    }
  }

  function scan(root = document) {
    if (!enabled) return;
    if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) bind(root);
    if (!(root instanceof Document || root instanceof DocumentFragment || root instanceof Element)) return;
    root.querySelectorAll(FIELD_SELECTOR).forEach(bind);
  }

  function beforeSubmit(event) {
    const form = event.target;
    if (form instanceof HTMLFormElement && hasAction(form)) prepare(form);
  }

  function beforeClick(event) {
    const control = event.target instanceof Element
      ? event.target.closest('button, input[type="submit"], input[type="button"]')
      : null;
    if (!control || !ACTION_RE.test(control.textContent || control.value || '')) return;
    const scope = control.closest('form, [role="dialog"]');
    if (scope) {
      prepare(scope);
      return;
    }
    for (let parent = control.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (fields(parent, isTitle).length) {
        prepare(parent);
        return;
      }
    }
  }

  let scanQueued = false;
  const observer = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(() => {
      scanQueued = false;
      scan();
    });
  });
  const scanPage = () => scan();

  function setEnabled(value) {
    const nextEnabled = Boolean(value);
    if (enabled === nextEnabled) return;
    enabled = nextEnabled;
    observer.disconnect();
    document.removeEventListener('submit', beforeSubmit, true);
    document.removeEventListener('click', beforeClick, true);
    document.removeEventListener('turbo:load', scanPage);
    document.removeEventListener('pjax:end', scanPage);
    window.removeEventListener('popstate', scanPage);
    if (!enabled) return;
    // Generated input values and textarea text can arrive after the dialog.
    observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] });
    document.addEventListener('submit', beforeSubmit, true);
    document.addEventListener('click', beforeClick, true);
    document.addEventListener('turbo:load', scanPage);
    document.addEventListener('pjax:end', scanPage);
    window.addEventListener('popstate', scanPage);
    scan();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.simplifyCommitMessages) {
      setEnabled(changes.simplifyCommitMessages.newValue);
    }
  });
  void chrome.storage.local.get({ simplifyCommitMessages: false }).then(({ simplifyCommitMessages }) => {
    setEnabled(simplifyCommitMessages);
  });
})();
