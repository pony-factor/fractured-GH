const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const manifest = require('../../manifest.json');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.isFile() && /\.(?:js|css|html|json|md)$/.test(entry.name)
      ? [absolute] : [];
  });
}

test('extension identity and metadata use Fractured GitHub', () => {
  assert.equal(manifest.name, 'Fractured GitHub');
  assert.equal(manifest.action.default_title, 'Fractured GitHub');
  assert.match(manifest.description, /Fractured GitHub/);
  const settingsPage = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
  assert.match(settingsPage, /<title>Fractured GitHub<\/title>/);
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /^# Fractured GitHub/m);
});

test('extension code and documentation contain no former branding', () => {
  const paths = [
    ...['README.md', 'manifest.json', 'background.js', 'options.html',
      'options.js', 'options-page.js', 'options.css'].map((name) => path.join(root, name)),
    ...sourceFiles(path.join(root, 'features')),
  ];
  const formerBranding = [
    /github-tweaks/i,
    /github-extension/i,
    /\[GitHub Extension\]/i,
  ];
  for (const file of paths) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of formerBranding) {
      assert.doesNotMatch(source, pattern, path.relative(root, file));
    }
  }
});
