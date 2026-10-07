(() => {
  'use strict';

  const STYLE_ID = 'github-tweaks-block-tooltips-style';
  const BLOCKED_TITLE_ATTRIBUTE = 'data-github-tweaks-blocked-title';
  const ADDED_ARIA_ATTRIBUTE = 'data-github-tweaks-added-aria-label';
  const ALLOW_TOOLTIP_ATTRIBUTE = 'data-github-tweaks-allow-tooltip';
  const REACTION_SUMMARY_SELECTOR = [
    '.reaction-summary-item:not(.add-reaction-btn)',
    '[data-testid="reaction-summary-item"]',
    '[data-testid="reaction-button"][aria-label*="reacted" i]',
    'button[aria-label*="reacted with" i]',
  ].join(', ');

  let titleObserver = null;
  let enabled = false;

  function tooltipStyle() {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      tool-tip:not([${ALLOW_TOOLTIP_ATTRIBUTE}]),
      [role="tooltip"]:not([${ALLOW_TOOLTIP_ATTRIBUTE}]),
      [data-component="Tooltip"]:not([${ALLOW_TOOLTIP_ATTRIBUTE}]) {
        display: none !important;
      }

      .tooltipped:not(.reaction-summary-item)::before,
      .tooltipped:not(.reaction-summary-item)::after {
        display: none !important;
      }
    `;
    return style;
  }

  function isReactionSummary(element) {
    return element instanceof Element && Boolean(element.closest(REACTION_SUMMARY_SELECTOR));
  }

  function tooltipControl(tooltip) {
    if (!(tooltip instanceof Element)) return null;

    const forId = tooltip.getAttribute('for');
    if (forId) {
      const control = document.getElementById(forId);
      if (control) return control;
    }

    if (!tooltip.id) return null;
    const escapedId = CSS.escape(tooltip.id);
    return document.querySelector(
      `[aria-describedby~="${escapedId}"], [aria-labelledby~="${escapedId}"]`,
    );
  }

  function allowReactionTooltip(tooltip) {
    if (
      !(tooltip instanceof Element) ||
      !tooltip.matches('tool-tip, [role="tooltip"], [data-component="Tooltip"]')
    ) {
      return;
    }

    if (isReactionSummary(tooltipControl(tooltip))) {
      tooltip.setAttribute(ALLOW_TOOLTIP_ATTRIBUTE, 'true');
    } else {
      tooltip.removeAttribute(ALLOW_TOOLTIP_ATTRIBUTE);
    }
  }

  function allowReactionTooltipsWithin(root) {
    if (!(root instanceof Element)) return;
    allowReactionTooltip(root);
    for (const tooltip of root.querySelectorAll(
      'tool-tip, [role="tooltip"], [data-component="Tooltip"]',
    )) {
      allowReactionTooltip(tooltip);
    }
  }

  function blockTitle(element) {
    if (!(element instanceof Element) || !element.hasAttribute('title')) return;
    if (isReactionSummary(element)) return;

    if (element.matches('relative-time, time-ago, local-time') && !element.hasAttribute('no-title')) {
      element.setAttribute('data-github-tweaks-added-no-title', 'true');
      element.setAttribute('no-title', '');
    }

    const title = element.getAttribute('title') || '';
    element.setAttribute(BLOCKED_TITLE_ATTRIBUTE, title);

    if (title && !element.hasAttribute('aria-label')) {
      element.setAttribute('aria-label', title);
      element.setAttribute(ADDED_ARIA_ATTRIBUTE, 'true');
    }

    element.removeAttribute('title');
  }

  function blockTitlesWithin(root) {
    if (!(root instanceof Element)) return;
    allowReactionTooltipsWithin(root);
    blockTitle(root);
    for (const element of root.querySelectorAll('[title]')) blockTitle(element);
  }

  function restoreTitles() {
    for (const element of document.querySelectorAll(`[${BLOCKED_TITLE_ATTRIBUTE}]`)) {
      element.setAttribute('title', element.getAttribute(BLOCKED_TITLE_ATTRIBUTE) || '');
      element.removeAttribute(BLOCKED_TITLE_ATTRIBUTE);

      if (element.hasAttribute('data-github-tweaks-added-no-title')) {
        element.removeAttribute('no-title');
        element.removeAttribute('data-github-tweaks-added-no-title');
      }

      if (element.hasAttribute(ADDED_ARIA_ATTRIBUTE)) {
        element.removeAttribute('aria-label');
        element.removeAttribute(ADDED_ARIA_ATTRIBUTE);
      }
    }
  }

  function enableBlocking() {
    if (enabled) return;
    enabled = true;

    if (!document.getElementById(STYLE_ID)) {
      (document.head || document.documentElement).append(tooltipStyle());
    }

    if (document.documentElement) blockTitlesWithin(document.documentElement);

    titleObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          blockTitle(mutation.target);
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node instanceof Element) blockTitlesWithin(node);
        }
      }
    });

    titleObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title'],
    });
  }

  function disableBlocking() {
    if (!enabled) return;
    enabled = false;
    titleObserver?.disconnect();
    titleObserver = null;
    document.getElementById(STYLE_ID)?.remove();
    restoreTitles();
  }

  async function loadSetting() {
    const { blockTooltips } = await chrome.storage.local.get({ blockTooltips: false });
    if (blockTooltips) enableBlocking();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.blockTooltips) return;
    if (changes.blockTooltips.newValue) enableBlocking();
    else disableBlocking();
  });

  void loadSetting();
})();
