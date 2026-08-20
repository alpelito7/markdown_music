// transforms.js: the mapping between the .mdm file on disk and the text the
// editor holds. The editor text is the file text, save for one thing: the
// YAML header, which the mdm.frontMatter setting can keep out of the editor.
// Hidden, the host strips it (and the blank lines under it) on the way in and
// splices it back from the file on the way out; shown, nothing is touched.

"use strict";

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
// under it stay with the host.
function toEditor(text, withFrontMatter) {
  if (withFrontMatter) return text;
  const fm = splitFrontMatter(text)[0];
  if (!fm) return text;
  return text.slice(fm.length + gapAfter(text, fm).length);
}

// Editor text -> file on disk. withFrontMatter says which of the two the
// editor text is, and it comes from the message that carried that text, not
// from the setting as it stands now: a toggle while an edit is in flight would
// otherwise read a header-less text as "the header was deleted" and drop it
// from the file.
//
// With the header out of the editor, diskText supplies it, with the blank
// lines the file kept under it (one is put in when the file had none, which
// is what Pandoc wants). If the user types a new `---` header there while the
// file already has one, the typed block joins the body: accepted edge case.
function fromEditor(editorText, diskText, withFrontMatter) {
  if (withFrontMatter) return editorText;
  const disk = diskText || "";
  let fm = splitFrontMatter(disk)[0];
  if (!fm) return editorText;
  if (!/\n$/.test(fm)) fm += "\n";
  if (editorText === "") return fm;
  const gap = gapAfter(disk, splitFrontMatter(disk)[0]) || "\n";
  return fm + gap + editorText;
}

// The YAML header of the file, whether or not the editor is showing it. The
// webview reads it to tell a file that has one from a file that has none,
// which is what greys out the front matter button.
function frontMatter(text) {
  return splitFrontMatter(text)[0];
}

module.exports = { toEditor, fromEditor, frontMatter };
