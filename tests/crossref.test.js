// Equations by number and the references to them (vscode-mdm/media/
// mdm-crossref.js): the rules the editor draws them by, which are Quarto's,
// held here against what `quarto render` printed for each form on
// 2026-09-30 (Quarto 1.9.37, with no filter of MDM's), and the prefixes
// against the language files of the Quarto on this computer. The export
// prints them by the same rules in mdm.lua (render.test.js, html.test.js),
// and the editor draws what this module says (webview-markdown.test.js).
// The figures and the references to them are further down, and they are
// Quarto's alone on the page.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const X = require("../vscode-mdm/media/mdm-crossref.js");

// The share/language folder of the Quarto on the PATH, or null.
function quartoLanguages() {
  let bin;
  try {
    bin = execFileSync("sh", ["-c", "command -v quarto"], { encoding: "utf8" }).trim();
  } catch (e) {
    return null;
  }
  if (!bin) return null;
  const real = fs.realpathSync(bin);
  const dir = path.join(path.dirname(real), "..", "share", "language");
  return fs.existsSync(dir) ? dir : null;
}

test("every language names an equation as Quarto's own language file does", (t) => {
  const dir = quartoLanguages();
  if (!dir) {
    t.skip("no Quarto on the PATH");
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => /^_language(?:-.+)?\.yml$/.test(f));
  assert.ok(files.length > 30, "Quarto's language files were not found in " + dir);
  const seen = new Set();
  for (const file of files) {
    const tag = file.replace(/^_language-?/, "").replace(/\.yml$/, "");
    seen.add(tag);
    const line = fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/).find((l) => /^crossref-eq-prefix:/.test(l));
    if (!line) {
      // A file with no prefix of its own falls to its base language.
      assert.ok(!Object.prototype.hasOwnProperty.call(X.PREFIXES, tag), tag + " has no prefix in Quarto");
      continue;
    }
    const value = /^crossref-eq-prefix:\s*"([^"]*)"/.exec(line) || /^crossref-eq-prefix:\s*(\S+)/.exec(line);
    assert.equal(X.PREFIXES[tag], value[1], "the prefix of " + (tag || "English"));
  }
  for (const tag of Object.keys(X.PREFIXES)) assert.ok(seen.has(tag), tag + " is not one of Quarto's languages");
});

test("a language tag finds its prefix as Quarto finds it: the tag, then its first part, then English", () => {
  // Each read off quarto.doc.language["crossref-eq-prefix"] in a filter,
  // on Quarto 1.9.37.
  const cases = {
    es: "Ecuación", "es-MX": "Ecuación", "es-419": "Ecuación", ES: "Equation",
    "fr-CA": "Équation", "fr-BE": "Équation", "de-AT": "Gleichung", "de-CH": "Gleichung",
    pt: "Equação", "pt-PT": "Equação", "pt-BR": "Equação", "zh-Hant": "式", "zh-TW": "方程式",
    "sr-Latn": "Jednačina", sr: "Equation", "en-GB": "Equation", xx: "Equation", ja: "式",
    nb: "Ligning", no: "Equation", uk: "Equation", ua: "Рівняння", "": "Equation",
  };
  for (const [tag, prefix] of Object.entries(cases)) assert.equal(X.languagePrefix(tag), prefix, tag);
});

test("the header says what an equation is called, how it is counted and whether a reference is a link", () => {
  assert.deepEqual(X.look(""), { prefix: "Equation", labels: "arabic", hyperlink: true });
  assert.equal(X.look("---\nlang: es\n---\n").prefix, "Ecuación");
  assert.equal(X.look("---\nlang: 'fr-CA' # the Quebec one\n---\n").prefix, "Équation");
  // `crossref: eq-prefix` over the language, and `language:` over the
  // language's file, as Quarto takes them.
  assert.equal(X.look("lang: es\ncrossref:\n  eq-prefix: \"eq.\"\n").prefix, "eq.");
  assert.equal(X.look("lang: es\nlanguage:\n  crossref-eq-prefix: \"Ec.\"\n").prefix, "Ec.");
  assert.equal(X.look("lang: es\ncrossref: {eq-prefix: 'Eq.'}\nlanguage:\n  crossref-eq-prefix: Ec.\n").prefix, "Eq.");
  assert.equal(X.look("crossref:\n  eq-prefix: \"\"\n").prefix, "");
  // A language named by a file of its own is not read here.
  assert.equal(X.look("lang: es\nlanguage: custom.yml\n").prefix, "Ecuación");
  // `eq-labels` over `labels`, in either style of map.
  assert.equal(X.look("crossref:\n  labels: roman\n").labels, "roman");
  assert.equal(X.look("crossref:\n  labels: roman\n  eq-labels: alpha A\n").labels, "alpha A");
  assert.equal(X.look("crossref: {labels: alpha a}").labels, "alpha a");
  assert.equal(X.look("crossref:\n  ref-hyperlink: false\n").hyperlink, false);
  assert.equal(X.look("crossref:\n  ref-hyperlink: true\n").hyperlink, true);
  // A key of the same name further in is not the top level's.
  assert.equal(X.look("format:\n  html:\n    lang: es\n").prefix, "Equation");
});

test("equations are counted in the style Quarto reads out of `labels`", () => {
  const counted = (style) => [1, 2, 3, 4, 14].map((n) => X.number(n, style)).join(" ");
  assert.equal(counted("arabic"), "1 2 3 4 14");
  assert.equal(counted("roman"), "I II III IV XIV");
  assert.equal(counted("roman i"), "i ii iii iv xiv");
  assert.equal(counted("alpha A"), "A B C D N");
  assert.equal(counted("alpha a"), "a b c d n");
  // With no letter Quarto takes the word for a list of one (measured: every
  // equation "alpha", and the references "Equation alpha").
  assert.equal(counted("alpha"), "alpha alpha alpha alpha alpha");
  assert.equal(X.number(2, undefined), "2");
});

test("a label is Quarto's: straight after the `$$`, spaces between, whole to its brace and ended by a space", () => {
  assert.deepEqual(X.labelAfter(" {#eq-mass}"), { from: 1, to: 11, label: "eq-mass" });
  assert.deepEqual(X.labelAfter("{#eq-a} where it is"), { from: 0, to: 7, label: "eq-a" });
  assert.deepEqual(X.labelAfter(" \t{#eq-a alt=\"x y\"}"), { from: 2, to: 19, label: "eq-a" });
  // Pandoc reads `{#eq-a}.` as one word with the period, which is no label;
  // Quarto printed it as text beside an equation with no number.
  assert.equal(X.labelAfter(" {#eq-a}."), null);
  assert.equal(X.labelAfter(" {#eq-}"), null);
  assert.equal(X.labelAfter(" {#fig-a}"), null);
  assert.equal(X.labelAfter(" text {#eq-a}"), null);
  assert.equal(X.labelAfter(""), null);
  assert.equal(X.labelAfter(" {#eq-a"), null);
});

test("a citation's source gives its citations with their prefixes and their dashes, as Pandoc reads them", () => {
  assert.deepEqual(X.citations("@eq-a"), [{ key: "eq-a", prefix: "", suppress: false }]);
  assert.deepEqual(X.citations("-@eq-a"), [{ key: "eq-a", prefix: "", suppress: true }]);
  assert.deepEqual(X.citations("@{eq-a}"), [{ key: "eq-a", prefix: "", suppress: false }]);
  assert.deepEqual(X.citations("@eq-a [p. 3]"), [{ key: "eq-a", prefix: "", suppress: false }]);
  assert.deepEqual(X.citations("[see @eq-a, p. 3; -@eq-b]"), [
    { key: "eq-a", prefix: "see", suppress: false },
    { key: "eq-b", prefix: "", suppress: true },
  ]);
  assert.deepEqual(X.citations("[Eq. @Eq-a]"), [{ key: "Eq-a", prefix: "Eq.", suppress: false }]);
});

test("a reference prints what Quarto printed for it, quirks and all", () => {
  // Every row is what `quarto render` wrote for the same source beside
  // `$$ {#eq-a}` and `$$ {#eq-b}` (1 and 2), with no filter of MDM's; bold
  // is **. A figure beside an equation is not the editor's to print.
  const equations = new Map([["eq-a", "1"], ["eq-b", "2"]]);
  const look = X.look("");
  const printed = (raw) => {
    const parts = X.reference(raw, equations, look);
    return parts && parts.map((p) => (p.kind === "missing" ? "**" + p.text + "**" : p.text)).join("");
  };
  const rows = [
    ["@eq-a", "Equation 1"],
    ["-@eq-a", "1"],
    ["[Eq. @eq-a]", "Eq. 1"],
    ["@Eq-a", "Equation 1"],
    ["[@eq-a; @eq-b]", "Equation 1, Equation 2"],
    ["[@eq-a; @eq-zz]", "Equation 1**?@eq-zz**"],
    ["[@eq-zz; @eq-a]", "**?@eq-zz**, Equation 1"],
    ["[see @eq-a, p. 3]", "see 1"],
    ["[@eq-a; @knuth]", "Equation 1"],
    ["[@knuth; @eq-a]", ", Equation 1"],
    ["@eq-a [p. 3]", "Equation 1"],
    ["@{eq-a}", "Equation 1"],
    ["@eq-zz", "**?@eq-zz**"],
    ["@Eq-zz", "**?@eq-zz**"],
    ["[@eq-a; @fig-x]", null],
    ["@knuth", null],
    ["@fig-x", null],
  ];
  for (const [raw, expected] of rows) assert.equal(printed(raw), expected, raw);
  // Linked, or ink when the header says so, and upper-cased by the key.
  assert.deepEqual(X.reference("@eq-a", equations, look).map((p) => p.kind), ["link"]);
  const plain = X.look("crossref:\n  ref-hyperlink: false\n");
  assert.deepEqual(X.reference("@eq-a", equations, plain).map((p) => p.kind), ["text"]);
  const own = X.look("crossref:\n  eq-prefix: \"eq.\"\n");
  assert.equal(X.reference("@eq-a", equations, own)[0].text, "eq. 1");
  assert.equal(X.reference("@Eq-a", equations, own)[0].text, "Eq. 1");
  const spanish = X.look("lang: es\n");
  assert.equal(X.reference("[@eq-a; @eq-b]", equations, spanish).map((p) => p.text).join(""), "Ecuación 1, Ecuación 2");
});

// ---------- Figures by number ----------
//
// A figure with a label (`![A caption](a.svg){#fig-a}`) and the references
// to it, as Quarto 1.9.37 printed them on 2026-10-12 through the extension's
// own export (the filter of MDM in the header, which leaves a figure to
// Quarto): every row below was read off the page of a probe document, the
// caption out of its `figcaption` and a reference out of its
// `a.quarto-xref`. The editor says which images and which divs are figures
// (webview-markdown.test.js), and the page is held against the editor in
// html.test.js.

test("every language names a figure as Quarto's own language file does", (t) => {
  const dir = quartoLanguages();
  if (!dir) {
    t.skip("no Quarto on the PATH");
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => /^_language(?:-.+)?\.yml$/.test(f));
  assert.ok(files.length > 30, "Quarto's language files were not found in " + dir);
  const seen = new Set();
  for (const file of files) {
    const tag = file.replace(/^_language-?/, "").replace(/\.yml$/, "");
    seen.add(tag);
    const lines = fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/);
    // No file has a word of its own for a reference, which is why a
    // reference takes the caption's (figureLook).
    assert.ok(!lines.some((l) => /^crossref-fig-prefix:/.test(l)), file + " has a crossref-fig-prefix");
    const line = lines.find((l) => /^crossref-fig-title:/.test(l));
    if (!line) {
      // A file with no title of its own falls to its base language.
      assert.ok(!Object.prototype.hasOwnProperty.call(X.FIGURE_TITLES, tag), tag + " has no title in Quarto");
      continue;
    }
    const value = /^crossref-fig-title:\s*"([^"]*)"/.exec(line) || /^crossref-fig-title:\s*(\S+)/.exec(line);
    assert.equal(X.FIGURE_TITLES[tag], value[1], "the title of " + (tag || "English"));
  }
  for (const tag of Object.keys(X.FIGURE_TITLES)) assert.ok(seen.has(tag), tag + " is not one of Quarto's languages");
});

test("the header says what a figure is called in its caption and in a reference, which Quarto finds apart", () => {
  assert.deepEqual(X.figureLook(""), { title: "Figure", prefix: "Figure", labels: "arabic", delim: ":" });
  // The language names both: "Figura 1: A caption" and "Figura 1" under
  // `lang: es`, 图 under `lang: zh`, and a tag Quarto has no file for is
  // English, `ES` among them.
  assert.deepEqual(X.figureLook("lang: es\n"), { title: "Figura", prefix: "Figura", labels: "arabic", delim: ":" });
  assert.equal(X.figureLook("lang: zh\n").prefix, "图");
  assert.equal(X.figureLook("lang: fr-CA\n").title, "Figure");
  assert.equal(X.figureLook("lang: de-AT\n").title, "Abbildung");
  assert.equal(X.figureLook("lang: ES\n").title, "Figure");
  // `crossref: fig-title` renames the captions and no reference: "Lámina 1:
  // A caption" over "Figure 1" (measured, and not what a reader expects).
  assert.deepEqual(
    X.figureLook("crossref:\n  fig-title: \"Lámina\"\n"),
    { title: "Lámina", prefix: "Figure", labels: "arabic", delim: ":" }
  );
  // The title under `language:` is the language's, so it renames both.
  const imagen = X.figureLook("language:\n  crossref-fig-title: \"Imagen\"\n");
  assert.deepEqual([imagen.title, imagen.prefix], ["Imagen", "Imagen"]);
  // A prefix of its own, under `language:` or under `crossref:`, the second
  // over the first.
  const both = X.figureLook("language:\n  crossref-fig-title: \"Imagen\"\n  crossref-fig-prefix: \"imagen\"\n");
  assert.deepEqual([both.title, both.prefix], ["Imagen", "imagen"]);
  assert.equal(X.figureLook("lang: ES\nlanguage:\n  crossref-fig-prefix: \"fig.\"\n").prefix, "fig.");
  const own = X.figureLook("lang: es\ncrossref:\n  fig-prefix: \"fig.\"\n  title-delim: \" —\"\n");
  assert.deepEqual(own, { title: "Figura", prefix: "fig.", labels: "arabic", delim: "—" });
  assert.equal(X.figureLook("language:\n  crossref-fig-prefix: a\ncrossref: {fig-prefix: b}\n").prefix, "b");
  // Emptied, each of them.
  const none = X.figureLook("crossref:\n  fig-title: \"\"\n  fig-prefix: \"\"\n");
  assert.deepEqual([none.title, none.prefix], ["", ""]);
  // Counted in the figures' own style, else in the document's.
  assert.equal(X.figureLook("crossref:\n  fig-labels: roman\n").labels, "roman");
  assert.equal(X.figureLook("crossref:\n  labels: alpha a\n").labels, "alpha a");
  assert.equal(X.figureLook("crossref:\n  labels: alpha a\n  fig-labels: alpha A\n").labels, "alpha A");
  assert.equal(X.figureLook("crossref:\n  eq-labels: roman\n").labels, "arabic");
  // The delimiter without the spaces around it, and none at all.
  assert.equal(X.figureLook("crossref:\n  title-delim: \". \"\n").delim, ".");
  assert.equal(X.figureLook("crossref:\n  title-delim: \" | x \"\n").delim, "| x");
  assert.equal(X.figureLook("crossref:\n  title-delim: \"\"\n").delim, "");
});

test("a figure's caption opens as Quarto printed it, and a figure inside a figure with its letter", () => {
  const opens = (header, n, captioned) => {
    const look = X.figureLook(header);
    return X.caption(X.number(n, look.labels), look, captioned);
  };
  // Each is the head of a `figcaption` of the page, before "Caption A".
  assert.equal(opens("", 1, true), "Figure 1: ");
  assert.equal(opens("lang: es\n", 13, true), "Figura 13: ");
  assert.equal(opens("crossref:\n  fig-title: \"Fig.\"\n  title-delim: \".\"\n  fig-labels: roman\n", 13, true), "Fig. XIII. ");
  assert.equal(opens("crossref:\n  labels: alpha a\n", 2, true), "Figure b: ");
  assert.equal(opens("lang: es\ncrossref:\n  title-delim: \" —\"\n", 1, true), "Figura 1— ");
  assert.equal(opens("crossref:\n  title-delim: \" | x \"\n", 1, true), "Figure 1| x ");
  assert.equal(opens("crossref:\n  title-delim: \"\"\n", 1, true), "Figure 1 ");
  // The no-break space stands whatever the title: " 1: Caption A".
  assert.equal(opens("crossref:\n  fig-title: \"\"\n", 1, true), " 1: ");
  // A figure with no caption has its number for one, and no delimiter.
  assert.equal(opens("", 2, false), "Figure 2");
  assert.equal(opens("crossref:\n  fig-title: \"Fig.\"\n  title-delim: \".\"\n  fig-labels: roman\n", 2, false), "Fig. II");
  assert.equal(opens("crossref:\n  fig-title: \"\"\n", 2, false), " 2");
  // Inside a figure: "(a) Sub one", "(b) Sub two", whatever the header
  // counts the figures in.
  assert.equal(X.subcaption(1, true), "(a) ");
  assert.equal(X.subcaption(2, true), "(b) ");
  assert.equal(X.subcaption(3, false), "(c)");
});

test("a reference to a figure prints what Quarto printed for it, beside an equation too", () => {
  // The numbers the probe's figures took: `fig-a` is written twice and the
  // later one, the thirteenth, is the one a reference finds; `fig-sub1` is
  // the first figure inside the sixth; `fig-intbl` stands in a table, whose
  // number the editor does not count; and no figure carries `fig-inline`
  // (an image in a sentence), `fig-cell` (one in a table's cell) or
  // `fig-b` (the label is `fig-B`). Bold is **.
  const equations = new Map([["eq-x", "1"]]);
  const numbers = new Map([
    ["fig-a", "13"], ["fig-w", "10"], ["fig-empty", "2"], ["fig-div", "5"], ["fig-subs", "6"],
    ["fig-sub1", "6 (a)"], ["fig-B", "9"], ["fig-intbl", null],
  ]);
  const printed = (raw, header) => {
    const figures = { numbers: numbers, prefix: X.figureLook(header || "").prefix };
    const parts = X.reference(raw, equations, X.look(header || ""), figures);
    return parts && parts.map((p) => (p.kind === "missing" ? "**" + p.text + "**" : p.text)).join("");
  };
  const rows = [
    ["@fig-a", "Figure 13"],
    ["[@fig-a]", "Figure 13"],
    ["-@fig-a", "13"],
    ["@Fig-a", "Figure 13"],
    ["[see @fig-a]", "see 13"],
    ["[Fig. @fig-a]", "Fig. 13"],
    ["[@fig-a; @fig-w]", "Figure 13, Figure 10"],
    ["[-@fig-a; -@fig-w]", "13, 10"],
    ["[@fig-a; @eq-x]", "Figure 13, Equation 1"],
    ["[@eq-x; @fig-a]", "Equation 1, Figure 13"],
    ["@fig-missing", "**?@fig-missing**"],
    ["[@fig-a; @fig-missing]", "Figure 13**?@fig-missing**"],
    ["[@fig-missing; @fig-a]", "**?@fig-missing**, Figure 13"],
    ["@fig-div", "Figure 5"],
    ["@fig-subs", "Figure 6"],
    ["@fig-sub1", "Figure 6 (a)"],
    ["-@fig-sub1", "6 (a)"],
    ["@fig-empty", "Figure 2"],
    ["@fig-inline", "**?@fig-inline**"],
    ["@fig-cell", "**?@fig-cell**"],
    ["[@fig-a, p. 3]", "Figure 13"],
    ["@fig-a [p. 3]", "Figure 13"],
    ["@fig-B", "Figure 9"],
    ["@fig-b", "**?@fig-b**"],
    ["[@fig-a; @knuth84]", "Figure 13"],
    // Not the editor's to print: a figure whose number is a table's, a
    // table, and a key of the bibliography.
    ["@fig-intbl", null],
    ["[@fig-a; @fig-intbl]", null],
    ["[@fig-a; @tbl-x]", null],
    ["@tbl-x", null],
    ["@plain", null],
  ];
  for (const [raw, expected] of rows) assert.equal(printed(raw), expected, raw);
  // The header's words, upper-cased by the key, and none where it empties
  // them.
  assert.equal(printed("@fig-a", "lang: es\n"), "Figura 13");
  assert.equal(printed("[@fig-a; @eq-x]", "lang: es\n"), "Figura 13, Ecuación 1");
  assert.equal(printed("@fig-a", "crossref:\n  fig-prefix: \"fig.\"\n"), "fig. 13");
  assert.equal(printed("@Fig-a", "crossref:\n  fig-prefix: \"fig.\"\n"), "Fig. 13");
  assert.equal(printed("@Fig-a", "language:\n  crossref-fig-prefix: \"imagen\"\n"), "Imagen 13");
  assert.equal(printed("@fig-a", "crossref:\n  fig-title: \"Lámina\"\n"), "Figure 13");
  assert.equal(printed("@fig-a", "crossref:\n  fig-prefix: \"\"\n"), "13");
  // A piece that names a figure says so, for the click that goes to it, and
  // an equation's does not; linked, or ink when the header says so.
  const figures = { numbers: numbers, prefix: "Figure" };
  assert.deepEqual(X.reference("[@fig-a; @eq-x]", equations, X.look(""), figures), [
    { kind: "link", text: "Figure 13", label: "fig-a", ref: "fig" },
    { kind: "text", text: ", " },
    { kind: "link", text: "Equation 1", label: "eq-x" },
  ]);
  const plain = X.look("crossref:\n  ref-hyperlink: false\n");
  assert.deepEqual(X.reference("@fig-a", equations, plain, figures).map((p) => p.kind), ["text"]);
  // A caller that numbers no figures leaves a figure's reference alone.
  assert.equal(X.reference("@fig-a", equations, X.look("")), null);
  assert.equal(X.reference("[@eq-x; @fig-a]", equations, X.look("")), null);
});

// ---------- Tables by number ----------
//
// A table whose caption carries a label (`: The shapes {#tbl-shapes}`) is
// numbered as a figure is, by Quarto on the page and by the same rules here
// (the owner, 2026-10-12: tables centred, captioned and cited). Every
// expectation is what `quarto render` printed on 1.9.37 that day through the
// extension's export, read out of the page's `figcaption` and its
// `a.quarto-xref` on the probes of tests/tmp/tbl-crossref/rules.

test("every language names a table as Quarto's own language file does", (t) => {
  const dir = quartoLanguages();
  if (!dir) {
    t.skip("no Quarto on the PATH");
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => /^_language(?:-.+)?\.yml$/.test(f));
  assert.ok(files.length > 30, "Quarto's language files were not found in " + dir);
  const seen = new Set();
  for (const file of files) {
    const tag = file.replace(/^_language-?/, "").replace(/\.yml$/, "");
    seen.add(tag);
    const lines = fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/);
    // No file has a word of its own for a reference to a table either.
    assert.ok(!lines.some((l) => /^crossref-tbl-prefix:/.test(l)), file + " has a crossref-tbl-prefix");
    const line = lines.find((l) => /^crossref-tbl-title:/.test(l));
    if (!line) {
      assert.ok(!Object.prototype.hasOwnProperty.call(X.TABLE_TITLES, tag), tag + " has no title in Quarto");
      continue;
    }
    const value = /^crossref-tbl-title:\s*"([^"]*)"/.exec(line) || /^crossref-tbl-title:\s*(\S+)/.exec(line);
    assert.equal(X.TABLE_TITLES[tag], value[1], "the title of " + (tag || "English"));
  }
  for (const tag of Object.keys(X.TABLE_TITLES)) assert.ok(seen.has(tag), tag + " is not one of Quarto's languages");
});

test("the header says what a table is called, by the keys a figure has with `tbl` for `fig`, and a table's caption opens as Quarto printed it", () => {
  assert.deepEqual(X.tableLook(""), { title: "Table", prefix: "Table", labels: "arabic", delim: ":" });
  assert.deepEqual(X.tableLook("lang: es\n"), { title: "Tabla", prefix: "Tabla", labels: "arabic", delim: ":" });
  assert.equal(X.tableLook("lang: de-AT\n").title, "Tabelle");
  assert.equal(X.tableLook("lang: fr-CA\n").title, "Table");
  // A figure's keys are not a table's, nor a table's a figure's.
  assert.equal(X.tableLook("crossref:\n  fig-title: \"Lámina\"\n  fig-labels: roman\n").title, "Table");
  assert.equal(X.tableLook("crossref:\n  fig-title: \"Lámina\"\n  fig-labels: roman\n").labels, "arabic");
  assert.equal(X.figureLook("crossref:\n  tbl-title: \"Cuadro\"\n  tbl-labels: roman\n").title, "Figure");
  assert.equal(X.figureLook("crossref:\n  tbl-title: \"Cuadro\"\n  tbl-labels: roman\n").labels, "arabic");
  // As a figure's, the title renames the captions alone and the language's
  // names both.
  assert.deepEqual(X.tableLook("crossref:\n  tbl-title: \"Cuadro\"\n"), { title: "Cuadro", prefix: "Table", labels: "arabic", delim: ":" });
  const tabla = X.tableLook("language:\n  crossref-tbl-title: \"Cuadro\"\n");
  assert.equal(tabla.title, "Cuadro");
  assert.equal(tabla.prefix, "Cuadro");
  // The probe's header: "Cuadro I. Uno" over the table, "cuadro I" in the
  // text.
  const own = "lang: es\ncrossref:\n  tbl-title: Cuadro\n  tbl-prefix: cuadro\n  tbl-labels: roman\n  title-delim: \".\"\n";
  assert.deepEqual(X.tableLook(own), { title: "Cuadro", prefix: "cuadro", labels: "roman", delim: "." });
  const opens = (header, n, captioned) => {
    const look = X.tableLook(header);
    return X.caption(X.number(n, look.labels), look, captioned);
  };
  assert.equal(opens("", 1, true), "Table 1: ");
  assert.equal(opens("lang: es\n", 2, true), "Tabla 2: ");
  assert.equal(opens(own, 2, true), "Cuadro II. ");
  // A table whose caption is its label alone, `: {#tbl-only}`, and a div
  // with no caption: the number and no delimiter.
  assert.equal(opens("", 4, false), "Table 4");
});

test("a reference to a table prints what Quarto printed for it, beside a figure and an equation", () => {
  // The numbers the probes' tables took: `tbl-suba` is the first table
  // inside the eighth, a div of two; `tbl-infig` is a table inside the
  // first figure, and reads with the figure's number after a table's word;
  // `fig-intbl` a figure inside the first table, the other way round; no
  // table carries `tbl-five` (written under `TABLE:`, which is no caption),
  // `tbl-sixa` (a second caption, after a table that had one before it) or
  // `tbl-first` (the first of two identifiers). Bold is **.
  const equations = new Map([["eq-a", "1"]]);
  const tables = new Map([
    ["tbl-one", "1"], ["tbl-b", "2"], ["tbl-panel", "8"], ["tbl-suba", "8 (a)"], ["tbl-infig", "1 (a)"], ["tbl-lost", null],
  ]);
  const figures = new Map([["fig-a", "1"], ["fig-intbl", "1 (a)"]]);
  const printed = (raw, header) => {
    const parts = X.reference(
      raw, equations, X.look(header || ""),
      { numbers: figures, prefix: X.figureLook(header || "").prefix },
      { numbers: tables, prefix: X.tableLook(header || "").prefix }
    );
    return parts && parts.map((p) => (p.kind === "missing" ? "**" + p.text + "**" : p.text)).join("");
  };
  const rows = [
    ["@tbl-one", "Table 1"],
    ["[@tbl-one]", "Table 1"],
    ["-@tbl-one", "1"],
    ["@Tbl-b", "Table 2"],
    ["[Tab. @tbl-one]", "Tab. 1"],
    ["[@tbl-one; @tbl-b]", "Table 1, Table 2"],
    ["@tbl-panel", "Table 8"],
    ["@tbl-suba", "Table 8 (a)"],
    ["@tbl-infig", "Table 1 (a)"],
    ["@fig-intbl", "Figure 1 (a)"],
    ["@tbl-five", "**?@tbl-five**"],
    ["[@tbl-one; @tbl-sixa]", "Table 1**?@tbl-sixa**"],
    ["[@tbl-b; @fig-a; @eq-a]", "Table 2, Figure 1, Equation 1"],
    ["[@tbl-one, p. 3]", "Table 1"],
    ["[@tbl-one; @knuth84]", "Table 1"],
    // Not the editor's to print: a table it could not number, a listing, a
    // section.
    ["@tbl-lost", null],
    ["[@tbl-one; @lst-x]", null],
    ["[@tbl-one; @sec-x]", null],
    ["@plain", null],
  ];
  for (const [raw, expected] of rows) assert.equal(printed(raw), expected, raw);
  // The header's words: the probe in Spanish, and the one that names them.
  assert.equal(printed("[@tbl-b; @fig-a; @eq-a]", "lang: es\n"), "Tabla 2, Figura 1, Ecuación 1");
  const own = "lang: es\ncrossref:\n  tbl-title: Cuadro\n  tbl-prefix: cuadro\n";
  assert.equal(printed("@tbl-one", own), "cuadro 1");
  assert.equal(printed("@Tbl-b", own), "Cuadro 2");
  assert.equal(printed("[véase @tbl-one, p. 3]", own), "véase 1");
  // A piece that names a table says so, for the click that goes to it.
  const float = (map, word) => ({ numbers: map, prefix: word });
  assert.deepEqual(X.reference("[@tbl-one; @fig-a]", equations, X.look(""), float(figures, "Figure"), float(tables, "Table")), [
    { kind: "link", text: "Table 1", label: "tbl-one", ref: "tbl" },
    { kind: "text", text: ", " },
    { kind: "link", text: "Figure 1", label: "fig-a", ref: "fig" },
  ]);
  // A caller that numbers no tables leaves a table's reference alone, alone
  // or beside a figure.
  assert.equal(X.reference("@tbl-one", equations, X.look(""), float(figures, "Figure")), null);
  assert.equal(X.reference("[@fig-a; @tbl-one]", equations, X.look(""), float(figures, "Figure")), null);
});

// ---------- Sections by number ----------
//
// `number-sections: true` and the keys beside it, as Quarto 1.9.37 printed
// them on 2026-10-03: each row below is a document rendered with
// `bin/mdm render x.mdm --to html` and the numbers read out of the
// `header-section-number` of its headings. The editor says which lines are
// headings and which of them are unnumbered (webview-markdown.test.js), and
// the page is held against the editor in html.test.js. The rows of the last
// test are the one rule that is the owner's and not Quarto's.

// The headings of a row, written as their levels: `2` is a `##`, `2-` one
// with `{.unnumbered}` on it. The numbers come back with `-` where the page
// prints none.
function numbered(header, levels) {
  const headings = levels.split(" ").map((h) => ({ level: Number(h.charAt(0)), unnumbered: h.slice(1) === "-" }));
  return X.sectionNumbers(headings, X.sectionLook(header)).map((n) => (n === null ? "-" : n)).join(" ");
}

test("the header says whether the sections are numbered, how deep and from where, and the page's say goes over the document's", () => {
  assert.deepEqual(X.sectionLook(""), { numbered: false, depth: 6, offsets: [], chapters: false });
  assert.deepEqual(X.sectionLook("---\ntitle: T\nnumber-sections: true\n---\n"), { numbered: true, depth: 6, offsets: [], chapters: false });
  // A comment after the value, and the two other spellings Quarto takes.
  assert.deepEqual(
    X.sectionLook("number-sections: true # yes\nnumber-depth: 2 # two\n"),
    { numbered: true, depth: 2, offsets: [], chapters: false }
  );
  assert.equal(X.sectionLook("number-sections: True\n").numbered, true);
  assert.equal(X.sectionLook("number-sections: TRUE\n").numbered, true);
  // `yes` and `on` are not YAML 1.2's true: Quarto refuses the header
  // ("Validation of YAML front matter failed") and exports nothing.
  assert.equal(X.sectionLook("number-sections: yes\n").numbered, false);
  assert.equal(X.sectionLook("number-sections: on\n").numbered, false);
  assert.equal(X.sectionLook("number-sections: false\n").numbered, false);
  // Under `format: html:`, alone or over what the document says; what is
  // written for the PDF is the PDF's.
  const page = (top, html) => "---\n" + top + "format:\n  html:\n    embed-resources: true\n" + html + "  pdf:\n    documentclass: article\n---\n";
  assert.equal(X.sectionLook(page("", "    number-sections: true\n")).numbered, true);
  assert.equal(X.sectionLook(page("number-sections: false\n", "    number-sections: true\n")).numbered, true);
  assert.equal(X.sectionLook(page("number-sections: true\n", "    number-sections: false\n")).numbered, false);
  assert.equal(X.sectionLook(page("number-sections: true\nnumber-depth: 2\n", "    number-depth: 3\n")).depth, 3);
  assert.equal(X.sectionLook("format:\n  pdf:\n    number-sections: true\n").numbered, false);
  assert.equal(X.sectionLook("number-sections: true\nformat: html\n").numbered, true);
  // The offsets: a number, a list in either style, and what repeats in it
  // dropped as Quarto drops it; the page's list added and not put over.
  assert.deepEqual(X.sectionLook("number-offset: 3\n").offsets, [3]);
  assert.deepEqual(X.sectionLook("number-offset: [2, 5]\n").offsets, [2, 5]);
  assert.deepEqual(X.sectionLook("number-offset: [2,5]\n").offsets, [2, 5]);
  assert.deepEqual(X.sectionLook("number-offset:\n  - 2\n  - 5\n").offsets, [2, 5]);
  assert.deepEqual(X.sectionLook("number-offset: [1, 1, 1]\n").offsets, [1]);
  assert.deepEqual(X.sectionLook("number-offset: [0, 0, 4]\n").offsets, [0, 4]);
  assert.deepEqual(X.sectionLook(page("number-offset: [2, 5]\n", "    number-offset: [3]\n")).offsets, [2, 5, 3]);
  assert.deepEqual(X.sectionLook(page("number-offset: 3\n", "    number-offset: [4, 4]\n")).offsets, [3, 4]);
  assert.equal(X.sectionLook("crossref:\n  chapters: true\n").chapters, true);
});

test("the sections are numbered as Quarto printed them, quirks and all", () => {
  const on = "number-sections: true\n";
  const page = (top, html) => top + "format:\n  html:\n" + html;
  const rows = [
    // The plain case, and the same document written one level down.
    [on, "1 2 2 3 1- 1", "1 1.1 1.2 1.2.1 - 2"],
    [on, "2 3 3 4 2- 2", "1 1.1 1.2 1.2.1 - 2"],
    // Written from `###` down, the second level is a 0.
    [on, "3 3 4", "0.1 0.2 0.2.1"],
    // A level stepped over stays as a 0, and is counted from 1 once written.
    [on, "1 3 2 3 1 2", "1 1.0.1 1.1 1.1.1 2 2.1"],
    [on, "1 2 3 4 5 6 6 4 1 6", "1 1.1 1.1.1 1.1.1.1 1.1.1.1.1 1.1.1.1.1.1 1.1.1.1.1.2 1.1.1.2 2 2.0.0.0.0.1"],
    // A numbered `#` anywhere makes the first level part of every number.
    [on, "2 2 1 2", "0.1 0.2 1 1.1"],
    // The depth is counted in `#`, and what is past it is still counted.
    [on + "number-depth: 1\n", "1 2 1- 2 1", "1 - - - 2"],
    [on + "number-depth: 2\n", "2 3 4 3", "1 - - -"],
    [on + "number-depth: 0\n", "1", "-"],
    [page(on + "number-depth: 2\n", "    number-depth: 3\n"), "1 2 3 1 2", "1 1.1 1.1.1 2 2.1"],
    // The offsets, the repeated ones dropped and the page's added.
    [on + "number-offset: 0\n", "1 2 3 1 2", "1 1.1 1.1.1 2 2.1"],
    [on + "number-offset: 3\n", "1 2 1 2", "4 4.1 5 5.1"],
    [on + "number-offset: [2, 5]\n", "1 2 1 2", "3 3.6 4 4.6"],
    [on + "number-offset: [2,5]\n", "1 2 3 1 2", "3 3.6 3.6.1 4 4.6"],
    [on + "number-offset:\n  - 2\n  - 5\n", "1 2 3 1 2", "3 3.6 3.6.1 4 4.6"],
    [on + "number-offset: [2, 5]\n", "2 3 2 3", "6 6.1 7 7.1"],
    [on + "number-offset: [1, 0, 2]\n", "1 2 3 2 3", "2 2.1 2.1.3 2.2 2.2.3"],
    [on + "number-offset: [1,1,1]\n", "1 2 3 1 2", "2 2.1 2.1.1 3 3.1"],
    [on + "number-offset: [1, 0, 1]\n", "1 2 3 1 2", "2 2.1 2.1.1 3 3.1"],
    [on + "number-offset: [0, 0, 4]\n", "1 2 3 1 2", "1 1.5 1.5.1 2 2.5"],
    [on + "number-offset: [1,1,1]\nnumber-depth: 3\n", "2 3 4 2 3", "1 1.1 - 2 2.1"],
    [on + "number-depth: 2\nnumber-offset: [1, 1, 1]\n", "2 3 4 2 3", "1 - - 2 -"],
    [page(on + "number-offset: [2, 5]\n", "    number-offset: [3]\n"), "1 2 3 1 2", "3 3.6 3.6.4 4 4.6"],
    [page(on + "number-offset: 3\n", "    number-offset: [4, 4]\n"), "1 2 3 1 2", "4 4.5 4.5.1 5 5.5"],
    // For the page alone, or not for the page.
    [page("", "    number-sections: true\n    number-depth: 2\n    number-offset: 4\n"), "1 2 3", "5 5.1 -"],
    [page("number-sections: false\n", "    number-sections: true\n"), "1 2", "1 1.1"],
    [page(on, "    number-sections: false\n"), "1 2", "- -"],
    // Chapters count from the first level whatever the document has.
    [on + "crossref:\n  chapters: true\n", "2 3", "0.1 0.1.1"],
    // And a header that asks for nothing numbers nothing.
    ["title: T\n", "1 2", "- -"],
  ];
  for (const [header, levels, expected] of rows) {
    assert.equal(numbered(header, levels), expected, JSON.stringify(header) + " over " + levels);
  }
});

// Where the editor leaves Quarto, on the owner's word of 2026-10-03. Quarto
// prints the `##` under `# Title {-}` as 0.1, 0.2: the unnumbered `#` is
// still its first level, with a counter that never moves. Here a first level
// that carries no number is not counted from, and the page is brought to it
// by mdm-after.lua (html.test.js) and the paper by mdm.lua (render.test.js).
test("a first level with its number turned off is not counted from", () => {
  const on = "number-sections: true\n";
  const rows = [
    // A title and its sections; Quarto has these at 0.1, 0.1.1, 0.2.
    [on, "1- 2 3 2", "- 1 1.1 2"],
    // A second title does not start the count again, and an unnumbered
    // section under it takes nothing from it.
    [on, "1- 2 3 2 1- 2 2- 2", "- 1 1.1 2 - 3 - 4"],
    // The levels under it are counted as in a document with no `#` at all:
    // one written from `###` down opens on the 0 of its second level.
    [on, "1- 3 3", "- 0.1 0.2"],
    [on, "1- 2 4 2", "- 1 1.0.1 2"],
    // The offset of the first level is in no number, and the others count.
    [on + "number-offset: [3, 4]\n", "1- 2 2", "- 5 6"],
    // The depth is still counted in `#`.
    [on + "number-depth: 2\n", "1- 2 3", "- 1 -"],
    // One `#` that carries a number and the first level is back in every
    // number, as Quarto prints it.
    [on, "1- 2 1 2", "- 0.1 1 1.1"],
    [on, "1 2 1- 2", "1 1.1 - 1.2"],
    // And so it is where the header asks for chapters.
    [on + "crossref:\n  chapters: true\n", "1- 2 2", "- 0.1 0.2"],
  ];
  for (const [header, levels, expected] of rows) {
    assert.equal(numbered(header, levels), expected, JSON.stringify(header) + " over " + levels);
  }
});

// ---------- The title block ----------

// What the header puts at the head of the page, read as the editor reads it
// to draw the same block (titleLook): the title and the subtitle, the
// categories and the description, whoever wrote the document and where they
// work, the dates and the DOI, the abstract and the keywords. Each form is
// held against what `quarto render` printed for it on 2026-10-03 and
// 2026-10-04 (Quarto 1.9.37, under the filter). What Quarto prints and this
// does not read is listed where the reading is, in mdm-crossref.js.
const TITLE_NOW = new Date(2026, 9, 3, 15, 30);
const titled = (lines) => X.titleLook(["---"].concat(lines, ["---", ""]).join("\n"), TITLE_NOW);
const somebody = (name, more) =>
  Object.assign({ name: name, degrees: [], url: "", email: "", orcid: "", affiliations: [] }, more || {});

// ---- The header as a tree ----

test("the header is read as the tree it is, to any depth", () => {
  const read = (lines) => X.readHeader(lines.join("\n"));
  // Maps in lists in maps, the list of a key at the key's own column, and
  // the flow styles on a line.
  assert.deepEqual(
    read([
      "---", "author:", "- name: A", "  affiliations:", "    - X", "    - name: Y", "      url: https://y.example", "- B",
      "keywords: [one, \"two, three\"]", "crossref: {eq-prefix: Eq., labels: roman}", "---", "",
    ]),
    {
      author: [{ name: "A", affiliations: ["X", { name: "Y", url: "https://y.example" }] }, "B"],
      keywords: ["one", "two, three"],
      crossref: { "eq-prefix": "Eq.", labels: "roman" },
    }
  );
  // A scalar is the text it was written as: nothing is made a number or a
  // boolean, a comment is no part of it, and a key with nothing after it is
  // null.
  assert.deepEqual(read(["a: true", "b: 2026-10-04  # the day", "c: 'It''s'  # quoted", "d:", 'e: "x: y # z"', "f: https://example.org/#top"]), {
    a: "true", b: "2026-10-04", c: "It's", d: null, e: "x: y # z", f: "https://example.org/#top",
  });
  // What a backslash writes between double quotes, and a figure that names
  // no character left as it was written (it used to throw, which would have
  // taken the drawing of the document with it).
  assert.deepEqual(read(['a: "caf\\u00e9\\tb\\n"', 'b: "say \\"hi\\""', "c: '\\n'"]), { a: "café\tb\n", b: 'say "hi"', c: "\\n" });
  assert.deepEqual(read(['a: "x\\UFFFFFFFFy\\U0001F3B5"']), { a: "x\\UFFFFFFFFy\u{1F3B5}" });
  // A plain scalar and a quoted one run on over the lines set in under
  // their key, a line break being a space.
  assert.deepEqual(read(["title: A title that", "  runs on", 'subtitle: "Quoted and', '  continued"', "author: A"]), {
    title: "A title that runs on", subtitle: "Quoted and continued", author: "A",
  });
  // The two block styles, and what the sign after them does to the end.
  assert.deepEqual(read(["a: |", "  one", "  two", "", "  three", "b: >", "  one", "  two", "", "  three", "c: |-", "  one", "d: >+", "  one", "", "e: x"]), {
    a: "one\ntwo\n\nthree\n", b: "one two\nthree\n", c: "one", d: "one\n\n", e: "x",
  });
  // A block under an item of a list, and a margin of its own.
  assert.deepEqual(read(["a:", "  - |", "    one", "  - two", "b: |2", "    set in"]), { a: ["one\n", "two"], b: "  set in\n" });
  // The fences are no part of it, whichever closes it, and neither is what
  // follows them; a file from Windows reads the same.
  assert.deepEqual(read(["---", "a: 1", "...", "b: 2"]), { a: "1" });
  assert.deepEqual(X.readHeader("---\r\na: 1\r\nb:\r\n  - x\r\n---\r\n"), { a: "1", b: ["x"] });
  assert.deepEqual(X.readHeader(""), {});
  assert.deepEqual(X.readHeader("just a line of prose\n"), {});
  // A colon is the end of a key only before a space or the end of the line:
  // an address at the head of an item is a text, not a map of `https`.
  assert.deepEqual(read(["links:", "  - https://example.org/a", "  - mailto:x@example.org", "  - at 12:30"]), {
    links: ["https://example.org/a", "mailto:x@example.org", "at 12:30"],
  });
  // A key that would reach into the object itself is not taken: read as any
  // other, it would become what the tree inherits from, and a `title` under
  // it a title the page knows nothing of.
  const hostile = read(["__proto__:", "  polluted: yes", "  title: Sneaked in", "a: 1"]);
  assert.deepEqual(Object.keys(hostile), ["a"]);
  assert.equal(hostile.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(titled(["__proto__:", "  title: Sneaked in", "lang: en"]), null);
});

// ---- What the block says ----

test("the title block is read off the header, every part of it", () => {
  assert.deepEqual(
    titled(['title: "A Markdown Music prototype"', 'subtitle: "Markdown and scores in one file"', "author: alpelito7", "lang: en"]),
    {
      title: "A Markdown Music prototype",
      subtitle: "Markdown and scores in one file",
      categories: [],
      description: null,
      authors: [somebody("alpelito7")],
      affiliated: false,
      date: "",
      modified: "",
      doi: "",
      abstract: null,
      abstractTitle: "Abstract",
      keywords: [],
      keywordsTitle: "Keywords",
    }
  );
  // Bare, single-quoted and with a comment after it.
  assert.equal(titled(["title: Plain title"]).title, "Plain title");
  assert.equal(titled(["title: 'It''s plain'  # the title"]).title, "It's plain");
  // A block scalar is one line of text on the page, its lines run together,
  // and so is a plain one that runs on.
  assert.equal(titled(["title: >", "  A long title", "  on two lines"]).title, "A long title on two lines");
  assert.equal(titled(["subtitle: |-", "  One", "  two"]).subtitle, "One two");
  assert.equal(titled(["title: A title that", "  runs on over two plain lines"]).title, "A title that runs on over two plain lines");
  // A key alone on its line names nothing, and neither does an empty string.
  assert.equal(titled(["title:", 'subtitle: ""', "author: A"]).title, "");
  // Only top-level keys: a `title` inside another map is that map's.
  assert.equal(titled(["format:", "  html:", "    title: no", "author: A"]).title, "");
  // The rest of the row the date is in, and the tags under the title.
  const more = titled(["title: T", "date: 2026-10-04", "date-modified: 2026-10-05", "doi: 10.1234/abcd.5678", "categories: [music, harmony]"]);
  assert.equal(more.date, "October 4, 2026");
  assert.equal(more.modified, "October 5, 2026");
  assert.equal(more.doi, "10.1234/abcd.5678");
  assert.deepEqual(more.categories, ["music", "harmony"]);
  assert.deepEqual(titled(["title: T", "categories: single"]).categories, ["single"]);
  assert.deepEqual(titled(["title: T", "categories: [a, b]", "title-block-categories: false"]).categories, []);
});

test("a header that puts nothing at the head of the page reads as no block", () => {
  // The page prints nothing for these, so the editor draws nothing and the
  // YAML button is the way in.
  assert.equal(titled(["lang: en"]), null);
  assert.equal(titled(["number-sections: true", "bibliography: refs.bib", "format:", "  html:", "    toc: true"]), null);
  assert.equal(titled(["title:", 'subtitle: ""']), null);
  assert.equal(X.titleLook("", TITLE_NOW), null);
  // Any one of the nine keys Quarto's template asks about is a block.
  for (const line of [
    "title: T", "subtitle: S", "author: A", "authors: A", "date: 2026-10-03", "categories: [c]",
    "date-modified: 2026-10-03", "doi: 10.1/x", "abstract: A.", "keywords: [k]",
  ]) {
    assert.ok(titled([line]), line + " drew nothing");
  }
  // And nothing else is: a description on its own, the affiliations of
  // nobody, categories the header turns off, an author Quarto drops.
  assert.equal(titled(["description: Alone."]), null);
  assert.equal(titled(["affiliations:", "  - name: Lonely Place", "lang: en"]), null);
  assert.equal(titled(["categories: [solo]", "title-block-categories: false"]), null);
  assert.equal(titled(["institute: Nobody's"]), null);
  assert.equal(titled(['author: ""']), null);
});

test("whoever wrote the document is read in every way the header names them", () => {
  const names = (lines) => titled(lines).authors.map((a) => a.name);
  assert.deepEqual(names(["author: alpelito7"]), ["alpelito7"]);
  assert.deepEqual(names(["authors: alpelito7"]), ["alpelito7"], "`authors` is `author`");
  assert.deepEqual(names(["author:", "  - One", '  - "Two, Jr."']), ["One", "Two, Jr."]);
  assert.deepEqual(names(['author: [A B, "C, D"]']), ["A B", "C, D"]);
  assert.deepEqual(names(["author:", "- One", "- Two"]), ["One", "Two"], "the list at the column of its key");
  // Maps, the name written every way Quarto reads one.
  assert.deepEqual(
    names(["author:", "  - name: Norah Jones", "    affiliation: Carnegie Mellon University", "    email: n@example.org", "  - name: Josiah Carberry"]),
    ["Norah Jones", "Josiah Carberry"]
  );
  assert.deepEqual(names(["author:", "  - affiliation: First", "    name: Named second"]), ["Named second"]);
  assert.deepEqual(names(["author:", "  name: Solo", "  affiliation: X"]), ["Solo"]);
  assert.deepEqual(names(["author: {name: Flow, email: f@example.org}"]), ["Flow"]);
  assert.deepEqual(names(["author:", "  - name:", "      given: Norah", "      family: Jones"]), ["Norah Jones"]);
  assert.deepEqual(names(["author:", "  - name: {given: Norah, family: Jones}"]), ["Norah Jones"]);
  assert.deepEqual(names(["author:", "  - name: {literal: The Trio}"]), ["The Trio"]);
  assert.deepEqual(names(["author:", "  - given: Ada", "    family: Lovelace"]), ["Ada Lovelace"], "the parts beside the other keys");
  // Both keys: `authors` is the one the page prints (measured).
  assert.deepEqual(names(["title: Both", "author: Singular", "authors: [Plural One, Plural Two]"]), ["Plural One", "Plural Two"]);
  // A map with no name: under `author` it takes every author off the page,
  // the named ones with it, and under `authors` it is a row with no name
  // (both measured; parseAuthor in Quarto's own code is why).
  assert.deepEqual(names(["title: T", "author:", "  - affiliation: Nowhere", "  - Somebody"]), []);
  assert.deepEqual(names(["title: T", "author:", "  - given: Only", "  - Somebody"]), []);
  assert.deepEqual(names(["title: T", "authors:", "  - email: x@example.org", "  - Somebody"]), ["", "Somebody"]);
});

test("an author carries what the page prints beside the name", () => {
  const who = titled([
    "title: T", "author:",
    "  - name: Ada Lovelace", "    degrees: [PhD, MD]", "    email: ada@example.org", "    orcid: 0000-0002-1825-0097",
    "    url: https://example.org/ada", "    affiliation-url: https://aei.example", "    affiliation: Analytical Engine Institute",
    '  - name: "Clara *Schumann*"', "    degrees: Dr", "    affiliation:", "      department: Piano",
    "  - name: Third",
  ]);
  assert.deepEqual(who.authors, [
    somebody("Ada Lovelace", {
      degrees: ["PhD", "MD"], url: "https://example.org/ada", email: "ada@example.org", orcid: "0000-0002-1825-0097",
      // `affiliation-url` is the address of the first affiliation.
      affiliations: [{ name: "Analytical Engine Institute", url: "https://aei.example" }],
    }),
    // An affiliation with no name is still a row of the column, an empty one.
    somebody("Clara *Schumann*", { degrees: ["Dr"], affiliations: [{ name: "", url: "" }] }),
    somebody("Third"),
  ]);
  assert.equal(who.affiliated, true);
  // The forms an affiliation is written in: a name, a list of names, a map,
  // a list of maps, and a `ref` to one of the document's own.
  const places = (lines) => titled(["title: T"].concat(lines)).authors.map((a) => a.affiliations);
  assert.deepEqual(places(["author:", "  - name: A", "    affiliation: [X, Y]"]), [[{ name: "X", url: "" }, { name: "Y", url: "" }]]);
  assert.deepEqual(
    places([
      "author:", "  - name: {literal: The Trio}", "    affiliations:", "      - ref: x", "      - Inline Place", "      - ref: nowhere",
      "affiliations:", "  - id: x", "    name: Referenced Place", "    url: https://x.example",
    ]),
    [[{ name: "Referenced Place", url: "https://x.example" }, { name: "Inline Place", url: "" }]]
  );
  // An `institute` is an affiliation of the author level with it, and the
  // last author takes those left over.
  assert.deepEqual(places(["author: [One, Two]", "institute: [Inst A, Inst B, Inst C]"]), [
    [{ name: "Inst A", url: "" }],
    [{ name: "Inst B", url: "" }, { name: "Inst C", url: "" }],
  ]);
  // The page sets the authors beside their affiliations as soon as the
  // document has one, even one nobody is named for; with none, the names
  // are a column of the row the date is in.
  assert.equal(titled(["author: [A, B]", "date: 2026-10-04"]).affiliated, false);
  assert.equal(titled(["author:", "  - name: A", "    email: a@example.org"]).affiliated, false);
  assert.equal(titled(["author: A", "affiliations:", "  - name: Unreferenced Place"]).affiliated, true);
  assert.equal(titled(["author: A", "institute: I"]).affiliated, true);
});

test("an abstract, a description and the keywords are read as the page sets them", () => {
  // Written as a block it is paragraphs; on a line, quoted or bare or
  // stripped of its last line break, it is a run of text, which the page
  // sets at another size (measured: 14.4px against 16).
  assert.deepEqual(titled(["abstract: |", "  First paragraph,", "  on two lines.", "", "  Second."]).abstract, {
    blocks: true, paragraphs: ["First paragraph, on two lines.", "Second."],
  });
  assert.deepEqual(titled(["abstract: >", "  Folded abstract, first line", "  second line of the same paragraph."]).abstract, {
    blocks: true, paragraphs: ["Folded abstract, first line second line of the same paragraph."],
  });
  assert.deepEqual(titled(["abstract: >+", "  Folded and kept,", "  one paragraph.", "", "keywords: [k]"]).abstract, {
    blocks: true, paragraphs: ["Folded and kept, one paragraph."],
  });
  assert.deepEqual(titled(['abstract: "A one line abstract written in quotes."']).abstract, {
    blocks: false, paragraphs: ["A one line abstract written in quotes."],
  });
  assert.deepEqual(titled(["abstract: First line of a plain abstract", "  that runs on a second line."]).abstract, {
    blocks: false, paragraphs: ["First line of a plain abstract that runs on a second line."],
  });
  // Stripped, its paragraphs are parted by a line break and no more.
  assert.deepEqual(titled(["abstract: |-", "  Stripped literal abstract.", "", "  Second paragraph of it."]).abstract, {
    blocks: false, paragraphs: ["Stripped literal abstract.", "Second paragraph of it."],
  });
  assert.equal(titled(["title: T", 'abstract: ""']).abstract, null);
  // A description the same, under a title: alone it prints nothing.
  assert.deepEqual(titled(["title: T", "description: |", "  A description in a block.", "", "  Its second paragraph."]).description, {
    blocks: true, paragraphs: ["A description in a block.", "Its second paragraph."],
  });
  assert.deepEqual(titled(["title: T", 'description: "Inline description."']).description, {
    blocks: false, paragraphs: ["Inline description."],
  });
  // The keywords are a list, or one text printed as it is.
  assert.deepEqual(titled(["keywords: [harmony, circle of fifths, tuning]"]).keywords, ["harmony", "circle of fifths", "tuning"]);
  assert.deepEqual(titled(["keywords:", "  - harmony", '  - "*emphasis*"']).keywords, ["harmony", "*emphasis*"]);
  assert.deepEqual(titled(["keywords: harmony, tuning"]).keywords, ["harmony, tuning"]);
});

test("the words over the abstract and the keywords are the language's, or the header's own", () => {
  const words = (lines) => {
    const look = titled(["abstract: A.", "keywords: [k]"].concat(lines));
    return [look.abstractTitle, look.keywordsTitle];
  };
  // Each measured on the page.
  assert.deepEqual(words([]), ["Abstract", "Keywords"]);
  assert.deepEqual(words(["lang: es"]), ["Resumen", "Palabras clave"]);
  assert.deepEqual(words(["lang: fr-CA"]), ["Résumé", "Mots clés"], "a region with no file of its own");
  assert.deepEqual(words(["lang: xx"]), ["Abstract", "Keywords"]);
  assert.deepEqual(words(["abstract-title: Summary", "language:", "  title-block-keywords: Tags"]), ["Summary", "Tags"]);
  assert.deepEqual(words(["lang: fr-CA", "language:", "  section-title-abstract: Sommaire"]), ["Sommaire", "Mots clés"]);
});

test("every language words the abstract and the keywords as Quarto's own language file does", (t) => {
  const dir = quartoLanguages();
  if (!dir) {
    t.skip("no Quarto on the PATH");
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => /^_language(?:-.+)?\.yml$/.test(f));
  assert.ok(files.length > 30, "Quarto's language files were not found in " + dir);
  for (const [key, table] of [["section-title-abstract", X.ABSTRACT_TITLES], ["title-block-keywords", X.KEYWORD_TITLES]]) {
    const seen = new Set();
    for (const file of files) {
      const tag = file.replace(/^_language-?/, "").replace(/\.yml$/, "");
      seen.add(tag);
      const line = fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/).find((l) => l.indexOf(key + ":") === 0);
      if (!line) {
        // A file with no word of its own falls to its base language.
        assert.ok(!Object.prototype.hasOwnProperty.call(table, tag), tag + " has no " + key + " in Quarto");
        continue;
      }
      const value = new RegExp("^" + key + ':\\s*"([^"]*)"').exec(line) || new RegExp("^" + key + ":\\s*(.+?)\\s*$").exec(line);
      assert.equal(table[tag], value[1], key + " of " + (tag || "English"));
    }
    for (const tag of Object.keys(table)) assert.ok(seen.has(tag), tag + " is not one of Quarto's languages");
  }
});

// ---- The dates ----

// Every row is a header and what the page printed for its date, measured:
// the language, the date as written, the `date-format`, and the page.
const PAGE_DATES = [
  ["", "2026-10-03", null, "October 3, 2026"],
  ["en", "2026-10-03", null, "October 3, 2026"],
  ["es", "2026-10-03", null, "3 de octubre de 2026"],
  ["de", "2026-10-03", null, "3. Oktober 2026"],
  ["fr", "2026-10-03", null, "3 octobre 2026"],
  ["it", "2026-10-03", null, "3 ottobre 2026"],
  ["nl", "2026-10-03", null, "3 oktober 2026"],
  ["pl", "2026-10-03", null, "3 października 2026"],
  ["pt", "2026-10-03", null, "3 de outubro de 2026"],
  ["ru", "2026-10-03", null, "3 октября 2026 г."],
  ["uk", "2026-10-03", null, "3 жовтня 2026 р."],
  // A region Quarto has dates for, one it has none for (its base language),
  // and a language it has none for at all (English).
  ["en-GB", "2026-10-03", null, "3 October 2026"],
  ["es-CU", "2026-10-03", null, "3 de octubre de 2026"],
  ["ja", "2026-10-03", null, "2026年10月3日"],
  ["xx", "2026-10-03", null, "October 3, 2026"],
  // The styles, and a format of figures.
  ["en", "2026-10-03", "full", "Saturday, October 3, 2026"],
  ["en", "2026-10-03", "long", "October 3, 2026"],
  ["en", "2026-10-03", "medium", "Oct 3, 2026"],
  ["en", "2026-10-03", "short", "10/3/26"],
  ["en", "2026-10-03", "iso", "2026-10-03"],
  ["en", "2026-10-03", "DD/MM/YYYY", "03/10/2026"],
  ["es", "2026-10-03", "full", "sábado, 3 de octubre de 2026"],
  ["es", "2026-10-03", "short", "3/10/26"],
  // A pattern in words: English written out, short forms and the ordinal
  // with it, and the long month and weekday of another language.
  ["en", "2026-10-04", "MMMM YYYY", "October 2026"],
  ["en", "2026-10-04", "MMM D, YYYY", "Oct 4, 2026"],
  ["en", "2026-10-04", "dddd, MMMM Do, YYYY", "Sunday, October 4th, 2026"],
  ["fr", "2026-10-04", "dddd D MMMM YYYY", "dimanche 4 octobre 2026"],
  ["fr", "2026-11-05", "dddd D MMMM YYYY", "jeudi 5 novembre 2026"],
  ["es", "2026-10-04", "dddd D [de] MMMM [de] YYYY", "domingo 4 de octubre de 2026"],
  // Words written into a pattern with no brackets around them are read as
  // the pattern: the `d` of "de" is the day of the week as a figure.
  ["es", "2026-10-04", "D de MMMM", "4 0e octubre"],
  // The day of the export.
  ["", "today", null, "October 3, 2026"],
  // The shapes a date is read in, month first where it is all figures.
  ["", "10/03/2026", null, "October 3, 2026"],
  ["", "03-10-2026", null, "March 10, 2026"],
  ["", "1/2/26", null, "January 2, 2026"],
  ["", "03 10 2026", null, "October 3, 2026"],
  ["", "2026-10-3", null, "October 3, 2026"],
  ["", "3 October 2026", null, "October 3, 2026"],
  ["", "October 3, 2026", null, "October 3, 2026"],
  // And what the engine makes of a date that is not one.
  ["", "Autumn 2026", null, "January 1, 2026"],
];

test("the date is printed as the page prints it, by language and by format", () => {
  for (const [lang, date, format, page] of PAGE_DATES) {
    assert.equal(X.dateText(date, format, lang, TITLE_NOW), page, JSON.stringify([lang, date, format]));
  }
  // Through the header, where `date-format` is the document's or the page's,
  // or the date's own, and the day a document was modified takes the same.
  assert.equal(titled(["date: 2026-10-03", "lang: es"]).date, "3 de octubre de 2026");
  assert.equal(titled(["date: 2026-10-03", "date-format: iso"]).date, "2026-10-03");
  assert.equal(titled(["date: 2026-10-03", "date-format: iso", "format:", "  html:", "    date-format: medium"]).date, "Oct 3, 2026");
  assert.equal(titled(["date: now"]).date, "October 3, 2026");
  assert.equal(titled(["date: last-modified"]).date, "October 3, 2026");
  assert.equal(titled(["date:", "  value: 2026-10-04", '  format: "MMMM YYYY"']).date, "October 2026");
  assert.equal(titled(["date: 2026-10-04", "date-modified: 2026-11-05", 'date-format: "dddd D MMMM YYYY"', "lang: fr"]).modified, "jeudi 5 novembre 2026");
  // A year alone is read by the engine as midnight in Greenwich, so the day
  // it lands on depends on where the computer is: the page printed
  // "December 31, 2025" at UTC-5. Whatever the zone, it is the engine's day.
  assert.equal(X.dateText("2026", null, "en", TITLE_NOW), new Date("2026").toLocaleString("en", { dateStyle: "long" }));
});

test("a pattern is read in dayjs's two passes, the clock and the zone with it", () => {
  // The zone is the computer's, so it is read here as dayjs reads it: the
  // page printed "-04:00" and "-0400" for these at UTC-4.
  const day = new Date(2026, 9, 4);
  const minutes = 15 * -Math.round(day.getTimezoneOffset() / 15);
  const two = (n) => (n < 10 ? "0" : "") + n;
  const zone = (minutes < 0 ? "-" : "+") + two(Math.floor(Math.abs(minutes) / 60)) + ":" + two(Math.abs(minutes) % 60);
  const compact = zone.replace(":", "");
  const at = (pattern, lang) => X.dateText("2026-10-04", pattern, lang || "en", TITLE_NOW);
  // Measured: "October 4, 2026 12:00 AM -04:00 -0400".
  assert.equal(at("MMMM D, YYYY h:mm A Z ZZ"), "October 4, 2026 12:00 AM " + zone + " " + compact);
  // Measured: "-0400 Q4 Sun Su 0". A run of letters dayjs has no value for
  // is the zone without its colon, what stands in brackets is kept, and the
  // short forms of English are cut from the long ones.
  assert.equal(at("YYY [Q]Q ddd dd d"), compact + " Q4 Sun Su 0");
  assert.equal(at("YY-M-D HH:mm:ss.SSS a k kk"), "26-10-4 00:00:00.000 am 24 24");
  assert.equal(at("X") , String(Math.floor(day.getTime() / 1000)));
  // The ordinal: English's rule, a sign after the figure, or the figure.
  assert.equal(at("Do"), "4th");
  assert.equal(X.dateText("2026-10-01", "Do", "en", TITLE_NOW), "1st");
  assert.equal(X.dateText("2026-10-22", "Do", "en-GB", TITLE_NOW), "22nd");
  assert.equal(X.dateText("2026-10-13", "Do", "en", TITLE_NOW), "13th");
  assert.equal(at("Do [de] MMMM", "es"), "4º de octubre");
  assert.equal(at("Do MMMM", "de"), "4. Oktober");
  assert.equal(at("Do", "en-AU"), "4");
});

test("a pattern that asks for a word this side does not have leaves the date as written", () => {
  const at = (pattern, lang) => X.dateText("2026-10-04", pattern, lang, TITLE_NOW);
  // The page printed "4 октября 2026" for the first: Russian declines the
  // month by the pattern, and that rule is dayjs's own.
  assert.equal(at("D MMMM YYYY", "ru"), "2026-10-04");
  assert.equal(at("D MMMM YYYY", "pl"), "2026-10-04");
  // A short month or weekday outside English: dayjs writes "oct" and "dom."
  // where the browser has other words for some of them.
  assert.equal(at("D MMM YYYY", "es"), "2026-10-04");
  assert.equal(at("ddd D", "es"), "2026-10-04");
  assert.equal(at("dd D", "fr"), "2026-10-04");
  // An ordinal with several endings, a word for the half of the day, a week
  // of the year, the name of a zone.
  assert.equal(at("Do MMMM", "fr"), "2026-10-04");
  assert.equal(at("h A", "ja"), "2026-10-04");
  assert.equal(at("[week] w", "en"), "2026-10-04");
  assert.equal(at("YYYY z", "en"), "2026-10-04");
  // A language with no long weekday of the browser's.
  assert.equal(at("dddd", "ca"), "2026-10-04");
});

test("the locales a date is printed in are the ones Quarto has dates for", (t) => {
  const languages = quartoLanguages();
  const dir = languages && path.join(languages, "..", "library", "dayjs", "locale");
  if (!dir || !fs.existsSync(dir)) {
    t.skip("no Quarto on the PATH");
    return;
  }
  const have = fs.readdirSync(dir).filter((f) => /\.js$/.test(f)).map((f) => f.replace(/\.js$/, "")).sort();
  assert.ok(have.length > 100, "Quarto's date locales were not found in " + dir);
  assert.deepEqual([...X.DATE_LOCALES].sort(), have);
});

// The words of a pattern are the runtime's only where they are dayjs's,
// letter for letter, and what says where is held here against the locale
// files of the Quarto on this computer: every locale the two lists name
// words its long months, or its long weekdays, as dayjs does under Node
// (the lists are shorter than what agrees here, since the editor runs in a
// browser that carries fewer locales: webview-title.test.js holds them to
// the letter there), and how each locale writes an ordinal and which have a
// word of their own for the half of the day are built again whole. Measured
// on Node 24.15 (ICU 78.2, CLDR 48) against Quarto 1.9.37; another Quarto or
// another runtime that words a month otherwise fails here, which is the
// point.
test("the words a pattern takes from the browser are dayjs's, locale by locale", async (t) => {
  const languages = quartoLanguages();
  const dir = languages && path.join(languages, "..", "library", "dayjs", "locale");
  if (!dir || !fs.existsSync(dir)) {
    t.skip("no Quarto on the PATH");
    return;
  }
  const { pathToFileURL } = require("node:url");
  const part = (locale, option, type, date) => {
    try {
      const found = new Intl.DateTimeFormat(locale, option).formatToParts(date).find((p) => p.type === type);
      return found ? found.value : null;
    } catch (e) {
      return null;
    }
  };
  const english = (n) => {
    const ends = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return "[" + n + (ends[(v - 20) % 10] || ends[v] || ends[0]) + "]";
  };
  const months = [];
  const days = [];
  const meridiem = [];
  const ordinalEnglish = [];
  const ordinalOwn = [];
  const signs = {};
  const files = fs.readdirSync(dir).filter((f) => /\.js$/.test(f)).sort();
  for (const file of files) {
    const name = file.replace(/\.js$/, "");
    const locale = (await import(pathToFileURL(path.join(dir, file)).href)).default;
    if (Array.isArray(locale.months) && locale.months.every((w, m) => w === part(name, { month: "long" }, "month", new Date(2023, m, 15)))) months.push(name);
    if (Array.isArray(locale.weekdays) && locale.weekdays.every((w, d) => w === part(name, { weekday: "long" }, "weekday", new Date(2023, 0, 1 + d)))) days.push(name);
    if (locale.meridiem) meridiem.push(name);
    const written = [];
    for (let n = 1; n <= 31; n++) written.push(String(locale.ordinal(n)));
    if (written.every((w, k) => w === english(k + 1))) ordinalEnglish.push(name);
    else {
      const m = /^1(.*)$/.exec(written[0]);
      if (m && written.every((w, k) => w === k + 1 + m[1])) {
        if (m[1]) (signs[m[1]] = signs[m[1]] || []).push(name);
      } else ordinalOwn.push(name);
    }
  }
  const sorted = (list) => [...list].sort();
  assert.ok(X.INTL_MONTHS.length > 50 && X.INTL_DAYS.length > 50, "the lists are all but empty");
  assert.deepEqual(X.INTL_MONTHS.filter((name) => months.indexOf(name) === -1), [], "a long month that is not dayjs's");
  assert.deepEqual(X.INTL_DAYS.filter((name) => days.indexOf(name) === -1), [], "a long weekday that is not dayjs's");
  assert.deepEqual(sorted(X.MERIDIEM_OWN), sorted(meridiem), "a word for the half of the day");
  assert.deepEqual(sorted(X.ORDINAL_ENGLISH), sorted(ordinalEnglish), "English's ordinals");
  assert.deepEqual(sorted(X.ORDINAL_OWN), sorted(ordinalOwn), "ordinals with several endings");
  assert.deepEqual(Object.keys(X.ORDINAL_SIGNS).sort(), Object.keys(signs).sort(), "the signs after an ordinal");
  for (const sign of Object.keys(signs)) assert.deepEqual(sorted(X.ORDINAL_SIGNS[sign]), sorted(signs[sign]), "ordinals in " + sign);
  // English itself is written out in the module, as dayjs has it.
  const en = (await import(pathToFileURL(path.join(dir, "en.js")).href)).default;
  for (let m = 0; m < 12; m++) assert.equal(X.dateText("2026-" + (m + 1) + "-15", "MMMM", "en", TITLE_NOW), en.months[m]);
  for (let d = 0; d < 7; d++) assert.equal(X.dateText("2023-01-0" + (d + 1), "dddd", "en", TITLE_NOW), en.weekdays[d]);
});
