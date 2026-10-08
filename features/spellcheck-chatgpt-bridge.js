(() => {
  'use strict';

  const JOB_KEY = 'fracturedSpellcheckJobV1';
  const PARAM = 'fractured-spellcheck';
  const PLUGIN_NAME = 'Spellcheck Only';
  const POLL_MS = 100;
  const COMPOSER_TIMEOUT_MS = 30000;
  const MENTION_TIMEOUT_MS = 8000;
  const RESPONSE_TIMEOUT_MS = 120000;

  const jobId = new URL(location.href).searchParams.get(PARAM);
  if (!jobId) return;

  function pause(ms = POLL_MS) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function visible(node) {
    return Boolean(node?.isConnected !== false && node?.getClientRects?.().length);
  }

  async function waitUntil(test, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = test();
      if (value) return value;
      await pause();
    }
    return null;
  }

  function composerInput() {
    return document.querySelector('#prompt-textarea, [data-composer-markdown][contenteditable="true"]');
  }

  function labels(node) {
    return [
      node?.getAttribute?.('aria-label'),
      node?.getAttribute?.('title'),
      node?.getAttribute?.('app-mention-display-name'),
      node?.getAttribute?.('app-mention-name'),
      node?.textContent,
    ].filter(Boolean).map((value) => String(value).replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function pluginLabelMatches(node) {
    const wanted = PLUGIN_NAME.toLowerCase();
    return labels(node).some((label) => {
      const normalized = label.toLowerCase();
      return normalized === wanted || normalized.startsWith(`${wanted} `);
    });
  }

  function findPluginMention(composer) {
    return [...(composer?.querySelectorAll?.('[app-mention-path]') || [])].find((node) => (
      /^app:\/\//.test(node.getAttribute?.('app-mention-path') || '')
      && pluginLabelMatches(node)
    )) || null;
  }

  function findPluginSuggestion() {
    const surfaces = [...document.querySelectorAll([
      '[data-mention-list-scroll-area]',
      '[role="listbox"]',
    ].join(', '))].filter((surface) => visible(surface) && !surface.closest?.('[inert]'));

    for (const surface of surfaces) {
      const actions = surface.querySelectorAll([
        'button',
        '[role="option"]',
        '[role="menuitem"]',
        '[data-list-navigation-item="true"]',
      ].join(', '));
      const match = [...actions].find((candidate) => visible(candidate) && pluginLabelMatches(candidate));
      if (match) return match;
    }
    return null;
  }

  function controlValue(control) {
    return control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement
      ? control.value
      : (control.innerText || control.textContent || '');
  }

  function nativeSet(control, text) {
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(control, text);
    control.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text,
    }));
    return control.value === text;
  }

  async function replaceComposerText(composer, text) {
    composer.focus({ preventScroll: true });
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      return nativeSet(composer, text);
    }
    if (!composer.isContentEditable) return false;

    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, text);
    await pause(50);
    return controlValue(composer).replace(/\n+$/, '') === text.replace(/\n+$/, '');
  }

  async function activatePlugin(composer) {
    if (!await replaceComposerText(composer, '@')) return false;

    composer.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, PLUGIN_NAME);

    const suggestion = await waitUntil(findPluginSuggestion, MENTION_TIMEOUT_MS);
    if (!suggestion) return false;
    suggestion.click();
    return Boolean(await waitUntil(() => findPluginMention(composer), MENTION_TIMEOUT_MS));
  }

  async function appendPrompt(composer, prompt) {
    if (!findPluginMention(composer)) return false;
    composer.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, `\n${prompt}`);
    await pause(50);
    return controlValue(composer).includes(prompt.slice(-80));
  }

  function sendButton(composer) {
    const form = composer.closest('form') || composer.closest('[data-type="unified-composer"]');
    return form?.querySelector([
      'button[data-testid="send-button"]',
      'button[aria-label^="Send" i]',
      'button[type="submit"]',
    ].join(', ')) || null;
  }

  function stopButton() {
    return [...document.querySelectorAll([
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
    ].join(', '))].find(visible) || null;
  }

  function assistantMessages() {
    return [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  }

  function latestAssistantText(afterCount) {
    const messages = assistantMessages();
    if (messages.length <= afterCount) return '';
    const latest = messages[messages.length - 1];
    return latest.innerText || latest.textContent || '';
  }

  async function waitForResponse(afterCount) {
    const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
    let last = '';
    let stableSince = 0;

    while (Date.now() < deadline) {
      const text = latestAssistantText(afterCount).trim();
      if (text !== last) {
        last = text;
        stableSince = Date.now();
      }
      if (text && !stopButton() && Date.now() - stableSince >= 1200) return text;
      await pause(250);
    }
    throw new Error('Spellcheck Only did not return a response in time.');
  }

  function parseResult(text) {
    const cleaned = String(text || '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first < 0 || last <= first) throw new Error('Spellcheck Only did not return the expected JSON result.');

    let parsed;
    try {
      parsed = JSON.parse(cleaned.slice(first, last + 1));
    } catch {
      throw new Error('Spellcheck Only returned JSON that Fractured could not parse.');
    }

    if (typeof parsed?.title !== 'string' || typeof parsed?.body !== 'string') {
      throw new Error('Spellcheck Only did not return both a title and body.');
    }
    return { title: parsed.title, body: parsed.body };
  }

  function buildPrompt(job) {
    const input = JSON.stringify({
      title: String(job.original?.title ?? ''),
      body: String(job.original?.body ?? ''),
    });
    return [
      job.kind === 'comment'
        ? 'Spellcheck this GitHub pull request comment.'
        : 'Spellcheck this GitHub issue or pull request draft.',
      'Correct spelling, capitalization, punctuation, and grammar only. Preserve meaning, Markdown, links, code, identifiers, and formatting.',
      'Return only one valid JSON object with exactly the string keys "title" and "body". Do not use Markdown fences or add commentary.',
      `Input JSON: ${input}`,
    ].join('\n');
  }

  async function writeJob(next) {
    await chrome.storage.local.set({ [JOB_KEY]: next });
  }

  async function closeBridgeTab() {
    try {
      await chrome.runtime.sendMessage({ type: 'fractured:close-spellcheck-tab' });
    } catch {
      // The result is already stored; leaving the helper tab open is harmless.
    }
  }

  async function run() {
    const stored = await chrome.storage.local.get(JOB_KEY);
    const job = stored[JOB_KEY];
    if (!job || job.id !== jobId || job.status !== 'pending') return;

    try {
      const composer = await waitUntil(composerInput, COMPOSER_TIMEOUT_MS);
      if (!composer) throw new Error('ChatGPT composer was not available for Spellcheck Only.');
      if (!await activatePlugin(composer)) throw new Error('Fractured could not activate the Spellcheck Only plugin.');

      const prompt = buildPrompt(job);
      if (!await appendPrompt(composer, prompt)) throw new Error('Fractured could not prepare the Spellcheck Only request.');

      const beforeCount = assistantMessages().length;
      const send = await waitUntil(() => {
        const button = sendButton(composer);
        return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
      }, MENTION_TIMEOUT_MS);
      if (!send) throw new Error('ChatGPT Send button did not become available.');
      send.click();

      const response = await waitForResponse(beforeCount);
      const result = parseResult(response);
      await writeJob({
        ...job,
        status: 'complete',
        completedAt: Date.now(),
        result,
      });
    } catch (error) {
      await writeJob({
        ...job,
        status: 'error',
        completedAt: Date.now(),
        error: error?.message || 'Spellcheck Only failed.',
      });
    } finally {
      await pause(250);
      await closeBridgeTab();
    }
  }

  void run();
})();
