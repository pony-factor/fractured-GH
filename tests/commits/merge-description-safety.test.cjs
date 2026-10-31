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
    }
    getAttribute(name) { return name === "name" ? this.name : null; }
    closest(selector) {
      if (selector === "#merge_pull_request_form") return mergeIds ? form : null;
      return form;
    }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name) { this.attributes.add(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    dispatchEvent() {}
    addEventListener() {}
  }
  class Textarea extends Input {}
  const form = new Form();
  const title = new Input(mergeIds ? "merge_title_field" : "commit_title", "commit title", "Update code");
  const description = new Textarea(mergeIds ? "merge_message_field" : "commit_description",
    "commit description", "- Fix review panel\n- Preserve commit history\n\nCo-authored-by: Developer <dev@example.com>");

  const source = fs.readFileSync(path.join(__dirname, "../../features/commits", feature), "utf8");
  const exports = feature === "message-simplifier.js"
    ? "isTitle, isBody, prepare, beforeSubmit, activate: () => { enabled = true; }"
    : "isCommitTitleField, prefixField, activate: () => { enabled = true; }";
  const context = vm.createContext({
    Element, HTMLFormElement: Form, HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
    Document: class {}, DocumentFragment: class {}, Event: class {},
    document: { addEventListener() {}, removeEventListener() {}, querySelectorAll() { return []; } },
    window: { location: { pathname }, addEventListener() {}, removeEventListener() {} },
    MutationObserver: class { observe() {} disconnect() {} },
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

test("ordinary commit descriptions still clear when simplification is enabled", () => {
  const page = mount("message-simplifier.js", "/owner/repo/edit/main/file.js", "Commit changes");
  page.activate();
  page.beforeSubmit({ target: page.form });
  assert.equal(page.description.value, "");
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
