import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const extensionPath = resolve(import.meta.dirname, "..");
const profilePath = mkdtempSync(join(tmpdir(), "fractured-ci-chromium-"));
let context;

try {
  context = await chromium.launchPersistentContext(profilePath, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent("serviceworker", { timeout: 20000 });
  const extensionId = new URL(worker.url()).hostname;
  assert.match(extensionId, /^[a-p]{32}$/);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole("heading", { name: "Fractured GitHub" }).waitFor();
  await options.getByRole("tab", { name: "Repositories" }).click();
  assert.equal(await options.locator("#settings-panel-repositories").isVisible(), true);
  assert.equal(await options.locator("#settings-panel-general").isVisible(), false);

  const github = await context.newPage();
  await github.route("https://github.com/fractured-ci-smoke", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><head><title>CI fixture</title></head><body><main>GitHub fixture</main></body></html>",
  }));
  await github.goto("https://github.com/fractured-ci-smoke");
  await github.waitForSelector("#fractured-github-hide-copilot-style", {
    state: "attached",
    timeout: 15000,
  });
  console.log("Chromium loaded the extension, settings tabs, and GitHub content scripts.");
} finally {
  await context?.close();
  rmSync(profilePath, { recursive: true, force: true });
}
