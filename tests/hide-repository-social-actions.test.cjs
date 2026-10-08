const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/hide-repository-social-actions.js'), 'utf8',
);
const attribute = 'data-fractured-hidden-repository-control';

function disabledControl(text, ariaLabel = '') {
  const wrapper = {
    action: undefined,
    setAttribute(name, value) {
      if (name === attribute) this.action = value;
    },
    removeAttribute(name) {
      if (name === attribute) this.action = undefined;
    },
  };
  return {
    wrapper,
    textContent: text,
    getAttribute: name => name === 'aria-label' ? ariaLabel : null,
    closest: () => wrapper,
  };
}

async function render(hideRepositoryFork, controls) {
  const frames = [];
  const document = {
    head: { append() {} },
    documentElement: {},
    createElement: () => ({ textContent: '' }),
    querySelector: selector => selector.includes('octolytics-dimension-repository_nwo')
      ? { getAttribute: () => 'pony-factor/fractured-GH' }
      : null,
    querySelectorAll(selector) {
      if (selector === `[${attribute}]`) {
        return controls.map(control => control.wrapper).filter(item => item.action);
      }
      if (selector.includes('#repository-container-header button:disabled')) return controls;
      return [];
    },
    addEventListener() {},
  };
  vm.runInNewContext(source, {
    document,
    location: { origin: 'https://github.com', pathname: '/pony-factor/fractured-GH' },
    chrome: {
      storage: {
        local: { get: async () => ({ hideRepositoryFork }) },
        onChanged: { addListener() {} },
      },
    },
    URL,
    window: { addEventListener() {} },
    requestAnimationFrame: callback => frames.push(callback),
    MutationObserver: class { observe() {} },
  });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  while (frames.length) frames.shift()();
}

test('hides a disabled private repository Fork button without hiding other actions', async () => {
  const fork = disabledControl('Fork');
  const star = disabledControl('Star');
  await render(true, [fork, star]);
  assert.equal(fork.wrapper.action, 'fork');
  assert.equal(star.wrapper.action, undefined);
});

test('matches an icon-only disabled Fork button by its accessible label', async () => {
  const fork = disabledControl('', 'Fork this repository');
  await render(true, [fork]);
  assert.equal(fork.wrapper.action, 'fork');
});

test('recognizes a private repository cannot-fork message', async () => {
  const fork = disabledControl('', 'Cannot fork this repository');
  await render(true, [fork]);
  assert.equal(fork.wrapper.action, 'fork');
});

test('leaves disabled Fork controls visible when the setting is off', async () => {
  const fork = disabledControl('Fork');
  await render(false, [fork]);
  assert.equal(fork.wrapper.action, undefined);
});
