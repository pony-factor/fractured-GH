const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.join(__dirname, "../../features/pony-headings.css"),
  "utf8",
);

function ruleAfter(comment) {
  const section = css.split(comment)[1]?.split("}")[0];
  assert.ok(section, "expected the documented typography rule");
  const [selectors, declarations] = section.split("{");
  assert.ok(declarations, "expected CSS declarations");
  return { selectors, declarations };
}

test("issue-opening metadata uses Celestia on both GitHub issue layouts", () => {
  const { selectors, declarations } = ruleAfter("/* Give the issue opener's author");
  assert.match(selectors, /\.gh-header-meta/);
  assert.match(selectors, /\[class\*="IssueBodyHeader-module__IssueBodyHeaderContainer"\]/);
  assert.match(selectors, /relative-time/);
  assert.match(selectors, /time-ago/);
  assert.match(declarations, /font-family:\s*"Celestia Medium Redux"[^;]*!important/);
  assert.doesNotMatch(declarations, /\b(?:font-size|line-height|padding|border|color):/);
});

test("member and contributor role pills inherit the font on legacy and modern comments", () => {
  const { selectors, declarations } = ruleAfter("/* Style author-association pills");
  for (const marker of [
    ".timeline-comment-label",
    '[data-testid="comment-author-association"]',
    '[class*="ActivityHeader-module__BadgesGroupContainer"] [data-component="Label"]',
    '[class*="IssueBodyHeader-module__badgeGroup"] [data-component="Label"]',
  ]) {
    assert.ok(selectors.includes(marker), "missing role badge selector: " + marker);
  }
  assert.match(declarations, /font-family:\s*"Celestia Medium Redux"[^;]*!important/);
  assert.doesNotMatch(declarations, /\b(?:font-size|line-height|padding|border|color):/);
  assert.doesNotMatch(selectors, /(?:\.markdown-body|\bLabel--)/);
});
