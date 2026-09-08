// Tests for what the published package carries and claims: the licence of
// the project, the notices of the work it vendors, and the copies that have
// to stay identical between the repository and the extension directory.
// These are the ones that cannot be caught by using the editor: nothing here
// changes what it does, only what may lawfully be handed to someone else.
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
