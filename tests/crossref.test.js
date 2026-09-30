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
