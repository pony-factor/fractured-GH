(() => {
  'use strict';

  const marker = 'data-fractured-commit-reference';

  function update(link) {
    let isCommit = false;
    try {
      const url = new URL(link.getAttribute('href'), location.href);
      const hash = link.textContent.trim();
      const target = url.pathname.match(/\/(?:commit|commits)\/([0-9a-f]{7,40})\/?$/i)?.[1];
      isCommit = url.origin === location.origin && /^[0-9a-f]{7,40}$/i.test(hash)
        && Boolean(target?.toLowerCase().startsWith(hash.toLowerCase()));
    } catch {}
    if (isCommit) link.setAttribute(marker, '');
    else link.removeAttribute(marker);
  }

  function scan(root) {
    if (root.nodeType === Node.TEXT_NODE) root = root.parentElement;
    if (!root) return;
    const parentLink = root.closest?.('a[href]');
    if (parentLink) update(parentLink);
    root.querySelectorAll?.('a[href]').forEach(update);
  }

  scan(document);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') {
        scan(record.target.closest?.('a[href]'));
        record.addedNodes.forEach(scan);
      } else scan(record.target);
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href'],
  });
})();
