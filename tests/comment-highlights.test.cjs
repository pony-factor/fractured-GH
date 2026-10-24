const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isConversationRoute, commentIdFromHash, authorLogin,
  reviewAuthoredBy, commentCardForTarget,
} = require('../features/people/comment-highlights.js');

for (const path of ['/owner/repo/issues/42', '/owner/repo/pull/17', '/owner/repo/pull/17/files']) {
  test(`comment highlighter handles conversation route ${path}`, () => {
    assert.equal(isConversationRoute(path), true);
  });
}
for (const path of ['/owner/repo/issues', '/owner/repo/actions', '/owner/repo/pull/not-a-pr', '/owner/repo/commit/123']) {
  test(`comment highlighter ignores unrelated route ${path}`, () => {
    assert.equal(isConversationRoute(path), false);
  });
}

test('issue, inline review and review summary permalinks are recognized', () => {
  for (const id of ['issuecomment-2275964399', 'discussion_r76543', 'pullrequestreview-1234']) {
    assert.equal(commentIdFromHash('#' + id), id);
  }
  assert.equal(commentIdFromHash('#issue-123'), '');
  assert.equal(commentIdFromHash('#discussion_r12-extra'), '');
});

test('author identity checks the profile link, not text rewritten by nickname features', () => {
  const user = { getAttribute: () => '/Windsor' };
  assert.equal(authorLogin(user, 'https://github.com'), 'windsor');
  assert.equal(authorLogin({ getAttribute: () => 'https://example.com/Windsor' }, 'https://github.com'), '');
  assert.equal(authorLogin({ getAttribute: () => '/owner/repo' }, 'https://github.com'), '');
});

test('review summary authorship ignores a nested comment by the viewer', () => {
  const summary = { querySelectorAll: () => [
    { getAttribute: () => '/SomeoneElse', closest: () => null },
    { getAttribute: () => '/Windsor', closest: (selector) => selector.includes('.comment-body') ? null : ({}) },
  ] };
  assert.equal(reviewAuthoredBy(summary, 'windsor', 'https://github.com'), false);
});

test('review summary and review comment each recognize their actual author', () => {
  const summary = { querySelectorAll: () => [] };
  const comment = { querySelectorAll: () => [] };
  summary.querySelectorAll = () => [{ getAttribute: () => '/Windsor', closest: () => null }];
  comment.querySelectorAll = () => [{ getAttribute: () => '/windsor', closest: (selector) => selector.includes('.comment-body') ? null : comment }];
  assert.equal(reviewAuthoredBy(summary, 'windsor', 'https://github.com'), true);
  assert.equal(reviewAuthoredBy(comment, 'windsor', 'https://github.com'), true);
  assert.equal(reviewAuthoredBy(comment, 'other', 'https://github.com'), false);
});

test('linked comment resolves its nearest comment rather than the entire review thread', () => {
  const comment = {};
  const target = { closest: () => comment, querySelector: () => { throw new Error('Should not walk outward'); } };
  assert.equal(commentCardForTarget(target), comment);
});

test('permalink on an outer timeline item resolves the nested comment', () => {
  const comment = {};
  const target = { closest: () => null, querySelector: () => comment };
  assert.equal(commentCardForTarget(target), comment);
  assert.equal(commentCardForTarget(null), null);
});

test('switching permalinks removes the previous marker and blue does not take priority', () => {
  const { markLinkedCard } = require('../features/people/comment-highlights.js');
  const markers = [];
  const document = {
    createElement: () => ({ className: '', textContent: '', remove() { markers.splice(markers.indexOf(this), 1); } }),
    querySelectorAll: () => [...markers],
  };
  global.document = document;
  function card() {
    const attributes = new Set();
    return {
      attributes,
      setAttribute: (name) => attributes.add(name),
      removeAttribute: (name) => attributes.delete(name),
      querySelector: () => null,
      prepend: (marker) => markers.push(marker),
    };
  }
  const one = card(), two = card();
  try {
    markLinkedCard(one);
    assert.equal(one.attributes.has('data-fractured-linked-comment'), true);
    assert.equal(markers[0].textContent, '🔗 Linked comment');
    markLinkedCard(two);
    assert.equal(one.attributes.has('data-fractured-linked-comment'), false);
    assert.equal(two.attributes.has('data-fractured-linked-comment'), true);
    assert.equal(markers.length, 1);
    markLinkedCard(null);
    assert.equal(markers.length, 0);
    assert.equal(two.attributes.has('data-fractured-linked-comment'), false);
  } finally {
    delete global.document;
  }
});

const fs = require('node:fs');
const path = require('node:path');
test('permalink styling outranks the blue review styling', () => {
  const css = fs.readFileSync(path.join(__dirname, '../features/comment-highlights.css'), 'utf8');
  assert.match(css, /own-review\]:not\(\[data-fractured-linked-comment\]\)/);
  assert.match(css, /\[data-fractured-linked-comment\]\s*\{/);
  assert.match(css, /\.fractured-linked-comment-label/);
});
