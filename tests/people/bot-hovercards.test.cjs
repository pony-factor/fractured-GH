const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../features/people/bot-hovercards.js'), 'utf8');

function anchor(href, attributes = {}) {
  const attrs = new Map(Object.entries({ href, ...attributes }));
  return {
    attrs, isConnected: true,
    getAttribute: (key) => attrs.get(key) ?? null,
    hasAttribute: (key) => attrs.has(key),
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: (key) => attrs.delete(key),
  };
}

function start(links) {
  let mutation;
  let observation;
  vm.runInNewContext(source, {
    URL, location: { origin: 'https://github.com' },
    document: { querySelectorAll: () => links, addEventListener() {} },
    addEventListener() {}, clearTimeout,
    requestAnimationFrame: (callback) => callback(),
    MutationObserver: class {
      constructor(callback) { mutation = callback; }
      observe(target, options) { observation = options; }
    },
  });
  return { rescan: () => mutation(), observation };
}

test('bot contributors use app links and no longer request user hovercards', () => {
  const links = ['codex-pony[bot]', 'lindsey-pony%5Bbot%5D'].map((name) => anchor('/' + name, {
    'data-hovercard-url': '/users/' + name + '/hovercard',
    'data-hovercard-type': 'user',
    'aria-label': name,
  }));
  const feature = start(links);
  for (const [index, slug] of ['codex-pony', 'lindsey-pony'].entries()) {
    assert.equal(links[index].getAttribute('href'), '/apps/' + slug);
    assert.equal(links[index].getAttribute('data-fractured-bot-profile'), slug);
    assert.equal(links[index].hasAttribute('data-hovercard-url'), false);
    assert.equal(links[index].hasAttribute('data-hovercard-type'), false);
    assert.ok(links[index].getAttribute('aria-label'));
  }
  feature.rescan();
  assert.equal(links[0].getAttribute('data-fractured-bot-profile'), 'codex-pony');
});

test('normal profiles, app links, external links and malformed routes retain their hovercards', () => {
  const hrefs = ['/codex', '/apps/codex-pony', 'https://example.com/codex-pony[bot]',
    '/owner/repo[bot]', '/bad%ZZ[bot]', '/%3Cimg%3E[bot]'];
  const links = hrefs.map((href) => anchor(href, { 'data-hovercard-url': '/original/hovercard' }));
  start(links);
  links.forEach((link, index) => {
    assert.equal(link.getAttribute('href'), hrefs[index]);
    assert.equal(link.getAttribute('data-hovercard-url'), '/original/hovercard');
    assert.equal(link.hasAttribute('data-fractured-bot-profile'), false);
  });
});

test('dynamic bot links and restored native attributes are repaired after navigation', () => {
  const links = [];
  const feature = start(links);
  const link = anchor('https://github.com/codex-pony[bot]');
  links.push(link);
  feature.rescan();
  assert.equal(link.getAttribute('href'), '/apps/codex-pony');
  link.setAttribute('data-hovercard-url', '/users/codex-pony%5Bbot%5D/hovercard');
  feature.rescan();
  assert.equal(link.hasAttribute('data-hovercard-url'), false);
  link.setAttribute('href', '/human');
  feature.rescan();
  assert.equal(link.hasAttribute('data-fractured-bot-profile'), false);
  assert.equal(feature.observation.childList, true);
  assert.equal(feature.observation.subtree, true);
});
