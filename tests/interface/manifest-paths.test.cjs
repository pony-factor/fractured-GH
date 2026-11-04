const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");
const featureRoot = path.join(repositoryRoot, "features");
const manifest = require("../../manifest.json");
const scriptPaths = manifest.content_scripts.flatMap(entry => entry.js || []);
const assetPaths = manifest.content_scripts.flatMap(entry => [
  ...(entry.js || []),
  ...(entry.css || []),
]);

function allJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return allJavaScriptFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith(".js")
      ? [path.relative(repositoryRoot, absolutePath).split(path.sep).join("/")]
      : [];
  });
}

test("manifest scripts and styles resolve to actual files", () => {
  for (const assetPath of assetPaths) {
    assert.ok(fs.statSync(path.join(repositoryRoot, assetPath)).isFile(), assetPath);
  }
});

test("every feature script is registered in the manifest", () => {
  const featureScripts = allJavaScriptFiles(featureRoot).sort();
  const registered = [...new Set(scriptPaths.filter(entry => entry.startsWith("features/")))].sort();
  assert.deepEqual(registered, featureScripts);
});

test("feature categories are not repeated in filenames", () => {
  const repeatedPrefixes = {
    commits: /^commit-/, 
    notifications: /(?:^|-)notifications?-/, 
    "pull-requests": /(?:^|-)pull-request-|^hide-pr-/, 
    repositories: /(?:^|-)repository-/, 
    spellcheck: /^spellcheck-/,
  };
  for (const featurePath of allJavaScriptFiles(featureRoot)) {
    const segments = featurePath.split("/");
    const folder = segments[segments.length - 2];
    const pattern = repeatedPrefixes[folder];
    if (pattern) assert.doesNotMatch(segments[segments.length - 1], pattern, featurePath);
  }
});

test("scripts retain their required dependency order", () => {
  const githubScripts = manifest.content_scripts.find(entry =>
    (entry.matches || []).some(match => match.includes("github.com"))
  )?.js || [];
  function loadsBefore(first, second) {
    assert.ok(githubScripts.indexOf(first) >= 0, first);
    assert.ok(githubScripts.indexOf(second) > githubScripts.indexOf(first), second);
  }
  loadsBefore("features/people/profile-name-cache.js", "features/people/promote-display-names.js");
  loadsBefore("features/writing/spellcheck/image-attachments.js", "features/writing/spellcheck/issue-pr-drafts.js");
  loadsBefore("features/writing/spellcheck/link-protection.js", "features/writing/spellcheck/issue-pr-drafts.js");
});
