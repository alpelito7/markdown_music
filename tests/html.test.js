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
  // Every word on a staff keeps the SIZE abcjs gives it. They were held to a
  // ladder over the prose's x-height for a while instead, and that was taken
  // back on 2026-09-10; nothing of ours has named a size since, here or in
  // the editor (renderScore in vscode-mdm/media/main.js). The page this opens
  // is rendered with no look at all, so it is in the filter's fallback sans
  // and abcjs keeps its own faces as well; the face is read below.
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

// And the face is the document's, which is the other half of it: a page set
// in the roman engraves its scores in the roman too, at those same sizes. The
// family is one of its own and not the `"Latin Modern Roman"` the prose is
// set in, because that one carries a `size-adjust` here and none in the
// editor, and a score naming it would come out 22.5% larger on the page than
// in the editor it was written in.
test("the page draws a score in the face the document is set in", { skip }, async () => {
  const drawn = (page) =>
    page.evaluate(() => {
      const out = {};
      document.querySelectorAll(".mdm-fit svg text").forEach((t) => {
        const cls = (t.getAttribute("class") || "?").split(" ")[0];
        if (!out[cls]) {
          out[cls] = t.getAttribute("font-family") + " | " + t.getAttribute("font-size");
        }
      });
      return out;
    });

  const roman = await open(EXAMPLE_PAGE);
  const r = await drawn(roman.page);
  assert.equal(r["abcjs-title"], "Latin Modern Roman Score | 27");
  assert.equal(r["abcjs-part"], "Latin Modern Roman Score | 20");
  assert.equal(r["abcjs-lyric"], "Latin Modern Roman Score | 17");
  assert.equal(r["abcjs-chord"], "Latin Modern Roman Score | 16");
  // The annotation is drawn in the other family of the same face, at the same
  // size: abcjs gives that role a sans, and a face put in its place at the
  // same nominal size only keeps the size if the x-heights agree. The wide
  // family is the same four files scaled until they do, with the line box
  // held where it was (mdm-roman.css).
  assert.equal(r["abcjs-annotation"], "Latin Modern Roman Score Wide | 16");
  await roman.close();

  // A page in the sans is handed no format at all and keeps abcjs's own.
  const sans = await open(EXAMPLE_SANS_PAGE);
  const p = await drawn(sans.page);
  assert.equal(p["abcjs-title"], "Times New Roman | 27");
  assert.equal(p["abcjs-lyric"], "Times New Roman | 17");
  assert.equal(p["abcjs-chord"], "Helvetica | 16");
  await sans.close();
});

// The ledger lines on the page as the editor draws them (LL1 in
// webview-look.test.js, with the same tune and the same reading of what is
// painted): in the staff's colour, the side's grey on either side and the
// ink when the staff lines are in ink, and under the notes, the middle of
// every head and every stem that crosses one of them in ink. mdm.js moves
// them there (sinkLedgers), as the editor does: left where abcjs draws them
// the grey line crossed the head it carries (2026-10-03). And in the slices
// a score of several systems is printed from as well, which are clones of
// the drawing and stand in for it on paper, in the PDF the extension prints
// too: a second tune, of two systems, is read in its slices.
test("the page draws the ledger lines in the staff's colour and under the notes (LL2)", { skip }, async () => {
  const { paintedAt, inkPoints, LEDGER_FIXTURE } = require("./webview/helpers.js");
  const text =
    "Low and high.\n\n```abc\n" + LEDGER_FIXTURE + "```\n\nTwo systems.\n\n" +
    "```abc\nX:2\nL:1/4\nK:C\nC A, a c'|\nA, C c' a|\n```\n";
  for (const [name, extra, grey] of [
    ["ledger-light", [], "rgb(163, 163, 163)"],
    ["ledger-dark", ["-M", "mdm-look:dark"], "rgb(111, 111, 111)"],
    ["ledger-ink", ["-M", "mdm-staff-lines:ink"], null],
  ]) {
    fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
    const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"].concat(extra), { cwd: DIR, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--allow-file-access-from-files"],
      defaultViewport: { width: 900, height: 700, deviceScaleFactor: 3 },
    });
    OPEN_BROWSERS.add(browser);
    try {
      const page = await browser.newPage();
      await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
      await page.waitForFunction(() => document.querySelector(".mdm-paper svg .abcjs-ledger"), { timeout: 20000 });
      const seen = await page.evaluate(() => {
        const svg = document.querySelector(".mdm-paper svg");
        const fills = (sel) => [...new Set(Array.from(svg.querySelectorAll(sel)).map((p) => getComputedStyle(p).fill))];
        return {
          count: svg.querySelectorAll(".abcjs-ledger").length,
          ledger: fills(".abcjs-ledger"),
          staff: fills(".abcjs-staff path"),
          head: fills(".abcjs-notehead"),
        };
      });
      assert.equal(seen.count, 10, name + ": the tune's ledger lines");
      assert.equal(seen.head.length, 1, name + ": the note heads");
      if (!grey) {
        assert.deepEqual(seen.ledger, seen.head, name + ": the ledger lines are not in the ink of the notes");
        assert.deepEqual(seen.staff, seen.head, name + ": the staff is not in ink");
        continue;
      }
      assert.deepEqual(seen.staff, [grey], name + ": the staff");
      assert.deepEqual(seen.ledger, [grey], name + ": the ledger lines are not in the staff's grey");
      assert.notEqual(seen.head[0], grey, name + ": the note heads went grey");
      // What is painted: the ink of the heads at the middle of each of them
      // and where a stem crosses a ledger line.
      const { clip, points } = await inkPoints(page, ".mdm-paper");
      assert.equal(points.filter((p) => p.what === "head").length, 5, name + ": the heads");
      assert.ok(points.filter((p) => p.what === "stem").length >= 2, name + ": no stem crosses a ledger line");
      const want = seen.head[0].match(/\d+/g).map(Number);
      const painted = await paintedAt(page, clip, points);
      painted.forEach((rgb, i) => {
        const off = Math.max(...rgb.map((v, c) => Math.abs(v - want[c])));
        assert.ok(
          off <= 24,
          name + ": the " + points[i].what + " at " + Math.round(points[i].x) + "," + Math.round(points[i].y) +
            " is painted " + rgb + " and not the ink " + want + ": a ledger line is drawn over it"
        );
      });
      // The slices a score of several systems is printed from, which are
      // not on screen to be read as pixels: no ledger line of theirs is left
      // in the group of its note.
      const slices = await page.evaluate(() => ({
        drawings: document.querySelectorAll(".mdm-slices svg").length,
        lines: document.querySelectorAll(".mdm-slices svg .abcjs-ledger").length,
        inNotes: document.querySelectorAll(".mdm-slices svg .abcjs-note .abcjs-ledger").length,
      }));
      assert.equal(slices.drawings, 2, name + ": the slices of the tune of two systems");
      assert.ok(slices.lines > 0, name + ": no ledger line in the slices");
      assert.equal(slices.inNotes, 0, name + ": the slices for print keep their ledger lines over the notes");
    } finally {
      await browser.close();
      OPEN_BROWSERS.delete(browser);
    }
  }
});

// The ledger lines of a sounding note take the accent with it on the page as
// in the editor (LL4 in webview-player.test.js): out of the note's group
// since mdm.js moves them under the notes, they are marked by the player
// itself (lightLedgers). Under the page's own player, which this suite had
// never started: abcjs fetches its piano from the network, so the requests
// are answered here with the piano the editor ships, and nothing else is let
// out. A middle C whose one line is lit and no other, an E with no ledger
// line, the low A with its two, and nothing lit once the tune is over.
test("on the page a sounding note's ledger lines are lit with it and put out with it (LL5)", { skip }, async () => {
  const text = "A tune to play.\n\n```{.abc .play}\nX:1\nL:1/4\nQ:1/4=120\nK:C\nC2 e2|A,4|\n```\n";
  const PIANO = path.join(ROOT, "vscode-mdm", "media", "vendor", "soundfont");
  for (const [name, extra, grey, accent] of [
    ["ledger-play-light", [], "rgb(163, 163, 163)", "rgb(160, 116, 15)"],
    ["ledger-play-dark", ["-M", "mdm-look:dark"], "rgb(111, 111, 111)", "rgb(217, 169, 79)"],
  ]) {
    fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
    const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"].concat(extra), { cwd: DIR, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"],
    });
    OPEN_BROWSERS.add(browser);
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const note = /midi-js-soundfonts\/[^/]+\/(acoustic_grand_piano-mp3\/[A-Za-z0-9]+\.mp3)$/.exec(req.url());
        if (note && fs.existsSync(path.join(PIANO, note[1]))) {
          return req.respond({
            status: 200,
            contentType: "audio/mpeg",
            headers: { "access-control-allow-origin": "*" },
            body: fs.readFileSync(path.join(PIANO, note[1])),
          });
        }
        return /^https?:/.test(req.url()) ? req.abort() : req.continue();
      });
      await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
      await page.waitForFunction(
        () => document.querySelector(".mdm-paper svg .abcjs-ledger") && document.querySelector(".mdm-audio .abcjs-midi-start"),
        { timeout: 20000 }
      );
      // Every ledger line by its note: whether it is lit, and its paint; and
      // the notes abcjs has marked.
      const read = () =>
        page.evaluate(() => {
          const svg = document.querySelector(".mdm-paper svg");
          const notes = Array.from(svg.querySelectorAll(".abcjs-note"));
          return {
            lines: Array.from(svg.querySelectorAll(".abcjs-ledger"))
              .map((line) => ({
                note: notes.findIndex((n) => (n.mdmLedgers || []).indexOf(line) >= 0),
                lit: line.classList.contains("mdm-ledger--lit"),
                fill: getComputedStyle(line).fill,
              }))
              .sort((a, b) => a.note - b.note)
              .map((l) => [l.note, l.lit, l.fill]),
            marked: Array.from(svg.querySelectorAll(".abcjs-note_selected")).map((el) => notes.indexOf(el)),
          };
        });
      // The note the player has lit, -1 for none.
      const sounding = (index) =>
        page.waitForFunction(
          (index) => {
            const svg = document.querySelector(".mdm-paper svg");
            const notes = Array.from(svg.querySelectorAll(".abcjs-note"));
            return notes.indexOf(svg.querySelector(".abcjs-note.abcjs-note_selected")) === index;
          },
          { timeout: 20000 },
          index
        );
      const still = [[0, false, grey], [2, false, grey], [2, false, grey]];
      assert.deepEqual((await read()).lines, still, name + ": the lines of the C and of the low A, at rest");
      await page.click(".mdm-audio .abcjs-midi-start");
      await sounding(0);
      assert.deepEqual(
        await read(),
        { lines: [[0, true, accent], [2, false, grey], [2, false, grey]], marked: [0] },
        name + ": the sounding C's line is not the one lit"
      );
      await sounding(1);
      assert.deepEqual((await read()).lines, still, name + ": a line stayed lit after its note");
      await sounding(2);
      assert.deepEqual(
        (await read()).lines,
        [[0, false, grey], [2, true, accent], [2, true, accent]],
        name + ": the low A's two lines are not lit with it"
      );
      await sounding(-1);
      assert.deepEqual(await read(), { lines: still, marked: [] }, name + ": a line left lit when the tune was over");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      OPEN_BROWSERS.delete(browser);
    }
  }
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
// reader's Ctrl+P, and the PDF the extension prints with headless Chrome
// unless LaTeX is asked to typeset it (printPage in vscode-mdm/extension.js,
// mdm.pdfEngine).
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
//
// The scale is Chrome's own shrink of a page too wide for its sheet, and not
// a zoom (2026-10-04): a zoom lays the page out again at other pixels, where
// lines broke on other words than on screen, a 1 px rule came out 1.2 px and
// a 2 px one 1.2 too. So the page is laid out at the screen's pixels, for a
// window as wide as the sheet over the scale, and what makes Chrome shrink
// it is a box on the root that wide, the rest clipped at the sheet's edge.
// Read here as that: no zoom, the box, the two clips, and a root as large as
// the screen's (Quarto prints with it at 11pt, which made every length left
// in rem 0.86 of itself). The window is the one a Letter sheet is laid out
// for, 816 px over the scale. That the print then comes out at the scale is
// read in a real one, in the test of the sheets below.
test("on paper the page is scaled, the scores fit and the transport is gone", { skip }, async () => {
  const h = await open();
  await h.page.setViewport({ width: 983, height: 700 });
  const screenRoot = await h.page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  await h.page.emulateMediaType("print");
  const out = await h.page.evaluate(() => {
    const main = document.querySelector("main.content");
    const root = document.documentElement;
    return {
      zoom: getComputedStyle(root).zoom,
      probe: parseFloat(getComputedStyle(root, "::before").width) / window.innerWidth,
      clips: [getComputedStyle(root).overflowX, getComputedStyle(document.body).overflowX],
      root: getComputedStyle(root).fontSize,
      column: getComputedStyle(main).width,
      audio: Array.from(document.querySelectorAll(".mdm-audio")).map(
        (el) => getComputedStyle(el).display
      ),
      cards: Array.from(document.querySelectorAll(".mdm-card")).map((card) => ({
        over: card.scrollWidth - card.clientWidth,
        // What paper draws, which is the slices of a score of several
        // systems (sliceForPrint in mdm.js) and the drawing itself otherwise.
        slack:
          card.querySelector(".mdm-paper").getBoundingClientRect().height -
          (card.querySelector(".mdm-paper > .mdm-slices") || card.querySelector(".mdm-paper > svg")).getBoundingClientRect().height,
      })),
    };
  });
  await h.page.emulateMediaType(null);
  await h.close();

  // 10 TeX pt on a 16 px body, which is what the typeset page sets the same
  // 51.25 em measure at: 10/12 with TeX's point converted to CSS's (800/803).
  // The box is the window over that, so what Chrome shrinks by is that.
  assert.equal(Number(out.zoom), 1, "the page is laid out a second time, at a zoom");
  assert.equal(Math.round((1 / out.probe) * 10000) / 10000, 0.8302, "the box that makes Chrome shrink the page is not the sheet over the scale");
  assert.deepEqual(out.clips, ["clip", "clip"], "what the page holds can make the overflow, and so the scale, its own");
  assert.equal(out.root, screenRoot, "the root is not the size it is on screen");
  assert.equal(screenRoot, "17px", "Quarto's root is no longer 17px, so the line above reads nothing");
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
// extension prints a PDF (printHtmlToPdf in
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

// The ground of a printed page reaches the edges of every sheet. The block
// margin is @page's (see the test above), and a page margin is outside the
// document's canvas, so the ground the body paints stopped at it: each sheet
// came out with a paper-white band over and under the text, a white frame on
// the dark side (seen on 2026-09-19 in an export from a machine with no TeX).
// @page is given the ground in mdm-look.css. Printed the way the extension
// prints a PDF, and read in the raster: the four edges of
// every sheet against the ground the middle of its left edge carries, which
// is the body's. The light fallback is used, a wash of #f6f6f6 and not white,
// so a white margin cannot pass for the ground.
test("on paper the ground reaches the four edges of every sheet", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, () => {
  const para =
    "A paragraph of prose long enough to take a few rows of the measure, " +
    "written again and again so the page runs on to a second sheet and the " +
    "margin at the foot of one and at the head of the next is printed. ";
  fs.writeFileSync(
    path.join(DIR, "ground.mdm"),
    [
      "---",
      'title: "The ground on paper"',
      "format:",
      "  html:",
      "    embed-resources: true",
      "filters:",
      "  - mdm",
      "---",
      "",
      ...Array.from({ length: 24 }, () => para.repeat(3) + "\n"),
    ].join("\n")
  );
  const r = spawnSync(MDM, ["render", "ground.mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const pdf = path.join(DIR, "ground.pdf");
  fs.rmSync(pdf, { force: true });
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
      path.join(DIR, "ground.html"),
    ],
    { encoding: "utf8", timeout: 60000 }
  );
  fs.rmSync(profile, { recursive: true, force: true });
  assert.ok(fs.existsSync(pdf), "Chrome printed nothing: " + c.stderr);

  const prefix = path.join(DIR, "ground-sheet");
  for (const n of fs.readdirSync(DIR)) if (n.startsWith("ground-sheet-")) fs.rmSync(path.join(DIR, n));
  assert.equal(spawnSync("pdftoppm", ["-r", "36", pdf, prefix]).status, 0);
  const sheets = fs.readdirSync(DIR).filter((n) => n.startsWith("ground-sheet-") && n.endsWith(".ppm"));
  assert.ok(sheets.length >= 2, "the page printed on " + sheets.length + " sheet, and the test needs two");
  for (const file of sheets) {
    const { width, height, data } = readPpm(path.join(DIR, file));
    const at = (x, y) => Array.from(data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3));
    const ground = at(0, height >> 1);
    assert.ok(Math.min(...ground) < 250, file + ": the ground is white, so this reads nothing: " + ground);
    const edges = [];
    for (let x = 0; x < width; x++) edges.push([x, 0], [x, height - 1]);
    for (let y = 0; y < height; y++) edges.push([0, y], [width - 1, y]);
    for (const [x, y] of edges) {
      const px = at(x, y);
      assert.ok(
        px.every((v, i) => Math.abs(v - ground[i]) <= 3),
        `${file}: the edge at (${x}, ${y}) is ${px}, where the ground is ${ground}`
      );
    }
  }
});

// ---------- The sheet, its number and the bookmarks (2026-10-02) ----------
//
// The extension's PDF is this page printed (printHtmlToPdf in
// vscode-mdm/extension.js), and what paper adds to a page is read off the
// typeset PDF: the sheet the header names, the number at the foot of every
// sheet, the headings as bookmarks. Each is printed here with the extension's
// own flags, the outline included.
function printPdf(name) {
  const pdf = path.join(DIR, name + ".pdf");
  fs.rmSync(pdf, { force: true });
  const profile = fs.mkdtempSync(path.join(DIR, "profile-"));
  const c = spawnSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      "--generate-pdf-document-outline",
      "--virtual-time-budget=6000",
      "--no-sandbox",
      "--user-data-dir=" + profile,
      "--print-to-pdf=" + pdf,
      path.join(DIR, name + ".html"),
    ],
    { encoding: "utf8", timeout: 60000 }
  );
  fs.rmSync(profile, { recursive: true, force: true });
  assert.ok(fs.existsSync(pdf), "Chrome printed nothing: " + c.stderr);
  return pdf;
}

// Every word poppler finds in a PDF, with the sheet it is on, in points from
// the head of the sheet.
function pdfWords(pdf) {
  const out = spawnSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8" }).stdout;
  const words = [];
  out.split("<page ").slice(1).forEach((sheet, i) => {
    const boxes = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
    for (const m of sheet.matchAll(boxes)) {
      words.push({ sheet: i + 1, x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], text: m[5] });
    }
  });
  return words;
}

function sheetSize(pdf) {
  const info = spawnSync("pdfinfo", [pdf], { encoding: "utf8" }).stdout;
  const m = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info);
  return { width: +m[1], height: +m[2] };
}

// A document in the editor's own face and justification, which a render of
// bin/mdm does not pass the way an export from the toolbar does.
function sheetDoc(name, header, body) {
  fs.writeFileSync(
    path.join(DIR, name + ".mdm"),
    [
      "---",
      'title: "' + name + '"',
      "mdm-text-font: roman",
      "mdm-text-align: justify",
      ...header,
      "filters:",
      "  - mdm",
      "---",
      "",
      body,
      "",
    ].join("\n")
  );
  const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout + r.stderr;
}

const HTML_ALONE = ["format:", "  html:", "    embed-resources: true"];

// The sheet the header names (paper_size in mdm.lua): `papersize` under
// `format: pdf:`, where example.mdm keeps its PDF options and where the
// typeset PDF reads it, or at the top of the header; with neither, Letter,
// which is LaTeX's own default; with a name the page does not know, Letter
// and a warning. On a sheet narrower than the measure the measure is TeX's,
// the sheet less 3 cm, with the type at its size: Chrome shrank the whole
// column onto an A5 otherwise, a word 0.80 of its width on Letter. A4 keeps
// the editor's measure, as Letter does (the measure in mdm-look.css's print
// rules), so the two text blocks are one width.
test("on paper the sheet is the one the header names, and a narrow one keeps the type at its size", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, () => {
  const body = "A paragraph of prose long enough to run over a few rows of the measure. ".repeat(14);
  const logs = {
    "sheet-pdf-a4": sheetDoc("sheet-pdf-a4", HTML_ALONE.concat(["  pdf:", "    papersize: a4"]), body),
    "sheet-top-a5": sheetDoc("sheet-top-a5", ["papersize: a5"].concat(HTML_ALONE), body),
    "sheet-none": sheetDoc("sheet-none", HTML_ALONE, body),
    "sheet-odd": sheetDoc("sheet-odd", ["papersize: foolscap"].concat(HTML_ALONE), body),
  };
  const sheets = {};
  for (const name of Object.keys(logs)) {
    const pdf = printPdf(name);
    const words = pdfWords(pdf).filter((w) => w.sheet === 1 && w.y1 < 700);
    sheets[name] = {
      size: sheetSize(pdf),
      left: Math.min(...words.map((w) => w.x0)),
      right: Math.max(...words.map((w) => w.x1)),
      word: words.find((w) => w.text === "paragraph"),
    };
  }
  const near = (a, b, within) => Math.abs(a - b) <= within;
  // One px of the document on paper: 10 TeX pt for 16 px (the scale of the
  // print rules of mdm-look.css).
  const PT = 0.75 * (10 / 12) * (800 / 803);
  const is = (name, width, height) =>
    assert.ok(
      near(sheets[name].size.width, width, 0.1) && near(sheets[name].size.height, height, 0.1),
      name + " was printed on " + JSON.stringify(sheets[name].size) + ", not " + width + " by " + height
    );
  // Chrome's A4 is 594.96 by 841.92 pt and its A5 420 by 594.96.
  is("sheet-pdf-a4", 594.96, 841.92);
  is("sheet-top-a5", 420, 594.96);
  is("sheet-none", 612, 792);
  is("sheet-odd", 612, 792);
  assert.match(
    logs["sheet-odd"],
    /papersize foolscap is not a sheet the printed page knows/,
    "a sheet the page does not know was left to the browser without a word"
  );
  const measure = (name) => sheets[name].right - sheets[name].left;
  const wide = (name) => sheets[name].word.x1 - sheets[name].word.x0;
  // The print is the page at the scale: on Letter, which is what Chrome
  // prints on when the header names no sheet, the editor's 820 px to a
  // twentieth of a point.
  assert.ok(
    near(measure("sheet-none"), 820 * PT, 0.05),
    "Letter sets a measure of " + measure("sheet-none").toFixed(2) + " pt, and 820 px at the scale are " + (820 * PT).toFixed(2)
  );
  // And A4 the same measure in the document's own pixels, each sheet read by
  // its own word: on a sheet the header names in millimetres, Chrome's pixels
  // for the sheet and the paper's are about one apart, and the shrink, which
  // is the one divided by the other, comes out that much large: 0.13 % on A4
  // (a measure of 511.24 pt for Letter's 510.59) and 0.18 % on A5, measured
  // 2026-10-04. In px of the document that cancels, and the type is held to
  // three thousandths of its size.
  const px = (name) => (measure(name) / wide(name)) * (wide("sheet-none") / PT);
  assert.ok(
    near(px("sheet-pdf-a4"), 820, 0.3),
    "A4 sets a measure of " + px("sheet-pdf-a4").toFixed(2) + " px of the document, and Letter one of " + px("sheet-none").toFixed(2)
  );
  assert.ok(
    near(wide("sheet-pdf-a4") / wide("sheet-none"), 1, 0.003),
    "a word is " + wide("sheet-pdf-a4").toFixed(2) + " pt wide on A4 and " + wide("sheet-none").toFixed(2) + " on Letter"
  );
  const a5 = sheets["sheet-top-a5"];
  assert.ok(
    near(measure("sheet-top-a5"), 420 - 85.04, 1.5),
    "the A5 measure is " + measure("sheet-top-a5").toFixed(2) + " pt, where the sheet less 3 cm is 334.96"
  );
  assert.ok(near(a5.left, 420 - a5.right, 1), "the A5 text block is not centred: " + a5.left + " to " + a5.right);
  // The type at its size, to the three thousandths the shrink is good for on
  // a sheet the header names (above); left to Chrome it was 0.80.
  assert.ok(
    near(wide("sheet-top-a5") / wide("sheet-none"), 1, 0.003),
    "a word is " + wide("sheet-top-a5").toFixed(2) + " pt wide on A5 and " + wide("sheet-none").toFixed(2) + " on Letter"
  );
});

// A line of the printed PDF ends on the word the editor ends it on, which is
// the test the export rule is stated in and was only ever run on the page.
// While the sheet was scaled with a `zoom`, the page was laid out a second
// time at 0.83 of its pixels and a row that fitted or failed by a hair
// changed sides: 6 of 2,282 row endings over 400 paragraphs of prose, and of
// the first 120 printed, 5 of 674 against the editor (2026-10-04). These are
// three of the paragraphs it happened in: twelve words 820.047 px long
// against the measure's 820 on screen and 680.750 against 680.766 under the
// zoom, and two out of that corpus. The sheet is now the page as it is laid
// out for the screen, shrunk by Chrome as it prints (the print rules of
// mdm-look.css), so there is one layout and its lines are the editor's.
const PAPER_PROSE = [
  "We first construct a family of vector fields whose fixed points can be placed in advance. Let the velocity be assigned at a state, and build the field from two ingredients: a scalar function, which governs motion along one distinguished coordinate and determines where fixed points can occur, and a matrix-valued function, which governs motion in the remaining coordinates and determines the local behavior around those points. Separating the distinguished coordinate from the remaining ones gives the compact form that the rest of the text relies on, written out in full below.",
  "Package of feat markdown-editor that owes it the runner reports it without failing the run and. The fix takes the mark off in its own commit cases passing and owed at the start of the branch. Headings emphasis strikethrough links autolinks a quote bullets tasks, a code card a table inline and display. Maths and a callout pass sub sup, the stripped space of. A code span escapes entities reference links and bare brackets the margin number of a rule. Nested quote bars computed list numbers the, bullet of an item that opens a rule and empty.",
  "Title where the editor showed YAML What is decided, in it each with. Its test The block is the page's TitleWidget draws the title, the subtitle the names and the date. Where Quarto's title block has them, at the sizes and with the spaces measured on the export the editor's sheet states them. The title block in style css html test js sets the. Two side by side on example mdm part by part. And in either.",
];

// The rows of one sheet of a PDF, each as its words in reading order.
function pdfRows(words) {
  const rows = [];
  for (const w of words.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - w.y0) < 3) row.words.push(w);
    else rows.push({ y: w.y0, words: [w] });
  }
  rows.forEach((row) => row.words.sort((a, b) => a.x0 - b.x0));
  return rows;
}

test("on paper every line ends on the word the editor ends it on", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const text = PAPER_PROSE.join("\n\n") + "\n";
  fs.writeFileSync(
    path.join(DIR, "paper-lines.mdm"),
    "---\nmdm-text-font: roman\nmdm-text-align: justify\nfilters:\n  - mdm\n---\n\n" + text
  );
  const r = spawnSync(MDM, ["render", "paper-lines.mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);

  const h = await openEditor({ text, scores: 0, seed: { settings: { textFont: "roman", textAlign: "justify", hyphenation: "none", theme: "light" } }, height: 1400 });
  let editor;
  try {
    await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1400 });
    await h.page.evaluate(async () => {
      await document.fonts.ready;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    await h.page.mouse.click(2, 2);
    await h.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    editor = await h.page.evaluate(
      (read) => eval("(" + read + ")")(Array.from(document.querySelectorAll("#app .cm-line")).filter((l) => l.textContent.trim().length > 60)),
      LINE_ENDS
    );
  } finally {
    await h.close();
  }
  const plain = (word) => word.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const editorEnds = PAPER_PROSE.map((para) => {
    const found = editor[para.slice(0, 30)] || Object.values(editor).find((e) => plain(e.text).startsWith(para.slice(0, 20)));
    assert.ok(found, "the editor drew no paragraph that opens " + JSON.stringify(para.slice(0, 30)));
    return found.ends.map(plain);
  });
  assert.ok(editorEnds.every((ends) => ends.length >= 4), "a paragraph is under five rows in the editor: " + JSON.stringify(editorEnds));

  const words = pdfWords(printPdf("paper-lines"));
  assert.equal(Math.max(...words.map((w) => w.sheet)), 1, "the fixture runs onto a second sheet");
  const foot = sheetSize(path.join(DIR, "paper-lines.pdf")).height - 70.87;
  const rows = pdfRows(words.filter((w) => w.y1 < foot));
  // The rows of each paragraph: from the one that opens on its first word to
  // the one that ends on its last.
  const paperEnds = PAPER_PROSE.map((para) => {
    const first = para.split(" ")[0];
    const last = para.split(" ").pop();
    const from = rows.findIndex((row) => plain(row.words[0].text) === first);
    assert.ok(from !== -1, "the PDF has no row that opens on " + first);
    const to = rows.findIndex((row, i) => i >= from && plain(row.words[row.words.length - 1].text) === last);
    assert.ok(to !== -1, "the PDF has no row that ends on " + last);
    return rows.slice(from, to).map((row) => plain(row.words[row.words.length - 1].text));
  });
  PAPER_PROSE.forEach((para, i) => {
    assert.deepEqual(
      paperEnds[i],
      editorEnds[i],
      "the paragraph that opens " + JSON.stringify(para.slice(0, 24)) + " breaks on other words on paper than in the editor"
    );
  });
});

// A rule on paper is as thick as the editor draws it. Chrome draws a border
// in whole pixels of the layout it is in, and under the zoom the sheet used
// to be scaled with that layout was 0.83 of the document's: a hairline of
// 1 px came out 1.2045 px of the document, the 2 px of a `***` came out
// 1.2045 as well and the 3 px bar of a quotation 2.409 (computed under print
// media, and 1.25, 1.00 and 2.33 in rasters of the PDF, 2026-10-04). Read
// here in the paper itself at eight pixels to one of the document: the line
// under a heading, the rule, and the bar.
test("on paper a rule is as thick as the editor draws it", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, () => {
  sheetDoc("paper-rules", HTML_ALONE, [
    "## Heading over a line",
    "Before, a line of prose.",
    "***",
    "> Quoted, a line of prose beside its bar.",
    "After, a line of prose.",
  ].join("\n\n"));
  const pdf = printPdf("paper-rules");
  const words = pdfWords(pdf);
  const at = (text) => {
    const w = words.find((x) => x.text === text);
    assert.ok(w, "the PDF has no word " + text);
    return w;
  };
  // Eight pixels of the picture to one of the document.
  const PT = 0.75 * (10 / 12) * (800 / 803);
  const DPI = (72 / PT) * 8;
  const crop = (name, x0, y0, x1, y1) => {
    const prefix = path.join(DIR, "paper-rules-" + name);
    const px = (pt) => Math.round((pt * DPI) / 72);
    const c = spawnSync("pdftoppm", [
      "-r", String(DPI), "-f", "1", "-l", "1", "-singlefile",
      "-x", String(px(x0)), "-y", String(px(y0)), "-W", String(px(x1 - x0)), "-H", String(px(y1 - y0)),
      pdf, prefix,
    ]);
    assert.equal(c.status, 0, String(c.stderr));
    return readPpm(prefix + ".ppm");
  };
  // The runs of pixels that are not the ground, along one axis of a crop.
  const runs = (img, across) => {
    const { width, height, data } = img;
    const level = (x, y) => data[(y * width + x) * 3] + data[(y * width + x) * 3 + 1] + data[(y * width + x) * 3 + 2];
    const n = across ? width : height;
    const m = across ? height : width;
    const line = [];
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < m; j++) sum += across ? level(i, j) : level(j, i);
      line.push(sum / m);
    }
    const ground = line.slice().sort((a, b) => a - b)[line.length >> 1];
    const peak = Math.max(...line.map((v) => Math.abs(v - ground)));
    const out = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && Math.abs(line[i] - ground) > peak / 2;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        out.push((i - start) / 8);
        start = -1;
      }
    }
    assert.ok(peak > 6, "nothing is drawn in the crop");
    return out;
  };
  const left = (612 - 820 * PT) / 2;
  const heading = at("Heading");
  const before = at("Before,");
  const quoted = at("Quoted,");
  const after = at("After,");
  // Under the heading's letters and over the next line's, clear of both: the
  // hairline alone.
  const hair = runs(crop("hair", left + 300 * PT, heading.y1 - 2, left + 400 * PT, before.y0 - 1), false);
  assert.deepEqual(hair.length, 1, "between the heading and the text there is not one line: " + JSON.stringify(hair));
  assert.ok(Math.abs(hair[0] - 1) <= 0.2, "the line under a heading is " + hair[0] + " px thick on paper and 1 in the editor");
  // Between the two lines of prose the rule stands alone.
  const rule = runs(crop("rule", left + 300 * PT, before.y1 + 2, left + 400 * PT, quoted.y0 - 2), false);
  assert.deepEqual(rule.length, 1, "between the text and the quotation there is not one rule: " + JSON.stringify(rule));
  assert.ok(Math.abs(rule[0] - 2) <= 0.2, "the rule is " + rule[0] + " px thick on paper and 2 in the editor");
  // Left of the quoted words, across the bar.
  const bar = runs(crop("bar", left - 3 * PT, quoted.y0 + 2, left + 12 * PT, quoted.y1 - 2), true);
  assert.deepEqual(bar.length, 1, "left of the quoted words there is not one bar: " + JSON.stringify(bar));
  assert.ok(Math.abs(bar[0] - 3) <= 0.2, "the bar of a quotation is " + bar[0] + " px wide on paper and 3 in the editor");
  assert.ok(after.y0 > quoted.y1, "the fixture is not in the order it was written in");
});

// The type on paper is the sheet's size and not the document's. Chrome
// shrinks a page too wide for its sheet, which is what the print's scale is
// made of now, and it shrank a page for whatever was too wide in it: a word
// of 159 letters or a table of fourteen columns made every word of its
// document 0.83 or 0.67 of its size, with the block still cut at the sheet's
// edge (2026-10-04). What the page holds is clipped at the sheet's edge, so
// the scale is the same whatever is in it. A raw block 3000 px wide is the
// thing too wide here, since nothing the page lays out itself is any longer.
// And the title block at the size the page has it on screen: Quarto prints
// with the root at 11pt for the screen's 17 px, and a subtitle, which it
// sizes in rem, came out 0.86 of itself beside prose that kept its size.
test("on paper the type is at the sheet's scale whatever the document holds, and the title block as large as on screen", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, async () => {
  const prose = "Holdfast is the word to read, in a paragraph of prose long enough to run over a row of the measure and on.";
  const subtitle = ['subtitle: "Undertitle of the fixture"'].concat(HTML_ALONE);
  sheetDoc("paper-hold", subtitle, prose);
  sheetDoc("paper-hold-wide", subtitle, prose + '\n\n<div style="width: 3000px; height: 8px; background: #888"></div>\n\nAfter the block.');
  const PT = 0.75 * (10 / 12) * (800 / 803);
  const wide = (name, text) => {
    const w = pdfWords(printPdf(name)).find((x) => x.text === text);
    assert.ok(w, name + ": the PDF has no word " + text);
    return w.x1 - w.x0;
  };
  const screen = await readSheetDoc("paper-hold", null, () => {
    const word = (root, text) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.data.indexOf(text);
        if (i === -1) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + text.length);
        return range.getBoundingClientRect().width;
      }
      return null;
    };
    return {
      prose: word(document.querySelector("main.content"), "Holdfast"),
      subtitle: word(document.querySelector(".subtitle"), "Undertitle"),
      overflows: document.documentElement.scrollWidth,
    };
  });
  const plainProse = wide("paper-hold", "Holdfast");
  const plainSub = wide("paper-hold", "Undertitle");
  assert.ok(
    Math.abs(plainProse - screen.prose * PT) <= 0.05,
    "a word of the prose is " + plainProse.toFixed(2) + " pt wide on paper and " + (screen.prose * PT).toFixed(2) + " at the scale"
  );
  assert.ok(
    Math.abs(plainSub - screen.subtitle * PT) <= 0.05,
    "the subtitle's word is " + plainSub.toFixed(2) + " pt wide on paper and " + (screen.subtitle * PT).toFixed(2) + " at the scale of what the page draws"
  );
  const held = wide("paper-hold-wide", "Holdfast");
  assert.ok(
    Math.abs(held - plainProse) <= 0.02,
    "beside a block wider than the sheet a word is " + held.toFixed(2) + " pt wide, and " + plainProse.toFixed(2) + " without it"
  );
});

// Nothing of the document is left off its paper. A screen scrolls a block
// the column cannot hold, in the editor and on the page alike; a sheet has
// nothing to scroll, and what stood past the column was not on it, nor in
// the text of the PDF, with nothing to say so: 31 letters of a word of 159,
// 67 of the 162 characters of a line of code, 10 of the 28 terms of a
// display equation, the fourteenth column of a table (2026-10-04). The print
// rules of mdm-look.css keep each: a word and a line of code go on in
// another row, and a table and a display equation are drawn smaller, whole,
// at what the measure has room for over what they need
// (resources/mdm-paper.js measures that as the print begins). The prose
// beside them keeps its size, and on screen each block still scrolls in its
// own box and the long word breaks on the letter the editor breaks it on.
const WIDE_DOC = (() => {
  const columns = ["Chord", "Root", "Third", "Fifth", "Seventh", "Ninth", "Eleventh", "Thirteenth", "Inversion", "Voicing", "Function", "Cadence", "Register", "Fingering"];
  const terms = Array.from({ length: 28 }, (_, i) => "a_{" + (i + 1) + "}").join(" + ");
  const word = "Donaudampfschifffahrtsgesellschaftskapitaensmuetze".repeat(3) + "ENDOFWORD";
  return {
    word: word,
    text: [
      "Measureword, a paragraph of prose to read the type's size by, long enough to wrap onto a second row of the measure.",
      "Longword paragraph with one word too long for the column: " + word + " and words after it.",
      "| " + columns.join(" | ") + " |\n|" + columns.map(() => "---").join("|") + "|\n" +
        [1, 2, 3].map((r) => "| " + columns.map((c) => c.toLowerCase() + r).join(" | ") + " |").join("\n"),
      "Aftertable, a line of prose.",
      "$$\n" + terms + " = z\n$$",
      "Aftereq, a line of prose.",
      "$$\n" + terms + " = z\n$$ {#eq-wide}",
      "Afternum, a line of prose.",
      "```python\nx = " + Array.from({ length: 29 }, (_, i) => "term_" + String(i + 1).padStart(2, "0")).join(" + ") + "  # ENDOFLINE\n```",
      "Aftercode, a line of prose.",
      // And a table inside a list item, where the room it has is the
      // column's less the item's indent.
      "- An item that holds a table:\n\n  | " + columns.join(" | ") + " |\n  |" + columns.map(() => "---").join("|") + "|\n  | " +
        columns.map((c) => c.toLowerCase() + "item").join(" | ") + " |",
      "Afteritem, a line of prose.",
    ].join("\n\n") + "\n",
  };
})();

test("on paper nothing of the document is left off the sheet: a long word and a long line of code go on in another row, and a table and an equation too wide are drawn smaller, whole", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const PT = 0.75 * (10 / 12) * (800 / 803);
  sheetDoc("paper-wide", HTML_ALONE, WIDE_DOC.text);
  sheetDoc("paper-wide-ref", HTML_ALONE, WIDE_DOC.text.split("\n\n")[0]);
  const words = pdfWords(printPdf("paper-wide"));
  const texts = words.map((w) => w.text);
  const right = 612 - (612 - 820 * PT) / 2;
  // Whole: the end of the word, the last column of the table, the last term
  // and the right-hand side of each equation, the end of the line of code.
  assert.ok(texts.some((t) => t.endsWith("ENDOFWORD")), "the end of the long word is not on the paper");
  for (const cell of ["chord1", "fingering1", "fingering3", "chorditem", "fingeringitem"]) {
    assert.ok(texts.includes(cell), "the table's cell " + cell + " is not on the paper");
  }
  assert.equal(texts.filter((t) => t === "28").length, 2, "the last term of an equation is not on the paper");
  assert.equal(texts.filter((t) => t === "z").length, 2, "the right-hand side of an equation is not on the paper");
  assert.ok(texts.includes("(1)"), "the number of the numbered equation is not on the paper");
  assert.ok(texts.includes("ENDOFLINE"), "the end of the line of code is not on the paper");
  // And inside the column, the number of the equation at its right edge.
  const over = words.filter((w) => w.sheet === 1 && w.x1 > right + 0.5 && w.text.trim());
  assert.deepEqual(over.map((w) => w.text), [], "words stand past the column's right edge, " + right.toFixed(1) + " pt");
  const number = words.find((w) => w.text === "(1)");
  assert.ok(Math.abs(number.x1 - right) <= 0.6, "the number of the equation is not at the column's edge: " + number.x1.toFixed(2));
  // The prose at its size, and so is the number: what is drawn smaller is
  // the block that needed it and nothing else.
  const wide = (list, text) => {
    const w = list.find((x) => x.text === text);
    return w.x1 - w.x0;
  };
  const ref = pdfWords(printPdf("paper-wide-ref"));
  assert.ok(
    Math.abs(wide(words, "Measureword,") - wide(ref, "Measureword,")) <= 0.02,
    "beside the wide blocks a word of the prose is " + wide(words, "Measureword,").toFixed(2) + " pt wide and " + wide(ref, "Measureword,").toFixed(2) + " without them"
  );
  const cell = words.find((w) => w.text === "chord1");
  const prose = words.find((w) => w.text === "Aftertable,");
  assert.ok(
    cell.y1 - cell.y0 < 0.9 * (prose.y1 - prose.y0),
    "the table of fourteen columns is not drawn smaller: a cell's word is " + (cell.y1 - cell.y0).toFixed(2) + " pt tall and the prose's " + (prose.y1 - prose.y0).toFixed(2)
  );

  // On screen: each wide block scrolls in a box of its own and the page does
  // not, a cell of the squeezed table is not broken inside a word, and the
  // long word breaks on the letters the editor breaks it on.
  const screen = await readSheetDoc("paper-wide", null, new Function(
    "const ends = (" + LINE_ENDS + ")(Array.from(document.querySelectorAll('main.content p')).filter((p) => p.textContent.startsWith('Longword')));" +
    "const table = document.querySelector('main.content table');" +
    "const pre = document.querySelector('main.content pre.sourceCode');" +
    "const eq = document.querySelector('main.content .katex-display');" +
    "return {" +
    " page: document.documentElement.scrollWidth - document.documentElement.clientWidth," +
    " table: table.scrollWidth - table.clientWidth, code: pre.scrollWidth - pre.clientWidth, eq: eq.scrollWidth - eq.clientWidth," +
    " cell: table.rows[1].cells[7].getBoundingClientRect().height, row: table.rows[1].cells[0].getBoundingClientRect().height," +
    " ends: Object.values(ends)[0].ends, measured: table.style.getPropertyValue('--mdm-natural') };"
  ));
  assert.ok(screen.page <= 0, "the page scrolls sideways by " + screen.page + " px");
  assert.ok(screen.table > 0 && screen.code > 0 && screen.eq > 0, "a block the column cannot hold does not scroll in its own box: " + JSON.stringify(screen));
  assert.equal(screen.cell, screen.row, "a cell of the squeezed table is broken inside a word");
  assert.equal(screen.measured, "", "the page was measured for paper while it was only read");
  const h = await openEditor({ text: WIDE_DOC.text, scores: 0, seed: { settings: { textFont: "roman", textAlign: "justify", hyphenation: "none", theme: "light" } }, height: 1400 });
  let editor;
  try {
    await h.page.setViewport({ width: 1200, height: 1400 });
    await h.page.evaluate(async () => {
      await document.fonts.ready;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    await h.page.mouse.click(2, 2);
    await h.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    editor = await h.page.evaluate(
      (read) => Object.values(eval("(" + read + ")")(Array.from(document.querySelectorAll("#app .cm-line")).filter((l) => l.textContent.startsWith("Longword"))))[0].ends,
      LINE_ENDS
    );
  } finally {
    await h.close();
  }
  assert.ok(editor.length >= 2, "the long word does not wrap in the editor: " + JSON.stringify(editor));
  assert.deepEqual(screen.ends, editor, "the long word breaks elsewhere on the page than in the editor");
});

// A picture and its caption on one sheet. With no rule to hold them, a
// picture that just fitted at the foot of a sheet left its caption to open
// the next one (the circle of fifths of examples/music-class/, 2026-10-04).
// Five pictures, each after one line more of prose than the last, so that
// one of them comes to the foot of its sheet with no room under it: a sheet
// is opened by hand before each, and the picture is a magenta slab found in
// a raster of the PDF.
test("on paper a picture and its caption stay on one sheet", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, () => {
  fs.writeFileSync(
    path.join(DIR, "slab.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="150"><rect width="400" height="150" fill="#ff00ff"/></svg>\n'
  );
  const lines = [16, 17, 18, 19, 20];
  const parts = [];
  lines.forEach((count, g) => {
    if (g > 0) parts.push('<div style="break-before: page"></div>');
    for (let n = 1; n <= count; n++) parts.push("Filler line " + n + " of group " + (g + 1) + ".");
    parts.push("![Captionword of group " + (g + 1) + ", a caption long enough to be a line.](slab.svg)");
    parts.push("Endgroup" + (g + 1) + ".");
  });
  sheetDoc("paper-figure", HTML_ALONE, parts.join("\n\n"));
  const pdf = printPdf("paper-figure");
  const words = pdfWords(pdf);
  const captions = words.filter((w) => w.text === "Captionword");
  assert.equal(captions.length, lines.length, "the PDF does not hold the five captions");
  const prefix = path.join(DIR, "paper-figure-sheet");
  for (const f of fs.readdirSync(DIR)) if (f.startsWith("paper-figure-sheet-")) fs.rmSync(path.join(DIR, f));
  assert.equal(spawnSync("pdftoppm", ["-r", "36", pdf, prefix]).status, 0);
  const slabs = [];
  fs.readdirSync(DIR)
    .filter((f) => f.startsWith("paper-figure-sheet-") && f.endsWith(".ppm"))
    .sort((a, b) => parseInt(a.match(/-(\d+)\.ppm$/)[1], 10) - parseInt(b.match(/-(\d+)\.ppm$/)[1], 10))
    .forEach((file) => {
      const { width, height, data } = readPpm(path.join(DIR, file));
      let last = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 3;
          if (data[i] > 240 && data[i + 1] < 30 && data[i + 2] > 240) {
            last = y;
            break;
          }
        }
      }
      // The foot of the slab, in points from the head of its sheet.
      if (last >= 0) slabs.push({ sheet: parseInt(file.match(/-(\d+)\.ppm$/)[1], 10), foot: (last * 72) / 36 });
    });
  assert.equal(slabs.length, lines.length, "the PDF does not hold the five pictures, each on a sheet of its own: " + JSON.stringify(slabs));
  const foot = sheetSize(pdf).height - 70.87;
  // One of the five has to be the case: a picture whose caption would not
  // have fitted under it had it stayed where the prose left it. It is the
  // one that opens a sheet instead.
  assert.ok(
    slabs.some((slab) => slab.foot < 250),
    "no picture was sent on to the next sheet, so the fixture puts none at the foot of one: " + JSON.stringify(slabs)
  );
  slabs.forEach((slab, g) => {
    assert.equal(
      captions[g].sheet,
      slab.sheet,
      "the picture of group " + (g + 1) + " is on sheet " + slab.sheet + " and its caption on sheet " + captions[g].sheet
    );
    assert.ok(captions[g].y0 > slab.foot && captions[g].y1 < foot, "the caption of group " + (g + 1) + " is not under its picture");
  });
});

// A callout in the editor's colours, on the page and on paper. It was
// Quarto's box as Quarto dresses it for a light page, on every side: on the
// dark one its title stood in rgb(185, 185, 185) on a band of rgb(201, 209,
// 221), 1.28 to 1, with a pale line round the box; on the light one a bar in
// Bootstrap's colours where the editor has its own five; and its text at
// 0.9rem (2026-10-04). The five colours are read out of the editor's own
// sheet, so the page follows it.
test("a callout is in the editor's colours on the page, its text at the size of the prose, on either side", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, async () => {
  const kinds = ["note", "tip", "warning", "important", "caution"];
  const sheet = fs.readFileSync(path.join(ROOT, "vscode-mdm", "media", "style.css"), "utf8");
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const editors = {};
  for (const kind of kinds) {
    const m = new RegExp("--mdm-co-" + kind + ":\\s*(#[0-9a-f]{6})").exec(sheet);
    assert.ok(m, "the editor's sheet names no colour for a " + kind);
    editors[kind] = rgb(m[1]);
  }
  const text =
    "Overcallout, a line of prose.\n\n" +
    kinds.map((kind) => "::: {.callout-" + kind + "}\nBody" + kind + " is the text of this one.\n:::").join("\n\n") +
    "\n\nUndercallout, a line of prose.\n";
  const PT = 0.75 * (10 / 12) * (800 / 803);
  for (const side of ["light", "dark"]) {
    const name = "callouts-" + side;
    fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
    const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html", "-M", "mdm-text-font:roman", "-M", "mdm-look:" + side], { cwd: DIR, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const read = await readSheetDoc(name, null, () => {
      const ink = getComputedStyle(document.querySelector("main.content p")).color;
      const wide = (text) => {
        const walker = document.createTreeWalker(document.querySelector("main.content"), NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const at = node.data.indexOf(text);
          if (at === -1) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + text.length);
          return range.getBoundingClientRect().width;
        }
        return null;
      };
      return {
        ink: ink,
        prose: getComputedStyle(document.querySelector("main.content p")).fontSize,
        bodyWord: wide("Bodynote"),
        callouts: Array.from(document.querySelectorAll("main.content div.callout")).map((box) => {
          const cs = getComputedStyle(box);
          const header = getComputedStyle(box.querySelector(".callout-header"));
          return {
            bar: cs.borderLeftWidth + " " + cs.borderLeftStyle + " " + cs.borderLeftColor,
            frame: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth].join(" "),
            ground: cs.backgroundColor,
            header: header.backgroundColor + " " + header.color + " " + header.opacity,
            body: getComputedStyle(box.querySelector(".callout-body p")).fontSize + " " + getComputedStyle(box.querySelector(".callout-body p")).color,
          };
        }),
      };
    });
    assert.equal(read.callouts.length, kinds.length, side + ": the page's callouts");
    kinds.forEach((kind, i) => {
      const c = read.callouts[i];
      const [red, green, blue] = editors[kind];
      const where = side + ", " + kind + ": " + JSON.stringify(c);
      assert.equal(c.bar, "3px solid rgb(" + red + ", " + green + ", " + blue + ")", "the bar, " + where);
      assert.equal(c.frame, "0px 0px 0px", "a frame round the callout, " + where);
      const mix = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+) \/ 0\.05\)$/.exec(c.ground);
      assert.ok(mix, "the ground is not its kind's colour at 5 %, " + where);
      assert.deepEqual(mix.slice(1, 4).map((v) => Math.round(Number(v) * 255)), editors[kind], "the ground's colour, " + where);
      assert.equal(c.header, "rgba(0, 0, 0, 0) " + read.ink + " 1", "the row of its title is not on the callout's own ground, in the ink, " + where);
      assert.equal(c.body, read.prose + " " + read.ink, "its text is not the prose's, " + where);
    });
    // And on paper, the text at the size it has on the page.
    const word = pdfWords(printPdf(name)).find((w) => w.text === "Bodynote");
    assert.ok(word, side + ": the PDF has no word Bodynote");
    assert.ok(
      Math.abs(word.x1 - word.x0 - read.bodyWord * PT) <= 0.05,
      side + ": a word of a callout is " + (word.x1 - word.x0).toFixed(2) + " pt wide on paper and " + (read.bodyWord * PT).toFixed(2) + " at the scale"
    );
  }
});

// Every sheet carries its number at its foot, as the typeset PDF prints it:
// centred, in the face and at the size of the prose, and its baseline
// 45.25 pt over the foot of the sheet, which is TeX's \footskip under the
// lowest baseline a sheet has here (the @page rule of mdm-look.css's print
// rules). The face and the size are poppler's box of the digit, which is a
// digit of the prose's own when both are the same; the height is read in the
// raster, where the lowest ink on a sheet is the foot of its number.
test("on paper every sheet carries its number at its foot, in the face and at the size of the prose", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, () => {
  const para =
    "Row 2 of a paragraph long enough to take a few rows of the measure, written again and " +
    "again so the page runs on to more sheets. ";
  sheetDoc("folio", HTML_ALONE, Array.from({ length: 22 }, () => para.repeat(3)).join("\n\n"));
  const pdf = printPdf("folio");
  const { width, height } = sheetSize(pdf);
  // The foot of the text: the @page margin, 2.5 cm on paper.
  const foot = height - 70.87;
  const words = pdfWords(pdf);
  const count = Math.max(...words.map((w) => w.sheet));
  assert.ok(count >= 2, "the page printed on " + count + " sheet, and the test needs two");
  const digit = words.find((w) => w.text === "2" && w.y1 < foot);
  for (let s = 1; s <= count; s++) {
    const under = words.filter((w) => w.sheet === s && w.y0 > foot);
    assert.deepEqual(under.map((w) => w.text), [String(s)], "sheet " + s + " has under its text: " + JSON.stringify(under));
    const n = under[0];
    assert.ok(
      Math.abs((n.x0 + n.x1) / 2 - width / 2) < 0.5,
      "the number of sheet " + s + " stands at " + ((n.x0 + n.x1) / 2).toFixed(2) + " pt, not in the middle"
    );
    assert.ok(
      Math.abs(n.y1 - n.y0 - (digit.y1 - digit.y0)) < 0.05 && (s > 9 || Math.abs(n.x1 - n.x0 - (digit.x1 - digit.x0)) < 0.05),
      "the number of sheet " + s + " is a box of " + (n.x1 - n.x0).toFixed(2) + " by " + (n.y1 - n.y0).toFixed(2) +
        " pt, and a digit of the prose " + (digit.x1 - digit.x0).toFixed(2) + " by " + (digit.y1 - digit.y0).toFixed(2)
    );
  }
  const prefix = path.join(DIR, "folio-sheet");
  for (const f of fs.readdirSync(DIR)) if (f.startsWith("folio-sheet-")) fs.rmSync(path.join(DIR, f));
  assert.equal(spawnSync("pdftoppm", ["-r", "144", pdf, prefix]).status, 0);
  for (const file of fs.readdirSync(DIR).filter((f) => f.startsWith("folio-sheet-")).sort()) {
    const { width: w, height: h, data } = readPpm(path.join(DIR, file));
    let lowest = -1;
    for (let y = h - 1; y >= 0 && lowest < 0; y--) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        if (Math.min(data[i], data[i + 1], data[i + 2]) < 128) {
          lowest = y;
          break;
        }
      }
    }
    const over = ((h - 1 - lowest) * 72) / 144;
    assert.ok(
      Math.abs(over - 45.25) <= 0.75,
      file + ": the number's baseline is " + over.toFixed(2) + " pt over the foot of the sheet, not 45.25"
    );
  }
});

// The roman goes into a printed PDF as the fonts it is. Chrome's PDF writer
// embeds a face with CFF outlines as a Type 3 font, a drawing for each glyph,
// and a viewer fills those as shapes: the prose of the owner's PDF read
// thinner than his editor and thinner than its own equations (2026-10-04; in
// pdf.js 9 % less ink than the editor on one row, 8 % in Chrome's viewer,
// against 1 % and 6 % with the faces embedded as fonts). So a page the
// extension renders to print (`mdm-print-faces: truetype`, which printPage
// passes) comes with the same four faces in TrueType outlines,
// resources/lm/print/, under the names the stylesheet already asks for, and a
// page for the screen keeps the CFF ones the editor draws with, which a
// screen hints to the pixel (ensure_look in mdm.lua). The first four bytes of
// a WOFF2 after its signature say which outlines it carries.
test("on paper the roman's faces are embedded as fonts, from the outlines kept for the print", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, () => {
  const body = "Regular words, *italic words*, **bold words** and ***bold italic words***, enough of each to be set.";
  sheetDoc("faces-print", ["mdm-print-faces: truetype"], body);
  sheetDoc("faces-screen", [], body);
  const FACES = ["Regular", "Italic", "Bold", "BoldItalic"];
  const carried = (name, face) => {
    const libs = path.join(DIR, name + "_files", "libs", "quarto-contrib");
    const roman = fs.readdirSync(libs).find((n) => n.startsWith("mdm-roman"));
    return fs.readFileSync(path.join(libs, roman, "fonts", "LatinModernRoman-" + face + ".woff2"));
  };
  const shipped = (folder, face) =>
    fs.readFileSync(path.join(ROOT, "_extensions", "mdm", "resources", "lm", folder, "LatinModernRoman-" + face + ".woff2"));
  const outlines = (woff2) => woff2.subarray(4, 8).toString("latin1");
  for (const face of FACES) {
    assert.ok(carried("faces-print", face).equals(shipped("print", face)), "the page for the print does not carry the print's " + face);
    assert.ok(carried("faces-screen", face).equals(shipped("fonts", face)), "the page for the screen does not carry the screen's " + face);
    assert.equal(outlines(shipped("print", face)), "\x00\x01\x00\x00", "the print's " + face + " has no TrueType outlines");
    assert.equal(outlines(shipped("fonts", face)), "OTTO", "the screen's " + face + " is not the CFF face the editor draws with");
  }
  const embedded = (name) =>
    spawnSync("pdffonts", [printPdf(name)], { encoding: "utf8" }).stdout
      .split("\n")
      .filter((line) => /LMRoman10-/.test(line))
      .map((line) => ({
        face: /LMRoman10-(\w+)/.exec(line)[1],
        type3: /\bType 3\b/.test(line),
        truetype: /\bTrueType\b/.test(line),
      }));
  const print = embedded("faces-print");
  assert.deepEqual(
    Array.from(new Set(print.map((f) => f.face))).sort(),
    FACES.slice().sort(),
    "the PDF does not hold the four faces: " + JSON.stringify(print)
  );
  assert.deepEqual(
    print.filter((f) => f.type3 || !f.truetype),
    [],
    "a face of the roman went into the PDF as something other than a TrueType font"
  );
  // And why the print has faces of its own: the screen's go in as Type 3. The
  // day this fails, Chrome embeds CFF outlines as fonts, and the print's own
  // faces, with the second render they cost an export of both, can go.
  const screen = embedded("faces-screen");
  assert.ok(
    screen.length >= 4 && screen.every((f) => f.type3),
    "the screen's faces no longer go into a PDF as Type 3: " + JSON.stringify(screen)
  );
});

// The headings are the PDF's bookmarks, each once. A heading that opened a
// sheet came out of Chrome with its words twice in its bookmark ("Heading
// number 5Heading number 5"), which the clip on the headings in mdm-look.css's
// print rules is there for. Thirty sections of different lengths put several
// headings at the head of a sheet (break-after: avoid sends one there
// whenever the paragraph under it does not fit at the foot of the one
// before), and the test says which, so a fixture that stopped doing so fails
// instead of passing on nothing. poppler's pdftohtml reads the outline.
test("on paper the PDF's bookmarks are its headings, each once, the ones that open a sheet included", {
  skip: skip || ((!POPPLER || spawnSync("pdftohtml", ["-v"]).status !== 0) && "needs pdftotext and pdftohtml"),
}, () => {
  const sentence = "A sentence of prose that fills part of a row of the measure, written so the sections differ in length. ";
  const sections = [];
  for (let k = 1; k <= 30; k++) {
    sections.push("## Heading number " + k);
    for (let p = 0; p < 1 + (k % 3); p++) sections.push(sentence.repeat(2 + ((k * 7 + p * 3) % 9)));
  }
  sheetDoc("bookmarks", HTML_ALONE, sections.join("\n\n"));
  const pdf = printPdf("bookmarks");
  const xml = spawnSync("pdftohtml", ["-xml", "-i", "-stdout", "-q", pdf], { encoding: "utf8" }).stdout;
  const items = [...xml.matchAll(/<item page="(\d+)">([^<]*)<\/item>/g)].map((m) => ({ sheet: +m[1], title: m[2] }));
  assert.deepEqual(
    items.map((i) => i.title),
    ["bookmarks"].concat(Array.from({ length: 30 }, (_, k) => "Heading number " + (k + 1))),
    "the bookmarks are not the title and the thirty headings, once each"
  );
  const count = Math.max(...pdfWords(pdf).map((w) => w.sheet));
  const opening = [];
  for (let s = 2; s <= count; s++) {
    const text = spawnSync("pdftotext", ["-layout", "-f", String(s), "-l", String(s), pdf, "-"], { encoding: "utf8" }).stdout;
    const first = text.split("\n").map((l) => l.trim()).find(Boolean) || "";
    const m = /^Heading number (\d+)$/.exec(first);
    if (m) opening.push({ k: +m[1], sheet: s });
  }
  assert.ok(opening.length >= 2, "only " + opening.length + " heading opens a sheet, and the test needs two");
  for (const o of opening) {
    assert.equal(items[o.k].sheet, o.sheet, "the bookmark of heading " + o.k + " does not lead to sheet " + o.sheet + ", which it opens");
  }
});

// A page of the fixtures above, read in a browser of its own: laid out as a
// screen, and read under `media` when one is named, as pageAt reads a page
// with scores.
async function readSheetDoc(name, media, read) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
    defaultViewport: { width: 1200, height: 1200 },
  });
  OPEN_BROWSERS.add(browser);
  try {
    const page = await browser.newPage();
    await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    if (media) await page.emulateMediaType(media);
    return await page.evaluate(read);
  } finally {
    OPEN_BROWSERS.delete(browser);
    await browser.close();
  }
}

// The contents of a document that asks for them (`toc: true`), on paper. The
// page keeps them in its margin and Quarto's print rules take them away, so
// the printed PDF had none where the typeset one opens with them.
// resources/mdm-toc.js puts a copy of the page's own into the flow, under the
// title block or at the head of a document whose header is hidden, and
// mdm-look.css draws it on paper alone and sets it as the typeset PDF sets
// its own, in the ink of the text (the owner's pick, 2026-10-03): the title
// a first-level heading that is no bookmark, the first-level entries in a
// heading's weight, each level 1.5em inside the one above, every entry a
// link. And the page on screen is where it was: the copy stands ahead of the
// first section without being drawn, and the heading that opens the column
// keeps the place it has in a document with no contents.
test("on paper a document that asks for its contents opens with them, set as the typeset PDF sets its own", {
  skip: skip || ((!POPPLER || spawnSync("pdftohtml", ["-v"]).status !== 0) && "needs pdftotext and pdftohtml"),
}, async () => {
  const body = [
    "# The vibrating string",
    "A string fixed at both ends is the first instrument that physics explains completely.",
    "## Partials and their numbers",
    "Each of those shapes is called a mode.",
    "### Counting in cents",
    "A cent is the 1200th part of an octave.",
    "## Intervals as ratios",
    "Two notes an octave apart.",
    "# What the ear does",
    "The ear is not a spectrum analyser.",
    "## Beats and roughness",
    "Two tones a few hertz apart.",
    "# Writing it down",
    "A score is a set of instructions.",
  ].join("\n\n");
  const asked = ["toc: true", "number-sections: true"].concat(HTML_ALONE);
  sheetDoc("toc-shown", asked, body);
  sheetDoc("toc-hidden", ["mdm-front-matter: hidden"].concat(asked), body);
  sheetDoc("toc-none", ["mdm-front-matter: hidden", "number-sections: true"].concat(HTML_ALONE), body);
  const entries = [
    "1 The vibrating string",
    "1.1 Partials and their numbers",
    "1.1.1 Counting in cents",
    "1.2 Intervals as ratios",
    "2 What the ear does",
    "2.1 Beats and roughness",
    "3 Writing it down",
  ];
  for (const [name, head] of [["toc-shown", ["toc-shown"]], ["toc-hidden", []]]) {
    const pdf = printPdf(name);
    const lines = spawnSync("pdftotext", ["-layout", "-f", "1", "-l", "1", pdf, "-"], { encoding: "utf8" })
      .stdout.split("\n")
      .map((l) => l.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    const opens = head.concat(["Table of contents"], entries, [entries[0]]);
    assert.deepEqual(lines.slice(0, opens.length), opens, name + " does not open with its contents");
    const xml = spawnSync("pdftohtml", ["-xml", "-i", "-stdout", "-q", pdf], { encoding: "utf8" }).stdout;
    for (const entry of entries) {
      const words = entry.replace(/^[\d.]+ /, "");
      assert.ok(
        new RegExp('<a href="[^"]*">(?:<b>)?[^<]*' + words).test(xml),
        name + ": the entry of " + words + " is not a link in the PDF"
      );
    }
    assert.deepEqual(
      [...xml.matchAll(/<item page="\d+">([^<]*)<\/item>/g)].map((m) => m[1]),
      head.concat(entries),
      name + ": the bookmarks are not the headings alone"
    );
  }

  const PAPER = () => {
    const main = document.querySelector("main.content");
    const nav = main.querySelector("nav.mdm-print-toc");
    const css = (el, pseudo) => getComputedStyle(el, pseudo || null);
    const title = nav.querySelector(":scope > h1");
    const heading = main.querySelector("section > h1");
    const first = nav.querySelector(":scope > ul > li > a");
    const inner = nav.querySelector("ul ul a");
    // The margin over a first-level heading in the middle of the document:
    // the blank line and the heading's padding.
    const air = css(main.querySelectorAll("section > h1")[1]).marginTop;
    return {
      shown: css(nav).display,
      before: nav.previousElementSibling ? nav.previousElementSibling.id : "",
      role: title.getAttribute("role"),
      titleTop:
        css(title).marginTop === air
          ? "air"
          : Math.abs(parseFloat(css(title).marginTop) - 0.4 * parseFloat(css(title).fontSize)) < 0.01
            ? "padding"
            : css(title).marginTop,
      under: css(heading).marginTop === air,
      titleSize: css(title).fontSize === css(heading).fontSize && css(title).fontWeight === css(heading).fontWeight,
      ink: css(first).color === css(main.querySelector("section p")).color && css(inner).color === css(first).color,
      number: css(nav.querySelector(".header-section-number")).color === css(first).color,
      weights: [css(first).fontWeight, css(inner).fontWeight],
      bullet: css(nav.querySelector("li"), "::before").content,
      steps: [...nav.querySelectorAll("ul")].slice(0, 3).map((ul) => parseFloat(css(ul).paddingLeft) / parseFloat(css(ul).fontSize)),
      ids: nav.querySelectorAll("[id]").length,
    };
  };
  // Under the title block the title of the contents has a heading's air over
  // it; opening the column, the padding alone, as a heading there has.
  for (const [name, before, titleTop] of [["toc-shown", "title-block-header", "air"], ["toc-hidden", "", "padding"]]) {
    const paper = await readSheetDoc(name, "print", PAPER);
    assert.deepEqual(
      paper,
      {
        shown: "block",
        before: before,
        role: "none",
        titleTop: titleTop,
        under: true,
        titleSize: true,
        ink: true,
        number: true,
        weights: ["600", "400"],
        bullet: "none",
        steps: [0, 1.5, 1.5],
        ids: 0,
      },
      name + " on paper"
    );
  }
  const SCREEN = () => {
    const main = document.querySelector("main.content");
    const nav = main.querySelector("nav.mdm-print-toc");
    return {
      copy: nav ? getComputedStyle(nav).display : "",
      tops: [...main.querySelectorAll("section :is(h1, h2, h3), section p")].map(
        (el) => Math.round((el.getBoundingClientRect().top - main.getBoundingClientRect().top) * 100) / 100
      ),
    };
  };
  const withContents = await readSheetDoc("toc-hidden", null, SCREEN);
  const without = await readSheetDoc("toc-none", null, SCREEN);
  assert.equal(withContents.copy, "none", "the copy of the contents is drawn on screen");
  assert.equal(without.copy, "", "a page with no contents was given a copy of them");
  assert.deepEqual(
    withContents.tops,
    without.tops,
    "on screen the headings and paragraphs of a document with contents are not where they are without them"
  );

  // Contents the header asks of the page and not of the PDF: the extension
  // says so to the filter (pdfAsks in extension.js, mdm-print-toc), and the
  // page keeps them in its margin with no copy for the paper.
  sheetDoc("toc-page", ["mdm-front-matter: hidden", "mdm-print-toc: hidden"].concat(asked), body);
  const kept = await readSheetDoc("toc-page", null, () => ({
    margin: !!document.querySelector("nav#TOC"),
    copy: !!document.querySelector("nav.mdm-print-toc"),
  }));
  assert.deepEqual(kept, { margin: true, copy: false }, "contents asked of the page alone");
  const first = spawnSync("pdftotext", ["-layout", "-f", "1", "-l", "1", printPdf("toc-page"), "-"], { encoding: "utf8" })
    .stdout.split("\n")
    .map((l) => l.trim().replace(/\s+/g, " "))
    .find(Boolean);
  assert.equal(first, entries[0], "the paper opens with contents the PDF was not asked for");
});

// A score is broken between two of its staff systems where the sheet runs
// out, as the typeset PDF breaks it ("a long score is cut so a page can break
// between two of its systems" in render.test.js). The drawing is one SVG, which
// Chrome prints whole, so a score longer than what was left of the sheet went
// on to the next one entire and left the foot of the sheet blank under the
// prose (example.mdm printed, 2026-09-19). mdm.js keeps a slice of
// the drawing per system and the print sheet shows the slices in its place.
// Six paragraphs leave room on the first sheet for the first system and not
// for the six (measured: before the slices every one of them printed on the
// second sheet). The part labels are SVG text, which pdftotext reads, so each
// names the sheet its system was printed on, and each is printed once: the
// slices stand in for the drawing on paper and are not printed beside it. On
// screen the slices are never drawn, and on paper the card's fill, padding
// and corners go on each piece, as a card of code's do.
test("on paper a score breaks between two of its systems where the sheet runs out", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, async () => {
  const para =
    "A paragraph of prose long enough to take a few rows of the measure, " +
    "written again so the score under it starts low on the first sheet. ";
  const abc =
    "X:1\nT:Slices\nM:4/4\nL:1/8\nK:Am\n" +
    Array.from({ length: 6 }, (_, i) => "P:sys" + (i + 1) + "\nABcd ef^ga | a^gfe dcBA |").join("\n") +
    "\n";
  fs.writeFileSync(
    path.join(DIR, "slices.mdm"),
    [
      "---",
      'title: "Slices"',
      "format:",
      "  html:",
      "    embed-resources: true",
      "filters:",
      "  - mdm",
      "---",
      "",
      ...Array.from({ length: 6 }, () => para.repeat(3) + "\n"),
      "```abc",
      abc + "```",
      "",
      "After the score.",
      "",
    ].join("\n")
  );
  const r = spawnSync(MDM, ["render", "slices.mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const html = path.join(DIR, "slices.html");
  const pdf = path.join(DIR, "slices.pdf");
  fs.rmSync(pdf, { force: true });
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
      html,
    ],
    { encoding: "utf8", timeout: 60000 }
  );
  fs.rmSync(profile, { recursive: true, force: true });
  assert.ok(fs.existsSync(pdf), "Chrome printed nothing: " + c.stderr);
  const t = spawnSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
  assert.equal(t.status, 0, t.stderr);
  const sheets = t.stdout.split("\f").map((s) => s.match(/sys\d+/g) || []);
  const where = sheets.map((labels, i) => "sheet " + (i + 1) + ": " + labels.join(" ")).join("; ");
  for (let n = 1; n <= 6; n++) {
    const on = sheets.map((labels) => labels.filter((l) => l === "sys" + n).length);
    assert.equal(on.reduce((a, b) => a + b, 0), 1, "sys" + n + " is printed " + on + " times (" + where + ")");
  }
  assert.ok(sheets[0].includes("sys1"), "the score went on to the next sheet whole (" + where + ")");
  assert.ok(!sheets[0].includes("sys6"), "the whole score fit the first sheet, so this breaks nothing (" + where + ")");

  const url = "file://" + html;
  const read = () => {
    const card = document.querySelector(".mdm-card");
    const slices = card.querySelector(".mdm-slices");
    return {
      slices: slices ? slices.querySelectorAll("svg").length : 0,
      shown: slices ? getComputedStyle(slices).display : "",
      whole: getComputedStyle(card.querySelector(".mdm-paper > svg")).display,
      decoration: getComputedStyle(card).boxDecorationBreak,
      // Room in the stack that no slice takes, which an inline SVG leaves
      // under itself for the descenders of a line it is not on.
      gap: slices
        ? slices.getBoundingClientRect().height -
          Array.from(slices.querySelectorAll("svg")).reduce((a, s) => a + s.getBoundingClientRect().height, 0)
        : NaN,
    };
  };
  const screen = await pageAt(url, 1000, read);
  assert.equal(screen.slices, 6, "a slice per system");
  assert.equal(screen.shown, "none", "the slices are drawn on screen");
  assert.notEqual(screen.whole, "none", "the drawing is not drawn on screen");
  const paper = await pageAt(url, 1000, read, null, false, "print");
  assert.equal(paper.shown, "block", "the slices are not drawn on paper");
  assert.equal(paper.whole, "none", "the whole drawing is printed beside its slices");
  assert.ok(Math.abs(paper.gap) <= 0.5, "the slices stand " + paper.gap.toFixed(1) + " px apart in all");
  assert.equal(paper.decoration, "clone", "a piece of a card broken between sheets loses its padding and corners");
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

// The editor draws that block too (TitleWidget in vscode-mdm/media/main.js,
// since 2026-10-03): with the header's source put away, which is how a
// document comes up, the title, the subtitle and the names stand over the
// first line where the page has them. Until then the editor showed either
// nothing of the header or its YAML, and the page opened with a block the
// editor had no word of. The two are set side by side here, part by part and
// in either face: where each part stands under the head of the column, how
// tall it is, the size and the weight it is set at and the width its words
// cover, and where the first paragraph starts under the block. The editor's
// sheet states the page's numbers (style.css, "The title block"), which are
// Quarto's under mdm-look.css, so this is what says a change to either sheet,
// or to Quarto's, has moved one block and not the other.
const TITLE_PARTS = function (root, parts, firstLine) {
  const top = root.getBoundingClientRect().top;
  const inkWidth = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().width;
  };
  const out = {};
  Object.keys(parts).forEach((name) => {
    const el = document.querySelector(parts[name]);
    if (!el) {
      out[name] = null;
      return;
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[name] = {
      top: +(r.top - top).toFixed(1),
      height: +r.height.toFixed(1),
      ink: +inkWidth(el).toFixed(1),
      size: +parseFloat(cs.fontSize).toFixed(2),
      weight: cs.fontWeight,
      color: cs.color,
    };
  });
  out.first = +(firstLine.getBoundingClientRect().top - top).toFixed(1);
  return out;
};

test("the editor draws the title block the page opens with, part by part, in either face", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const { frontMatter } = require("../vscode-mdm/transforms.js");
  const example = fs.readFileSync(path.join(ROOT, "example.mdm"), "utf8");
  const read = TITLE_PARTS.toString();
  for (const [face, url] of [["roman", EXAMPLE_PAGE], ["sans", EXAMPLE_SANS_PAGE]]) {
    const exported = await pageAt(url, SIDE_BY_SIDE_WIDTH, "(" + read + ")(" +
      'document.querySelector("main.content"), ' +
      '{ title: "#title-block-header h1.title", subtitle: "#title-block-header .subtitle", author: "#title-block-header .quarto-title-meta-contents p" }, ' +
      'Array.from(document.querySelectorAll("main.content p")).find((e) => e.textContent.startsWith("This document is ordinary Markdown")))');
    const h = await openEditor({
      seed: { settings: { textFont: face } },
      scores: 1,
      withFrontMatter: false,
      frontMatter: frontMatter(example),
    });
    await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1200 });
    await h.page.evaluate(() => document.fonts.ready);
    await h.page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
    const editor = await h.page.evaluate("(" + read + ")(" +
      'document.querySelector("#app .mdm-title-block"), ' +
      '{ title: "#app .mdm-title", subtitle: "#app .mdm-subtitle", author: "#app .mdm-title-authors p" }, ' +
      'Array.from(document.querySelectorAll("#app .cm-content > .cm-line")).find((e) => e.textContent.startsWith("This document is ordinary Markdown")))');
    assert.deepEqual(h.errors, []);
    await h.close();
    for (const part of ["title", "subtitle", "author"]) {
      assert.ok(exported[part], "the " + face + " page has no " + part);
      assert.ok(editor[part], "the " + face + " editor draws no " + part);
      for (const what of ["top", "height", "ink"]) {
        assert.ok(
          Math.abs(editor[part][what] - exported[part][what]) <= 0.5,
          "the " + what + " of the " + part + " in the " + face + ": " + editor[part][what] + " in the editor, " + exported[part][what] + " on the page"
        );
      }
      assert.equal(editor[part].size, exported[part].size, "the size of the " + part + " in the " + face);
      assert.equal(editor[part].weight, exported[part].weight, "the weight of the " + part + " in the " + face);
      assert.equal(editor[part].color, exported[part].color, "the ink of the " + part + " in the " + face);
    }
    assert.ok(
      Math.abs(editor.first - exported.first) <= 0.5,
      "the first paragraph of the " + face + " starts " + editor.first + "px under the head of the column in the editor and " + exported.first + " on the page"
    );
  }
});

// The rest of what the page prints at its head, which the editor has drawn
// since 2026-10-04: the authors beside their affiliations with the envelope
// of an email and the mark of ORCID, the two dates and the DOI, the tags and
// the description under the title, the abstract and the keywords. One
// document that has all of it, rendered in each face and set beside the
// editor opened on it in the same face: where each part stands in the
// column, how tall and how wide it is and how far its words reach, the size,
// the weight and the ink it is set in, whether it is in capitals, and where
// the first paragraph starts under the block. A part the page has and the
// editor does not, or the other way about, is a failure of its own.
const TITLE_BLOCK_DOC = [
  "---",
  // Written as a block, which reaches the page as a paragraph inside the
  // heading: its margin used to put 32px between the title and its rule
  // (mdm-look.css takes it off), and the height of the title below is what
  // says so.
  "title: >",
  "  A Study of the Circle of Fifths",
  'subtitle: "Notes for the harmony class"',
  "author:",
  "  - name: Ada Lovelace",
  "    degrees: [PhD]",
  "    email: ada@example.org",
  "    orcid: 0000-0002-1825-0097",
  "    url: https://example.org/ada",
  "    affiliations:",
  "      - name: Analytical Engine Institute",
  "        url: https://example.org",
  "      - Royal Society",
  "  - name: Clara Schumann",
  "    affiliation: Leipzig Conservatory",
  "date: 2026-10-04",
  "date-modified: 2026-10-05",
  "doi: 10.1234/abcd.5678",
  "categories: [music, harmony]",
  'description: "A description of the document, on one line."',
  "abstract: |",
  "  First paragraph of the abstract with *emphasis* and a formula $a^2+b^2$, long enough to wrap over more than one line of the column so the measure can be read off it.",
  "",
  "  Second paragraph of the abstract.",
  "keywords: [harmony, circle of fifths, tuning]",
  "lang: en",
  "filters:",
  "  - mdm",
  "---",
  "",
  "This document is ordinary Markdown. The first paragraph is long enough to wrap, so that its first line can be compared between the editor and the page.",
  "",
].join("\n");
// The same parts under their two names, the page's and the editor's.
const TITLE_BLOCK_PARTS = [
  ["title", "#title-block-header h1.title", "#app .mdm-title"],
  ["subtitle", "#title-block-header .subtitle", "#app .mdm-subtitle"],
  ["tags", "#title-block-header .quarto-categories", "#app .mdm-title-categories"],
  ["tag", "#title-block-header .quarto-category", "#app .mdm-title-category"],
  ["description", "#title-block-header .description", "#app .mdm-title-description"],
  ["author", "#title-block-header p.author", "#app .mdm-title-author p"],
  ["affiliation", "#title-block-header p.affiliation", "#app .mdm-title-affiliations p"],
  ["envelope", "#title-block-header a.quarto-title-author-email", "#app .mdm-title-email"],
  ["ORCID mark", "#title-block-header a.quarto-title-author-orcid img", "#app .mdm-title-orcid svg"],
  ["date", "#title-block-header p.date", "#app .mdm-title-date p"],
  ["modified date", "#title-block-header p.date-modified", "#app .mdm-title-modified p"],
  ["DOI", "#title-block-header p.doi", "#app .mdm-title-doi p"],
  ["DOI link", "#title-block-header p.doi a", "#app .mdm-title-doi .mdm-link"],
  ["word over the abstract", "#title-block-header .abstract .block-title", "#app .mdm-title-abstract .mdm-title-label"],
  ["paragraph of the abstract", "#title-block-header .abstract > p", "#app .mdm-title-abstract > p"],
  ["word over the keywords", "#title-block-header .keywords .block-title", "#app .mdm-title-keywords .mdm-title-label"],
  ["keywords", "#title-block-header .keywords > p", "#app .mdm-title-keywords > p"],
];
const TITLE_BLOCK_READ = function (rootSel, parts, side, lines) {
  const root = document.querySelector(rootSel);
  const box = root.getBoundingClientRect();
  const out = { parts: {} };
  parts.forEach((part) => {
    out.parts[part[0]] = Array.from(document.querySelectorAll(part[side])).map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // How far its words reach: from the first letter drawn to the last,
      // off the text itself and not off the boxes around it (a title
      // written as a block is a paragraph inside the heading on the page,
      // and a paragraph is as wide as the column whatever it says).
      const ink = { left: Infinity, right: -Infinity, width: 0 };
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        Array.from(range.getClientRects()).forEach((rect) => {
          if (!rect.width) return;
          ink.left = Math.min(ink.left, rect.left);
          ink.right = Math.max(ink.right, rect.right);
        });
      }
      if (ink.right > ink.left) ink.width = ink.right - ink.left;
      // What fades it: its own opacity and that of everything over it.
      let opacity = 1;
      for (let e = el; e && e !== root; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
      return {
        left: +(r.left - box.left).toFixed(1),
        top: +(r.top - box.top).toFixed(1),
        width: +r.width.toFixed(1),
        height: +r.height.toFixed(1),
        // A picture has no words to measure.
        ink: /^(?:img|svg)$/i.test(el.tagName) ? null : +ink.width.toFixed(1),
        size: +parseFloat(cs.fontSize).toFixed(2),
        weight: cs.fontWeight,
        color: cs.color,
        opacity: +opacity.toFixed(3),
        capitals: cs.textTransform,
        // The words without the space between them: the page's markup has
        // line breaks between two tags where the editor's has nothing, and
        // how far the words reach is measured above.
        text: el.textContent.replace(/\s+/g, ""),
      };
    });
  });
  const first = Array.from(document.querySelectorAll(lines)).find((e) => e.textContent.trim().startsWith("This document is ordinary Markdown"));
  out.first = first ? +(first.getBoundingClientRect().top - box.top).toFixed(1) : null;
  return out;
};

test("the editor draws every part of the title block where the page prints it, in either face", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const { frontMatter } = require("../vscode-mdm/transforms.js");
  const read = TITLE_BLOCK_READ.toString();
  const WIDTH = 1000;
  for (const face of ["roman", "sans"]) {
    const name = "title-block-" + face;
    fs.writeFileSync(path.join(DIR, name + ".mdm"), TITLE_BLOCK_DOC);
    const r = spawnSync(
      MDM,
      ["render", name + ".mdm", "--to", "html", "-M", "mdm-text-font:" + face, "-M", "mdm-text-align:justify"],
      { cwd: DIR, encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr);

    const browser = await puppeteer.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--allow-file-access-from-files"],
      defaultViewport: { width: WIDTH, height: 1200 },
    });
    OPEN_BROWSERS.add(browser);
    let exported;
    try {
      const page = await browser.newPage();
      await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
      await page.evaluate(() => document.fonts.ready);
      exported = await page.evaluate(
        "(" + read + ")(" + JSON.stringify("main.content") + ", " + JSON.stringify(TITLE_BLOCK_PARTS) + ", 1, " + JSON.stringify("main.content p") + ")"
      );
    } finally {
      await browser.close();
      OPEN_BROWSERS.delete(browser);
    }

    const h = await openEditor({
      seed: { settings: { textFont: face } },
      scores: 0,
      withFrontMatter: false,
      frontMatter: frontMatter(TITLE_BLOCK_DOC),
      text: TITLE_BLOCK_DOC,
    });
    let editor;
    try {
      await h.page.setViewport({ width: WIDTH, height: 1200 });
      await h.page.evaluate(() => document.fonts.ready);
      await h.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      editor = await h.page.evaluate(
        "(" + read + ")(" + JSON.stringify("#app .mdm-title-block") + ", " + JSON.stringify(TITLE_BLOCK_PARTS) + ", 2, " + JSON.stringify("#app .cm-content > .cm-line") + ")"
      );
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }

    for (const [part] of TITLE_BLOCK_PARTS) {
      const there = exported.parts[part];
      const here = editor.parts[part];
      assert.ok(there.length > 0, "the " + face + " page has no " + part);
      assert.equal(here.length, there.length, "the " + part + " in the " + face + ": " + here.length + " in the editor, " + there.length + " on the page");
      there.forEach((page, i) => {
        const where = "the " + part + " " + (i + 1) + " in the " + face + " (" + page.text.slice(0, 24) + ")";
        for (const what of ["left", "top", "width", "height", "ink"]) {
          if (page[what] === null) continue;
          assert.ok(
            Math.abs(here[i][what] - page[what]) <= 0.5,
            "the " + what + " of " + where + ": " + here[i][what] + " in the editor, " + page[what] + " on the page"
          );
        }
        for (const what of ["size", "weight", "color", "opacity", "capitals", "text"]) {
          assert.equal(here[i][what], page[what], "the " + what + " of " + where);
        }
      });
    }
    assert.ok(
      Math.abs(editor.first - exported.first) <= 0.5,
      "the first paragraph of the " + face + " starts " + editor.first + "px under the head of the column in the editor and " + exported.first + " on the page"
    );
  }
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

// A task's box on the page is the editor's (mdm-look.css and style.css;
// picked from design-task-box.html on 2026-10-01): 13px with its middle on
// the middle of the face's capital, to the whole pixel, half an em before the
// text, a line in the ink that fills with the brass when the task is done.
// Read with one function on both surfaces, row by row, in either face: the
// roman's capital is 13.4px and the sans's 11, so the same rule sets the box
// on the baseline in one and a pixel under it in the other, and a page that
// kept the -2px and the 0.28em it had would part from the editor in both.
//
// Every shape Pandoc writes a task in is here: in a list of tasks alone, in
// a list that mixes them with other items, on a numbered item, and in a
// loose list, whose box stands inside a <p> and a <label> and was reached by
// no rule of the page until this test (it stood in the flow, behind a
// bullet).
const TASK_BOXES = function (lines, left) {
  const probe = (line, css) => {
    const s = document.createElement("span");
    s.style.cssText = "display:inline-block;width:1px;text-indent:0;vertical-align:baseline;" + css;
    line.appendChild(s);
    const r = s.getBoundingClientRect();
    s.remove();
    return r;
  };
  const round = (x) => Math.round(x * 100) / 100;
  return lines.map((line) => {
    const input = line.querySelector('input[type="checkbox"]');
    const baseline = probe(line, "height:0").top;
    const cap = probe(line, "height:1cap").height;
    const box = input.getBoundingClientRect();
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement.closest(".mdm-li-marker") || !n.textContent.trim()
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const node = walker.nextNode();
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 1);
    const cs = getComputedStyle(input);
    const tick = getComputedStyle(input, "::before");
    return {
      text: node.textContent.trim(),
      cap: round(cap),
      size: box.width + "x" + box.height,
      foot: round(box.bottom - baseline),
      boxLeft: round(box.left - left),
      gap: round(range.getBoundingClientRect().left - box.right),
      textLeft: round(range.getBoundingClientRect().left - left),
      appearance: cs.appearance,
      ground: cs.backgroundColor,
      edge: cs.borderTopColor,
      tick: tick.content === "none" ? "none" : tick.backgroundColor,
    };
  });
}.toString();

test("a task's box on the page is the editor's: its place in the line, its gap and its drawing (TB3)", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const text =
    "- [ ] Poder a Mariam\n- [x] Hecha\n- [ ] Tanques\n\nProse between.\n\n- an item\n- [ ] a task among items\n\n" +
    "1. [ ] a numbered task\n\nMore prose.\n\n- [ ] a loose task\n\n- [x] a loose task done\n";
  const TASKS = ["Poder a Mariam", "Hecha", "Tanques", "a task among items", "a numbered task", "a loose task", "a loose task done"];
  for (const face of ["roman", "sans"]) {
    for (const [look, extra, brass] of [["light", [], "rgb(160, 116, 15)"], ["dark", ["-M", "mdm-look:dark"], "rgb(217, 169, 79)"]]) {
      // The dark side is read in one face: what it adds is the colours.
      if (look === "dark" && face === "sans") continue;
      const name = "task-box-" + face + "-" + look;
      const where = face + ", " + look;
      fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
      const r = spawnSync(
        MDM,
        ["render", name + ".mdm", "--to", "html", "-M", "mdm-text-font:" + face].concat(extra),
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
      const exported = await page.evaluate((f) => {
        const main = document.querySelector("main.content");
        return {
          boxes: eval("(" + f + ")")(
            Array.from(main.querySelectorAll('li input[type="checkbox"]')).map((i) => i.parentElement),
            main.getBoundingClientRect().left
          ),
          // A task carries no bullet and no number beside its box.
          markers: Array.from(main.querySelectorAll("li"))
            .filter((li) => li.querySelector('input[type="checkbox"]'))
            .map((li) => getComputedStyle(li, "::before").content),
        };
      }, TASK_BOXES);
      await browser.close();
      OPEN_BROWSERS.delete(browser);

      const h = await openEditor({ text, scores: 0, seed: { settings: { textFont: face, theme: look } } });
      let editor;
      try {
        await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1200 });
        await h.page.evaluate(async () => {
          await document.fonts.ready;
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        });
        await h.page.mouse.click(2, 2);
        await h.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
        editor = await h.page.evaluate(
          (f) =>
            eval("(" + f + ")")(
              Array.from(document.querySelectorAll("#app .cm-content .cm-line")).filter((l) => l.querySelector("input.mdm-task")),
              window.__mdm.view.contentDOM.getBoundingClientRect().left
            ),
          TASK_BOXES
        );
      } finally {
        await h.close();
      }

      assert.deepEqual(exported.boxes.map((b) => b.text), TASKS, where + ": the page's tasks");
      assert.deepEqual(editor.map((b) => b.text), TASKS, where + ": the editor's tasks");
      assert.deepEqual(
        exported.markers,
        TASKS.map(() => "none"),
        where + ": a task on the page carries a marker beside its box"
      );
      TASKS.forEach((task, i) => {
        const p = exported.boxes[i];
        const e = editor[i];
        const both = where + ", " + task + ": page " + JSON.stringify(p) + ", editor " + JSON.stringify(e);
        assert.equal(p.size, "13x13", "the page's box, " + both);
        assert.equal(e.size, "13x13", "the editor's box, " + both);
        assert.ok(Math.abs(p.cap - e.cap) <= 0.05, "the two capitals, " + both);
        assert.equal(p.foot, e.foot, "the box stands at another height in its line, " + both);
        assert.ok(Math.abs(p.gap - e.gap) <= 0.05, "the gap before the text, " + both);
        assert.ok(Math.abs(p.gap - 8) <= 0.05, "the gap is not half an em, " + both);
        assert.ok(Math.abs(p.boxLeft - e.boxLeft) <= 0.5, "the box into the column, " + both);
        assert.ok(Math.abs(p.textLeft - e.textLeft) <= 0.5, "the text into the column, " + both);
        assert.equal(p.appearance, "none", "the page's box is the browser's, " + both);
        for (const prop of ["ground", "edge", "tick"]) {
          assert.equal(p[prop], e[prop], "the box's " + prop + ", " + both);
        }
      });
      const done = exported.boxes[1];
      assert.equal(done.ground, brass, where + ": a task done is not filled with the side's brass on the page");
      assert.notEqual(done.tick, "none", where + ": a task done has no tick on the page");
      assert.equal(exported.boxes[0].ground, "rgba(0, 0, 0, 0)", where + ": a task to do has a ground on the page");
    }
  }
});

// A cell of a table written as a list, set on the page as the editor draws
// it: MDM's reading and not Markdown's (cell_lines in mdm.lua, cellItems in
// main.js), taken on the owner's word of 2026-10-02. Every cell read as its
// pieces on both surfaces (a box, a bullet, a line break, the words), and
// the box of a one-line cell measured with TASK_BOXES against the head of
// the cell's text: the size, the height in the line, the gap and the
// drawing of the prose's box. The bullet in the shade a list's has, and its
// words a space after it. In either face, on the light side.
const CELL_PIECES = function (cells) {
  return cells.map((td) =>
    Array.from(td.childNodes)
      .map((n) =>
        n.nodeType === 3
          ? n.textContent
          : n.matches('input[type="checkbox"]')
            ? n.checked ? "[x]" : "[ ]"
            : n.matches(".mdm-li-gap")
              ? ""
              : n.matches(".mdm-bullet")
                ? "•"
                : n.tagName === "BR"
                  ? "⏎"
                  : n.textContent
      )
      .join("")
      .replace(/\s+/g, " ")
      .trim()
  );
}.toString();
const CELL_BULLETS = function (cells) {
  return cells
    .filter((td) => td.querySelector(".mdm-bullet") && !td.querySelector("br"))
    .map((td) => {
      const bullet = td.querySelector(".mdm-bullet");
      // The first letter after the bullet: the space after it is a text
      // node of its own in the editor and part of the words on the page.
      const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          bullet.contains(n) || !(bullet.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) || !/\S/.test(n.textContent)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      const words = walker.nextNode();
      const at = words.textContent.search(/\S/);
      const range = document.createRange();
      range.setStart(words, at);
      range.setEnd(words, at + 1);
      const left = td.getBoundingClientRect().left + parseFloat(getComputedStyle(td).paddingLeft);
      return {
        colour: getComputedStyle(bullet).color,
        bulletLeft: Math.round((bullet.getBoundingClientRect().left - left) * 100) / 100,
        textLeft: Math.round((range.getBoundingClientRect().left - left) * 100) / 100,
      };
    });
}.toString();

test("a cell written as a list is set on the page as the editor draws it: its boxes, its bullets and its lines (TB16)", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const text =
    "| tasks | bullets |\n|---|---|\n| - [ ] Tune the A | - Rosin |\n| - [x] Done | * Bow<br> + Mute |\n" +
    "| - [x] Scales<br>1. [ ] Arpeggios | plain |\n| 1. as written | x |\n";
  const PIECES = ["[ ]Tune the A", "• Rosin", "[x]Done", "• Bow⏎• Mute", "[x]Scales⏎[ ]Arpeggios", "plain", "1. as written", "x"];
  for (const face of ["roman", "sans"]) {
    const name = "cell-lists-" + face;
    fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
    const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html", "-M", "mdm-text-font:" + face], { cwd: DIR, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    // One reading for both surfaces, the cells found by the selector given.
    const read = function (selector, pieces, boxes, bullets) {
      const cells = Array.from(document.querySelectorAll(selector));
      const ones = cells.filter((td) => td.querySelector('input[type="checkbox"]') && !td.querySelector("br"));
      return {
        pieces: eval("(" + pieces + ")")(cells),
        boxes: ones.map((td) => eval("(" + boxes + ")")([td], td.getBoundingClientRect().left + parseFloat(getComputedStyle(td).paddingLeft))[0]),
        bullets: eval("(" + bullets + ")")(cells),
      };
    }.toString();

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
      (read, ...args) => eval("(" + read + ")")(...args),
      read,
      "main.content tbody td",
      CELL_PIECES,
      TASK_BOXES,
      CELL_BULLETS
    );
    await browser.close();
    OPEN_BROWSERS.delete(browser);

    const h = await openEditor({ text, scores: 0, seed: { settings: { textFont: face, theme: "light" } } });
    let editor;
    try {
      await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1200 });
      await h.page.evaluate(async () => {
        await document.fonts.ready;
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      });
      await h.page.mouse.click(2, 2);
      await h.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      editor = await h.page.evaluate(
        (read, ...args) => eval("(" + read + ")")(...args),
        read,
        "#app .mdm-table tbody td",
        CELL_PIECES,
        TASK_BOXES,
        CELL_BULLETS
      );
    } finally {
      await h.close();
    }

    assert.deepEqual(exported.pieces, PIECES, face + ": the page's cells");
    assert.deepEqual(editor.pieces, PIECES, face + ": the editor's cells");
    assert.equal(exported.boxes.length, 2, face + ": the page's one-line tasks");
    assert.equal(editor.boxes.length, 2, face + ": the editor's one-line tasks");
    exported.boxes.forEach((p, i) => {
      const e = editor.boxes[i];
      const both = face + ", " + p.text + ": page " + JSON.stringify(p) + ", editor " + JSON.stringify(e);
      assert.equal(p.text, e.text, both);
      assert.equal(p.size, "13x13", "the page's box, " + both);
      assert.equal(e.size, "13x13", "the editor's box, " + both);
      assert.equal(p.foot, e.foot, "the box stands at another height in its line, " + both);
      assert.ok(Math.abs(p.boxLeft) <= 0.5 && Math.abs(e.boxLeft) <= 0.5, "the box is not at the head of its cell, " + both);
      assert.ok(Math.abs(p.gap - e.gap) <= 0.05, "the gap before the words, " + both);
      assert.ok(Math.abs(p.gap - 8) <= 0.05, "the gap is not half an em, " + both);
      for (const prop of ["appearance", "ground", "edge", "tick"]) {
        assert.equal(p[prop], e[prop], "the box's " + prop + ", " + both);
      }
    });
    assert.equal(exported.boxes[1].ground, "rgb(160, 116, 15)", face + ": a task done in a cell is not filled with the brass on the page");
    assert.equal(exported.bullets.length, 1, face + ": the page's one-line bullets");
    assert.equal(editor.bullets.length, 1, face + ": the editor's one-line bullets");
    const p = exported.bullets[0];
    const e = editor.bullets[0];
    const both = face + ": page " + JSON.stringify(p) + ", editor " + JSON.stringify(e);
    assert.equal(p.colour, e.colour, "the bullet's shade, " + both);
    assert.ok(Math.abs(p.bulletLeft) <= 0.5 && Math.abs(e.bulletLeft) <= 0.5, "the bullet is not at the head of its cell, " + both);
    assert.ok(Math.abs(p.textLeft - e.textLeft) <= 0.5, "the bullet's words, " + both);
  }
});

// A table as the editor draws it, on the page and on paper (the Tables rules
// of mdm-look.css, 2026-10-04). The page drew Bootstrap's `.table`: the whole
// measure wide whatever it held, Pandoc's percentages on the columns of a
// table with a long line in its source, cells padded half a rem all round,
// the head at the foot of its row, and a rule over the table, under it and
// under every row in a grey of Quarto's light theme; the owner's printed
// tables "are not drawn the same" as his editor's. Three tables, each
// between two lines of prose: three short columns, a column of each
// alignment, and one whose source runs past 72 characters and whose cells
// wrap. Every cell is read on both surfaces (where it stands in the column,
// its box, its padding, its alignment, the rule under it) and has to agree,
// with the air over and under each table; and in the PDF printed from the
// page a word of each column stands where the editor has it.
const TABLES = function (columnSel, tableSel, marks) {
  const column = document.querySelector(columnSel);
  const col = column.getBoundingClientRect();
  const round = (v) => Math.round(v * 100) / 100;
  const word = (w) => {
    const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.data.indexOf(w);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + w.length);
      const r = range.getBoundingClientRect();
      return { left: round(r.left - col.left), top: round(r.top), bottom: round(r.bottom) };
    }
    return null;
  };
  const tables = Array.from(document.querySelectorAll(tableSel)).map((table) => {
    const rows = Array.from(table.querySelectorAll("tr"));
    const first = rows[0].getBoundingClientRect();
    const last = rows[rows.length - 1].getBoundingClientRect();
    const frame = getComputedStyle(table);
    return {
      left: round(first.left - col.left),
      width: round(first.width),
      top: round(first.top),
      bottom: round(last.bottom),
      frame: frame.borderTopWidth + " " + frame.borderBottomWidth,
      cells: Array.from(table.querySelectorAll("th, td")).map((cell) => {
        const b = cell.getBoundingClientRect();
        const cs = getComputedStyle(cell);
        return {
          text: cell.textContent.replace(/\s+/g, " ").trim().slice(0, 14),
          x: round(b.left - col.left),
          w: round(b.width),
          h: round(b.height),
          pad: cs.padding,
          align: cs.textAlign,
          valign: cs.verticalAlign,
          rule: cs.borderBottomWidth + " " + cs.borderBottomStyle + " " + cs.borderBottomColor,
        };
      }),
    };
  });
  const found = {};
  marks.forEach((m) => { found[m] = word(m); });
  return { column: round(col.width), tables: tables, words: found };
}.toString();

test("a table is set on the page and on paper as the editor draws it: its width, its columns, its rules and its air", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const text = [
    "Overone, a line of prose over the first table.",
    "| Interval | Ratio | Cents |\n|----------|-------|-------|\n| Octave   | 2:1   | 1200  |\n| Fifth    | 3:2   | 702   |\n| Fourth   | 4:3   | 498   |",
    "Undone, a line of prose under the first table and over the second.",
    "| Left | Centre | Right | None |\n|:-----|:------:|------:|------|\n| a    | b      | 1.5   | x    |\n| alpha beta | gamma delta | 22.25 | y z |",
    "Undtwo, a line of prose under the second table and over the third.",
    "| Term | What it means |\n|------|---------------|\n" +
      "| Consonance | Two notes whose frequencies stand in a simple ratio sound smooth together, and the simpler the ratio the smoother the sound. |\n" +
      "| Dissonance | Two notes whose frequencies stand in a complicated ratio beat against each other and sound rough. |",
    "Undthree, a line of prose under the third table.",
  ].join("\n\n") + "\n";
  const MARKS = ["Overone", "Undone", "Undtwo", "Undthree", "Ratio", "Cents", "Octave", "Fifth", "Centre", "22.25", "Dissonance", "complicated"];
  // One CSS px of the document on paper, and where a Letter sheet starts the
  // column (the print rules of mdm-look.css).
  const PT = (16 * 0.75 * (10 / 12) * (800 / 803)) / 16;
  for (const face of ["roman", "sans"]) {
    const name = "tables-" + face;
    fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
    const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html", "-M", "mdm-text-font:" + face], { cwd: DIR, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      fs.readFileSync(path.join(DIR, name + ".html"), "utf8"),
      /<col style="width: \d+%">/,
      "Pandoc wrote no widths for the table with a long source line, so the rule that takes them off reads nothing"
    );

    const browser = await puppeteer.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--allow-file-access-from-files"],
      defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 1400 },
    });
    OPEN_BROWSERS.add(browser);
    const page = await browser.newPage();
    await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    const exported = await page.evaluate((read, ...args) => eval("(" + read + ")")(...args), TABLES, "main.content", "main.content table", MARKS);
    await browser.close();
    OPEN_BROWSERS.delete(browser);

    const h = await openEditor({ text, scores: 0, seed: { settings: { textFont: face, theme: "light" } }, height: 1400 });
    let editor;
    try {
      await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1400 });
      await h.page.evaluate(async () => {
        await document.fonts.ready;
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      });
      await h.page.mouse.click(2, 2);
      await h.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      editor = await h.page.evaluate((read, ...args) => eval("(" + read + ")")(...args), TABLES, "#app .cm-content", "#app .mdm-table table", MARKS);
    } finally {
      await h.close();
    }

    assert.equal(exported.column, 820, face + ": the page's column");
    assert.equal(editor.column, 820, face + ": the editor's column");
    assert.equal(exported.tables.length, 3, face + ": the page's tables");
    assert.equal(editor.tables.length, 3, face + ": the editor's tables");
    const overs = ["Overone", "Undone", "Undtwo"];
    const unders = ["Undone", "Undtwo", "Undthree"];
    exported.tables.forEach((p, t) => {
      const e = editor.tables[t];
      const where = face + ", table " + (t + 1);
      assert.equal(p.frame, "0px 0px", where + ": the page draws a rule over or under the table");
      assert.equal(e.frame, "0px 0px", where + ": the editor's table has a frame");
      assert.ok(Math.abs(p.left) <= 0.5 && Math.abs(e.left) <= 0.5, where + ": the table is not on the left margin: page " + p.left + ", editor " + e.left);
      assert.ok(Math.abs(p.width - e.width) <= 0.5, where + ": the page's table is " + p.width + " px wide and the editor's " + e.width);
      assert.equal(p.cells.length, e.cells.length, where + ": the cells");
      p.cells.forEach((pc, i) => {
        const ec = e.cells[i];
        const both = where + ", cell " + JSON.stringify(pc.text) + ": page " + JSON.stringify(pc) + ", editor " + JSON.stringify(ec);
        assert.equal(pc.text, ec.text, both);
        for (const side of ["x", "w", "h"]) {
          assert.ok(Math.abs(pc[side] - ec[side]) <= 0.5, "the cell's " + side + ", " + both);
        }
        for (const prop of ["pad", "align", "valign", "rule"]) {
          assert.equal(pc[prop], ec[prop], "the cell's " + prop + ", " + both);
        }
      });
      const air = (side) => ({
        over: side.tables[t].top - side.words[overs[t]].bottom,
        under: side.words[unders[t]].top - side.tables[t].bottom,
      });
      const pa = air(exported);
      const ea = air(editor);
      assert.ok(
        Math.abs(pa.over - ea.over) <= 0.5 && Math.abs(pa.under - ea.under) <= 0.5,
        where + ": the air is " + JSON.stringify(pa) + " on the page and " + JSON.stringify(ea) + " in the editor"
      );
    });
    // What the design is, said once and not only as "the same on both": a
    // short table is as wide as what it holds, its first cell starts on the
    // margin, the head has the stronger rule and the last row none.
    const short = exported.tables[0];
    assert.ok(short.width < 300, face + ": a table of three short columns is " + short.width + " px wide");
    assert.match(short.cells[0].pad, /^\S+ \S+ \S+ 0px$/, face + ": the first cell is padded on its left: " + short.cells[0].pad);
    assert.match(short.cells[0].rule, /^1px solid .*0\.34\)$/, face + ": the rule under the head: " + short.cells[0].rule);
    assert.match(short.cells[3].rule, /^1px solid .*0\.1\)$/, face + ": the rule under a row: " + short.cells[3].rule);
    assert.match(short.cells[short.cells.length - 1].rule, /^0px /, face + ": a rule under the last row: " + short.cells[short.cells.length - 1].rule);
    assert.deepEqual(exported.tables[1].cells.slice(0, 4).map((c) => c.align), ["left", "center", "right", "left"], face + ": the alignment of the columns");
    // The third table fills the measure and wraps its cells where the editor
    // wraps them, which Pandoc's percentages kept it from.
    assert.ok(exported.tables[2].width > 700, face + ": the table of long cells does not reach the measure");

    // And on paper: a word of each column where the editor has it, and the
    // rows at the editor's pitch.
    const sheet = pdfWords(printPdf(name)).filter((w) => w.sheet === 1);
    const left = (612 - 820 * PT) / 2;
    const at = (text) => {
      const w = sheet.find((x) => x.text === text);
      assert.ok(w, face + ": the PDF has no word " + text);
      return w;
    };
    for (const mark of ["Ratio", "Cents", "Centre", "22.25", "complicated"]) {
      const expected = left + editor.words[mark].left * PT;
      assert.ok(
        Math.abs(at(mark).x0 - expected) <= 0.6,
        face + ": on paper " + mark + " stands at " + at(mark).x0.toFixed(2) + " pt and the editor has it at " + expected.toFixed(2)
      );
    }
    const pitch = (at("Fifth").y0 - at("Octave").y0) / PT;
    const editorPitch = editor.words.Fifth.top - editor.words.Octave.top;
    assert.ok(
      Math.abs(pitch - editorPitch) <= 0.8,
      face + ": on paper the rows are " + pitch.toFixed(2) + " px apart and in the editor " + editorPitch.toFixed(2)
    );
  }
});

// What the review of the printed PDF found standing or painted otherwise on
// the page than in the editor, block by block (2026-10-04), each put right in
// mdm-look.css and read here on both surfaces and on paper:
// - a quotation set in a measure 25.5 px short of the editor's (Bootstrap
//   pads `.blockquote` 1.5rem on its right), so it broke on other words;
// - the code of a card 3.7 px further in and the card 3.7 px taller
//   (Bootstrap pads every <code>), the card 14 px from its neighbours for the
//   editor's 16 (a margin in the card's own em), and an empty card half the
//   height of the editor's;
// - 5 px less across a display equation than in the editor, and 6.4 less
//   across a numbered one (the 0.2em of the editor's widget);
// - a score 9.5 px further from its neighbours (a margin of 1.5rem);
// - the two lines beside a `***` 25.6 px nearer each other (the rule's
//   margins collapsed into its neighbours' where the editor pads a row);
// - headings 3 to 6 at 0.9 of the ink (Quarto's theme), a tune's title in
//   black on the light side (the root of the drawing painted on every side),
//   code in a link in the code's ink and code in a strong run at 400
//   (Bootstrap), and a highlight with round corners;
// - the text of a note 3.58 px after its number for the editor's space of
//   6.52 (the last mark: where a note's first word stands in the column).
// The marks are words of prose that stand over and under each block, so what
// is compared is where the block puts the text around it, whatever face the
// code is in; and the first letter of a card's code, which is at the card's
// padding in any face.
const BLOCKS_DOC = [
  "Overquote, a line of prose over the quotation.",
  "> A single quoted paragraph that is long enough to wrap onto a second line of the column so the height of the bar can be read over two rows of text.",
  "Underquote, a line of prose under the quotation.",
  "```python\ndef scale(root):\n    return [root * 2 ** (n / 12) for n in range(13)]\n```",
  "Betweencards, a line between two cards.",
  "```\nplaincard text\n```",
  "```\n```",
  "Underempty, a line under the empty card.",
  "### Thirdlevel heading",
  "#### Fourthlevel heading",
  "##### Fifthlevel heading",
  "###### Sixthlevel heading",
  "Textline with [`linkcode`](https://example.com) and **strong with `boldcode` in it** and [marked]{.mark} words, and a note.[^1]",
  "$$\nE = mc^2\n$$",
  "Aftereq, a line after the equation.",
  "$$\na^2 + b^2 = c^2\n$$ {#eq-pyth}",
  "Afternum, a line after the numbered equation.",
  "```abc\nX:1\nT:Scoretitle\nL:1/4\nK:C\nCDEF|GABc|\n```",
  "Afterscore, a line after the score.",
  "***",
  "Afterrule, a line after the rule.",
  "[^1]: Notetext of the note.",
].join("\n\n") + "\n";
const BLOCKS_MARKS = ["Overquote,", "second", "height", "Underquote,", "def", "Betweencards,", "plaincard", "Underempty,", "Thirdlevel", "Aftereq,", "Afternum,", "Afterscore,", "Afterrule,", "Notetext"];
// Where each mark stands, and what a few boxes compute to: each probe is a
// name, a selector and a property, read on the first element that matches.
const BLOCKS = function (columnSel, marks, probes) {
  const column = document.querySelector(columnSel);
  const col = column.getBoundingClientRect();
  const round = (v) => Math.round(v * 100) / 100;
  const words = {};
  marks.forEach((mark) => {
    const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.data.indexOf(mark);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + mark.length);
      const r = range.getClientRects()[0];
      words[mark] = { left: round(r.left - col.left), top: round(r.top) };
      break;
    }
  });
  const styles = {};
  probes.forEach(([name, selector, property]) => {
    const el = column.querySelector(selector);
    styles[name] = el ? getComputedStyle(el)[property] : null;
  });
  return { words: words, styles: styles, ink: getComputedStyle(column).color };
}.toString();

test("a quotation, a card of code, an equation, a score and a rule stand on the page and on paper where the editor stands them, in its inks", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const PT = 0.75 * (10 / 12) * (800 / 803);
  for (const side of ["light", "dark"]) {
    const name = "blocks-" + side;
    fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + BLOCKS_DOC);
    const r = spawnSync(
      MDM,
      ["render", name + ".mdm", "--to", "html", "-M", "mdm-text-font:roman", "-M", "mdm-text-align:justify", "-M", "mdm-look:" + side],
      { cwd: DIR, encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr);

    const browser = await puppeteer.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--allow-file-access-from-files"],
      defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 2400 },
    });
    OPEN_BROWSERS.add(browser);
    const page = await browser.newPage();
    await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector(".mdm-paper svg");
    const exported = await page.evaluate((read, ...args) => eval("(" + read + ")")(...args), BLOCKS, "main.content", BLOCKS_MARKS, [
      ["h3", "h3", "opacity"], ["h4", "h4", "opacity"], ["h5", "h5", "opacity"], ["h6", "h6", "opacity"],
      ["linkCode", "a > code", "color"], ["link", "a[href^='https://example.com']", "color"],
      ["strongCode", "strong > code", "fontWeight"],
      ["mark", "mark", "borderTopLeftRadius"],
      ["scoreRoot", ".mdm-paper svg", "fill"],
    ]);
    await browser.close();
    OPEN_BROWSERS.delete(browser);

    const h = await openEditor({
      text: BLOCKS_DOC,
      scores: 1,
      seed: { settings: { textFont: "roman", textAlign: "justify", hyphenation: "none", theme: side } },
      height: 2400,
    });
    let editor;
    try {
      await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 2400 });
      await h.page.evaluate(async () => {
        await document.fonts.ready;
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      });
      await h.page.mouse.click(2, 2);
      await h.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      await new Promise((res) => setTimeout(res, 400));
      editor = await h.page.evaluate((read, ...args) => eval("(" + read + ")")(...args), BLOCKS, "#app .cm-content", BLOCKS_MARKS, [
        ["linkCode", ".mdm-link .mdm-inline-code", "color"], ["link", ".mdm-link", "color"],
        ["strongCode", ".mdm-inline-code[style*='bold'], strong .mdm-inline-code, .mdm-strong .mdm-inline-code", "fontWeight"],
        ["mark", ".mdm-highlight, .mdm-marked, mark", "borderTopLeftRadius"],
        ["scoreRoot", "code.language-abc svg", "fill"],
      ]);
    } finally {
      await h.close();
    }

    for (const mark of BLOCKS_MARKS) {
      assert.ok(exported.words[mark], side + ": the page has no word " + mark);
      assert.ok(editor.words[mark], side + ": the editor has no word " + mark);
      assert.ok(
        Math.abs(exported.words[mark].left - editor.words[mark].left) <= 0.5,
        side + ": " + mark + " stands " + exported.words[mark].left + " px into the column on the page and " + editor.words[mark].left + " in the editor"
      );
    }
    // From each line of prose to the next, across the block between them.
    const steps = [
      ["Overquote,", "Underquote,", "a quotation of two rows"],
      ["Underquote,", "Betweencards,", "a card of code"],
      ["Betweencards,", "Underempty,", "a card of plain text and an empty card"],
      ["Underempty,", "Thirdlevel", "a heading under text"],
      ["Aftereq,", "Afternum,", "a numbered equation"],
      ["Afternum,", "Afterscore,", "a score"],
      ["Afterscore,", "Afterrule,", "a rule"],
    ];
    for (const [from, to, what] of steps) {
      const onPage = exported.words[to].top - exported.words[from].top;
      const inEditor = editor.words[to].top - editor.words[from].top;
      assert.ok(
        Math.abs(onPage - inEditor) <= 0.5,
        side + ": across " + what + " the page has " + onPage.toFixed(2) + " px from one line of text to the next and the editor " + inEditor.toFixed(2)
      );
    }
    // The row of text over the plain equation holds chips of code, whose
    // face is not the same on the two surfaces; the equation is read from
    // the text under it, across the numbered one, above. What a plain
    // display leaves is read on the page itself: the editor's 0.45em over
    // and under the formula's box.
    assert.equal(exported.styles.h3, "1", side + ": a heading of the third level is not at the whole of the ink");
    assert.equal(exported.styles.h4, "1", side);
    assert.equal(exported.styles.h5, "1", side);
    assert.equal(exported.styles.h6, "1", side);
    assert.equal(exported.styles.linkCode, exported.styles.link, side + ": code in a link is not in the link's colour on the page");
    assert.equal(exported.styles.strongCode, "700", side + ": code in a strong run is not bold on the page");
    assert.equal(exported.styles.mark, "0px", side + ": a highlight has round corners on the page");
    assert.equal(exported.styles.scoreRoot, editor.styles.scoreRoot, side + ": the root of a score's drawing, which paints its title, is another colour on the page");
    assert.equal(exported.styles.scoreRoot, exported.ink, side + ": a tune's title is not in the document's ink");

    // On paper, the same steps in the PDF printed from the page, a row's
    // pixel either way (a baseline is drawn on a whole pixel).
    const words = pdfWords(printPdf(name));
    const at = (text) => {
      const w = words.find((x) => x.text === text);
      assert.ok(w, side + ": the PDF has no word " + text);
      return w;
    };
    for (const [from, to, what] of steps) {
      // Between two lines of prose alone: poppler boxes a word by its face
      // and its size, and a heading's box starts elsewhere over its letters
      // than a line of prose's does.
      if (to === "Thirdlevel" || at(from).sheet !== at(to).sheet) continue;
      const onPaper = (at(to).y0 - at(from).y0) / PT;
      const inEditor = editor.words[to].top - editor.words[from].top;
      assert.ok(
        Math.abs(onPaper - inEditor) <= 1.2,
        side + ": across " + what + " the paper has " + onPaper.toFixed(2) + " px from one line of text to the next and the editor " + inEditor.toFixed(2)
      );
    }
    const left = (612 - 820 * PT) / 2;
    // "height" opens the quotation's second row in the editor, after a first
    // row that ends on "so" at the column's edge: in a measure any shorter
    // "so" goes down and stands before it.
    assert.ok(
      Math.abs(at("height").x0 - (left + editor.words.height.left * PT)) <= 0.6,
      side + ": on paper the quotation breaks elsewhere than in the editor"
    );
  }
});

// A display equation on the page leaves over and under its formula what the
// editor leaves: the 0.25em of the box that scrolls it and the 0.2em of the
// widget the editor draws it in. Read between two lines of plain prose, on
// both surfaces and on paper, for a formula of one row, a taller one and a
// numbered one; and a rule under a list, where the list's own margin stands
// over it.
test("a display equation and a rule leave on the page and on paper the air the editor leaves", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const PT = 0.75 * (10 / 12) * (800 / 803);
  const text = [
    "Overplain, a line of prose over a display equation.",
    "$$\nE = mc^2\n$$",
    "Underplain, a line of prose under it and over a taller one.",
    "$$\n\\int_0^\\infty \\frac{x^3}{e^x - 1}\\,dx = \\frac{\\pi^4}{15}\n$$",
    "Undertall, a line of prose under it and over a numbered one.",
    "$$\na^2 + b^2 = c^2\n$$ {#eq-pyth}",
    "Undernum, a line of prose under it.",
    "***",
    "Underrule, a line of prose under the rule.",
    "- an item over a rule",
    "***",
    "Lastline, after the second rule.",
  ].join("\n\n") + "\n";
  const MARKS = ["Overplain,", "Underplain,", "Undertall,", "Undernum,", "Underrule,", "item", "Lastline,"];
  const name = "equation-air";
  fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
  const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html", "-M", "mdm-text-font:roman", "-M", "mdm-text-align:justify"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const exported = await readSheetDoc(name, null, new Function("return (" + BLOCKS + ")('main.content', " + JSON.stringify(MARKS) + ", [])"));
  const h = await openEditor({ text, scores: 0, seed: { settings: { textFont: "roman", textAlign: "justify", hyphenation: "none", theme: "light" } }, height: 1600 });
  let editor;
  try {
    await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1600 });
    await h.page.evaluate(async () => {
      await document.fonts.ready;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    await h.page.mouse.click(2, 2);
    await h.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    editor = await h.page.evaluate((read, ...args) => eval("(" + read + ")")(...args), BLOCKS, "#app .cm-content", MARKS, []);
  } finally {
    await h.close();
  }
  const words = pdfWords(printPdf(name));
  const at = (mark) => words.find((w) => w.text === mark);
  const whats = ["a formula of one row", "a taller formula", "a numbered formula", "a rule under a paragraph", "a paragraph", "a rule under a list"];
  MARKS.slice(1).forEach((to, i) => {
    const from = MARKS[i];
    const onPage = exported.words[to].top - exported.words[from].top;
    const inEditor = editor.words[to].top - editor.words[from].top;
    const onPaper = (at(to).y0 - at(from).y0) / PT;
    assert.ok(
      Math.abs(onPage - inEditor) <= 0.5,
      "across " + whats[i] + " the page has " + onPage.toFixed(2) + " px from one line of text to the next and the editor " + inEditor.toFixed(2)
    );
    assert.ok(
      Math.abs(onPaper - inEditor) <= 1.2,
      "across " + whats[i] + " the paper has " + onPaper.toFixed(2) + " px from one line of text to the next and the editor " + inEditor.toFixed(2)
    );
  });
});

// The blocks the two dialects part on, drawn as the editor draws them once
// the copy has its blank lines (extension.js, withBreaks): a table straight
// under a line of text, a `***` and a spaced rule under text or under an
// item, a `---` under an item (G039); and the addresses: one with a scheme
// and a mail address are links on both surfaces, a `www.` one is text on
// both (G017). The page is read as the sequence of its blocks and the links
// of its last paragraph, the editor as the sequence of its rows.
test("the page shows the table, the rules, the lists and the address the editor shows (G039, G017)", { skip }, async () => {
  const { open: openEditor, rows } = require("./webview/helpers.js");
  const text =
    "Text above.\n| a | b |\n|---|---|\n| 1 | 2 |\n\nText above two.\n***\n\n- foo\n* * *\n- bar\n\n- item\n---\n\n" +
    "See https://example.com/path and www.example.org and someone@example.org.\n";
  const name = "dialect-blocks";
  fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
  const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
  });
  OPEN_BROWSERS.add(browser);
  const page = await browser.newPage();
  await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
  const exported = await page.evaluate(() => {
    const main = document.querySelector("main.content");
    const blocks = Array.from(main.querySelectorAll("p, table, hr, ul"))
      .filter((el) => !el.parentElement.closest("li, td, th"))
      .map((el) => el.tagName.toLowerCase());
    const last = Array.from(main.querySelectorAll("p")).pop();
    return {
      blocks,
      links: Array.from(last.querySelectorAll("a")).map((a) => a.textContent),
      cells: Array.from(main.querySelectorAll("td")).map((td) => td.textContent.trim()),
    };
  });
  await browser.close();
  OPEN_BROWSERS.delete(browser);
  // `- bar` and `- item` with a blank line between them are one loose list
  // to both dialects, two items long.
  assert.deepEqual(exported.blocks, ["p", "table", "p", "hr", "ul", "hr", "ul", "hr", "p"]);
  assert.deepEqual(exported.cells, ["1", "2"]);
  assert.deepEqual(exported.links, ["https://example.com/path", "someone@example.org"]);

  const h = await openEditor({ text, scores: 0 });
  let editor;
  try {
    const drawn = await rows(h.page);
    editor = {
      blocks: drawn
        .filter((row) => !/mdm-blank/.test(row.roles))
        .map((row) =>
          /mdm-table/.test(row.roles) ? "table" : /mdm-hr/.test(row.roles) ? "hr" : /mdm-li/.test(row.roles) ? "li" : "p"
        ),
      links: await h.page.evaluate(() => {
        const line = Array.from(document.querySelectorAll("#app .cm-line")).find((l) => l.textContent.startsWith("See "));
        return Array.from(line.querySelectorAll(".mdm-link")).map((a) => a.textContent);
      }),
    };
  } finally {
    await h.close();
  }
  // The editor draws an item per row where the page draws a list per run.
  assert.deepEqual(editor.blocks, ["p", "table", "p", "hr", "li", "hr", "li", "li", "hr", "p"]);
  assert.deepEqual(editor.links, exported.links);
});

// The punctuation Pandoc's `smart` extension prints, which the editor draws
// while a line is untouched (G015): the first paragraph of the page reads as
// the first row of the editor, glyph for glyph. The page's own line wrapping
// inside the paragraph is folded to spaces first.
test("the page prints the quotes, dashes and ellipsis the editor draws (G015)", { skip }, async () => {
  const { open: openEditor, rows } = require("./webview/helpers.js");
  const text = "\"Double quotes\", 'single quotes', the '90s, pages 3--5, a pause --- here, F\" and so on...\n";
  const name = "smart-punctuation";
  fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
  const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
  });
  OPEN_BROWSERS.add(browser);
  const page = await browser.newPage();
  await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
  const exported = await page.evaluate(() =>
    document.querySelector("main.content p").textContent.replace(/\s+/g, " ").trim()
  );
  await browser.close();
  OPEN_BROWSERS.delete(browser);
  // Read off pandoc 3.8.3 with the export's reader on 2026-09-17.
  assert.equal(
    exported,
    "\u201cDouble quotes\u201d, \u2018single quotes\u2019, the \u201990s, pages 3\u20135, a pause \u2014 here, F\u201d and so on\u2026"
  );

  const h = await openEditor({ text, scores: 0 });
  let editor;
  try {
    editor = (await rows(h.page))[0].text;
  } finally {
    await h.close();
  }
  assert.equal(editor, exported);
});

// A setext underline set in a space or two is CommonMark's, and the editor's,
// and a paragraph with the `=====` in it to Pandoc; the copy brings it to the
// margin (withBreaks), so the page heads the section the editor heads (G041).
test("the page reads a setext heading with an indented underline as the editor does (G041)", { skip }, async () => {
  const { open: openEditor, rows } = require("./webview/helpers.js");
  const text = "Title\n  =====\n\n   Indented text.\n";
  const name = "indented-underline";
  fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
  const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
  });
  OPEN_BROWSERS.add(browser);
  const page = await browser.newPage();
  await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
  const exported = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main.content h1, main.content p")).map(
      (el) => el.tagName.toLowerCase() + ":" + el.textContent.trim()
    )
  );
  await browser.close();
  OPEN_BROWSERS.delete(browser);
  assert.deepEqual(exported, ["h1:Title", "p:Indented text."]);

  const h = await openEditor({ text, scores: 0 });
  let editor;
  try {
    editor = (await rows(h.page))
      .filter((row) => row.text)
      .map((row) => (/mdm-h1/.test(row.roles) ? "h1:" : "p:") + row.text);
  } finally {
    await h.close();
  }
  assert.deepEqual(editor, exported);
});

// The measures of a subscript, a superscript and a figure, read the same way
// on both surfaces: the size the sub or sup is drawn at and how far its box
// stands below or above the box of the prose beside it (a Range over the
// word `Water`, so the line box's padding on either surface is left out);
// the caption's size and colour beside the colour of the prose, the gap
// between the picture and its caption, the width the picture is drawn at,
// and the air on either side of the figure, from the block of prose above
// it (the page's `p`, the editor's line) to the picture and from the caption
// to the block below. The colour of a table's caption too, where there is
// one (the editor draws none, so only the page is asked).
function inlineMeasures(root, sel) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const holding = (word) => {
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent.indexOf(word);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + word.length);
      return {
        text: range.getBoundingClientRect(),
        block: n.parentElement.closest(sel.block).getBoundingClientRect(),
        color: getComputedStyle(n.parentElement).color,
      };
    }
    return null;
  };
  const above = holding("Water");
  const below = holding("After");
  const prose = above.text;
  const sub = root.querySelector(sel.sub);
  const sup = root.querySelector(sel.sup);
  const img = root.querySelector(sel.img);
  const caption = root.querySelector(sel.caption);
  const tableCaption = sel.tableCaption ? root.querySelector(sel.tableCaption) : null;
  const box = (el) => el.getBoundingClientRect();
  const size = (el) => +parseFloat(getComputedStyle(el).fontSize).toFixed(2);
  return {
    subSize: size(sub),
    subDrop: Math.round(box(sub).bottom - prose.bottom),
    supSize: size(sup),
    supRise: Math.round(prose.top - box(sup).top),
    captionSize: size(caption),
    captionColor: getComputedStyle(caption).color,
    proseColor: above.color,
    tableCaptionColor: tableCaption ? getComputedStyle(tableCaption).color : null,
    gap: Math.round(box(caption).top - box(img).bottom),
    picture: Math.round(box(img).width),
    above: Math.round(box(img).top - above.block.bottom),
    below: Math.round(below.block.top - box(caption).bottom),
  };
}

test("the page lowers a subscript, raises a superscript and captions a figure as the editor does", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  // The extension's own icon (256 px) is the picture, beside the document
  // on the page and in the folder the harness is told is the document's.
  fs.copyFileSync(path.join(ROOT, "vscode-mdm", "media", "icon.png"), path.join(DIR, "icon.png"));
  const text =
    "Water is H~2~O and E = mc^2^ in prose.\n\n![A caption under the picture.](icon.png)\n\nAfter the figure.\n\n" +
    "| a | b |\n|---|---|\n| 1 | 2 |\n\n: A caption at the table.\n";

  // The page, rendered with the look of either side and measured.
  async function exportedAs(name, look) {
    fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
    const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html", "-M", "mdm-text-font:roman"].concat(look), {
      cwd: DIR,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--allow-file-access-from-files"],
      defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 1200 },
    });
    OPEN_BROWSERS.add(browser);
    try {
      const page = await browser.newPage();
      await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
      await page.evaluate(() => document.fonts.ready);
      return await page.evaluate(
        (fn) =>
          new Function("root", "sel", fn)(document.querySelector("main.content"), {
            block: "p",
            sub: "sub",
            sup: "sup",
            img: "figure img",
            caption: "figure figcaption",
            tableCaption: "table caption",
          }),
        inlineMeasures.toString().replace(/^[^{]*\{/, "").replace(/\}\s*$/, "")
      );
    } finally {
      await browser.close();
      OPEN_BROWSERS.delete(browser);
    }
  }

  // The editor, on the side asked for.
  async function editorAs(theme) {
    const base = "file://" + DIR + "/";
    const h = await openEditor({ text, scores: 0, seed: { settings: { textFont: "roman", theme }, docBase: base } });
    try {
      await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1200 });
      await h.page.evaluate(() => {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      });
      await h.page.mouse.click(2, 2);
      await h.page.waitForFunction(() => {
        const img = document.querySelector("#app .mdm-figure img");
        return img && img.complete && img.naturalWidth > 0;
      });
      await h.page.evaluate(() => document.fonts.ready);
      await h.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      return await h.page.evaluate(
        (fn) =>
          new Function("root", "sel", fn)(document.querySelector("#app .cm-content"), {
            block: ".cm-line",
            sub: "sub.mdm-sub",
            sup: "sup.mdm-sup",
            img: ".mdm-figure img",
            caption: ".mdm-figcaption",
          }),
        inlineMeasures.toString().replace(/^[^{]*\{/, "").replace(/\}\s*$/, "")
      );
    } finally {
      await h.close();
    }
  }

  const exported = await exportedAs("inline-figure", []);
  const editor = await editorAs("light");
  // Bootstrap's reboot on the page: three quarters of the size, a quarter
  // em down and half an em up (12px, 3 and 6 at 16px); Quarto's caption at
  // 0.9rem of its 17px root, 15.3px (measured 2026-09-16); and the
  // paragraph's 16px of margin on either side of the figure, which in the
  // editor is the blank line and nothing else (measured 2026-09-17).
  assert.equal(editor.subSize, 12, "the editor's subscript: " + JSON.stringify(editor));
  assert.equal(editor.supSize, 12, "the editor's superscript: " + JSON.stringify(editor));
  assert.equal(editor.captionSize, 15.3, "the editor's caption: " + JSON.stringify(editor));
  assert.equal(editor.above, 16, "the air over the figure in the editor: " + JSON.stringify(editor));
  for (const key of ["subSize", "subDrop", "supSize", "supRise", "captionSize", "gap", "picture", "above", "below"]) {
    assert.ok(
      Math.abs(exported[key] - editor[key]) <= 1,
      key + " is " + exported[key] + " on the page and " + editor[key] + " in the editor"
    );
  }
  // The caption in the ink of the prose, on either side and on both
  // surfaces, and a table's caption on the page with it: B on
  // design/design-caption-colour.html, the owner's pick of 2026-09-27. It
  // was Quarto's grey, rgb(90, 101, 112) on every side and 2.71:1 on the
  // dark page, and only the light side was held.
  const dark = await exportedAs("inline-figure-dark", DARK_LOOK);
  const editorDark = await editorAs("dark");
  const sides = [
    ["light", "rgb(36, 41, 46)", exported, editor],
    ["dark", "rgb(212, 212, 212)", dark, editorDark],
  ];
  for (const [side, ink, page, own] of sides) {
    assert.equal(own.proseColor, ink, "the editor's prose on the " + side + " side");
    assert.equal(own.captionColor, ink, "the editor's caption on the " + side + " side");
    assert.equal(page.proseColor, ink, "the page's prose on the " + side + " side");
    assert.equal(page.captionColor, ink, "the page's caption on the " + side + " side");
    assert.equal(page.tableCaptionColor, ink, "the page's table caption on the " + side + " side");
  }
});

// A caption printed into a PDF keeps the size the editor gives it, 0.956
// of the text. The page printed by Chrome sets its root at 11pt and leaves the
// prose at 16px, so Quarto's 0.9rem made a caption 0.825 of the text on paper,
// a figure's and a table's alike (13.2px, measured 2026-09-28), where the
// screen had it right; mdm-look.css sets it in ems of the text. Printed with
// the extension's flags and read off pdftotext's word boxes, which grow with
// the size a face is set at.
test("printed into a PDF, a caption keeps the editor's size beside the text", {
  skip: skip || (!POPPLER && "needs pdftoppm and pdftotext"),
}, () => {
  fs.copyFileSync(path.join(ROOT, "vscode-mdm", "media", "icon.png"), path.join(DIR, "icon.png"));
  fs.writeFileSync(
    path.join(DIR, "printed-caption.mdm"),
    [
      "---",
      "format:",
      "  html:",
      "    embed-resources: true",
      "filters:",
      "  - mdm",
      "---",
      "",
      "Water is prose, a paragraph of it.",
      "",
      "![A caption under the picture.](icon.png)",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      ": A caption at the table.",
      "",
    ].join("\n")
  );
  const r = spawnSync(MDM, ["render", "printed-caption.mdm", "--to", "html", "-M", "mdm-text-font:roman"], {
    cwd: DIR,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const pdf = path.join(DIR, "printed-caption.pdf");
  fs.rmSync(pdf, { force: true });
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
      path.join(DIR, "printed-caption.html"),
    ],
    { encoding: "utf8", timeout: 60000 }
  );
  fs.rmSync(profile, { recursive: true, force: true });
  assert.ok(fs.existsSync(pdf), "Chrome printed nothing: " + c.stderr);
  const t = spawnSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8" });
  assert.equal(t.status, 0, t.stderr);
  const height = (text) => {
    const m = new RegExp('yMin="([\\d.]+)" xMax="[\\d.]+" yMax="([\\d.]+)">' + text.replace(/\./g, "\\.") + "</word>").exec(t.stdout);
    assert.ok(m, text + " is not in the printed PDF");
    return Number(m[2]) - Number(m[1]);
  };
  const prose = height("Water");
  for (const word of ["picture.", "table."]) {
    const ratio = height(word) / prose;
    assert.ok(Math.abs(ratio - 0.956) < 0.01, "the caption holding " + word + " is printed at " + ratio.toFixed(3) + " of the text");
  }
});

// A highlight is one colour on both surfaces. Both draw it as a wash with an
// alpha over the ground rather than as a flat colour, so what is compared is
// the pixel each would paint: the wash is filled over its own ground on a
// canvas, which is the compositing the browser does, and the two results
// have to be the same. The value is the owner's pick of 2026-09-19 (butter,
// B on design-highlight-colour.html); before it both surfaces drew the
// browser's `Mark`, pure #ffff00 with black letters, which is the one thing
// on the page nobody had chosen. The words keep the document's ink, so that
// is compared too.
function paintedMark(root, sel) {
  const el = root.querySelector(sel);
  const wash = getComputedStyle(el).backgroundColor;
  // The ground is the first ancestor that paints one, which is where the
  // alpha lands.
  let ground = "rgb(255, 255, 255)";
  for (let n = el.parentElement; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { ground = bg; break; }
  }
  const c = document.createElement("canvas").getContext("2d");
  c.fillStyle = ground;
  c.fillRect(0, 0, 1, 1);
  c.fillStyle = wash;
  c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  return { painted: [r, g, b], ink: getComputedStyle(el).color, ground: ground };
}

test("the page marks a word in the same colour the editor marks it", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const text = "A [passage]{.mark} in the run of the words.\n";
  const name = "highlight-colour";
  fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
  const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
  });
  OPEN_BROWSERS.add(browser);
  const page = await browser.newPage();
  await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
  const exported = await page.evaluate(
    (fn) => new Function("root", "sel", fn)(document.querySelector("main.content"), "mark"),
    paintedMark.toString().replace(/^[^{]*\{/, "").replace(/\}\s*$/, "")
  );
  await browser.close();
  OPEN_BROWSERS.delete(browser);

  const h = await openEditor({ text, scores: 0 });
  let editor;
  try {
    editor = await h.page.evaluate(
      (fn) => new Function("root", "sel", fn)(document.querySelector("#app .cm-content"), ".mdm-highlight"),
      paintedMark.toString().replace(/^[^{]*\{/, "").replace(/\}\s*$/, "")
    );
  } finally {
    await h.close();
  }
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(exported.painted[i] - editor.painted[i]) <= 1,
      "the mark is painted " + exported.painted + " on the page and " + editor.painted +
      " in the editor (grounds " + exported.ground + " and " + editor.ground + ")");
  }
  // Not the browser's yellow on either, which is what this replaced.
  assert.ok(exported.painted[2] > 120,
    "the page is back on a pure yellow: " + exported.painted);
  assert.equal(exported.ink, editor.ink, "the words in a mark are not the same ink on the two surfaces");
});

// The head of a table in the weight of its body, on the page as in the
// editor, and bold where a cell asks for it with `**` (the owner's word of
// 2026-09-27). The page's head was the browser's own bold, 700, and the
// editor's 600; the .tex has always written it as it is written
// (render.test.js).
test("the page sets a table's head in the weight of its body, as the editor does", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  const text = "| index and type | **bold head** |\n| --- | --- |\n| 0, sink | basic attractor |\n";
  const name = "table-head-weight";
  fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nfilters:\n  - mdm\n---\n\n" + text);
  const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // The head, the body and the words in `**` in the head, read the same way
  // on both surfaces.
  const weights = (table) => {
    const weight = (el) => getComputedStyle(el).fontWeight;
    const cells = (sel) => Array.from(document.querySelectorAll(table + " " + sel));
    return { head: cells("th").map(weight), body: cells("tbody td").map(weight), strong: cells("th strong").map(weight) };
  };

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
  });
  OPEN_BROWSERS.add(browser);
  const page = await browser.newPage();
  await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
  const exported = await page.evaluate(weights, "main.content table");
  await browser.close();
  OPEN_BROWSERS.delete(browser);

  const h = await openEditor({ text, scores: 0 });
  let editor;
  try {
    editor = await h.page.evaluate(weights, "#app .mdm-table");
  } finally {
    await h.close();
  }
  assert.deepEqual(exported.head, exported.body, "the page's head is not in the weight of its body");
  assert.deepEqual(exported.strong, ["700"], "a head cell written in `**` is not bold on the page");
  assert.deepEqual(exported, editor, "the page and the editor weigh the table differently");
});

// ---------- Bibliographies ----------

const BIB = `@book{knuth1984,
  author = {Knuth, Donald E.}, title = {The {\\TeX}book}, publisher = {Addison-Wesley}, year = {1984}
}
@article{shannon1948,
  author = {Shannon, Claude E.}, title = {A Mathematical Theory of Communication},
  journal = {Bell System Technical Journal}, volume = {27}, pages = {379--423}, year = {1948}
}
@article{partch1949,
  author = {Partch, Harry}, title = {Tuning by the ratio $3/2$ and the fifth $\\sqrt[12]{2^7}$},
  journal = {Journal of Tuning}, year = {1949}
}
@book{rameau1722,
  author = {Rameau, Jean-Philippe}, title = {Traité de l'harmonie réduite à ses principes naturels},
  publisher = {Ballard}, year = {1722}, langid = {french}
}
`;

// A paragraph long enough to break over several rows, with a citation of
// every shape in it, a note that cites, and the heading the list goes under.
const CITING = `The theory of consonance has a long history, from the ratios of Pythagoras to the measured intervals of the nineteenth century, and @knuth1984 is not usually counted among its sources, although the typesetting of music owes him a great deal [@knuth1984, p. 12]. The information carried by a melody was measured much later [see @shannon1948, pp. 379--423], and the tuning debates of the twentieth century [@partch1949; @rameau1722] went back to the same numbers once more.[^1]

[^1]: A note that cites [@rameau1722] as well.

## References
`;

function renderCiting(name, extra) {
  fs.writeFileSync(path.join(DIR, "refs.bib"), BIB);
  fs.writeFileSync(
    path.join(DIR, name + ".mdm"),
    "---\ntitle: Citations\nlang: en\nbibliography: refs.bib\nformat:\n  html:\n    embed-resources: true\nfilters:\n  - mdm\n---\n\n" + CITING
  );
  const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"].concat(extra || []), { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return "file://" + path.join(DIR, name + ".html");
}

// A page read at the side-by-side width, once its fonts are in; pageAt waits
// for a score, and these pages have none.
async function readCiting(url, read, arg) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
    defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 1200 },
  });
  OPEN_BROWSERS.add(browser);
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(read, arg);
  } finally {
    await browser.close();
    OPEN_BROWSERS.delete(browser);
  }
}

// Quarto's appendix took the notes and the list into a white card at 0.9 of
// the text and 0.9 opacity, under headings of its own, and the card stayed
// white under the dark look while the ink went pale: 1.42:1 (2026-09-29).
// They stay in the flow of the page now (appendix-style: none, which the
// export writes into the copy), set as the prose is.
test("the notes and the reference list stay in the flow of the page, set as the prose is and readable on either side", { skip }, async () => {
  for (const side of ["light", "dark"]) {
    const url = renderCiting("bib-" + side, ["-M", "mdm-look:" + side, "-M", "mdm-text-font:roman"]);
    const read = await readCiting(url, () => {
      // A computed colour as channels from 0 to 1 and its alpha: rgb() and
      // rgba() count to 255, and a colour-mix comes back as color(srgb ...),
      // which counts to 1 and carries its alpha after a slash.
      const channels = (c) => {
        const n = c.match(/[\d.]+/g).map(Number);
        if (/^color\(/.test(c)) return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 };
        return { rgb: n.slice(0, 3).map((x) => x / 255), a: n.length > 3 ? n[3] : 1 };
      };
      const lum = (rgb) => {
        const v = rgb.map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const ground = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const bg = getComputedStyle(e).backgroundColor;
          if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
        }
        return "rgb(255, 255, 255)";
      };
      // WCAG's contrast of the text, laid over what is behind it.
      const contrast = (el) => {
        const fg = channels(getComputedStyle(el).color);
        const bg = channels(ground(el)).rgb;
        const a = lum(fg.rgb.map((x, i) => fg.a * x + (1 - fg.a) * bg[i]));
        const b = lum(bg);
        return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
      };
      const p = document.querySelector("main.content p");
      const entry = document.querySelector("#refs .csl-entry");
      const second = document.querySelectorAll("#refs .csl-entry")[1];
      const e = getComputedStyle(entry);
      const heading = document.querySelector("#refs").previousElementSibling;
      return {
        appendix: !!document.querySelector("#quarto-appendix"),
        underHeading: heading && heading.tagName + " " + heading.textContent.trim(),
        size: e.fontSize === getComputedStyle(p).fontSize,
        leading: e.lineHeight === getComputedStyle(p).lineHeight,
        align: e.textAlign === getComputedStyle(p).textAlign,
        opacity: e.opacity,
        hang: [parseFloat(e.paddingLeft) / parseFloat(e.fontSize), parseFloat(e.textIndent) / parseFloat(e.fontSize)],
        left: Math.round(entry.getBoundingClientRect().left - p.getBoundingClientRect().left),
        gap: Math.round((parseFloat(getComputedStyle(second).marginTop) / parseFloat(e.lineHeight)) * 100) / 100,
        readable: contrast(entry) >= 4.5 && contrast(document.querySelector("section.footnotes li p")) >= 4.5,
        noteSize: getComputedStyle(document.querySelector("section.footnotes")).fontSize === getComputedStyle(p).fontSize,
        back: getComputedStyle(document.querySelector(".footnote-back")).display,
      };
    });
    assert.deepEqual(
      read,
      {
        appendix: false,
        underHeading: "H2 References",
        size: true,
        leading: true,
        align: true,
        opacity: "1",
        hang: [1.5, -1.5],
        left: 0,
        // A quarter of a line where the style asks for one (Pandoc's default
        // does), which the editor and the PDF leave too (2026-09-29).
        gap: 0.25,
        readable: true,
        noteSize: true,
        back: "none",
      },
      side
    );
  }
});

// Citeproc runs after every filter, so a formula it writes from a .bib never
// was the filter's; the page fetched MathJax from a CDN for it and KaTeX drew
// it in red. The export asks for GladTeX's markup, and mdm-math.js sets it.
test("a formula in the bibliography is set by KaTeX, and the page fetches nothing for it", { skip }, async () => {
  const url = renderCiting("bib-maths", []);
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--allow-file-access-from-files"] });
  OPEN_BROWSERS.add(browser);
  try {
    const page = await browser.newPage();
    const fetched = [];
    page.on("request", (req) => {
      if (/^https?:/.test(req.url())) fetched.push(req.url());
    });
    await page.goto(url, { waitUntil: "networkidle0" });
    const read = await page.evaluate(() => ({
      set: document.querySelectorAll("#refs eq .katex").length,
      errors: document.querySelectorAll(".katex-error").length,
      scripts: Array.from(document.scripts).filter((s) => /mathjax/i.test(s.src)).length,
    }));
    assert.deepEqual(read, { set: 2, errors: 0, scripts: 0 });
    assert.deepEqual(fetched, []);
  } finally {
    await browser.close();
    OPEN_BROWSERS.delete(browser);
  }
});

// The box the page opens over a citation was white on either side, and the
// entry in it started a hang's width left of the box, its first letter cut.
test("the box over a citation takes the look's colours and shows its entry whole", { skip }, async () => {
  const url = renderCiting("bib-box", ["-M", "mdm-look:dark", "-M", "mdm-text-align:justify"]);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
    defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 900 },
  });
  OPEN_BROWSERS.add(browser);
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0" });
    const a = (await page.$$(".citation a"))[2];
    const box = await a.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector(".tippy-box", { timeout: 5000 });
    const read = await page.evaluate(() => {
      const t = document.querySelector(".tippy-box");
      const entry = t.querySelector(".csl-entry");
      const range = document.createRange();
      range.selectNodeContents(entry);
      const card = getComputedStyle(document.body).getPropertyValue("--mdm-syn-card").trim();
      const probe = document.createElement("div");
      probe.style.color = card;
      document.body.appendChild(probe);
      const cardColour = getComputedStyle(probe).color;
      probe.remove();
      return {
        ground: getComputedStyle(t).backgroundColor === cardColour,
        align: getComputedStyle(entry).textAlign,
        whole: range.getClientRects()[0].left >= t.getBoundingClientRect().left,
      };
    });
    assert.deepEqual(read, { ground: true, align: "left", whole: true });
  } finally {
    await browser.close();
    OPEN_BROWSERS.delete(browser);
  }
});

// The line-break test of the export rule, for a paragraph that cites: with
// the citations drawn as written, every row of it ended on another word in
// the editor than on the page (2026-09-29). The editor asks the real host,
// which asks the Pandoc of the Quarto these tests render with.
test("a paragraph that cites breaks on the same words in the editor as on the page", { skip }, async () => {
  const MOCK = path.join(__dirname, "mocks", "vscode.js");
  const Module = require("node:module");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    return request === "vscode" ? MOCK : resolve.call(this, request, ...rest);
  };
  const vscode = require("vscode");
  const ext = require("../vscode-mdm/extension.js");
  const { open: openEditor } = require("./webview/helpers.js");
  const look = ["-M", "mdm-text-font:roman", "-M", "mdm-text-align:justify", "-M", "mdm-hyphenation:none", "-M", "mdm-front-matter:hidden", "-M", "mdm-look:light"];
  const url = renderCiting("bib-lines", look);
  const docPath = path.join(DIR, "bib-lines.mdm");
  const uri = "file://" + docPath;
  vscode._reset();
  vscode._state.documents.set(uri, fs.readFileSync(docPath, "utf8"));
  ext.activate({ subscriptions: [], extensionUri: vscode.Uri.file("/ext"), globalState: vscode._memento() });
  const provider = vscode._state.registeredProviders[vscode._state.registeredProviders.length - 1].provider;
  let page = null;
  let receive = null;
  let dispose = null;
  const panel = {
    webview: {
      asWebviewUri: (u) => u,
      cspSource: "vscode-resource:",
      postMessage(msg) {
        if (!page) return Promise.resolve(false);
        return page.evaluate((m) => window.postMessage(m, "*"), msg).then(() => true, () => false);
      },
      onDidReceiveMessage(handler) {
        receive = handler;
      },
    },
    onDidDispose(handler) {
      dispose = handler;
    },
  };
  provider.resolveCustomTextEditor(vscode._makeDocument(uri), panel);
  const settings = Object.assign(JSON.parse(/window\.MDM_SETTINGS = (\{.*?\});/.exec(panel.webview.html)[1]), {
    frontMatter: "hidden", textFont: "roman", textAlign: "justify", hyphenation: "none", theme: "light",
  });
  const h = await openEditor({ seed: { settings }, scores: 0, toHost: (msg, p) => { page = p; return receive(msg); } });
  let editor;
  try {
    await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1200 });
    await h.page.waitForFunction(() => document.querySelectorAll("#app .mdm-cited").length >= 5, { timeout: 20000 });
    await h.page.evaluate(() => document.activeElement && document.activeElement.blur());
    await new Promise((r) => setTimeout(r, 500));
    editor = await h.page.evaluate(
      (fn) => eval("(" + fn + ")")(Array.from(document.querySelectorAll("#app .cm-line")).filter((l) => l.querySelector(".mdm-cited") && l.textContent.length > 200)),
      LINE_ENDS
    );
  } finally {
    dispose();
    await h.close();
    Module._resolveFilename = resolve;
  }
  const pageRead = await readCiting(
    url,
    (fn) => eval("(" + fn + ")")(Array.from(document.querySelectorAll("main.content p")).filter((q) => q.querySelector(".citation") && q.textContent.length > 200)),
    LINE_ENDS
  );
  const ed = Object.values(editor);
  const pg = Object.values(pageRead);
  assert.equal(ed.length, 1, "the paragraph was not found in the editor");
  assert.equal(pg.length, 1, "the paragraph was not found on the page");
  assert.equal(ed[0].text, pg[0].text, "the editor prints other words than the page");
  assert.ok(ed[0].ends.length >= 3, "the paragraph is not long enough to test: " + JSON.stringify(ed[0].ends));
  assert.deepEqual(ed[0].ends, pg[0].ends);
});

// A numbered style on the page: the numbers in a column as wide as the widest
// of them, each flush right, and the text half an em after it on every line,
// as the editor sets the same list (webview-markdown.test.js) and look_tex the
// paper (C on design/design-bib-numbers.html, the owner's pick of
// 2026-09-30); Pandoc's stylesheet, inlined in the page, set the text at 3em.
// The box the page opens over a citation shows its entry the same way. The
// smallest style that numbers and aligns its second field, as IEEE and
// Vancouver do; ten works for a number of two figures, cited in order.
const NUMBERED_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info><title>Numbered</title><id>numbered</id><updated>2026-09-30T00:00:00+00:00</updated></info>
  <citation><layout prefix="[" suffix="]" delimiter=", "><text variable="citation-number"/></layout></citation>
  <bibliography entry-spacing="0" second-field-align="flush"><layout><text variable="citation-number" prefix="[" suffix="]"/><text variable="title" prefix=" "/></layout></bibliography>
</style>
`;

test("a numbered list on the page sets its numbers flush right in a column as wide as the widest, and the text half an em after it", { skip }, async () => {
  fs.writeFileSync(path.join(DIR, "numbered.csl"), NUMBERED_CSL);
  const keys = Array.from({ length: 10 }, (_, i) => "k" + (i + 1));
  fs.writeFileSync(
    path.join(DIR, "numbered.bib"),
    keys
      .map((k, i) => "@book{" + k + ", title = {" + (i ? "Title " + (i + 1) : "A title long enough to be set on two lines of the column of the page, and a few words more to be sure of it, and more") + "}, year = 2002}\n")
      .join("")
  );
  fs.writeFileSync(
    path.join(DIR, "bib-numbered.mdm"),
    "---\nlang: en\nbibliography: numbered.bib\ncsl: numbered.csl\nformat:\n  html:\n    embed-resources: true\nfilters:\n  - mdm\n---\n\nAs " +
      keys.map((k) => "[@" + k + "]").join(" ") + ".\n"
  );
  const r = spawnSync(MDM, ["render", "bib-numbered.mdm", "--to", "html", "-M", "mdm-text-font:roman"], { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
    defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 1200 },
  });
  OPEN_BROWSERS.add(browser);
  try {
    const page = await browser.newPage();
    await page.goto("file://" + path.join(DIR, "bib-numbered.html"), { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    const set = await page.evaluate(() => {
      const list = document.querySelector("#refs").getBoundingClientRect();
      const entries = Array.from(document.querySelectorAll("#refs .csl-entry"));
      const em = parseFloat(getComputedStyle(entries[0]).fontSize);
      const at = (x) => Math.round(((x - list.left) / em) * 100) / 100;
      const ink = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return Array.from(range.getClientRects()).filter((x) => x.width > 0);
      };
      const number = (e) => ink(e.querySelector(".csl-left-margin"))[0];
      const rows = ink(entries[0].querySelector(".csl-right-inline"));
      const widest = number(entries[9]);
      return {
        cited: Array.from(document.querySelectorAll("main.content p .citation")).map((c) => c.textContent),
        numbers: entries.map((e) => e.querySelector(".csl-left-margin").textContent.trim()),
        ends: Array.from(new Set(entries.map((e) => at(number(e).right)))).length,
        widestAt: at(widest.left),
        text: Array.from(new Set(rows.concat(entries.map((e) => ink(e.querySelector(".csl-right-inline"))[0])).map((x) => at(x.left)))),
        column: Math.round((at(widest.right) + 0.5) * 100) / 100,
        rows: new Set(rows.map((x) => Math.round(x.top))).size,
        gap: Math.round(entries[1].getBoundingClientRect().top - entries[0].getBoundingClientRect().bottom),
      };
    });
    const numbers = keys.map((k, i) => "[" + (i + 1) + "]");
    assert.deepEqual(set.cited, numbers);
    assert.deepEqual(set.numbers, numbers);
    assert.equal(set.ends, 1, "the numbers do not end in one line");
    assert.equal(set.widestAt, 0, "the widest number does not start at the list's edge");
    assert.equal(set.text.length, 1, "the text starts at more than one place: " + set.text);
    assert.ok(Math.abs(set.text[0] - set.column) < 0.02, "the text at " + set.text[0] + "em, not half an em after the numbers (" + set.column + "em)");
    assert.equal(set.rows, 2);
    assert.equal(set.gap, 0);
    // The box over the first citation: its number and its text side by
    // side, half an em apart.
    const a = await page.$(".citation a");
    const box = await a.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector(".tippy-box .csl-entry", { timeout: 5000 });
    const tip = await page.evaluate(() => {
      const e = document.querySelector(".tippy-box .csl-entry");
      const em = parseFloat(getComputedStyle(e).fontSize);
      const ink = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return Array.from(range.getClientRects()).filter((x) => x.width > 0)[0];
      };
      const n = ink(e.querySelector(".csl-left-margin"));
      const t = ink(e.querySelector(".csl-right-inline"));
      return { row: Math.abs(n.top - t.top) < 2, gap: Math.round(((t.left - n.right) / em) * 100) / 100 };
    });
    assert.equal(tip.row, true, "the box sets the number above its text");
    assert.ok(Math.abs(tip.gap - 0.5) < 0.05, "the box sets the text " + tip.gap + "em after its number");
  } finally {
    await browser.close();
    OPEN_BROWSERS.delete(browser);
  }
});

// The page divided the words of what citeproc printed ("Sha-nnon") where the
// editor, which draws a citation whole (CiteWidget), divides none: 14 marks
// in the citations of one paragraph (2026-09-29).
test("the page divides the words of a paragraph that cites and none inside its citations", { skip }, async () => {
  const url = renderCiting("bib-divide", ["-M", "mdm-hyphenation:auto"]);
  const read = await readCiting(url, () => ({
    inCitations: document.querySelectorAll("main.content .citation .mdm-hyphen").length,
    inProse: document.querySelectorAll("main.content p .mdm-hyphen").length,
  }));
  assert.equal(read.inCitations, 0);
  assert.ok(read.inProse > 10, "the prose is not divided at all: " + read.inProse);
});

// ---------- Equations by number ----------
//
// A display equation with a label after its closing `$$` is numbered at the
// right of the column on the formula's baseline, and a reference to it reads
// "Equation 1" and leads to it; Quarto did this itself only for formulas the
// filter had not written out yet, which on an MDM page was none: the label
// came out as text and every reference as "?@eq-mass" (2026-09-30). The
// equations pass in mdm.lua does it now, by the rules the editor draws by
// (media/mdm-crossref.js), and this holds the two surfaces to one another.

const EQUATIONS = `Before one, a line of prose to measure from.

$$
E = mc^2
$$

After one, a line of prose to measure to.

Before two, a line of prose to measure from.

$$
E = mc^2
$$ {#eq-mass}

After two, a line of prose to measure to.

$$
\\frac{a}{b} = \\sum_{i=1}^{n} x_i
$$ {#eq-sum}

$$
\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}
$$ {#eq-pair}

Inline, with no number, $$c = d$$ inside a paragraph.

Inline, with a number, $$c = d$$ {#eq-inline} inside a paragraph.

$$
x_{1} + x_{2} + x_{3} + x_{4} + x_{5} + x_{6} + x_{7} + x_{8} + x_{9} + x_{10} + x_{11} + x_{12} + x_{13} + x_{14} + x_{15} + x_{16} + x_{17} + x_{18} + x_{19} + x_{20} + x_{21} + x_{22} + x_{23} + x_{24} + x_{25} + x_{26}
$$ {#eq-long}

The relation between mass and energy, @eq-mass, is the one the sum in -@eq-sum and the pair of [Eq. @eq-pair] were written against, and @Eq-mass is the same equation again, beside [@eq-sum; @eq-pair] and a label nothing carries, [@eq-mass; @eq-zz], all of it in one paragraph long enough to break over several rows of the column on both surfaces, which is what the line ends below compare.
`;

// The numbered equations of a surface: the number, how far its baseline
// stands from the formula's, how far it stands in from the right of the
// column, and whether it is in the prose's face at its size.
const NUMBERS = function (sel) {
  const prose = getComputedStyle(document.querySelector(sel.prose));
  const col = document.querySelector(sel.column).getBoundingClientRect();
  return Array.from(document.querySelectorAll(sel.equation)).map((eq) => {
    const num = eq.querySelector(".mdm-eq-number");
    const disp = eq.querySelector(".katex-display");
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
    const out = {
      number: num.textContent,
      baseline: Math.round((n.getBoundingClientRect().top - m.getBoundingClientRect().top) * 10) / 10,
      right: Math.round((col.right - num.getBoundingClientRect().right) * 10) / 10,
      face: getComputedStyle(num).fontFamily === prose.fontFamily && getComputedStyle(num).fontSize === prose.fontSize,
      scrolls: disp.scrollWidth > disp.clientWidth,
      whole: num.getBoundingClientRect().width >= num.scrollWidth - 0.5 && num.getBoundingClientRect().height < parseFloat(getComputedStyle(num).fontSize) * 1.5,
    };
    m.remove();
    n.remove();
    return out;
  });
}.toString();

test("a numbered equation is set as the editor draws it, and a reference to it prints what the editor prints and breaks its paragraph on the same words", { skip }, async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const look = ["-M", "mdm-text-font:roman", "-M", "mdm-text-align:justify", "-M", "mdm-hyphenation:none", "-M", "mdm-front-matter:hidden", "-M", "mdm-look:light"];
  fs.writeFileSync(
    path.join(DIR, "equations.mdm"),
    "---\ntitle: Equations\nformat:\n  html:\n    embed-resources: true\nfilters:\n  - mdm\n---\n\n" + EQUATIONS
  );
  const r = spawnSync(MDM, ["render", "equations.mdm", "--to", "html"].concat(look), { cwd: DIR, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // The one label nothing carries, and nothing else, is warned of.
  const warned = (r.stderr + r.stdout).replace(/\x1b\[[0-9;]*m/g, "").match(/Unable to resolve crossref @\S+/g) || [];
  assert.deepEqual(Array.from(new Set(warned)), ["Unable to resolve crossref @eq-zz"]);
  const url = "file://" + path.join(DIR, "equations.html");
  const page = await readCiting(
    url,
    (arg) => {
      const numbers = eval("(" + arg.numbers + ")")({ prose: "main.content p", column: "main.content p", equation: "main.content .mdm-eq" });
      const ps = Array.from(document.querySelectorAll("main.content p"));
      const line = (t) => ps.find((p) => p.textContent.startsWith(t));
      const range = (el, last) => {
        const rg = document.createRange();
        rg.selectNodeContents(el);
        const rs = rg.getClientRects();
        return last ? rs[rs.length - 1] : rs[0];
      };
      const gaps = ["one", "two"].map((k) => range(line("After " + k)).top - range(line("Before " + k), true).bottom);
      // The display maths of a paragraph: the air between its words and the
      // formula above and below, with a number and without one.
      const inline = ["no number", "a number"].map((k) => {
        const p = line("Inline, with " + k);
        const formula = p.querySelector(".katex-display .katex-html").getBoundingClientRect();
        const rows = Array.from(p.childNodes).filter((n) => n.nodeType === 3 && n.data.trim());
        const before = range(rows[0], true);
        const after = range(rows[rows.length - 1]);
        return [Math.round((formula.top - before.bottom) * 10) / 10, Math.round((after.top - formula.bottom) * 10) / 10];
      });
      return {
        numbers: numbers,
        gaps: gaps,
        inline: inline,
        refs: Array.from(document.querySelectorAll("main.content a.quarto-xref")).map((a) => a.textContent + " " + a.getAttribute("href")),
        missing: Array.from(document.querySelectorAll("main.content p strong")).map((s) => s.textContent),
        labels: /\{#eq-/.test(document.querySelector("main.content").textContent),
        lines: eval("(" + arg.ends + ")")(ps.filter((p) => p.textContent.startsWith("The relation"))),
      };
    },
    { numbers: NUMBERS, ends: LINE_ENDS }
  );
  assert.deepEqual(page.numbers.map((n) => n.number), ["(1)", "(2)", "(3)", "(4)", "(5)"]);
  for (const n of page.numbers) {
    assert.ok(Math.abs(n.baseline) < 0.5, n.number + " stands " + n.baseline + " px off the formula's baseline on the page");
    assert.ok(Math.abs(n.right) < 0.5, n.number + " stands " + n.right + " px in from the right of the column on the page");
    assert.ok(n.face, n.number + " is not in the prose's face on the page");
    // Only the formula too wide for the column scrolls, and its number
    // stands whole beside it.
    assert.equal(n.scrolls, n.number === "(5)", n.number + (n.scrolls ? " scrolls" : " does not scroll") + " on the page");
    assert.ok(n.whole, n.number + " is not whole on one row on the page");
  }
  assert.ok(Math.abs(page.gaps[0] - page.gaps[1]) < 0.5, "the page's gaps are " + page.gaps.join(" and "));
  assert.deepEqual(page.inline[1], page.inline[0], "the display maths of a paragraph stands otherwise with a number");
  assert.equal(page.labels, false, "a label is printed on the page");
  assert.deepEqual(page.refs, [
    "Equation 1 #eq-mass",
    "2 #eq-sum",
    "Eq. 3 #eq-pair",
    "Equation 1 #eq-mass",
    "Equation 2 #eq-sum",
    "Equation 3 #eq-pair",
    "Equation 1 #eq-mass",
  ]);
  assert.deepEqual(page.missing, ["?@eq-zz"]);

  const { open: openEditor } = require("./webview/helpers.js");
  const settings = { frontMatter: "hidden", textFont: "roman", textAlign: "justify", hyphenation: "none", theme: "light" };
  const h = await openEditor({ text: EQUATIONS, seed: { settings }, scores: 0, height: 1200 });
  let editor;
  try {
    await h.page.setViewport({ width: SIDE_BY_SIDE_WIDTH, height: 1200 });
    await h.page.evaluate(() => document.activeElement && document.activeElement.blur());
    await new Promise((res) => setTimeout(res, 500));
    editor = await h.page.evaluate(
      (arg) => ({
        numbers: eval("(" + arg.numbers + ")")({ prose: "#app .cm-content", column: "#app .cm-content", equation: "#app .mdm-math--numbered" }),
        refs: Array.from(document.querySelectorAll("#app .mdm-eqref")).map((e) => e.textContent),
        lines: eval("(" + arg.ends + ")")(Array.from(document.querySelectorAll("#app .cm-line")).filter((l) => l.textContent.startsWith("The relation"))),
      }),
      { numbers: NUMBERS, ends: LINE_ENDS }
    );
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
  assert.deepEqual(editor.numbers.map((n) => n.number), page.numbers.map((n) => n.number));
  for (const n of editor.numbers) {
    assert.ok(Math.abs(n.baseline) < 0.5, n.number + " stands " + n.baseline + " px off the formula's baseline in the editor");
    assert.ok(Math.abs(n.right) < 0.5, n.number + " stands " + n.right + " px in from the right of the column in the editor");
    assert.ok(n.face, n.number + " is not in the prose's face in the editor");
    assert.equal(n.scrolls, n.number === "(5)", n.number + (n.scrolls ? " scrolls" : " does not scroll") + " in the editor");
    assert.ok(n.whole, n.number + " is not whole on one row in the editor");
  }
  const pageText = Object.values(page.lines)[0];
  const editorText = Object.values(editor.lines)[0];
  assert.ok(pageText && editorText, "the paragraph of references was not found");
  assert.equal(editorText.text, pageText.text, "the editor prints other words than the page");
  assert.ok(editorText.ends.length >= 3, "the paragraph is not long enough to test: " + JSON.stringify(editorText.ends));
  assert.deepEqual(editorText.ends, pageText.ends);
});

// ---------- Sections by number, page against editor ----------

// `number-sections: true` numbers the headings of the page, and the editor
// draws the same numbers (the owner, 2026-10-03: the key in the header drew
// nothing in the editor). The count is Quarto's own, with a callout's title,
// an unnumbered heading and a level stepped over each read its way, and the
// editor writes the same rules a second time (media/mdm-crossref.js), so the
// two are set side by side here on one document, the one the editor's own
// test opens (SECTIONS in webview-markdown.test.js) with the filter named in
// its header: every heading with its number, the number in the ink of its
// heading on both (Quarto's theme greys it, and mdm-look.css gives it back
// the heading's), and the heading as wide on the page as in the editor, which
// is the number in the heading's face at its size with one space after it.
const SECTIONS_DOC =
  "---\ntitle: \"Numbered\"\nnumber-sections: true\nfilters:\n  - mdm\n---\n" +
  "\n# Strings\n\nText.\n\n" +
  "## Modes {#sec-modes}\n\n" +
  "### Fifths ###\n\n" +
  "> ## Quoted heading\n\n" +
  "- ## Listed heading\n\n" +
  "1. Item\n\n   ### Itemed heading\n\n" +
  "::: {.callout-note}\n## Titled callout\n\nBody.\n\n## Second in a callout\n:::\n\n" +
  "::: {.callout-tip title=\"Given\"}\n## Given a title\n:::\n\n" +
  "::: {.callout-custom}\n## Boxed in a div\n:::\n\n" +
  "::: {.callout}\n# Bare callout\n:::\n\n" +
  "# Winds {-}\n\n" +
  "## Reeds {.unnumbered}\n\n" +
  "## Flutes {#flutes -}\n\n" +
  "## Horns {.Unnumbered}\n\n" +
  "## Bells {unnumbered}\n\n" +
  "Drums\n=====\n\n" +
  "Gongs {-}\n---------\n\n" +
  "##### Deep\n\n" +
  "#\n\n" +
  "## *Emphasis* and `code`\n";

// The headings of a surface: for each its number, or `-`, with the first
// word of its text, whether the number is in the heading's ink, and how wide
// the heading's run is, the number and its space in it. `number` is the
// selector of a number inside a heading; the page's anchor link, which
// stands after the text, is left out of the width.
const SECTION_HEADINGS = function (headings, number) {
  return headings.map((h) => {
    const mark = h.querySelector(number);
    let text = "";
    let past = !mark;
    const walk = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.parentElement.closest(".anchorjs-link")) continue;
      if (mark && mark.contains(n)) past = true;
      else if (past) text += n.textContent;
    }
    const run = document.createRange();
    run.selectNodeContents(h);
    const anchor = h.querySelector(".anchorjs-link");
    if (anchor) run.setEndBefore(anchor);
    return {
      heading: (mark ? mark.textContent.trim() : "-") + " " + (text.replace(/^[^\p{L}]+/u, "").split(/\s+/)[0] || ""),
      ink: mark ? getComputedStyle(mark).color === getComputedStyle(h).color : null,
      width: +run.getBoundingClientRect().width.toFixed(2),
    };
  });
}.toString();

test("a numbered section carries on the page the number the editor draws on it, in the heading's ink and as wide, in either face", { skip }, async () => {
  const { open: openEditor } = require("./webview/helpers.js");
  for (const face of ["roman", "sans"]) {
    const name = "sections-" + face;
    fs.writeFileSync(path.join(DIR, name + ".mdm"), SECTIONS_DOC);
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
      (fn) =>
        eval("(" + fn + ")")(
          Array.from(document.querySelectorAll("main.content :is(h1, h2, h3, h4, h5, h6):not(.title)")),
          ".header-section-number"
        ),
      SECTION_HEADINGS
    );
    await browser.close();
    OPEN_BROWSERS.delete(browser);

    const h = await openEditor({ text: SECTIONS_DOC, scores: 0, height: 2600, seed: { settings: { textFont: face } } });
    let editor;
    try {
      await h.page.evaluate(() => document.activeElement && document.activeElement.blur());
      await h.page.mouse.click(2, 2);
      await new Promise((res) => setTimeout(res, 300));
      await h.page.evaluate(() => document.fonts.ready);
      editor = await h.page.evaluate(
        (fn) => eval("(" + fn + ")")(Array.from(document.querySelectorAll("#app .cm-line.mdm-h")), ".mdm-section-number"),
        SECTION_HEADINGS
      );
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }

    // The title of a callout is a heading's line in the editor and none on
    // the page, and it has no number in either.
    const titles = editor.filter((e) => /^- (?:Titled|Bare)$/.test(e.heading));
    assert.equal(titles.length, 2, "the editor numbers the title of a callout: " + JSON.stringify(editor.map((e) => e.heading)));
    const drawn = editor.filter((e) => titles.indexOf(e) === -1);
    assert.equal(exported.length, 19, "the " + face + " page has other headings than the document: " + JSON.stringify(exported.map((e) => e.heading)));
    assert.deepEqual(
      drawn.map((e) => e.heading),
      exported.map((e) => e.heading),
      "the " + face + " editor numbers its sections otherwise than the page"
    );
    assert.equal(exported.filter((e) => e.ink !== null).length, 15, face);
    for (const surface of [exported, drawn]) {
      for (const e of surface) {
        if (e.ink !== null) assert.equal(e.ink, true, "the number of " + JSON.stringify(e.heading) + " is not in the ink of its heading (" + face + (surface === exported ? " page)" : " editor)"));
      }
    }
    // As wide on both, where both set the same words at the same size: an
    // item's heading has its bullet on the editor's line, a setext heading
    // keeps its attributes on screen there, and a heading inside a callout
    // is smaller on the page than in the editor, numbered or not ("1.4
    // Second in a callout" measured 311.48 px on the roman page and 325.75
    // in the editor, 2026-10-03), which is the callout's difference and is
    // not this test's; neither is that of the code in a heading (the last
    // one, 329.55 px against 327.84).
    for (const word of ["Strings", "Modes", "Fifths", "Quoted", "Horns", "Drums", "Deep"]) {
      const at = exported.findIndex((e) => e.heading.split(" ")[1] === word);
      assert.ok(at >= 0, word);
      assert.ok(
        Math.abs(exported[at].width - drawn[at].width) < 0.5,
        JSON.stringify(exported[at].heading) + " is " + exported[at].width + " px wide on the " + face + " page and " + drawn[at].width + " in the editor"
      );
    }
  }
});

// The one rule of the count that is the owner's and not Quarto's
// (2026-10-03, sectionNumbers in mdm-crossref.js): under `# Title {-}` the
// sections count from the second level, 1, 1.1, 2, where Quarto prints 0.1,
// 0.1.1, 0.2. The page is brought to the editor by mdm-after.lua, which
// takes the first counter off what Quarto wrote: off the heading, off the
// contents made from it, off the data-number and off a reference to the
// heading. Held on both ways the filter reaches a document: by the
// extension's name, whose _extension.yml hands the second filter in after
// Quarto's own, and by path with the second filter on the command line,
// which is the VS Code export's way (withFilter and renderArgs, called here
// as the export calls them).
const TITLED_DOC =
  "---\nnumber-sections: true\ntoc: true\nfilters:\n  - mdm\n---\n" +
  "\n# Scales {-}\n\nSee @sec-major, [-@sec-thirds] and @sec-triads.\n\n" +
  "## Major {#sec-major}\n\n### Thirds {#sec-thirds}\n\n" +
  "::: {.callout-note}\n## A note\n\nBody.\n\n## Inside the note\n:::\n\n" +
  "## Minor\n\n# Chords {.unnumbered}\n\n## Triads {#sec-triads}\n\n## Sources {-}\n\nText.\n";

test("under a title with its number off the page counts its sections from the second level as the editor does, in the headings, the contents and the references, by either way the filter is called", { skip }, async () => {
  const MOCK = path.join(__dirname, "mocks", "vscode.js");
  const Module = require("node:module");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    return request === "vscode" ? MOCK : resolve.call(this, request, ...rest);
  };
  const ext = require("../vscode-mdm/extension.js");
  Module._resolveFilename = resolve;
  const { open: openEditor } = require("./webview/helpers.js");

  // By the extension's name, as bin/mdm renders it.
  fs.writeFileSync(path.join(DIR, "titled-name.mdm"), TITLED_DOC);
  const named = spawnSync(MDM, ["render", "titled-name.mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
  assert.equal(named.status, 0, named.stderr);
  // By path, as the export's copy names it, with the export's own arguments.
  const copy = ext.withFilter(TITLED_DOC, ext.FILTER);
  assert.ok(!/mdm-after/.test(copy), "the copy's header names the second filter, which is a line more in it");
  fs.writeFileSync(path.join(DIR, "titled-path.qmd"), copy);
  const args = ext.renderArgs(copy, "titled-path.qmd", ["--to", "html"]);
  const pathed = spawnSync("quarto", args, { cwd: DIR, encoding: "utf8" });
  assert.equal(pathed.status, 0, pathed.stderr);

  // And the two it has to leave as Quarto wrote them: a document with no `#`
  // at all, whose numbers start at the second level already, and one that
  // asks for chapters, which keeps the first level whatever it has (both
  // rows of the editor's rule in crossref.test.js).
  const untouched = {
    "titled-none": ["", "## Major\n\n### Thirds\n\n## Minor\n", ["1 Major", "1.1 Thirds", "2 Minor"]],
    "titled-chapters": ["crossref:\n  chapters: true\n", "# Scales {-}\n\n## Major\n\n## Minor\n", ["- Scales", "0.1 Major", "0.2 Minor"]],
  };
  for (const name of Object.keys(untouched)) {
    fs.writeFileSync(path.join(DIR, name + ".mdm"), "---\nnumber-sections: true\n" + untouched[name][0] + "filters:\n  - mdm\n---\n\n" + untouched[name][1]);
    const r = spawnSync(MDM, ["render", name + ".mdm", "--to", "html"], { cwd: DIR, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }

  const h = await openEditor({ text: TITLED_DOC, scores: 0, height: 1800 });
  let editor;
  try {
    await h.page.evaluate(() => document.activeElement && document.activeElement.blur());
    await h.page.mouse.click(2, 2);
    await new Promise((res) => setTimeout(res, 300));
    editor = await h.page.evaluate(
      (fn) => eval("(" + fn + ")")(Array.from(document.querySelectorAll("#app .cm-line.mdm-h")), ".mdm-section-number"),
      SECTION_HEADINGS
    );
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
  // The title of the callout is a heading's line in the editor and none on
  // the page, with no number in either.
  const drawn = editor.map((e) => e.heading).filter((e) => e !== "- A");
  assert.deepEqual(drawn, ["- Scales", "1 Major", "1.1 Thirds", "2 Inside", "3 Minor", "- Chords", "4 Triads", "- Sources"]);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--allow-file-access-from-files"],
    defaultViewport: { width: SIDE_BY_SIDE_WIDTH, height: 1200 },
  });
  OPEN_BROWSERS.add(browser);
  // The headings of the document: the contents printed for paper are a nav
  // inside the page's main with a heading of their own (mdm-toc.js).
  try {
    for (const name of ["titled-name", "titled-path"]) {
      const page = await browser.newPage();
      await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
      const exported = await page.evaluate(
        (fn) =>
          eval("(" + fn + ")")(
            Array.from(document.querySelectorAll("main.content :is(h1, h2, h3, h4, h5, h6):not(.title, nav *)")),
            ".header-section-number"
          ),
        SECTION_HEADINGS
      );
      assert.deepEqual(exported.map((e) => e.heading), drawn, name + ": the page numbers its sections otherwise than the editor");
      const rest = await page.evaluate(() => ({
        data: Array.from(document.querySelectorAll("main.content :is(h1, h2, h3, h4, h5, h6):not(.title, nav *)")).map((el) => el.getAttribute("data-number") || "-"),
        contents: Array.from(document.querySelectorAll("#TOC a")).map((a) => a.textContent.replace(/\s+/g, " ").trim()),
        references: Array.from(document.querySelectorAll("main.content a.quarto-xref")).map((a) => a.textContent.replace(/ /g, " ")),
      }));
      assert.deepEqual(rest.data, drawn.map((e) => e.split(" ")[0]), name + ": the number a heading says it has is not the one it shows");
      assert.deepEqual(rest.contents, ["Scales", "1 Major", "1.1 Thirds", "3 Minor", "Chords", "4 Triads", "Sources"], name);
      assert.deepEqual(rest.references, ["Section 1", "1.1", "Section 4"], name);
      await page.close();
    }
    for (const name of Object.keys(untouched)) {
      const page = await browser.newPage();
      await page.goto("file://" + path.join(DIR, name + ".html"), { waitUntil: "networkidle0" });
      const exported = await page.evaluate(
        (fn) =>
          eval("(" + fn + ")")(
            Array.from(document.querySelectorAll("main.content :is(h1, h2, h3, h4, h5, h6):not(.title, nav *)")),
            ".header-section-number"
          ),
        SECTION_HEADINGS
      );
      assert.deepEqual(exported.map((e) => e.heading), untouched[name][2], name + ": numbers that were Quarto's to keep");
      await page.close();
    }
  } finally {
    await browser.close();
    OPEN_BROWSERS.delete(browser);
  }
});
