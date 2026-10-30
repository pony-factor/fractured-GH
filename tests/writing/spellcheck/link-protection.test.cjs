const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../../features/writing/spellcheck-link-protection.js'), 'utf8',
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

test('preserves complete native GitHub HTML images outside the image importer', () => {
  const api = links();
  const image = '<img width="690" height="326" alt="Screenshot > draft"\n'
    + ' src="https://github.com/user-attachments/assets/eba74fc1-2db0-4c9a-bce2-61ff3afba008" />';
  const original = { title: '', body: 'teh screenshot:\n' + image + '\nmore teh words' };
  const masked = api.protect(original);
  assert.equal(masked.entries.length, 1, 'the entire tag is one protected unit');
  assert.equal(masked.entries[0].literal, image);
  assert.doesNotMatch(masked.masked.body, /<img|github\.com|Screenshot/);
  const result = api.restore(masked, {
    title: '',
    body: masked.masked.body.replaceAll('teh', 'the'),
  });
  assert.equal(result.body, original.body.replaceAll('teh', 'the'));
  assert.equal(api.sameLinks(original, result), true);
});

test('preserves single-quoted and uppercase image tags alongside Markdown images', () => {
  const api = links();
  const original = {
    title: '',
    body: "<IMG ALT='A > B' SRC='https://github.com/user-attachments/assets/native'>"
      + '\n![other](https://example.com/other.png)\n'
      + '<img data-alt="a \'quoted\' name" src="https://example.com/two.png"/>',
  };
  const masked = api.protect(original);
  assert.equal(masked.entries.length, 3);
  assert.doesNotMatch(masked.masked.body, /<img|<IMG|https?:\/\//);
  assert.equal(api.restore(masked, masked.masked).body, original.body);
});

test('rejects changes to native image tags, including rewrapped src and alt text', () => {
  const api = links();
  const image = '<img alt="Screenshot" src="https://github.com/user-attachments/assets/abc" />';
  const original = { title: '', body: 'Image:\n' + image };
  const masked = api.protect(original);
  const token = masked.entries[0].token;
  assert.equal(api.sameLinks(original, { title: '', body: original.body.replace('Screenshot', 'Screen shot') }), false);
  assert.equal(api.sameLinks(original, { title: '', body: original.body.replace('abc', 'def') }), false);
  assert.equal(api.sameLinks(original, { title: '', body: original.body + '\n' + image }), false);
  assert.throws(() => api.restore(masked, {
    title: '', body: masked.masked.body.replace(token, '[' + token + '](' + token + ')'),
  }), /protected Markdown link/);
  assert.throws(() => api.restore(masked, {
    title: '', body: masked.masked.body + '\n' + image,
  }), /introduced or changed/);
});

test('does not mistake similarly named HTML elements for image tags', () => {
  const api = links();
  const original = { title: '', body: '<image alt="a"> <imgur src="x"> <img missing closing' };
  assert.equal(api.protect(original).entries.length, 0);
});

test('preserves scheme-less raw GitHub URLs exactly as supplied', () => {
  const api = links();
  const original = { title: 'Raw github.com/pony-factor/fractured-GH', body:
    'Use github.com/pony-factor/fractured-GH/pull/66, www.github.com/org/repo and '
    + 'https://github.com/user-attachments/assets/a-b-c raw. Fix teh typo.' };
  const masked = api.protect(original);
  assert.equal(masked.entries.length, 4);
  assert.doesNotMatch(masked.masked.body, /github\.com|https?:\/\//);
  const result = api.restore(masked, {
    title: masked.masked.title,
    body: masked.masked.body.replace('teh typo', 'the typo'),
  });
  assert.equal(result.title, original.title);
  assert.equal(result.body, original.body.replace('teh typo', 'the typo'));
});

test('rejects changing bare links into bracketed, bold, or inline-code links', () => {
  const api = links();
  for (const url of ['https://github.com/pony-factor/fractured-GH', 'github.com/pony-factor/fractured-GH']) {
    const original = { title: '', body: 'Read ' + url + ' for context.' };
    const protectedDraft = api.protect(original);
    const token = protectedDraft.entries[0].token;
    for (const wrapper of [`[${token}]`, `\`${token}\``, `**${token}**`, `<${token}>`]) {
      const body = protectedDraft.masked.body.replace(token, wrapper);
      assert.throws(() => api.restore(protectedDraft, { title: '', body }),
        /introduced or changed|protected Markdown link/);
    }
  }
});

test('keeps original link enclosure unchanged when already authored that way', () => {
  const api = links();
  const original = { title: '', body: 'Here is [github.com/pony-factor/fractured-GH] and `https://github.com/foo`.' };
  const protectedDraft = api.protect(original);
  assert.equal(protectedDraft.entries.length, 2);
  assert.equal(api.restore(protectedDraft, protectedDraft.masked).body, original.body);
  assert.equal(api.sameLinks(original, original), true);
  assert.equal(api.sameLinks(original, { title: '', body: original.body.replace('[github.com/pony-factor/fractured-GH]', 'github.com/pony-factor/fractured-GH') }), false);
});
