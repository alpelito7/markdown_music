// The title block in the editor (TitleWidget in vscode-mdm/media/main.js):
// what the YAML header puts at the head of the page, the title, the subtitle,
// the names and the date, drawn where the page has it, with the hand, and
// opened into its YAML by a click as a table is opened into its rows. A header
// that prints nothing draws nothing, and the YAML button of the toolbar is its
// way in. Asked for by the owner on 2026-10-03, who chose the second half from
// six proposals (design/design-yaml-header.html, A), and on 2026-10-04 asked
// for the rest of what the page prints there: the affiliations, the dates
// and the DOI, the abstract and the keywords, the categories and the
// description ("The rest of the block", at the end). The same day the owner
// told the two ways in apart: what a click on the title opens goes away when
// the carets leave it, as a table's source does, and what the button shows
// stays, with no title drawn under it ("Opened by a click, shown by the
// button").
//
// The header's source is open or put away by the host (the `header` message;
// extension-host.test.js holds that end, and the setting that keeps a header
// with nothing to draw in view), so a test
// here plays the host: it reads what the webview asked and answers with the
// document in that state. What the block says is read in mdm-crossref.js
// (crossref.test.js), and that it is the page's block, part by part, is
// measured against the export in html.test.js.
// Run with: node --test --test-concurrency=1 tests/webview-title.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const { frontMatter } = require("../vscode-mdm/transforms.js");
const { open, update, skip, docText, setSelection } = require("./webview/helpers.js");

// The host itself, for the tests that put it on the other end of the wire
// ("With the host on the other end"): require("vscode") is the mock, as in
// extension-host.test.js and webview-memory.test.js.
const MOCK = path.join(__dirname, "mocks", "vscode.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "vscode") return MOCK;
  return origResolve.call(this, request, ...rest);
};
const vscode = require("vscode");
const ext = require("../vscode-mdm/extension.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HEADER = [
  "---",
  'title: "A Markdown Music prototype"',
  'subtitle: "Markdown and scores in one file"',
  "author: alpelito7",
  "lang: en",
  "---",
  "",
].join("\n");
const BODY = "This document is ordinary Markdown.\n\n## A heading\n\nMore prose under it.\n";
const TITLED = HEADER + "\n" + BODY;
const BARE = "---\nlang: en\n---\n\n" + BODY;
// A document long enough for a keystroke to redraw a few of its blocks and
// not all of it: the editor rebuilds the whole drawing when what changed is
// more than half the text, and every document above is that short. The
// partial road is the one that has to put the title back, since the block
// stands at the head of the first line and goes with that line's redraw.
const LONG_BODY =
  BODY + "\n" + Array.from({ length: 40 }, (_, i) => "Paragraph " + (i + 1) + " of a longer document, so that one line is a small part of it.").join("\n\n") + "\n";
const LONG_TITLED = HEADER + "\n" + LONG_BODY;
const partRebuilds = (page) => page.evaluate(() => window.__mdm.rebuilds.part);

// The editor on a document with its header put away, which is how the host
// hands every document over, or with its source open.
const editor = (text, shown, more) =>
  open(Object.assign({ text: text, scores: 0, withFrontMatter: !!shown, frontMatter: frontMatter(text), height: 900 }, more || {}));
// On a file with no header at all.
const bare = (text) => open({ text: text, scores: 0, withFrontMatter: false, frontMatter: "" });
// The host's answer to a `header` message. `stays` is the host's `pinned`:
// the source is there as the button or the setting shows it, and not as a
// click on the title opens it.
const answer = (page, text, shown, stays) => update(page, text, shown, 0, frontMatter(text), stays);
// What a click on the drawn title asks, what the carets leaving ask, and
// what the YAML button asks.
const PEEK = { type: "header", open: true, peek: true };
const LEAVE = { type: "header", open: false, peek: true };
const SHOW = { type: "header", open: true };
const HIDE = { type: "header", open: false };

const headerPosts = (page) => page.evaluate(() => window.__posts.filter((m) => m.type === "header"));

// What stands at the head of the document: the block and its parts, the
// lines of the header's card, and the first numbers of the margin.
const head = (page) =>
  page.evaluate(() => {
    const text = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.textContent);
    const block = document.querySelector("#app .mdm-title-block");
    const content = document.querySelector("#app .cm-content");
    return {
      blocks: document.querySelectorAll("#app .mdm-title-block").length,
      open: !!block && block.classList.contains("mdm-title-block--open"),
      numbered: !!block && !!block.querySelector("[data-mdm-line]"),
      title: text("#app .mdm-title-block .mdm-title"),
      subtitle: text("#app .mdm-title-block .mdm-subtitle"),
      authors: text("#app .mdm-title-block .mdm-title-authors p"),
      date: text("#app .mdm-title-block .mdm-title-date p"),
      card: document.querySelectorAll("#app .cm-line.mdm-fm-line").length,
      // The children of the column in their order: where the block stands.
      order: Array.from(content.children)
        .slice(0, 9)
        .map((e) => (e.classList.contains("mdm-title-block") ? "TITLE" : e.classList.contains("mdm-fm-line") ? "fm" : e.classList.contains("cm-line") ? "line" : "other"))
        .join(" "),
      numbers: Array.from(document.querySelectorAll("#app .cm-content [data-mdm-line]"))
        .slice(0, 3)
        .map((e) => e.getAttribute("data-mdm-line") + (e.closest(".mdm-title-block") ? "T" : "")),
    };
  });

const middle = (page, sel) =>
  page.evaluate((s) => {
    const b = document.querySelector(s).getBoundingClientRect();
    return [b.left + Math.min(40, b.width / 2), b.top + b.height / 2];
  }, sel);
const clickOn = async (page, sel, options) => {
  const at = await middle(page, sel);
  await page.mouse.click(at[0], at[1], options || {});
  await sleep(150);
};
const caretLine = (page) =>
  page.evaluate(() => {
    const state = window.__mdm.view.state;
    const line = state.doc.lineAt(state.selection.main.head);
    return { text: line.text, after: line.text.slice(state.selection.main.head - line.from), focused: window.__mdm.view.hasFocus };
  });

test("a header that names a title is drawn as the title block, over the first line", { skip }, async () => {
  const h = await editor(TITLED, false);
  assert.equal(await docText(h.page), BODY, "the header is in the text");
  const seen = await head(h.page);
  assert.equal(seen.blocks, 1);
  assert.equal(seen.open, false);
  assert.deepEqual(seen.title, ["A Markdown Music prototype"]);
  assert.deepEqual(seen.subtitle, ["Markdown and scores in one file"]);
  assert.deepEqual(seen.authors, ["alpelito7"]);
  assert.deepEqual(seen.date, []);
  // Over the first line of the body, and no source of the header anywhere.
  assert.equal(seen.card, 0);
  assert.match(seen.order, /^TITLE line/, seen.order);
  // The margin: the block carries the number of the header's first line, as
  // the cover over any drawn block does, and the body counts the file's
  // lines from under the header.
  assert.deepEqual(seen.numbers, ["1T", "8", "9"]);
  assert.equal(seen.numbered, true);
  // The hand, since a click opens it, and each part names its key.
  const parts = await h.page.evaluate(() => ({
    cursor: getComputedStyle(document.querySelector("#app .mdm-title")).cursor,
    keys: Array.from(document.querySelectorAll("#app .mdm-title-block [data-mdm-key]")).map((e) => e.getAttribute("data-mdm-key")),
  }));
  assert.deepEqual(parts, { cursor: "pointer", keys: ["title", "subtitle", "author"] });
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a header that prints nothing draws nothing, and the YAML button is its way in", { skip }, async () => {
  const h = await editor(BARE, false);
  const seen = await head(h.page);
  assert.equal(seen.blocks, 0, "a header that names only a language drew a block");
  assert.equal(seen.card, 0);
  assert.match(seen.order, /^line/, seen.order);
  assert.deepEqual(seen.numbers, ["5", "6", "7"]);
  const button = '#app button[data-type="mdm-front-matter"]';
  assert.deepEqual(
    await h.page.evaluate((sel) => {
      const b = document.querySelector(sel);
      return [b.getAttribute("aria-label"), b.classList.contains("mdm-btn--on"), b.classList.contains("mdm-btn--off")];
    }, button),
    ["Show YAML header", false, false]
  );
  await h.page.click(button);
  await sleep(150);
  assert.deepEqual(await headerPosts(h.page), [SHOW]);
  await answer(h.page, BARE, true, true);
  const open = await head(h.page);
  assert.equal(open.card, 3, "the source did not open");
  assert.equal(open.blocks, 0, "the open header drew a block it has nothing to say in");
  assert.deepEqual(h.errors, []);
  await h.close();

  // And a file with no header at all.
  const none = await bare(BODY);
  assert.equal((await head(none.page)).blocks, 0);
  await none.close();
});

// The sizes and the spaces of the page's block, as measured on the export of
// 2026-10-03 at a 16px body (style.css names them; html.test.js sets the two
// surfaces side by side). Here they are numbers, so that a rule of the
// editor's sheet that drifts is caught without a Quarto to render the page.
test("the block is set at the page's sizes and with the page's spaces", { skip }, async () => {
  const h = await editor(TITLED, false);
  const m = await h.page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    const block = box("#app .mdm-title-block");
    const title = box("#app .mdm-title");
    const subtitle = box("#app .mdm-subtitle");
    const meta = box("#app .mdm-title-meta");
    const first = Array.from(document.querySelectorAll("#app .cm-content > .cm-line"))[0].getBoundingClientRect();
    const round = (v) => +v.toFixed(1);
    return {
      overTitle: round(title.top - block.top),
      titleHeight: round(title.height),
      overSubtitle: round(subtitle.top - title.bottom),
      overNames: round(meta.top - subtitle.bottom),
      underBlock: round(first.top - meta.bottom),
      column: round(block.width - title.width),
      titleSize: cs("#app .mdm-title").fontSize,
      titleWeight: cs("#app .mdm-title").fontWeight,
      rule: cs("#app .mdm-title").borderBottomWidth,
      subtitleSize: cs("#app .mdm-subtitle").fontSize,
      subtitleWeight: cs("#app .mdm-subtitle").fontWeight,
      nameSize: cs("#app .mdm-title-authors").fontSize,
      nameInk: cs("#app .mdm-title-meta").color,
      ink: cs("#app .cm-content").color,
      // CodeMirror measures a widget by its box: no margin on it.
      margins: cs("#app .mdm-title-block").marginTop + " " + cs("#app .mdm-title-block").marginBottom,
    };
  });
  assert.equal(m.overTitle, 18.2, "the air over the title");
  assert.equal(m.titleHeight, 49, "the title's row and its rule");
  assert.equal(m.overSubtitle, 5.3, "between the title and the subtitle");
  assert.equal(m.overNames, 10.6, "between the subtitle and the names");
  assert.equal(m.underBlock, 17, "under the block");
  assert.equal(m.column, 0, "the block is not the column wide");
  assert.equal(m.titleSize, "32px");
  assert.equal(m.titleWeight, "600");
  assert.equal(m.rule, "1px");
  assert.equal(m.subtitleSize, "21.25px");
  assert.equal(m.subtitleWeight, "300");
  assert.equal(m.nameSize, "14.4px");
  assert.notEqual(m.nameInk, m.ink, "the names are in the ink of the prose, not at 72% of it");
  assert.equal(m.margins, "0px 0px", "a margin on the widget, which CodeMirror does not measure");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a click on the drawn title opens the header's source with the caret on the line clicked", { skip }, async () => {
  // The part clicked, the line the caret goes to, and what is left of that
  // line after the caret: nothing for a bare value, and the closing quote
  // for a quoted one, since a word typed after the quote is outside the
  // value and breaks the line as YAML.
  const lines = { ".mdm-title": ["title:", '"'], ".mdm-subtitle": ["subtitle:", '"'], ".mdm-title-authors": ["author:", ""] };
  for (const sel of Object.keys(lines)) {
    const h = await editor(TITLED, false);
    await setSelection(h.page, 5);
    await h.page.evaluate(() => window.__mdm.view.contentDOM.blur());
    await clickOn(h.page, "#app " + sel);
    assert.deepEqual(await headerPosts(h.page), [PEEK], sel);
    // Nothing moves until the host answers: the block stands on no line of
    // the text, and the press on it puts no caret in the document and does
    // not hand it the focus, which comes with the caret once the header's
    // lines are there to hold it.
    assert.equal(await h.page.evaluate(() => window.__mdm.view.state.selection.main.head), 5, "the press moved the caret");
    assert.equal(await h.page.evaluate(() => window.__mdm.view.hasFocus), false, "the press gave the document the focus");
    assert.equal((await head(h.page)).open, false);

    await answer(h.page, TITLED, true);
    const seen = await head(h.page);
    assert.equal(seen.card, 6, "the source did not open");
    // The block stays, under the card, the live preview of what is typed;
    // the card's lines carry their own numbers and the block none.
    assert.equal(seen.blocks, 1);
    assert.equal(seen.open, true);
    assert.match(seen.order, /^fm fm fm fm fm fm TITLE line/, seen.order);
    assert.deepEqual(seen.numbers, ["1", "2", "3"]);
    assert.equal(seen.numbered, false, "the block under the card carries a line number");
    const caret = await caretLine(h.page);
    assert.ok(caret.text.startsWith(lines[sel][0]), sel + " put the caret on: " + caret.text);
    assert.equal(caret.after, lines[sel][1], "the caret is not at the end of the value");
    assert.equal(caret.focused, true, "the document was not given the focus");
    assert.equal(await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop), 0);
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

test("a click on the title while its source is open puts the source away", { skip }, async () => {
  const h = await editor(TITLED, true);
  assert.equal((await head(h.page)).open, true);
  await setSelection(h.page, 20);
  await h.page.evaluate(() => window.__mdm.view.focus());
  await clickOn(h.page, "#app .mdm-title");
  assert.deepEqual(await headerPosts(h.page), [LEAVE]);
  // Left to nobody, as a table put away is.
  assert.equal(await h.page.evaluate(() => window.__mdm.view.hasFocus), false, "the document kept the focus");
  await answer(h.page, TITLED, false);
  const seen = await head(h.page);
  assert.equal(seen.card, 0);
  assert.equal(seen.open, false);
  assert.match(seen.order, /^TITLE line/, seen.order);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The webview holds a keystroke back for 300 ms before it posts it. The host
// answers the request with the text it holds, so the edit has to be there
// first: sent after, the answer would be made from the text before the
// keystroke, and the keystroke would be typed over a header it did not know.
test("an edit still held back goes to the host ahead of the request", { skip }, async () => {
  const h = await editor(TITLED, false);
  await setSelection(h.page, 4);
  await h.page.evaluate(() => window.__mdm.view.focus());
  await h.page.keyboard.type("x");
  await clickOn(h.page, "#app .mdm-title");
  const sent = await h.page.evaluate(() =>
    window.__posts.filter((m) => m.type === "edit" || m.type === "header").map((m) => m.type)
  );
  assert.deepEqual(sent, ["edit", "header"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("only one plain click opens the title: a double click asks once and a modifier asks nothing", { skip }, async () => {
  const h = await editor(TITLED, false);
  // The second press of a double click lands on the same drawing, the host
  // not having answered between the two: one request, not two.
  await clickOn(h.page, "#app .mdm-title", { count: 2 });
  assert.deepEqual(await headerPosts(h.page), [PEEK]);
  await h.page.evaluate(() => {
    window.__posts.length = 0;
  });
  for (const key of ["Alt", "Shift", "Control"]) {
    await h.page.keyboard.down(key);
    await clickOn(h.page, "#app .mdm-subtitle");
    await h.page.keyboard.up(key);
  }
  assert.deepEqual(await headerPosts(h.page), [], "a click with a modifier down opened the header");
  assert.equal(await h.page.evaluate(() => window.__mdm.view.state.selection.ranges.length), 1, "a caret was added");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The block stands over position 0, and a press left to the browser puts the
// native selection there: a table or a score that opens the document would
// take the caret and open under the title that was clicked.
test("a press on the title does not open the block that opens the document", { skip }, async () => {
  const text = HEADER + "\n| a | b |\n|---|---|\n| 1 | 2 |\n\nProse under the table.\n";
  const h = await editor(text, false);
  assert.equal(await h.page.evaluate(() => document.querySelectorAll("#app .mdm-table").length), 1);
  await setSelection(h.page, await h.page.evaluate(() => window.__mdm.view.state.doc.length - 2));
  await clickOn(h.page, "#app .mdm-title");
  assert.equal(await h.page.evaluate(() => document.querySelectorAll("#app .cm-line.mdm-table-line").length), 0, "the table opened");
  assert.deepEqual(await headerPosts(h.page), [PEEK]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("what is typed in the open header is drawn in the title under it", { skip }, async () => {
  const h = await editor(LONG_TITLED, true);
  const at = LONG_TITLED.indexOf("prototype");
  await setSelection(h.page, at);
  await h.page.evaluate(() => window.__mdm.view.focus());
  const parts = await partRebuilds(h.page);
  await h.page.keyboard.type("working ");
  await sleep(200);
  assert.deepEqual((await head(h.page)).title, ["A Markdown Music working prototype"]);
  // The partial rebuild after a keystroke leaves what a whole one gives.
  assert.ok((await partRebuilds(h.page)) > parts, "the keystrokes redrew the whole document, so the partial road was not under test");
  assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
  // A part that goes from the header goes from the block, and a block with
  // nothing left to say goes altogether.
  const cut = async (from, to) => {
    await h.page.evaluate(
      (a, b) => {
        const view = window.__mdm.view;
        const text = view.state.doc.toString();
        const start = text.indexOf(a);
        view.dispatch({ changes: { from: start, to: text.indexOf(b, start) } });
      },
      from,
      to
    );
    await sleep(150);
  };
  await cut("subtitle:", "author:");
  let seen = await head(h.page);
  assert.deepEqual(seen.subtitle, []);
  assert.deepEqual(seen.authors, ["alpelito7"]);
  await cut("title:", "lang:");
  seen = await head(h.page);
  assert.equal(seen.blocks, 0, "a header that names only a language kept its block");
  assert.equal(seen.card, 3);
  assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The header put away is not in the text, so a change to it changes no text:
// the file edited beside the editor, or the language the menu writes.
test("a header that changes beside the editor redraws the title with no change to the text", { skip }, async () => {
  const h = await editor(TITLED, false);
  await answer(h.page, TITLED.replace("A Markdown Music prototype", "Renamed"), false);
  assert.deepEqual((await head(h.page)).title, ["Renamed"]);
  assert.equal(await docText(h.page), BODY);
  await answer(h.page, BARE, false);
  let seen = await head(h.page);
  assert.equal(seen.blocks, 0, "the block outlived its title");
  assert.deepEqual(seen.numbers, ["5", "6", "7"]);
  await answer(h.page, TITLED, false);
  seen = await head(h.page);
  assert.equal(seen.blocks, 1, "the block did not come back");
  assert.deepEqual(seen.numbers, ["1T", "8", "9"]);
  assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("typing at the head of the document keeps the title over it", { skip }, async () => {
  const h = await editor(LONG_TITLED, false);
  await setSelection(h.page, 0);
  await h.page.evaluate(() => window.__mdm.view.focus());
  const parts = await partRebuilds(h.page);
  await h.page.keyboard.type("Now ");
  await sleep(200);
  assert.ok((await docText(h.page)).startsWith("Now This document"));
  const seen = await head(h.page);
  assert.ok((await partRebuilds(h.page)) > parts, "the keystrokes redrew the whole document, so the partial road was not under test");
  assert.equal(seen.blocks, 1, "the title went with the first line's redraw");
  assert.match(seen.order, /^TITLE line/, seen.order);
  assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
  // Everything selected and deleted leaves the header where it was: put
  // away, it is not in the text for an edit to reach.
  await h.page.keyboard.down("Control");
  await h.page.keyboard.press("a");
  await h.page.keyboard.up("Control");
  await h.page.keyboard.press("Delete");
  await sleep(200);
  assert.equal(await docText(h.page), "");
  assert.equal((await head(h.page)).blocks, 1, "deleting the body deleted the title");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the title is read as Markdown, as the page reads it", { skip }, async () => {
  const text = [
    "---",
    'title: "A *slanted* word, a formula $x^2$ and \'quotes\'"',
    "subtitle: With [a link](https://example.org) in it",
    "author:",
    "  - First Author",
    "  - Second Author",
    "date: 2026-10-03",
    "lang: es",
    "---",
    "",
    "Body.",
    "",
  ].join("\n");
  const h = await editor(text, false);
  const seen = await h.page.evaluate(() => {
    const title = document.querySelector("#app .mdm-title");
    const left = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().left);
    const top = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top);
    return {
      em: Array.from(title.querySelectorAll("em")).map((e) => e.textContent),
      maths: title.querySelectorAll(".katex").length,
      stars: /\*/.test(title.textContent),
      quotes: /‘quotes’/.test(title.textContent),
      link: Array.from(document.querySelectorAll("#app .mdm-subtitle .mdm-link")).map((e) => e.textContent),
      authors: Array.from(document.querySelectorAll("#app .mdm-title-authors p")).map((e) => e.textContent),
      date: document.querySelector("#app .mdm-title-date").textContent,
      // The names in the first column and the date in the second, level.
      dateRight: left("#app .mdm-title-date") > left("#app .mdm-title-authors") + 100,
      level: top("#app .mdm-title-date") === top("#app .mdm-title-authors"),
    };
  });
  assert.deepEqual(seen, {
    em: ["slanted"],
    maths: 1,
    stars: false,
    quotes: true,
    link: ["a link"],
    authors: ["First Author", "Second Author"],
    // The page's date for a Spanish document (crossref.test.js).
    date: "3 de octubre de 2026",
    dateRight: true,
    level: true,
  });
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The copy button ----------

// The owner, 2026-10-04: the drawn title shows a copy button with the pointer
// on it, as a table does; a header that draws nothing shows none, there being
// nothing of it on screen; and whichever header it is, the button is there for
// as long as its YAML is shown. One button at a time: beside the drawing while
// the source is put away, and on the card while it is open.
const copyButtons = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("#app .cm-content .mdm-chrome")).map((rail) => {
      const button = rail.querySelector(".mdm-copy");
      return {
        // Where the rail hangs: the drawn title, or a line of the header's card.
        on: rail.closest(".mdm-title-block") ? "title" : rail.closest(".cm-line.mdm-fm-line") ? "card" : "other",
        shown: !!button && getComputedStyle(button).opacity === "1" && getComputedStyle(button).visibility !== "hidden",
        // Past the right edge of the column, in the margin the other rails use.
        inMargin: !!button && button.getBoundingClientRect().left >= document.querySelector("#app .cm-content").getBoundingClientRect().right,
      };
    })
  );
const copied = (page) => page.evaluate(() => window.__copied.slice());

test("the drawn title shows a copy button under the pointer, which copies the header as written", { skip }, async () => {
  const h = await editor(TITLED, false, { clipboard: true });
  // At rest the rail is put away, as every rail is.
  await h.page.mouse.move(450, 700);
  await sleep(400);
  assert.deepEqual(await copyButtons(h.page), [{ on: "title", shown: false, inMargin: true }]);
  // The pointer on any part of the drawing brings it up.
  const at = await middle(h.page, "#app .mdm-subtitle");
  await h.page.mouse.move(at[0], at[1]);
  await sleep(500);
  assert.deepEqual(await copyButtons(h.page), [{ on: "title", shown: true, inMargin: true }]);
  // Level with the title, which is the top of what is drawn.
  const level = await h.page.evaluate(() => {
    const button = document.querySelector("#app .mdm-title-block .mdm-copy").getBoundingClientRect();
    const title = document.querySelector("#app .mdm-title").getBoundingClientRect();
    return Math.round(button.top - title.top);
  });
  assert.ok(Math.abs(level) <= 1, "the button stands " + level + "px from the top of the title");
  // The press on the button copies and opens nothing.
  await clickOn(h.page, "#app .mdm-title-block .mdm-copy");
  assert.deepEqual(await copied(h.page), [frontMatter(TITLED).replace(/\n+$/, "")]);
  assert.ok((await copied(h.page))[0].startsWith("---\ntitle:") && (await copied(h.page))[0].endsWith("\n---"), "the fences are not in what was copied");
  assert.deepEqual(await headerPosts(h.page), [], "the copy button opened the header");
  // A header that changes beside the editor changes what the button copies,
  // also where the change is in a key the block does not draw.
  await answer(h.page, TITLED.replace("lang: en", "lang: es"), false);
  // Onto the drawing first, as a pointer comes: the block was drawn again,
  // and a rail put away takes no press (a press where a hidden button
  // stands goes to what is under it).
  const again = await middle(h.page, "#app .mdm-subtitle");
  await h.page.mouse.move(again[0], again[1]);
  await sleep(400);
  await clickOn(h.page, "#app .mdm-title-block .mdm-copy");
  assert.match((await copied(h.page))[1], /\nlang: es\n---$/);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a header that draws nothing has no copy button until its YAML is shown, and the open card has one for either header", { skip }, async () => {
  const bareDoc = await editor(BARE, false, { clipboard: true });
  assert.deepEqual(await copyButtons(bareDoc.page), [], "a header that is not on screen has a copy button");
  await answer(bareDoc.page, BARE, true, true);
  // Shown with the pointer nowhere near it: the card is a block that is open.
  await bareDoc.page.mouse.move(450, 700);
  await sleep(400);
  assert.deepEqual(await copyButtons(bareDoc.page), [{ on: "card", shown: true, inMargin: true }]);
  await clickOn(bareDoc.page, "#app .cm-line.mdm-fm-line .mdm-copy");
  assert.deepEqual(await copied(bareDoc.page), ["---\nlang: en\n---"]);
  assert.equal((await head(bareDoc.page)).card, 3, "the copy button put the header away");
  assert.deepEqual(bareDoc.errors, []);
  await bareDoc.close();

  // With a title: the card's button, and none on the drawing under it.
  const titledDoc = await editor(TITLED, true, { clipboard: true });
  await titledDoc.page.mouse.move(450, 700);
  await sleep(400);
  assert.deepEqual(await copyButtons(titledDoc.page), [{ on: "card", shown: true, inMargin: true }]);
  await clickOn(titledDoc.page, "#app .cm-line.mdm-fm-line .mdm-copy");
  assert.deepEqual(await copied(titledDoc.page), [frontMatter(TITLED).replace(/\n+$/, "")]);
  // What is typed in the card is what the button copies.
  await setSelection(titledDoc.page, TITLED.indexOf("alpelito7") + "alpelito7".length);
  await titledDoc.page.evaluate(() => window.__mdm.view.focus());
  await titledDoc.page.keyboard.type(" and friends");
  await sleep(200);
  await clickOn(titledDoc.page, "#app .cm-line.mdm-fm-line .mdm-copy");
  assert.match((await copied(titledDoc.page))[1], /\nauthor: alpelito7 and friends\n/);
  // Put away again, the button is the drawing's.
  await answer(titledDoc.page, TITLED, false);
  await titledDoc.page.mouse.move(450, 700);
  await sleep(400);
  assert.deepEqual(await copyButtons(titledDoc.page), [{ on: "title", shown: false, inMargin: true }]);
  assert.deepEqual(titledDoc.errors, []);
  await titledDoc.close();
});

// ---------- Opened by a click, shown by the button ----------

// Asked for by the owner on 2026-10-04, for a header that draws a title:
// "when I click outside (the text, or the dead margin at the sides) the YAML
// must go away, that is, it must work exactly as the tables, the equations
// and the scores do", and "the button in its show mode must show the code
// and take the drawing away, as a header that draws nothing is shown".
//
// The host holds the state (extension-host.test.js) and the editor asks:
// `peek` on the message says the click on the title or the carets leaving,
// and the host's `pinned` on its answer says the source is the button's and
// stays. These play the host, as the tests above do; the last two of the
// file put the real one on the wire.

const FM = '#app button[data-type="mdm-front-matter"]';
// Its tooltip, whether it is lit, whether it is greyed out.
const fmButton = (page) =>
  page.evaluate((sel) => {
    const b = document.querySelector(sel);
    return [b.getAttribute("aria-label"), b.classList.contains("mdm-btn--on"), b.classList.contains("mdm-btn--off")];
  }, FM);
// A point on the line of the text that reads `text`, a little way into it.
const onLine = (page, text) =>
  page.evaluate((t) => {
    const line = Array.from(document.querySelectorAll("#app .cm-content > .cm-line")).find((l) => l.textContent.includes(t));
    const b = line.getBoundingClientRect();
    return [b.left + 60, b.top + b.height / 2];
  }, text);
const clickLine = async (page, text, options) => {
  const at = await onLine(page, text);
  await page.mouse.click(at[0], at[1], options || {});
  await sleep(150);
};
// The dead margin, left of the column.
const clickMargin = async (page) => {
  const at = await page.evaluate(() => {
    const c = document.querySelector("#app .cm-content").getBoundingClientRect();
    return [c.left - 30, c.top + 300];
  });
  await page.mouse.click(at[0], at[1]);
  await sleep(150);
};
const selection = (page) =>
  page.evaluate(() => {
    const sel = window.__mdm.view.state.selection;
    return { ranges: sel.ranges.length, empty: sel.main.empty };
  });
// A click on the drawn title and the host's answer to it.
const peek = async (page, text) => {
  await clickOn(page, "#app .mdm-title");
  await answer(page, text, true);
};
const forget = (page) =>
  page.evaluate(() => {
    window.__posts.length = 0;
  });

test("the source a click opened is put away when the carets leave it, at the release of the button", { skip }, async () => {
  const h = await editor(TITLED, false);
  await peek(h.page, TITLED);
  assert.deepEqual(await headerPosts(h.page), [PEEK]);
  // The button of the bar is dark: it is not what opened this.
  assert.deepEqual(await fmButton(h.page), ["Show YAML header", false, false]);
  // Moving about the source asks nothing: an arrow, a click on another of
  // its lines.
  await h.page.keyboard.press("ArrowDown");
  await clickLine(h.page, "author: alpelito7");
  assert.equal((await caretLine(h.page)).text, "author: alpelito7");
  assert.deepEqual(await headerPosts(h.page), [PEEK]);
  // A press in the body puts the caret there, and nothing is asked while
  // the button is down: the header's lines going would lift the text from
  // under the pointer by the height of the card.
  const at = await onLine(h.page, "More prose under it.");
  await h.page.mouse.move(at[0], at[1]);
  await h.page.mouse.down();
  await sleep(150);
  assert.equal((await caretLine(h.page)).text, "More prose under it.");
  assert.deepEqual(await headerPosts(h.page), [PEEK], "the source was asked away under a button still down");
  await h.page.mouse.up();
  await sleep(150);
  assert.deepEqual(await headerPosts(h.page), [PEEK, LEAVE]);
  // Asked once, however the carets move before the host answers.
  await h.page.keyboard.press("ArrowUp");
  await h.page.keyboard.press("ArrowDown");
  await sleep(100);
  assert.equal((await headerPosts(h.page)).length, 2, "asked again before the answer");
  // The answer: the card goes, the title stands over the first line again,
  // and the caret is where the press put it, a caret and not a selection.
  await answer(h.page, TITLED, false);
  const seen = await head(h.page);
  assert.equal(seen.card, 0);
  assert.equal(seen.open, false);
  assert.match(seen.order, /^TITLE line/, seen.order);
  const caret = await caretLine(h.page);
  assert.equal(caret.text, "More prose under it.");
  assert.equal(caret.focused, true);
  assert.deepEqual(await selection(h.page), { ranges: 1, empty: true });
  assert.deepEqual(h.errors, []);

  // The arrows take the caret out as a click does: from the title's line
  // down the card, and past its last line.
  await forget(h.page);
  await peek(h.page, TITLED);
  for (let i = 0; i < 4; i++) await h.page.keyboard.press("ArrowDown");
  await sleep(100);
  assert.equal((await caretLine(h.page)).text, "---", "four arrows did not reach the closing fence");
  assert.deepEqual(await headerPosts(h.page), [PEEK], "asked away with the caret on the header's last line");
  await h.page.keyboard.press("ArrowDown");
  await sleep(100);
  assert.deepEqual(await headerPosts(h.page), [PEEK, LEAVE]);
  await answer(h.page, TITLED, false);

  // A selection drawn from the source into the body still has an end in
  // it, and a press dragged back into the source has not left it.
  await forget(h.page);
  await peek(h.page, TITLED);
  await clickLine(h.page, "This document is ordinary Markdown.");
  assert.deepEqual(await headerPosts(h.page), [PEEK, LEAVE], "a plain click in the body did not ask");
  await answer(h.page, TITLED, false);
  await forget(h.page);
  await peek(h.page, TITLED);
  await h.page.keyboard.down("Shift");
  await clickLine(h.page, "This document is ordinary Markdown.");
  await h.page.keyboard.up("Shift");
  assert.equal((await selection(h.page)).empty, false, "the shift-click drew no selection");
  assert.deepEqual(await headerPosts(h.page), [PEEK], "a selection with an end in the header put it away");
  const body = await onLine(h.page, "More prose under it.");
  const card = await onLine(h.page, "author: alpelito7");
  await h.page.mouse.move(body[0], body[1]);
  await h.page.mouse.down();
  await sleep(100);
  await h.page.mouse.move(card[0], card[1], { steps: 4 });
  await h.page.mouse.up();
  await sleep(150);
  assert.equal((await selection(h.page)).empty, false, "the drag drew no selection");
  assert.deepEqual(await headerPosts(h.page), [PEEK], "a press dragged back into the header put it away");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a click outside the text puts that source away as well, and the YAML button keeps it instead", { skip }, async () => {
  const h = await editor(TITLED, false);
  // The dead margin beside the column, as it puts a table's source away.
  await peek(h.page, TITLED);
  await forget(h.page);
  await clickMargin(h.page);
  assert.deepEqual(await headerPosts(h.page), [LEAVE]);
  assert.equal(await h.page.evaluate(() => window.__mdm.view.hasFocus), false, "the margin left the document the focus");
  // Asked once: a second click out there before the host has answered.
  await clickMargin(h.page);
  assert.deepEqual(await headerPosts(h.page), [LEAVE], "asked again before the answer");
  await answer(h.page, TITLED, false);
  assert.equal((await head(h.page)).card, 0);
  // The bar, on a button that is not about the selection.
  await peek(h.page, TITLED);
  await forget(h.page);
  await h.page.click('#app button[data-type="mdm-staff-lines"]');
  await sleep(150);
  assert.deepEqual(await headerPosts(h.page), [LEAVE]);
  await answer(h.page, TITLED, false);
  // Its own button asks one thing, and it is to keep the source: put away
  // first, the header would go and come back under the reader.
  await peek(h.page, TITLED);
  await forget(h.page);
  await h.page.click(FM);
  await sleep(150);
  assert.deepEqual(await headerPosts(h.page), [SHOW]);
  // With nothing open a click out there asks nothing.
  await answer(h.page, TITLED, false);
  await forget(h.page);
  await clickMargin(h.page);
  await h.page.click('#app button[data-type="mdm-staff-lines"]');
  await sleep(150);
  assert.deepEqual(await headerPosts(h.page), []);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A header of thirty lines is read by scrolling down it, and the handle of
// the scrollbar is a way to scroll: it is the scroller's own, outside the
// text and no click "outside" in the sense above.
test("the scrollbar's handle leaves the source a click opened where it is", { skip }, async () => {
  const h = await editor(LONG_TITLED, false, { height: 500, bars: true });
  await peek(h.page, LONG_TITLED);
  await forget(h.page);
  const bar = await h.page.evaluate(() => {
    const s = window.__mdm.view.scrollDOM;
    const box = s.getBoundingClientRect();
    return { wide: s.offsetWidth - s.clientWidth, x: box.right - (s.offsetWidth - s.clientWidth) / 2, y: box.top + 20 };
  });
  assert.ok(bar.wide > 5, "no scrollbar is drawn, so nothing was under test");
  // Its handle stands at the top; dragged down, the page scrolls.
  await h.page.mouse.move(bar.x, bar.y);
  await h.page.mouse.down();
  await h.page.mouse.move(bar.x, bar.y + 120, { steps: 6 });
  await h.page.mouse.up();
  await sleep(200);
  assert.ok((await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop)) > 100, "the handle did not scroll the page");
  assert.deepEqual(await headerPosts(h.page), [], "the scrollbar put the header away");
  // The margin beside it still does.
  await clickMargin(h.page);
  assert.deepEqual(await headerPosts(h.page), [LEAVE]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the YAML button shows the source in place of the drawing, and what it shows stays", { skip }, async () => {
  const h = await editor(LONG_TITLED, false);
  await h.page.click(FM);
  await sleep(150);
  assert.deepEqual(await headerPosts(h.page), [SHOW]);
  await answer(h.page, LONG_TITLED, true, true);
  let seen = await head(h.page);
  assert.equal(seen.card, 6, "the source did not open");
  assert.equal(seen.blocks, 0, "the title is drawn under a source the button shows");
  assert.match(seen.order, /^fm fm fm fm fm fm line/, seen.order);
  assert.deepEqual(seen.numbers, ["1", "2", "3"]);
  assert.deepEqual(await fmButton(h.page), ["Hide YAML header", true, false]);
  // The caret was at the head of the body, where a document nobody has
  // clicked in has it, and it is there still: the press gives the text the
  // focus, and a caret left at the head of the text would be in the header
  // and have its title drawn.
  assert.equal(await h.page.evaluate(() => window.__mdm.view.hasFocus), true, "the press did not hand the text the focus, so nothing was under test");
  assert.ok((await caretLine(h.page)).text.startsWith("This document is ordinary"), "the button put the caret in the header");
  // It stays: a caret put in it and taken out, a click in the margin.
  await clickLine(h.page, "author: alpelito7");
  await clickLine(h.page, "More prose under it.");
  await clickMargin(h.page);
  assert.deepEqual(await headerPosts(h.page), [SHOW], "the carets leaving asked for the button's source to be put away");
  assert.equal((await head(h.page)).card, 6);
  // While a caret is in it, what it says is drawn under it as it is typed,
  // as a table is drawn under its rows while they are edited (the owner,
  // 2026-10-05), on the road that redraws a few blocks and not the whole
  // document.
  await clickLine(h.page, "author: alpelito7");
  seen = await head(h.page);
  assert.equal(seen.blocks, 1, "the title is not drawn under the source a caret is in");
  assert.equal(seen.open, true);
  assert.match(seen.order, /^fm fm fm fm fm fm TITLE line/, seen.order);
  assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
  await setSelection(h.page, LONG_TITLED.indexOf("prototype"));
  const parts = await partRebuilds(h.page);
  await h.page.keyboard.type("working ");
  await sleep(200);
  assert.deepEqual((await head(h.page)).title, ["A Markdown Music working prototype"]);
  assert.ok((await partRebuilds(h.page)) > parts, "the keystrokes redrew the whole document, so the partial road was not under test");
  assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
  assert.deepEqual(await fmButton(h.page), ["Hide YAML header", true, false]);
  // And it goes when the carets leave: a click in the body, the document
  // left to nobody. The source stays, and nothing is asked of the host.
  await clickLine(h.page, "More prose under it.");
  seen = await head(h.page);
  assert.equal(seen.blocks, 0, "the drawing stayed under the source after the caret left it");
  assert.equal(seen.card, 6);
  assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
  await clickLine(h.page, "author: alpelito7");
  assert.equal((await head(h.page)).blocks, 1);
  await clickMargin(h.page);
  assert.equal((await head(h.page)).blocks, 0, "the drawing stayed with the document left to nobody");
  assert.deepEqual(await headerPosts(h.page), [SHOW]);
  // A header that says nothing to draw has nothing drawn under it, a caret
  // in it or not.
  const bareDoc = await editor(BARE, true, { pinned: true });
  await clickLine(bareDoc.page, "lang: en");
  assert.equal((await head(bareDoc.page)).blocks, 0);
  assert.deepEqual(bareDoc.errors, []);
  await bareDoc.close();
  // The same text as a click on the title leaves it: the title is drawn
  // under the card and the button is dark, with no change to the text.
  const text = await docText(h.page);
  await setSelection(h.page, 10);
  await answer(h.page, text, true, false);
  seen = await head(h.page);
  assert.equal(seen.blocks, 1, "the mark alone did not bring the drawing back");
  assert.equal(seen.open, true);
  assert.deepEqual(seen.title, ["A Markdown Music working prototype"]);
  assert.deepEqual(await fmButton(h.page), ["Show YAML header", false, false]);
  assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
  // The caret out of it, which asks for a source a click opened to be put
  // away; the host says it is the button's again, and the drawing goes.
  await setSelection(h.page, text.indexOf("More prose"));
  await sleep(100);
  assert.deepEqual(await headerPosts(h.page), [SHOW, LEAVE]);
  await answer(h.page, text, true, true);
  assert.equal((await head(h.page)).blocks, 0);
  // The button again puts it away.
  await h.page.click(FM);
  await sleep(150);
  assert.deepEqual(await headerPosts(h.page), [SHOW, LEAVE, HIDE]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A header typed into a file that had none is the text's from the edit that
// closed it, and the host says so a moment later: open as a click would have
// left it, where it draws a title. By then the carets may be elsewhere, and
// the source with nobody in it would have stayed for good.
test("a header the host opens with no caret in it is put away again", { skip }, async () => {
  const typed = "---\ntitle: Typed\n---\n\n";
  for (const [where, asks] of [["Typed", []], ["More prose", [LEAVE]]]) {
    const h = await bare(BODY);
    await h.page.evaluate((head) => window.__mdm.view.dispatch({ changes: { from: 0, insert: head } }), typed);
    await setSelection(h.page, (typed + BODY).indexOf(where));
    await h.page.evaluate(() => window.__mdm.view.focus());
    await h.page.evaluate(
      (text, head) => window.postMessage({ type: "update", text: text, frontMatter: head, withFrontMatter: true, pinned: false, hiddenLines: 0 }, "*"),
      typed + BODY,
      typed.replace(/\n$/, "")
    );
    await sleep(200);
    assert.deepEqual(await headerPosts(h.page), asks, where);
    const seen = await head(h.page);
    assert.equal(seen.card, 3, where);
    assert.equal(seen.blocks, 1, "the typed title is not drawn under its source");
    assert.deepEqual(await fmButton(h.page), ["Show YAML header", false, false], where);
    // Only as the source opens: an update that finds it open already, the
    // file having changed beside the editor, asks nothing more of it.
    await forget(h.page);
    await h.page.evaluate(
      (text, head) => window.postMessage({ type: "update", text: text, frontMatter: head, withFrontMatter: true, pinned: false, hiddenLines: 0 }, "*"),
      typed + BODY + "A line written beside the editor.\n",
      typed.replace(/\n$/, "")
    );
    await sleep(200);
    assert.ok((await docText(h.page)).endsWith("beside the editor.\n"));
    assert.deepEqual(await headerPosts(h.page), [], where + ": asked again by an update that opened nothing");
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

// The key of the part clicked is looked for as a line of the header, and a
// key YAML lets be written in quotes is not found there. The caret goes into
// the source all the same: outside it, nothing would ever put the source away.
test("a click on a part whose key is written in quotes still puts the caret in the source", { skip }, async () => {
  const text = '---\n"title": Quoted\nlang: en\n---\n\n' + BODY;
  const h = await editor(text, false);
  assert.deepEqual((await head(h.page)).title, ["Quoted"]);
  await peek(h.page, text);
  const caret = await caretLine(h.page);
  assert.equal(caret.text, '"title": Quoted');
  assert.equal(caret.after, "");
  assert.equal(caret.focused, true);
  await clickLine(h.page, "More prose under it.");
  assert.deepEqual(await headerPosts(h.page), [PEEK, LEAVE]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The header's lines come into the text and leave it over everything the
// reader is looking at. Measured in VS Code before this was held
// (2026-10-04): a header of 31 lines open, the page scrolled down to the
// body, a click on a line there, and the line went 676 px up and out of the
// pane as the header was put away.
test("the line the reader is on stays where it is when the header's lines leave the text or come into it", { skip }, async () => {
  const LONG_BARE = "---\nlang: en\n---\n\n" + LONG_BODY;
  // The line at a height of the pane, by the words it opens with, and where
  // a line stands.
  const lineAt = (page, down) =>
    page.evaluate((y) => {
      const pane = window.__mdm.view.scrollDOM.getBoundingClientRect();
      // The first paragraph from that height down: a blank line stands
      // between every two.
      for (let dy = 0; dy < 80; dy += 8) {
        const el = document.elementFromPoint(pane.left + pane.width / 2, pane.top + y + dy);
        const line = el && el.closest("#app .cm-content > .cm-line");
        const named = line && /^Paragraph \d+ of/.exec(line.textContent);
        if (named) return named[0];
      }
      return null;
    }, down);
  const topOf = (page, text) =>
    page.evaluate((t) => {
      const line = Array.from(document.querySelectorAll("#app .cm-content > .cm-line")).find((l) => l.textContent.startsWith(t));
      return line ? Math.round(line.getBoundingClientRect().top) : null;
    }, text);
  const scrollTo = async (page, top) => {
    await page.evaluate((y) => {
      window.__mdm.view.scrollDOM.scrollTop = y;
    }, top);
    await sleep(250);
  };
  const held = async (page, line, before, what) => {
    await sleep(150);
    const after = await topOf(page, line);
    assert.ok(after !== null && Math.abs(after - before) <= 1, what + ": the line moved " + (after - before) + "px");
  };

  const h = await editor(LONG_TITLED, false, { height: 700 });
  // A click in the body, with the card and the title above the pane.
  await peek(h.page, LONG_TITLED);
  await scrollTo(h.page, 900);
  let line = await lineAt(h.page, 300);
  assert.ok(line, "no paragraph of the body at the middle of the pane");
  let before = await topOf(h.page, line);
  await clickLine(h.page, line);
  assert.deepEqual(await headerPosts(h.page), [PEEK, LEAVE]);
  await answer(h.page, LONG_TITLED, false);
  await held(h.page, line, before, "a click in the body");
  assert.ok((await caretLine(h.page)).text.startsWith(line));
  assert.ok((await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop)) > 100, "the page went to the top");
  // The same with the header only just above the pane, where the blank
  // line under it is drawn too: that line goes with the header, and is not
  // the one to hold the page by.
  await scrollTo(h.page, 0);
  await forget(h.page);
  await peek(h.page, LONG_TITLED);
  const bodyStarts = await topOf(h.page, "This document is ordinary");
  await scrollTo(h.page, bodyStarts - 80);
  line = await lineAt(h.page, 200);
  before = await topOf(h.page, line);
  assert.ok(
    await h.page.evaluate(() => Array.from(document.querySelectorAll("#app .cm-content > .cm-line")).some((l) => l.textContent === "---")),
    "the header is not drawn above the pane, so nothing new was under test"
  );
  await clickLine(h.page, line);
  await answer(h.page, LONG_TITLED, false);
  await held(h.page, line, before, "a click in the body, the header just above the pane");
  await scrollTo(h.page, 900);
  // The title was put back at the head of a document whose head was not on
  // screen, and the editor still knows how tall it is: a jump to the top
  // lands on the top, with the title whole.
  await scrollTo(h.page, 0);
  assert.equal(await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop), 0, "the page stopped short of the top");
  assert.ok((await topOf(h.page, "This document is ordinary")) > 150, "the title is not over the first line");
  // A click on the title with the page a little down: the card opens over
  // the title, at the head of the document, and the page goes there.
  await scrollTo(h.page, 40);
  await forget(h.page);
  await peek(h.page, LONG_TITLED);
  await sleep(150);
  assert.equal(await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop), 0, "the card opened above the pane");
  await clickMargin(h.page);
  await answer(h.page, LONG_TITLED, false);
  // With the header in the pane and the page at its top there is nothing
  // to hold the line with, and the page stays at the top.
  await forget(h.page);
  await peek(h.page, LONG_TITLED);
  await clickLine(h.page, "This document is ordinary");
  assert.deepEqual(await headerPosts(h.page), [PEEK, LEAVE]);
  await answer(h.page, LONG_TITLED, false);
  await sleep(150);
  assert.equal(await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop), 0, "the page left the top");
  // A second click on the drawing under the card, with the card above the
  // pane: the drawing stays under the pointer, as a table's does.
  await forget(h.page);
  await peek(h.page, LONG_TITLED);
  const cardHeight = await h.page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll("#app .cm-line.mdm-fm-line"));
    return Math.round(lines[lines.length - 1].getBoundingClientRect().bottom - lines[0].getBoundingClientRect().top);
  });
  await scrollTo(h.page, cardHeight + 60);
  const drawingTop = () => h.page.evaluate(() => Math.round(document.querySelector("#app .mdm-subtitle").getBoundingClientRect().top));
  before = await drawingTop();
  await clickOn(h.page, "#app .mdm-subtitle");
  assert.deepEqual(await headerPosts(h.page), [PEEK, LEAVE]);
  await answer(h.page, LONG_TITLED, false);
  await sleep(150);
  assert.ok(Math.abs((await drawingTop()) - before) <= 1, "the drawing moved " + ((await drawingTop()) - before) + "px from under the pointer");
  // A click in the margin: the caret is in the header, out of the pane,
  // and the line held is the first the pane shows.
  await forget(h.page);
  await peek(h.page, LONG_TITLED);
  await scrollTo(h.page, 900);
  line = await lineAt(h.page, 300);
  before = await topOf(h.page, line);
  await clickMargin(h.page);
  assert.deepEqual(await headerPosts(h.page), [PEEK, LEAVE]);
  await answer(h.page, LONG_TITLED, false);
  await held(h.page, line, before, "a click in the margin");
  assert.deepEqual(h.errors, []);
  await h.close();

  // The lines coming in: a header that draws nothing, brought into view by
  // the setting being touched in another editor, and put away the same way.
  const b = await editor(LONG_BARE, false, { height: 700 });
  await scrollTo(b.page, 600);
  line = await lineAt(b.page, 300);
  before = await topOf(b.page, line);
  await answer(b.page, LONG_BARE, true, true);
  assert.ok((await docText(b.page)).startsWith("---\nlang: en\n---\n"), "the header did not come into the text");
  await held(b.page, line, before, "the header coming in");
  await answer(b.page, LONG_BARE, false);
  await held(b.page, line, before, "the header going");
  assert.deepEqual(b.errors, []);
  await b.close();
});

// ---------- An undo whose text has gone ----------

// The header's lines leave the text when it is put away, and what was
// written in them is still in the history, with nowhere to stand. Measured
// before this was mended (2026-10-04): a word of the title deleted, the
// header put away, Ctrl+Z, and the word was written into the first line of
// the body. Every step of the history now says where it was made, and one
// whose place has been deleted from around it by a change from outside is
// taken out without being applied (historyStep in main.js).
const ctrl = async (page, key) => {
  await page.keyboard.down("Control");
  await page.keyboard.press(key);
  await page.keyboard.up("Control");
  await sleep(150);
};
// The host's acknowledgement of the last edit the page sent, so that the
// text of that edit is what the two sides agree on.
const acknowledge = async (page) => {
  await page.evaluate(() => {
    const edits = window.__posts.filter((m) => m.type === "edit");
    if (edits.length) window.postMessage({ type: "applied", seq: edits[edits.length - 1].seq }, "*");
  });
  await sleep(50);
};
// A change made as the reader makes one, each a step of the history of its
// own: the wait is longer than the half second that joins two.
const change = async (page, find, insert) => {
  await page.evaluate(
    (f, text) => {
      const view = window.__mdm.view;
      const at = view.state.doc.toString().indexOf(f);
      view.dispatch({ changes: { from: at, to: at + f.length, insert: text }, userEvent: text ? "input.type" : "delete.backward" });
    },
    find,
    insert
  );
  await sleep(650);
};

test("an undo of what was written in the header leaves the body alone once the header is put away", { skip }, async () => {
  const h = await editor(TITLED, true);
  await h.page.evaluate(() => window.__mdm.view.focus());
  // A step in the body, then four in the header: a word deleted, a word
  // replaced, a word typed, and the opening fence typed over itself, which
  // is a change at the very head of the text.
  await change(h.page, "ordinary ", "");
  await change(h.page, "Music ", "");
  await change(h.page, "alpelito7", "somebody");
  await h.page.evaluate(() => {
    const view = window.__mdm.view;
    const at = view.state.doc.toString().indexOf("somebody") + "somebody".length;
    view.dispatch({ changes: { from: at, insert: " else" }, userEvent: "input.type" });
  });
  await sleep(650);
  await h.page.evaluate(() => window.__mdm.view.dispatch({ changes: { from: 0, to: 3, insert: "---" }, userEvent: "input.paste" }));
  await sleep(650);
  await acknowledge(h.page);
  const edited = await docText(h.page);
  assert.ok(edited.startsWith('---\ntitle: "A Markdown prototype"'), edited.slice(0, 60));
  assert.ok(edited.includes("author: somebody else\n"), edited.slice(0, 140));
  const body = BODY.replace("ordinary ", "");
  // Put away, and the caret left in the body, where the reader went on.
  await answer(h.page, edited, false);
  assert.equal(await docText(h.page), body);
  const caret = body.indexOf("More prose") + 4;
  await setSelection(h.page, caret);
  const where = () => h.page.evaluate(() => [window.__mdm.view.state.selection.main.head, window.__mdm.view.state.selection.main.empty]);
  // Four presses for the header's four steps, none of which writes
  // anything or takes the caret anywhere, and the fifth is the body's own.
  for (const step of ["the fence", "the word typed", "the name", "the word of the title"]) {
    await ctrl(h.page, "z");
    assert.equal(await docText(h.page), body, "the undo of " + step + " wrote into the body");
    assert.deepEqual(await where(), [caret, true], "the undo of " + step + " moved the caret");
  }
  await ctrl(h.page, "z");
  assert.equal(await docText(h.page), BODY, "the body's own step was lost with the header's");
  // And forward again: the body's, and nothing after it.
  await ctrl(h.page, "y");
  assert.equal(await docText(h.page), body);
  const redone = await where();
  for (let i = 0; i < 4; i++) {
    await ctrl(h.page, "y");
    assert.equal(await docText(h.page), body, "a redo of the header's steps wrote into the body");
    assert.deepEqual(await where(), redone, "a redo of the header's steps moved the caret");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the header opened again does not give its old steps back their place", { skip }, async () => {
  const h = await editor(TITLED, true);
  await h.page.evaluate(() => window.__mdm.view.focus());
  await change(h.page, "Music ", "");
  await acknowledge(h.page);
  const edited = await docText(h.page);
  await answer(h.page, edited, false);
  await answer(h.page, edited, true);
  assert.equal(await docText(h.page), edited);
  // The lines are new ones to the history: the word would go in at the head
  // of the text, over the opening fence, or at the head of the body.
  await ctrl(h.page, "z");
  assert.equal(await docText(h.page), edited);
  // A redo is a step like any other: a word typed in the header and taken
  // back there with Ctrl+Z, the header put away, and Ctrl+Y would write the
  // word at the head of the body.
  const redo = await editor(TITLED, true);
  await redo.page.evaluate(() => window.__mdm.view.focus());
  await redo.page.evaluate((at) => window.__mdm.view.dispatch({ changes: { from: at, insert: "working " }, userEvent: "input.type" }), TITLED.indexOf("prototype"));
  await sleep(650);
  await ctrl(redo.page, "z");
  assert.equal(await docText(redo.page), TITLED, "the undo in the open header did not take the word back");
  await acknowledge(redo.page);
  await answer(redo.page, TITLED, false);
  await ctrl(redo.page, "y");
  assert.equal(await docText(redo.page), BODY, "the redo wrote the header's word into the body");
  assert.deepEqual(redo.errors, []);
  await redo.close();
  // The same from the toolbar's arrow, from the browser's own undo, and
  // from the undo of the selection (Ctrl+U), each on a header of its own.
  for (const how of ["button", "browser", "selection"]) {
    const again = await editor(TITLED, true);
    await again.page.evaluate(() => window.__mdm.view.focus());
    await change(again.page, "Music ", "");
    await acknowledge(again.page);
    const text = await docText(again.page);
    await answer(again.page, text, false);
    const left = await docText(again.page);
    if (how === "button") await again.page.click('#app button[data-type="undo"]');
    else if (how === "selection") await ctrl(again.page, "u");
    else {
      await again.page.evaluate(() =>
        window.__mdm.view.contentDOM.dispatchEvent(new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true }))
      );
    }
    await sleep(150);
    assert.equal(await docText(again.page), left, how + ": the word deleted in the title was written into the body");
    assert.deepEqual(again.errors, []);
    await again.close();
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The rule is about any change from outside, the header going being the one
// that happens every day: a place is gone when the text on both sides of it
// has been deleted, and not when a change from outside only came up to it.
test("an undo is dropped only when the text around its place was deleted from outside", { skip }, async () => {
  const text = "First paragraph of the document.\n\nSecond paragraph, with a word to delete.\n\nThird paragraph, to the end.\n";
  const gone = "First paragraph of the document.\n\nThird paragraph, to the end.\n";
  const cases = [
    // The paragraph the word was deleted in, taken out from outside.
    [gone, gone],
    // Another paragraph: the word goes back where it was.
    ["First paragraph of the document.\n\nSecond paragraph, with a to delete.\n", "First paragraph of the document.\n\nSecond paragraph, with a word to delete.\n"],
    // What follows the place, from the place on, and what comes before it,
    // up to the place: it still has a side to stand on.
    ["First paragraph of the document.\n\nSecond paragraph, with a \n\nThird paragraph, to the end.\n", "First paragraph of the document.\n\nSecond paragraph, with a word \n\nThird paragraph, to the end.\n"],
    ["First paragraph of the document.\n\nto delete.\n\nThird paragraph, to the end.\n", "First paragraph of the document.\n\nword to delete.\n\nThird paragraph, to the end.\n"],
  ];
  for (const [outside, undone] of cases) {
    const h = await open({ text: text, scores: 0, withFrontMatter: false, frontMatter: "" });
    await h.page.evaluate(() => window.__mdm.view.focus());
    await change(h.page, "word ", "");
    await acknowledge(h.page);
    await update(h.page, outside, false, 0, "");
    assert.equal(await docText(h.page), outside);
    await ctrl(h.page, "z");
    assert.equal(await docText(h.page), undone, JSON.stringify(outside));
    assert.deepEqual(h.errors, []);
    await h.close();
  }
  // The place follows the text through a change from outside that moves
  // it: a paragraph written over the first, and then the paragraph of the
  // deleted word taken out.
  const moved = await open({ text: text, scores: 0, withFrontMatter: false, frontMatter: "" });
  await moved.page.evaluate(() => window.__mdm.view.focus());
  await change(moved.page, "word ", "");
  await acknowledge(moved.page);
  const above = "A paragraph written over the first, from outside.\n\n";
  await update(moved.page, above + text.replace("word ", ""), false, 0, "");
  await update(moved.page, above + gone, false, 0, "");
  await ctrl(moved.page, "z");
  assert.equal(await docText(moved.page), above + gone, "a place that had moved was looked for where it used to be");
  assert.deepEqual(moved.errors, []);
  await moved.close();
  // A word typed here and deleted from outside: the step has its place and
  // nothing left to take back, and its undo leaves the caret where it is.
  const typed = await open({ text: text, scores: 0, withFrontMatter: false, frontMatter: "" });
  await typed.page.evaluate(() => window.__mdm.view.focus());
  await typed.page.evaluate((at) => window.__mdm.view.dispatch({ changes: { from: at, insert: "lovely " }, userEvent: "input.type" }), text.indexOf("word"));
  await sleep(650);
  await acknowledge(typed.page);
  await update(typed.page, text, false, 0, "");
  await setSelection(typed.page, text.indexOf("Third"));
  await ctrl(typed.page, "z");
  assert.equal(await docText(typed.page), text);
  assert.equal(await typed.page.evaluate(() => window.__mdm.view.state.selection.main.head), text.indexOf("Third"), "an undo with nothing to take back moved the caret");
  assert.deepEqual(typed.errors, []);
  await typed.close();
  // Typing joined into one step with a deletion inside what was typed is
  // undone as ever: the place of the later change is inside text the step
  // itself takes back, and that is no change from outside.
  const h = await open({ text: text, scores: 0, withFrontMatter: false, frontMatter: "" });
  await setSelection(h.page, text.indexOf("word"));
  await h.page.evaluate(() => window.__mdm.view.focus());
  await h.page.keyboard.type("lovely");
  await h.page.keyboard.press("Backspace");
  await h.page.keyboard.press("Backspace");
  await sleep(100);
  assert.ok((await docText(h.page)).includes("a loveword"), "the typing did not land");
  assert.equal(await h.page.evaluate(() => window.CM.undoDepth(window.__mdm.view.state)), 1, "the typing and the deletion were not joined, so nothing was under test");
  await ctrl(h.page, "z");
  assert.equal(await docText(h.page), text, "a step made of joined changes was dropped");
  // And a step of the selection alone, which has no place of its own, is
  // taken as ever: Ctrl+U brings the caret back from where it went.
  await setSelection(h.page, 5);
  await setSelection(h.page, 40);
  await ctrl(h.page, "u");
  assert.equal(await h.page.evaluate(() => window.__mdm.view.state.selection.main.head), 5, "the undo of the selection was taken out with nothing done");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- With the host on the other end ----------

// The same gestures with extension.js answering them, in Node over the mock
// of VS Code: what the two halves were each tested against is what the other
// half does.
async function withHost(text, settings) {
  vscode._reset();
  Object.assign(vscode._state.settings, settings || {});
  vscode._state.documents.set("file:///doc.mdm", text);
  ext.activate({ subscriptions: [], extensionUri: vscode.Uri.file("/ext"), globalState: vscode._memento() });
  const providers = vscode._state.registeredProviders;
  const provider = providers[providers.length - 1].provider;
  let page = null;
  let receive = null;
  const panel = {
    webview: {
      asWebviewUri: (u) => u,
      cspSource: "vscode-resource:",
      postMessage(msg) {
        if (!page) return Promise.resolve(false);
        return page.evaluate((m) => window.postMessage(m, "*"), msg).then(
          () => true,
          () => false
        );
      },
      onDidReceiveMessage(handler) {
        receive = handler;
      },
    },
    onDidDispose() {},
  };
  const document = vscode._makeDocument("file:///doc.mdm");
  provider.resolveCustomTextEditor(document, panel);
  const settingsOf = JSON.parse(/window\.MDM_SETTINGS = (\{.*?\});/.exec(panel.webview.html)[1]);
  const h = await open({
    seed: { settings: settingsOf },
    scores: 0,
    height: 900,
    toHost: (msg, p) => {
      page = p;
      return receive(msg);
    },
  });
  return { page: h.page, errors: h.errors, close: h.close, document: document };
}
const settle = () => sleep(250);

test("from a click to a click away, with the host on the other end", { skip }, async () => {
  const h = await withHost(TITLED, {});
  // Drawn, where headers are put away.
  let seen = await head(h.page);
  assert.equal(seen.card, 0);
  assert.equal(seen.blocks, 1);
  assert.deepEqual(await fmButton(h.page), ["Show YAML header", false, false]);
  // A click opens the source over the drawing, and a click in the body
  // puts it away with the caret where the click was.
  await clickOn(h.page, "#app .mdm-title");
  await settle();
  seen = await head(h.page);
  assert.equal(seen.card, 6);
  assert.equal(seen.open, true);
  assert.match(seen.order, /^fm fm fm fm fm fm TITLE line/, seen.order);
  assert.ok((await caretLine(h.page)).text.startsWith("title:"));
  await clickLine(h.page, "More prose under it.");
  await settle();
  seen = await head(h.page);
  assert.equal(seen.card, 0, "a click in the body left the source open");
  assert.match(seen.order, /^TITLE line/, seen.order);
  assert.equal((await caretLine(h.page)).text, "More prose under it.");
  assert.deepEqual(await selection(h.page), { ranges: 1, empty: true });
  // What is typed in the source is in the file by the time it has gone,
  // and in the title drawn from it.
  await clickOn(h.page, "#app .mdm-title");
  await settle();
  await h.page.keyboard.type(" at work");
  await clickMargin(h.page);
  await settle();
  seen = await head(h.page);
  assert.equal(seen.card, 0, "a click in the margin left the source open");
  assert.deepEqual(seen.title, ["A Markdown Music prototype at work"]);
  assert.ok(h.document.getText().startsWith('---\ntitle: "A Markdown Music prototype at work"\n'), h.document.getText().slice(0, 60));
  assert.equal(await docText(h.page), BODY);
  // Ctrl+Z after that writes nothing into the body. (The file's header is
  // put back by the workbench's own undo inside VS Code, which is not here.)
  await clickLine(h.page, "More prose under it.");
  await ctrl(h.page, "z");
  await settle();
  assert.equal(await docText(h.page), BODY);
  assert.ok(h.document.getText().endsWith("\n" + BODY), "the undo reached the file's body");
  assert.deepEqual(vscode._state.updates, [], "a click on the title wrote the setting");
  // The button: the source alone, and it stays through a click in the body
  // and one in the margin, until the button is pressed again. It is the
  // setting, for a header that draws a title as for any other.
  await h.page.click(FM);
  await settle();
  seen = await head(h.page);
  assert.equal(seen.card, 6);
  assert.equal(seen.blocks, 0, "the title is drawn under a source the button shows");
  assert.deepEqual(await fmButton(h.page), ["Hide YAML header", true, false]);
  assert.deepEqual(vscode._state.updates.map((u) => u.key + "=" + u.value), ["mdm.frontMatter=shown"]);
  await clickLine(h.page, "More prose under it.");
  await clickMargin(h.page);
  await settle();
  assert.equal((await head(h.page)).card, 6, "a click outside put away what the button shows");
  await h.page.click(FM);
  await settle();
  seen = await head(h.page);
  assert.equal(seen.card, 0);
  assert.equal(seen.blocks, 1);
  assert.deepEqual(vscode._state.updates.map((u) => u.value), ["shown", "hidden"]);
  // From a source a click opened, the button keeps it and takes the
  // drawing from under it once the carets are out of it, with no moment of
  // the header gone between.
  await clickOn(h.page, "#app .mdm-title");
  await settle();
  await h.page.click(FM);
  await settle();
  seen = await head(h.page);
  assert.equal(seen.card, 6);
  assert.deepEqual(await fmButton(h.page), ["Hide YAML header", true, false]);
  await clickLine(h.page, "More prose under it.");
  await settle();
  seen = await head(h.page);
  assert.equal(seen.card, 6);
  assert.equal(seen.blocks, 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("where headers are kept in view every header comes up as its YAML, with the host on the other end", { skip }, async () => {
  // A header with a title: its YAML, no drawing, the button lit.
  const t = await withHost(TITLED, { "mdm.frontMatter": "shown" });
  let seen = await head(t.page);
  assert.equal(seen.card, 6, "a titled header was not kept in view by the setting");
  assert.equal(seen.blocks, 0);
  assert.deepEqual(await fmButton(t.page), ["Hide YAML header", true, false]);
  // What is typed in it is drawn under it while the caret is there.
  await clickLine(t.page, "author: alpelito7");
  await t.page.keyboard.press("End");
  await t.page.keyboard.type(" and friends");
  await sleep(500);
  seen = await head(t.page);
  assert.equal(seen.blocks, 1);
  assert.deepEqual(seen.authors, ["alpelito7 and friends"]);
  await clickLine(t.page, "More prose under it.");
  await settle();
  seen = await head(t.page);
  assert.equal(seen.card, 6, "a click outside put away a header the setting keeps in view");
  assert.equal(seen.blocks, 0);
  assert.deepEqual(await headerPosts(t.page), [], "and the editor asked for it");
  // The button puts it away and the title is drawn, and that is the setting.
  await t.page.click(FM);
  await settle();
  seen = await head(t.page);
  assert.equal(seen.card, 0);
  assert.deepEqual(seen.authors, ["alpelito7 and friends"]);
  assert.deepEqual(vscode._state.updates.map((u) => u.key + "=" + u.value), ["mdm.frontMatter=hidden"]);
  assert.deepEqual(t.errors, []);
  await t.close();

  // A header that draws nothing: the same, and a title typed into it is
  // drawn as it is typed.
  const h = await withHost(BARE, { "mdm.frontMatter": "shown" });
  seen = await head(h.page);
  assert.equal(seen.card, 3);
  assert.equal(seen.blocks, 0);
  assert.deepEqual(await fmButton(h.page), ["Hide YAML header", true, false]);
  await clickLine(h.page, "lang: en");
  await clickLine(h.page, "More prose under it.");
  await clickMargin(h.page);
  await settle();
  assert.equal((await head(h.page)).card, 3, "a click outside put away a header the setting keeps in view");
  assert.deepEqual(await headerPosts(h.page), [], "and the editor asked for it");
  await setSelection(h.page, BARE.indexOf("lang: en"));
  await h.page.evaluate(() => window.__mdm.view.focus());
  await h.page.keyboard.type("title: Now titled\n");
  await sleep(500);
  seen = await head(h.page);
  assert.equal(seen.card, 4);
  assert.deepEqual(seen.title, ["Now titled"], "the title typed into the header is not drawn as it is typed");
  await clickLine(h.page, "More prose under it.");
  await settle();
  seen = await head(h.page);
  assert.equal(seen.card, 4);
  assert.equal(seen.blocks, 0);
  assert.deepEqual(await fmButton(h.page), ["Hide YAML header", true, false]);
  // The button puts it away, and the title is drawn.
  await h.page.click(FM);
  await settle();
  seen = await head(h.page);
  assert.equal(seen.card, 0);
  assert.deepEqual(seen.title, ["Now titled"]);
  assert.deepEqual(vscode._state.updates.map((u) => u.value), ["hidden"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The rest of the block ----------

// Everything else the page prints at its head, asked for on 2026-10-04: the
// header of the document the page was measured on that day (html.test.js sets
// the two side by side), with the categories and a description added.
const FULL_HEADER = [
  "---",
  'title: "A Study of the Circle of Fifths"',
  'subtitle: "Notes for the harmony class"',
  "author:",
  "  - name: Ada Lovelace",
  "    email: ada@example.org",
  "    orcid: 0000-0002-1825-0097",
  "    url: https://example.org/ada",
  "    affiliations:",
  "      - name: Analytical Engine Institute",
  "        department: Department of Music",
  "        city: London",
  "        country: UK",
  "        url: https://example.org",
  "  - name: Clara Schumann",
  "    affiliation: Leipzig Conservatory",
  "date: 2026-10-04",
  "date-modified: 2026-10-05",
  "doi: 10.1234/abcd.5678",
  "abstract: |",
  "  First paragraph of the abstract with *emphasis* and a formula $a^2+b^2$, long enough to wrap over more than one line of the column so the measure can be read off it.",
  "",
  "  Second paragraph of the abstract.",
  "keywords: [harmony, circle of fifths, tuning]",
  "lang: en",
  "---",
  "",
].join("\n");
const FULL_BODY =
  "This document is ordinary Markdown. The first paragraph is long enough to wrap, so that its first line can be compared between the editor and the page.\n\n## A heading\n\nMore text.\n";
const FULL = FULL_HEADER + "\n" + FULL_BODY;
const withKeys = (text, lines) => text.replace("lang: en\n", lines.join("\n") + "\nlang: en\n");

// The parts of the block as they stand in it.
const drawn = (page) =>
  page.evaluate(() => {
    const block = document.querySelector("#app .mdm-title-block");
    const clean = (e) => e.textContent.replace(/\s+/g, " ").trim();
    const text = (sel) => Array.from(block.querySelectorAll(sel)).map(clean);
    return {
      order: Array.from(block.querySelector(".mdm-title-inner").children).map((e) => e.className.replace("mdm-title-prose ", "")),
      keys: Array.from(block.querySelectorAll("[data-mdm-key]")).map((e) => e.getAttribute("data-mdm-key")),
      categories: text(".mdm-title-category"),
      description: text(".mdm-title-description"),
      authors: text(".mdm-title-author p"),
      affiliations: Array.from(block.querySelectorAll(".mdm-title-affiliations")).map((c) => Array.from(c.querySelectorAll("p")).map(clean)),
      names: text(".mdm-title-authors p"),
      links: Array.from(block.querySelectorAll(".mdm-link")).map((e) => e.getAttribute("data-mdm-href")),
      dates: text(".mdm-title-date p").concat(text(".mdm-title-modified p")),
      doi: text(".mdm-title-doi p"),
      labels: text(".mdm-title-label"),
      abstract: text(".mdm-title-abstract > p"),
      keywords: text(".mdm-title-keywords > p"),
      emphasis: text(".mdm-title-abstract em"),
      maths: block.querySelectorAll(".mdm-title-abstract .katex").length,
      marks: [block.querySelectorAll(".mdm-title-email svg").length, block.querySelectorAll(".mdm-title-orcid svg").length],
    };
  });

test("every part the page prints at its head is drawn, in the page's order", { skip }, async () => {
  const text = withKeys(FULL, ["categories: [music, harmony]", 'description: "A description on one line."']);
  const h = await editor(text, false);
  assert.deepEqual(await drawn(h.page), {
    order: [
      "mdm-title", "mdm-subtitle", "mdm-title-categories", "mdm-title-description", "mdm-title-byline", "mdm-title-meta",
      "mdm-title-abstract", "mdm-title-keywords",
    ],
    keys: ["title", "subtitle", "categories", "description", "author", "date", "date-modified", "doi", "abstract", "keywords"],
    categories: ["music", "harmony"],
    description: ["A description on one line."],
    authors: ["Ada Lovelace", "Clara Schumann"],
    affiliations: [["Analytical Engine Institute"], ["Leipzig Conservatory"]],
    // No column of names in the row of the dates: each stands beside its
    // affiliation.
    names: [],
    // The author's own address, the envelope, the ORCID mark, the address of
    // the affiliation, and the DOI.
    links: [
      "https://example.org/ada", "mailto:ada@example.org", "https://orcid.org/0000-0002-1825-0097", "https://example.org",
      "https://doi.org/10.1234/abcd.5678",
    ],
    dates: ["October 4, 2026", "October 5, 2026"],
    doi: ["10.1234/abcd.5678"],
    labels: ["Abstract", "Keywords"],
    abstract: [
      "First paragraph of the abstract with emphasis and a formula a2+b2a^2+b^2a2+b2, long enough to wrap over more than one line of the column so the measure can be read off it.",
      "Second paragraph of the abstract.",
    ],
    keywords: ["harmony, circle of fifths, tuning"],
    emphasis: ["emphasis"],
    maths: 1,
    marks: [1, 1],
  });
  // The body under it, and the number of the header's first line on the
  // block.
  assert.equal(await docText(h.page), FULL_BODY);
  const seen = await head(h.page);
  assert.equal(seen.numbered, true);
  assert.deepEqual(seen.numbers.slice(0, 2), ["1T", String(text.split("\n").indexOf(FULL_BODY.split("\n")[0]) + 1)]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the names stand in the row of the date, or beside their affiliations once the document has one", { skip }, async () => {
  const lay = (page) =>
    page.evaluate(() => {
      const block = document.querySelector("#app .mdm-title-block");
      const box = (sel) => {
        const el = block.querySelector(sel);
        return el ? el.getBoundingClientRect() : null;
      };
      const ink = (sel) => {
        const el = block.querySelector(sel);
        return el ? getComputedStyle(el).color : null;
      };
      const left = block.getBoundingClientRect().left;
      const date = box(".mdm-title-date");
      const names = box(".mdm-title-authors");
      const byline = box(".mdm-title-byline");
      return {
        names: !!names,
        byline: !!byline,
        nameInk: ink(".mdm-title-authors p") || ink(".mdm-title-author p"),
        dateInk: ink(".mdm-title-date p"),
        prose: getComputedStyle(document.querySelector("#app .cm-content")).color,
        dateColumn: Math.round(date.left - left) > 100 ? "second" : "first",
        dateUnder: byline ? Math.round(date.top - byline.bottom) : names ? Math.round(date.top - names.top) : null,
        marks: [block.querySelectorAll(".mdm-title-email").length, block.querySelectorAll(".mdm-title-orcid").length],
      };
    });
  // Nobody has an affiliation: one row, the names in its first column and
  // the date in its second, all of it in the fainter ink. An email and an
  // ORCID do not change that, and their marks stand after the name.
  const plain = await editor(
    "---\ntitle: T\nauthor:\n  - name: Ada Lovelace\n    email: ada@example.org\n    orcid: 0000-0002-1825-0097\n  - Second Author\ndate: 2026-10-04\n---\n\n" + BODY,
    false
  );
  const a = await lay(plain.page);
  assert.deepEqual(
    { names: a.names, byline: a.byline, dateColumn: a.dateColumn, dateUnder: a.dateUnder, marks: a.marks },
    { names: true, byline: false, dateColumn: "second", dateUnder: 0, marks: [1, 1] }
  );
  assert.equal(a.nameInk, a.dateInk, "the names and the date are not in one ink");
  assert.notEqual(a.nameInk, a.prose, "the names are in the full ink");
  assert.deepEqual(plain.errors, []);
  await plain.close();
  // One affiliation in the document, and of the second author alone: each
  // author is a row of two columns in full ink, the first with nothing
  // beside it, and the date starts a row of its own under them.
  const placed = await editor(
    "---\ntitle: T\nauthor:\n  - Ada Lovelace\n  - name: Clara Schumann\n    affiliation: Leipzig Conservatory\ndate: 2026-10-04\n---\n\n" + BODY,
    false
  );
  const b = await lay(placed.page);
  assert.deepEqual(
    { names: b.names, byline: b.byline, dateColumn: b.dateColumn, dateUnder: b.dateUnder },
    { names: false, byline: true, dateColumn: "first", dateUnder: 0 }
  );
  assert.equal(b.nameInk, b.prose, "a name beside its affiliation is not in the full ink");
  assert.notEqual(b.dateInk, b.prose, "the date is in the full ink");
  const rows = await placed.page.evaluate(() =>
    Array.from(document.querySelectorAll("#app .mdm-title-byline > div")).map((e) => [e.className, e.textContent, Math.round(e.getBoundingClientRect().top)])
  );
  assert.deepEqual(
    rows.map((r) => r.slice(0, 2)),
    [["mdm-title-author", "Ada Lovelace"], ["mdm-title-affiliations", ""], ["mdm-title-author", "Clara Schumann"], ["mdm-title-affiliations", "Leipzig Conservatory"]]
  );
  assert.equal(rows[0][2], rows[1][2], "an author and its affiliations are not level");
  assert.ok(rows[2][2] > rows[0][2], "the second author is not under the first");
  assert.deepEqual(placed.errors, []);
  await placed.close();
});

test("an abstract written as a block is paragraphs, and one written on a line a run of text at the size of the prose", { skip }, async () => {
  const shape = (page, sel) =>
    page.evaluate((s) => {
      const box = document.querySelector("#app " + s);
      const label = box.querySelector(".mdm-title-label");
      const first = box.querySelector("p");
      return {
        paragraphs: Array.from(box.querySelectorAll(":scope > p")).map((p) => p.textContent),
        breaks: box.querySelectorAll(":scope > br").length,
        text: box.textContent.slice(label ? label.textContent.length : 0),
        // The size the words are set at: a paragraph's, or the box's own.
        size: getComputedStyle(first || box).fontSize,
        label: label ? [label.textContent, getComputedStyle(label).textTransform, getComputedStyle(label).fontSize, getComputedStyle(label).opacity] : null,
      };
    }, sel);
  const block = await editor("---\ntitle: T\nabstract: |\n  One paragraph.\n\n  Another with *emphasis*.\ndescription: >\n  A description\n  folded.\n---\n\n" + BODY, false);
  assert.deepEqual(await shape(block.page, ".mdm-title-abstract"), {
    paragraphs: ["One paragraph.", "Another with emphasis."],
    breaks: 0,
    text: "One paragraph.Another with emphasis.",
    size: "14.4px",
    label: ["Abstract", "uppercase", "12.8px", "0.8"],
  });
  assert.deepEqual(await shape(block.page, ".mdm-title-description"), {
    paragraphs: ["A description folded."], breaks: 0, text: "A description folded.", size: "14.4px", label: null,
  });
  assert.deepEqual(block.errors, []);
  await block.close();
  // On a line, quoted: no paragraph, and the size of the prose. Stripped of
  // its last line break (`|-`) it is the same run, its paragraphs parted by
  // a line break.
  const inline = await editor('---\ntitle: T\nabstract: "On *one* line."\ndescription: |-\n  First.\n\n  Second.\n---\n\n' + BODY, false);
  assert.deepEqual(await shape(inline.page, ".mdm-title-abstract"), {
    paragraphs: [], breaks: 0, text: "On one line.", size: "16px", label: ["Abstract", "uppercase", "12.8px", "0.8"],
  });
  assert.deepEqual(await shape(inline.page, ".mdm-title-description"), {
    paragraphs: [], breaks: 1, text: "First.Second.", size: "16px", label: null,
  });
  assert.deepEqual(inline.errors, []);
  await inline.close();
  // The words over them are the language's.
  const spanish = await editor("---\ntitle: T\nlang: es\nabstract: |\n  Resumen.\nkeywords: [uno, dos]\n---\n\n" + BODY, false);
  assert.deepEqual((await drawn(spanish.page)).labels, ["Resumen", "Palabras clave"]);
  assert.deepEqual((await drawn(spanish.page)).keywords, ["uno, dos"]);
  await spanish.close();
});

// The sizes and the spaces of those parts, as measured on the page exported
// from this very header on 2026-10-04, a 16px body and a column of 820
// (html.test.js sets the two surfaces side by side, in either face). Numbers
// here, so that a rule of the editor's sheet that drifts is caught without a
// Quarto to render the page.
test("the rest of the block is set at the page's sizes and with the page's spaces", { skip }, async () => {
  const h = await editor(FULL, false);
  await h.page.setViewport({ width: 1000, height: 900 });
  await h.page.evaluate(() => document.fonts.ready);
  await h.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const m = await h.page.evaluate(() => {
    const block = document.querySelector("#app .mdm-title-block");
    const at = block.getBoundingClientRect();
    const part = (sel, n) => {
      const el = block.querySelectorAll(sel)[n || 0];
      const r = el.getBoundingClientRect();
      return [+(r.left - at.left).toFixed(1), +(r.top - at.top).toFixed(1), +r.height.toFixed(1)];
    };
    const cs = (sel) => getComputedStyle(block.querySelector(sel));
    const first = Array.from(document.querySelectorAll("#app .cm-content > .cm-line"))[0].getBoundingClientRect();
    return {
      column: +at.width.toFixed(1),
      author: [part(".mdm-title-author p", 0), part(".mdm-title-author p", 1)],
      affiliation: [part(".mdm-title-affiliations p", 0), part(".mdm-title-affiliations p", 1)],
      date: part(".mdm-title-date p"),
      modified: part(".mdm-title-modified p"),
      doi: part(".mdm-title-doi p"),
      envelope: part(".mdm-title-email .mdm-title-icon"),
      orcid: part(".mdm-title-orcid .mdm-title-icon"),
      abstractLabel: part(".mdm-title-abstract .mdm-title-label"),
      abstract: [part(".mdm-title-abstract > p", 0), part(".mdm-title-abstract > p", 1)],
      keywordsLabel: part(".mdm-title-keywords .mdm-title-label"),
      keywords: part(".mdm-title-keywords > p"),
      first: +(first.top - at.top).toFixed(1),
      sizes: [cs(".mdm-title-author").fontSize, cs(".mdm-title-date").fontSize, cs(".mdm-title-abstract > p").fontSize, cs(".mdm-title-label").fontSize],
      columns: [cs(".mdm-title-byline").gridTemplateColumns, cs(".mdm-title-meta").gridTemplateColumns, cs(".mdm-title-byline").columnGap],
      envelopeOpacity: cs(".mdm-title-email").opacity,
      linkInk: cs(".mdm-title-doi .mdm-link").color === cs(".mdm-title-author .mdm-link").color,
      // Justified with the prose, as the page justifies every paragraph of
      // the block; the harness opens with the prose justified.
      aligned: [cs(".mdm-title-abstract > p").textAlign, cs(".mdm-title-author p").textAlign, cs(".mdm-title-date p").textAlign, cs(".mdm-title").textAlign],
    };
  });
  assert.equal(m.column, 820);
  // Left, top and height of each, from the head of the block.
  assert.deepEqual(m.author, [[0, 119.2, 24.5], [0, 145.2, 24.5]], "the authors");
  assert.deepEqual(m.affiliation, [[418, 119.2, 24.5], [418, 145.2, 24.5]], "the affiliations");
  assert.deepEqual(m.date, [0, 171.1, 24.5], "the date");
  assert.deepEqual(m.modified, [418, 171.1, 24.5], "the day it was modified");
  assert.deepEqual(m.doi, [0, 197, 24.5], "the DOI");
  assert.deepEqual(m.abstractLabel, [0, 235.7, 21.8], "the word over the abstract");
  assert.deepEqual(m.abstract, [[0, 257.5, 50.4], [0, 322.3, 24.5]], "the abstract");
  assert.deepEqual(m.keywordsLabel, [0, 359.5, 21.8], "the word over the keywords");
  assert.deepEqual(m.keywords, [0, 381.3, 24.5], "the keywords");
  assert.equal(m.first, 422.8, "the first line of the document under the block");
  assert.deepEqual(m.sizes, ["14.4px", "14.4px", "14.4px", "12.8px"]);
  assert.deepEqual(m.columns, ["402px 402px", "402px 402px", "16px"]);
  // The marks: an em square for the envelope, where the page's icon stands,
  // and 0.8em for ORCID's.
  assert.deepEqual([m.envelope[0], m.envelope[2]], [108.4, 14.4], "the envelope");
  assert.deepEqual([m.orcid[0], m.orcid[1], m.orcid[2]], [128.7, 127.2, 11.5], "the ORCID mark");
  assert.equal(m.envelopeOpacity, "0.7");
  assert.equal(m.linkInk, true);
  assert.deepEqual(m.aligned, ["justify", "justify", "justify", "start"]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // The column of the names is as wide as its widest name asks, and never
  // less than half: Quarto's own rule for the authors beside their
  // affiliations (`minmax(max-content, 1fr) 1fr`), which two short names
  // cannot tell from two halves.
  const long = await editor(
    "---\ntitle: T\nauthor:\n  - name: " + "A Very Long Name Indeed ".repeat(3).trim() + "\n    affiliation: Somewhere\n---\n\n" + BODY,
    false
  );
  await long.page.setViewport({ width: 1000, height: 900 });
  await long.page.evaluate(() => document.fonts.ready);
  await long.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const wide = await long.page.evaluate(() => {
    const columns = getComputedStyle(document.querySelector("#app .mdm-title-byline")).gridTemplateColumns.split(" ").map(parseFloat);
    const name = document.querySelector("#app .mdm-title-author p");
    const range = document.createRange();
    range.selectNodeContents(name);
    return { columns: columns, name: range.getBoundingClientRect().width, rows: Math.round(name.getBoundingClientRect().height) };
  });
  assert.ok(wide.columns[0] > 420 && wide.columns[0] >= wide.name - 0.5, "the column of the names is " + wide.columns[0] + "px for a name of " + wide.name);
  assert.ok(Math.abs(wide.columns[0] + wide.columns[1] + 16 - 820) <= 0.5, "the two columns and their gap are not the column: " + wide.columns);
  assert.equal(wide.rows, 24, "the long name was broken over two rows");
  assert.deepEqual(long.errors, []);
  await long.close();
});

test("the categories and the description stand under the title as on the page", { skip }, async () => {
  // Measured on the export of 2026-10-04: the tags 12px under the title's
  // rule in a row of 32.9px, 10.4px in capitals inside a hairline box; the
  // description straight under them.
  const h = await editor("---\ntitle: T\ncategories: [music, harmony]\ndescription: A description without a banner.\nauthor: A\n---\n\n" + BODY, false);
  const m = await h.page.evaluate(() => {
    const block = document.querySelector("#app .mdm-title-block");
    const at = block.getBoundingClientRect();
    const r = (sel, n) => block.querySelectorAll(sel)[n || 0].getBoundingClientRect();
    const cs = getComputedStyle(block.querySelector(".mdm-title-category"));
    const round = (v) => +v.toFixed(1);
    return {
      tags: [round(r(".mdm-title-categories").top - at.top), round(r(".mdm-title-categories").height)],
      tag: [round(r(".mdm-title-category").height), cs.fontSize, cs.textTransform, cs.opacity, cs.borderTopWidth, cs.borderRadius],
      gap: round(r(".mdm-title-category", 1).left - r(".mdm-title-category", 0).right),
      description: [round(r(".mdm-title-description").top - at.top), round(r(".mdm-title-description").height)],
      names: round(r(".mdm-title-meta").top - at.top),
    };
  });
  assert.deepEqual(m.tags, [79.2, 32.9]);
  assert.deepEqual(m.tag, [24.9, "10.4px", "uppercase", "0.6", "1px", "6.375px"]);
  assert.equal(m.gap, 6.4);
  assert.deepEqual(m.description, [112, 27.2]);
  assert.equal(m.names, 139.2);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a block with no title carries the number of the header's first line and its copy button on what it opens with", { skip }, async () => {
  // What the block opens with, the part that carries the number, and how
  // far under the head of the block its copy button stands: level with the
  // top of that part, which is under its own air for the tags and for the
  // word over an abstract.
  const cases = [
    ["abstract: |\n  Only an abstract.", "mdm-title-prose mdm-title-abstract", 12],
    ['abstract: "On one line."\nkeywords: [k]', "mdm-title-prose mdm-title-abstract", 12],
    ["categories: [a, b]\ndate: 2026-10-04", "mdm-title-categories", 11],
    ["author: A\ndate: 2026-10-04", "", 0],
    ["author:\n  - name: A\n    affiliation: X", "", 0],
    ["doi: 10.1/x", "", 0],
  ];
  for (const [header, part, top] of cases) {
    const h = await editor("---\n" + header + "\n---\n\n" + BODY, false);
    const seen = await h.page.evaluate(() => {
      const block = document.querySelector("#app .mdm-title-block");
      const numbered = Array.from(block.querySelectorAll("[data-mdm-line]"));
      const chrome = block.querySelector(".mdm-chrome");
      const first = numbered[0];
      return {
        numbers: numbered.map((e) => e.getAttribute("data-mdm-line")),
        part: first ? (first.tagName === "P" ? "" : first.className) : null,
        rail: parseFloat(chrome.style.top),
        // Where the part's own top is, under the head of the block.
        partTop: first ? Math.round(first.getBoundingClientRect().top - block.getBoundingClientRect().top) : null,
      };
    });
    assert.deepEqual(seen.numbers, ["1"], header);
    assert.equal(seen.part, part, header);
    assert.equal(seen.rail, top, header);
    assert.ok(Math.abs(seen.partTop - seen.rail) <= 1, header + ": the part stands at " + seen.partTop + " and the button at " + seen.rail);
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

test("a click on a part opens the source with the caret at the end of what its key says", { skip }, async () => {
  const text = withKeys(FULL, ["categories: [music, harmony]", 'description: "A description on one line."']);
  // The part clicked, the line the caret lands on, and what is left of that
  // line after it. A value written under its key is entered at the end of
  // its last line, and a line that closes with a quote or a bracket inside
  // what closes it.
  const cases = [
    [".mdm-title-abstract > p", "  Second paragraph of the abstract.", ""],
    [".mdm-title-abstract .mdm-title-label", "  Second paragraph of the abstract.", ""],
    [".mdm-title-keywords > p", "keywords: [harmony, circle of fifths, tuning]", "]"],
    [".mdm-title-author p", "    affiliation: Leipzig Conservatory", ""],
    [".mdm-title-affiliations p", "    affiliation: Leipzig Conservatory", ""],
    [".mdm-title-date p", "date: 2026-10-04", ""],
    [".mdm-title-modified p", "date-modified: 2026-10-05", ""],
    [".mdm-title-category", "categories: [music, harmony]", "]"],
    [".mdm-title-description", 'description: "A description on one line."', '"'],
  ];
  for (const [sel, line, after] of cases) {
    const h = await editor(text, false);
    await clickOn(h.page, "#app " + sel);
    assert.deepEqual(await headerPosts(h.page), [PEEK], sel);
    await answer(h.page, text, true);
    const caret = await caretLine(h.page);
    assert.equal(caret.text, line, sel);
    assert.equal(caret.after, after, sel + ": the caret is not at the end of the value");
    assert.equal(caret.focused, true, sel);
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

test("a link of the block is followed with the click that follows a link, and opens nothing", { skip }, async () => {
  const h = await editor(FULL, false);
  const followed = () => h.page.evaluate(() => window.__posts.filter((m) => m.type === "openLink").map((m) => m.href));
  const follow = async (sel) => {
    const at = await h.page.evaluate((s) => {
      const b = document.querySelector("#app " + s).getBoundingClientRect();
      return [b.left + b.width / 2, b.top + b.height / 2];
    }, sel);
    await h.page.keyboard.down("Control");
    await h.page.mouse.click(at[0], at[1]);
    await h.page.keyboard.up("Control");
    await sleep(150);
  };
  await follow(".mdm-title-doi .mdm-link");
  await follow(".mdm-title-email");
  await follow(".mdm-title-orcid");
  await follow(".mdm-title-author .mdm-link");
  await follow(".mdm-title-affiliations .mdm-link");
  assert.deepEqual(await followed(), [
    "https://doi.org/10.1234/abcd.5678", "mailto:ada@example.org", "https://orcid.org/0000-0002-1825-0097",
    "https://example.org/ada", "https://example.org",
  ]);
  assert.deepEqual(await headerPosts(h.page), [], "following a link opened the header");
  // The tooltip names the address and the click, as a link of the prose's.
  const tip = await h.page.evaluate(() => document.querySelector("#app .mdm-title-doi .mdm-link").title);
  assert.equal(tip, "https://doi.org/10.1234/abcd.5678\nCtrl+click to open");
  // A plain click on the same link is a click on the block.
  await clickOn(h.page, "#app .mdm-title-doi .mdm-link");
  assert.deepEqual(await headerPosts(h.page), [PEEK]);
  assert.equal((await followed()).length, 5);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The words of a date are the browser's where they are dayjs's
// (mdm-crossref.js, "A date in a format of its own"), and the editor's
// browser is not Node: Chromium carries the words of about two thirds of
// Quarto's locales, answers in English for the rest and writes "M10" for the
// month of a few. crossref.test.js holds the reading under Node, where every
// locale has its words; this holds it in the browser the editor runs in.
test("the browser words a month and a weekday as dayjs does, in every locale the lists name and in no other", { skip }, async (t) => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { execFileSync } = require("node:child_process");
  const { pathToFileURL } = require("node:url");
  const X = require("../vscode-mdm/media/mdm-crossref.js");
  let dir = null;
  try {
    const bin = execFileSync("sh", ["-c", "command -v quarto"], { encoding: "utf8" }).trim();
    dir = bin ? path.join(path.dirname(fs.realpathSync(bin)), "..", "share", "library", "dayjs", "locale") : null;
  } catch (e) {
    dir = null;
  }
  if (!dir || !fs.existsSync(dir)) {
    t.skip("no Quarto on the PATH");
    return;
  }
  // What dayjs has for each locale, and which of them a runtime agrees with:
  // read in the page and here by the same function.
  const words = {};
  for (const name of X.DATE_LOCALES) {
    const locale = (await import(pathToFileURL(path.join(dir, name + ".js")).href)).default;
    words[name] = { months: Array.isArray(locale.months) ? locale.months : null, days: locale.weekdays };
  }
  const AGREE = function (words) {
    const part = (locale, option, type, date) => {
      try {
        const found = new Intl.DateTimeFormat(locale, option).formatToParts(date).find((p) => p.type === type);
        return found ? found.value : null;
      } catch (e) {
        return null;
      }
    };
    const months = [];
    const days = [];
    Object.keys(words).forEach((name) => {
      if (words[name].months && words[name].months.every((w, m) => w === part(name, { month: "long" }, "month", new Date(2023, m, 15)))) months.push(name);
      if (words[name].days.every((w, d) => w === part(name, { weekday: "long" }, "weekday", new Date(2023, 0, 1 + d)))) days.push(name);
    });
    return { months: months, days: days };
  };
  const h = await editor(TITLED, false);
  const here = AGREE(words);
  const there = await h.page.evaluate("(" + AGREE.toString() + ")(" + JSON.stringify(words) + ")");
  const both = (a, b) => a.filter((name) => b.indexOf(name) !== -1).sort();
  assert.deepEqual([...X.INTL_MONTHS].sort(), both(here.months, there.months), "the long months");
  assert.deepEqual([...X.INTL_DAYS].sort(), both(here.days, there.days), "the long weekdays");
  assert.ok(there.months.length < here.months.length, "the browser has every locale Node has: the lists can be longer");
  // What the editor then prints, read in the page: a locale the browser has
  // no words for keeps its date as written, in a style as in a pattern,
  // where it used to come out in English, and one it has prints as the page
  // does.
  const printed = await h.page.evaluate(() => {
    const at = (date, format, lang) => window.MDM_CROSSREF.dateText(date, format, lang, new Date(2026, 9, 3));
    return {
      basque: [at("2026-10-03", null, "eu"), at("2026-10-03", "full", "eu"), at("2026-10-03", "MMMM YYYY", "eu")],
      galician: at("2026-10-03", null, "gl"),
      azerbaijani: at("2026-10-03", null, "az"),
      spanish: [at("2026-10-03", null, "es"), at("2026-10-04", "dddd D [de] MMMM [de] YYYY", "es")],
      french: at("2026-10-04", "dddd D MMMM YYYY", "fr"),
      russian: at("2026-10-03", null, "ru"),
      figures: at("2026-10-03", "DD/MM/YYYY", "eu"),
    };
  });
  assert.deepEqual(printed, {
    basque: ["2026-10-03", "2026-10-03", "2026-10-03"],
    galician: "2026-10-03",
    azerbaijani: "2026-10-03",
    spanish: ["3 de octubre de 2026", "domingo 4 de octubre de 2026"],
    french: "dimanche 4 octobre 2026",
    russian: "3 октября 2026 г.",
    // Figures need no words.
    figures: "03/10/2026",
  });
  // And through the block itself, in the document's language.
  await answer(h.page, '---\ntitle: T\ndate: 2026-10-04\ndate-format: "dddd D [de] MMMM [de] YYYY"\nlang: es\n---\n\n' + BODY, false);
  assert.equal(await h.page.evaluate(() => document.querySelector("#app .mdm-title-date").textContent), "domingo 4 de octubre de 2026");
  assert.deepEqual(h.errors, []);
  await h.close();
});
