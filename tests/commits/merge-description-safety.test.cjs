const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function mount(feature, pathname, action, mergeIds = false) {
  class Element {}
  class Form extends Element {
    querySelectorAll(selector) {
      if (selector.includes("button")) return [{ textContent: action }];
      if (selector.includes("textarea")) return [title, description];
      return [];
    }
  }
  class Input extends Element {
    constructor(id, name, value) {
      super();
      this.id = id;
      this.name = name;
      this.value = value;
      this.type = "text";
      this.labels = [];
      this.attributes = new Set();
      this.listeners = new Map();
    }
    getAttribute(name) { return name === "name" ? this.name : null; }
    closest(selector) {
      if (selector === "#merge_pull_request_form") return mergeIds ? form : null;
      return form;
    }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name) { this.attributes.add(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    dispatchEvent(event) {
      for (const listener of this.listeners.get(event.type) || []) listener(event);
    }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
  }
  class Textarea extends Input {}
  const form = new Form();
  const title = new Input(mergeIds ? "merge_title_field" : "commit_title", "commit title", "Update code");
  const description = new Textarea(mergeIds ? "merge_message_field" : "commit_description",
    "commit description", "- Fix review panel\n- Preserve commit history\n\nCo-authored-by: Developer <dev@example.com>");

  const source = fs.readFileSync(path.join(__dirname, "../../features/commits", feature), "utf8");
  const exports = feature === "message-simplifier.js"
    ? "isTitle, isBody, scan, prepare, beforeSubmit, activate: () => { enabled = true; }"
    : "isCommitTitleField, prefixField, bindField, scan, activate: () => { enabled = true; }";
  const context = vm.createContext({
    Element, HTMLFormElement: Form, HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
    Document: class {}, DocumentFragment: class {}, Event: class { constructor(type) { this.type = type; } },
    document: { addEventListener() {}, removeEventListener() {}, querySelectorAll() { return []; } },
    window: { location: { pathname }, addEventListener() {}, removeEventListener() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame(callback) { callback(); },
    chrome: { storage: { onChanged: { addListener() {} }, local: { get: async defaults => defaults } } },
  });
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, "globalThis.testHelpers = { " + exports + " };\n})();"), context);
  return { title, description, form, ...context.testHelpers };
}

test("squash merge messages and titles survive commit simplification without other settings", () => {
  const page = mount("message-simplifier.js", "/owner/repo/pull/27", "Confirm squash and merge", true);
  const originalTitle = page.title.value;
  const originalDescription = page.description.value;
  page.activate();
  page.scan(page.form);
  assert.equal(page.isTitle(page.title), false);
  assert.equal(page.isBody(page.description), false);
  page.beforeSubmit({ target: page.form });
  assert.equal(page.title.value, originalTitle);
  assert.equal(page.description.value, originalDescription);
});

test("merge actions protect messages even without GitHub's old merge field ids", () => {
  for (const action of ["Confirm squash and merge", "Confirm rebase", "Merge pull request"]) {
    const page = mount("message-simplifier.js", "/owner/repo/pull/27", action);
    const originalDescription = page.description.value;
    page.activate();
    page.prepare(page.form);
    assert.equal(page.description.value, originalDescription, action);
  }
});

test("ordinary commit descriptions clear when the editor opens, not on submission", () => {
  const page = mount("message-simplifier.js", "/owner/repo/edit/main/file.js", "Commit changes");
  page.activate();
  page.scan(page.form);
  assert.equal(page.description.value, "");
  page.description.value = "Additional implementation details";
  page.description.dispatchEvent({ type: "input" });
  page.scan(page.form);
  page.beforeSubmit({ target: page.form });
  assert.equal(page.description.value, "Additional implementation details");
});

test("late generated descriptions clear before edits, but user text is preserved", () => {
  const page = mount("message-simplifier.js", "/owner/repo/edit/main/file.js", "Commit changes");
  page.activate();
  page.description.value = "";
  page.scan(page.form);
  page.description.value = "Automatically generated explanation";
  page.scan(page.form);
  assert.equal(page.description.value, "");
  page.description.value = "My additional information";
  page.description.dispatchEvent({ type: "input" });
  page.scan(page.form);
  assert.equal(page.description.value, "My additional information");
  page.beforeSubmit({ target: page.form });
  assert.equal(page.description.value, "My additional information");
});

test("disabled commit simplification does not clear descriptions", () => {
  const page = mount("message-simplifier.js", "/owner/repo/edit/main/file.js", "Commit changes");
  const original = page.description.value;
  page.scan(page.form);
  page.beforeSubmit({ target: page.form });
  assert.equal(page.description.value, original);
});

test("commit emoji prefixing does not rewrite PR merge titles", () => {
  const page = mount("title-emojis.js", "/owner/repo/pull/27", "Confirm squash and merge", true);
  const originalTitle = page.title.value;
  page.activate();
  assert.equal(page.isCommitTitleField(page.title), false);
  page.prefixField(page.title);
  assert.equal(page.title.value, originalTitle);
});

test("ordinary commit titles still receive the emoji prefix", () => {
  const page = mount("title-emojis.js", "/owner/repo/edit/main/file.js", "Commit changes");
  page.activate();
  assert.equal(page.isCommitTitleField(page.title), true);
  page.prefixField(page.title);
  assert.match(page.title.value, /Update code$/);
  assert.notEqual(page.title.value, "Update code");
});

test("SweetieBot-formatted merge summaries and co-author dividers are not cleared", () => {
  const page = mount("message-simplifier.js", "/owner/repo/pull/27", "Confirm squash and merge", true);
  const formatted = [
    "- 🐛 Fix review panel",
    "    Retain commit details and attribution.",
    "- 🧪 Test additional cases",
    "",
    "__________",
    "",
    "Co-authored-by: Developer <dev@example.com>",
    "Co-authored-by: Codex (Web) <noreply@openai.com>",
  ].join("\n");
  page.description.value = formatted;
  page.activate();
  page.prepare(page.form);
  assert.equal(page.description.value, formatted);
});


test("emoji suggestions run once and leave later edits alone", () => {
  const page = mount("title-emojis.js", "/owner/repo/edit/main/file.js", "Commit changes");
  page.activate();
  page.bindField(page.title);
  assert.equal(page.title.value, "🔧 Update code");
  for (const value of ["Update code", "", "🔧", "🎨 My title", "A replacement title"]) {
    page.title.value = value;
    for (const type of ["input", "change", "blur"]) page.title.dispatchEvent({ type });
    page.scan(page.form);
    page.prefixField(page.title);
    assert.equal(page.title.value, value);
  }
});

test("empty editors wait for the first input and preserve the caret", () => {
  const page = mount("title-emojis.js", "/owner/repo/edit/main/file.js", "Commit changes");
  page.activate();
  page.title.value = "";
  page.bindField(page.title);
  assert.equal(page.title.value, "");
  page.title.value = "A";
  page.title.selectionStart = 1;
  page.title.selectionEnd = 1;
  page.title.selectionDirection = "none";
  page.title.setSelectionRange = (start, end, direction) => {
    assert.deepEqual([start, end, direction], [4, 4, "none"]);
  };
  page.title.dispatchEvent({ type: "input" });
  assert.equal(page.title.value, "🔧 A");
  page.scan(page.form);
  assert.equal(page.title.value, "🔧 A");
});

test("existing emoji including bare emoji are never duplicated or restored", () => {
  for (const value of ["🔧", "🕷️ Fix code", "👩‍💻 Code", "🇺🇸 Title", "1️⃣ Title"]) {
    const page = mount("title-emojis.js", "/owner/repo/edit/main/file.js", "Commit changes");
    page.activate();
    page.title.value = value;
    page.bindField(page.title);
    assert.equal(page.title.value, value);
    page.title.value = "";
    page.scan(page.form);
    page.title.value = "My title";
    page.title.dispatchEvent({ type: "input" });
    assert.equal(page.title.value, "My title");
  }
});

test("late initial titles receive one suggestion without replacing their wording", () => {
  const page = mount("title-emojis.js", "/owner/repo/edit/main/file.js", "Commit changes");
  page.activate();
  page.title.value = "";
  page.bindField(page.title);
  page.title.value = "Sync branch with main";
  page.scan(page.form);
  assert.equal(page.title.value, "🔄 Sync branch with main");
  page.title.value = "Sync my branch";
  page.scan(page.form);
  assert.equal(page.title.value, "Sync my branch");
});

test("composition completes before the first emoji is suggested", () => {
  const page = mount("title-emojis.js", "/owner/repo/edit/main/file.js", "Commit changes");
  page.activate();
  page.title.value = "";
  page.bindField(page.title);
  page.title.value = "入力";
  page.title.dispatchEvent({ type: "input", isComposing: true });
  page.scan(page.form);
  assert.equal(page.title.value, "入力");
  page.title.dispatchEvent({ type: "compositionend" });
  assert.equal(page.title.value, "🔧 入力");
});


test("reentrant input events cannot insert a second prefix", () => {
  const page = mount("title-emojis.js", "/owner/repo/edit/main/file.js", "Commit changes");
  page.activate();
  page.title.value = "";
  page.bindField(page.title);
  page.title.addEventListener("input", () => page.scan(page.form));
  page.title.value = "Update code";
  page.title.dispatchEvent({ type: "input" });
  assert.equal(page.title.value, "🔧 Update code");
});


test("PR descriptions survive before merge controls hydrate and on commit subpages", () => {
  for (const route of ["/owner/repo/pull/640", "/owner/repo/pull/640/commits"]) {
    for (const action of ["", "Commit changes", "Confirm merge"]) {
      const page = mount("message-simplifier.js", route, action);
      const original = page.description.value;
      const title = page.title.value;
      page.activate();
      page.scan(page.form);
      page.beforeSubmit({ target: page.form });
      assert.equal(page.description.value, original);
      assert.equal(page.title.value, title);
      const emojis = mount("title-emojis.js", route, action);
      emojis.activate();
      emojis.scan(emojis.form);
      assert.equal(emojis.title.value, title);
    }
  }
});

test("unknown commit editors retain descriptions while ordinary file editors still clear", () => {
  for (const route of ["/owner/repo/compare/main...branch", "/owner/repo/commit/abc123"]) {
    const page = mount("message-simplifier.js", route, "Commit changes");
    const original = page.description.value;
    page.activate();
    page.scan(page.form);
    assert.equal(page.description.value, original);
  }
});
