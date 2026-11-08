(() => {
  'use strict';

  const DIALOG_ID = 'fractured-spellcheck-submit-warning';
  const STYLE_ID = 'fractured-spellcheck-submit-warning-styles';
  const reviewedDrafts = new WeakMap();
  const approvedDrafts = new WeakMap();
  const boundControls = new WeakMap();

  function snapshot(fields) {
    return JSON.stringify([fields.title?.value ?? '', fields.body.value]);
  }

  function markChecked(fields) {
    reviewedDrafts.set(fields.body, snapshot(fields));
    approvedDrafts.delete(fields.body);
  }

  function markUnchecked(fields) {
    reviewedDrafts.delete(fields.body);
    approvedDrafts.delete(fields.body);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#fractured-spellcheck-submit-warning {',
      ' background: var(--bgColor-default, #fff);',
      ' border: 1px solid var(--borderColor-default, #d0d7de);',
      ' border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,.3);',
      ' box-sizing: border-box; color: var(--fgColor-default, #1f2328);',
      ' max-width: min(500px, calc(100vw - 32px)); padding: 22px; width: 100%;',
      '}',
      '#fractured-spellcheck-submit-warning::backdrop { background: rgba(0,0,0,.48); }',
      '#fractured-spellcheck-submit-warning h2 { font-size: 18px; line-height: 1.4; margin: 0 0 10px; }',
      '#fractured-spellcheck-submit-warning p { color: var(--fgColor-muted, #59636e);',
      ' font-size: 14px; line-height: 1.5; margin: 0 0 20px; }',
      '#fractured-spellcheck-submit-warning .fractured-spellcheck-warning-actions {',
      ' display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }',
      '#fractured-spellcheck-submit-warning button {',
      ' background: var(--button-default-bgColor-rest, #f6f8fa);',
      ' border: 1px solid var(--button-default-borderColor-rest, #d0d7de);',
      ' border-radius: 6px; color: var(--button-default-fgColor-rest, #24292f);',
      ' cursor: pointer; font: inherit; font-size: 14px; padding: 8px 12px; }',
      '#fractured-spellcheck-submit-warning button[data-primary="true"] {',
      ' background: var(--button-primary-bgColor-rest, #1f883d);',
      ' border-color: var(--button-primary-borderColor-rest, #1f883d);',
      ' color: var(--button-primary-fgColor-rest, #fff); }',
      '#fractured-spellcheck-submit-warning button:focus-visible {',
      ' outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: 2px; }',
    ].join('\n');
    document.documentElement.append(style);
  }

  function showWarning(fields, submitControl, spellcheckControl) {
    if (document.getElementById(DIALOG_ID)) return;
    injectStyles();

    const dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.setAttribute('aria-labelledby', 'fractured-spellcheck-submit-title');
    dialog.setAttribute('aria-describedby', 'fractured-spellcheck-submit-description');
    const heading = document.createElement('h2');
    heading.id = 'fractured-spellcheck-submit-title';
    heading.textContent = 'Submit without spellchecking?';
    const description = document.createElement('p');
    description.id = 'fractured-spellcheck-submit-description';
    description.textContent = 'This draft has not been spellchecked, or has changed since its last spellcheck. You can check it first or submit it unchanged.';
    const actions = document.createElement('div');
    actions.className = 'fractured-spellcheck-warning-actions';

    const close = () => {
      dialog.close();
      dialog.remove();
    };
    const actionButton = (label, callback, primary = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (primary) button.setAttribute('data-primary', 'true');
      button.addEventListener('click', callback);
      actions.append(button);
      return button;
    };
    const cancel = actionButton('Cancel', close);
    actionButton('Submit without spellcheck', () => {
      close();
      // Only the exact draft the user approved may bypass the warning.
      if (!fields.body.isConnected || !submitControl.isConnected) return;
      approvedDrafts.set(fields.body, snapshot(fields));
      submitControl.click();
    });
    actionButton('Run Spellcheck Only', () => {
      close();
      if (spellcheckControl.isConnected) spellcheckControl.click();
    }, true);

    dialog.append(heading, description, actions);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  }

  function intercept(event, fields, submitControl, spellcheckControl) {
    if (!fields.body.isConnected || !submitControl.isConnected) return false;

    // Retain the existing hard block for provisional image placeholders.
    const images = globalThis.fracturedSpellcheckImages;
    if (images?.hasUnresolved?.(fields.body)) {
      images.preventUnresolvedSubmission(event, fields.body);
      return true;
    }

    const current = snapshot(fields);
    if (approvedDrafts.get(fields.body) === current) {
      if (event.type === 'submit') {
        // Other controls in the same form can have their own capture listeners.
        // Clear the one-shot approval after this whole submit event finishes.
        queueMicrotask(() => {
          if (approvedDrafts.get(fields.body) === current) approvedDrafts.delete(fields.body);
        });
      }
      return false;
    }
    if (reviewedDrafts.get(fields.body) === current) return false;

    event.preventDefault();
    event.stopImmediatePropagation?.();
    showWarning(fields, submitControl, spellcheckControl);
    return true;
  }

  function bind(submitControl, fields, spellcheckControl, scope) {
    boundControls.set(submitControl, { fields, spellcheckControl });
    // Capture before GitHub's delegated click/submit handlers run.
    submitControl.addEventListener('click', (event) => {
      intercept(event, fields, submitControl, spellcheckControl);
    }, true);
    scope?.addEventListener('submit', (event) => {
      if (!event.submitter || event.submitter === submitControl) {
        intercept(event, fields, submitControl, spellcheckControl);
      }
    }, true);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)
      || event.altKey || event.shiftKey || event.isComposing || event.repeat) return;

    // Cmd/Ctrl+Enter may invoke a React submit handler without a form event.
    // Capture the shortcut before GitHub and resume through its original button.
    for (const control of document.querySelectorAll('[data-fractured-spellcheck-bound]')) {
      const binding = boundControls.get(control);
      if (!binding || !control.isConnected || control.disabled) continue;
      const { fields, spellcheckControl } = binding;
      if (event.target !== fields.body && event.target !== fields.title
        && !fields.body.contains?.(event.target)) continue;
      intercept(event, fields, control, spellcheckControl);
      return;
    }
  }, true);

  globalThis.fracturedSpellcheckSubmitConfirmation = { bind, markChecked, markUnchecked };
})();
