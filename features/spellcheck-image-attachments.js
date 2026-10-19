(() => {
  'use strict';

  // Image bytes stay in this tab until spellcheck is applied. Storage and the
  // ChatGPT bridge carry only the temporary Markdown references, never files.
  const pending = new Map();
  const PREFIX = 'fractured-pending-image:';
  const RADIUS_PX = 64 * (96 / 72); // 64 pt at the browser's 96 CSS px/in
  const UPLOAD_TIMEOUT_MS = 45000;

  function tokenFor(id, alt) {
    return `![${alt}](${PREFIX}${id})`;
  }

  function altFor(file) {
    return file.name.replace(/\.[^.]+$/, '').replace(/[\\\[\]\r\n]/g, ' ').trim() || 'Image';
  }

  function uuid() {
    return globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function setValue(field, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(field, value); else field.value = value;
    field.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: value,
    }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function roundedFile(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height } = bitmap;
      if (!width || !height || width * height > 40000000) {
        throw new Error('This image is too large to process safely.');
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing is unavailable in this browser.');
      const radius = Math.min(RADIUS_PX, width / 2, height / 2);
      context.beginPath();
      context.moveTo(radius, 0);
      context.lineTo(width - radius, 0);
      context.quadraticCurveTo(width, 0, width, radius);
      context.lineTo(width, height - radius);
      context.quadraticCurveTo(width, height, width - radius, height);
      context.lineTo(radius, height);
      context.quadraticCurveTo(0, height, 0, height - radius);
      context.lineTo(0, radius);
      context.quadraticCurveTo(0, 0, radius, 0);
      context.closePath();
      context.clip();
      context.drawImage(bitmap, 0, 0);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not encode the rounded image.');
      if (blob.size > 10 * 1024 * 1024) {
        throw new Error('The rounded PNG exceeds GitHub\'s 10 MB image limit.');
      }
      const name = `${altFor(file).replace(/[^a-zA-Z0-9._-]/g, '-')}-rounded.png`;
      return new File([blob], name, { type: 'image/png' });
    } finally {
      bitmap.close?.();
    }
  }

  async function add(editor, file) {
    const processed = await roundedFile(file);
    if (!editor.isConnected) throw new Error('The draft editor was closed.');
    const id = uuid();
    const alt = altFor(file);
    const token = tokenFor(id, alt);
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? start;
    const before = editor.value;
    setValue(editor, before.slice(0, start) + token + before.slice(end));
    editor.focus();
    editor.setSelectionRange?.(start + token.length, start + token.length);
    pending.set(id, { editor, token, alt, file: processed, status: 'pending' });
    return token;
  }

  function markers(value) {
    return [...String(value).matchAll(/fractured-pending-image:[\w-]+/g)].map(m => m[0]);
  }

  function validate(original, result) {
    // Spellcheck is not allowed to silently remove or rewrite attachments.
    const before = markers(original).sort();
    const after = markers(result).sort();
    return before.length === after.length && before.every((value, i) => value === after[i]);
  }

  function fileInputFor(editor) {
    const form = editor.closest('form, [role="dialog"]');
    const local = form || editor.parentElement;
    if (!local) return null;
    const choices = [...local.querySelectorAll('input[type="file"]')]
      .filter(input => !input.classList.contains('fractured-rounded-image-picker'));
    return choices.find(input => input.closest('file-attachment, [data-upload-policy]'))
      || choices.find(input => /image|png|jpeg|gif|\*/i.test(input.accept || ''))
      || choices[0] || null;
  }

  function beginNativeUpload(editor, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = fileInputFor(editor);
    // Prefer GitHub's own file-attachment control. The synthetic paste fallback
    // is useful on editor layouts whose native input is not exposed.
    if (input) {
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: transfer });
      editor.dispatchEvent(paste);
    }
  }

  function newAttachment(body, before) {
    // GitHub adds a Markdown attachment as soon as its native uploader finishes.
    const regex = /!?\[[^\]\r\n]*\]\((https:\/\/[^\s)]+)\)/g;
    for (const match of body.matchAll(regex)) {
      const url = match[1];
      if (!before.includes(url) && (
        /^https:\/\/github\.com\/user-attachments\/assets\//.test(url)
        || /^https:\/\/user-images\.githubusercontent\.com\//.test(url)
        || /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:assets|files)\//.test(url)
      )) return { markdown: match[0], url };
    }
    return null;
  }

  function waitForUpload(editor, before, token) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      function check() {
        if (!editor.isConnected) return reject(new Error('Draft editor closed during upload.'));
        if (!editor.value.includes(token)) {
          return reject(new Error('The image placeholder was edited during upload.'));
        }
        const added = newAttachment(editor.value, before);
        if (added) return resolve(added);
        if (Date.now() - started > UPLOAD_TIMEOUT_MS) {
          return reject(new Error('GitHub did not return an image attachment URL. The image remains pending.'));
        }
        setTimeout(check, 150);
      }
      check();
    });
  }

  async function finalize(editor) {
    let uploaded = 0;
    for (const item of pending.values()) {
      if (item.editor !== editor || !editor.value.includes(item.token)) continue;
      if (item.status === 'uploading') throw new Error('An image upload is already in progress.');
      item.status = 'uploading';
      try {
        const before = editor.value;
        editor.focus();
        editor.setSelectionRange?.(before.length, before.length);
        const result = waitForUpload(editor, before, item.token);
        beginNativeUpload(editor, item.file);
        const { markdown, url } = await result;
        const current = editor.value;
        if (!current.includes(markdown) || !current.includes(item.token)) {
          throw new Error('The draft changed unexpectedly during image upload.');
        }
        // Remove GitHub's appended link and replace our *original* placeholder,
        // leaving one inline Markdown image at the author's chosen position.
        const finalText = current.replace(markdown, '').replace(
          item.token, `![${item.alt}](${url})`,
        );
        setValue(editor, finalText);
        pending.delete(item.token.slice(item.token.indexOf(PREFIX) + PREFIX.length, -1));
        uploaded += 1;
      } catch (error) {
        item.status = 'pending';
        throw error;
      }
    }
    return uploaded;
  }

  function hasUnresolved(editor) {
    return markers(editor.value).length > 0;
  }

  function preventUnresolvedSubmission(event, editor) {
    if (!hasUnresolved(editor)) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    alert('Images are still pending. Apply Spellcheck Only and complete the GitHub upload before submitting.');
  }

  globalThis.fracturedSpellcheckImages = {
    add, finalize, validate, hasUnresolved, preventUnresolvedSubmission,
  };
})();
