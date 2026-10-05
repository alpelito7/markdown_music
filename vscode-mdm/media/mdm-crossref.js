// Equations by number and the references to them, as Quarto prints them: a
// display equation with a label after its closing `$$` (`$$ {#eq-mass}`) is
// numbered, and `@eq-mass` reads "Equation 1". The export does this in its
// filter (the equations pass in mdm.lua, where the reasons are), and the
// editor draws what the export prints, so the rules are written twice, once
// in Lua and once here, and both are Quarto's own (equations.lua and refs.lua
// among its filters, read on 1.9.37, and every form below checked against
// what `quarto render` printed on 2026-09-30). Shared by the webview and the
// tests, and written so that none of it needs a DOM: the webview finds the
// equations in its syntax tree and hands this their text. The numbers of
// the sections (`number-sections`) are counted here too, by Quarto's rules
// again (Sections by number, below), and so is what the header puts at the
// head of the page (The title block, at the end).
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MDM_CROSSREF = factory();
  }
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  // What an equation is called before its number, by the language of the
  // document: `crossref-eq-prefix` in each of Quarto's language files
  // (share/language/_language-<tag>.yml of 1.9.37), and "" for the file
  // with no tag, which is English. A file that names no prefix of its own
  // (fr-CA) is not listed, and falls to its base language as Quarto's does.
  // tests/crossref.test.js holds this against the files of an installed
  // Quarto, so a Quarto that translates otherwise shows up there.
  const PREFIXES = {
    "": "Equation",
    bg: "Уравнение",
    ca: "Equació",
    cs: "Rovnice",
    da: "Ligning",
    de: "Gleichung",
    "de-CH": "Gleichung",
    el: "Εξίσωση",
    es: "Ecuación",
    eu: "Ekuazioa",
    fi: "Yhtälö",
    fr: "Équation",
    he: "משוואה",
    id: "Perhitungan",
    is: "Jafna",
    it: "Equazione",
    ja: "式",
    ko: "방정식",
    lt: "Lygtis",
    nb: "Ligning",
    nl: "Vergelijking",
    nn: "Likning",
    pl: "Równanie",
    pt: "Equação",
    "pt-BR": "Equação",
    ru: "Уравнение",
    sk: "Rovnica",
    sl: "Enakost",
    "sr-Latn": "Jednačina",
    sv: "Ekvation",
    tr: "Eşitlik",
    ua: "Рівняння",
    zh: "式",
    "zh-TW": "方程式",
  };

  // The prefix of a language tag as Quarto finds it: the file of the tag
  // itself, then the one of its first part, then English. The tag is matched
  // as written, so `ES` is English and `es-MX` Spanish, and Ukrainian is
  // `ua`, the name Quarto gives its file: `uk` prints "Equation" (all of it
  // measured on 1.9.37).
  function languagePrefix(lang) {
    const tag = String(lang || "");
    if (tag && Object.prototype.hasOwnProperty.call(PREFIXES, tag)) return PREFIXES[tag];
    const base = tag.split("-")[0];
    if (base && Object.prototype.hasOwnProperty.call(PREFIXES, base)) return PREFIXES[base];
    return PREFIXES[""];
  }

  // ---------- The header ----------
  //
  // The few keys of the YAML header that change what an equation is called
  // and numbered: `lang`, and inside `crossref:` the `eq-prefix`, the
  // `eq-labels` or `labels` and `ref-hyperlink`, and inside `language:` the
  // `crossref-eq-prefix`. Read as the header is written in practice, a map in
  // either of YAML's two styles and a value quoted or bare, and not as a YAML
  // parser would: a `language:` that names a file of its own is not read
  // here, and neither is anything YAML lets a key hide behind (an anchor, a
  // multi-line scalar). What is not read is Quarto's default, which is what
  // the editor then draws.

  // A scalar as YAML writes one, quoted or bare, and a comment after it.
  function unquote(v) {
    const s = String(v).trim();
    let m = /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(s);
    if (m) return m[1].replace(/\\(.)/g, "$1");
    m = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(s);
    if (m) return m[1].replace(/''/g, "'");
    return s.replace(/[ \t]+#.*$/, "");
  }

  // Split at a top-level separator: not inside quotes, brackets or braces.
  function splitTop(s, sep) {
    const out = [];
    let depth = 0;
    let quote = "";
    let from = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (quote) {
        if (ch === quote) quote = "";
        else if (ch === "\\" && quote === '"') i++;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") depth--;
      else if (ch === sep && depth === 0) {
        out.push(s.slice(from, i));
        from = i + 1;
      }
    }
    out.push(s.slice(from));
    return out;
  }

  // A value written on the key's own line: a flow list, a flow map, or a
  // scalar.
  function inlineValue(text) {
    const s = text.replace(/^[ \t]+/, "");
    if (/^\[.*\]\s*(?:#.*)?$/.test(s)) {
      const inner = s.slice(1, s.lastIndexOf("]"));
      return inner.trim() ? splitTop(inner, ",").map(unquote) : [];
    }
    if (/^\{.*\}\s*(?:#.*)?$/.test(s)) {
      const map = {};
      const inner = s.slice(1, s.lastIndexOf("}"));
      splitTop(inner, ",").forEach(function (pair) {
        const m = /^\s*([^:\s]+)\s*:\s*(.*)$/.exec(pair);
        if (m) map[m[1]] = inlineValue(m[2]);
      });
      return map;
    }
    return unquote(s);
  }

  // A value written on the lines under its key, indented: a list of `- `
  // items or a map of `key: value`, one level of either inside the other.
  function blockValue(lines) {
    const body = lines.filter(function (l) {
      return l.trim() && !/^\s*#/.test(l);
    });
    if (!body.length) return null;
    if (/^\s*-(?:\s|$)/.test(body[0])) {
      return body
        .filter(function (l) {
          return /^\s*-(?:\s|$)/.test(l);
        })
        .map(function (l) {
          return unquote(l.replace(/^\s*-\s?/, ""));
        });
    }
    const indent = /^\s*/.exec(body[0])[0].length;
    const map = {};
    for (let i = 0; i < body.length; i++) {
      if (/^\s*/.exec(body[i])[0].length !== indent) continue;
      const m = /^\s*([^:\s]+)\s*:(?:[ \t]+(.*)|[ \t]*)$/.exec(body[i]);
      if (!m) continue;
      if (m[2] !== undefined && m[2].trim() && !/^#/.test(m[2].trim())) {
        map[m[1]] = inlineValue(m[2]);
      } else {
        const under = [];
        for (let j = i + 1; j < body.length && /^\s*/.exec(body[j])[0].length > indent; j++) under.push(body[j]);
        map[m[1]] = blockValue(under);
      }
    }
    return map;
  }

  // The top-level keys of a header, `---` fences or none.
  function headerKeys(header) {
    const lines = String(header || "").split(/\r?\n/);
    const keys = {};
    for (let i = 0; i < lines.length; i++) {
      if (/^(?:---|\.\.\.)\s*$/.test(lines[i])) continue;
      const m = /^([A-Za-z0-9_-]+)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/.exec(lines[i]);
      if (!m) continue;
      if (m[2] !== undefined && m[2].trim() && !/^#/.test(m[2].trim())) {
        keys[m[1]] = inlineValue(m[2]);
      } else {
        const under = [];
        for (let j = i + 1; j < lines.length && (/^[ \t]/.test(lines[j]) || !lines[j].trim()); j++) {
          under.push(lines[j]);
        }
        keys[m[1]] = blockValue(under);
      }
    }
    return keys;
  }

  function isMap(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  // What the equations and their references take from the header. `prefix`
  // is the word before a number ("Equation", "Ecuación", or the header's
  // own), `labels` how the numbers are counted (Quarto's `eq-labels`, else
  // `labels`, else arabic), `hyperlink` whether a reference is a link.
  function look(header) {
    const keys = headerKeys(header);
    const crossref = isMap(keys.crossref) ? keys.crossref : {};
    const language = isMap(keys.language) ? keys.language : {};
    let prefix;
    if (crossref["eq-prefix"] !== undefined && crossref["eq-prefix"] !== null) {
      prefix = String(crossref["eq-prefix"]);
    } else if (typeof language["crossref-eq-prefix"] === "string") {
      prefix = language["crossref-eq-prefix"];
    } else {
      prefix = languagePrefix(typeof keys.lang === "string" ? keys.lang : "");
    }
    let labels = crossref["eq-labels"];
    if (typeof labels !== "string") labels = crossref.labels;
    if (typeof labels !== "string") labels = "arabic";
    const link = crossref["ref-hyperlink"];
    return {
      prefix: prefix,
      labels: labels,
      hyperlink: !(typeof link === "string" && /^false$/i.test(link.trim())),
    };
  }

  // ---------- Numbers ----------

  function roman(n) {
    const table = [
      [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
      [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
    ];
    let out = "";
    let rest = n;
    table.forEach(function (row) {
      while (rest >= row[0]) {
        out += row[1];
        rest -= row[0];
      }
    });
    return out;
  }

  // The n-th equation's number, in the style Quarto reads out of `labels`
  // (formatNumberOption): `arabic`; `roman`, upper case unless the style ends
  // in an `i`; `alpha x`, letters from x on; and any other text the words
  // and spaces it is made of, counted through and started again, which for a
  // word on its own is that word every time (`labels: alpha` with no letter
  // numbers every equation "alpha", as Quarto does). A list is not a style:
  // Quarto refuses the header that gives one and exports nothing.
  function number(n, labels) {
    const style = typeof labels === "string" ? labels : "arabic";
    if (style === "arabic") return String(n);
    if (/^alpha /.test(style)) {
      const start = style.split(" ")[1] || "a";
      return String.fromCodePoint(start.codePointAt(0) + n - 1);
    }
    if (/^roman/.test(style)) {
      const r = roman(n);
      return style.slice(-1) === "i" ? r.toLowerCase() : r;
    }
    const words = style.match(/\S+|\s+/g) || [style];
    return words[(n - 1) % words.length].replace(/^\s+$/, " ");
  }

  // ---------- Labels ----------

  // The label Quarto takes after a display equation (process_equations and
  // collectAttrBlock): `{#eq-...}` straight after the closing `$$`, spaces
  // or tabs between and nothing else, whole up to its first `}`, and ending
  // where a word of Pandoc's would, at a space or the end of the line. On
  // the next line it is no label, and neither is `{#eq-x}.`, which Pandoc
  // reads as one word with the period. `rest` is the line after the `$$`;
  // the answer is where the label starts and ends in it, and its name.
  const LABEL = /^([ \t]*)(\{#(eq-[^\s}]+)[^}\n]*\})(?=[ \t]|$)/;
  function labelAfter(rest) {
    const m = LABEL.exec(String(rest || ""));
    if (!m) return null;
    return { from: m[1].length, to: m[1].length + m[2].length, label: m[3] };
  }

  // ---------- References ----------

  // The kinds of cross-reference Quarto resolves (valid_ref_types: its
  // theorems, its floats and callouts, equations and sections, read on
  // 1.9.37), by what a key starts with, in any case, before a hyphen.
  const KINDS = [
    "fig", "tbl", "lst", "eq", "sec", "thm", "lem", "cor", "prp", "cnj", "def",
    "exm", "exr", "sol", "rem", "alg", "prf", "nte", "wrn", "cau", "tip", "imp",
  ];
  function kindOf(key) {
    const m = /^([A-Za-z]+)-/.exec(String(key || ""));
    if (!m) return null;
    const kind = m[1].toLowerCase();
    return KINDS.indexOf(kind) !== -1 ? kind : null;
  }

  // A key as Pandoc reads one after its `@` (citeKey in Parsing/Citations.hs,
  // the rule pandoc.js parses by), with the `-` that suppresses the author.
  const KEY = /(^|[^\p{L}\p{N}_])(-?)@(?:\{([^}\s]*)\}|([\p{L}\p{N}_*](?:[\p{L}\p{N}_]|[:.#$%&+?<>~/-](?=[\p{L}\p{N}_])|[:/](?=\/))*))/u;

  // The citations a citation's source holds, as Pandoc's reader makes them:
  // `[see @a, p. 3; -@b]` is two, each with its key, what is written before
  // it (the prefix) and whether a `-` stands before the `@`; `@a` and `-@a`
  // are one, and the locator of `@a [p. 3]` is a suffix, which a
  // cross-reference does not print.
  function citations(raw) {
    const text = String(raw || "");
    const parts = text.charAt(0) === "[" && text.charAt(text.length - 1) === "]"
      ? splitTop(text.slice(1, -1), ";")
      : [text];
    const out = [];
    parts.forEach(function (part) {
      const m = KEY.exec(part);
      if (!m) return;
      out.push({
        key: m[3] !== undefined ? m[3] : m[4],
        prefix: part.slice(0, m.index + m[1].length).trim(),
        suppress: m[2] === "-",
      });
    });
    return out;
  }

  // What the page prints for a citation that names an equation, as
  // resolveRefs does it, or null when the citation is not the editor's to
  // print: none of its keys is an equation's, or it also names a figure, a
  // table or another kind the editor does not number. `equations` maps a
  // label to its number. Every key of an equation gives one piece, after a
  // comma and a space unless it is the first citation of the brackets (a
  // key of the bibliography counts for that and prints nothing: Quarto drops
  // it); a piece is the prefix written in the brackets or else the
  // document's, upper-cased when the key is, then a no-break space and the
  // number, and it is the number alone for `-@eq-x`. A label no equation
  // carries is "?@eq-x", in bold on the page, with no comma before it.
  function reference(raw, equations, lookOf) {
    const list = citations(raw);
    const kinds = list.map(function (c) {
      return kindOf(c.key);
    });
    if (kinds.indexOf("eq") === -1) return null;
    if (kinds.some(function (k) {
      return k && k !== "eq";
    })) return null;
    const out = [];
    list.forEach(function (c, i) {
      if (kinds[i] !== "eq") return;
      const label = c.key.charAt(0).toLowerCase() + c.key.slice(1);
      const found = equations.get(label);
      if (found === undefined) {
        out.push({ kind: "missing", text: "?@" + label, label: label });
        return;
      }
      if (i > 0) out.push({ kind: "text", text: ", " });
      let text = "";
      if (c.prefix) {
        text = c.prefix + " ";
      } else if (!c.suppress) {
        let prefix = lookOf.prefix;
        if (/^[A-Z]/.test(c.key) && prefix) {
          const chars = Array.from(prefix);
          chars[0] = chars[0].toUpperCase();
          prefix = chars.join("");
        }
        if (prefix) text = prefix + " ";
      }
      out.push({ kind: lookOf.hyperlink ? "link" : "text", text: text + found, label: label });
    });
    return out;
  }

  // ---------- Sections by number ----------
  //
  // `number-sections: true` in the header numbers the headings, 1, 1.1,
  // 1.2, and the numbers of the page are not Pandoc's: Quarto counts them in
  // a filter of its own (sections.lua and sectionNumber among its crossref
  // filters, read on 1.9.37), by rules a reader would not guess. They are
  // written here as they are there, all but the one told apart below, and
  // held against what `quarto render` printed for each of them on 2026-10-03
  // (tests/crossref.test.js):
  //
  // - Every level has a counter. A heading takes the next number of its
  //   level, and one that stands above the level counted last sets the
  //   counters under it back.
  // - The number is the counters from the first level down to the
  //   heading's, so a level the document steps over stays in it as a 0 (`#`
  //   then `###` is 1.0.1). Where the document has no heading of the first
  //   level the number starts at the second: a document written from `##`
  //   down reads 1, 1.1, and one written from `###` down reads 0.1.
  // - A heading of the class `unnumbered` (`{.unnumbered}`, or `{-}`) has
  //   no number and takes none from the count.
  // - `number-depth` is the deepest level that is numbered, counted in `#`
  //   and not in the parts of the number: at a depth of 2, a document
  //   written from `##` down numbers its `##` and nothing under them. The
  //   levels past it are still counted.
  // - `number-offset` is where each level's counter starts, a number for
  //   the first level or a list from the first level down. Quarto merges the
  //   list and drops what repeats in it, so `[1, 1]` is `[1]` and
  //   `[0, 0, 4]` is `[0, 4]`, and a list written for the page is added to
  //   the document's where every other key written for the page replaces
  //   it (measured: `[2, 5]` with `[3]` under `format: html:` counts from
  //   2, 5 and 3).
  // - `crossref: chapters: true` counts from the first level whatever the
  //   document has.
  //
  // The one rule that is not Quarto's, on the owner's word of 2026-10-03: a
  // first level with no number on it is not counted from. To Quarto an
  // unnumbered `#` is still a heading of the first level, so a document that
  // opens on `# Title {-}` has its `##` at 0.1, 0.2 (measured), which is
  // nobody's meaning in turning the title's number off. Here the number
  // starts at the first level only where a `#` carries a number, and such a
  // document reads 1, 1.1, 2 like one with its title in the header; a second
  // `#` that is unnumbered too does not start the count again. The export
  // takes the first counter off what Quarto printed (mdm-after.lua in the
  // render tree) and off what LaTeX would print (title_sections in mdm.lua).
  //
  // What the header says for the page (`format: html:`) is taken over what
  // it says for the document, as Quarto takes it, since the editor draws
  // the page. Only `true`, `True` and `TRUE` turn the numbers on: Quarto
  // refuses a header that says `yes` or `on` and exports nothing. A
  // `_quarto.yml` beside the document is not read.
  function saysTrue(v) {
    return typeof v === "string" && /^(?:true|True|TRUE)$/.test(v.trim());
  }
  function wholeNumber(v) {
    return typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
  }

  // What the sections take from the header: whether they are `numbered`,
  // down to which `depth`, the `offsets` their counters start at and whether
  // the document is counted in `chapters`.
  function sectionLook(header) {
    const keys = headerKeys(header);
    const format = isMap(keys.format) ? keys.format : {};
    const html = isMap(format.html) ? format.html : {};
    const crossref = isMap(keys.crossref) ? keys.crossref : {};
    const said = function (name) {
      return html[name] !== undefined && html[name] !== null ? html[name] : keys[name];
    };
    const depth = wholeNumber(said("number-depth"));
    const offsets = [];
    [keys["number-offset"], html["number-offset"]].forEach(function (given) {
      (Array.isArray(given) ? given : [given]).forEach(function (item) {
        const n = wholeNumber(item);
        if (n !== null && offsets.indexOf(n) === -1) offsets.push(n);
      });
    });
    return {
      numbered: saysTrue(said("number-sections")),
      depth: depth === null ? 6 : depth,
      offsets: offsets,
      chapters: saysTrue(crossref.chapters),
    };
  }

  // The number of each heading of a document, in the document's order, or
  // null for one the page prints no number on. A heading is its `level`, 1
  // to 6, and whether it is `unnumbered`; the title of a callout is not a
  // heading and is not handed in (the editor says which those are).
  const LEVELS = 7;
  function sectionNumbers(headings, lookOf) {
    const offsets = [];
    for (let i = 0; i < LEVELS; i++) offsets.push(i < lookOf.offsets.length ? lookOf.offsets[i] : 0);
    const section = offsets.slice();
    // The level the number starts at: the first one where the document
    // counts in chapters or numbers a `#`, and the second one otherwise.
    let top = lookOf.chapters ? 1 : LEVELS;
    headings.forEach(function (h) {
      if (h.level < top && !(h.level === 1 && h.unnumbered)) top = h.level;
    });
    return headings.map(function (h) {
      if (h.unnumbered) return null;
      // The level counted last: the deepest counter that is not at 0.
      let counted = 0;
      for (let i = LEVELS; i >= 1 && !counted; i--) if (section[i - 1] !== 0) counted = i;
      if (h.level < counted) for (let i = h.level; i < LEVELS; i++) section[i] = offsets[i];
      section[h.level - 1] += 1;
      if (!lookOf.numbered || h.level > lookOf.depth) return null;
      // Down to the heading's own level, or to the deepest counter over it
      // that has counted anything.
      let last = 1;
      for (let i = h.level; i >= 2 && last === 1; i--) if (section[i - 1] > 0) last = i;
      const parts = top === 1 ? [section[0]] : [];
      for (let i = 2; i <= last; i++) parts.push(section[i - 1]);
      return parts.length ? parts.join(".") : null;
    });
  }

  return {
    PREFIXES: PREFIXES,
    languagePrefix: languagePrefix,
    headerKeys: headerKeys,
    look: look,
    sectionLook: sectionLook,
    sectionNumbers: sectionNumbers,
    number: number,
    labelAfter: labelAfter,
    kindOf: kindOf,
    citations: citations,
    reference: reference,
  };
});
