(() => {
  'use strict';

  const STYLE_ID = 'github-tweaks-hide-footer-style';

  function footerStyle() {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      footer[role="contentinfo"],
      body > footer.footer {
        display: none !important;
      }
    `;
    return style;
  }

  function enableFooterHiding() {
    if (document.getElementById(STYLE_ID)) return;
    (document.head || document.documentElement).append(footerStyle());
  }

  function disableFooterHiding() {
    document.getElementById(STYLE_ID)?.remove();
  }

  async function loadSetting() {
    const { hideFooter } = await chrome.storage.local.get({ hideFooter: false });
    if (hideFooter) enableFooterHiding();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.hideFooter) return;
    if (changes.hideFooter.newValue) enableFooterHiding();
    else disableFooterHiding();
  });

  void loadSetting();
})();
