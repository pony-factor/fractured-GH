const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../features/spellcheck-chatgpt-bridge.js'), 'utf8')
  .replace('const COMPOSER_TIMEOUT_MS = 30000;', 'const COMPOSER_TIMEOUT_MS = 1;')
  .replace('await pause(250);\n        await closeBridgeTab();', 'await pause(0);\n        await closeBridgeTab();')
  .replace(/  void run\(\)\.catch\([\s\S]*?\n  \}\);(?=\n\}\)\(\);)/, '  globalThis.bridge = { run, writeJob };');

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
