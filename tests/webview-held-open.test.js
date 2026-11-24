// Several drawings open at once (heldField and the section "Several drawings
// open at once" in vscode-mdm/media/main.js). The owner's ask of 2026-11-21,
// on tipos-de-barra.mdm: with Shift down, a click on score 1 and then one on
// score 3 show the code of the three, to be edited together with a
// multicursor; with Ctrl (on Windows and Linux; the Mac's key was left to
// be chosen, and is Cmd) each click chooses one more; a click outside puts
// them all away, as always, and a click on the drawing of one of them puts
// that one away alone.
//
// What a click on a drawing does is one behaviour for every drawn block
// (CLAUDE.md), so the tests here name every one: a score, a table, an
// equation in its block and in a line, a figure and a picture in a line,
// and the title block the header draws. The header's
// source is put in the text by the host (webview-title.test.js says how),
// and a test here plays the host as that file does.
// Run with: node --test --test-concurrency=1 tests/webview-held-open.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { frontMatter } = require("../vscode-mdm/transforms.js");
const { open, update, skip, docText, posOf, setSelection, selectionRanges, clickAt } = require("./webview/helpers.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HEADER = ["---", 'title: "Held open"', "lang: en", "---", ""].join("\n");
// Two scores with a table and an equation between them, prose between every
// two, a heading under the last score, and enough prose after it that a
// change to one block is a small part of the document (the partial rebuild
// of the drawing, which checkDecorations holds to a whole one).
// The prose before the first score is long enough for the page to hold a
// drawing under the pointer as a source over it goes (putAwayOne): at the
// head of the text there is nothing to scroll back by. Under the last score,
// the drawings that joined on 2026-11-21: an equation in a line, a picture
// in a line and a figure, the two pictures small SVGs written into the text
// (a PNG of this suite does not load, TCP3 in tests/README.md).
const RECT = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iODAiPjxyZWN0IHdpZHRoPSIxNjAiIGhlaWdodD0iODAiIGZpbGw9IiNiMDhkNTciLz48L3N2Zz4=";
const DOT = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiNiMDhkNTciLz48L3N2Zz4=";
const BODY = []
  .concat(
    Array.from({ length: 8 }, (_, i) => "Opening paragraph " + (i + 1) + ", before any drawing.\n"),
    ["Prose before the first score.", ""],
    ["```abc", "X:1", "K:C", "CDEF|", "```", ""],
    ["Prose between the first score and the table.", ""],
    // A caption beside the table with an equation in it, which is the
    // table's drawing and gets no caret of its own in a range.
    ["| a | b |", "|---|---|", "| 1 | 2 |", "", ": Values of $k$ in a table.", ""],
    ["Prose between the table and the equation.", ""],
    ["$$", "e^{i\\pi} + 1 = 0", "$$", ""],
    ["Prose between the equation and the last score.", ""],
    ["```abc", "X:2", "K:G", "GABc|", "```", ""],
    ["## A heading under the last score", ""],
    ["A line with $x^2 + y^2$ in it and a dot ![dot](" + DOT + ") among its words.", ""],
    // Labelled, so that the figures' count reads it as well.
    ["![A figure.](" + RECT + "){#fig-held}", ""],
    ["Prose at the end.", ""],
    Array.from({ length: 60 }, (_, i) => "Paragraph " + (i + 1) + " of what follows, so that one block is a small part of the text.\n")
  )
  .join("\n");
const TEXT = HEADER + "\n" + BODY;

const SCORE = "#app .mdm-score code.language-abc svg";
const TABLE = "#app .mdm-table td";
const EQUATION = "#app .mdm-math--block .katex-display";
const TITLE = "#app .mdm-title-block .mdm-title";
// The equation and the picture in the line, shut and as the preview after
// their open source, and the figure, shut or open.
const INLINE_EQ = "#app .cm-line .mdm-math:not(.mdm-math--block):not(.mdm-math--preview)";
const INLINE_EQ_PREVIEW = "#app .cm-line .mdm-math--preview";
const DOT_IMG = '#app .cm-line img.mdm-image[alt="dot"]:not(.mdm-image--preview)';
const DOT_PREVIEW = "#app .cm-line img.mdm-image--preview";
const FIGURE = "#app .mdm-figure img";

// The key that chooses a drawing, Ctrl on Windows and Linux and Cmd on a
// Mac (choosesDrawing). Chrome on a Mac makes a Ctrl+click the right
// button's, a mousedown, a contextmenu and a mouseup with no click after
// them (measured 2026-11-21), which is why Cmd is the Mac's key; and it does
// so whatever platform the page is told, so on a Mac the page is told it is
// one and Cmd is pressed, Cmd+Z with it for an undo. Ctrl+click is held on
// Windows and Linux by the same tests run there.
const MAC = process.platform === "darwin";
const CHOOSE = MAC ? "Meta" : "Control";
const MOD = MAC ? "Meta" : "Control";

// The editor on the document with its header put away, as the host hands
// every document over, at a height that has every drawing on the screen
// once the first score is brought to the top of the pane (top).
const editor = (more) =>
  open(
    Object.assign(
      { text: TEXT, scores: 2, withFrontMatter: false, frontMatter: frontMatter(TEXT), height: 2000, platform: MAC ? "MacIntel" : "Linux x86_64" },
      more || {}
    )
  );
// The page scrolled to put the prose just over the first score at the top
// of the pane, with the opening paragraphs above it to scroll back by.
const top = async (page) => {
  const at = await posOf(page, "Prose before the first score.");
  await page.evaluate((at) => {
    const view = window.__mdm.view;
    view.dispatch({ effects: window.__mdm.CM.EditorView.scrollIntoView(at, { y: "start", yMargin: 10 }) });
  }, at);
  await sleep(300);
};
// The host's answer to a `header` message: the text with the header's
// source in it, or without.
const answer = (page, shown) => update(page, TEXT, shown, 2, frontMatter(TEXT));
const PEEK = { type: "header", open: true, peek: true };
const LEAVE = { type: "header", open: false, peek: true };
const headerPosts = (page) => page.evaluate(() => window.__posts.filter((m) => m.type === "header"));
const forgetPosts = (page) =>
  page.evaluate(() => {
    window.__posts.length = 0;
  });

// Which drawings have their source open, read off their rails (the widget's
// own reading of the carets, .mdm-chrome--open) and the title block's class,
// with the source lines that show, the carets and the focus.
const shown = (page) =>
  page.evaluate(() => {
    const opened = (sel) =>
      Array.from(document.querySelectorAll(sel)).map((el) => {
        const rail = el.querySelector(":scope > .mdm-chrome");
        return !!rail && rail.classList.contains("mdm-chrome--open");
      });
    const title = document.querySelector("#app .mdm-title-block");
    const view = window.__mdm.view;
    return {
      scores: opened("#app .mdm-score"),
      table: opened("#app .mdm-table")[0],
      equation: opened("#app .mdm-math--block")[0],
      title: !!title && title.classList.contains("mdm-title-block--open"),
      // The equation in the line by its source on show, the picture in the
      // line by its preview, the figure by its class.
      inline: document.querySelectorAll("#app .mdm-math-src").length > 0,
      dot: !!document.querySelector("#app img.mdm-image--preview"),
      figure: !!document.querySelector("#app .mdm-figure--open"),
      abc: document.querySelectorAll("#app .cm-line.mdm-abc-line").length,
      carets: view.state.selection.ranges.length,
      focus: view.hasFocus,
    };
  });

// The middle of the `index`th drawing that matches, which has to be on the
// pane to be clicked.
const box = (page, sel, index) =>
  page.evaluate(
    (sel, index) => {
      const el = document.querySelectorAll(sel)[index || 0];
      if (!el) throw new Error("nothing drawn for " + sel);
      const r = el.getBoundingClientRect();
      const pane = window.__mdm.view.scrollDOM.getBoundingClientRect();
      const at = { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 };
      if (at.y <= pane.top || at.y >= pane.bottom) throw new Error(sel + " is off the pane, at " + Math.round(at.y));
      return at;
    },
    sel,
    index
  );

// A click on a drawing with `keys` held, spaced from the click before it so
// that two on one spot are not read as a double.
const press = async (page, sel, index, keys) => {
  const at = await box(page, sel, index);
  await sleep(600);
  for (const k of keys || []) await page.keyboard.down(k);
  await page.mouse.click(at.x, at.y);
  for (const k of (keys || []).slice().reverse()) await page.keyboard.up(k);
  await sleep(350);
};

const margin = (page) =>
  page.evaluate(() => {
    const c = window.__mdm.view.contentDOM.getBoundingClientRect();
    const s = window.__mdm.view.scrollDOM.getBoundingClientRect();
    return { x: c.right + 60, y: s.top + 20 };
  });

// What the drawing on screen is against a drawing of the whole document:
// null where the two agree.
const drift = (page) => page.evaluate(() => window.__mdm.checkDecorations());

test("Shift+click on a drawing shows every drawing from the caret's to it, with a caret in each, and they stay through a click in any of their sources", { skip }, async () => {
  const h = await editor();
  try {
    await top(h.page);
    await press(h.page, SCORE, 0);
    let seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation], [[true, false], false, false], "the first score did not open alone");

    // To the last score: the table and the equation between open with it,
    // each with a caret where a click on it alone puts one (a score and an
    // equation at the head of their source, a table at its first row), and
    // the last score's is the main one.
    await press(h.page, SCORE, 1, ["Shift"]);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.focus], [[true, true], true, true, true], JSON.stringify(seen));
    const heads = [await posOf(h.page, "X:1"), await posOf(h.page, "| a |"), await posOf(h.page, "e^{i"), await posOf(h.page, "X:2")];
    assert.deepEqual(await selectionRanges(h.page), heads.map((p) => [p, p]), "the carets are not one in each drawing");
    assert.equal(await h.page.evaluate(() => window.__mdm.view.state.selection.main.head), heads[3], "the main caret is not the clicked score's");
    assert.equal(await drift(h.page), null);

    // A plain click into one source, to put the caret where an edit goes,
    // leaves the others showing: they are held, not hanging on the carets.
    await clickAt(h.page, (await posOf(h.page, "| 1 | 2 |")) + 2);
    await sleep(250);
    seen = await shown(h.page);
    assert.equal(seen.carets, 1);
    assert.deepEqual([seen.scores, seen.table, seen.equation], [[true, true], true, true], "a click into the table's source put the others away");
    // And the arrows walk out of a source into the prose with the others
    // still showing, as scrolling leaves them.
    for (let i = 0; i < 3; i++) await h.page.keyboard.press("ArrowDown");
    await sleep(250);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation], [[true, true], true, true], "the arrows put the drawings away");

    // From the first score to the equation, the last score left shut; and
    // Shift on a drawing never shuts one: on the table, open, it makes the
    // table's caret the main one and leaves the rest as they are.
    await clickAt(h.page, await posOf(h.page, "Prose at the end."));
    await sleep(250);
    await top(h.page);
    await press(h.page, SCORE, 0);
    await press(h.page, EQUATION, 0, ["Shift"]);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.carets], [[true, false], true, true, 3], "Shift+click from the first score to the equation: " + JSON.stringify(seen));
    await press(h.page, TABLE, 0, ["Shift"]);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.carets], [[true, false], true, true, 3], "Shift+click on the open table: " + JSON.stringify(seen));
    assert.equal(await h.page.evaluate(() => window.__mdm.view.state.selection.main.head), heads[1], "the table's caret is not the main one");
    assert.equal(await drift(h.page), null);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("Ctrl+click chooses the drawings one at a time, puts one that is open away from among them, and the carets it adds edit them all at once", { skip }, async () => {
  const h = await editor();
  try {
    await top(h.page);
    await press(h.page, SCORE, 0, [CHOOSE]);
    await press(h.page, SCORE, 1, [CHOOSE]);
    let seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.carets], [[true, true], false, false, 2], JSON.stringify(seen));

    // The two carets, one at the head of each tune, write into both.
    const before = await docText(h.page);
    await h.page.keyboard.press("End");
    await h.page.keyboard.type("0");
    await sleep(200);
    const typed = await docText(h.page);
    assert.ok(typed.includes("X:10\n") && typed.includes("X:20\n"), "what was typed did not go into both tunes");
    await h.page.keyboard.down(MOD);
    await h.page.keyboard.press("z");
    await h.page.keyboard.up(MOD);
    await sleep(200);
    assert.equal(await docText(h.page), before);

    // The table and the equation join them.
    await press(h.page, TABLE, 0, [CHOOSE]);
    await press(h.page, EQUATION, 0, [CHOOSE]);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.carets], [[true, true], true, true, 4], JSON.stringify(seen));
    assert.equal(await drift(h.page), null);

    // Ctrl on one that is open puts it away, and its caret with it; the
    // others stay, and so does the focus.
    await press(h.page, SCORE, 0, [CHOOSE]);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.carets, seen.focus], [[false, true], true, true, 3, true], JSON.stringify(seen));
    await press(h.page, TABLE, 0, [CHOOSE]);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.carets], [[false, true], false, true, 2], JSON.stringify(seen));
    assert.equal(await drift(h.page), null);

    // A plain click into the last score's source keeps the equation, which
    // holds no caret then.
    await clickAt(h.page, (await posOf(h.page, "GABc")) + 1);
    await sleep(250);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.equation, seen.carets], [[false, true], true, 1], "a click into the score's source put the equation away");

    // A double click with the key down is one click of it: the second press
    // does not open again what the first put away. The second press comes
    // a little after the first, as a hand's does: sent in the same task, as
    // puppeteer's `count: 2` sends it, it lands before the page has put the
    // drawing back under the pointer (keepDrawingAt, a frame later), on the
    // source of the score below.
    const eq = await box(h.page, EQUATION, 0);
    await sleep(600);
    await h.page.keyboard.down(CHOOSE);
    await h.page.mouse.move(eq.x, eq.y);
    await h.page.mouse.down();
    await h.page.mouse.up();
    await sleep(120);
    await h.page.mouse.down({ clickCount: 2 });
    await h.page.mouse.up({ clickCount: 2 });
    await h.page.keyboard.up(CHOOSE);
    await sleep(350);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.equation], [[false, true], false], "the second press of a double click opened the equation again: " + JSON.stringify(seen));
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("a plain click on one of several open drawings puts that one away alone, and a click outside them puts them all away", { skip }, async () => {
  const h = await editor();
  try {
    await top(h.page);
    const all = async () => {
      await top(h.page);
      await press(h.page, SCORE, 0);
      await press(h.page, SCORE, 1, ["Shift"]);
      const seen = await shown(h.page);
      assert.deepEqual([seen.scores, seen.table, seen.equation], [[true, true], true, true], "the four did not open");
    };
    await all();
    // A plain click on a drawing that is open, among others: it goes, and
    // the caret it held with it; the rest stay, the document focused.
    for (const [sel, index, name] of [[EQUATION, 0, "equation"], [TABLE, 0, "table"], [SCORE, 0, "first score"]]) {
      const top = (await box(h.page, sel, index)).y;
      await press(h.page, sel, index);
      const seen = await shown(h.page);
      assert.equal(seen.focus, true, "the " + name + " left the document to nobody");
      // Held under the pointer while its source goes from over it.
      const after = (await box(h.page, sel, index)).y;
      assert.ok(Math.abs(after - top) <= 2, "the " + name + " moved " + Math.round(after - top) + "px from under the pointer");
      if (name === "equation") assert.deepEqual([seen.scores, seen.table, seen.equation, seen.carets], [[true, true], true, false, 3], JSON.stringify(seen));
      if (name === "table") assert.deepEqual([seen.scores, seen.table, seen.equation, seen.carets], [[true, true], false, false, 2], JSON.stringify(seen));
      if (name === "first score") assert.deepEqual([seen.scores, seen.carets], [[false, true], 1], JSON.stringify(seen));
    }
    // The last of them goes as a single source goes on its second click:
    // all of it, and the document left to nobody.
    await press(h.page, SCORE, 1);
    let seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.focus], [[false, false], false, false, false], JSON.stringify(seen));

    // Where the only carets were in the one put away, a caret goes to the
    // nearest one still open, so that nothing is typed where nothing shows.
    await all();
    await clickAt(h.page, (await posOf(h.page, "| 1 | 2 |")) + 2);
    await sleep(250);
    await press(h.page, TABLE, 0);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.carets], [[true, true], false, true, 1], JSON.stringify(seen));
    const head = await h.page.evaluate(() => window.__mdm.view.state.selection.main.head);
    assert.ok([await posOf(h.page, "X:1"), await posOf(h.page, "e^{i")].includes(head), "the caret went to " + head);

    // A click in the prose puts them all away.
    await clickAt(h.page, await posOf(h.page, "Prose at the end."));
    await sleep(250);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.abc], [[false, false], false, false, 0], "a click in the prose left some open: " + JSON.stringify(seen));

    // And so does the dead margin.
    await all();
    const m = await margin(h.page);
    await sleep(600);
    await h.page.mouse.click(m.x, m.y);
    await sleep(300);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.focus], [[false, false], false, false, false], "the margin left some open");

    // And a press on the bar, which takes no focus from the text: Page.
    await all();
    const word = await h.page.evaluate(() => {
      const b = document.querySelector('#app .mdm-toolbar__item > button[data-type="menu-page"]');
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await sleep(600);
    await h.page.mouse.click(word.x, word.y);
    await sleep(300);
    await h.page.keyboard.press("Escape");
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation], [[false, false], false, false], "a press on the bar left some open");

    // A plain click on a drawing that is shut shows it and no other, as a
    // click on a drawing always has.
    await all();
    await clickAt(h.page, await posOf(h.page, "Prose before the first score."));
    await sleep(250);
    await top(h.page);
    await press(h.page, SCORE, 0, [CHOOSE]);
    await press(h.page, SCORE, 1, [CHOOSE]);
    await press(h.page, TABLE, 0);
    seen = await shown(h.page);
    assert.deepEqual([seen.scores, seen.table, seen.equation, seen.carets], [[false, false], true, false, 1], "a plain click on the table kept the scores: " + JSON.stringify(seen));
    assert.equal(await drift(h.page), null);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("the title block is shown beside the other drawings by Shift and by Ctrl, and put away alone, with the host on the other end", { skip }, async () => {
  const h = await editor();
  try {
    // The head of the document, where the title block stands.
    await h.page.evaluate(() => {
      window.__mdm.view.scrollDOM.scrollTop = 0;
    });
    // Shift+click on the title, with the caret in the first score: the host
    // is asked for the header, and its source joins the score's.
    await press(h.page, SCORE, 0);
    await forgetPosts(h.page);
    await press(h.page, TITLE, 0, ["Shift"]);
    assert.deepEqual(await headerPosts(h.page), [PEEK]);
    await answer(h.page, true);
    let seen = await shown(h.page);
    assert.deepEqual([seen.title, seen.scores, seen.carets], [true, [true, false], 2], JSON.stringify(seen));
    const line = await h.page.evaluate(() => {
      const state = window.__mdm.view.state;
      return state.doc.lineAt(state.selection.main.head).text;
    });
    assert.ok(line.startsWith("title:"), "the header's caret is on: " + line);

    // A plain click into the score's source keeps the header: no request
    // to put it away goes to the host.
    await forgetPosts(h.page);
    await clickAt(h.page, (await posOf(h.page, "CDEF")) + 1);
    await sleep(300);
    assert.deepEqual(await headerPosts(h.page), [], "a click into the score's source put the header away");
    assert.equal((await shown(h.page)).title, true);

    // A plain click on the title, open among others: it alone goes, the
    // score stays and the document keeps the focus.
    await press(h.page, TITLE, 0);
    assert.deepEqual(await headerPosts(h.page), [LEAVE]);
    await answer(h.page, false);
    seen = await shown(h.page);
    assert.deepEqual([seen.title, seen.scores, seen.focus], [false, [true, false], true], JSON.stringify(seen));

    // Ctrl+click chooses it, and Ctrl+click on it open puts it away again.
    await forgetPosts(h.page);
    await press(h.page, TITLE, 0, [CHOOSE]);
    assert.deepEqual(await headerPosts(h.page), [PEEK]);
    await answer(h.page, true);
    seen = await shown(h.page);
    assert.deepEqual([seen.title, seen.scores, seen.carets], [true, [true, false], 2], JSON.stringify(seen));
    await press(h.page, TITLE, 0, [CHOOSE]);
    assert.deepEqual(await headerPosts(h.page), [PEEK, LEAVE]);
    await answer(h.page, false);
    seen = await shown(h.page);
    assert.deepEqual([seen.title, seen.scores, seen.carets], [false, [true, false], 1], JSON.stringify(seen));

    // Shift+click on a score with the caret in the header's source: every
    // drawing from the header down to the score, the header held with them.
    await forgetPosts(h.page);
    await press(h.page, TITLE, 0);
    await answer(h.page, true);
    await press(h.page, TABLE, 0, ["Shift"]);
    seen = await shown(h.page);
    assert.deepEqual([seen.title, seen.scores, seen.table, seen.equation], [true, [true, false], true, false], JSON.stringify(seen));
    await clickAt(h.page, (await posOf(h.page, "CDEF")) + 1);
    await sleep(300);
    assert.deepEqual(await headerPosts(h.page), [PEEK], "a click into the score's source put the held header away");
    // A click in the prose puts them all away, the header by the host.
    await clickAt(h.page, await posOf(h.page, "Prose at the end."));
    await sleep(300);
    assert.deepEqual(await headerPosts(h.page), [PEEK, LEAVE]);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("on a Mac it is Cmd+click that chooses a drawing, and on Windows and Linux Ctrl+click and not the Windows key", { skip }, async () => {
  // Cmd on a Mac, and Ctrl there does not choose: it is the right button's
  // (the browser of a Mac sends it no click at all, so that half is pressed
  // only where the suite runs on Windows or Linux).
  const mac = await editor({ platform: "MacIntel" });
  try {
    await top(mac.page);
    await press(mac.page, SCORE, 0, ["Meta"]);
    await press(mac.page, TABLE, 0, ["Meta"]);
    let seen = await shown(mac.page);
    assert.deepEqual([seen.scores, seen.table, seen.carets], [[true, false], true, 2], "Cmd+click did not choose on a Mac: " + JSON.stringify(seen));
    if (!MAC) {
      await press(mac.page, SCORE, 1, ["Control"]);
      seen = await shown(mac.page);
      assert.deepEqual([seen.scores, seen.table], [[false, true], false], "Ctrl+click chose on a Mac: " + JSON.stringify(seen));
    }
    assert.deepEqual(mac.errors, []);
  } finally {
    await mac.close();
  }
  // On Windows and Linux the Windows key is no Ctrl: its click is a plain
  // one, which shows the drawing clicked and no other.
  const pc = await editor({ platform: "Linux x86_64" });
  try {
    await top(pc.page);
    if (!MAC) {
      await press(pc.page, SCORE, 0, ["Control"]);
      await press(pc.page, SCORE, 1, ["Control"]);
      const seen = await shown(pc.page);
      assert.deepEqual(seen.scores, [true, true], "Ctrl+click did not choose on Linux: " + JSON.stringify(seen));
    } else {
      await press(pc.page, SCORE, 0);
    }
    await press(pc.page, TABLE, 0, ["Meta"]);
    const seen = await shown(pc.page);
    assert.deepEqual([seen.scores, seen.table, seen.carets], [[false, false], true, 1], "the Windows key chose a drawing: " + JSON.stringify(seen));
    assert.deepEqual(pc.errors, []);
  } finally {
    await pc.close();
  }
});

test("the drawings held open are let go when nobody is in the document, and not when the window loses the focus", { skip }, async () => {
  const h = await editor();
  try {
    await top(h.page);
    await press(h.page, SCORE, 0, [CHOOSE]);
    await press(h.page, SCORE, 1, [CHOOSE]);
    await clickAt(h.page, (await posOf(h.page, "GABc")) + 1);
    await sleep(250);
    // Alt+Tab: the page is left with the focus where it was in it, and the
    // window's blur says nothing about who is in the document (syncFocus).
    await h.page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await sleep(200);
    let seen = await shown(h.page);
    assert.deepEqual(seen.scores, [true, true], "the window's blur put a held drawing away");
    // Nobody in the document any more, which a press on a bare part of the
    // page and the focus going nowhere say (leftByHand): what was held is
    // let go, and does not come back with the focus. The press is the right
    // button's, which puts nothing away by itself (dismissFromOutside).
    await h.page.evaluate(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2 }));
      document.activeElement.blur();
    });
    await sleep(200);
    await h.page.evaluate(() => window.__mdm.view.focus());
    await sleep(200);
    seen = await shown(h.page);
    assert.deepEqual(seen.scores, [false, true], "a held drawing came back with the focus");
    // And the drawing is what a whole rebuild gives: kept through the blur,
    // a held score would be open in the state and drawn shut by a partial
    // rebuild, whose spans the carets give.
    assert.equal(await drift(h.page), null);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("an equation in a line, a picture in a line and a figure are chosen with Ctrl, ranged with Shift and put away alone, as the other drawings are", { skip }, async () => {
  const h = await editor();
  try {
    await top(h.page);
    await press(h.page, INLINE_EQ, 0, [CHOOSE]);
    await press(h.page, DOT_IMG, 0, [CHOOSE]);
    await press(h.page, FIGURE, 0, [CHOOSE]);
    await press(h.page, SCORE, 1, [CHOOSE]);
    let seen = await shown(h.page);
    assert.deepEqual([seen.inline, seen.dot, seen.figure, seen.scores, seen.carets], [true, true, true, [false, true], 4], JSON.stringify(seen));
    // Each with its caret where a click on it alone puts one: the equation
    // at the head of its maths, the picture at its `![`, the figure at the
    // head of its paragraph, the score at the head of its tune.
    const doc = await docText(h.page);
    const heads = [doc.indexOf("x^2 + y^2"), doc.indexOf("![dot]"), doc.indexOf("![A figure."), doc.indexOf("X:2")].sort((a, b) => a - b);
    assert.deepEqual(await selectionRanges(h.page), heads.map((p) => [p, p]), "the carets are not one in each drawing");
    // The figure open is drawn under its source, its line on show.
    assert.ok(
      await h.page.evaluate(() => Array.from(document.querySelectorAll("#app .cm-line")).some((l) => l.textContent.startsWith("![A figure.]("))),
      "the figure's source is not on show"
    );
    assert.equal(await drift(h.page), null);

    // A plain click on the drawing of one puts it away alone: the figure,
    // the picture's preview, the equation's preview.
    await press(h.page, FIGURE, 0);
    seen = await shown(h.page);
    assert.deepEqual([seen.inline, seen.dot, seen.figure, seen.scores, seen.carets, seen.focus], [true, true, false, [false, true], 3, true], JSON.stringify(seen));
    await press(h.page, DOT_PREVIEW, 0);
    seen = await shown(h.page);
    assert.deepEqual([seen.inline, seen.dot, seen.figure, seen.scores, seen.carets], [true, false, false, [false, true], 2], JSON.stringify(seen));
    await press(h.page, INLINE_EQ_PREVIEW, 0);
    seen = await shown(h.page);
    assert.deepEqual([seen.inline, seen.dot, seen.figure, seen.scores, seen.carets], [false, false, false, [false, true], 1], JSON.stringify(seen));
    assert.equal(await drift(h.page), null);

    // Shift from the last score to the figure: the equation and the picture
    // in the line between open with them.
    await clickAt(h.page, await posOf(h.page, "Prose at the end."));
    await sleep(250);
    await press(h.page, SCORE, 1);
    await press(h.page, FIGURE, 0, ["Shift"]);
    seen = await shown(h.page);
    assert.deepEqual([seen.inline, seen.dot, seen.figure, seen.scores, seen.carets], [true, true, true, [false, true], 4], JSON.stringify(seen));
    // And they stay through a click into one of their sources, the score's,
    // with no caret left in the line's drawings or in the figure.
    await clickAt(h.page, (await posOf(h.page, "GABc")) + 1);
    await sleep(250);
    seen = await shown(h.page);
    assert.deepEqual([seen.inline, seen.dot, seen.figure, seen.scores, seen.carets], [true, true, true, [false, true], 1], JSON.stringify(seen));
    assert.equal(await drift(h.page), null);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("a picture shows its drawing under its open source, as a table does, and a second click on it puts the source away", { skip }, async () => {
  const h = await editor();
  try {
    await top(h.page);
    // A plain click on the figure: its source opens over it, the caret at
    // its `![`, and the figure stays drawn under it.
    await press(h.page, FIGURE, 0);
    let seen = await shown(h.page);
    assert.deepEqual([seen.figure, seen.carets, seen.focus], [true, 1, true], JSON.stringify(seen));
    const doc = await docText(h.page);
    assert.equal(await h.page.evaluate(() => window.__mdm.view.state.selection.main.head), doc.indexOf("![A figure."));
    // The second click puts it away, the figure held under the pointer as
    // its line goes from over it, and the document left to nobody.
    const top0 = (await box(h.page, FIGURE, 0)).y;
    await press(h.page, FIGURE, 0);
    seen = await shown(h.page);
    assert.deepEqual([seen.figure, seen.focus], [false, false], JSON.stringify(seen));
    const top1 = (await box(h.page, FIGURE, 0)).y;
    assert.ok(Math.abs(top1 - top0) <= 2, "the figure moved " + Math.round(top1 - top0) + "px from under the pointer");

    // A picture in a line: a plain click puts the caret beside it, which
    // opens its source, and the picture stands after the source as its
    // preview; a click on the preview puts the source away. The plain click
    // is CodeMirror's, as on the text around it: on the right half of the
    // picture the caret goes after it.
    const right = await h.page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.right - 3, y: r.top + r.height / 2 };
    }, DOT_IMG);
    await sleep(600);
    await h.page.mouse.click(right.x, right.y);
    await sleep(350);
    const dotEnd = doc.indexOf("![dot](") + ("![dot](" + DOT + ")").length;
    assert.equal(await h.page.evaluate(() => window.__mdm.view.state.selection.main.head), dotEnd, "a click on the right of the picture did not put the caret after it");
    await clickAt(h.page, await posOf(h.page, "Prose at the end."));
    await sleep(250);
    await press(h.page, DOT_IMG, 0);
    seen = await shown(h.page);
    assert.deepEqual([seen.dot, seen.focus], [true, true], JSON.stringify(seen));
    assert.ok(
      await h.page.evaluate(() => Array.from(document.querySelectorAll("#app .cm-line")).some((l) => l.textContent.includes("![dot]("))),
      "the picture's source is not on show"
    );
    await press(h.page, DOT_PREVIEW, 0);
    seen = await shown(h.page);
    assert.deepEqual([seen.dot, seen.focus], [false, false], JSON.stringify(seen));
    assert.equal(await drift(h.page), null);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});
