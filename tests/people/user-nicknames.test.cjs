const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../features/people/user-nicknames.js'), 'utf8');

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
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}

for (const nickname of ['John', 'John Wooten']) {
  test(`nickname and conversation observers settle for ${nickname}`, async () => {
    const updates = [];
    let label = nickname;
    let writes = 0;
    const span = {
      getAttribute: (name) => name === 'nickname' ? 'JFWooten4' : '@JFWooten4',
      get textContent() { return label; },
      set textContent(value) {
        label = value;
        writes++;
        updates.push(true);
      },
    };
    const link = new Anchor('/JFWooten4', '', true);
    link.isConnected = true;
    link.querySelector = (selector) => selector === '[nickname]' ? span : null;
    const feature = vm.runInNewContext([
      functionSource('normalizeNickname'),
      functionSource('firstWord'),
      functionSource('applyNicknameToProfileLink'),
      functionSource('applyConversationFirstName'),
      '({ applyNicknameToProfileLink, applyConversationFirstName })',
    ].join('\n'), {
      enabled: true, nicknameReplacementEnabled: true, conversationFirstNamesEnabled: true,
      HTMLAnchorElement: Anchor,
      nicknameByUsername: new Map([['jfwooten4', { nickname }]]),
      NICKNAME_ATTR: 'nickname', CONVERSATION_NAME_ATTR: 'conversation', ORIGINAL_TEXT_ATTR: 'original',
      usernameFromLink: () => 'JFWooten4',
      isConversationIdentity: () => true,
      fetchedProfileDisplayName: async () => 'John Wooten',
      firstNameForUser: async () => 'John',
      renderedNickname: (original, name) => original.startsWith('@') ? `@${name}` : name,
      replaceConversationAttributes() {},
    });
    async function refresh() {
      await Promise.all([
        feature.applyNicknameToProfileLink(link),
        feature.applyConversationFirstName(link),
      ]);
    }
    await refresh();
    for (let count = 0; updates.length && count < 10; count++) {
      updates.shift();
      await refresh();
    }
    assert.equal(updates.length, 0, 'name mutations must stop scheduling observer updates');
    assert.equal(label, '@John');
    assert.equal(writes, 1, 'both name passes must agree without rewriting identical text');
  });
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

test('verified signature popovers are excluded from both nickname passes', async () => {
  const popover = {
    textContent: "This commit was signed with the committer's verified signature. GPG key ID: 7539",
  };
  const link = new Anchor('/JFWooten4');
  link.isConnected = true;
  link.closest = (selector) => selector === '.Popover-message' ? popover : null;
  let profileLookups = 0;
  const feature = vm.runInNewContext([
    functionSource('isVerifiedSignaturePopover'),
    functionSource('applyNicknameToProfileLink'),
    functionSource('applyConversationFirstName'),
    '({ isVerifiedSignaturePopover, applyNicknameToProfileLink, applyConversationFirstName })',
  ].join('\n'), {
    enabled: true, nicknameReplacementEnabled: true, conversationFirstNamesEnabled: true,
    HTMLAnchorElement: Anchor,
    nicknameByUsername: new Map([['jfwooten4', { nickname: 'Windsor' }]]),
    usernameFromLink: () => 'JFWooten4',
    isConversationIdentity: () => true,
    fetchedProfileDisplayName: async () => { profileLookups++; return 'John Wooten'; },
    firstNameForUser: async () => { profileLookups++; return 'Windsor'; },
  });
  assert.equal(feature.isVerifiedSignaturePopover(link), true);
  assert.equal(feature.isVerifiedSignaturePopover(new Anchor('/JFWooten4')), false);
  await Promise.all([
    feature.applyNicknameToProfileLink(link),
    feature.applyConversationFirstName(link),
  ]);
  assert.equal(profileLookups, 0);
  assert.equal(link.textContent, 'JFWooten4');
  assert.match(popover.textContent, /GPG key ID: 7539/);
});
