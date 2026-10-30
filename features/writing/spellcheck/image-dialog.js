(() => {
  'use strict';

  const DIALOG_ID = 'fractured-image-dialog';
  const STYLE_ID = 'fractured-image-dialog-styles';
  let active = null;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#fractured-image-dialog { position: fixed; inset: 0; z-index: 100001; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(1,4,9,.58); }',
      '#fractured-image-dialog .fractured-image-panel { box-sizing: border-box; width: min(440px, 100%); max-height: calc(100vh - 32px); overflow: auto; background: var(--bgColor-default, #fff); color: var(--fgColor-default, #1f2328); border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 12px; box-shadow: 0 16px 48px rgba(1,4,9,.25); padding: 20px; }',
      '#fractured-image-dialog .fractured-image-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }',
      '#fractured-image-dialog .fractured-image-header h2 { font-size: 18px; line-height: 1.4; margin: 0; }',
      '#fractured-image-dialog .fractured-image-close { border: 0; background: transparent; color: inherit; border-radius: 6px; font-size: 23px; cursor: pointer; padding: 2px 8px; }',
      '#fractured-image-dialog .fractured-image-drop-zone { box-sizing: border-box; display: block; width: 100%; border: 2px dashed var(--borderColor-default, #8c959f); border-radius: 10px; background: var(--bgColor-muted, #f6f8fa); color: inherit; cursor: pointer; text-align: center; padding: 36px 14px; line-height: 1.5; font: inherit; }',
      '#fractured-image-dialog .fractured-image-drop-zone:hover, #fractured-image-dialog .fractured-image-drop-zone.is-dragover { border-color: var(--borderColor-accent-emphasis, #0969da); background: var(--bgColor-accent-muted, #ddf4ff); }',
      '#fractured-image-dialog .fractured-image-drop-zone:focus-visible, #fractured-image-dialog .fractured-image-close:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: 3px; }',
      '#fractured-image-dialog .fractured-image-hint { font-size: 12px; color: var(--fgColor-muted, #59636e); margin: 12px 0 0; }',
      '#fractured-image-dialog .fractured-image-status { font-size: 13px; margin: 12px 0 0; }',
      '#fractured-image-dialog .fractured-image-status[data-error="true"] { color: var(--fgColor-danger, #cf222e); }',
      '#fractured-image-dialog button[disabled] { cursor: progress; opacity: .6; }'
    ].join('\n');
    document.documentElement.append(style);
  }

  function close(restoreFocus = true) {
    if (!active || (active.busy && restoreFocus)) return;
    const previous = active;
    active = null;
    previous.overlay.remove();
    if (restoreFocus && previous.trigger.isConnected) previous.trigger.focus();
  }

  function open({ trigger, editor, add, onAdded }) {
    if (!editor?.isConnected || typeof add !== 'function') return;
    close(false);
    ensureStyles();

    const overlay = document.createElement('div');
    overlay.id = DIALOG_ID;
    const panel = document.createElement('section');
    panel.className = 'fractured-image-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'fractured-image-dialog-title');

    const header = document.createElement('div');
    header.className = 'fractured-image-header';
    const heading = document.createElement('h2');
    heading.id = 'fractured-image-dialog-title';
    heading.textContent = 'Add image';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'fractured-image-close';
    dismiss.setAttribute('aria-label', 'Close image picker');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => close());
    header.append(heading, dismiss);

    const zone = document.createElement('button');
    zone.type = 'button';
    zone.className = 'fractured-image-drop-zone';
    zone.textContent = 'Drop images here or click to select files';
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.multiple = true;
    picker.hidden = true;
    picker.className = 'fractured-rounded-image-picker';
    zone.addEventListener('click', () => picker.click());

    const hint = document.createElement('p');
    hint.className = 'fractured-image-hint';
    hint.textContent = 'Images are rounded and staged locally until you apply Spellcheck Only.';
    const status = document.createElement('p');
    status.className = 'fractured-image-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    panel.append(header, zone, picker, hint, status);
    overlay.append(panel);
    document.body.append(overlay);
    const dialog = { overlay, trigger, editor, busy: false };
    active = dialog;

    async function receive(incoming) {
      if (dialog.busy || active !== dialog) return;
      const files = Array.from(incoming || []);
      if (!files.length) return;
      if (files.some((file) => !file.type?.startsWith('image/'))) {
        status.dataset.error = 'true';
        status.textContent = 'Choose image files only.';
        return;
      }
      dialog.busy = true;
      zone.disabled = true;
      dismiss.disabled = true;
      picker.disabled = true;
      status.dataset.error = 'false';
      status.textContent = files.length === 1 ? 'Preparing image…' : 'Preparing images…';
      let count = 0;
      let succeeded = false;
      try {
        for (const file of files) {
          if (!editor.isConnected) throw new Error('The draft editor was closed.');
          await add(file);
          count += 1;
        }
        succeeded = true;
      } catch (error) {
        status.dataset.error = 'true';
        status.textContent = (count ? count + ' image(s) added. ' : '')
          + 'Could not add image: ' + (error?.message || 'Unknown error.');
      } finally {
        dialog.busy = false;
        zone.disabled = false;
        dismiss.disabled = false;
        picker.disabled = false;
        picker.value = '';
      }
      if (active !== dialog) return;
      if (count) onAdded?.(count);
      if (succeeded) close();
    }

    picker.addEventListener('change', () => receive(picker.files));
    let dragDepth = 0;
    zone.addEventListener('dragenter', (event) => {
      event.preventDefault();
      if (dialog.busy) return;
      dragDepth += 1;
      zone.classList.add('is-dragover');
    });
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('dragleave', (event) => {
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) zone.classList.remove('is-dragover');
    });
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      dragDepth = 0;
      zone.classList.remove('is-dragover');
      return receive(event.dataTransfer?.files);
    });
    // Avoid browser navigation if a file misses the drop target.
    overlay.addEventListener('dragover', (event) => event.preventDefault());
    overlay.addEventListener('drop', (event) => event.preventDefault());
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        // Keep keyboard focus within the two interactive modal controls.
        if (event.shiftKey && document.activeElement === dismiss) {
          event.preventDefault();
          zone.focus();
        } else if (!event.shiftKey && document.activeElement === zone) {
          event.preventDefault();
          dismiss.focus();
        }
      }
    });
    zone.focus();
  }

  document.addEventListener('turbo:before-cache', () => close(false));
  document.addEventListener('turbo:load', () => close(false));
  document.addEventListener('pjax:end', () => close(false));
  window.addEventListener('popstate', () => close(false));
  window.addEventListener('pagehide', () => close(false));

  globalThis.fracturedSpellcheckImageDialog = { open, close };
})();
