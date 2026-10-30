(() => {
  'use strict';

  let enabled = false;
  const BOUND_ATTR = 'data-fractured-commit-emoji-bound';
  const WRITING_ATTR = 'data-fractured-commit-emoji-writing';
  const BUG_EMOJIS = ['🐛', '🐜', '🐝', '🐞', '🦗', '🕷️', '🦟'];
  const FINANCIAL_INCLUSION_EMOJIS = ['🌍', '🌎', '🌏'];
  const SECURITY_EMOJIS = [
    '📌', '📍', '📎', '🖇️', '📏', '📐', '✂️', '🧷', '🔒', '🔓', '🔏', '🔐', '🔑', '🗝️',
    '🔨', '🪓', '⛏️', '⚒️', '🛠️', '🧲', '🛡️', '🦯', '🔗', '⛓️', '⚗️', '🧪', '🧬', '🔬',
    '🔭', '💊', '🩹',
  ];
  const EMOJI_PREFIX_RE = /^\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?)*\s+/u;
  const COMMIT_ACTION_RE = /\b(commit changes|propose changes|merge pull request|squash and merge|rebase and merge|confirm merge|confirm squash|confirm rebase)\b/i;
  const CODE_PATH_RE = /\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|kt|kts|swift|php|cs|c|cc|cpp|h|hpp|scala|sh|zsh|fish|ps1|lua|ex|exs|erl|hrl|fs|fsx|vb|r|dart|sol|move|css|scss|sass|less|vue|svelte)$/i;
  const WRITING_PATH_RE = /\.(?:md|mdx|txt|rst|adoc|tex|org)$/i;
  const IMAGE_PATH_RE = /\.(?:svg|png|jpe?g|gif|webp|avif|ico)$/i;
  const CONFIG_PATH_RE = /(?:^|\/)(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|deno\.jsonc?|tsconfig[^/]*\.json|vite\.config\.[^/]+|webpack\.config\.[^/]+|[^/]+\.(?:ya?ml|toml|ini|conf|env))$/i;

  function includesAny(text, patterns) {
    return patterns.some((pattern) => (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)));
  }

  function repositoryKey() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : window.location.hostname;
  }

  function stableChoice(storageKey, choices) {
    const key = `studio-github-commit-emoji:${storageKey}:${repositoryKey()}`;

    try {
      const stored = window.localStorage.getItem(key);
      if (choices.includes(stored)) return stored;

      const choice = choices[Math.floor(Math.random() * choices.length)];
      window.localStorage.setItem(key, choice);
      return choice;
    } catch (error) {
      let hash = 0;
      for (const char of key) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
      return choices[Math.abs(hash) % choices.length];
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

  function isCommitTitleField(field) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
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

  function currentContext(field) {
    const scope = commitScope(field);
    const scopeText = (scope?.textContent || '').replace(/\s+/g, ' ').slice(0, 1500);
    return `${field.value}\n${decodeURIComponent(window.location.pathname)}\n${scopeText}`.toLowerCase();
  }

  function isCodeContext(text) {
    const path = decodeURIComponent(window.location.pathname);
    return CODE_PATH_RE.test(path) || includesAny(text, [
      /\b(code|function|class|component|runtime|script|parser|renderer|viewer|extension|build|compile|lint|typecheck|api)\b/,
      /\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|kt|swift|php|cs|c|cc|cpp|css|scss|vue|svelte)\b/,
    ]);
  }

  function classifyEmoji(title, field) {
    const text = currentContext(field);
    const path = decodeURIComponent(window.location.pathname).toLowerCase();

    if (/\b(fix(?:e[ds])?|bug|regression|broken|crash|fault|repair|restore)\b/.test(text) && isCodeContext(text)) {
      return stableChoice('bug', BUG_EMOJIS);
    }

    if (includesAny(text, [/\bsdex\b/, /stellar.{0,40}(?:decentralized exchange|dex)\b/, /\border ?book\b/, /\bstellar offer(?:s)?\b/])) return '💱';
    if (includesAny(text, [/\bsoroban\b/, /\bsmart contracts?\b/, /\bwasm\b.{0,40}\bstellar\b/, /\bstellar\b.{0,40}\bcontract\b/])) return '🧮';
    if (/\bdecentrali[sz](?:e|ed|ing|ation)\b/.test(text)) return '🌐';
    if (includesAny(text, ['financial inclusion', 'unbanked', 'underbanked'])) return stableChoice('financial-inclusion', FINANCIAL_INCLUSION_EMOJIS);
    if (includesAny(text, ['free-market', 'free market', 'free markets'])) return '📈';

    if (includesAny(text, [/\b(layout|spacing|alignment|align|center|centering|padding|margin|radius|typography|font|viewport|sidebar|toolbar|ui|ux)\b/])) return '🖌️';
    if (includesAny(text, [/\b(colou?r|theme|dark mode|light mode|contrast|palette|rgb|hex)\b/])) return '🎨';
    if (includesAny(text, [/\b(image|images|icon|icons|favicon|avatar|crop|cropping|screenshot|photo|svg|png|jpe?g|webp)\b/]) || IMAGE_PATH_RE.test(path)) return '🖼️';
    if (includesAny(text, [/\b(brand|branding|wordmark|banner|identity|display scheme)\b/])) return '✨';

    if (includesAny(text, [/\b(address|respond to|resolve)\b.{0,30}\b(review|feedback|comment)\b/, /\bpr feedback\b/, /\breview feedback\b/])) return '🤝';
    if (includesAny(text, [/\b(sync|synchroni[sz]e|rebase|merge|update)\b.{0,40}\bmain\b/, /\bmain\b.{0,40}\b(sync|rebase|merge)\b/])) return '🔄';

    if (/\b(code comment|inline comment|comments?)\b/.test(text)) return '💬';
    if (includesAny(text, ['scribble', 'sticky note', 'scratch note', 'rough note'])) return '💭';

    if (includesAny(text, ['freedom', 'liberty'])) return isCodeContext(text) ? '🦅' : '🕊️';
    if (includesAny(text, [/\b(policy|regulation|rulemaking|legal|law|compliance)\b/, /\b(?:cfr|usc|sec|congress|federal)\b/])) {
      return includesAny(text, [/\b(?:u\.?s\.?|united states|cfr|usc|sec|congress|federal)\b/]) ? '🗽' : '⚖️';
    }

    if (/\brefactor(?:ing|ed)?\b/.test(text)) return '🏗️';
    if (CONFIG_PATH_RE.test(path) || includesAny(text, [/\b(configuration|config|setting|settings|metric|metrics|threshold|limit)\b/])) return '⚙️';
    if (includesAny(text, [/\b(tune|tuning|parameter|parameters|adjust|adjusting)\b/])) return '🔧';
    if (includesAny(text, [/\b(connect|connecting|wire|wiring|integrate|integration|hook|bridge)\b/])) return '🔩';
    if (includesAny(text, [/\b(concise|simplif(?:y|ies|ied)|deduplicat(?:e|es|ed|ing)|reduce boilerplate|shorten code)\b/])) return '🗜️';
    if (includesAny(text, [/\b(package|dependency|dependencies|lockfile|npm|pnpm|yarn|bun)\b/]) || /(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)/.test(path)) return '🧰';

    if (includesAny(text, ['superstonk', 'gamestop', 'ape investor', 'ape movement'])) return '🦍';
    if (includesAny(text, ['my little pony', 'mlp', 'pony fandom'])) return '🦄';
    if (includesAny(text, [/\b(math|formula|equation|calculation|calculate)\b/])) return '🧾';

    if (includesAny(text, [/\b(delete|remove)\b.{0,30}\b(file|files)\b/, /^delete\b/])) return '🗑️';
    if (includesAny(text, [/\b(consolidate|consolidating|combine)\b.{0,30}\b(files|documents|items)\b/])) return '🗃️';
    if (includesAny(text, [/\b(reorganize|reorganizing|shuffle|reshuffle|restructure)\b.{0,30}\b(files|folders|directory|directories)\b/])) return '🗂️';
    if (/\barchive(?:s|d|ing)?\b/.test(text)) return '🗄️';
    if (includesAny(text, [/\b(add|create|new)\b.{0,30}\b(directory|folder)\b/])) return '📂';
    if (includesAny(text, [/\b(delete|remove)\b.{0,30}\b(directory|folder)\b/])) return '📁';

    if (includesAny(text, [/\b(draft|write|writing|compose|new copy)\b/])) return '✒️';
    if (includesAny(text, [/\b(revise|revision|rewrite|edit copy|update copy)\b/])) return '🖋️';
    if (includesAny(text, [/\b(grammar|grammatical|structure|structural|proofread)\b/])) return '🖊️';
    if (/\bfootnote\b/.test(text)) return '✏️';
    if (includesAny(text, [/\b(reference|rough reference|external link|url)\b/])) return '🖍️';
    if (includesAny(text, [/\b(multiple|several|many)\b.{0,20}\bsections?\b/, /\bbig diff\b/])) return '📝';
    if (includesAny(text, [/\b(placeholder|stub|skeleton|empty file)\b/])) return '🌱';
    if (includesAny(text, [/\b(network call|fetch\(|fetch request|http request|api request|xhr|websocket)\b/])) return '📡';
    if (includesAny(text, [/\b(test|tests|testing|security|secure|auth|permission|permissions|encrypt|encryption|vulnerability|threat)\b/])) return stableChoice('test-security', SECURITY_EMOJIS);

    if (WRITING_PATH_RE.test(path)) return /\b(add|create|new)\b/.test(title.toLowerCase()) ? '✒️' : '🖋️';
    if (CONFIG_PATH_RE.test(path)) return '⚙️';
    if (IMAGE_PATH_RE.test(path)) return '🖼️';
    if (CODE_PATH_RE.test(path)) return '🔧';
    return '🔧';
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
    if (!enabled || !isCommitTitleField(field) || field.hasAttribute(WRITING_ATTR)) return;

    const title = field.value.trim();
    if (!title || EMOJI_PREFIX_RE.test(title)) return;

    const emoji = classifyEmoji(title, field);
    const nextTitle = emoji === '🔄' ? '🔄 Sync brach to main' : `${emoji} ${title}`;

    field.setAttribute(WRITING_ATTR, 'true');
    try {
      setNativeValue(field, nextTitle);
    } finally {
      field.removeAttribute(WRITING_ATTR);
    }
  }

  function bindField(field) {
    if (!isCommitTitleField(field)) return;
    if (field.hasAttribute(BOUND_ATTR)) {
      prefixField(field);
      return;
    }

    field.setAttribute(BOUND_ATTR, 'true');
    const ensurePrefix = () => window.requestAnimationFrame(() => prefixField(field));
    field.addEventListener('change', ensurePrefix);
    field.addEventListener('blur', ensurePrefix);
    prefixField(field);
  }

  function scan(root = document) {
    if (!enabled) return;
    if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) bindField(root);
    if (!(root instanceof Document || root instanceof DocumentFragment || root instanceof Element)) return;

    root.querySelectorAll('input:not([type]), input[type="text"], textarea').forEach(bindField);
  }

  function beforeSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    form.querySelectorAll('input:not([type]), input[type="text"], textarea').forEach(prefixField);
  }

  function beforeClick(event) {
    const control = event.target instanceof Element
      ? event.target.closest('button, input[type="submit"], input[type="button"]')
      : null;
    if (!control || !COMMIT_ACTION_RE.test(control.textContent || control.value || '')) return;
    const scope = control.closest('form, [role="dialog"]') || document;
    scope.querySelectorAll('input:not([type]), input[type="text"], textarea').forEach(prefixField);
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
    document.removeEventListener('submit', beforeSubmit, true);
    document.removeEventListener('click', beforeClick, true);
    document.removeEventListener('turbo:load', scanPage);
    document.removeEventListener('pjax:end', scanPage);
    window.removeEventListener('popstate', scanPage);
    if (!enabled) return;

    // React can replace a generated title on an already bound input.
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
    document.addEventListener('submit', beforeSubmit, true);
    document.addEventListener('click', beforeClick, true);
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
