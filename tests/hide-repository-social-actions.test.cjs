const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../features/repositories/hide-repository-social-actions.js'), 'utf8',
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

async function render(hideRepositoryFork, controls, options = {}) {
  const frames = [];
  const document = {
    head: { append() {} },
    documentElement: {},
    createElement: () => ({ textContent: '' }),
    querySelector: selector => selector.includes('octolytics-dimension-repository_nwo')
      ? (options.organization ? null : { getAttribute: () => 'pony-factor/fractured-GH' })
      : null,
    querySelectorAll(selector) {
      if (selector === `[${attribute}]`) {
        return [
          ...controls.map(control => control.wrapper),
          ...(options.links || []),
          ...(options.cardStars || []).map(card => card.metric),
        ].filter(item => item.action);
      }
      if (selector.includes('#repository-container-header button,')) return controls;
      if (selector.startsWith('a[href*=')) return (options.links || []).filter(link =>
        link.href.includes(selector.includes('stargazers') ? '/stargazers' : '/forks'));
      if (selector.startsWith('.pinned-item-list-item svg.octicon-star')) {
        return (options.cardStars || []).map(card => card.icon);
      }
      return [];
    },
    addEventListener() {},
  };
  vm.runInNewContext(source, {
    document,
    location: { origin: 'https://github.com', pathname: '/pony-factor/fractured-GH' },
    chrome: {
      storage: {
        local: { get: async () => ({ hideRepositoryFork, ...options.settings }) },
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

test('preserves a disabled private repository Fork control without hiding other actions', async () => {
  const fork = disabledControl('Fork');
  const star = disabledControl('Star');
  await render(true, [fork, star]);
  assert.equal(fork.wrapper.action, undefined);
  assert.equal(star.wrapper.action, undefined);
});

test('preserves an icon-only disabled Fork button by its accessible label', async () => {
  const fork = disabledControl('', 'Fork this repository');
  await render(true, [fork]);
  assert.equal(fork.wrapper.action, undefined);
});

test('does not remove a private repository cannot-fork message', async () => {
  const fork = disabledControl('', 'Cannot fork this repository');
  await render(true, [fork]);
  assert.equal(fork.wrapper.action, undefined);
});

test('leaves disabled Fork controls visible when the setting is off', async () => {
  const fork = disabledControl('Fork');
  await render(false, [fork]);
  assert.equal(fork.wrapper.action, undefined);
});

function statistic(href) {
  return { href, ...disabledControl('').wrapper };
}

test('hides pinned and listed statistics without repository metadata, preserving other links', async () => {
  const links = [
    statistic('https://github.com/blocktransfer/TAD3-core/stargazers'),
    statistic('https://github.com/blocktransfer/SEC-publications/forks/'),
    statistic('https://github.com/blocktransfer/SEC-publications/issues'),
    statistic('https://example.com/blocktransfer/TAD3-core/stargazers'),
    statistic('https://github.com/orgs/blocktransfer/forks'),
    statistic('https://github.com/blocktransfer/TAD3-core/stargazers/extra'),
  ];
  await render(true, [], { organization: true, links, settings: { hideRepositoryStar: true } });
  assert.deepEqual(links.map(link => link.action), ['star', 'fork', undefined, undefined, undefined, undefined]);
});

test('honors separate star/fork preferences and the legacy fallback on organization cards', async () => {
  const star = statistic('https://github.com/blocktransfer/TAD3-core/stargazers');
  const fork = statistic('https://github.com/blocktransfer/TAD3-core/forks');
  await render(false, [], { organization: true, links: [star, fork], settings: { hideRepositorySocialActions: true } });
  assert.equal(star.action, 'star');
  assert.equal(fork.action, undefined);
  star.action = undefined;
  await render(true, [], { organization: true, links: [star, fork], settings: { hideRepositoryStar: false } });
  assert.equal(star.action, undefined);
  assert.equal(fork.action, 'fork');
});

function cardStar({ classified = true, iconCount = 1, text = '1' } = {}) {
  const metric = disabledControl('').wrapper;
  metric.textContent = text;
  metric.querySelectorAll = () => Array.from({ length: iconCount }, () => ({}));
  const icon = {
    closest: () => classified ? metric : null,
    parentElement: metric,
  };
  return { metric, icon };
}

test('hides non-link star counts on pinned and repository cards without hiding adjacent items', async () => {
  const pinned = cardStar();
  const listed = cardStar({ classified: false, text: '1.2k' });
  const sharedFooter = cardStar({ classified: false, iconCount: 2 });
  const fork = statistic('https://github.com/pony-factor/fractured-GH/forks');
  await render(false, [], {
    organization: true,
    cardStars: [pinned, listed, sharedFooter],
    links: [fork],
    settings: { hideRepositoryStar: true },
  });
  assert.equal(pinned.metric.action, 'star');
  assert.equal(listed.metric.action, 'star');
  assert.equal(sharedFooter.metric.action, undefined);
  assert.equal(fork.action, undefined);
});

test('card star counts respect the individual and legacy preferences and restore when disabled', async () => {
  const pinned = cardStar();
  await render(false, [], {
    organization: true, cardStars: [pinned], settings: { hideRepositorySocialActions: true },
  });
  assert.equal(pinned.metric.action, 'star');

  await render(false, [], {
    organization: true, cardStars: [pinned],
    settings: { hideRepositoryStar: false, hideRepositorySocialActions: true },
  });
  assert.equal(pinned.metric.action, undefined);
});
