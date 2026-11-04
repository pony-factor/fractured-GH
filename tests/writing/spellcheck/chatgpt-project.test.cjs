const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '../../../background.js'), 'utf8')
  .split('// Curated, safe-rated fandom artworks.')[0]
  .replaceAll('void applyActionIcon();', '');

function setup(settings = {}) {
  const listeners = [];
  const tabs = [];
  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { listeners.push(listener); } },
    },
    action: { onClicked: { addListener() {} } },
    storage: { local: { async get(defaults) { return { ...defaults, ...settings }; } } },
    tabs: {
      create(params, done) {
        tabs.push(params);
        done({ id: 7 });
      },
      remove(_id, done) { done(); },
    },
  };
  const context = { chrome, URL, console };
  vm.runInNewContext(background + '\nglobalThis.normalizeUrl = normalizeChatgptProjectUrl;', context);
  return {
    tabs,
    normalizeUrl: context.normalizeUrl,
    async open(jobId = 'job-123') {
      const event = listeners[0];
      return new Promise((resolve) => {
        assert.equal(event({ type: 'fractured:open-spellcheck', jobId }, {}, resolve), true);
      });
    },
  };
}

test('default spellcheck still opens an ordinary ChatGPT chat', async () => {
  const app = setup();
  assert.equal((await app.open()).ok, true);
  assert.equal(app.tabs.length, 1);
  const url = new URL(app.tabs[0].url);
  assert.equal(url.origin + url.pathname, 'https://chatgpt.com/');
  assert.equal(url.searchParams.get('fractured-spellcheck'), 'job-123');
  assert.equal(url.searchParams.has('fractured-project'), false);
  assert.equal(app.tabs[0].active, false);
});

test('opt-in routes only to a configured project with the job identifier', async () => {
  const project = 'https://chatgpt.com/g/g-p-example123/project';
  const app = setup({ spellcheckUseChatgptProject: true, spellcheckChatgptProjectUrl: project + '/' });
  assert.equal((await app.open('my job')).ok, true);
  assert.equal(app.tabs.length, 1);
  const url = new URL(app.tabs[0].url);
  assert.equal(url.origin + url.pathname, project);
  assert.equal(url.searchParams.get('fractured-spellcheck'), 'my job');
  assert.equal(url.searchParams.get('fractured-project'), '1');
});

test('refuses malformed project URLs instead of silently using an ordinary chat', async () => {
  for (const candidate of [
    '', 'https://evil.example/g/g-p-123/project',
    'http://chatgpt.com/g/g-p-123/project',
    'https://chatgpt.com/g/g-p-123/project?redirect=evil',
    'https://chatgpt.com/c/123',
    'https://chatgpt.com/g/g-p-123/project#fragment',
    'https://chatgpt.com.evil.example/g/g-p-123/project',
  ]) {
    const app = setup({ spellcheckUseChatgptProject: true, spellcheckChatgptProjectUrl: candidate });
    const result = await app.open();
    assert.equal(result.ok, false, candidate);
    assert.match(result.error, /valid ChatGPT Project URL/);
    assert.equal(app.tabs.length, 0, candidate);
  }
});

test('project URL is ignored completely when setting is disabled', async () => {
  const app = setup({ spellcheckUseChatgptProject: false, spellcheckChatgptProjectUrl: 'not valid' });
  assert.equal((await app.open()).ok, true);
  assert.equal(new URL(app.tabs[0].url).pathname, '/');
});

test('URL validation accepts only exact project paths', () => {
  const app = setup();
  assert.equal(app.normalizeUrl('https://chatgpt.com/g/g-p-foo123/project/'),
    'https://chatgpt.com/g/g-p-foo123/project');
  assert.equal(app.normalizeUrl('https://chatgpt.com/g/g-p-foo123/project/extra'), null);
  assert.equal(app.normalizeUrl('https://chatgpt.com@evil.example/g/g-p-foo123/project'), null);
});
