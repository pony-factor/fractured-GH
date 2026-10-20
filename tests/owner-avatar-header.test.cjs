const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/people/owner-avatar-header.js'), 'utf8',
);

function harness(initiallyEnabled) {
  let setting = initiallyEnabled;
  let storageListener;
  const frames = [];
  const styles = new Map();
  const location = { pathname: '/pony-factor/fractured-GH', origin: 'https://github.com' };
  const documentListeners = new Map();
  const windowListeners = new Map();

  class Image {
    setAttribute(name, value) { this[name] = value; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  }

  class Anchor {
    constructor() {
      this.attrs = new Map([['href', '/'], ['aria-label', 'Homepage']]);
      this.children = [];
    }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    hasAttribute(name) { return this.attrs.has(name); }
    setAttribute(name, value) { this.attrs.set(name, value); }
    removeAttribute(name) { this.attrs.delete(name); }
    querySelector(selector) {
      return selector === '[data-fractured-owner-avatar]'
        ? this.children.find(child => 'data-fractured-owner-avatar' in child) || null
        : null;
    }
    append(child) { child.parent = this; this.children.push(child); }
  }

  const logo = new Anchor();
  const header = {
    querySelector(selector) {
      if (selector === '[data-fractured-owner-logo]') {
        return logo.hasAttribute('data-fractured-owner-logo') ? logo : null;
      }
      return selector.includes('a.AppHeader-logo') ? logo : null;
    },
    querySelectorAll() { return []; },
  };
  const document = {
    documentElement: {},
    head: { append(style) { styles.set(style.id, style); } },
    getElementById(id) { return styles.get(id) || null; },
    createElement(tag) { return tag === 'img' ? new Image() : { id: '', textContent: '' }; },
    querySelector(selector) {
      if (selector.includes('octolytics-dimension-repository_nwo')) {
        return { getAttribute() { return 'pony-factor/fractured-GH'; } };
      }
      if (selector === '.GlobalNav, #global-nav') return header;
      if (selector === '[data-fractured-owner-logo]') {
        return logo.hasAttribute('data-fractured-owner-logo') ? logo : null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(name, callback) { documentListeners.set(name, callback); },
  };
  vm.runInNewContext(source, {
    document, HTMLAnchorElement: Anchor, HTMLImageElement: Image,
    location,
    window: { location, addEventListener(name, callback) { windowListeners.set(name, callback); } },
    chrome: {
      storage: {
        local: { async get() { return { ownerAvatarHeaderEnabled: setting }; } },
        onChanged: { addListener(listener) { storageListener = listener; } },
      },
    },
    requestAnimationFrame(callback) { frames.push(callback); },
    MutationObserver: class { observe() {} },
  });

  return {
    logo, styles,
    navigate(pathname, eventName = 'turbo:load') {
      location.pathname = pathname;
      const listener = eventName === 'popstate'
        ? windowListeners.get(eventName)
        : documentListeners.get(eventName);
      assert.ok(listener, 'navigation listener missing: ' + eventName);
      listener();
    },
    async settle() {
      await Promise.resolve();
      await Promise.resolve();
      while (frames.length) frames.shift()();
    },
    change(enabled) {
      setting = enabled;
      storageListener({ ownerAvatarHeaderEnabled: {} }, 'local');
    },
  };
}

test('enlarges and centers the private lock only in the avatar-enhanced breadcrumb', async () => {
  const feature = harness(true);
  await feature.settle();
  const css = feature.styles.get('fractured-owner-avatar-header-style')?.textContent;
  assert.ok(css);
  assert.match(css, /:has\(\[data-fractured-owner-logo\]\)/);
  assert.match(css, /li:has\(svg\.octicon-lock, svg\[data-octicon="lock"\]\)/);
  assert.match(css, /align-items: center !important/);
  assert.match(css, /width: 16px !important/);
  assert.match(css, /height: 16px !important/);
  assert.equal(feature.logo.getAttribute('href'), '/pony-factor');
});

test('matches the owner navigation button and hover shape to the rounded-square avatar', async () => {
  const feature = harness(true);
  await feature.settle();

  const css = feature.styles.get('fractured-owner-avatar-header-style')?.textContent;
  const linkRule = css?.match(/\[data-fractured-owner-logo\]\s*\{([^}]+)\}/)?.[1];
  assert.ok(linkRule);
  for (const declaration of [
    'width: 28px !important;',
    'height: 28px !important;',
    'min-width: 28px !important;',
    'min-height: 28px !important;',
    'padding: 0 !important;',
    'border-radius: 6px !important;',
    'display: inline-flex !important;',
    'overflow: hidden !important;',
  ]) {
    assert.ok(linkRule.includes(declaration), 'owner link missing ' + declaration);
  }
  assert.match(css, /\[data-fractured-owner-logo\]::before,\s*\[data-fractured-owner-logo\]::after\s*\{[^}]*border-radius: inherit !important;/);
  assert.equal(feature.logo.getAttribute('href'), '/pony-factor');
  assert.equal(feature.logo.getAttribute('aria-label'), 'pony-factor');
  assert.equal(
    feature.logo.querySelector('[data-fractured-owner-avatar]')?.src,
    'https://github.com/pony-factor.png?size=64',
  );
});

test('leaves GitHub unmodified when the avatar setting is disabled or switched off', async () => {
  const feature = harness(false);
  await feature.settle();
  assert.equal(feature.styles.size, 0);
  assert.equal(feature.logo.getAttribute('href'), '/');

  feature.change(true);
  await feature.settle();
  assert.equal(feature.logo.hasAttribute('data-fractured-owner-logo'), true);

  feature.change(false);
  await feature.settle();
  assert.equal(feature.logo.hasAttribute('data-fractured-owner-logo'), false);
  assert.equal(feature.logo.getAttribute('href'), '/');
  assert.equal(feature.logo.getAttribute('aria-label'), 'Homepage');
});

test('updates the logo during Turbo, PJAX, and history navigation despite stale repo metadata', async () => {
  const feature = harness(true);
  await feature.settle();

  for (const [pathname, eventName, owner] of [
    ['/stellar/stellar-protocol', 'turbo:load', 'stellar'],
    ['/JFWooten4/example-repo', 'pjax:end', 'JFWooten4'],
    ['/pony-factor/fractured-GH', 'popstate', 'pony-factor'],
  ]) {
    feature.navigate(pathname, eventName);
    await feature.settle();

    assert.equal(feature.logo.getAttribute('data-fractured-owner-logo'), owner);
    assert.equal(feature.logo.getAttribute('href'), '/' + owner);
    assert.equal(feature.logo.getAttribute('aria-label'), owner);
    assert.equal(
      feature.logo.querySelector('[data-fractured-owner-avatar]')?.src,
      'https://github.com/' + owner + '.png?size=64',
    );
    assert.equal(feature.logo.children.length, 1, 'must not accumulate stale avatars');
  }
});

test('restores GitHub branding when leaving a repository even if metadata remains stale', async () => {
  const feature = harness(true);
  await feature.settle();

  for (const pathname of ['/stellar', '/orgs/stellar/repositories', '/settings/profile']) {
    feature.navigate(pathname);
    await feature.settle();
    assert.equal(feature.logo.hasAttribute('data-fractured-owner-logo'), false);
    assert.equal(feature.logo.getAttribute('href'), '/');
    assert.equal(feature.logo.getAttribute('aria-label'), 'Homepage');
    assert.equal(feature.logo.children.length, 0);
  }

  feature.navigate('/stellar/stellar-protocol');
  await feature.settle();
  assert.equal(feature.logo.getAttribute('data-fractured-owner-logo'), 'stellar');
  assert.equal(feature.logo.getAttribute('href'), '/stellar');
});
