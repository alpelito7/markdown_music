// Unit tests for vscode-mdm/transforms.js: the disk <-> editor text mapping.
// The editor text is the file text, so what is fixed here is the one thing
// the mapping does: the YAML header must survive being hidden, and a full
// round trip of example.mdm must be byte-identical in both modes.
// Run with: node --test tests/transforms.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  toEditor,
  fromEditor,
  frontMatter,
  hiddenLines,
  toLf,
  toEol,
  withLang,
  langOf,
} = require("../vscode-mdm/transforms.js");
const hyphen = require("../vscode-mdm/media/mdm-hyphenation.js");

const EXAMPLE = fs.readFileSync(
  path.join(__dirname, "..", "example.mdm"),
  "utf8"
);

// Round trip helper: what the file becomes after passing through the editor
// untouched (toEditor, then fromEditor with the same disk text). `eol` is what
// the host reads off document.eol; LF unless a test says otherwise.
function roundTrip(text, withFrontMatter, eol) {
  return fromEditor(
    toEditor(text, withFrontMatter),
    text,
    withFrontMatter,
    eol || "\n"
  );
}

// ---------- Golden round trip ----------

test("example.mdm round-trips byte-identical with the header hidden", () => {
  assert.equal(roundTrip(EXAMPLE, false), EXAMPLE);
});

test("example.mdm round-trips byte-identical with the header shown", () => {
  assert.equal(roundTrip(EXAMPLE, true), EXAMPLE);
});

test("example.mdm editor text carries no YAML header when hidden", () => {
  const editor = toEditor(EXAMPLE, false);
  assert.ok(!editor.startsWith("---"));
  assert.ok(!editor.includes("filters:"));
});

test("example.mdm editor text is the file itself when shown", () => {
  assert.equal(toEditor(EXAMPLE, true), EXAMPLE);
});

// ---------- Literal text ----------

test("fence info strings reach the editor as written, and come back as written", () => {
  const disk = "```{.abc .play}\nX:1\n```\n\n```abc\nX:2\n```\n\n```{.python #id}\nx = 1\n```\n";
  assert.equal(toEditor(disk, true), disk);
  assert.equal(toEditor(disk, false), disk);
  assert.equal(fromEditor(disk, disk, true), disk);
  assert.equal(fromEditor(disk, disk, false), disk);
});

// ---------- Line endings ----------

// The editor is CodeMirror, which holds no CR: a CRLF file that reached it as
// it is came back LF, the host read every edit as a change and echoed the
// document back, and the editor rewrote it from the first CR on (the caret to
// line 1, and a blank line more at the end per echo). So the editor text is
// LF and the file keeps its own endings, which only the host knows.
test("CRLF files keep their line endings through both modes", () => {
  const disk = "---\r\ntitle: t\r\n---\r\n\r\nBody\r\n```abc\r\nX:1\r\n```\r\n";
  assert.equal(roundTrip(disk, true, "\r\n"), disk);
  assert.equal(roundTrip(disk, false, "\r\n"), disk);
});

test("the editor text of a CRLF file is LF, header shown or hidden", () => {
  const disk = "---\r\ntitle: t\r\n---\r\n\r\nBody\r\n```abc\r\nX:1\r\n```\r\n";
  assert.equal(toEditor(disk, false), "Body\n```abc\nX:1\n```\n");
  assert.equal(toEditor(disk, true), "---\ntitle: t\n---\n\nBody\n```abc\nX:1\n```\n");
  assert.ok(!toEditor(disk, false).includes("\r"));
  assert.ok(!toEditor(disk, true).includes("\r"));
});

test("an edit typed in the editor is written back with the file's endings", () => {
  const disk = "---\r\ntitle: t\r\n---\r\n\r\nBody\r\n";
  const edited = toEditor(disk, false) + "More\n";
  assert.equal(
    fromEditor(edited, disk, false, "\r\n"),
    "---\r\ntitle: t\r\n---\r\n\r\nBody\r\nMore\r\n"
  );
  assert.equal(
    fromEditor(edited, disk, true, "\r\n"),
    "Body\r\nMore\r\n"
  );
});

test("a lone CR is a line ending too, in both directions", () => {
  assert.equal(toEditor("a\rb\r", true), "a\nb\n");
  assert.equal(toEol("a\rb\r", "\r\n"), "a\r\nb\r\n");
  assert.equal(toLf("a\r\nb\rc\n"), "a\nb\nc\n");
});

test("an LF file is left alone, and an absent eol means LF", () => {
  const disk = "---\ntitle: t\n---\n\nBody\n";
  assert.equal(roundTrip(disk, false), disk);
  assert.equal(fromEditor("Body\n", disk, false, undefined), disk);
  assert.equal(toEol("Body\n", undefined), "Body\n");
});

// ---------- Front matter handling ----------

test("frontMatter() returns the header, or empty when there is none", () => {
  assert.equal(
    frontMatter("---\ntitle: t\n---\n\nBody\n"),
    "---\ntitle: t\n---\n"
  );
  assert.equal(frontMatter("Body only\n"), "");
  // A --- block later in the file is not a header.
  assert.equal(frontMatter("Body\n\n---\ntitle: t\n---\n"), "");
  assert.equal(frontMatter("---\r\ntitle: t\r\n---\r\n\r\nBody\r\n"), "---\r\ntitle: t\r\n---\r\n");
});

test("hidden header is spliced back from disk on save", () => {
  const disk = "---\ntitle: t\n---\n\nBody\n";
  const editor = toEditor(disk, false);
  assert.equal(editor, "Body\n");
  assert.equal(fromEditor("Body\n", disk, false), disk);
});

test("the blank lines the file keeps under the header are the ones put back", () => {
  const two = "---\ntitle: t\n---\n\n\nBody\n";
  assert.equal(toEditor(two, false), "Body\n");
  assert.equal(fromEditor("Body\n", two, false), two);
  const none = "---\ntitle: t\n---\nBody\n";
  assert.equal(toEditor(none, false), "Body\n");
  // A file with no blank line under its header gets the one Pandoc wants.
  assert.equal(fromEditor("Body\n", none, false), "---\ntitle: t\n---\n\nBody\n");
});

test("shown mode writes the editor text as it is, blank line or none", () => {
  const editorText = "---\ntitle: t\n---\n\nBody\n";
  assert.equal(fromEditor(editorText, "", true), editorText);
  const tight = "---\ntitle: t\n---\nBody\n";
  assert.equal(fromEditor(tight, "", true), tight);
});

test("a header-only file survives both modes", () => {
  const disk = "---\ntitle: t\n---\n";
  assert.equal(roundTrip(disk, false), disk);
  assert.equal(roundTrip(disk, true), disk);
});

test("editing the body never drags the header along (hidden mode)", () => {
  const disk = "---\ntitle: t\n---\n\nOld body\n";
  assert.equal(
    fromEditor("New body\n", disk, false),
    "---\ntitle: t\n---\n\nNew body\n"
  );
});

test("emptying the body keeps the header alone, no trailing blank", () => {
  const disk = "---\ntitle: t\n---\n\nBody\n";
  assert.equal(fromEditor("", disk, false), "---\ntitle: t\n---\n");
});

test("deleting the header in shown mode deletes it from the file", () => {
  const disk = "---\ntitle: t\n---\n\nBody\n";
  assert.equal(fromEditor("Body\n", disk, true), "Body\n");
});

test("a file without a header is unaffected by either mode", () => {
  const disk = "Just a paragraph\n\n```abc\nX:1\n```\n";
  assert.equal(roundTrip(disk, false), disk);
  assert.equal(roundTrip(disk, true), disk);
  // Blank lines at the top are the file's own and stay.
  assert.equal(toEditor("\n\nBody\n", false), "\n\nBody\n");
});

test("a header missing its trailing newline gains one before the body", () => {
  // splitFrontMatter can end the header at EOF without a newline; splicing a
  // body under it must not glue "---" to the body text.
  const disk = "---\ntitle: t\n---";
  const out = fromEditor("Body\n", disk, false);
  assert.equal(out, "---\ntitle: t\n---\n\nBody\n");
});

test("toEditor is stable (mapping twice changes nothing)", () => {
  const once = toEditor(EXAMPLE, false);
  assert.equal(toEditor(once, false), once);
  assert.equal(toEditor(EXAMPLE, true), toEditor(toEditor(EXAMPLE, true), true));
});

// ---- The lines the editor never sees ----

// The editor draws the file's line numbers in its margin, so it has to be told
// how many lines the mapping kept back. Everything here counts the newlines of
// the prefix toEditor takes off, which is the header plus the blank lines the
// file has under it.

test("hiddenLines counts the header and the gap the editor never receives", () => {
  const disk = "---\ntitle: t\n---\n\nBody\n";
  assert.equal(hiddenLines(disk, false), 4);
  // Which is to say: the editor's first line is the file's fifth.
  assert.equal(toEditor(disk, false), "Body\n");
  assert.equal(disk.split("\n")[4], "Body");
  // Two blank lines under the header are two lines of the file.
  assert.equal(hiddenLines("---\na\n---\n\n\nBody\n", false), 5);
  // A CRLF file counts its lines, not its characters.
  assert.equal(hiddenLines("---\r\na\r\n---\r\n\r\nBody\r\n", false), 4);
});

test("hiddenLines is zero whenever the two texts already agree", () => {
  const disk = "---\ntitle: t\n---\n\nBody\n";
  // The header shown: the editor holds the file.
  assert.equal(hiddenLines(disk, true), 0);
  // No header to hide: both modes give the same text.
  assert.equal(hiddenLines("Body\n", false), 0);
  assert.equal(hiddenLines("", false), 0);
  // A `---` that is not at the very start is not a header (splitFrontMatter).
  assert.equal(hiddenLines("Body\n\n---\ntitle: t\n---\n", false), 0);
});

test("hiddenLines agrees with example.mdm line for line", () => {
  const first = toEditor(EXAMPLE, false).split("\n")[0];
  const lines = EXAMPLE.split("\n");
  // The number the editor draws beside its first line is the number the text
  // editor draws beside the same line of the file.
  assert.equal(hiddenLines(EXAMPLE, false) + 1, lines.indexOf(first) + 1);
});

// ---------- The language the hyphenation menu writes ----------

// The menu's languages go into the header as `lang:`, and the editor divides
// words by reading that line back (language() in mdm-hyphenation.js). The two
// are held to one answer here: whatever the header was, after the write the
// editor reads the language that was chosen.

const LANGUAGES = Object.keys(require("../vscode-mdm/media/hyphenation-patterns.js"));

const HEADERS = [
  "", // no header at all
  "---\ntitle: t\n---\n\n",
  "---\ntitle: t\nlang: fr\n---\n\n",
  "---\nlang: 'es-CU' # a comment\ntitle: t\n---\n\n",
  "---\nlang:\n  pt\ntitle: t\n---\n\n", // the value on a line of its own
  "---\nlang: ja_JP\n---\n\n", // a tag the editor cannot read
  "---\nLANG: fr\n---\n\n", // which the editor reads all the same
  "---\ntitle: |\n  lang: es\nabstract: >\n  last\n---\n\n", // a block closes the header
  "---\nformat:\n  html:\n    lang: es\n---\n", // nested, and no blank line under it
];

test("after the menu writes a language, the editor reads that language", () => {
  for (const head of HEADERS) {
    for (const lang of LANGUAGES) {
      const out = withLang(head + "Body\n", lang);
      const where = JSON.stringify(head) + " with " + lang;
      assert.equal(hyphen.language(frontMatter(out)).split("-")[0], lang, where);
      assert.ok(out.endsWith("\nBody\n"), where + ": the body moved");
      assert.equal(withLang(out, lang), out, where + ": a second write changed it again");
    }
  }
});

// The host reads the same line to decide whether an export divides words
// (exportHyphenation in extension.js), and has to find there what the editor
// finds, a header naming no language included, in any line endings.
test("the host reads the header's language as the editor does", () => {
  for (const head of HEADERS) {
    const text = head + "Body\n";
    const editor = hyphen.language(frontMatter(text));
    assert.equal(langOf(text), editor, JSON.stringify(head));
    assert.equal(langOf(text.replace(/\n/g, "\r\n")), editor, JSON.stringify(head) + " in CRLF");
  }
  assert.equal(langOf("---\ntitle: t\n---\n\nlang: es\n"), "", "the body named the language");
});

test("the line goes last in a header without one, and replaces the one there is", () => {
  assert.equal(withLang("---\ntitle: t\n---\n\nBody\n", "es"), "---\ntitle: t\nlang: es\n---\n\nBody\n");
  assert.equal(withLang("---\nlang: fr\ntitle: t\n---\n\nBody\n", "es"), "---\nlang: es\ntitle: t\n---\n\nBody\n");
  // A value continued on the next lines goes with the key it belonged to.
  assert.equal(withLang("---\nlang:\n  fr\ntitle: t\n---\nBody\n", "es"), "---\nlang: es\ntitle: t\n---\nBody\n");
  // A file with no header gets one, with the blank line Pandoc wants.
  assert.equal(withLang("Body\n", "de"), "---\nlang: de\n---\n\nBody\n");
  assert.equal(withLang("", "de"), "---\nlang: de\n---\n\n");
  // A `---` further down is not a header to write into (splitFrontMatter).
  assert.equal(withLang("Body\n\n---\ntitle: t\n---\n", "es"), "---\nlang: es\n---\n\nBody\n\n---\ntitle: t\n---\n");
});

test("a header already in the language, regional tag included, is left alone", () => {
  for (const text of [
    "---\nlang: es\n---\n\nBody\n",
    "---\nlang: es-CU\n---\n\nBody\n",
    '---\nlang: "es" # Spanish\n---\n\nBody\n',
  ]) {
    assert.equal(withLang(text, "es"), text);
  }
  // A header that names no language is written to even for English, which is
  // what the editor assumes there: from then on the file says so itself.
  assert.equal(withLang("---\ntitle: t\n---\n\nBody\n", "en"), "---\ntitle: t\nlang: en\n---\n\nBody\n");
});

test("the language is written with the file's line endings", () => {
  const crlf = "---\r\ntitle: t\r\n---\r\n\r\nBody\r\n";
  assert.equal(withLang(crlf, "es", "\r\n"), "---\r\ntitle: t\r\nlang: es\r\n---\r\n\r\nBody\r\n");
  assert.equal(withLang("Body\r\n", "es", "\r\n"), "---\r\nlang: es\r\n---\r\n\r\nBody\r\n");
  // Untouched means untouched, the endings included.
  const same = "---\r\nlang: es\r\n---\r\n\r\nBody\r\n";
  assert.equal(withLang(same, "es", "\r\n"), same);
});
