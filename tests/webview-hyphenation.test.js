"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { open, skip, docText, setSelection, selectionRanges, postSettings, setSettingPosts, lastEdit, update } = require("./webview/helpers.js");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BUTTON = 'button[data-type="mdm-hyphenation"]';
const ENTRY = tag => '#app button[data-type="mdm-hyphenation-' + tag + '"]';
const PATTERNS = require("../vscode-mdm/media/hyphenation-patterns.js");
// Word division on, as the menu leaves it once a language has been chosen.
const ON = { settings: { hyphenation: "auto" } };

async function wrapInsideWord(page) {
  return page.evaluate(() => {
    const v = window.__mdm.view, text = v.state.doc.toString();
    for (let at = 1; at < text.length; at++) {
      if (!/\p{L}/u.test(text[at - 1]) || !/\p{L}/u.test(text[at])) continue;
      const before = v.coordsAtPos(at - 1, 1), after = v.coordsAtPos(at, 1);
      if (before && after && after.top > before.top + 5) return at;
    }
    return null;
  });
}

// The menu as the reader finds it, opened and closed again by its button:
// each entry's tag, its label and whether the tick is on it.
async function menu(page) {
  await page.click(BUTTON);
  const entries = await page.$$eval('#app button[data-type^="mdm-hyphenation-"]', els => els.map(el => ({
    tag: el.getAttribute("data-type").slice("mdm-hyphenation-".length),
    label: el.childNodes[0].textContent,
    ticked: !!el.querySelector(".mdm-swatch__tick"),
  })));
  await page.click(BUTTON);
  return entries;
}
const ticked = entries => entries.filter(e => e.ticked).map(e => e.tag);
const marks = page => page.$$eval("#app .mdm-hyphen", els => els.length);
const lit = page => page.$eval(BUTTON, el => el.classList.contains("mdm-btn--on"));

test("the menu opens on no hyphenation, the default, and names each language in its own words", { skip }, async t => {
  const h = await open({ text: "---\nlang: es\n---\n\nUna representación extraordinariamente internacionalización.\n", scores: 0 });
  t.after(() => h.close());
  const entries = await menu(h.page);
  assert.deepEqual(entries.map(e => e.label), ["No hyphenation", "Deutsch", "English", "Español", "Français",
    "Italiano", "Nederlands", "Polski", "Português", "Русский", "Українська"]);
  assert.equal(entries[0].tag, "none");
  assert.deepEqual(entries.slice(1).map(e => e.tag).sort(), Object.keys(PATTERNS).sort(), "the menu and the patterns disagree");
  assert.deepEqual(ticked(entries), ["none"]);
  assert.equal(await marks(h.page), 0, "words divided before a language was chosen");
  // The tick says what is chosen, and the button lights while a language is
  // dividing the prose: dark on the default, lit once Spanish divides.
  assert.equal(await h.page.$eval(BUTTON, el => el.getAttribute("aria-label")), "Hyphenation");
  assert.equal(await lit(h.page), false, "the default lit the button");
  await postSettings(h.page, { hyphenation: "auto" });
  await h.page.waitForFunction(() => document.querySelector("#app .mdm-hyphen"));
  assert.deepEqual(ticked(await menu(h.page)), ["es"]);
  assert.equal(await lit(h.page), true, "a language dividing the prose left the button dark");
  assert.deepEqual(h.errors, []);
});

test("a language waits for the edit being typed, asks for its lang line, then turns division on", { skip }, async t => {
  const text = "The representation extraordinarily internationalization continues.\n";
  const h = await open({ text, scores: 0 });
  t.after(() => h.close());
  await setSelection(h.page, text.length - 1);
  await h.page.keyboard.type("X");
  // Both clicks in one go, well inside the 300 ms the edit waits for: the
  // edit reaches the host first only if the menu sends it on its way.
  await h.page.evaluate((button, entry) => {
    document.querySelector(button).click();
    document.querySelector(entry).click();
  }, BUTTON, ENTRY("es"));
  const posts = await h.page.evaluate(() => window.__posts
    .filter(m => ["edit", "setLanguage", "setSetting"].includes(m.type))
    .map(m => m.type === "edit" ? { type: "edit", text: m.text } : m));
  assert.deepEqual(posts, [
    { type: "edit", text: text.slice(0, -1) + "X\n" },
    { type: "setLanguage", lang: "es" },
    { type: "setSetting", key: "hyphenation", value: "auto" },
  ]);
  assert.deepEqual(h.errors, []);
});

test("the host's answer divides words in that language, and no hyphenation joins them again", { skip }, async t => {
  const prose = "Una representación extraordinariamente internacionalización continúa.\n";
  const h = await open({ text: prose, frontMatter: "", withFrontMatter: false, scores: 0, height: 500,
    seed: { settings: { frontMatter: "hidden" } } });
  t.after(() => h.close());
  await h.page.setViewport({ width: 340, height: 500 });
  await sleep(100);
  assert.equal(await wrapInsideWord(h.page), null, "a word was divided before a language was chosen");
  await h.page.click(BUTTON);
  await h.page.click(ENTRY("es"));
  // What the host does with that (extension-host.test.js): a header of its
  // own holding `lang: es`, sent back as an update, and the setting echoed.
  const header = "---\nlang: es\n---\n";
  await update(h.page, header + "\n" + prose, false, 0, header);
  await postSettings(h.page, { frontMatter: "hidden", hyphenation: "auto" });
  await h.page.waitForFunction(() => document.querySelector("#app .mdm-hyphen"));
  assert.equal(await docText(h.page), prose, "the hidden header reached the text the editor holds");
  assert.deepEqual(ticked(await menu(h.page)), ["es"]);
  assert.equal(await lit(h.page), true, "the button stayed dark with Spanish dividing");
  const at = await wrapInsideWord(h.page);
  assert.ok(at, "Spanish did not divide a word");
  await setSelection(h.page, at);
  await h.page.keyboard.type("X");
  assert.equal(await docText(h.page), prose.slice(0, at) + "X" + prose.slice(at));
  await h.page.evaluate(() => window.__mdm.CM.undo(window.__mdm.view));
  assert.equal(await docText(h.page), prose);
  await h.page.setViewport({ width: 1400, height: 500 });
  await sleep(150);
  assert.equal(await wrapInsideWord(h.page), null, "hyphens did not disappear when the line grew");
  await h.page.click(BUTTON);
  await h.page.click(ENTRY("none"));
  assert.deepEqual((await setSettingPosts(h.page)).pop(), { type: "setSetting", key: "hyphenation", value: "none" });
  assert.equal(await h.page.evaluate(() => window.__posts.filter(m => m.type === "setLanguage").length), 1,
    "no hyphenation wrote to the header");
  await postSettings(h.page, { frontMatter: "hidden", hyphenation: "none" });
  await h.page.waitForFunction(() => !document.querySelector("#app .mdm-hyphen"));
  assert.deepEqual(ticked(await menu(h.page)), ["none"]);
  assert.equal(await lit(h.page), false, "no hyphenation left the button lit");
  assert.equal(await docText(h.page), prose);
  assert.deepEqual(await selectionRanges(h.page), [[at, at]]);
  assert.deepEqual(h.errors, []);
});

for (const [lang, prose] of [
  ["en", "The representation extraordinarily internationalization continues."],
  ["es", "Una representación extraordinariamente internacionalización continúa."],
]) {
  test(lang + ": a divided word deletes across rows, copies and undoes without changing offsets", { skip }, async t => {
    const text = "---\nlang: " + lang + "\n---\n\n" + prose + "\n";
    const h = await open({ text, scores: 0, height: 500, seed: ON });
    t.after(() => h.close());
    await h.page.setViewport({ width: 340, height: 500 });
    await sleep(200);
    const at = await wrapInsideWord(h.page);
    assert.ok(at, "no word was divided");
    const original = await docText(h.page);
    await setSelection(h.page, at);
    await h.page.keyboard.press("Backspace");
    assert.equal(await docText(h.page), original.slice(0, at - 1) + original.slice(at));
    assert.deepEqual(await selectionRanges(h.page), [[at - 1, at - 1]]);
    await h.page.evaluate(() => window.__mdm.CM.undo(window.__mdm.view));
    assert.equal(await docText(h.page), original);
    await h.page.evaluate(() => window.__mdm.CM.redo(window.__mdm.view));
    assert.equal(await docText(h.page), original.slice(0, at - 1) + original.slice(at));
    await h.page.evaluate(() => window.__mdm.CM.undo(window.__mdm.view));

    // Delete backwards from the end of the wrapped word through its upper
    // fragment. Every keystroke removes one actual letter, including at the
    // point where the suffix fits back beside the prefix.
    let end = at;
    while (/\p{L}/u.test(original[end] || " ")) end++;
    await setSelection(h.page, end);
    let expected = original;
    for (let pos = end; pos > at - 3; pos--) {
      await h.page.keyboard.press("Backspace");
      expected = expected.slice(0, pos - 1) + expected.slice(pos);
      assert.equal(await docText(h.page), expected);
      assert.deepEqual(await selectionRanges(h.page), [[pos - 1, pos - 1]]);
      const gap = await h.page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const v = window.__mdm.view, caret = document.querySelector(".cm-cursor-primary, .cm-cursor");
        const actual = caret.getBoundingClientRect(), expected = v.coordsAtPos(v.state.selection.main.head);
        return { x: Math.abs(actual.left - expected.left), y: Math.abs(actual.top - expected.top) };
      });
      assert.ok(gap.x < 2 && gap.y < 2, "the drawn caret drifted from the text: " + JSON.stringify(gap));
    }
    await sleep(350);
    assert.equal(await lastEdit(h.page), expected, "saved text acquired a visual hyphen");
    await setSelection(h.page, [{ anchor: 0, head: expected.length }]);
    assert.equal(await h.page.evaluate(() => window.getSelection().toString()), expected);
    assert.deepEqual(h.errors, []);
  });
}

test("hyphens stay out of source, headings, formulas and destinations while prose remains editable", { skip }, async t => {
  const text = "---\nlang: es\ntitle: representación\n---\n\n# representación\n\n" +
    "Una **representación** y `representación` y $representacion$ [representación](https://example.com/representacion).\n\n" +
    "```text\nrepresentación\n```\n";
  const h = await open({ text, scores: 0, seed: ON });
  t.after(() => h.close());
  await setSelection(h.page, [{ anchor: 0, head: text.length }]);
  assert.equal(await h.page.$$eval(".mdm-code-line .mdm-hyphen, .mdm-fm-line .mdm-hyphen, .mdm-h .mdm-hyphen, .mdm-inline-code .mdm-hyphen, .mdm-math-src .mdm-hyphen", els => els.length), 0);
  assert.ok(await marks(h.page) > 0);
  assert.equal(await docText(h.page), text);
  assert.deepEqual(h.errors, []);
});

test("a hidden header selects Spanish, and an external language change recomputes the cuts and the tick", { skip }, async t => {
  const header = "---\nlang: es-CU\n---\n\n", prose = "Una representación extraordinariamente internacionalización.\n";
  const h = await open({ text: header + prose, frontMatter: header, withFrontMatter: false, scores: 0,
    seed: { settings: { frontMatter: "hidden", hyphenation: "auto" } } });
  t.after(() => h.close());
  assert.ok(await marks(h.page) > 0);
  assert.deepEqual(ticked(await menu(h.page)), ["es"], "a regional tag did not tick its language");
  assert.equal(await lit(h.page), true, "a regional tag left the button dark");
  assert.equal(await docText(h.page), prose);
  await update(h.page, header.replace("es-CU", "ja") + prose, false, 0, header.replace("es-CU", "ja"));
  assert.equal(await marks(h.page), 0, "an unsupported language borrowed Spanish cuts");
  assert.deepEqual(ticked(await menu(h.page)), ["none"], "a language without patterns did not tick no hyphenation");
  assert.equal(await lit(h.page), false, "a language without patterns lit the button");
  assert.equal(await docText(h.page), prose);
  assert.deepEqual(h.errors, []);
});

test("a lang typed into the header on screen moves the cuts and the tick at once", { skip }, async t => {
  const text = "---\nlang: en\n---\n\nUna representación extraordinariamente internacionalización continúa.\n";
  const h = await open({ text, scores: 0, seed: ON });
  t.after(() => h.close());
  assert.deepEqual(ticked(await menu(h.page)), ["en"]);
  const english = await marks(h.page);
  const at = text.indexOf("en\n");
  await h.page.evaluate(at => window.__mdm.view.dispatch({ changes: { from: at, to: at + 2, insert: "es" } }), at);
  await h.page.waitForFunction(before => document.querySelectorAll("#app .mdm-hyphen").length !== before, {}, english);
  assert.deepEqual(ticked(await menu(h.page)), ["es"]);
  assert.deepEqual(h.errors, []);
});

test("a header that names no language divides nothing and ticks nothing until one is named", { skip }, async t => {
  // Quarto would call this document English; the editor does not guess
  // (language() in mdm-hyphenation.js), and the export follows the editor
  // (exportHyphenation in extension.js, pinned in extension-host.test.js).
  const text = "---\ntitle: t\n---\n\nThe representation extraordinarily internationalization continues.\n";
  const h = await open({ text, scores: 0, seed: ON });
  t.after(() => h.close());
  assert.equal(await marks(h.page), 0, "a header naming no language was divided as English");
  assert.deepEqual(ticked(await menu(h.page)), ["none"], "a header naming no language did not tick no hyphenation");
  assert.equal(await lit(h.page), false, "the button lit with nothing divided");
  // A `lang:` typed on screen divides, ticks and lights at once.
  const at = text.indexOf("---\n\n");
  await h.page.evaluate(at => window.__mdm.view.dispatch({ changes: { from: at, insert: "lang: en\n" } }), at);
  await h.page.waitForFunction(() => document.querySelector("#app .mdm-hyphen"));
  assert.deepEqual(ticked(await menu(h.page)), ["en"]);
  assert.equal(await lit(h.page), true, "a lang typed on screen left the button dark");
  assert.deepEqual(h.errors, []);
});

// The file's header is the first one, and while the host keeps it out of the
// text a header at the top of the editor is a block typed below it: the
// language comes from the host's copy, which is the one the export reads
// (langOf in transforms.js). With a header holding only the language this is
// the header shown too, and a reader typing a title there got words whole in
// the editor while the export was told to divide them.
test("while the file's header is kept aside, a header typed in the text does not name the language", { skip }, async t => {
  const header = "---\nlang: es\n---\n\n", typed = "---\ntitle: t\n---\n\n";
  const prose = "Una representación extraordinariamente internacionalización continúa.\n";
  const h = await open({ text: header + typed + prose, frontMatter: header, withFrontMatter: false, scores: 0,
    seed: { settings: { frontMatter: "shown", hyphenation: "auto" } } });
  t.after(() => h.close());
  assert.equal(await docText(h.page), typed + prose);
  assert.ok(await marks(h.page) > 0, "the typed header took the language away");
  assert.deepEqual(ticked(await menu(h.page)), ["es"]);
  assert.equal(await lit(h.page), true);
  assert.deepEqual(h.errors, []);
});

test("Delete and multiple carets edit letters, and the default opens with words whole", { skip }, async t => {
  // Under a hidden header naming the language, since without one nothing
  // divides at all.
  const header = "---\nlang: en\n---\n\n", text = "The representation extraordinarily internationalization continues.\n";
  const h = await open({ text: header + text + text, frontMatter: header, withFrontMatter: false, scores: 0,
    seed: { settings: { frontMatter: "hidden" } } });
  t.after(() => h.close());
  assert.equal(await marks(h.page), 0, "the default divided words");
  assert.deepEqual(ticked(await menu(h.page)), ["none"]);
  await postSettings(h.page, { frontMatter: "hidden", hyphenation: "auto" });
  await h.page.waitForSelector(".mdm-hyphen");
  await h.page.setViewport({ width: 340, height: 600 });
  await sleep(100);
  const at = await wrapInsideWord(h.page);
  assert.ok(at);
  await setSelection(h.page, [{ anchor: at }, { anchor: text.length + at }]);
  await h.page.keyboard.press("Delete");
  const changed = text.slice(0, at) + text.slice(at + 1);
  assert.equal(await docText(h.page), changed + changed);
  await h.page.evaluate(() => window.__mdm.CM.undo(window.__mdm.view));
  assert.equal(await docText(h.page), text + text);
  assert.deepEqual(h.errors, []);
});
