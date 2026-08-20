// Unit tests for vscode-mdm/transforms.js: the disk <-> editor text mapping.
// The invariants here are the ones the editor's data safety rests on:
// tokenized fences must be restored exactly, the YAML header must survive
// being hidden, and a full round trip of example.mdm must be byte-identical.
// Run with: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { toEditor, fromEditor, frontMatter } = require("../vscode-mdm/transforms.js");

const EXAMPLE = fs.readFileSync(
  path.join(__dirname, "..", "example.mdm"),
  "utf8"
);

// Round trip helper: what the file becomes after passing through the editor
// untouched (toEditor, then fromEditor with the same disk text).
function roundTrip(text, withFrontMatter) {
  return fromEditor(toEditor(text, withFrontMatter), text, withFrontMatter);
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

test("example.mdm editor text starts with the header when shown", () => {
  const editor = toEditor(EXAMPLE, true);
  assert.ok(editor.startsWith("---\ntitle:"));
});

// ---------- Fence tokenization ----------

test("```abc becomes mdm-abc in the editor", () => {
  const disk = "Intro\n\n```abc\nX:1\nK:C\nC\n```\n";
  const editor = toEditor(disk, false);
  assert.ok(editor.includes("```mdm-abc\n"));
  assert.ok(!/```abc\n/.test(editor));
});

test("```{.abc .play} becomes mdm-abc-play in the editor", () => {
  const disk = "```{.abc .play}\nX:1\nK:C\nC\n```\n";
  const editor = toEditor(disk, false);
  assert.ok(editor.includes("```mdm-abc-play\n"));
});

test("mdm-abc and mdm-abc-play are restored on save", () => {
  const disk = "```abc\nX:1\n```\n\n```{.abc .play}\nX:2\n```\n";
  assert.equal(roundTrip(disk, false), disk);
});

test("```{.abc} is normalized to ```abc on save", () => {
  const disk = "```{.abc}\nX:1\n```\n";
  const editor = toEditor(disk, false);
  assert.ok(editor.includes("```mdm-abc\n"));
  assert.equal(fromEditor(editor, disk, false), "```abc\nX:1\n```\n");
});

test("a hand-typed ```mdm-abc is saved as ```abc (documented side effect)", () => {
  const editor = "```mdm-abc\nX:1\n```\n";
  assert.equal(fromEditor(editor, "", false), "```abc\nX:1\n```\n");
});

test("spacing variants of {.abc .play} are recognized", () => {
  for (const info of ["{.abc .play}", "{ .abc .play }", "{.abc  .play}"]) {
    const disk = "```" + info + "\nX:1\n```\n";
    const editor = toEditor(disk, false);
    assert.ok(
      editor.includes("```mdm-abc-play\n"),
      info + " should map to mdm-abc-play"
    );
  }
});

test("class order {.play .abc} is protected as a generic attribute token", () => {
  // Not the canonical order, so it gets the reversible mdm-attr token rather
  // than the score token; the exact info-string must come back on save.
  const disk = "```{.play .abc}\nX:1\n```\n";
  const editor = toEditor(disk, false);
  assert.ok(/```mdm-attr-[A-Za-z0-9_-]+\n/.test(editor));
  assert.equal(roundTrip(disk, false), disk);
});

test("generic Pandoc attributes survive through the mdm-attr token", () => {
  const infos = [
    "{.python .numberLines}",
    '{.callout-note title="A title with spaces"}',
    "{#id .class key=value}",
    "python numberLines", // spaces without braces: lute would truncate too
  ];
  for (const info of infos) {
    const disk = "```" + info + "\ncode\n```\n";
    const editor = toEditor(disk, false);
    assert.ok(
      /```mdm-attr-[A-Za-z0-9_-]+\n/.test(editor),
      info + " should be tokenized"
    );
    assert.equal(roundTrip(disk, false), disk, info + " should round-trip");
  }
});

test("single-word info-strings pass through untouched", () => {
  for (const info of ["python", "js", "{x}"]) {
    // {x} carries a brace, so it is tokenized; bare words are not.
    const disk = "```" + info + "\ncode\n```\n";
    const editor = toEditor(disk, false);
    if (/[{\s]/.test(info)) {
      assert.ok(editor.includes("mdm-attr-"), info);
    } else {
      assert.ok(editor.includes("```" + info + "\n"), info);
    }
    assert.equal(roundTrip(disk, false), disk, info);
  }
});

test("a literal ```mdm-attr-… typed by the user does not mutate", () => {
  // Invalid base64url payloads, or payloads that decode to something
  // infoToEditor would never have encoded, must be left exactly as typed.
  const cases = [
    "```mdm-attr-!!!\ncode\n```\n", // not base64url
    "```mdm-attr-cHl0aG9u\ncode\n```\n", // decodes to "python": no brace/space
  ];
  for (const disk of cases) {
    assert.equal(fromEditor(disk, "", false), disk);
  }
});

test("mdm-attr restore demands an exact re-encoding", () => {
  // "eyB4IH0" and "eyB4IH0="-style variants decode to the same string; only
  // the canonical encoding our own encoder produces is restored.
  const info = "{ x }";
  const canonical = Buffer.from(info, "utf8").toString("base64url");
  const disk = "```mdm-attr-" + canonical + "\ncode\n```\n";
  assert.equal(fromEditor(disk, "", false), "```" + info + "\ncode\n```\n");
});

// ---------- Scanner correctness ----------

test("fences inside an open fence are literal content and stay untouched", () => {
  const disk =
    "````markdown\n```abc\nX:1\n```\n````\n\n```abc\nX:2\n```\n";
  const editor = toEditor(disk, false);
  // The inner ```abc is content of the ````markdown block: not tokenized.
  assert.ok(editor.includes("```abc\nX:1\n```\n"));
  // The real score block after it is tokenized.
  assert.ok(editor.includes("```mdm-abc\nX:2\n"));
  assert.equal(roundTrip(disk, false), disk);
});

test("a closing fence must match the opening char and length", () => {
  // ``` cannot close a ````; ~~~ cannot close a ```.
  const disk = "````abc\n```\nstill inside\n````\n";
  const editor = toEditor(disk, false);
  assert.ok(editor.includes("````mdm-abc\n"));
  assert.ok(editor.includes("\n```\nstill inside\n"));
  assert.equal(roundTrip(disk, false), disk);
});

test("tilde fences are tokenized like backtick fences", () => {
  const disk = "~~~abc\nX:1\n~~~\n";
  const editor = toEditor(disk, false);
  assert.ok(editor.includes("~~~mdm-abc\n"));
  assert.equal(roundTrip(disk, false), disk);
});

test("fences indented up to three spaces keep their indent", () => {
  const disk = "  ```abc\n  X:1\n  ```\n";
  const editor = toEditor(disk, false);
  assert.ok(editor.includes("  ```mdm-abc\n"));
  assert.equal(roundTrip(disk, false), disk);
});

test("a tab-indented ``` is indented code, not a fence", () => {
  const disk = "\t```abc\n\tX:1\n\t```\n";
  assert.equal(toEditor(disk, false), disk);
});

test("spaces between the marker and the info-string are preserved", () => {
  const disk = "```  abc\nX:1\n```\n";
  const editor = toEditor(disk, false);
  assert.ok(editor.includes("```  mdm-abc\n"));
  assert.equal(roundTrip(disk, false), disk);
});

test("an unclosed fence at EOF still tokenizes its opening", () => {
  const disk = "```abc\nX:1\n";
  const editor = toEditor(disk, false);
  assert.ok(editor.includes("```mdm-abc\n"));
  assert.equal(roundTrip(disk, false), disk);
});

test("a ``` inside the YAML header does not poison the scanner", () => {
  const disk =
    '---\ntitle: t\nabstract: |\n  ```\n  not a fence\n---\n\n```abc\nX:1\n```\n';
  const editor = toEditor(disk, false);
  assert.ok(editor.includes("```mdm-abc\n"));
  assert.equal(roundTrip(disk, false), disk);
});

// ---------- CRLF ----------

test("CRLF fences are tokenized and restored with their \\r intact", () => {
  const disk = "Intro\r\n\r\n```abc\r\nX:1\r\n```\r\n";
  const editor = toEditor(disk, false);
  assert.ok(editor.includes("```mdm-abc\r\n"));
  const back = fromEditor(editor, disk, false);
  assert.equal(back, disk);
});

test("CRLF front matter is recognized and split off", () => {
  const disk = "---\r\ntitle: t\r\n---\r\n\r\nBody\r\n";
  assert.equal(frontMatter(disk), "---\r\ntitle: t\r\n---\r\n");
  const editor = toEditor(disk, false);
  assert.ok(!editor.includes("title:"));
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
});

test("hidden header is spliced back from disk on save", () => {
  const disk = "---\ntitle: t\n---\n\nBody\n";
  const editor = toEditor(disk, false);
  assert.equal(editor, "Body\n");
  assert.equal(fromEditor("Body\n", disk, false), disk);
});

test("the blank line lute strips after the header is restored", () => {
  const disk = "---\ntitle: t\n---\n\nBody\n";
  // lute serializes the header with a single newline after the closing ---.
  const luteText = "---\ntitle: t\n---\nBody\n";
  assert.equal(fromEditor(luteText, disk, true), disk);
});

test("an already-present blank line after the header is not doubled", () => {
  const editorText = "---\ntitle: t\n---\n\nBody\n";
  assert.equal(fromEditor(editorText, "", true), editorText);
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
});

test("a header missing its trailing newline gains one before the body", () => {
  // splitFrontMatter can end the header at EOF without a newline; splicing a
  // body under it must not glue "---" to the body text.
  const disk = "---\ntitle: t\n---";
  const out = fromEditor("Body\n", disk, false);
  assert.equal(out, "---\ntitle: t\n---\n\nBody\n");
});

// ---------- Normalizations the editor is allowed to make ----------

test("blank lines before the body are dropped (accepted normalization)", () => {
  const disk = "\n\nBody\n";
  assert.equal(toEditor(disk, false), "Body\n");
});

test("toEditor output is stable (tokenizing twice changes nothing)", () => {
  const disk = EXAMPLE;
  const once = toEditor(disk, false);
  const twice = toEditor(once, false);
  assert.equal(twice, once);
});
