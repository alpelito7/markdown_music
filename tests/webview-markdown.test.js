// Markdown conformance of the editor (vscode-mdm/media/main.js), row by row:
// a snippet of Markdown goes in, the document is left unfocused (the reading
// state, where nothing is revealed), and every row the editor draws is
// compared with what a reader of the exported page sees. The expected rows
// are written by hand from the CommonMark spec and from what Pandoc 3.8.3
// makes of the same snippet with the reader the export uses
// (markdown-blank_before_header-blank_before_blockquote), never computed here:
// this suite must run without pandoc.
//
// Each case names the case of the Markdown torture bench it came from
// (md-torture/markdown-torture.md, which is not shipped) so that a failure
// can be looked up there. A case the editor does not pass yet is marked
// `todo` with the package that owes it; the runner reports it without
// failing the run, and the package that fixes it takes the mark off in the
// same commit as the fix.
//
// Run with: node --test --test-concurrency=1 tests/webview-markdown.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { open, skip, rows } = require("./webview/helpers.js");

// Puts the document in the reading state: the focus leaves the editor the
// way a click on a bare stretch of the page takes it, which is what makes
// every mark hidden and every block drawn.
async function reading(page) {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && active.blur) active.blur();
  });
  await page.mouse.click(2, 2);
  await new Promise((r) => setTimeout(r, 150));
}

// A row as the tests write it: [line number, roles, text]. The number is
// the file line the margin shows (null for a drawn block that carries none),
// the roles are the mdm-* classes the row must wear (a subset; a row may wear
// more), and the text is exact. `h` is left out: heights are the look's,
// measured in webview-look.test.js.
function expectRows(actual, expected, id) {
  const shown = actual.map((r) => [r.n, r.roles, r.text, r.h]);
  assert.equal(
    actual.length,
    expected.length,
    id + ": " + expected.length + " rows expected, " + actual.length + " drawn:\n" + JSON.stringify(shown, null, 1)
  );
  expected.forEach((e, i) => {
    const r = actual[i];
    const where = id + " row " + (i + 1) + " " + JSON.stringify(shown[i]);
    assert.equal(String(r.n), String(e[0]), where + ": line number");
    for (const role of e[1].split(" ").filter(Boolean)) {
      assert.ok(r.roles.split(" ").includes(role), where + ": role " + role + " missing");
    }
    assert.equal(r.text, e[2], where + ": text");
  });
}

// ---- The cases ----
//
// `text` is the file; `rows` what the reading state draws. Blank lines are
// rows too (an em-tall gap, class mdm-blank), so every file line is accounted
// for in order, and a drawn block is a row of its own between them.

// A picture small enough to write into a case, so that it really loads: a
// 100x70 white PNG (the one webview-look.test.js draws).
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABGCAYAAAAr1V1TAAAAKklEQVR4" +
  "nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAHwbLcQAAaHYVR0AAAAASUVORK5CYII=";

// What each link of the document says on hover: its destination (the
// `title` of its span) and the Markdown title beside it (`data-mdm-title`),
// one entry per Link node of the syntax tree, read off the span drawn over
// the first character of its text. Walking the tree rather than the spans
// keeps one entry per link whatever the marks inside it split its span
// into, and leaves out the address a GFM autolink finds inside a label.
async function linkTips(page) {
  return page.evaluate(() => {
    const view = window.__mdm.view;
    const out = [];
    window.CM.syntaxTree(view.state).iterate({
      enter(n) {
        if (n.name !== "Link") return;
        const marks = n.node.getChildren("LinkMark");
        const at = view.domAtPos(marks.length ? marks[0].to : n.from);
        // The outermost span of the link: an address inside the label is a
        // link of its own, drawn inside it, and says nothing about where the
        // link goes (K03).
        let el = (at.node.nodeType === 3 ? at.node.parentElement : at.node).closest(".mdm-link");
        while (el && el.parentElement.closest(".mdm-link")) el = el.parentElement.closest(".mdm-link");
        out.push(el ? [el.getAttribute("title"), el.getAttribute("data-mdm-title")] : null);
        return false;
      },
    });
    return out;
  });
}

// The colour the glyphs of each link are drawn in: the computed colour of
// the innermost element holding its text, one per link.
async function linkInk(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("#app .cm-line .mdm-link")) {
      if (el.parentElement.closest(".mdm-link")) continue; // an inner span of the same link
      let deepest = el;
      while (deepest.firstElementChild) deepest = deepest.firstElementChild;
      out.push(getComputedStyle(deepest).color);
    }
    return out;
  });
}


