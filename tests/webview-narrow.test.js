// What every kind of block does as the pane is squeezed, which is one rule
// for the whole document: a block keeps itself intact while it fits, and a
// block that no longer fits is reached by scrolling instead of being made
// smaller or broken.
//
//   - the prose rewraps, because that is what prose does, and the column
//     follows the pane;
//   - a line of source (code, ABC, TeX, YAML) keeps its line, and the editor
//     scrolls sideways to the end of it;
//   - a table squeezes its columns and then scrolls inside its own box;
//   - a display equation keeps its size and scrolls inside its own box from
//     the first pixel it does not fit;
//   - a score is drawn at the size it is engraved at, whatever the column
//     does, and the box it sits in scrolls the part that does not fit.
//
// The score is what moved: it used to be scaled down whole with no floor, so
// a 260 px column drew the staff's line spacing at 2.8 px where the prose
// beside it was still at 16 (the numbers are in the note in style.css). Code
// moved too: it used to rewrap with the prose, breaking inside a word when a
// line had nothing else to break on.
//
// Everything here is measured in a real browser, because all of it is layout.
//
// Run with: node --test --test-concurrency=1 tests/webview-narrow.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { open, posOf, setSelection, skip } = require("./webview/helpers.js");

// One of each kind of block, and three scores: a wide one, one whose two
// parts are a line each, and one that names its own width. All three are
// drawn at the width they are engraved at.
const DOC = [
  "---",
  'title: "Narrow"',
  "---",
  "",
  "A paragraph of prose to rewrap, long enough that the column has something",
  "to do with it at every width the tests below ask for, and then some more",
  "words after that so no width leaves it on one line.",
  "",
  "$$",
  "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6} \\quad\\text{and}\\quad",
  "\\int_0^1 x^2\\,dx = \\frac{1}{3} \\quad\\text{and}\\quad",
  "\\prod_{k=1}^{n} \\left(1 - \\frac{1}{k^2}\\right) = \\frac{n+1}{2n}",
  "$$",
  "",
  // The long line is the FIRST of the block on purpose: the copy button is an
  // inline widget inside that line, so it is the case where the button would
  // ride off to the end of the text if it were not held to the column.
  "```python",
  "path = '/a/very/long/unbreakable/path/that/cannot/wrap/anywhere/at/all.txt'",
  "x = 1",
  "```",
  "",
  "A card whose every line is short, which is the one that has to come out",
  "exactly the width of the column:",
  "",
  "```sh",
  "ls",
  "```",
  "",
  "| Column one | Column two | Column three | Column four |",
  "| --- | --- | --- | --- |",
  "| a value here | another value | a third value | a fourth one |",
  "",
  "```abc",
  "X:1",
  "M:4/4",
  "L:1/8",
  "K:C",
  "CDEF GABc | cBAG FEDC | CDEF GABc | cBAG FEDC | CDEF GABc | cBAG FEDC |",
  "```",
  "",
  "```abc",
  "X:2",
  "L:1/4",
  "K:C",
  "P:first",
  "C D E F |",
  "P:second",
  "G A B c |",
  "```",
  "",
  "```abc",
  "%%staffwidth 400pt",
  "X:3",
  "L:1/4",
  "K:C",
  "C D E F |",
  "```",
  "",
].join("\n");

// Tall on purpose: CodeMirror renders the lines in view and a little beyond,
// so a short pane would leave the blocks at the bottom unbuilt.
const HEIGHT = 6000;

async function at(page, width) {
  await page.setViewport({ width: width, height: HEIGHT });
  await new Promise((r) => setTimeout(r, 400));
  return page.evaluate(() => {
    const px = (n) => Math.round(n * 10) / 10;
    const scroller = document.querySelector("#app .cm-scroller");
    const content = document.querySelector("#app .cm-content");
    const eq = document.querySelector("#app .mdm-math--block .katex-display");
    const table = document.querySelector("#app .mdm-table");
    const codeLines = Array.from(document.querySelectorAll("#app .cm-line.mdm-code-line"));
    const long = codeLines.find((l) => l.textContent.indexOf("unbreakable") >= 0);
    const short = codeLines.find((l) => l.textContent.indexOf("x = 1") >= 0);
    // The line of the card that has nothing long in it at all.
    const tiny = codeLines.find((l) => l.textContent.trim() === "ls");
    // Where the ink of a line really ends, and where its ground does.
    const inkRight = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return px(range.getBoundingClientRect().right);
    };
    const copy = document.querySelector("#app .mdm-chrome--code .mdm-copy");
    const scores = Array.from(document.querySelectorAll("#app code.language-abc")).map(
      (code) => {
        const svg = code.querySelector("svg");
        if (!svg) return null;
        const view = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
        const drawn = svg.getBoundingClientRect().width;
        const staff = svg.querySelector(".abcjs-staff");
        return {
          // Four spaces of the staff as drawn: the one number that says
          // whether the engraving was made smaller.
          gap: staff ? px((staff.getBBox().height / 4) * (drawn / view[2])) : null,
          systems: svg.querySelectorAll(".abcjs-staff").length,
          drawn: px(drawn),
          box: px(code.clientWidth),
          held: px(code.scrollWidth - code.clientWidth),
          overflow: getComputedStyle(code).overflowX,
        };
      }
    );
    return {
      pane: px(scroller.clientWidth),
      column: px(content.clientWidth),
      // What the editor itself holds back sideways, which is where a line of
      // source too long for the column is reached.
      documentHeld: px(scroller.scrollWidth - scroller.clientWidth),
      prose: px(parseFloat(getComputedStyle(content).fontSize)),
      proseRows: (function () {
        const line = Array.from(document.querySelectorAll("#app .cm-line")).find(
          (l) => l.textContent.indexOf("A paragraph of prose") >= 0
        );
        return line ? Math.round(line.getBoundingClientRect().height) : null;
      })(),
      eq: eq
        ? {
            box: px(eq.clientWidth),
            // The drawing itself, and not the box: a .katex-display that has
            // room reports the box as its scrollWidth, and KaTeX's own
            // .katex wrapper is a block that fills it. What the maths really
            // takes is the row of bases inside (KaTeX's .base, which the
            // vendored build spells .katex-base).
            ink: px(
              Array.from(eq.querySelectorAll(".katex-base, .base")).reduce(
                (w, b) => w + b.getBoundingClientRect().width,
                0
              )
            ),
            held: px(eq.scrollWidth - eq.clientWidth),
          }
        : null,
      table: table ? { box: px(table.clientWidth), ink: px(table.scrollWidth) } : null,
      scores: scores,
      code: long
        ? {
            rows: Math.round(long.getBoundingClientRect().height),
            shortRows: short ? Math.round(short.getBoundingClientRect().height) : null,
            ink: inkRight(long),
            ground: px(long.getBoundingClientRect().right),
            shortGround: short ? px(short.getBoundingClientRect().right) : null,
            tinyGround: tiny ? px(tiny.getBoundingClientRect().right) : null,
            copyRight: copy ? px(copy.getBoundingClientRect().right) : null,
            copyTop: copy
              ? px(
                  copy.getBoundingClientRect().top -
                    document
                      .querySelector("#app .cm-line.mdm-code-first")
                      .getBoundingClientRect().top
                )
              : null,
            paneRight: px(scroller.getBoundingClientRect().right),
            // What the card itself holds back sideways, which is where the
            // end of a line too long for the column is reached now.
            held: long.scrollWidth - long.clientWidth,
            shortHeld: short ? short.scrollWidth - short.clientWidth : null,
            tinyHeld: tiny ? tiny.scrollWidth - tiny.clientWidth : null,
          }
        : null,
    };
  });
}

test("the prose rewraps, and the column follows the pane", { skip }, async () => {
  const h = await open({ text: DOC, scores: 3, height: HEIGHT });
  const wide = await at(h.page, 900);
  const narrow = await at(h.page, 420);
  assert.ok(narrow.column < wide.column - 300, "the column did not follow the pane");
  // The words stay the size they are, and take more rows. Rewrapping is the
  // whole of what the prose does about a narrow pane.
  assert.equal(narrow.prose, wide.prose);
  assert.ok(narrow.proseRows > wide.proseRows, "the paragraph did not rewrap");
  await h.close();
});

test("a line of source keeps its line, and its card scrolls to the end of it", { skip }, async () => {
  const h = await open({ text: DOC, scores: 3, height: HEIGHT });
  const wide = await at(h.page, 900);
  const narrow = await at(h.page, 420);
  // One row at both panes: the line is not broken at the column, as it used
  // to be (3 rows at a 500 px column, the break inside a word).
  assert.equal(wide.code.rows, wide.code.shortRows);
  assert.equal(narrow.code.rows, narrow.code.shortRows, "the code line was broken to fit");
  // And the end of it is reached inside the card, which is the box the
  // exported page has. The document itself never moves sideways: it used to
  // be the other way round, the card as wide as its longest line and the
  // whole page sliding under the reader to show the end of it (232 px of
  // document at a 600 px window, against the 91 px the page hid inside the
  // block).
  assert.ok(
    narrow.code.held > 100,
    "the card holds nothing back, so the end of the line cannot be reached: " + narrow.code.held
  );
  assert.equal(narrow.documentHeld, 0, "the document scrolled sideways for a card");
  assert.equal(wide.code.held, 0, "a card with room for its line still scrolled");
  assert.equal(wide.documentHeld, 0, "a pane with room for the code still scrolled");
  // The card is the column, at every pane and whatever is written in it: the
  // ground under the longest line, under a short line of the same card and
  // under a card with nothing long in it are one edge. With the line box as
  // wide as its text, 269 px of a 819 px line stood on the page's own ground
  // with no card under it, and each line of a card had an edge of its own
  // (twenty of them between 470 and 633 px on the python block of
  // example.mdm, measured at a 520 px pane).
  [wide, narrow].forEach(function (out) {
    const column = out.code.paneRight - 50;
    ["ground", "shortGround", "tinyGround"].forEach(function (edge) {
      assert.ok(
        Math.abs(out.code[edge] - column) <= 1,
        "the card's " + edge + " is not the column at " + out.pane + ": " + out.code[edge] + " against " + column
      );
    });
  });
  // And every line of one card holds back the same amount, or the text of a
  // card shears line by line as it is scrolled.
  assert.equal(
    narrow.code.shortHeld,
    narrow.code.held,
    "the lines of one card do not scroll together: " + narrow.code.shortHeld + " against " + narrow.code.held
  );
  // A card with nothing long in it holds nothing and draws no bar.
  assert.equal(narrow.code.tinyHeld, 0, "a card with room in it scrolls: " + narrow.code.tinyHeld);
  // The copy button stays at the column's right edge and 4 px under the top
  // of the card, and does not ride off to the end of the longest line.
  [wide, narrow].forEach(function (out) {
    assert.ok(
      Math.abs(out.code.copyRight - (out.code.paneRight - 58)) <= 1,
      "the copy button is not 8 px inside the column at " + out.pane + ": " + out.code.copyRight
    );
    assert.ok(
      Math.abs(out.code.copyTop - 4) <= 1,
      "the copy button is not 4 px under the top of the card: " + out.code.copyTop
    );
  });
  await h.close();
});

// What the card costs: the caret and the selection are drawn in layers
// outside the lines, so everything below is about marks that have to follow a
// box CodeMirror knows nothing about.
test("the caret and the selection follow the card they stand in", { skip }, async () => {
  const h = await open({ text: DOC, scores: 3, height: HEIGHT });
  const page = h.page;
  await page.setViewport({ width: 480, height: HEIGHT });
  await new Promise((r) => setTimeout(r, 400));
  const marks = () =>
    page.evaluate(() => {
      const px = (n) => Math.round(n * 10) / 10;
      const view = window.__mdm.view;
      const head = view.state.selection.main.head;
      const rows = Array.from(document.querySelectorAll("#app .cm-line.mdm-code-line"));
      const row = rows.find((l) => l.textContent.indexOf("unbreakable") >= 0);
      const win = row.getBoundingClientRect();
      // The run of lines this one card is drawn on, as main.js walks it: the
      // document holds another card, and that one must not move with it.
      const card = [];
      for (let el = row; el && el.classList.contains("mdm-code-line"); el = el.previousElementSibling) {
        card.unshift(el);
        if (el.classList.contains("mdm-code-first")) break;
      }
      for (let el = row.nextElementSibling; el && el.classList.contains("mdm-code-line"); el = el.nextElementSibling) {
        card.push(el);
        if (el.classList.contains("mdm-code-last")) break;
      }
      const others = rows.filter((r) => card.indexOf(r) < 0);
      const caret = document.querySelector("#app .cm-cursorLayer .cm-cursor");
      const glyph = view.coordsAtPos(head);
      const scroller = document.querySelector("#app .cm-scroller");
      const sel = view.state.selection.main;
      const from = sel.empty ? null : view.coordsAtPos(sel.from);
      const to = sel.empty ? null : view.coordsAtPos(sel.to);
      return {
        // Where the glyph the caret belongs to is, and where the caret was
        // drawn: the 0.6 px is drawSelection's own rounding.
        drift: caret && glyph ? px(caret.getBoundingClientRect().left - glyph.left) : null,
        shown: caret ? caret.style.opacity !== "0" : null,
        inWindow: glyph ? glyph.left > win.left && glyph.left < win.right : null,
        scrolls: card.map((r) => r.scrollLeft).join("/"),
        elsewhere: others.map((r) => r.scrollLeft).join("/"),
        documentHeld: scroller.scrollWidth - scroller.clientWidth,
        window: [px(win.left), px(win.right)],
        ink: from && to ? [px(from.left), px(to.left)] : null,
        rects: Array.from(document.querySelectorAll("#app .cm-selectionBackground")).map((e) => {
          const b = e.getBoundingClientRect();
          return [px(b.left), px(b.right), e.style.opacity !== "0"];
        }),
        head: head,
        column: head - view.state.doc.lineAt(head).from,
        lineEnd: view.state.doc.lineAt(head).length,
      };
    });
  const scrollCard = (to) =>
    page.evaluate((to) => {
      // As a drag of the bar does it: one line of the card, and the rest of
      // the card has to follow.
      document.querySelector("#app .cm-line.mdm-code-last").scrollLeft = to;
    }, to);

  // A caret set past the end of the card's window brings the card to it:
  // CodeMirror reveals a caret by scrolling the boxes the text is in, and the
  // caret is not in them, so what it scrolled was the document (34 px of it,
  // with the caret still out of sight).
  // Far enough along the line to be past the window at any pane this test
  // uses: at 480 px the column is 380 and the line is 636 px of monospace.
  const deep = await posOf(page, "all.txt", 0);
  await setSelection(page, deep);
  await new Promise((r) => setTimeout(r, 300));
  let out = await marks();
  assert.ok(out.inWindow, "the caret was left outside the card's window: " + JSON.stringify(out));
  assert.ok(Math.abs(out.drift) <= 1, "the caret was drawn off its glyph: " + out.drift);
  assert.ok(out.shown, "the caret was not drawn");
  assert.equal(out.documentHeld, 0, "the document scrolled sideways to show a caret");

  // And a card scrolled under a caret carries the caret with it, which is
  // the whole of what the layers cost: nothing redraws them on a scroll.
  const want = String(Number(out.scrolls.split("/")[0]) + 40);
  await scrollCard(Number(want));
  await new Promise((r) => setTimeout(r, 200));
  out = await marks();
  assert.ok(Math.abs(out.drift) <= 1, "the caret stayed where the card had left: " + out.drift);
  assert.ok(
    out.scrolls.split("/").every((n) => n === want),
    "the lines of the card did not follow the one that was scrolled: " + out.scrolls + ", wanted " + want
  );
  assert.ok(
    out.elsewhere.split("/").every((n) => n === "0"),
    "another card moved with this one: " + out.elsewhere
  );

  // A card scrolled away from its caret does not draw it out over the page,
  // and does not make the document scrollable either.
  await scrollCard(0);
  await new Promise((r) => setTimeout(r, 200));
  out = await marks();
  assert.equal(out.shown, false, "a caret out of the card's window was drawn anyway");
  assert.equal(out.documentHeld, 0, "a mark out of the card made the document scrollable");

  // A selection inside the card is drawn over its own letters, and cut to the
  // card's window rather than painted out into the margin: at a 240 px offset
  // the rectangle of an 11 character word stood 137 px left of the card.
  const word = await posOf(page, "unbreakable", 0);
  await setSelection(page, [{ anchor: word, head: word + 11 }]);
  await new Promise((r) => setTimeout(r, 300));
  out = await marks();
  assert.equal(out.rects.length, 1, "the selection was drawn as " + out.rects.length + " rectangles");
  assert.ok(
    Math.abs(out.rects[0][0] - out.ink[0]) <= 1 && Math.abs(out.rects[0][1] - out.ink[1]) <= 1,
    "the selection is not over its letters: " + JSON.stringify(out.rects) + " against " + JSON.stringify(out.ink)
  );
  const held = Number(out.scrolls.split("/")[0]);
  await scrollCard(held + 60);
  await new Promise((r) => setTimeout(r, 200));
  out = await marks();
  assert.ok(
    out.rects.every((r) => r[0] >= out.window[0] - 0.5 && r[1] <= out.window[1] + 0.5),
    "the selection was painted outside the card: " + JSON.stringify(out.rects) + " in " + JSON.stringify(out.window)
  );
  assert.ok(
    out.rects.some((r) => Math.abs(r[1] - out.ink[1]) <= 1) || out.ink[1] < out.window[0],
    "the visible end of the selection is not on its letters: " + JSON.stringify(out.rects)
  );


  // Home and End go to the ends of the line, not to the ends of the card's
  // window: with the card at a 166 px offset the browser answered Home with
  // the character at the edge of the window, 20 into the line.
  await setSelection(page, deep);
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.press("Home");
  await new Promise((r) => setTimeout(r, 300));
  out = await marks();
  assert.equal(out.column, 0, "Home stopped short of the start of the line: column " + out.column);
  assert.ok(Math.abs(out.drift) <= 1, "the caret was drawn off its glyph after Home: " + out.drift);
  await page.keyboard.press("End");
  await new Promise((r) => setTimeout(r, 300));
  out = await marks();
  assert.equal(out.column, out.lineEnd, "End stopped short of the end of the line: " + out.column);
  assert.ok(out.inWindow, "the end of the line was not brought into the card's window");

  // And the prose is left to CodeMirror: Home on a row of a wrapped
  // paragraph goes to the start of that row and not of the paragraph.
  const prose = await posOf(page, "A paragraph of prose", 0);
  const wrapped = await page.evaluate((from) => {
    // A position on the second drawn row of the paragraph.
    const view = window.__mdm.view;
    const line = view.state.doc.lineAt(from);
    const top = view.coordsAtPos(line.from).top;
    for (let pos = line.from; pos <= line.to; pos++) {
      const c = view.coordsAtPos(pos);
      if (c && c.top > top + 4) return pos + 2;
    }
    return null;
  }, prose);
  assert.ok(wrapped, "the paragraph did not wrap at this pane");
  await setSelection(page, wrapped);
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.press("Home");
  await new Promise((r) => setTimeout(r, 300));
  const proseHome = await page.evaluate(() => {
    const view = window.__mdm.view;
    const head = view.state.selection.main.head;
    return { head: head, lineFrom: view.state.doc.lineAt(head).from };
  });
  assert.ok(
    proseHome.head > proseHome.lineFrom,
    "Home in the prose went to the start of the paragraph instead of the row"
  );
  await h.close();
});

test("an equation and a table keep their size and scroll inside their own box", { skip }, async () => {
  const h = await open({ text: DOC, scores: 3, height: HEIGHT });
  const wide = await at(h.page, 900);
  const narrow = await at(h.page, 420);
  // KaTeX cannot reflow a display equation, so what it has is what it keeps:
  // the ink is the same width at both panes and the box it sits in scrolls.
  assert.ok(
    Math.abs(narrow.eq.ink - wide.eq.ink) < 1,
    "the equation was made to fit: " + narrow.eq.ink + " against " + wide.eq.ink
  );
  assert.ok(narrow.eq.ink > narrow.eq.box + 20, "the equation fits a 420 px pane");
  assert.ok(narrow.eq.held > 0, "the equation's box did not scroll");
  // A table has somewhere to give (its columns), and then it scrolls too.
  assert.ok(narrow.table.ink >= narrow.table.box, "the table stretched the column");
  await h.close();
});

test("a score is drawn at its engraved size at every pane, and its box scrolls", { skip }, async () => {
  const h = await open({ text: DOC, scores: 3, height: HEIGHT });
  const wide = await at(h.page, 900);
  for (const score of wide.scores) assert.ok(score, "a score was not engraved");
  for (const width of [700, 600, 500, 420]) {
    const out = await at(h.page, width);
    out.scores.forEach(function (score, i) {
      if (!score) return; // out of CodeMirror's viewport at this height
      const was = wide.scores[i];
      const which = "score " + (i + 1) + " at a pane of " + width + ": ";
      // The drawing keeps its size, staff, notes and words with it. Before
      // this it was scaled to the column: 7.9 px a space at 820, 5.4 at 500,
      // 2.8 at 260.
      assert.equal(score.drawn, was.drawn, which + "the drawing changed width");
      assert.equal(score.gap, was.gap, which + "the staff changed size");
      assert.equal(score.systems, was.systems, which + "the music was dealt differently");
      // And what does not fit is held back by the box, which scrolls it.
      const overflowing = score.drawn > score.box + 1;
      // scrollWidth is a whole number and the drawing is not, hence the
      // pixel: what matters is that the box holds back the part that does
      // not fit and nothing more.
      assert.ok(
        Math.abs(score.held - (overflowing ? score.drawn - score.box : 0)) <= 1,
        which + "the box holds back " + score.held + " of a drawing " + score.drawn + " wide in a box of " + score.box
      );
      if (overflowing) {
        assert.equal(score.overflow, "auto", which + "the box clips the drawing instead of scrolling it");
      }
    });
  }
  await h.close();
});

test("a wide score never scrolls the document, whatever the pane", { skip }, async () => {
  // A score is a widget with a box of its own, so the part of it that does
  // not fit belongs to that box and not to the document: a page-wide scroll
  // for a score would drag the prose sideways with it. (A line of source has
  // no box of its own to be given, and the test above is the record of what
  // was done about that: every line of the card is a scroll box, so a card
  // does not scroll the document either.)
  const h = await open({
    text: DOC.replace(
      "```python\npath = '/a/very/long/unbreakable/path/that/cannot/wrap/anywhere/at/all.txt'\nx = 1\n```\n\n",
      ""
    ).replace("```sh\nls\n```\n\n", ""),
    scores: 3,
    height: HEIGHT,
  });
  for (const width of [900, 600, 420]) {
    const out = await at(h.page, width);
    assert.equal(
      out.documentHeld,
      0,
      "the document scrolled sideways at a pane of " + width + ": " + out.documentHeld
    );
  }
  await h.close();
});

// A card of a hundred lines, one of them too long for any column, so that
// the pane can hold part of it and CodeMirror can drop and build the rest.
const TALL_CARD = [
  "Prose before the card.",
  "",
  "```python",
  "path = '/a/very/long/unbreakable/path/that/cannot/wrap/anywhere/at/all.txt'",
]
  .concat(
    Array.from({ length: 100 }, function (x, i) {
      return "line_" + i + " = " + i;
    })
  )
  .concat(["```", "", "Prose after the card.", ""])
  .join("\n");

test("a card keeps one offset through the rows CodeMirror builds and drops", { skip }, async () => {
  // CodeMirror renders the lines in view and a little beyond, so a card
  // taller than the pane loses rows at one end and builds them at the other
  // as the reader goes down the document. A row it has just built comes back
  // at nothing while the rest of the card stands where the reader left it,
  // and the card would then be drawn with its text sheared row by row: the
  // frame after they appear takes them back (syncCards, from afterRender).
  const h = await open({ text: TALL_CARD, scores: 0, height: 400 });
  const page = h.page;
  await page.setViewport({ width: 480, height: 400 });
  await new Promise((r) => setTimeout(r, 400));
  const read = () =>
    page.evaluate(() => {
      const rows = Array.prototype.slice.call(
        document.querySelectorAll("#app .cm-line.mdm-code-line")
      );
      return {
        rows: rows.length,
        offsets: rows.map((r) => r.scrollLeft).join("/"),
        first: rows.length ? rows[0].textContent.slice(0, 12) : null,
      };
    });
  await page.evaluate(() => {
    document.querySelector("#app .cm-line.mdm-code-line").scrollLeft = 60;
  });
  await new Promise((r) => setTimeout(r, 300));
  const before = await read();
  assert.ok(before.rows > 10, "the card was not drawn: " + JSON.stringify(before));
  assert.ok(
    before.offsets.split("/").every((n) => n === "60"),
    "the card did not take the offset: " + before.offsets
  );
  // Down the document by more than the pane and less than the whole card, so
  // that rows survive the move and rows are built for the first time.
  await page.evaluate(() => {
    document.querySelector("#app .cm-scroller").scrollTop += 1200;
  });
  await new Promise((r) => setTimeout(r, 500));
  const after = await read();
  assert.notEqual(after.first, before.first, "the pane did not move down the card");
  assert.ok(after.rows > 10, "the card left the pane: " + JSON.stringify(after));
  assert.ok(
    after.offsets.split("/").every((n) => n === "60"),
    "a row the pane brought in came back at another offset: " + after.offsets
  );
  await h.close();
});

test("the number of a card's line is drawn in the margin the card clips", { skip }, async () => {
  const h = await open({ text: DOC, scores: 3, height: HEIGHT });
  const page = h.page;
  await page.setViewport({ width: 480, height: HEIGHT });
  await new Promise((r) => setTimeout(r, 400));
  // A card is a scroll box, and a scroll box clips what stands outside it.
  // The number in the margin is a ::before of the line, placed against the
  // line, so it is only drawn while the line is not the frame it is placed
  // against (`position: static` on the card's lines in style.css): with the
  // line as the frame this band of margin came out pixel for pixel what it is
  // with the numbers painted transparent.
  const band = (which) =>
    page.evaluate((which) => {
      const rows = Array.prototype.slice.call(document.querySelectorAll("#app .cm-line"));
      const row =
        which === "card"
          ? rows.find((l) => l.textContent.indexOf("unbreakable") >= 0)
          : rows.find((l) => l.textContent.indexOf("A paragraph of prose") >= 0);
      const b = row.getBoundingClientRect();
      return {
        x: Math.round(b.left - 44),
        y: Math.round(b.top),
        width: 44,
        height: Math.min(30, Math.round(b.height)),
      };
    }, which);
  const shot = (clip) => page.screenshot({ clip: clip, encoding: "base64" });
  const cardBand = await band("card");
  const proseBand = await band("prose");
  const card = await shot(cardBand);
  const prose = await shot(proseBand);
  await page.addStyleTag({
    content: "#app [data-mdm-line]::before { color: transparent !important; }",
  });
  await new Promise((r) => setTimeout(r, 200));
  assert.notEqual(
    prose,
    await shot(proseBand),
    "no number is drawn beside a line of prose either, so nothing was tested"
  );
  assert.notEqual(card, await shot(cardBand), "the card clipped the number of its own line away");
  await h.close();
});

// ---- What a scrollbar takes, and from whom ----
//
// A bar drawn inside a box of a stated height is taken out of the content
// box, and abcjs states a height on the box it engraves into: the bar was
// drawn over the bottom 9.6 px of the music (measured at a 520 px pane). The
// equation never had that trouble, because nothing states a height on a
// .katex-display, and the fix is to let the score's box take its height from
// the drawing the same way (style.css).
//
// These read with the bars drawn, which is what a webview does and what
// puppeteer hides in every headless browser it launches. That costs the pane
// 15 px to the vertical bar, so nothing here is compared with a number from
// the tests above.
async function withBars(page, width) {
  await page.setViewport({ width: width, height: HEIGHT });
  await new Promise((r) => setTimeout(r, 400));
  return page.evaluate(() => {
    const px = (n) => Math.round(n * 10) / 10;
    // What the box holds a bar in, and how much of the drawing inside it is
    // under that bar: the drawing's own bottom edge against the bottom of
    // the box's content.
    const read = (box, inner) => {
      if (!box || !inner) return null;
      const outer = box.getBoundingClientRect();
      return {
        bar: box.offsetHeight - box.clientHeight,
        content: box.clientHeight,
        covered: px(inner.getBoundingClientRect().bottom - (outer.top + box.clientHeight)),
        held: px(box.scrollWidth - box.clientWidth),
      };
    };
    const code = document.querySelector("#app code.language-abc");
    const eq = document.querySelector("#app .mdm-math--block .katex-display");
    const scroller = document.querySelector("#app .cm-scroller");
    // A card of source is a run of lines and the bar is one of them, so it is
    // read row by row: which of them draws a bar, how much room the one that
    // does keeps for its text, and how much of that text is under the bar.
    const rows = Array.from(document.querySelectorAll("#app .cm-line.mdm-code-line"));
    const long = rows.find((l) => l.textContent.indexOf("unbreakable") >= 0);
    const card = [];
    if (long) {
      for (let el = long; el && el.classList.contains("mdm-code-line"); el = el.previousElementSibling) {
        card.unshift(el);
        if (el.classList.contains("mdm-code-first")) break;
      }
      for (let el = long.nextElementSibling; el && el.classList.contains("mdm-code-line"); el = el.nextElementSibling) {
        card.push(el);
        if (el.classList.contains("mdm-code-last")) break;
      }
    }
    const last = card[card.length - 1];
    let ink = null;
    if (last) {
      const range = document.createRange();
      range.selectNodeContents(last);
      ink = range.getBoundingClientRect().bottom;
    }
    return {
      score: read(code, code && code.querySelector("svg")),
      eq: read(eq, eq && eq.querySelector(".katex")),
      card: last
        ? {
            bars: card.map((r) => r.offsetHeight - r.clientHeight),
            content: last.clientHeight,
            covered: px(ink - (last.getBoundingClientRect().top + last.clientHeight)),
            held: px(long.scrollWidth - long.clientWidth),
          }
        : null,
      documentBar: scroller.offsetHeight - scroller.clientHeight,
    };
  });
}

test("the bar of a score is drawn under the music and not over it", { skip }, async () => {
  const h = await open({ text: DOC, scores: 3, height: HEIGHT, bars: true });
  const wide = await withBars(h.page, 900);
  const narrow = await withBars(h.page, 500);
  // Wide enough for the drawing: no bar, and no room taken for one.
  assert.equal(wide.score.bar, 0, "a score that fits its column still holds a bar");
  assert.ok(wide.score.covered <= 0.5, "the drawing is cut at a pane with room for it");
  // Narrow: the box scrolls, so it holds a bar...
  assert.ok(narrow.score.held > 0, "the box did not scroll at a 500 px pane");
  assert.ok(narrow.score.bar >= 10, "the box holds no bar: " + narrow.score.bar);
  // ...and the bar is under the music: the room for the drawing is the same
  // as on a wide pane, and none of the drawing is past the bottom of it.
  assert.equal(
    narrow.score.content,
    wide.score.content,
    "the bar was taken out of the music's own room"
  );
  assert.ok(
    narrow.score.covered <= 0.5,
    "the bar covers " + narrow.score.covered + " px of the drawing"
  );
  // The equation is the one that always did this, and the score now reads
  // the same way beside it.
  assert.ok(narrow.eq.bar >= 10, "the equation's box holds no bar");
  assert.ok(narrow.eq.covered <= 0.5, "the bar covers the equation");
  // And the card of source: one bar for the whole card, on its last line,
  // which is where the page draws it, and added to that line instead of
  // taken out of it (the row grew from 28.8 px to 38.8 and its text stayed
  // where it was).
  assert.deepEqual(
    wide.card.bars.map(() => 0),
    wide.card.bars,
    "a card with room for its lines holds a bar: " + JSON.stringify(wide.card.bars)
  );
  assert.ok(narrow.card.held > 0, "the card did not scroll at a 500 px pane");
  assert.ok(
    narrow.card.bars[narrow.card.bars.length - 1] >= 10,
    "the last line of the card draws no bar: " + JSON.stringify(narrow.card.bars)
  );
  assert.deepEqual(
    narrow.card.bars.slice(0, -1),
    narrow.card.bars.slice(0, -1).map(() => 0),
    "a line of the card other than the last drew a bar: " + JSON.stringify(narrow.card.bars)
  );
  assert.equal(
    narrow.card.content,
    wide.card.content,
    "the bar was taken out of the room the card's text had"
  );
  assert.ok(
    narrow.card.covered <= 0.5,
    "the bar covers " + narrow.card.covered + " px of the card's text"
  );
  await h.close();
});
