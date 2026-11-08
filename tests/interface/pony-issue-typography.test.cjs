const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.join(__dirname, "../../features/pony-headings.css"),
  "utf8",
);

function rulesAfter(comment) {
  const section = css.split(comment)[1]?.split("\n/* ")[0];
  assert.ok(section, "expected the documented typography section");
  const declarations = [...section.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  assert.equal(declarations.length, 1, "expected one rule in this section");
  return { selectors: section.split("{")[0], declarations: declarations[0] };
}

test("issue-opening metadata uses Celestia across CSS-module header variants", () => {
  const { selectors, declarations } = rulesAfter("/* Give the issue opener's author");
  for (const marker of [
    ".gh-header-meta",
    '[class^="IssueBodyHeader"]',
    '[class*=" IssueBodyHeader"]',
    '[data-testid="issue-body-header"]',
    '[data-testid="issue-body-header-author"]',
    "relative-time",
    "time-ago",
  ]) {
    assert.ok(selectors.includes(marker), "missing issue opener selector: " + marker);
  }
  assert.match(declarations, /font-family:\s*"Celestia Medium Redux"[^;]*!important/);
  assert.doesNotMatch(declarations, /\b(?:font-size|line-height|padding|border|color):/);
});

test("Member and Contributor role pills apply the font to nested badge text", () => {
  const { selectors, declarations } = rulesAfter("/* Style author-association pills");
  for (const marker of [
    ".timeline-comment-label",
    '[data-testid="comment-author-association"]',
    '[data-testid="issue-author-association"]',
    '.tooltipped[aria-label^="This user is a member"]',
    '.tooltipped[aria-label^="This user has previously committed"]',
    '[class*="ActivityHeader-module__BadgesGroupContainer"] [data-component="Label"]',
    '[class*="IssueBodyHeader-module__badgeGroup"] [data-component="Label"]',
    ") :is(span, strong, a)",
  ]) {
    assert.ok(selectors.includes(marker), "missing role badge selector: " + marker);
  }
  assert.match(declarations, /font-family:\s*"Celestia Medium Redux"[^;]*!important/);
  assert.doesNotMatch(declarations, /\b(?:font-size|line-height|padding|border|color):/);
  assert.doesNotMatch(selectors, /(?:\.markdown-body|comment-subject-author|^\s*\[data-component="Label"\])/);
});
