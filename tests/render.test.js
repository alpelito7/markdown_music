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
const zlib = require("node:zlib");
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

function sha1Bytes(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
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
// The 0.9 is the width the staff lines are rewritten to (STAFF_LINE_WIDTH in
// mdm.lua), which is part of the cache key: a width change re-engraves.
function cacheName(abc, ink, staff) {
  return sha1(abc + "\n" + (ink || LIGHT_INK) + " " + (staff || GRAY_STAFF) + " 0.9");
}

// What an abcjs engraving is named after: the engraver with its recipe
// version and staff width (`abcjs 2 703` in mdm.lua), then the block and the
// colours, as above. The default engraver on a machine with a Chrome, which
// this one is: the webview suites already need it.
function abcjsCacheName(abc, ink, staff) {
  return sha1(
    "abcjs 2 703\n" + abc + "\n" + (ink || LIGHT_INK) + " " + (staff || GRAY_STAFF));
}

// And a KaTeX formula: the recipe, the mode (I inline, D display), the TeX
// and the ink of the side (the body ink, not the svg ink of an engraving).
function katexCacheName(mode, tex, ink) {
  return sha1("katex 2 " + mode + "\n" + tex + "\n" + (ink || "#24292e"));
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

// ---------- The engine the page sets its formulas with ----------

const PAGE_MATH = (opts) => `---
title: "Math"
${opts}filters:
  - mdm
---

Inline $f:x\\to y$ and a display:

$$E=mc^2$$
`;

test("the page carries the vendored KaTeX and asks nothing of the network", () => {
  const dir = freshDir("katex");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PAGE_MATH(""));
  const r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  // Quarto's own default is MathJax from a CDN, which is what the page used
  // to carry: a formula needed the network, and MathJax's widths are not the
  // editor's, so the same paragraph broke at a different word.
  assert.ok(!/cdn\.jsdelivr/.test(html), "the page still asks a CDN for something");
  assert.ok(
    !/<script[^>]+src="[^"]*mathjax[^"]*"/i.test(html),
    "the page still loads MathJax"
  );
  // KaTeX and the script that reads the formulas back out ride with the page.
  assert.match(html, /src="[^"]*mdm-katex-[^"]*\/katex\.min\.js"/);
  assert.match(html, /src="[^"]*mdm-katex-[^"]*\/mdm-math\.js"/);
  assert.match(html, /href="[^"]*mdm-katex-[^"]*\/katex\.min\.css"/);
  const faces = fs
    .readdirSync(path.join(dir, "doc_files", "libs", "quarto-contrib"))
    .filter((n) => n.startsWith("mdm-katex-"));
  assert.equal(faces.length, 1, "the KaTeX dependency is not beside the page");
  assert.equal(
    fs.readdirSync(path.join(dir, "doc_files", "libs", "quarto-contrib", faces[0], "fonts"))
      .length,
    20,
    "the faces the stylesheet names did not come along"
  );
  // The formula is left as its own LaTeX for KaTeX to set, not written out
  // as Pandoc's own approximation of it in HTML.
  assert.match(html, /<span class="math inline">f:x\\to y<\/span>/);
  assert.match(html, /<span class="math display">E=mc\^2<\/span>/);
  // And nothing was left beside the output for the page to reach for.
  assert.ok(!fs.existsSync(path.join(dir, "mdm_cache", "katex")));
});

test("a self-contained page carries KaTeX inside the file", () => {
  // `embed-resources: true` is one file and no folder beside it, which is
  // what example.mdm asks for. The engine used to be fetched at view time by
  // a path relative to the page (Quarto rewrites the tags into a loader), so
  // a page moved away from that folder showed its formulas as LaTeX source.
  const dir = freshDir("katex-embedded");
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    PAGE_MATH("format:\n  html:\n    embed-resources: true\n")
  );
  const r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  assert.ok(
    !/<script[^>]+src="(?!data:)[^"]*"/.test(html),
    "the page fetches a script from outside itself"
  );
  assert.ok(!/href="[^"]*katex[^"]*"/.test(html), "the stylesheet was left outside");
  assert.match(html, /katex\.render/, "KaTeX itself is not in the page");
  // The faces too, or every formula would come out in a fallback face.
  assert.equal(
    (html.match(/url\(data:font\/woff2;base64,/g) || []).length,
    20,
    "the faces were not taken into the page"
  );
});

// ---------- Figures named by an absolute path ----------

// A figure drawn by another project is named by its absolute path, and Quarto
// rewrites the src of an image outside the render directory into a relative
// one by dropping the leading slash: `/tmp/x/fig.png` came out of the HTML as
// `./tmp/x/fig.png`, which points at nothing, and the PDF died in LaTeX
// looking for a file of that name beside the document. The filter copies the
// file into its own cache and points the image there.
const FIGURE_DOC = (src) => `---
title: "Absolute figure"
filters:
  - mdm
---

A figure from somewhere else.

![Elsewhere.](${src})
`;

// A 100 x 70 PNG of one flat colour, written by hand so the test carries no
// binary of its own: header, one IDAT of the raw rows, and the end marker.
function png() {
  const [w, h] = [100, 70];
  const raw = Buffer.concat(
    Array.from({ length: h }, () =>
      Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0xc8)])
    )
  );
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// The checksum every PNG chunk ends with, computed rather than tabulated.
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

test("a figure named by an absolute path is copied into the cache", () => {
  const dir = freshDir("abs-figure");
  // Outside the render directory on purpose: that is the case Quarto mangles.
  const elsewhere = path.join(TMP, "abs-figure-source");
  fs.rmSync(elsewhere, { recursive: true, force: true });
  fs.mkdirSync(elsewhere, { recursive: true });
  const figure = path.join(elsewhere, "fig.png");
  const bytes = png();
  fs.writeFileSync(figure, bytes);
  fs.writeFileSync(path.join(dir, "doc.mdm"), FIGURE_DOC(figure));

  const r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  const src = /<img src="([^"]*)"/.exec(html);
  assert.ok(src, "no figure in the HTML at all");
  assert.equal(
    src[1],
    "mdm_cache/" + sha1Bytes(bytes) + ".png",
    "the figure was not pointed at the cache"
  );
  const copy = path.join(dir, src[1]);
  assert.ok(fs.existsSync(copy), "the figure was not copied into the cache");
  assert.ok(fs.readFileSync(copy).equals(bytes), "the copy is not the figure");

  // And on paper: the same path, and a PDF that comes out at all.
  const p = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(p.status, 0, p.stderr);
  assert.ok(fs.existsSync(path.join(dir, "doc.pdf")), "no PDF came out");
  const tex = fs.readFileSync(path.join(dir, "doc.tex"), "utf8");
  assert.match(tex, /mdm_cache\/[0-9a-f]{40}\.png/, "the TeX does not name the copy");
});

// An SVG figure has to be a PDF before LaTeX can take it. Quarto converts one
// with rsvg-convert, which it does not ship: without that program the render
// dies where the conversion is asked for, so a document with a drawn figure
// had no PDF at all on a machine carrying everything the editor needs. The
// filter prints it with the Chrome it engraves the scores with.
const SVG_FIGURE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">',
  '<rect width="240" height="160" fill="#f6f4f1"/>',
  '<circle cx="120" cy="80" r="60" fill="#a0740f"/>',
  "</svg>",
  "",
].join("\n");

test("an SVG figure is printed to PDF by the filter's own Chrome", () => {
  const dir = freshDir("svg-figure");
  fs.writeFileSync(path.join(dir, "fig.svg"), SVG_FIGURE);
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    '---\ntitle: "Drawn"\nfilters:\n  - mdm\n---\n\n![A drawing.](fig.svg)\n'
  );
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, "doc.pdf")), "no PDF came out");
  const tex = fs.readFileSync(path.join(dir, "doc.tex"), "utf8");
  const named = /mdm_cache\/([0-9a-f]{40})\.pdf/.exec(tex);
  assert.ok(named, "the TeX does not name a printed figure");
  assert.equal(
    named[1],
    sha1(SVG_FIGURE),
    "the print is not named after the drawing it was made from"
  );
  // The drawing and nothing around it: 240 x 160 px is 180 x 120 pt.
  const box = execFileSync("pdfinfo", [path.join(dir, "mdm_cache", named[1] + ".pdf")], {
    encoding: "utf8",
  });
  const size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(box);
  assert.ok(size, "no page size in the printed figure");
  assert.ok(Math.abs(Number(size[1]) - 180) < 2, "printed " + size[1] + " pt wide, not 180");
  assert.ok(Math.abs(Number(size[2]) - 120) < 2, "printed " + size[2] + " pt tall, not 120");
  assert.ok(!/includesvg/.test(tex), "the SVG was left for LaTeX to read");
});

// ---------- The rules the copy draws ----------

// A `---` written straight above a score. The editor draws a rule there and
// Pandoc read the same line as the opening fence of a YAML metadata block,
// which ran to the next `---`, took the score into it and killed the render in
// Quarto's own reader ("Error parsing YAML metadata"). The blank line the two
// dialects need goes into the .qmd twin and never into the .mdm: see the
// breaks() pass of bin/mdm and withBreaks in vscode-mdm/extension.js, which
// the host suite holds to the same cases.
const RULE_DOC = `---
title: "Rules"
format:
  html: {}
filters:
  - mdm
---

Intro paragraph.

---
\`\`\`abc
X:1
K:C
CDEF|
\`\`\`

---

Last paragraph.
`;

test("a rule written straight above a score does not swallow it", () => {
  const dir = freshDir("rules");
  const doc = path.join(dir, "doc.mdm");
  fs.writeFileSync(doc, RULE_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "html"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(dir, "doc.qmd")), "the copy was left behind");
  // The blank line went into the copy, so the file on disk is untouched.
  assert.equal(fs.readFileSync(doc, "utf8"), RULE_DOC, "the document itself was rewritten");

  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  assert.equal(
    (html.match(/class="mdm-block/g) || []).length,
    1,
    "the score under the rule never reached the filter"
  );
  assert.equal((html.match(/<hr/g) || []).length, 2, "a rule came out as something else");
  assert.match(html, /Last paragraph\./);
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
  // The card of the dark side is lifted off the page and not sunk into it,
  // which is the mix the editor's own dark rule carries (style.css,
  // `#app.mdm--dark`): under a theme that draws its editor near black,
  // `--mdm-syn-bg` reads as a hole at the bottom of the page, and a block of
  // code is not a hole. The light side keeps the opposite step and is read a
  // few tests above.
  assert.equal(
    look["--mdm-syn-card"],
    "color-mix(in srgb, var(--mdm-ink) 4%, var(--mdm-syn-page))"
  );
  assert.equal(look["--mdm-syn-string"], "#e6db74");
  assert.equal(look["--mdm-score-fill"], "#332c1c", "brass, on its dark value");
  assert.equal(look["--mdm-score-margin"], "0");
  assert.equal(look["--mdm-staff-fill"], "currentColor");
  // On the dark side the accent already reads as a glyph, so the two forms
  // are one value.
  assert.equal(look["--mdm-play-accent"], "#d9a94f");
  assert.equal(look["--mdm-play-accent-ink"], "#d9a94f");
  // A colour that is not six hex digits is dropped whole. What paints the slot
  // instead is the side's business: on the light side nothing is written and
  // the stylesheet's own `:root` block has it, and on the dark side the filter
  // writes its fallback out, because that `:root` block holds the light
  // palette alone and a dark page has nothing under it to fall through to.
  // (Leaving the slot out is what used to put the dark side's ink over a
  // ground mixed from the light side's #f6f6f6.) The three values below are
  // Monokai's, the editor's own dark fallback, and not one of them is what the
  // command line carried.
  assert.equal(look["--mdm-syn-base"], "#f8f8f2", "a colour name reached the page");
  assert.equal(
    look["--mdm-syn-keyword"],
    "#f92672",
    "a value with CSS in it got through"
  );
  assert.equal(
    look["--mdm-syn-number"],
    "#ae81ff",
    "a value with markup in it got through"
  );
  assert.ok(!html.includes("display: none"), "the CSS in a value reached the page");
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

test("a heading leaves the editor's air over its rule", () => {
  // The rule under h1 and h2 hangs from the baseline of the heading's last
  // line and not from the bottom of it, at the distance the editor draws it
  // at in the face the document is set in (HEAD_RULE_AIR in mdm.lua), and one
  // command draws it under both kinds of class: KOMA's \sectionlinesformat
  // hook, and the after-code of titlesec's format, where titlesec's own
  // \titlerule used to stand with the spacing titlesec computes. It sat at a
  // different distance in each class, and went down under a last line with
  // descenders (measured). This render is the sans in an article; the
  // measured test further down reads both faces under both kinds of class.
  const dir = freshDir("head-rule");
  fs.writeFileSync(path.join(dir, "doc.mdm"), TEX_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);
  const tex = texOf(dir);
  assert.ok(
    tex.includes(
      "\\newcommand*{\\mdmheadrule}[1]{\\par\\nobreak\\vskip\\dimexpr #1\\mdmem-\\prevdepth\\relax"
    ),
    "the rule is not measured from the baseline"
  );
  assert.ok(
    tex.includes("\\Ifstr{#1}{section}{\\mdmheadrule{1.062}}"),
    "KOMA's rule under h1 is not at the sans's distance"
  );
  assert.ok(
    tex.includes("\\Ifstr{#1}{subsection}{\\mdmheadrule{0.674}}"),
    "KOMA's rule under h2 is not at the sans's distance"
  );
  assert.ok(
    tex.includes("[\\mdmheadrule{1.062}]") && tex.includes("[\\mdmheadrule{0.674}]"),
    "titlesec does not draw the same rule"
  );
  assert.ok(!tex.includes("\\titlerule"), "titlesec's own rule is still drawn");
});

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
  // The ladder level by level with its leading, on the command that draws
  // each level and on both branches of the preamble (titlesec for a standard
  // class, KOMA's hooks beside it): one for both faces, Markdown's 2, 1.5 and
  // 1.25, then 1.125 and 1.0625, each at 1.3 of its size written to the last
  // digit (rounded to two places, a wrapped h3 set its lines 1.304 of its
  // size apart). This render is the sans in an article, where `#` is
  // \section and `#####` the last level with a command; the test of the roman
  // on paper reads its own the same way. \linespread{1} goes in each
  // heading's font with its size: the prose's \linespread{1.417}, multiplied
  // into a heading's own leading, set a wrapped heading's lines 1.84 of its
  // size apart (the paper measures it further down; this pins the lever).
  const commands = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"];
  [["2", "2.6"], ["1.5", "1.95"], ["1.25", "1.625"], ["1.125", "1.4625"], ["1.0625", "1.38125"]].forEach(
    ([size, lead], i) => {
      const font = "\\fontsize{" + size + "\\mdmem}{" + lead + "\\mdmem}";
      assert.ok(
        tex.includes(
          "\\titleformat{\\" + commands[i] + "}[hang]{\\color{mdmink}\\bfseries\\linespread{1}" +
            font + "\\selectfont}"
        ),
        "titlesec does not set \\" + commands[i] + " at " + size + " ems"
      );
      assert.ok(
        tex.includes("\\addtokomafont{" + commands[i] + "}{" + font + "\\linespread{1}\\selectfont}"),
        "KOMA does not set \\" + commands[i] + " at " + size + " ems"
      );
    }
  );
  assert.ok(!tex.includes("{1.1\\mdmem}"), "the sans's old fourth level is back");
  // And a format for the fifth level, which a standard class cannot draw
  // without one once Quarto has made it stand free of the text: a `#####`
  // stopped the PDF with "titlesec Error: No format for this command". The
  // measured test of the headings further down renders one; this pins the
  // lever.
  assert.ok(
    tex.includes("\\titleformat{\\subparagraph}"),
    "the fifth level has no format under a standard class"
  );
  assert.ok(tex.includes("\\colorlet{mdmrule}{mdmink!14!mdmpage}"), "the hairline is missing");
  // The maths at the 1.21 KaTeX sets its own at, and code at the 0.88 the
  // stylesheet gives it. The face is NewCM Book, the correction for paper of
  // the same thickening KaTeX's fonts carry for the screen; Latin Modern
  // stays behind it for a distribution without NewCM.
  assert.ok(
    tex.includes("\\setmathfont{NewCMMath-Book.otf}[Scale=1.21]"),
    "the maths is not the Book weight at the KaTeX scale"
  );
  assert.ok(
    tex.includes("\\setmathfont{Latin Modern Math}[Scale=1.21]"),
    "the Latin Modern fallback is gone"
  );
  // The words of an operator (\sin, \mathrm) in the upright serif of the same
  // family, as KaTeX sets them, not in the sans of the page.
  assert.ok(tex.includes("\\setmathrm{NewCM10-Book.otf}[Scale=1.21]"), "the operators stay sans");
  // Inline code on its chip of the card material, breakable at the line's
  // end, which is what lua-ul is for; and the band of air around a score.
  assert.ok(tex.includes("\\highLight[mdmcard]"), "inline code lost its chip");
  assert.ok(tex.includes("\\newcommand{\\mdmscoreband}[1]"), "the band around a score is missing");
  // The quote with the editor's left border, and the thematic break as its
  // hairline.
  assert.ok(tex.includes("\\colorlet{mdmquoterule}{mdmink!22!mdmpage}"), "the quote border is missing");
  assert.ok(tex.includes("\\newcommand{\\mdmthematicbreak}"), "the thematic break is missing");
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
  assert.ok(
    tex.includes("\\mdmscoreband{\\centering\\mdmscore{\\includegraphics{"),
    "the narrow score is not centred inside the band"
  );

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
  assert.ok(!tex.includes("\\centering\\mdmscore"), "the score is still centred");
  assert.ok(
    tex.includes("\\mdmscoreband{\\noindent\\mdmscore{\\includegraphics{"),
    "the score is not lined up left"
  );
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

// The other side of the switch, and the one that had nothing holding it: the
// test above says the block goes away when the editor is hiding the header,
// and until this was written nothing said it comes back when the editor is
// showing it. `mdm-front-matter:shown` was only ever exercised as the filter's
// own fallback, which a document rendered from a terminal takes, so an export
// that stopped carrying the block would have gone on passing.
//
// Both faces, because the face is what the editor changes most often and the
// two travel through different sheets: the roman brings mdm-roman.css with it
// and the sans does not, and the block is drawn by neither of them. What is
// checked is the block itself and the three things it holds, the title, the
// subtitle and whoever wrote it, since Quarto normalises the author into keys
// of its own and the hidden branch has to take all of them away.
test("the title block comes out for either face when the header is on screen", () => {
  const dir = freshDir("front-matter-shown");
  fs.writeFileSync(path.join(dir, "doc.mdm"), TITLED_DOC);

  ["roman", "sans"].forEach((face) => {
    const r = runMdm(
      ["render", "doc.mdm", "--to", "html",
        "-M", "mdm-text-font:" + face,
        "-M", "mdm-front-matter:shown"],
      dir
    );
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
    assert.ok(html.includes("title-block-header"), "no title block in the " + face);
    assert.ok(html.includes(">A title<"), "the title is missing in the " + face);
    assert.ok(html.includes("And a subtitle"), "the subtitle is missing in the " + face);
    assert.ok(html.includes("somebody"), "the author is missing in the " + face);
  });
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
  // A slot that was not passed still falls back, one by one, and it falls back
  // to the palette of the side it is on rather than to one flat set: this is
  // the dark side, so the string is Monokai's. The two sides were one table
  // before, and a dark page that carried no palette came out with the dark
  // side's ink, #d4d4d4, over a ground mixed from the LIGHT side's #f6f6f6.
  assert.ok(
    tex.includes("\\definecolor{mdmsynstring}{HTML}{E6DB74}"),
    "an unset slot went missing"
  );
  assert.ok(
    !tex.includes("{HTML}{54790D}"),
    "the light side's fallback was written onto a dark page"
  );
});

test("a PDF with no palette at all takes the fallback of its own side", () => {
  const dir = freshDir("look-tex-fallback");
  fs.writeFileSync(path.join(dir, "doc.mdm"), TEX_DOC);
  const r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true", "-M", "mdm-look:light"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const tex = texOf(dir);
  // The other half of the pair the test above reads: stackoverflow-light,
  // which is what the editor shows on this side when it has no theme to read.
  // LaTeX has no cascade to leave a slot to, so every one of them is written
  // out whether it arrived or not.
  assert.ok(
    tex.includes("\\definecolor{mdmsynstring}{HTML}{54790D}"),
    "the light fallback string went missing"
  );
  assert.ok(
    tex.includes("\\definecolor{mdmsynbg}{HTML}{F6F6F6}"),
    "the light fallback ground went missing"
  );
  assert.ok(
    !tex.includes("{HTML}{E6DB74}"),
    "the dark side's fallback was written onto a light page"
  );
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
  assert.ok(!("--mdm-text" in look), "an unknown face was honoured");
});

// ---------- The face of the text ----------

test("the roman travels to the page, and only when it is asked for", () => {
  const dir = freshDir("look-roman-html");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PLAIN_DOC);
  const r = runMdm(
    ["render", "doc.mdm", "--to", "html", "-M", "mdm-text-font:roman"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  // The stylesheet reads --mdm-text on the body and the headings; the block
  // the filter writes is what puts the roman in it.
  const look = lookBlock(html);
  assert.match(
    look["--mdm-text"] || "",
    /Latin Modern Roman/,
    "the face did not reach the page"
  );
  // The faces themselves ride as their own dependency, with the rule that
  // takes KaTeX's 1.21 back off the maths: beside the roman, which is the same
  // drawing as KaTeX's own faces, there is nothing to compensate for.
  assert.ok(html.includes("mdm-roman.css"), "the roman stylesheet is missing");
  // The page links the sheet rather than carrying it (only a self-contained
  // export inlines a dependency), so the rules are read where Quarto put them.
  const libs = path.join(dir, "doc_files", "libs", "quarto-contrib");
  const romanDir = fs
    .readdirSync(libs)
    .find((name) => name.startsWith("mdm-roman"));
  assert.ok(romanDir, "the roman dependency was not copied beside the page");
  const sheet = fs.readFileSync(path.join(libs, romanDir, "mdm-roman.css"), "utf8");
  // The roman is drawn at the reading size the sans had: its x-height is
  // 0.431 em against the sans's 0.528, so at a bare 16px it reads a fifth
  // small while the headings, which are ems of that same 16px, keep theirs.
  assert.ok(
    /font-size-adjust: ex-height 0\.528/.test(sheet),
    "the exported roman is left at its own x-height"
  );
  // And the engraving is taken back out of it: abcjs draws its titles and
  // annotations as SVG text at sizes of its own, which would inherit the
  // adjust off the body and come out a seventh larger than abcjs drew them.
  // The rule is not in this sheet, though it is this sheet that makes it
  // necessary: it belongs to the score and not to the face, so it rides with
  // the look and reaches a page in either face (see below).
  const lookDir = fs
    .readdirSync(libs)
    .find((name) => name.startsWith("mdm-look"));
  assert.ok(lookDir, "the look dependency was not copied beside the page");
  const lookSheet = fs.readFileSync(path.join(libs, lookDir, "mdm-look.css"), "utf8");
  assert.ok(
    /\.mdm-fit,\s*\n\.mdm-fit svg \{\s*\n\s*font-size-adjust: none/.test(lookSheet),
    "the adjust reaches the engraving"
  );
  // KaTeX is left exactly as it ships: its own `font` shorthand keeps the
  // adjust off the maths, and its 1.21 is the compensation that matches a
  // page set at the sans's x-height.
  assert.ok(
    !/\.katex[\s\S]{0,40}font-size:/.test(sheet),
    "the export is still resizing the maths"
  );
  assert.equal(
    (sheet.match(/font-family: "Latin Modern Roman"/g) || []).length,
    4,
    "the four text faces are not all declared"
  );
  // And the faces came with it, or every word would be drawn in Georgia.
  assert.deepEqual(
    fs.readdirSync(path.join(libs, romanDir, "fonts")).sort(),
    [
      "LatinModernRoman-Bold.woff2",
      "LatinModernRoman-BoldItalic.woff2",
      "LatinModernRoman-Italic.woff2",
      "LatinModernRoman-Regular.woff2",
    ],
    "the faces the stylesheet names did not come along"
  );

  // The roman sheet sizes no heading at all: one ladder serves both faces, and
  // it is mdm-look.css's, the other end of the editor's (style.css, after
  // `#app .cm-line.mdm-h6`). The roman sheet carried article.cls's ladder
  // here at first. What the page draws with it is measured in html.test.js.
  // Read with the comments out, since a comment that names a selector is not
  // a rule.
  const rules = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const level of ["h1", "h2", "h3", "h4", "h5", "h6", "\\.title"]) {
    assert.ok(
      !new RegExp("body " + level + "\\b[^{]*\\{[^}]*font-size").test(rules),
      "the roman sheet sizes " + level.replace("\\", "") + " itself"
    );
  }
  // The face's sheet is read after the look's, the order mdm.lua adds the two
  // dependencies in: whatever it sets on an element the look also sets wins
  // that way and no other, both being one element under `body`.
  assert.ok(
    html.indexOf("mdm-roman.css") > html.indexOf("mdm-look.css"),
    "the roman sheet is read before the one it overrides"
  );

  // And a page that did not ask for it carries none of it: four faces are
  // 191 KB, and a self-contained export takes every dependency inside the
  // file. This is also what `bin/mdm render` on its own gets, the sans page
  // the filter has always drawn.
  const plain = freshDir("look-roman-none");
  fs.writeFileSync(path.join(plain, "doc.mdm"), PLAIN_DOC);
  const p2 = runMdm(["render", "doc.mdm", "--to", "html"], plain);
  assert.equal(p2.status, 0, p2.stderr);
  const sans = fs.readFileSync(path.join(plain, "doc.html"), "utf8");
  assert.ok(!("--mdm-text" in lookBlock(sans)), "the sans page named a face");
  assert.ok(!sans.includes("mdm-roman.css"), "the roman rode along for nothing");
  assert.ok(!sans.includes("Latin Modern Roman"), "a face rode along for nothing");
  // What it does carry is the reset on the engraving, which is the reason
  // that rule was taken out of the roman sheet. Nothing on a sans page sets a
  // font-size-adjust today, so the rule costs it nothing and protects it the
  // day something does: abcjs's text is drawn at the sizes abcjs gives it,
  // and an adjust inherited from the page would scale it along with the prose.
  const sansLibs = path.join(plain, "doc_files", "libs", "quarto-contrib");
  const sansLook = fs
    .readdirSync(sansLibs)
    .find((name) => name.startsWith("mdm-look"));
  assert.ok(
    /\.mdm-fit,\s*\n\.mdm-fit svg \{\s*\n\s*font-size-adjust: none/.test(
      fs.readFileSync(path.join(sansLibs, sansLook, "mdm-look.css"), "utf8")
    ),
    "the sans page has no reset on the engraving"
  );
});

test("a self-contained roman page carries its own faces", () => {
  const dir = freshDir("roman-selfcontained");
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    PAGE_MATH("format:\n  html:\n    embed-resources: true\n")
  );
  const r = runMdm(
    ["render", "doc.mdm", "--to", "html", "-M", "mdm-text-font:roman"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "doc.html"), "utf8");
  // KaTeX's twenty, and the four of the text. A page that fetched the text
  // faces from beside itself would read in Georgia wherever it was opened.
  assert.equal(
    (html.match(/url\(data:font\/woff2;base64,/g) || []).length,
    24,
    "the text faces were not taken into the page"
  );
  assert.ok(
    !/href="[^"]*LatinModernRoman[^"]*"/.test(html),
    "a face was left outside the file"
  );
});

test("the roman travels to the paper, and takes the sans preamble with it", () => {
  const dir = freshDir("look-roman-tex");
  fs.writeFileSync(path.join(dir, "doc.mdm"), TEX_DOC);
  const r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true",
     "-M", "mdm-text-font:roman"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const tex = texOf(dir);
  // On paper the roman is what LaTeX already is, so the right thing to do is
  // to stop doing the wrong one: no sans main font, and under pdfTeX no
  // \familydefault pushed over to it either.
  assert.ok(
    !tex.includes("\\setmainfont{TeX Gyre Heros}"),
    "the page is still set in the sans"
  );
  assert.ok(
    !tex.includes("\\renewcommand{\\familydefault}{\\sfdefault}"),
    "pdfTeX is still pushed to the sans"
  );
  // The sans is still declared, so a \textsf in the document has Helvetica.
  assert.ok(tex.includes("\\setsansfont{TeX Gyre Heros}"), "the sans is gone entirely");
  // The maths at the size of the words, in the Latin Modern of the same
  // family: the 1.21 and the Book weight were both answers to a sans standing
  // beside them, and no sans stands there now.
  assert.ok(
    tex.includes("\\setmathfont{Latin Modern Math}"),
    "the maths is not the Latin Modern of the text"
  );
  assert.ok(!/Scale=1\.21/.test(tex), "the compensation for a sans is still on the maths");
  // Code is untouched: it is the monospace either way.
  assert.ok(tex.includes("[Scale=0.88]"), "the code lost its size");
  // And the headings are the ladder the editor draws, the same in the roman as
  // in the sans: Markdown's top three, then 1.125 and 1.0625, at the leadings
  // written to the last digit. A heading set to another ladder is the sort of
  // drift the export rule exists to stop: a reader with the editor open beside
  // the paper is reading one document. Each size is read on the command that
  // draws its level, on both branches of the preamble, the titlesec one for a
  // standard class and the KOMA one beside it. What the paper draws with them
  // is measured further down.
  const commands = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"];
  [["2", "2.6"], ["1.5", "1.95"], ["1.25", "1.625"], ["1.125", "1.4625"], ["1.0625", "1.38125"]].forEach(
    ([size, lead], i) => {
      const font = "\\fontsize{" + size + "\\mdmem}{" + lead + "\\mdmem}";
      assert.ok(
        tex.includes(
          "\\titleformat{\\" + commands[i] + "}[hang]{\\color{mdmink}\\bfseries\\linespread{1}" +
            font + "\\selectfont}"
        ),
        "titlesec does not set the roman's \\" + commands[i] + " at " + size + " ems"
      );
      assert.ok(
        tex.includes("\\addtokomafont{" + commands[i] + "}{" + font + "\\linespread{1}\\selectfont}"),
        "KOMA does not set the roman's \\" + commands[i] + " at " + size + " ems"
      );
    }
  );
  assert.ok(!tex.includes("{2.074\\mdmem}"), "article.cls's ladder is back on the roman");
  // The two bold files at a Scale of their own: the editor's font-size-adjust
  // weighs each face by its own sxHeight, 0.444 for the bold against the
  // regular's 0.431, and under the family's one Scale the bold stood 3% taller
  // on paper than on screen (ROMAN_BOLD_SCALE in mdm.lua; what the paper draws
  // is measured further down).
  for (const shape of ["BoldFeatures", "BoldItalicFeatures"]) {
    assert.ok(
      tex.includes(shape + "={Scale=1.1892}"),
      "the " + shape + " do not hold the bold to the editor's x-height"
    );
  }
  // And the words at the size the editor draws them. fontspec's Scale is
  // font-size-adjust on paper: the x-height the editor holds the roman to
  // (0.528) over Latin Modern's own (0.431), with \f@size left alone so every
  // length in \mdmem stays where it was. The files are the four the editor
  // carries, named one by one: asked for by family name, luaotfload would
  // hand the scaled body to Latin Modern 12, a narrower drawing than the one
  // the editor breaks its lines with. What is measured on the page is in the
  // tests below; this pins the lever.
  assert.match(
    tex,
    /\\setmainfont\{lmroman10-regular\.otf\}\[Scale=1\.2251,/,
    "the roman is not drawn at the editor's size"
  );
  for (const file of ["lmroman10-italic.otf", "lmroman10-bold.otf", "lmroman10-bolditalic.otf"]) {
    assert.ok(tex.includes(file), file + " is not the face of its shape");
  }
  assert.ok(
    tex.includes("\\setmathfont{Latin Modern Math}[Scale=1.2251]"),
    "the maths LaTeX sets itself does not grow with the words"
  );
});

test("a document that names its own mainfont keeps it in the roman", () => {
  const dir = freshDir("roman-own-mainfont");
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    TEX_DOC.replace("filters:", "mainfont: TeX Gyre Termes\nfilters:")
  );
  const r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true",
     "-M", "mdm-text-font:roman"],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const tex = texOf(dir);
  // Quarto writes the document's own face into the preamble before this
  // block is read, and a \setmainfont after it would take it away.
  assert.ok(tex.includes("TeX Gyre Termes"), "the document's face never reached the preamble");
  assert.ok(!tex.includes("lmroman10-regular.otf"), "the roman was put over the document's face");
});

// ---------- The words and the equations on paper, measured ----------

// The x-height of every face this project draws words or maths in on paper,
// as a fraction of its em: OS/2 sxHeight, read off the files with fontTools
// (the TeX Live 2025 faces, and KaTeX 0.18.4's, the build vendored here).
// A face missing from the table fails the test that meets it rather than
// being guessed at.
const X_HEIGHT = {
  "LMRoman10-Regular": 0.431,
  // The roman's other three shapes. sxHeight is also what the editor's
  // font-size-adjust weighs a face by, and not the ink of its x: Chrome's `ex`
  // reads 0.431, 0.431, 0.444 and 0.444 for the four in the editor, where the
  // ink of the italic's x reaches 0.442 and the bold italic's 0.452.
  "LMRoman10-Italic": 0.431,
  "LMRoman10-Bold": 0.444,
  "LMRoman10-BoldItalic": 0.444,
  "TeXGyreHeros-Regular": 0.524,
  "TeXGyreHeros-Bold": 0.54,
  "KaTeX_Math-Italic": 0.441,
  "LatinModernMath-Regular": 0.431,
  "NewCMMath-Book": 0.431,
};

// Every run of text on the first page of a PDF, with its face and the size
// it is painted at after every transformation: ghostscript's txtwrite reports
// the size the glyph is drawn at, a formula printed by Chrome and included as
// a graphic among them.
function pdfSpans(pdf) {
  const r = spawnSync(
    "gs",
    ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=txtwrite", "-dTextFormat=0",
     "-dFirstPage=1", "-dLastPage=1", "-sOutputFile=-", pdf],
    { encoding: "utf8" }
  );
  assert.equal(r.status, 0, r.stderr);
  const spans = [];
  const re = /<span bbox="[^"]*" font="([^"]+)" size="([\d.]+)">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(r.stdout))) {
    spans.push({
      font: m[1].replace(/^[A-Z]{6}\+/, "").replace(/-Identity-H$/, ""),
      size: Number(m[2]),
      letters: (m[3].match(/ c="[^"]*"/g) || []).length,
    });
  }
  return spans;
}

// The height of a face's lowercase as painted, in bp: its size times its own
// x-height. The size is the one that face carries the most letters at, which
// is the body for the words and the line for the maths, not a script or a
// heading of the same face.
function paintedX(spans, face) {
  const at = new Map();
  for (const s of spans) {
    if (s.font === face) at.set(s.size, (at.get(s.size) || 0) + s.letters);
  }
  assert.ok(at.size, face + " is not on the page: " + [...new Set(spans.map((s) => s.font))]);
  assert.ok(face in X_HEIGHT, "no measured x-height for " + face);
  const size = [...at].sort((a, b) => b[1] - a[1])[0][0];
  return { size: size, x: size * X_HEIGHT[face] };
}

const WORDS_AND_MATHS_DOC = `---
format:
  pdf:
    documentclass: article
filters:
  - mdm
---

A string of length $L$ under a tension $T$ sounds a note, and the words around
the formula stand in the same line as it does, at the size it is.

$$f_n = \\frac{n}{2L}\\sqrt{\\frac{T}{\\mu}}$$
`;

const WORD_FACE = { roman: "LMRoman10-Regular", sans: "TeXGyreHeros-Regular" };

// Renders the fixture in one face and measures the words and the maths of
// its first page. The maths face is whichever of the three set it: KaTeX's,
// with a Chrome at hand, or LaTeX's own under the name the preamble gives it.
function wordsAndMaths(face, extra) {
  const dir = freshDir("pdf-words-maths-" + face + (extra.length ? "-latex" : ""));
  fs.writeFileSync(path.join(dir, "doc.mdm"), WORDS_AND_MATHS_DOC);
  const r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "mdm-text-font:" + face].concat(extra),
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  const spans = pdfSpans(path.join(dir, "doc.pdf"));
  const mathFace = ["KaTeX_Math-Italic", "LatinModernMath-Regular", "NewCMMath-Book"].find(
    (f) => spans.some((s) => s.font === f)
  );
  assert.ok(mathFace, "no maths face on the page: " + [...new Set(spans.map((s) => s.font))]);
  return { words: paintedX(spans, WORD_FACE[face]), maths: paintedX(spans, mathFace), mathFace };
}

// The one proportion this page was designed around: the editor draws the
// prose at an x-height of 0.528 of its em, the sans's own and the roman's by
// font-size-adjust, and sets the equations at 1.21 of the text in Computer
// Modern shapes, which lands their lowercase within 2% of the words. On paper
// the roman used to keep Latin Modern's own 0.431, and the formulas set into
// a line of it stood a fifth taller than its words (9.96 pt of text against
// 12.06 of maths, measured on example.pdf).
function assertSameSize(m, what) {
  const ratio = m.maths.x / m.words.x;
  assert.ok(
    Math.abs(ratio - 1) < 0.03,
    what + ": the maths is " + ratio.toFixed(3) + " of the words (" +
      m.mathFace + " at " + m.maths.size + " bp against the words at " + m.words.size + ")"
  );
}

test("on paper the words are the size of the equations set among them, in either face", () => {
  const roman = wordsAndMaths("roman", []);
  const sans = wordsAndMaths("sans", []);
  assertSameSize(roman, "roman");
  assertSameSize(sans, "sans");
  // And the two faces read at one size, as they do in the editor, where the
  // roman is drawn at the sans's x-height. The two proportions are one fact
  // seen twice: with the roman at its own x-height it would fail both.
  const faces = roman.words.x / sans.words.x;
  assert.ok(
    Math.abs(faces - 1) < 0.02,
    "the roman's words are " + faces.toFixed(3) + " of the sans's"
  );
});

// ---------- The headings on paper, measured ----------

// The four shapes of the roman against each other, which is what a bold
// heading is drawn in. The editor weighs each face of the family by its own
// sxHeight, so under its adjust all four are drawn with that height at 0.528
// of the em (measured off its pixels at a device scale of 16: the x of the
// regular and of the bold at 0.5283, of the italic and the bold italic at
// 0.5410 and 0.5371, whose ink stands over their sxHeight). One Scale for
// the four files drew the bold and the bold italic at 1.0302 of the regular
// on paper (measured on this fixture).
const ROMAN_SHAPES_DOC = `---
format:
  pdf:
    documentclass: article
filters:
  - mdm
---

Regular words, *italic words*, **bold words** and ***bold italic words***.
`;

test("on paper the four shapes of the roman are drawn at the editor's x-height", () => {
  const dir = freshDir("pdf-roman-shapes");
  fs.writeFileSync(path.join(dir, "doc.mdm"), ROMAN_SHAPES_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "mdm-text-font:roman"], dir);
  assert.equal(r.status, 0, r.stderr);
  const spans = pdfSpans(path.join(dir, "doc.pdf"));
  const regular = paintedX(spans, "LMRoman10-Regular");
  for (const face of ["LMRoman10-Italic", "LMRoman10-Bold", "LMRoman10-BoldItalic"]) {
    const ratio = paintedX(spans, face).x / regular.x;
    assert.ok(
      Math.abs(ratio - 1) < 0.001,
      face + " is drawn at " + ratio.toFixed(4) + " of the regular's x-height"
    );
  }
});

// Six levels, each over a line of prose, which is the document the editor's
// own test of the ladder opens (HEADINGS_DOC in webview-look.test.js). The
// class is the document's to choose, and the preamble reaches its headings
// through two doors, titlesec for a standard class and KOMA's hooks for the
// class Quarto gives a document that names none; a class with chapters writes
// `#` as \chapter and every level under it one command down. `extra` is YAML
// put in as it stands.
function headingsDoc(cls, extra) {
  return (
    "---\n" +
    (cls ? "format:\n  pdf:\n    documentclass: " + cls + "\n" : "") +
    (extra || "") +
    "filters:\n  - mdm\n---\n\n" +
    [1, 2, 3, 4, 5, 6]
      .map((n) => "#".repeat(n) + " Level " + n + "\n\nA line of prose under it.\n")
      .join("\n")
  );
}

// The ladder the editor draws, in ems of the body and level by level
// (style.css), one for both faces: Markdown's top three, then each level
// halving what the one above stands over the body, and h6 at the body.
const HEADING_LADDER = [2, 1.5, 1.25, 1.125, 1.0625, 1];

// The lines of the first page as ghostscript reads them, each with its
// letters run together, the sizes and the faces they are painted in, and the
// x its first letter stands at. txtwrite cuts a line into a span per word,
// and now and then inside one, so the spans are joined by the height they
// stand at.
function pdfLines(pdf) {
  const r = spawnSync(
    "gs",
    ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=txtwrite", "-dTextFormat=0",
     "-dFirstPage=1", "-dLastPage=1", "-sOutputFile=-", pdf],
    { encoding: "utf8" }
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = new Map();
  const re = /<span bbox="(-?[\d.]+) (-?[\d.]+) [^"]*" font="([^"]+)" size="([\d.]+)">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(r.stdout))) {
    const line = lines.get(m[2]) || { text: "", sizes: new Set(), fonts: new Set(), x: Infinity };
    line.text += (m[5].match(/ c="[^"]*"/g) || []).map((c) => c.slice(4, -1)).join("");
    line.sizes.add(Number(m[4]));
    line.fonts.add(m[3].replace(/^[A-Z]{6}\+/, "").replace(/-Identity-H$/, ""));
    line.x = Math.min(line.x, Number(m[1]));
    lines.set(m[2], line);
  }
  return [...lines.values()];
}

// Renders the six levels in one face and one class and gives back, for each
// heading, how large it reads against the prose of the page, whether it is
// painted in a bold face, and the x its first letter stands at. How large is
// what the editor holds, and it holds it by a different measure in each face:
// the sans by its em, nothing being adjusted, and the roman by its x-height,
// since font-size-adjust draws each face of the family at 0.528 of the em by
// that face's own sxHeight. So in the roman a painted size is weighed by the
// X_HEIGHT of its face: the paper draws the regular at 1.2251 of its size and
// the bold at 1.1892 (ROMAN_SCALE and ROMAN_BOLD_SCALE in mdm.lua), and by
// the em alone an h1 reads 1.9414 of the body where by its x-height it reads
// 2, as it does on screen (1.9985 there, measured off the editor's pixels).
function paperLadder(face, cls, extra) {
  const where = face + " under " + (cls || "KOMA") + (extra ? " with " + extra.trim() : "");
  const dir = freshDir("pdf-headings-" + face + "-" + (cls || "koma") + (extra ? "-extra" : ""));
  fs.writeFileSync(path.join(dir, "doc.mdm"), headingsDoc(cls, extra));
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "mdm-text-font:" + face], dir);
  assert.equal(r.status, 0, where + " did not compile:\n" + r.stderr.slice(-600));
  const lines = pdfLines(path.join(dir, "doc.pdf"));
  const lineOf = (text) => {
    const line = lines.find((l) => l.text === text);
    assert.ok(line, where + ": no line reads " + text + " (" + lines.map((l) => l.text).join(" | ") + ")");
    assert.equal(line.sizes.size, 1, where + ": " + text + " is painted at more than one size");
    return line;
  };
  const reads = (line) => {
    const size = [...line.sizes][0];
    if (face === "sans") return size;
    assert.equal(line.fonts.size, 1, where + ": " + line.text + " is painted in more than one face");
    const font = [...line.fonts][0];
    assert.ok(font in X_HEIGHT, where + ": no measured x-height for " + font);
    return size * X_HEIGHT[font];
  };
  const body = reads(lineOf("Alineofproseunderit."));
  return [1, 2, 3, 4, 5, 6].map((n) => {
    const line = lineOf("Level" + n);
    return {
      ratio: reads(line) / body,
      bold: [...line.fonts].every((f) => /Bold/.test(f)),
      x: line.x,
    };
  });
}

// Each level of the paper against the level of the screen, in both faces and
// under four kinds of class: the standard article and KOMA's, which is what
// Quarto gives a document that names none, and the same two with chapters
// (report and scrreprt), where `#` is \chapter. By the command's name, as the
// sizes used to go, a class with chapters drew `#` at its own size (2.488
// under report, 1.894 under scrreprt) and every level from `##` down at the
// size of the one above it; under a standard class a `#####` stopped the PDF
// with "titlesec Error: No format for this command" until it had a format of
// its own. The sizes come out within 0.0001 of the ladder (measured), so a
// thousandth is room for rounding and nothing more.
// Every heading stands flush with the text, `#####` under KOMA with
// `indent: true` included, which KOMA used to indent by the paragraph indent
// it keeps aside (14.2 bp in the roman, 11.6 in the sans, measured).
// Every level is bold, as the editor draws it at 600, h6 included: under
// chapters `######` is \subparagraph, and in an article, where Pandoc writes a
// sixth level as a plain paragraph, the Header filter sets it as the
// preamble's \mdmheadsix (it came out regular, as a line of prose).
test("on paper every heading is the size the editor draws it, in either face and under four kinds of class", () => {
  const runs = [];
  for (const face of ["roman", "sans"]) {
    for (const cls of ["article", null, "report", "scrreprt"]) runs.push([face, cls, ""]);
  }
  runs.push(["roman", null, "indent: true\n"]);
  for (const [face, cls, extra] of runs) {
    const where = face + " under " + (cls || "KOMA") + (extra ? " with " + extra.trim() : "");
    const got = paperLadder(face, cls, extra);
    const all = got.map((g) => g.ratio.toFixed(4)).join(", ");
    got.forEach((g, i) => {
      assert.ok(
        Math.abs(g.ratio - HEADING_LADDER[i]) < 0.001,
        where + ": h" + (i + 1) + " is " + g.ratio.toFixed(4) +
          " of the body where the editor draws it at " + HEADING_LADDER[i] +
          " (all six: " + all + ")"
      );
      assert.ok(g.bold, where + ": h" + (i + 1) + " is not set in a bold face on paper");
      assert.ok(
        Math.abs(g.x - got[0].x) <= 1,
        where + ": h" + (i + 1) + " starts at x " + g.x + " where h1 starts at " + got[0].x
      );
    });
  }
});

// A heading that wraps is set at the leading the editor gives it, 1.3 of its
// size from one line to the next. The prose's \linespread{1.417} used to be
// multiplied into a heading's own, and KOMA set a wrapped \paragraph or
// \subparagraph at the body's leading: 1.84 of the size, and 1.56 and 1.66
// (measured). Read off pdftotext's word boxes, whose coordinates are not
// rounded to the point as txtwrite's are: the step between the first words
// of a heading's first two lines, over its size in ems of the body (\mdmem,
// the prose's painted size, over ROMAN_SCALE in the roman).
const WRAP =
  "runs on long enough to fill its line and carry over onto a second one " +
  "below it, which is where its leading shows";

function wrappedDoc(cls) {
  return (
    "---\n" +
    (cls ? "format:\n  pdf:\n    documentclass: " + cls + "\n" : "") +
    "filters:\n  - mdm\n---\n\n" +
    [1, 2, 3, 4, 5, 6]
      .map((n) => "#".repeat(n) + " Wrap" + n + " " + WRAP + "\n\nA line of prose under it.\n")
      .join("\n")
  );
}

function wrappedPitches(face, cls) {
  const where = face + " under " + (cls || "KOMA");
  const dir = freshDir("pdf-wrapped-" + face + "-" + (cls || "koma"));
  fs.writeFileSync(path.join(dir, "doc.mdm"), wrappedDoc(cls));
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "mdm-text-font:" + face], dir);
  assert.equal(r.status, 0, where + " did not compile:\n" + r.stderr.slice(-600));
  const pdf = path.join(dir, "doc.pdf");
  const prose = pdfLines(pdf).find((l) => l.text === "Alineofproseunderit.");
  assert.ok(prose, where + ": no line of prose on the first page");
  const mdmem = [...prose.sizes][0] / (face === "roman" ? 1.2251 : 1);
  const t = spawnSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8" });
  assert.equal(t.status, 0, t.stderr);
  const pages = t.stdout.split("<page ").slice(1).map((p) =>
    [...p.matchAll(/<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)<\/word>/g)]
      .map((w) => ({ y: Number(w[1]), text: w[2] }))
  );
  return [1, 2, 3, 4, 5, 6].map((n) => {
    for (const words of pages) {
      const i = words.findIndex((w) => w.text === "Wrap" + n);
      if (i < 0) continue;
      const next = words.slice(i + 1).find((w) => w.y > words[i].y + 1);
      assert.ok(next, where + ": Wrap" + n + " did not wrap");
      return (next.y - words[i].y) / (HEADING_LADDER[n - 1] * mdmem);
    }
    return assert.fail(where + ": no heading reads Wrap" + n);
  });
}

test("on paper a heading that wraps is set at the editor's leading, under both kinds of class", () => {
  for (const face of ["roman", "sans"]) {
    for (const cls of ["article", null]) {
      const where = face + " under " + (cls || "KOMA");
      const got = wrappedPitches(face, cls);
      got.forEach((p, i) => {
        assert.ok(
          Math.abs(p - 1.3) < 0.01,
          where + ": a wrapped h" + (i + 1) + " steps " + p.toFixed(4) +
            " of its size from line to line (all six: " + got.map((x) => x.toFixed(4)).join(", ") + ")"
        );
      });
    }
  }
});

// The rule under h1 and h2 on paper, where the editor draws it: a fixed
// distance under the baseline of the heading's last line, whatever its
// letters (HEAD_RULE_AIR in mdm.lua, 0.749 and 0.486 ems of the body in the
// roman and 1.062 and 0.674 in the sans, measured in the editor). It used to
// hang from the depth of the last line with the class's own spacing over it,
// so it stood somewhere else in each class and went down under a last line
// with descenders (1.05 em under an h1 in the roman against 0.58 with none,
// measured). Read off the pixels at 600 dpi: the rule is the one run of the
// hairline's grey (14% of the ink over the page) most of the way across the
// sheet, and "Level 1" and "Level 2" have no descender, so the last row of
// dark ink over it is the heading's baseline, within the overshoot of an `e`.
// Under a class with chapters `#` is a \chapter and its rule is the h1's,
// titlesec drawing it with the same format and KOMA through the chapter's
// own line format: 0.747 and 0.482 em under report and 0.737 and 0.473 under
// scrreprt in the roman, 1.060 and 0.675, and 1.045 and 0.671, in the sans
// (measured).
const RULE_AIR = { roman: [0.749, 0.486], sans: [1.062, 0.674] };

function rulesUnderInk(pdf, dpi) {
  const r = spawnSync(
    "pdftoppm",
    ["-gray", "-r", String(dpi), "-f", "1", "-l", "1", pdf],
    { maxBuffer: 1 << 30 }
  );
  assert.equal(r.status, 0, String(r.stderr));
  const buf = r.stdout;
  const space = (b) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;
  const fields = [];
  let at = 0;
  while (fields.length < 4) {
    while (space(buf[at])) at++;
    const start = at;
    while (!space(buf[at])) at++;
    fields.push(buf.toString("latin1", start, at));
  }
  at++;
  const w = Number(fields[1]);
  const h = Number(fields[2]);
  const pixel = (x, y) => buf[at + y * w + x];
  const rules = [];
  for (let y = 0; y < h; y++) {
    let best = 0;
    let run = 0;
    for (let x = 0; x < w; x++) {
      const v = pixel(x, y);
      if (v > 180 && v < 235) {
        if (++run > best) best = run;
      } else {
        run = 0;
      }
    }
    if (best < 0.4 * w) continue;
    const last = rules[rules.length - 1];
    if (last && last.last === y - 1) last.last = y;
    else rules.push({ first: y, last: y });
  }
  const dark = (y) => {
    for (let x = 0; x < w; x++) if (pixel(x, y) < 128) return true;
    return false;
  };
  return rules.map((rule) => {
    let y = rule.first - 1;
    while (y > 0 && !dark(y)) y--;
    return ((rule.first - (y + 1)) * 72) / dpi;
  });
}

test("on paper the rule under h1 and h2 stands where the editor draws it, under four kinds of class", () => {
  for (const face of ["roman", "sans"]) {
    for (const cls of ["article", null, "report", "scrreprt"]) {
      const where = face + " under " + (cls || "KOMA");
      const dir = freshDir("pdf-rules-" + face + "-" + (cls || "koma"));
      fs.writeFileSync(path.join(dir, "doc.mdm"), headingsDoc(cls));
      const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "mdm-text-font:" + face], dir);
      assert.equal(r.status, 0, where + " did not compile:\n" + r.stderr.slice(-600));
      const pdf = path.join(dir, "doc.pdf");
      const prose = pdfLines(pdf).find((l) => l.text === "Alineofproseunderit.");
      assert.ok(prose, where + ": no line of prose on the first page");
      const mdmem = [...prose.sizes][0] / (face === "roman" ? 1.2251 : 1);
      const air = rulesUnderInk(pdf, 600).map((d) => d / mdmem);
      assert.equal(air.length, 2, where + ": " + air.length + " rules on the page, where h1 and h2 have one each");
      air.forEach((a, i) => {
        assert.ok(
          Math.abs(a - RULE_AIR[face][i]) < 0.05,
          where + ": the rule stands " + a.toFixed(3) + " em under h" + (i + 1) +
            " where the editor draws it at " + RULE_AIR[face][i]
        );
      });
    }
  }
});

// A chapter, in a class that has them, is the h1 the editor draws, and the
// class keeps its page break: every `#` opens a page, a right-hand one where
// the class opens chapters there (book and scrbook, a blank page going in
// before it), a `#` straight under another `#` included, and a `##` stays on
// the page of its chapter. The first `#` stands where it stands in the same
// document without chapters, under article for report and under KOMA's
// article for scrreprt: in the top class titlesec keeps \chapter in, its
// baseline stood 6.05 em under the top of the text where an article's `#`
// stands 1.82, and KOMA's own skip put it 7.2 em lower than a \section
// (measured). Now it is the same to the thousandth of an em under report, and
// under scrreprt 0.187 em lower in the roman and 0.363 in the sans, KOMA
// hanging a chapter's first line from \topskip (pdftotext's word boxes,
// measured); half an em is room for that and nothing like the skips it
// replaced.
const chaptersDoc = (cls) =>
  "---\n" +
  (cls ? "format:\n  pdf:\n    documentclass: " + cls + "\n" : "") +
  "filters:\n  - mdm\n---\n\n" +
  "# One\n\n# Two\n\nA line of prose under it.\n\n" +
  "# Three\n\nA line of prose under it.\n\n## Four\n\nA line of prose under it.\n";

// Every word of a PDF with its page and the bottom of its box, which
// pdftotext gives in fractions of a point where txtwrite rounds to the point.
function pdfWords(pdf) {
  const t = spawnSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8" });
  assert.equal(t.status, 0, t.stderr);
  return t.stdout.split("<page ").slice(1).flatMap((p, i) =>
    [...p.matchAll(/<word xMin="[\d.]+" yMin="[\d.]+" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g)]
      .map((w) => ({ page: i + 1, bottom: Number(w[1]), text: w[2] }))
  );
}

test("on paper a chapter opens its page and stands where an article's `#` stands", () => {
  const render = (face, cls) => {
    const where = face + " under " + (cls || "KOMA");
    const dir = freshDir("pdf-chapters-" + face + "-" + (cls || "koma"));
    fs.writeFileSync(path.join(dir, "doc.mdm"), chaptersDoc(cls));
    const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "mdm-text-font:" + face], dir);
    assert.equal(r.status, 0, where + " did not compile:\n" + r.stderr.slice(-600));
    const pdf = path.join(dir, "doc.pdf");
    const words = pdfWords(pdf);
    const word = (text) => {
      const w = words.find((x) => x.text === text);
      assert.ok(w, where + ": no word reads " + text);
      return w;
    };
    return { where, pdf, word };
  };
  const pages = (doc) => ["One", "Two", "Three", "Four"].map((t) => doc.word(t).page);
  for (const face of ["roman", "sans"]) {
    for (const [chapters, plain] of [["report", "article"], ["scrreprt", null]]) {
      const c = render(face, chapters);
      const p = render(face, plain);
      assert.deepEqual(pages(c), [1, 2, 3, 3], c.where + ": the chapters are not a page each");
      const prose = pdfLines(p.pdf).find((l) => l.text === "Alineofproseunderit.");
      assert.ok(prose, p.where + ": no line of prose on the first page");
      const mdmem = [...prose.sizes][0] / (face === "roman" ? 1.2251 : 1);
      const dy = (c.word("One").bottom - p.word("One").bottom) / mdmem;
      assert.ok(
        Math.abs(dy) < 0.5,
        c.where + ": the first `#` stands " + dy.toFixed(3) + " em lower than " + p.where + " sets it"
      );
    }
  }
  for (const cls of ["book", "scrbook"]) {
    assert.deepEqual(
      pages(render("roman", cls)),
      [1, 3, 5, 5],
      "roman under " + cls + ": a chapter does not open a right-hand page"
    );
  }
});

// A sixth-level heading on paper is a heading. Pandoc writes a level past
// \subparagraph as a plain paragraph, which in an article is `######`, and it
// came out as a line of prose: the regular face, with no more air over it
// than two paragraphs leave (measured). The Header filter hands it to the
// preamble's \mdmheadsix instead, with its label, so that a link to it still
// lands; under a class with chapters `######` is \subparagraph, a heading
// already, and is left to it.
const SIXTH_DOC = `---
format:
  pdf:
    documentclass: article
filters:
  - mdm
---

A paragraph that points at [the sixth level](#six).

###### Six {#six}

A line of prose under it.
`;

test("a sixth-level heading reaches the paper as a heading, with its label", () => {
  const dir = freshDir("pdf-sixth");
  fs.writeFileSync(path.join(dir, "doc.mdm"), SIXTH_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);
  const tex = texOf(dir);
  assert.ok(tex.includes("\\mdmheadsix{Six}\\label{six}"), "the sixth level is not the preamble's heading");
  assert.ok(tex.includes("\\hyperref[six]"), "the link to it does not reach its label");
});

// The title on paper at the size and weight the page draws it: 2 ems of the
// body and bold, as `body .title` in mdm-look.css draws it (32px and 600 on
// the 16px body, measured on the exported page). The class drew it at its
// own \LARGE in an article, 1.728 of the body, and \huge under KOMA, 1.894
// (measured). The subtitle is not bold, the page setting it at 300.
const titleDoc = (cls) =>
  "---\n" +
  'title: "A title on paper"\n' +
  'subtitle: "A subtitle under it"\n' +
  (cls ? "format:\n  pdf:\n    documentclass: " + cls + "\n" : "") +
  "filters:\n  - mdm\n---\n\n" +
  "A line of prose under it.\n";

test("on paper the title is the size and weight the page gives it, under both kinds of class", () => {
  for (const face of ["roman", "sans"]) {
    for (const cls of ["article", null]) {
      const where = face + " under " + (cls || "KOMA");
      const dir = freshDir("pdf-title-" + face + "-" + (cls || "koma"));
      fs.writeFileSync(path.join(dir, "doc.mdm"), titleDoc(cls));
      const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "mdm-text-font:" + face], dir);
      assert.equal(r.status, 0, where + " did not compile:\n" + r.stderr.slice(-600));
      const lines = pdfLines(path.join(dir, "doc.pdf"));
      const lineOf = (text) => {
        const line = lines.find((l) => l.text === text);
        assert.ok(line, where + ": no line reads " + text + " (" + lines.map((l) => l.text).join(" | ") + ")");
        return line;
      };
      // By its em in the sans and by its x-height in the roman, as the ladder
      // of the headings is read (paperLadder).
      const reads = (line) => {
        const size = [...line.sizes][0];
        if (face === "sans") return size;
        const font = [...line.fonts][0];
        assert.ok(font in X_HEIGHT, where + ": no measured x-height for " + font);
        return size * X_HEIGHT[font];
      };
      const title = lineOf("Atitleonpaper");
      const ratio = reads(title) / reads(lineOf("Alineofproseunderit."));
      assert.ok(
        Math.abs(ratio - 2) < 0.001,
        where + ": the title is " + ratio.toFixed(4) + " of the body where the page draws it at 2"
      );
    }
test("the maths LaTeX sets itself grows with the words", () => {
  // The route with no KaTeX in it, which is every document without a Chrome
  // at hand and every one that asks for abcm2ps: unicode-math sets the
  // formulas, and its face has to be scaled with the words or the fix above
  // turns round and leaves the maths a fifth small.
  const roman = wordsAndMaths("roman", ["-M", "mdm-engraver:abcm2ps"]);
  const sans = wordsAndMaths("sans", ["-M", "mdm-engraver:abcm2ps"]);
  assert.notEqual(roman.mathFace, "KaTeX_Math-Italic", "KaTeX set the maths under abcm2ps");
  assertSameSize(roman, "roman");
  assertSameSize(sans, "sans");
  const faces = roman.words.x / sans.words.x;
  assert.ok(
    Math.abs(faces - 1) < 0.02,
    "the roman's words are " + faces.toFixed(3) + " of the sans's"
  );
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

// Forced to abcm2ps: this test pins the EPS pipeline itself (the .abc the
// engraver reads, the crop written back into the EPS), which the default
// abcjs engraver never writes.
test("PDF render: sha1 cache, bbox crop, .w sidecars, narrow centring", () => {
  const dir = freshDir("pdf");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PDF_DOC);
  const r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true",
      "-M", "mdm-engraver:abcm2ps"],
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
      "\\mdmscoreband{\\centering\\mdmscore{\\includegraphics{mdm_cache/" +
        narrowHash + ".pdf}}}"
    ),
    "narrow score not centred in TeX"
  );
  assert.ok(
    tex.includes(
      "\\mdmscoreband{\\noindent\\mdmscore{\\includegraphics[width=\\mdmscorewidth]{mdm_cache/" +
        wideHash + ".pdf}}}"
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
  // Forced to abcm2ps: abcjs falls back to X:1 and K:C by itself, and the
  // injected header this test pins is for the engraver that will not.
  const r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true",
      "-M", "mdm-engraver:abcm2ps"],
    dir);
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
  // Forced to abcm2ps throughout: what is read back is the painted EPS.
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    PDF_DOC.replace("filters:", "mdm-engraver: abcm2ps\nfilters:"));
  const cache = path.join(dir, "mdm_cache");
  // The grey wraps the staff run, whose `dlw` (0.7 pt) is rewritten to the
  // 0.9 pt that cannot fall between the pixel rows of a screen.
  const staffRun = /\n0\.435 0\.435 0\.435 setrgbcolor 0\.9 SLW [^\n]*stroke 0\.831/;

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
  assert.doesNotMatch(inkedEps, /setrgbcolor 0\.9 SLW/, "the staff lines were greyed");
  // In ink the lines keep the colour of the score but still take the width.
  assert.match(inkedEps, /\n0\.9 SLW [^\n]*stroke/, "the staff lines kept the hairline width");

  // And the light side is the black it always was, with grey staff lines.
  r = runMdm(["render", "doc.mdm", "--to", "pdf"], dir);
  assert.equal(r.status, 0, r.stderr);
  const light = fs.readFileSync(
    path.join(cache, cacheName(NARROW_ABC) + "_001.eps"), "utf8");
  assert.match(light, /%%EndSetup\n0\.000 0\.000 0\.000 setrgbcolor\n/);
  assert.match(light, /\n0\.639 0\.639 0\.639 setrgbcolor 0\.9 SLW [^\n]*stroke 0\.000/);
});

test("PDF render reuses the cache (abcm2ps not rerun on a warm cache)", () => {
  const dir = path.join(TMP, "pdf");
  const cache = path.join(dir, "mdm_cache");
  assert.ok(fs.existsSync(cache), "run after the PDF test above");
  const stampFile = path.join(cache, cacheName(NARROW_ABC) + ".pdf");
  const before = fs.statSync(stampFile).mtimeMs;
  const r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "mdm-engraver:abcm2ps"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.statSync(stampFile).mtimeMs, before);
});

// ---------- The editor's engraver ----------

// The default: the same abcjs that draws the editor and the HTML, loaded
// into a headless Chrome and printed to a vector PDF, so a score in the PDF
// is the score the editor shows, glyph for glyph. abcm2ps stays behind it
// for a machine without a Chrome; that degrade is a plain nil-check in the
// filter and is not staged here, since blinding the render to the real
// Chrome would mean starving its PATH, and quarto and latex live there too.
test("the PDF is engraved by the editor's abcjs when a Chrome is at hand", () => {
  const dir = freshDir("pdf-abcjs");
  fs.writeFileSync(path.join(dir, "doc.mdm"), PDF_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);
  const cache = path.join(dir, "mdm_cache");
  const narrow = abcjsCacheName(NARROW_ABC);
  const wide = abcjsCacheName(WIDE_ABC);
  for (const h of [narrow, wide]) {
    assert.ok(fs.existsSync(path.join(cache, h + ".pdf")), h + ".pdf missing");
    assert.ok(fs.existsSync(path.join(cache, h + ".w")), h + ".w missing");
    // Nothing of the abcm2ps pipeline, and the page Chrome printed from and
    // its untrimmed print are cleaned away.
    for (const suffix of [".abc", "_001.eps", ".html", ".chrome.pdf"]) {
      assert.ok(
        !fs.existsSync(path.join(cache, h + suffix)),
        h + suffix + " left behind");
    }
  }
  // And no abcm2ps engraving happened on the side: the fallback stayed put.
  assert.ok(
    !fs.existsSync(path.join(cache, cacheName(NARROW_ABC) + ".pdf")),
    "the render fell back to abcm2ps");
  // The %%staffwidth 200pt score comes out well under the 330 pt threshold
  // (132 pt of ink, measured: the one sparse bar does not fill even that):
  // narrow, centred at natural size. The wide one takes the text width.
  const wNarrow = Number(fs.readFileSync(path.join(cache, narrow + ".w"), "utf8"));
  const wWide = Number(fs.readFileSync(path.join(cache, wide + ".w"), "utf8"));
  assert.ok(wNarrow > 0 && wNarrow < 330, "narrow width: " + wNarrow);
  assert.ok(wWide >= 330, "wide width: " + wWide);
  const tex = fs.readFileSync(path.join(dir, "doc.tex"), "utf8");
  assert.ok(
    tex.includes(
      "\\mdmscoreband{\\centering\\mdmscore{\\includegraphics{mdm_cache/" +
        narrow + ".pdf}}}"),
    "narrow abcjs score not centred in TeX");
  // The wide score is two labelled systems, so it goes down as one clipped
  // image per system (what the slices are and how they tile is pinned in the
  // test below); what is asked for here is the text width they are set at.
  const wideSlices = tex.match(
    new RegExp(
      String.raw`\\includegraphics\[trim=[^\]]*,clip,width=\\mdmscorewidth\]` +
        String.raw`\{mdm_cache/` + wide + String.raw`\.pdf\}`,
      "g"
    )
  );
  assert.equal(
    wideSlices && wideSlices.length, 2,
    "wide abcjs score not two slices at the text width in TeX");
});

// A picture is atomic to LaTeX: whole, a score that does not fit the space
// left on the page jumps to the next one entire and leaves the rest of this
// one blank, and one taller than the page has nowhere to go at all (with the
// slices off, below: the document grows a page, the score sits alone on it
// and still runs past the bottom margin). Music is written to be read across
// a page turn, so the engraver reports where its staff systems fell and the
// score goes down as one clipped image per system, stacked with no glue:
// they tile into the drawing they were cut from, and the page may break
// between any two of them, where the engraving is already blank.
//
// Twelve systems, 856 pt of drawing against the 622.7 pt of text a page of
// this document holds (both measured), so the break has to fall inside the
// score whatever the geometry rounds to.
const TALL_ABC =
  "X:1\nT:Tall\nM:4/4\nL:1/8\nK:Am\n" +
  Array.from(
    { length: 12 },
    (_, i) => "P:sys" + (i + 1) + "\nABcd ef^ga | a^gfe dcBA |"
  ).join("\n") + "\n";

const TALL_DOC = `---
title: "Tall score"
format:
  pdf:
    documentclass: article
filters:
  - mdm
---

A score taller than the page it starts on.

\`\`\`abc
${TALL_ABC}\`\`\`

After the score.
`;

// The pages of a finished PDF, counted with the same ghostscript the
// engravings are cropped with: the bbox device writes one box per page.
function pageCount(pdf) {
  const gs = spawnSync(
    "gs",
    ["-q", "-dBATCH", "-dNOPAUSE", "-sDEVICE=bbox", pdf],
    { encoding: "utf8" }
  );
  const out = (gs.stdout || "") + (gs.stderr || "");
  return (out.match(/^%%BoundingBox:/gm) || []).length;
}

test("a long score is cut so a page can break between two of its systems", () => {
  const dir = freshDir("pdf-slices");
  fs.writeFileSync(path.join(dir, "doc.mdm"), TALL_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);

  // The sidecar: the height of the cropped drawing first, then one position
  // per gap between two systems, in points from its bottom edge and top to
  // bottom, so each one is inside the drawing and below the one before it.
  const digest = abcjsCacheName(TALL_ABC);
  const numbers = fs
    .readFileSync(path.join(dir, "mdm_cache", digest + ".cuts"), "utf8")
    .trim()
    .split(/\s+/)
    .map(Number);
  const height = numbers.shift();
  assert.ok(height > 800, "the drawing is " + height + " pt tall");
  assert.equal(numbers.length, 11, "twelve systems, eleven cuts: " + numbers.length);
  let above = height;
  for (const cut of numbers) {
    assert.ok(
      cut > 0 && cut < above,
      "the cuts do not run down the drawing: " + numbers.join(" ")
    );
    above = cut;
  }

  // The .tex: one clipped image per system, every one of them the same
  // drawing at the text width, and the trims tile it exactly, each slice
  // starting where the one above it stopped.
  const tex = texOf(dir);
  const slices = [
    ...tex.matchAll(
      new RegExp(
        String.raw`\\mdmslice\{\\includegraphics\[trim=0bp ([\d.]+)bp 0bp ([\d.]+)bp,` +
          String.raw`clip,width=\\mdmscorewidth\]\{mdm_cache/` + digest + String.raw`\.pdf\}\}`,
        "g"
      )
    ),
  ];
  assert.equal(slices.length, 12, "the score did not go down as twelve slices");
  slices.forEach((slice, i) => {
    const wanted = i < numbers.length ? numbers[i] : 0;
    const above = i === 0 ? 0 : height - numbers[i - 1];
    assert.ok(
      Math.abs(Number(slice[1]) - wanted) < 0.01,
      "slice " + (i + 1) + " is cut at " + slice[1] + ", not " + wanted
    );
    assert.ok(
      Math.abs(Number(slice[2]) - above) < 0.01,
      "slice " + (i + 1) + " starts at " + slice[2] + ", not " + above
    );
  });
  // One band and one stack around the lot: the air above and below the score
  // is the band's, and between the slices there is none of TeX's.
  assert.equal(
    (tex.match(/\\mdmscoreband\{\\mdmslicestack\{/g) || []).length,
    1,
    "the slices are not held in one band"
  );

  // And what it comes to on paper: two pages, which is the score starting on
  // the first and finishing on the second.
  assert.equal(pageCount(path.join(dir, "doc.pdf")), 2, "the score did not break");

  // Verified to bite: with the sidecar taken away the score goes down whole,
  // the way an abcm2ps engraving does (no browser measures that one), and
  // the same document needs three pages, the score alone on the second.
  fs.unlinkSync(path.join(dir, "mdm_cache", digest + ".cuts"));
  const whole = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(whole.status, 0, whole.stderr);
  assert.ok(
    texOf(dir).includes("\\mdmscore{\\includegraphics[width=\\mdmscorewidth]"),
    "the score is not one piece without its sidecar"
  );
  assert.equal(pageCount(path.join(dir, "doc.pdf")), 3, "the whole score fitted after all");
});

// A block abcjs draws nothing from (directives alone, or nothing at all)
// prints an inkless page, which pdfcrop cannot trim: the filter has to see
// the zero-ink box and refuse it, or a blank 900 x 4500 pt sheet was cached
// and inserted at natural size (nine-odd pages of nothing, measured before
// the guard). The refusal falls through to abcm2ps, which also refuses, and
// the block stays source text, exactly as it did before the Chrome engraver.
test("a block with no ink in it falls all the way back to source text", () => {
  const dir = freshDir("pdf-inkless");
  const BLANK_ABC = "%%staffwidth 200pt\n% nothing here\n";
  fs.writeFileSync(
    path.join(dir, "doc.mdm"),
    PDF_DOC.replace(/```abc\n[\s\S]*$/, "```abc\n" + BLANK_ABC + "```\n")
  );
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /engraved nothing/, "the fallback chain did not end in the warning");
  const cache = path.join(dir, "mdm_cache");
  assert.ok(
    !fs.existsSync(path.join(cache, abcjsCacheName(BLANK_ABC) + ".pdf")),
    "the inkless engraving was cached");
  const tex = fs.readFileSync(path.join(dir, "doc.tex"), "utf8");
  assert.ok(!tex.includes("\\mdmscore{"), "an engraving was inserted for an inkless block");
  // Skylighting escapes the percent signs (`\%\%staffwidth`), so what is
  // asked for is the bare directive.
  assert.ok(tex.includes("staffwidth 200pt"), "the source text of the block is gone");
});

// ---------- The editor's equations ----------

const MATH_DOC = `---
title: "Math"
format:
  pdf:
    documentclass: article
filters:
  - mdm
---

Inline $L$ math.

$$f_n = \\frac{n}{2L}\\sqrt{\\frac{T}{\\mu}} = n f_1.$$
`;
const INLINE_TEX = "L";
const DISPLAY_TEX = "f_n = \\frac{n}{2L}\\sqrt{\\frac{T}{\\mu}} = n f_1.";

test("the equations are set by the editor's KaTeX when a Chrome is at hand", () => {
  const dir = freshDir("pdf-katex");
  fs.writeFileSync(path.join(dir, "doc.mdm"), MATH_DOC);
  const r = runMdm(["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true"], dir);
  assert.equal(r.status, 0, r.stderr);
  const cache = path.join(dir, "mdm_cache");
  const inline = katexCacheName("I", INLINE_TEX);
  const display = katexCacheName("D", DISPLAY_TEX);
  for (const h of [inline, display]) {
    assert.ok(fs.existsSync(path.join(cache, h + ".pdf")), h + ".pdf missing");
    assert.ok(fs.existsSync(path.join(cache, h + ".dim")), h + ".dim missing");
  }
  // The .dim sidecar carries "w h d pw ph" in the editor's pixels, the
  // pagelet padded to the 8 px grid Chrome prints exactly.
  const dim = fs.readFileSync(path.join(cache, inline + ".dim"), "utf8");
  const [w, h, d, pw, ph] = dim.trim().split(" ").map(Number);
  assert.ok(w > 1 && h > w && d > 0, "inline dims look wrong: " + dim);
  assert.ok(pw % 8 === 0 && ph % 8 === 0 && pw > w && ph > h, "pagelet not on the 8px grid: " + dim);
  const tex = fs.readFileSync(path.join(dir, "doc.tex"), "utf8");
  // The inline formula rides a \makebox of its true width around a
  // \raisebox that drops the padded pagelet to the baseline and reports
  // the real ascent and depth; the display one is centred in its band.
  assert.match(
    tex,
    new RegExp("\\\\makebox\\[[\\d.]+\\\\mdmem\\]\\[l\\]\\{\\\\raisebox\\{-[\\d.]+\\\\mdmem\\}" +
      "\\[[\\d.]+\\\\mdmem\\]\\[[\\d.]+\\\\mdmem\\]\\{\\\\includegraphics\\[width=[\\d.]+\\\\mdmem\\]" +
      "\\{mdm_cache/" + inline + "\\.pdf\\}\\}\\}"),
    "the inline formula is not inserted on the baseline");
  assert.ok(
    tex.includes("{\\centering\\makebox") && tex.includes(display + ".pdf"),
    "the display formula is not centred in its band");
  assert.ok(!tex.includes("\\(L\\)"), "the inline formula was left to LaTeX");
});

test("mdm-engraver: abcm2ps leaves the equations to LaTeX", () => {
  const dir = freshDir("pdf-katex-off");
  fs.writeFileSync(path.join(dir, "doc.mdm"), MATH_DOC);
  const r = runMdm(
    ["render", "doc.mdm", "--to", "pdf", "-M", "keep-tex:true",
      "-M", "mdm-engraver:abcm2ps"],
    dir);
  assert.equal(r.status, 0, r.stderr);
  const tex = fs.readFileSync(path.join(dir, "doc.tex"), "utf8");
  assert.ok(tex.includes("\\(L\\)"), "the inline formula is not LaTeX's");
  assert.ok(!tex.includes("\\makebox["), "a KaTeX insertion slipped through");
  assert.ok(
    !fs.existsSync(path.join(dir, "mdm_cache", katexCacheName("I", INLINE_TEX) + ".pdf")),
    "a KaTeX engraving was cached under abcm2ps");
});
