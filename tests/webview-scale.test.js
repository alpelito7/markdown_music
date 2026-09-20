// What keeps the editor's work in proportion to what changed
// (vscode-mdm/media/main.js), which a document of twenty thousand lines makes
// the difference between an editor and a wait.
//
// The partial rebuild of the decorations (rebuilt): a caret move, a keystroke
// or a piece of the tree landing rebuilds the blocks it reaches and keeps the
// rest of the set that stood. What that leaves has to be what a rebuild of
// the whole document gives, so those tests move the editor and then ask it
// for the first place the two part (window.__mdm.checkDecorations, which
// builds the whole set afresh, the link definitions read again), and read the
// counts of whole and partial rebuilds to know which road a step took.
//
// And two things that grew with use: the equations kept rendered, which are
// bounded, and the outline, which a caret move no longer paints and typing
// paints once it rests.
//
// Run with: node --test --test-concurrency=1 tests/webview-scale.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { open, skip } = require("./webview/helpers.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A document of every kind of block the editor draws, long enough that a
// block or two is never half of it (past half, the whole is rebuilt). Each
// section differs in its words and numbers, so nothing in one stands in for
// the same thing in another.
function section(k) {
  return [
    "## Section " + k + " {#sec-" + k + "}",
    "",
    "A paragraph with *emphasis*, **strong** words, `code " + k + "`, a [link](https://example.com/" + k + "),",
    "a second line with \"quotes\" -- and a dash, a note[^n" + k + "] and $x_" + k + "^2$ inline.",
    "",
    "Setext " + k,
    "-------",
    "",
    "- item one of " + k,
    "- item two",
    "  continued on its second line",
    "  - nested with a [reference][ref" + k + "]",
    "- [ ] a task",
    "-",
    "  text under an empty marker",
    "",
    "1. first",
    "2. second",
    "",
    "> A quote of section " + k + ",",
    "> on two lines.",
    ">",
    "> > nested in it",
    "",
    "::: {.callout-note}",
    "A note with **marks** in it.",
    ":::",
    "",
    "```python",
    "value_" + k + " = " + k,
    "print(value_" + k + ")",
    "```",
    "",
    "    indented code " + k,
    "",
    "| Left " + k + " | Right |",
    "|:-----|------:|",
    "| a    | \"q\" |",
    "",
    "$$",
    "E_" + k + " = mc^2",
    "$$ where the tail of " + k + " stands.",
    "",
    "***",
    "",
    "<!-- a comment of " + k + " -->",
    "",
    "[ref" + k + "]: https://example.org/ref/" + k + " \"Title " + k + "\"",
    "",
    "[^n" + k + "]: The note of section " + k + ".",
    "",
  ].join("\n");
}
const DOC = "# The document\n\n" + Array.from({ length: 12 }, (_, i) => section(i + 1)).join("\n") + "\nThe end.\n";

// The editor on DOC, focused, the whole tree parsed, the counts at zero.
async function start() {
  const h = await open({ text: DOC, scores: 0, height: 900 });
  await h.page.evaluate(async () => {
    const { view, CM } = window.__mdm;
    view.focus();
    for (let i = 0; i < 200 && !CM.ensureSyntaxTree(view.state, view.state.doc.length, 200); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 100));
    window.__mdm.rebuilds.whole = 0;
    window.__mdm.rebuilds.part = 0;
  });
  return h;
}

// One step in the page: `fn` is given the view and what it needs, the
// follow-up transactions land, and what comes back is where the set on screen
// parts from a whole rebuild (null when it does not) and the counts so far.
async function step(h, fn, arg) {
  await h.page.evaluate(fn, arg);
  await sleep(60);
  return h.page.evaluate(() => ({
    differs: window.__mdm.checkDecorations(),
    whole: window.__mdm.rebuilds.whole,
    part: window.__mdm.rebuilds.part,
  }));
}

const caretAt = (needle) => {
  const { view } = window.__mdm;
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(needle) } });
};

test("a caret move rebuilds the blocks it leaves and the ones it enters, and nothing else", { skip }, async () => {
  const h = await start();
  let got = await step(h, caretAt, "emphasis*, **strong** words, `code 3`");
  assert.equal(got.differs, null);
  got = await step(h, caretAt, "item one of 9");
  assert.equal(got.differs, null);
  got = await step(h, caretAt, "A note with **marks**");
  assert.equal(got.differs, null);
  // Out of the editor and in again: the carets answer to nothing and then to
  // the selection again.
  got = await step(h, () => window.__mdm.view.contentDOM.blur());
  assert.equal(got.differs, null);
  got = await step(h, () => window.__mdm.view.focus());
  assert.equal(got.differs, null);
  assert.equal(got.whole, 0, "a caret move rebuilt the whole document");
  assert.ok(got.part >= 3, "no partial rebuild was counted: " + JSON.stringify(got));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the marker of an item whose text starts on the next line outlives the rebuild of the line under it", { skip }, async () => {
  // That marker's widget takes the line break too and ends where the next
  // line begins: a rebuild of that next line dropped it, going by where a
  // decoration ends and not by where it starts. Seen on the bench's 22 805-line
  // document, where a letter typed before "  text" made the line a paragraph
  // of its own.
  const h = await start();
  const typed = await step(h, () => {
    const { view } = window.__mdm;
    const at = view.state.doc.toString().indexOf("  text under an empty marker");
    view.dispatch({ changes: { from: at, insert: "x" }, selection: { anchor: at + 1 } });
  });
  assert.equal(typed.differs, null);
  const away = await step(h, caretAt, "The end.");
  assert.equal(away.differs, null);
  assert.equal(away.whole, 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a change made away from the caret, and one that changes what the blocks below it are, are drawn", { skip }, async () => {
  const h = await start();
  await step(h, caretAt, "The end.");
  // As the host writes one: far from the caret, which stays where it is.
  let got = await step(h, () => {
    const { view } = window.__mdm;
    const at = view.state.doc.toString().indexOf("**strong** words, `code 2`");
    view.dispatch({ changes: { from: at, to: at + 2, insert: "__" } });
  });
  assert.equal(got.differs, null);
  assert.equal(got.whole, 0);
  // A fence opened above a section: what was a list, a quote and a table is
  // code down to the next fence, and the blocks of the two trees part there.
  got = await step(h, () => {
    const { view } = window.__mdm;
    const at = view.state.doc.toString().indexOf("Setext 5");
    view.dispatch({ changes: { from: at, to: at + 3, insert: "```" } });
  });
  assert.equal(got.differs, null);
  // And closed again.
  got = await step(h, () => {
    const { view } = window.__mdm;
    const at = view.state.doc.toString().indexOf("```ext 5");
    view.dispatch({ changes: { from: at, to: at + 3, insert: "Set" } });
  });
  assert.equal(got.differs, null);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("what reaches past its own block rebuilds the whole: a line more or fewer, the lines the host keeps back, a link definition", { skip }, async () => {
  const h = await start();
  await step(h, caretAt, "The end.");
  // The count the host keeps back: every number in the margin. Before
  // anything is typed here, so that the text of the message is the one the
  // two sides agree on and the count is all it changes.
  let got = await step(h, () =>
    window.postMessage(
      // The mode as it stands: a change of mode takes the language up again,
      // which rebuilds the whole on its own account.
      { type: "update", text: window.__mdm.view.state.doc.toString(), frontMatter: "x", withFrontMatter: true, hiddenLines: 7 },
      "*"
    )
  );
  assert.equal(got.differs, null);
  assert.ok(got.whole >= 1, "another count of hidden lines did not rebuild the whole");
  let whole = got.whole;
  // A line more: the rule, the table and the card below carry their line's
  // number, and every number below moves.
  got = await step(h, () => {
    const { view } = window.__mdm;
    const at = view.state.doc.toString().indexOf("Setext 2");
    view.dispatch({ changes: { from: at, insert: "\n" } });
  });
  assert.equal(got.differs, null);
  assert.ok(got.whole > whole, "a new line did not rebuild the whole");
  // The address of a definition: the link that names it is in another block,
  // and its tooltip is the address.
  whole = got.whole;
  got = await step(h, () => {
    const { view } = window.__mdm;
    const at = view.state.doc.toString().indexOf("https://example.org/ref/4");
    view.dispatch({ changes: { from: at + 8, to: at + 15, insert: "changed" } });
  });
  assert.equal(got.differs, null);
  assert.ok(got.whole > whole, "a changed definition did not rebuild the whole");
  const title = await h.page.evaluate(() => {
    const { view } = window.__mdm;
    const at = view.state.doc.toString().indexOf("[reference][ref4]");
    view.dispatch({ selection: { anchor: 0 }, effects: window.__mdm.CM.EditorView.scrollIntoView(at, { y: "center" }) });
    return new Promise((r) =>
      setTimeout(() => {
        const link = Array.from(document.querySelectorAll("#app .mdm-link")).find((a) => a.textContent === "reference" && /ref\/4/.test(a.title || a.getAttribute("data-mdm-title") || ""));
        r(link ? link.title || link.getAttribute("data-mdm-title") : null);
      }, 200)
    );
  });
  assert.ok(title && /changed\.org\/ref\/4/.test(title), "the link kept the old address: " + title);
  // A definition that is new: the language starts over with it, and a
  // paragraph that keeps its place and its size holds a link now.
  got = await step(h, () => {
    const { view } = window.__mdm;
    const doc = view.state.doc.toString();
    const at = doc.indexOf("item two");
    view.dispatch({ changes: [{ from: at, to: at + 8, insert: "[newly]x" }, { from: doc.length, insert: "\n[newly]: https://example.net/\n" }] });
  });
  await sleep(200);
  got = await step(h, () => {});
  assert.equal(got.differs, null);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the language taken up again with a new definition rebuilds the whole, in a document parsed at one go", { skip }, async () => {
  // A definition that is new makes a link of `[label]` wherever it stands,
  // inside paragraphs that keep their place and their size, so no comparison
  // of blocks sees it. In a long document the parse lands in pieces and each
  // piece is rebuilt as it comes; a short one is parsed at one go, and the
  // transaction that takes the language up again is all there is to go by.
  const filler = Array.from({ length: 60 }, (_, i) => "Paragraph number " + i + " of the filler.\n\n").join("");
  const h = await open({ text: "A [label] to be.\n\n" + filler + "The end.\n", scores: 0 });
  await h.page.evaluate(() => {
    const { view } = window.__mdm;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Paragraph number 30") } });
  });
  await sleep(150);
  const got = await step(h, () => {
    const { view } = window.__mdm;
    const end = view.state.doc.length;
    // In place of the last line, so that the number of lines stays.
    const last = view.state.doc.line(view.state.doc.lines - 1);
    view.dispatch({ changes: { from: last.from, to: last.to, insert: "[label]: https://example.com/" } });
  });
  await sleep(200);
  const after = await step(h, () => {});
  assert.equal(after.differs, null);
  const linked = await h.page.evaluate(() => {
    const line = document.querySelector("#app .cm-line");
    return !!line.querySelector(".mdm-link");
  });
  assert.ok(linked, "the label of the first line is not drawn as a link");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a walk of three hundred random steps leaves what a whole rebuild gives, most of it rebuilt in part", { skip }, async () => {
  const h = await start();
  const out = await h.page.evaluate(async () => {
    const { view, CM } = window.__mdm;
    let seed = 20260918;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const failures = [];
    for (let i = 0; i < 300 && !failures.length; i++) {
      const doc = view.state.doc;
      const line = doc.line(1 + rnd(doc.lines));
      const pos = line.from + rnd(line.length + 1);
      const kind = rnd(12);
      let what;
      if (kind < 5) {
        what = "caret to " + pos;
        view.dispatch({ selection: { anchor: pos } });
      } else if (kind < 7) {
        what = "a letter at " + pos + " in " + JSON.stringify(line.text.slice(0, 24));
        view.dispatch({ changes: { from: pos, insert: "x" }, selection: { anchor: pos + 1 }, userEvent: "input.type" });
      } else if (kind === 7) {
        if (!line.length) continue;
        const at = line.from + rnd(line.length);
        what = "a character off " + at + " in " + JSON.stringify(line.text.slice(0, 24));
        view.dispatch({ changes: { from: at, to: at + 1 }, selection: { anchor: at } });
      } else if (kind === 8) {
        const other = doc.line(1 + rnd(doc.lines));
        what = "a selection from " + pos + " to " + other.from;
        view.dispatch({ selection: { anchor: pos, head: other.from } });
      } else if (kind === 9) {
        const other = doc.line(1 + rnd(doc.lines));
        const second = other.from + rnd(other.length + 1);
        if (second === pos) continue;
        const lo = Math.min(pos, second);
        const hi = Math.max(pos, second);
        what = "two carets typing at " + lo + " and " + hi;
        view.dispatch({
          changes: [{ from: lo, insert: "y" }, { from: hi, insert: "y" }],
          selection: CM.EditorSelection.create([CM.EditorSelection.cursor(lo + 1), CM.EditorSelection.cursor(hi + 2)], 0),
        });
      } else if (kind === 10) {
        what = "a line break at " + pos;
        view.dispatch({ changes: { from: pos, insert: "\n" }, selection: { anchor: pos + 1 } });
      } else {
        what = "undo";
        CM.undo(view);
      }
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 40));
      const differs = window.__mdm.checkDecorations();
      if (differs) failures.push("step " + i + ", " + what + ": " + differs);
    }
    return { failures, rebuilds: window.__mdm.rebuilds };
  });
  assert.deepEqual(out.failures, []);
  assert.ok(out.rebuilds.part > out.rebuilds.whole, "the partial road was the rare one: " + JSON.stringify(out.rebuilds));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the equations kept rendered are bounded by what they hold, the one asked for longest ago going first", { skip }, async () => {
  const h = await open({ text: "An equation $x$ here.\n", scores: 0 });
  const got = await h.page.evaluate(() => {
    const k = window.__mdm.katex;
    const held = () => {
      let chars = 0;
      k.cache.forEach((hit, key) => (chars += key.length + (hit.html || hit.error).length));
      return chars;
    };
    const one = k.render("a_{0}", false).html.length + "Ia_{0}".length;
    // Room for five or so of them.
    k.held.limit = one * 5;
    let first = null;
    for (let i = 1; i <= 12; i++) {
      k.render("a_{" + i + "}", false);
      // Asked for again at every turn: the newest each time, so it stays,
      // the very render it was and not one made again after it went.
      const again = k.render("a_{1}", false);
      if (i === 1) first = again;
    }
    return {
      sameRender: k.cache.get("Ia_{1}") === first,
      within: k.held.chars <= k.held.limit,
      counted: k.held.chars === held(),
      size: k.cache.size,
      newest: k.cache.has("Ia_{12}"),
      askedAgain: k.cache.has("Ia_{1}"),
      oldest: k.cache.has("Ia_{2}"),
      refused: k.render("\\frac{", false).error !== null,
    };
  });
  assert.deepEqual(got, { sameRender: true, within: true, counted: true, size: got.size, newest: true, askedAgain: true, oldest: false, refused: true });
  assert.ok(got.size >= 2 && got.size <= 6, "kept " + got.size);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a caret move marks another row of the outline and paints none, and typing paints the rows once, when it rests", { skip }, async () => {
  const h = await open({ text: DOC, scores: 0, height: 900, seed: { settings: { outline: "shown" } } });
  await h.page.waitForFunction(() => document.querySelectorAll("#app .mdm-outline__row").length >= 13, { timeout: 15000 });
  const read = () =>
    h.page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("#app .mdm-outline__row"));
      return {
        current: rows.filter((r) => r.classList.contains("mdm-outline__row--current")).map((r) => r.textContent),
        kept: rows.filter((r) => r.dataset.seen === "1").length,
        rows: rows.length,
        third: rows[3] ? rows[3].textContent : null,
      };
    });
  await h.page.evaluate(() => {
    const { view } = window.__mdm;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("item one of 2") } });
    document.querySelectorAll("#app .mdm-outline__row").forEach((r) => (r.dataset.seen = "1"));
  });
  // A caret move: another row is the current one, and every row is the
  // element it was.
  await h.page.evaluate(() => {
    const { view } = window.__mdm;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("item one of 7") } });
  });
  let got = await read();
  assert.deepEqual(got.current, ["Setext 7"]);
  assert.equal(got.kept, got.rows, "the rows were painted again for a caret move");
  // Five letters typed into a heading: the rows on screen are still the old
  // ones, and a row clicked now still goes to its heading.
  await h.page.evaluate(() => {
    const { view } = window.__mdm;
    const at = view.state.doc.toString().indexOf("Section 2 {#sec-2}") + "Section 2".length;
    for (let i = 0; i < 5; i++) {
      view.dispatch({ changes: { from: at + i, insert: "!" }, selection: { anchor: at + i + 1 }, userEvent: "input.type" });
    }
  });
  got = await read();
  assert.equal(got.kept, got.rows, "the rows were painted again at a keystroke");
  assert.equal(got.third, "Section 2");
  await sleep(400);
  got = await read();
  assert.equal(got.kept, 0, "the rows were not painted again once the typing rested");
  assert.equal(got.third, "Section 2!!!!!");
  assert.deepEqual(got.current, ["Section 2!!!!!"]);
  // A row clicked before the rows are painted again still goes to its
  // heading: the places kept for the rows move along with the text.
  const line = await h.page.evaluate(() => {
    const { view } = window.__mdm;
    const at = view.state.doc.toString().indexOf("Section 2!!!!!") + "Section 2".length;
    for (let i = 0; i < 3; i++) view.dispatch({ changes: { from: at, insert: "?" }, selection: { anchor: at + 1 } });
    document.querySelectorAll("#app .mdm-outline__row")[5].click();
    return view.state.doc.lineAt(view.state.selection.main.head).text;
  });
  assert.equal(line, "## Section 3 {#sec-3}");
  assert.deepEqual(h.errors, []);
  await h.close();
});
