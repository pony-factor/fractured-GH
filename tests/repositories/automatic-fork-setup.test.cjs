const test = require('node:test');
const assert = require('node:assert/strict');
const { forkSource, repositoryRoot, matchesNewFork, labelMatches } = require(
  '../../features/repositories/automatic-fork-setup.js',
);

test('only recognizes GitHub fork creation routes', () => {
  assert.equal(forkSource('/upstream/project/fork'), 'upstream/project');
  assert.equal(forkSource('/upstream/project/fork/'), 'upstream/project');
  assert.equal(forkSource('/upstream/project/settings'), null);
  assert.equal(forkSource('/upstream/project'), null);
});

test('only recognizes a repository homepage, not settings or subpages', () => {
  assert.equal(repositoryRoot('/me/project'), 'me/project');
  assert.equal(repositoryRoot('/me/project/'), 'me/project');
  assert.equal(repositoryRoot('/me/project/settings'), null);
});

test('only accepts a freshly created fork of the exact expected parent', () => {
  const now = Date.parse('2026-10-24T18:00:00Z');
  const valid = {
    fork: true,
    parent: { full_name: 'Upstream/Project' },
    created_at: new Date(now - 60000).toISOString(),
  };
  assert.equal(matchesNewFork(valid, 'upstream/project', now), true);
  assert.equal(matchesNewFork({ ...valid, fork: false }, 'upstream/project', now), false);
  assert.equal(matchesNewFork({ ...valid, parent: { full_name: 'other/repo' } }, 'upstream/project', now), false);
  assert.equal(matchesNewFork({ ...valid, created_at: new Date(now - 3600000).toISOString() }, 'upstream/project', now), false);
  assert.equal(matchesNewFork({ ...valid, created_at: 'broken' }, 'upstream/project', now), false);
});

test('matches labels without mistaking similarly named controls', () => {
  const label = textContent => ({ textContent });
  assert.equal(labelMatches(label('Releases'), 'Releases'), true);
  assert.equal(labelMatches(label('Wikis  Enable repository wiki'), 'Wikis'), true);
  assert.equal(labelMatches(label('Automatically delete head branches'), 'Automatically delete head branches'), true);
  assert.equal(labelMatches(label('Release notes'), 'Releases'), false);
  assert.equal(labelMatches(label('Projects 2'), 'Wikis'), false);
});
