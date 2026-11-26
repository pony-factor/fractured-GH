const pauseInboxes = document.getElementById('pause-inboxes');
const statusText = document.getElementById('popup-status');

function showError(message) {
  statusText.textContent = message;
  statusText.hidden = false;
}

chrome.storage.local.get({ inboxesPaused: false }).then(({ inboxesPaused }) => {
  pauseInboxes.checked = inboxesPaused === true;
  pauseInboxes.disabled = false;
}).catch(() => showError('Could not load your inbox preference.'));

pauseInboxes.addEventListener('change', async () => {
  const paused = pauseInboxes.checked;
  pauseInboxes.disabled = true;
  statusText.hidden = true;
  try {
    await chrome.storage.local.set({ inboxesPaused: paused });
  } catch {
    pauseInboxes.checked = !paused;
    showError('Could not save your inbox preference.');
  } finally {
    pauseInboxes.disabled = false;
  }
});

document.getElementById('open-full-settings').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage().catch(() => showError('Could not open full settings.'));
});
