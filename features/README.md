# Feature scripts

Content scripts are grouped by the GitHub surface or behavior they customize:

- `commits/` — commit titles, messages, and merge forms.
- `interface/` — shared interface and navigation cleanups.
- `notifications/` — inbox controls and notification cleanup.
- `people/` — avatars, profile names, nicknames, and muting.
- `pull-requests/` — pull request and diff presentation.
- `repositories/` — repository pages, navigation, and shortcuts.
- `writing/spellcheck/` — GitHub spellcheck, image attachments, and the ChatGPT bridge.

## Adding or moving a feature

Keep each script self-contained and register its path under the appropriate
`content_scripts` entry in the root `manifest.json`. Preserve the current
script order when moving files: `profile-name-cache.js` initializes shared
profile-name utilities before the display-name scripts, while
`writing/spellcheck/image-attachments.js` must load before
`writing/spellcheck/issue-pr-drafts.js`. The ChatGPT spellcheck bridge is registered
separately for `chatgpt.com` at `document_idle`.

Name files for their role within the parent directory, without repeating its category:
`commits/message-simplifier.js`, `pull-requests/hide-participants.js`, and
`writing/spellcheck/image-dialog.js` are examples. Renames must also update
`manifest.json` and any test imports. Do not change settings keys when renaming.

CSS files remain directly in `features/`; their paths are declared separately
in `manifest.json`. Settings and storage keys are unchanged by this layout.
