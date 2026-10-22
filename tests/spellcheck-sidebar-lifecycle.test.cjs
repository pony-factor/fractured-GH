const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const source = fs.readFileSync(require.resolve('../features/writing/spellcheck-issue-pr-drafts.js'), 'utf8');
  let removed = false;
  const body = { value: 'Corrected comment', isConnected: true };
  const location = { href: 'https://github.com/owner/repo/issues/1' };
  const context = {
    location, body,
    document: {
      getElementById: () => ({ remove() { removed = true; } }),
      querySelectorAll: () => [],
    },
  };
  vm.runInNewContext(source.slice(0, source.indexOf('  chrome.storage.onChanged.addListener')) + `
    sidebarUrl = location.href;
    sidebarFields = activeFields = { body };
    activeJob = { id: 'pending-job' };
    globalThis.api = { checkSidebarContext, handleJob, active: () => activeJob };
  })();`, context);
  return { ...context.api, body, location, removed: () => removed };
}

test('keeps the popup while the draft remains on the same page', () => {
  const app = setup();
  app.checkSidebarContext();
  assert.equal(app.removed(), false);
  assert.ok(app.active());
});

test('dismisses on navigation and ignores late spellcheck results', () => {
  const app = setup();
  app.location.href = 'https://github.com/owner/repo/issues/2';
  app.handleJob({ id: 'pending-job', status: 'error', error: 'Late result' });
  assert.equal(app.removed(), true);
  assert.equal(app.active(), null);
});

test('dismisses after the comment editor is reset or removed', () => {
  for (const update of [{ value: '' }, { isConnected: false }]) {
    const app = setup();
    Object.assign(app.body, update);
    app.checkSidebarContext();
    assert.equal(app.removed(), true);
    assert.equal(app.active(), null);
  }
});
