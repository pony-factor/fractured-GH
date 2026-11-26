import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "playwright/test";

const extensionPath = process.env.EXTENSION_PATH
  ? resolve(process.env.EXTENSION_PATH)
  : resolve(import.meta.dirname, "..");
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
  const pageErrors = [];
  context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.stack)));
  options.on("pageerror", (error) => pageErrors.push(error.stack));
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole("heading", { name: "Fractured GitHub" }).waitFor();
  await options.getByRole("tab", { name: "Repositories" }).click();
  assert.equal(await options.locator("#settings-panel-repositories").isVisible(), true);
  assert.equal(await options.locator("#settings-panel-general").isVisible(), false);

  const github = await context.newPage();
  let busy = false;
  await github.route("https://github.com/users/status?*", (route) => route.fulfill({
    contentType: "text/html",
    body: `<input type="checkbox" name="limited_availability"${busy ? " checked" : ""}>`,
  }));
  await github.route("https://github.com/notifications?*", (route) => route.fulfill({
    contentType: "text/html",
    body: '<div class="notifications-list-item"></div>',
  }));
  await worker.evaluate(() => chrome.storage.local.set({
    organizationNotificationInboxesEnabled: true,
    notificationOrganizations: ["acme", "example"],
  }));
  await github.route("https://github.com/fractured-ci-smoke", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html><head><title>CI fixture</title></head><body>
      <header class="AppHeader" role="banner">
        <a id="AppHeader-notifications-button" href="/notifications">Inbox</a>
      </header>
      <main>GitHub fixture <a href="/copilot">Copilot</a></main>
    </body></html>`,
  }));
  await github.goto("https://github.com/fractured-ci-smoke");
  await github.waitForSelector("#fractured-github-hide-copilot-style", {
    state: "attached",
    timeout: 15000,
  });
  const copilot = github.getByRole("link", { name: "Copilot", includeHidden: true });
  await expect(copilot).toBeHidden();

  const inboxes = [
    github.locator("#AppHeader-notifications-button"),
    github.locator('[data-fractured-github-organization-notification="acme"]'),
    github.locator('[data-fractured-github-organization-notification="example"]'),
  ];
  for (const inbox of inboxes) await expect(inbox).toHaveCSS("display", "none");
  await expect.poll(() => github.evaluate(() => localStorage.getItem("fractured-github-busy"))).toBe("false");

  const popupPath = await worker.evaluate(() => chrome.action.getPopup({}));
  assert.equal(popupPath, `chrome-extension://${extensionId}/popup.html`);
  const popup = await context.newPage();
  await popup.goto(popupPath);
  const showInboxes = popup.getByRole("checkbox", { name: "Show inboxes", exact: true });
  await expect(popup.getByRole("checkbox")).toHaveCount(1);
  await expect(showInboxes).not.toBeChecked();
  const startedAt = Date.now();
  await showInboxes.check();
  for (const inbox of inboxes) await expect(inbox).toBeVisible();
  const { inboxesVisibleUntil } = await worker.evaluate(() => chrome.storage.local.get("inboxesVisibleUntil"));
  const eightHours = 8 * 60 * 60 * 1000;
  assert.ok(inboxesVisibleUntil >= startedAt + eightHours && inboxesVisibleUntil <= Date.now() + eightHours);

  busy = true;
  await github.evaluate(() => window.dispatchEvent(new Event("focus")));
  for (const inbox of inboxes) await expect(inbox).toHaveCSS("display", "none");
  busy = false;
  await github.evaluate(() => window.dispatchEvent(new Event("focus")));
  for (const inbox of inboxes) await expect(inbox).toBeVisible();

  await worker.evaluate(() => chrome.storage.local.set({ hideInboxWhileBusy: false }));
  await github.reload();
  for (const inbox of inboxes) await expect(inbox).toBeVisible();

  await popup.reload();
  await expect(showInboxes).toBeChecked();
  await showInboxes.uncheck();
  for (const inbox of inboxes) await expect(inbox).toHaveCSS("display", "none");
  await showInboxes.check();
  for (const inbox of inboxes) await expect(inbox).toBeVisible();
  await worker.evaluate(() => chrome.storage.local.set({ inboxesVisibleUntil: Date.now() + 1000 }));
  for (const inbox of inboxes) await expect(inbox).toHaveCSS("display", "none");
  await expect(showInboxes).not.toBeChecked();
  await github.reload();
  for (const inbox of inboxes) await expect(inbox).toHaveCSS("display", "none");

  // Exercise the settings UI and real chrome.storage change propagation.
  await options.getByRole("tab", { name: "Copilot", exact: true }).click();
  const hideCopilot = options.locator("#hide-copilot");
  await expect(hideCopilot).toBeChecked();
  await hideCopilot.uncheck();
  await expect(copilot).toBeVisible();
  await options.reload();
  await expect(hideCopilot).not.toBeChecked();
  await github.reload();
  await expect(copilot).toBeVisible();
  await hideCopilot.check();
  await expect(copilot).toBeHidden();
  await options.reload();
  await expect(hideCopilot).toBeChecked();
  await options.close();
  const openedOptions = context.waitForEvent("page");
  await popup.getByRole("button", { name: "Full settings" }).click();
  await expect(await openedOptions).toHaveURL(`chrome-extension://${extensionId}/options.html`);
  assert.deepEqual(pageErrors, [], "Extension pages and content scripts must not throw");
  console.log("Chromium verified default inbox hiding, the eight-hour window and expiry, Busy status, and settings persistence.");
} finally {
  await context?.close();
  rmSync(profilePath, { recursive: true, force: true });
}
