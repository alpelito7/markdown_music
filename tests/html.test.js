// Tests for the HTML side of the Quarto extension, in a real browser: the
// filter emits the ABC source and _extensions/mdm/resources/mdm.js engraves it
// with abcjs when the page loads. Everything here happens at run time, so the
// pandoc output that render.test.js checks says nothing about it: whether a
// narrow score keeps its natural width and sits centred, whether the box under
// it is the height of the drawing, and whether a .play block grows its
// controls.
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

// Rendered once for the whole file: quarto takes a few seconds.
let PAGE = null;

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
async function open() {
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
  await page.goto(PAGE);
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

// One entry per music block: the boxes of the figure, the fitting wrapper if
// mdm.js added one, the paper and the engraved SVG.
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

test("every music block is engraved, and only the narrow one is fitted", { skip }, async () => {
  const h = await open();
  const out = await blocks(h.page);
  assert.equal(out.length, 3);
  for (const b of out) {
    assert.ok(b.svg.width > 0 && b.svg.height > 0, "a block was not engraved");
  }
  // The narrow score keeps the width %%staffwidth asked for, in a wrapper of
  // its own, and stays well inside the page.
  assert.equal(out[0].fitted, true, "the narrow score was not fitted");
  assert.match(out[0].maxWidth, /^\d+px$/);
  assert.ok(
    out[0].svg.width < out[0].block.width - 40,
    "the narrow score was stretched: " + out[0].svg.width
  );
  // The wide one and the playable one take the text width, with no wrapper.
  for (const b of [out[1], out[2]]) {
    assert.equal(b.fitted, false);
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
      (b.fitted ? "narrow" : "wide") +
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
