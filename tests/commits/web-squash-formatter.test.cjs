const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "features/commits/web-squash-formatter.js"), "utf8");
const context = vm.createContext({
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  document: { addEventListener() {}, querySelectorAll() { return []; } },
  window: { addEventListener() {} },
  chrome: { storage: {
    onChanged: { addListener() {} },
    local: { get: async defaults => defaults },
  } },
});
vm.runInContext(source.replace(/\}\)\(\);\s*$/, "globalThis.helpers = { squashTitle, squashBody }; \n})();"), context);
const { squashTitle, squashBody } = context.helpers;

test("preserves the exact PR title and appends its number once", () => {
  assert.equal(squashTitle("🖌️ Improve controls", 45), "🖌️ Improve controls (#45)");
  assert.equal(squashTitle("🖌️ Improve controls (#45)", 45), "🖌️ Improve controls (#45)");
});

test("formats chronological subjects, descriptions, sync filtering and unique co-authors", () => {
  const body = [
    "* 🐛 Fix panel layout",
    "    Protect narrow windows.",
    "* 🔄 Sync brach to main",
    "* 🧪 Add regression coverage",
    "",
    "Co-authored-by: Alice <alice@example.com>",
    "Co-authored-by: Codex <noreply@openai.com>",
  ].join("\n");
  assert.equal(squashBody(body, { webSquashFilterSync: true }), [
    "- 🐛 Fix panel layout",
    "    Protect narrow windows.",
    "- 🧪 Add regression coverage",
    "",
    "__________",
    "",
    "Co-authored-by: Alice <alice@example.com>",
    "Co-authored-by: Codex (Web) <noreply@openai.com>",
  ].join("\n"));
});

test("can omit bullets only if all retained subjects start with emoji", () => {
  const prefs = { webSquashFilterSync: true, webSquashOmitEmojiBullets: true, webSquashSeparator: "hyphens" };
  const result = squashBody("- 🐛 Fix toolbar\n- 🧪 Cover edge cases", prefs);
  assert.match(result, /^🐛 Fix toolbar\n\n🧪 Cover edge cases\n\n---------\n\n/);
  assert.ok(!result.includes("- 🐛"));
  assert.match(squashBody("- 🐛 Fix toolbar\n- Add tests", prefs), /^- 🐛 Fix toolbar\n- Add tests/);
});

test("keeps sync entries when filtering is disabled and supports no separator", () => {
  const result = squashBody("- 🔄 Sync branch to main\n- 🐛 Fix a bug",
    { webSquashFilterSync: false, webSquashSeparator: "none" });
  assert.match(result, /^- 🔄 Sync branch to main\n- 🐛 Fix a bug\n\nCo-authored-by:/);
  assert.ok(!result.includes("__________"));
});

test("does not reinterpret manually authored messages as commit lists", () => {
  assert.equal(squashBody("A PR description with no commit list."), null);
  assert.equal(squashBody("## Summary\n- Add a feature"), null);
  assert.equal(squashBody(""), null);
});

test("merge-specific preferences are wired and disabled until opted in", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes("features/commits/web-squash-formatter.js"));
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const options = fs.readFileSync(path.join(root, "options.html"), "utf8");
  const controller = fs.readFileSync(path.join(root, "options.js"), "utf8");
  assert.match(background, /webSquashFormattingEnabled: false/);
  for (const key of ["webSquashFormattingEnabled", "webSquashOmitEmojiBullets",
    "webSquashFilterSync", "webSquashSeparator"]) {
    assert.match(controller, new RegExp(key + ": "));
  }
  for (const id of ["web-squash-formatting-enabled", "web-squash-omit-emoji-bullets",
    "web-squash-filter-sync", "web-squash-separator"]) {
    assert.ok(options.includes('id="' + id + '"'));
  }
  for (const feature of ["message-simplifier.js", "title-emojis.js"]) {
    const content = fs.readFileSync(path.join(root, "features/commits", feature), "utf8");
    assert.match(content, /isManagedSquash\(field\)/);
  }
  assert.match(source, /button\.type = "button"/);
  assert.doesNotMatch(source, /click\(\)|requestSubmit\(\)/);
});
