(() => {
  'use strict';

  // One durable cache for profile hovers, the profile page, and name promotion.
  // A name can change on GitHub, so entries expire after thirty days.
  const CACHE_PREFIX = 'fractured-profile-name-v1:';
  const CACHE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
  const PROFILE_NAME_SELECTOR = '[itemprop="name"], [data-testid="profile-name"], .p-name';
  const memory = new Map();
  const inFlight = new Map();

  function normalizeUsername(value) {
    const username = String(value || '').trim();
    return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)
      ? username.toLowerCase()
      : '';
  }

  function cleanName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  async function fetchDisplayName(username) {
    const response = await fetch('/' + encodeURIComponent(username), {
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) return '';

    const profile = new DOMParser().parseFromString(await response.text(), 'text/html');
    const name = cleanName(profile.querySelector(PROFILE_NAME_SELECTOR)?.textContent);
    if (name) return name;

    // Some profile layouts only expose the name in the page title.
    const title = cleanName(profile.querySelector('title')?.textContent);
    const match = title.match(/^(.+?)\s+\(@?([a-z\d-]+)\)\s+·\s+GitHub$/i);
    return match && match[2].toLowerCase() === username ? cleanName(match[1]) : '';
  }

  async function readOrFetch(username, key) {
    // Read the saved name before fetching the profile again, including after
    // navigating to another page, opening a new tab, or restarting the browser.
    try {
      const record = (await chrome.storage.local.get(key))[key];
      if (record && typeof record.name === 'string' && record.name
        && Number.isFinite(record.expiresAt) && record.expiresAt > Date.now()) {
        memory.set(key, record);
        return record.name;
      }
    } catch {
      // Storage errors should not prevent the usual GitHub profile lookup.
    }

    let name = '';
    try {
      name = await fetchDisplayName(username);
    } catch {
      // Do not persist failed or empty lookups: they should be retried.
    }
    if (!name) return '';

    const record = { name, expiresAt: Date.now() + CACHE_LIFETIME_MS };
    memory.set(key, record);
    try {
      await chrome.storage.local.set({ [key]: record });
    } catch {
      // Keep the result usable for this page if extension storage is unavailable.
    }
    return name;
  }

  function getDisplayName(username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return Promise.resolve('');
    const key = CACHE_PREFIX + normalized;
    const cached = memory.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.name);

    const existing = inFlight.get(key);
    if (existing) return existing;

    const pending = readOrFetch(normalized, key).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  }

  globalThis.FracturedProfileNameCache = Object.freeze({ getDisplayName });
})();
