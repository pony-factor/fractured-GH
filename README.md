# Fractured GitHub

Fractured GitHub is a browser extension that customizes GitHub's interface, notifications, repositories, pull requests, and writing tools. Configure its features from the extension's settings page.

## Development

The extension uses Manifest V3. Load this repository as an unpacked extension in a Chromium-based browser, then open **Fractured GitHub** from the extensions menu to manage settings.

Run the automated tests from the repository root with `node --test`. Content scripts are organized by feature under `features/`, with corresponding tests under `tests/`.

## Continuous integration

Pull requests and pushes to `main` run unit tests on Node 22 and 24, JavaScript lint and syntax checks, GitHub Actions workflow validation, and extension manifest and asset validation. The workflow builds an extension ZIP, then loads that exact artifact in Chromium to check settings navigation, saved preferences across reloads, and live updates to a GitHub page. Browser checks use a local GitHub fixture and a temporary profile; no account is required. The workflow can also be run manually from GitHub Actions.

To run the browser checks locally:

```sh
npm install --no-save --no-package-lock playwright@1.56.1
npx playwright install chromium
node scripts/smoke-extension.mjs
```

Set `EXTENSION_PATH` to an extracted extension ZIP directory to test a packaged build. Otherwise, the smoke test loads the current checkout.
