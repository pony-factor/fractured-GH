(() => {
  'use strict';

  const PENDING_KEY = 'fractured:new-fork-setup-pending';
  const RESULT_KEY = 'fractured:new-fork-setup-result';
  const EXPIRY_MS = 20 * 60 * 1000;
  const clearedFields = new WeakSet();
  let enabled = false;
  let busy = false;

  function forkSource(pathname) {
    const match = /^\/([^/]+)\/([^/]+)\/fork\/?$/.exec(pathname);
    return match ? (match[1] + '/' + match[2]) : null;
  }

  function repositoryRoot(pathname) {
    const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
    return match ? (match[1] + '/' + match[2]) : null;
  }

  function matchesNewFork(repository, source, now = Date.now()) {
    const age = now - Date.parse(repository?.created_at);
    return repository?.fork === true
      && typeof repository?.parent?.full_name === 'string'
      && repository.parent.full_name.toLowerCase() === source.toLowerCase()
      && Number.isFinite(age) && age >= -120000 && age <= EXPIRY_MS;
  }

  function normalizedText(element) {
    return (element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function labelMatches(element, text) {
    const label = normalizedText(element).toLowerCase();
    const expected = text.toLowerCase();
    return label === expected || label.startsWith(expected + ' ');
  }

  // Export the pure guards without starting browser automation in Node tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { forkSource, repositoryRoot, matchesNewFork, labelMatches };
    return;
  }

  function readJSON(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key) || 'null');
    } catch {
      sessionStorage.removeItem(key);
      return null;
    }
  }

  function readPending() {
    const item = readJSON(PENDING_KEY);
    if (!item || !Number.isFinite(item.createdAt)
      || Date.now() - item.createdAt > EXPIRY_MS
      || item.createdAt - Date.now() > 120000) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return item;
  }

  function savePending(item) {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(item));
  }

  function recordForkIntent() {
    const source = forkSource(location.pathname);
    if (!enabled || !source) return;
    savePending({ source, createdAt: Date.now(), stage: 'landing', warnings: [] });
  }

  function clearForkDescription() {
    if (!enabled || !forkSource(location.pathname)) return;
    for (const field of document.querySelectorAll(
      'input[name*="description" i], textarea[name*="description" i]',
    )) {
      if (clearedFields.has(field)) continue;
      clearedFields.add(field);
      if (!field.value) continue;
      field.value = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function handleForkSubmit(event) {
    if (!forkSource(location.pathname)) return;
    if (event.target?.tagName?.toLowerCase() === 'form') recordForkIntent();
  }

  function handleForkClick(event) {
    if (!forkSource(location.pathname)) return;
    const button = event.target?.closest?.('button, input[type="submit"]');
    if (button && /^(create fork|create repository)$/i.test(
      (button.textContent || button.value || '').trim(),
    )) recordForkIntent();
  }

  function findCheckbox(container, label, names = []) {
    for (const name of names) {
      const field = container.querySelector('input[name="' + name + '"]');
      if (field?.type === 'checkbox') return field;
    }
    for (const candidate of container.querySelectorAll('label')) {
      if (!labelMatches(candidate, label)) continue;
      const field = candidate.control
        || candidate.querySelector('input[type="checkbox"], [role="checkbox"]')
        || (candidate.htmlFor && document.getElementById(candidate.htmlFor));
      if (field && (field.type === 'checkbox' || field.getAttribute('role') === 'checkbox')) {
        return field;
      }
    }
    return null;
  }

  function isChecked(field) {
    return field.type === 'checkbox'
      ? field.checked
      : field.getAttribute('aria-checked') === 'true';
  }

  function setCheckbox(field, checked) {
    if (!field || field.disabled || field.getAttribute('aria-disabled') === 'true') return false;
    if (isChecked(field) !== checked) field.click();
    return true;
  }

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function waitFor(find, timeout = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = find();
      if (found) return found;
      await pause(125);
    }
    return null;
  }

  function findAboutEditButton() {
    const explicit = [...document.querySelectorAll('button, a, [role="button"]')]
      .find(element => /edit repository details/i.test(
        (element.getAttribute('aria-label') || '') + ' '
        + (element.getAttribute('title') || ''),
      ));
    if (explicit) return explicit;

    const heading = [...document.querySelectorAll('h2, h3')].find(element =>
      normalizedText(element) === 'About');
    const section = heading?.closest('aside, section, [class*="SidebarAbout"]')
      || heading?.parentElement?.parentElement;
    return section?.querySelector('button[aria-label*="Edit"], button[title*="Edit"]') || null;
  }

  async function configureAbout(warnings) {
    const editButton = await waitFor(findAboutEditButton);
    if (!editButton) {
      warnings.push('About editor not found');
      return;
    }
    editButton.click();
    const dialog = await waitFor(() => [...document.querySelectorAll(
      '[role="dialog"], dialog[open], [aria-modal="true"]',
    )].find(node => /releases|packages/i.test(normalizedText(node))));
    if (!dialog) {
      warnings.push('About dialog did not open');
      return;
    }

    const description = dialog.querySelector(
      'textarea[name*="description" i], input[name*="description" i], #repository_description',
    );
    const releases = findCheckbox(dialog, 'Releases');
    const packages = findCheckbox(dialog, 'Packages');
    const saveButton = [...dialog.querySelectorAll('button, input[type="submit"]')]
      .find(node => /^save changes$/i.test((node.textContent || node.value || '').trim()));

    if (!saveButton) {
      warnings.push('About save button not found');
      return;
    }
    if (!description) warnings.push('Description field not found');
    if (!releases) warnings.push('Releases checkbox not found');
    if (!packages) warnings.push('Packages checkbox not found');
    if (description) {
      description.value = '';
      description.dispatchEvent(new Event('input', { bubbles: true }));
      description.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (releases) setCheckbox(releases, false);
    if (packages) setCheckbox(packages, false);
    saveButton.click();
    await pause(1500);
  }

  async function configureGeneralSettings(warnings) {
    const targets = [
      { label: 'Projects', names: ['repository[has_projects]', 'has_projects'], checked: false },
      { label: 'Wikis', names: ['repository[has_wiki]', 'has_wiki'], checked: false },
      {
        label: 'Automatically delete head branches',
        names: ['repository[delete_branch_on_merge]', 'delete_branch_on_merge'],
        checked: true,
      },
    ];

    for (const target of targets) {
      const field = await waitFor(() => findCheckbox(document, target.label, target.names), 4000);
      if (!field) {
        warnings.push(target.label + ' setting not found');
        continue;
      }
      if (!setCheckbox(field, target.checked)) {
        warnings.push(target.label + ' setting is unavailable');
      }
      // GitHub autosaves its General settings toggles; allow each request to settle
      // before changing another checkbox or leaving the page.
      await pause(900);
    }
    await pause(1200);
  }

  async function verifyGeneralSettings(repository, warnings) {
    try {
      const response = await fetch(
        'https://api.github.com/repos/' + repository.split('/').map(encodeURIComponent).join('/'),
        {
          credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'application/vnd.github+json' },
        },
      );
      if (!response.ok) {
        warnings.push('Could not verify saved repository settings');
        return;
      }
      const settings = await response.json();
      const expected = [
        ['Projects', 'has_projects', false],
        ['Wikis', 'has_wiki', false],
        ['Automatic branch deletion', 'delete_branch_on_merge', true],
      ];
      for (const [label, field, value] of expected) {
        if (settings[field] !== value) warnings.push(label + ' did not persist');
      }
      if (settings.description !== null && settings.description !== '') {
        warnings.push('Description did not clear');
      }
    } catch {
      warnings.push('Could not verify saved repository settings');
    }
  }

  function finish(item, repository) {
    sessionStorage.removeItem(PENDING_KEY);
    sessionStorage.setItem(RESULT_KEY, JSON.stringify({
      repository, warnings: item.warnings, finishedAt: Date.now(),
    }));
    location.assign('/' + repository);
  }

  function showResult(repository) {
    const result = readJSON(RESULT_KEY);
    if (result?.repository !== repository) return;
    sessionStorage.removeItem(RESULT_KEY);
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;'
      + 'max-width:360px;padding:14px 18px;border:1px solid #8b949e;'
      + 'border-radius:8px;background:Canvas;color:CanvasText;'
      + 'box-shadow:0 5px 25px #0003;font:14px system-ui;';
    const message = document.createElement('span');
    message.textContent = result.warnings.length
      ? 'Fractured attempted your fork setup. Check: ' + result.warnings.join('; ') + '.'
      : 'Fractured submitted your fork preferences. Review Settings to confirm they saved.';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.style.marginLeft = '10px';
    dismiss.addEventListener('click', () => notice.remove());
    notice.append(message, dismiss);
    (document.body || document.documentElement).append(notice);
  }

  async function validateFork(repository, source) {
    try {
      const response = await fetch(
        'https://api.github.com/repos/' + repository.split('/').map(encodeURIComponent).join('/'),
        { credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } },
      );
      if (!response.ok) return false;
      return matchesNewFork(await response.json(), source);
    } catch {
      return false;
    }
  }

  async function run() {
    if (!enabled || busy) return;
    const source = forkSource(location.pathname);
    if (source) {
      clearForkDescription();
      return;
    }

    const repository = repositoryRoot(location.pathname);
    const pending = readPending();
    if (!pending) {
      if (repository) showResult(repository);
      return;
    }

    if (pending.stage === 'landing' && repository) {
      busy = true;
      try {
        if (!await validateFork(repository, pending.source)) {
          // Never configure an unrelated or preexisting repository.
          sessionStorage.removeItem(PENDING_KEY);
          return;
        }
        pending.repository = repository;
        pending.stage = 'about';
        savePending(pending);
        await configureAbout(pending.warnings);
        pending.stage = 'settings';
        savePending(pending);
        location.assign('/' + repository + '/settings');
      } catch {
        pending.warnings.push('About setup encountered an error');
        pending.stage = 'settings';
        savePending(pending);
        location.assign('/' + repository + '/settings');
      } finally {
        busy = false;
      }
    } else if (pending.stage === 'about' && repository === pending.repository) {
      busy = true;
      try {
        await configureAbout(pending.warnings);
        pending.stage = 'settings';
        savePending(pending);
        location.assign('/' + repository + '/settings');
      } catch {
        pending.warnings.push('About setup encountered an error');
        pending.stage = 'settings';
        savePending(pending);
        location.assign('/' + repository + '/settings');
      } finally {
        busy = false;
      }
    } else if (pending.stage === 'settings'
      && location.pathname.replace(/\/$/, '') === '/' + pending.repository + '/settings') {
      busy = true;
      try {
        await configureGeneralSettings(pending.warnings);
        await verifyGeneralSettings(pending.repository, pending.warnings);
      } catch {
        pending.warnings.push('General settings setup encountered an error');
      } finally {
        finish(pending, pending.repository);
        busy = false;
      }
    }
  }

  async function start() {
    const settings = await chrome.storage.local.get({ autoSetupNewForks: true });
    enabled = settings.autoSetupNewForks === true;
    if (!enabled) return;

    document.addEventListener('submit', handleForkSubmit, true);
    document.addEventListener('click', handleForkClick, true);
    document.addEventListener('turbo:load', () => { void run(); });
    document.addEventListener('pjax:end', () => { void run(); });
    window.addEventListener('popstate', () => { void run(); });
    await run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void start(); }, { once: true });
  } else {
    void start();
  }
})();