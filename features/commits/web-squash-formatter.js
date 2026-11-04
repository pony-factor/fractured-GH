(() => {
  "use strict";
  const MARK = "data-fractured-squash-format-button";
  const TRAILER = /^Co-authored-by:\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/i;
  const SYNC = /^(?:🔄\s*)?Sync (?:brach|branch) to main(?:\s*\(#\d+\))?$/i;
  const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})/u;
  const CODEX = "Co-authored-by: Codex (Web) <noreply@openai.com>";
  const selectors = "input:not([type]), input[type=\"text\"], textarea";
  let settings = { webSquashFormattingEnabled: false, webSquashOmitEmojiBullets: false,
    webSquashFilterSync: true, webSquashSeparator: "underscores" };
  let pending = false;

  function prInfo() {
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(location.pathname);
    return match ? { number: Number(match[3]), owner: match[1], repository: match[2] } : null;
  }

  function squashTitle(title, number) {
    const cleaned = String(title).trim().replace(/\s+/g, " ");
    const suffix = " (#" + number + ")";
    return cleaned.endsWith(suffix) ? cleaned : cleaned + suffix;
  }

  function detailLines(lines) {
    const output = [];
    let fence = false;
    for (const raw of lines) {
      const text = raw.trim();
      if (!text) {
        if (output.length && output[output.length - 1]) output.push("");
        continue;
      }
      if (/^\x60{3}/.test(text)) fence = !fence;
      if (fence || /^\x60{3}/.test(text)) {
        output.push("    " + text);
        continue;
      }
      let current = "    ";
      for (const word of text.split(/\s+/)) {
        if (current.trim() && current.length + word.length + 1 > 88) {
          output.push(current);
          current = "    ";
        }
        current += (current.trim() ? " " : "") + word;
      }
      output.push(current);
    }
    while (output[output.length - 1] === "") output.pop();
    return output;
  }

  function squashBody(original, prefs = {}) {
    const entries = [];
    const credits = [];
    let trailers = false;
    for (const line of String(original || "").replace(/\r\n?/g, "\n").split("\n")) {
      const credit = line.match(TRAILER);
      if (credit) {
        credits.push({ name: credit[1], email: credit[2] });
        trailers = true;
      } else if (trailers) {
        if (line.trim() && !/^(?:__________|---------)$/.test(line.trim())) return null;
      } else if (/^(?:__________|---------)$/.test(line.trim())) {
        continue;
      } else if (/^[-*]\s+\S/.test(line)) {
        entries.push({ subject: line.replace(/^[-*]\s+/, "").trim(), body: [] });
      } else if (!line.trim()) {
        if (entries.length) entries[entries.length - 1].body.push("");
      } else if (entries.length && /^\s/.test(line)) {
        entries[entries.length - 1].body.push(line);
      } else {
        return null;
      }
    }
    if (!entries.length) return null;
    const kept = entries.filter(entry => prefs.webSquashFilterSync === false || !SYNC.test(entry.subject));
    const omitBullets = prefs.webSquashOmitEmojiBullets === true && kept.length > 0
      && kept.every(entry => EMOJI.test(entry.subject));
    const summary = kept.map(entry => {
      const body = detailLines(entry.body);
      return (omitBullets ? "" : "- ") + entry.subject
        + (body.length ? "\n" + body.join("\n") : "");
    }).join(omitBullets ? "\n\n" : "\n");

    const seen = new Set();
    const authors = [];
    for (const item of [...credits, { name: "Codex (Web)", email: "noreply@openai.com" }]) {
      const codex = /codex/i.test(item.name) && item.email.toLowerCase() === "noreply@openai.com";
      const key = codex ? "codex" : (item.name + "<" + item.email + ">").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      authors.push(codex ? CODEX : "Co-authored-by: " + item.name + " <" + item.email + ">");
    }
    const separator = { underscores: "__________", hyphens: "---------", none: "" }[
      prefs.webSquashSeparator] ?? "__________";
    return [summary, separator, authors.join("\n")].filter(Boolean).join("\n\n");
  }

  function descriptor(field) {
    const labels = field.labels ? [...field.labels].map(label => label.textContent || "") : [];
    return [field.id, field.name, field.getAttribute("aria-label"), ...labels]
      .filter(Boolean).join(" ").replace(/[_-]/g, " ").toLowerCase();
  }

  function mergeFields(scope) {
    const fields = [...scope.querySelectorAll(selectors)];
    const title = scope.querySelector("#merge_title_field") || fields.find(field =>
      /(?:merge|commit).{0,20}(?:title|subject)/.test(descriptor(field)));
    const body = scope.querySelector("#merge_message_field") || fields.find(field =>
      field !== title && /(?:merge|commit).{0,20}(?:message|description|body)/.test(descriptor(field)));
    return title && body ? { title, body } : null;
  }

  function isSquash(scope) {
    return [...scope.querySelectorAll("button, input[type=\"submit\"]")].some(button =>
      /^(?:confirm\s+)?squash and merge$/i.test(
        (button.textContent || button.value || "").trim().replace(/\s+/g, " ")));
  }

  function prTitle(number) {
    const element = document.querySelector(".js-issue-title, [data-testid=\"issue-title\"], h1 bdi");
    return element ? (element.textContent || "").trim().replace(
      new RegExp("\\s*#" + number + "\\s*$"), "") : "";
  }

  function update(field, value) {
    const prototype = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function apply(scope, status) {
    const pr = prInfo();
    const fields = mergeFields(scope);
    const title = pr && prTitle(pr.number);
    if (!pr || !fields || !title || !isSquash(scope)) return;
    const body = squashBody(fields.body.value, settings);
    if (body === null) {
      status.textContent = "The original commit list is unavailable; the merge message was not changed.";
      return;
    }
    const subject = squashTitle(title, pr.number);
    if (fields.title.value !== subject) update(fields.title, subject);
    if (fields.body.value !== body) update(fields.body, body);
    status.textContent = "SweetieBot formatting applied. Review before confirming the merge.";
  }

  function scan() {
    if (!settings.webSquashFormattingEnabled || !prInfo()) return;
    for (const scope of document.querySelectorAll("#merge_pull_request_form, form, [role=\"dialog\"]")) {
      const fields = mergeFields(scope);
      if (!fields || !isSquash(scope) || scope.querySelector("[" + MARK + "]")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "Button Button--secondary Button--small";
      button.setAttribute(MARK, "");
      button.textContent = "Apply SweetieBot formatting";
      const status = document.createElement("span");
      status.setAttribute("role", "status");
      status.style.marginLeft = "0.5rem";
      button.addEventListener("click", () => apply(scope, status));
      fields.body.insertAdjacentElement("afterend", button);
      button.insertAdjacentElement("afterend", status);
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; scan(); });
  }

  const observer = new MutationObserver(schedule);
  function configure(next) {
    settings = { ...settings, ...next };
    observer.disconnect();
    if (!settings.webSquashFormattingEnabled) {
      document.querySelectorAll("[" + MARK + "]").forEach(button => {
        if (button.nextElementSibling?.getAttribute("role") === "status") button.nextElementSibling.remove();
        button.remove();
      });
      return;
    }
    observer.observe(document, { childList: true, subtree: true });
    schedule();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = {};
    for (const key of Object.keys(settings)) if (changes[key]) next[key] = changes[key].newValue;
    if (Object.keys(next).length) configure(next);
  });
  void chrome.storage.local.get(settings).then(configure);
  document.addEventListener("turbo:load", schedule);
  document.addEventListener("pjax:end", schedule);
  window.addEventListener("popstate", schedule);
})();