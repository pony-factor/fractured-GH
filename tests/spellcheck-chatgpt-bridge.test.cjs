const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

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
  vm.runInNewContext(fs.readFileSync(require.resolve('../features/spellcheck-chatgpt-bridge.js'), 'utf8')
    .replace('void run();', 'globalThis.waitForResponse = waitForResponse;'), context);
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
