(function installLinkProtection() {
  'use strict';
  // Send opaque markers instead of link syntax or URL bytes to the model.
  function closingDelimiter(text, start, opener, closer) {
    let depth = 1;
    for (let i = start + 1; i < text.length; i += 1) {
      if (text[i] === '\\' && i + 1 < text.length) { i += 1; continue; }
      if (text[i] === opener) depth += 1;
      if (text[i] === closer && --depth === 0) return i + 1;
    }
    return -1;
  }
  function markdownLinkEnd(text, start) {
    let i = start + (text[start] === '!' ? 1 : 0);
    if (text.slice(i, i + 2) === '\\[') {
      const match = /^\\\[[^\r\n]*?\\\]\\\(/.exec(text.slice(i));
      if (!match) return -1;
      const close = text.indexOf('\\)', i + match[0].length);
      return close < 0 ? -1 : close + 2;
    }
    if (text[i] !== '[') return -1;
    const bracketEnd = closingDelimiter(text, i, '[', ']');
    if (bracketEnd < 0) return -1;
    if (text.slice(bracketEnd, bracketEnd + 2) === '\\(') {
      const close = text.indexOf('\\)', bracketEnd + 2);
      return close < 0 ? -1 : close + 2;
    }
    if (text[bracketEnd] === '(') return closingDelimiter(text, bracketEnd, '(', ')');
    if (text[bracketEnd] === '[') return closingDelimiter(text, bracketEnd, '[', ']');
    return -1;
  }
  // Native GitHub uploads often use <img src="..."> rather than Markdown.
  // Protect the entire tag, including its alt text, dimensions and URL, so
  // spellcheck cannot turn a src value into a Markdown link or rewrite it.
  function htmlImageEnd(text, at) {
    if (text[at] !== '<' || text.slice(at, at + 4).toLowerCase() !== '<img'
      || !/[\s/>]/.test(text[at + 4] || '')) return -1;
    let quote = '';
    for (let i = at + 4; i < text.length; i += 1) {
      const character = text[i];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        return i + 1;
      }
    }
    return -1;
  }
  function protectedEnd(text, at) {
    const imageEnd = htmlImageEnd(text, at);
    if (imageEnd > at) return imageEnd;
    const rest = text.slice(at);
    if (at === 0 || text[at - 1] === '\n') {
      const definition = /^[ \t]{0,3}\[(?!\^)[^\]\r\n]+\]:[^\r\n]+/.exec(rest);
      if (definition) return at + definition[0].length;
    }
    if (text[at] === '[' || text[at] === '!' || text[at] === '\\') {
      const end = markdownLinkEnd(text, at);
      if (end > at) return end;
    }
    const autolink = /^<https?:\/\/[^<>\s]+>/.exec(rest);
    if (autolink) return at + autolink[0].length;
    // GitHub issues also auto-link scheme-less github.com and www URLs.
    // Preserve those exact bytes just like fully-qualified raw URLs.
    const url = /^(?:https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|github\.com(?![\w.-])(?:\/[^\s<>"'`]+)?)/i.exec(rest);
    if (!url) return -1;
    let literal = url[0];
    while (/[.,;:!?]$/.test(literal)) literal = literal.slice(0, -1);
    while (literal.endsWith(')')) {
      const opens = (literal.match(/\(/g) || []).length;
      const closes = (literal.match(/\)/g) || []).length;
      if (closes <= opens) break;
      literal = literal.slice(0, -1);
    }
    return literal.length > 'https://'.length ? at + literal.length : -1;
  }
  // A raw URL is not interchangeable with a Markdown-wrapped or code-formatted
  // URL, even when the destination bytes are unchanged. Capture the adjacent
  // markup (but not ordinary sentence punctuation) for each bare link.
  function rawLinkPresentation(text, start, end) {
    const before = text.slice(0, start);
    const after = text.slice(end);
    const opening = /(?:\\?\[|<|`+|\*+|_+)$/.exec(before)?.[0] || '';
    const closing = /^(?:\\?\]|>|`+|\*+|_+)/.exec(after)?.[0] || '';
    return opening + '\0' + closing;
  }
  function codeEnd(text, at) {
    if (text[at] !== '`' && text.slice(at, at + 3) !== '~~~') return -1;
    const run = /^(?:`+|~{3,})/.exec(text.slice(at))[0];
    const end = text.indexOf(run, at + run.length);
    return end < 0 ? text.length : end + run.length;
  }

  // Pair only unambiguous, single-caret placeholders. Leave unmatched markers
  // alone rather than inventing footnote content or guessing at repeated carets.
  function footnotes(text) {
    const references = [];
    const definitions = [];
    for (let i = 0; i < text.length;) {
      const end = Math.max(codeEnd(text, i), protectedEnd(text, i));
      if (end > i) { i = end; continue; }
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '^' && text[i - 1] !== '^' && text[i + 1] !== '^') {
        const line = text.slice(text.lastIndexOf('\n', i - 1) + 1, i);
        if (/^[ \t]{0,3}$/.test(line) && /\S/.test(text[i + 1] || '')) {
          definitions.push(i);
        } else if (/^[ \t]{0,3}$/.test(line) && /^[ \t]+\S/.test(text.slice(i + 1))) {
          definitions.push(i);
        } else if (/\S/.test(line) && (!text[i + 1] || /[\s.,;:!?)]/.test(text[i + 1]))) {
          references.push(i);
        }
      }
      i += 1;
    }
    if (!references.length || references.length !== definitions.length
      || references.some((at, index) => at > definitions[index])) return text;
    const used = new Set(Array.from(text.matchAll(/\[\^([^\]\n]+)\]/g), match => match[1]));
    const replacements = new Map();
    let number = 1;
    references.forEach((at, index) => {
      while (used.has(String(number))) number += 1;
      const label = String(number++);
      replacements.set(at, `[^${label}]`);
      replacements.set(definitions[index], `[^${label}]:` + (/\s/.test(text[definitions[index] + 1]) ? '' : ' '));
    });
    return text.split('').map((character, i) => replacements.get(i) || character).join('');
  }

  function syntaxEnd(text, at) {
    const code = codeEnd(text, at);
    if (code > at) return code;
    const match = /^(?:\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|\[\^[^\]\r\n]+\](?::)?|[_*]+)/.exec(text.slice(at));
    return match ? at + match[0].length : -1;
  }
  function protect(original) {
    const source = { title: String(original?.title ?? ''), body: String(original?.body ?? '') };
    let marker = 'FRACTUREDLINKTOKEN';
    while ((source.title + source.body).includes(marker)) marker += 'X';
    const entries = [];
    const masked = {};
    for (const field of ['title', 'body']) {
      const value = field === 'body' ? footnotes(source[field]) : source[field];
      let output = '';
      for (let i = 0; i < value.length;) {
        const linkEnd = protectedEnd(value, i);
        const end = linkEnd > i ? linkEnd : syntaxEnd(value, i);
        if (end <= i) { output += value[i]; i += 1; continue; }
        const token = `${marker}${entries.length}END`;
        const literal = value.slice(i, end);
        const presentation = /^(?:https?:\/\/|www\.|github\.com(?:\/|$))/i.test(literal)
          ? rawLinkPresentation(value, i, end) : null;
        entries.push({ token, literal, field, presentation, kind: linkEnd > i ? 'link' : 'syntax' });
        output += token;
        i = end;
      }
      masked[field] = output;
    }
    return { source, masked, entries, marker };
  }
  // Also compares complete native HTML image tags, not just Markdown links.
  function sameLinks(before, after) {
    const signature = ({ field, literal, presentation }) =>
      JSON.stringify([field, literal, presentation]);
    const first = protect(before).entries.filter(entry => entry.kind === 'link').map(signature);
    const second = protect(after).entries.filter(entry => entry.kind === 'link').map(signature);
    return first.length === second.length && first.every((value, i) => value === second[i]);
  }
  function restore(protectedDraft, response) {
    const result = { title: String(response?.title ?? ''), body: String(response?.body ?? '') };
    const { marker, entries, source } = protectedDraft;
    const tokenPattern = new RegExp(`${marker}\\d+END`, 'g');
    for (const field of ['title', 'body']) {
      const expected = entries.filter((entry) => entry.field === field);
      const actual = result[field].match(tokenPattern) || [];
      if (actual.length !== expected.length || actual.some((token, i) => token !== expected[i].token)) {
        throw new Error('Spellcheck altered, omitted, duplicated, or reordered a protected Markdown link, URL, or HTML image. Nothing was applied.');
      }
      // Opaque markers have no Markdown meaning. Discard escapes the model
      // introduced immediately before them before restoring the authored bytes.
      for (const entry of expected) {
        result[field] = result[field].replace(new RegExp('\\\\+(?=' + entry.token + ')', 'g'), '');
      }
      for (const entry of expected) {
        result[field] = result[field].replace(entry.token, () => entry.literal);
      }
      const escapes = value => value.match(/\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/g) || [];
      const originalEscapes = escapes(source[field]);
      const returnedEscapes = escapes(result[field]);
      if (returnedEscapes.length !== originalEscapes.length
        || returnedEscapes.some((escape, i) => escape !== originalEscapes[i])) {
        throw new Error('Spellcheck changed Markdown escaping. Nothing was applied.');
      }
    }
    if (!sameLinks(source, result)) {
      throw new Error('Spellcheck introduced or changed a Markdown link, URL, or HTML image. Nothing was applied.');
    }
    return result;
  }
  globalThis.fracturedSpellcheckLinks = { protect, restore, sameLinks };
})();
