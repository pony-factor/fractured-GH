const DEFAULT_SETTINGS = {
  commitTitleEmojis: false,
  simplifyCommitMessages: false,
  wrapDiffLines: true,
  hideCopilot: true,
  rotate404FanArtEnabled: true,
  hideInboxWhileBusy: true,
  relativeTimesOnly: false,
  ownerAvatarHeaderEnabled: true,
  organizationNotificationInboxesEnabled: false,
  notificationOrganizations: [],
  userNicknamesEnabled: true,
  userNicknames: [],
  conversationFirstNamesEnabled: false,
  preferDisplayNamesEnabled: false,
  hideContributingGuidelinesNotice: true,
  hidePullRequestMilestone: false,
  hideSuggestedWorkflows: false,
  hideRepositoryLanguages: false,
  hideRepositoryInsights: false,
  hideRepositoryCustomProperties: false,
  hideReportRepository: false,
  hideRepositoryOverviewName: false,
  hideRepositoryPins: true,
  autoSetupNewForks: true,
  hideMyNavigationLinks: false,
  hideHamburgerMenu: false,
  muteUsersEnabled: true,
  mutedUsers: [],
};

async function initializeMissingSettings() {
  const keys = [...Object.keys(DEFAULT_SETTINGS), 'hideRepositorySocialActions',
    'hideRepositoryWatch', 'hideRepositoryStar', 'hideRepositoryFork'];
  const stored = await chrome.storage.local.get(keys);
  const missing = {};

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (stored[key] === undefined) missing[key] = DEFAULT_SETTINGS[key];
  }

  for (const key of ['hideRepositoryWatch', 'hideRepositoryStar', 'hideRepositoryFork']) {
    if (stored[key] === undefined) missing[key] = Boolean(stored.hideRepositorySocialActions);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'fractured:open-spellcheck' && typeof message.jobId === 'string') {
    const url = `https://chatgpt.com/?fractured-spellcheck=${encodeURIComponent(message.jobId)}`;
    chrome.tabs.create({ url, active: false }, (tab) => {
      const error = chrome.runtime.lastError;
      sendResponse(error
        ? { ok: false, error: error.message }
        : { ok: true, tabId: tab?.id ?? null });
    });
    return true;
  }

  if (message?.type === 'fractured:close-spellcheck-tab' && sender.tab?.id != null) {
    chrome.tabs.remove(sender.tab.id, () => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { ok: false, error: error.message } : { ok: true });
    });
    return true;
  }

  return false;
});

void applyActionIcon();


// Curated, safe-rated fandom artworks. Fetch via the extension worker so that
// GitHub's content security policy cannot break the images.
const FRACTURED_404_IMAGE_IDS = [2961898, 2962441, 3150400, 2988636];
const fractured404Cache = new Map();
let fractured404LastId = null;

async function loadFractured404Artwork(id) {
  const cached = fractured404Cache.get(id);
  if (cached && Date.now() - cached.createdAt < 30 * 60 * 1000) return cached.value;

  const response = await fetch('https://derpibooru.org/api/v1/json/images/' + id, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Artwork metadata unavailable');
  const { image } = await response.json();
  const tags = Array.isArray(image?.tags) ? image.tags : [];
  const artistTag = tags.find(tag => /^artist:[^ ]/i.test(tag));
  if (!image || image.id !== id || !tags.includes('safe') || !artistTag) {
    throw new Error('Artwork is not verified as safe and credited');
  }
  const imageUrl = image.representations?.large || image.representations?.medium;
  const cdn = new URL(imageUrl);
  if (cdn.protocol !== 'https:' || cdn.hostname !== 'derpicdn.net') {
    throw new Error('Unexpected artwork host');
  }
  const asset = await fetch(cdn.href, { signal: AbortSignal.timeout(15000) });
  const mime = (asset.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!asset.ok || !/^image\/(?:jpeg|png|webp|gif)$/.test(mime)) {
    throw new Error('Artwork image unavailable');
  }
  const bytes = new Uint8Array(await asset.arrayBuffer());
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Artwork too large');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  let sourceUrl = '';
  try {
    const parsed = new URL(image.source_url || '');
    if (parsed.protocol === 'https:') sourceUrl = parsed.href;
  } catch {
    // Source URL is optional; the Derpibooru post remains linked.
  }
  const value = {
    ok: true,
    id,
    imageDataUrl: 'data:' + mime + ';base64,' + btoa(binary),
    artist: artistTag.slice('artist:'.length),
    postUrl: 'https://derpibooru.org/images/' + id,
    sourceUrl,
  };
  fractured404Cache.set(id, { createdAt: Date.now(), value });
  return value;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'fractured:load-404-fan-art') return false;
  const candidates = FRACTURED_404_IMAGE_IDS.filter(id =>
    id !== message.excludeId && id !== fractured404LastId);
  const pool = candidates.length ? candidates : FRACTURED_404_IMAGE_IDS;
  const id = pool[Math.floor(Math.random() * pool.length)];
  fractured404LastId = id;
  void loadFractured404Artwork(id)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: String(error.message || error) }));
  return true;
});
