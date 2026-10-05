// Equations by number and the references to them (vscode-mdm/media/
// mdm-crossref.js): the rules the editor draws them by, which are Quarto's,
// held here against what `quarto render` printed for each form on
// 2026-09-30 (Quarto 1.9.37, with no filter of MDM's), and the prefixes
// against the language files of the Quarto on this computer. The export
// prints them by the same rules in mdm.lua (render.test.js, html.test.js),
// and the editor draws what this module says (webview-markdown.test.js).
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
