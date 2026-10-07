(() => {
  'use strict';

  const tabs = [...document.querySelectorAll('.settings-category-tab')];
  const panels = [...document.querySelectorAll('.settings-panel')];
  const storageKey = 'fractured-options-tab';

  function activateTab(tab, focus = false) {
    if (!tab) return;

    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
    }

    for (const panel of panels) {
      panel.hidden = panel.id !== tab.getAttribute('aria-controls');
    }

    sessionStorage.setItem(storageKey, tab.id);
    if (focus) tab.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();

      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      activateTab(tabs[nextIndex], true);
    });
  });

  const savedTab = sessionStorage.getItem(storageKey);
  activateTab(tabs.find((tab) => tab.id === savedTab) || tabs[0]);
})();
