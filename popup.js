const INBOX_WINDOW_MS = 8 * 60 * 60 * 1000;
const showInboxes = document.getElementById('show-inboxes');
const statusText = document.getElementById('popup-status');
let visibleUntil = 0;
let expiryTimer;

function showError(message) {
  statusText.textContent = message;
  statusText.hidden = false;
}

function renderVisibility() {
  clearTimeout(expiryTimer);
  const remaining = visibleUntil - Date.now();
  showInboxes.checked = remaining > 0;
  if (remaining > 0) expiryTimer = setTimeout(renderVisibility, remaining);
}

chrome.storage.local.get({ inboxesVisibleUntil: 0 }).then(({ inboxesVisibleUntil }) => {
  visibleUntil = inboxesVisibleUntil;
  renderVisibility();
  showInboxes.disabled = false;
}).catch(() => showError('Could not load your inbox preference.'));

chrome.storage.onChanged.addListener((changes, areaName) => {
  const change = changes.inboxesVisibleUntil;
  if (areaName !== 'local' || !change) return;
  visibleUntil = change.newValue ?? 0;
  renderVisibility();
});

showInboxes.addEventListener('change', async () => {
  const deadline = showInboxes.checked ? Date.now() + INBOX_WINDOW_MS : 0;
  showInboxes.disabled = true;
  statusText.hidden = true;
  try {
    await chrome.storage.local.set({ inboxesVisibleUntil: deadline });
    visibleUntil = deadline;
  } catch {
    showError('Could not save your inbox preference.');
  } finally {
    renderVisibility();
    showInboxes.disabled = false;
  }
});

document.getElementById('open-full-settings').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage().catch(() => showError('Could not open full settings.'));
});
