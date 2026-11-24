// The zoom of the page (mdm.zoom, the Zoom section of main.js, --mdm-zoom in
// style.css): the size the editor draws the document at, in per cent of the
// size it is set at, 100 being the page an export prints. The owner's ask of
// 2026-11-16, with every decision of it left to the implementer:
//
//   - the whole page grows and shrinks together, the words with the width of
//     the column and the equations, the scores and the pictures with the
//     words, so a line ends on the same word at every zoom while the pane has
//     room for the column;
//   - what is the editor's keeps its size: the bar and its menus, the panels,
//     the numbers in the margin, the rail of a block, and the margin they
//     stand in;
//   - the keys are the ones VS Code zooms its window with, taken for the page
//     anywhere in the editor; Ctrl with the wheel steps it too, and the spot
//     under the pointer stays where it is;
//   - it is a setting of the editor's, written once a gesture has settled,
//     shown at the right end of the bar while it is not 100, and stepped
//     from the Zoom row of the Page menu;
//   - nothing of an export reads it (extension-host.test.js holds that);
//   - at 100 the page is set at 0.9 of the lengths the sheets name, what 90
//     drew until 2026-11-16 and the owner asked that day to be the size a
//     document opens at, called 100; the exported page is set at the same
//     factor, so 100 is still the page an export prints (html.test.js).
//
// Everything here is layout, so it is measured in a real browser.
//
// Run with: node --test --test-concurrency=1 tests/webview-zoom.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { frontMatter } = require("../vscode-mdm/transforms.js");
const {
  open,
  skip,
  posOf,
  setSelection,
  docText,
  postSettings,
  setSettingPosts,
  pressBar,
  barState,
  update,
} = require("./webview/helpers.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome's steps, which the editor zooms by (ZOOM_STEPS in main.js).
const STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];

// One of each thing the page is made of, and a picture from the folder the
// harness is told is the document's (the extension's own icon, 256px).
const PICTURES = "file://" + path.resolve(__dirname, "../vscode-mdm/media") + "/";
const ZOOM_DOC = [
  "---",
  'title: "Zoom"',
  'subtitle: "One page at two sizes"',
  "---",
  "",
  "# A heading",
  "",
  "A paragraph of prose with $x^2$ in it, long enough to take two rows at the widths these tests ask for, and some more words after them so that no width leaves it on one.",
  "",
  "- [ ] a task",
  "- [x] a task done",
  "",
  "> A quote on a line of its own.",
  "",
  "$$",
  "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
  "$$",
  "",
  "$$",
  "E = mc^2",
  "$$ {#eq-mass}",
  "",
  "::: {.callout-note}",
  "A note in a callout.",
  ":::",
  "",
  "***",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "| 3 | ![Cell](icon.png) |",
  "",
  "![Icon](icon.png)",
  "",
  "![Wide](icon.png){width=100}",
  "",
  "![Part](icon.png){width=30%}",
  "",
  "```python",
  "x = 1",
  "```",
  "",
  "```abc",
  "X:1",
  "T:Zoom",
  "M:4/4",
  "L:1/4",
  "K:C",
  "C D E F | G A B c |]",
  "```",
  "",
  "The end.",
  "",
].join("\n");

// A short score walked by the score mode (as in webview-score-mode.test.js).
const WALK_SOURCE = ["X:1", "T:Walk", "M:4/4", "L:1/4", "K:C", "C [EG] z x y A |", "B c d e |", "f g a b |]"].join("\n");
const WALK = ["# Walk", "", "Some prose to click on.", "", "```abc", WALK_SOURCE, "```", "", "The end.", ""].join("\n");

// The page at the zoom's 100, as a factor of the sheets' lengths (PAGE_AT in
// main.js).
const PAGE = 0.9;

// The zoom the page is drawn at: the factor on #app over the page's own,
// so that 1.1 is the step after 100 whatever the page is set at.
const zoomOf = (page) =>
  page.evaluate((at) => String(+(parseFloat(getComputedStyle(document.getElementById("app")).getPropertyValue("--mdm-zoom")) / at).toFixed(4)), PAGE);

// The writes of the zoom the webview asked the host for.
const zoomPosts = async (page) => (await setSettingPosts(page)).filter((m) => m.key === "zoom").map((m) => m.value);

// A key as a keyboard of another layout sends it, or the number pad's 0 with
// NumLock on, which puppeteer's own pad key has off (it names it Insert).
// `modifiers` is CDP's: Alt 1, Ctrl 2, Meta 4, Shift 8.
async function rawKey(page, key, code, vk, modifiers, location) {
  const cdp = await page.target().createCDPSession();
  const base = { key: key, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: modifiers, location: location || 0 };
  await cdp.send("Input.dispatchKeyEvent", Object.assign({ type: "rawKeyDown" }, base));
  await cdp.send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, base));
  await cdp.detach();
}

async function chord(page, mods, key) {
  for (const m of mods) await page.keyboard.down(m);
  await page.keyboard.press(key);
  for (const m of mods.slice().reverse()) await page.keyboard.up(m);
}

// VS Code's webview host hears every key and every wheel of the page on the
// window, in the bubble phase (handleInnerKeydown and handleWheel in the host
// page of 1.133.0); this stands in for it, after the page's own listeners.
function hearAsHost(page) {
  return page.evaluate(() => {
    window.__hostKeys = [];
    window.__hostWheels = 0;
    window.addEventListener("keydown", (e) => window.__hostKeys.push((e.ctrlKey ? "Ctrl+" : "") + (e.metaKey ? "Meta+" : "") + e.key));
    window.addEventListener("wheel", () => window.__hostWheels++);
  });
}
const hostKeys = (page) => page.evaluate(() => window.__hostKeys.filter((k) => !/^(Ctrl\+|Meta\+)*(Control|Meta|Shift)$/.test(k)));

// The sizes of the page and of the chrome, read the same way at any zoom.
const SIZES = () => {
  const q = (s) => document.querySelector(s);
  const css = (s) => getComputedStyle(q(s));
  const box = (s) => q(s).getBoundingClientRect();
  const lines = Array.from(q("#app code.language-abc svg g.abcjs-staff").children)
    .map((l) => {
      const r = l.getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    })
    .sort((a, b) => a - b);
  return {
    page: {
      prose: parseFloat(css("#app .cm-scroller").fontSize),
      column: box("#app .cm-content").width,
      over: parseFloat(css("#app .cm-content").paddingTop),
      heading: parseFloat(css("#app .cm-line.mdm-h1").fontSize),
      maths: parseFloat(css("#app .cm-line .katex").fontSize),
      display: box("#app .mdm-math--block .katex-display").height,
      title: parseFloat(css("#app .mdm-title").fontSize),
      subtitle: parseFloat(css("#app .mdm-subtitle").fontSize),
      underTitle: parseFloat(css("#app .mdm-title-block").paddingBottom),
      number: parseFloat(css("#app .mdm-eq-number").fontSize),
      callout: parseFloat(css("#app .mdm-co-line").paddingRight),
      rule: parseFloat(css("#app .mdm-hr").height),
      task: box("#app .mdm-task").width,
      quote: parseFloat(css("#app .cm-line.mdm-quote").borderLeftWidth),
      cell: box("#app .mdm-table tbody tr:first-child td").height,
      code: parseFloat(css("#app .cm-line.mdm-code-line").fontSize),
      picture: box('#app img.mdm-image[alt="Icon"]').width,
      wide: box('#app img.mdm-image[alt="Wide"]').width,
      inCell: box('#app .mdm-table img.mdm-image[alt="Cell"]').width,
      part: box('#app img.mdm-image[alt="Part"]').width / box("#app .cm-content").width,
      score: box("#app code.language-abc svg").width,
      staff: (lines[lines.length - 1] - lines[0]) / 4,
    },
    chrome: {
      bar: box("#app .mdm-toolbar").height,
      word: css("#app .mdm-word").fontSize,
      number: getComputedStyle(q("#app .cm-line[data-mdm-line]"), "::before").fontSize,
      margin: css("#app .cm-scroller").paddingLeft,
      rail: box("#app .mdm-chrome .mdm-copy").width,
    },
  };
};

async function zoomDoc(zoom) {
  const h = await open({
    text: ZOOM_DOC,
    scores: 1,
    withFrontMatter: false,
    frontMatter: frontMatter(ZOOM_DOC),
    seed: { docBase: PICTURES, settings: zoom ? { zoom: zoom } : {} },
  });
  await h.page.setViewport({ width: 1500, height: 2600 });
  await h.page.waitForFunction(() => {
    const imgs = document.querySelectorAll("#app img.mdm-image");
    return imgs.length === 4 && Array.from(imgs).every((img) => img.complete && img.naturalWidth > 0);
  });
  await sleep(300);
  return h;
}

test("at 100% the page is set at 0.9 of the sheet's lengths, and 100 is what a document opens at (ZM01)", { skip }, async () => {
  const h = await zoomDoc(null);
  const seen = await h.page.evaluate(() => ({
    zoom: getComputedStyle(document.getElementById("app")).getPropertyValue("--mdm-zoom").trim(),
    zoomed: document.getElementById("app").classList.contains("mdm-zoomed"),
    reading: document.querySelector('#app button[data-type="zoom-reading"]').getClientRects().length,
    svg: (() => {
      const svg = document.querySelector("#app code.language-abc svg");
      return [svg.getBoundingClientRect().width, parseFloat(svg.getAttribute("width"))];
    })(),
  }));
  assert.equal(seen.zoom, "0.9");
  assert.equal(seen.zoomed, false);
  assert.equal(seen.reading, 0, "the reading of the zoom is drawn at 100");
  // The score at 0.9 of the size it is engraved at, which is the size the
  // page prints it at (html.test.js holds the two surfaces together at 100).
  assert.ok(Math.abs(seen.svg[0] - PAGE * seen.svg[1]) < 0.01, "the score is drawn " + seen.svg[0] + " wide for " + seen.svg[1]);
  const s = await h.page.evaluate(SIZES);
  // The lengths the sheet names, at 0.9; the air over the first line in
  // whole pixels (ZM02 says why), a border in whole pixels too.
  const near = (key, named, within) => assert.ok(Math.abs(s.page[key] - PAGE * named) <= (within || 0.02), key + " is " + s.page[key] + " for " + PAGE * named);
  near("prose", 16);
  near("column", 820);
  assert.equal(s.page.over, Math.round(PAGE * 18));
  near("subtitle", 21.25);
  near("task", 13);
  // A quote's level is a whole number of pixels (--mdm-frame-step), 15.
  assert.equal(s.page.quote, Math.round(17 * PAGE), "the quote's level is " + s.page.quote);
  near("picture", 256);
  near("wide", 100);
  near("inCell", 256);
  assert.ok(Math.abs(s.page.part - 0.3) < 0.002, "a picture of 30% is " + s.page.part + " of the column");
  near("underTitle", 17);
  near("number", 16);
  near("callout", 10);
  near("rule", 2);
  near("score", 740, 0.1);
  assert.deepEqual(s.chrome, { bar: 35, word: "13px", number: "11px", margin: "50px", rail: 24 });
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("at a zoom the whole page grows by it, and the bar, the numbers, the rail and the margin keep their size (ZM02)", { skip }, async () => {
  const h = await zoomDoc(null);
  const at100 = await h.page.evaluate(SIZES);
  await postSettings(h.page, { zoom: 150 });
  await sleep(400);
  const at150 = await h.page.evaluate(SIZES);
  // What is laid out in the sheet's lengths, exactly half again.
  for (const key of ["prose", "column", "over", "heading", "maths", "title", "subtitle", "underTitle", "number", "callout", "rule", "task", "code", "picture", "wide", "inCell", "score"]) {
    assert.ok(Math.abs(at150.page[key] - 1.5 * at100.page[key]) < 0.02, key + ": " + at100.page[key] + " went to " + at150.page[key]);
  }
  // What is drawn: the staff's spacing, the display equation's box and a
  // row of the table, which carry a hairline or a pixel the browser rounds.
  assert.ok(Math.abs(at150.page.staff - 1.5 * at100.page.staff) < 0.1, "staff: " + at100.page.staff + " went to " + at150.page.staff);
  assert.ok(Math.abs(at150.page.display - 1.5 * at100.page.display) < 2, "display: " + at100.page.display + " went to " + at150.page.display);
  assert.ok(Math.abs(at150.page.cell - 1.5 * at100.page.cell) < 1.5, "cell: " + at100.page.cell + " went to " + at150.page.cell);
  // A width in per cent is of the column, which the zoom has sized already:
  // it is the same share of it, and not zoomed twice.
  assert.ok(Math.abs(at150.page.part - at100.page.part) < 0.002, "a picture of 30% is " + at150.page.part + " of the column at 150%");
  // A border is drawn in whole pixels: the quote's inset is 25 for 25.5.
  assert.ok(Math.abs(at150.page.quote - 1.5 * at100.page.quote) <= 1, "quote: " + at100.page.quote + " went to " + at150.page.quote);
  assert.deepEqual(at150.chrome, at100.chrome, "the chrome moved with the page");
  // The table whose cell holds a picture is as tall in CodeMirror's heights
  // as it is drawn: the picture grows the cell when its file is in, and the
  // heights are read again then (a gap older than the zoom).
  const table = await h.page.evaluate(() => {
    const v = window.__mdm.view;
    const el = document.querySelector("#app .mdm-table");
    return { map: v.lineBlockAt(v.posAtDOM(el)).height, dom: el.getBoundingClientRect().height };
  });
  assert.ok(Math.abs(table.map - table.dom) <= 1, "CodeMirror holds the table at " + table.map + " where it is drawn at " + table.dom);
  // The air over the first line in whole pixels, which is what CodeMirror
  // reads it as (parseInt): 17.82px at 110% would be taken for 17.
  await postSettings(h.page, { zoom: 110 });
  await sleep(200);
  assert.equal(await h.page.evaluate(() => getComputedStyle(document.querySelector("#app .cm-content")).paddingTop), "18px");
  // An engine without round() reads the declaration outside the @supports,
  // which zooms the air to the fraction. The rounding rule is taken out of
  // the sheet to see it, as such an engine never reads it.
  const unrounded = await h.page.evaluate(() => {
    let taken = 0;
    for (const sheet of document.styleSheets) {
      let rules = [];
      try {
        rules = sheet.cssRules;
      } catch (e) {
        continue;
      }
      for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (rule instanceof CSSSupportsRule && /round\(/.test(rule.conditionText) && /\.cm-content[^{]*\{[^}]*padding-top/.test(rule.cssText)) {
          sheet.deleteRule(i);
          taken++;
        }
      }
    }
    return { taken: taken, air: getComputedStyle(document.querySelector("#app .cm-content")).paddingTop };
  });
  assert.equal(unrounded.taken, 1, "the rounding rule was not found, so this reads nothing");
  assert.equal(unrounded.air, "17.82px");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a line ends on the same word at every step of the zoom, in both faces (ZM03)", { skip }, async () => {
  const ENDS = () => {
    const out = {};
    document.querySelectorAll("#app .cm-line").forEach((el) => {
      if (el.matches(".mdm-h, .mdm-src-line, .mdm-code-line, .mdm-fm-line, .mdm-math-line, .mdm-table-line")) return;
      const cs = getComputedStyle(el);
      const half = (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2) / 2;
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const ends = [];
      let top = null;
      let text = "";
      let n;
      while ((n = walk.nextNode())) {
        if (n.parentElement.closest(".katex")) continue;
        for (let i = 0; i < n.data.length; i++) {
          const rg = document.createRange();
          rg.setStart(n, i);
          rg.setEnd(n, i + 1);
          const rect = rg.getClientRects()[0];
          if (rect && top !== null && rect.top > top + half) ends.push((text.match(/(\S+)\s*$/) || ["", ""])[1]);
          if (rect) top = rect.top;
          text += n.data[i];
        }
      }
      if (text.length > 40) out[text.slice(0, 30)] = ends;
    });
    return out;
  };
  for (const [face, steps] of [
    ["roman", STEPS],
    ["sans", [75, 150, 250]],
  ]) {
    const h = await open({ scores: 1, seed: { settings: { frontMatter: "hidden", textFont: face } } });
    const at = {};
    for (const zoom of [100].concat(steps.filter((z) => z !== 100))) {
      // A pane with room for the column at that zoom, its margins, and some.
      await h.page.setViewport({ width: Math.ceil((820 * PAGE * zoom) / 100 + 100) + 40, height: 5000 });
      await postSettings(h.page, { frontMatter: "hidden", textFont: face, zoom: zoom });
      await sleep(400);
      at[zoom] = await h.page.evaluate(ENDS);
      const rows = Object.values(at[zoom]).reduce((n, e) => n + e.length, 0);
      assert.ok(rows >= 5, face + " at " + zoom + ": too few rows to read (" + rows + ")");
    }
    const parted = [];
    for (const zoom of steps) {
      let compared = 0;
      for (const key of Object.keys(at[zoom])) {
        if (!at[100][key]) continue;
        compared++;
        if (at[zoom][key].join("|") !== at[100][key].join("|")) parted.push(face + " " + zoom + "% " + JSON.stringify(key) + ": " + at[zoom][key].join("|") + " against " + at[100][key].join("|"));
      }
      assert.ok(compared >= 5, face + " at " + zoom + ": " + compared + " paragraphs compared");
    }
    assert.deepEqual(parted, []);
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

test("the zoom's keys step it anywhere in the editor, are kept from VS Code, and leave Ctrl+0 to the paragraph (ZM04)", { skip }, async () => {
  const h = await open({ text: "# A heading\n\nSome prose to read.\n", scores: 0 });
  await h.page.setViewport({ width: 1300, height: 800 });
  await hearAsHost(h.page);
  // The document opens with nobody in it: the keys are the page's all the
  // same.
  const steps = [
    [() => chord(h.page, ["Control"], "Equal"), "1.1", "Ctrl+="],
    [() => chord(h.page, ["Control", "Shift"], "Equal"), "1.25", "Ctrl++ on a keyboard whose + is over its ="],
    [() => rawKey(h.page, "+", "BracketRight", 187, 2), "1.5", "Ctrl++ on a keyboard with a + of its own (Spanish)"],
    [() => chord(h.page, ["Control"], "NumpadAdd"), "1.75", "Ctrl with the pad's +"],
    [() => chord(h.page, ["Control"], "Minus"), "1.5", "Ctrl+-"],
    [() => rawKey(h.page, "-", "Slash", 189, 2), "1.25", "Ctrl+- on a Spanish keyboard"],
    [() => chord(h.page, ["Control"], "NumpadSubtract"), "1.1", "Ctrl with the pad's -"],
    [() => rawKey(h.page, "0", "Numpad0", 96, 2, 3), "1", "Ctrl with the pad's 0"],
  ];
  for (const [press, zoom, what] of steps) {
    await press();
    await sleep(80);
    assert.equal(await zoomOf(h.page), zoom, what);
  }
  assert.deepEqual(await hostKeys(h.page), [], "a key of the zoom reached VS Code");
  // What is not the zoom's goes on to VS Code: Ctrl+Shift+- (Go Forward on
  // Linux), and the pad's 0 with NumLock off, which is Ctrl+Insert, a copy.
  await chord(h.page, ["Control", "Shift"], "Minus");
  await chord(h.page, ["Control"], "Numpad0");
  await sleep(80);
  assert.equal(await zoomOf(h.page), "1");
  assert.deepEqual(await hostKeys(h.page), ["Ctrl+_", "Ctrl+Insert"]);
  // Ctrl+0 with the caret in the text is a paragraph's, as it was, and a
  // key of the row of digits is a level's whatever it writes: the 6 of a
  // French board writes -, and Ctrl with it is a heading of the sixth level,
  // not a step out. With Shift it is no level's, and the = a Spanish board
  // writes on its 0 is the zoom's.
  await setSelection(h.page, 4);
  await chord(h.page, ["Control"], "Digit0");
  await sleep(150);
  assert.equal((await docText(h.page)).split("\n")[0], "A heading", "Ctrl+0 did not make the heading a paragraph");
  assert.equal(await zoomOf(h.page), "1", "Ctrl+0 zoomed");
  await rawKey(h.page, "-", "Digit6", 54, 2);
  await sleep(150);
  assert.equal((await docText(h.page)).split("\n")[0], "###### A heading", "the 6 of a French board did not set the sixth level");
  assert.equal(await zoomOf(h.page), "1", "the 6 of a French board zoomed");
  await rawKey(h.page, "=", "Digit0", 48, 2 + 8);
  await sleep(150);
  assert.equal(await zoomOf(h.page), "1.1", "Ctrl+Shift+0, = on a Spanish board, did not zoom");
  await rawKey(h.page, "0", "Numpad0", 96, 2, 3);
  await sleep(150);
  assert.equal(await zoomOf(h.page), "1");
  // From a zoom between two steps, as settings.json may hold one, a key goes
  // to the next step on its side. The host's answer to the last write comes
  // first each time: until it comes, a zoom stored elsewhere is taken for
  // one from before the write (takeZoom).
  await sleep(500);
  await postSettings(h.page, { zoom: 100 });
  await postSettings(h.page, { zoom: 137 });
  await sleep(80);
  assert.equal(await zoomOf(h.page), "1.37");
  await chord(h.page, ["Control"], "Equal");
  await sleep(500);
  assert.equal(await zoomOf(h.page), "1.5");
  await postSettings(h.page, { zoom: 150 });
  await postSettings(h.page, { zoom: 137 });
  await sleep(80);
  await chord(h.page, ["Control"], "Minus");
  await sleep(500);
  assert.equal(await zoomOf(h.page), "1.25");
  await postSettings(h.page, { zoom: 125 });
  // At the end of the band a key goes nowhere, and nothing is written.
  await postSettings(h.page, { zoom: 300 });
  await sleep(600);
  const before = (await zoomPosts(h.page)).length;
  await chord(h.page, ["Control"], "Equal");
  await sleep(600);
  assert.equal(await zoomOf(h.page), "3");
  assert.equal((await zoomPosts(h.page)).length, before, "a step past the end was written");
  assert.deepEqual(h.errors, []);
  await h.close();

  // On a Mac the keys are Cmd's, as VS Code's own are there: Cmd with the
  // pad's 0 is 100, and Cmd+0 stays VS Code's Focus Side Bar; Shift with
  // the minus is out, as VS Code binds it there; Ctrl+= is not the zoom's.
  const mac = await open({ text: "Some prose to read.\n", scores: 0, platform: "MacIntel" });
  await hearAsHost(mac.page);
  await chord(mac.page, ["Meta"], "Equal");
  await sleep(80);
  assert.equal(await zoomOf(mac.page), "1.1");
  await chord(mac.page, ["Meta"], "Digit0");
  await sleep(80);
  assert.equal(await zoomOf(mac.page), "1.1", "Cmd+0 was taken from VS Code");
  await rawKey(mac.page, "0", "Numpad0", 96, 4, 3);
  await sleep(80);
  assert.equal(await zoomOf(mac.page), "1");
  await chord(mac.page, ["Meta", "Shift"], "Minus");
  await sleep(80);
  assert.equal(await zoomOf(mac.page), "0.9");
  await chord(mac.page, ["Control"], "Equal");
  await sleep(80);
  assert.equal(await zoomOf(mac.page), "0.9");
  assert.deepEqual(await hostKeys(mac.page), ["Meta+0", "Ctrl+="]);
  assert.deepEqual(mac.errors, []);
  await mac.close();

  // On Windows Ctrl+Shift+- is VS Code's second way out, and the page's
  // here; on Linux it is VS Code's Go Forward and is left to it (above).
  const win = await open({ text: "Some prose to read.\n", scores: 0, platform: "Win32" });
  await hearAsHost(win.page);
  await chord(win.page, ["Control", "Shift"], "Minus");
  await sleep(80);
  assert.equal(await zoomOf(win.page), "0.9");
  assert.deepEqual(await hostKeys(win.page), []);
  assert.deepEqual(win.errors, []);
  await win.close();
});

test("Ctrl with the wheel steps the zoom, a pinch by how far it turns, the spot under the pointer staying put, and the wheel alone scrolls (ZM05)", { skip }, async () => {
  const h = await open({ scores: 1, seed: { settings: { frontMatter: "hidden" } } });
  await h.page.setViewport({ width: 1300, height: 700 });
  await sleep(200);
  await hearAsHost(h.page);
  await h.page.evaluate(() => {
    window.__mdm.view.scrollDOM.scrollTop = 900;
  });
  await sleep(200);
  // The spot under the pointer, as a point of the page: the block it is in
  // (a paragraph, a score) and how far down that block it stands, a share
  // of it, since the whole block grows with the zoom.
  const spot = { x: 650, y: 400 };
  const where = await h.page.evaluate((y) => {
    const v = window.__mdm.view;
    const block = v.lineBlockAtHeight(y - v.documentTop);
    return { from: block.from, share: (y - v.documentTop - block.top) / block.height };
  }, spot.y);
  await h.page.mouse.move(spot.x, spot.y);
  await h.page.keyboard.down("Control");
  await h.page.mouse.wheel({ deltaY: -100 });
  await sleep(150);
  assert.equal(await zoomOf(h.page), "1.1", "a notch of the wheel with Ctrl");
  const held = await h.page.evaluate((w) => {
    const v = window.__mdm.view;
    const block = v.lineBlockAt(w.from);
    return v.documentTop + block.top + w.share * block.height;
  }, where);
  assert.ok(Math.abs(held - spot.y) < 1.5, "the spot under the pointer moved " + (held - spot.y) + "px");
  await h.page.mouse.wheel({ deltaY: 100 });
  await sleep(150);
  assert.equal(await zoomOf(h.page), "1");
  // A pinch: small turns, a step once they come to 40 pixels.
  for (let i = 0; i < 9; i++) {
    await h.page.mouse.wheel({ deltaY: -4 });
    await sleep(15);
  }
  assert.equal(await zoomOf(h.page), "1", "a step for less than 40 pixels of pinch");
  for (let i = 0; i < 3; i++) {
    await h.page.mouse.wheel({ deltaY: -4 });
    await sleep(15);
  }
  assert.equal(await zoomOf(h.page), "1.1", "no step for 48 pixels of pinch");
  await h.page.keyboard.up("Control");
  // The wheel alone scrolls the page and zooms nothing.
  const top = await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop);
  await h.page.mouse.wheel({ deltaY: 200 });
  await sleep(300);
  assert.equal(await zoomOf(h.page), "1.1");
  assert.ok((await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop)) > top, "the wheel alone did not scroll");
  // VS Code heard the plain wheel and none of the zoom's.
  assert.equal(await h.page.evaluate(() => window.__hostWheels), 1);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a zoom is written once its gesture settles, and an answer behind the hand does not take the page back (ZM06)", { skip }, async () => {
  const h = await open({ text: "Some prose to read.\n", scores: 0 });
  await h.page.setViewport({ width: 1300, height: 800 });
  // Three presses a little apart, as a hand makes them: each further apart
  // than a page takes to run a timer, and nearer than the gesture settles.
  for (let i = 0; i < 3; i++) {
    await chord(h.page, ["Control"], "Equal");
    await sleep(120);
  }
  assert.equal(await zoomOf(h.page), "1.5");
  assert.deepEqual(await zoomPosts(h.page), [], "a step of the gesture was written before it settled");
  await sleep(600);
  assert.deepEqual(await zoomPosts(h.page), [150], "the gesture was not written once, with where it ended");
  // A settings message sent for anything else carries the zoom stored
  // before the ask: while a gesture settles, and while its answer is on its
  // way, the page stays where the hand put it.
  await chord(h.page, ["Control"], "Equal");
  await postSettings(h.page, { zoom: 150 });
  await sleep(50);
  assert.equal(await zoomOf(h.page), "1.75", "an answer put the page back under a gesture still settling");
  await sleep(600);
  assert.deepEqual(await zoomPosts(h.page), [150, 175]);
  await postSettings(h.page, { zoom: 150 });
  await sleep(50);
  assert.equal(await zoomOf(h.page), "1.75", "an answer from before the ask put the page back");
  // Its own answer, and then a zoom written by another editor or by hand.
  await postSettings(h.page, { zoom: 175 });
  await postSettings(h.page, { zoom: 200 });
  await sleep(100);
  assert.equal(await zoomOf(h.page), "2", "a zoom stored elsewhere did not reach the page");
  assert.equal((await barState(h.page, "zoom-reading")).name, "200%");
  // An answer that never comes: past its time the page follows what is
  // stored (a settings.json that cannot be written).
  await chord(h.page, ["Control"], "Minus");
  await sleep(600);
  await postSettings(h.page, { zoom: 200 });
  await sleep(50);
  assert.equal(await zoomOf(h.page), "1.75");
  await sleep(3100);
  await postSettings(h.page, { zoom: 200 });
  await sleep(100);
  assert.equal(await zoomOf(h.page), "2", "the page held a zoom the host never stored");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the Zoom row of the Page menu and the reading at the end of the bar step and show the zoom (ZM07)", { skip }, async () => {
  const h = await open({ text: "Some prose to read.\n", scores: 0 });
  await h.page.setViewport({ width: 1200, height: 800 });
  const reading = () =>
    h.page.evaluate(() => {
      const bar = document.querySelector("#app .mdm-toolbar");
      const word = bar.querySelector('button[data-type="zoom-reading"]');
      const exp = bar.querySelector('button[data-type="menu-export"]');
      const r = word.getBoundingClientRect();
      return {
        drawn: word.getClientRects().length > 0,
        text: word.textContent,
        right: Math.round(bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight) - r.right),
        row: Math.round(r.top) === Math.round(exp.getBoundingClientRect().top),
        after: r.left > exp.getBoundingClientRect().right,
      };
    });
  assert.equal((await reading()).drawn, false, "the reading is drawn at 100");
  const row = async (name) => {
    const s = await barState(h.page, name);
    return [s.under, s.name, s.key, s.on, s.off];
  };
  assert.deepEqual(await row("mdm-zoom"), ["menu-page", "Zoom", null, false, false]);
  assert.deepEqual(await row("zoom-in"), ["menu-page", "Zoom in", "Ctrl++", false, false]);
  assert.deepEqual(await row("zoom-out"), ["menu-page", "Zoom out", "Ctrl+-", false, false]);
  assert.deepEqual(await row("zoom-actual"), ["menu-page", "Actual size", "Ctrl+NumPad0", false, true], "back to 100 is not greyed at 100");
  assert.deepEqual(await row("zoom-100"), ["menu-page", "100%", null, true, false]);
  // A step pressed where a hand reaches it: Page, Zoom, the step.
  await pressBar(h.page, "zoom-150");
  await sleep(150);
  assert.equal(await zoomOf(h.page), "1.5");
  assert.deepEqual(await row("zoom-150"), ["menu-page", "150%", null, true, false]);
  assert.equal((await barState(h.page, "zoom-100")).on, false);
  assert.equal((await barState(h.page, "zoom-actual")).off, false);
  // The reading, at the right end of the row, after Export and on its line.
  assert.deepEqual(await reading(), { drawn: true, text: "150%", right: 0, row: true, after: true });
  await sleep(500);
  assert.deepEqual(await zoomPosts(h.page), [150]);
  // Its own menu holds the zoom's rows, the same as the Page menu's.
  await h.page.click('#app .mdm-toolbar button[data-type="zoom-reading"]');
  await sleep(150);
  const rows = await h.page.evaluate(() => {
    const names = (panel) => Array.from(panel.children).map((el) => (el.classList.contains("mdm-menu__rule") ? "|" : el.getAttribute("data-type")));
    return {
      own: names(document.querySelector("#app .mdm-toolbar__item--open > .mdm-menu")),
      page: names(document.querySelector('#app button[data-type="mdm-zoom"]').parentNode.querySelector(":scope > .mdm-menu")),
    };
  });
  assert.deepEqual(rows.own, ["zoom-in", "zoom-out", "zoom-actual", "|"].concat(STEPS.map((s) => "zoom-" + s)));
  assert.deepEqual(rows.own, rows.page);
  // Its Actual size: back to 100, which the reading says for a moment
  // before it goes (ZM15).
  await h.page.click('#app .mdm-toolbar__item--open button[data-type="zoom-actual"]');
  await sleep(150);
  assert.equal(await zoomOf(h.page), "1");
  assert.equal((await reading()).text, "100%");
  assert.equal((await reading()).drawn, true, "the reading went as the zoom came back to 100");
  await sleep(1600);
  assert.equal((await reading()).drawn, false, "the reading stayed at 100");
  // The ends of the band grey the step that has nowhere to go: after the
  // host's answer to the last write, as at ZM04.
  await sleep(500);
  await postSettings(h.page, { zoom: 100 });
  await postSettings(h.page, { zoom: 300 });
  await sleep(100);
  assert.equal((await barState(h.page, "zoom-in")).off, true);
  await postSettings(h.page, { zoom: 50 });
  await sleep(100);
  assert.equal((await barState(h.page, "zoom-out")).off, true);
  assert.equal((await barState(h.page, "zoom-in")).off, false);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a zoom from the keys holds the line the reader is at, at the top of the pane (ZM08)", { skip }, async () => {
  const h = await open({ scores: 1, seed: { settings: { frontMatter: "hidden" } } });
  await h.page.setViewport({ width: 1300, height: 700 });
  await sleep(200);
  // At the very top a zoom leaves the page at its top. The air over the
  // first line grows with the page, and held by that line the page was left
  // scrolled into it, 18px a step of a hundred (the second reading).
  for (const key of ["Equal", "Equal", "Minus", "Minus"]) {
    await chord(h.page, ["Control"], key);
    await sleep(120);
    assert.equal(await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop), 0, "a zoom at the top left the page scrolled");
  }
  await sleep(500);
  await postSettings(h.page, { frontMatter: "hidden", zoom: 100 });
  await h.page.evaluate(() => {
    window.__mdm.view.scrollDOM.scrollTop = 900;
  });
  await sleep(200);
  // The block at the top of the pane, and how far into it the top stands.
  const top = () =>
    h.page.evaluate(() => {
      const v = window.__mdm.view;
      const pane = v.scrollDOM.getBoundingClientRect().top;
      const block = v.lineBlockAtHeight(pane - v.documentTop);
      return { from: block.from, into: pane - (v.documentTop + block.top), height: block.height };
    });
  const before = await top();
  for (const [key, factor] of [
    ["Equal", 1.1],
    ["Equal", 1.25],
    ["Minus", 1.1],
  ]) {
    await chord(h.page, ["Control"], key);
    await sleep(150);
    const after = await top();
    assert.equal(after.from, before.from, "another line is at the top of the pane at " + factor);
    assert.ok(Math.abs(after.into - before.into * factor) < 1.5, "the line moved under the top of the pane: " + before.into + " to " + after.into + " at " + factor);
  }
  // In a pane just wide enough for the bar at 100, the reading of the zoom
  // takes the bar into a second row, and the pane starts that much lower:
  // the line at its top is the line at its new top. Back at 100 by the
  // pad's 0, and past the moment the reading stays up after it (ZM15).
  await rawKey(h.page, "0", "Numpad0", 96, 2, 3);
  await sleep(1700);
  await postSettings(h.page, { frontMatter: "hidden", zoom: 100 });
  const snug = await h.page.evaluate(() => {
    const bar = document.querySelector("#app .mdm-toolbar");
    const exp = bar.querySelector('button[data-type="menu-export"]').getBoundingClientRect();
    return Math.ceil(exp.right + parseFloat(getComputedStyle(bar).paddingRight) + 12);
  });
  await h.page.setViewport({ width: snug, height: 700 });
  await sleep(300);
  // A score 40px into the top of the pane: in a pane this narrow the column
  // is the pane's and not the zoom's, so prose rewraps as it grows and only
  // a drawing keeps its share (the page at 0.9 put a paragraph where the
  // first score had been at 900px).
  await h.page.evaluate(() => {
    const v = window.__mdm.view;
    const score = document.querySelector("#app .mdm-score");
    v.scrollDOM.scrollTop = v.lineBlockAt(v.posAtDOM(score)).top + 40;
  });
  await sleep(200);
  const bar = () => h.page.evaluate(() => document.querySelector("#app .mdm-toolbar").getBoundingClientRect().height);
  const one = await bar();
  const was = await top();
  await chord(h.page, ["Control"], "Equal");
  await sleep(200);
  assert.ok((await bar()) > one + 20, "the reading did not take the bar into a second row at " + snug + "px, so this reads nothing");
  const now = await top();
  assert.equal(now.from, was.from, "another line is at the top of the pane once the bar took a second row");
  assert.ok(Math.abs(now.into - was.into * 1.1) < 1.5, "the line at the top moved: " + was.into + " to " + now.into);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("under the score mode a click at a zoom puts the cursor on the note under it, the line's ends stand at the staff's, and the mode keeps its keys (ZM09)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1, seed: { settings: { zoom: 150 } } });
  await h.page.setViewport({ width: 1500, height: 1400 });
  await sleep(300);
  await pressBar(h.page, "mdm-score-navigation");
  await h.page.mouse.move(1400, 15);
  await sleep(200);
  const geometry = () =>
    h.page.evaluate(() => {
      const svg = document.querySelector("#app .mdm-score code.language-abc svg");
      const heads = Array.from(svg.querySelectorAll(".abcjs-notehead")).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
      });
      const staves = Array.from(svg.querySelectorAll("g.abcjs-staff")).map((staff) => {
        const ys = Array.from(staff.children).map((l) => {
          const r = l.getBoundingClientRect();
          return (r.top + r.bottom) / 2;
        });
        const b = staff.getBoundingClientRect();
        return { top: Math.min(...ys), bottom: Math.max(...ys), left: b.left, right: b.right };
      });
      return { heads, staves };
    });
  const { heads, staves } = await geometry();
  // The staff at half again its spacing at 100 (7.75px of the engraving, at
  // the page's 0.9 there).
  assert.ok(Math.abs((staves[0].bottom - staves[0].top) / 4 - 7.75 * 1.5 * PAGE) < 0.1, "the staff is not drawn at the zoom");
  const stepAt = (s, step) => s.bottom - ((step - 2) * (s.bottom - s.top)) / 8;
  const cursor = () =>
    h.page.evaluate(() => {
      const g = document.querySelector("#app .mdm-score-cursor");
      const beat = g.querySelector(".mdm-score-cursor__beat").getBoundingClientRect();
      const box = g.querySelector(".mdm-score-cursor__step").getBoundingClientRect();
      return { step: Number(g.getAttribute("data-mdm-step")), x: (beat.left + beat.right) / 2, stepY: (box.top + box.bottom) / 2 };
    });
  // The A on the middle line, then the B under the second staff.
  for (const [i, staff, step] of [
    [3, 0, 6],
    [4, 1, 1],
  ]) {
    await h.page.mouse.click(heads[i].x, stepAt(staves[staff], step));
    await sleep(150);
    const c = await cursor();
    assert.equal(c.step, step, "head " + i);
    assert.ok(Math.abs(c.x - heads[i].x) < 1, "the cursor stands " + (c.x - heads[i].x) + "px off head " + i);
    assert.ok(Math.abs(c.stepY - stepAt(staves[staff], step)) < 1, "the cursor's step is off its height at head " + i);
    await sleep(600);
  }
  // Past the ink of the drawing the cursor is given the room a note there
  // would have (roomForScoreCursor), which makes the drawing taller: the box
  // it is laid out in grows with it, at the zoom, and the staff keeps its
  // size (setDrawingBox).
  await h.page.mouse.click(heads[8].x, heads[8].y);
  await sleep(150);
  for (let i = 0; i < 14; i++) await h.page.keyboard.press("ArrowDown");
  await sleep(300);
  const room = await h.page.evaluate(() => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    const box = svg.viewBox.baseVal;
    const lines = Array.from(svg.querySelector("g.abcjs-staff").children).map((l) => {
      const r = l.getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    });
    return {
      made: svg.hasAttribute("data-mdm-room"),
      scale: svg.getBoundingClientRect().height / box.height,
      across: svg.getBoundingClientRect().width / box.width,
      staff: (Math.max(...lines) - Math.min(...lines)) / 4,
    };
  });
  assert.equal(room.made, true, "no room was made, so this reads nothing");
  assert.ok(Math.abs(room.scale - 1.5 * PAGE) < 0.005 && Math.abs(room.across - 1.5 * PAGE) < 0.005, "the drawing given room is laid out at " + room.scale + " by " + room.across);
  assert.ok(Math.abs(room.staff - 7.75 * 1.5 * PAGE) < 0.1, "the staff is drawn at " + room.staff + " once room is made");
  await h.page.keyboard.press("Escape");
  await sleep(600);
  // The pair at the end of each line, 5px past its staff as at 100.
  await h.page.mouse.move(staves[0].left + 40, staves[0].top + 5);
  await h.page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await sleep(120);
  const pairs = await h.page.evaluate(() =>
    Array.from(document.querySelectorAll("#app .mdm-score-edit.mdm-score-edit--shown .mdm-score-end__btn")).map((b) => ({
      left: b.getBoundingClientRect().left,
      system: Number(b.getAttribute("data-mdm-system")),
    }))
  );
  for (const [i, s] of staves.entries()) {
    const pair = pairs.filter((p) => p.system === i);
    assert.ok(pair.length, "no pair at the end of line " + i);
    assert.ok(Math.abs(pair[0].left - s.right - 5) < 1, "the pair of line " + i + " stands " + (pair[0].left - s.right) + "px past its staff");
  }
  // The mode takes the pad's digits for its figures: Ctrl with the pad's 0
  // writes a rest there, and zooms nothing. Ctrl+= is no key of the mode's.
  const source = await h.page.evaluate(() => document.querySelector("#app .mdm-score").getAttribute("data-mdm-source"));
  await rawKey(h.page, "0", "Numpad0", 96, 2, 3);
  await sleep(200);
  assert.equal(await zoomOf(h.page), "1.5", "the pad's 0 zoomed under the mode");
  assert.notEqual(await h.page.evaluate(() => document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")), source, "the mode did not take the pad's 0");
  await chord(h.page, ["Control"], "Equal");
  await sleep(150);
  assert.equal(await zoomOf(h.page), "1.75", "the zoom is not stepped under the mode");
  // And the zoom's rows answer under the mode, as the look's do.
  for (const name of ["menu-page", "mdm-zoom", "zoom-in", "zoom-reading"]) {
    assert.equal((await barState(h.page, name)).off, false, name + " is greyed under the score mode");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("at a zoom in a pane narrower than its column, the prose rewraps, each block scrolls in its own box, and the page never sideways (ZM10)", { skip }, async () => {
  // Opened tall: at 200% the first score is drawn twice as far down.
  const h = await open({ scores: 1, height: 6000, seed: { settings: { frontMatter: "hidden", zoom: 200 } } });
  await h.page.setViewport({ width: 700, height: 1800 });
  await sleep(400);
  // Down the page to the first score: in the shorter pane CodeMirror draws
  // what is in sight, and at 200% the score is further down than that.
  await h.page.waitForFunction(
    () => {
      const svg = document.querySelector("#app code.language-abc svg");
      if (!svg) window.__mdm.view.scrollDOM.scrollTop += 600;
      return !!svg;
    },
    { polling: 150, timeout: 10000 }
  );
  await sleep(300);
  const seen = await h.page.evaluate(() => {
    const s = window.__mdm.view.scrollDOM;
    const code = document.querySelector("#app code.language-abc");
    return {
      prose: getComputedStyle(s).fontSize,
      column: document.querySelector("#app .cm-content").getBoundingClientRect().width,
      page: [s.scrollWidth, s.clientWidth],
      score: [code.scrollWidth, code.clientWidth],
    };
  });
  assert.equal(seen.prose, "28.8px");
  assert.equal(seen.column, 600, "the column is not the pane less its margins");
  assert.ok(seen.page[0] <= seen.page[1], "the page scrolls sideways: " + seen.page);
  assert.ok(seen.score[0] > seen.score[1], "the score does not scroll inside its box: " + seen.score);
  // A fill gives way before the drawing does, at the drawing's size at the
  // zoom: at 150% the score (740 drawn at 999, the page's 0.9 of 1110) is
  // wider than a column of 950, and its fill keeps no padding beside it.
  await h.page.setViewport({ width: 1050, height: 1800 });
  await postSettings(h.page, { frontMatter: "hidden", zoom: 150, scoreFill: "paper" });
  await sleep(400);
  await h.page.waitForFunction(
    () => {
      const svg = document.querySelector("#app code.language-abc svg");
      if (!svg) window.__mdm.view.scrollDOM.scrollTop += 600;
      return !!svg;
    },
    { polling: 150, timeout: 10000 }
  );
  const filled = await h.page.evaluate(() => {
    const code = document.querySelector("#app code.language-abc");
    return {
      column: document.querySelector("#app .cm-content").getBoundingClientRect().width,
      drawing: code.querySelector("svg").getBoundingClientRect().width,
      padding: getComputedStyle(code).paddingLeft,
    };
  });
  assert.equal(filled.column, 950);
  assert.ok(Math.abs(filled.drawing - 740 * 1.5 * PAGE) < 0.05, "the drawing is " + filled.drawing + " wide");
  assert.equal(filled.padding, "0px", "the fill keeps a padding beside a drawing wider than the column");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a score at a zoom is drawn at the zoom's size from its first frame, so the page under it never jumps (ZM11)", { skip }, async () => {
  // CodeMirror measures a widget as it draws it and keeps that height until
  // something it watches changes size. A score drawn at its own size and
  // grown to the zoom's a frame later was held at 352px where it stood at
  // 529, and the text under it dropped 176px a frame after the score came
  // in (the second reading of the zoom, 2026-11-16; measured frame by frame).
  const h = await open({ scores: 1, height: 6000, seed: { settings: { zoom: 150, frontMatter: "hidden" } } });
  await h.page.setViewport({ width: 1500, height: 700 });
  await sleep(400);
  // To the foot, where the scores at the head of the document are dropped,
  // then back to where the first one comes into the pane, frame by frame.
  await h.page.evaluate(() => {
    const s = window.__mdm.view.scrollDOM;
    s.scrollTop = s.scrollHeight;
  });
  await sleep(600);
  const frames = await h.page.evaluate(
    () =>
      new Promise((done) => {
        const v = window.__mdm.view;
        const text = v.state.doc.toString();
        const at = text.indexOf("```abc");
        const under = text.indexOf("\n\n", text.indexOf("```", at + 6) + 3) + 2;
        v.scrollDOM.scrollTop = v.lineBlockAt(at).top + 200;
        const out = [];
        const tick = () => {
          const el = document.querySelector("#app .mdm-score");
          const svg = el && el.querySelector("code.language-abc svg");
          const c = v.coordsAtPos(under);
          if (el && svg && c) {
            out.push({
              map: v.lineBlockAt(v.posAtDOM(el)).height,
              dom: el.getBoundingClientRect().height,
              scale: svg.getBoundingClientRect().height / parseFloat(svg.getAttribute("height")),
              // The engraving's own scale, which a box of the right size
              // with no viewBox in it would leave at 1.
              ink: svg.getScreenCTM().a,
              under: c.top,
            });
          }
          if (out.length < 6) requestAnimationFrame(tick);
          else done(out);
        };
        tick();
      })
  );
  assert.ok(frames.length >= 6, "the score never came into the pane");
  for (const [i, f] of frames.entries()) {
    assert.ok(Math.abs(f.scale - 1.5 * PAGE) < 0.01, "frame " + i + ": the score is drawn at " + f.scale + " of its size");
    assert.ok(Math.abs(f.ink - 1.5 * PAGE) < 0.01, "frame " + i + ": the engraving is drawn at " + f.ink + " of its size in a box at 1.35");
    assert.ok(Math.abs(f.map - f.dom) <= 1, "frame " + i + ": CodeMirror holds the score at " + f.map + " where it is drawn at " + f.dom);
  }
  assert.ok(frames.every((f) => Math.abs(f.under - frames[0].under) < 1), "the line under the score moved: " + frames.map((f) => Math.round(f.under)).join(", "));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a card's air grows with the page: a caret taken to the end of a long line of code stands that air inside the card (ZM12)", { skip }, async () => {
  const long = "x = '" + "a long line of code that the card scrolls to reach the end of ".repeat(3) + "'";
  const h = await open({ text: "Some prose.\n\n```python\n" + long + "\ny = 1\n```\n\nThe end.\n", scores: 0, seed: { settings: { zoom: 150 } } });
  await h.page.setViewport({ width: 900, height: 900 });
  await sleep(300);
  await setSelection(h.page, (await posOf(h.page, long)) + long.length);
  await sleep(400);
  const gap = await h.page.evaluate(() => {
    const caret = document.querySelector("#app .cm-cursor").getBoundingClientRect();
    const row = Array.from(document.querySelectorAll("#app .cm-line.mdm-code-line")).find((r) => {
      const b = r.getBoundingClientRect();
      const mid = (caret.top + caret.bottom) / 2;
      return mid >= b.top && mid <= b.bottom;
    });
    return { gap: row.getBoundingClientRect().right - caret.right, scrolled: row.scrollLeft };
  });
  assert.ok(gap.scrolled > 0, "the card did not scroll, so this reads nothing");
  // The card's own air is 12px of the sheet's, 0.9em of its monospace: at
  // 150, 12 times 1.5 times the page's 0.9.
  assert.ok(Math.abs(gap.gap - 12 * 1.5 * PAGE) <= 1.5, "the caret stands " + gap.gap + "px inside the card's edge");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a picture in a table's cell is measured once its file is in, at the zoom's size (ZM13)", { skip }, async () => {
  // A table and nothing else: the pictures of the prose ask for the heights
  // again when their files are in, and with one of them on the page that
  // would hide whether the cell's own picture does. The picture is written
  // into a page that has settled, as the late picture of the prose is
  // (webview-editing.test.js): drawn with the page, its file came in before
  // the measures that follow a page's first drawing, which read every height
  // again whatever the cell asks. And a page shorter than the pane, whose
  // content box is stretched to the pane and so does not change height
  // when the cell grows, which is the change CodeMirror would read the
  // heights again for by itself.
  const table = (cell) => "| a | b |\n|---|---|\n| 1 | " + cell + " |\n\nThe end.\n";
  const h = await open({ text: table("x"), scores: 0, seed: { docBase: PICTURES, settings: { zoom: 150 } } });
  await sleep(300);
  await update(h.page, table("![Cell](icon.png)"), true, 0);
  await h.page.waitForFunction(() => {
    const img = document.querySelector("#app .mdm-table img.mdm-image");
    return img && img.complete && img.naturalWidth > 0;
  });
  await sleep(300);
  const seen = await h.page.evaluate(() => {
    const v = window.__mdm.view;
    const el = document.querySelector("#app .mdm-table");
    return {
      picture: el.querySelector("img").getBoundingClientRect().width,
      map: v.lineBlockAt(v.posAtDOM(el)).height,
      dom: el.getBoundingClientRect().height,
    };
  });
  assert.ok(Math.abs(seen.picture - 256 * 1.5 * PAGE) < 0.02, "the picture in the cell is " + seen.picture + " wide");
  assert.ok(Math.abs(seen.map - seen.dom) <= 1, "CodeMirror holds the table at " + seen.map + " where it is drawn at " + seen.dom);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a score whose ink hangs out of the box abcjs declares is measured again once it is widened to it (ZM14)", { skip }, async () => {
  // A slur under the lowest notes hangs 1.3 units of the drawing below the
  // height abcjs gives the score (probed on fifteen shapes of score, the
  // second reading of the zoom, 2026-11-16; a title wider than its staff
  // was the only other that outgrew its box, and only in width). fitScores
  // grows the drawing to it after CodeMirror has measured the widget, which
  // at 300% is 4px CodeMirror would not know of without being told.
  // Written into a page that has settled, and shorter than the pane, for the
  // reasons the picture in a cell is (ZM13).
  const abc = "X:1\nK:C\n(C,,D,,E,,F,,|G,,A,,B,,C,)|(3c'd'e' {g'}f'4|";
  const h = await open({ text: "Some prose.\n\nThe end.\n", scores: 0, seed: { settings: { zoom: 300 } } });
  await sleep(300);
  await update(h.page, "Some prose.\n\n```abc\n" + abc + "\n```\n\nThe end.\n", true, 1);
  await h.page.waitForFunction(() => document.querySelector("#app code.language-abc svg[data-mdm-fit]"));
  await sleep(300);
  const seen = await h.page.evaluate(() => {
    const v = window.__mdm.view;
    const el = document.querySelector("#app .mdm-score");
    const svg = el.querySelector("code.language-abc svg");
    const box = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    const ink = svg.getBBox();
    return {
      bottom: box[1] + box[3],
      ink: ink.y + ink.height,
      scale: svg.getBoundingClientRect().height / parseFloat(svg.getAttribute("height")),
      map: v.lineBlockAt(v.posAtDOM(el)).height,
      dom: el.getBoundingClientRect().height,
    };
  });
  assert.ok(Math.abs(seen.bottom - seen.ink) < 0.01, "the drawing's foot is " + seen.bottom + " and its ink's " + seen.ink + ": it was not widened to its ink, so this reads nothing");
  // Drawn at the zoom of the size it was widened to, and not of the size
  // abcjs declared: 1.3 units short of it is 0.023 off the zoom.
  assert.ok(Math.abs(seen.scale - 3 * PAGE) < 0.005, "the widened score is drawn at " + seen.scale + " of its size");
  assert.ok(Math.abs(seen.map - seen.dom) <= 1, "CodeMirror holds the score at " + seen.map + " where it is drawn at " + seen.dom);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's report of 2026-11-20: Ctrl and the wheel showed the reading,
// and the reading went as the zoom passed through 100. A reader's own zoom
// keeps it up, 100 included, for ZOOM_LINGER (1.5 s) after the last step,
// and at 100 it then goes as it did (D5); not while its menu is open, nor
// with the page moving on the screen as the bar loses the row the reading
// took. A zoom the host brings is no gesture of the reader's: at 100 the
// reading goes at once. The wheel and not the keys, which are Cmd on a Mac.
test("a reader's zoom through 100 keeps the reading up a moment, and putting it away moves nothing (ZM15)", { skip }, async () => {
  const text = Array.from({ length: 60 }, (_, i) => "Paragraph " + (i + 1) + " of a page long enough to scroll, with words enough to wrap at a narrow width.").join("\n\n") + "\n";
  const h = await open({ text, scores: 0, height: 700 });
  await h.page.setViewport({ width: 1200, height: 700 });
  await sleep(200);
  const reading = () =>
    h.page.evaluate(() => {
      const word = document.querySelector('#app .mdm-toolbar button[data-type="zoom-reading"]');
      return word.getClientRects().length > 0 ? word.textContent : null;
    });
  const notch = async (dy) => {
    await h.page.keyboard.down("Control");
    await h.page.mouse.wheel({ deltaY: dy });
    await h.page.keyboard.up("Control");
  };
  await h.page.mouse.move(600, 400);
  // Through 100 and past it, a notch every half second: two seconds of one
  // gesture, longer than the linger, so a timer of an earlier notch left
  // running would put the reading away under the hand.
  const seen = [];
  for (const dy of [-100, 100, 100, -100]) {
    await notch(dy);
    await sleep(100);
    seen.push([await zoomOf(h.page), await reading()]);
    await sleep(400);
  }
  assert.deepEqual(seen, [["1.1", "110%"], ["1", "100%"], ["0.9", "90%"], ["1", "100%"]], "the reading as the wheel turned");
  await sleep(500);
  assert.equal(await reading(), "100%", "the reading went before the linger was over");
  await sleep(1100);
  assert.equal(await reading(), null, "the reading stayed at 100 once the hand had stopped");
  // At another zoom it stays, as it always did.
  await notch(-100);
  await sleep(1700);
  assert.equal(await reading(), "110%");
  // Its own menu open as the linger ends: it stays up with its menu, and
  // goes once the menu is shut.
  await notch(100);
  await sleep(100);
  await h.page.click('#app .mdm-toolbar button[data-type="zoom-reading"]');
  await sleep(1700);
  assert.equal(await reading(), "100%", "the reading went with its menu open");
  assert.equal(await h.page.evaluate(() => !!document.querySelector("#app .mdm-toolbar__item--end.mdm-toolbar__item--open")), true, "the reading's menu was shut");
  await h.page.keyboard.press("Escape");
  await sleep(1700);
  assert.equal(await reading(), null, "the reading stayed once its menu was shut");
  // The host's zoom: 110 stored and answered, then 100 from elsewhere.
  await sleep(600);
  await postSettings(h.page, { zoom: 100 });
  await postSettings(h.page, { zoom: 110 });
  await sleep(150);
  assert.equal(await reading(), "110%");
  await postSettings(h.page, { zoom: 100 });
  await sleep(150);
  assert.equal(await reading(), null, "a zoom the host brought to 100 kept the reading up");
  // A pane where the reading takes the bar into a second row: the widest
  // that does, sought, since the words' widths are the platform's.
  const barHeight = () => h.page.evaluate(() => Math.round(document.querySelector("#app .mdm-toolbar").getBoundingClientRect().height));
  let narrow = 0;
  for (let width = 700; width >= 360 && !narrow; width -= 10) {
    await h.page.setViewport({ width, height: 700 });
    await postSettings(h.page, { zoom: 110 });
    await sleep(80);
    const with110 = await barHeight();
    await postSettings(h.page, { zoom: 100 });
    await sleep(80);
    if (with110 > (await barHeight())) narrow = width;
  }
  assert.ok(narrow > 0, "no width at which the reading takes a row of its own");
  await sleep(700);
  await h.page.evaluate(() => {
    window.__mdm.view.scrollDOM.scrollTop = 1500;
  });
  await sleep(200);
  await h.page.mouse.move(Math.round(narrow / 2), 400);
  await notch(-100);
  await sleep(300);
  await notch(100);
  await sleep(300);
  const tall = await barHeight();
  // A point of the text by its block and its offset into it, on the screen.
  const mark = await h.page.evaluate(() => {
    const v = window.__mdm.view;
    const block = v.lineBlockAtHeight(400 - v.documentTop);
    return { from: block.from, off: 400 - (v.documentTop + block.top) };
  });
  const at = () =>
    h.page.evaluate((m) => {
      const v = window.__mdm.view;
      return v.documentTop + v.lineBlockAt(m.from).top + m.off;
    }, mark);
  await sleep(1700);
  assert.ok((await barHeight()) < tall, "the bar kept the reading's row at " + narrow + "px: " + tall);
  const moved = (await at()) - 400;
  assert.ok(Math.abs(moved) < 1, "the text moved " + moved + "px on the screen as the reading was put away");
  assert.deepEqual(h.errors, []);
  await h.close();
});
