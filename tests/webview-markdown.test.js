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
    name: "a citation and a cross-reference are drawn as written, in the link colour, with what they are in the tooltip (PX04)",
    text: "As shown by [@knuth1984, p. 33] and in @fig-brass, mail me@example.org.\n",
    rows: [
      [1, "", "As shown by [@knuth1984, p. 33] and in @fig-brass, mail me@example.org."],
      [2, "mdm-blank", ""],
    ],
    dom: (page) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("#app .mdm-cite"))
          .filter((e) => !e.parentElement.closest(".mdm-cite"))
          .map((e) => e.textContent + "|" + e.title)
      ),
    domExpected: ["[@knuth1984, p. 33]|Citation [@knuth1984, p. 33]", "@fig-brass|Reference @fig-brass"],
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
                link.title +
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
          return link ? td.textContent + " → " + link.title : td.textContent;
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
    name: "a closer with a label after it closes the block, the label drawn under the equation, and the next block is its own (G052)",
    text: "$$\nE = mc^2\n$$ {#eq-mass}\n$$\nF = ma\n$$\n",
    // The label is an attribute the page prints none of, so nothing is
    // drawn under the equation (it was drawn as text until the attributes
    // came, P6).
    rows: [
      [1, "mdm-math mdm-math--block", "⟦math:E = mc^2⟧"],
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
