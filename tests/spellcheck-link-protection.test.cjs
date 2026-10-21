const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/writing/spellcheck-link-protection.js'), 'utf8',
);

function links() {
  const context = {};
  vm.runInNewContext(source, context);
  return context.fracturedSpellcheckLinks;
}

test('preserves Markdown links, URL parameters, fragments, and nested URL parentheses', () => {
  const api = links();
  const original = {
    title: 'teh title',
    body: 'teh [GitHub](https://github.com/pony-factor/fractured-GH/pull/54) and '
      + '[Wiki](https://example.com/a_(b)) and https://example.com/?a=1&b=2#section. teh',
  };
  const protectedDraft = api.protect(original);
  assert.equal(protectedDraft.entries.length, 3);
  assert.doesNotMatch(protectedDraft.masked.body, /https?:\/\//);
  const result = api.restore(protectedDraft, {
    title: 'the title',
    body: protectedDraft.masked.body.replaceAll('teh', 'the'),
  });
  assert.equal(result.title, 'the title');
  assert.equal(result.body, original.body.replaceAll('teh', 'the'));
  assert.equal(api.sameLinks(original, result), true);
});

test('protects escaped Markdown links, image links, autolinks, and references', () => {
  const api = links();
  const original = {
    title: '',
    body: '[Example]\\(https://example.com/escaped\\) '
      + '\\[Escaped\\]\\(https://example.org/path\\)\n'
      + '![image](https://example.org/image.png) <https://docs.github.com/en/rest>\n'
      + '[Example][reference]\n[reference]: https://example.com/ref "title"',
  };
  const protectedDraft = api.protect(original);
  assert.equal(protectedDraft.entries.length, 6);
  const result = api.restore(protectedDraft, protectedDraft.masked);
  assert.equal(result.body, original.body);
});

test('protects repeated identical URLs independently and keeps surrounding prose editable', () => {
  const api = links();
  const original = { title: '', body: 'teh [one](https://x.com) [two](https://x.com) https://x.com teh' };
  const masked = api.protect(original);
  assert.equal(masked.entries.length, 3);
  const result = api.restore(masked, {
    title: '', body: masked.masked.body.replaceAll('teh', 'the'),
  });
  assert.equal(result.body, 'the [one](https://x.com) [two](https://x.com) https://x.com the');
});

test('refuses missing, duplicated, reordered, relocated, and changed tokens', () => {
  const api = links();
  const masked = api.protect({
    title: '[title](https://title.example)',
    body: '[one](https://one.example) [two](https://two.example)',
  });
  const [title, one, two] = masked.entries.map(entry => entry.token);
  const failures = [
    { title: title, body: one },
    { title: title, body: one + one + two },
    { title: title, body: two + one },
    { title: '', body: title + one + two },
    { title: title, body: one.replace('1END', '9END') + two },
  ];
  for (const result of failures) {
    assert.throws(() => api.restore(masked, result), /protected Markdown link/);
  }
});

test('refuses an added or rewritten URL even if all original markers survive', () => {
  const api = links();
  const original = { title: '', body: 'See https://example.com/test' };
  const masked = api.protect(original);
  assert.throws(() => api.restore(masked, {
    title: '', body: masked.masked.body + ' https://other.example/path',
  }), /introduced or changed/);
  assert.equal(api.sameLinks(original, {
    title: '', body: 'See https://other.example/test',
  }), false);
  assert.equal(api.sameLinks(original, {
    title: '', body: 'See https://example.com/test https://extra.example',
  }), false);
});

test('keeps text-only drafts editable and rejects injected links on GitHub', () => {
  const api = links();
  const original = { title: 'teh title', body: 'teh description' };
  assert.deepEqual(JSON.parse(JSON.stringify(api.protect(original).masked)), original);
  assert.deepEqual(JSON.parse(JSON.stringify(api.restore(api.protect(original), {
    title: 'the title', body: 'the description',
  }))), { title: 'the title', body: 'the description' });
  assert.equal(api.sameLinks(original, {
    title: 'the title', body: 'the [description](https://example.com)',
  }), false);
});
