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
  HTMLInputElement: class {},
  HTMLTextAreaElement: class {},
  Event: class { constructor(type) { this.type = type; } },
  document: { addEventListener() {}, querySelectorAll() { return []; } },
  window: { addEventListener() {} },
  chrome: { storage: {
    onChanged: { addListener() {} },
    local: { get: async defaults => defaults },
  } },
});
vm.runInContext(source.replace(/\}\)\(\);\s*$/, "globalThis.helpers = { squashTitle, squashBody, mergeFields, prTitle, apply }; \n})();"), context);
const { squashTitle, squashBody, mergeFields, apply } = context.helpers;

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
    "Co-authored-by: Codex <noreply@openai.com>",
  ].join("\n"));
});

test("can omit bullets only if all retained subjects start with emoji", () => {
  const prefs = { webSquashFilterSync: true, webSquashOmitEmojiBullets: true, webSquashSeparator: "hyphens" };
  const result = squashBody("- 🐛 Fix toolbar\n- 🧪 Cover edge cases", prefs);
  assert.equal(result, "🐛 Fix toolbar\n\n🧪 Cover edge cases");
  assert.ok(!result.includes("- 🐛"));
  assert.match(squashBody("- 🐛 Fix toolbar\n- Add tests", prefs), /^- 🐛 Fix toolbar\n- Add tests/);
});

test("keeps sync entries when filtering is disabled and supports no separator", () => {
  const result = squashBody("- 🔄 Sync branch to main\n- 🐛 Fix a bug",
    { webSquashFilterSync: false, webSquashSeparator: "none" });
  assert.equal(result, "- 🔄 Sync branch to main\n- 🐛 Fix a bug");
  assert.ok(!result.includes("__________"));
});

test("does not reinterpret manually authored messages as commit lists", () => {
  assert.equal(squashBody("A PR description with no commit list."), null);
  assert.equal(squashBody("## Summary\n- Add a feature"), null);
  assert.equal(squashBody(""), null);
});

test("formats GitHub's interleaved trailers and unindented commit descriptions", () => {
  const result = squashBody([
    "* 🔩 Share signing identity", "", "Co-authored-by: ChatGPT 6 <noreply@openai.com>", "",
    "* 🧪 Cover signing", "", "Keep author and committer separate.", "",
    "Co-authored-by: ChatGPT 6 <noreply@openai.com>", "",
    "* 🔄 Sync brach to main", "", "Resolve conflicts.", "",
    "Co-authored-by: Alice <alice@example.com>",
  ].join("\n"));
  assert.equal(result, [
    "- 🔩 Share signing identity", "- 🧪 Cover signing",
    "    Keep author and committer separate.", "", "__________", "",
    "Co-authored-by: ChatGPT 6 <noreply@openai.com>",
    "Co-authored-by: Alice <alice@example.com>",
  ].join("\n"));
});

test("does not invent Codex co-authorship when no source commits credit it", () => {
  const body = "- 🌱 Add constituency quotations\n- ✒️ Add reply-intent prompts";
  assert.equal(squashBody(body), body);
  assert.equal(squashBody(body + "\n\n__________"), body);
  assert.doesNotMatch(squashBody(body), /Co-authored-by|noreply@openai.com/i);
});

test("keeps explicitly supplied Codex Web and ChatGPT credits distinct and stable", () => {
  const body = [
    "- 🐛 Fix formatting",
    "",
    "Co-authored-by: Codex (Web) <noreply@openai.com>",
    "Co-authored-by: ChatGPT 6 <noreply@openai.com>",
    "Co-authored-by: Codex (Web) <noreply@openai.com>",
  ].join("\n");
  const formatted = squashBody(body);
  assert.equal(formatted, [
    "- 🐛 Fix formatting", "", "__________", "",
    "Co-authored-by: Codex (Web) <noreply@openai.com>",
    "Co-authored-by: ChatGPT 6 <noreply@openai.com>",
  ].join("\n"));
  assert.equal(squashBody(formatted), formatted);
});

test("wand applies a PR title and commit list without adding an AI co-author", () => {
  const title = { value: "Old commit title", dispatchEvent() {} };
  const body = { value: "* 🌱 Add quote file\n* ✒️ Add prompts", dispatchEvent() {} };
  context.location = { pathname: "/JFWooten4/stellar-tokenization-policy-drafting/pull/3" };
  context.document.querySelector = () => ({ textContent: "✒️ Add constituency quotations and reply-intent prompts" });
  const scope = {
    querySelector(selector) { return selector === "#merge_title_field" ? title : body; },
    querySelectorAll(selector) { return selector.includes("button")
      ? [{ textContent: "Confirm squash and merge" }] : [title, body]; },
  };
  const status = {};
  apply(scope, status);
  assert.equal(title.value, "✒️ Add constituency quotations and reply-intent prompts (#3)");
  assert.equal(body.value, "- 🌱 Add quote file\n- ✒️ Add prompts");
  assert.doesNotMatch(body.value, /Codex|Co-authored-by|__________/i);
  assert.match(status.textContent, /formatting applied/i);
});

test("reads the React PR heading when legacy title selectors are absent", () => {
  context.document.querySelector = selector => selector === "h1"
    ? { textContent: "🔩 Share signing identity - # 681" } : null;
  assert.equal(context.helpers.prTitle(681), "🔩 Share signing identity");
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


test("React merge fields use Commit message as title and Extended description as body", () => {
  const field = (label, value) => ({ value, labels: [{ textContent: label }], getAttribute() { return null; } });
  const title = field("Commit message", "Original commit (#640)");
  const body = field("Extended description", "Description and attribution");
  const scope = { querySelector() { return null; }, querySelectorAll() { return [title, body]; } };
  const result = context.helpers.mergeFields(scope);
  assert.equal(result.title, title);
  assert.equal(result.body, body);
});

test("single-commit prose and credits survive applying the exact PR title", () => {
  const description = "Show live merge progress.\n\nCo-authored-by: Codex <noreply@openai.com>";
  const title = { value: "🖌️ Show live progress (#640)", getAttribute() { return null; } };
  const body = { value: description, getAttribute() { return null; } };
  context.location = { pathname: "/pony-factor/sweetiebot-SCM/pull/640" };
  context.document.querySelector = () => ({ textContent: "🖌️ Show live progress" });
  const scope = {
    querySelector(selector) { return selector === "#merge_title_field" ? title : body; },
    querySelectorAll(selector) { return selector.includes("button")
      ? [{ textContent: "Confirm squash and merge" }] : [title, body]; },
  };
  const status = {};
  context.helpers.apply(scope, status);
  assert.equal(body.value, description);
  assert.match(status.textContent, /Description preserved/);
});
