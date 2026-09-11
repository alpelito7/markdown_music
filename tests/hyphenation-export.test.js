"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { open, skip: chromeSkip } = require("./webview/helpers.js");
const ROOT = path.join(__dirname, "..");
const quarto = spawnSync("quarto", ["--version"]).status === 0;

function fixture(name, lang) {
  const dir = path.join(__dirname, "tmp", "hyphenation-" + name);
  fs.mkdirSync(dir, { recursive: true });
  const prose = lang === "es"
    ? "Una representación extraordinariamente internacionalización continúa."
    : "The representation extraordinarily internationalization continues.";
  const source = "---\nlang: " + lang + "\nformat:\n  html:\n    embed-resources: true\n  pdf:\n    keep-tex: true\ngeometry: textwidth=80pt\nfilters:\n  - " +
    path.join(ROOT, "_extensions/mdm/mdm.lua") + "\n---\n\n" + prose + "\n";
  fs.writeFileSync(path.join(dir, "doc.mdm"), source);
  return { dir, prose, source };
}

function render(f, format, mode) {
  const result = spawnSync(path.join(ROOT, "bin/mdm"), ["render", "doc.mdm", "--to", format,
    "-M", "mdm-text-font:roman", "-M", "mdm-hyphenation:" + mode], { cwd: f.dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(f.dir, "doc.mdm"), "utf8"), f.source);
}

for (const lang of ["en", "es"]) {
  test(lang + ": self-contained HTML uses the editor's cuts and copies whole words", { skip: chromeSkip || !quarto }, async t => {
    const f = fixture("html-" + lang, lang);
    render(f, "html", "auto");
    const h = await open({ text: f.source, scores: 0, height: 500, withFrontMatter: false,
      seed: { settings: { frontMatter: "hidden", hyphenation: "auto" } }, frontMatter: f.source.split("---")[1] });
    t.after(() => h.close());
    await h.page.setViewport({ width: 340, height: 500 });
    const editor = await h.page.evaluate(() => [...document.querySelectorAll(".mdm-hyphen")].map(el => el.textContent));
    await h.page.goto("file://" + path.join(f.dir, "doc.html"));
    await h.page.evaluate(() => document.fonts.ready);
    const exported = await h.page.evaluate(() => {
      const p = document.querySelector("main.content p"), marks = [...p.querySelectorAll(".mdm-hyphen")];
      const range = document.createRange(); range.selectNodeContents(p);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return { text: p.textContent, copied: selection.toString(), marks: marks.map(el => el.textContent),
        visible: marks.some(el => { const r = document.createRange(); r.selectNodeContents(el);
          return el.getBoundingClientRect().width > r.getBoundingClientRect().width + 2; }) };
    });
    assert.equal(exported.text, f.prose);
    assert.equal(exported.copied, f.prose);
    assert.deepEqual(exported.marks, editor, "HTML chose different opportunities");
    assert.ok(exported.visible, "HTML did not paint any hyphen at a real wrap");
    render(f, "html", "none");
    await h.page.reload();
    assert.equal(await h.page.$$eval(".mdm-hyphen", marks => marks.length), 0);
    assert.deepEqual(h.errors, []);
  });
}

test("PDF honours both word-division settings in its printed text", { skip: !quarto || spawnSync("pdftotext", ["-v"]).status !== 0 }, () => {
  for (const lang of ["en", "es"]) {
    const f = fixture("pdf-" + lang, lang);
    for (const mode of ["auto", "none"]) {
      render(f, "pdf", mode);
      const result = spawnSync("pdftotext", ["-layout", path.join(f.dir, "doc.pdf"), "-"], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      if (mode === "auto") assert.match(result.stdout, /-\s*\n/, lang + ": PDF never divides a word");
      else assert.doesNotMatch(result.stdout, /-\s*\n/, lang + ": PDF divides words with the setting off");
    }
  }
});
