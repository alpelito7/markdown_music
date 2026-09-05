// Shared helpers for the webview tests (tests/webview-*.test.js): a real
// browser (puppeteer-core + google-chrome) opens tests/webview/harness.html,
// the page extension.js builds with the host replaced by a shim that records
// what the webview posts in window.__posts, and the document is handed over
// with the host's own update message.
//
// The editor is CodeMirror 6 (window.__mdm.view in the page, exposed by
// main.js for this harness): the text of the document is the file text, and
// what is rendered where depends on where the carets are. The helpers at the
// bottom move the carets and read the document from the test side.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { toEditor, hiddenLines } = require("../../vscode-mdm/transforms.js");

const CHROME = "/usr/bin/google-chrome";
const HARNESS = "file://" + path.join(__dirname, "harness.html");
const EXAMPLE = fs.readFileSync(path.join(__dirname, "..", "..", "example.mdm"), "utf8");

// The webview types a proof edit at the end of the first body paragraph in a
// few tests; example.mdm is written and rewritten by hand, so the paragraph's
// wording drifts. This inserts a marker at its end whatever it says, instead
// of matching a phrase that no longer exists.
function typedIntoFirstParagraph(text, insert) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n/, "");
  const firstPara = body.split(/\n\n/)[0];
  return text.replace(firstPara, firstPara + insert);
}

// The seek and resume tests measure the player against a tune's exact length
// and note grid, which the third score of example.mdm carried until it was
// re-voiced by hand (mixed note lengths now, and about 28s). They run on this
// fixture instead: three scores so the player mounts as it does in the
// document, the third an even stream of eighth notes at a quarter of 100, so
// four 4/4 bars are about 9.6s and a note falls every ~300ms. A stable grid is
// what the resume test needs to predict where the next note lands.
const TIMING_FIXTURE = [
  "---",
  'title: "Timing fixture"',
  "---",
  "",
  "A tune to seek in, and two more so the player mounts as it does in the document.",
  "",
  "```abc",
  "X:1",
  "K:C",
  "CDEFGABc|",
  "```",
  "",
  "The middle score.",
  "",
  "```abc",
  "X:1",
  "K:C",
  "cBAGFEDC|",
  "```",
  "",
  "Four 4/4 bars of even eighths at a quarter of 100: about 9.6 seconds, a note every 300 ms.",
  "",
  "```{.abc .play}",
  "X:1",
  "M:4/4",
  "L:1/8",
  "Q:1/4=100",
  "K:C",
  "CDEF GABc | cBAG FEDC | CDEF GABc | cBAG FEDC |",
  "```",
  "",
].join("\n");

// A duet on two staves, the second in bass clef, for the highlight: the two
// voices sound together and are engraved on staves of their own, and abcjs
// names only the first of them in the startChar/endChar of the event it
// reports. The clefs differ on purpose, so that a voice left dark is the one
// a reader would notice; the parts run in parallel quarters, so that at every
// moment there is exactly one note to light on each staff.
const DUET_FIXTURE = [
  "---",
  'title: "Duet"',
  "---",
  "",
  "Two parts, one in each clef, sounding together.",
  "",
  "```{.abc .play}",
  "X:1",
  "M:4/4",
  "L:1/4",
  "Q:1/4=120",
  "K:C",
  "V:1 clef=treble",
  "V:2 clef=bass",
  "[V:1] CDEF | GABc |",
  "[V:2] C,D,E,F, | G,A,B,C |",
  "```",
  "",
].join("\n");

// A duet with a written silence in it, for the ink over a rest. The treble
// holds a half note and then a quarter rest while the bass holds a dotted
// half through the whole measure, so the rest is a moment of the tune where
// nothing at all attacks; the measure after it starts with a rest that DOES
// share its moment with a bass chord, which is the case that always worked.
// Three measures at 110 are about 4.9 seconds.
const REST_FIXTURE = [
  "---",
  'title: "Rest"',
  "---",
  "",
  "A rest one hand holds alone.",
  "",
  "```{.abc .play}",
  "X:1",
  "M:3/4",
  "L:1/8",
  "Q:1/4=110",
  "K:Am",
  "V:1 clef=treble",
  "V:2 clef=bass",
  "[V:1] B4 z2 | z2 A G A2 | G4 z2 |",
  "[V:2] [G,,B,,D,]6 | [A,,C,E,]4 [A,,C,E,]2 | [E,G,B,]6 |",
  "```",
  "",
].join("\n");

// A file that opens on a score: no front matter, the fence on the first line.
// The selection an untouched document carries sits at character 0, which is
// inside this block, so anything that wakes that selection shows the ABC of a
// score nobody has put a caret in. A second score further down gives the
// tests a player to open away from the top.
const TOP_SCORE_FIXTURE = [
  "```abc",
  "X:1",
  "K:C",
  "CDEF|",
  "```",
  "",
  "A file that opens on a score, with the prose below it.",
  "",
  "```abc",
  "X:2",
  "K:C",
  "GABc|",
  "```",
  "",
].join("\n");

let puppeteer = null;
try {
  puppeteer = require("puppeteer-core");
} catch (e) {
  // Reported as a skip below.
}

const available = puppeteer && fs.existsSync(CHROME);

// Opens the harness, hands it a document and waits for the first render.
// `seed` goes into the page before it loads (settings, palette, themes).
//
// A tall window on purpose: CodeMirror renders only the lines in view (plus
// a margin), and the scores and code of example.mdm must all be on screen
// for the counts the tests make. A test that wants a short pane passes
// `height`.
async function open(options) {
  const opts = options || {};
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: [
      "--no-sandbox",
      "--allow-file-access-from-files",
      // The player tests press play from a synthetic click; headless autoplay
      // policy must not hold the AudioContext suspended for it.
      "--autoplay-policy=no-user-gesture-required",
    ],
    defaultViewport: { width: 900, height: opts.height || 2400 },
  });
  OPEN_BROWSERS.add(browser);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((seed) => {
    window.__settings = seed.settings || {};
    window.__palette = seed.palette || null;
    window.__side = seed.side || null;
    window.__themes = seed.themes || [];
    window.__docBase = seed.docBase || null;
    window.__fileBase = seed.fileBase || null;
  }, opts.seed || {});
  if (opts.clipboard) {
    // Headless has no clipboard to write to; what was copied is recorded.
    await page.evaluateOnNewDocument(() => {
      window.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: (text) => {
            window.__copied.push(text);
            return Promise.resolve();
          },
        },
        configurable: true,
      });
    });
  }
  if (opts.gainSpy) {
    // Every realtime gain the webview builds, in the order it builds them:
    // the master volume first (ensureAudioGraph), then the stage the resume
    // silence uses. The audioSpy above catches the second one, which is what
    // the source connects to; the mute is set on the first.
    await page.evaluateOnNewDocument(() => {
      window.__gains = [];
      const make = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function () {
        const node = make.apply(this, arguments);
        window.__gains.push(node);
        return node;
      };
    });
  }
  if (opts.audioLife) {
    // The life of the realtime graph: how many contexts the page makes, the
    // oscillators it starts (the pilot that keeps the output awake) with the
    // gain each feeds and where that gain goes, and the idle timer the
    // editor sets after the last player closes, caught so that a test can
    // fire it without waiting the minute out.
    await page.evaluateOnNewDocument(() => {
      window.__contexts = [];
      const Orig = window.AudioContext;
      window.AudioContext = function () {
        const ctx = new Orig();
        window.__contexts.push(ctx);
        return ctx;
      };
      window.AudioContext.prototype = Orig.prototype;
      window.__pilots = [];
      const oscConnect = OscillatorNode.prototype.connect;
      OscillatorNode.prototype.connect = function (target) {
        window.__pilots.push({ osc: this, gain: target, stopped: false, sink: null });
        return oscConnect.apply(this, arguments);
      };
      const oscStop = OscillatorNode.prototype.stop;
      OscillatorNode.prototype.stop = function () {
        const p = window.__pilots.find((x) => x.osc === this);
        if (p) p.stopped = true;
        return oscStop.apply(this, arguments);
      };
      const gainConnect = GainNode.prototype.connect;
      GainNode.prototype.connect = function (target) {
        const p = window.__pilots.find((x) => x.gain === this);
        if (p) p.sink = target.constructor.name;
        return gainConnect.apply(this, arguments);
      };
      window.__idle = [];
      const realSetTimeout = window.setTimeout;
      window.setTimeout = function (fn, ms) {
        if (ms >= 30000) {
          window.__idle.push({ fn: fn, ms: ms });
          return realSetTimeout.call(window, function () {}, ms);
        }
        return realSetTimeout.apply(window, arguments);
      };
    });
  }
  if (opts.audioSpy) {
    // Records what every buffer source connects to, and keeps the realtime
    // gain node if one shows up in that path: abcjs stock connects the
    // playback source straight to the destination, so a realtime GainNode
    // here is proof the volume reroute is in force.
    await page.evaluateOnNewDocument(() => {
      window.__connects = [];
      const orig = AudioBufferSourceNode.prototype.connect;
      AudioBufferSourceNode.prototype.connect = function (target) {
        try {
          window.__connects.push(
            target.constructor.name + "@" + target.context.constructor.name
          );
          if (target instanceof GainNode && target.context instanceof AudioContext) {
            window.__gain = target; // the first stage: the resume mute
          }
        } catch (e) {
          // never break playback from the spy
        }
        return orig.apply(this, arguments);
      };
      // The chain is mute -> volume -> destination; the volume stage, the one
      // the slider drives, is the gain another gain connects into.
      const gainConnect = GainNode.prototype.connect;
      GainNode.prototype.connect = function (target) {
        try {
          if (target instanceof GainNode && target.context instanceof AudioContext) {
            window.__volGain = target;
          }
        } catch (e) {
          // same
        }
        return gainConnect.apply(this, arguments);
      };
    });
  }
  await page.goto(HARNESS);
  // The editor is only built once the first document arrives, so what says
  // the webview is up is the `ready` it posts to the host.
  await page.waitForFunction(
    () => window.__posts.some((m) => m.type === "ready"),
    { timeout: 20000 }
  );
  const withFrontMatter = opts.withFrontMatter !== false;
  await update(page, opts.text || EXAMPLE, withFrontMatter, opts.scores);
  return {
    page,
    browser,
    errors,
    close: async () => {
      OPEN_BROWSERS.delete(browser);
      await browser.close();
    },
  };
}

// A failing assertion skips the close() at the end of its test, and a browser
// left running keeps the whole run from exiting.
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

// The host's update message, with the text mapped the way the host maps it,
// and with the count of the lines that mapping kept back, which is what the
// numbers in the margin count from.
async function update(page, disk, withFrontMatter, scores) {
  await page.evaluate(
    (text, fm, hidden) =>
      window.postMessage(
        {
          type: "update",
          text: text,
          frontMatter: "x",
          withFrontMatter: fm,
          hiddenLines: hidden,
        },
        "*"
      ),
    toEditor(disk, withFrontMatter),
    withFrontMatter,
    hiddenLines(disk, withFrontMatter)
  );
  // The scores are engraved as their widgets are built, and fitted on an
  // animation frame after; settle before measuring. A document with no score
  // of its own (`scores: 0`) waits for the first line instead.
  const want = scores === undefined ? 3 : scores;
  if (want > 0) {
    await page.waitForFunction(
      (n) => document.querySelectorAll("#app code.language-abc svg").length >= n,
      { timeout: 20000 },
      want
    );
  } else {
    await page.waitForFunction(
      () => document.querySelectorAll("#app .cm-content .cm-line").length > 0,
      { timeout: 20000 }
    );
  }
  await new Promise((r) => setTimeout(r, 300));
}

// The webview debounces an edit for 300 ms before posting it. Waiting a fixed
// stretch instead made the round-trip tests flaky on a loaded machine: the
// edit had simply not been posted yet and the assertion read `undefined`.
async function lastEdit(page) {
  await page.waitForFunction(
    () => window.__posts.some((m) => m.type === "edit"),
    { timeout: 15000 }
  );
  return page.evaluate(
    () => (window.__posts.filter((m) => m.type === "edit").pop() || {}).text
  );
}

const skip = available
  ? false
  : "needs puppeteer-core (npm install) and " + CHROME;

// ---- The editor from the test side ----

// The text in the editor.
function docText(page) {
  return page.evaluate(() => window.__mdm.view.state.doc.toString());
}

// Position of the nth occurrence of `needle` (0-based), plus `offset`.
function posOf(page, needle, offset, nth) {
  return page.evaluate(
    (needle, offset, nth) => {
      const text = window.__mdm.view.state.doc.toString();
      let at = -1;
      for (let i = 0; i <= (nth || 0); i++) at = text.indexOf(needle, at + 1);
      return at < 0 ? -1 : at + (offset || 0);
    },
    needle,
    offset || 0,
    nth || 0
  );
}

// Puts the carets. `ranges` is a list of {anchor, head?}; a single number is
// one caret. Dispatches through the view, as the arrow keys would, so the
// rendering follows.
function setSelection(page, ranges) {
  const list = Array.isArray(ranges) ? ranges : [{ anchor: ranges }];
  return page.evaluate((list) => {
    const { EditorSelection } = window.__mdm.CM;
    const view = window.__mdm.view;
    view.dispatch({
      selection: EditorSelection.create(
        list.map((r) =>
          EditorSelection.range(r.anchor, r.head === undefined ? r.anchor : r.head)
        ),
        0
      ),
      scrollIntoView: true,
    });
    view.focus();
  }, list);
}

// The selection ranges, as [from, to] pairs.
function selectionRanges(page) {
  return page.evaluate(() =>
    window.__mdm.view.state.selection.ranges.map((r) => [r.from, r.to])
  );
}

// Screen coordinates of a document position (centre of the line box).
function coordsAt(page, pos) {
  return page.evaluate((pos) => {
    const r = window.__mdm.view.coordsAtPos(pos);
    return r ? { x: r.left + 1, y: (r.top + r.bottom) / 2 } : null;
  }, pos);
}

// The .cm-line element holding a position, from the test side: its classes
// and text.
function lineAt(page, pos) {
  return page.evaluate((pos) => {
    const view = window.__mdm.view;
    const dom = view.domAtPos(pos).node;
    const el = dom.nodeType === 1 ? dom : dom.parentElement;
    const line = el && el.closest ? el.closest(".cm-line") : null;
    return line ? { className: line.className, text: line.textContent } : null;
  }, pos);
}

// The settings message the host sends back after a button press. The webview
// never repaints itself: every toolbar button that holds a state asks the host
// (setSetting) and waits for the value to come back, so a test that presses one
// posts this behind it. Every key travels, with the harness defaults unless
// overridden, which is what the real readSettings does.
function settingsMessage(overrides) {
  return {
    type: "settings",
    settings: Object.assign(
      {
        theme: "light",
        scoreFill: "none",
        staffLines: "gray",
        scoreAlign: "center",
        frontMatter: "shown",
        outline: "hidden",
        outlineWidth: 250,
        multicursorMatch: "word",
      },
      overrides || {}
    ),
  };
}

function postSettings(page, overrides) {
  return page.evaluate(
    (msg) => window.postMessage(msg, "*"),
    settingsMessage(overrides)
  );
}

// What the webview asked the host to store, in the order it asked.
function setSettingPosts(page) {
  return page.evaluate(() =>
    window.__posts.filter((m) => m.type === "setSetting")
  );
}

module.exports = {
  CHROME,
  HARNESS,
  EXAMPLE,
  TIMING_FIXTURE,
  DUET_FIXTURE,
  REST_FIXTURE,
  TOP_SCORE_FIXTURE,
  typedIntoFirstParagraph,
  open,
  update,
  lastEdit,
  skip,
  docText,
  posOf,
  setSelection,
  selectionRanges,
  coordsAt,
  lineAt,
  settingsMessage,
  postSettings,
  setSettingPosts,
};
