(() => {
  'use strict';

  let enabled = false;
  const BOUND_ATTR = 'data-fractured-commit-emoji-bound';
  const HANDLED_ATTR = 'data-fractured-commit-emoji-handled';
  const composingFields = new WeakSet();
  const queuedFields = new WeakSet();
  const BUG_EMOJIS = ['🐛', '🐜', '🐝', '🐞', '🦗', '🕷️', '🦟'];
  const FINANCIAL_INCLUSION_EMOJIS = ['🌍', '🌎', '🌏'];
  const SECURITY_EMOJIS = [
    '📌', '📍', '📎', '🖇️', '📏', '📐', '✂️', '🧷', '🔒', '🔓', '🔏', '🔐', '🔑', '🗝️',
    '🔨', '🪓', '⛏️', '⚒️', '🛠️', '🧲', '🛡️', '🦯', '🔗', '⛓️', '⚗️', '🧪', '🧬', '🔬',
    '🔭', '💊', '🩹',
  ];
  // Studio's fallback palette, indexed by Unicode character names.
  const FALLBACK_EMOJIS = new Map(`
🗣️ speaking head in silhouette
👤 bust in silhouette
👥 busts in silhouette
👪 family
💰 money bag
💵 banknote with dollar sign
💸 money with wings
💳 credit card
💹 chart with upwards trend and yen sign
📉 chart with downwards trend
📊 bar chart
💫 dizzy symbol
🦏 rhinoceros
🐁 mouse
🐀 rat
🐇 rabbit
🦇 bat
🦢 swan
🐢 turtle
🐉 dragon
🐋 whale
🐙 octopus
🌳 deciduous tree
🥬 leafy green
🗺️ world map
🧭 compass
🏔️ snow capped mountain
⛰️ mountain
🌋 volcano
🗻 mount fuji
🧱 brick
🏘️ house buildings
🏠 house building
🏡 house with garden
🏢 office building
🏥 hospital
🏫 school
🏬 department store
🏭 factory
🏯 japanese castle
🏰 european castle
⛲ fountain
🚂 steam locomotive
🚃 railway car
🚄 high speed train
🚅 high speed train with bullet nose
🚆 train
🚇 metro
🚈 light rail
🚉 station
🚊 tram
🚝 monorail
🚞 mountain railway
🚋 tram car
🚏 bus stop
🛣️ motorway
🛤️ railway track
🛢️ oil drum
⛽ fuel pump
🚨 police cars revolving light
🚦 vertical traffic light
🛑 octagonal sign
🚧 construction sign
🛰️ satellite
🚀 rocket
🛎️ bellhop bell
🧳 luggage
⏳ hourglass with flowing sand
⏰ alarm clock
⏱️ stopwatch
⏲️ timer clock
🕰️ mantelpiece clock
🌑 new moon symbol
🌒 waxing crescent moon symbol
🌓 first quarter moon symbol
🌔 waxing gibbous moon symbol
🌕 full moon symbol
🌖 waning gibbous moon symbol
🌗 last quarter moon symbol
🌘 waning crescent moon symbol
🌙 crescent moon
🌜 last quarter moon with face
🌡️ thermometer
🪐 ringed planet
⭐ white medium star
🌟 glowing star
🌠 shooting star
🌌 milky way
☁️ cloud
⛅ sun behind cloud
⚡ high voltage sign
❄️ snowflake
☄️ comet
🔥 fire
💧 droplet
🌊 water wave
🧊 ice cube
🎆 fireworks
🎇 firework sparkler
🎁 wrapped present
🎗️ reminder ribbon
🎟️ admission tickets
🎫 ticket
🎖️ military medal
🏆 trophy
🏅 sports medal
🥇 first place medal
🥈 second place medal
🥉 third place medal
🎯 direct hit
🪀 yo yo
🪁 kite
🎱 billiards
🔮 crystal ball
🎮 video game
🕹️ joystick
🎲 game die
🧩 jigsaw puzzle piece
🧵 spool of thread
🎒 school satchel
👑 crown
🎩 top hat
🔇 speaker with cancellation stroke
🔈 speaker
🔉 speaker with one sound wave
🔊 speaker with three sound waves
📢 public address loudspeaker
📣 cheering megaphone
🔔 bell
🔕 bell with cancellation stroke
🎵 musical note
🎶 multiple musical notes
🎙️ studio microphone
🎚️ level slider
🎛️ control knobs
🎤 microphone
🎧 headphone
📻 radio
🎷 saxophone
🎹 musical keyboard
🎻 violin
🥁 drum with drumsticks
📱 mobile phone
📲 mobile phone with rightwards arrow at left
☎️ black telephone
📞 telephone receiver
📟 pager
📠 fax machine
🔋 battery
🔌 electric plug
💻 personal computer
🖥️ desktop computer
🖨️ printer
⌨️ keyboard
🖱️ three button mouse
💽 minidisc
💾 floppy disk
💿 optical disc
📀 dvd
🎥 movie camera
🎞️ film frames
📽️ film projector
🎬 clapper board
📺 television
📷 camera
📸 camera with flash
📹 video camera
📼 videocassette
🔍 left pointing magnifying glass
🔎 right pointing magnifying glass
🕯️ candle
💡 electric light bulb
🔦 electric torch
🏮 izakaya lantern
🪔 diya lamp
📔 notebook with decorative cover
📕 closed book
📖 open book
📗 green book
📘 blue book
📙 orange book
📚 books
📓 notebook
📒 ledger
📃 page with curl
📜 scroll
📄 page facing up
📰 newspaper
🗞️ rolled up newspaper
📑 bookmark tabs
🔖 bookmark
🏷️ label
✉️ envelope
📧 e mail symbol
📨 incoming envelope
📩 envelope with downwards arrow above
📤 outbox tray
📥 inbox tray
📦 package
📮 postbox
🗳️ ballot box with ballot
💼 briefcase
🗓️ spiral calendar pad
📇 card index
📋 clipboard
🚪 door
🛋️ couch and lamp
🪑 chair
🧹 broom
🧺 basket
🧼 bar of soap
🧽 sponge
🧯 fire extinguisher
🛒 shopping trolley
🧿 nazar amulet
🗿 moyai
🚮 put litter in its place symbol
🚰 potable water symbol
♿ wheelchair symbol
⚠️ warning sign
🚸 children crossing
⛔ no entry
🚫 no entry sign
⬆️ upwards black arrow
↗️ north east arrow
➡️ black rightwards arrow
↘️ south east arrow
⬇️ downwards black arrow
↙️ south west arrow
⬅️ leftwards black arrow
↖️ north west arrow
↕️ up down arrow
↔️ left right arrow
↩️ leftwards arrow with hook
↪️ rightwards arrow with hook
⤴️ arrow pointing rightwards then curving upwards
⤵️ arrow pointing rightwards then curving downwards
🔃 clockwise downwards and upwards open circle arrows
🔆 high brightness symbol
✖️ heavy multiplication x
➕ heavy plus sign
➖ heavy minus sign
➗ heavy division sign
♾️ permanent paper sign
❓ black question mark ornament
❔ white question mark ornament
❕ white exclamation mark ornament
❗ heavy exclamation mark symbol
♻️ black universal recycling symbol
⚜️ fleur de lis
🔱 trident emblem
✅ white heavy check mark
☑️ ballot box with check
✔️ heavy check mark
❌ cross mark
❎ negative squared cross mark
  `.trim().split('\n').map((line) => {
    const separator = line.indexOf(' ');
    return [line.slice(separator + 1), line.slice(0, separator)];
  }));
  const FALLBACK_ALIASES = new Map([
    ['accessibility', 'wheelchair symbol'],
    ['benchmark', 'bar chart'],
    ['calendar', 'spiral calendar pad'],
    ['checklist', 'clipboard'],
    ['dashboard', 'bar chart'],
    ['email', 'e mail symbol'],
    ['launch', 'rocket'],
    ['logging', 'scroll'],
    ['performance', 'bar chart'],
    ['recycling', 'black universal recycling symbol'],
    ['search', 'left pointing magnifying glass'],
    ['telemetry', 'satellite'],
    ['video', 'video camera'],
  ]);

  const EMOJI_PREFIX_RE = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)/u;
  const COMMIT_ACTION_RE = /\b(commit changes|propose changes|merge pull request|squash and merge|rebase and merge|confirm merge|confirm squash|confirm rebase)\b/i;
  const CODE_PATH_RE = /\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|kt|kts|swift|php|cs|c|cc|cpp|h|hpp|scala|sh|zsh|fish|ps1|lua|ex|exs|erl|hrl|fs|fsx|vb|r|dart|sol|move|css|scss|sass|less|vue|svelte)$/i;
  const WRITING_PATH_RE = /\.(?:md|mdx|txt|rst|adoc|tex|org)$/i;
  const IMAGE_PATH_RE = /\.(?:svg|png|jpe?g|gif|webp|avif|ico)$/i;
  const PACKAGE_PATH_RE = /(?:^|\/)(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|deno\.jsonc?|pyproject\.toml|requirements[^/]*\.txt|cargo\.(?:toml|lock)|gemfile(?:\.lock)?|go\.(?:mod|sum))$/i;
  const CONFIG_PATH_RE = /(?:^|\/)(?:tsconfig[^/]*\.json|vite\.config\.[^/]+|webpack\.config\.[^/]+|[^/]+\.(?:ya?ml|toml|ini|conf|env))$/i;

  function editorLocation() {
    const match = window.location.pathname.match(/^\/([^/]+\/[^/]+)\/(edit|new|delete|upload)\/(.+)$/);
    if (!match) return { branch: '', path: '' };

    const [, repository, action, remainder] = match;
    const route = decodeURIComponent(remainder);
    const treePrefix = `/${repository}/tree/`;
    let branch = route.split('/')[0];

    // The editor breadcrumb links to the entire branch, including slashes in its name.
    for (const link of document.querySelectorAll('main a[href], [role="main"] a[href]')) {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith(treePrefix)) continue;
      const ref = decodeURIComponent(href.slice(treePrefix.length));
      if (ref.length > branch.length && ref === link.textContent.trim()
          && (route === ref || route.startsWith(`${ref}/`))) branch = ref;
    }
    const filename = document.querySelector('main input[aria-label="File name"]')?.value;
    const path = action === 'upload' ? '' : filename || route.slice(branch.length + 1);
    return { action, branch, path };
  }

  function stableBugEmoji(branch) {
    const repository = window.location.pathname.split('/').slice(1, 3).join('/');
    const key = `studio-github-commit-emoji:bug:${repository}:${branch}`;
    try {
      const stored = window.localStorage.getItem(key);
      if (BUG_EMOJIS.includes(stored)) return stored;

      const choice = randomEmoji(BUG_EMOJIS);
      window.localStorage.setItem(key, choice);
      return choice;
    } catch {
      let hash = 0;
      for (const char of key) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
      return BUG_EMOJIS[Math.abs(hash) % BUG_EMOJIS.length];
    }
  }

  function fieldDescriptor(field) {
    const labels = field.labels ? Array.from(field.labels, (label) => label.textContent || '') : [];
    return [
      field.getAttribute('aria-label') || '',
      field.getAttribute('placeholder') || '',
      field.getAttribute('name') || '',
      field.id || '',
      ...labels,
    ]
      .join(' ')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function commitScope(field) {
    return field.closest('form, [role="dialog"], [data-testid*="commit" i], [data-testid*="merge" i]') || field.parentElement;
  }

  function hasCommitAction(scope) {
    if (!scope) return false;
    const controls = scope.querySelectorAll('button, input[type="submit"], input[type="button"]');
    return Array.from(controls).some((control) => COMMIT_ACTION_RE.test(control.textContent || control.value || ''));
  }

  function isManagedSquash(field) {
    // Protect the entire PR route before React hydrates fields or merge controls.
    // Nested commit panels can appear before their surrounding merge dialog.
    return /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(window.location.pathname);
  }

  function isCommitTitleField(field) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || isManagedSquash(field)) return false;
    if (field instanceof HTMLInputElement && !['', 'text'].includes(field.type)) return false;

    const descriptor = fieldDescriptor(field);
    if (/\b(description|body|extended)\b/.test(descriptor)) return false;

    const explicitTitle = /\b(commit (?:message|title|summary)|commitmessage|committitle)\b/.test(descriptor);
    const commitNamed = /\bcommit\b/.test(descriptor) && /\b(message|title|summary)\b/.test(descriptor);
    const genericMessage = /^(?:message|summary)$/.test(descriptor);
    if (!explicitTitle && !commitNamed && !genericMessage) return false;

    const scope = commitScope(field);
    return hasCommitAction(scope) || /\b(commit|merge|squash|rebase|propose)\b/i.test(scope?.textContent || '');
  }

  function isCodeContext(title, path) {
    return CODE_PATH_RE.test(path) || /\b(?:code|function|class|component|runtime|script|parser|renderer|viewer|extension|compile|lint|typecheck|api)\b/.test(title);
  }

  function isPrivateRepository() {
    const visibility = document.querySelector('meta[name="octolytics-dimension-repository_public"]')?.content;
    if (visibility === 'false') return true;
    if (visibility === 'true') return false;
    return Array.from(document.querySelectorAll('#repository-container-header .Label'))
      .some((badge) => badge.textContent.trim() === 'Private');
  }

  function respondsToHumanReview(title) {
    if (!/\b(?:address|respond to|resolve|apply|incorporate|review feedback|pr feedback)\b/.test(title)
        || !/\b(?:review|reviewer|feedback|suggestion|comment)s?\b/.test(title)) return false;
    if (/\b(?:real person|human|maintainer|teammate|colleague)\b/.test(title)) return true;
    return Array.from(title.matchAll(/@([a-z0-9-]+)(\[bot\])?/g)).some(([, name, bot]) =>
      !bot && !/(?:copilot|codex|claude|chatgpt|dependabot|renovate|github-actions|bot$)/.test(name));
  }

  function fallbackEmoji(title) {
    const words = title.match(/[a-z0-9]+/g) || [];
    // A specific name like "video camera" takes precedence over a one-word alias.
    for (let length = Math.min(7, words.length); length > 0; length--) {
      for (let start = 0; start <= words.length - length; start++) {
        const phrase = words.slice(start, start + length).join(' ');
        const emoji = FALLBACK_EMOJIS.get(phrase) || FALLBACK_EMOJIS.get(FALLBACK_ALIASES.get(phrase));
        if (emoji) return emoji;
      }
    }
    return FALLBACK_EMOJIS.get('clipboard');
  }

  function randomEmoji(choices) {
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function classifyEmoji(title) {
    const text = title.toLowerCase();
    const { action, branch, path } = editorLocation();
    const code = isCodeContext(text, path);
    const writing = WRITING_PATH_RE.test(path);

    const bugFix = /\b(?:fix(?:e[ds])?|repair|restore|correct)\b/.test(text)
      || /\b(?:prevent|resolve|address)\b.{0,40}\b(?:bug|regression|crash|fault)\b/.test(text);
    if (code && bugFix && !/\b(?:fix|correct) (?:an? |the )?(?:typos?|spelling|grammar|punctuation)\b/.test(text)) {
      return stableBugEmoji(branch);
    }

    if (/\b(?:sdex|stellar (?:dex|decentralized exchange|offers?))\b/.test(text)
        || (/\bstellar\b/.test(text) && /\border ?book\b/.test(text))) return '💱';
    if (/\bsoroban\b/.test(text) || (/\bstellar\b/.test(text) && /\b(?:smart contracts?|wasm|contracts?)\b/.test(text))) return '🧮';
    if (/\bdecentrali[sz](?:e|ed|ing|ation)\b/.test(text)) return '🌐';
    if (/\b(?:financial inclusion|unbanked|underbanked)\b/.test(text)) return randomEmoji(FINANCIAL_INCLUSION_EMOJIS);
    if (/\bfree[ -]market(?:s| economics)?\b/.test(text)) return '📈';

    if (/\b(?:brand(?:ing)?|wordmark|brand identity|display scheme)\b/.test(text)) return '✨';
    if (/\b(?:colou?rs?|themes?|dark mode|light mode|contrast|palette|rgb|hex colou?r)\b/.test(text)) return '🎨';
    // An image-processing script still counts as code. Look for a direct image edit or asset.
    if (IMAGE_PATH_RE.test(path) || /\b(?:crop|resize|replace|redraw|retouch|recolou?r|swap)\b.{0,30}\b(?:images?|icons?|favicon|avatars?|screenshots?|photos?)\b/.test(text)) return '🖼️';
    if (/\b(?:layout|spacing|alignment|align|center(?:ing)?|padding|margin|radius|typography|font|viewport|ui|ux)\b/.test(text)
        || /\b(?:style|restyle|redesign)\b.{0,30}\b(?:sidebar|toolbar)\b/.test(text)) return '🖌️';

    if (respondsToHumanReview(text)) return '🤝';
    if (/^(?:sync(?:hroni[sz]e)?|rebase)\b.{0,40}\b(?:onto|with|to|against) main\b/.test(text)
        || /^merge (?:origin\/)?main into\b/.test(text)) return '🔄';

    if (/\b(?:code comments?|inline comments?)\b/.test(text)
        || (code && /\b(?:add|annotate|clarify|document|update)\b.{0,25}\bcomments?\b/.test(text))) return '💬';
    if (/\b(?:scribbles?|sticky notes?|scratch notes?|rough notes?)\b/.test(text)) return '💭';

    if (/\b(?:freedom|liberty)\b/.test(text)) return code ? '🦅' : '🕊️';
    const us = /\b(?:u\.?s\.? (?:policy|law|rules?|regulat\w+|markets?)|united states|cfr|usc|sec rule\b|congress|federal)\b/.test(text);
    if (us || /\b(?:policy|regulation|rulemaking|legal|law|compliance)\b/.test(text)) return us ? '🗽' : '⚖️';

    if (/\brefactor(?:ing|ed)?\b/.test(text)) return '🏗️';
    if (PACKAGE_PATH_RE.test(path) || /\b(?:package config(?:uration)?|package manifest|dependencies|dependency|lockfile|npm|pnpm|yarn)\b/.test(text)) return '🧰';
    if (/\b(?:tune|tuning|retune|fine[ -]tune|fine[ -]tuning)\b/.test(text)
        || /\b(?:adjust|calibrate)\b.{0,30}\b(?:parameters?|thresholds?|limits?|timeouts?)\b/.test(text)) return '🔧';
    if (CONFIG_PATH_RE.test(path) || /\b(?:configuration|config|settings?|metrics?|thresholds?|limits?)\b/.test(text)) return '⚙️';
    if (/\b(?:connect|connecting|wire|wiring|integrate|integration|hook up|bridge)\b/.test(text)) return '🔩';
    if (/\b(?:concise|simplif(?:y|ies|ied|ying)|deduplicat(?:e|es|ed|ing)|reduce boilerplate|shorten code)\b/.test(text)) return '🗜️';

    if (/\b(?:superstonk|gamestop|ape investors?|ape movement)\b/.test(text)) return '🦍';
    if (/\b(?:my little pony|mlp|pony fandom)\b/.test(text) && isPrivateRepository()) return '🦄';
    if (/\b(?:math|formulas?|equations?|calculations?|calculate)\b/.test(text)) return '🧾';

    if (/^(?:add|create)\b.{0,30}\b(?:directory|folder)\b/.test(text)) return '📂';
    if (/^(?:delete|remove)\b.{0,30}\b(?:directory|folder)\b/.test(text)) return '📁';
    if (/^(?:delete|remove)\b.{0,30}\bfiles?\b/.test(text)
        || (action === 'delete' && /^delete\b/.test(text))) return '🗑️';
    if (/\b(?:consolidat\w+|combin\w+)\b.{0,30}\b(?:files|documents|items)\b/.test(text)) return '🗃️';
    if (/\b(?:reorganiz\w+|reshuffl\w+|shuffl\w+|restructur\w+)\b.{0,30}\b(?:files|folders|directories)\b/.test(text)) return '🗂️';
    if (/^(?:archive|create (?:an? )?archive|bundle files into an? archive)\b/.test(text)) return '🗄️';

    if (/\b(?:placeholder|stub|skeleton|empty file)\b/.test(text)) return '🌱';
    if (/\b(?:footnotes?)\b/.test(text)) return '✏️';
    if (/\b(?:rough references?|standalone (?:url|link)|external reference)\b/.test(text)
        || (writing && /\b(?:add|include|append)\b.{0,25}\b(?:references?|external links?|urls?)\b/.test(text))) return '🖍️';
    if (/\b(?:multiple|several|many)\b.{0,20}\bsections?\b/.test(text) || /\bbig diff\b/.test(text)) return '📝';
    if (/\b(?:grammar|grammatical|proofread|punctuation|sentence structure)\b/.test(text)
        || (writing && /\bstructur(?:e|al)\b/.test(text))) return '🖊️';
    if (/\b(?:draft|compose|write (?:a |the )?(?:new |initial )?(?:draft|article|letter|essay|copy))\b/.test(text)) return '✒️';
    if (/\b(?:revise|revision|rewrite|edit copy|update copy)\b/.test(text) && (writing || !code)) return '🖋️';

    if (/\b(?:network calls?|fetch requests?|http requests?|api requests?|xhr|websocket)\b/.test(text)) return '📡';
    if (/\b(?:tests?|testing|security|secure|auth(?:entication|orization)?|permissions?|encrypt(?:ion)?|vulnerabilit(?:y|ies)|threat|scope angles)\b/.test(text)) return randomEmoji(SECURITY_EMOJIS);

    if (writing) return /^(?:add|create|write)\b/.test(text) ? '✒️' : '🖋️';
    return fallbackEmoji(text);
  }

  function setNativeValue(field, value) {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(field, value);
    else field.value = value;

    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function prefixField(field) {
    if (!enabled || !isCommitTitleField(field) || field.hasAttribute(HANDLED_ATTR) || composingFields.has(field)) return;
    if (field.id === 'commit-message-input' && /^Copilot is thinking\b/i.test(field.getAttribute('placeholder') || '')) return;

    const title = field.value.trim();
    if (!title) return;

    // Claim this draft before dispatching events, which can trigger another scan.
    // Existing emoji also count: deleting or replacing them is the user's choice.
    field.setAttribute(HANDLED_ATTR, 'true');
    if (EMOJI_PREFIX_RE.test(title)) return;

    const emoji = classifyEmoji(title);
    const prefix = `${emoji} `;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const direction = field.selectionDirection;
    setNativeValue(field, prefix + field.value);
    if (typeof start === 'number' && typeof end === 'number') {
      field.setSelectionRange(start + prefix.length, end + prefix.length, direction);
    }
  }

  function suggestPrefix(field) {
    if (field.id !== 'commit-message-input') {
      prefixField(field);
      return;
    }
    if (field.hasAttribute(HANDLED_ATTR) || queuedFields.has(field)) return;

    // Let GitHub's controlled commit dialog finish rendering the suggestion.
    queuedFields.add(field);
    requestAnimationFrame(() => {
      queuedFields.delete(field);
      if (field.isConnected) prefixField(field);
    });
  }

  function bindField(field) {
    if (!isCommitTitleField(field)) return;
    if (field.hasAttribute(BOUND_ATTR)) {
      suggestPrefix(field);
      return;
    }

    field.setAttribute(BOUND_ATTR, 'true');
    field.addEventListener('compositionstart', () => composingFields.add(field));
    field.addEventListener('input', (event) => {
      if (event.isComposing) composingFields.add(field);
      else suggestPrefix(field);
    });
    field.addEventListener('compositionend', () => {
      composingFields.delete(field);
      suggestPrefix(field);
    });
    suggestPrefix(field);
  }

  function scan(root = document) {
    if (!enabled) return;
    if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) bindField(root);
    if (!(root instanceof Document || root instanceof DocumentFragment || root instanceof Element)) return;

    root.querySelectorAll('input:not([type]), input[type="text"], textarea').forEach(bindField);
  }

  let scanQueued = false;
  const observer = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(() => {
      scanQueued = false;
      scan();
    });
  });
  const scanPage = () => scan();

  function setEnabled(value) {
    const nextEnabled = Boolean(value);
    if (enabled === nextEnabled) return;
    enabled = nextEnabled;
    observer.disconnect();
    document.removeEventListener('turbo:load', scanPage);
    document.removeEventListener('pjax:end', scanPage);
    window.removeEventListener('popstate', scanPage);
    if (!enabled) return;

    // Discover new editors and late initial titles without rewriting handled drafts.
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'placeholder'] });
    document.addEventListener('turbo:load', scanPage);
    document.addEventListener('pjax:end', scanPage);
    window.addEventListener('popstate', scanPage);
    scan();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.commitTitleEmojis) {
      setEnabled(changes.commitTitleEmojis.newValue);
    }
  });
  void chrome.storage.local.get({ commitTitleEmojis: false }).then(({ commitTitleEmojis }) => {
    setEnabled(commitTitleEmojis);
  });
})();
