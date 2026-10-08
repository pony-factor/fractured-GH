const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/profile-name-cache.js'), 'utf8',
);

function startCache(storage, opts = {}) {
  const clock = opts.clock || { now: 1000000 };
  const DateWithClock = class extends Date {
    static now() { return clock.now; }
  };
  let fetches = 0;
  let reads = 0;
  const context = {
    Date: DateWithClock,
    chrome: {
      storage: {
        local: {
          async get(key) {
            reads++;
            return { [key]: storage.get(key) };
          },
          async set(records) {
            for (const [key, value] of Object.entries(records)) storage.set(key, value);
          },
        },
      },
    },
    fetch: async () => {
      fetches++;
      if (opts.fail) throw new Error('network unavailable');
      return { ok: true, text: async () => 'profile document' };
    },
    DOMParser: class {
      parseFromString() {
        return {
          querySelector(selector) {
            if (selector === 'title') return { textContent: opts.title || '' };
            return opts.name === '' ? null : { textContent: opts.name || 'Windsor Flight' };
          },
        };
      }
    },
  };
  vm.runInNewContext(source, context);
  return {
    cache: context.FracturedProfileNameCache,
    get fetches() { return fetches; },
    get reads() { return reads; },
  };
}

test('profile names survive new page contexts and differently cased logins', async () => {
  const storage = new Map();
  const first = startCache(storage);
  assert.equal(await first.cache.getDisplayName('JFWooten4'), 'Windsor Flight');
  assert.equal(first.fetches, 1);

  const second = startCache(storage, { fail: true });
  assert.equal(await second.cache.getDisplayName('jfwooten4'), 'Windsor Flight');
  assert.equal(second.fetches, 0);
});

test('hover and page requests for the same user share one pending lookup', async () => {
  const feature = startCache(new Map());
  const [hover, profile] = await Promise.all([
    feature.cache.getDisplayName('JFWooten4'),
    feature.cache.getDisplayName('jfwooten4'),
  ]);
  assert.equal(hover, 'Windsor Flight');
  assert.equal(profile, 'Windsor Flight');
  assert.equal(feature.fetches, 1);
  assert.equal(feature.reads, 1);
});

test('expired names are refreshed after thirty days', async () => {
  const clock = { now: 1000000 };
  const storage = new Map();
  const first = startCache(storage, { clock, name: 'Original Name' });
  assert.equal(await first.cache.getDisplayName('JFWooten4'), 'Original Name');

  clock.now += 31 * 24 * 60 * 60 * 1000;
  const next = startCache(storage, { clock, name: 'Updated Name' });
  assert.equal(await next.cache.getDisplayName('JFWooten4'), 'Updated Name');
  assert.equal(next.fetches, 1);
  const anotherPage = startCache(storage, { clock, fail: true });
  assert.equal(await anotherPage.cache.getDisplayName('JFWooten4'), 'Updated Name');
  assert.equal(anotherPage.fetches, 0);
});

test('failed and empty profile fetches are not persisted', async () => {
  const storage = new Map();
  const failed = startCache(storage, { fail: true });
  assert.equal(await failed.cache.getDisplayName('JFWooten4'), '');
  assert.equal(storage.size, 0);
  const empty = startCache(storage, { name: '' });
  assert.equal(await empty.cache.getDisplayName('JFWooten4'), '');
  assert.equal(storage.size, 0);
  const retry = startCache(storage);
  assert.equal(await retry.cache.getDisplayName('JFWooten4'), 'Windsor Flight');
  assert.equal(retry.fetches, 1);
});

test('profile title is used when GitHub omits the visible name selector', async () => {
  const feature = startCache(new Map(), {
    name: '',
    title: 'Windsor Flight (JFWooten4) · GitHub',
  });
  assert.equal(await feature.cache.getDisplayName('JFWooten4'), 'Windsor Flight');
});

test('unrecognized usernames do not trigger profile fetches', async () => {
  const feature = startCache(new Map());
  assert.equal(await feature.cache.getDisplayName('users/not-a-login'), '');
  assert.equal(feature.fetches, 0);
});
