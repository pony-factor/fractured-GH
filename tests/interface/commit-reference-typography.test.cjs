const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../../features/interface/commit-reference-typography.js"), "utf8"
);

function link(href, textContent) {
  const attributes = new Map([["href", href]]);
  return {
    nodeType: 1,
    textContent,
    getAttribute(name) { return attributes.get(name) ?? null; },
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    closest(selector) { return selector === "a[href]" ? this : null; },
    querySelectorAll() { return []; },
  };
}

function setup(links = []) {
  let onMutation;
  const document = {
    nodeType: 9,
    querySelectorAll(selector) { return selector === "a[href]" ? links : []; },
  };
  vm.runInNewContext(source, {
    document,
    location: {
      href: "https://github.com/owner/repo/pull/123",
      origin: "https://github.com",
    },
    URL,
    Node: { TEXT_NODE: 3 },
    MutationObserver: class {
      constructor(callback) { onMutation = callback; }
      observe() {}
    },
  });
  return {
    mutate(records) { onMutation(records); },
  };
}

test("identifies same-origin commit hashes without marking other links", () => {
  const commit = link("/owner/repo/commit/abcdef0123456789", "abcdef0");
  const external = link("https://example.com/commit/abcdef0123456789", "abcdef0");
  const mismatch = link("/owner/repo/commit/abcdef0123456789", "1234567");
  setup([commit, external, mismatch]);
  assert.equal(commit.hasAttribute("data-fractured-commit-reference"), true);
  assert.equal(external.hasAttribute("data-fractured-commit-reference"), false);
  assert.equal(mismatch.hasAttribute("data-fractured-commit-reference"), false);
});

test("ignores missing mutation targets, null additions, and detached text nodes", () => {
  const app = setup();
  const unrelated = { nodeType: 1, closest() { return null; } };
  assert.doesNotThrow(() => app.mutate([
    { type: "childList", target: unrelated, addedNodes: [null] },
    { type: "childList", target: null, addedNodes: [] },
    { type: "childList", target: unrelated,
      addedNodes: [{ nodeType: 3, parentElement: null }] },
    { type: "characterData", target: { nodeType: 3, parentElement: null } },
  ]));
});

test("refreshes commit classification after text and descendant mutations", () => {
  const commit = link("/owner/repo/commits/abcdef0123456789", "abcdef0");
  const app = setup([commit]);
  assert.equal(commit.hasAttribute("data-fractured-commit-reference"), true);

  commit.textContent = "not a hash";
  app.mutate([{ type: "characterData", target: { nodeType: 3, parentElement: commit } }]);
  assert.equal(commit.hasAttribute("data-fractured-commit-reference"), false);

  commit.textContent = "abcdef0";
  app.mutate([{ type: "childList",
    target: { nodeType: 1, closest() { return commit; } }, addedNodes: [] }]);
  assert.equal(commit.hasAttribute("data-fractured-commit-reference"), true);
});
