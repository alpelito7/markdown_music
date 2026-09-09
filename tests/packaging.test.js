// Tests for what the published package carries and claims: the licence of
// the project, the notices of the work it vendors, and the copies that have
// to stay identical between the repository and the extension directory.
// These are the ones that cannot be caught by using the editor: nothing here
// changes what it does, only what may lawfully be handed to someone else, and
// what the README shown on the Marketplace page points at.
// Run with: node --test tests/packaging.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "vscode-mdm");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

test("the extension carries the same licence as the repository", () => {
  // vsce looks for a LICENSE in the package root, so the file has to exist
  // twice; a copy that drifts would put two licences on one piece of work.
  const root = read(ROOT, "LICENSE");
  assert.equal(read(EXT, "LICENSE"), root, "the two LICENSE copies drifted apart");
  assert.match(root, /^MIT License/);
  assert.match(root, /Copyright \(c\) \d{4}/);
  // The manifest says MIT; if the file ever says otherwise the two disagree
  // in public, on the Marketplace page.
  const manifest = JSON.parse(read(EXT, "package.json"));
  assert.equal(manifest.license, "MIT");
});

test("every package inside the bundle is credited in both notices", () => {
  // The bundle is rebuilt with `npm run vendor`, which rewrites VERSIONS.json.
  // A new dependency that arrives that way is one nobody has credited yet.
  const versions = JSON.parse(read(EXT, "media", "vendor", "cm6", "VERSIONS.json"));
  const names = Object.keys(versions);
  assert.ok(names.length > 20, "VERSIONS.json looks empty");
  for (const file of [
    path.join(ROOT, "THIRD-PARTY-NOTICES.md"),
    path.join(EXT, "THIRD-PARTY-NOTICES.md"),
  ]) {
    const notices = fs.readFileSync(file, "utf8");
    for (const name of names) {
      if (name === "katex") {
        assert.ok(notices.includes("KaTeX " + versions[name]), "KaTeX is not credited in " + file);
        continue;
      }
      assert.ok(
        notices.includes(name + " " + versions[name]),
        name + " " + versions[name] + " is in the bundle but not in " + path.basename(file)
      );
    }
  }
});

test("the notices name a licence for everything the extension ships", () => {
  const notices = read(EXT, "THIRD-PARTY-NOTICES.md");
  // abcjs, CodeMirror and KaTeX are MIT and the text is reproduced once.
  assert.match(notices, /abcjs 6\.7\.0/);
  assert.match(notices, /Paul\s+Rosen/);
  assert.match(notices, /Marijn\s+Haverbeke/);
  assert.match(notices, /Khan\s+Academy/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
  // The soundfont is the one piece that is not MIT: share-alike, so the
  // attribution is an obligation and not a courtesy.
  assert.match(notices, /Musyng Kite/);
  assert.match(notices, /Attribution-ShareAlike\s+3\.0/);
  assert.match(notices, /creativecommons\.org\/licenses\/by-sa\/3\.0/);
  // Latin Modern is neither MIT nor shared alike: the licence asks that a
  // derived work say what it changed and where the whole Work can be had, and
  // four faces out of a distribution of a thousand files is already a derived
  // work by its own clause 2. Both halves are pinned here, and so is the copy
  // of the licence text the package carries.
  assert.match(notices, /Latin\s+Modern\s+Roman/);
  assert.match(notices, /Jackowski/);
  assert.match(notices, /GUST\s+Font\s+License/);
  assert.match(notices, /LaTeX\s+Project\s+Public\s+License\s+1\.3c/);
  assert.match(notices, /ctan\.org\/pkg\/lm/);
  assert.ok(
    fs.existsSync(path.join(EXT, "licenses", "GUST-FONT-LICENSE.txt")),
    "the extension ships the faces without the licence they came under"
  );
  // And the tools the export asks of the machine are named as not shipped.
  assert.match(notices, /Lesser\s+General\s+Public\s+License/);
  assert.ok(
    !fs.existsSync(path.join(EXT, "tools", "bin", "abcm2ps")),
    "abcm2ps is inside the extension: the notices say it is not"
  );
});

test("the notices cover a local abcm2ps build when one is present", () => {
  // The binary is not tracked (LGPL object code stays out of the repo), but
  // a local build may sit in tools/bin/ for the render tests; while one is
  // there, the notices naming it have to hold.
  const notices = read(ROOT, "THIRD-PARTY-NOTICES.md");
  const binary = path.join(ROOT, "tools", "bin", "abcm2ps");
  if (!fs.existsSync(binary)) return; // no local build: nothing to cover
  assert.match(notices, /abcm2ps 8\.14\.15/);
  assert.match(notices, /Jean-Francois\s+Moine/);
  assert.match(notices, /Lesser\s+General\s+Public\s+License/);
  // The LGPL is only met if the text travels with the binary, and the LGPL
  // leans on the GPL text for most of its terms.
  assert.match(notices, /licenses\/LGPL-3\.0\.txt/);
  assert.match(read(ROOT, "licenses", "LGPL-3.0.txt"), /GNU LESSER GENERAL PUBLIC LICENSE/);
  assert.match(read(ROOT, "licenses", "GPL-3.0.txt"), /GNU GENERAL PUBLIC LICENSE/);
  // And the corresponding source has to be findable.
  assert.match(notices, /github\.com\/lewdlime\/abcm2ps/);
});

test("the soundfont's own note agrees with the notices", () => {
  // The note beside the files is what a reader finds first; if it and the
  // notices ever say different licences, one of them is wrong.
  const note = read(EXT, "media", "vendor", "soundfont", "README.md");
  assert.match(note, /Attribution\s+Share-Alike\s+3\.0/);
  assert.match(note, /gleitz\/midi-js-soundfonts/);
  assert.match(note, /unmodified/);
});

// The README ships in the package and is what the Marketplace page shows, and
// every picture in it is fetched by its address on GitHub: vscode-mdm/docs/
// stays out of the package (.vscodeignore) and the page reads the files from
// main. A name that folder does not have is a broken picture on the
// extension's page, seen only after a release. Each needs its alt text too:
// one is an animation and the other a picture of code.
const DOCS_URL = "https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/";

function readmePictures() {
  const md = read(EXT, "README.md");
  const pics = [];
  for (const m of md.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) pics.push({ alt: m[1], src: m[2] });
  for (const m of md.matchAll(/<(?:img|video)\b[^>]*>/g)) {
    const at = (name) => (m[0].match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] || "";
    pics.push({ alt: at("alt") || at("title"), src: at("src") });
  }
  return pics;
}

test("every picture the README shows is in its docs folder, with alt text", () => {
  const pics = readmePictures();
  const names = pics.map((p) => p.src.slice(DOCS_URL.length));
  for (const p of pics) {
    assert.ok(p.src.startsWith(DOCS_URL), `a picture not fetched from the docs folder on main: ${p.src}`);
    const name = p.src.slice(DOCS_URL.length);
    assert.ok(fs.existsSync(path.join(EXT, "docs", name)), `the README shows docs/${name}, which is not there`);
    assert.ok(p.alt.trim().length >= 40, `docs/${name} has no alt text to speak of`);
  }
  // The score block is a picture of the editor (tools/demo-clips/abc-card.js)
  // so that its ABC reads in the extension's colours; the Marketplace would
  // set a fenced block in its own.
  assert.ok(names.includes("abc-card.png"), "the README no longer shows the score block in the editor's colours");
});

// The docs folder is where the Marketplace page fetches the README's pictures
// from, so a picture in it that the README no longer names is a file nothing
// reads. Two screenshots and the documents they were taken from stayed there
// after the tour clip replaced them. The notes in Markdown are the folder's
// own; anything else has to be named by the README, as a source or a poster.
test("the docs folder holds nothing the README does not show", () => {
  const md = read(EXT, "README.md");
  const shown = new Set();
  for (const m of md.matchAll(new RegExp(DOCS_URL.replace(/[.]/g, "\\.") + '([^)"\\s]+)', "g"))) shown.add(m[1]);
  const loose = fs.readdirSync(path.join(EXT, "docs")).filter((f) => !f.endsWith(".md") && !shown.has(f));
  assert.deepEqual(loose, [], "files in vscode-mdm/docs/ that the README does not show");
});

// A clip goes into the README as a GIF, on the line after its
// <!-- clip: id --> marker (tools/demo-clips/apply.js writes it). A <video>
// would be lighter, but the Marketplace page strips muted from it, and Chrome
// then shows a reader who arrives from outside the poster and nothing else.
test("every clip the README marks is shown as its GIF", () => {
  const lines = read(EXT, "README.md").split("\n");
  const base = DOCS_URL.replace(/[.]/g, "\\.");
  let marks = 0;
  lines.forEach((line, i) => {
    const m = line.match(/^<!-- clip: ([a-z0-9-]+) -->\s*$/);
    if (!m) return;
    marks++;
    const next = lines[i + 1] || "";
    assert.match(next, new RegExp(`^!\\[[^\\]]+\\]\\(${base}clip-${m[1]}\\.gif\\)\\s*$`), `clip ${m[1]} is not followed by its GIF: ${next.slice(0, 80)}`);
  });
  assert.ok(marks > 0, "the README marks no clip");
});

// ABC in the README is shown in the extension's colours, and a code block on
// the Marketplace page is drawn by the page's own stylesheet: the ABC is the
// picture above and nothing else. A header line of a tune at the start of a
// line (X:, T:, M:, L:, Q:, K:) is ABC written as plain code.
test("the README writes no ABC as plain code", () => {
  const lines = read(EXT, "README.md").split("\n");
  const plain = lines.filter((l) => /^\s*[XTMLQK]:\S/.test(l));
  assert.deepEqual(plain, [], "ABC written as plain code in the README");
});

