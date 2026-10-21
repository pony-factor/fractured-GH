(() => {
  'use strict';

  const KEY = 'hideHamburgerMenu';
  const STYLE_ID = 'fractured-hide-hamburger-menu-style';

  function setEnabled(enabled) {
    document.getElementById(STYLE_ID)?.remove();
    if (!enabled) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :is(.AppHeader, header[role="banner"], header.GlobalNav,
          [aria-label="Global navigation menu"], [data-component="AppHeader"], #global-nav)
      :is(button, [role="button"]):is([aria-label="Open menu"], [aria-label="Open global navigation menu"]) {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) setEnabled(changes[KEY].newValue);
  });
  void chrome.storage.local.get({ [KEY]: false }).then(settings => setEnabled(settings[KEY]));
})();
