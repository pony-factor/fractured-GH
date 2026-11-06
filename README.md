# Fractured GitHub

Fractured GitHub is a browser extension that customizes GitHub's interface, notifications, repositories, pull requests, and writing tools. Configure its features from the extension's settings page.

## Development

The extension uses Manifest V3. Load this repository as an unpacked extension in a Chromium-based browser, then open **Fractured GitHub** from the extensions menu to manage settings.

Run the automated tests from the repository root with `node --test`. Content scripts are organized by feature under `features/`, with corresponding tests under `tests/`.
