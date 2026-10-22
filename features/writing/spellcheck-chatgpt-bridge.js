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
    const legacy = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (legacy.length) return legacy;
    return [...document.querySelectorAll('[data-conversation-role="assistant"]')]
      .map((heading) => heading.parentElement);
  }

  function latestAssistantText(afterCount) {
    const messages = assistantMessages();
    if (messages.length <= afterCount) return '';
    const latest = messages[messages.length - 1];
    return latest.innerText || latest.textContent || '';
  }

  async function waitForResponse(afterCount) {
    // Background tabs throttle polling timers. Observe the streamed response so
    // a completed result is collected while the user stays on GitHub.
    return new Promise((resolve, reject) => {
      let timeout;
      const finish = (text) => {
        observer.disconnect();
        window.clearTimeout(timeout);
        resolve(text);
      };
      const check = () => {
        const text = latestAssistantText(afterCount).trim();
        if (!text) return;
        try {
          // A complete JSON object is the response contract; partial streamed
          // text must never be applied to the original editor.
          parseResult(text);
          finish(text);
        } catch {
          // Keep observing until the JSON response is complete.
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
      });
      timeout = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error('Spellcheck Only did not return a response in time.'));
      }, RESPONSE_TIMEOUT_MS);
      check();
    });
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

  function shouldGenerateTitle(job) {
    return job.kind !== 'comment'
      && !String(job.original?.title ?? '').trim()
      && Boolean(String(job.original?.body ?? '').trim());
  }

  function needsShortTitleEmoji(job) {
    if (job.kind === 'comment' || shouldGenerateTitle(job)) return false;
    const title = String(job.original?.title ?? '').trim();
    return Boolean(title) && title.split(/\s+/u).length <= 6;
  }

  function buildPrompt(job, protectedDraft) {
    const generateTitle = shouldGenerateTitle(job);
    const input = JSON.stringify(protectedDraft?.masked ?? {
      title: String(job.original?.title ?? ''),
      body: String(job.original?.body ?? ''),
    });
    return [
      job.kind === 'comment'
        ? 'Spellcheck this GitHub issue or pull request comment.'
        : generateTitle
          ? 'Generate a title and proofread this GitHub issue or pull request draft.'
          : 'Spellcheck this GitHub issue or pull request draft.',
      generateTitle
        ? 'The title is blank: generate a concise, specific 4–12 word title that describes the body. Do not leave the title empty. For the body, correct spelling, capitalization, punctuation, and grammar only; preserve its meaning, Markdown, links, code, identifiers, and formatting.'
        : 'Correct spelling, capitalization, punctuation, and grammar only. Preserve meaning, Markdown, links, code, identifiers, and formatting.',
      job.kind === 'comment'
        ? null
        : generateTitle
          ? 'Apply the Spellcheck Only emoji rule to the generated title as an independent input: if it has six words or fewer, prefix exactly one professional emoji appropriate to its content and omit ending punctuation. Do not add an emoji to the body.'
          : needsShortTitleEmoji(job)
            ? 'The existing title has six words or fewer. As the highest-priority exception to spelling-only edits, the corrected title MUST start with exactly one professional emoji appropriate to its content, even when the body is long. Preserve an existing leading emoji rather than duplicating it; do not end the title with punctuation. Do not add an emoji to the body.'
            : 'Preserve any existing title emoji. Do not add a new emoji to titles longer than six words.',
      'Preserve every fractured-pending-image: placeholder exactly as written; these represent images to upload after spellcheck.',
      'The FRACTUREDLINKTOKEN markers represent protected Markdown links and URLs. Preserve every marker exactly once, in its original order and field; never add or change a marker.',
      'Return only one valid JSON object with exactly the string keys "title" and "body". Do not use Markdown fences or add commentary.',
      `Input JSON: ${input}`,
    ].join('\n');
  }

  // Browser extension reloads invalidate APIs in scripts from already-open tabs.
  // A lost context is not a spellcheck failure that can be written to storage.
  function isExtensionContextInvalidated(error) {
    if (/Extension context invalidated/i.test(String(error?.message ?? error ?? ''))) return true;
    try {
      return !chrome.runtime?.id;
    } catch {
      return true;
    }
  }

  async function writeJob(next) {
    try {
      if (isExtensionContextInvalidated()) return false;
      await chrome.storage.local.set({ [JOB_KEY]: next });
      return true;
    } catch (error) {
      if (isExtensionContextInvalidated(error)) return false;
      throw error;
    }
  }

  async function closeBridgeTab() {
    try {
      await chrome.runtime.sendMessage({ type: 'fractured:close-spellcheck-tab' });
    } catch {
      // The result is already stored; leaving the helper tab open is harmless.
    }
  }

  async function run() {
    let job;
    let started = false;
    try {
      if (isExtensionContextInvalidated()) return;
      const stored = await chrome.storage.local.get(JOB_KEY);
      job = stored?.[JOB_KEY];
      if (!job || job.id !== jobId || job.status !== 'pending') return;
      started = true;
      const composer = await waitUntil(composerInput, COMPOSER_TIMEOUT_MS);
      if (!composer) throw new Error('ChatGPT composer was not available for Spellcheck Only.');
      const links = globalThis.fracturedSpellcheckLinks;
      if (!links) throw new Error('Markdown link protection was not available.');
      const protectedDraft = links.protect(job.original);
      const generateTitle = shouldGenerateTitle(job);
      const prompt = buildPrompt(job, protectedDraft);
      if (generateTitle) {
        // A missing title requires generation rather than Spellcheck Only.
        if (!await replaceComposerText(composer, prompt)) {
          throw new Error('Fractured could not prepare the title generation request.');
        }
      } else {
        if (!await activatePlugin(composer)) throw new Error('Fractured could not activate the Spellcheck Only plugin.');
        if (!await appendPrompt(composer, prompt)) throw new Error('Fractured could not prepare the Spellcheck Only request.');
      }

      const beforeCount = assistantMessages().length;
      const send = await waitUntil(() => {
        const button = sendButton(composer);
        return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
      }, MENTION_TIMEOUT_MS);
      if (!send) throw new Error('ChatGPT Send button did not become available.');
      send.click();

      const response = await waitForResponse(beforeCount);
      const result = links.restore(protectedDraft, parseResult(response));
      if (generateTitle && !result.title.trim()) {
        throw new Error('ChatGPT did not generate a title for the untitled draft.');
      }
      await writeJob({
        ...job,
        status: 'complete',
        completedAt: Date.now(),
        result,
      });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) return;
      if (job) {
        try {
          await writeJob({
            ...job,
            status: 'error',
            completedAt: Date.now(),
            error: error?.message || 'Spellcheck Only failed.',
          });
        } catch (storageError) {
          if (!isExtensionContextInvalidated(storageError)) {
            console.warn('Fractured could not save the Spellcheck Only error:', storageError);
          }
        }
      } else {
        console.warn('Fractured could not load the Spellcheck Only job:', error);
      }
    } finally {
      if (started && !isExtensionContextInvalidated()) {
        await pause(250);
        await closeBridgeTab();
      }
    }
  }

  void run().catch((error) => {
    if (!isExtensionContextInvalidated(error)) {
      console.error('Fractured spellcheck bridge failed:', error);
    }
  });
})();
