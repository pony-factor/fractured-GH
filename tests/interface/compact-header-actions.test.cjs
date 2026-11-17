const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const { findCreateControl } = require('../../features/interface/compact-header-actions.js');

function mockControl(hasPlus, inCustomMenu = false) {
  return {
    closest: () => inCustomMenu ? {} : null,
    querySelector: (selector) => selector === 'svg.octicon-plus' && hasPlus ? {} : null,
  };
}

test('detects the native plus action only inside the GitHub header', () => {
  const wrongButton = mockControl(false);
  const ourOwnButton = mockControl(true, true);
  const native = mockControl(true);
  const header = { querySelectorAll: () => [wrongButton, ourOwnButton, native] };
  assert.equal(findCreateControl({ querySelector: () => header }), native);
  assert.equal(findCreateControl({ querySelector: () => null }), null);
});

test('optional header controls are registered and default off', () => {
  const manifest = require('../../manifest.json');
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
  const options = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
  const script = manifest.content_scripts[0].js;
  assert.ok(script.includes('features/interface/compact-header-actions.js'));
  for (const [key, id] of [
    ['compactTopRightActions', 'compact-top-right-actions'],
    ['hideNotificationsButton', 'hide-notifications-button'],
  ]) {
    assert.match(background, new RegExp(key + ': false'));
    assert.match(html, new RegExp('id="' + id + '"'));
    assert.match(options, new RegExp(key + ':'));
  }
});

test('expanded menu reuses the native creation action instead of recreating GitHub links', () => {
  const script = fs.readFileSync(path.join(root, 'features/interface/compact-header-actions.js'), 'utf8');
  assert.match(script, /nativeCreate\.click\(\)/);
  assert.match(script, /inbox\.href = '\/notifications'/);
  assert.match(script, /setExpanded\(false\)/);
});
