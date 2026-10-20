(async () => {
  'use strict';

  const SETTING_KEY = 'relativeTimesOnly';
  const TIME_SELECTOR = [
    'relative-time[datetime]',
    'time-ago[datetime]',
    'local-time[datetime]',
    'time[datetime]',
  ].join(',');
  const PROCESSED_ATTR = 'data-gh-relative-time';
  const ORIGINAL_TEXT_ATTR = 'data-gh-relative-time-original-text';
  const ORIGINAL_TITLE_ATTR = 'data-gh-relative-time-original-title';
  const NO_TITLE_VALUE = '__none__';
  const REFRESH_INTERVAL_MS = 60_000;

  let enabled = false;
  let observer = null;
  let refreshInterval = null;

  function formatUnit(value, unit) {
    return `${value} ${unit}${value === 1 ? '' : 's'}`;
  }

  function relativePhrase(date) {
    const now = new Date();
    const differenceMs = date.getTime() - now.getTime();
    const isFuture = differenceMs > 0;
    const absoluteSeconds = Math.abs(differenceMs) / 1000;

    if (absoluteSeconds < 60) {
      return isFuture ? 'in less than a minute' : 'just now';
    }

    let phrase;

    if (absoluteSeconds < 60 * 60) {
      phrase = formatUnit(Math.max(1, Math.floor(absoluteSeconds / 60)), 'minute');
    } else if (absoluteSeconds < 24 * 60 * 60) {
      phrase = formatUnit(Math.max(1, Math.floor(absoluteSeconds / (60 * 60))), 'hour');
    } else if (absoluteSeconds < 14 * 24 * 60 * 60) {
      phrase = formatUnit(Math.max(1, Math.floor(absoluteSeconds / (24 * 60 * 60))), 'day');
    } else if (absoluteSeconds < 60 * 24 * 60 * 60) {
      phrase = formatUnit(Math.max(1, Math.floor(absoluteSeconds / (7 * 24 * 60 * 60))), 'week');
    } else if (absoluteSeconds < 365.2425 * 24 * 60 * 60) {
      phrase = formatUnit(Math.max(1, Math.floor(absoluteSeconds / (30.436875 * 24 * 60 * 60))), 'month');
    } else {
      const totalMonths = Math.max(12, Math.floor(absoluteSeconds / (30.436875 * 24 * 60 * 60)));
      const years = Math.floor(totalMonths / 12);
      const months = totalMonths % 12;
      phrase = formatUnit(years, 'year');
      if (months > 0) phrase += `, ${formatUnit(months, 'month')}`;
    }

    return isFuture ? `in ${phrase}` : `${phrase} ago`;
  }

  function rememberOriginal(element) {
    if (element.hasAttribute(PROCESSED_ATTR)) return;

    element.setAttribute(ORIGINAL_TEXT_ATTR, element.textContent ?? '');
    element.setAttribute(
      ORIGINAL_TITLE_ATTR,
      element.hasAttribute('title') ? element.getAttribute('title') : NO_TITLE_VALUE,
    );
    element.setAttribute(PROCESSED_ATTR, 'true');
  }

  function applyRelativeTime(element) {
    if (!(element instanceof Element) || !element.matches(TIME_SELECTOR)) return;

    const date = new Date(element.getAttribute('datetime'));
    if (Number.isNaN(date.getTime())) return;

    rememberOriginal(element);
    const label = relativePhrase(date);

    if (element.textContent !== label) element.textContent = label;
    if (element.shadowRoot && element.shadowRoot.textContent !== label) {
      element.shadowRoot.textContent = label;
    }
    if (document.getElementById('github-tweaks-block-tooltips-style')) {
      // Suppress native title generation before removing the title. Otherwise
      // relative-time regenerates it on every update and removal queues another
      // update, starving GitHub's loading and navigation work.
      if (element.matches('relative-time, time-ago, local-time') && !element.hasAttribute('no-title')) {
        element.setAttribute('data-github-tweaks-added-no-title', 'true');
        element.setAttribute('no-title', '');
      }
      element.setAttribute('data-github-tweaks-blocked-title', label);
      if (element.hasAttribute('title')) element.removeAttribute('title');
    } else if (element.getAttribute('title') !== label) {
      element.setAttribute('title', label);
    }
  }

  function processTree(root = document) {
    if (!enabled) return;

    if (root instanceof Element && root.matches(TIME_SELECTOR)) {
      applyRelativeTime(root);
    }

    if (root instanceof Document || root instanceof DocumentFragment || root instanceof Element) {
      for (const element of root.querySelectorAll(TIME_SELECTOR)) {
        applyRelativeTime(element);
      }
    }
  }

  function restoreOriginalTimes() {
    for (const element of document.querySelectorAll(`[${PROCESSED_ATTR}]`)) {
      element.textContent = element.getAttribute(ORIGINAL_TEXT_ATTR) ?? '';

      const originalTitle = element.getAttribute(ORIGINAL_TITLE_ATTR);
      if (originalTitle === NO_TITLE_VALUE) {
        element.removeAttribute('title');
      } else if (originalTitle !== null) {
        element.setAttribute('title', originalTitle);
      }

      element.removeAttribute(PROCESSED_ATTR);
      element.removeAttribute(ORIGINAL_TEXT_ATTR);
      element.removeAttribute(ORIGINAL_TITLE_ATTR);
    }
  }

  function ensureObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (!enabled) return;

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          applyRelativeTime(mutation.target);
          continue;
        }

        if (mutation.type === 'characterData') {
          applyRelativeTime(mutation.target.parentElement);
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node instanceof Element || node instanceof DocumentFragment) {
            processTree(node);
          }
        }
      }
    });
  }

  function start() {
    enabled = true;
    ensureObserver();
    observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['datetime'],
    });
    processTree();

    if (refreshInterval === null) {
      refreshInterval = window.setInterval(() => processTree(), REFRESH_INTERVAL_MS);
    }
  }

  function stop() {
    enabled = false;
    observer?.disconnect();

    if (refreshInterval !== null) {
      window.clearInterval(refreshInterval);
      refreshInterval = null;
    }

    restoreOriginalTimes();
  }

  function setEnabled(nextEnabled) {
    if (nextEnabled) {
      start();
    } else {
      stop();
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(SETTING_KEY in changes)) return;
    setEnabled(Boolean(changes[SETTING_KEY].newValue));
  });

  document.addEventListener('relative-time-updated', (event) => {
    if (enabled) applyRelativeTime(event.target);
  });

  document.addEventListener('turbo:load', () => processTree());
  document.addEventListener('pjax:end', () => processTree());

  const settings = await chrome.storage.local.get({ [SETTING_KEY]: false });
  setEnabled(Boolean(settings[SETTING_KEY]));
})();
