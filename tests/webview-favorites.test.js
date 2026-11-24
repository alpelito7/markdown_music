// The row of favorites (mdm.favorites; FAVORITES and favoritesRow in
// main.js, .mdm-favorites in style.css): a row of buttons under the words of
// the bar, the owner's picks of 2026-11-16 from design-favorites.html:
//
//   - set B: the outline at its head, then undo and redo, the heading levels,
//     bold, italic and link, the three lists, equation, table, picture and
//     the music symbols, and the face and the zoom as two glyphs more, the A
//     and the magnifier: nothing is set apart at its right end; since
//     2026-11-20 the A heads the marks, left of the levels, and the
//     magnifier is a group of its own after undo and redo, with the zoom's
//     figure beside it (design-row-icons.html); and since the same day the
//     code block stands right of the task list and the music symbols are
//     Insert's alone, the owner's asks;
//   - every button is a row of one of the menus: that row's glyph, its name
//     and its key in the tip, greyed when the row is, and a press on it does
//     what a press on the row does;
//   - no line between the words and the row, and the bar is 64px with it;
//   - a pane too narrow for it gathers whole groups into a » at the end of
//     the run, from the right, and the bar keeps its height;
//   - the Favorites row of the Page menu puts it away (it is shown by
//     default), and the bar is then the bar of words, the outline back at
//     its head.
//
// The harness opens without the row, as it opens without the score panel
// (the extension's defaults are both shown), so every test here asks for it.
//
// Run with: node --test --test-concurrency=1 tests/webview-favorites.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { open, skip, docText, posOf, setSelection, postSettings, setSettingPosts, pressBar, barState } = require("./webview/helpers.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The row in order, by the names of the rows its buttons are, "|" for a rule.
const ROW = [
  "outline",
  "|",
  "undo",
  "redo",
  "|",
  // A group of its own after Undo and Redo, the owner's pick of 2026-11-20
  // (B of design-row-icons.html), where it was the run's last.
  "mdm-zoom",
  "|",
  // Left of the heading's levels, the owner's ask of 2026-11-20.
  "mdm-text-font",
  "headings",
  "bold",
  "italic",
  "link",
  "|",
  "unordered-list",
  "ordered-list",
  "task-list",
  // Right of the task list, the owner's ask of 2026-11-20.
  "code-block",
  "|",
  "insert-equation",
  "insert-table",
  "insert-picture",
  // The music symbols left the row on 2026-11-20, the owner's ask: Insert
  // keeps them.
];
// Its groups, the outline's apart: what goes into the » goes a group at a time.
const GROUPS = ROW.slice(2)
  .join(" ")
  .split(" | ")
  .map((g) => g.split(" "));
const WORDS = ["menu-edit", "menu-format", "menu-paragraph", "menu-insert", "menu-page", "menu-score", "menu-export"];

// The editor with the row asked for, as the extension ships it.
function withRow(opts) {
  const o = Object.assign({ text: "Some words here.\n", scores: 0 }, opts || {});
  o.seed = Object.assign({}, o.seed || {});
  o.seed.settings = Object.assign({ favorites: "shown" }, o.seed.settings || {});
  return open(o);
}

// What the row shows, in order: a button by its name, "|" for a rule.
const rowSeen = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelector("#app .mdm-favorites").children)
      .filter((el) => getComputedStyle(el).display !== "none")
      .map((el) => (el.classList.contains("mdm-toolbar__sep") ? "|" : el.querySelector(":scope > button").getAttribute("data-type")))
  );

// A button of the row by name, its box and what it says of itself.
const button = (page, name) =>
  page.evaluate((name) => {
    const b = document.querySelector('#app .mdm-favorites > .mdm-toolbar__item > button[data-type="' + name + '"]');
    if (!b) return null;
    const css = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return {
      tip: b.getAttribute("aria-label"),
      keys: b.getAttribute("aria-keyshortcuts"),
      glyph: (b.querySelector("svg") || { outerHTML: "" }).outerHTML,
      // Greyed is its glyph at the weight of a greyed row: the button keeps
      // the pointer, for its tip (style.css, 2026-11-20).
      off: Number(getComputedStyle(b.querySelector(":scope > svg")).opacity) < 1,
      on: b.classList.contains("mdm-btn--on"),
      open: b.parentNode.classList.contains("mdm-toolbar__item--open"),
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  }, name);

const press = (page, name) => page.click('#app .mdm-favorites > .mdm-toolbar__item > button[data-type="' + name + '"]');

// The rows of the panel a button of the row opens, as they stand: name, what
// it says, its key, ticked, whether it has a glyph.
const panelRows = (page, name) =>
  page.evaluate((name) => {
    const panel = document.querySelector('#app .mdm-favorites > .mdm-toolbar__item > button[data-type="' + name + '"] + .mdm-menu');
    // In sight is what has a box: a row that leads to a submenu stands in a
    // group with it, and the » puts away the group, not the row.
    return Array.from(panel.querySelectorAll(":scope > .mdm-menu__item, :scope > .mdm-menu__group > .mdm-menu__item, :scope > .mdm-menu__rule"))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) =>
        el.classList.contains("mdm-menu__rule")
          ? "|"
          : [
              el.getAttribute("data-type"),
              Array.from(el.childNodes)
                .filter((n) => n.nodeType === 3)
                .map((n) => n.textContent)
                .join(""),
              (el.querySelector(".mdm-menu__key") || { textContent: null }).textContent,
              !!el.querySelector(".mdm-swatch__tick"),
              !!el.querySelector(".mdm-menu__icon svg"),
            ]
      );
  }, name);

test("the row stands under the words, the outline at its head, set B in order, the magnifier after Undo and Redo and the A left of the levels, nothing apart at its right end (FV01)", { skip }, async () => {
  const h = await withRow();
  await h.page.setViewport({ width: 920, height: 700 });
  await sleep(300);
  assert.deepEqual(await rowSeen(h.page), ROW);
  const m = await h.page.evaluate(() => {
    const bar = document.querySelector("#app .mdm-toolbar");
    const row = bar.querySelector(":scope > .mdm-favorites");
    const items = Array.from(row.children).filter((el) => getComputedStyle(el).display !== "none");
    const boxes = items.map((el) => el.getBoundingClientRect());
    const rb = row.getBoundingClientRect();
    return {
      bar: bar.getBoundingClientRect().height,
      words: Array.from(bar.querySelectorAll(":scope > .mdm-toolbar__item > .mdm-word"))
        .filter((w) => getComputedStyle(w.parentNode).display !== "none")
        .map((w) => w.getAttribute("data-type")),
      head: bar.firstElementChild.querySelector(":scope > button").getAttribute("data-type"),
      under: rb.top >= bar.querySelector(".mdm-word").getBoundingClientRect().bottom,
      gaps: boxes.slice(1).map((b, i) => Math.round((b.left - boxes[i].right) * 10) / 10),
      room: rb.right - boxes[boxes.length - 1].right,
      line: getComputedStyle(row).borderTopWidth,
      heights: [...new Set(items.filter((el) => el.querySelector(":scope > button")).map((el) => el.querySelector(":scope > button").getBoundingClientRect().height))],
    };
  });
  assert.equal(m.bar, 64, "the bar with the row is not the words' 35 and the row's 28 and the gap between them");
  assert.deepEqual(m.words, WORDS, "the words are not the seven of the bar");
  assert.equal(m.head, "menu-edit", "the words do not begin with Edit: the outline is not in the row");
  assert.ok(m.under, "the row is not under the words");
  // One gap between two buttons, and a rule's margins either side of it:
  // nothing pushed away from the rest.
  assert.ok(Math.max(...m.gaps) <= 6, "something stands apart in the run: " + JSON.stringify(m.gaps));
  assert.ok(m.room > 300, "the run does not end where its buttons do: " + m.room + "px after it");
  assert.equal(m.line, "0px", "a line between the words and the row");
  assert.deepEqual(m.heights, [28], "a button of the row is not one height with the bar's");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("every button of the row is a row of a menu: its glyph, its name and its key, the tip saying the two (FV02)", { skip }, async () => {
  const h = await withRow();
  // The menu row each button is: the levels' button stands for the rows that
  // open the Paragraph menu and wears the glyph of the first of the six.
  const ROWS_OF = { outline: "page-outline", headings: "heading-1" };
  for (const name of ROW.filter((n) => n !== "|")) {
    const b = await button(h.page, name);
    const row = await barState(h.page, ROWS_OF[name] || name);
    assert.ok(b && row && row.kind === "row", name + " is not a row of a menu");
    assert.ok(b.glyph !== "" && b.glyph === row.glyph, name + ": the button does not wear its row's glyph");
    const says = name === "headings" ? "Heading" : row.name;
    assert.equal(b.tip, row.key && name !== "headings" ? says + " (" + row.key + ")" : says, name + ": the tip");
    assert.equal(!!b.keys, !!row.keys && name !== "headings", name + ": the key a reader of the page is told");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a press on a button does what a press on its row does: a mark on the selection, undo and redo greyed by the history, a level from the heading's rows (FV03)", { skip }, async () => {
  const h = await withRow({ text: "Some words here.\n" });
  assert.ok((await button(h.page, "undo")).off, "undo is not greyed with nothing to undo");
  assert.ok((await button(h.page, "redo")).off, "redo is not greyed with nothing to redo");
  const at = await posOf(h.page, "words");
  await setSelection(h.page, [{ anchor: at, head: at + 5 }]);
  await press(h.page, "bold");
  await sleep(150);
  assert.equal(await docText(h.page), "Some **words** here.\n");
  assert.ok(!(await button(h.page, "undo")).off, "undo is greyed with a mark to undo");
  await press(h.page, "undo");
  await sleep(150);
  assert.equal(await docText(h.page), "Some words here.\n");
  assert.ok(!(await button(h.page, "redo")).off, "redo is greyed with the mark to redo");
  await press(h.page, "redo");
  await sleep(150);
  assert.equal(await docText(h.page), "Some **words** here.\n");
  const word = await posOf(h.page, "words");
  await setSelection(h.page, [{ anchor: word, head: word + 5 }]);
  await press(h.page, "italic");
  await sleep(150);
  assert.equal(await docText(h.page), "Some ***words*** here.\n");

  // The levels: the rows the Paragraph menu begins with, each with its key,
  // the level of the caret's line ticked, and a press makes the line one.
  await setSelection(h.page, await posOf(h.page, "here"));
  await press(h.page, "headings");
  await sleep(150);
  assert.ok((await button(h.page, "headings")).open, "the levels did not open under their button");
  const levels = await panelRows(h.page, "headings");
  assert.deepEqual(
    levels.map((r) => r.slice(0, 4)),
    [0, 1, 2, 3, 4, 5, 6].map((n) => [n ? "heading-" + n : "paragraph", n ? "Heading " + n : "Paragraph", "Ctrl+" + n, n === 0])
  );
  await h.page.click('#app .mdm-favorites [data-type="headings"] + .mdm-menu [data-type="heading-2"]');
  await sleep(150);
  assert.equal(await docText(h.page), "## Some ***words*** here.\n");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the A opens the faces and the magnifier the zoom's rows, the same rows as Page's, ticked alike, and a press asks for what the row asks (FV04)", { skip }, async () => {
  // The scroll bars drawn, for the room a panel keeps for one to show.
  const h = await withRow({ bars: true });
  // A panel of the row is a word's: no strip kept for a bar it never shows,
  // so the magnifier's rows are as wide as the same rows under Page -> Zoom,
  // and its button sits on the disc a word's menu puts under the word.
  const width = (sel) => h.page.$eval(sel, (el) => el.getBoundingClientRect().width);
  await pressBar(h.page, "zoom-in");
  await h.page.keyboard.press("Escape");
  await pressBar(h.page, "menu-page");
  await h.page.hover('#app .mdm-word[data-type="menu-page"] + .mdm-menu button[data-type="mdm-zoom"]');
  await sleep(300);
  const pageWidth = await width('#app .mdm-word[data-type="menu-page"] + .mdm-menu button[data-type="mdm-zoom"] + .mdm-menu');
  const word = await h.page.$eval('#app .mdm-word[data-type="menu-page"]', (w) => getComputedStyle(w).backgroundColor);
  await h.page.keyboard.press("Escape");
  await press(h.page, "mdm-zoom");
  await h.page.mouse.move(5, 400);
  await sleep(300);
  const own = await width('#app .mdm-favorites button[data-type="mdm-zoom"] + .mdm-menu');
  assert.ok(Math.abs(own - pageWidth) < 0.5, "the magnifier's rows are " + own + "px wide and Page's " + pageWidth);
  assert.equal(
    await h.page.$eval('#app .mdm-favorites button[data-type="mdm-zoom"] + .mdm-menu', (m) => getComputedStyle(m).scrollbarGutter),
    "auto",
    "the magnifier's panel keeps room for a bar"
  );
  const ground = await h.page.$eval('#app .mdm-favorites button[data-type="mdm-zoom"]', (b) => getComputedStyle(b).backgroundColor);
  assert.equal(ground, word, "the magnifier with its rows open is not on an open word's disc");
  await h.page.keyboard.press("Escape");
  await press(h.page, "mdm-text-font");
  await sleep(150);
  assert.deepEqual(await panelRows(h.page, "mdm-text-font"), [
    ["font-roman", "Latin Modern Roman", null, true, false],
    ["font-sans", "System sans", null, false, false],
  ]);
  // Page's Font row leads to the same two, ticked alike.
  const page = async () => [(await barState(h.page, "font-roman")).on, (await barState(h.page, "font-sans")).on];
  assert.deepEqual(await page(), [true, false], "Page's Font rows");
  assert.equal((await barState(h.page, "mdm-text-font")).name, "Font");
  await h.page.click('#app .mdm-favorites [data-type="mdm-text-font"] + .mdm-menu [data-type="font-sans"]');
  await sleep(150);
  assert.deepEqual(
    (await setSettingPosts(h.page)).filter((m) => m.key === "textFont").map((m) => [m.key, m.value]),
    [["textFont", "sans"]]
  );
  await postSettings(h.page, { favorites: "shown", textFont: "sans" });
  await h.page.waitForFunction(() => !document.getElementById("app").classList.contains("mdm-text--roman"));
  assert.deepEqual(await page(), [false, true], "Page's rows did not follow the face");
  await press(h.page, "mdm-text-font");
  await sleep(150);
  assert.deepEqual(
    (await panelRows(h.page, "mdm-text-font")).map((r) => r[3]),
    [false, true],
    "the A's rows did not follow the face"
  );
  await h.page.keyboard.press("Escape");

  await press(h.page, "mdm-zoom");
  await sleep(150);
  const zoom = await panelRows(h.page, "mdm-zoom");
  assert.deepEqual(
    zoom.map((r) => (r === "|" ? r : r[0])),
    ["zoom-in", "zoom-out", "zoom-actual", "|"].concat([50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300].map((s) => "zoom-" + s))
  );
  assert.deepEqual(
    zoom.filter((r) => r !== "|" && r[3]).map((r) => r[0]),
    ["zoom-110"],
    "the zoom in force is not the one ticked"
  );
  await h.page.click('#app .mdm-favorites [data-type="mdm-zoom"] + .mdm-menu [data-type="zoom-in"]');
  await sleep(600);
  assert.deepEqual(
    (await setSettingPosts(h.page)).filter((m) => m.key === "zoom").map((m) => m.value),
    [110, 125],
    "Zoom in from the magnifier did not step the zoom"
  );
  assert.equal((await barState(h.page, "zoom-125")).on, true, "Page's Zoom rows did not follow");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the code block, right of the task list, makes a block where the caret is, and the music symbols are not on the row (FV05)", { skip }, async () => {
  const h = await withRow({ text: "Some prose.\n\n" });
  await setSelection(h.page, 13);
  await press(h.page, "code-block");
  await sleep(150);
  assert.equal(await docText(h.page), "Some prose.\n\n```\n```", "the code block of the row did not open a block on the blank line");
  assert.equal(await h.page.$$eval('#app .mdm-favorites [data-type="insert-symbol"]', (els) => els.length), 0, "the music symbols are still on the row");
  assert.deepEqual(h.errors, []);
  await h.close();
});

const SCORED = ["Some prose.", "", "```abc", "X:1", "T:Row", "M:4/4", "L:1/4", "K:C", "C D E F |]", "```", "", "The end.", ""].join("\n");

test("under the score mode what writes text greys out as its word does, and the outline, the face and the zoom stay (FV06)", { skip }, async () => {
  const h = await withRow({ text: SCORED, scores: 1 });
  await setSelection(h.page, await posOf(h.page, "prose"));
  await press(h.page, "bold");
  await sleep(150);
  await pressBar(h.page, "mdm-score-navigation");
  await h.page.waitForFunction(() => document.getElementById("app").classList.contains("mdm--score-mode"));
  await sleep(200);
  const off = {};
  for (const name of ROW.filter((n) => n !== "|")) off[name] = (await button(h.page, name)).off;
  const STAY = ["outline", "mdm-text-font", "mdm-zoom"];
  for (const name of Object.keys(off)) assert.equal(off[name], !STAY.includes(name), name + (off[name] ? " greyed" : " not greyed") + " under the mode");
  const words = await h.page.evaluate(() =>
    Array.from(document.querySelectorAll("#app .mdm-toolbar > .mdm-toolbar__item > .mdm-word"))
      .filter((w) => getComputedStyle(w).opacity < 1)
      .map((w) => w.getAttribute("data-type"))
  );
  assert.deepEqual(words, ["menu-format", "menu-paragraph", "menu-insert"], "the words that grey out are not the row's companions");
  // Greyed for the keyboard as well: a button or a row left focused (Tab
  // reaches them) answers Enter with nothing, a music symbol's cell
  // included. The pointer reaches a button, for its tip, and gets nothing
  // either (FV14).
  const frozen = await docText(h.page);
  const enterOn = async (selector) => {
    await h.page.evaluate((s) => document.querySelector(s).focus(), selector);
    await h.page.keyboard.press("Enter");
    await sleep(200);
  };
  await enterOn('#app .mdm-favorites button[data-type="insert-table"]');
  await enterOn('#app .mdm-favorites button[data-type="bold"]');
  await h.page.evaluate(() => document.querySelector('#app .mdm-word[data-type="menu-insert"]').click());
  await sleep(150);
  await enterOn('#app .mdm-word[data-type="menu-insert"] + .mdm-menu button[data-type="insert-rule"]');
  await h.page.evaluate(() => document.querySelector('#app .mdm-word[data-type="menu-insert"] + .mdm-menu button[data-type="insert-symbol"]').click());
  await sleep(150);
  await enterOn('#app .mdm-word[data-type="menu-insert"] + .mdm-menu [data-type="symbol-quarter"]');
  assert.equal(await docText(h.page), frozen, "a greyed control wrote into the text under the mode");
  await h.page.keyboard.press("Escape");
  await pressBar(h.page, "mdm-score-navigation");
  await h.page.waitForFunction(() => !document.getElementById("app").classList.contains("mdm--score-mode"));
  await sleep(200);
  for (const name of ["bold", "undo", "insert-table"]) assert.equal((await button(h.page, name)).off, false, name + " still greyed out of the mode");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("in a pane too narrow for the row whole groups go into the » from the right end, the row never wraps, and the » holds their rows (FV07)", { skip }, async () => {
  const h = await withRow();
  const cuts = new Set();
  // Down to a pane narrower than the outline and one group: under about 430px
  // the words wrap by themselves (as they did before the row), so the bar's
  // 64px are asked of the wider panes only; the row is one line at all.
  for (const width of [920, 560, 520, 490, 440, 400, 360, 300, 250, 200, 130]) {
    await h.page.setViewport({ width, height: 700 });
    await sleep(250);
    const seen = await rowSeen(h.page);
    const [bar, line] = await h.page.$eval("#app .mdm-toolbar", (b) => [b.getBoundingClientRect().height, b.querySelector(".mdm-favorites").getBoundingClientRect().height]);
    if (width >= 440) assert.equal(bar, 64, width + ": the bar grew");
    assert.equal(line, 28, width + ": the row is not one line");
    assert.deepEqual(seen.slice(0, 2), ["outline", "|"], width + ": the outline left the head");
    const more = seen[seen.length - 1] === "favorites-more";
    const run = (more ? seen.slice(2, -1) : seen.slice(2)).join(" ").split(" | ").filter(Boolean);
    // Whole groups, the first ones: the run is a prefix of the groups.
    const kept = run.length;
    assert.deepEqual(run.map((g) => g.split(" ")), GROUPS.slice(0, kept), width + ": the run is not whole groups from the left: " + JSON.stringify(seen));
    assert.equal(more, kept < GROUPS.length, width + ": a » with nothing in it, or groups gone with no »");
    const fits = await h.page.evaluate(() => {
      const row = document.querySelector("#app .mdm-favorites");
      const last = Array.from(row.children).filter((el) => getComputedStyle(el).display !== "none").pop();
      return last.getBoundingClientRect().right <= row.getBoundingClientRect().right - 8 + 0.5;
    });
    assert.ok(fits, width + ": the row runs past the pane");
    cuts.add(kept);
    if (!more) continue;
    await press(h.page, "favorites-more");
    await sleep(150);
    const rows = await panelRows(h.page, "favorites-more");
    const names = rows.map((r) => (r === "|" ? r : r[0]));
    const hidden = GROUPS.slice(kept);
    assert.deepEqual(names, hidden.map((g) => g.join(" ")).join(" | ").split(" "), width + ": the » does not hold the groups that went");
    for (const r of rows) if (r !== "|") assert.ok(r[4], width + ": " + r[0] + " has no glyph in the »");
    const task = rows.find((r) => r[0] === "task-list");
    if (task) assert.equal(task[2], "Ctrl+Shift+T", "the » does not name a row's key");
    await h.page.keyboard.press("Escape");
    await sleep(100);
  }
  assert.deepEqual([...cuts].sort(), [0, 1, 2, 3, 4, 5], "the widths tried did not cut the row at every group");

  // No submenu of the » is read here since the music symbols left the row
  // (2026-11-20): theirs was the one that opened, at 560px, where they were
  // the one group gathered. The groups the » takes now lead to no submenu
  // until a pane of about 360px gathers the A and the levels, and there a
  // press on such a row shuts the » (under Pending, FVP7).
  // The glass's panel open, and the pane narrowed until the glass is
  // gathered: the panel goes with it, and nothing is left open out of sight.
  await h.page.setViewport({ width: 920, height: 700 });
  await sleep(250);
  await press(h.page, "mdm-zoom");
  await sleep(150);
  assert.ok((await button(h.page, "mdm-zoom")).open, "the glass's panel did not open");
  await h.page.setViewport({ width: 200, height: 700 });
  await sleep(250);
  assert.ok(!(await rowSeen(h.page)).includes("mdm-zoom"), "a pane of 200 did not gather the glass, so this reads nothing");
  assert.equal(await h.page.$$eval("#app .mdm-toolbar__item--open", (els) => els.length), 0, "a panel was left open under a button the row gathered");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("put away from the Page menu, the row goes and the bar is the bar of words, the outline at its head; shown again, the outline goes back to the row (FV08)", { skip }, async () => {
  const h = await withRow();
  const bar = () =>
    h.page.evaluate(() => {
      const b = document.querySelector("#app .mdm-toolbar");
      return {
        height: b.getBoundingClientRect().height,
        head: Array.from(b.children)
          .slice(0, 3)
          .map((el) => (el.classList.contains("mdm-toolbar__sep") ? "|" : (el.querySelector(":scope > button") || { getAttribute: () => el.className }).getAttribute("data-type"))),
        rowShown: getComputedStyle(b.querySelector(".mdm-favorites")).display !== "none",
        lit: document.querySelector('#app button[data-type="outline"]').classList.contains("mdm-btn--on"),
        outlines: document.querySelectorAll('#app button[data-type="outline"]').length,
      };
    });
  assert.equal((await barState(h.page, "page-favorites")).on, true, "the Favorites row is not ticked with the row shown");
  await pressBar(h.page, "page-favorites");
  await sleep(150);
  assert.deepEqual(
    (await setSettingPosts(h.page)).map((m) => [m.key, m.value]),
    [["favorites", "hidden"]]
  );
  assert.equal((await bar()).rowShown, true, "the row went before the host answered");
  await postSettings(h.page, { favorites: "hidden" });
  await sleep(200);
  let b = await bar();
  assert.deepEqual([b.height, b.head, b.rowShown, b.outlines], [35, ["outline", "|", "menu-edit"], false, 1], "the bar of words, as it was");
  assert.equal((await barState(h.page, "page-favorites")).on, false);
  // A panel of the row open as the row is put away goes with it.
  await postSettings(h.page, { favorites: "shown" });
  await sleep(200);
  await press(h.page, "mdm-text-font");
  await sleep(150);
  assert.ok((await button(h.page, "mdm-text-font")).open, "the A's list did not open");
  await postSettings(h.page, { favorites: "hidden" });
  await sleep(200);
  assert.equal(await h.page.$$eval("#app .mdm-toolbar__item--open", (els) => els.length), 0, "a panel of the row was left open with the row put away");
  // The outline's button keeps its state whichever row it is in.
  await postSettings(h.page, { favorites: "hidden", outline: "shown" });
  await sleep(200);
  assert.equal((await bar()).lit, true, "the outline's button is not lit with the outline open");
  await postSettings(h.page, { favorites: "shown", outline: "shown" });
  await sleep(200);
  b = await bar();
  assert.deepEqual([b.height, b.head[0], b.rowShown, b.lit, b.outlines], [64, "menu-edit", true, true, 1]);
  assert.deepEqual((await rowSeen(h.page)).slice(0, 3), ["outline", "|", "undo"]);
  assert.equal((await barState(h.page, "page-favorites")).on, true);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a menu of the words opens over the row, the pointer crossing a button of the row leaves it open, and no tip of the row is drawn meanwhile (FV09)", { skip }, async () => {
  const h = await withRow();
  await h.page.setViewport({ width: 920, height: 700 });
  await pressBar(h.page, "menu-insert");
  await sleep(150);
  const over = await h.page.evaluate(() => {
    const panel = document.querySelector("#app .mdm-toolbar__item--open > .mdm-menu");
    const p = panel.getBoundingClientRect();
    const row = document.querySelector("#app .mdm-favorites").getBoundingClientRect();
    const hit = document.elementFromPoint(p.left + 20, (row.top + row.bottom) / 2);
    return { covers: p.top < row.bottom && p.bottom > row.top, onTop: !!hit && panel.contains(hit) };
  });
  assert.deepEqual(over, { covers: true, onTop: true }, "the menu is not over the row");
  // The pointer on a button of the row with a panel of its own, outside the
  // menu: the menu stays, and the button neither opens nor shows its tip.
  // Down from the word into its menu first, then along the row, so that the
  // pointer crosses no other word (which would open that word's menu, as a
  // menu bar does).
  const insert = await h.page.$eval('#app .mdm-word[data-type="menu-insert"]', (w) => {
    const r = w.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const heading = await button(h.page, "headings");
  await h.page.mouse.move(insert.x, insert.y);
  await h.page.mouse.move(insert.x, heading.y, { steps: 3 });
  await h.page.mouse.move(heading.x, heading.y, { steps: 6 });
  await sleep(500);
  const state = await h.page.evaluate(() => ({
    open: Array.from(document.querySelectorAll("#app .mdm-toolbar__item--open > button")).map((b) => b.getAttribute("data-type")),
    tip: getComputedStyle(document.querySelector('#app .mdm-favorites button[data-type="headings"]'), "::after").display,
  }));
  assert.deepEqual(state, { open: ["menu-insert"], tip: "none" });
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the player's row and the search row open under the row of favorites (FV10)", { skip }, async () => {
  const h = await withRow({ text: SCORED, scores: 1 });
  await h.page.evaluate(() => document.querySelector("#app .mdm-score .mdm-audio-toggle").click());
  await h.page.waitForFunction(() => document.querySelector("#app .mdm-toolbar .mdm-audio"));
  await h.page.evaluate(() => document.activeElement && document.activeElement.blur());
  await h.page.keyboard.down("Control");
  await h.page.keyboard.press("f");
  await h.page.keyboard.up("Control");
  await h.page.waitForFunction(() => document.querySelector("#app .cm-panels-top .mdm-search"));
  await sleep(200);
  const boxes = await h.page.evaluate(() => {
    const box = (s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return [Math.round(r.top), Math.round(r.bottom)];
    };
    return { words: box("#app .mdm-word"), row: box("#app .mdm-favorites"), player: box("#app .mdm-toolbar > .mdm-audio"), search: box("#app .cm-panels-top") };
  });
  assert.ok(boxes.words[1] <= boxes.row[0], "the row is not under the words: " + JSON.stringify(boxes));
  assert.ok(boxes.row[1] <= boxes.player[0], "the player's row is not under the row: " + JSON.stringify(boxes));
  assert.ok(boxes.player[1] <= boxes.search[0], "the search row is not under the player's: " + JSON.stringify(boxes));
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A press on the chrome puts away the block being edited, all but a press on
// what works on the selection (dismissFromOutside): the rows of Format and
// Insert, and their buttons on the row, whose press comes before the work
// it is for. Without that, the selection in a table's source is moved out of
// the table by the press, and the mark or the symbol lands after it.
const TABLE = ["Before.", "", "| a | b |", "|---|---|", "| one | two |", "", "After.", ""].join("\n");

test("with a table's source open, Bold of the row and a music symbol of Insert work on the selection in the table (FV11)", { skip }, async () => {
  const h = await withRow({ text: TABLE });
  const one = await posOf(h.page, "one");
  await setSelection(h.page, [{ anchor: one, head: one + 3 }]);
  await sleep(250);
  await press(h.page, "bold");
  await sleep(200);
  assert.ok((await docText(h.page)).includes("| **one** | two |"), "Bold did not mark the word in the cell: " + JSON.stringify(await docText(h.page)));
  await setSelection(h.page, await posOf(h.page, "two", 3));
  await sleep(250);
  await pressBar(h.page, "insert-symbol");
  await sleep(150);
  await h.page.click('#app .mdm-word[data-type="menu-insert"] + .mdm-menu [data-type="symbol-quarter"]');
  await sleep(200);
  assert.ok((await docText(h.page)).includes("two\u{1D15F}"), "the symbol was not written in the cell: " + JSON.stringify(await docText(h.page)));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("with a table's source open, the » and its Equation work on the selection in the table, as the Insert menu does (FV12)", { skip }, async () => {
  const h = await withRow({ text: TABLE });
  await h.page.setViewport({ width: 470, height: 700 });
  await sleep(250);
  assert.ok((await rowSeen(h.page)).includes("favorites-more"), "the inserts are not in the » at this width, so this reads nothing");
  const one = await posOf(h.page, "one");
  await setSelection(h.page, [{ anchor: one, head: one + 3 }]);
  await sleep(250);
  await press(h.page, "favorites-more");
  await sleep(150);
  await h.page.click('#app .mdm-favorites [data-type="favorites-more"] + .mdm-menu button[data-type="insert-equation"]');
  await sleep(200);
  assert.ok((await docText(h.page)).includes("| $one$ | two |"), "Equation from the » did not wrap the word in the cell: " + JSON.stringify(await docText(h.page)));
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner, 2026-11-20: "Zoom muestre al lado el porciento". The figure
// stands in the button, right of the glass, in the type of the words (the
// words' own reading at the end of the bar is a word), its figures of one
// width; it follows the zoom however it is stepped; and while it is in
// sight the words' reading, which said the same at the other end of the
// bar, is put away. It comes back with the row put away, and with the glass
// gathered into the » by a narrow pane.
test("the magnifier says the zoom beside its glass, follows it, and stands in for the words' reading while it is in sight (FV13)", { skip }, async () => {
  const h = await withRow();
  await h.page.setViewport({ width: 920, height: 700 });
  await sleep(250);
  const read = () =>
    h.page.evaluate(() => {
      const b = document.querySelector('#app .mdm-favorites > .mdm-toolbar__item > button[data-type="mdm-zoom"]');
      const fig = b.querySelector(".mdm-btn__reading");
      const glass = b.querySelector(":scope > svg").getBoundingClientRect();
      const f = fig.getBoundingClientRect();
      const word = document.querySelector('#app .mdm-word[data-type="menu-edit"]');
      const type = (el) => {
        const c = getComputedStyle(el);
        return [c.fontFamily, c.fontSize, c.fontWeight, c.color];
      };
      const end = document.querySelector('#app .mdm-toolbar button[data-type="zoom-reading"]');
      const box = b.getBoundingClientRect();
      return {
        says: fig.textContent,
        beside: f.left >= glass.right && f.right <= box.right && Math.abs((f.top + f.bottom) / 2 - (glass.top + glass.bottom) / 2) < 1.5,
        type: JSON.stringify(type(fig)) === JSON.stringify(type(word)),
        figures: getComputedStyle(fig).fontVariantNumeric,
        tall: box.height,
        wide: Math.round(box.width * 10) / 10,
        tip: b.getAttribute("aria-label"),
        words: !!end && end.getClientRects().length > 0,
        shown: b.getClientRects().length > 0,
      };
    });
  const at100 = await read();
  assert.equal(at100.says, "100%");
  assert.ok(at100.beside, "the figure does not stand right of the glass, in the button, level with it");
  assert.ok(at100.type, "the figure is not in the type of the words");
  assert.equal(at100.figures, "tabular-nums", "the figures are not of one width");
  assert.equal(at100.tall, 28, "the button is not one height with the others");
  assert.equal(at100.tip, "Zoom");
  // A step in from the glass's own panel: the figure follows, the button
  // keeps its width, and the words' reading, which a zoom off 100 brings,
  // stays away while this one is in sight.
  await press(h.page, "mdm-zoom");
  await sleep(150);
  await h.page.click('#app .mdm-favorites [data-type="mdm-zoom"] + .mdm-menu [data-type="zoom-in"]');
  await sleep(200);
  const at110 = await read();
  assert.equal(at110.says, "110%");
  assert.equal(at110.wide, at100.wide, "the button changed width with the figure");
  assert.equal(await h.page.evaluate(() => document.getElementById("app").classList.contains("mdm-zoomed")), true, "the page is not zoomed, so the words' reading reads nothing");
  assert.equal(at110.words, false, "the bar says the zoom twice");
  // And by the keys, which step it as the panel does.
  await h.page.evaluate(() => window.__mdm.view.focus());
  await h.page.keyboard.down("Control");
  await h.page.keyboard.press("=");
  await h.page.keyboard.up("Control");
  await sleep(200);
  assert.equal((await read()).says, "125%");
  // The row put away: the words' reading is the one there is.
  await postSettings(h.page, { favorites: "hidden" });
  await sleep(200);
  assert.equal((await read()).words, true, "with the row put away the bar does not say the zoom");
  await postSettings(h.page, { favorites: "shown" });
  await sleep(250);
  assert.equal((await read()).words, false, "the row came back and the bar says the zoom twice");
  // A pane that gathers the glass into the »: the words' reading again.
  let gathered = null;
  for (const width of [800, 600, 470, 360, 250, 200, 130]) {
    await h.page.setViewport({ width, height: 700 });
    await sleep(250);
    const r = await read();
    if (!r.shown) {
      gathered = r;
      break;
    }
  }
  assert.ok(gathered, "no pane tried gathered the glass into the »");
  assert.equal(gathered.words, true, "the glass went into the » and the bar no longer says the zoom");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner, 2026-11-20: "cuando pongo el cursor encima de un icono
// desactivado no sale cartel, creo que siempre debería salir cartel". A
// greyed button kept the pointer off it (pointer-events: none), so its tip,
// drawn under :hover, never came. It takes the pointer now and says what it
// is; what greys is its glyph, at the weight of a greyed row; no wash comes
// under the pointer; and a press does nothing, with nothing to undo as under
// the score mode, a button with a panel as one without.
test("a greyed button keeps its tip: under the pointer it says what it is, its glyph at a greyed row's weight, and a press does nothing (FV14)", { skip }, async () => {
  const h = await withRow({ text: SCORED, scores: 1 });
  await h.page.setViewport({ width: 1000, height: 700 });
  await sleep(250);
  const pointAt = async (name) => {
    const b = await button(h.page, name);
    await h.page.mouse.move(b.x, b.y);
    await sleep(500);
    return h.page.evaluate((name) => {
      const el = document.querySelector('#app .mdm-favorites > .mdm-toolbar__item > button[data-type="' + name + '"]');
      const tip = getComputedStyle(el, "::after");
      return {
        tip: tip.opacity === "1" && tip.display !== "none",
        says: el.getAttribute("aria-label"),
        glyph: getComputedStyle(el.querySelector(":scope > svg")).opacity,
        ground: getComputedStyle(el).backgroundColor,
        cursor: getComputedStyle(el).cursor,
      };
    }, name);
  };
  const rowWeight = await h.page.evaluate(() => getComputedStyle(document.querySelector('#app .mdm-word[data-type="menu-edit"] + .mdm-menu [data-type="undo"]')).opacity);
  assert.equal(rowWeight, "0.35", "the row of Undo is not greyed, so the weights compare nothing");
  const bare = "rgba(0, 0, 0, 0)";
  // Nothing to undo.
  assert.deepEqual(await pointAt("undo"), { tip: true, says: "Undo (Ctrl+Z)", glyph: rowWeight, ground: bare, cursor: "default" });
  assert.deepEqual(await pointAt("redo"), { tip: true, says: "Redo (Ctrl+Y)", glyph: rowWeight, ground: bare, cursor: "default" });
  const before = await docText(h.page);
  await press(h.page, "redo");
  await sleep(150);
  assert.equal(await docText(h.page), before, "a greyed Redo did something");
  // Under the score mode: a button that writes and one with a panel.
  const prose = await posOf(h.page, "prose");
  await setSelection(h.page, [{ anchor: prose, head: prose + 5 }]);
  await pressBar(h.page, "mdm-score-navigation");
  await h.page.waitForFunction(() => document.getElementById("app").classList.contains("mdm--score-mode"));
  await sleep(200);
  const frozen = await docText(h.page);
  assert.deepEqual(await pointAt("bold"), { tip: true, says: "Bold (Ctrl+B)", glyph: rowWeight, ground: bare, cursor: "default" });
  assert.deepEqual(await pointAt("headings"), { tip: true, says: "Heading", glyph: rowWeight, ground: bare, cursor: "default" });
  await press(h.page, "bold");
  await sleep(150);
  await press(h.page, "headings");
  await sleep(150);
  await press(h.page, "code-block");
  await sleep(150);
  assert.equal(await docText(h.page), frozen, "a greyed button wrote into the text under the mode");
  assert.equal(await h.page.$$eval("#app .mdm-toolbar__item--open", (els) => els.length), 0, "a greyed button opened its panel under the mode");
  // What the mode leaves alone is as it was under the pointer: the wash.
  const glass = await pointAt("mdm-zoom");
  assert.equal(glass.glyph, "1");
  assert.notEqual(glass.ground, bare, "a button the mode leaves alone has no wash under the pointer");
  // Out of the mode every one is lit again, the wash under the pointer.
  await pressBar(h.page, "mdm-score-navigation");
  await h.page.waitForFunction(() => !document.getElementById("app").classList.contains("mdm--score-mode"));
  await sleep(200);
  const bold = await pointAt("bold");
  assert.equal(bold.glyph, "1", "Bold is still greyed out of the mode");
  assert.notEqual(bold.ground, bare, "Bold has no wash under the pointer out of the mode");
  assert.equal(bold.cursor, "pointer");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's picks of 2026-11-20 from design/design-row-icons.html, the
// glyphs of B and B: the outline wears the panel it opens, a window with a
// column of lines down its left, where the outline stands beside the page,
// and so the twin of the score's Side panel, the same kind of window with
// its right part filled; Undo wears a U-turn, back along the top to a head
// at its left, the turn on the right and the tail under, open between them,
// and Redo is Undo mirrored. Today's ring (nearly a whole circle) and the
// stack of headings with dots (the bulleted list's drawing, near enough)
// fail it. Each is one drawing wherever it stands: the outline at the head
// of the row and on its row of Page, Undo and Redo on the row and on the
// Edit menu (FV02 and SM119 hold the rest). Read by where a drawing is
// filled, on a copy of it set down in sight, in its own 16 units.
test("the outline wears the panel it opens and Undo and Redo a U-turn, Redo the mirror of Undo, one drawing wherever they stand (FV15)", { skip }, async () => {
  const h = await withRow();
  await h.page.setViewport({ width: 1000, height: 700 });
  await sleep(250);
  const glyphs = await h.page.evaluate(() => {
    const svg = (sel) => (document.querySelector(sel) || { outerHTML: "" }).outerHTML;
    const row = (name) => svg('#app .mdm-favorites > .mdm-toolbar__item > button[data-type="' + name + '"] > svg');
    const menu = (word, name) => svg('#app .mdm-word[data-type="' + word + '"] + .mdm-menu [data-type="' + name + '"] .mdm-menu__icon svg');
    return {
      outline: [row("outline"), menu("menu-page", "page-outline")],
      undo: [row("undo"), menu("menu-edit", "undo")],
      redo: [row("redo"), menu("menu-edit", "redo")],
      panel: menu("menu-score", "mdm-score-panel"),
    };
  });
  for (const name of ["outline", "undo", "redo"]) {
    assert.ok(glyphs[name][0], name + " has no glyph on the row");
    assert.equal(glyphs[name][1], glyphs[name][0], name + " draws another glyph on its row of the menu");
  }
  assert.ok(glyphs.panel, "the Side panel's row has no glyph");
  // Whether each point of a drawing is filled, and the box of the drawing.
  const read = (html, points) =>
    h.page.evaluate(
      (html, points) => {
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;left:0;top:0;width:160px;height:160px;z-index:99";
        host.innerHTML = html;
        document.body.appendChild(host);
        const svg = host.querySelector("svg");
        svg.setAttribute("width", "160");
        svg.setAttribute("height", "160");
        const shapes = Array.from(svg.querySelectorAll("path, rect, circle, ellipse, polygon"));
        const filled = points.map(([x, y]) => shapes.some((s) => s.isPointInFill(new DOMPoint(x, y))));
        const b = svg.getBBox();
        host.remove();
        return { filled, box: [b.x, b.y, b.x + b.width, b.y + b.height].map((v) => Math.round(v * 100) / 100) };
      },
      html,
      points
    );
  const check = async (what, html, marks) => {
    const got = await read(html, marks.map((m) => m[0]));
    marks.forEach(([p, want, says], i) => assert.equal(got.filled[i], want, what + ": " + says + " at " + p));
    return got;
  };
  // The outline: the window, its column, three lines in it, and the rest of
  // the window empty.
  await check("the outline", glyphs.outline[0], [
    [[1.6, 8], true, "the window's left side"],
    [[14.4, 8], true, "the window's right side"],
    [[8, 3], true, "the window's top"],
    [[8, 13], true, "the window's foot"],
    [[7.05, 8], true, "the column's edge"],
    [[4.5, 5.9], true, "the column's first line"],
    [[4.5, 8.1], true, "its second line"],
    [[4.5, 10.3], true, "its third line"],
    [[4.5, 7], false, "a gap between two lines"],
    [[10.5, 8], false, "the page beside the column"],
    [[12, 5], false, "the page beside the column"],
  ]);
  // The Side panel, the same kind of window, filled on its own side.
  await check("the Side panel", glyphs.panel, [
    [[1.6, 8], true, "the window's left side"],
    [[11.5, 8], true, "the panel down its right"],
    [[5, 8], false, "the page beside the panel"],
  ]);
  // Undo: the head at the top left, the way back; the stroke along the top,
  // the turn on the right and the tail under it, open between them and
  // under the head.
  const UNDO = [
    [[1.6, 5], true, "the head's point"],
    [[3.5, 5], true, "the head"],
    [[9, 5], true, "the stroke along the top"],
    [[14, 8.75], true, "the turn on the right"],
    [[9, 12.5], true, "the tail under"],
    [[9, 8.75], false, "the open middle of the turn"],
    [[3, 11], false, "under the head, left of the tail"],
    [[10, 2.5], false, "over the stroke"],
  ];
  const undo = await check("Undo", glyphs.undo[0], UNDO);
  const redo = await check("Redo", glyphs.redo[0], UNDO.map(([[x, y], want, says]) => [[16 - x, y], want, says + ", mirrored"]));
  assert.deepEqual(redo.box, [16 - undo.box[2], undo.box[1], 16 - undo.box[0], undo.box[3]].map((v) => Math.round(v * 100) / 100), "Redo is not Undo mirrored");
  assert.deepEqual(h.errors, []);
  await h.close();
});
