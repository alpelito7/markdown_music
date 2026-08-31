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

// What a cached engraving is named after: the block and the two colours it was
// drawn in, since the same score on the two sides of the look is two drawings.
// These are the colours of a render nobody passed a look to: the black of the
// light side, and the grey the staff lines take unless the editor asks for ink.
const LIGHT_INK = "#000000";
const GRAY_STAFF = "#a3a3a3";
function cacheName(abc, ink, staff) {
  return sha1(abc + "\n" + (ink || LIGHT_INK) + " " + (staff || GRAY_STAFF));
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
  // Both forms of the accent travel: the one the sounding note takes, and the
  // deep one the chrome writes its held states in, which on the light side is
  // a colour of its own.
  assert.equal(look["--mdm-play-accent"], "#a0740f");
  assert.equal(look["--mdm-play-accent-ink"], "#8a5f00");
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
  // On the dark side the accent already reads as a glyph, so the two forms
  // are one value.
  assert.equal(look["--mdm-play-accent"], "#d9a94f");
  assert.equal(look["--mdm-play-accent-ink"], "#d9a94f");
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

// ---------- The look on paper ----------

// The PDF is dressed the way the HTML is: the ground of the side the editor
// is on, its ink, its sans, the heading sizes with the hairline under the
// first two levels, and the code card with the ten slots over it. What is
// read here is the .tex, which is where the preamble the filter writes lands.
const TEX_DOC = `---
title: "On paper"
format:
  pdf:
    documentclass: article
filters:
  - mdm
---

# A heading

Prose, and \`some code\` in it.

\`\`\`python
def f(x):
    return "s"  # a comment
\`\`\`
`;

function texOf(dir) {
  return fs.readFileSync(path.join(dir, "doc.tex"), "utf8");
}

test("the look rides on every PDF render, and reads the same metadata", () => {
  const dir = freshDir("look-tex");
  fs.writeFileSync(path.join(dir, "doc.mdm"), TEX_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);
  const tex = texOf(dir);

  // Nothing was passed: the light side, and the palette the stylesheet falls
  // back to written out slot by slot, since LaTeX has no cascade to leave it
  // to.
  assert.ok(tex.includes("\\definecolor{mdmink}{HTML}{24292E}"), "the ink is not the light one");
  assert.ok(tex.includes("\\definecolor{mdmsynkeyword}{HTML}{015692}"), "the fallback palette is missing");
  assert.ok(tex.includes("\\colorlet{mdmpage}{mdmwash}"), "the page is not the wash of the light side");
  assert.ok(tex.includes("\\colorlet{shadecolor}{mdmcard}"), "the code card is missing");
  // The editor's sans, and the ten slots over Pandoc's own token commands
  // with no bold and no italic left on them.
  assert.ok(tex.includes("TeX Gyre Heros"), "the sans is missing");
  assert.ok(
    tex.includes("\\renewcommand{\\KeywordTok}[1]{\\textcolor{mdmsynkeyword}{#1}}"),
    "the keyword slot did not reach the code"
  );
  assert.ok(!/\\renewcommand\{\\KeywordTok\}[^\n]*textbf/.test(tex), "a keyword came out bold");
  // The heading sizes of the editor, and the hairline under the first two.
  assert.ok(tex.includes("\\titleformat{\\section}"), "a standard class was not restyled");
  assert.ok(tex.includes("{2\\mdmem}"), "the h1 is not two ems");
  assert.ok(tex.includes("\\colorlet{mdmrule}{mdmink!14!mdmpage}"), "the hairline is missing");
  // The maths at the 1.21 KaTeX sets its own at, and code at the 0.88 the
  // stylesheet gives it.
  assert.ok(
    tex.includes("\\setmathfont{Latin Modern Math}[Scale=1.21]"),
    "the maths is left at the scale of the roman"
  );
  assert.ok(tex.includes("[Scale=0.88]"), "code is not at the size the editor sets it");
  // The size command must not shrink it a second time (the template carries a
  // commented-out `fontsize=\\small` of its own, which is why this names the
  // whole \\fvset).
  assert.ok(
    tex.includes("\\fvset{fontsize=\\normalsize}") &&
      !tex.includes("\\fvset{fontsize=\\small}"),
    "the code size is applied twice"
  );
  // Ragged right and no font expansion, which is how a browser sets a line.
  assert.ok(tex.includes("\\AtBeginDocument{\\raggedright}"), "the text is justified");
  assert.ok(
    tex.includes("\\microtypesetup{expansion=false}"),
    "microtype is still squeezing the glyphs of a line"
  );
  // The measure of the editor: 820 px of text at 16 px is 51.25 of its ems.
  assert.ok(tex.includes("{51.25\\mdmem}"), "the measure of the editor is missing");
  assert.ok(tex.includes("\\newgeometry{textwidth=\\mdmmeasure"), "the page was not remeasured");
  assert.ok(fs.existsSync(path.join(dir, "doc.pdf")), "the PDF did not come out");
});

// The measure is worth measuring, and the page is asked for it in so many
// words: the document prints its own \\textwidth, and the number is read back
// out of the finished PDF with the same ghostscript the engravings are cropped
// with. Reading the ink instead would measure the sheet, since the look paints
// the whole page.
const WIDTH_DOC = `---
title: "Measure"
format:
  pdf:
    documentclass: article
filters:
  - mdm
---

MDMWIDTH=\\the\\textwidth
`;

function textWidth(pdf) {
  const gs = spawnSync(
    "gs",
    ["-q", "-dBATCH", "-dNOPAUSE", "-sDEVICE=txtwrite", "-sOutputFile=-", pdf],
    { encoding: "utf8" }
  );
  const out = (gs.stdout || "") + (gs.stderr || "");
  const m = /MDMWIDTH=([\d.]+)pt/.exec(out);
  assert.ok(m, "the width is not in the PDF: " + out.slice(0, 300));
  return Number(m[1]);
}

test("the page is set to the measure of the editor", () => {
  const dir = freshDir("measure");
  fs.writeFileSync(path.join(dir, "doc.mdm"), WIDTH_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "pdf"], dir);
  assert.equal(r.status, 0, r.stderr);
  // The editor's column is 820 px of text at 16 px, which is 51.25 of its own
  // ems: 512.5 pt at the 10 pt of the article class, and that is what it gets.
  const width = textWidth(path.join(dir, "doc.pdf"));
  assert.ok(Math.abs(width - 512.5) < 1, "the text is " + width + " pt wide");

  // The class Quarto gives a document that names none sets its text at 11 pt,
  // where 51.25 ems is 561 pt and wider than letter paper can hold: there the
  // clamp answers instead, and leaves the sheet 3 cm of margin.
  const komaDir = freshDir("measure-koma");
  fs.writeFileSync(
    path.join(komaDir, "doc.mdm"),
    WIDTH_DOC.replace(/format:\n  pdf:\n    documentclass: article\n/, "")
  );
  const koma = runMdm(["render", "doc.mdm", "--to", "pdf"], komaDir);
  assert.equal(koma.status, 0, koma.stderr);
  const clamped = textWidth(path.join(komaDir, "doc.pdf"));
  assert.ok(Math.abs(clamped - 528.94) < 1, "the clamp gave " + clamped + " pt");
});

// The measure is only half of where a line ends: the editor sets its text
// ragged right and squeezes no glyph, and LaTeX, left to itself, justifies and
// lets microtype expand the font, which took one word more per line at the very
// same width. This is the opening paragraph of example.mdm, and the break is
// the one the editor draws (measured in the harness: `... equations, source` /
// `code and, on top of that, ...`).
const PARAGRAPH_DOC = `---
title: "Breaks"
format:
  pdf:
    documentclass: article
filters:
  - mdm
---

This document is ordinary Markdown, rendered and editable at once: text, **emphasis**, LaTeX equations, source code and, on top of that, music blocks that render as a score and play, with multicursor, an outline, a look set from the toolbar and export options.
`;

test("a paragraph breaks where the editor breaks it", () => {
  const dir = freshDir("breaks");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PARAGRAPH_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "pdf"], dir);
  assert.equal(r.status, 0, r.stderr);
  const gs = spawnSync(
    "gs",
    ["-q", "-dBATCH", "-dNOPAUSE", "-sDEVICE=txtwrite", "-sOutputFile=-",
      path.join(dir, "doc.pdf")],
    { encoding: "utf8" }
  );
  const lines = ((gs.stdout || "") + (gs.stderr || ""))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const first = lines.find((l) => l.startsWith("This document"));
  assert.ok(first, "the paragraph is not in the PDF");
  assert.ok(first.endsWith("source"), "the line ends: " + JSON.stringify(first.slice(-24)));
});

test("a document that names its own maths font keeps it", () => {
  const dir = freshDir("mathfont");
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    TEX_DOC.replace("filters:", "mathfont: Latin Modern Math\nfilters:")
  );
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);
  const tex = texOf(dir);
  assert.ok(!tex.includes("[Scale=1.21]"), "the document's maths font was rescaled");
  assert.ok(tex.includes("Latin Modern Math"), "the document lost its maths font");
});

test("a document that sets its own page keeps it", () => {
  const dir = freshDir("measure-own");
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    WIDTH_DOC.replace("filters:", "geometry: margin=1in\nfilters:")
  );
  const r = runMdm(["render", "doc.mdm", "--to", "pdf"], dir);
  assert.equal(r.status, 0, r.stderr);
  // An inch of margin either side of letter paper, and none of the editor's.
  const width = textWidth(path.join(dir, "doc.pdf"));
  assert.ok(Math.abs(width - 469.75) < 1, "the text is " + width + " pt wide");
});

// The two things a score can be given of its own: the fill behind it, one
// colour per side, and whether it is centred like a display equation or lined
// up with the text.
test("the fill and the alignment of a score travel to the PDF", () => {
  const dir = freshDir("score-look");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PDF_DOC);

  // Nothing asked for: no box around the engraving, and the narrow score
  // centred.
  let r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);
  let tex = texOf(dir);
  assert.ok(tex.includes("\\newcommand{\\mdmscore}[1]{#1}"), "an empty fill still boxes");
  assert.ok(tex.includes("\\begin{center}\\mdmscore{\\includegraphics{"), "the narrow score is not centred");

  // Paper, on the light side, and the score lined up with the text.
  r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true",
      "-M", "mdm-score-fill:paper", "-M", "mdm-score-align:left"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  tex = texOf(dir);
  assert.ok(tex.includes("\\definecolor{mdmscorefill}{HTML}{F4EFE2}"), "the paper fill is not the light one");
  assert.ok(tex.includes("\\colorbox{mdmscorefill}"), "the fill does not reach the engraving");
  assert.ok(!tex.includes("\\begin{center}\\mdmscore"), "the score is still centred");
  assert.ok(tex.includes("\\noindent\\mdmscore{\\includegraphics{"), "the score is not lined up left");
  // A score at the text width gives the padding back, so the box fits the
  // measure instead of hanging over both margins.
  assert.ok(tex.includes("width=\\mdmscorewidth"), "the wide score does not take the box into account");
  assert.ok(tex.includes("\\dimexpr\\linewidth-1.4em"), "the padding is not given back");

  // The dark side takes the other paper.
  r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true",
      "-M", "mdm-score-fill:paper", "-M", "mdm-look:dark"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  assert.ok(texOf(dir).includes("\\definecolor{mdmscorefill}{HTML}{2A2723}"), "the dark paper is missing");
});

// The title block Quarto draws from the YAML belongs to the header: the editor
// can keep the header off the screen, and an export from there renders a
// document that does not open with it either.
const TITLED_DOC = `---
title: "A title"
subtitle: "And a subtitle"
author: somebody
filters:
  - mdm
---

Prose.
`;

test("the title block comes out only when the header is on screen", () => {
  const dir = freshDir("front-matter");
  fs.writeFileSync(path.join(dir, "doc.mdm"), TITLED_DOC);

  // The header on screen, which is what a render with no editor behind it
  // gets as well: the block is drawn.
  let r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  let html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  assert.ok(html.includes("A title"), "the title did not come out");
  assert.ok(html.includes("somebody"), "the author did not come out");

  // The header hidden: no block, and no trace of what it held. Quarto keeps
  // the author under two names of its own, so all three have to go.
  r = runMdm(["render", "doc.mdm", "--to", "html", "-M", "mdm-front-matter:hidden"], dir);
  assert.equal(r.status, 0, r.stderr);
  html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  assert.ok(!html.includes("title-block-header"), "the block is still there");
  assert.ok(!html.includes("And a subtitle"), "the subtitle survived");
  assert.ok(!html.includes("somebody"), "the author survived");
  assert.ok(html.includes("Prose."), "the document itself went with the block");

  // And the same on paper.
  r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true",
      "-M", "mdm-front-matter:hidden"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const tex = texOf(dir);
  assert.ok(!tex.includes("\\maketitle"), "the PDF still draws the title block");
  assert.ok(!tex.includes("And a subtitle"), "the subtitle survived");
});

test("a PDF takes the side and the palette it is given", () => {
  const dir = freshDir("look-tex-dark");
  fs.writeFileSync(path.join(dir, "doc.mdm"), TEX_DOC);
  const r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true",
     "-M", "mdm-look:dark", "-M", "mdm-syn-base:d4d4d4", "-M", "mdm-syn-bg:1e1e1e",
     "-M", "mdm-syn-keyword:569cd6", "-M", "mdm-look-bogus:x"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const tex = texOf(dir);
  assert.ok(tex.includes("\\definecolor{mdmink}{HTML}{D4D4D4}"), "the dark ink is missing");
  assert.ok(tex.includes("\\colorlet{mdmpage}{mdmtint}"), "the dark page is missing");
  assert.ok(tex.includes("\\definecolor{mdmsynkeyword}{HTML}{569CD6}"), "the palette did not travel");
  // A slot that was not passed still falls back, one by one.
  assert.ok(tex.includes("\\definecolor{mdmsynstring}{HTML}{54790D}"), "an unset slot went missing");
});

test("a PDF with no code block at all still compiles", () => {
  const dir = freshDir("look-tex-plain");
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    TEX_DOC.replace(/\n# A heading[\s\S]*$/, "\n# A heading\n\nNothing but prose.\n")
  );
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  // Pandoc writes the token commands only for a document that has code in it,
  // so the block that repaints them has to ask for them first.
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, "doc.pdf")), "the PDF did not come out");
  assert.ok(
    texOf(dir).includes("\\@ifundefined{KeywordTok}"),
    "the repaint of the tokens is not asking for them first"
  );
});

// ---------- The dialect the render reads ----------

// Pandoc asks for a blank line before a heading, CommonMark does not, and the
// editor reads CommonMark: a heading written straight under a paragraph or
// under the closing fence of a score showed as a heading on screen and came
// out of the render as a line of text with hashes on it. bin/mdm renders the
// copy in a dialect with that rule off (and the same one for block quotes).
const PEGGED_DOC = `---
filters:
  - mdm
---

Prose.
## Under the prose

\`\`\`abc
X:1
K:C
C
\`\`\`
## Under the score

Prose.
> Under the prose as well
`;

test("a heading needs no blank line above it, as in the editor", () => {
  const dir = freshDir("pegged");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PEGGED_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  assert.match(html, /<h2[^>]*>Under the prose<\/h2>/);
  assert.match(html, /<h2[^>]*>Under the score<\/h2>/);
  assert.match(html, /<blockquote[\s\S]*Under the prose as well/);
  assert.ok(!html.includes("## Under"), "a heading came out as text");
});

test("a document that names its own dialect is obeyed", () => {
  const dir = freshDir("own-dialect");
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    PEGGED_DOC.replace("filters:", "from: markdown\nfilters:")
  );
  const r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  assert.ok(html.includes("## Under the prose"), "the document was overruled");
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

  const narrowHash = cacheName(NARROW_ABC);
  const wideHash = cacheName(WIDE_ABC);
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
  // Both go through \mdmscore, which is the box a fill would put them in and
  // the engraving itself when there is none.
  assert.ok(
    tex.includes(
      "\\begin{center}\\mdmscore{\\includegraphics{mdm_cache/" +
        narrowHash + ".pdf}}\\end{center}"
    ),
    "narrow score not centred in TeX"
  );
  assert.ok(
    tex.includes(
      "\\noindent\\mdmscore{\\includegraphics[width=\\mdmscorewidth]{mdm_cache/" +
        wideHash + ".pdf}}"
    ),
    "wide score not at the text width in TeX"
  );
});

// abcjs draws a tune that names no reference number and no key; abcm2ps
// refuses one, and refuses it quietly (status 0, no EPS), which used to leave
// the PDF with the ABC source as a paragraph of text while the editor and the
// HTML showed a staff. The filter supplies the two fields the engraver wants.
const BARE_ABC = `M:4/4
L:1/4
C D E F | G A b c' |]
`;

test("a tune with no X: and no K: is engraved all the same", () => {
  const dir = freshDir("pdf-bare");
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    PDF_DOC.replace(/```abc\n[\s\S]*$/, "```abc\n" + BARE_ABC + "```\n")
  );
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/engraved nothing/.test(r.stderr), r.stderr);

  // The cache is named after the block as it was written, not after what the
  // engraver was handed.
  const hash = cacheName(BARE_ABC);
  const cache = path.join(dir, "mdm_cache");
  assert.ok(fs.existsSync(path.join(cache, hash + "_001.eps")), "nothing was engraved");
  assert.equal(
    fs.readFileSync(path.join(cache, hash + ".abc"), "utf8"),
    "X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A b c' |]\n",
    "the key goes at the end of the header, and the number in front of it"
  );
  const tex = fs.readFileSync(path.join(dir, "doc.tex"), "utf8");
  assert.ok(tex.includes("mdm_cache/" + hash + ".pdf"), "the score is not in the TeX");
  assert.ok(!tex.includes("C D E F"), "the ABC source was left in the PDF as text");
});

// abcm2ps writes no colour into the engraving and Ghostscript bakes black into
// the PDF it makes of it, so the two colours the editor draws a score with are
// painted into the EPS on the way through: the ink of the side, and the grey of
// the staff lines unless the editor asks for them in ink.
test("a score is engraved in the colours of the look", () => {
  const dir = freshDir("pdf-colour");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PDF_DOC);
  const cache = path.join(dir, "mdm_cache");
  const staffRun = /\n0\.435 0\.435 0\.435 setrgbcolor dlw [^\n]*stroke 0\.831/;

  // The dark side: the score in the editor's light ink, the staff lines in the
  // grey of that side, and an entry of its own in the cache.
  let r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "mdm-look:dark"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const dark = cacheName(NARROW_ABC, "#d4d4d4", "#6f6f6f");
  const darkEps = fs.readFileSync(path.join(cache, dark + "_001.eps"), "utf8");
  assert.match(darkEps, /%%EndSetup\n0\.831 0\.831 0\.831 setrgbcolor\n/);
  assert.match(darkEps, staffRun, "the staff lines are not in the grey of the side");

  // Ink staff lines: the whole engraving in one colour, and no wrapping left.
  r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "mdm-look:dark",
      "-M", "mdm-staff-lines:ink"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const inked = cacheName(NARROW_ABC, "#d4d4d4", "#d4d4d4");
  assert.notEqual(inked, dark, "the two looks share a cache entry");
  const inkedEps = fs.readFileSync(path.join(cache, inked + "_001.eps"), "utf8");
  assert.match(inkedEps, /%%EndSetup\n0\.831 0\.831 0\.831 setrgbcolor\n/);
  assert.doesNotMatch(inkedEps, /setrgbcolor dlw/, "the staff lines were greyed");

  // And the light side is the black it always was, with grey staff lines.
  r = runMdm(["render", "doc.mdm", "--to", "pdf"], dir);
  assert.equal(r.status, 0, r.stderr);
  const light = fs.readFileSync(
    path.join(cache, cacheName(NARROW_ABC) + "_001.eps"), "utf8");
  assert.match(light, /%%EndSetup\n0\.000 0\.000 0\.000 setrgbcolor\n/);
  assert.match(light, /\n0\.639 0\.639 0\.639 setrgbcolor dlw [^\n]*stroke 0\.000/);
});

test("PDF render reuses the cache (abcm2ps not rerun on a warm cache)", () => {
  const dir = path.join(TMP, "pdf");
  const cache = path.join(dir, "mdm_cache");
  assert.ok(fs.existsSync(cache), "run after the PDF test above");
  const stampFile = path.join(cache, cacheName(NARROW_ABC) + ".pdf");
  const before = fs.statSync(stampFile).mtimeMs;
  const r = runMdm(["render", "doc.mdm", "--to", "pdf"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.statSync(stampFile).mtimeMs, before);
});
