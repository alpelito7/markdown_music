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

const { open, skip, rows, setSelection, postSettings, update } = require("./webview/helpers.js");

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
        // The destination is the tooltip's first line; the second, the click
        // that follows the link, is held in webview-look.test.js.
        out.push(el ? [(el.getAttribute("title") || "").split("\n")[0] || null, el.getAttribute("data-mdm-title")] : null);
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

// The text of every body cell of the drawn table, row by row.
async function tableCells(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#app .mdm-table tbody tr")).map((tr) =>
      Array.from(tr.children).map((td) => td.textContent)
    )
  );
}

const CASES = [
  {
    id: "H01",
    name: "ATX headings one to six, hashes hidden",
    text: "# Level one\n## Level two\n### Level three\n#### Level four\n##### Level five\n###### Level six\n",
    rows: [
      [1, "mdm-h mdm-h1", "Level one"],
      [2, "mdm-h mdm-h2", "Level two"],
      [3, "mdm-h mdm-h3", "Level three"],
      [4, "mdm-h mdm-h4", "Level four"],
      [5, "mdm-h mdm-h5", "Level five"],
      [6, "mdm-h mdm-h6", "Level six"],
      [7, "mdm-blank", ""],
    ],
  },
  {
    id: "H02",
    name: "seven hashes and a hash without a space are paragraphs (CM ex. 63-64)",
    text: "####### Seven\n\n#5 bolt\n",
    rows: [
      [1, "", "####### Seven"],
      [2, "mdm-blank", ""],
      [3, "", "#5 bolt"],
      [4, "mdm-blank", ""],
    ],
  },
  {
    id: "H09",
    name: "setext headings, underline hidden",
    text: "Setext one\n==========\n\nSetext two\n----------\n",
    rows: [
      [1, "mdm-h mdm-h1", "Setext one"],
      [3, "mdm-blank", ""],
      [4, "mdm-h mdm-h2", "Setext two"],
      [6, "mdm-blank", ""],
    ],
  },
  {
    id: "H03",
    name: "a tab after the hashes makes a heading too, and the text starts past it (CM 4.2, G042)",
    text: "#\tTab heading\n\n##\tSecond tab heading\n\n### \tSpace then tab\n\nAfter.\n",
    rows: [
      [1, "mdm-h mdm-h1", "Tab heading"],
      [2, "mdm-blank", ""],
      [3, "mdm-h mdm-h2", "Second tab heading"],
      [4, "mdm-blank", ""],
      [5, "mdm-h mdm-h3", "Space then tab"],
      [6, "mdm-blank", ""],
      [7, "", "After."],
      [8, "mdm-blank", ""],
    ],
  },
  {
    id: "E01",
    name: "the four forms of emphasis, marks hidden",
    text: "*star* _underscore_ **double star** __double underscore__ ***triple star*** ___triple underscore___\n",
    rows: [
      [1, "", "star underscore double star double underscore triple star triple underscore"],
      [2, "mdm-blank", ""],
    ],
  },
  {
    id: "E04",
    name: "unbalanced runs keep their literal star (CM ex. 442-443)",
    text: "**foo*\n\n*foo**\n",
    rows: [
      [1, "", "*foo"],
      [2, "mdm-blank", ""],
      [3, "", "foo*"],
      [4, "mdm-blank", ""],
    ],
  },
  {
    id: "S01",
    name: "strikethrough hides its tildes",
    text: "~~two tildes~~ here\n",
    rows: [
      [1, "", "two tildes here"],
      [2, "mdm-blank", ""],
    ],
  },
  {
    id: "S02",
    name: "Pandoc subscript and superscript are lowered and raised, marks hidden",
    text: "H~2~O and E = mc^2^ and 2^10^ = 1024\n",
    rows: [
      [1, "", "H2O and E = mc2 and 210 = 1024"],
      [2, "mdm-blank", ""],
    ],
    // The '2' of H~2~O stands in a <sub> and the '2' of mc^2^ in a <sup>
    // (the first of each): the measures are the page's, held by
    // html.test.js.
    dom: async (page) =>
      page.evaluate(() => {
        const line = document.querySelector("#app .cm-line");
        return [
          line.querySelector("sub") && line.querySelector("sub").textContent,
          line.querySelector("sup") && line.querySelector("sup").textContent,
        ];
      }),
    domExpected: ["2", "2"],
  },
  {
    id: "C01",
    name: "code spans, backticks hidden, doubled backticks holding a backtick, one space stripped (CM ex. 329)",
    text: "`foo` and `` foo ` bar ``\n",
    rows: [
      [1, "", "foo and foo ` bar"],
      [2, "mdm-blank", ""],
    ],
  },
  {
    id: "X01",
    name: "backslash escapes draw the character without its backslash (CM ex. 12)",
    text: "\\* not a list and \\# not a heading\n",
    rows: [
      [1, "", "* not a list and # not a heading"],
      [2, "mdm-blank", ""],
    ],
  },
  {
    id: "X04",
    name: "entities are decoded (CM ex. 25-26)",
    text: "&copy; &amp; &#35; and &bogus; stays\n",
    rows: [
      [1, "", "© & # and &bogus; stays"],
      [2, "mdm-blank", ""],
    ],
  },
  {
    id: "B01",
    name: "a hard break, two spaces or a backslash, is marked at the end of its row; a soft break is a row",
    text: "two spaces  \nbackslash\\\nsoft\nend\n",
    rows: [
      [1, "", "two spaces↵"],
      [2, "", "backslash↵"],
      [3, "", "soft"],
      [4, "", "end"],
      [5, "mdm-blank", ""],
    ],
    // The page writes <br> for the first two and runs the last two on: the
    // soft break drawn as a row is by design (tests/README.md).
  },
  {
    id: "K01",
    name: "inline links show their label alone",
    text: "[plain](https://example.com) and [double title](https://example.com \"Double\")\n",
    rows: [
      [1, "", "plain and double title"],
      [2, "mdm-blank", ""],
    ],
  },
  {
    id: "K05",
    name: "reference links show their label alone and the definition is not prose",
    text: "[full][ref] and [Ref][] and [Ref]\n\n[ref]: https://example.com/ref \"The reference title\"\n",
    rows: [
      [1, "", "full and Ref and Ref"],
      [2, "mdm-blank", ""],
      [3, "mdm-linkref-line", "[ref]: https://example.com/ref \"The reference title\""],
      [4, "mdm-blank", ""],
    ],
    // Each of the three resolves to the definition: the tooltip is its
    // destination and the title rides beside it (G004, G007).
    dom: linkTips,
    domExpected: [
      ["https://example.com/ref", "The reference title"],
      ["https://example.com/ref", "The reference title"],
      ["https://example.com/ref", "The reference title"],
    ],
  },
  {
    id: "K02",
    name: "the tail of a link folds whole, spaces, title and angle brackets included, and the tooltip is the destination",
    text:
      "[spaced](   https://example.com/a   ) and [angled](<https://example.com/a b>) and " +
      "[titled](https://example.com \"The title\") and [file](file:///home/me/score.pdf)\n",
    rows: [
      [1, "", "spaced and angled and titled and file"],
      [2, "mdm-blank", ""],
    ],
    // The spaces typed inside the parentheses fold with them (G024), the
    // angle brackets are not part of the address (G006), the Markdown title
    // rides beside the destination and a file URL is kept whole (G023).
    dom: linkTips,
    domExpected: [
      ["https://example.com/a", null],
      ["https://example.com/a b", null],
      ["https://example.com", "The title"],
      ["file:///home/me/score.pdf", null],
    ],
  },
  {
    id: "K03",
    name: "a link whose label is itself an address goes where its parentheses say (CM 6.7, G005)",
    text: "[https://a.example](https://b.example)\n",
    rows: [
      [1, "", "https://a.example"],
      [2, "mdm-blank", ""],
    ],
    dom: linkTips,
    domExpected: [["https://b.example", null]],
  },
  {
    id: "K11",
    name: "brackets with no definition are text, not links (CM 6.3)",
    text: "He wrote [sic] and press [Ctrl] then [x].\n",
    rows: [
      [1, "", "He wrote [sic] and press [Ctrl] then [x]."],
      [2, "mdm-blank", ""],
    ],
    dom: linkTips,
    domExpected: [],
  },
  {
    id: "K12",
    name: "balanced brackets inside a link's text stay in the link (CM 6.3, G003)",
    text: "Three [Sonata [K. 331]](https://en.wikipedia.org/wiki/X_(Y)) end.\n",
    rows: [
      [1, "", "Three Sonata [K. 331] end."],
      [2, "mdm-blank", ""],
    ],
    dom: linkTips,
    domExpected: [["https://en.wikipedia.org/wiki/X_(Y)", null]],
  },
  {
    id: "K13",
    name: "a reference with no definition is text, brackets and all, beside one that has it",
    text: "[nope][missing] and [real] and ![lone] here.\n\n[real]: https://example.com/real\n",
    rows: [
      [1, "", "[nope][missing] and real and ![lone] here."],
      [2, "mdm-blank", ""],
      [3, "mdm-linkref-line", "[real]: https://example.com/real"],
      [4, "mdm-blank", ""],
    ],
    dom: linkTips,
    domExpected: [["https://example.com/real", null]],
  },
  {
    id: "I01",
    name: "an image alone in its paragraph is a figure, the alt text its caption, in place of the paragraph (G018)",
    text: "Above.\n\n![A figure.](" + PNG + ")\n\nBelow.\n",
    rows: [
      [1, "", "Above."],
      [2, "mdm-blank", ""],
      [3, "mdm-figure", "⟦img:A figure.⟧A figure."],
      [4, "mdm-blank", ""],
      [5, "", "Below."],
      [6, "mdm-blank", ""],
    ],
  },
  {
    id: "I01b",
    name: "a caption is inline content, read as a cell is read, and the alt attribute its words alone (G018, G009)",
    text: "![A *fine* photo &copy; 1741](" + PNG + ")\n",
    rows: [
      [1, "mdm-figure", "⟦img:A fine photo © 1741⟧A fine photo © 1741"],
      [2, "mdm-blank", ""],
    ],
    // Pandoc, same reader:
    //   <figure><img src="…" alt="A fine photo © 1741" />
    //   <figcaption aria-hidden="true">A <em>fine</em> photo ©
    //   1741</figcaption></figure>
    // The caption carries the marks read, the alt attribute the words
    // without them; `rows()` names the picture by its alt.
    dom: async (page) =>
      page.evaluate(() => {
        const fig = document.querySelector("#app .mdm-figure");
        return {
          caption: fig.querySelector(".mdm-figcaption").innerHTML,
          alt: fig.querySelector("img").alt,
        };
      }),
    domExpected: { caption: "A <em>fine</em> photo © 1741", alt: "A fine photo © 1741" },
  },
  {
    id: "I02",
    name: "an image beside text stays in its line",
    text: "See ![inline](" + PNG + ") here.\n",
    rows: [
      [1, "", "See ⟦img:inline⟧ here."],
      [2, "mdm-blank", ""],
    ],
  },
  {
    id: "I06",
    name: "an image written by reference is drawn from its definition, as a figure when alone",
    text: "![By reference.][pic]\n\nAnd ![inline][pic] too.\n\n[pic]: <" + PNG + ">\n",
    rows: [
      [1, "mdm-figure", "⟦img:By reference.⟧By reference."],
      [2, "mdm-blank", ""],
      [3, "", "And ⟦img:inline⟧ too."],
      [4, "mdm-blank", ""],
      [5, "mdm-linkref-line", "[pic]: <" + PNG + ">"],
      [6, "mdm-blank", ""],
    ],
    // The pictures are the definition's, with the angle brackets off it.
    dom: async (page) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("#app img.mdm-image")).map((i) => i.getAttribute("src").slice(0, 22))
      ),
    domExpected: ["data:image/png;base64,", "data:image/png;base64,"],
  },
  {
    id: "A01",
    name: "angle-bracket autolinks show the address without the brackets",
    text: "<https://commonmark.org> and <someone@example.com>\n",
    rows: [
      [1, "", "https://commonmark.org and someone@example.com"],
      [2, "mdm-blank", ""],
    ],
    // Down to the glyphs: the highlighter wraps the address in a span of its
    // own, and the link's colour on the outer span stopped there (G016).
    dom: linkInk,
    domExpected: ["rgb(9, 105, 218)", "rgb(9, 105, 218)"],
  },
  {
    id: "A03",
    name: "a bare URL is a link, drawn in the link colour down to its glyphs (GFM autolink, G016)",
    text: "See https://example.com/path?q=1 here.\n",
    rows: [
      [1, "", "See https://example.com/path?q=1 here."],
      [2, "mdm-blank", ""],
    ],
    dom: linkInk,
    domExpected: ["rgb(9, 105, 218)"],
  },
  {
    id: "A04",
    name: "a bare address is a link when it has a scheme or is mail; a www. address is text, as on the page (G017)",
    // The page links what Pandoc's autolink_bare_uris links, an absolute
    // address and a mail address, and the export's reader asks for that;
    // the `www.` link GFM makes beyond it has no switch on the page, so the
    // editor draws it as text too. An address in angle brackets is a link
    // either way.
    text: "Visit www.example.com. Or https://example.com/path. Mail someone@example.org, or <someone@example.org>.\n",
    rows: [
      [1, "", "Visit www.example.com. Or https://example.com/path. Mail someone@example.org, or someone@example.org."],
      [2, "mdm-blank", ""],
    ],
    // The spans drawn in the link colour, outermost only, since a bare
    // address is no Link node for linkTips to walk.
    dom: (page) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("#app .cm-line .mdm-link"))
          .filter((e) => !e.parentElement.closest(".mdm-link"))
          .map((e) => e.textContent)
      ),
    domExpected: ["https://example.com/path", "someone@example.org", "someone@example.org"],
  },
  {
    id: "F03",
    name: "a `---` over a blank line is a rule and not the opening of a header, as Pandoc reads it (G040)",
    text: "---\n\nFirst para.\n\n---\n\nAfter.\n",
    withFrontMatter: true,
    rows: [
      [1, "mdm-hr", "⟦hr⟧"],
      [2, "mdm-blank", ""],
      [3, "", "First para."],
      [4, "mdm-blank", ""],
      [5, "mdm-hr", "⟦hr⟧"],
      [6, "mdm-blank", ""],
      [7, "", "After."],
      [8, "mdm-blank", ""],
    ],
  },
  {
    id: "RT01",
    name: "raw TeX is drawn as the source it is, inline and as a block, and the tooltip says the page leaves it out (G013)",
    text: "A \\textbf{bold} word and \\alpha here, C:\\Users\\bach too.\n\n\\begin{center}\nx\n\\end{center}\n",
    rows: [
      [1, "", "A \\textbf{bold} word and \\alpha here, C:\\Users\\bach too."],
      [2, "mdm-blank", ""],
      [3, "mdm-rawtex-line", "\\begin{center}"],
      [4, "mdm-rawtex-line", "x"],
      [5, "mdm-rawtex-line", "\\end{center}"],
      [6, "mdm-blank", ""],
    ],
    dom: (page) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("#app .mdm-rawtex"))
          .filter((e) => !e.parentElement.closest(".mdm-rawtex"))
          .map((e) => e.textContent + "|" + e.title.slice(0, 7))
      ),
    domExpected: [
      "\\textbf{bold}|Raw TeX",
      "\\alpha|Raw TeX",
      "\\Users|Raw TeX",
      "\\bach|Raw TeX",
      "\\begin{center}|Raw TeX",
      "x|Raw TeX",
      "\\end{center}|Raw TeX",
    ],
  },
  {
    id: "AT01",
    name: "attributes are hidden and take effect: a heading's, an image's width, a span's small caps, mark and underline, a code span's format (G014)",
    text:
      "## Attributed {#sec-attr .unnumbered}\n\n![Sized brass](" +
      PNG +
      "){#fig-brass width=30%}\n\nThis is [small caps]{.smallcaps} and [highlighted]{.mark} and [underlined]{.underline} and `raw`{=html}.\n",
    rows: [
      [1, "mdm-h mdm-h2", "Attributed"],
      [2, "mdm-blank", ""],
      [3, "mdm-figure", "⟦img:Sized brass⟧Sized brass"],
      [4, "mdm-blank", ""],
      [5, "", "This is small caps and highlighted and underlined and raw."],
      [6, "mdm-blank", ""],
    ],
    dom: (page) =>
      page.evaluate(() => ({
        smallcaps: document.querySelectorAll("#app .mdm-smallcaps").length,
        mark: document.querySelectorAll("#app .mdm-highlight").length,
        // Drawn and not only classed: the page writes `<u>`, which the
        // browser underlines, so an editor that did not draw the line was a
        // difference between the two surfaces (Pandoc 3.8.3).
        underline: getComputedStyle(document.querySelector("#app .mdm-underline")).textDecorationLine,
        width: document.querySelector("#app .mdm-figure img").style.width,
        shown: document.querySelectorAll("#app .mdm-attr").length,
      })),
    domExpected: { smallcaps: 1, mark: 1, underline: "underline", width: "30%", shown: 0 },
  },
  {
    id: "CT01",
    // Named by what it cites and not by its brackets: the bare `@knuth1984`
    // was called a "Reference" and `[@fig-x]` a "Citation" (isCrossref in
    // main.js, the kinds Quarto numbers; 2026-09-29).
    name: "a citation and a cross-reference are drawn as written, in the link colour, with what they are in the tooltip (PX04)",
    text: "As shown by [@knuth1984, p. 33], by @knuth1984 and in @fig-brass, mail me@example.org.\n",
    rows: [
      [1, "", "As shown by [@knuth1984, p. 33], by @knuth1984 and in @fig-brass, mail me@example.org."],
      [2, "mdm-blank", ""],
    ],
    dom: (page) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("#app .mdm-cite"))
          .filter((e) => !e.parentElement.closest(".mdm-cite"))
          .map((e) => e.textContent + "|" + e.title)
      ),
    domExpected: [
      "[@knuth1984, p. 33]|Citation [@knuth1984, p. 33]",
      "@knuth1984|Citation @knuth1984",
      "@fig-brass|Cross-reference @fig-brass",
    ],
  },
  {
    id: "FN01",
    name: "a footnote reference is raised, an inline note stands in a card, and the note itself is a faint block with its label raised and its indentation hidden (PX01)",
    text:
      "A claim.[^1] Another with an inline note.^[This note is *inline*.]\n\n" +
      "[^1]: The footnote text, with *emphasis* and $x$.\n\n    A second paragraph of the same footnote, indented.\n\nAfter.\n",
    rows: [
      [1, "", "A claim.1 Another with an inline note.This note is inline."],
      [2, "mdm-blank", ""],
      [3, "mdm-note-line", "1 The footnote text, with emphasis and ⟦math:x⟧."],
      [4, "mdm-blank", ""],
      [5, "mdm-note-line", "A second paragraph of the same footnote, indented."],
      [6, "mdm-blank", ""],
      [7, "", "After."],
      [8, "mdm-blank", ""],
    ],
    dom: (page) =>
      page.evaluate(() => ({
        refs: Array.from(document.querySelectorAll("#app .mdm-note-ref"))
          .filter((e) => !e.parentElement.closest(".mdm-note-ref"))
          .map((e) => e.textContent + "|" + (e.classList.contains("mdm-sup") ? "sup" : "")),
        inline: document.querySelectorAll("#app .mdm-note-inline").length > 0,
        card: getComputedStyle(document.querySelector("#app .mdm-note-inline")).borderStyle,
      })),
    domExpected: { refs: ["1|sup", "1|sup"], inline: true, card: "solid" },
  },
  {
    id: "SP01",
    name: "quotes, dashes and an ellipsis are drawn as the page prints them, the source kept, and never inside code or maths (G015)",
    text:
      "\"Double quotes\", 'single quotes', pages 3--5, a pause --- here, and so on...\n\n" +
      "It's the *\"quoted\"* word, `\"code\"` and $a--b$ untouched.\n",
    rows: [
      [1, "", "\u201cDouble quotes\u201d, \u2018single quotes\u2019, pages 3\u20135, a pause \u2014 here, and so on\u2026"],
      [2, "mdm-blank", ""],
      [3, "", "It\u2019s the \u201cquoted\u201d word, \"code\" and \u27e6math:a--b\u27e7 untouched."],
      [4, "mdm-blank", ""],
    ],
    // The caret on the line shows the source as typed.
    dom: async (page) => {
      await page.evaluate(() => {
        window.__mdm.view.focus();
        window.__mdm.view.dispatch({ selection: { anchor: 3 } });
      });
      await new Promise((r) => setTimeout(r, 150));
      return page.evaluate(() => document.querySelector("#app .cm-line").textContent.slice(0, 15));
    },
    domExpected: '"Double quotes"',
  },
  {
    id: "SP02",
    name: "a quote that cannot open closes, a single one that never closes is an apostrophe, a pair nests in a pair, runs past a line end and a code span, stops at an emphasis and is stepped over whole, as Pandoc reads them (G015)",
    text:
      "the '90s weren't great\n\n'tis the season\n\nHe said \"hello\n\n5\" wide and F\", he said\n\nrock 'n' roll\n\n" +
      "\"nested 'single' inside\"\n\n'nested \"double\" inside'\n\nword' end and \" quoted\"\n\nit's 'quoted's' thing\n\n" +
      "\"unclosed *em\"* here\n\nLine one 'open\ncontinues' here\n\n''\n\n" +
      "'see `code`' here\n\n\"a 'b\" c' d\"\n\n'a *b' c* d\n\n'a \"b' c\"\n",
    rows: [
      [1, "", "the \u201990s weren\u2019t great"],
      [2, "mdm-blank", ""],
      [3, "", "\u2019tis the season"],
      [4, "mdm-blank", ""],
      [5, "", "He said \u201chello"],
      [6, "mdm-blank", ""],
      [7, "", "5\u201d wide and F\u201d, he said"],
      [8, "mdm-blank", ""],
      [9, "", "rock \u2018n\u2019 roll"],
      [10, "mdm-blank", ""],
      [11, "", "\u201cnested \u2018single\u2019 inside\u201d"],
      [12, "mdm-blank", ""],
      [13, "", "\u2018nested \u201cdouble\u201d inside\u2019"],
      [14, "mdm-blank", ""],
      [15, "", "word\u2019 end and \u201d quoted\u201d"],
      [16, "mdm-blank", ""],
      [17, "", "it\u2019s \u2018quoted\u2019s\u2019 thing"],
      [18, "mdm-blank", ""],
      [19, "", "\u201cunclosed em\u201d here"],
      [20, "mdm-blank", ""],
      [21, "", "Line one \u2018open"],
      [22, "", "continues\u2019 here"],
      [23, "mdm-blank", ""],
      [24, "", "\u2019\u2019"],
      [25, "mdm-blank", ""],
      [26, "", "\u2018see code\u2019 here"],
      [27, "mdm-blank", ""],
      [28, "", "\u201ca \u2018b\u201d c\u2019 d\u201d"],
      [29, "mdm-blank", ""],
      [30, "", "\u2019a b\u2019 c d"],
      [31, "mdm-blank", ""],
      [32, "", "\u2019a \u201cb\u2019 c\u201d"],
      [33, "mdm-blank", ""],
    ],
  },
  {
    id: "SP03",
    name: "the punctuation is left alone in an escape, a tag, a comment, an entity and a link's tail, and drawn in a heading, an item, a task, a quote and a note (G015)",
    text:
      "escaped \\\"quote\\\" and \\'single\\' and \\-\\-\\-\n\n" +
      "<span class=\"x\">\"in tag\"</span> and <!-- \"c\" --> and &quot;ent&quot;\n\n" +
      "[the '90s \"text\"](http://a--b.com \"it' s\") and <http://x--y.z>\n\n" +
      "# \"Heading\" --- 'ok'\n\n- \"item\" -- 'x'\n- [ ] \"task\" ... done\n\n> \"quote\" --- here\n\n[^1]: \"note\" -- 'x'\n",
    rows: [
      [1, "", "escaped \"quote\" and 'single' and ---"],
      [2, "mdm-blank", ""],
      [3, "", "<span class=\"x\">\u201cin tag\u201d</span> and <!-- \"c\" --> and \"ent\""],
      [4, "mdm-blank", ""],
      // The quote in the title is no closer for the one in the text: a title is not prose.
      [5, "", "the \u201990s \u201ctext\u201d and http://x--y.z"],
      [6, "mdm-blank", ""],
      [7, "mdm-h mdm-h1 mdm-h-first mdm-h-last", "\u201cHeading\u201d \u2014 \u2018ok\u2019"],
      [8, "mdm-blank", ""],
      [9, "mdm-li", "\u2022 \u201citem\u201d \u2013 \u2018x\u2019"],
      [10, "mdm-li", "\u2610 \u201ctask\u201d \u2026 done"],
      [11, "mdm-blank", ""],
      [12, "mdm-quote-1", "\u201cquote\u201d \u2014 here"],
      [13, "mdm-blank", ""],
      [14, "mdm-note-line", "1 \u201cnote\u201d \u2013 \u2018x\u2019"],
      [15, "mdm-blank", ""],
    ],
  },
  {
    id: "SP04",
    name: "a table's cell, a figure's caption, the prose after an equation and an outline row print the same punctuation (G015)",
    seed: { settings: { outline: "shown" } },
    text:
      "# The \"Well-Tempered\" Clavier -- Book I\n\n| \"cell\" | a--b |\n|---|---|\n| 'x' | ... |\n\n" +
      "![A \"quoted\" caption -- here](" + PNG + ")\n\n$$\nE = mc^2\n$$ the \"label\" -- here\n",
    rows: [
      [1, "mdm-h1", "The \u201cWell-Tempered\u201d Clavier \u2013 Book I"],
      [2, "mdm-blank", ""],
      [3, "mdm-table", "\u201ccell\u201da\u2013b\u2018x\u2019\u2026"],
      [6, "mdm-blank", ""],
      [7, "mdm-figure", "\u27e6img:A \u201cquoted\u201d caption \u2013 here\u27e7A \u201cquoted\u201d caption \u2013 here"],
      [8, "mdm-blank", ""],
      [9, "mdm-math mdm-math--block", "\u27e6math:E = mc^2\u27e7the \u201clabel\u201d \u2013 here"],
      [12, "mdm-blank", ""],
    ],
    dom: async (page) => {
      await page.waitForFunction(() => document.querySelectorAll("#app .mdm-outline__row").length > 0, { timeout: 5000 });
      return page.evaluate(() =>
        Array.from(document.querySelectorAll("#app .mdm-outline__row")).map((r) => r.textContent)
      );
    },
    domExpected: ["The \u201cWell-Tempered\u201d Clavier \u2013 Book I"],
  },
  {
    id: "HB01",
    name: "an element, a comment and a processing instruction are raw HTML, drawn as the source they are (G048)",
    text:
      "<div class=\"x\">\n<p>raw \"kept\"</p>\n</div>\n\n<!-- a comment\nover \"two\" lines -->\n\n" +
      "<?php echo \"pi\"; ?>\n\nProse \"after\".\n",
    rows: [
      [1, "mdm-html-line", "<div class=\"x\">"],
      [2, "mdm-html-line", "<p>raw \"kept\"</p>"],
      [3, "mdm-html-line", "</div>"],
      [4, "mdm-blank", ""],
      [5, "mdm-html-line", "<!-- a comment"],
      [6, "mdm-html-line", "over \"two\" lines -->"],
      [7, "mdm-blank", ""],
      [8, "mdm-html-line", "<?php echo \"pi\"; ?>"],
      [9, "mdm-blank", ""],
      [10, "", "Prose \u201cafter\u201d."],
      [11, "mdm-blank", ""],
    ],
  },
  {
    id: "NB01",
    name: "a line of one no-break space is a paragraph and keeps its row, where a line of spaces is the gap (G046)",
    text: "Above.\n\n\u00a0\n\nBelow.\n  \nEnd.\n",
    rows: [
      [1, "", "Above."],
      [2, "mdm-blank", ""],
      [3, "", "\u00a0"],
      [4, "mdm-blank", ""],
      [5, "", "Below."],
      [6, "mdm-blank", "  "],
      [7, "", "End."],
      [8, "mdm-blank", ""],
    ],
    dom: (page) => page.evaluate(() => document.querySelectorAll("#app .cm-line.mdm-blank").length),
    domExpected: 4,
  },
  {
    id: "WS01",
    name: "the whitespace a reader drops is not drawn: before a paragraph's lines and a heading, the tab after a >, the columns of indented code and the indent a fence shares with its body (G041)",
    text:
      "Plain paragraph.\n   and its second line.\n\n   Indented by three.\n\n   # Three spaces\n\n" +
      "  Setext\n  heading\n  =======\n\n> Space quote\n\n>\tTab quote\n\n" +
      "  ```\n  aaa\n    aaa\n  aaa\n  ```\n\n    indented code\n\tindented by a tab\n\n- item\n     continued far in\n",
    rows: [
      [1, "", "Plain paragraph."],
      [2, "", "and its second line."],
      [3, "mdm-blank", ""],
      [4, "", "Indented by three."],
      [5, "mdm-blank", ""],
      [6, "mdm-h1", "Three spaces"],
      [7, "mdm-blank", ""],
      [8, "mdm-h1 mdm-h-first", "Setext"],
      // The rule of the heading under its last line of text, the underline
      // set in two spaces notwithstanding.
      [9, "mdm-h1 mdm-h-last", "heading"],
      [11, "mdm-blank", ""],
      [12, "mdm-quote-1", "Space quote"],
      [13, "mdm-blank", ""],
      [14, "mdm-quote-1", "Tab quote"],
      [15, "mdm-blank", ""],
      [17, "mdm-code-line mdm-code-first", "aaa"],
      [18, "mdm-code-line", "  aaa"],
      [19, "mdm-code-line mdm-code-last", "aaa"],
      [21, "mdm-blank", ""],
      [22, "mdm-code-line mdm-code-first", "indented code"],
      [23, "mdm-code-line mdm-code-last", "indented by a tab"],
      [24, "mdm-blank", ""],
      [25, "mdm-li", "\u2022 item"],
      [26, "mdm-li", "continued far in"],
      [27, "mdm-blank", ""],
    ],
    // Under the caret the whitespace is back: a line of prose by itself, the
    // lines of indented code all at once, so the code never stands at two
    // insets.
    dom: async (page) => {
      const line = (n) =>
        page.evaluate((k) => {
          const { view } = window.__mdm;
          const at = view.state.doc.line(k);
          const dom = view.domAtPos(at.from).node;
          return (dom.nodeType === 1 ? dom : dom.parentElement).closest(".cm-line").textContent;
        }, n);
      const caret = (n) =>
        page.evaluate((k) => {
          const { view } = window.__mdm;
          view.focus();
          view.dispatch({ selection: { anchor: view.state.doc.line(k).to } });
        }, n);
      await caret(4);
      await new Promise((r) => setTimeout(r, 150));
      const prose = [await line(2), await line(4)];
      await caret(22);
      await new Promise((r) => setTimeout(r, 150));
      return { prose, code: [await line(22), await line(23)], proseAfter: await line(4) };
    },
    domExpected: {
      prose: ["and its second line.", "   Indented by three."],
      code: ["    indented code", "\tindented by a tab"],
      proseAfter: "Indented by three.",
    },
  },
  {
    id: "SC01",
    name: "a bidi override, a soft hyphen and a zero-width space are drawn as the page draws them, and named under the caret (G058)",
    text: "A\u202eb c\n\nsoft\u00adhyphen and zero\u200bwidth\n",
    rows: [
      [1, "", "A\u202eb c"],
      [2, "mdm-blank", ""],
      [3, "", "soft\u00adhyphen and zero\u200bwidth"],
      [4, "mdm-blank", ""],
    ],
    dom: async (page) => {
      const marks = () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll("#app .mdm-special")).map((el) => el.textContent + " " + el.title)
        );
      const reading = await marks();
      await page.evaluate(() => {
        const { view } = window.__mdm;
        view.focus();
        view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
      });
      await new Promise((r) => setTimeout(r, 150));
      // In the brass the marks of a line are drawn in.
      const brass = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--mdm-line-ink)";
        document.getElementById("app").appendChild(probe);
        const same =
          getComputedStyle(probe).color === getComputedStyle(document.querySelector("#app .mdm-special")).color;
        probe.remove();
        return same;
      });
      return { reading, caret: await marks(), brass };
    },
    domExpected: {
      brass: true,
      reading: [],
      caret: ["\u2022 U+00AD soft hyphen", "\u2022 U+200B zero-width space"],
    },
  },
  {
    id: "T01",
    name: "the three thematic breaks are rules, numbered in the margin",
    text: "***\n\n---\n\n___\n",
    rows: [
      [1, "mdm-hr", "⟦hr⟧"],
      [2, "mdm-blank", ""],
      [3, "mdm-hr", "⟦hr⟧"],
      [4, "mdm-blank", ""],
      [5, "mdm-hr", "⟦hr⟧"],
      [6, "mdm-blank", ""],
    ],
  },
  {
    id: "Q01",
    name: "a quote of two paragraphs keeps its bar and hides the marks",
    text: "> First paragraph of the quote.\n>\n> Second paragraph of the quote.\n",
    rows: [
      [1, "mdm-quote", "First paragraph of the quote."],
      [2, "mdm-quote", ""],
      [3, "mdm-quote", "Second paragraph of the quote."],
      [4, "mdm-blank", ""],
    ],
  },
  {
    id: "Q03",
    name: "nested quotes wear one bar per level, in and out again",
    text: "> Level one\n>\n> > Level two\n> >\n> > > Level three\n> >\n> > Back to two\n>\n> Back to one\n",
    rows: [
      [1, "mdm-quote mdm-quote-1", "Level one"],
      [2, "mdm-quote mdm-quote-1 mdm-blank", ""],
      [3, "mdm-quote mdm-quote-2", "Level two"],
      [4, "mdm-quote mdm-quote-2 mdm-blank", ""],
      [5, "mdm-quote mdm-quote-3", "Level three"],
      [6, "mdm-quote mdm-quote-2 mdm-blank", ""],
      [7, "mdm-quote mdm-quote-2", "Back to two"],
      [8, "mdm-quote mdm-quote-1 mdm-blank", ""],
      [9, "mdm-quote mdm-quote-1", "Back to one"],
      [10, "mdm-blank", ""],
    ],
  },
  {
    id: "Q05",
    name: "a quote holds every block inside its bar",
    text:
      "> ## Heading in a quote\n>\n> - item one\n> - item two\n>\n> ```python\n> print(\"code in a quote\")\n> ```\n>\n" +
      "> | a | b |\n> |---|---|\n> | 1 | 2 |\n>\n> $$\n> \\int_0^1 x\\,dx = \\tfrac12\n> $$\n>\n> - [ ] a task in a quote\n>\n> ---\n",
    rows: [
      [1, "mdm-quote mdm-quote-1 mdm-h mdm-h2", "Heading in a quote"],
      [2, "mdm-quote mdm-quote-1 mdm-blank", ""],
      [3, "mdm-quote mdm-quote-1 mdm-li", "• item one"],
      [4, "mdm-quote mdm-quote-1 mdm-li", "• item two"],
      [5, "mdm-quote mdm-quote-1 mdm-blank", ""],
      [7, "mdm-quote mdm-quote-1 mdm-code-line mdm-code-first mdm-code-last", "print(\"code in a quote\")"],
      [9, "mdm-quote mdm-quote-1 mdm-blank", ""],
      [10, "mdm-quote mdm-quote-1 mdm-table", "ab12"],
      [13, "mdm-quote mdm-quote-1 mdm-blank", ""],
      [14, "mdm-quote mdm-quote-1 mdm-math", "⟦math:\\int_0^1 x\\,dx = \\tfrac12⟧"],
      [17, "mdm-quote mdm-quote-1 mdm-blank", ""],
      [18, "mdm-quote mdm-quote-1 mdm-li", "☐ a task in a quote"],
      [19, "mdm-quote mdm-quote-1 mdm-blank", ""],
      [20, "mdm-quote mdm-quote-1 mdm-hr", "⟦hr⟧"],
      [21, "mdm-blank", ""],
    ],
  },
  {
    id: "Q08",
    name: "a quote inside a callout and a callout inside a quote wear both bars",
    text: "::: {.callout-note}\n> A quote inside a note.\n:::\n\n> ::: {.callout-warning}\n> A warning inside a quote.\n> :::\n",
    rows: [
      [1, "mdm-co-line mdm-co--note mdm-co-fence", "::: {.callout-note}"],
      [2, "mdm-co-line mdm-co--note mdm-quote mdm-quote-1", "A quote inside a note."],
      [3, "mdm-co-line mdm-co--note mdm-co-fence", ":::"],
      [4, "mdm-blank", ""],
      [5, "mdm-quote mdm-quote-1 mdm-co-line mdm-co--warning mdm-co-fence", "::: {.callout-warning}"],
      [6, "mdm-quote mdm-quote-1 mdm-co-line mdm-co--warning", "A warning inside a quote."],
      [7, "mdm-quote mdm-quote-1 mdm-co-line mdm-co--warning mdm-co-fence", ":::"],
      [8, "mdm-blank", ""],
    ],
  },
  {
    id: "D03",
    name: "a callout inside a callout takes its own kind and both bars",
    text: ":::: {.callout-warning}\nOuter warning.\n\n::: {.callout-note}\nInner note.\n:::\n\nBack in the warning.\n::::\n",
    rows: [
      [1, "mdm-co-line mdm-co--warning mdm-co-fence", ":::: {.callout-warning}"],
      [2, "mdm-co-line mdm-co--warning", "Outer warning."],
      [3, "mdm-co-line mdm-co--warning mdm-blank", ""],
      [4, "mdm-co-line mdm-co--note mdm-co-fence", "::: {.callout-note}"],
      [5, "mdm-co-line mdm-co--note", "Inner note."],
      [6, "mdm-co-line mdm-co--note mdm-co-fence", ":::"],
      [7, "mdm-co-line mdm-co--warning mdm-blank", ""],
      [8, "mdm-co-line mdm-co--warning", "Back in the warning."],
      [9, "mdm-co-line mdm-co--warning mdm-co-fence", "::::"],
      [10, "mdm-blank", ""],
    ],
  },
  {
    id: "D04",
    name: "a callout holds a list, a card, an equation and a table inside its bar",
    text: "::: {.callout-note}\n- one\n- two\n\n```python\nprint(\"inside a callout\")\n```\n\n$$\n\\sum_{i=1}^n i\n$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n:::\n",
    rows: [
      [1, "mdm-co-line mdm-co--note mdm-co-fence", "::: {.callout-note}"],
      [2, "mdm-co-line mdm-co--note mdm-li", "• one"],
      [3, "mdm-co-line mdm-co--note mdm-li", "• two"],
      [4, "mdm-co-line mdm-co--note mdm-blank", ""],
      [6, "mdm-co-line mdm-co--note mdm-code-line mdm-code-first mdm-code-last", "print(\"inside a callout\")"],
      [8, "mdm-co-line mdm-co--note mdm-blank", ""],
      [9, "mdm-co-line mdm-co--note mdm-math", "⟦math:\\sum_{i=1}^n i⟧"],
      [12, "mdm-co-line mdm-co--note mdm-blank", ""],
      [13, "mdm-co-line mdm-co--note mdm-table", "ab12"],
      [16, "mdm-co-line mdm-co--note mdm-co-fence", ":::"],
      [17, "mdm-blank", ""],
    ],
  },
  {
    id: "M10",
    name: "a display equation in a list item and in a quote is drawn, the quote's inside its bar",
    text: "- An item with a block:\n\n  $$\n  a^2 + b^2 = c^2\n  $$\n\n> $$\n> \\oint_C \\mathbf{F} \\cdot d\\mathbf{r} = 0\n> $$\n",
    rows: [
      [1, "mdm-li", "• An item with a block:"],
      [2, "mdm-li mdm-blank", ""],
      [3, "mdm-math", "⟦math:a^2 + b^2 = c^2⟧"],
      [6, "mdm-blank", ""],
      [7, "mdm-quote mdm-quote-1 mdm-math", "⟦math:\\oint_C \\mathbf{F} \\cdot d\\mathbf{r} = 0⟧"],
      [10, "mdm-blank", ""],
    ],
  },
  {
    id: "L01",
    name: "bullet items draw a bullet for any marker",
    text: "- dash\n* star\n+ plus\n",
    rows: [
      [1, "mdm-li", "• dash"],
      [2, "mdm-li", "• star"],
      [3, "mdm-li", "• plus"],
      [4, "mdm-blank", ""],
    ],
  },
  {
    id: "L02",
    name: "ordered items show the number the list gives them, not the one typed",
    text: "1. first\n1. second\n1. third\n",
    rows: [
      [1, "mdm-li", "1. first"],
      [2, "mdm-li", "2. second"],
      [3, "mdm-li", "3. third"],
      [4, "mdm-blank", ""],
    ],
  },
  {
    id: "L14",
    name: "an item whose first line opens a rule or an equation keeps its bullet",
    text: "- ***\n- $$\n  x^2\n  $$\n- the last item\n",
    rows: [
      [1, "mdm-hr mdm-li", "• ⟦hr⟧"],
      [2, "mdm-math mdm-li", "• ⟦math:x^2⟧"],
      [5, "mdm-li", "• the last item"],
      [6, "mdm-blank", ""],
    ],
  },
  {
    id: "L14b",
    name: "an item whose first line opens a fence keeps its bullet, beside the card",
    text: "- ```js\n  let first = 1;\n  ```\n- the last item\n",
    rows: [
      [2, "mdm-li mdm-code-line mdm-code-first mdm-code-last", "• let first = 1;"],
      [4, "mdm-li", "• the last item"],
      [5, "mdm-blank", ""],
    ],
  },
  {
    id: "L06",
    name: "five levels of mixed lists, each set in one more step",
    text:
      "- level one bullet\n  1. level two number\n     - level three bullet\n       1. level four number\n" +
      "          - level five bullet with a long line of text that must wrap in a narrow pane and hang under its own marker rather than under the bullet of level one\n",
    rows: [
      [1, "mdm-li", "• level one bullet"],
      [2, "mdm-li", "1. level two number"],
      [3, "mdm-li", "• level three bullet"],
      [4, "mdm-li", "1. level four number"],
      [5, "mdm-li", "• level five bullet with a long line of text that must wrap in a narrow pane and hang under its own marker rather than under the bullet of level one"],
      [6, "mdm-blank", ""],
    ],
  },
  {
    id: "L07",
    name: "an item holding paragraphs, a card, a quote and a table, all set in with it",
    text:
      "1. The first paragraph of the item.\n\n   The second paragraph of the same item.\n\n   ```js\n   console.log(\"code inside a list item\");\n   ```\n\n" +
      "   > A quote inside the item.\n\n   | x | y |\n   |---|---|\n   | 1 | 2 |\n\n2. The next item.\n",
    rows: [
      [1, "mdm-li", "1. The first paragraph of the item."],
      [2, "mdm-li mdm-blank", ""],
      [3, "mdm-li", "The second paragraph of the same item."],
      [4, "mdm-li mdm-blank", ""],
      [6, "mdm-li mdm-code-line mdm-code-first mdm-code-last", "console.log(\"code inside a list item\");"],
      [8, "mdm-li mdm-blank", ""],
      [9, "mdm-li mdm-quote mdm-quote-1", "A quote inside the item."],
      [10, "mdm-li mdm-blank", ""],
      [11, "mdm-li mdm-table", "xy12"],
      [14, "mdm-blank", ""],
      [15, "mdm-li", "2. The next item."],
      [16, "mdm-blank", ""],
    ],
  },
  {
    id: "L15",
    name: "a blank line inside an item is the gap a blank line is",
    text: "- First paragraph of the item.\n\n  Second paragraph of the same item.\n- Next item\n",
    rows: [
      [1, "mdm-li", "• First paragraph of the item."],
      [2, "mdm-li mdm-blank", ""],
      [3, "mdm-li", "Second paragraph of the same item."],
      [4, "mdm-li", "• Next item"],
      [5, "mdm-blank", ""],
    ],
  },
  {
    id: "MU01",
    name: "a score in a list item and in a quote is engraved from its whole source, inside the frame",
    text: "- A tune in a list:\n\n  ```abc\n  X:1\n  K:C\n  CDEF GABc|\n  ```\n\n> ```abc\n> X:2\n> K:G\n> GABc dedB|\n> ```\n",
    scores: 2,
    rows: [
      [1, "mdm-li", "• A tune in a list:"],
      [2, "mdm-li mdm-blank", ""],
      [3, "mdm-li mdm-score score", "⟦score⟧"],
      [8, "mdm-blank", ""],
      [9, "mdm-quote mdm-quote-1 mdm-score score", "⟦score⟧"],
      [14, "mdm-blank", ""],
    ],
  },
  {
    id: "F06",
    name: "an empty fence is drawn as an empty card, numbered by its first line",
    text: "Before\n\n```\n```\n\nAfter\n",
    rows: [
      [1, "", "Before"],
      [2, "mdm-blank", ""],
      [3, "mdm-empty-card", ""],
      [5, "mdm-blank", ""],
      [6, "", "After"],
      [7, "mdm-blank", ""],
    ],
  },
  {
    id: "F07",
    name: "a fence of three lines in a quote is one card of three, its marks hidden",
    text: "> ```\n> one\n>\n> three\n> ```\n",
    rows: [
      [2, "mdm-quote mdm-quote-1 mdm-code-line mdm-code-first", "one"],
      [3, "mdm-quote mdm-quote-1 mdm-code-line", ""],
      [4, "mdm-quote mdm-quote-1 mdm-code-line mdm-code-last", "three"],
      [6, "mdm-blank", ""],
    ],
  },
  {
    id: "M10b",
    name: "a display equation of two lines in a quote and in an item is typeset without the marks",
    text: "> $$\n> x^2\n> y^2\n> $$\n\n- item\n\n  $$\n  a^2\n  b^2\n  $$\n",
    rows: [
      [1, "mdm-quote mdm-quote-1 mdm-math", "⟦math:x^2\ny^2⟧"],
      [5, "mdm-blank", ""],
      [6, "mdm-li", "• item"],
      [7, "mdm-li mdm-blank", ""],
      [8, "mdm-li mdm-math", "⟦math:a^2\nb^2⟧"],
      [12, "mdm-blank", ""],
    ],
  },
  {
    id: "H09b",
    name: "a setext heading of two lines is one heading, the air above the first and the rule under the last",
    text: "First line\nsecond line\n===\n\nAfter.\n",
    rows: [
      [1, "mdm-h mdm-h1 mdm-h-first", "First line"],
      [2, "mdm-h mdm-h1 mdm-h-last", "second line"],
      [4, "mdm-blank", ""],
      [5, "", "After."],
      [6, "mdm-blank", ""],
    ],
  },
  {
    id: "TB09",
    name: "a table inside an item is drawn inside the item",
    text: "- Item with a table:\n\n  | k | v |\n  |---|---|\n  | 1 | 2 |\n",
    rows: [
      [1, "mdm-li", "• Item with a table:"],
      [2, "mdm-li mdm-blank", ""],
      [3, "mdm-li mdm-table", "kv12"],
      [6, "mdm-blank", ""],
    ],
  },
  {
    id: "TL01",
    name: "task items draw their boxes, checked by x or X",
    text: "- [ ] to do\n- [x] done\n- [X] done with a capital\n",
    rows: [
      [1, "mdm-li", "☐ to do"],
      [2, "mdm-li", "☑ done"],
      [3, "mdm-li", "☑ done with a capital"],
      [4, "mdm-blank", ""],
    ],
  },
  {
    id: "F01",
    name: "a fenced code block is a card of its lines with the fences hidden",
    text: "```python\ndef f(x):\n    return x ** 2\n```\n",
    rows: [
      [2, "mdm-code-line mdm-code-first", "def f(x):"],
      [3, "mdm-code-line mdm-code-last", "    return x ** 2"],
      [5, "mdm-blank", ""],
    ],
  },
  {
    id: "TB01",
    name: "a pipe table is drawn as a table, numbered by its first line",
    text: "| Left | Right |\n|:-----|------:|\n| a    | 1     |\n",
    rows: [
      [1, "mdm-table", "LeftRighta1"],
      [4, "mdm-blank", ""],
    ],
  },
  {
    id: "TB10",
    name: "empty cells keep their column",
    text: "| a | b | c |\n|---|---|---|\n|   |   |   |\n| x |   | z |\n",
    rows: [
      [1, "mdm-table", "abcxz"],
      [5, "mdm-blank", ""],
    ],
    dom: async (page) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("#app .mdm-table tbody tr")).map((tr) =>
          Array.from(tr.children).map((td) => td.textContent)
        )
      ),
    domExpected: [["", "", ""], ["x", "", "z"]],
  },
  {
    id: "TB05",
    name: "a row is fitted to the header: a short one given empty cells, a long one losing the excess (GFM ex. 204)",
    text: "| one | two | three |\n|-----|-----|-------|\n| a | b |\n| a | b | c | d | e |\n",
    rows: [
      [1, "mdm-table", "onetwothreeababc"],
      [5, "mdm-blank", ""],
    ],
    dom: tableCells,
    domExpected: [["a", "b", ""], ["a", "b", "c"]],
  },
  {
    id: "TB02",
    name: "a table without its outer pipes is the same table (GFM ex. 199)",
    text: "Name | Value\n-|-\nalpha | 1\nbeta | 2\n",
    rows: [
      [1, "mdm-table", "NameValuealpha1beta2"],
      [5, "mdm-blank", ""],
    ],
    dom: tableCells,
    domExpected: [["alpha", "1"], ["beta", "2"]],
  },
  {
    id: "TB04",
    name: "a <br> in a cell is a line break, as the page writes it (G020)",
    text: "| a | b |\n|---|---|\n| break | first<br>second |\n| tag | <b>kept</b> |\n",
    rows: [
      [1, "mdm-table", "abbreakfirstsecondtag<b>kept</b>"],
      [5, "mdm-blank", ""],
    ],
    // The break is a real <br>; another raw tag stays as written, as in the
    // prose.
    dom: async (page) =>
      page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-table td")).map((td) => td.innerHTML)),
    domExpected: ["break", "first<br>second", "tag", "&lt;b&gt;kept&lt;/b&gt;"],
  },
  {
    id: "TB11",
    name: "a pipe inside inline maths does not split the cell: the formula is the cell's, as Pandoc reads it (G011)",
    text: "| name | formula |\n|------|---------|\n| magnitude | $|x|$ |\n| norm | $\\lVert v \\rVert$ |\n",
    rows: [
      [1, "mdm-table", "nameformulamagnitude⟦math:|x|⟧norm⟦math:\\lVert v \\rVert⟧"],
      [5, "mdm-blank", ""],
    ],
    // A cell holding maths answers with the formula's source (KaTeX's own
    // annotation), the way rows() names an equation.
    dom: async (page) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("#app .mdm-table tbody tr")).map((tr) =>
          Array.from(tr.children).map((td) => {
            const ann = td.querySelector(".mdm-math annotation");
            return ann ? "⟦math:" + ann.textContent + "⟧" : td.textContent;
          })
        )
      ),
    domExpected: [["magnitude", "⟦math:|x|⟧"], ["norm", "⟦math:\\lVert v \\rVert⟧"]],
  },
  {
    id: "TB12",
    name: "a cell reads its entities, its raw HTML, its escapes and its references as the prose does (G002, G004, G009)",
    text:
      "| entity | html | escape | reference |\n|--------|------|--------|-----------|\n" +
      "| &copy; 1741 | line<br>two | \\*literal\\* | [the reference][ref] |\n\n" +
      '[ref]: https://example.com/ref "The reference title"\n',
    rows: [
      [1, "mdm-table", "entityhtmlescapereference© 1741linetwo*literal*the reference"],
      [4, "mdm-blank", ""],
      [5, "mdm-linkref-line", '[ref]: https://example.com/ref "The reference title"'],
      [6, "mdm-blank", ""],
    ],
    // What Pandoc gives for this row, read from `pandoc -f
    // markdown-blank_before_header-blank_before_blockquote+autolink_bare_uris
    // -t html` (3.8.3):
    //   <td>© 1741</td>
    //   <td>line<br>two</td>
    //   <td>*literal*</td>
    //   <td><a href="https://example.com/ref" title="The reference
    //   title">the reference</a></td>
    // The editor puts the destination in the tooltip and the Markdown title
    // beside it (data-mdm-title), which is the pair a link in the prose
    // carries.
    dom: async (page) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("#app .mdm-table tbody tr")).map((tr) =>
          Array.from(tr.children).map((td) => {
            const link = td.querySelector(".mdm-link");
            if (link) {
              return (
                td.textContent +
                " → " +
                link.title.split("\n")[0] +
                (link.getAttribute("data-mdm-title") ? ' "' + link.getAttribute("data-mdm-title") + '"' : "")
              );
            }
            return td.innerHTML;
          })
        )
      ),
    domExpected: [
      ["© 1741", "line<br>two", "*literal*", 'the reference → https://example.com/ref "The reference title"'],
    ],
  },
  {
    id: "TB12c",
    name: "a note, a citation and raw TeX in a cell are drawn as the prose draws them (PX01, PX04, G013)",
    text: "| note | cite | tex |\n|---|---|---|\n| A claim[^1] | [@knuth, p. 3] | \\emph{x} |\n\n[^1]: The note.\n",
    rows: [
      [1, "mdm-table", "notecitetexA claim1[@knuth, p. 3]\\emph{x}"],
      [4, "mdm-blank", ""],
      [5, "mdm-note-line", "1 The note."],
      [6, "mdm-blank", ""],
    ],
    // Pandoc, same reader: <td>A claim<a href="#fn1" class="footnote-ref"
    // ...><sup>1</sup></a></td>, <td><span class="citation"
    // data-cites="knuth">[@knuth, p. 3]</span></td>, and <td></td> for the
    // raw TeX, which the HTML writer leaves out altogether. The cell says
    // what the TeX is rather than drawing it as words, as the prose does.
    dom: async (page) =>
      page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-table tbody td")).map((td) => td.innerHTML)),
    domExpected: [
      'A claim<span class="mdm-note-ref mdm-sup" title="Footnote 1">1</span>',
      '<span class="mdm-cite" title="Citation [@knuth, p. 3]">[@knuth, p. 3]</span>',
      '<span class="mdm-rawtex" title="Raw TeX: set in the PDF, left out of the HTML page">\\emph{x}</span>',
    ],
  },
  {
    id: "TB12b",
    name: "a destination in angle brackets is the address inside them in a cell as well (G006)",
    text: "| picture | link |\n|---|---|\n| ![Cell](<img/brass.png>) | [cell link](<my page.html>) |\n",
    seed: { docBase: "https://vsc.test/home/me/papers" },
    rows: [
      [1, "mdm-table", "picturelink⟦img:Cell⟧cell link"],
      [4, "mdm-blank", ""],
    ],
    // Pandoc, same reader: <td><img src="img/brass.png" alt="Cell" /></td>
    // and <td><a href="my%20page.html">cell link</a></td>. The address is
    // kept as written here, the percent-encoding being the writer's.
    dom: async (page) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("#app .mdm-table tbody td")).map((td) => {
          const img = td.querySelector("img");
          if (img) return "img src=" + img.getAttribute("src") + " alt=" + img.alt;
          const link = td.querySelector(".mdm-link");
          return link ? td.textContent + " → " + link.title.split("\n")[0] : td.textContent;
        })
      ),
    domExpected: [
      "img src=https://vsc.test/home/me/papers/img/brass.png alt=Cell",
      "cell link → my page.html",
    ],
  },
  {
    id: "TB03",
    name: "an escaped pipe is text, and a pipe inside a code span is the code's (Pandoc), escaped or not",
    text:
      "| Expression | Meaning |\n|------------|---------|\n| a \\| b | escaped pipe |\n" +
      "| `a \\| b` | pipe in code, escaped |\n| `x || y` | unescaped pipes in code |\n",
    rows: [
      [1, "mdm-table", "ExpressionMeaninga | bescaped pipea \\| bpipe in code, escapedx || yunescaped pipes in code"],
      [6, "mdm-blank", ""],
    ],
    dom: tableCells,
    domExpected: [["a | b", "escaped pipe"], ["a \\| b", "pipe in code, escaped"], ["x || y", "unescaped pipes in code"]],
  },
  {
    id: "M01",
    name: "inline maths is typeset, dollars hidden",
    text: "Euler: $e^{i\\pi} + 1 = 0$, a fraction $\\frac{a}{b}$.\n",
    rows: [
      [1, "", "Euler: ⟦math:e^{i\\pi} + 1 = 0⟧, a fraction ⟦math:\\frac{a}{b}⟧."],
      [2, "mdm-blank", ""],
    ],
  },
  {
    id: "M04",
    name: "a display block is drawn under its hidden source, numbered by its first line",
    text: "$$\na^2 + b^2 = c^2\n$$\n",
    rows: [
      [1, "mdm-math mdm-math--block", "⟦math:a^2 + b^2 = c^2⟧"],
      [4, "mdm-blank", ""],
    ],
  },
  {
    id: "M11",
    name: "a closer with a label after it closes the block, the equation numbered in the label's place, and the next block is its own (G052)",
    text: "$$\nE = mc^2\n$$ {#eq-mass}\n$$\nF = ma\n$$\n",
    // The label is the equation's number on the page and none of its text
    // (the equations pass in mdm.lua), so the number is drawn beside the
    // equation and nothing under it. Until 2026-09-30 the label was drawn as
    // nothing and the equation had no number, on the belief that the page
    // printed none of it; it printed the label as text and "?@eq-mass" for
    // the references.
    rows: [
      [1, "mdm-math mdm-math--block mdm-math--numbered", "⟦math:E = mc^2⟧(1)"],
      [4, "mdm-math mdm-math--block", "⟦math:F = ma⟧"],
      [7, "mdm-blank", ""],
    ],
  },
  {
    id: "M12",
    name: "prose after the closer is drawn under the equation, its marks read",
    text: "$$\na^2 + b^2 = c^2\n$$ where *c* is the hypotenuse.\n",
    rows: [
      [1, "mdm-math mdm-math--block", "⟦math:a^2 + b^2 = c^2⟧where c is the hypotenuse."],
      [4, "mdm-blank", ""],
    ],
    dom: async (page) => page.evaluate(() => document.querySelector("#app .mdm-math-tail em").textContent),
    domExpected: "c",
  },
  {
    id: "D01",
    name: "a callout wears its kind, its fences small",
    text: "::: {.callout-warning title=\"Careful\"}\nA warning with a title.\n:::\n",
    rows: [
      [1, "mdm-co-line mdm-co--warning mdm-co-first mdm-co-fence", "::: {.callout-warning title=\"Careful\"}"],
      [2, "mdm-co-line mdm-co--warning", "A warning with a title."],
      [3, "mdm-co-line mdm-co--warning mdm-co-last mdm-co-fence", ":::"],
      [4, "mdm-blank", ""],
    ],
  },
  {
    id: "D05",
    name: "a fenced div that is no callout is drawn bare, its fences put away (G051)",
    text: "::: {.column width=\"50%\"}\nA generic div.\n:::\n\n::: {#refs}\nA div with an id.\n:::\n",
    rows: [
      [1, "mdm-co-fence", "::: {.column width=\"50%\"}"],
      [2, "", "A generic div."],
      [3, "mdm-co-fence", ":::"],
      [4, "mdm-blank", ""],
      [5, "mdm-co-fence", "::: {#refs}"],
      [6, "", "A div with an id."],
      [7, "mdm-co-fence", ":::"],
      [8, "mdm-blank", ""],
    ],
    // No bar, no tint: not a callout line among them.
    dom: async (page) => page.evaluate(() => document.querySelectorAll("#app .cm-line.mdm-co-line").length),
    domExpected: 0,
  },
  {
    id: "D06",
    name: "an opener with colons after its attributes, or a brace inside a quoted value, is a callout (Pandoc, G053)",
    text: "::: {.callout-tip} :::\nTrailing colons.\n:::\n\n::: {.callout-important title=\"Braces {inside}\"}\nBraces.\n:::\n",
    rows: [
      [1, "mdm-co-line mdm-co--tip mdm-co-first mdm-co-fence", "::: {.callout-tip} :::"],
      [2, "mdm-co-line mdm-co--tip", "Trailing colons."],
      [3, "mdm-co-line mdm-co--tip mdm-co-last mdm-co-fence", ":::"],
      [4, "mdm-blank", ""],
      [5, "mdm-co-line mdm-co--important mdm-co-first mdm-co-fence", "::: {.callout-important title=\"Braces {inside}\"}"],
      [6, "mdm-co-line mdm-co--important", "Braces."],
      [7, "mdm-co-line mdm-co--important mdm-co-last mdm-co-fence", ":::"],
      [8, "mdm-blank", ""],
    ],
  },
  {
    id: "D07",
    name: "an opener straight under a paragraph line is prose: a fenced div needs a blank line before it (Pandoc, G053)",
    text: "A paragraph line\n::: {.callout-note}\nUnder a paragraph.\n:::\n",
    rows: [
      [1, "", "A paragraph line"],
      [2, "", "::: {.callout-note}"],
      [3, "", "Under a paragraph."],
      [4, "", ":::"],
      [5, "mdm-blank", ""],
    ],
    dom: async (page) => page.evaluate(() => document.querySelectorAll("#app .cm-line.mdm-co-fence, #app .cm-line.mdm-co-line").length),
    domExpected: 0,
  },
];

for (const c of CASES) {
  const options = { skip };
  if (c.todo) options.todo = "owed by " + c.todo;
  test(c.id + ": " + c.name, options, async () => {
    const h = await open({
      text: c.text,
      scores: c.scores === undefined ? 0 : c.scores,
      height: 1200,
      seed: c.seed,
      withFrontMatter: c.withFrontMatter,
    });
    try {
      await reading(h.page);
      expectRows(await rows(h.page), c.rows, c.id);
      if (c.dom) assert.deepEqual(await c.dom(h.page), c.domExpected, c.id + ": DOM");
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }
  });
}

// ---------- Citations, as the page prints them ----------
//
// The host runs the export's own Pandoc over the citations of the document
// (citationService in extension.js); here it is played by an answer written
// out in the shape Pandoc 3.8.3 gives it (read off a real run, 2026-09-29),
// so that what is tested is the editor's side: what it asks, and what it
// draws of the answer.

const CITED =
  "As @knuth1984 says, and [@shannon1948, p. 380] too, with a note.[^1] And a key it has not got [@nokey2020].\n\n" +
  "[^1]: A note citing [@rameau1722].\n\n" +
  "| Work | Cited |\n|---|---|\n| TeXbook | [@knuth1984, p. 3] |\n\n" +
  "::: {#refs}\n:::\n\nAfter the list.\n";

// In the order the page prints them, a note's where it is called from, each
// in a span that names it; the table's last.
const CITED_BODY =
  "[@knuth1984]{#mdmcite-0}\n\n[[@shannon1948, p. 380]]{#mdmcite-1}\n\n^[[[@rameau1722]]{#mdmcite-2}]\n\n" +
  "[[@nokey2020]]{#mdmcite-3}\n\n[[@knuth1984, p. 3]]{#mdmcite-4}\n";

const link = (key, text) => '<a href="#ref-' + key + '" role="doc-biblioref">' + text + "</a>";
const CITED_HTML =
  '<p><span id="mdmcite-0"><span class="citation" data-cites="knuth1984">Knuth (' + link("knuth1984", "1984") + ")</span></span></p>\n" +
  // What a prefix may carry into the answer, and must not reach the page:
  // raw HTML with a handler on it.
  '<p><span id="mdmcite-1"><span class="citation" data-cites="shannon1948">(<img src="x" onerror="window.__ran = 1">' +
  link("shannon1948", "Shannon 1948, 380") + ")</span></span></p>\n" +
  '<p><a href="#fn1" class="footnote-ref" id="fnref1" role="doc-noteref"><sup>1</sup></a></p>\n' +
  '<p><span id="mdmcite-3"><span class="citation" data-cites="nokey2020">(' + link("nokey2020", "<strong>nokey2020?</strong>") + ")</span></span></p>\n" +
  '<p><span id="mdmcite-4"><span class="citation" data-cites="knuth1984">(' + link("knuth1984", "Knuth 1984, 3") + ")</span></span></p>\n" +
  '<div id="refs" class="references csl-bib-body hanging-indent" role="list">\n' +
  '<div id="ref-knuth1984" class="csl-entry" role="listitem">\nKnuth, Donald E. 1984. <em>The <span>TeX</span>book</em>. Addison-Wesley.\n</div>\n' +
  '<div id="ref-partch1949" class="csl-entry" role="listitem">\nPartch, Harry. 1949. <span>“Tuning by the Ratio <span class="math inline">3/2</span>.”</span> <em>Journal of Tuning</em>.\n</div>\n' +
  '<div id="ref-rameau1722" class="csl-entry" role="listitem">\nRameau, Jean-Philippe. 1722. <em>Traité de l’harmonie</em>. Ballard.\n</div>\n' +
  "</div>\n" +
  '<section id="footnotes" class="footnotes footnotes-end-of-document" role="doc-endnotes">\n<hr />\n<ol>\n' +
  '<li id="fn1"><p><span id="mdmcite-2"><span class="citation" data-cites="rameau1722">(' + link("rameau1722", "Rameau 1722") +
  ')</span></span><a href="#fnref1" class="footnote-back" role="doc-backlink">↩︎</a></p></li>\n</ol>\n</section>\n';

async function citesAsked(page, count) {
  await page.waitForFunction(
    (n) => window.__posts.filter((m) => m.type === "cites").length >= n,
    { timeout: 10000 },
    count || 1
  );
  return page.evaluate(() => window.__posts.filter((m) => m.type === "cites").pop());
}

function answerCites(page, msg) {
  return page.evaluate((m) => window.postMessage(m, "*"), Object.assign({ type: "cites" }, msg));
}

async function citedNow(page) {
  await new Promise((r) => setTimeout(r, 200));
  return page.evaluate(() => ({
    cited: Array.from(document.querySelectorAll("#app .mdm-cited")).map(
      (e) => e.textContent + (e.classList.contains("mdm-cited--missing") ? " !" : "")
    ),
    raw: Array.from(document.querySelectorAll("#app .mdm-cite")).map((e) => e.textContent),
  }));
}

test("the host is asked about the citations in their order and in their notes, and each is drawn as the page prints it, the list where the page sets it", { skip }, async () => {
  const h = await open({ text: CITED, scores: 0, height: 1200 });
  try {
    const asked = await citesAsked(h.page);
    assert.equal(asked.body, CITED_BODY);
    await answerCites(h.page, { seq: asked.seq, state: "ok", html: CITED_HTML, missing: ["nokey2020"] });
    await reading(h.page);
    const seen = await citedNow(h.page);
    assert.deepEqual(seen.cited, [
      "Knuth (1984)",
      "(Shannon 1948, 380)",
      "(nokey2020?) !",
      "(Rameau 1722)",
      "(Knuth 1984, 3)",
    ]);
    assert.deepEqual(seen.raw, []);
    const drawn = await h.page.evaluate(() => {
      const first = document.querySelector("#app .mdm-cited");
      const year = first.querySelector(".mdm-cite-link");
      const fences = Array.from(document.querySelectorAll("#app .cm-line")).filter((l) => l.textContent === ":::" || l.textContent === "::: {#refs}");
      const list = document.querySelector("#app .mdm-refs");
      return {
        // In the ink of the prose, the part the page links in the link blue.
        ink: getComputedStyle(first).color === getComputedStyle(document.querySelector("#app .cm-line")).color,
        blue: getComputedStyle(year).color !== getComputedStyle(first).color,
        // The pointer a link and the number of a note carry, since a click
        // opens it; it had the caret of the text (the owner, 2026-09-29).
        pointer: Array.from(document.querySelectorAll("#app .mdm-cited"))
          .map((e) => getComputedStyle(e).cursor)
          .filter((c, i, all) => all.indexOf(c) === i),
        entries: Array.from(list.querySelectorAll(".csl-entry")).map((e) => e.textContent.trim().slice(0, 12)),
        // Between the fences of the document's `::: {#refs}`.
        inside:
          list.getBoundingClientRect().top >= fences[0].getBoundingClientRect().bottom - 1 &&
          list.getBoundingClientRect().bottom <= fences[1].getBoundingClientRect().top + 1,
        maths: list.querySelectorAll(".katex").length,
        // Nothing of the raw HTML came across, and nothing of it ran.
        images: document.querySelectorAll("#app .mdm-cited img").length,
        ran: window.__ran === 1,
        same: window.__mdm.checkDecorations(),
        // The buffers CodeMirror sets beside a widget, out of the flow: in
        // it, one was a place to break the line, and a period went down to
        // a row of its own after "Partch (1949, 5)" (2026-09-29).
        buffers: Array.from(document.querySelectorAll("#app .cm-line img.cm-widgetBuffer"))
          .filter((b) => [b.previousElementSibling, b.nextElementSibling].some((e) => e && e.classList.contains("mdm-cited")))
          .map((b) => getComputedStyle(b).position)
          .filter((p, i, all) => all.indexOf(p) === i),
      };
    });
    assert.deepEqual(drawn, {
      ink: true,
      blue: true,
      pointer: ["pointer"],
      entries: ["Knuth, Donal", "Partch, Harr", "Rameau, Jean"],
      inside: true,
      maths: 1,
      images: 0,
      ran: false,
      same: null,
      buffers: ["absolute"],
    });
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("a citation under the caret is its source, one being typed is drawn as written until its own answer, and an answer about another text is not taken", { skip }, async () => {
  const h = await open({ text: CITED, scores: 0, height: 1200 });
  try {
    const asked = await citesAsked(h.page);
    await answerCites(h.page, { seq: asked.seq, state: "ok", html: CITED_HTML, missing: ["nokey2020"] });
    await reading(h.page);
    // The caret in `[@shannon1948, p. 380]`.
    const at = CITED.indexOf("[@shannon1948") + 3;
    await setSelection(h.page, at);
    let seen = await citedNow(h.page);
    assert.deepEqual(seen.raw, ["[@shannon1948, p. 380]"]);
    assert.equal(seen.cited.length, 4);
    // Open, it is text being written, and has the text's caret back.
    assert.equal(await h.page.evaluate(() => getComputedStyle(document.querySelector("#app .mdm-cite")).cursor), "text");
    // Typed into: its answer is let go of, the rest stand. Read with the
    // caret moved on to another paragraph, where the citation is untouched
    // and an answer kept for it would be drawn (a click on the corner lands
    // on the toolbar, which keeps the document's caret where it was).
    await h.page.keyboard.type("x");
    seen = await citedNow(h.page);
    assert.deepEqual(seen.raw, ["[@sxhannon1948, p. 380]"]);
    await setSelection(h.page, CITED.length - 2);
    seen = await citedNow(h.page);
    assert.deepEqual(seen.raw, ["[@sxhannon1948, p. 380]"]);
    assert.equal(seen.cited.length, 4);
    // Asked again, for the new text; the answer to the old request is not
    // taken for it.
    const again = await citesAsked(h.page, 2);
    assert.ok(again.body.includes("[[@sxhannon1948, p. 380]]{#mdmcite-1}"), again.body);
    await answerCites(h.page, { seq: asked.seq, state: "ok", html: CITED_HTML, missing: [] });
    seen = await citedNow(h.page);
    assert.deepEqual(seen.raw, ["[@sxhannon1948, p. 380]"]);
    assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("without a bibliography, or without Quarto, the citations stay as written", { skip }, async () => {
  const h = await open({ text: CITED, scores: 0, height: 1200 });
  try {
    for (const state of ["none", "noquarto", "error"]) {
      const asked = await citesAsked(h.page);
      await answerCites(h.page, { seq: asked.seq, state: state });
      await reading(h.page);
      const seen = await citedNow(h.page);
      assert.deepEqual(seen.cited, [], state);
      assert.equal(seen.raw.length, 5, state);
      assert.equal(await h.page.evaluate(() => document.querySelectorAll("#app .mdm-refs").length), 0, state);
    }
  } finally {
    await h.close();
  }
});

// The list is set as the page sets it (mdm-look.css): the prose's size and
// leading, the style's hang at the PDF's 1.5em, a quarter of a line between
// two entries unless the style says none (the style's whole line was too far
// apart, 2026-09-29), justified when the prose is.
test("the list of works cited is set as the prose is, with the style's hang and the style's space between entries", { skip }, async () => {
  const h = await open({ text: "As [@knuth1984].\n\nProse after it.\n", scores: 0, height: 1200 });
  try {
    for (const spacing of ["", ' data-entry-spacing="0"']) {
      const asked = await citesAsked(h.page);
      const html =
        '<p><span id="mdmcite-0"><span class="citation" data-cites="knuth1984">(' + link("knuth1984", "Knuth 1984") + ")</span></span></p>\n" +
        '<div id="refs" class="references csl-bib-body hanging-indent"' + spacing + ' role="list">\n' +
        '<div id="ref-a" class="csl-entry" role="listitem">\nAaa, A. 2001. <em>A title long enough to be set on two lines of the column of the editor, and a few words more to be sure of it</em>. Press.\n</div>\n' +
        '<div id="ref-b" class="csl-entry" role="listitem">\nBbb, B. 2002. A title. Press.\n</div>\n</div>\n';
      await answerCites(h.page, { seq: asked.seq, state: "ok", html: html, missing: [] });
      await reading(h.page);
      await new Promise((r) => setTimeout(r, 200));
      const set = await h.page.evaluate(() => {
        const prose = getComputedStyle(document.querySelector("#app .cm-line"));
        const entries = document.querySelectorAll("#app .mdm-refs .csl-entry");
        const a = getComputedStyle(entries[0]);
        const b = getComputedStyle(entries[1]);
        return {
          size: a.fontSize === prose.fontSize,
          leading: a.lineHeight === prose.lineHeight,
          face: a.fontFamily === prose.fontFamily,
          hang: [parseFloat(a.paddingLeft) / parseFloat(a.fontSize), parseFloat(a.textIndent) / parseFloat(a.fontSize)],
          gap: parseFloat(b.marginTop) / parseFloat(b.lineHeight),
          align: a.textAlign,
        };
      });
      // A margin in lh reads a hair under the line height (27.1875 against
      // 27.2 px at 16px): the gap is a quarter of a line to a thousandth.
      assert.ok(Math.abs(set.gap - (spacing ? 0 : 0.25)) < 0.001, spacing + ": gap " + set.gap);
      delete set.gap;
      assert.deepEqual(set, { size: true, leading: true, face: true, hang: [1.5, -1.5], align: "justify" }, spacing);
      // The second answer goes to the same request, as the host's answer
      // does when a .bib it watches changes.
    }
  } finally {
    await h.close();
  }
});

// A numbered style (IEEE, Vancouver) prints each entry as its number and its
// text in two boxes, which stand in two columns: the numbers' as wide as the
// widest number, each flush right, and the text half an em after it on every
// line, as LaTeX sets its own bibliography (C on
// design/design-bib-numbers.html, the owner's pick of 2026-09-30). Pandoc's
// stylesheet set the text at 3em whatever the numbers, and "[1]" stood
// 1.71em from it. Ten entries, for a number of two figures; written in the
// shape Pandoc 3.8.3 gives a list whose style aligns its second field (read
// off a real run), with no space between entries, which such a style asks.
test("a numbered list sets its numbers flush right in a column as wide as the widest, and the text half an em after it", { skip }, async () => {
  const keys = Array.from({ length: 10 }, (_, i) => "k" + (i + 1));
  const h = await open({ text: "As " + keys.map((k) => "[@" + k + "]").join(" ") + ".\n\nProse after it.\n", scores: 0, height: 1200 });
  try {
    const asked = await citesAsked(h.page);
    const entry = (key, n, title) =>
      '<div id="ref-' + key + '" class="csl-entry" role="listitem">\n<div class="csl-left-margin">[' + n +
      '] </div><div class="csl-right-inline">' + title + "</div>\n</div>\n";
    const html =
      keys.map((k, i) => '<p><span id="mdmcite-' + i + '"><span class="citation" data-cites="' + k + '">[' + link(k, String(i + 1)) + "]</span></span></p>\n").join("") +
      '<div id="refs" class="references csl-bib-body" data-entry-spacing="0" role="list">\n' +
      keys
        .map((k, i) =>
          entry(k, i + 1, i ? "Title " + (i + 1) : "A title long enough to be set on two lines of the column of the editor, and a few words more to be sure of it")
        )
        .join("") +
      "</div>\n";
    await answerCites(h.page, { seq: asked.seq, state: "ok", html, missing: [] });
    await reading(h.page);
    await new Promise((r) => setTimeout(r, 200));
    const set = await h.page.evaluate(() => {
      const list = document.querySelector("#app .mdm-refs-list").getBoundingClientRect();
      const entries = Array.from(document.querySelectorAll("#app .mdm-refs .csl-entry"));
      const em = parseFloat(getComputedStyle(entries[0]).fontSize);
      const at = (x) => Math.round(((x - list.left) / em) * 100) / 100;
      // The ink of a number, and of every row of an entry's text.
      const ink = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return Array.from(range.getClientRects()).filter((r) => r.width > 0);
      };
      const number = (e) => ink(e.querySelector(".csl-left-margin"))[0];
      const rows = ink(entries[0].querySelector(".csl-right-inline"));
      const widest = number(entries[9]);
      return {
        numbers: entries.map((e) => e.querySelector(".csl-left-margin").textContent.trim()),
        // Every number ends where the widest does, and the widest starts at
        // the list's edge.
        ends: Array.from(new Set(entries.map((e) => at(number(e).right)))).length,
        widestAt: at(widest.left),
        // Every row of the text, of every entry, starts half an em after the
        // widest number.
        text: Array.from(new Set(rows.concat(entries.map((e) => ink(e.querySelector(".csl-right-inline"))[0])).map((r) => at(r.left)))),
        column: Math.round((at(widest.right) + 0.5) * 100) / 100,
        rows: new Set(rows.map((r) => Math.round(r.top))).size,
        gap: Math.round(entries[1].getBoundingClientRect().top - entries[0].getBoundingClientRect().bottom),
      };
    });
    assert.deepEqual(set.numbers, ["[1]", "[2]", "[3]", "[4]", "[5]", "[6]", "[7]", "[8]", "[9]", "[10]"]);
    assert.equal(set.ends, 1, "the numbers do not end in one line");
    assert.equal(set.widestAt, 0, "the widest number does not start at the list's edge");
    assert.equal(set.text.length, 1, "the text starts at more than one place: " + set.text);
    assert.ok(Math.abs(set.text[0] - set.column) < 0.02, "the text at " + set.text[0] + "em, not half an em after the numbers (" + set.column + "em)");
    assert.equal(set.rows, 2);
    assert.equal(set.gap, 0);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

// A citation says in its tooltip what it cites, the entry as the box the
// page opens over it shows it, and the click that goes there; Ctrl+click
// goes, as the page's link does, leaving the caret where it was. An entry
// the host found in a file opens there on a plain click, and says so, and
// Ctrl+click on it does not (one click for one thing, the owner said); one
// it did not find is words; a link inside an entry is followed with
// Ctrl+click (the owner, 2026-09-29).
test("a citation names its entries and Ctrl+click goes to them in the list, and a click on an entry opens it where it is written", { skip }, async () => {
  // Far enough for the list not to be drawn at all until it is gone to:
  // CodeMirror draws a margin past the pane, and a list inside it was found
  // at once, which left the second look of showEntry untried.
  const filler = Array.from({ length: 300 }, (_, i) => "Paragraph " + i + " standing between the citations and the list.").join("\n\n");
  const text = CITED.replace("::: {#refs}", filler + "\n\n::: {#refs}");
  // A list long enough that the place it stands at, brought into the pane,
  // does not bring its first entry with it: the entry is looked for again
  // once the list is drawn.
  const more = Array.from({ length: 60 }, (_, i) => '<div id="ref-zz' + i + '" class="csl-entry" role="listitem">\nZzz, Z. ' + (1900 + i) + ". A title. Press.\n</div>\n").join("");
  const html = CITED_HTML.replace(
    "Rameau, Jean-Philippe. 1722. <em>Traité de l’harmonie</em>. Ballard.",
    'Rameau, Jean-Philippe. 1722. <em>Traité de l’harmonie</em>. Ballard. <a href="https://doi.org/10.1/x">https://doi.org/10.1/x</a>.'
  ).replace("</div>\n</div>\n<section", "</div>\n" + more + "</div>\n<section");
  const h = await open({ text, scores: 0, height: 600 });
  try {
    const asked = await citesAsked(h.page);
    await answerCites(h.page, {
      seq: asked.seq,
      state: "ok",
      html,
      missing: ["nokey2020"],
      sources: { knuth1984: "refs.bib", rameau1722: "refs.bib" },
    });
    await reading(h.page);
    await new Promise((r) => setTimeout(r, 200));
    const titles = await h.page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-cited")).map((e) => e.title));
    assert.deepEqual(titles, [
      "Knuth, Donald E. 1984. The TeXbook. Addison-Wesley.\nCtrl+click to open",
      // Answered, but not in the list the answer carries: nothing to say.
      "",
      "@nokey2020: not in the bibliography",
      "Rameau, Jean-Philippe. 1722. Traité de l’harmonie. Ballard. https://doi.org/10.1/x.\nCtrl+click to open",
      "Knuth, Donald E. 1984. The TeXbook. Addison-Wesley.\nCtrl+click to open",
    ]);
    // An entry corrected in its file, the citations printing the same as
    // before: the tooltips follow it, the table's with them, which is told
    // apart from its last drawing by what its citations print (citedSignature).
    await answerCites(h.page, {
      seq: asked.seq,
      state: "ok",
      html: html.replace("Addison-Wesley.\n</div>", "Addison-Wesley, 1986.\n</div>"),
      missing: ["nokey2020"],
      sources: { knuth1984: "refs.bib", rameau1722: "refs.bib" },
    });
    await new Promise((r) => setTimeout(r, 200));
    const again = await h.page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-cited")).map((e) => e.title));
    assert.equal(again[0], "Knuth, Donald E. 1984. The TeXbook. Addison-Wesley, 1986.\nCtrl+click to open");
    assert.equal(again[4], again[0], "the table's citation kept the tooltip it was first drawn with");

    // Ctrl+click on a citation whose key the list has not got: nothing to
    // go to, and the view stays. Then on the first citation: its entry, far
    // below and not yet drawn, comes into the pane, and the caret has not
    // moved. The caret stands after the first citation, outside it, which
    // would otherwise be its source.
    await setSelection(h.page, CITED.indexOf(" says") + 2);
    const before = await h.page.evaluate(() => window.__mdm.view.state.selection.main.head);
    const entryShown = () =>
      h.page.evaluate(() => {
        const e = document.querySelector('#app .mdm-refs .csl-entry[data-mdm-ref="knuth1984"]');
        if (!e) return false;
        const b = e.getBoundingClientRect();
        return b.top >= 0 && b.bottom <= window.innerHeight;
      });
    const scrolled = () => h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop);
    const ctrlClick = async (index) => {
      const at = await h.page.evaluate((i) => {
        const b = document.querySelectorAll("#app .mdm-cited")[i].querySelector(".mdm-cite-link").getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }, index);
      await h.page.keyboard.down("Control");
      await h.page.mouse.click(at.x, at.y);
      await h.page.keyboard.up("Control");
      await new Promise((r) => setTimeout(r, 300));
    };
    assert.equal(await entryShown(), false, "the entry was in sight already");
    assert.equal(
      await h.page.evaluate(() => document.querySelectorAll("#app .mdm-refs").length),
      0,
      "the list was drawn before it was gone to"
    );
    const top = await scrolled();
    await ctrlClick(1);
    assert.equal(await scrolled(), top, "a key the list has not got moved the view");
    await ctrlClick(0);
    assert.equal(await entryShown(), true, "Ctrl+click did not bring the entry into sight");
    assert.equal(await h.page.evaluate(() => window.__mdm.view.state.selection.main.head), before);

    // The entries: which open, what they say, and what a click posts.
    const entries = await h.page.evaluate(() =>
      Array.from(document.querySelectorAll("#app .mdm-refs .csl-entry")).slice(0, 3).map((e) => [
        e.getAttribute("data-mdm-ref"),
        e.title,
        getComputedStyle(e).cursor,
      ])
    );
    assert.deepEqual(entries, [
      ["knuth1984", "refs.bib\nClick to open", "pointer"],
      ["partch1949", "", "text"],
      ["rameau1722", "refs.bib\nClick to open", "pointer"],
    ]);
    // Under the pointer an entry that opens takes the link blue; one that
    // does not keeps the ink.
    const hovered = async (key) => {
      const b = await h.page.evaluate((k) => {
        const e = document.querySelector('#app .mdm-refs .csl-entry[data-mdm-ref="' + k + '"]');
        e.scrollIntoView({ block: "center" });
        const r = e.getBoundingClientRect();
        return { x: r.left + 20, y: r.top + r.height / 2 };
      }, key);
      await h.page.mouse.move(b.x, b.y);
      await new Promise((r) => setTimeout(r, 100));
      return h.page.evaluate((k) => {
        const e = document.querySelector('#app .mdm-refs .csl-entry[data-mdm-ref="' + k + '"]');
        const link = getComputedStyle(document.querySelector("#app .mdm-cited .mdm-cite-link")).color;
        const ink = getComputedStyle(document.querySelector("#app .cm-line")).color;
        const c = getComputedStyle(e).color;
        return c === link ? "blue" : c === ink ? "ink" : c;
      }, key);
    };
    assert.equal(await hovered("knuth1984"), "blue");
    assert.equal(await hovered("partch1949"), "ink");
    const clickOn = async (selector, ctrl) => {
      const b = await h.page.evaluate((sel) => {
        const e = document.querySelector(sel);
        e.scrollIntoView({ block: "center" });
        const r = e.getBoundingClientRect();
        return { x: r.left + 4, y: r.top + r.height / 2 };
      }, selector);
      if (ctrl) await h.page.keyboard.down("Control");
      await h.page.mouse.click(b.x, b.y);
      if (ctrl) await h.page.keyboard.up("Control");
      await new Promise((r) => setTimeout(r, 100));
    };
    const posted = () =>
      h.page.evaluate(() =>
        window.__posts.filter((m) => m.type === "openEntry" || m.type === "openLink").map((m) => m.type + " " + (m.key || m.href))
      );
    // A plain click opens an entry the host found, and Ctrl+click on it
    // does nothing, but on the DOI inside it follows the DOI.
    await clickOn('#app .mdm-refs .csl-entry[data-mdm-ref="knuth1984"]');
    await clickOn('#app .mdm-refs .csl-entry[data-mdm-ref="partch1949"]');
    await clickOn("#app .mdm-refs .mdm-cite-link[data-mdm-href]", true);
    await clickOn('#app .mdm-refs .csl-entry[data-mdm-ref="rameau1722"]', true);
    await clickOn('#app .mdm-refs .csl-entry[data-mdm-ref="partch1949"]', true);
    assert.deepEqual(await posted(), ["openEntry knuth1984", "openLink https://doi.org/10.1/x"]);
    // Nothing of the list became a caret in the document.
    assert.equal(await h.page.evaluate(() => window.__mdm.view.state.selection.main.head), before);
    // With Ctrl+click adding a caret (editor.multiCursorModifier ctrlCmd),
    // Alt+click is the one that follows, and a citation's tooltip says so;
    // an entry's names the plain click that opens it either way.
    await postSettings(h.page, { multiCursorModifier: "ctrlCmd" });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(
      await h.page.evaluate(() => [
        document.querySelector("#app .mdm-cited").title.split("\n").pop(),
        document.querySelector('#app .mdm-refs .csl-entry[data-mdm-ref="knuth1984"]').title,
      ]),
      ["Alt+click to open", "refs.bib\nClick to open"]
    );
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

// ---------- Equations by number ----------
//
// A display equation with a label straight after its closing `$$` is
// numbered at the right of the column on the formula's baseline, and a
// reference to it reads as the page prints it (the equations pass in
// mdm.lua). The rules are media/mdm-crossref.js's, held against what Quarto
// printed in crossref.test.js; the page is held against the same document
// in html.test.js, and the paper in render.test.js.

const NUMBERED =
  "Before one, a line of prose.\n\n$$\nE = mc^2\n$$\n\nAfter one, a line of prose.\n\n" +
  "Before two, a line of prose.\n\n$$\nE = mc^2\n$$ {#eq-mass}\n\nAfter two, a line of prose.\n\n" +
  "$$\n\\frac{a}{b} = \\sum_{i=1}^{n} x_i\n$$ {#eq-sum}\n\n" +
  "$$\n\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}\n$$ {#eq-pair}\n\n" +
  "Inline display $$c = d$$ {#eq-inline} inside a paragraph.\n\n" +
  "> $$\n> e = f\n> $$ {#eq-quote}\n\n" +
  "| Work | Law |\n|---|---|\n| Newton | $$F = ma$$ {#eq-cell} |\n\n" +
  "Refs: @eq-mass; -@eq-sum; [Eq. @eq-pair]; @Eq-inline; [@eq-quote; @eq-cell]; [@eq-mass; @eq-zz]; [see @eq-mass, p. 3].\n";

// Each numbered equation as it is drawn: its number, how far the number's
// baseline stands from the formula's, how far it stands in from the right of
// the equation's box, how far the formula is off the box's centre, and
// whether the number is in the prose's face at its size.
async function numberedNow(page) {
  return page.evaluate(() => {
    const prose = getComputedStyle(document.querySelector("#app .cm-content"));
    return Array.from(document.querySelectorAll("#app .mdm-math--numbered")).map((eq) => {
      const num = eq.querySelector(":scope > .mdm-eq-number");
      const disp = eq.querySelector(":scope > .katex-display");
      const bases = disp.querySelectorAll(".katex-html > *");
      const probe = () => {
        const s = document.createElement("span");
        s.style.cssText = "display:inline-block;width:0;height:0";
        return s;
      };
      const m = probe();
      const n = probe();
      bases[bases.length - 1].appendChild(m);
      num.appendChild(n);
      const box = eq.getBoundingClientRect();
      const nb = num.getBoundingClientRect();
      const k = disp.querySelector(".katex-html").getBoundingClientRect();
      const out = {
        number: num.textContent,
        baseline: +(n.getBoundingClientRect().top - m.getBoundingClientRect().top).toFixed(2),
        right: +(box.right - nb.right).toFixed(2),
        centre: +((k.left + k.right) / 2 - (box.left + box.right) / 2).toFixed(2),
        face: getComputedStyle(num).fontFamily === prose.fontFamily,
        size: getComputedStyle(num).fontSize,
        cell: !!eq.closest(".mdm-table"),
        scrolls: disp.scrollWidth > disp.clientWidth,
      };
      m.remove();
      n.remove();
      return out;
    });
  });
}

function eqRefs(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#app .mdm-eqref")).map((e) => ({
      text: e.textContent,
      links: Array.from(e.querySelectorAll(".mdm-eqref-link")).map((l) => l.getAttribute("data-mdm-eq")),
      missing: Array.from(e.querySelectorAll(".mdm-eqref-missing")).map((l) => l.textContent),
      title: e.title,
    }))
  );
}

test("a labelled equation is numbered in the order of the document at the right of the column, on the formula's baseline and in the prose's face, and nothing of its label is drawn", { skip }, async () => {
  const h = await open({ text: NUMBERED, scores: 0, height: 1400 });
  try {
    await reading(h.page);
    const seen = await numberedNow(h.page);
    // In a block, a fraction, an aligned pair (whose baseline is its axis,
    // where LaTeX stands the tag of an aligned block too), inside a
    // paragraph, in a quote and in a table's cell, in that order.
    assert.deepEqual(seen.map((s) => s.number), ["(1)", "(2)", "(3)", "(4)", "(5)", "(6)"]);
    for (const s of seen) {
      assert.ok(Math.abs(s.baseline) < 0.5, s.number + " stands " + s.baseline + " px off the formula's baseline");
      assert.ok(Math.abs(s.right) < 0.5, s.number + " stands " + s.right + " px in from the right of its equation");
      assert.ok(s.face, s.number + " is not in the prose's face");
      assert.equal(s.size, "16px", s.number);
      if (!s.cell) assert.ok(Math.abs(s.centre) < 1, s.number + "'s formula stands " + s.centre + " px off the centre");
      // A formula that fits does not scroll: what KaTeX draws past its box
      // (the bar of a fraction, the limits of a sum) is inside the half em.
      assert.equal(s.scrolls, false, s.number + " scrolls");
    }
    // A block's and a paragraph's equation span the column, as the page's do.
    const widths = await h.page.evaluate(() => {
      const col = document.querySelector("#app .cm-content").getBoundingClientRect().width;
      return Array.from(document.querySelectorAll("#app .mdm-math--numbered"))
        .filter((e) => !e.closest(".mdm-table, .mdm-block-framed"))
        .map((e) => Math.round(col - e.getBoundingClientRect().width));
    });
    assert.deepEqual(widths, [0, 0, 0, 0]);
    // Nothing of a label is on screen, and the unlabelled equation has no
    // number.
    const shown = await h.page.evaluate(() => document.querySelector("#app .cm-content").innerText);
    assert.ok(!/\{#eq-/.test(shown), shown);
    assert.equal(await h.page.evaluate(() => document.querySelectorAll("#app .mdm-math--block:not(.mdm-math--numbered)").length), 1);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("a reference to an equation reads as the page prints it, in the link blue, its tooltip the equation, and its source under the caret", { skip }, async () => {
  const h = await open({ text: NUMBERED, scores: 0, height: 1400 });
  try {
    await reading(h.page);
    const refs = await eqRefs(h.page);
    assert.deepEqual(refs.map((r) => r.text), [
      "Equation\u00a01",
      "2",
      "Eq.\u00a03",
      "Equation\u00a04",
      "Equation\u00a05, Equation\u00a06",
      "Equation\u00a01?@eq-zz",
      "see\u00a01",
    ]);
    assert.deepEqual(refs[4].links, ["eq-quote", "eq-cell"]);
    assert.deepEqual(refs[5].missing, ["?@eq-zz"]);
    assert.equal(refs[0].title, "(1) E = mc^2\nCtrl+click to open");
    assert.equal(refs[5].title, "(1) E = mc^2\n@eq-zz: no equation carries this label\nCtrl+click to open");
    // The link blue on what the page links, the ink on the rest, and the
    // missing label in bold, underlined as a missing citation is.
    const look = await h.page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--mdm-link)";
      document.querySelector("#app").appendChild(probe);
      const blue = getComputedStyle(probe).color;
      probe.remove();
      const ref = document.querySelectorAll("#app .mdm-eqref")[5];
      return {
        blue: blue,
        link: getComputedStyle(ref.querySelector(".mdm-eqref-link")).color,
        missingWeight: getComputedStyle(ref.querySelector(".mdm-eqref-missing")).fontWeight,
        missingLine: getComputedStyle(ref.querySelector(".mdm-eqref-missing")).textDecorationStyle,
        cursor: getComputedStyle(ref).cursor,
      };
    });
    assert.equal(look.link, look.blue);
    assert.ok(Number(look.missingWeight) >= 600, look.missingWeight);
    assert.equal(look.missingLine, "wavy");
    assert.equal(look.cursor, "pointer");
    // Under the caret, the source.
    await setSelection(h.page, NUMBERED.indexOf("@eq-mass;") + 3);
    const open1 = await eqRefs(h.page);
    assert.equal(open1.length, 6);
    assert.equal(open1[0].text, "2");
    const raw = await h.page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-cite")).map((e) => e.textContent));
    assert.deepEqual(raw, ["@eq-mass"]);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("an open equation shows its label wherever the caret stands in it", { skip }, async () => {
  // The label is the equation's number on the page and none of its text, so
  // shut it is not drawn; open, it stands small and faint on the closer's
  // line with the caret anywhere in the equation. It showed only once the
  // caret came onto it, at the end of the `$$` (the owner, 2026-09-30).
  const h = await open({ text: NUMBERED, scores: 0, height: 1400 });
  try {
    await reading(h.page);
    const at = NUMBERED.indexOf("$$ {#eq-mass}");
    // The caret in the formula's own line, two lines above the label.
    await setSelection(h.page, NUMBERED.lastIndexOf("E = mc^2", at) + 2);
    await new Promise((r) => setTimeout(r, 150));
    const label = await h.page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("#app .mdm-attr")).find((e) => e.textContent === "{#eq-mass}");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { shown: b.width > 0 && b.height > 0, line: el.closest(".cm-line").textContent };
    });
    assert.ok(label, "the label is not drawn with the equation open");
    assert.equal(label.shown, true);
    assert.equal(label.line, "$$ {#eq-mass}");
    // A caret in the paragraph after it shuts the equation again, and the
    // label goes with its source.
    await setSelection(h.page, NUMBERED.indexOf("After two") + 2);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await h.page.evaluate(() => /\{#eq-mass\}/.test(document.querySelector("#app .cm-content").innerText)), false);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("a numbered equation too wide for the column scrolls in its own box, its number whole at the right and still", { skip }, async () => {
  // The owner's ask (2026-09-30): the number always in view, the scroll
  // bar working, the number not moving with it. The editor's text may be
  // cut between any two letters, and "(4)" stood as three rows beside a
  // formula that could not fit, the grid having given the number the width
  // of one character.
  const sum = Array.from({ length: 24 }, (_, i) => "x_{" + (i + 1) + "}").join(" + ");
  const text = "Before.\n\n$$\n" + sum + "\n$$ {#eq-long}\n\nAfter.\n";
  const h = await open({ text, scores: 0, height: 900 });
  try {
    await reading(h.page);
    const read = () =>
      h.page.evaluate(() => {
        const eq = document.querySelector("#app .mdm-math--numbered");
        const disp = eq.querySelector(":scope > .katex-display");
        const num = eq.querySelector(":scope > .mdm-eq-number");
        const col = document.querySelector("#app .cm-content").getBoundingClientRect();
        const n = num.getBoundingClientRect();
        return {
          scrolls: disp.scrollWidth > disp.clientWidth,
          scrollLeft: disp.scrollLeft,
          whole: n.width >= num.scrollWidth - 0.5 && n.height < parseFloat(getComputedStyle(num).fontSize) * 1.5,
          right: Math.round((col.right - n.right) * 10) / 10,
          left: Math.round(n.left * 10) / 10,
          clear: n.left >= disp.getBoundingClientRect().right,
        };
      });
    const before = await read();
    assert.equal(before.scrolls, true, "the formula does not scroll");
    assert.equal(before.whole, true, "the number is not whole on one row");
    assert.equal(before.right, 0, "the number is not at the right of the column");
    assert.equal(before.clear, true, "the formula's box runs under the number");
    await h.page.evaluate(() => {
      document.querySelector("#app .mdm-math--numbered > .katex-display").scrollLeft = 300;
    });
    await new Promise((r) => setTimeout(r, 100));
    const after = await read();
    assert.equal(after.scrollLeft, 300);
    assert.equal(after.left, before.left, "the number moved with the scroll");
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("an equation leaves the same air above and below with a number as without one", { skip }, async () => {
  const h = await open({ text: NUMBERED, scores: 0, height: 1400 });
  try {
    await reading(h.page);
    const gaps = await h.page.evaluate(() => {
      const line = (t) => Array.from(document.querySelectorAll("#app .cm-line")).find((l) => l.textContent.startsWith(t));
      return ["one", "two"].map((k) => line("After " + k).getBoundingClientRect().top - line("Before " + k).getBoundingClientRect().bottom);
    });
    assert.ok(Math.abs(gaps[0] - gaps[1]) < 0.5, "the gaps are " + gaps.join(" and "));
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("a label added renumbers the equations after it and every reference to them, as does the header's language, hidden or shown", { skip }, async () => {
  const h = await open({ text: NUMBERED, scores: 0, height: 1400 });
  try {
    await reading(h.page);
    // A labelled equation put in at the head of the document, far above the
    // references: every number moves, and the references with them, though
    // nothing near them changed.
    await h.page.evaluate(() => window.__mdm.view.dispatch({ changes: { from: 0, insert: "$$\nx = y\n$$ {#eq-first}\n\n" } }));
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual((await numberedNow(h.page)).map((s) => s.number), ["(1)", "(2)", "(3)", "(4)", "(5)", "(6)", "(7)"]);
    assert.deepEqual((await eqRefs(h.page)).map((r) => r.text).slice(0, 2), ["Equation\u00a02", "3"]);
    assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
    // Its label taken off again: the old numbers come back.
    await h.page.evaluate(() => {
      const text = window.__mdm.view.state.doc.toString();
      const at = text.indexOf(" {#eq-first}");
      window.__mdm.view.dispatch({ changes: { from: at, to: at + " {#eq-first}".length } });
    });
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual((await eqRefs(h.page)).map((r) => r.text).slice(0, 2), ["Equation\u00a01", "2"]);
    assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
    // A header the host keeps out of the text, naming the language and the
    // numbering: the text does not change, and the references follow it.
    const text = await h.page.evaluate(() => window.__mdm.view.state.doc.toString());
    const header = "---\nlang: es\ncrossref:\n  eq-labels: roman i\n---\n";
    await update(h.page, header + "\n" + text, false, 0, header);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual((await eqRefs(h.page)).map((r) => r.text).slice(0, 2), ["Ecuación\u00a0i", "ii"]);
    assert.deepEqual((await numberedNow(h.page)).map((s) => s.number).slice(0, 2), ["(i)", "(ii)"]);
    assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
    // The language changed in that header and nothing else: the lines kept
    // back are as many as before, and no other change redraws the document.
    const french = header.replace("lang: es", "lang: fr");
    await update(h.page, french + "\n" + text, false, 0, french);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await eqRefs(h.page))[0].text, "Équation\u00a0i");
    assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("a header shown in the text names the equations as it is typed", { skip }, async () => {
  const header = "---\ntitle: T\n---\n\n";
  const h = await open({ text: header + NUMBERED, scores: 0, height: 1400, withFrontMatter: true });
  try {
    await reading(h.page);
    assert.equal((await eqRefs(h.page))[0].text, "Equation\u00a01");
    await h.page.evaluate(() => {
      const text = window.__mdm.view.state.doc.toString();
      const at = text.indexOf("title: T\n") + "title: T\n".length;
      window.__mdm.view.dispatch({ changes: { from: at, insert: "crossref:\n  eq-prefix: \"eq.\"\n" } });
    });
    await new Promise((r) => setTimeout(r, 150));
    const refs = await eqRefs(h.page);
    assert.equal(refs[0].text, "eq.\u00a01");
    assert.equal(refs[3].text, "Eq.\u00a04");
    assert.equal(await h.page.evaluate(() => window.__mdm.checkDecorations()), null);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("what a closer carries that is no equation's label is drawn as the page prints it", { skip }, async () => {
  // `{#fig-x}` after a closer, a label with a period after it, and a label
  // on the line under the closer: Pandoc reads none of them as an attribute
  // and Quarto numbers none of them, so the page prints them as written,
  // beside an equation with no number (measured on Quarto 1.9.37); and a
  // reference to the last prints "?@eq-next".
  const text = "$$\nk = l\n$$ {#fig-x}\n\n$$\nm = n\n$$ {#eq-dot}.\n\n$$\ni = j\n$$\n{#eq-next}\n\nSee @eq-next.\n";
  const h = await open({ text, scores: 0, height: 900 });
  try {
    await reading(h.page);
    const drawn = (await rows(h.page)).map((r) => r.text).filter((t) => t);
    assert.deepEqual(drawn, ["⟦math:k = l⟧{#fig-x}", "⟦math:m = n⟧{#eq-dot}.", "⟦math:i = j⟧", "{#eq-next}", "See ?@eq-next."]);
    assert.equal(await h.page.evaluate(() => document.querySelectorAll("#app .mdm-math--numbered").length), 0);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test("a citation that names a cross-reference is Quarto's, and Pandoc is not asked about it", { skip }, async () => {
  // Quarto takes the whole of `[@knuth1984; @eq-mass]` and drops the key of
  // the bibliography unprinted, keeping the comma that came before the
  // equation (", Equation 1", measured), so citeproc, which runs after it,
  // never counts it; neither is it in what the editor asks about.
  const text = "$$\nE = mc^2\n$$ {#eq-mass}\n\nSee [@knuth1984; @eq-mass], [@shannon1948; @fig-x] and @knuth1984.\n";
  const h = await open({ text, scores: 0, height: 900 });
  try {
    const asked = await citesAsked(h.page);
    assert.equal(asked.body, "[@knuth1984]{#mdmcite-0}\n");
    await reading(h.page);
    assert.deepEqual((await eqRefs(h.page)).map((r) => r.text), [", Equation\u00a01"]);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});
