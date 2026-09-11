"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const hyphen = require("../vscode-mdm/media/mdm-hyphenation.js");

test("English and Spanish use their own cuts, with three letters at each edge", () => {
  assert.deepEqual(hyphen.positions("representation", "en-US"), [3, 5, 8, 10]);
  assert.deepEqual(hyphen.positions("representación", "es-CU"), [5, 8, 10]);
  assert.deepEqual(hyphen.positions("extraordinariamente", "es"), [5, 7, 9, 11, 14]);
  assert.deepEqual(hyphen.positions("projects", "en"), [], "TeX exception was ignored");
  for (const word of ["short", "NASA", "my_identifier", "well-known", "caf\u0065\u0301", "abc123def"]) {
    assert.deepEqual(hyphen.positions(word, "en"), []);
  }
  assert.deepEqual(hyphen.positions("representation", "zz"), []);
  assert.deepEqual(hyphen.segments("https://example.com/internationalization", "en"), []);
});

test("all ten bundled languages provide offline word division", () => {
  const words = { en: "internationalization", es: "internacionalización", fr: "extraordinaire",
    de: "Silbentrennung", pt: "extraordinariamente", it: "rappresentazione", nl: "lettergrepen",
    pl: "reprezentacja", ru: "представление", uk: "представлення" };
  for (const [lang, word] of Object.entries(words)) {
    const cuts = hyphen.positions(word, lang);
    assert.ok(cuts.length, lang + " has no dictionary");
    assert.ok(cuts.every(at => at >= 3 && at <= word.length - 3), lang + " leaves a tiny fragment");
  }
});

test("language comes from the document header, never a nested setting or body", () => {
  assert.equal(hyphen.language("---\nlang: 'es-CU' # prose\n---"), "es-cu");
  assert.equal(hyphen.language('---\nlang: "fr"\n---'), "fr");
  // A header that names no language gives none, and none divides nothing:
  // Quarto's default English is not assumed (language() says why).
  assert.equal(hyphen.language("---\ntitle: |\n  lang: es\n---"), "");
  assert.equal(hyphen.language("---\nlang: es<script>\n---"), "");
  assert.equal(hyphen.language("---\ntitle: t\n---"), "");
  assert.equal(hyphen.language(""), "");
  assert.deepEqual(hyphen.positions("representation", ""), []);
  assert.deepEqual(hyphen.positions("representation", undefined), []);
  assert.deepEqual(hyphen.segments("The representation continues.", ""), []);
});

test("the editor and both render trees carry identical engines and dictionaries", () => {
  for (const name of ["mdm-hyphenation.js", "hyphenation-patterns.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "../_extensions/mdm/resources", name));
    for (const dir of ["../vscode-mdm/media", "../vscode-mdm/render/mdm/resources"]) {
      assert.deepEqual(fs.readFileSync(path.join(__dirname, dir, name)), source);
    }
  }
});
