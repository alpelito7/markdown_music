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
let NARROW_TITLE_PAGE = null;
let WIDE_STAFF_PAGE = null;
let EXAMPLE_PAGE = null;
let EXAMPLE_SANS_PAGE = null;
let EXAMPLE_FILL_PAGE = null;

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

  // A score that names a width narrower than its own title, which is the one
  // shape a drawing can be cropped in: abcjs sizes the box from the engraved
  // music alone, so the title hangs outside it. The editor's twin of this
  // fixture is NARROW_TITLE in webview-look.test.js.
  fs.writeFileSync(
    path.join(DIR, "title.mdm"),
    [
      "---",
      'title: "Titles"',
      "format:",
      "  html:",
      "    embed-resources: true",
      "filters:",
      "  - mdm",
      "---",
      "",
      "A score whose title is wider than its staff:",
      "",
      "```abc",
      "%%staffwidth 200pt",
      "X:1",
      "T:E(3,8): the tresillo, 3+3+2",
      "M:4/4",
      "L:1/8",
      "K:C",
      "|: c3 e3 g2 :|",
      "```",
      "",
    ].join("\n")
  );
  const t = spawnSync(MDM, ["render", "title.mdm", "--to", "html"], {
    cwd: DIR,
    encoding: "utf8",
  });
  assert.equal(t.status, 0, t.stderr);
  NARROW_TITLE_PAGE = "file://" + path.join(DIR, "title.html");

  // A score that asks for more width than the measure has. On screen its card
  // scrolls the rest, which is the narrow editor's decision; on paper there
  // is nowhere to scroll to, and this is the document that says whether the
  // printed page fits the drawing or cuts it. 900pt is 1200px against the
  // editor's 820px column, so nothing about the window can make it fit.
  fs.writeFileSync(
    path.join(DIR, "widestaff.mdm"),
    [
      "---",
      'title: "Wider than the measure"',
      "format:",
      "  html:",
      "    embed-resources: true",
      "filters:",
      "  - mdm",
      "---",
      "",
      "A score drawn wider than any page:",
      "",
      "```abc",
      "%%staffwidth 900pt",
      "X:1",
      "T:Wider than the measure",
      "M:4/4",
      "L:1/8",
      "K:C",
      "CDEF GABc | cBAG FEDC | CDEF GABc | cBAG FEDC |]",
      "```",
      "",
    ].join("\n")
  );
  // With the header hidden, which is what the editor exports with by default,
  // so this page is also the one that says whether a document keeps its own
  // name when its title block goes.
  const w = spawnSync(
    MDM,
    ["render", "widestaff.mdm", "--to", "html", "-M", "mdm-front-matter:hidden"],
    { cwd: DIR, encoding: "utf8" }
  );
  assert.equal(w.status, 0, w.stderr);
  WIDE_STAFF_PAGE = "file://" + path.join(DIR, "widestaff.html");

  // And the real example, which is the document the export rule is stated in
  // terms of: the editor opens this same file, so the two surfaces can be put
  // side by side. Rendered in the roman, because that is the face the editor
  // opens in and the filter's own default is the sans (the first trap named in
  // CLAUDE.md); the toolbar's export passes the same -M. Justified for the
  // same reason: the editor opens justified and the filter falls back to the
  // ragged right.
  fs.copyFileSync(path.join(ROOT, "example.mdm"), path.join(DIR, "example.mdm"));
  const e = spawnSync(
    MDM,
    ["render", "example.mdm", "--to", "html",
      "-M", "mdm-text-font:roman", "-M", "mdm-text-align:justify", "-M", "mdm-front-matter:shown"],
    { cwd: DIR, encoding: "utf8" }
  );
  assert.equal(e.status, 0, e.stderr);
  EXAMPLE_PAGE = "file://" + path.join(DIR, "example.html");

  // And the same document in the other face. The face is the setting the
  // reader changes most often and it is the one that brings a second
  // stylesheet with it, so anything the export is asked to hold has to be
  // measured on both: this page is what the roman is compared against.
  fs.copyFileSync(path.join(ROOT, "example.mdm"), path.join(DIR, "sans-example.mdm"));
  const s = spawnSync(
    MDM,
    ["render", "sans-example.mdm", "--to", "html",
      "-M", "mdm-text-font:sans", "-M", "mdm-text-align:justify", "-M", "mdm-front-matter:shown"],
    { cwd: DIR, encoding: "utf8" }
  );
  assert.equal(s.status, 0, s.stderr);
  EXAMPLE_SANS_PAGE = "file://" + path.join(DIR, "sans-example.html");

  // And with a fill under the scores, which is where the drawing's size came
  // apart from the editor's: the page took the fill's padding out of the
  // drawing and the editor only did so on a narrow pane.
  fs.copyFileSync(path.join(ROOT, "example.mdm"), path.join(DIR, "fill-example.mdm"));
  const f = spawnSync(
    MDM,
    ["render", "fill-example.mdm", "--to", "html",
      "-M", "mdm-text-font:roman", "-M", "mdm-text-align:justify", "-M", "mdm-front-matter:shown", "-M", "mdm-score-fill:paper"],
    { cwd: DIR, encoding: "utf8" }
  );
  assert.equal(f.status, 0, f.stderr);
  EXAMPLE_FILL_PAGE = "file://" + path.join(DIR, "fill-example.html");
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
// what carries the alignment, inside the card that carries the fill); only
// one whose source fixed its width is pinned to a size of its own.
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

test("every music block is engraved, and none is stretched to the column", { skip }, async () => {
  const h = await open();
  const out = await blocks(h.page);
  assert.equal(out.length, 3);
  for (const b of out) {
    assert.ok(b.svg.width > 0 && b.svg.height > 0, "a block was not engraved");
    assert.equal(b.fitted, true, "a score was left without its box");
  }
  // Every score is held at the width it was engraved at, and the two that say
  // nothing about their own are held at abcjs's, which is what the editor
  // draws them at. The wide ones used to fill the column instead: mdm.js
  // engraved its measuring pass at the width of the box, so a tune with
  // nothing to say came out exactly as wide as the page. That reads well and
  // is not what the editor does, and a responsive SVG scales its whole
  // drawing, so the staff, the notes and every word on them came out 11%
  // larger here than there. The export rule (CLAUDE.md) settles which of the
  // two moves.
  for (const b of out) {
    assert.equal(b.pinned, true, "a score was left to fill the column");
    assert.match(b.maxWidth, /^\d+px$/);
    assert.ok(
      b.svg.width < b.block.width - 40,
      "a score was stretched to the column: " + b.svg.width + " of " + b.block.width
    );
  }
  // %%staffwidth still decides, and decides downwards: the narrow one comes
  // out narrower than a tune that names no width at all. (The two that name
  // none are not engraved to the same width as each other, and should not be:
  // abcjs leaves a last line at its natural length, so what they come out at
  // is what their own music takes.)
  assert.ok(
    out[0].svg.width < out[1].svg.width,
    "%%staffwidth stopped deciding the width: " + out[0].svg.width
  );
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
      // The text abcjs draws inside a score, which is not styled by any sheet
      // of ours: it is handed to the engine as a size in points, and left to
      // itself the engine uses defaults of its own that come out a title at
      // 27px beside a 16px paragraph.
      scoreTitle: css(".mdm-fit svg text.abcjs-title", "fontSize"),
      // Every distinct size any score text is drawn at, so a reader of a
      // failure can see what the engine actually did rather than one probe
      // coming back null because the fixture spells a role differently.
      scoreText: [
        ...new Set(
          [...document.querySelectorAll(".mdm-fit svg text")].map(
            (t) => (t.getAttribute("class") || "?").split(" ")[0] + " " + getComputedStyle(t).fontSize
          )
        ),
      ].sort(),
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
      scoreFill: css(".mdm-card", "backgroundColor"),
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
  // A render from the command line names no look, and its prose keeps the
  // ragged right a page has always had: justified is the editor's default
  // and travels only when the editor sends it (the justified page is
  // measured against the editor further down).
  assert.equal(
    await h.page.$eval("main.content p", (p) => getComputedStyle(p).textAlign),
    "left",
    "a page with no look came out justified"
  );
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

test("the score's own text is drawn at abcjs's own sizes", { skip }, async () => {
  // The page hands abcjs no `format`, as the editor hands it none (renderScore
  // in vscode-mdm/media/main.js), so every word on a staff keeps the size
  // abcjs gives it. They were held to a ladder over the prose's x-height for
  // a while instead, and that was taken back on 2026-09-10.
  const h = await open();
  const l = await looks(h.page);
  // A 20 pt title, which abcjs draws at 4/3.
  assert.equal(l.scoreTitle, "27px", "the title is not at abcjs's own size");
  // The rest as a set, since which roles the fixture happens to use is its
  // own business: every string at one of the sizes abcjs gives its roles (a
  // title 27px, a subtitle or free text 21, a part label or tempo 20, a
  // composer or bar number 19, a lyric or volta 17, a chord 16, a triplet 15).
  const sizes = [...new Set(l.scoreText.map((t) => t.split(" ").pop()))].sort();
  assert.deepEqual(
    sizes.filter((px) => !["15px", "16px", "17px", "19px", "20px", "21px", "27px"].includes(px)),
    [],
    "score text at a size abcjs never draws: " + JSON.stringify(l.scoreText)
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

// Every paragraph as the words its lines end on, keyed by how it opens. The
// text of a formula is left out on both surfaces, since a sub- or superscript
// sits off the row it belongs to and would read as a line break, and a row
// counts as new only half a line below the one before.
const LINE_ENDS = function (els) {
  const out = {};
  Array.from(els).forEach((el) => {
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
        if (rect && top !== null && rect.top > top + half) {
          ends.push((text.match(/(\S+)\s*$/) || ["", ""])[1]);
        }
        if (rect) top = rect.top;
        text += n.data[i];
      }
    }
    out[text.slice(0, 30)] = { ends: ends, text: text.replace(/\s+/g, " ").trim() };
  });
  return out;
}.toString();

// Every paragraph as the gaps its rows leave before the right edge of its box,
// keyed as LINE_ENDS keys them, the last row left out, since justification
// leaves a last row alone. A formula is one piece of ink here and not its
// letters, so a row ending on one ends where the formula does, and a
// sub- or superscript cannot pass for a row of its own; a row counts as new
// when its middle is half a line below the middle of the one before.
const ROW_GAPS = function (els) {
  const out = {};
  Array.from(els).forEach((el) => {
    const cs = getComputedStyle(el);
    const half = (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2) / 2;
    const right = el.getBoundingClientRect().right - parseFloat(cs.paddingRight);
    const rows = [];
    let text = "";
    const ink = (rect, s) => {
      if (!rect || !rect.width) return;
      const mid = rect.top + rect.height / 2;
      let row = rows[rows.length - 1];
      if (!row || mid > row.mid + half) {
        row = { mid: mid, right: -Infinity };
        rows.push(row);
      }
      if (/\S/.test(s)) row.right = Math.max(row.right, rect.right);
    };
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) =>
        n.nodeType === 1 && n.parentElement && n.parentElement.closest(".katex")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    let n;
    while ((n = walk.nextNode())) {
      if (n.nodeType === 1) {
        if (n.classList.contains("katex")) ink(n.getBoundingClientRect(), "x");
        continue;
      }
      if (n.parentElement.closest(".katex")) continue;
      text += n.data;
      for (let i = 0; i < n.data.length; i++) {
        const rg = document.createRange();
        rg.setStart(n, i);
        rg.setEnd(n, i + 1);
        ink(rg.getClientRects()[0], n.data[i]);
      }
    }
    if (rows.length < 2 || el.querySelector(".katex-display")) return;
    out[text.slice(0, 30)] = rows.slice(0, -1).map((row) => +(right - row.right).toFixed(1));
  });
  return out;
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
  const exported = await page.evaluate((f, fl, le, rg) => {
    const para = Array.from(document.querySelectorAll("p")).find((e) =>
      e.textContent.startsWith("This document is ordinary Markdown")
    );
    const out = eval("(" + f + ")")(
      document.querySelector("main.content"),
      para,
      document.querySelector(".mdm-paper"),
      fl
    );
    out.ends = eval("(" + le + ")")(document.querySelectorAll("main.content p"));
    out.rows = eval("(" + rg + ")")(document.querySelectorAll("main.content p"));
    return out;
  }, m, FIRST_VISUAL_LINE, LINE_ENDS, ROW_GAPS);
  await browser.close();
  OPEN_BROWSERS.delete(browser);

  const h = await openEditor({ seed: { settings: { textFont: "roman" } }, scores: 1 });
  await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1200 });
  await h.page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  const editor = await h.page.evaluate((f, fl, le, rg) => {
    const line = Array.from(document.querySelectorAll("#app .cm-line")).find((e) =>
      e.textContent.startsWith("This document is ordinary Markdown")
    );
    const out = eval("(" + f + ")")(
      document.querySelector("#app .cm-content"),
      line,
      document.querySelector("#app code.language-abc"),
      fl
    );
    out.ends = eval("(" + le + ")")(document.querySelectorAll("#app .cm-line"));
    out.rows = eval("(" + rg + ")")(document.querySelectorAll("#app .cm-line"));
    return out;
  }, m, FIRST_VISUAL_LINE, LINE_ENDS, ROW_GAPS);
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

// And every paragraph after it, line by line, where the first line of the
// first one could not look: at a word ending within a space of the margin.
// CodeMirror wraps with `break-spaces`, in which the space after the last word
// of a line takes room and has to fit, while a page lets it hang past the
// edge; "The boundary" of the string paragraph ended 1.05 px inside the 820 px
// column, stayed on the page's first line and went down to the editor's
// second (or was divided there, with hyphenation on). Compared only where the
// two surfaces show the same characters, formulas aside: a paragraph holding
// the caret shows its marks in the editor and not on the page.
// And the other half of how a line meets the edge: which rows are set out to
// it. The editor justifies its prose by default and the toolbar's export says
// so, so every row the editor carries to the right edge the page carries
// there too, and a row either leaves short (the last before a break the
// source forces) is short on both. Compared on the paragraphs whose text is
// the same on both surfaces, as above, and with no display formula inside,
// whose rows the page and the editor draw as different boxes.
test("the page justifies the rows the editor justifies", { skip }, async () => {
  const s = await sides();
  const same = Object.keys(s.exported.rows).filter(
    (k) => s.editor.rows[k] && s.exported.ends[k] && s.editor.ends[k] &&
      s.editor.ends[k].text === s.exported.ends[k].text
  );
  let reached = 0;
  for (const k of same) {
    const flush = (gaps) => gaps.map((g) => Math.abs(g) < 1.5);
    assert.deepEqual(
      flush(s.exported.rows[k]),
      flush(s.editor.rows[k]),
      "the rows of \"" + k + "...\" reach the edge differently: editor " +
        JSON.stringify(s.editor.rows[k]) + ", page " + JSON.stringify(s.exported.rows[k])
    );
    reached += flush(s.editor.rows[k]).filter(Boolean).length;
  }
  assert.ok(reached >= 8, "only " + reached + " rows reach the edge on " + same.length + " paragraphs; nothing was justified");
});

test("every paragraph of the page ends its lines where the editor ends them", { skip }, async () => {
  const s = await sides();
  const same = Object.keys(s.exported.ends).filter(
    (k) =>
      s.exported.ends[k].ends.length &&
      s.editor.ends[k] &&
      s.editor.ends[k].text === s.exported.ends[k].text
  );
  assert.ok(same.length >= 3, "too few paragraphs wrapped alike on both surfaces to test: " + JSON.stringify(same));
  for (const k of same) {
    assert.deepEqual(
      s.editor.ends[k].ends,
      s.exported.ends[k].ends,
      "the lines of \"" + k + "...\" end on different words"
    );
  }
});

// One surface at one window width: the page in a browser of its own, the
// editor through the harness.
// `then` for a test about what the page does to a window that MOVES after it
// has loaded, as against the width it opened at: the page is read at that
// second width, once the reflow of the scores has landed (scheduleReflow in
// resources/mdm.js waits for the window to settle).
// `bars` for a test about what a scrollbar takes: puppeteer hides the bars of
// every headless browser it launches (--hide-scrollbars), and hidden, a bar
// takes no room, so a box measured the same whether it scrolled or not.
// `media` for the tests about paper: the page is laid out as a screen, as it
// always is, and only the reading is taken under print media, which is what a
// browser does when it prints.
async function pageAt(url, width, read, then, bars, media) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
    ignoreDefaultArgs: bars ? ["--hide-scrollbars"] : [],
    defaultViewport: { width: width, height: 1200 },
  });
  OPEN_BROWSERS.add(browser);
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector(".mdm-paper svg");
  if (then) {
    await page.setViewport({ width: then, height: 1200 });
    await new Promise((r) => setTimeout(r, 500));
  }
  if (media) await page.emulateMediaType(media);
  const out = await page.evaluate(read);
  await browser.close();
  OPEN_BROWSERS.delete(browser);
  return out;
}
// `height` for a test that has to see more than the first block: CodeMirror
// renders the lines in view and a little beyond, and a narrow pane makes the
// document taller, so the scores further down are not in the DOM to measure.
async function editorAt(settings, width, read, height) {
  const { open: openEditor } = require("./webview/helpers.js");
  const h = await openEditor({ seed: { settings: settings }, scores: 0, height: height || 1200 });
  await h.page.waitForFunction(() => document.querySelector("#app .mdm-score code.language-abc svg[data-mdm-fit]"));
  await h.page.setViewport({ width: width, height: height || 1200 });
  // Two frames for the layout, and then the wait the reflow of the scores
  // asks for: it lands when the pane settles and not on the frame the width
  // changes (scheduleReflow in media/main.js, 120 ms), so a measurement taken
  // two frames after a resize is of the engraving that was there before.
  await h.page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  await new Promise((r) => setTimeout(r, 400));
  const out = await h.page.evaluate(read);
  await h.close();
  return out;
}

// Below 920 px the two columns narrow together, which the flat 820 above
// cannot show. At a 600 px window two things kept them apart: the editor's
// column would not go under its widest equation (579 px, a flex item's
// min-content), and the page's equation stood out of its column and scrolled
// the whole page. On both a wide equation now scrolls inside its own box, and
// the page crops none of what KaTeX draws past that box.
test("a narrow window narrows both columns alike, and a wide equation scrolls in its own box", { skip }, async () => {
  const width = 600;
  const page = await pageAt(EXAMPLE_PAGE, width, () => {
    const eq = document.querySelector("main.content .katex-display");
    return {
      column: Math.round(document.querySelector("main.content").getBoundingClientRect().width),
      scrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
      eqBox: eq.clientWidth,
      eqContent: eq.scrollWidth,
      cropped: eq.scrollHeight > eq.clientHeight + 1,
    };
  });
  const editor = await editorAt({ textFont: "roman" }, width, () =>
    Math.round(document.querySelector("#app .cm-content").getBoundingClientRect().width)
  );
  assert.equal(page.column, editor, "the page holds its text to " + page.column + " px and the editor to " + editor);
  assert.equal(page.scrolls, false, "the page scrolls sideways");
  assert.ok(page.eqContent > page.eqBox + 1, "the equation fits the column, so nothing was tested");
  assert.equal(page.cropped, false, "the page crops the equation at the top or the bottom of its box");
});

// The music at a narrow window, on both surfaces. A score is drawn at the
// size it is engraved at whatever the column does, and a drawing the column
// cannot hold is reached by scrolling the box it sits on: the card here, the
// <code> the engraving sits in in the editor. So what has to agree is the
// size of the drawing, the systems it is dealt into, and how much of it the
// box is holding back.
//
// The first two scores of example.mdm, because the fill and the alignment
// treat them differently: the first is narrower than the column with a title
// wider than its staff, the second is a plain wide one.
test("a narrow window leaves the music at its engraved size on both surfaces", { skip }, async () => {
  const width = 600;
  const page = await pageAt(EXAMPLE_PAGE, width, () =>
    Array.prototype.slice.call(document.querySelectorAll(".mdm-card"), 0, 2).map(function (card) {
      const svg = card.querySelector(".mdm-paper svg");
      const view = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      const drawn = svg.getBoundingClientRect().width;
      const staff = svg.querySelector(".abcjs-staff");
      return {
        drawn: Math.round(drawn),
        systems: svg.querySelectorAll(".abcjs-staff").length,
        // Four spaces of the staff as drawn: the number that says whether the
        // engraving was made smaller.
        gap: Math.round((staff.getBBox().height / 4) * (drawn / view[2]) * 10) / 10,
        held: Math.round(card.scrollWidth - card.clientWidth),
      };
    })
  );
  const editor = await editorAt(
    { textFont: "roman" },
    width,
    () =>
      Array.prototype.slice.call(document.querySelectorAll("#app code.language-abc"), 0, 2).map(function (code) {
        const svg = code.querySelector("svg");
        const view = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
        const drawn = svg.getBoundingClientRect().width;
        const staff = svg.querySelector(".abcjs-staff");
        return {
          drawn: Math.round(drawn),
          systems: svg.querySelectorAll(".abcjs-staff").length,
          gap: Math.round((staff.getBBox().height / 4) * (drawn / view[2]) * 10) / 10,
          held: Math.round(code.scrollWidth - code.clientWidth),
        };
      }),
    2600
  );
  assert.equal(page.length, 2);
  assert.equal(editor.length, 2);
  for (let i = 0; i < 2; i++) {
    const which = "score " + (i + 1) + ": ";
    assert.ok(
      Math.abs(page[i].drawn - editor[i].drawn) <= 1,
      which + "the page draws it " + page[i].drawn + " px wide and the editor " + editor[i].drawn
    );
    assert.equal(
      page[i].systems,
      editor[i].systems,
      which + "the page draws " + page[i].systems + " systems and the editor " + editor[i].systems
    );
    assert.ok(
      Math.abs(page[i].gap - editor[i].gap) < 0.2,
      which + "the staff is " + page[i].gap + " px a space on the page and " + editor[i].gap + " in the editor"
    );
    assert.ok(
      Math.abs(page[i].held - editor[i].held) <= 2,
      which + "the page holds back " + page[i].held + " px of the drawing and the editor " + editor[i].held
    );
  }
  // And the drawing was not made smaller to fit: the second score is wider
  // than the 500 px column at this window, so its box is holding some of it
  // back, and the staff is at the size abcjs draws it (7.9 px a space).
  assert.ok(editor[1].held > 100, "nothing was held back, so nothing was tested");
  assert.ok(editor[1].gap > 7.5, "the engraving was made smaller: " + editor[1].gap);
});

// A wide line of code at a narrow window, on both surfaces. A line of source
// is left whole and the end of it is reached by scrolling the block it is
// written in, the <pre> on the page and the card's own lines in the editor,
// so what has to agree is how much of the line each of them holds back and
// that neither of them moves its column to show it.
//
// This is the one difference between the two surfaces that had been written
// down instead of fixed: at this window the page hid 91 px of the widest line
// inside its block while the editor scrolled 232 px of the whole document,
// dragging the prose sideways with it.
test("a wide line of code scrolls inside its own block on both surfaces", { skip }, async () => {
  const width = 600;
  const page = await pageAt(EXAMPLE_PAGE, width, () => {
    const pre = document.querySelector("div.sourceCode pre.sourceCode");
    // The widest line of the block, as ink: the <pre> holds the lines as
    // spans with the newlines between them, so each line is measured on its
    // own range.
    let ink = 0;
    Array.prototype.forEach.call(pre.querySelectorAll("code > span"), function (line) {
      const range = document.createRange();
      range.selectNodeContents(line);
      const w = range.getBoundingClientRect().width;
      if (w > ink) ink = w;
    });
    return {
      box: Math.round(pre.clientWidth),
      held: Math.round(pre.scrollWidth - pre.clientWidth),
      ink: Math.round(ink),
      pad: Math.round(parseFloat(getComputedStyle(pre).paddingLeft)),
      size: Math.round(parseFloat(getComputedStyle(pre).fontSize) * 100) / 100,
      scrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  const editor = await editorAt(
    { textFont: "roman" },
    width,
    () => {
      // The widest line of the only card the editor draws as source: the
      // scores of example.mdm are engraved and their source is not rendered,
      // so these are the lines of its one code block.
      const rows = Array.prototype.slice.call(
        document.querySelectorAll("#app .cm-line.mdm-code-line")
      );
      let wide = rows[0];
      let ink = 0;
      rows.forEach(function (r) {
        const range = document.createRange();
        range.selectNodeContents(r);
        const w = range.getBoundingClientRect().width;
        if (w > ink) {
          ink = w;
          wide = r;
        }
      });
      const scroller = document.querySelector("#app .cm-scroller");
      return {
        box: Math.round(wide.clientWidth),
        held: Math.round(wide.scrollWidth - wide.clientWidth),
        ink: Math.round(ink),
        pad: Math.round(parseFloat(getComputedStyle(wide).paddingLeft)),
        size: Math.round(parseFloat(getComputedStyle(wide).fontSize) * 100) / 100,
        scrolls: scroller.scrollWidth > scroller.clientWidth + 1,
      };
    },
    2600
  );
  assert.equal(page.scrolls, false, "the page scrolls sideways for a line of code");
  assert.equal(editor.scrolls, false, "the editor scrolls the document sideways for a line of code");
  // The same block of the same document: the same size of type, the same
  // padding and the same column.
  assert.equal(page.size, editor.size, "the code is set at two sizes");
  assert.equal(page.pad, editor.pad, "the block carries two paddings");
  assert.ok(
    Math.abs(page.box - editor.box) <= 2,
    "the block is " + page.box + " px wide on the page and " + editor.box + " in the editor"
  );
  // And each of them holds back the part of its own longest line that the
  // column cannot take, so the end of that line is inside the block on both
  // surfaces. What is not the same is the face: the editor draws source in
  // VS Code's own editor font, which the page cannot know and answers with a
  // stack of its own, so the same line is not the same number of pixels of
  // ink on the two of them (574 px on the page against 565 in the harness,
  // where the editor's font setting is unset and it falls back to the
  // generic monospace; measured at this window).
  [["page", page], ["editor", editor]].forEach(function (pair) {
    const which = pair[0], out = pair[1];
    const past = out.ink + out.pad - out.box;
    assert.ok(past > 50, "the longest line fits the column on the " + which + ", so nothing was tested");
    assert.ok(
      out.held >= past - 2,
      "the " + which + " holds back " + out.held + " px of a line that stands " + past + " px past its column"
    );
  });
  // The editor holds a little more back than the page, and stops there: 91 px
  // against 116 at this window, which is 38 px past the end of its longest
  // line. 25 of those are the card's own padding, both sides of it, so the
  // card is scrolled to the end of the line and then stops with the air to
  // its right that it has to its left (a browser's own scroll box drops the
  // padding on that side and leaves the last character flush against the
  // edge, which is what the page does). The other 13 are the slack of the
  // `ch` the card counts its width in: 68 of them stand 13 px over the ink of
  // the same 68 characters in this font, and the sheet says as much where it
  // counts them (.mdm-code-line in style.css). What this holds down is the
  // card that scrolls far past the end of its text.
  const past = editor.ink + editor.pad - editor.box;
  assert.ok(
    editor.held - past <= 2 * editor.pad + 15,
    "the card holds back " + (editor.held - past) + " px past the end of its longest line"
  );
});
// And the same page at two windows: the engraving is the same drawing at
// both, and the only thing the narrow one does differently is hold part of it
// back inside the card. This is what `max-width: none` on the drawing and the
// card's own overflow buy; a responsive SVG scaled the whole engraving down
// to the window instead.
test("the page draws the same engraving at every window, and scrolls the card", { skip }, async () => {
  const read = () =>
    Array.prototype.slice.call(document.querySelectorAll(".mdm-card"), 0, 2).map(function (card) {
      const svg = card.querySelector(".mdm-paper svg");
      const staff = svg.querySelector(".abcjs-staff");
      const view = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      const drawn = svg.getBoundingClientRect().width;
      return {
        drawn: Math.round(drawn),
        systems: svg.querySelectorAll(".abcjs-staff").length,
        gap: Math.round((staff.getBBox().height / 4) * (drawn / view[2]) * 10) / 10,
        box: Math.round(card.clientWidth),
        held: Math.round(card.scrollWidth - card.clientWidth),
        scrolls: getComputedStyle(card).overflowX,
      };
    });
  const wide = await pageAt(EXAMPLE_PAGE, 1000, read);
  const narrow = await pageAt(EXAMPLE_PAGE, 500, read);
  for (let i = 0; i < 2; i++) {
    assert.equal(wide[i].drawn, narrow[i].drawn, "the drawing changed size with the window");
    assert.equal(wide[i].systems, narrow[i].systems, "the music was dealt differently");
    assert.equal(wide[i].gap, narrow[i].gap, "the staff changed size with the window");
  }
  // The wide window holds nothing back, the narrow one holds back exactly
  // what does not fit, and the card is the box that scrolls it.
  assert.equal(wide[1].held, 0, "a window with room for the score still held part of it back");
  assert.equal(narrow[1].held, narrow[1].drawn - narrow[1].box);
  assert.equal(narrow[1].scrolls, "auto");
});

// The name the page goes by, which is the browser's tab and the Title a PDF
// printed from that page carries, since Chrome copies <title> into it. The
// editor hides the header by default, and the title block goes with it, so
// nearly every page it exported came out called `quarto-inputdae4994f30dfed2f`,
// a temporary of Quarto's own (measured on Quarto 1.9.37, 2026-09-13). The
// filter copies the title into `pagetitle` before the block goes; a document
// with no title at all is named by the export instead, which writes one into
// the copy it renders (withPageTitle in vscode-mdm/extension.js, held by
// extension-host.test.js).
test("a document keeps its own name when its title block is hidden", { skip }, async () => {
  const out = await pageAt(WIDE_STAFF_PAGE, 1000, () => ({
    title: document.title,
    block: document.querySelectorAll("#title-block-header").length,
  }));
  assert.equal(out.title, "Wider than the measure");
  assert.equal(out.block, 0, "the header was hidden and the title block was drawn anyway");
});

// The link AnchorJS hangs on every heading, which the editor has none of. In
// the flow it is an inline box 24px wide at the end of the heading's last
// line, and that is enough to send a heading that filled its line onto a
// second one, where the editor keeps it on one: the export rule's own case.
// It is in the margin now, so it costs the heading nothing and a reader still
// has the link to a section.
test("the link on a heading costs the heading nothing", { skip }, async () => {
  // Only the headings that carry one: Quarto anchors the document's own
  // headings and not the h1 it draws from the title.
  const read = () =>
    Array.prototype.slice.call(document.querySelectorAll("main.content .anchored"))
      .map(function (h) {
        const a = h.querySelector(".anchorjs-link");
        if (!a) return null;
        const was = Math.round(h.getBoundingClientRect().height * 10) / 10;
        // Read before the link goes: a computed style is live, and it comes
        // back empty once the element it belongs to is out of the document.
        const position = getComputedStyle(a).position;
        const box = a.getBoundingClientRect();
        const head = h.getBoundingClientRect();
        // What the heading measures with the link taken out of the document
        // altogether, which is the editor's own case.
        a.remove();
        const without = Math.round(h.getBoundingClientRect().height * 10) / 10;
        return {
          position: position,
          // How far into the margin it stands, measured on its own left edge:
          // the box carries AnchorJS's own padding either side of the glyph,
          // so its right edge sits about where the text begins.
          leftOfText: Math.round((head.left - box.left) * 10) / 10,
          inside: box.left >= 0,
          was: was,
          without: without,
        };
      })
      .filter(Boolean);
  for (const width of [1400, 900, 520, 420]) {
    const out = await pageAt(EXAMPLE_PAGE, width, read);
    assert.ok(out.length >= 3, "the example has no anchored headings to measure");
    for (const h of out) {
      assert.equal(h.position, "absolute", "the link is in the flow at " + width);
      assert.equal(
        h.was,
        h.without,
        "the link changes its heading's height at " + width + "px"
      );
      // In the margin, and inside the sheet: the column leaves 50px either
      // side of itself at every window, which is where the icon stands.
      assert.ok(h.leftOfText > 0, "the link is not in the margin at " + width);
      assert.ok(h.inside, "the link is off the left edge of the page at " + width);
    }
  }
  // And nothing of it makes the page scroll sideways, at any window.
  for (const width of [1400, 900, 520, 420, 360]) {
    const out = await pageAt(EXAMPLE_PAGE, width, () => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    assert.ok(
      out.scroll <= out.client,
      "the page scrolls sideways at " + width + "px (" + out.scroll + " over " + out.client + ")"
    );
  }
});

// The same page on paper, which is the other surface the export has: a
// reader's Ctrl+P, and the PDF the extension prints with headless Chrome when
// there is no TeX to typeset one (printInstead in vscode-mdm/extension.js).
// Paper cannot scroll, so the card that holds a wide score back on screen
// would simply cut it, and it did: printed at Chrome's own page box, the
// partials of example.mdm lost "8:7" and the chord row lost its whole A7 bar,
// and a scrollbar and the audio transport were drawn onto the sheet
// (measured 2026-09-13, before the Paper block of mdm-look.css).
//
// What is checked here is the three decisions that block takes, in the print
// media itself: the page is scaled rather than re-flowed, so the column is
// still the editor's 820 px and the engraving inside it keeps the size it has
// on screen; a drawing wider than the column is fitted to it instead of cut;
// and nothing that answers a pointer is drawn. The measured page the numbers
// come from is in tests/README.md.
test("on paper the page is scaled, the scores fit and the transport is gone", { skip }, async () => {
  const h = await open();
  await h.page.emulateMediaType("print");
  const out = await h.page.evaluate(() => {
    const main = document.querySelector("main.content");
    return {
      zoom: getComputedStyle(document.documentElement).zoom,
      column: getComputedStyle(main).width,
      audio: Array.from(document.querySelectorAll(".mdm-audio")).map(
        (el) => getComputedStyle(el).display
      ),
      cards: Array.from(document.querySelectorAll(".mdm-card")).map((card) => ({
        over: card.scrollWidth - card.clientWidth,
        slack:
          card.querySelector(".mdm-paper").getBoundingClientRect().height -
          card.querySelector(".mdm-paper svg").getBoundingClientRect().height,
      })),
    };
  });
  await h.page.emulateMediaType(null);
  await h.close();

  // 10 TeX pt on a 16 px body, which is what the typeset page sets the same
  // 51.25 em measure at: 10/12 with TeX's point converted to CSS's (800/803).
  assert.equal(Math.round(Number(out.zoom) * 10000) / 10000, 0.8302);
  // 819.982 and not 820: the column is measured after the scale above, and
  // the scale is a ratio the browser has already rounded.
  assert.ok(
    Math.abs(parseFloat(out.column) - 820) <= 0.05,
    "the printed column is " + out.column + " and not the editor's 820px"
  );
  assert.ok(out.audio.length > 0, "the fixture has no player to hide");
  for (const display of out.audio) {
    assert.equal(display, "none", "the player bar is drawn on paper");
  }
  for (const card of out.cards) {
    assert.ok(card.over <= 0.5, `a score hangs ${card.over.toFixed(1)}px past its card`);
    assert.ok(
      Math.abs(card.slack) <= 0.5,
      `the box keeps ${card.slack.toFixed(1)}px of height the drawing does not use`
    );
  }

  // And the score that asks for more width than the measure has, which is the
  // one the clamp is there for: this fixture's %%staffwidth is 900pt, 1200px
  // against the 820px column, so no window makes it fit and only the clamp
  // does. On screen the same card holds the rest back and scrolls it.
  const read = () =>
    Array.prototype.slice.call(document.querySelectorAll(".mdm-card")).map(function (card) {
      const svg = card.querySelector(".mdm-paper svg");
      return {
        over: Math.round((svg.getBoundingClientRect().right - card.getBoundingClientRect().right) * 10) / 10,
        held: Math.round(card.scrollWidth - card.clientWidth),
      };
    });
  const onScreen = await pageAt(WIDE_STAFF_PAGE, 1400, read);
  const onPaper = await pageAt(WIDE_STAFF_PAGE, 1400, read, null, false, "print");
  assert.ok(onScreen[0].held > 0, "the fixture no longer asks for more width than the measure");
  assert.ok(
    onPaper[0].over <= 0.5,
    `the wide score hangs ${onPaper[0].over}px past the paper's card`
  );
  assert.equal(onPaper[0].held, 0, "the printed card still has something to scroll");
});

// A card of code longer than what is left of a sheet, printed the way the
// extension prints a page when there is no TeX (printHtmlToPdf in
// vscode-mdm/extension.js: headless Chrome's --print-to-pdf, with its flags).
// Chrome gives a box broken across two sheets its padding once, over the first
// piece and under the last, so the card went on at the head of the next sheet
// with its first line against its top edge: 1.0 pt from it, where the card's
// own start leaves 7.0 (seen on 2026-09-14 in the PDF of a document with no
// scores; the rule is "A card of code that runs on past the foot of a sheet"
// in mdm-look.css). The paper itself is what is read. A sheet that changes
// colours and nothing else paints the card magenta and its text blue, the
// sheets are rasterized to find each piece of the card, and poppler's word
// boxes give where each line's box begins, which is the same for every glyph
// on a line and so does not depend on the letters that open it. The foot of
// a piece is not read: what is left under the last line that fits is
// whatever the sheet had left.
function readPpm(file) {
  const buf = fs.readFileSync(file);
  const head = /^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(buf.toString("latin1", 0, 64));
  return { width: +head[1], height: +head[2], data: buf.subarray(head[0].length) };
}

const POPPLER =
  spawnSync("pdftoppm", ["-v"]).status === 0 && spawnSync("pdftotext", ["-v"]).status === 0;

test("on paper a card of code that goes on past the foot of a sheet opens the next sheet as it opens anywhere", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, () => {
  const lines = Array.from(
    { length: 150 },
    (_, i) => "value_" + String(i).padStart(3, "0") + " = compute(" + i + ")  # one line of a long card"
  );
  fs.writeFileSync(
    path.join(DIR, "longcode.mdm"),
    [
      "---",
      'title: "A long card"',
      "format:",
      "  html:",
      "    embed-resources: true",
      "filters:",
      "  - mdm",
      "---",
      "",
      "A card of code longer than a sheet:",
      "",
      "```python",
      ...lines,
      "```",
      "",
    ].join("\n")
  );
  const r = spawnSync(MDM, ["render", "longcode.mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);

  const paint =
    "<style>@media print {" +
    " body div.sourceCode, body div.sourceCode pre.sourceCode { background: #ff00ff !important; }" +
    " body pre code, body pre code * { color: #0000ff !important; } }</style>";
  const page = fs.readFileSync(path.join(DIR, "longcode.html"), "utf8");
  fs.writeFileSync(path.join(DIR, "longcode-painted.html"), page.replace("</head>", paint + "</head>"));
  const pdf = path.join(DIR, "longcode.pdf");
  const profile = fs.mkdtempSync(path.join(DIR, "profile-"));
  const c = spawnSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      "--virtual-time-budget=6000",
      "--no-sandbox",
      "--user-data-dir=" + profile,
      "--print-to-pdf=" + pdf,
      path.join(DIR, "longcode-painted.html"),
    ],
    { encoding: "utf8", timeout: 60000 }
  );
  fs.rmSync(profile, { recursive: true, force: true });
  assert.ok(fs.existsSync(pdf), "Chrome printed nothing: " + c.stderr);

  const prefix = path.join(DIR, "longcode-sheet");
  assert.equal(spawnSync("pdftoppm", ["-r", "144", pdf, prefix]).status, 0);
  const sheets = fs
    .readdirSync(DIR)
    .filter((n) => n.startsWith("longcode-sheet-") && n.endsWith(".ppm"))
    .sort((a, b) => parseInt(a.slice(15), 10) - parseInt(b.slice(15), 10));
  const words = Array.from(
    spawnSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8" }).stdout.matchAll(/<page [^>]*>([\s\S]*?)<\/page>/g),
    (m) =>
      Array.from(
        m[1].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">/g),
        (w) => w.slice(1).map(Number)
      )
  );

  // Every piece of the card, sheet by sheet: its top edge and how far under
  // it the box of its first line begins, in pt (the raster is 2 px a pt).
  const pieces = [];
  sheets.forEach((file, i) => {
    const { width, height, data } = readPpm(path.join(DIR, file));
    const magenta = (x, y) => {
      const o = (y * width + x) * 3;
      return data[o] > 220 && data[o + 1] < 60 && data[o + 2] > 220;
    };
    const rows = [];
    for (let y = 0; y < height; y++) {
      let left = -1;
      let right = -1;
      for (let x = 0; x < width; x++) {
        if (magenta(x, y)) {
          if (left < 0) left = x;
          right = x;
        }
      }
      rows.push(left < 0 ? null : [left, right]);
    }
    for (let y = 0; y < height; ) {
      if (!rows[y]) {
        y++;
        continue;
      }
      const top = y;
      let left = width;
      let right = -1;
      for (; y < height && rows[y]; y++) {
        left = Math.min(left, rows[y][0]);
        right = Math.max(right, rows[y][1]);
      }
      const t = top / 2;
      const b = y / 2;
      const inside = words[i].filter(
        (w) => w[0] >= left / 2 && w[2] <= (right + 1) / 2 + 1 && w[1] >= t - 0.5 && w[3] <= b + 0.5
      );
      if (inside.length) {
        pieces.push({ sheet: i + 1, gap: Math.min(...inside.map((w) => w[1])) - t });
      }
    }
  });

  // One card of 150 lines, a sheet and a half of them and more: if it no
  // longer runs on past a foot twice, this reads nothing.
  assert.ok(pieces.length >= 3, "the card came out in " + pieces.length + " pieces, and the test needs three");
  const opens = pieces[0].gap;
  for (const piece of pieces.slice(1)) {
    assert.ok(
      Math.abs(piece.gap - opens) <= 0.6,
      "on sheet " + piece.sheet + " the card's first line stands " + piece.gap.toFixed(1) +
        " pt under its top edge, where the card opens with it " + opens.toFixed(1) + " pt under"
    );
  }
});

// And the bar the card holds it back with is drawn under the music, not over
// it. The card's height is its content's, so a bar is added below the paper;
// the editor's box had a height of its own (abcjs writes one into the style
// attribute of what it engraves into) and the bar was taken out of it
// instead, covering the bottom 9.6 px of the drawing at a 520 px pane. The
// two bars are not the same height, 15 px here against the 10 px VS Code
// draws inside a webview, which is the platform's furniture and not the
// document: what has to agree is that neither of them stands on the music.
// The editor's twin is "the bar of a score is drawn under the music and not
// over it" in webview-narrow.test.js.
test("the bar under a score on the page is drawn below the music", { skip }, async () => {
  const read = () => {
    const card = document.querySelector(".mdm-card");
    const svg = card.querySelector(".mdm-paper svg");
    const box = card.getBoundingClientRect();
    return {
      bar: card.offsetHeight - card.clientHeight,
      content: card.clientHeight,
      held: Math.round(card.scrollWidth - card.clientWidth),
      // What of the drawing sits past the bottom of the card's content.
      covered: Math.round((svg.getBoundingClientRect().bottom - (box.top + card.clientHeight)) * 10) / 10,
    };
  };
  const wide = await pageAt(EXAMPLE_PAGE, 1000, read, null, true);
  const narrow = await pageAt(EXAMPLE_PAGE, 500, read, null, true);
  assert.equal(wide.bar, 0, "a card with room for its drawing still holds a bar");
  assert.ok(narrow.held > 0, "the card does not scroll at a 500 px window");
  assert.ok(narrow.bar > 0, "the card holds no bar at a 500 px window");
  assert.equal(
    narrow.content,
    wide.content,
    "the bar was taken out of the music's own room: " + narrow.content + " against " + wide.content
  );
  assert.ok(narrow.covered <= 0.5, "the bar covers " + narrow.covered + " px of the drawing");
});

// The drawing is never cropped by the box it sits in. abcjs sizes a drawing
// from the engraved music alone, so a title wider than any staff hangs
// outside the box it declares and the SVG viewport cuts it: the engraving
// here asks for 200pt of staff and carries a title wider than that. The
// editor has widened that box to the ink since abcjs 5.10.3 (fitScores) and
// the page does the same (fitPaper); without it the title lost its first and
// last letters. The editor's twin of this test is "a title wider than its
// staff is not cropped" in webview-look.test.js.
test("a title wider than its staff is not cropped on the page", { skip }, async () => {
  const out = await pageAt(NARROW_TITLE_PAGE, 900, () =>
    Array.prototype.slice.call(document.querySelectorAll(".mdm-paper svg")).map(function (svg) {
      const view = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      const ink = svg.getBBox();
      return {
        left: Math.round((view[0] - ink.x) * 10) / 10,
        right: Math.round((ink.x + ink.width - (view[0] + view[2])) * 10) / 10,
        // The title has to be the thing that overhangs, or the fixture has
        // stopped testing what it was written for.
        titleOver: Math.round(
          (svg.querySelector(".abcjs-title").getBBox().width -
            svg.querySelector(".abcjs-staff").getBBox().width) *
            10
        ) / 10,
      };
    })
  );
  assert.equal(out.length, 1);
  for (const b of out) {
    assert.ok(b.titleOver > 0, "the title fits its staff, so nothing was tested");
    // Half a pixel of slack for the sub-pixel jitter of text measurement, the
    // same the editor's test allows.
    assert.ok(b.left <= 0.5, "cropped on the left by " + b.left + " px");
    assert.ok(b.right <= 0.5, "cropped on the right by " + b.right + " px");
  }
});

// A fill under a score, on both surfaces: the card spans the column and the
// drawing on it is the size the editor draws, which is the size of the same
// score with no fill. The page used to hug the drawing with the fill and take
// its padding out of it, 714 px against the editor's 740; the editor did the
// same once the column was narrower than the drawing and the padding.
test("a filled score is drawn at the editor's size, on a card the width of the column", { skip }, async () => {
  for (const width of [1200, 700]) {
    const page = await pageAt(EXAMPLE_FILL_PAGE, width, () => {
      const card = document.querySelector(".mdm-card");
      return {
        column: Math.round(document.querySelector("main.content").getBoundingClientRect().width),
        card: Math.round(card.getBoundingClientRect().width),
        fill: getComputedStyle(card).backgroundColor,
        // The first two scores, because they take the two roads a narrow
        // column offers and the fill is measured differently on each: the
        // first is scaled inside the card (a reflow would cost it a system),
        // the second is engraved again for the room the card leaves, which is
        // the room the fill's own padding is taken out of. The page measured
        // that room before it knew the drawing's width once, and engraved a
        // reflowed score 574 px wide where the editor drew it 600.
        drawings: Array.prototype.slice
          .call(document.querySelectorAll(".mdm-card"), 0, 2)
          .map(function (c) {
            return Math.round(c.querySelector(".mdm-paper svg").getBoundingClientRect().width);
          }),
      };
    });
    const editor = await editorAt(
      { textFont: "roman", scoreFill: "paper" },
      width,
      () =>
        Array.prototype.slice
          .call(document.querySelectorAll("#app .mdm-score code.language-abc"), 0, 2)
          .map(function (code) {
            return Math.round(code.querySelector("svg").getBoundingClientRect().width);
          }),
      2600
    );
    assert.notEqual(page.fill, "rgba(0, 0, 0, 0)", "the page has no fill to test");
    assert.equal(page.card, page.column, width + ": the card is " + page.card + " px in a column of " + page.column);
    assert.equal(page.drawings.length, 2);
    assert.equal(editor.length, 2);
    for (let i = 0; i < 2; i++) {
      assert.equal(
        page.drawings[i],
        editor[i],
        width + ": the page draws filled score " + (i + 1) + " " + page.drawings[i] +
          " px wide and the editor " + editor[i]
      );
    }
  }
});

test("a score is drawn on the page at the size it is drawn in the editor", { skip }, async () => {
  const s = await sides();
  // The drawing, which a responsive SVG can scale as a whole.
  assert.equal(s.exported.svg, s.editor.svg, "the engraving is a different width on the page");
  assert.equal(s.exported.staff, s.editor.staff, "the staff is a different height on the page");
  // The words on it: the size asked for, and the size drawn. Both, because
  // they came apart once: the sizes matched while the ink did not, the page
  // having taken the score out of the prose's font-size-adjust and the editor
  // not, which drew the same string at the same size a seventh wider.
  assert.equal(
    s.exported.titleSize,
    s.editor.titleSize,
    "the title is asked for at a different size on the page"
  );
  assert.equal(
    s.exported.adjust,
    s.editor.adjust,
    "one surface adjusts the score's text and the other does not"
  );
  assert.equal(
    s.exported.titleInk,
    s.editor.titleInk,
    "the title is drawn a different width on the page"
  );
});

// ---------- The block the YAML asks for, and the face it is set in ----------

// What a page is asked for at the top of it, measured rather than read out of
// the HTML: render.test.js reads the markup and says the block is there, and
// markup that is there and painted at nothing is what a stylesheet takes away.
// So this asks for the ink: the width the title, the subtitle and the author
// actually cover on screen.
//
// Both faces, in the same pass, because the roman brings a second stylesheet
// with it (mdm-roman.css) and the sans does not, and everything a page is
// asked to hold has to survive both. What is compared between them is the
// measure, which is the face's business only in what it puts inside it: the
// column is the editor's 820 whichever face the words are in.
const TITLE_BLOCK = function () {
  const ink = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      size: +parseFloat(cs.fontSize).toFixed(2),
      hidden: cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0",
      text: el.textContent.trim(),
    };
  };
  return {
    column: Math.round(document.querySelector("main.content").getBoundingClientRect().width),
    body: +parseFloat(getComputedStyle(document.body).fontSize).toFixed(2),
    header: ink("#title-block-header"),
    title: ink("#title-block-header h1.title"),
    subtitle: ink("#title-block-header .subtitle"),
    author: ink("#title-block-header .quarto-title-meta-contents"),
  };
};

async function titleBlocks() {
  const out = {};
  for (const [face, url] of [["roman", EXAMPLE_PAGE], ["sans", EXAMPLE_SANS_PAGE]]) {
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--allow-file-access-from-files"],
      defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 1200 },
    });
    OPEN_BROWSERS.add(browser);
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    out[face] = await page.evaluate("(" + TITLE_BLOCK.toString() + ")()");
    await browser.close();
    OPEN_BROWSERS.delete(browser);
  }
  return out;
}

test("the page opens with the block the YAML asks for, in either face", { skip }, async () => {
  const b = await titleBlocks();
  ["roman", "sans"].forEach((face) => {
    const t = b[face];
    assert.ok(t.header, "the " + face + " page has no title block at all");
    assert.ok(!t.header.hidden, "the " + face + " page hides its title block");
    // The three things the block holds, each of them drawn and not merely
    // present: a heading with no ink is a heading a stylesheet took away.
    assert.equal(t.title.text, "A Markdown Music prototype", face);
    assert.ok(t.title.w > 100, "the " + face + " title covers " + t.title.w + "px");
    assert.equal(t.subtitle.text, "Markdown and scores in one file", face);
    assert.ok(t.subtitle.w > 100, "the " + face + " subtitle covers " + t.subtitle.w + "px");
    assert.equal(t.author.text, "alpelito7", face);
    assert.ok(t.author.w > 20, "the " + face + " author covers " + t.author.w + "px");
  });
  // The title takes the size of a first-level heading, which is Markdown's
  // 2em in either face: the roman's ladder only parts from the sans's below
  // h3, and the roman once set it at article.cls's \huge (2.074). The rule
  // that carries it names `.title` beside `h1`, and losing that half of the
  // selector is the quiet way for the block to fall out of the ladder.
  assert.equal(b.roman.title.size, +(b.roman.body * 2).toFixed(2), "the roman title");
  assert.equal(b.sans.title.size, +(b.sans.body * 2).toFixed(2), "the sans title");
  // And where the two faces are not meant to differ. The measure is the
  // editor's, whatever the words are set in: the roman used to break the first
  // paragraph a word earlier than the sans on the very same page, both of them
  // held to Quarto's 802px track rather than to the editor's 820.
  assert.equal(b.roman.column, b.sans.column, "the two faces hold different measures");
  assert.equal(b.roman.column, 820, "the column is not the editor's");
});

// ---------- The ladder of headings, page against editor ----------

// Six levels, each over a line of prose, which is the document the editor's
// own test of the ladder opens (HEADINGS_DOC in webview-look.test.js). It is
// rendered in each face and set beside the editor opened on it in the same
// face. The editor takes its sizes from style.css alone and the page from two
// sheets, mdm-look.css for the sans's ladder and mdm-roman.css over it where
// the roman's parts from it: a level the roman sheet forgets is drawn at the
// sans's size, and one mdm-look.css forgets at the size Quarto's own sheets
// give it. The same numbers out of the three files are what this reads,
// level by level.
const HEADINGS = [1, 2, 3, 4, 5, 6]
  .map((n) => "#".repeat(n) + " Level " + n + "\n\nA line of prose under it.\n")
  .join("\n");

test("every heading is drawn on the page at the size the editor draws it, in either face", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  for (const face of ["roman", "sans"]) {
    const name = "headings-" + face;
    fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + HEADINGS);
    const r = spawnSync(
      MDM,
      ["render", name + ".mdm", "--to", "html", "-M", "mdm-text-font:" + face],
      { cwd: DIR, encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr);

    const browser = await puppeteer.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--allow-file-access-from-files"],
      defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 1200 },
    });
    OPEN_BROWSERS.add(browser);
    const page = await browser.newPage();
    await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    const exported = await page.evaluate(() =>
      [1, 2, 3, 4, 5, 6].map((n) => {
        const el = Array.from(document.querySelectorAll("h" + n)).find((e) =>
          e.textContent.trim().startsWith("Level " + n)
        );
        return el ? +parseFloat(getComputedStyle(el).fontSize).toFixed(3) : null;
      })
    );
    await browser.close();
    OPEN_BROWSERS.delete(browser);

    // Closed whatever happens, so a failure here leaves no editor open to keep
    // the run waiting.
    const h = await openEditor({ text: HEADINGS, scores: 0, seed: { settings: { textFont: face } } });
    let editor;
    try {
      editor = await h.page.evaluate(() =>
        [1, 2, 3, 4, 5, 6].map((n) => {
          const el = document.querySelector("#app .cm-line.mdm-h" + n);
          return el ? +parseFloat(getComputedStyle(el).fontSize).toFixed(3) : null;
        })
      );
    } finally {
      await h.close();
    }

    assert.ok(editor.every((s) => s), "the editor drew no line for a level: " + editor);
    assert.deepEqual(
      exported,
      editor,
      "the " + face + " page heads its six levels at other sizes than the editor"
    );
  }
});

// The air around a heading, gap by gap against the editor: from the bottom of
// each block's line box to the top of the next, and from the top of the
// column to the first block's text, on the page and in the editor opened on
// the same document, in both faces. The page used to give a heading its
// padding as a margin, which collapsed into the paragraph's, and to draw no
// blank line at all: an h2 stood 16px under a paragraph where the editor sets
// it 30.4, and the six levels measured 458px on the page against 573 in the
// editor. A quotation kept Bootstrap's padding, 10.6px more over it and 11.6
// under it. Three documents, for the head of the column as well as its body:
// the six levels with a quotation under the prose, which opens on an h1;
// example.mdm's opening, a paragraph and then `##`, which Quarto's own rules
// set 34px apart where the editor sets them 30.4; and a column that opens on
// an h2, which one of those rules set flush with the top where the editor
// leaves the heading's padding over it, 14.4px (mdm-look.css, after the
// margins of a heading).
const AIR_DOCS = {
  headings: HEADINGS + "\n> A quoted line under the prose.\n\nA line after the quote.\n",
  opening: "An opening paragraph, one line of it.\n\n## A section\n\nA line of prose under it.\n",
  h2: "## An opening section\n\nA line of prose under it.\n",
};

const BLOCK_GAPS = function (column, blocks) {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      top: r.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth),
      bottom: r.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth),
      text: el.textContent.replace(/^[#>\s]+/, "").trim().slice(0, 12),
    };
  };
  const b = blocks.map(box);
  return {
    top: +(b[0].top - box(column).top).toFixed(2),
    gaps: b.slice(1).map((x, i) => ({
      between: b[i].text + " > " + x.text,
      gap: +(x.top - b[i].bottom).toFixed(2),
    })),
  };
}.toString();

test("the page leaves the air around a heading that the editor leaves, in either face", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  for (const face of ["roman", "sans"]) {
    for (const [doc, text] of Object.entries(AIR_DOCS)) {
      const name = "air-" + doc + "-" + face;
      const where = face + ", " + doc;
      fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
      const r = spawnSync(
        MDM,
        ["render", name + ".mdm", "--to", "html", "-M", "mdm-text-font:" + face],
        { cwd: DIR, encoding: "utf8" }
      );
      assert.equal(r.status, 0, r.stderr);

      const browser = await puppeteer.launch({
        executablePath: CHROME,
        args: ["--no-sandbox", "--allow-file-access-from-files"],
        defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 1200 },
      });
      OPEN_BROWSERS.add(browser);
      const page = await browser.newPage();
      await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
      await page.evaluate(() => document.fonts.ready);
      const exported = await page.evaluate(
        (f) =>
          eval("(" + f + ")")(
            document.querySelector("main.content"),
            Array.from(
              document.querySelectorAll("main.content :is(h1, h2, h3, h4, h5, h6):not(.title), main.content p")
            )
          ),
        BLOCK_GAPS
      );
      await browser.close();
      OPEN_BROWSERS.delete(browser);

      const h = await openEditor({ text, scores: 0, seed: { settings: { textFont: face } } });
      let editor;
      try {
        await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1200 });
        await h.page.evaluate(
          () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
        );
        editor = await h.page.evaluate(
          (f) =>
            eval("(" + f + ")")(
              document.querySelector("#app .cm-content"),
              Array.from(document.querySelectorAll("#app .cm-content .cm-line:not(.mdm-blank)"))
            ),
          BLOCK_GAPS
        );
      } finally {
        await h.close();
      }

      assert.ok(
        Math.abs(exported.top - editor.top) <= 1,
        where + ": the first block's text stands " + exported.top +
          "px under the top of the column on the page and " + editor.top + " in the editor"
      );
      assert.deepEqual(
        exported.gaps.map((g) => g.between),
        editor.gaps.map((g) => g.between),
        where + ": the two surfaces do not hold the same blocks in the same order"
      );
      exported.gaps.forEach((g, i) => {
        assert.ok(
          Math.abs(g.gap - editor.gaps[i].gap) <= 1,
          where + ": " + g.between + " is " + g.gap + "px on the page and " + editor.gaps[i].gap +
            " in the editor"
        );
      });
    }
  }
});

// A list on the page is set on the editor's measures (mdm-look.css, Lists;
// style.css, Lists): 1.5em of hanging indent a level, the marker in the gap
// and the text starting after it. Read on both surfaces from the column's
// left edge, the text of an item at three levels, the second row of an item
// that wraps, a task's text and a numbered item's, and the box of the task.
test("the page hangs a list under its text where the editor does, level by level", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const text =
    "Intro.\n\n- level one bullet\n  1. level two number\n     - level three bullet with enough words to wrap onto a " +
    "second row at the side-by-side width, hanging under its text and not under the first level\n- [ ] a task\n\n8. eight\n9. nine\n";
  const NEEDLES = ["level one", "level two", "level three", "a task", "eight"];
  const name = "lists-roman";
  fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
  const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
    defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 1200 },
  });
  OPEN_BROWSERS.add(browser);
  const page = await browser.newPage();
  await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const exported = await page.evaluate((needles) => {
    const main = document.querySelector("main.content");
    const left = main.getBoundingClientRect().left;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    const xOf = (needle) => {
      for (const n of nodes) {
        const i = n.textContent.indexOf(needle);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + needle.length);
        return Math.round(range.getBoundingClientRect().left - left);
      }
      return null;
    };
    const box = main.querySelector("li input[type=checkbox]");
    // Where a wrapped row of the third level starts: the item's own left
    // edge, since the marker stands outside it.
    const third = main.querySelector("ul > li > ol > li > ul > li");
    return {
      xs: needles.map(xOf),
      wrapped: third ? Math.round(third.getBoundingClientRect().left - left) : null,
      box: box ? Math.round(box.getBoundingClientRect().left - left) : null,
    };
  }, NEEDLES);
  await browser.close();
  OPEN_BROWSERS.delete(browser);

  const h = await openEditor({ text, scores: 0 });
  let editor;
  try {
    await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1200 });
    await h.page.evaluate(() => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    await h.page.mouse.click(2, 2);
    await h.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    editor = await h.page.evaluate((needles) => {
      const view = window.__mdm.view;
      const left = view.contentDOM.getBoundingClientRect().left;
      const doc = view.state.doc.toString();
      const box = document.querySelector("#app input.mdm-task");
      // The start of the second visual row of the third level's line: the
      // first position whose box stands lower than the line's first one.
      const line = view.state.doc.lineAt(doc.indexOf("level three"));
      const top = view.coordsAtPos(line.from).top;
      let wrapped = null;
      for (let pos = line.from + 1; pos <= line.to && wrapped === null; pos++) {
        const c = view.coordsAtPos(pos);
        if (c && c.top > top + 4) wrapped = Math.round(c.left - left);
      }
      return {
        xs: needles.map((needle) => Math.round(view.coordsAtPos(doc.indexOf(needle)).left - left)),
        wrapped,
        box: box ? Math.round(box.getBoundingClientRect().left - left) : null,
      };
    }, NEEDLES);
  } finally {
    await h.close();
  }
  NEEDLES.forEach((needle, i) => {
    assert.ok(
      Math.abs(exported.xs[i] - editor.xs[i]) <= 1,
      needle + " starts " + exported.xs[i] + "px into the column on the page and " + editor.xs[i] + " in the editor"
    );
  });
  assert.deepEqual(editor.xs, [24, 48, 72, 24, 24], "the editor's levels: " + JSON.stringify(editor.xs));
  assert.equal(editor.wrapped, 72, "the editor hangs the wrapped row under the text");
  assert.equal(exported.wrapped, editor.wrapped, "the page hangs it there too");
  assert.ok(
    Math.abs(exported.box - editor.box) <= 2,
    "the task's box stands " + exported.box + "px into the column on the page and " + editor.box + " in the editor"
  );
});
