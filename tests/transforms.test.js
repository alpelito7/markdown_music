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
  toLf,
  toEol,
} = require("../vscode-mdm/transforms.js");

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
