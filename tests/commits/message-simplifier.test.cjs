const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../features/commits/message-simplifier.js'), 'utf8');
const context = vm.createContext({
  MutationObserver: class {},
  chrome: { storage: {
    onChanged: { addListener() {} },
    local: { get: async defaults => defaults },
  } },
});
vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.helpers = { simplify, splitEmoji, bodySummary, weak };\n})();'), context);
const { simplify, splitEmoji, bodySummary, weak } = context.helpers;

test('rewrite common generated phrasing into imperative titles', () => {
  assert.equal(simplify('This commit adds support for caching.'), 'Support caching');
  assert.equal(simplify('fix(parser): Fixed an issue with parser errors.'), 'Fix parser errors');
  assert.equal(simplify('Please updated docs in order to clarify setup.'), 'Update docs to clarify setup');
});

test('keep specific concise titles intact', () => {
  assert.equal(simplify('Add parser recovery'), 'Add parser recovery');
  assert.equal(weak('Update README.md'), true);
  assert.equal(weak('Add parser recovery'), false);
});

test('extract useful prose from a generated body', () => {
  assert.equal(bodySummary('## Summary\n- Fixes an issue with parser errors.\n\nTesting'), 'Fixes an issue with parser errors.');
});

test('preserve existing emoji and joined emoji prefixes', () => {
  const prefix = splitEmoji('👩‍💻 This commit adds parser recovery.');
  assert.equal(prefix.emoji, '👩‍💻');
  assert.equal(simplify(prefix.text), 'Add parser recovery');
});
