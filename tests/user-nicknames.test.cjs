const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../features/user-nicknames.js'), 'utf8');

test('profile nickname applies synchronously without a cached or fetched display name', () => {
  const original = { textContent: ' New GitHub Name ' };
  const element = { textContent: original.textContent, querySelector: () => null };
  const replacements = [];
  const apply = vm.runInNewContext([
    functionSource('normalizeUsername'),
    functionSource('applyNicknameToCurrentProfile'),
    'applyNicknameToCurrentProfile',
  ].join('\n'), {
    enabled: true, nicknameReplacementEnabled: true,
    location: { pathname: '/ExampleUser' },
    nicknameByUsername: new Map([['exampleuser', { nickname: 'Friend' }]]),
    document: { querySelectorAll: () => [element] },
    PROFILE_DISPLAY_NAME_SELECTOR: '.p-name', NICKNAME_ATTR: 'nickname',
    fetchedProfileDisplayName() { throw new Error('Must not fetch'); },
    matchingExactTextNode(root, name) {
      assert.equal(root, element);
      assert.equal(name, 'New GitHub Name');
      return original;
    },
    replaceTextNode(node, mapping) { replacements.push({ node, ...mapping }); },
  });
  assert.equal(apply(), undefined);
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].nickname, 'Friend');
  assert.equal(replacements[0].node, original);
});

function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}

class Anchor {
  constructor(href, hovercard = '', author = false) {
    this.href = href; this.hovercard = hovercard; this.author = author;
    this.textContent = href.split('/').pop();
    this.classList = { contains: () => false };
  }
  getAttribute(name) { return name === 'href' ? this.href : this.hovercard; }
  closest() { return null; }
  matches(selector) { return this.author && selector === 'authors'; }
}

function identities(enabled = true, pathname = '/owner/repository') {
  return vm.runInNewContext([
    functionSource('normalizeUsername'),
    functionSource('isConversationPage'),
    functionSource('commitAuthorFromLink'),
    functionSource('usernameFromLink'),
    functionSource('isConversationIdentity'),
    '({ usernameFromLink, isConversationIdentity })',
  ].join('\n'), {
    HTMLAnchorElement: Anchor, URL,
    location: { origin: 'https://github.com', pathname },
    conversationFirstNamesEnabled: enabled,
    CONVERSATION_AUTHOR_SELECTOR: 'authors', CONVERSATION_BODY_SELECTOR: 'bodies',
    CONVERSATION_CONTAINER_SELECTOR: 'containers', NICKNAME_ATTR: 'nickname',
  });
}

test('repository latest commit authors qualify for first names without changing their URLs', () => {
  const feature = identities();
  const link = new Anchor('/owner/repository/commits/main/?author=JFWooten4');
  assert.equal(feature.usernameFromLink(link), 'JFWooten4');
  assert.equal(feature.isConversationIdentity(link, 'JFWooten4'), true);
  assert.equal(link.href, '/owner/repository/commits/main/?author=JFWooten4');
  assert.equal(identities(false).isConversationIdentity(link, 'JFWooten4'), false);
});

test('PR header authors qualify outside comment containers, while unrelated profile links do not', () => {
  const feature = identities(true, '/WhyDRS/documents/pull/8');
  const author = new Anchor('/JFWooten4', '', true);
  assert.equal(feature.isConversationIdentity(author, 'JFWooten4'), true);
  assert.equal(feature.isConversationIdentity(new Anchor('/JFWooten4'), 'JFWooten4'), false);
  assert.equal(identities(false, '/WhyDRS/documents/pull/8').isConversationIdentity(author, 'JFWooten4'), false);
  assert.equal(author.href, '/JFWooten4');
});

test('ordinary repository links, external links, and mismatched authors do not qualify', () => {
  const feature = identities();
  for (const href of ['/JFWooten4', '/owner/repository/issues?author=JFWooten4',
    'https://example.com/owner/repository/commits?author=JFWooten4',
    '/owner/repository/commits?author=another-user']) {
    assert.equal(feature.isConversationIdentity(new Anchor(href), 'JFWooten4'), false);
  }
});
