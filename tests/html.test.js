// Tests for the HTML side of the Quarto extension, in a real browser: the
// filter emits the ABC source and _extensions/mdm/resources/mdm.js engraves it
// with abcjs when the page loads. Everything here happens at run time, so the
// pandoc output that render.test.js checks says nothing about it: whether a
// narrow score keeps its natural width and sits centred, whether the box under
// it is the height of the drawing, and whether a .play block grows its
// controls.
//
// And the look: the exported page is dressed as the MDM editor
// (resources/mdm-look.css), so what is checked here as well is the ground the
// document sits on, the code cards and their colours, the shape of the player
// bar, and that the look the editor exports with (the -M metadata the
// extension passes) reaches the page.
// Run with: node --test tests/html.test.js   (needs quarto and google-chrome)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const MDM = path.join(ROOT, "bin", "mdm");
const DIR = path.join(__dirname, "tmp", "html-browser");
const CHROME = "/usr/bin/google-chrome";

let puppeteer = null;
try {
  puppeteer = require("puppeteer-core");
} catch (e) {
  // Reported as a skip below.
}

const available =
  puppeteer && fs.existsSync(CHROME) && spawnSync("quarto", ["--version"]).status === 0;
const skip = available
  ? false
  : "needs puppeteer-core (npm install), " + CHROME + " and quarto";

// A narrow score (sized with %%staffwidth), a wide one, and a playable one:
// the three shapes mdm.js treats differently.
const DOC = `---
title: "HTML runtime"
format:
  html:
    embed-resources: true
filters:
  - mdm
---

Narrow:

\`\`\`abc
%%staffwidth 200pt
X:1
T:Narrow
M:none
L:1/1
K:C
[CG]
\`\`\`

Wide:

\`\`\`abc
X:2
T:Wide
M:4/4
L:1/8
K:Am
P:harmonic
ABcd ef^ga | a^gfe dcBA |
P:melodic
ABcd e^f^ga | a=g=fe dcBA |]
\`\`\`

A line of prose with \`inline code\` in it.

\`\`\`python
def f(x):
    return "a string" + str(3)  # a comment
\`\`\`

Playable:

\`\`\`{.abc .play}
X:3
T:Playable
M:4/4
L:1/8
Q:1/4=120
K:C
CDEF GABc |
\`\`\`
`;

// What the VS Code extension passes when it exports from a dark editor with a
// fill under the scores, staff lines in ink and scores lined up left
// (exportLook in vscode-mdm/extension.js). The colours are Monokai's, spelt
// without their `#`, which a -M value cannot carry.
const DARK_LOOK = [
  "-M", "mdm-look:dark",
  "-M", "mdm-score-fill:paper",
  "-M", "mdm-staff-lines:ink",
  "-M", "mdm-score-align:left",
  "-M", "mdm-syn-base:f8f8f2",
  "-M", "mdm-syn-bg:272822",
  "-M", "mdm-syn-keyword:f92672",
  "-M", "mdm-syn-string:e6db74",
  "-M", "mdm-syn-comment:88846f",
];

// Rendered once for the whole file: quarto takes a few seconds. Twice, in
// fact: the same document with the look of the command line (the editor's own
// fallbacks) and with the look of a dark editor.
let PAGE = null;
let DARK_PAGE = null;
let EXAMPLE_PAGE = null;

test.before(() => {
  if (!available) return;
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  fs.symlinkSync(path.join(ROOT, "_extensions"), path.join(DIR, "_extensions"));
  fs.writeFileSync(path.join(DIR, "doc.mdm"), DOC);
  const r = spawnSync(MDM, ["render", "doc.mdm", "--to", "html"], {
    cwd: DIR,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  PAGE = "file://" + path.join(DIR, "doc.html");

  fs.writeFileSync(path.join(DIR, "dark.mdm"), DOC);
  const d = spawnSync(
    MDM,
    ["render", "dark.mdm", "--to", "html"].concat(DARK_LOOK),
    { cwd: DIR, encoding: "utf8" }
  );
  assert.equal(d.status, 0, d.stderr);
  DARK_PAGE = "file://" + path.join(DIR, "dark.html");

  // And the real example, which is the document the export rule is stated in
  // terms of: the editor opens this same file, so the two surfaces can be put
  // side by side. Rendered in the roman, because that is the face the editor
  // opens in and the filter's own default is the sans (the first trap named in
  // CLAUDE.md); the toolbar's export passes the same -M.
  fs.copyFileSync(path.join(ROOT, "example.mdm"), path.join(DIR, "example.mdm"));
  const e = spawnSync(
    MDM,
    ["render", "example.mdm", "--to", "html",
      "-M", "mdm-text-font:roman", "-M", "mdm-front-matter:shown"],
    { cwd: DIR, encoding: "utf8" }
  );
  assert.equal(e.status, 0, e.stderr);
  EXAMPLE_PAGE = "file://" + path.join(DIR, "example.html");
});

const OPEN_BROWSERS = new Set();
test.after(async () => {
  for (const browser of OPEN_BROWSERS) {
    try {
      await browser.close();
    } catch (e) {
      // Already gone.
    }
  }
});

// Loads the rendered page and waits for mdm.js to have engraved every block.
async function open(url) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
    defaultViewport: { width: 900, height: 700 },
  });
  OPEN_BROWSERS.add(browser);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url || PAGE);
  await page.waitForFunction(
    () => document.querySelectorAll(".mdm-paper svg").length >= 3,
    { timeout: 20000 }
  );
  await new Promise((r) => setTimeout(r, 300));
  return {
    page,
    errors,
    close: async () => {
      OPEN_BROWSERS.delete(browser);
      await browser.close();
    },
  };
}

// One entry per music block: the boxes of the figure, the box mdm.js holds the
// score in, the paper and the engraved SVG. Every score gets that box (it is
// what carries the fill and the alignment); only one whose source fixed its
// width is pinned to a size of its own.
function blocks(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".mdm-block")).map((block) => {
      const paper = block.querySelector(".mdm-paper");
      const fit = block.querySelector(".mdm-fit");
      const svg = paper.querySelector("svg");
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width, height: r.height };
      };
      return {
        play: block.classList.contains("mdm-play"),
        fitted: !!fit,
        pinned: !!(fit && fit.style.maxWidth),
        maxWidth: fit ? fit.style.maxWidth : "",
        block: box(block),
        fit: box(fit),
        paper: box(paper),
        svg: box(svg),
        audioButtons: block.querySelectorAll(".mdm-audio button").length,
        audio: !!block.querySelector(".abcjs-inline-audio"),
        supportsAudio: !!(
          window.ABCJS &&
          window.ABCJS.synth &&
          window.ABCJS.synth.supportsAudio()
        ),
      };
    })
  );
}

test("every music block is engraved, and only the narrow one is pinned", { skip }, async () => {
  const h = await open();
  const out = await blocks(h.page);
  assert.equal(out.length, 3);
  for (const b of out) {
    assert.ok(b.svg.width > 0 && b.svg.height > 0, "a block was not engraved");
    assert.equal(b.fitted, true, "a score was left without its box");
  }
  // The narrow score keeps the width %%staffwidth asked for and stays well
  // inside the page. The measurement that decides this is made against the
  // width of the box: mdm.js engraves the first pass at that width, so a tune
  // with nothing to say about its own comes out filling it exactly.
  assert.equal(out[0].pinned, true, "the narrow score was not pinned");
  assert.match(out[0].maxWidth, /^\d+px$/);
  assert.ok(
    out[0].svg.width < out[0].block.width - 40,
    "the narrow score was stretched: " + out[0].svg.width
  );
  // The wide one and the playable one take the text width, at no fixed size.
  for (const b of [out[1], out[2]]) {
    assert.equal(b.pinned, false, "a wide score was pinned to a width");
    assert.ok(
      b.svg.width > b.block.width - 40,
      "a wide score did not fill the line: " + b.svg.width
    );
  }
  await h.close();
});

test("a narrow score is centred, like display maths", { skip }, async () => {
  const h = await open();
  const out = await blocks(h.page);
  const left = out[0].svg.left - out[0].block.left;
  const right = out[0].block.right - out[0].svg.right;
  assert.ok(
    Math.abs(left - right) < 2,
    "the narrow score is not centred: " + left + " vs " + right
  );
  await h.close();
});

test("the box under a score is the height of the drawing", { skip }, async () => {
  // abcjs keeps the aspect ratio of a responsive render in a percentage
  // padding-bottom, which resolves against the width of the containing block.
  // With the max-width on the paper itself that percentage was still computed
  // from the page width, leaving a tall gap under the score; the wrapper is
  // what fixed it. The paper also carries the natural height inline, which is
  // wrong the moment the drawing is scaled, hence height:0 in the stylesheet.
  const h = await open();
  const out = await blocks(h.page);
  for (const b of out) {
    assert.ok(
      Math.abs(b.paper.height - b.svg.height) < 4,
      (b.pinned ? "narrow" : "wide") +
        ": paper " +
        Math.round(b.paper.height) +
        " under a drawing of " +
        Math.round(b.svg.height)
    );
  }
  await h.close();
});

test("the .play block, and only it, grows playback controls", { skip }, async () => {
  const h = await open();
  const out = await blocks(h.page);
  assert.deepEqual(
    out.map((b) => b.play),
    [false, false, true]
  );
  assert.equal(out[0].audioButtons, 0);
  assert.equal(out[1].audioButtons, 0);
  if (!out[2].supportsAudio) {
    // A browser with no Web Audio: the score still renders, which is what the
    // filter promises, and there is nothing to grow the controls from.
    assert.equal(out[2].audio, false);
    await h.close();
    return;
  }
  assert.equal(out[2].audio, true, "no abcjs audio controls in the .play block");
  assert.ok(
    out[2].audioButtons >= 3,
    "expected the three transport buttons, found " + out[2].audioButtons
  );
  await h.close();
});

test("the page loads with no script errors", { skip }, async () => {
  const h = await open();
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The look of the editor ----------

// A computed colour, whatever notation the browser hands it back in: a plain
// colour comes back as rgb(), one that went through color-mix() as
// color(srgb ...) with the channels in 0..1.
function channels(value) {
  const rgb = /^rgba?\(([^)]+)\)/.exec(value);
  if (rgb) return rgb[1].split(",").slice(0, 3).map(Number);
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(value);
  if (srgb) return [+srgb[1] * 255, +srgb[2] * 255, +srgb[3] * 255];
  return null;
}

function luma(value) {
  const c = channels(value);
  assert.ok(c, "not a colour: " + value);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// Everything the look decides, read off the rendered page.
function looks(page) {
  return page.evaluate(() => {
    const css = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    const bar = document.querySelector(".mdm-block.mdm-play .mdm-audio");
    return {
      page: css("body", "backgroundColor"),
      ink: css("body", "color"),
      fontSize: css("body", "fontSize"),
      lineHeight: css("body", "lineHeight"),
      column: document.querySelector("main.content").getBoundingClientRect().width,
      card: css("div.sourceCode", "backgroundColor"),
      codeSize: css("div.sourceCode", "fontSize"),
      codeInk: css("div.sourceCode", "color"),
      keyword: css("code span.kw", "color"),
      keywordWeight: css("code span.kw", "fontWeight"),
      string: css("code span.st", "color"),
      comment: css("code span.co", "color"),
      lineSpan: css("code.sourceCode > span", "color"),
      inlineCode: css("p code", "backgroundColor"),
      staff: css(".mdm-paper svg .abcjs-staff path", "fill"),
      scoreFill: css(".mdm-fit", "backgroundColor"),
      scoreMargin: css(".mdm-fit", "marginLeft"),
      barButtons: bar
        ? Array.from(bar.querySelectorAll(".abcjs-btn")).map((b) =>
            b.getAttribute("aria-label")
          )
        : [],
      trackLabel: (() => {
        const t = document.querySelector(".abcjs-midi-progress-background");
        return t ? t.getAttribute("aria-label") : null;
      })(),
      barVolume: !!document.querySelector(".mdm-audio .mdm-audio-vol input"),
      barWidget: css(".mdm-audio .abcjs-inline-audio", "borderRadius"),
      barHeight: css(".mdm-audio .abcjs-inline-audio", "height"),
      barGround: css(".mdm-audio .abcjs-inline-audio", "backgroundColor"),
      button: css(".mdm-audio .abcjs-btn", "width"),
      buttonRadius: css(".mdm-audio .abcjs-btn", "borderRadius"),
      track: css(".abcjs-midi-progress-background", "height"),
      head: css(".abcjs-midi-progress-indicator", "width"),
      clock: css(".abcjs-midi-clock", "fontSize"),
      progress: (() => {
        const t = document.querySelector(".abcjs-midi-progress-background");
        return t ? t.style.getPropertyValue("--mdm-progress") : null;
      })(),
      // The brass ladder the chrome is drawn on, mixed by the browser from
      // the properties in force, so a value that stops taking them is what
      // fails rather than a colour spelt out here.
      headFill: css(".abcjs-midi-progress-indicator", "backgroundColor"),
      accentInk: getComputedStyle(document.documentElement)
        .getPropertyValue("--mdm-play-accent-ink")
        .trim(),
      brass22: bar
        ? (() => {
            const probe = document.createElement("span");
            probe.style.backgroundColor =
              "color-mix(in srgb, var(--mdm-play-accent) 22%, transparent)";
            bar.appendChild(probe);
            const v = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return v;
          })()
        : null,
    };
  });
}

test("the page is the editor's: its ground, its ink, its measure", { skip }, async () => {
  const h = await open();
  const l = await looks(h.page);
  assert.equal(l.fontSize, "16px");
  assert.equal(l.lineHeight, "27.2px", "the editor's 1.7 of a line");
  assert.ok(l.column <= 820, "the text column is wider than the editor's 820");
  // The two grounds of the editor, on the light side, which is the side a
  // render with no look at all comes out on: the code keeps the slate it has
  // always had and the page takes the shallower wash above it, so the card is
  // the darker of the two. The step is made of the ink, and on the dark side
  // the ink changes ends and the step with it; that arrangement is read in
  // "the look the editor exports with reaches the page" below.
  assert.ok(
    luma(l.card) < luma(l.page),
    "the code card is not darker than the page: " + l.card + " on " + l.page
  );
  await h.close();
});

test("code is on the editor's card, in the palette's colours", { skip }, async () => {
  const h = await open();
  const l = await looks(h.page);
  assert.equal(l.codeSize, "14.08px", "0.88 of the editor's 16px");
  // The fallback palette, which is what the editor shows when it cannot read a
  // theme, and so what a render from the command line gets:
  // stackoverflow-light.
  assert.equal(l.keyword, "rgb(1, 86, 146)");
  assert.equal(l.string, "rgb(84, 121, 13)");
  assert.equal(l.comment, "rgb(101, 110, 119)");
  // A token carries colour and nothing else, as in the editor; Quarto's own
  // stylesheet bolds its keywords and paints the line wrappers navy.
  assert.equal(l.keywordWeight, "400");
  assert.equal(l.lineSpan, "rgb(47, 51, 55)", "the base colour of the palette");
  // Inline code takes the card material too, not Quarto's own chip.
  assert.ok(
    Math.abs(luma(l.inlineCode) - luma(l.card)) < 1,
    "inline code is not on the card ground: " + l.inlineCode
  );
  await h.close();
});

test("the player bar is the editor's", { skip }, async () => {
  const h = await open();
  const out = await blocks(h.page);
  if (!out[2].supportsAudio) {
    await h.close();
    return; // no Web Audio here: there is no bar to look at
  }
  const l = await looks(h.page);
  // What abcjs ships is a 34px slab of square buttons on #424242, a 10px
  // trough and a 20px lozenge. What the editor draws, and this with it: a
  // 30px pill on the card ground, round 24px buttons, a hairline track with a
  // round head, and the clock a size smaller.
  assert.deepEqual(l.barButtons, ["Play", "Stop", "Repeat"]);
  assert.equal(l.trackLabel, "Position", "the track was never given its role");
  assert.equal(l.barVolume, true, "the volume control is missing");
  assert.equal(l.barHeight, "30px");
  assert.equal(l.barWidget, "15px");
  assert.equal(l.button, "24px");
  assert.equal(l.buttonRadius, "50%");
  assert.equal(l.track, "4px");
  assert.equal(l.head, "11px");
  assert.equal(l.clock, "11px");
  assert.equal(l.progress, "0.00%", "the track's fill was never written");
  assert.ok(
    Math.abs(luma(l.barGround) - luma(l.card)) < 1,
    "the bar is not on the card ground: " + l.barGround
  );
  // And the brass of the editor's own bar: the state disc is the accent at
  // 22%, the played half of the progress and its head are the deep form of
  // the same brass, and so is the volume. A page that fell back to the ink of
  // the document would miss all four.
  assert.equal(l.accentInk, "#8a5f00", "the deep brass never reached the page");
  assert.equal(l.headFill, "rgb(138, 95, 0)", "the progress head is not brass");
  // And the held state as it is really painted: the class abcjs writes when
  // the repeat is on, put on by hand, so what is measured is the rule that
  // has to win the !important fight with abcjs's own `background: none`. Read
  // after the disc has faded in: the buttons carry a transition, and a
  // computed value taken on the same turn as the class is still the old one.
  await h.page.evaluate(() => {
    document
      .querySelector(".mdm-block.mdm-play .mdm-audio .abcjs-midi-loop")
      .classList.add("abcjs-pushed");
  });
  await new Promise((r) => setTimeout(r, 300));
  const pushed = await h.page.evaluate(() => {
    const loop = document.querySelector(
      ".mdm-block.mdm-play .mdm-audio .abcjs-midi-loop"
    );
    return {
      disc: getComputedStyle(loop).backgroundColor,
      ink: getComputedStyle(loop.querySelector("g")).fill,
    };
  });
  assert.equal(
    pushed.disc,
    l.brass22,
    "a held button does not sit on the brass at 22%: " + pushed.disc
  );
  assert.equal(pushed.ink, "rgb(138, 95, 0)", "the held glyph is not brass");
  await h.close();
});

test("the look the editor exports with reaches the page", { skip }, async () => {
  const h = await open(DARK_PAGE);
  const l = await looks(h.page);
  // The dark side: the editor's ink, and the code a step LIGHTER than the
  // prose, where on the light side it is a step darker. The step is made of
  // the ink and the ink changes ends: the page rises to the tint here, and the
  // card is that page carried 4% towards the ink, which is the mix the editor
  // paints its own dark card and its outline panel with (style.css,
  // `#app.mdm--dark`). The card used to be the theme's own background, and
  // under a theme that draws its editor near black (Dark 2026 is #121314)
  // that is a hole at the bottom of the page; a block of code is not a hole.
  assert.equal(l.ink, "rgb(212, 212, 212)");
  assert.ok(
    luma(l.card) > luma(l.page),
    "the code card is not lighter than the page: " + l.card + " on " + l.page
  );
  // The palette that travelled, Monokai's.
  assert.equal(l.keyword, "rgb(249, 38, 114)");
  assert.equal(l.string, "rgb(230, 219, 116)");
  assert.equal(l.codeInk, "rgb(248, 248, 242)");
  // The fill under the scores (paper, on its dark value), staff lines back in
  // ink rather than gray, and scores lined up with the text.
  assert.equal(l.scoreFill, "rgb(42, 39, 35)");
  assert.equal(l.staff, "rgb(212, 212, 212)", "the staff lines are not in ink");
  assert.equal(l.scoreMargin, "0px", "the scores are not lined up left");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The export is the editor, measured ----------

// The rule the whole format rests on (CLAUDE.md): what the reader sees in the
// editor is what the export has to show, and the test of it is a line break.
// Both surfaces are opened on the same example.mdm at the same width and asked
// where the first paragraph runs out of room.
//
// Two faults this caught, both of which had been on the page for as long as
// there was a page:
//
//   - The measure. The column is a grid item of Quarto's page-columns layout,
//     and the grid gave the body track 802px where the editor holds its text
//     to 820. `max-width: 820px` therefore never bound, the eighteen pixels
//     were a word, and the paragraph broke after "emphasis" on the page and
//     after "LaTeX" in the editor.
//   - The size of a score. mdm.js asked abcjs for a staff the width of the
//     column so a tune would fill it; the editor asks for nothing and abcjs
//     draws 740. A responsive SVG scales its whole drawing, so every note,
//     staff line and word came out 11% larger on the page.
//
// The width is 1200 because that is where the two are flat: both hold the
// column at its full 820 and neither is shrinking to the window.
const SIDE_BY_SIDE_WIDTH = 1200;

// The first visual line of an element, as a string: walk its text and stop at
// the character that starts a new row. The one measurement that says a line
// broke in the same place without knowing anything about fonts or widths.
const FIRST_VISUAL_LINE = function (el) {
  let top = null;
  let first = "";
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  outer: while ((n = walk.nextNode())) {
    for (let i = 0; i < n.data.length; i++) {
      const rg = document.createRange();
      rg.setStart(n, i);
      rg.setEnd(n, i + 1);
      const t = Math.round(rg.getBoundingClientRect().top);
      if (top === null) top = t;
      if (t > top + 2) break outer;
      first += n.data[i];
    }
  }
  return first.trim();
}.toString();

// What both surfaces are asked for, in the same words: the column, where the
// first paragraph breaks, and the score as it is actually drawn. On screen and
// not in user units, since an SVG scaled to its container reports the same
// getBBox whatever size it is painted at, which is how the 11% went unseen.
const MEASURE = function (columnEl, paraEl, scoreEl, firstLine) {
  const svg = scoreEl.querySelector("svg");
  const staff = svg.querySelector(".abcjs-staff");
  const title = Array.from(svg.querySelectorAll(".abcjs-title")).find((e) =>
    e.getAttribute("font-size")
  );
  return {
    column: Math.round(columnEl.getBoundingClientRect().width),
    first: eval("(" + firstLine + ")")(paraEl),
    svg: Math.round(svg.getBoundingClientRect().width),
    staff: +staff.getBoundingClientRect().height.toFixed(2),
    titleSize: title ? title.getAttribute("font-size") : null,
    titleInk: Math.round(title.getBoundingClientRect().width),
    adjust: getComputedStyle(svg).fontSizeAdjust,
  };
};

let SIDES = null;
async function sides() {
  if (SIDES) return SIDES;
  const { open: openEditor } = require("./webview/helpers.js");
  const m = MEASURE.toString();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
    defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 1200 },
  });
  OPEN_BROWSERS.add(browser);
  const page = await browser.newPage();
  await page.goto(EXAMPLE_PAGE, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const paper = await page.waitForSelector(".mdm-paper svg");
  assert.ok(paper, "the page engraved no score to measure");
  const exported = await page.evaluate((f, fl) => {
    const para = Array.from(document.querySelectorAll("p")).find((e) =>
      e.textContent.startsWith("This document is ordinary Markdown")
    );
    return eval("(" + f + ")")(
      document.querySelector("main.content"),
      para,
      document.querySelector(".mdm-paper"),
      fl
    );
  }, m, FIRST_VISUAL_LINE);
  await browser.close();
  OPEN_BROWSERS.delete(browser);

  const h = await openEditor({ seed: { settings: { textFont: "roman" } }, scores: 1 });
  await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1200 });
  await h.page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  const editor = await h.page.evaluate((f, fl) => {
    const line = Array.from(document.querySelectorAll("#app .cm-line")).find((e) =>
      e.textContent.startsWith("This document is ordinary Markdown")
    );
    return eval("(" + f + ")")(
      document.querySelector("#app .cm-content"),
      line,
      document.querySelector("#app code.language-abc"),
      fl
    );
  }, m, FIRST_VISUAL_LINE);
  await h.close();

  SIDES = { exported: exported, editor: editor };
  return SIDES;
}

test("the page breaks the first paragraph where the editor breaks it", { skip }, async () => {
  const s = await sides();
  assert.equal(
    s.exported.column,
    s.editor.column,
    "the page holds its text to " + s.exported.column + "px and the editor to " + s.editor.column
  );
  assert.ok(s.editor.first.length > 40, "the paragraph did not wrap; nothing was tested");
  assert.equal(
    s.exported.first,
    s.editor.first,
    "the first paragraph breaks in a different place:\n  editor: ..." +
      s.editor.first.slice(-40) +
      "\n  page:   ..." +
      s.exported.first.slice(-40)
  );
});
