// Integration tests for the Quarto side: bin/mdm CLI guards, the Lua filter's
// HTML output (figures, escaping, dependencies), and the PDF pipeline
// (abcm2ps -> ghostscript bbox crop -> epstopdf, sha1 cache, narrow-score
// centring). Everything renders inside tests/tmp against symlinks to
// _extensions/ and tools/, so the repository itself is never written to.
// These are the slow tests: the PDF one compiles LaTeX (~20 s).
// Run with: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const MDM = path.join(ROOT, "bin", "mdm");
const TMP = path.join(__dirname, "tmp");

function freshDir(name) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(path.join(ROOT, "_extensions"), path.join(dir, "_extensions"));
  fs.symlinkSync(path.join(ROOT, "tools"), path.join(dir, "tools"));
  return dir;
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function runMdm(args, cwd) {
  return spawnSync(MDM, args, { cwd, encoding: "utf8" });
}

// ---------- bin/mdm CLI guards ----------

test("mdm without arguments exits 1 with usage", () => {
  const r = runMdm([], ROOT);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: mdm render/);
});

test("mdm refuses a file that is not .mdm", () => {
  const r = runMdm(["render", "foo.txt"], ROOT);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /expected a \.mdm file/);
});

test("mdm refuses to overwrite an existing .qmd twin", () => {
  const dir = freshDir("cli-collision");
  fs.writeFileSync(path.join(dir, "doc.mdm"), "hola\n");
  fs.writeFileSync(path.join(dir, "doc.qmd"), "precious\n");
  const r = runMdm(["render", "doc.mdm"], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exists/);
  assert.equal(fs.readFileSync(path.join(dir, "doc.qmd"), "utf8"), "precious\n");
});

// ---------- HTML rendering ----------

const HTML_DOC = `---
title: "Filter test"
format:
  html: {}
filters:
  - mdm
---

Intro paragraph.

\`\`\`abc
X:1
T:Ties & <slurs>
K:C
CDEF|
\`\`\`

\`\`\`{.abc .play}
X:2
K:C
GABc|
\`\`\`

\`\`\`music
X:3
K:C
cdef|
\`\`\`
`;

test("HTML render: figures, playback, escaping, deps, and no music alias", () => {
  const dir = freshDir("html");
  fs.writeFileSync(path.join(dir, "doc.mdm"), HTML_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  // The temporary .qmd twin must be cleaned up.
  assert.ok(!fs.existsSync(path.join(dir, "doc.qmd")));
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");

  // One figure per abc block; the play one is tagged; the ```music block is
  // NOT an alias any more (renamed to abc on 2026-08-17) and must stay a
  // plain code block.
  assert.equal((html.match(/class="mdm-block/g) || []).length, 2);
  // The class on the figure, not the bare word: the look block writes
  // --mdm-play-accent into the same page.
  assert.equal((html.match(/class="mdm-block mdm-play/g) || []).length, 1);
  assert.match(html, /<pre class="mdm-src" style="display:none">/);
  assert.ok(!/class="mdm-block[^"]*"[^>]*>[^]*X:3/.test(html.split("mdm-src")[0]));
  assert.match(html, /class="[^"]*\bmusic\b[^"]*"/);

  // The ABC source is HTML-escaped inside the hidden pre.
  assert.match(html, /T:Ties &amp; &lt;slurs&gt;/);

  // The abcjs + mdm assets ride along as HTML dependencies.
  for (const dep of [
    "abcjs-basic-min",
    "mdm.js",
    "mdm.css",
    "mdm-look.css",
    "abcjs-audio.css",
  ]) {
    assert.ok(html.includes(dep), dep + " missing from HTML");
  }
});

// ---------- The look of the editor ----------

// The block of custom properties the filter writes for the look in force, as
// a map of property to value.
function lookBlock(html) {
  const m = /html:root \{([^}]*)\}/.exec(html);
  assert.ok(m, "no look block in the page");
  const out = {};
  m[1]
    .split(";")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const at = line.indexOf(":");
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    });
  return out;
}

const PLAIN_DOC = `---
title: "No music here"
format:
  html: {}
filters:
  - mdm
---

Just prose, and \`some code\` in it.
`;

test("the look rides on every HTML render, music or no music", () => {
  const dir = freshDir("look-plain");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PLAIN_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  // The ground and the ink of the document are the document's, not the
  // scores': a page with no music is dressed all the same. abcjs is not,
  // which is what the dependency of the music blocks is for.
  assert.ok(html.includes("mdm-look.css"), "the look stylesheet is missing");
  assert.ok(!html.includes("abcjs-basic-min"), "abcjs rode along for nothing");
  const look = lookBlock(html);
  // Nothing was passed, so what is written is the light side alone and the
  // palette is left to the fallbacks of the stylesheet.
  assert.equal(look["--mdm-ink"], "#24292e");
  assert.equal(look["--mdm-syn-page"], "var(--mdm-syn-wash)");
  assert.equal(look["--mdm-staff-fill"], "#a3a3a3");
  assert.ok(!("--mdm-syn-string" in look), "a palette came from nowhere");
  assert.ok(!("--mdm-score-fill" in look), "a score fill came from nowhere");
});

test("the look metadata is read, and only what is on the list gets through", () => {
  const dir = freshDir("look-values");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PLAIN_DOC);
  const r = runMdm(
    [
      "render", "doc.mdm", "--to", "html",
      "-M", "mdm-look:dark",
      "-M", "mdm-score-fill:brass",
      "-M", "mdm-score-align:left",
      "-M", "mdm-staff-lines:ink",
      "-M", "mdm-syn-string:e6db74",
      // What must not get through: these values go into a <style> block, and
      // metadata is whatever the command line carried.
      "-M", "mdm-syn-base:red",
      "-M", "mdm-syn-keyword:e6db74} body { display: none",
      "-M", "mdm-syn-number:</style><script>alert(1)</script>",
    ],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  const look = lookBlock(html);
  assert.equal(look["--mdm-look"], undefined, "the raw metadata was echoed");
  assert.equal(look["--mdm-ink"], "#d4d4d4");
  assert.equal(look["--mdm-scheme"], "dark");
  assert.equal(look["--mdm-syn-card"], "var(--mdm-syn-bg)");
  assert.equal(look["--mdm-syn-string"], "#e6db74");
  assert.equal(look["--mdm-score-fill"], "#332c1c", "brass, on its dark value");
  assert.equal(look["--mdm-score-margin"], "0");
  assert.equal(look["--mdm-staff-fill"], "currentColor");
  // A colour that is not six hex digits is dropped whole, and the fallback of
  // the stylesheet paints that slot instead.
  assert.ok(!("--mdm-syn-base" in look), "a colour name reached the page");
  assert.ok(!("--mdm-syn-keyword" in look), "a value with CSS in it got through");
  assert.ok(!("--mdm-syn-number" in look), "a value with markup in it got through");
  assert.ok(!html.includes("alert(1)"), "the payload reached the page anyway");
});

// Quarto lists the document's other formats in the margin of the HTML ("Other
// Formats"). An .mdm declares both, so every page carried a link to a PDF that
// is only on disk if one was rendered too, and the editor the page is dressed
// as has no such column. bin/mdm turns it off, and a document that wants it
// keeps it by saying so: the flag is only passed when the file says nothing.
const TWO_FORMATS = `---
title: "Two formats"
format:
  html: {}
  pdf: {}
filters:
  - mdm
---

Prose.
`;

test("the other formats of a document are not linked in the margin", () => {
  const dir = freshDir("links-off");
  fs.writeFileSync(path.join(dir, "doc.mdm"), TWO_FORMATS);
  const r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  assert.ok(!html.includes("quarto-alternate-formats"), "the margin column is back");
  assert.ok(!html.includes('href="doc.pdf"'), "a link to a PDF that is not there");
});

test("a document that asks for the format links keeps them", () => {
  const dir = freshDir("links-on");
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    TWO_FORMATS.replace("filters:", "format-links: true\nfilters:")
  );
  const r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  assert.ok(html.includes("quarto-alternate-formats"), "the document was overruled");
});

test("a word the filter does not know falls back to the plain look", () => {
  const dir = freshDir("look-bogus");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PLAIN_DOC);
  const r = runMdm(
    [
      "render", "doc.mdm", "--to", "html",
      "-M", "mdm-look:midnight",
      "-M", "mdm-score-fill:</style>",
      "-M", "mdm-staff-lines:none",
      "-M", "mdm-score-align:middle",
    ],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const look = lookBlock(fs.readFileSync(path.join(dir, "doc.html"), "utf8"));
  assert.equal(look["--mdm-ink"], "#24292e", "an unknown side was honoured");
  assert.ok(!("--mdm-score-fill" in look));
  assert.equal(look["--mdm-staff-fill"], "#a3a3a3");
  assert.ok(!("--mdm-score-margin" in look), "an unknown alignment was honoured");
});

// ---------- PDF rendering ----------

const NARROW_ABC = `%%staffwidth 200pt
X:1
T:Narrow
M:none
L:1/1
K:C
[CG]
`;

// Two labelled systems of eighth notes: measured ink width 512 pt, well over
// the 330 pt threshold. (A short title alone is not enough: the crop is to
// real ink, and a single bar of music stays under 330 pt.)
const WIDE_ABC = `X:1
T:Wide
M:4/4
L:1/8
K:Am
P:harmonic
ABcd ef^ga | a^gfe dcBA |
P:melodic
ABcd e^f^ga | a=g=fe dcBA |]
`;

const PDF_DOC = `---
title: "PDF test"
format:
  pdf:
    documentclass: article
filters:
  - mdm
---

Narrow, centred at natural size:

\`\`\`abc
${NARROW_ABC}\`\`\`

Wide, at full text width:

\`\`\`abc
${WIDE_ABC}\`\`\`
`;

test("PDF render: sha1 cache, bbox crop, .w sidecars, narrow centring", () => {
  const dir = freshDir("pdf");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PDF_DOC);
  const r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, "doc.pdf")));

  const narrowHash = sha1(NARROW_ABC);
  const wideHash = sha1(WIDE_ABC);
  const cache = path.join(dir, "mdm_cache");

  for (const h of [narrowHash, wideHash]) {
    for (const suffix of [".abc", "_001.eps", ".pdf", ".w"]) {
      assert.ok(
        fs.existsSync(path.join(cache, h + suffix)),
        h + suffix + " missing from cache"
      );
    }
  }

  // The .w sidecar holds the cropped ink width in points, and it must agree
  // with the BoundingBox that was rewritten into the EPS.
  const wNarrow = Number(fs.readFileSync(path.join(cache, narrowHash + ".w"), "utf8"));
  const wWide = Number(fs.readFileSync(path.join(cache, wideHash + ".w"), "utf8"));
  assert.ok(wNarrow > 0 && wNarrow < 330, "narrow width: " + wNarrow);
  assert.ok(wWide >= 330, "wide width: " + wWide);
  const eps = fs.readFileSync(path.join(cache, narrowHash + "_001.eps"), "utf8");
  const bb = /%%BoundingBox: (-?\d+) (-?\d+) (-?\d+) (-?\d+)/.exec(eps);
  assert.ok(bb, "EPS BoundingBox missing");
  assert.equal(Number(bb[3]) - Number(bb[1]), wNarrow);
  // abcm2ps 8.14.15 emits no %%HiResBoundingBox (the rewrite of that line in
  // mdm.lua is defensive, for engravers that do); if one is ever present it
  // must agree with the cropped box.
  const hires = /%%HiResBoundingBox: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/.exec(eps);
  if (hires) {
    assert.equal(Number(hires[3]) - Number(hires[1]), wNarrow);
  }

  // In the LaTeX source, the narrow score is centred at natural size and the
  // wide one is inserted at full text width.
  const tex = fs.readFileSync(path.join(dir, "doc.tex"), "utf8");
  assert.ok(
    tex.includes(
      "\\begin{center}\\includegraphics{mdm_cache/" + narrowHash + ".pdf}\\end{center}"
    ),
    "narrow score not centred in TeX"
  );
  const wideUse = new RegExp(
    "includegraphics\\[[^\\]]*width=[^\\]]*\\]\\{mdm_cache/" + wideHash + "\\.pdf\\}"
  );
  assert.match(tex, wideUse);
});

test("PDF render reuses the cache (abcm2ps not rerun on a warm cache)", () => {
  const dir = path.join(TMP, "pdf");
  const cache = path.join(dir, "mdm_cache");
  assert.ok(fs.existsSync(cache), "run after the PDF test above");
  const stampFile = path.join(cache, sha1(NARROW_ABC) + ".pdf");
  const before = fs.statSync(stampFile).mtimeMs;
  const r = runMdm(["render", "doc.mdm", "--to", "pdf"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.statSync(stampFile).mtimeMs, before);
});
