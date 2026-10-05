const DEFAULT_SETTINGS = {
  commitTitleEmojis: false,
  simplifyCommitMessages: false,
  wrapDiffLines: false,
  hideCopilot: true,
  hideInboxWhileBusy: true,
  relativeTimesOnly: false,
  organizationNotificationInboxesEnabled: false,
  notificationOrganizations: [],
  userNicknamesEnabled: true,
  userNicknames: [],
  conversationFirstNamesEnabled: false,
  hideContributingGuidelinesNotice: true,
  hidePullRequestMilestone: false,
  hideSuggestedWorkflows: false,
  hideMyNavigationLinks: false,
  muteUsersEnabled: true,
  mutedUsers: [],
};

async function initializeMissingSettings() {
  const keys = Object.keys(DEFAULT_SETTINGS);
  const stored = await chrome.storage.local.get(keys);
  const missing = {};

  for (const key of keys) {
    if (stored[key] === undefined) missing[key] = DEFAULT_SETTINGS[key];
  }

  if (Object.keys(missing).length) {
    await chrome.storage.local.set(missing);
  }
}

async function applyActionIcon() {
  try {
    const response = await fetch(chrome.runtime.getURL('icons/fractured.png'));
    const bitmap = await createImageBitmap(await response.blob());
    const cropSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = (bitmap.width - cropSize) / 2;
    const sourceY = (bitmap.height - cropSize) / 2;
    const imageData = {};

    for (const size of [16, 32]) {
      const canvas = new OffscreenCanvas(size, size);
      const context = canvas.getContext('2d');
      context.drawImage(
        bitmap,
        sourceX,
        sourceY,
        cropSize,
        cropSize,
        0,
        0,
        size,
        size,
      );
      imageData[size] = context.getImageData(0, 0, size, size);
    }

    bitmap.close?.();
    await chrome.action.setIcon({ imageData });
  } catch (error) {
    console.warn('[Fractured GitHub] Could not set toolbar icon:', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeMissingSettings();
  void applyActionIcon();
});

chrome.runtime.onStartup.addListener(() => {
  void applyActionIcon();
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

void applyActionIcon();
