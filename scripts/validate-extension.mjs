import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const checked = new Set();

function requireFile(relativePath, reference) {
  assert.equal(typeof relativePath, "string", `${reference} must be a path`);
  assert.ok(relativePath.length && !isAbsolute(relativePath), `${reference}: invalid path`);
  const absolutePath = resolve(root, relativePath);
  assert.ok(!relative(root, absolutePath).startsWith(`..${sep}`) &&
    relative(root, absolutePath) !== ".." && absolutePath !== root,
  `${reference}: path escapes repository`);
  assert.ok(statSync(absolutePath).isFile(), `${reference}: ${relativePath} is not a file`);
  checked.add(relativePath);
}

assert.equal(manifest.manifest_version, 3, "Extension must use Manifest V3");
assert.equal(typeof manifest.name, "string");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
requireFile(manifest.background?.service_worker, "background.service_worker");
requireFile(manifest.options_page, "options_page");

for (const [size, icon] of Object.entries(manifest.icons || {})) {
  requireFile(icon, `icons.${size}`);
}
for (const [size, icon] of Object.entries(manifest.action?.default_icon || {})) {
  requireFile(icon, `action.default_icon.${size}`);
}
assert.ok(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length,
  "Extension must declare content scripts");
for (const [index, entry] of manifest.content_scripts.entries()) {
  assert.ok(Array.isArray(entry.matches) && entry.matches.length,
    `content_scripts[${index}] needs matches`);
  for (const [kind, items] of Object.entries({ js: entry.js || [], css: entry.css || [] })) {
    for (const file of items) requireFile(file, `content_scripts[${index}].${kind}`);
  }
}
for (const [index, entry] of (manifest.web_accessible_resources || []).entries()) {
  for (const file of entry.resources || []) {
    assert.ok(!file.includes("*"), `web_accessible_resources[${index}]: wildcard not validated`);
    requireFile(file, `web_accessible_resources[${index}]`);
  }
}

const html = readFileSync(resolve(root, manifest.options_page), "utf8");
for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
  if (!/^(?:https?:|data:|#)/i.test(match[1])) {
    requireFile(match[1], "options_page asset");
  }
}
console.log(`Validated Manifest V3 and ${checked.size} referenced extension assets.`);
