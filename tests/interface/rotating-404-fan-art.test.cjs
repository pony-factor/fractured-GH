const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const background = fs.readFileSync(require.resolve('../../background.js'), 'utf8')
  .replaceAll('void applyActionIcon();', '');

test('404 art requests fresh random results and skips repeats and unusable images', async () => {
  const artwork = (id, tags = ['safe', 'artist:example']) => ({
    id,
    tags,
    representations: { large: `https://derpicdn.net/${id}.png` },
  });
  const batches = [
    [artwork(4100000, ['safe']), artwork(4100001, ['artist:example']), artwork(4100002), artwork(4100003)],
    [artwork(4100003), artwork(4100004), artwork(4100005)],
  ];
  const listeners = [];
  const downloads = [];
  const fetch = async (href, options) => {
    const url = new URL(href);
    if (url.hostname === 'derpibooru.org') {
      assert.equal(url.pathname, '/api/v1/json/search/images');
      assert.equal(url.searchParams.get('q'), 'safe, pony, artist:*, -animated');
      assert.equal(url.searchParams.get('sf'), 'random');
      assert.equal(options.cache, 'no-store');
      return Response.json({ images: batches.shift() });
    }
    assert.equal(url.hostname, 'derpicdn.net');
    downloads.push(url.pathname);
    if (url.pathname === '/4100002.png') return new Response(null, { status: 404 });
    return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } });
  };
  vm.runInNewContext(background, {
    AbortSignal, URL, URLSearchParams, btoa, fetch,
    chrome: { runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { listeners.push(listener); } },
    } },
  });
  const request = (excludeId) => new Promise(resolve => {
    const message = { type: 'fractured:load-404-fan-art', excludeId };
    assert.equal(listeners.some(listener => listener(message, {}, resolve)), true);
  });

  const first = await request();
  assert.equal(first.id, 4100003);
  assert.equal(first.artist, 'example');
  assert.equal(first.imageDataUrl, 'data:image/png;base64,AQ==');
  assert.equal((await request(4100004)).id, 4100005);
  assert.deepEqual(downloads, ['/4100002.png', '/4100003.png', '/4100005.png']);
  assert.equal(batches.length, 0);
});
