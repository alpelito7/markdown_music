// transforms.js: the mapping between the .mdm file on disk and the text the
// editor holds. The editor text is the file text, save for two things. The
// YAML header, which the mdm.frontMatter setting can keep out of the editor:
// hidden, the host strips it (and the blank lines under it) on the way in and
// splices it back from the file on the way out; shown, nothing is touched.
// And the line endings, which are LF in the editor whatever the file uses.

"use strict";

// The editor is CodeMirror, which splits an incoming text on /\r\n?|\n/ and
// holds no CR at all. A CRLF file handed to it as it is therefore comes back
// LF, and the two texts never agree again: the host sees every edit as a
// change, echoes the document back, and the editor rewrites almost all of it
// (the caret lands wherever the first CR was, and the CR left dangling at the
// end of the replacement becomes one more line). So the editor text is LF,
// always, and the EOL of the file is put on again on the way out.
function toLf(text) {
  return text.replace(/\r\n?/g, "\n");
}

// Back to the line ending of the file, which is the document's own (VS Code
// hands an extension the text with that EOL on it: getText() is the lines of
// the document joined with it).
function toEol(text, eol) {
  return eol === "\r\n" ? toLf(text).replace(/\n/g, "\r\n") : toLf(text);
}

// The leading YAML header, if any: a `---` line at the very start, closed by
// the next `---` line. CRLF files are recognised.
function splitFrontMatter(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  return m ? [m[0], text.slice(m[0].length)] : ["", text];
}

// The blank lines between the header and the body, as the file has them.
function gapAfter(text, fm) {
  const m = /^(?:\r?\n)+/.exec(text.slice(fm.length));
  return m ? m[0] : "";
}

// File on disk -> text for the editor. withFrontMatter (the mdm.frontMatter
// setting) decides whether the YAML header is part of the editor text: shown,
// the editor gets the file as it is; hidden, the header and the blank lines
// under it stay with the host. Either way the text comes out in LF.
function toEditor(text, withFrontMatter) {
  if (withFrontMatter) return toLf(text);
  const fm = splitFrontMatter(text)[0];
  if (!fm) return toLf(text);
  return toLf(text.slice(fm.length + gapAfter(text, fm).length));
}

// Editor text -> file on disk. withFrontMatter says which of the two the
// editor text is, and it comes from the message that carried that text, not
// from the setting as it stands now: a toggle while an edit is in flight would
// otherwise read a header-less text as "the header was deleted" and drop it
// from the file. `eol` is the line ending of the document being written
// ("\r\n" for a CRLF file, LF for anything else, including a missing value):
// the editor text is LF and the file keeps the endings it had.
//
// With the header out of the editor, diskText supplies it, with the blank
// lines the file kept under it (one is put in when the file had none, which
// is what Pandoc wants). If the user types a new `---` header there while the
// file already has one, the typed block joins the body: accepted edge case.
function fromEditor(editorText, diskText, withFrontMatter, eol) {
  if (withFrontMatter) return toEol(editorText, eol);
  const disk = diskText || "";
  let fm = splitFrontMatter(disk)[0];
  if (!fm) return toEol(editorText, eol);
  if (!/\n$/.test(fm)) fm += "\n";
  if (editorText === "") return toEol(fm, eol);
  const gap = gapAfter(disk, splitFrontMatter(disk)[0]) || "\n";
  return toEol(fm + gap + editorText, eol);
}

// The YAML header of the file, whether or not the editor is showing it. The
// webview reads it to tell a file that has one from a file that has none,
// which is what greys out the front matter button. It comes out with the
// file's own line endings; the host puts it in LF before it travels.
function frontMatter(text) {
  return splitFrontMatter(text)[0];
}

module.exports = { toEditor, fromEditor, frontMatter, toLf, toEol };
