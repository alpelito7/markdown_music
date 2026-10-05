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

  // ---------- The title block ----------
  //
  // What the page opens with when the header names it: the title and the
  // subtitle, the categories and a description, whoever wrote the document
  // and where they work, its dates and its DOI, the abstract and the
  // keywords. The editor draws the same block where the page has it
  // (TitleWidget in main.js), so what the block says is read here, by
  // Quarto's rules again: its title block partials (title-block.html,
  // title-metadata.html and _title-meta-author.html among its HTML
  // templates), the authors and affiliations as its filter normalises them
  // (filters/modules/authors.lua) and the dates as core/date.ts prints them,
  // all read on 1.9.37, and each form below held against what `quarto
  // render` printed on 2026-10-03 and 2026-10-04 (tests/crossref.test.js).
  //
  // Not read, and so on the page alone: a header that asks for another block
  // altogether (`title-block-banner`, `title-block-style`), whose page is
  // laid out otherwise; what YAML lets a value hide behind (an anchor, an
  // alias, a tag); and in an abstract or a description anything but
  // paragraphs (a list there stays as it is written).

  // ---- The header, read whole ----
  //
  // The reader above takes a key and one level under it, which is all the
  // equations and the sections ask of the header. The title block asks more:
  // an author is a map in a list, with a list of maps under one of its keys,
  // and an abstract is a block of text. So the header is read here as the
  // tree it is: maps and lists in block style to any depth, the flow styles
  // on a line, and a scalar plain, quoted, or written as a block (`|`, `>`),
  // on its key's line or under it. Every scalar is the text it was written
  // as (`true` and `2026` are not made into anything), and null stands for a
  // key with nothing after it.

  // What a backslash writes in a double-quoted scalar (YAML 1.2, 5.7).
  const ESCAPES = {
    0: "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b",
    " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\x85", _: "\xa0", L: " ", P: " ",
  };
  function unescaped(body) {
    return body.replace(/\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[\s\S])/g, function (whole, code) {
      if (code.length > 1) {
        // A figure past the last code point there is stays as it was
        // written: fromCodePoint throws on one, and a header that cannot be
        // read would take the drawing of the whole document with it.
        const point = parseInt(code.slice(1), 16);
        return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
      }
      return Object.prototype.hasOwnProperty.call(ESCAPES, code) ? ESCAPES[code] : code;
    });
  }

  // Where a quoted scalar ends: the index of its closing quote in `text`,
  // which opens with it, or -1 while the scalar runs on.
  function closingQuote(text, quote) {
    for (let i = 1; i < text.length; i++) {
      const ch = text.charAt(i);
      if (quote === '"' && ch === "\\") i++;
      else if (ch === quote) {
        if (quote === "'" && text.charAt(i + 1) === "'") i++;
        else return i;
      }
    }
    return -1;
  }

  // A plain scalar without the comment after it.
  function uncommented(text) {
    return text.replace(/(?:^|[ \t]+)#.*$/, "").replace(/[ \t]+$/, "");
  }

  // The key a line opens with, and what follows its colon: a colon counts
  // only before a space or at the end of the line, so `https://x` is no key.
  function entryOf(text) {
    let m = /^"((?:[^"\\]|\\.)*)"[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/.exec(text);
    if (m) return { key: unescaped(m[1]), rest: m[2] || "" };
    m = /^'((?:[^']|'')*)'[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/.exec(text);
    if (m) return { key: m[1].replace(/''/g, "'"), rest: m[2] || "" };
    if (/^[\s"'[\]{}#&*!|>%@`,-]/.test(text)) return null;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (ch === "#" && /[ \t]/.test(text.charAt(i - 1))) return null;
      if (ch !== ":") continue;
      const next = text.charAt(i + 1);
      if (next !== "" && next !== " " && next !== "\t") continue;
      return { key: text.slice(0, i).replace(/[ \t]+$/, ""), rest: text.slice(i + 1).replace(/^[ \t]+/, "") };
    }
    return null;
  }

  function indentOf(line) {
    return /^ */.exec(line)[0].length;
  }

  function readHeader(header) {
    const all = String(header || "").split(/\r?\n/);
    const from = /^---[ \t]*$/.test(all[0] || "") ? 1 : 0;
    let to = all.length;
    for (let k = from; k < all.length; k++) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(all[k])) {
        to = k;
        break;
      }
    }
    const L = all.slice(from, to);
    let i = 0;
    const skip = function () {
      while (i < L.length && (!L[i].trim() || /^\s*#/.test(L[i]))) i++;
    };
    const dash = function (text) {
      return /^-(?:[ \t]|$)/.test(text);
    };

    // A scalar written as a block under `|` or `>`: its lines without the
    // margin of the first, joined by the line breaks they have (`|`) or
    // folded into paragraphs (`>`), and one line break at the end unless the
    // header strips it (`-`) or keeps them all (`+`). `parent` is the column
    // of what the block is the value of, which its lines stand to the right
    // of.
    const blockScalar = function (style, chomp, digit, parent) {
      const body = [];
      let margin = digit ? parent + Number(digit) : -1;
      while (i < L.length) {
        const line = L[i];
        if (!line.trim()) {
          body.push("");
          i++;
          continue;
        }
        const indent = indentOf(line);
        if (margin === -1) {
          if (indent <= parent) break;
          margin = indent;
        }
        if (indent < margin) break;
        body.push(line.slice(margin));
        i++;
      }
      let trailing = 0;
      while (body.length && body[body.length - 1] === "") {
        body.pop();
        trailing++;
      }
      if (!body.length) return chomp === "+" ? new Array(trailing + 1).join("\n") : "";
      let text = body[0];
      for (let k = 1; k < body.length; k++) {
        const line = body[k];
        const before = body[k - 1];
        if (style === "|") text += "\n" + line;
        else if (line === "") text += "\n";
        else if (before === "") text += line;
        else text += (/^[ \t]/.test(line) || /^[ \t]/.test(before) ? "\n" : " ") + line;
      }
      if (chomp === "-") return text;
      return text + new Array((chomp === "+" ? trailing + 1 : 1) + 1).join("\n");
    };

    // A scalar from the text its first line holds, the line itself already
    // taken, over the lines it runs on: those under a quote still open, a
    // bracket still open, or to the right of `parent` for a plain one, a
    // line break between them being a space.
    const scalar = function (first, parent) {
      let text = first.replace(/^[ \t]+/, "");
      const lead = text.charAt(0);
      if (lead === '"' || lead === "'") {
        let close = closingQuote(text, lead);
        while (close === -1 && i < L.length) {
          text += " " + L[i].trim();
          i++;
          close = closingQuote(text, lead);
        }
        const body = close === -1 ? text.slice(1) : text.slice(1, close);
        return lead === '"' ? unescaped(body) : body.replace(/''/g, "'");
      }
      const block = /^([|>])([+-]?)([1-9]?)([+-]?)[ \t]*(?:#.*)?$/.exec(text);
      if (block) return blockScalar(block[1], block[2] || block[4], block[3], parent);
      if (lead === "[" || lead === "{") {
        const open = function (t) {
          let depth = 0;
          let quote = "";
          for (let k = 0; k < t.length; k++) {
            const ch = t.charAt(k);
            if (quote) {
              if (ch === quote) quote = "";
              else if (ch === "\\" && quote === '"') k++;
            } else if (ch === '"' || ch === "'") quote = ch;
            else if (ch === "[" || ch === "{") depth++;
            else if (ch === "]" || ch === "}") depth--;
          }
          return depth > 0;
        };
        while (open(text) && i < L.length) {
          text += " " + L[i].trim();
          i++;
        }
        return inlineValue(text);
      }
      let out = uncommented(text);
      while (i < L.length) {
        const line = L[i];
        if (!line.trim() || /^\s*#/.test(line)) {
          // Blank lines and comments end a plain scalar unless more of it
          // follows them.
          let k = i;
          while (k < L.length && (!L[k].trim() || /^\s*#/.test(L[k]))) k++;
          if (k >= L.length || indentOf(L[k]) <= parent) break;
          i = k;
          continue;
        }
        if (indentOf(line) <= parent) break;
        out += " " + uncommented(line.trim());
        i++;
      }
      return out;
    };

    let node;

    const sequence = function (indent) {
      const out = [];
      for (;;) {
        skip();
        if (i >= L.length) break;
        const line = L[i];
        const at = indentOf(line);
        if (at < indent) break;
        if (at > indent || !dash(line.slice(indent))) {
          if (at === indent) break;
          // A line set in further than the list and no part of an item.
          i++;
          continue;
        }
        const m = /^-([ \t]*)(.*)$/.exec(line.slice(indent));
        if (!m[2] || /^#/.test(m[2])) {
          i++;
          skip();
          out.push(i < L.length && indentOf(L[i]) > indent ? node(indentOf(L[i]), indent) : null);
        } else {
          // The dash's own line is set in to where its text stands, which is
          // the column the keys under it are written at.
          const column = indent + 1 + m[1].length;
          L[i] = new Array(column + 1).join(" ") + m[2];
          out.push(node(column, indent));
        }
      }
      return out;
    };

    const mapping = function (indent) {
      const out = {};
      for (;;) {
        skip();
        if (i >= L.length) break;
        const line = L[i];
        const at = indentOf(line);
        if (at < indent) break;
        const entry = at === indent ? entryOf(line.slice(indent)) : null;
        if (!entry) {
          if (at === indent) break;
          i++;
          continue;
        }
        i++;
        let value = null;
        if (entry.rest && !/^#/.test(entry.rest)) {
          value = scalar(entry.rest, indent);
        } else {
          skip();
          if (i < L.length && indentOf(L[i]) > indent) value = node(indentOf(L[i]), indent);
          // A list may stand at the column of its own key.
          else if (i < L.length && indentOf(L[i]) === indent && dash(L[i].slice(indent))) value = sequence(indent);
        }
        if (entry.key !== "__proto__" && !Object.prototype.hasOwnProperty.call(out, entry.key)) out[entry.key] = value;
      }
      return out;
    };

    // What starts on the line at hand, at `column`, as the value of
    // something written at `parent`.
    node = function (column, parent) {
      const text = L[i].slice(column);
      if (dash(text)) return sequence(column);
      if (entryOf(text)) return mapping(column);
      i++;
      return scalar(text, parent);
    };

    skip();
    if (i >= L.length) return {};
    const tree = node(indentOf(L[i]), -1);
    return isMap(tree) ? tree : {};
  }

  // ---- What the block says ----

  // A scalar of the tree as text; a list or a map is none.
  function textOf(value) {
    return typeof value === "string" ? value : "";
  }
  // The text on one line: a title written as a block is one line on the
  // page, a line break in it being a space to Pandoc.
  function lineOf(value) {
    return textOf(value).replace(/\s*\n\s*/g, " ").trim();
  }
  // A value that may be one thing or a list of them.
  function listOf(value) {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  }

  // A text the page sets either as part of a line or as paragraphs of its
  // own, which Pandoc tells apart by how the scalar ends (normalizeMetaValue
  // among its readers): one that ends in a line break, as every block scalar
  // does unless it is stripped (`|-`), is read as blocks, and anything else
  // as a run of inline text, its paragraphs then parted by a line break and
  // nothing more. The page's stylesheet sizes the two differently (see
  // TitleWidget). A line break inside a paragraph is a space.
  function proseOf(value) {
    const text = textOf(value);
    if (!text.trim()) return null;
    const paragraphs = text
      .split(/\n[ \t]*\n/)
      .map(lineOf)
      .filter(Boolean);
    return { blocks: /\n[ \t]*$/.test(text), paragraphs: paragraphs };
  }

  // The name of an author written as a map: `name`, itself a string or a
  // map of its parts, or the parts written beside the other keys.
  function nameOf(map) {
    const literal = function (parts) {
      if (typeof parts.literal === "string") return parts.literal;
      return [parts.given, parts.family]
        .filter(function (part) {
          return typeof part === "string" && part;
        })
        .join(" ");
    };
    if (typeof map.name === "string") return lineOf(map.name);
    if (isMap(map.name)) return lineOf(literal(map.name));
    return lineOf(literal(map));
  }

  // The affiliations a value names, as Quarto's processAffiliation reads
  // them: a name, a map (its `name`, and its `url` or `affiliation-url`), or
  // a list of either, where a map that only holds a `ref` points at one of
  // the document's own. `known` is those, by id.
  function affiliationsOf(value, known) {
    const one = function (item) {
      if (typeof item === "string") return { name: lineOf(item), url: "" };
      if (!isMap(item)) return null;
      const keys = Object.keys(item);
      if (keys.length === 1 && keys[0] === "ref") {
        const id = textOf(item.ref);
        return Object.prototype.hasOwnProperty.call(known, id) ? known[id] : null;
      }
      return { name: lineOf(item.name), url: textOf(item.url) || textOf(item["affiliation-url"]) };
    };
    return (isMap(value) ? [value] : listOf(value)).map(one).filter(Boolean);
  }

  // Whoever wrote the document, as the page lists them: `authors`, or
  // `author` where there is no such key, one or a list, each a name or a
  // map. The page prints of a map its name, with the degrees after it, as a
  // link where it has a `url`, an envelope for an `email` and the ORCID mark
  // for an `orcid`, and beside it the names of its affiliations. An
  // `institute` is an affiliation of the author it stands level with in its
  // own list, the last author taking those left over.
  //
  // The two keys are not read alike (parseAuthor in Quarto's own code, and
  // measured): under `author`, one map with neither a `name` nor a `family`
  // name takes every author off the page, the named ones with it, where
  // under `authors` it is a row with no name in it.
  //
  // `affiliated` says the document has an affiliation at all, even one no
  // author names: the page then sets the authors in two columns, each beside
  // its own, where it otherwise sets the names in a column of the row the
  // date is in.
  function authorsOf(tree) {
    const known = {};
    let affiliated = false;
    (isMap(tree.affiliations) ? [tree.affiliations] : listOf(tree.affiliations)).forEach(function (item) {
      affiliated = true;
      if (!isMap(item)) return;
      const id = textOf(item.id);
      if (id) known[id] = { name: lineOf(item.name), url: textOf(item.url) || textOf(item["affiliation-url"]) };
    });
    const said = function (value) {
      return value !== undefined && value !== null && value !== "";
    };
    let raw = [];
    if (said(tree.authors)) raw = listOf(tree.authors);
    else if (said(tree.author)) {
      raw = listOf(tree.author);
      const nameless = function (item) {
        return isMap(item) && !said(item.name) && !said(item.family);
      };
      if (raw.some(nameless)) raw = [];
    }
    const authors = raw
      .map(function (item) {
        if (typeof item === "string") {
          return { name: lineOf(item), degrees: [], url: "", email: "", orcid: "", affiliations: [] };
        }
        if (!isMap(item)) return null;
        const own = affiliationsOf(item.affiliations !== undefined ? item.affiliations : item.affiliation, known);
        const url = textOf(item["affiliation-url"]);
        if (own.length && url) own[0] = { name: own[0].name, url: url };
        return {
          name: nameOf(item),
          degrees: listOf(item.degrees).map(lineOf).filter(Boolean),
          url: textOf(item.url),
          email: textOf(item.email),
          orcid: textOf(item.orcid),
          affiliations: own,
        };
      })
      .filter(Boolean);
    listOf(tree.institute).forEach(function (item, at) {
      affiliated = true;
      const author = authors[Math.min(at, authors.length - 1)];
      if (author) author.affiliations.push({ name: lineOf(item), url: "" });
    });
    authors.forEach(function (author) {
      if (author.affiliations.length) affiliated = true;
    });
    return { authors: authors, affiliated: affiliated };
  }

  // The locales Quarto has dates for (share/library/dayjs/locale of 1.9.37):
  // the document's `lang`, lowercased, then its first part, then English, and
  // the name it finds is the locale the date is printed in.
  const DATE_LOCALES = (
    "af am ar-dz ar-iq ar ar-kw ar-ly ar-ma ar-sa ar-tn az be bg bi bm bn-bd bn bo br bs ca cs cv cy da de-at " +
    "de-ch de dv el en-au en-ca en-gb en-ie en-il en-in en en-nz en-sg en-tt eo es-do es es-mx es-pr es-us et " +
    "eu fa fi fo fr-ca fr-ch fr fy ga gd gl gom-latn gu he hi hr ht hu hy-am id is it-ch it ja jv ka kk km kn " +
    "ko ku ky lb lo lt lv me mi mk ml mn mr ms ms-my mt my nb ne nl-be nl nn oc-lnc pa-in pl pt-br pt rn ro ru " +
    "rw sd se si sk sl sq sr-cyrl sr ss sv-fi sv sw ta te tet tg th tk tlh tl-ph tr tzl tzm tzm-latn ug-cn uk " +
    "ur uz uz-latn vi x-pseudo yo zh-cn zh-hk zh zh-tw"
  ).split(" ");
  function dateLocale(lang) {
    const tag = String(lang || "").toLowerCase();
    if (DATE_LOCALES.indexOf(tag) !== -1) return tag;
    const base = tag.split("-")[0];
    return tag.indexOf("-") !== -1 && DATE_LOCALES.indexOf(base) !== -1 ? base : "en";
  }

  // The day a date names, as Quarto reads it: the shapes it tries in its
  // order, month first where a date is all figures, and then whatever the
  // engine makes of the text, which is where "3 October 2026" is read and
  // also where "2026" alone becomes the last day of 2025 west of Greenwich
  // (measured). `today`, `now` and `last-modified` are the day of the export:
  // the page is rendered from a copy written as it is exported.
  const DATE_SHAPES = [
    [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, 3, 1, 2],
    [/^(\d{1,2})-(\d{1,2})-(\d{4})$/, 3, 1, 2],
    [/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, 3, 1, 2],
    [/^(\d{1,2})-(\d{1,2})-(\d{2})$/, 3, 1, 2],
    [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, 1, 2, 3],
    [/^(\d{1,2}) (\d{1,2}) (\d{4})$/, 3, 2, 1],
    [/^(\d{1,2}) (\d{1,2}), (\d{4})$/, 3, 1, 2],
  ];
  function dateOf(raw, now) {
    const text = String(raw).trim();
    if (/^(?:today|now|last-modified)$/.test(text)) {
      const day = now ? new Date(now.getTime()) : new Date();
      if (text !== "now") day.setHours(0, 0, 0, 0);
      return day;
    }
    for (let i = 0; i < DATE_SHAPES.length; i++) {
      const shape = DATE_SHAPES[i];
      const m = shape[0].exec(text);
      if (!m) continue;
      let year = Number(m[shape[1]]);
      if (m[shape[1]].length === 2) year += 2000;
      const month = Number(m[shape[2]]);
      const day = Number(m[shape[3]]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      return new Date(year, month - 1, day);
    }
    const guessed = new Date(text);
    return isNaN(guessed.getTime()) ? null : guessed;
  }

  // ---- A date in a format of its own ----
  //
  // A `date-format` that is none of the four styles is a pattern dayjs
  // prints (formatDate in core/date.ts): `MMMM YYYY`, `D [de] MMMM [de]
  // YYYY`. The pattern is read here as dayjs reads it, in its two passes
  // (the `advancedFormat` plugin Quarto loads, then dayjs's own format, both
  // read in Quarto's bundle of 1.9.37), and what it prints of a number is
  // printed. What it prints in words is the locale's, and those words are
  // not here: they are taken where they can be had without carrying dayjs's
  // tables.
  //
  // - English is written out below, months and weekdays, and dayjs cuts its
  //   short forms from the long ones (three letters, and two for `dd`).
  // - The long name of a month (`MMMM`) and of a weekday (`dddd`) is the
  //   browser's (Intl) for the locales in the two lists, which are the ones
  //   where it is letter for letter dayjs's: 61 and 60 of the 143 locales,
  //   Spanish, French, German, Italian, Portuguese and Dutch among them.
  //   The lists are the locales that agree both under Node, which carries
  //   every locale, and in Chrome, which does not (trusted, below), measured
  //   on Node 24.15 and Chrome 151. The tests build them again from the
  //   locale files of the installed Quarto, in each of the two runtimes
  //   (crossref.test.js and webview-title.test.js), so a Quarto or a runtime
  //   that words a month otherwise shows up there.
  // - An ordinal (`Do`) is dayjs's rule for English, and a figure with or
  //   without a fixed sign after it for most others (`4.`, `4º`).
  // - AM and PM are dayjs's own unless the locale has a word for them.
  //
  // What cannot be printed leaves the date as it was written, which is what
  // every pattern in words did until 2026-10-04: a short month or weekday
  // outside English (`MMM`, `ddd`, `dd`: dayjs writes "sep" and "dom." where
  // the browser has "sept" and "dom"), a month in a locale that declines it
  // by the pattern (hr, lt, pl, ru, uk), an ordinal in one that has several
  // endings (bg, bn-bd, ca, fr, ne, nl, sv), a week of the year, the name of
  // a time zone.
  const EN_MONTHS = "January February March April May June July August September October November December".split(" ");
  const EN_DAYS = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" ");
  const INTL_MONTHS = (
    "af ar-dz ar ar-ly ar-ma ar-sa ar-tn bg cs da de-at de-ch de en-au en-ca en-gb en-ie en-il en-in en en-nz " +
    "en-sg en-tt es-do es es-mx es-pr es-us et fi fr-ca fr-ch fr gom-latn he hu id it-ch it ko lv mr ms ms-my nb " +
    "nl-be nl pt-br pt sk sl sv-fi sv sw te th tl-ph tr ur zh-cn zh"
  ).split(" ");
  const INTL_DAYS = (
    "af bg bn-bd bn cs da de-at de-ch de el en-au en-ca en-gb en-ie en-il en-in en en-nz en-sg en-tt es-do es " +
    "es-mx es-pr es-us et fi fr-ca fr-ch fr hr hu id it-ch it ja ko lt ms ms-my nb nl-be nl pl pt-br pt ru sk sl " +
    "sv-fi sv sw te tl-ph tr ur zh-cn zh-hk zh zh-tw"
  ).split(" ");
  // How a locale writes the day as an ordinal: English's rule, the sign it
  // puts after the figure, or a rule of its own that is not carried here.
  // A locale in none of the three writes the figure alone.
  const ORDINAL_ENGLISH = "en en-gb en-in en-nz en-tt".split(" ");
  const ORDINAL_SIGNS = {
    ".": "cs da de-at de-ch de et fi hr hu id lt ms nb nn pl sk sl sr-cyrl sr th tk tr".split(" "),
    "º": "es-do es-mx es-pr es-us es gl it oc-lnc pt-br pt".split(" "),
    "日": "ja zh-cn zh-hk zh-tw zh".split(" "),
    "ኛ": ["am"],
  };
  const ORDINAL_OWN = "bg bn-bd ca fr ne nl sv-fi sv".split(" ");
  // The locales with a word of their own for the half of the day.
  const MERIDIEM_OWN = "ar-dz ar-iq ar-kw ar-ly ar-ma ar-sa ar-tn bn-bd br ja ko ku ru zh-cn zh-tw zh".split(" ");

  // The name Intl has for a month or a weekday of `date`, or null.
  function intlName(locale, option, type, date) {
    try {
      const parts = new Intl.DateTimeFormat(locale, option).formatToParts(date);
      for (let i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
    } catch (e) {
      // A locale the runtime does not know.
    }
    return null;
  }

  // Whether the runtime has the words of a locale. Quarto prints a date
  // with every locale there is, and the editor runs in Chromium, which
  // carries about two thirds of them: asked for a date in Basque, Galician
  // or Welsh it answers in English ("October 3, 2026"), and for a few it
  // knows by name only it writes the month as a figure ("2026 M10 3" in
  // Azerbaijani). Both measured on Chrome 151 against Node 24.15, 50 and 7
  // of Quarto's 143 locales. A date in such a locale is left as it was
  // written, in a style as in a pattern, which says less than the page does
  // and nothing the page does not.
  const trustedLocales = {};
  function trusted(locale) {
    if (!Object.prototype.hasOwnProperty.call(trustedLocales, locale)) {
      let known = false;
      try {
        known =
          Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0 &&
          !/^M\d\d$/.test(intlName(locale, { month: "long" }, "month", new Date(2023, 9, 15)) || "M00");
      } catch (e) {
        known = false;
      }
      trustedLocales[locale] = known;
    }
    return trustedLocales[locale];
  }

  // The day as an ordinal, as the pattern takes it: English's comes in
  // brackets, which is how dayjs keeps its letters from being read as more
  // of the pattern. Null for a rule that is not carried.
  function ordinalOf(day, locale) {
    if (ORDINAL_ENGLISH.indexOf(locale) !== -1) {
      const ends = ["th", "st", "nd", "rd"];
      const v = day % 100;
      return "[" + day + (ends[(v - 20) % 10] || ends[v] || ends[0]) + "]";
    }
    if (ORDINAL_OWN.indexOf(locale) !== -1) return null;
    const signs = Object.keys(ORDINAL_SIGNS);
    for (let i = 0; i < signs.length; i++) if (ORDINAL_SIGNS[signs[i]].indexOf(locale) !== -1) return day + signs[i];
    return String(day);
  }

  // `date` in a pattern of dayjs's, in the locale named, or null where the
  // pattern asks for a word that is not to be had here.
  function patternText(date, pattern, locale) {
    let lost = false;
    const pad = function (n, width) {
      let out = String(n);
      while (out.length < width) out = "0" + out;
      return out;
    };
    // The offset from Greenwich as dayjs writes it, rounded to the quarter
    // of an hour.
    const minutes = 15 * -Math.round(date.getTimezoneOffset() / 15);
    const zone =
      (minutes < 0 ? "-" : "+") + pad(Math.floor(Math.abs(minutes) / 60), 2) + ":" + pad(Math.abs(minutes) % 60, 2);
    // The first pass, the plugin's.
    const first = pattern.replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g, function (match) {
      if (match.charAt(0) === "[") return match;
      if (match === "Q") return String(Math.ceil((date.getMonth() + 1) / 3));
      if (match === "Do") {
        const ordinal = ordinalOf(date.getDate(), locale);
        if (ordinal === null) lost = true;
        return ordinal || "";
      }
      if (match === "X") return String(Math.floor(date.getTime() / 1000));
      if (match === "x") return String(date.getTime());
      if (match === "k" || match === "kk") return pad(date.getHours() === 0 ? 24 : date.getHours(), match.length);
      if (match === "S") return match;
      // A week of the year or the name of a time zone.
      lost = true;
      return "";
    });
    const english = locale === "en";
    const month = function (long) {
      if (english) return long ? EN_MONTHS[date.getMonth()] : EN_MONTHS[date.getMonth()].slice(0, 3);
      const name =
        long && INTL_MONTHS.indexOf(locale) !== -1 && trusted(locale) ? intlName(locale, { month: "long" }, "month", date) : null;
      if (name === null) lost = true;
      return name || "";
    };
    const weekday = function (letters) {
      if (english) return letters ? EN_DAYS[date.getDay()].slice(0, letters) : EN_DAYS[date.getDay()];
      const name =
        !letters && INTL_DAYS.indexOf(locale) !== -1 && trusted(locale)
          ? intlName(locale, { weekday: "long" }, "weekday", date)
          : null;
      if (name === null) lost = true;
      return name || "";
    };
    const meridiem = function (lower) {
      if (MERIDIEM_OWN.indexOf(locale) !== -1) {
        lost = true;
        return "";
      }
      const half = date.getHours() < 12 ? "AM" : "PM";
      return lower ? half.toLowerCase() : half;
    };
    const hour = date.getHours() % 12 || 12;
    // The second, dayjs's own: a run of letters it has no value for is the
    // zone without its colon (`ZZ`, and `YYY` with it).
    const out = first.replace(
      /\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g,
      function (match, kept) {
        if (kept) return kept;
        switch (match) {
          case "YY": return String(date.getFullYear()).slice(-2);
          case "YYYY": return String(date.getFullYear());
          case "M": return String(date.getMonth() + 1);
          case "MM": return pad(date.getMonth() + 1, 2);
          case "MMM": return month(false);
          case "MMMM": return month(true);
          case "D": return String(date.getDate());
          case "DD": return pad(date.getDate(), 2);
          case "d": return String(date.getDay());
          case "dd": return weekday(2);
          case "ddd": return weekday(3);
          case "dddd": return weekday(0);
          case "H": return String(date.getHours());
          case "HH": return pad(date.getHours(), 2);
          case "h": return String(hour);
          case "hh": return pad(hour, 2);
          case "a": return meridiem(true);
          case "A": return meridiem(false);
          case "m": return String(date.getMinutes());
          case "mm": return pad(date.getMinutes(), 2);
          case "s": return String(date.getSeconds());
          case "ss": return pad(date.getSeconds(), 2);
          case "SSS": return pad(date.getMilliseconds(), 3);
          case "Z": return zone;
          default: return zone.replace(":", "");
        }
      }
    );
    return lost ? null : out;
  }

  // The date as the page prints it: in the style `date-format` names, `long`
  // when it names none, by the locale of the document, or in the pattern it
  // gives (patternText). A pattern that asks for a word this side does not
  // have leaves the date as it was written, as do a locale the runtime has
  // no words for (trusted) and a date nothing could read.
  function dateText(raw, format, lang, now) {
    const written = String(raw === undefined || raw === null ? "" : raw).trim();
    if (!written) return "";
    const date = dateOf(written, now);
    if (!date) return written;
    const style = String(format || "long").trim();
    const locale = dateLocale(lang);
    if (/^(?:full|long|medium|short)$/.test(style)) {
      if (!trusted(locale)) return written;
      try {
        return date.toLocaleString(locale, { dateStyle: style });
      } catch (e) {
        return written;
      }
    }
    const text = patternText(date, style === "iso" ? "YYYY-MM-DD" : style, locale);
    return text === null ? written : text;
  }

  // ---- The words over the abstract and the keywords ----

  // `section-title-abstract` and `title-block-keywords` in each of Quarto's
  // language files, found as the equations' prefix is (languagePrefix): the
  // file of the tag, then of its first part, then English. tests/
  // crossref.test.js holds both against the files of an installed Quarto.
  const ABSTRACT_TITLES = {
    "": "Abstract", bg: "Резюме", ca: "Resum", cs: "Abstrakt", da: "Resume", de: "Zusammenfassung",
    "de-CH": "Zusammenfassung", el: "Περίληψη", es: "Resumen", eu: "Laburpena", fi: "Tiivistelmä", fr: "Résumé",
    he: "תקציר", id: "Abstrak", is: "Ágrip", it: "Sommario", ja: "概要", ko: "초록", lt: "Santrauka",
    nb: "Sammendrag", nl: "Samenvatting", nn: "Samandrag", pl: "Abstrakt", pt: "Resumo", "pt-BR": "Resumo",
    ru: "Аннотация", sk: "Abstrakt", sl: "Povzetek", "sr-Latn": "Apstrakt", sv: "Sammanfattning", tr: "Özet",
    ua: "Анотація", zh: "摘要", "zh-TW": "摘要",
  };
  const KEYWORD_TITLES = {
    "": "Keywords", bg: "Ключови думи", ca: "Paraules clau", cs: "Klíčová slova", da: "Nøgleord",
    de: "Schlüsselwörter", "de-CH": "Schlüsselwörter", el: "Λέξεις-κλειδιά", es: "Palabras clave",
    eu: "Gako-hitzak", fi: "Avainsanat", fr: "Mots clés", he: "מילות מפתח", id: "Kata kunci", is: "Lykilorð",
    it: "Parole chiave", ja: "キーワード", ko: "키워드", lt: "Raktiniai žodžiai", nb: "Nøkkelord",
    nl: "Trefwoorden", nn: "Nøkkelord", pl: "Słowa kluczowe", pt: "Palavras-chave", "pt-BR": "Palavras-chave",
    ru: "Ключевые слова", sk: "Kľúčové slová", sl: "Ključne besede", "sr-Latn": "Ključne Reči", sv: "Nyckelord",
    tr: "Anahtar kelimeler", ua: "Ключові слова", zh: "关键词", "zh-TW": "關鍵字",
  };
  function languageWord(table, lang) {
    const tag = String(lang || "");
    if (tag && Object.prototype.hasOwnProperty.call(table, tag)) return table[tag];
    const base = tag.split("-")[0];
    if (base && Object.prototype.hasOwnProperty.call(table, base)) return table[base];
    return table[""];
  }

  // What the block says, or null for a header that puts nothing at the head
  // of the page. `now` is the day `today` stands for, the tests' to fix.
  //
  // - `title` and `subtitle`, a line each.
  // - `categories`, the tags under the title, unless the header turns them
  //   off (`title-block-categories: false`), and `description`, the text
  //   under those.
  // - `authors`, each with its `name`, `degrees`, `url`, `email`, `orcid`
  //   and `affiliations` (name and url), and `affiliated`, which says the
  //   page sets them in two columns (authorsOf).
  // - `date` and `modified` as printed, both in the one `date-format`, and
  //   `doi`.
  // - `abstract` and `keywords`, with the word the page sets over each
  //   (`abstractTitle`, `keywordsTitle`): the header's own (`abstract-title`,
  //   or the two keys under `language:`), else the language's.
  //
  // The page has a block exactly when one of title, subtitle, authors, date,
  // categories, date-modified, doi, abstract and keywords is there (the
  // `$if$` chain of Quarto's template.html): a description alone prints
  // nothing, and neither does a list of affiliations nobody is named for.
  function titleLook(header, now) {
    const tree = readHeader(header);
    const format = isMap(tree.format) ? tree.format : {};
    const html = isMap(format.html) ? format.html : {};
    const language = isMap(tree.language) ? tree.language : {};
    const lang = textOf(tree.lang);
    const dateFormat = textOf(html["date-format"]) || textOf(tree["date-format"]);
    const who = authorsOf(tree);
    const shown = !/^false$/i.test(textOf(tree["title-block-categories"]).trim());
    // A date is a text, or a map of its `value` and a `format` of its own.
    const dated = function (value) {
      if (isMap(value)) return dateText(textOf(value.value), textOf(value.format) || dateFormat, lang, now);
      return dateText(textOf(value), dateFormat, lang, now);
    };
    const out = {
      title: lineOf(tree.title),
      subtitle: lineOf(tree.subtitle),
      categories: shown ? listOf(tree.categories).map(lineOf).filter(Boolean) : [],
      description: proseOf(tree.description),
      authors: who.authors,
      affiliated: who.affiliated,
      date: dated(tree.date),
      modified: dated(tree["date-modified"]),
      doi: lineOf(tree.doi),
      abstract: proseOf(tree.abstract),
      abstractTitle: lineOf(tree["abstract-title"]) || lineOf(language["section-title-abstract"]) || languageWord(ABSTRACT_TITLES, lang),
      keywords: listOf(tree.keywords).map(lineOf).filter(Boolean),
      keywordsTitle: lineOf(language["title-block-keywords"]) || languageWord(KEYWORD_TITLES, lang),
    };
    const block =
      out.title || out.subtitle || out.authors.length || out.date || out.categories.length || out.modified ||
      out.doi || out.abstract || out.keywords.length;
    return block ? out : null;
  }

  return {
    PREFIXES: PREFIXES,
    languagePrefix: languagePrefix,
    headerKeys: headerKeys,
    look: look,
    sectionLook: sectionLook,
    sectionNumbers: sectionNumbers,
    DATE_LOCALES: DATE_LOCALES,
    INTL_MONTHS: INTL_MONTHS,
    INTL_DAYS: INTL_DAYS,
    ORDINAL_ENGLISH: ORDINAL_ENGLISH,
    ORDINAL_SIGNS: ORDINAL_SIGNS,
    ORDINAL_OWN: ORDINAL_OWN,
    MERIDIEM_OWN: MERIDIEM_OWN,
    ABSTRACT_TITLES: ABSTRACT_TITLES,
    KEYWORD_TITLES: KEYWORD_TITLES,
    readHeader: readHeader,
    dateText: dateText,
    titleLook: titleLook,
    number: number,
    labelAfter: labelAfter,
    kindOf: kindOf,
    citations: citations,
    reference: reference,
  };
});
