const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { headerActionMode } = require('../../features/repositories/hide-repository-social-actions.js');

const root = path.join(__dirname, '../..');
const options = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

test('each settings checkbox occurs exactly once under the intended tab', () => {
  const ids = [...options.matchAll(/<input id="([^"]+)" type="checkbox"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length > 35);
  const tab = id => options.match(new RegExp('<section id="settings-panel-([^"]+)"[\\s\\S]*?(?=<section id="settings-panel-|<p id="status")', 'g'))
    ?.find(section => section.includes('id="' + id + '"'));
  for (const id of ['hide-repository-watch', 'hide-repository-star', 'hide-repository-fork',
    'hide-repository-watch-button', 'hide-repository-star-button', 'hide-repository-fork-button',
    'auto-setup-new-forks']) {
    assert.match(tab(id) || '', /id="settings-panel-repositories"/);
  }
  assert.match(tab('hide-copilot') || '', /id="settings-panel-commits"/);
  assert.match(tab('hide-pull-request-protip') || '', /id="settings-panel-pull-requests"/);
  assert.match(tab('hide-footer') || '', /id="settings-panel-general"/);
});

test('count hiding is independent of button hiding', () => {
  for (const action of ['watch', 'star', 'fork']) {
    const name = action[0].toUpperCase() + action.slice(1);
    const count = 'hideRepository' + name;
    const button = count + 'Button';
    assert.equal(headerActionMode(action, {}), 'show');
    assert.equal(headerActionMode(action, { [count]: true }), 'compact');
    assert.equal(headerActionMode(action, { [button]: true }), 'hide');
    assert.equal(headerActionMode(action, { [count]: true, [button]: true }), 'hide');
    assert.equal(headerActionMode(action, { hideRepositorySocialActions: true }), 'compact');
    assert.equal(headerActionMode(action, { [count]: false, hideRepositorySocialActions: true }), 'show');
    assert.match(controller, new RegExp(button + ': '));
    assert.match(background, new RegExp(button + ': false'));
  }
  assert.equal(headerActionMode('pins', {}), 'hide');
  assert.equal(headerActionMode('pins', { hideRepositoryPins: false }), 'show');
});

test('distinct count and button sections are labeled and linked to inputs', () => {
  assert.match(options, /<span>Action counts<\/span>/);
  assert.match(options, /<span>Action buttons<\/span>/);
  assert.match(options, /<span>New repositories and forks<\/span>/);
  assert.match(options, /aria-controls="settings-panel-repositories"/);
  assert.match(options, />Copilot<\/button>/);
  for (const metric of ['Watch', 'Star', 'Fork']) {
    assert.match(options, new RegExp('Hide ' + metric + ' counts and dropdown'));
    assert.match(options, new RegExp('Hide ' + metric + ' button'));
  }
});
