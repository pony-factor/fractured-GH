const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../features/user-nicknames.js'), 'utf8');
function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}

class Anchor {
  constructor(href, hovercard = '') { this.href = href; this.hovercard = hovercard; }
  getAttribute(name) { return name === 'href' ? this.href : this.hovercard; }
}

function identities(enabled = true) {
  return vm.runInNewContext([
    functionSource('normalizeUsername'),
    functionSource('isConversationPage'),
    functionSource('commitAuthorFromLink'),
    functionSource('usernameFromLink'),
    functionSource('isConversationIdentity'),
    '({ usernameFromLink, isConversationIdentity })',
  ].join('\n'), {
    HTMLAnchorElement: Anchor, URL,
    location: { origin: 'https://github.com', pathname: '/owner/repository' },
    conversationFirstNamesEnabled: enabled,
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

test('ordinary repository links, external links, and mismatched authors do not qualify', () => {
  const feature = identities();
  for (const href of ['/JFWooten4', '/owner/repository/issues?author=JFWooten4',
    'https://example.com/owner/repository/commits?author=JFWooten4',
    '/owner/repository/commits?author=another-user']) {
    assert.equal(feature.isConversationIdentity(new Anchor(href), 'JFWooten4'), false);
  }
});
