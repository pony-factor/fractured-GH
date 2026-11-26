const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../features/people/owner-avatar-header.js'), 'utf8',
);

function harness(initiallyEnabled, initialStorageError = null, initialRuntimeError = null) {
  let setting = initiallyEnabled;
  let repositoryNwo = 'pony-factor/fractured-GH';
  let storageListener;
  let storageError = initialStorageError;
  let runtimeError = initialRuntimeError;
  let observerCallback;
  let disconnected = false;
  let storageReads = 0;
  let urlReads = 0;
  const warnings = [];
  const runtime = {
    id: 'fractured',
    getURL(resource) {
      urlReads++;
      if (runtimeError) throw runtimeError;
      return 'chrome-extension://fractured/' + resource;
    },
  };
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
      if (selector === '[data-fractured-owner-logo], [data-fractured-brand-logo]'
        || selector === '[data-fractured-owner-logo]') {
        return logo.hasAttribute('data-fractured-owner-logo')
          || logo.hasAttribute('data-fractured-brand-logo') ? logo : null;
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
        return { getAttribute() { return repositoryNwo; } };
      }
      if (selector === '.GlobalNav, #global-nav') return header;
      if (selector === '[data-fractured-owner-logo], [data-fractured-brand-logo]'
        || selector === '[data-fractured-owner-logo]') {
        return logo.hasAttribute('data-fractured-owner-logo')
          || logo.hasAttribute('data-fractured-brand-logo') ? logo : null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(name, callback) { documentListeners.set(name, callback); },
    removeEventListener(name) { documentListeners.delete(name); },
  };
  vm.runInNewContext(source, {
    document, HTMLAnchorElement: Anchor, HTMLImageElement: Image,
    location,
    window: {
      location,
      addEventListener(name, callback) { windowListeners.set(name, callback); },
      removeEventListener(name) { windowListeners.delete(name); },
    },
    console: { warn(...args) { warnings.push(args); } },
    chrome: {
      runtime,
      storage: {
        local: { async get() {
          storageReads++;
          if (storageError) throw storageError;
          return { ownerAvatarHeaderEnabled: setting };
        } },
        onChanged: { addListener(listener) { storageListener = listener; } },
      },
    },
    requestAnimationFrame(callback) { frames.push(callback); },
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
  });

  return {
    logo, styles, warnings,
    invalidateRuntime() { delete runtime.id; },
    failGetURL(error) { runtimeError = error; },
    failStorage(error) { storageError = error; },
    mutate() { observerCallback?.(); },
    lifecycle() {
      return { disconnected, listeners: documentListeners.size + windowListeners.size, storageReads, urlReads, queued: frames.length };
    },
    navigate(pathname, eventName = 'turbo:load', nwo = null) {
      location.pathname = pathname;
      if (nwo !== null) repositoryNwo = nwo;
      const listener = eventName === 'popstate'
        ? windowListeners.get(eventName)
        : documentListeners.get(eventName);
      assert.ok(listener, 'navigation listener missing: ' + eventName);
      listener();
    },
    async settle() {
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
        while (frames.length) frames.shift()();
      }
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
  const linkRule = css?.match(/\[data-fractured-owner-logo\],\s*\[data-fractured-brand-logo\]\s*\{([^}]+)\}/)?.[1];
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
  assert.match(css, /\[data-fractured-owner-logo\]::before,\s*\[data-fractured-owner-logo\]::after,/);
  assert.match(css, /\[data-fractured-brand-logo\]::before,\s*\[data-fractured-brand-logo\]::after\s*\{[^}]*border-radius: inherit !important;/);
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

test('updates the logo during Turbo, PJAX, and history navigation once repo metadata agrees', async () => {
  const feature = harness(true);
  await feature.settle();

  for (const [pathname, eventName, owner] of [
    ['/stellar/stellar-protocol', 'turbo:load', 'stellar'],
    ['/JFWooten4/example-repo', 'pjax:end', 'JFWooten4'],
    ['/pony-factor/fractured-GH', 'popstate', 'pony-factor'],
  ]) {
    feature.navigate(pathname, eventName, `${owner}/${pathname.split('/')[2]}`);
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

test('shows Fractured branding outside repositories and restores owner avatars on return', async () => {
  const feature = harness(true);
  await feature.settle();

  for (const pathname of ['/', '/orgs', '/organizations/new', '/settings/profile', '/search']) {
    // Keep the previous repository metadata to simulate GitHub's stale Turbo state.
    feature.navigate(pathname);
    await feature.settle();
    assert.equal(feature.logo.hasAttribute('data-fractured-owner-logo'), false);
    assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), true);
    assert.equal(feature.logo.getAttribute('href'), '/');
    assert.equal(feature.logo.getAttribute('aria-label'), 'Homepage');
    assert.equal(feature.logo.querySelector('[data-fractured-owner-avatar]')?.src,
      'chrome-extension://fractured/icons/fractured.png');
    assert.equal(feature.logo.children.length, 1, 'must not accumulate brand images');
  }

  feature.navigate('/stellar/stellar-protocol', 'turbo:load', 'stellar/stellar-protocol');
  await feature.settle();
  assert.equal(feature.logo.getAttribute('data-fractured-owner-logo'), 'stellar');
  assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), false);
  assert.equal(feature.logo.getAttribute('href'), '/stellar');
});

test("keeps account avatars on profile and organization pages, including in-app navigation", async () => {
  const feature = harness(true);
  await feature.settle();
  for (const [pathname, eventName, owner] of [
    ["/stellar", "turbo:load", "stellar"],
    ["/orgs/stellar/repositories", "pjax:end", "stellar"],
    ["/organizations/stellar/repositories/new", "popstate", "stellar"],
    ["/JFWooten4", "turbo:load", "JFWooten4"],
  ]) {
    // Simulate stale metadata left behind by the previously visited repository.
    feature.navigate(pathname, eventName, "pony-factor/fractured-GH");
    await feature.settle();
    assert.equal(feature.logo.getAttribute("data-fractured-owner-logo"), owner);
    assert.equal(feature.logo.hasAttribute("data-fractured-brand-logo"), false);
    assert.equal(feature.logo.getAttribute("href"), "/" + owner);
    assert.equal(feature.logo.querySelector("[data-fractured-owner-avatar]")?.src,
      "https://github.com/" + owner + ".png?size=64");
    assert.equal(feature.logo.children.length, 1);
  }

  feature.navigate("/organizations/new");
  await feature.settle();
  assert.equal(feature.logo.hasAttribute("data-fractured-owner-logo"), false);
  assert.equal(feature.logo.hasAttribute("data-fractured-brand-logo"), true);
});

test('uses the personal project owner avatar through project views and navigation', async () => {
  const feature = harness(true);
  await feature.settle();

  for (const [pathname, eventName, owner] of [
    ['/users/JFWooten4/projects/1', 'turbo:load', 'JFWooten4'],
    ['/users/JFWooten4/projects/1/views/2', 'pjax:end', 'JFWooten4'],
    ['/users/another-owner/projects/2/settings', 'popstate', 'another-owner'],
    ['/users/JFWooten4/projects', 'turbo:load', 'JFWooten4'],
  ]) {
    feature.navigate(pathname, eventName, 'pony-factor/fractured-GH');
    await feature.settle();
    assert.equal(feature.logo.getAttribute('data-fractured-owner-logo'), owner);
    assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), false);
    assert.equal(feature.logo.getAttribute('href'), '/' + owner);
    assert.equal(feature.logo.getAttribute('aria-label'), owner);
    assert.equal(feature.logo.querySelector('[data-fractured-owner-avatar]')?.src,
      'https://github.com/' + owner + '.png?size=64');
    assert.equal(feature.logo.children.length, 1);
  }

  for (const pathname of ['/users', '/users/JFWooten4', '/users/JFWooten4/settings', '/users/invalid_owner/projects/1']) {
    feature.navigate(pathname);
    await feature.settle();
    assert.equal(feature.logo.hasAttribute('data-fractured-owner-logo'), false);
    assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), true);
  }
});

test('does not brand a different repository while GitHub metadata is stale', async () => {
  const feature = harness(true);
  await feature.settle();
  feature.navigate('/stellar/stellar-protocol');
  await feature.settle();
  assert.equal(feature.logo.hasAttribute('data-fractured-owner-logo'), false);
  assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), true);
  assert.equal(feature.logo.getAttribute('href'), '/');
  feature.navigate('/stellar/stellar-protocol', 'turbo:load', 'stellar/stellar-protocol');
  await feature.settle();
  assert.equal(feature.logo.getAttribute('data-fractured-owner-logo'), 'stellar');
});

test('uses Fractured branding on non-repository routes despite stale repository metadata', async () => {
  const feature = harness(true);
  await feature.settle();
  feature.navigate('/settings/profile', 'turbo:load', 'pony-factor/fractured-GH');
  await feature.settle();
  assert.equal(feature.logo.hasAttribute('data-fractured-owner-logo'), false);
  assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), true);
  assert.equal(feature.logo.getAttribute('href'), '/');
});

test('restores the original GitHub homepage logo when the preference is disabled', async () => {
  const feature = harness(true);
  feature.navigate('/');
  await feature.settle();
  assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), true);

  feature.change(false);
  await feature.settle();
  assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), false);
  assert.equal(feature.logo.children.length, 0);
  assert.equal(feature.logo.getAttribute('href'), '/');
  assert.equal(feature.logo.getAttribute('aria-label'), 'Homepage');
});

function assertRestored(feature) {
  assert.equal(feature.logo.hasAttribute('data-fractured-owner-logo'), false);
  assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), false);
  assert.equal(feature.logo.getAttribute('href'), '/');
  assert.equal(feature.logo.getAttribute('aria-label'), 'Homepage');
  assert.equal(feature.logo.children.length, 0);
  assert.equal(feature.lifecycle().disconnected, true);
  assert.equal(feature.lifecycle().listeners, 0);
}

test('never calls getURL during notifications navigation or mutation refreshes', async () => {
  const feature = harness(true);
  await feature.settle();
  assert.equal(feature.lifecycle().urlReads, 1);
  feature.failGetURL(new Error('Extension context invalidated.'));
  for (const event of ['turbo:load', 'pjax:end', 'popstate']) {
    feature.navigate('/notifications', event);
    await feature.settle();
    feature.mutate();
    await feature.settle();
    assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), true);
    assert.equal(feature.logo.querySelector('[data-fractured-owner-avatar]')?.src,
      'chrome-extension://fractured/icons/fractured.png');
    assert.equal(feature.lifecycle().urlReads, 1);
  }
  feature.invalidateRuntime();
  feature.mutate();
  await feature.settle();
  assertRestored(feature);
  const before = feature.lifecycle();
  feature.mutate();
  feature.change(true);
  await feature.settle();
  assert.deepEqual(feature.lifecycle(), before);
  assert.equal(feature.warnings.length, 0);
});

test('handles getURL invalidation at startup before registering callbacks', async () => {
  const feature = harness(true, null, new Error('Extension context invalidated.'));
  await feature.settle();
  assert.equal(feature.lifecycle().urlReads, 1);
  assert.equal(feature.lifecycle().listeners, 0);
  assert.equal(feature.lifecycle().storageReads, 0);
  assert.equal(feature.lifecycle().queued, 0);
  assert.equal(feature.logo.children.length, 0);
  assert.equal(feature.logo.getAttribute('href'), '/');
  assert.equal(feature.warnings.length, 0);
});

test('stops queued refreshes on repository pages when the runtime ID disappears', async () => {
  const feature = harness(true);
  await feature.settle();
  feature.mutate();
  feature.invalidateRuntime();
  await feature.settle();
  assertRestored(feature);
  assert.equal(feature.lifecycle().queued, 0);
  assert.equal(feature.lifecycle().urlReads, 1);
});

test('restores existing Fractured branding on invalidation', async () => {
  const feature = harness(true);
  feature.navigate('/notifications');
  await feature.settle();
  assert.equal(feature.logo.hasAttribute('data-fractured-brand-logo'), true);
  feature.invalidateRuntime();
  feature.mutate();
  await feature.settle();
  assertRestored(feature);
});

test('handles invalidated storage reads at startup and after settings changes', async () => {
  const error = new Error('Extension context invalidated.');
  const startup = harness(true, error);
  await startup.settle();
  assertRestored(startup);
  assert.equal(startup.warnings.length, 0);

  const running = harness(true);
  await running.settle();
  running.failStorage(error);
  running.change(false);
  await running.settle();
  assertRestored(running);
  assert.equal(running.warnings.length, 0);
});

test('does not suppress unrelated storage failures or permanently disable the feature', async () => {
  const error = new Error('Storage unavailable');
  const feature = harness(true, error);
  await feature.settle();
  assert.equal(feature.warnings.length, 1);
  assert.equal(feature.warnings[0][1], error);
  assert.equal(feature.lifecycle().disconnected, false);
  feature.failStorage(null);
  feature.change(true);
  await feature.settle();
  assert.equal(feature.logo.getAttribute('href'), '/pony-factor');
});
