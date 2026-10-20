const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../features/writing/spellcheck-chatgpt-bridge.js'), 'utf8')
  .replace('const COMPOSER_TIMEOUT_MS = 30000;', 'const COMPOSER_TIMEOUT_MS = 1;')
  .replace('await pause(250);\n        await closeBridgeTab();', 'await pause(0);\n        await closeBridgeTab();')
  .replace(/  void run\(\)\.catch\([\s\S]*?\n  \}\);(?=\n\}\)\(\);)/, '  globalThis.bridge = { run, writeJob, buildPrompt, shouldGenerateTitle };');

function harness({ getError, setError, invalidateOnSet = false } = {}) {
  const writes = [];
  const warnings = [];
  const messages = [];
  let runtimeId = 'active-extension';
  const chrome = {
    runtime: {
      get id() { return runtimeId; },
      async sendMessage(message) { messages.push(message); },
    },
    storage: {
      local: {
        async get() {
          if (getError) {
            if (/Extension context invalidated/.test(getError.message)) runtimeId = '';
            throw getError;
          }
          return { fracturedSpellcheckJobV1: {
            id: 'test-job', status: 'pending', original: { title: '', body: '' },
          } };
        },
        async set(value) {
          writes.push(value);
          if (invalidateOnSet) runtimeId = '';
          if (setError) throw setError;
        },
      },
    },
  };
  const ctx = {
    URL,
    chrome,
    location: { href: 'https://chatgpt.com/c/example?fractured-spellcheck=test-job' },
    document: { querySelector() { return null; } },
    window: { setTimeout, clearTimeout },
    console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
  };
  vm.runInNewContext(script, ctx, { filename: 'spellcheck-chatgpt-bridge.js' });
  assert.ok(ctx.bridge, 'test bridge exports expected functions');
  return { ...ctx.bridge, writes, warnings, messages, invalidate: () => { runtimeId = ''; } };
}

test('writes pending job updates normally while the extension is active', async () => {
  const bridge = harness();
  assert.equal(await bridge.writeJob({ status: 'complete' }), true);
  assert.equal(bridge.writes[0].fracturedSpellcheckJobV1.status, 'complete');
});

test('skips storage writes when extension context is already invalidated', async () => {
  const bridge = harness();
  bridge.invalidate();
  assert.equal(await bridge.writeJob({ status: 'complete' }), false);
  assert.equal(bridge.writes.length, 0);
});

test('suppresses invalidation during storage write without an unhandled rejection', async () => {
  const bridge = harness({
    invalidateOnSet: true,
    setError: new Error('Extension context invalidated.'),
  });
  assert.equal(await bridge.writeJob({ status: 'complete' }), false);
  assert.equal(bridge.warnings.length, 0);
});

test('handles invalidation before the initial job read', async () => {
  const bridge = harness({ getError: new Error('Extension context invalidated.') });
  await assert.doesNotReject(bridge.run());
  assert.equal(bridge.writes.length, 0);
  assert.equal(bridge.messages.length, 0);
  assert.equal(bridge.warnings.length, 0);
});

test('does not retry an invalidated write while handling a failed spellcheck', async () => {
  const bridge = harness({
    invalidateOnSet: true,
    setError: new Error('Extension context invalidated.'),
  });
  await assert.doesNotReject(bridge.run());
  assert.equal(bridge.writes.length, 1);
  assert.equal(bridge.messages.length, 0);
  assert.equal(bridge.warnings.length, 0);
});

test('records an ordinary composer failure and closes the helper tab', async () => {
  const bridge = harness();
  await assert.doesNotReject(bridge.run());
  assert.equal(bridge.writes[0].fracturedSpellcheckJobV1.status, 'error');
  assert.match(bridge.writes[0].fracturedSpellcheckJobV1.error, /composer was not available/);
  assert.equal(bridge.messages.length, 1);
});

test('keeps unrelated storage failures visible without a rejected run promise', async () => {
  const bridge = harness({ setError: new Error('Storage quota reached') });
  await assert.doesNotReject(bridge.run());
  assert.equal(bridge.writes.length, 1);
  assert.equal(bridge.warnings.length, 1);
  assert.match(bridge.warnings[0][0], /could not save/);
});

test('logs initial non-invalidation read failures without trying to write an unknown job', async () => {
  const bridge = harness({ getError: new Error('Temporary storage failure') });
  await assert.doesNotReject(bridge.run());
  assert.equal(bridge.writes.length, 0);
  assert.equal(bridge.warnings.length, 1);
  assert.match(bridge.warnings[0][0], /could not load/);
});

// Streaming response regression coverage introduced by PR #53.
function setup({ modern = false } = {}) {
  let onMutation;
  let onTimeout;
  let disconnected = false;
  let cleared = false;
  const messages = [];
  const context = {
    URL,
    location: { href: 'https://chatgpt.com/?fractured-spellcheck=test' },
    document: {
      documentElement: {},
      querySelectorAll: selector => selector.includes('data-message-author-role')
        ? (modern ? [] : messages)
        : (modern ? messages.map(parentElement => ({ parentElement })) : []),
    },
    window: {
      setTimeout(callback) { onTimeout = callback; return 1; },
      clearTimeout() { cleared = true; },
    },
    MutationObserver: class {
      constructor(callback) { onMutation = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../features/writing/spellcheck-chatgpt-bridge.js'), 'utf8')
    .replace(/  void run\(\)\.catch\([\s\S]*?\n  \}\);(?=\n\}\)\(\);)/, '  globalThis.waitForResponse = waitForResponse;'), context);
  return {
    wait: context.waitForResponse,
    messages,
    mutate: () => onMutation(),
    timeout: () => onTimeout(),
    cleaned: () => disconnected && cleared,
  };
}

test('collects a completed streamed result without a polling timer firing', async () => {
  const app = setup();
  app.messages.push({ innerText: 'Earlier answer' });
  const result = app.wait(1);
  app.messages.push({ innerText: '{"title":"","body":"Cor' });
  app.mutate();
  let finished = false;
  result.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, 'partial JSON must not be applied');
  app.messages[1].innerText = '{"title":"","body":"Corrected comment."}';
  app.mutate();
  assert.equal(await result, app.messages[1].innerText);
  assert.equal(app.cleaned(), true);
});

test('collects a response already present when observation starts', async () => {
  const app = setup();
  app.messages.push({ innerText: '{"title":"","body":"Done."}' });
  assert.equal(await app.wait(0), app.messages[0].innerText);
  assert.equal(app.cleaned(), true);
});

test('reads responses identified by the current conversation-role heading', async () => {
  const app = setup({ modern: true });
  const result = app.wait(0);
  app.messages.push({ innerText: 'ChatGPT said:\n{"title":"","body":"Corrected."}\nCopy' });
  app.mutate();
  assert.equal(await result, app.messages[0].innerText);
  assert.equal(app.cleaned(), true);
});

test('reports a timeout when no valid response arrives', async () => {
  const app = setup();
  const result = app.wait(0);
  app.timeout();
  await assert.rejects(result, /did not return a response in time/);
});

test('generates a title only when a draft has no title but has a body', () => {
  const bridge = harness();
  const untitled = { kind: 'draft', original: { title: '  ', body: '## Summary\nFix the image picker.' } };
  assert.equal(bridge.shouldGenerateTitle(untitled), true);
  const prompt = bridge.buildPrompt(untitled);
  assert.match(prompt, /Generate a title and proofread/);
  assert.match(prompt, /title is blank: generate a concise/);
  assert.match(prompt, /Preserve every fractured-pending-image: placeholder/);
  assert.match(prompt, /"title" and "body"/);
});

test('preserves spellcheck-only instructions for titled drafts and comments', () => {
  const bridge = harness();
  for (const job of [
    { kind: 'draft', original: { title: 'Existing title', body: 'Bodi' } },
    { kind: 'comment', original: { title: '', body: 'Commment text' } },
    { kind: 'draft', original: { title: '', body: '   ' } },
  ]) {
    assert.equal(bridge.shouldGenerateTitle(job), false);
    const prompt = bridge.buildPrompt(job);
    assert.match(prompt, /Correct spelling, capitalization, punctuation, and grammar only/);
    assert.doesNotMatch(prompt, /title is blank: generate/);
  }
});
