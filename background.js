const DEFAULT_SETTINGS = {
  commitTitleEmojis: false,
  simplifyCommitMessages: false,
  webSquashFormattingEnabled: false,
  webSquashOmitEmojiBullets: false,
  webSquashFilterSync: true,
  webSquashSeparator: "underscores",
  wrapDiffLines: true,
  pullRequestSidebarToggleEnabled: true,
  pullRequestSidebarCollapsed: false,
  hideCopilot: true,
  rotate404FanArtEnabled: true,
  hideInboxWhileBusy: true,
  hideNotificationsButton: false,
  compactTopRightActions: false,
  relativeTimesOnly: false,
  ownerAvatarHeaderEnabled: true,
  organizationNotificationInboxesEnabled: false,
  notificationOrganizations: [],
  userNicknamesEnabled: true,
  rainbowOwnMentionsEnabled: false,
  userNicknames: [],
  conversationFirstNamesEnabled: false,
  preferDisplayNamesEnabled: false,
  hideContributingGuidelinesNotice: true,
  hidePullRequestMilestone: false,
  hideEmptySidebarSections: false,
  hidePullRequestMergeStatus: false,
  hidePullRequestCodeButton: false,
  hideSuggestedWorkflows: false,
  hideRepositoryLanguages: false,
  hideRepositoryInsights: false,
  hideRepositoryCustomProperties: false,
  hideReportRepository: false,
  hideRepositoryOverviewName: false,
  hideRepositoryPins: true,
  hideRepositoryWatchButton: false,
  hideRepositoryStarButton: false,
  hideRepositoryForkButton: false,
  autoSetupNewForks: true,
  hideMyNavigationLinks: false,
  hideHamburgerMenu: false,
  muteUsersEnabled: true,
  mutedUsers: [],
  spellcheckUseChatgptProject: false,
  spellcheckChatgptProjectUrl: '',
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

function normalizeChatgptProjectUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com'
      || url.username || url.password || url.port || url.search || url.hash
      || !/^\/g\/g-p-[A-Za-z0-9_-]+\/project\/?$/.test(url.pathname)) return null;
    return `https://chatgpt.com${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'fractured:open-spellcheck' && typeof message.jobId === 'string') {
    void (async () => {
      const settings = await chrome.storage.local.get({
        spellcheckUseChatgptProject: false,
        spellcheckChatgptProjectUrl: '',
      });
      const projectMode = settings.spellcheckUseChatgptProject === true;
      const projectUrl = projectMode
        ? normalizeChatgptProjectUrl(settings.spellcheckChatgptProjectUrl) : null;
      if (projectMode && !projectUrl) {
        sendResponse({
          ok: false,
          error: 'Enter a valid ChatGPT Project URL in Fractured settings, or turn off project routing.',
        });
        return;
      }
      const target = new URL(projectUrl || 'https://chatgpt.com/');
      target.searchParams.set('fractured-spellcheck', message.jobId);
      if (projectMode) target.searchParams.set('fractured-project', '1');
      chrome.tabs.create({ url: target.href, active: false }, (tab) => {
        const error = chrome.runtime.lastError;
        sendResponse(error
          ? { ok: false, error: error.message }
          : { ok: true, tabId: tab?.id ?? null });
      });
    })().catch((error) => {
      sendResponse({ ok: false, error: error?.message || 'Could not open ChatGPT for spellcheck.' });
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


// Fetch through the extension worker and pass the image to GitHub as a data URL.
const fractured404Search = new URL('https://derpibooru.org/api/v1/json/search/images');
fractured404Search.search = new URLSearchParams({
  q: 'safe, pony, artist:*, -animated',
  sf: 'random',
  per_page: '8',
});
let fractured404LastId = null;

async function loadFractured404Artwork(image, signal) {
  const tags = Array.isArray(image?.tags) ? image.tags : [];
  const artistTag = tags.find(tag => /^artist:[^ ]/i.test(tag));
  const id = image?.id;
  if (!Number.isSafeInteger(id) || id <= 0 || !tags.includes('safe') || !artistTag) {
    throw new Error('Artwork is not verified as safe and credited');
  }
  const imageUrl = image.representations?.large || image.representations?.medium;
  const cdn = new URL(imageUrl);
  if (cdn.protocol !== 'https:' || cdn.hostname !== 'derpicdn.net') {
    throw new Error('Unexpected artwork host');
  }
  const asset = await fetch(cdn.href, { signal });
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
  return {
    ok: true,
    id,
    imageDataUrl: 'data:' + mime + ';base64,' + btoa(binary),
    artist: artistTag.slice('artist:'.length),
    postUrl: 'https://derpibooru.org/images/' + id,
    sourceUrl,
  };
}

async function selectFractured404Artwork(excludeId) {
  const response = await fetch(fractured404Search.href, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Artwork search unavailable');
  const { images } = await response.json();
  const signal = AbortSignal.timeout(15000);
  for (const image of images) {
    if (image?.id === excludeId || image?.id === fractured404LastId) continue;
    try {
      const artwork = await loadFractured404Artwork(image, signal);
      if (artwork.id === fractured404LastId) continue;
      fractured404LastId = artwork.id;
      return artwork;
    } catch {
      // A random result can be missing a credit or a usable image. Try the next one.
      if (signal.aborted) break;
    }
  }
  throw new Error('No usable artwork in the random results');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'fractured:load-404-fan-art') return false;
  void selectFractured404Artwork(message.excludeId)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: String(error.message || error) }));
  return true;
});
