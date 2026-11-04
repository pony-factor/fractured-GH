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
  const AGE_CELL_SELECTOR = [
    '.react-directory-row-age-cell',
    '[data-testid="age-cell"]',
    'tr.react-directory-row td:last-child',
    'tr.js-navigation-item td:last-child',
  ].join(', ');

  let enabled = false;
  let observer = null;
  let refreshInterval = null;
  let ageResizeObserver = null;
  let resizeFrame = null;
  let measurementContext = null;
  const observedAgeCells = new Set();

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

  // Keep verbose dates elsewhere. Repository file rows abbreviate only if
  // the complete phrase cannot fit in the available age column.
  function compactRelativeVariants(phrase) {
    if (phrase === 'just now') return ['now'];
    if (phrase === 'in less than a minute') return ['in <1m', '<1m'];

    const units = { minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'mo', year: 'y' };
    const abbreviated = phrase
      .replace(/\b(\d+) (minutes?|hours?|days?|weeks?|months?|years?)\b/g,
        (_, count, unit) => count + units[unit.replace(/s$/, '')])
      .replace(/, /g, ' ');
    const withoutDirection = abbreviated.replace(/^in /, '').replace(/ ago$/, '');
    return [...new Set([abbreviated, withoutDirection, withoutDirection.split(' ')[0]])];
  }

  function scheduleAgeRefresh() {
    if (!enabled || resizeFrame !== null) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = null;
      processTree();
    });
  }

  function fitRelativeTime(element, fullPhrase) {
    const cell = element.closest?.(AGE_CELL_SELECTOR);
    if (!cell || typeof getComputedStyle !== 'function') return fullPhrase;

    if (ageResizeObserver && !observedAgeCells.has(cell)) {
      observedAgeCells.add(cell);
      ageResizeObserver.observe(cell);
    }

    const cellWidth = cell.getBoundingClientRect?.().width || cell.clientWidth;
    if (!cellWidth) return fullPhrase;

    const cellStyle = getComputedStyle(cell);
    const horizontalPadding = (parseFloat(cellStyle.paddingLeft) || 0)
      + (parseFloat(cellStyle.paddingRight) || 0);
    const available = Math.max(0, cellWidth - horizontalPadding - 2);

    if (!measurementContext) {
      measurementContext = document.createElement('canvas').getContext('2d');
    }
    if (!measurementContext) return fullPhrase;

    const textStyle = getComputedStyle(element);
    measurementContext.font = textStyle.font || `${textStyle.fontSize} ${textStyle.fontFamily}`;
    const alternatives = [fullPhrase, ...compactRelativeVariants(fullPhrase)];
    return alternatives.find((candidate) => measurementContext.measureText(candidate).width <= available)
      || alternatives[alternatives.length - 1];
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
    const fullPhrase = relativePhrase(date);
    const label = fitRelativeTime(element, fullPhrase);

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
      element.setAttribute('data-github-tweaks-blocked-title', fullPhrase);
      if (element.hasAttribute('title')) element.removeAttribute('title');
    } else if (element.getAttribute('title') !== fullPhrase) {
      element.setAttribute('title', fullPhrase);
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
      if (element.shadowRoot) element.shadowRoot.textContent = element.textContent;

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
    if (!ageResizeObserver && typeof ResizeObserver === 'function') {
      ageResizeObserver = new ResizeObserver(scheduleAgeRefresh);
    }
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

    if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = null;
    ageResizeObserver?.disconnect();
    ageResizeObserver = null;
    observedAgeCells.clear();
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

  function refreshOnNavigation() {
    ageResizeObserver?.disconnect();
    observedAgeCells.clear();
    processTree();
  }

  document.addEventListener('turbo:load', refreshOnNavigation);
  document.addEventListener('pjax:end', refreshOnNavigation);

  const settings = await chrome.storage.local.get({ [SETTING_KEY]: false });
  setEnabled(Boolean(settings[SETTING_KEY]));
})();
