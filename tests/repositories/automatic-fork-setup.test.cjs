const test = require('node:test');
const assert = require('node:assert/strict');
const {
  forkSource, newRepositoryOwner, creationIntent, repositoryRoot,
  matchesNewFork, matchesNewRepository, labelMatches,
} = require('../../features/repositories/automatic-fork-setup.js');

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

test('recognizes only new repository creation routes', () => {
  assert.equal(newRepositoryOwner('/new'), '');
  assert.equal(newRepositoryOwner('/new/'), '');
  assert.equal(newRepositoryOwner('/organizations/example/repositories/new'), 'example');
  assert.equal(newRepositoryOwner('/orgs/example/repositories/new/'), 'example');
  assert.equal(newRepositoryOwner('/organizations/example/repositories'), null);
  assert.equal(newRepositoryOwner('/owner/repository'), null);
});

test('captures repository creation by name and organization when known', () => {
  assert.deepEqual(creationIntent('/new', ' Some.Project '), {
    kind: 'repository', name: 'Some.Project', owner: null,
  });
  assert.deepEqual(creationIntent('/organizations/TEAM/repositories/new', 'repo'), {
    kind: 'repository', name: 'repo', owner: 'TEAM',
  });
  assert.deepEqual(creationIntent('/upstream/project/fork', undefined), {
    kind: 'fork', source: 'upstream/project',
  });
  assert.equal(creationIntent('/new', ''), null);
  assert.equal(creationIntent('/new', '../invalid/name'), null);
  assert.equal(creationIntent('/elsewhere', 'repo'), null);
});

test('only accepts a fresh non-fork repository with the expected name and owner', () => {
  const now = Date.parse('2026-10-30T16:00:00Z');
  const valid = {
    full_name: 'TEAM/Repository', fork: false,
    created_at: new Date(now - 60000).toISOString(),
  };
  const expected = { name: 'repository', owner: 'team' };
  assert.equal(matchesNewRepository(valid, expected, now), true);
  assert.equal(matchesNewRepository({ ...valid, fork: true }, expected, now), false);
  assert.equal(matchesNewRepository({ ...valid, full_name: 'team/other' }, expected, now), false);
  assert.equal(matchesNewRepository({ ...valid, full_name: 'other/repository' }, expected, now), false);
  assert.equal(matchesNewRepository({ ...valid, created_at: new Date(now - 3600000).toISOString() }, expected, now), false);
  assert.equal(matchesNewRepository({ ...valid, created_at: 'broken' }, expected, now), false);
  assert.equal(matchesNewRepository(valid, { name: 'repository', owner: null }, now), true);
  assert.equal(matchesNewRepository(valid, { name: '' }, now), false);
});

const { matchesPrivateCreation, setCheckbox } = require('../../features/repositories/automatic-fork-setup.js');

test('private setup requires a recent creation redirect, matching identity, and edit access', () => {
  const now = Date.parse('2026-11-05T18:00:00Z');
  const pending = { kind: 'repository', name: 'FOSS', owner: 'AM-only', createdAt: now - 1000 };
  const page = {
    repository: 'AM-only/FOSS', isPrivate: 'true', isFork: 'false',
    canEdit: true, fromCreation: true,
  };
  assert.equal(matchesPrivateCreation('AM-only/FOSS', pending, page, now), true);
  assert.equal(matchesPrivateCreation('other/FOSS', pending, page, now), false);
  assert.equal(matchesPrivateCreation('AM-only/other', pending, page, now), false);
  for (const change of [
    { repository: 'other/FOSS' }, { isPrivate: 'false' }, { isFork: 'true' },
    { canEdit: false }, { fromCreation: false }, { isFork: undefined },
  ]) assert.equal(matchesPrivateCreation('AM-only/FOSS', pending, { ...page, ...change }, now), false);
  for (const change of [
    { createdAt: now - 120001 }, { createdAt: now + 1000 },
    { kind: 'fork' }, { name: 'other' }, { createdAt: NaN },
  ]) assert.equal(matchesPrivateCreation('AM-only/FOSS', { ...pending, ...change }, page, now), false);
});

test('disabled wiki already off satisfies the preference without a warning or click', () => {
  const field = {
    type: 'checkbox', checked: false, disabled: true,
    getAttribute() { return null; },
    click() { throw Error('Unavailable controls must not be clicked'); },
  };
  assert.equal(setCheckbox(field, false), true);
  assert.equal(setCheckbox(field, true), false);
});
