// transforms.js: two-way transformations between the .mdm file on disk and the
// text the Vditor editor sees. Vditor's lute engine truncates a fence
// info-string at the first space (```{.abc .play} becomes ```{.abc, losing
// data), so those info-strings are replaced by single-word tokens before
// entering the editor and restored on save. The blank line after the YAML
// front matter, which lute strips, is restored as well.
//
// Plain ```abc fences are tokenized too, for a second reason: Vditor renders
// any .language-abc block itself, calling ABCJS.renderAbc with no options, so
// a block that reaches the editor under its own name would be engraved by
// Vditor's abcjs (default paddings, no semantic classes) instead of by the
// webview. Under the mdm-abc token Vditor leaves it alone and main.js
// relabels it to .language-abc at render time.
//
// Known limitation: the scanner is linear, with no awareness of containers;
// fences inside blockquotes or deeply indented lists are not protected
// (documented in the README).

"use strict";

function b64urlEncode(s) {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s) {
  try {
    return Buffer.from(s, "base64url").toString("utf8");
  } catch (e) {
    return null;
  }
}

// Spaces only (no tabs) as indentation: a tab counts as 4 columns in
// CommonMark, that is, indented code and not a fence. The trailing (\r?)
// supports CRLF files; group 3 preserves the spaces between the marker and the
// info-string.
const FENCE = /^([ ]{0,3})(`{3,}|~{3,})([ \t]*)(.*?)[ \t]*(\r?)$/;

// Splits the leading YAML front matter (if any) from the body, so its lines do
// not poison the fence scanner state (e.g. a ``` inside an `abstract: |`
// literal block).
function splitFrontMatter(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  return m ? [m[0], text.slice(m[0].length)] : ["", text];
}

// Walks the body line by line tracking open fences (CommonMark: a closing
// fence carries no info-string) and applies mapInfo only to OPENING
// info-strings; block content is left untouched.
function mapFenceInfos(text, mapInfo) {
  const parts = splitFrontMatter(text);
  const lines = parts[1].split("\n");
  let fence = null; // {char, len} of the open fence
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (!m) continue;
    const marker = m[2];
    const info = m[4];
    if (fence) {
      if (marker[0] === fence.char && marker.length >= fence.len && info === "") {
        fence = null; // closing fence
      }
      continue; // anything else is literal block content
    }
    fence = { char: marker[0], len: marker.length };
    const mapped = mapInfo(info);
    if (mapped !== null && mapped !== info) {
      lines[i] = m[1] + marker + m[3] + mapped + m[5];
    }
  }
  return parts[0] + lines.join("\n");
}

function infoToEditor(info) {
  if (info === "") return null;
  if (/^\{\s*\.abc\s+\.play\s*\}$/.test(info)) return "mdm-abc-play";
  if (info === "abc" || /^\{\s*\.abc\s*\}$/.test(info)) return "mdm-abc";
  // Any other info-string lute would truncate (braces or spaces) is protected
  // with a reversible token.
  if (/[{\s]/.test(info)) return "mdm-attr-" + b64urlEncode(info);
  return null;
}

// The two mdm-abc tokens map back to the plain form, so ```{.abc} is written
// out as ```abc: the same normalization the attribute-less form already got.
// A block the user writes as ```mdm-abc is saved as ```abc for the same
// reason; the mdm- prefix marks the name as this editor's, not a language.
function infoFromEditor(info) {
  if (info === "mdm-abc") return "abc";
  if (info === "mdm-abc-play") return "{.abc .play}";
  if (info.startsWith("mdm-attr-")) {
    const dec = b64urlDecode(info.slice("mdm-attr-".length));
    // Restored only if what was decoded is something infoToEditor would have
    // encoded (it contains a brace or a space) and the encoding is exact: this
    // stops a literal ```mdm-attr-XX written by the user from mutating.
    if (
      dec !== null &&
      /[{\s]/.test(dec) &&
      "mdm-attr-" + b64urlEncode(dec) === info
    ) {
      return dec;
    }
  }
  return null;
}

// lute strips the blank line after the closing --- of the front matter;
// Pandoc/Quarto want it. It is restored on save (editor text always arrives
// with LF endings).
function restoreFrontMatterGap(text) {
  return text.replace(/^(---\n[\s\S]*?\n---\n)(?!\n)(?!$)/, "$1\n");
}

// The header as lute writes it back: exactly one newline after the closing
// ---, which is the shape a round trip through the editor settles on. Handing
// the editor the file shape instead (with the blank line Pandoc wants) makes
// every edit come back one character shorter than what was sent, which reads
// on the host as an external change and re-renders the document.
function normalizeFrontMatter(fm) {
  return fm.replace(/\r?\n*$/, "\n");
}

// File on disk -> text for the editor. withFrontMatter (the mdm.frontMatter
// setting) decides whether the YAML header is part of the editor text: shown,
// it is an ordinary block of the document, editable in place; hidden, the host
// keeps it and splices it back on save.
function toEditor(text, withFrontMatter) {
  const fm = splitFrontMatter(text)[0];
  const body = mapFenceInfos(
    text.slice(fm.length).replace(/^(?:\r?\n)+/, ""),
    infoToEditor
  );
  return withFrontMatter && fm ? normalizeFrontMatter(fm) + body : body;
}

// Editor text -> file on disk. withFrontMatter says which of the two the
// editor text is, and it comes from the message that carried that text, not
// from the setting as it stands now: a toggle while an edit is in flight would
// otherwise read a header-less text as "the header was deleted" and drop it
// from the file.
//
// With the header out of the editor, diskText supplies it. If the user types a
// new `---` header there while the file already has one, the typed block joins
// the body: accepted edge case.
function fromEditor(editorText, diskText, withFrontMatter) {
  const body = mapFenceInfos(editorText, infoFromEditor).replace(/^\n+/, "");
  if (withFrontMatter) return restoreFrontMatterGap(body);
  let fm = splitFrontMatter(diskText || "")[0];
  if (!fm) return restoreFrontMatterGap(body);
  if (!/\n$/.test(fm)) fm += "\n";
  return body === "" ? fm : fm + "\n" + body;
}

// The YAML header of the file, whether or not the editor is showing it. The
// webview reads it to tell a file that has one from a file that has none,
// which is what greys out the front matter button.
function frontMatter(text) {
  return splitFrontMatter(text)[0];
}

module.exports = { toEditor, fromEditor, frontMatter };
