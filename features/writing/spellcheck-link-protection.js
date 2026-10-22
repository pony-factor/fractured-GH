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
      const definition = /^[ \t]{0,3}\[[^\]\r\n]+\]:[^\r\n]+/.exec(rest);
      if (definition) return at + definition[0].length;
    }
    if (text[at] === '[' || text[at] === '!' || text[at] === '\\') {
      const end = markdownLinkEnd(text, at);
      if (end > at) return end;
    }
    const autolink = /^<https?:\/\/[^<>\s]+>/.exec(rest);
    if (autolink) return at + autolink[0].length;
    const url = /^https?:\/\/[^\s<>"'`]+/.exec(rest);
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
  function protect(original) {
    const source = { title: String(original?.title ?? ''), body: String(original?.body ?? '') };
    let marker = 'FRACTUREDLINKTOKEN';
    while ((source.title + source.body).includes(marker)) marker += 'X';
    const entries = [];
    const masked = {};
    for (const field of ['title', 'body']) {
      const value = source[field];
      let output = '';
      for (let i = 0; i < value.length;) {
        const end = protectedEnd(value, i);
        if (end <= i) { output += value[i]; i += 1; continue; }
        const token = `${marker}${entries.length}END`;
        entries.push({ token, literal: value.slice(i, end), field });
        output += token;
        i = end;
      }
      masked[field] = output;
    }
    return { source, masked, entries, marker };
  }
  // Also compares complete native HTML image tags, not just Markdown links.
  function sameLinks(before, after) {
    const first = protect(before).entries.map(({ field, literal }) => `${field}:${literal}`);
    const second = protect(after).entries.map(({ field, literal }) => `${field}:${literal}`);
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
      for (const entry of expected) result[field] = result[field].replace(entry.token, entry.literal);
    }
    if (!sameLinks(source, result)) {
      throw new Error('Spellcheck introduced or changed a Markdown link, URL, or HTML image. Nothing was applied.');
    }
    return result;
  }
  globalThis.fracturedSpellcheckLinks = { protect, restore, sameLinks };
})();
