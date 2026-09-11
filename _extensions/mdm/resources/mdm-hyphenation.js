// Liang's pattern algorithm, shared by the editor and the exported page.
// Only the opportunities are decorated: a CSS soft hyphen paints at a wrap,
// never enters the text, and disappears as soon as the word fits again.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./hyphenation-patterns.js"));
  } else {
    root.MDM_HYPHENATION = factory(root.MDM_HYPHENATION_PATTERNS);
    document.addEventListener("DOMContentLoaded", function () {
      const main = document.querySelector("main.content");
      if (main && getComputedStyle(document.documentElement)
        .getPropertyValue("--mdm-hyphenation").trim() === "auto") {
        root.MDM_HYPHENATION.decorate(main);
      }
    });
  }
})(typeof globalThis === "object" ? globalThis : this, function (patterns) {
  "use strict";
  const languages = Object.create(null);
  const cache = new Map();

  function language(header) {
    // Only a top-level, plain BCP 47 tag; nested format settings and text
    // inside a YAML block scalar must not change the document's language.
    // A header that names none gives no language, and no language divides
    // nothing. Quarto would call that document English (it hands the filter
    // `lang: en` and writes `<html lang="en">`, measured on 1.9.37), but
    // English patterns over prose in another language cut words where it has
    // no syllable break, which is the trap TeX falls into without babel.
    const match = /^lang:[ \t]*["']?([a-z]{2,3}(?:-[a-z0-9]+)*)["']?[ \t]*(?:#.*)?$/im.exec(header || "");
    return match ? match[1].toLowerCase() : "";
  }

  function dictionary(lang) {
    if (!patterns[lang]) return null;
    if (languages[lang]) return languages[lang];
    const trie = Object.create(null), exceptions = Object.create(null), alphabet = new Set();
    patterns[lang].patterns.split(" ").forEach(function (pattern) {
      let node = trie, at = 0;
      const weights = [0];
      for (const ch of pattern) {
        if (ch >= "0" && ch <= "9") weights[at] = Number(ch);
        else {
          alphabet.add(ch);
          node = node[ch] || (node[ch] = Object.create(null));
          weights[++at] = 0;
        }
      }
      node.weights = weights;
    });
    patterns[lang].exceptions.split(" ").filter(Boolean).forEach(function (word) {
      let at = 0;
      exceptions[word.replace(/-/g, "")] = word.split("-").slice(0, -1).map(function (part) {
        return at += part.length;
      });
    });
    return languages[lang] = { trie: trie, exceptions: exceptions, alphabet: alphabet };
  }

  function positions(word, languageTag) {
    if (!languageTag) return []; // no language, no division (see language())
    const lang = languageTag.toLowerCase().split("-")[0];
    // Three letters on either side keeps short fragments off both margins.
    // Acronyms, identifiers, compounds and decomposed accents stay intact.
    if (word.length < 6 || word.length > 80 || word === word.toUpperCase() ||
      word !== word.normalize("NFC") || !/^\p{L}+$/u.test(word)) return [];
    const dict = dictionary(lang);
    if (!dict) return [];
    const lower = word.toLowerCase(), key = lang + ":" + lower;
    if ([...lower].some(function (ch) { return !dict.alphabet.has(ch); })) return [];
    if (cache.has(key)) return cache.get(key);
    let cuts = dict.exceptions[lower];
    if (!cuts) {
      const padded = "." + lower + ".", weights = new Uint8Array(padded.length + 1);
      for (let i = 0; i < padded.length; i++) {
        let node = dict.trie;
        for (let j = i; j < padded.length && (node = node[padded[j]]); j++) {
          if (node.weights) node.weights.forEach(function (weight, k) {
            weights[i + k] = Math.max(weights[i + k], weight);
          });
        }
      }
      cuts = [];
      for (let i = 3; i <= word.length - 3; i++) if (weights[i + 1] % 2) cuts.push(i);
    }
    cuts = cuts.filter(function (at) { return at >= 3 && at <= word.length - 3; });
    if (cache.size >= 4096) cache.clear();
    cache.set(key, cuts);
    return cuts;
  }

  function segments(text, lang) {
    const spans = [];
    // Consume a whole URL/identifier even though it is not a prose word.
    const words = /(?:https?:\/\/|www\.)[^\s]+|[\p{L}\p{M}\p{N}_'’\u00ad-]+/gu;
    let word;
    while ((word = words.exec(text))) {
      let from = word.index;
      positions(word[0], lang).forEach(function (at) {
        const to = word.index + at;
        spans.push({ from: from, to: to });
        from = to;
      });
    }
    return spans;
  }

  function decorate(main) {
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode, el = node.parentElement;
      if (el.closest("p, li, blockquote") &&
        !el.closest("pre, code, kbd, samp, script, style, svg, math, .math, .katex, .mdm-hyphen, h1, h2, h3, h4, h5, h6")) nodes.push(node);
    }
    nodes.forEach(function (node) {
      const el = node.parentElement.closest("[lang]");
      const spans = segments(node.data, el ? el.lang : "");
      if (!spans.length) return;
      const fragment = document.createDocumentFragment();
      let from = 0;
      spans.forEach(function (span) {
        fragment.appendChild(document.createTextNode(node.data.slice(from, span.to - 1)));
        const mark = document.createElement("span");
        mark.className = "mdm-hyphen";
        mark.textContent = node.data.slice(span.to - 1, span.to);
        fragment.appendChild(mark);
        from = span.to;
      });
      fragment.appendChild(document.createTextNode(node.data.slice(from)));
      node.replaceWith(fragment);
    });
  }

  return { language: language, positions: positions, segments: segments, decorate: decorate };
});
