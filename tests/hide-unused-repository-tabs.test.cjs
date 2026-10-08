const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/hide-unused-repository-tabs.js'), 'utf8',
);

function makeLink(label, route, owner = 'pony-factor', repo = 'fractured-GH') {
  const item = { hidden: false, dataset: {} };
  const link = {
    href: 'https://github.com/' + owner + '/' + repo + '/' + route,
    textContent: label,
    getAttribute: () => null,
    closest: selector => (selector === 'li' ? item : null),
  };
  return { item, link };
}

function setup(fetch, initialSettings = {}) {
  const callbacks = {};
  const storageListeners = [];
  const storedSettings = { ...initialSettings };
  const chrome = {
    storage: {
      local: { get: async defaults => ({ ...defaults, ...storedSettings }) },
      onChanged: { addListener: listener => storageListeners.push(listener) },
    },
  };
  const frames = [];
  const location = { origin: 'https://github.com', pathname: '/pony-factor/fractured-GH' };
  const links = [];
  const navigation = {
    querySelectorAll(selector) {
      if (selector === 'a[href]') return links.map(({ link }) => link);
      if (selector === '[data-fractured-hidden-repository-tab]') {
        return links.filter(({ item }) => item.dataset.fracturedHiddenRepositoryTab).map(({ item }) => item);
      }
      throw Error('Unexpected selector: ' + selector);
    },
  };
  const document = {
    documentElement: {},
    addEventListener: (name, callback) => { callbacks[name] = callback; },
    querySelectorAll: () => [navigation],
  };
  const window = {
    location,
    requestAnimationFrame: callback => frames.push(callback),
    addEventListener: (name, callback) => { callbacks[name] = callback; },
  };
  vm.runInNewContext(source, {
    window, document, fetch, URL, encodeURIComponent, Date,
    MutationObserver: class { observe() {} },
    chrome,
  });
  function flush() {
    for (let i = 0; frames.length; i++) {
      if (i > 10) throw Error('Animation frame loop');
      frames.shift()();
    }
  }
  async function settle() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    flush();
  }
  function changeSetting(key, value) {
    storedSettings[key] = value;
    for (const listener of storageListeners) {
      listener({ [key]: { newValue: value } }, 'local');
    }
  }
  return { links, location, callbacks, flush, settle, changeSetting };
}

test('does not fetch metadata without a Discussions tab', () => {
  let calls = 0;
  const app = setup(() => { calls++; return Promise.resolve({ ok: true }); });
  app.links.push(makeLink('Code', ''), makeLink('Wiki', 'wiki'));
  app.flush();
  assert.equal(calls, 0);
  assert.equal(app.links[1].item.hidden, true);
});

test('hides disabled Discussions tabs, without hiding other tabs or fetching repeatedly', async () => {
  let calls = 0;
  const app = setup((url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/pony-factor/fractured-GH');
    assert.equal(options.credentials, 'omit');
    return Promise.resolve({ ok: true, json: async () => ({ has_discussions: false }) });
  });
  app.links.push(makeLink('Code', ''), makeLink('Discussions 2', 'discussions'), makeLink('Issues', 'issues'));
  app.flush();
  assert.equal(app.links[1].item.hidden, false);
  await app.settle();
  assert.equal(app.links[1].item.hidden, true);
  assert.equal(app.links[0].item.hidden, false);
  assert.equal(app.links[2].item.hidden, false);
  app.callbacks['turbo:load']();
  app.flush();
  assert.equal(calls, 1);
});

test('leaves enabled Discussions tabs visible', async () => {
  const app = setup(async () => ({ ok: true, json: async () => ({ has_discussions: true }) }));
  app.links.push(makeLink('Discussions', 'discussions'));
  app.flush();
  await app.settle();
  assert.equal(app.links[0].item.hidden, false);
});

test('fails open when repository metadata is inaccessible', async () => {
  for (const fetch of [
    async () => ({ ok: false, status: 404 }),
    async () => ({ ok: false, status: 403 }),
    async () => { throw new Error('Offline'); },
    async () => ({ ok: true, json: async () => ({ has_issues: true }) }),
  ]) {
    const app = setup(fetch);
    app.links.push(makeLink('Discussions', 'discussions'));
    app.flush();
    await app.settle();
    assert.equal(app.links[0].item.hidden, false);
  }
});

test('does not apply an outdated result after navigating to another repository', async () => {
  const pending = [];
  const app = setup(url => new Promise(resolve => pending.push({ url, resolve })));
  app.links.push(makeLink('Discussions', 'discussions'));
  app.flush();
  app.location.pathname = '/other/repo';
  app.links.splice(0, 1, makeLink('Discussions', 'discussions', 'other', 'repo'));
  app.callbacks['turbo:load']();
  app.flush();
  assert.equal(pending.length, 2);
  pending[1].resolve({ ok: true, json: async () => ({ has_discussions: true }) });
  await app.settle();
  pending[0].resolve({ ok: true, json: async () => ({ has_discussions: false }) });
  await app.settle();
  assert.equal(app.links[0].item.hidden, false);
});

test('hides Actions when there are no workflows or historical runs', async () => {
  const urls = [];
  const app = setup(async url => {
    urls.push(url);
    return { ok: true, json: async () => ({ total_count: 0 }) };
  });
  app.links.push(makeLink('Actions', 'actions'), makeLink('Issues', 'issues'));
  app.flush();
  assert.equal(app.links[0].item.hidden, false);
  await app.settle();
  assert.equal(app.links[0].item.hidden, true);
  assert.equal(app.links[1].item.hidden, false);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/actions\/workflows\?per_page=1$/);
  assert.match(urls[1], /\/actions\/runs\?per_page=1$/);
  app.callbacks['turbo:load']();
  app.flush();
  assert.equal(urls.length, 2, 'cache avoids refetching on navigation events');
});

test('keeps Actions visible with configured workflows, even if they have never run', async () => {
  const urls = [];
  const app = setup(async url => {
    urls.push(url);
    return { ok: true, json: async () => ({ total_count: 1 }) };
  });
  app.links.push(makeLink('Actions', 'actions'));
  app.flush();
  await app.settle();
  assert.equal(app.links[0].item.hidden, false);
  assert.equal(urls.length, 1, 'do not fetch historical runs if workflows exist');
});

test('keeps Actions visible with historical runs after workflows were removed', async () => {
  const urls = [];
  const app = setup(async url => {
    urls.push(url);
    return { ok: true, json: async () => ({
      total_count: url.includes('/workflows?') ? 0 : 4,
    }) };
  });
  app.links.push(makeLink('Actions', 'actions'));
  app.flush();
  await app.settle();
  assert.equal(app.links[0].item.hidden, false);
  assert.equal(urls.length, 2);
});

test('keeps Actions visible when metadata cannot prove there is nothing to see', async () => {
  for (const fetch of [
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => ({ bogus: true }) }),
    async url => url.includes('/runs?')
      ? { ok: false, status: 404 }
      : { ok: true, json: async () => ({ total_count: 0 }) },
    async () => { throw Error('Offline'); },
  ]) {
    const app = setup(fetch);
    app.links.push(makeLink('Actions', 'actions'));
    app.flush();
    await app.settle();
    assert.equal(app.links[0].item.hidden, false);
  }
});

test('does not request Actions status if no Actions tab is shown', () => {
  let calls = 0;
  const app = setup(async () => { calls++; return { ok: true, json: async () => ({ total_count: 0 }) }; });
  app.links.push(makeLink('Issues', 'issues'));
  app.flush();
  assert.equal(calls, 0);
});

test('does not hide the Actions tab for a different repository after navigation', async () => {
  const pending = [];
  const app = setup(url => new Promise(resolve => pending.push({ url, resolve })));
  app.links.push(makeLink('Actions', 'actions'));
  app.flush();
  app.location.pathname = '/other/repo';
  app.links.splice(0, 1, makeLink('Actions', 'actions', 'other', 'repo'));
  app.callbacks['turbo:load']();
  app.flush();
  assert.equal(pending.length, 2);
  pending[1].resolve({ ok: true, json: async () => ({ total_count: 2 }) });
  await app.settle();
  pending[0].resolve({ ok: true, json: async () => ({ total_count: 0 }) });
  await app.settle();
  assert.equal(pending.length, 3, 'first repository checks historical runs');
  pending[2].resolve({ ok: true, json: async () => ({ total_count: 0 }) });
  await app.settle();
  assert.equal(app.links[0].item.hidden, false);
});


test('hides the repository Insights tab when explicitly enabled', async () => {
  const app = setup(async () => { throw Error('No metadata request expected'); }, {
    hideRepositoryInsights: true,
  });
  app.links.push(
    makeLink('Insights', 'pulse'),
    makeLink('Code', ''),
    makeLink('Issues', 'issues'),
    makeLink('Insights', 'pulse', 'another', 'repository'),
    makeLink('Insights', 'settings'),
  );
  await app.settle();
  assert.equal(app.links[0].item.hidden, true);
  assert.equal(app.links[1].item.hidden, false);
  assert.equal(app.links[2].item.hidden, false);
  assert.equal(app.links[3].item.hidden, false, 'another repository remains unaffected');
  assert.equal(app.links[4].item.hidden, false, 'unrelated Insights links remain visible');
});

test('keeps the Insights tab visible by default and restores it live when disabled', async () => {
  const app = setup(async () => { throw Error('No metadata request expected'); });
  app.links.push(makeLink('Insights', 'pulse'));
  await app.settle();
  assert.equal(app.links[0].item.hidden, false);

  app.changeSetting('hideRepositoryInsights', true);
  app.flush();
  assert.equal(app.links[0].item.hidden, true);

  app.changeSetting('hideRepositoryInsights', false);
  app.flush();
  assert.equal(app.links[0].item.hidden, false);
  assert.equal(app.links[0].item.dataset.fracturedHiddenRepositoryTab, undefined);
});
