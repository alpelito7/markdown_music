// Tests for the webview (vscode-mdm/media/main.js + style.css), driven in a
// real browser: the harness in tests/webview/harness.html is the page
// extension.js builds, with the host replaced by a shim that records what the
// webview posts.
//
// What is fixed here is what cannot be checked any other way: that the YAML
// header is painted without breaking lute's serialization, that the blocks are
// spaced like paragraphs, and that the buttons leave the editor where the user
// expects it.
// Run with: node --test tests/webview.test.js   (needs google-chrome)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { toEditor, fromEditor } = require("../vscode-mdm/transforms.js");

const CHROME = "/usr/bin/google-chrome";
const HARNESS = "file://" + path.join(__dirname, "webview", "harness.html");
const EXAMPLE = fs.readFileSync(path.join(__dirname, "..", "example.mdm"), "utf8");

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

let puppeteer = null;
try {
  puppeteer = require("puppeteer-core");
} catch (e) {
  // Reported as a skip below.
}

const available = puppeteer && fs.existsSync(CHROME);

// Opens the harness, hands it a document and waits for the first render.
// `seed` goes into the page before it loads (settings, palette, themes).
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
    defaultViewport: { width: 900, height: 700 },
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
  // Vditor is only constructed once the first document arrives, so what says
  // the webview is up is the `ready` it posts to the host.
  await page.waitForFunction(
    () => window.__posts.some((m) => m.type === "ready"),
    { timeout: 20000 }
  );
  const withFrontMatter = opts.withFrontMatter !== false;
  await update(page, opts.text || EXAMPLE, withFrontMatter, opts.scores);
  return {
    page,
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

// The host's update message, with the text mapped the way the host maps it.
async function update(page, disk, withFrontMatter, scores) {
  await page.evaluate(
    (text, fm) =>
      window.postMessage(
        { type: "update", text: text, frontMatter: "x", withFrontMatter: fm },
        "*"
      ),
    toEditor(disk, withFrontMatter),
    withFrontMatter
  );
  // The scores are engraved on an animation frame after the render, and abcjs
  // is fetched the first time; settle before measuring. A document with no
  // score of its own (`scores: 0`) waits for the first block instead.
  const want = scores === undefined ? 3 : scores;
  if (want > 0) {
    await page.waitForFunction(
      (n) => document.querySelectorAll("code.language-abc svg").length >= n,
      { timeout: 20000 },
      want
    );
  } else {
    await page.waitForFunction(
      () => {
        const root = document.querySelector("#app .vditor-ir .vditor-reset");
        return !!root && root.children.length > 0;
      },
      { timeout: 20000 }
    );
  }
  await new Promise((r) => setTimeout(r, 300));
}

// The webview debounces an edit for 300 ms before posting it. Waiting a fixed
// stretch instead made the two round-trip tests flaky on a loaded machine (a
// full run drives one browser after another): the edit had simply not been
// posted yet and the assertion read `undefined`.
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

// ---------- The YAML header ----------

test("the header is painted, and its editable source stays one text node", { skip }, async () => {
  const h = await open({});
  const out = await h.page.evaluate(() => {
    const block = document.querySelector('#app div[data-type="yaml-front-matter"]');
    const source = block.querySelector("pre.vditor-ir__marker--pre > code");
    const preview = block.querySelector("pre.mdm-fm-preview");
    return {
      attrs: preview ? preview.querySelectorAll(".hljs-attr").length : 0,
      strings: preview ? preview.querySelectorAll(".hljs-string").length : 0,
      // What lute reads to serialize the block: it takes the first child of
      // the code element, so anything but a lone text node loses the header.
      childNodes: source.childNodes.length,
      firstIsText: source.firstChild.nodeType === 3,
      sourceText: source.textContent,
      previewText: preview ? preview.textContent : "",
    };
  });
  assert.ok(out.attrs >= 8, "keys painted: " + out.attrs);
  assert.ok(out.strings >= 5, "values painted: " + out.strings);
  assert.equal(out.childNodes, 1);
  assert.equal(out.firstIsText, true);
  assert.equal(out.previewText, out.sourceText);
  await h.close();
});

test("an edit anywhere leaves the header intact (the lute serialization trap)", { skip }, async () => {
  const h = await open({});
  await h.page.evaluate(() => {
    const p = document.querySelector("#app .vditor-ir .vditor-reset > p");
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await h.page.keyboard.type("QQ");
  const sent = await lastEdit(h.page);
  assert.ok(sent, "the webview sent no edit");
  assert.equal(
    fromEditor(sent, EXAMPLE, true),
typedIntoFirstParagraph(EXAMPLE, "QQ")
  );
  await h.close();
});

test("typing inside the header keeps the caret and the text", { skip }, async () => {
  const h = await open({});
  const offset = await h.page.evaluate(() => {
    const code = document.querySelector(
      '#app div[data-type="yaml-front-matter"] pre.vditor-ir__marker--pre > code'
    );
    const at = code.textContent.indexOf("alpelito7") + "alpelito7".length;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, null);
    let seen = 0;
    let node;
    while ((node = walker.nextNode())) {
      if (seen + node.textContent.length >= at) {
        const r = document.createRange();
        r.setStart(node, at - seen);
        r.collapse(true);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        break;
      }
      seen += node.textContent.length;
    }
    return at;
  });
  await h.page.keyboard.type("ZZ");
  await new Promise((r) => setTimeout(r, 900));
  const out = await h.page.evaluate(() => {
    const code = document.querySelector(
      '#app div[data-type="yaml-front-matter"] pre.vditor-ir__marker--pre > code'
    );
    const sel = getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    let caret = null;
    if (range && code.contains(range.startContainer)) {
      const upto = range.cloneRange();
      upto.selectNodeContents(code);
      upto.setEnd(range.startContainer, range.startOffset);
      caret = upto.toString().length;
    }
    return {
      caret: caret,
      text: code.textContent,
      preview: (document.querySelector("#app pre.mdm-fm-preview") || {}).textContent,
      sent: (window.__posts.filter((m) => m.type === "edit").pop() || {}).text,
    };
  });
  assert.equal(out.caret, offset + 2);
  assert.match(out.text, /author: alpelito7ZZ/);
  assert.match(out.preview, /author: alpelito7ZZ/);
  assert.equal(
    fromEditor(out.sent, EXAMPLE, true),
    EXAMPLE.replace("author: alpelito7", "author: alpelito7ZZ")
  );
  await h.close();
});

// ---------- Spacing ----------

// A paragraph on each side of every kind of block, which is what this test
// measures. It used to read example.mdm, and the pairs it needs come and go as
// that document is rewritten: the run that caught this had no code block with a
// paragraph under it at all.
const SPACING = `---
title: "t"
---

One.

Two paragraphs in a row, which is the gap everything else is measured against.

\`\`\`python
x = 1
\`\`\`

Two.

$$
y = x
$$

Three.

\`\`\`abc
X:1
K:C
CDEF|
\`\`\`

Four.

\`\`\`abc
X:2
K:C
GABc|
\`\`\`

Five.

\`\`\`abc
X:3
K:C
cdef|
\`\`\`

Six.
`;

test("code, scores and equations are spaced like paragraphs", { skip }, async () => {
  const h = await open({ text: SPACING });
  const gaps = await h.page.evaluate(() => {
    const kids = Array.from(
      document.querySelector("#app .vditor-ir .vditor-reset").children
    );
    const out = {};
    for (let i = 0; i + 1 < kids.length; i++) {
      const type = kids[i].getAttribute("data-type") || kids[i].tagName.toLowerCase();
      const nextType =
        kids[i + 1].getAttribute("data-type") || kids[i + 1].tagName.toLowerCase();
      const gap = Math.round(
        kids[i + 1].getBoundingClientRect().top -
          kids[i].getBoundingClientRect().bottom
      );
      const key = type + ">" + nextType;
      if (!(key in out)) out[key] = gap;
    }
    return out;
  });
  const paragraph = gaps["p>p"];
  assert.ok(paragraph > 0, "no paragraph pair to measure against");
  ["p>code-block", "p>math-block", "code-block>p", "math-block>p"].forEach(
    (key) => {
      assert.equal(gaps[key], paragraph, key + " was " + gaps[key]);
    }
  );
  await h.close();
});

test("a display equation is rendered, not collapsed", { skip }, async () => {
  // The rules that tighten a collapsed block used to reach the span KaTeX
  // renders into, and the equation vanished from the page.
  const h = await open({});
  const math = await h.page.evaluate(() => {
    const el = document.querySelector("#app .katex-display");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, h: Math.round(r.height) };
  });
  assert.ok(math, "no equation was rendered");
  assert.notEqual(math.display, "none");
  assert.ok(math.h > 20, "the equation is " + math.h + "px tall");
  await h.close();
});

// ---------- Buttons ----------

test("the header button takes the editor to the top, on and off", { skip }, async () => {
  const h = await open({
    seed: { settings: { frontMatter: "hidden" } },
    withFrontMatter: false,
  });
  const scrollDown = async () => {
    await h.page.evaluate(() => {
      document.querySelector("#app .vditor-ir .vditor-reset").scrollTop = 800;
    });
    const at = await h.page.evaluate(
      () => document.querySelector("#app .vditor-ir .vditor-reset").scrollTop
    );
    assert.ok(at > 400, "the document did not scroll: " + at);
  };
  // What the host sends when the button is pressed: the settings it stored,
  // and the document in the mode just chosen.
  const press = (shown) =>
    h.page.evaluate(
      (text, isShown) => {
        window.postMessage(
          {
            type: "settings",
            settings: {
              theme: "light",
              scoreFill: "none",
              staffLines: "gray",
              scoreAlign: "center",
              frontMatter: isShown ? "shown" : "hidden",
            },
          },
          "*"
        );
        window.postMessage(
          {
            type: "update",
            text: text,
            frontMatter: "x",
            withFrontMatter: isShown,
          },
          "*"
        );
      },
      toEditor(EXAMPLE, shown),
      shown
    );
  const state = () =>
    h.page.evaluate(() => ({
      scrollTop: document.querySelector("#app .vditor-ir .vditor-reset").scrollTop,
      header: !!document.querySelector('#app div[data-type="yaml-front-matter"]'),
    }));

  await scrollDown();
  await press(true);
  await new Promise((r) => setTimeout(r, 900));
  assert.deepEqual(await state(), { scrollTop: 0, header: true });

  // And back: hiding the header takes the block off the top of the document,
  // so it goes to the top too instead of leaving the reader halfway down.
  await scrollDown();
  await press(false);
  await new Promise((r) => setTimeout(r, 900));
  assert.deepEqual(await state(), { scrollTop: 0, header: false });
  await h.close();
});

test("the header goes on and off as one block, with nothing else re-rendered", { skip }, async () => {
  // A full setValue would repaint every block: the editor blanks for a frame
  // and every score is engraved again. Marking the nodes that are already
  // there is how that shows up in a test.
  const h = await open({});
  const before = await h.page.evaluate(() => {
    document
      .querySelectorAll("code.language-abc svg")
      .forEach((svg, i) => svg.setAttribute("data-marked", i));
    return {
      blocks: document.querySelectorAll("#app .vditor-ir .vditor-reset > *").length,
      marked: document.querySelectorAll("svg[data-marked]").length,
    };
  });
  assert.ok(before.marked >= 3, "no scores to watch");

  const settings = (frontMatter) => ({
    type: "settings",
    settings: {
      theme: "light",
      scoreFill: "none",
      staffLines: "gray",
      scoreAlign: "center",
      frontMatter: frontMatter,
    },
  });
  // Hide it, then show it again: both directions patch the one block.
  await h.page.evaluate(
    (msg, text) => {
      window.postMessage(msg, "*");
      window.postMessage(
        { type: "update", text: text, frontMatter: "x", withFrontMatter: false },
        "*"
      );
    },
    settings("hidden"),
    toEditor(EXAMPLE, false)
  );
  await new Promise((r) => setTimeout(r, 700));
  const hidden = await h.page.evaluate(() => ({
    header: !!document.querySelector('#app div[data-type="yaml-front-matter"]'),
    blocks: document.querySelectorAll("#app .vditor-ir .vditor-reset > *").length,
    marked: document.querySelectorAll("svg[data-marked]").length,
  }));
  assert.equal(hidden.header, false);
  assert.equal(hidden.blocks, before.blocks - 1);
  assert.equal(hidden.marked, before.marked);

  await h.page.evaluate(
    (msg, text) => {
      window.postMessage(msg, "*");
      window.postMessage(
        { type: "update", text: text, frontMatter: "x", withFrontMatter: true },
        "*"
      );
    },
    settings("shown"),
    toEditor(EXAMPLE, true)
  );
  await new Promise((r) => setTimeout(r, 700));
  const shown = await h.page.evaluate(() => ({
    header: !!document.querySelector('#app div[data-type="yaml-front-matter"]'),
    blocks: document.querySelectorAll("#app .vditor-ir .vditor-reset > *").length,
    marked: document.querySelectorAll("svg[data-marked]").length,
    painted: !!document.querySelector("#app pre.mdm-fm-preview .hljs-attr"),
    // The block was built by hand, so what it serializes to is the check that
    // matters: the document must come back exactly as the host sent it.
    value: document.querySelector("#app pre.mdm-fm-preview") ? true : false,
  }));
  assert.equal(shown.header, true);
  assert.equal(shown.blocks, before.blocks);
  assert.equal(shown.marked, before.marked);
  assert.equal(shown.painted, true);

  // And the round trip still holds with the hand-built block in place.
  await h.page.evaluate(() => {
    const p = document.querySelector("#app .vditor-ir .vditor-reset > p");
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await h.page.keyboard.type("QQ");
  await new Promise((r) => setTimeout(r, 900));
  const sent = await h.page.evaluate(
    () => (window.__posts.filter((m) => m.type === "edit").pop() || {}).text
  );
  assert.equal(
    fromEditor(sent, EXAMPLE, true),
    typedIntoFirstParagraph(EXAMPLE, "QQ")
  );
  await h.close();
});

// ---------- Copy ----------

test("the copy button copies the source and pulses the block, not the page", { skip }, async () => {
  const h = await open({
    clipboard: true,
  });
  for (const [kind, selector] of [
    ["code", '#app div[data-type="code-block"]:has(code.language-python)'],
    ["score", '#app div[data-type="code-block"]:has(code.language-abc)'],
  ]) {
    // The button only exists visible while the pointer is over the block.
    const hover = await h.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.scrollIntoView();
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + 30 };
    }, selector);
    await h.page.mouse.move(hover.x, hover.y);
    await new Promise((r) => setTimeout(r, 300));
    const button = await h.page.evaluate((sel) => {
      const btn = document.querySelector(sel + " .vditor-copy span");
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
    }, selector);
    assert.ok(button.w > 0, kind + ": no copy button to click");
    await h.page.mouse.click(button.x, button.y);
    await new Promise((r) => setTimeout(r, 200));
    const out = await h.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const card =
        el.querySelector("code.language-abc") ||
        el.querySelector(".vditor-ir__preview code");
      return {
        copied: window.__copied[window.__copied.length - 1] || "",
        source: el.querySelector("pre.vditor-ir__marker--pre > code").textContent,
        animation: getComputedStyle(card).animationName,
        selection: String(getSelection()).length,
        label: el.querySelector(".vditor-copy span").getAttribute("aria-label"),
      };
    }, selector);
    assert.equal(out.selection, 0, kind + ": the page was selected");
    assert.equal(out.label, "Copied");
    assert.notEqual(out.animation, "none", kind + ": the block did not pulse");
    if (kind === "code") {
      assert.equal(out.copied, out.source);
      assert.equal(out.animation, "mdm-copy-pulse-code");
    } else {
      // A score drops the directives that size it for this document.
      assert.ok(!/%%staffwidth/.test(out.copied));
      assert.equal(out.animation, "mdm-copy-pulse");
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  await h.close();
});

test("a setting that touches no colour does not repaint the theme", { skip }, async () => {
  const h = await open({
    seed: { settings: { frontMatter: "hidden" } },
    withFrontMatter: false,
  });
  await h.page.evaluate(() => {
    const proto = window.Vditor.prototype;
    const orig = proto.setTheme;
    window.__setThemeCalls = 0;
    proto.setTheme = function () {
      window.__setThemeCalls++;
      return orig.apply(this, arguments);
    };
  });
  await h.page.evaluate(() =>
    window.postMessage(
      {
        type: "settings",
        settings: {
          theme: "light",
          scoreFill: "none",
          staffLines: "gray",
          scoreAlign: "center",
          frontMatter: "shown",
        },
      },
      "*"
    )
  );
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await h.page.evaluate(() => window.__setThemeCalls), 0);
  await h.close();
});

test("the theme menu lists what the host sent, and a click asks for it", { skip }, async () => {
  const themes = [
    { name: "Monokai", kind: "dark" },
    { name: "Solarized Light", kind: "light" },
  ];
  const h = await open({ seed: { themes: themes } });
  await h.page.click('#app button[data-type="mdm-theme"]');
  await new Promise((r) => setTimeout(r, 200));
  const entries = await h.page.evaluate(() =>
    Array.from(
      document.querySelectorAll('#app button[data-type^="mdm-theme-"]')
    ).map((b) => b.textContent.trim())
  );
  // The entry in use carries a tick; the harness opens on "light".
  assert.deepEqual(
    entries.map((e) => e.replace("✓", "")),
    ["Follow VS Code", "Light", "Dark", "White", "Monokai", "Solarized Light"]
  );
  assert.deepEqual(entries.filter((e) => e.includes("✓")), ["Light✓"]);
  await h.page.click('#app button[data-type="mdm-theme-4"]');
  await new Promise((r) => setTimeout(r, 200));
  const posted = await h.page.evaluate(() =>
    window.__posts.filter((m) => m.type === "setSetting")
  );
  assert.deepEqual(posted, [{ type: "setSetting", key: "theme", value: "Monokai" }]);
  await h.close();
});

// ---------- The two grounds ----------

// The luminance of a computed colour, enough to say which of two greys is the
// darker. getComputedStyle answers in color(srgb r g b) once a colour comes out
// of color-mix, so both spellings are read.
function luminance(color) {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(color);
  if (srgb) return (+srgb[1] * 0.2126 + +srgb[2] * 0.7152 + +srgb[3] * 0.0722) * 255;
  const rgb = /rgba?\((\d+), (\d+), (\d+)/.exec(color);
  assert.ok(rgb, "colour not understood: " + color);
  return +rgb[1] * 0.2126 + +rgb[2] * 0.7152 + +rgb[3] * 0.0722;
}

// The page the document is written on, and the ground under a block of code.
// The hljs class is what Vditor stamps on a code block it has painted.
function grounds(page) {
  return page.evaluate(() => {
    const code = document.querySelector(
      '#app .vditor-reset pre > code[class*="language-"]:not(.language-abc)'
    );
    if (code) code.classList.add("hljs");
    const bg = (el) => getComputedStyle(el).backgroundColor;
    return {
      page: bg(document.querySelector("#app .vditor-ir .vditor-reset")),
      code: code ? bg(code) : null,
      header: bg(document.querySelector('#app div[data-type="yaml-front-matter"]')),
      score: bg(document.querySelector("code.language-abc")),
    };
  });
}

test("the code sits on a darker ground than the page, on either side", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const h = await open({ seed: { settings: { theme: theme, scoreFill: "none" } } });
    const g = await grounds(h.page);
    // Both greys are mixes of the theme's own colours, and whichever side is in
    // force the code is the darker of the two, the way a notebook draws its
    // cells: in light the code keeps its slate and the page is a shade off
    // white, in dark the code drops to editor.background and the page rises.
    assert.ok(
      luminance(g.code) < luminance(g.page),
      theme + ": code " + g.code + " against page " + g.page
    );
    assert.ok(
      Math.abs(luminance(g.code) - luminance(g.page)) > 4,
      theme + ": the two grounds are the same grey"
    );
    // The YAML header reads as a block of code, so it takes the same ground.
    assert.equal(g.header, g.code);
    await h.close();
  }
});

test("light leaves the page a shade off the white the theme gives it", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light", scoreFill: "none" } } });
  const g = await grounds(h.page);
  const page = luminance(g.page);
  assert.ok(page < 255, "the page is pure white: " + g.page);
  assert.ok(page > 235, "the page is more than a shade off white: " + g.page);
  await h.close();
});

test("white is a white page with the code keeping its slate", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "white", scoreFill: "none" } } });
  const g = await grounds(h.page);
  assert.equal(g.page, "rgb(255, 255, 255)");
  assert.ok(luminance(g.code) < 255, "the code has no ground of its own: " + g.code);
  assert.ok(luminance(g.code) > 200, "the code ground is not a light tint: " + g.code);
  // With no fill of its own a score draws straight on the page, so on paper it
  // comes out on white.
  assert.match(g.score, /rgba\(0, 0, 0, 0\)|transparent/);
  assert.equal(
    await h.page.evaluate(() =>
      document.getElementById("app").classList.contains("vditor--dark")
    ),
    false,
    "white must stay on the light side"
  );
  await h.close();
});

// ---------- Scores ----------

// Three blocks, so the wait in update() is satisfied, and the first of them is
// the shape that used to be cropped: a staff narrowed with %%staffwidth under a
// title wider than it.
const NARROW_TITLE = `---
title: "t"
---

\`\`\`abc
%%staffwidth 200pt
X:1
T:E(3,8): the tresillo, 3+3+2
M:4/4
L:1/8
K:C
|: c3 e3 g2 :|
\`\`\`

\`\`\`abc
X:2
T:Wide
M:4/4
L:1/8
K:Am
ABcd ef^ga | a^gfe dcBA |
\`\`\`

\`\`\`abc
X:3
K:C
CDEF|
\`\`\`
`;

// The box each score declares against the box its ink really occupies.
function scoreBoxes(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("code.language-abc svg")).map((svg) => {
      const ink = svg.getBBox();
      const view = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      const rect = svg.getBoundingClientRect();
      const pane = svg.closest(".vditor-ir__preview").getBoundingClientRect();
      return {
        view: { x: view[0], y: view[1], w: view[2], h: view[3] },
        ink: { x: ink.x, y: ink.y, w: ink.width, h: ink.height },
        left: rect.left - pane.left,
        right: pane.right - rect.right,
        width: rect.width,
        paneWidth: pane.width,
      };
    })
  );
}

test("a title wider than its staff is not cropped", { skip }, async () => {
  const h = await open({ text: NARROW_TITLE });
  const boxes = await scoreBoxes(h.page);
  assert.equal(boxes.length, 3);
  for (const b of boxes) {
    // abcjs 5.10.3 sizes the SVG from the engraved music alone: the centred
    // title of the narrow one ran from -6 to 272 inside a box declared 266
    // wide, and lost its first and last letters. Half a unit of slack for the
    // sub-pixel jitter of text measurement.
    assert.ok(b.view.x <= b.ink.x + 0.5, "left cropped: " + b.view.x + " vs " + b.ink.x);
    assert.ok(
      b.view.x + b.view.w >= b.ink.x + b.ink.w - 0.5,
      "right cropped: " + (b.view.x + b.view.w) + " vs " + (b.ink.x + b.ink.w)
    );
    assert.ok(b.view.y <= b.ink.y + 0.5, "top cropped");
    assert.ok(b.view.y + b.view.h >= b.ink.y + b.ink.h - 0.5, "bottom cropped");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an edited score keeps no card behind it, in either theme", { skip }, async () => {
  // Vditor stamps `hljs` on the <code> of every block it re-renders, a score
  // among them, and the card rule for code blocks then matched it: from the
  // first edit inside a score block the score sat on a card, invisible under a
  // light theme and plainly there under a dark one.
  for (const theme of ["dark", "light"]) {
    const h = await open({ seed: { settings: { theme: theme, scoreFill: "none" } } });
    const score = () =>
      h.page.evaluate(() => {
        const code = document.querySelector("code.language-abc");
        return {
          classes: code.className,
          background: getComputedStyle(code).backgroundColor,
        };
      });
    const fresh = await score();
    assert.match(fresh.background, /rgba\(0, 0, 0, 0\)|transparent/, theme + " fresh");
    // The edit, through the DOM the way the user reaches it: open the score,
    // type into its source, then take the caret out so it engraves again.
    const at = await h.page.evaluate(() => {
      const code = document.querySelector("code.language-abc");
      code.scrollIntoView({ block: "center" });
      const r = code.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await h.page.mouse.click(at.x, at.y);
    await new Promise((r) => setTimeout(r, 400));
    await h.page.keyboard.type(" ");
    await new Promise((r) => setTimeout(r, 600));
    const out = await h.page.evaluate(() => {
      const p = document.querySelector("#app .vditor-ir .vditor-reset > p");
      p.scrollIntoView({ block: "center" });
      const r = p.getBoundingClientRect();
      return { x: r.x + 20, y: r.y + 10 };
    });
    await h.page.mouse.click(out.x, out.y);
    await new Promise((r) => setTimeout(r, 900));
    const edited = await score();
    assert.match(edited.classes, /hljs/, theme + ": Vditor no longer stamps hljs");
    assert.match(
      edited.background,
      /rgba\(0, 0, 0, 0\)|transparent/,
      theme + " after the edit: " + edited.background
    );
    await h.close();
  }
});

test("the alignment button moves narrow scores to the margin", { skip }, async () => {
  const h = await open({ text: NARROW_TITLE });
  const narrow = async () => (await scoreBoxes(h.page))[0];
  const tip = () =>
    h.page.$eval('#app button[data-type="mdm-score-align"]', (b) =>
      b.getAttribute("aria-label")
    );

  const centred = await narrow();
  assert.ok(centred.width < centred.paneWidth - 20, "the fixture is not narrow");
  assert.ok(
    Math.abs(centred.left - centred.right) < 1,
    "not centred: " + centred.left + " vs " + centred.right
  );
  // The tooltip names the destination of the click, not the state in use.
  assert.equal(await tip(), "Align scores left");

  await h.page.click('#app button[data-type="mdm-score-align"]');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(
    await h.page.evaluate(() => window.__posts.filter((m) => m.type === "setSetting")),
    [{ type: "setSetting", key: "scoreAlign", value: "left" }]
  );
  // The webview never repaints itself: the value comes back from the host.
  assert.ok((await narrow()).left > 1, "moved before the host answered");

  await h.page.evaluate(() =>
    window.postMessage(
      {
        type: "settings",
        settings: {
          theme: "light",
          scoreFill: "none",
          staffLines: "gray",
          scoreAlign: "left",
          frontMatter: "shown",
        },
      },
      "*"
    )
  );
  await h.page.waitForFunction(() =>
    document.getElementById("app").classList.contains("mdm-score--left")
  );
  assert.ok((await narrow()).left < 1, "did not reach the margin");
  assert.equal(await tip(), "Centre scores");
  await h.close();
});

// ---------- The syntax palette ----------

// A palette shaped the way the host sends it (theme.js), with colours nothing
// else in the sheets uses, so a computed value can only have come from here.
function palette(kind) {
  return {
    kind: kind,
    colors: {
      base: "#112233",
      bg: "#445566",
      comment: "#010203",
      string: "#040506",
      number: "#070809",
      keyword: "#0a0b0c",
      attr: "#0d0e0f",
      name: "#101112",
      type: "#131415",
      variable: "#161718",
    },
  };
}

// The custom properties as they stand on #app: "" for a slot the webview left
// to the fallbacks in style.css.
function synVars(page) {
  return page.evaluate(() => {
    const root = document.getElementById("app");
    const out = {};
    ["base", "bg", "comment", "string", "number", "keyword", "attr", "name", "type", "variable"]
      .forEach((slot) => {
        out[slot] = root.style.getPropertyValue("--mdm-syn-" + slot);
      });
    return out;
  });
}

test("the palette of the theme in use paints the code", { skip }, async () => {
  const h = await open({
    seed: { settings: { theme: "light" }, palette: palette("light") },
  });
  const vars = await synVars(h.page);
  assert.deepEqual(vars, palette("light").colors);
  // And they are spent: the YAML keys of the header take the `attr` colour,
  // which is the slot the whole mechanism was built for.
  const painted = await h.page.evaluate(
    () => getComputedStyle(document.querySelector("#app .hljs-attr")).color
  );
  assert.equal(painted, "rgb(13, 14, 15)");
  await h.close();
});

test("a palette from the other side is dropped, fallbacks stay", { skip }, async () => {
  // mdm.theme can hold this editor to light while VS Code is on a dark theme,
  // and dark syntax colours on a light ground are unreadable.
  const h = await open({
    seed: { settings: { theme: "light" }, palette: palette("dark") },
  });
  const vars = await synVars(h.page);
  assert.deepEqual(
    vars,
    Object.fromEntries(Object.keys(palette("light").colors).map((k) => [k, ""]))
  );
  // stackoverflow-light, the fallback in style.css for the light side.
  const painted = await h.page.evaluate(
    () => getComputedStyle(document.querySelector("#app .hljs-attr")).color
  );
  assert.equal(painted, "rgb(1, 86, 146)");
  await h.close();
});

test("a palette message repaints the code with no document update", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light" } } });
  // Nothing seeded: the editor opens on the fallbacks.
  assert.equal((await synVars(h.page)).string, "");
  await h.page.evaluate((p) => {
    window.postMessage({ type: "palette", palette: p, side: null }, "*");
  }, palette("light"));
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await synVars(h.page), palette("light").colors);
  // And a palette that no longer matches the side is taken back off.
  await h.page.evaluate((p) => {
    window.postMessage({ type: "palette", palette: p, side: null }, "*");
  }, palette("dark"));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await synVars(h.page)).string, "");
  await h.close();
});

test("a named theme brings its own side, palette and all", { skip }, async () => {
  // mdm.theme holding the name of a dark VS Code theme: the host says which
  // side it sits on, and the editor follows it without any VS Code theme kind
  // on the body.
  const h = await open({
    seed: {
      settings: { theme: "Monokai" },
      themes: [{ name: "Monokai", kind: "dark" }],
      palette: palette("dark"),
      side: "dark",
    },
  });
  assert.equal(
    await h.page.evaluate(() =>
      document.getElementById("app").classList.contains("vditor--dark")
    ),
    true,
    "the editor did not follow the theme to the dark side"
  );
  assert.deepEqual(await synVars(h.page), palette("dark").colors);
  await h.close();
});

// A run of `code` inside a sentence, which the Vditor content themes wash
// with a colour of their own: 5% black in light, barely visible on a page
// that is already off white, and 36% of a Google blue in dark. It takes the
// ground of the code cards instead, on both sides, and nothing else that is
// written as a <code> picks up its hairline edge.
function inlineCodeColours(page) {
  return page.evaluate(() => {
    const chip = document.querySelector(
      "#app .vditor-reset p code:not(.hljs):not(.language-abc):not(.vditor-ir__marker)"
    );
    const card = document.querySelector(
      "#app .vditor-reset pre > code.hljs:not(.language-abc)"
    );
    const score = document.querySelector("#app code.language-abc");
    const header = document.querySelector(
      '#app .vditor-reset div[data-type="yaml-front-matter"] pre > code'
    );
    const source = document.querySelector(
      "#app .vditor-reset pre.vditor-ir__marker--pre > code.language-python"
    );
    const maths = document.querySelector(
      '#app .vditor-reset code[data-type="math-inline"]'
    );
    const width = (el) => (el ? getComputedStyle(el).borderTopWidth : null);
    return {
      text: chip ? chip.textContent : null,
      chipBg: chip ? getComputedStyle(chip).backgroundColor : null,
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
      chipEdge: width(chip),
      scoreEdge: width(score),
      headerEdge: width(header),
      sourceEdge: width(source),
      mathsEdge: width(maths),
    };
  });
}

test("inline code sits on the code ground, not the theme's own wash", { skip }, async () => {
  for (const side of ["light", "dark"]) {
    const h = await open({ seed: { settings: { theme: side } } });
    const c = await inlineCodeColours(h.page);
    assert.equal(c.text, "d = (d + 3) % 7", "the inline code of the example");
    assert.equal(c.chipBg, c.cardBg, "chip and card on different grounds (" + side + ")");
    assert.equal(c.chipEdge, "1px", "the chip lost its edge (" + side + ")");
    // The blue the dark content theme paints it with, gone on both sides.
    assert.notEqual(c.chipBg, "rgba(66, 133, 244, 0.36)");
    // The edge belongs to the chip alone: a score is a <code> as well, and so
    // are the editable sources Vditor keeps in a <pre>, the YAML header and
    // the source of every code block, and the source of a run of inline
    // maths, which shows the moment the caret goes into it.
    assert.equal(c.scoreEdge, "0px", "a score took the chip edge (" + side + ")");
    assert.equal(c.headerEdge, "0px", "the header took the chip edge (" + side + ")");
    assert.equal(c.sourceEdge, "0px", "an editable source took the chip edge (" + side + ")");
    assert.equal(c.mathsEdge, "0px", "inline maths took the chip edge (" + side + ")");
    await h.close();
  }
});

// ---------- Staff lines ----------

// The fill of the five staff lines, which carry the .abcjs-staff class that
// add_classes asks abcjs for, and of a note head, which must not follow them.
function staffColours(page) {
  return page.evaluate(() => {
    const svg = document.querySelector("code.language-abc svg");
    const staff = svg.querySelector(".abcjs-staff");
    const note = svg.querySelector(".abcjs-note");
    return {
      staff: staff ? getComputedStyle(staff).fill : null,
      note: note ? getComputedStyle(note).fill : null,
      gray: document.getElementById("app").classList.contains("mdm-staff--gray"),
      tip: document
        .querySelector('#app button[data-type="mdm-staff-lines"]')
        .getAttribute("aria-label"),
      current: document
        .querySelector('#app button[data-type="mdm-staff-lines"]')
        .classList.contains("vditor-menu--current"),
    };
  });
}

test("staff lines are gray by default and the button puts them back in ink", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light" } } });
  const before = await staffColours(h.page);
  assert.equal(before.gray, true, "the default is not gray");
  assert.equal(before.staff, "rgb(163, 163, 163)");
  // Notes, clefs and bar lines keep the ink colour: that is the whole point.
  assert.equal(before.note, "rgb(0, 0, 0)");
  // The tooltip names where the click leads, and the button is quiet while the
  // default holds.
  assert.equal(before.tip, "Ink staff lines");
  assert.equal(before.current, false);

  await h.page.click('#app button[data-type="mdm-staff-lines"]');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(
    await h.page.evaluate(() =>
      window.__posts.filter((m) => m.type === "setSetting")
    ),
    [{ type: "setSetting", key: "staffLines", value: "ink" }],
    "the button did not ask the host for ink"
  );
  // Nothing moves until the host answers.
  assert.equal((await staffColours(h.page)).staff, "rgb(163, 163, 163)");

  await h.page.evaluate(() =>
    window.postMessage(
      {
        type: "settings",
        settings: {
          theme: "light",
          scoreFill: "none",
          staffLines: "ink",
          scoreAlign: "center",
          frontMatter: "shown",
        },
      },
      "*"
    )
  );
  await new Promise((r) => setTimeout(r, 300));
  const after = await staffColours(h.page);
  assert.equal(after.gray, false);
  assert.equal(after.staff, "rgb(0, 0, 0)", "the staff did not go back to ink");
  assert.equal(after.tip, "Gray staff lines");
  assert.equal(after.current, true, "ink is the state the button marks");
  await h.close();
});

test("gray staff lines are a darker gray on the dark side", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "dark" } } });
  const out = await staffColours(h.page);
  assert.equal(out.gray, true);
  assert.equal(out.staff, "rgb(111, 111, 111)");
  // The dark repaint takes the notes, and the gray rule outranks it on the
  // staff lines alone.
  assert.equal(out.note, "rgb(212, 212, 212)");
  await h.close();
});

// ---------- Score fill ----------

function fillState(page) {
  return page.evaluate(() => {
    const root = document.getElementById("app");
    const code = document.querySelector("code.language-abc");
    return {
      filled: root.classList.contains("mdm-score--filled"),
      variable: root.style.getPropertyValue("--mdm-score-fill"),
      background: getComputedStyle(code).backgroundColor,
      // The pulse a copy plays on this card: the two are different animations,
      // since a cleared card has no colour of its own to flash.
      pulse: (function () {
        code.classList.add("mdm-copy-pulse");
        const name = getComputedStyle(code).animationName;
        code.classList.remove("mdm-copy-pulse");
        return name;
      })(),
    };
  });
}

test("a score is cleared by default and the menu fills it", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light" } } });
  const before = await fillState(h.page);
  assert.equal(before.filled, false);
  assert.match(before.background, /rgba\(0, 0, 0, 0\)|transparent/);
  assert.equal(before.pulse, "mdm-copy-pulse");

  // The menu lists the four fills, with a tick on the one in use.
  await h.page.click('#app button[data-type="mdm-score-fill"]');
  await new Promise((r) => setTimeout(r, 200));
  const entries = await h.page.evaluate(() =>
    Array.from(document.querySelectorAll('#app button[data-type^="mdm-score-"]'))
      .filter((b) => b.getAttribute("data-type") !== "mdm-score-fill")
      .filter((b) => b.getAttribute("data-type") !== "mdm-score-align")
      .map((b) => b.textContent.trim())
  );
  assert.deepEqual(entries, ["None✓", "Paper", "Slate", "Brass"]);

  await h.page.click('#app button[data-type="mdm-score-brass"]');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(
    await h.page.evaluate(() =>
      window.__posts.filter((m) => m.type === "setSetting")
    ),
    [{ type: "setSetting", key: "scoreFill", value: "brass" }]
  );

  await h.page.evaluate(() =>
    window.postMessage(
      {
        type: "settings",
        settings: {
          theme: "light",
          scoreFill: "brass",
          staffLines: "gray",
          scoreAlign: "center",
          frontMatter: "shown",
        },
      },
      "*"
    )
  );
  await new Promise((r) => setTimeout(r, 300));
  const after = await fillState(h.page);
  assert.equal(after.filled, true);
  assert.equal(after.variable, "#f7edd8", "the light brass value");
  assert.equal(after.background, "rgb(247, 237, 216)");
  // A card with a colour of its own pulses that colour, not the accent tint.
  assert.equal(after.pulse, "mdm-copy-pulse-filled");
  await h.close();
});

test("a fill carries a value for each side", { skip }, async () => {
  const h = await open({
    seed: { settings: { theme: "dark", scoreFill: "brass" } },
  });
  const out = await fillState(h.page);
  assert.equal(out.filled, true);
  assert.equal(out.variable, "#332c1c", "the dark brass value");
  assert.equal(out.background, "rgb(51, 44, 28)");
  await h.close();
});

// ---------- Click to edit ----------

test("clicking a rendered block opens its source", { skip }, async () => {
  const h = await open({});
  for (const selector of [
    '#app div[data-type="yaml-front-matter"]',
    '#app div[data-type="math-block"]',
    '#app div[data-type="code-block"]',
  ]) {
    const box = await h.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.scrollIntoView();
      const r = el.getBoundingClientRect();
      return { x: r.x + 30, y: r.y + Math.min(20, r.height / 2) };
    }, selector);
    await new Promise((r) => setTimeout(r, 150));
    await h.page.mouse.click(box.x, box.y);
    await new Promise((r) => setTimeout(r, 300));
    const state = await h.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const source = el.querySelector("pre.vditor-ir__marker--pre");
      return {
        expanded: el.classList.contains("vditor-ir__node--expand"),
        sourceHeight: Math.round(source.getBoundingClientRect().height),
      };
    }, selector);
    assert.equal(state.expanded, true, selector + " did not open");
    assert.ok(state.sourceHeight > 10, selector + " source stayed collapsed");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});


// ---------- Rendered block edges ----------

// The guards in main.js's handleBlockEdges: a forward Delete at the edge of a
// rendered block used to run the browser's raw merge (source pulled into the
// paragraph, KaTeX left orphaned, the glyph text serialized into the file);
// now it steps INTO the block. The inner edges of an open source step OUT
// instead of dissolving the block, an emptied source lets the next key remove
// the block whole, and a selection covering the whole source is spliced by
// hand because the raw delete mangled the block the same way.

const EDGES = [
  "---",
  'title: "Edges"',
  "---",
  "",
  "Intro paragraph.",
  "",
  "$$",
  "E = mc^2",
  "$$",
  "",
  "Middle paragraph.",
  "",
  "```js",
  "let a = 1;",
  "```",
  "",
  "After code.",
  "",
  "```abc",
  "X:1",
  "K:C",
  "CDEF|",
  "```",
  "",
  "```abc",
  "X:1",
  "K:C",
  "GABc|",
  "```",
  "",
  "```abc",
  "X:1",
  "K:C",
  "cdef|",
  "```",
  "",
  "Outro paragraph.",
  "",
].join("\n");

// The caret at an exact offset of the paragraph whose text matches; -1 lands
// at its end.
async function caretInParagraph(page, text, offset) {
  await page.evaluate(
    (t, off) => {
      const root = document.querySelector("#app .vditor-ir .vditor-reset");
      root.focus();
      const p = Array.from(root.querySelectorAll("p")).find(
        (el) => el.textContent === t
      );
      const node = p.firstChild;
      const range = document.createRange();
      range.setStart(node, off < 0 ? node.textContent.length : off);
      range.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    },
    text,
    offset
  );
}

async function mathState(page) {
  return page.evaluate(() => {
    const block = document.querySelector('#app div[data-type="math-block"]');
    if (!block) return { present: false };
    const code = block.querySelector("pre.vditor-ir__marker--pre > code");
    const sel = getSelection();
    const anchor =
      sel.anchorNode &&
      (sel.anchorNode.nodeType === 1
        ? sel.anchorNode
        : sel.anchorNode.parentElement);
    return {
      present: true,
      expanded: block.classList.contains("vditor-ir__node--expand"),
      source: code ? code.textContent : null,
      caretInSource: !!(anchor && code && (anchor === code || code.contains(anchor))),
      katex: !!block.querySelector(".katex"),
    };
  });
}

async function editCount(page) {
  return page.evaluate(
    () => window.__posts.filter((m) => m.type === "edit").length
  );
}

// Opens the equation for editing the way a user does, with a click on it.
async function openEquation(page) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('#app div[data-type="math-block"]');
    el.scrollIntoView();
    const r = el.getBoundingClientRect();
    return { x: r.x + 30, y: r.y + Math.min(20, r.height / 2) };
  });
  await new Promise((r) => setTimeout(r, 150));
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 300));
}

test("a forward delete before an equation steps into it, corrupting nothing", { skip }, async () => {
  const h = await open({ text: EDGES });
  await caretInParagraph(h.page, "Intro paragraph.", -1);
  await h.page.keyboard.press("Delete");
  await new Promise((r) => setTimeout(r, 700));
  const s = await mathState(h.page);
  assert.equal(s.present, true, "the equation block is gone");
  assert.equal(s.expanded, true, "the equation did not open");
  assert.equal(s.caretInSource, true, "the caret did not land in the source");
  assert.equal(s.source, "E = mc^2", "the source was touched");
  assert.equal(await editCount(h.page), 0, "a no-op keypress posted an edit");
  // Typing continues at the head of the formula, and the document round-trips.
  await h.page.keyboard.type("Z");
  const disk = fromEditor(await lastEdit(h.page), EDGES, true);
  assert.equal(disk, EDGES.replace("E = mc^2", "ZE = mc^2"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a forward delete before a code block steps into it too", { skip }, async () => {
  const h = await open({ text: EDGES });
  await caretInParagraph(h.page, "Middle paragraph.", -1);
  await h.page.keyboard.press("Delete");
  await new Promise((r) => setTimeout(r, 700));
  const s = await h.page.evaluate(() => {
    const block = Array.from(
      document.querySelectorAll('#app div[data-type="code-block"]')
    ).find((b) => {
      const c = b.querySelector("pre.vditor-ir__marker--pre > code");
      return c && c.textContent.indexOf("let a") === 0;
    });
    return {
      expanded: !!block && block.classList.contains("vditor-ir__node--expand"),
    };
  });
  assert.equal(s.expanded, true, "the code block did not open");
  assert.equal(await editCount(h.page), 0);
  await h.page.keyboard.type("Z");
  const disk = fromEditor(await lastEdit(h.page), EDGES, true);
  assert.equal(disk, EDGES.replace("let a = 1;", "Zlet a = 1;"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("backspace at the head of an open source steps out, the block survives", { skip }, async () => {
  const h = await open({ text: EDGES });
  await openEquation(h.page);
  await h.page.evaluate(() => {
    const code = document.querySelector(
      '#app div[data-type="math-block"] pre.vditor-ir__marker--pre > code'
    );
    const range = document.createRange();
    range.setStart(code.firstChild, 0);
    range.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await h.page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 700));
  const s = await mathState(h.page);
  assert.equal(s.present, true, "the block was dissolved");
  assert.equal(s.source, "E = mc^2", "the source was touched");
  assert.equal(s.expanded, false, "the block did not close on the way out");
  assert.equal(s.katex, true, "the equation lost its rendering");
  assert.equal(await editCount(h.page), 0);
  // The caret stands at the end of the paragraph above.
  await h.page.keyboard.type("Q");
  const disk = fromEditor(await lastEdit(h.page), EDGES, true);
  assert.equal(disk, EDGES.replace("Intro paragraph.", "Intro paragraph.Q"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("delete at the tail of an open source steps out forward", { skip }, async () => {
  const h = await open({ text: EDGES });
  await openEquation(h.page);
  await h.page.evaluate(() => {
    const code = document.querySelector(
      '#app div[data-type="math-block"] pre.vditor-ir__marker--pre > code'
    );
    const range = document.createRange();
    range.selectNodeContents(code);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await h.page.keyboard.press("Delete");
  await new Promise((r) => setTimeout(r, 700));
  const s = await mathState(h.page);
  assert.equal(s.present, true);
  assert.equal(s.source, "E = mc^2", "the source was touched");
  assert.equal(s.expanded, false, "the block did not close on the way out");
  assert.equal(await editCount(h.page), 0);
  await h.page.keyboard.type("Q");
  const disk = fromEditor(await lastEdit(h.page), EDGES, true);
  assert.equal(disk, EDGES.replace("Middle paragraph.", "QMiddle paragraph."));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an emptied equation is removed by the next key, and undo brings it back", { skip }, async () => {
  const h = await open({ text: EDGES });
  await openEquation(h.page);
  // Select the whole source and delete it: the fences stay (the raw delete
  // used to mangle the block here).
  await h.page.evaluate(() => {
    const code = document.querySelector(
      '#app div[data-type="math-block"] pre.vditor-ir__marker--pre > code'
    );
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await h.page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 700));
  let s = await mathState(h.page);
  assert.equal(s.present, true, "the block was mangled by the selection delete");
  const disk1 = fromEditor(await lastEdit(h.page), EDGES, true);
  assert.match(disk1, /\$\$\n{1,3}\$\$/, "the fences did not survive");
  assert.ok(!disk1.includes("mc^2"), "the source text is still there");
  // The next Backspace removes the emptied block whole.
  await h.page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 700));
  s = await mathState(h.page);
  assert.equal(s.present, false, "the emptied block was not removed");
  const disk2 = fromEditor(await lastEdit(h.page), EDGES, true);
  assert.equal(disk2, EDGES.replace("$$\nE = mc^2\n$$\n\n", ""));
  // One undo restores the block.
  await h.page.keyboard.down("Control");
  await h.page.keyboard.press("z");
  await h.page.keyboard.up("Control");
  await new Promise((r) => setTimeout(r, 700));
  s = await mathState(h.page);
  assert.equal(s.present, true, "undo did not restore the block");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an ordinary delete inside a paragraph stays ordinary", { skip }, async () => {
  const h = await open({ text: EDGES });
  await caretInParagraph(h.page, "Intro paragraph.", 6);
  await h.page.keyboard.press("Delete");
  await new Promise((r) => setTimeout(r, 400));
  const s = await mathState(h.page);
  assert.equal(s.present, true);
  assert.equal(s.expanded, false, "a mid-paragraph delete opened the equation");
  const disk = fromEditor(await lastEdit(h.page), EDGES, true);
  assert.equal(disk, EDGES.replace("Intro paragraph.", "Intro aragraph."));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a whole source is spliced even collapsed, a partial selection is not", { skip }, async () => {
  // Selection.toString() reports what is DRAWN, and a collapsed block draws
  // its source in a 10x5px box, so it reads empty there (measured); the guard
  // compares range boundary points instead, which do not depend on layout.
  // Without that, this selection fell through to the raw delete.
  const h = await open({ text: EDGES });
  await h.page.evaluate(() => {
    const code = document.querySelector(
      '#app div[data-type="math-block"].vditor-ir__node pre.vditor-ir__marker--pre > code'
    );
    document.querySelector("#app .vditor-ir .vditor-reset").focus();
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await h.page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 700));
  const s = await mathState(h.page);
  assert.equal(s.present, true, "the collapsed block was mangled");
  // Open, with the caret in the emptied source: a new formula is typed there.
  assert.equal(s.expanded, true, "the emptied block did not open to be typed in");
  assert.equal(s.caretInSource, true, "the caret is not in the emptied source");
  const disk = fromEditor(await lastEdit(h.page), EDGES, true);
  assert.match(disk, /\$\$\n{1,3}\$\$/, "the fences did not survive");
  assert.ok(!disk.includes("mc^2"), "the source text is still there");

  // A selection of part of the source is Blink's to delete, untouched.
  const h2 = await open({ text: EDGES });
  await openEquation(h2.page);
  await h2.page.evaluate(() => {
    const code = document.querySelector(
      '#app div[data-type="math-block"].vditor-ir__node pre.vditor-ir__marker--pre > code'
    );
    const range = document.createRange();
    range.setStart(code.firstChild, 2);
    range.setEnd(code.firstChild, 5);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await h2.page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 700));
  const disk2 = fromEditor(await lastEdit(h2.page), EDGES, true);
  assert.equal(disk2, EDGES.replace("E = mc^2", "E c^2"));
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h2.errors, []);
  await h.close();
  await h2.close();
});

test("an equation alone in the document can be removed, and typing goes on", { skip }, async () => {
  // Removing it leaves the caret in a detached node and the document with no
  // block at all, so a paragraph takes its place before the block goes.
  const h = await open({
    text: "$$\nE = mc^2\n$$\n",
    withFrontMatter: false,
    scores: 0,
  });
  await h.page.evaluate(() => {
    const code = document.querySelector(
      '#app div[data-type="math-block"].vditor-ir__node pre.vditor-ir__marker--pre > code'
    );
    document.querySelector("#app .vditor-ir .vditor-reset").focus();
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await h.page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 700));
  await h.page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 700));
  assert.equal((await mathState(h.page)).present, false, "the block is still there");
  await h.page.keyboard.type("plain text");
  await new Promise((r) => setTimeout(r, 700));
  const disk = fromEditor(await lastEdit(h.page), "", false);
  assert.equal(disk, "plain text\n", "typing after the removal did not land");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an equation inside a blockquote is entered, not merged into it", { skip }, async () => {
  // The rendered block and the paragraph before it are siblings inside the
  // blockquote, not children of the editable root, so the guard climbs to the
  // level that has a neighbour. Without that climb this document corrupted
  // exactly like a top-level one (measured).
  const h = await open({
    text: "Intro.\n\n> Quoted.\n>\n> $$\n> E = mc^2\n> $$\n\nOutro.\n",
    withFrontMatter: false,
    scores: 0,
  });
  await caretInParagraph(h.page, "Quoted.", -1);
  await h.page.keyboard.press("Delete");
  await new Promise((r) => setTimeout(r, 700));
  const s = await h.page.evaluate(() => {
    const quote = document.querySelector("#app .vditor-ir .vditor-reset blockquote");
    const block = quote && quote.querySelector('div[data-type="math-block"].vditor-ir__node');
    const code = block && block.querySelector("pre.vditor-ir__marker--pre > code");
    const sel = getSelection();
    const a =
      sel.anchorNode &&
      (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    return {
      inQuote: !!block,
      expanded: !!block && block.classList.contains("vditor-ir__node--expand"),
      source: code ? code.textContent : null,
      caretInSource: !!(a && code && (a === code || code.contains(a))),
      edits: window.__posts.filter((m) => m.type === "edit").length,
    };
  });
  assert.equal(s.inQuote, true, "the equation left the blockquote");
  assert.equal(s.source, "E = mc^2", "the source was touched");
  assert.equal(s.expanded, true, "the equation did not open");
  assert.equal(s.caretInSource, true, "the caret did not land in the source");
  assert.equal(s.edits, 0, "a no-op keypress posted an edit");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The player ----------

// Shared helpers: the score blocks in document order, and the state the
// player tests keep asserting.
async function playerState(page) {
  return page.evaluate(() => {
    const scores = Array.from(
      document.querySelectorAll('#app div[data-type="code-block"]')
    ).filter((b) => b.querySelector(".vditor-ir__preview code.language-abc"));
    return {
      bars: document.querySelectorAll(".mdm-audio").length,
      widgets: document.querySelectorAll(".mdm-audio .abcjs-inline-audio").length,
      onIndex: scores.findIndex((b) => b.querySelector(".mdm-audio")),
      attrs: document.querySelectorAll("[data-mdm-audio]").length,
      labels: scores.map((b) =>
        b.querySelector(".mdm-audio-toggle span").getAttribute("aria-label")
      ),
    };
  });
}

async function clickToggle(page, index) {
  await page.evaluate((i) => {
    const scores = Array.from(
      document.querySelectorAll('#app div[data-type="code-block"]')
    ).filter((b) => b.querySelector(".vditor-ir__preview code.language-abc"));
    scores[i].querySelector(".mdm-audio-toggle span").click();
  }, index);
}

test("every score gets a player toggle beside the copy button; other code does not", { skip }, async () => {
  const h = await open({});
  const counts = await h.page.evaluate(() => {
    const blocks = Array.from(
      document.querySelectorAll('#app div[data-type="code-block"]')
    );
    const scores = blocks.filter((b) =>
      b.querySelector(".vditor-ir__preview code.language-abc")
    );
    const others = blocks.filter(
      (b) => !b.querySelector(".vditor-ir__preview code.language-abc")
    );
    return {
      scores: scores.length,
      withToggle: scores.filter((b) => b.querySelector(".mdm-audio-toggle span"))
        .length,
      others: others.length,
      othersWithToggle: others.filter((b) =>
        b.querySelector(".mdm-audio-toggle")
      ).length,
    };
  });
  assert.equal(counts.scores, 3);
  assert.equal(counts.withToggle, 3);
  assert.ok(counts.others >= 1, "the fixture keeps a non-score code block");
  assert.equal(counts.othersWithToggle, 0);

  // Hidden until the block is hovered, like the copy button, and then sitting
  // on its left at the same height.
  const spot = await h.page.evaluate(() => {
    const block = document.querySelector('#app div[data-type="code-block"]');
    block.scrollIntoView();
    const r = block
      .querySelector("pre.vditor-ir__preview")
      .getBoundingClientRect();
    const toggle = block.querySelector(".mdm-audio-toggle");
    return {
      x: r.x + r.width / 2,
      y: r.y + 8,
      hiddenBefore: getComputedStyle(toggle).display === "none",
    };
  });
  assert.equal(spot.hiddenBefore, true, "toggle visible without hover");
  await h.page.mouse.move(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 200));
  const boxes = await h.page.evaluate(() => {
    const block = document.querySelector('#app div[data-type="code-block"]');
    const toggle = block.querySelector(".mdm-audio-toggle span");
    const copy = block.querySelector(".vditor-copy span");
    const t = toggle.getBoundingClientRect();
    const c = copy.getBoundingClientRect();
    return {
      visible: t.width > 0,
      tx: t.x,
      cx: c.x,
      // Centres, not top edges: the speaker is drawn a size larger than the
      // copy button, so their boxes no longer start at the same y.
      tMid: t.y + t.height / 2,
      cMid: c.y + c.height / 2,
    };
  });
  assert.equal(boxes.visible, true);
  assert.ok(boxes.tx < boxes.cx, "toggle left of copy");
  assert.ok(Math.abs(boxes.tMid - boxes.cMid) <= 1.5, "same height");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the toggle opens the player without expanding the block, and closes it", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  const openState = await h.page.evaluate(() => {
    const block = document.querySelector("#app [data-mdm-audio]");
    const bar = block.querySelector(".mdm-audio");
    return {
      expanded: block.classList.contains("vditor-ir__node--expand"),
      play: !!bar.querySelector(".abcjs-midi-start"),
      loop: !!bar.querySelector(".abcjs-midi-loop"),
      progress: !!bar.querySelector(".abcjs-midi-progress-background"),
      insidePreview: !!bar.closest("pre.vditor-ir__preview"),
      maxWidth: parseInt(bar.style.maxWidth, 10),
    };
  });
  assert.equal(openState.expanded, false, "opening the player expanded the block");
  assert.equal(openState.play && openState.loop && openState.progress, true);
  assert.equal(openState.insidePreview, true);
  assert.ok(openState.maxWidth >= 280, "bar sized to the score");
  assert.deepEqual((await playerState(h.page)).labels, [
    "Hide player",
    "Show player",
    "Show player",
  ]);
  await clickToggle(h.page, 0);
  await new Promise((r) => setTimeout(r, 200));
  const closed = await playerState(h.page);
  assert.equal(closed.bars, 0);
  assert.equal(closed.attrs, 0);
  assert.deepEqual(closed.labels, ["Show player", "Show player", "Show player"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("play sounds from the vendored soundfont, no network", { skip }, async () => {
  const h = await open({});
  const requests = [];
  h.page.on("request", (r) => requests.push(r.url()));
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  // Pushed the moment the synth is primed; the indicator then moves.
  await h.page.waitForFunction(
    () =>
      document
        .querySelector(".mdm-audio .abcjs-midi-start")
        .classList.contains("abcjs-pushed"),
    { timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 1500));
  const moved = await h.page.evaluate(
    () =>
      parseFloat(
        document.querySelector(".mdm-audio .abcjs-midi-progress-indicator").style
          .left
      ) || 0
  );
  assert.ok(moved > 0, "progress indicator never moved: " + moved);
  // The widget's clicks stay in the widget: without the bar's stopPropagation,
  // pressing play falls through to Vditor and the block opens for editing.
  const expanded = await h.page.evaluate(() =>
    document
      .querySelector(".mdm-audio")
      .closest('[data-type="code-block"]')
      .classList.contains("vditor-ir__node--expand")
  );
  assert.equal(expanded, false, "pressing play expanded the block");
  const notes = requests.filter((u) => u.includes("/soundfont/"));
  assert.ok(notes.length >= 3, "soundfont notes requested: " + notes.length);
  assert.ok(
    notes.every(
      (u) => u.startsWith("file://") && u.includes("acoustic_grand_piano-mp3/")
    ),
    "every note came from the vendored piano"
  );
  assert.ok(
    !requests.some((u) => u.startsWith("http")),
    "something went to the network: " + requests.filter((u) => u.startsWith("http"))
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an open player never touches serialization (round-trip intact)", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  await h.page.evaluate(() => {
    const p = document.querySelector("#app .vditor-ir .vditor-reset > p");
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await h.page.keyboard.type("QQ");
  const sent = await lastEdit(h.page);
  assert.ok(sent, "the webview sent no edit");
  assert.equal(
    fromEditor(sent, EXAMPLE, true),
    typedIntoFirstParagraph(EXAMPLE, "QQ")
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("one player at a time: opening a second score closes the first", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  await clickToggle(h.page, 1);
  await h.page.waitForFunction(
    () =>
      document.querySelectorAll(".mdm-audio").length === 1 &&
      document.querySelector(".mdm-audio .abcjs-inline-audio") &&
      document
        .querySelectorAll("#app [data-mdm-audio]")[0]
        .querySelector(".mdm-audio"),
    { timeout: 15000 }
  );
  const state = await playerState(h.page);
  assert.equal(state.bars, 1);
  assert.equal(state.onIndex, 1);
  assert.deepEqual(state.labels, ["Show player", "Hide player", "Show player"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the player rides out edits in its block and full external updates", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 1);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  // An edit inside the open block: Vditor wipes the preview, the player
  // reopens in place with the new tune, stopped.
  await h.page.evaluate(() => {
    const scores = Array.from(
      document.querySelectorAll('#app div[data-type="code-block"]')
    ).filter((b) => b.querySelector(".vditor-ir__preview code.language-abc"));
    const code = scores[1].querySelector("pre.vditor-ir__marker--pre > code");
    document
      .querySelector("#app .vditor-ir .vditor-reset")
      .focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(code);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await h.page.keyboard.type(" A");
  await h.page.waitForFunction(
    () => {
      const bar = document.querySelector(".mdm-audio");
      const block = bar && bar.closest('[data-type="code-block"]');
      return (
        block &&
        bar.querySelector(".abcjs-inline-audio") &&
        /A\n?$/.test(
          block.querySelector("pre.vditor-ir__marker--pre > code").textContent
        )
      );
    },
    { timeout: 15000 }
  );
  const pushed = await h.page.evaluate(() =>
    document
      .querySelector(".mdm-audio .abcjs-midi-start")
      .classList.contains("abcjs-pushed")
  );
  assert.equal(pushed, false, "a re-armed player must come back stopped");
  assert.equal((await playerState(h.page)).onIndex, 1);

  // A full external update replaces every block; the player carries over by
  // position. Removing the scores altogether closes it without residue.
  await update(
    h.page,
    typedIntoFirstParagraph(EXAMPLE, " Ext."),
    true
  );
  const after = await playerState(h.page);
  assert.equal(after.bars, 1);
  assert.equal(after.onIndex, 1);
  await h.page.evaluate(
    (text) =>
      window.postMessage(
        { type: "update", text: text, frontMatter: "x", withFrontMatter: true },
        "*"
      ),
    "Nothing musical here.\n"
  );
  await new Promise((r) => setTimeout(r, 700));
  const gone = await h.page.evaluate(() => ({
    bars: document.querySelectorAll(".mdm-audio").length,
    attrs: document.querySelectorAll("[data-mdm-audio]").length,
  }));
  assert.deepEqual(gone, { bars: 0, attrs: 0 });
  assert.deepEqual(h.errors, []);
  await h.close();
});

async function pressPlay(page) {
  await page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector(".mdm-audio .abcjs-midi-start")
        .classList.contains("abcjs-pushed"),
    { timeout: 15000 }
  );
}

test("chord symbols draw but do not sound: only the written notes are fetched", { skip }, async () => {
  const h = await open({});
  const requests = [];
  h.page.on("request", (r) => requests.push(r.url()));
  await clickToggle(h.page, 1); // the circle-of-fifths block, "Dm7"[DFAc]4 …
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  requests.length = 0;
  await pressPlay(h.page);
  await new Promise((r) => setTimeout(r, 1200));
  const notes = requests
    .filter((u) => u.includes("acoustic_grand_piano"))
    .map((u) => u.split("/").pop().replace(".mp3", ""));
  assert.ok(notes.length >= 10, "notes requested: " + notes.length);
  // The written chords, spelled onto the piano keys the soundfont names.
  // Without chordsOff, abcjs's strummed accompaniment also asks for the bass
  // octaves (C3 and below), which is exactly what must never happen.
  // Ab4 is the G sharp of E7 and Db5 the C sharp of the closing A7; the
  // soundfont names both by their flats.
  const written = new Set([
    "C4", "D4", "E4", "F4", "G4", "A4", "B4", "Ab4",
    "C5", "Db5", "D5", "E5", "F5", "G5", "A5",
  ]);
  const strays = notes.filter((n) => !written.has(n));
  assert.deepEqual(strays, [], "accompaniment notes fetched: " + strays);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("one volume for the session, moving a live gain on the playback path", { skip }, async () => {
  const h = await open({ audioSpy: true });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .mdm-audio-vol input"),
    { timeout: 15000 }
  );
  const initial = await h.page.evaluate(
    () => document.querySelector(".mdm-audio .mdm-audio-vol input").value
  );
  assert.equal(initial, "100");
  await pressPlay(h.page);
  // Stock abcjs connects the playback source straight to the destination; a
  // GainNode on the realtime context in that path is the reroute at work.
  const graph = await h.page.evaluate(() => ({
    realtimeGain: window.__connects.includes("GainNode@AudioContext"),
    gain: window.__volGain ? window.__volGain.gain.value : null,
  }));
  assert.equal(graph.realtimeGain, true, "playback does not go through the gain");
  assert.equal(graph.gain, 1);
  await h.page.evaluate(() => {
    const s = document.querySelector(".mdm-audio .mdm-audio-vol input");
    s.value = "37";
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // The gain is ramped over 20ms rather than set, so that muting mid-note
  // does not click; read once the ramp has landed.
  await new Promise((r) => setTimeout(r, 150));
  const moved = await h.page.evaluate(() => window.__volGain.gain.value);
  assert.ok(Math.abs(moved - 0.37) < 1e-3, "gain did not follow: " + moved);
  // The level is the session's, not the player's: the next player opens with
  // the slider where it was left.
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () =>
      document.querySelectorAll(".mdm-audio").length === 1 &&
      document.querySelector(".mdm-audio .mdm-audio-vol input"),
    { timeout: 15000 }
  );
  const second = await h.page.evaluate(
    () => document.querySelector(".mdm-audio .mdm-audio-vol input").value
  );
  assert.equal(second, "37");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the sounding notes light up on the score, and the ink comes back", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await pressPlay(h.page);
  // The highlight lands on the on-screen engraving (the 5.10.3 one), in the
  // accent colour, driven by the chars the synth reports.
  await h.page.waitForFunction(
    () =>
      document.querySelector(
        "#app [data-mdm-audio] code.language-abc svg .abcjs-note_selected"
      ),
    { timeout: 15000 }
  );
  const lit = await h.page.evaluate(
    () =>
      document.querySelectorAll(
        '#app [data-mdm-audio] code.language-abc svg .abcjs-note_selected'
      ).length
  );
  assert.ok(lit > 0, "no element carries the playing class");
  // The mark has to survive as a colour, not just as an attribute: the dark
  // content theme paints the shapes of a score with `fill: currentColor`, and
  // a declaration outranks the attribute abcjs writes, so on that side the
  // notehead came back grey while only its label stayed accented.
  const painted = await h.page.evaluate(() => {
    const marked = Array.from(
      document.querySelectorAll(
        "#app [data-mdm-audio] code.language-abc svg .abcjs-note_selected"
      )
    );
    return {
      notes: marked
        .filter((el) => (el.getAttribute("class") || "").includes("abcjs-note"))
        .map((el) => getComputedStyle(el).fill),
      // A note carries the shapes of its staff in the same set; lighting one
      // would draw a blue rule across the system.
      staves: marked.filter((el) =>
        (el.getAttribute("class") || "").includes("abcjs-staff")
      ).length,
    };
  });
  assert.ok(painted.notes.length > 0, "no note carries the accent");
  assert.deepEqual(
    Array.from(new Set(painted.notes)),
    ["rgb(160, 116, 15)"], // the light brass of --mdm-play-accent
    "the sounding note is not accented"
  );
  assert.equal(painted.staves, 0, "a staff line was lit with the note");
  await clickToggle(h.page, 0); // close: playback stops, highlight cleared
  await new Promise((r) => setTimeout(r, 300));
  const leftover = await h.page.evaluate(() => ({
    lit: document.querySelectorAll(
      "code.language-abc svg .abcjs-note_selected"
    ).length,
    bars: document.querySelectorAll(".mdm-audio").length,
  }));
  assert.deepEqual(leftover, { lit: 0, bars: 0 });
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Opens the player on a score whose block is OPEN for editing, and leaves the
// bar in view: with the ABC source showing above it, the bar can sit below the
// fold, and a click aimed there lands outside the editor instead (which
// blurs it, and looks exactly like the bug this fixes).
async function openPlayerOnExpandedScore(page, index) {
  await page.evaluate((i) => {
    const scores = Array.from(
      document.querySelectorAll('#app div[data-type="code-block"]')
    ).filter((b) => b.querySelector(".vditor-ir__preview code.language-abc"));
    scores[i].scrollIntoView({ block: "center" });
  }, index);
  await new Promise((r) => setTimeout(r, 200));
  const score = await page.evaluate((i) => {
    const scores = Array.from(
      document.querySelectorAll('#app div[data-type="code-block"]')
    ).filter((b) => b.querySelector(".vditor-ir__preview code.language-abc"));
    const r = scores[i].querySelector("code.language-abc").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, index);
  await page.mouse.click(score.x, score.y); // opens the ABC source
  await new Promise((r) => setTimeout(r, 400));
  await clickToggle(page, index);
  await page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  // Aim at the play button, and make sure the point really is on it.
  return page.evaluate(() => {
    document.querySelector(".mdm-audio").scrollIntoView({ block: "center" });
    const r = document
      .querySelector(".mdm-audio .abcjs-midi-start")
      .getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x: x,
      y: y,
      onButton: !!(hit && hit.closest && hit.closest(".abcjs-midi-start")),
      expanded: !!document.querySelector(
        '[data-type="code-block"].vditor-ir__node--expand'
      ),
      scroll: Math.round(
        document.querySelector("#app .vditor-ir .vditor-reset").scrollTop
      ),
    };
  });
}

test("play works with the score open for editing, and holds the document still", { skip }, async () => {
  const h = await open({});
  const aim = await openPlayerOnExpandedScore(h.page, 2);
  assert.equal(aim.onButton, true, "the play button is not under the aim point");
  assert.equal(aim.expanded, true, "the block should still be open for editing");

  await h.page.mouse.click(aim.x, aim.y);
  await new Promise((r) => setTimeout(r, 1500));
  const after = await h.page.evaluate(() => {
    const start = document.querySelector(".mdm-audio .abcjs-midi-start");
    const ind = document.querySelector(".mdm-audio .abcjs-midi-progress-indicator");
    return {
      pushed: start ? start.classList.contains("abcjs-pushed") : false,
      indicator: ind ? parseFloat(ind.style.left) || 0 : 0,
      expanded: !!document.querySelector(
        '[data-type="code-block"].vditor-ir__node--expand'
      ),
      scroll: Math.round(
        document.querySelector("#app .vditor-ir .vditor-reset").scrollTop
      ),
    };
  });
  // The button is focusable, so without the mousedown default prevented its
  // press pulls the focus out of the editable root; Vditor answers a blur by
  // collapsing the open block, which rebuilds the preview the bar lives in,
  // and the button is gone between mousedown and click. Measured before the
  // fix: playback never started and the document slid 258px.
  assert.equal(after.pushed, true, "playback did not start");
  assert.ok(after.indicator > 0, "the tune is not running: " + after.indicator);
  assert.equal(after.expanded, true, "the block collapsed under the player");
  assert.equal(after.scroll, aim.scroll, "the document moved under the reader");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the player's buttons carry tooltips that name the destination", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  const idle = await h.page.evaluate(() => {
    const start = document.querySelector(".mdm-audio .abcjs-midi-start");
    const loop = document.querySelector(".mdm-audio .abcjs-midi-loop");
    const widget = document.querySelector(".mdm-audio .abcjs-inline-audio");
    const buttons = Array.from(widget.querySelectorAll(".abcjs-btn"));
    return {
      startLabel: start.getAttribute("aria-label"),
      loopLabel: loop.getAttribute("aria-label"),
      // A native title never shows inside the webview, so the CSS tooltip of
      // this editor is what labels them; carrying both would show two.
      startTitle: start.getAttribute("title"),
      loopTitle: loop.getAttribute("title"),
      tooltipped: start.classList.contains("vditor-tooltipped") &&
        loop.classList.contains("vditor-tooltipped"),
      playFirst: buttons.indexOf(start) < buttons.indexOf(loop),
    };
  });
  assert.equal(idle.startLabel, "Play");
  assert.equal(idle.loopLabel, "Repeat");
  assert.equal(idle.startTitle, null);
  assert.equal(idle.loopTitle, null);
  assert.equal(idle.tooltipped, true);
  assert.equal(idle.playFirst, true, "play should lead the bar");

  // Pressing repeat lights it: abcjs declares `background: none !important` on
  // its buttons, so the state used to be drawn by a rule that never painted
  // and the button read as dead.
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-loop").click()
  );
  // The label follows the class abcjs writes, through an observer, so it
  // lands a tick after the press.
  await new Promise((r) => setTimeout(r, 150));
  const lit = await h.page.evaluate(() => {
    const loop = document.querySelector(".mdm-audio .abcjs-midi-loop");
    return {
      label: loop.getAttribute("aria-label"),
      background: getComputedStyle(loop).backgroundColor,
      pushed: loop.classList.contains("abcjs-pushed"),
    };
  });
  assert.equal(lit.pushed, true);
  assert.equal(lit.label, "Play once", "the tooltip must follow the state");
  assert.notEqual(lit.background, "rgba(0, 0, 0, 0)", "repeat paints nothing when on");
  assert.notEqual(lit.background, "transparent");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the player chrome takes no syntax colour, so no theme can turn it red", { skip }, async () => {
  // Monokai's keyword colour, which the buttons used to take on hover: a
  // strong pink-red, and every dark theme brings a hue of its own.
  const h = await open({ seed: { settings: { theme: "dark" } } });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  const spot = await h.page.evaluate(() => {
    document.querySelector(".mdm-audio").scrollIntoView({ block: "center" });
    const r = document
      .querySelector(".mdm-audio .abcjs-midi-start")
      .getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await h.page.mouse.move(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 200));
  const colours = await h.page.evaluate(() => {
    const root = document.getElementById("app");
    const keyword = getComputedStyle(root).getPropertyValue("--mdm-syn-keyword").trim();
    const g = document.querySelector(".mdm-audio .abcjs-midi-start g");
    const base = getComputedStyle(root).getPropertyValue("--mdm-syn-base").trim();
    return { keyword: keyword, fill: getComputedStyle(g).fill, base: base };
  });
  // The fallback dark palette is Monokai, whose keyword is #f92672.
  assert.equal(colours.keyword, "#f92672", "the fixture must carry a red keyword");
  assert.notEqual(colours.fill, "rgb(249, 38, 114)", "the hovered button went red");
  // Every disc in the bar is the ink of the editor at some weight: one under
  // the pointer, a stronger one for the state the repeat button holds, and
  // no hue anywhere, neither a syntax colour nor the brass the score marks
  // the sounding note with. The expected values are mixed by the browser
  // from the ink in force, so the test follows a change of theme and only
  // fails if a disc stops taking it.
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-loop").click()
  );
  await new Promise((r) => setTimeout(r, 200));
  const discs = await h.page.evaluate(() => {
    const bar = document.querySelector(".mdm-audio .abcjs-inline-audio");
    const mix = (colour, pct) => {
      const probe = document.createElement("div");
      probe.style.backgroundColor =
        "color-mix(in srgb, var(" + colour + ") " + pct + "%, transparent)";
      bar.appendChild(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    };
    return {
      hover: getComputedStyle(bar.querySelector(".abcjs-midi-start"))
        .backgroundColor,
      pushed: getComputedStyle(bar.querySelector(".abcjs-midi-loop"))
        .backgroundColor,
      ink10: mix("--mdm-syn-base", 10),
      ink20: mix("--mdm-syn-base", 20),
      brass10: mix("--mdm-play-accent", 10),
    };
  });
  assert.equal(discs.hover, discs.ink10, "the hovered disc is not the ink of the bar");
  assert.equal(discs.pushed, discs.ink20, "the repeat disc is not the ink of the bar");
  assert.notEqual(discs.hover, discs.brass10, "the disc took the brass of the score");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the toggle wears headphones, and lights up while its player is open", { skip }, async () => {
  const h = await open({});
  const read = () =>
    h.page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll(".mdm-audio-toggle span"));
      return spans.map((s) => ({
        label: s.getAttribute("aria-label"),
        drawing: s.innerHTML.replace(/\s+/g, " ").trim(),
        disc: getComputedStyle(s).backgroundColor,
      }));
    });
  const closed = await read();
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  const open_ = await read();
  // One drawing, the same for every score and in both states: a speaker would
  // have collided with the mute of the bar, where a struck-through cone means
  // "nothing is coming out" rather than "click to hide".
  const drawings = new Set(closed.concat(open_).map((t) => t.drawing));
  assert.equal(drawings.size, 1, "the toggle has more than one face");
  assert.ok(
    [...drawings][0].includes("<rect") && !/M2 6\.5/.test([...drawings][0]),
    "the toggle is not the headphones: " + [...drawings][0].slice(0, 80)
  );
  // What says the player is open is the disc, as on the repeat button, and the
  // tooltip still names the destination of the click.
  assert.deepEqual(
    closed.map((t) => t.label),
    ["Show player", "Show player", "Show player"]
  );
  assert.deepEqual(
    open_.map((t) => t.label),
    ["Hide player", "Show player", "Show player"]
  );
  assert.equal(closed[0].disc, "rgba(0, 0, 0, 0)", "a shut player carries a disc");
  assert.notEqual(open_[0].disc, "rgba(0, 0, 0, 0)", "the open player is not marked");
  assert.deepEqual(
    open_.slice(1).map((t) => t.disc),
    ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"],
    "the scores left alone were marked too"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the sounding note is accented on the dark side too", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "dark" } } });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await pressPlay(h.page);
  await h.page.waitForFunction(
    () =>
      document.querySelector(
        "#app [data-mdm-audio] code.language-abc svg .abcjs-note_selected"
      ),
    { timeout: 15000 }
  );
  const fills = await h.page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        "#app [data-mdm-audio] code.language-abc svg .abcjs-note_selected"
      )
    )
      .filter((el) => (el.getAttribute("class") || "").includes("abcjs-note"))
      .map((el) => getComputedStyle(el).fill)
  );
  assert.ok(fills.length > 0, "no note carries the accent");
  // The dark side carries a brass of its own: the light one would sink into
  // the ground the way the ink of a score does.
  assert.deepEqual(
    Array.from(new Set(fills)),
    ["rgb(217, 169, 79)"],
    "the dark repaint swallowed the mark"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("stop halts the tune and takes it back to the top", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .mdm-audio-stop"),
    { timeout: 15000 }
  );
  const order = await h.page.evaluate(() => {
    const widget = document.querySelector(".mdm-audio .abcjs-inline-audio");
    return Array.from(widget.querySelectorAll(".abcjs-btn")).map((b) =>
      b.classList.contains("abcjs-midi-start")
        ? "play"
        : b.classList.contains("mdm-audio-stop")
        ? "stop"
        : b.classList.contains("abcjs-midi-loop")
        ? "repeat"
        : "?"
    );
  });
  assert.deepEqual(order, ["play", "stop", "repeat"]);

  await pressPlay(h.page);
  await h.page.waitForFunction(
    () =>
      parseFloat(
        document.querySelector(".mdm-audio .abcjs-midi-progress-indicator")
          .style.left
      ) > 0,
    { timeout: 15000 }
  );
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .mdm-audio-stop").click()
  );
  await new Promise((r) => setTimeout(r, 400));
  const stopped = await h.page.evaluate(() => {
    const start = document.querySelector(".mdm-audio .abcjs-midi-start");
    const ind = document.querySelector(".mdm-audio .abcjs-midi-progress-indicator");
    return {
      pushed: start.classList.contains("abcjs-pushed"),
      label: start.getAttribute("aria-label"),
      indicator: parseFloat(ind.style.left) || 0,
      lit: document.querySelectorAll(
        "code.language-abc svg .abcjs-note_selected"
      ).length,
      stopLabel: document
        .querySelector(".mdm-audio .mdm-audio-stop")
        .getAttribute("aria-label"),
    };
  });
  // Stopped, not paused: pressing play again starts from the top, and the
  // note that was sounding is back in ink.
  assert.equal(stopped.pushed, false, "the tune is still running");
  assert.equal(stopped.label, "Play");
  assert.equal(stopped.indicator, 0, "the progress did not rewind");
  assert.equal(stopped.lit, 0, "a note stayed lit after stopping");
  assert.equal(stopped.stopLabel, "Stop");
  // And it stays quiet: nothing restarts it on its own.
  await new Promise((r) => setTimeout(r, 600));
  const still = await h.page.evaluate(() =>
    parseFloat(
      document.querySelector(".mdm-audio .abcjs-midi-progress-indicator").style
        .left
    ) || 0
  );
  assert.equal(still, 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("setting the volume draws no focus box", { skip }, async () => {
  const h = await open({});
  // The sheet VS Code hands every webview, copied from the preload of the
  // installed build: -webkit-focus-ring-color is amber in Chromium, so this
  // is what drew a yellow box around the slider while it was dragged.
  await h.page.addStyleTag({
    content:
      "a:focus, input:focus, select:focus, textarea:focus { outline: 1px solid -webkit-focus-ring-color; outline-offset: -1px; }",
  });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .mdm-audio-vol input"),
    { timeout: 15000 }
  );
  const spot = await h.page.evaluate(() => {
    document.querySelector(".mdm-audio").scrollIntoView({ block: "center" });
    const r = document
      .querySelector(".mdm-audio .mdm-audio-vol input")
      .getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await h.page.mouse.click(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 200));
  const out = await h.page.evaluate(() => {
    const el = document.querySelector(".mdm-audio .mdm-audio-vol input");
    const style = getComputedStyle(el);
    return {
      focused: document.activeElement === el,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  assert.equal(out.focused, true, "the slider did not take the focus");
  assert.equal(out.outlineStyle, "none", "the focus box is still drawn");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the volume can be set without closing the score that is open", { skip }, async () => {
  const h = await open({});
  await openPlayerOnExpandedScore(h.page, 2);
  const aim = await h.page.evaluate(() => {
    document.querySelector(".mdm-audio").scrollIntoView({ block: "center" });
    const el = document.querySelector(".mdm-audio .mdm-audio-vol input");
    const r = el.getBoundingClientRect();
    const x = r.x + r.width * 0.4;
    const y = r.y + r.height / 2;
    return {
      x: x,
      y: y,
      onSlider: document.elementFromPoint(x, y) === el,
      value: el.value,
      expanded: !!document.querySelector(".vditor-ir__node--expand"),
      scroll: Math.round(
        document.querySelector("#app .vditor-ir .vditor-reset").scrollTop
      ),
    };
  });
  assert.equal(aim.onSlider, true, "the slider is not under the aim point");
  assert.equal(aim.expanded, true);
  await h.page.mouse.click(aim.x, aim.y);
  await new Promise((r) => setTimeout(r, 400));
  const after = await h.page.evaluate(() => ({
    value: document.querySelector(".mdm-audio .mdm-audio-vol input").value,
    expanded: !!document.querySelector(".vditor-ir__node--expand"),
    scroll: Math.round(
      document.querySelector("#app .vditor-ir .vditor-reset").scrollTop
    ),
  }));
  // A form control has to take the focus for its own drag, so its blur is
  // stopped short of Vditor instead. Before that, this click closed the block
  // and slid the document 258px.
  assert.notEqual(after.value, aim.value, "the slider did not move");
  assert.equal(after.expanded, true, "the block closed under the slider");
  assert.equal(after.scroll, aim.scroll, "the document moved under the reader");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a click beside an open block closes it, as one above or below does", { skip }, async () => {
  const h = await open({});
  for (const selector of [
    '#app div[data-type="code-block"]',
    '#app div[data-type="math-block"]',
  ]) {
    const spot = await h.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + 40, y: r.y + Math.min(20, r.height / 2) };
    }, selector);
    await new Promise((r) => setTimeout(r, 200));
    await h.page.mouse.click(spot.x, spot.y);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      await h.page.evaluate(() => !!document.querySelector(".vditor-ir__node--expand")),
      true,
      selector + " did not open"
    );
    // The gutter beside it: a block spans the whole width, so there is no
    // block to land on there and the click used to leave the source open.
    const aim = await h.page.evaluate(() => {
      const el = document.querySelector(".vditor-ir__node--expand");
      const r = el.getBoundingClientRect();
      const y = Math.min(Math.max(r.y + r.height / 2, 60), 640);
      const hit = document.elementFromPoint(20, y);
      return {
        y: y,
        onGutter: !!(hit && hit.classList && hit.classList.contains("vditor-reset")),
        scroll: Math.round(
          document.querySelector("#app .vditor-ir .vditor-reset").scrollTop
        ),
      };
    });
    assert.equal(aim.onGutter, true, "the aim point is not in the gutter");
    await h.page.mouse.click(20, aim.y);
    await new Promise((r) => setTimeout(r, 400));
    const after = await h.page.evaluate(() => ({
      expanded: !!document.querySelector(".vditor-ir__node--expand"),
      scroll: Math.round(
        document.querySelector("#app .vditor-ir .vditor-reset").scrollTop
      ),
    }));
    assert.equal(after.expanded, false, selector + " stayed open");
    assert.equal(after.scroll, aim.scroll, "the document moved");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a selection dragged past the edge of the block keeps it open", { skip }, async () => {
  const h = await open({});
  // Open the first score for editing.
  const spot = await h.page.evaluate(() => {
    const el = document.querySelector('#app div[data-type="code-block"]');
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + 40, y: r.y + Math.min(20, r.height / 2) };
  });
  await h.page.mouse.click(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 400));
  // Selecting a line of ABC runs to the edge of the block and out into the
  // gutter, where the mouse comes up on the editable root: the same target a
  // click beside the block has. Read as a click, that closed the block and
  // threw the selection away, which made a long line impossible to select.
  const drag = await h.page.evaluate(() => {
    const code = document.querySelector(
      ".vditor-ir__node--expand pre.vditor-ir__marker--pre > code"
    );
    const text = code.firstChild;
    // The longest line: dragging from its middle to the gutter has to leave a
    // selection long enough to tell from a stray caret move.
    const line = code.textContent.split("\n").sort((a, b) => b.length - a.length)[0];
    const from = code.textContent.indexOf(line);
    const range = document.createRange();
    range.setStart(text, from);
    range.setEnd(text, from + line.length);
    const r = range.getBoundingClientRect();
    return {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      line: line,
    };
  });
  await h.page.mouse.move(drag.x, drag.y);
  await h.page.mouse.down();
  await h.page.mouse.move(20, drag.y, { steps: 10 });
  await h.page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const after = await h.page.evaluate(() => ({
    expanded: !!document.querySelector(".vditor-ir__node--expand"),
    selected: window.getSelection().toString(),
  }));
  assert.equal(after.expanded, true, "the block closed on the end of the drag");
  assert.ok(
    drag.line.startsWith(after.selected) && after.selected.length > 3,
    "the selection was lost: " + JSON.stringify(after.selected)
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the speaker silences the score, and the level it was set to survives", { skip }, async () => {
  const h = await open({ gainSpy: true });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .mdm-audio-mute"),
    { timeout: 15000 }
  );
  const master = () =>
    h.page.evaluate(() => (window.__gains[0] ? window.__gains[0].gain.value : null));
  const face = () =>
    h.page.evaluate(() => ({
      label: document.querySelector(".mdm-audio-mute").getAttribute("aria-label"),
      lit: !!document.querySelector(".mdm-audio-vol--muted"),
    }));
  // Half volume first, so what mute has to give back is a level and not the
  // default it started at.
  await h.page.evaluate(() => {
    const slider = document.querySelector(".mdm-audio-vol input[type=range]");
    slider.value = "40";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(Math.abs((await master()) - 0.4) < 0.01, "the slider did not take");
  assert.equal(
    await h.page.evaluate(() =>
      document
        .querySelector(".mdm-audio-vol input[type=range]")
        .style.getPropertyValue("--mdm-vol")
    ),
    "40%",
    "the volume track is not filled to the level"
  );
  await h.page.evaluate(() => document.querySelector(".mdm-audio-mute").click());
  // The gain is ramped over 20ms rather than dropped, so it clicks on nobody.
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await master(), 0, "the speaker did not silence the score");
  assert.deepEqual(await face(), { label: "Unmute", lit: true });
  // The speaker reports the state it is in: struck through while nothing is
  // coming out (SPEAKER_SLASH), open again once the sound is back.
  const struck = () =>
    h.page.evaluate(() =>
      document.querySelector(".mdm-audio-mute svg").innerHTML.includes("M11.31")
    );
  assert.equal(await struck(), true, "the muted speaker is not struck through");
  await h.page.evaluate(() => document.querySelector(".mdm-audio-mute").click());
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(
    Math.abs((await master()) - 0.4) < 0.01,
    "the level did not come back: " + (await master())
  );
  assert.deepEqual(await face(), { label: "Mute", lit: false });
  assert.equal(await struck(), false, "the speaker stayed struck through");
  // Reaching for the slider while muted asks for sound.
  await h.page.evaluate(() => document.querySelector(".mdm-audio-mute").click());
  await new Promise((r) => setTimeout(r, 150));
  await h.page.evaluate(() => {
    const slider = document.querySelector(".mdm-audio-vol input[type=range]");
    slider.value = "70";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(Math.abs((await master()) - 0.7) < 0.01, "the slider did not lift the mute");
  assert.deepEqual(await face(), { label: "Mute", lit: false });
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("what a button of the bar holds is drawn on its disc, never on its glyph", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-loop"),
    { timeout: 15000 }
  );
  const read = () =>
    h.page.evaluate(() => {
      const bar = document.querySelector(".mdm-audio");
      const loop = bar.querySelector(".abcjs-midi-loop");
      const style = getComputedStyle(bar);
      // The custom properties resolve to whatever the theme set; a throwaway
      // element turns them into the rgb() the computed styles are read in.
      const probe = document.createElement("span");
      bar.appendChild(probe);
      const resolve = (name) => {
        probe.style.color = style.getPropertyValue(name);
        return getComputedStyle(probe).color;
      };
      const out = {
        ink: resolve("--mdm-syn-base"),
        // The brass the score marks the sounding note with. No disc of the
        // bar may be drawn in it: a row of coloured circles reads as an
        // alarm, and the colour belongs to the music.
        accent: resolve("--mdm-play-accent"),
        glyph: getComputedStyle(loop.querySelector("g")).fill,
        disc: getComputedStyle(loop).backgroundColor,
      };
      probe.remove();
      return out;
    });
  const off = await read();
  assert.equal(off.disc, "rgba(0, 0, 0, 0)", "an idle button carries a disc");
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-loop").click()
  );
  await new Promise((r) => setTimeout(r, 200));
  const on = await read();
  assert.notEqual(on.disc, "rgba(0, 0, 0, 0)", "the repeat state is not drawn");
  assert.notEqual(on.disc, off.disc);
  assert.equal(on.glyph, on.ink, "the glyph took a colour of its own");
  assert.notEqual(on.glyph, on.accent);
  // The disc is the ink of the editor at some weight, never the brass: it is
  // a mix of that ink with transparency, so its channels are the ink's. A
  // color-mix() computes to color(srgb …) with channels from 0 to 1, while a
  // plain colour reads as rgb() from 0 to 255; both are brought to the same
  // scale before they are compared.
  const channels = (colour) =>
    (colour.match(/[\d.]+/g) || [])
      .slice(0, 3)
      .map((n) => (Number(n) > 1 ? Number(n) / 255 : Number(n)));
  const near = (a, b) => a.every((n, i) => Math.abs(n - b[i]) < 0.01);
  assert.ok(
    near(channels(on.disc), channels(on.ink)),
    "the state disc is not drawn in the ink of the bar: " + on.disc
  );
  assert.ok(
    !near(channels(on.disc), channels(on.accent)),
    "the state disc took the brass of the score: " + on.disc
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a button of the bar answers the pointer, and deeper while it is held", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  const aim = await h.page.evaluate(() => {
    document.querySelector(".mdm-audio").scrollIntoView({ block: "center" });
    const el = document.querySelector(".mdm-audio .abcjs-midi-start");
    const r = el.getBoundingClientRect();
    const p = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    // Measured from the point, never from the element: a bar scrolled out of
    // the viewport reports a box all the same, and the press would land on
    // something else entirely.
    p.onButton = el.contains(document.elementFromPoint(p.x, p.y));
    return p;
  });
  assert.equal(aim.onButton, true, "the aim point is not on the play button");
  const disc = () =>
    h.page.evaluate(
      () => getComputedStyle(document.querySelector(".mdm-audio .abcjs-midi-start")).backgroundColor
    );
  const alpha = (colour) => {
    const parts = colour.match(/[\d.]+/g) || [];
    return parts.length >= 4 ? Number(parts[3]) : 0;
  };
  assert.equal(alpha(await disc()), 0, "an idle button carries a disc");
  await h.page.mouse.move(aim.x, aim.y);
  await new Promise((r) => setTimeout(r, 200));
  const hovered = alpha(await disc());
  await h.page.mouse.down();
  await new Promise((r) => setTimeout(r, 200));
  const pressed = alpha(await disc());
  await h.page.mouse.up();
  // abcjs declares `background: none !important` on every one of its buttons,
  // so each of these has to win that fight to be seen at all.
  assert.ok(hovered > 0.05, "no disc under the pointer: " + hovered);
  assert.ok(pressed > hovered, "the press is not answered: " + pressed + " vs " + hovered);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the track is filled up to the head, wherever the head is put", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-progress-background"),
    { timeout: 15000 }
  );
  // What is painted behind the head: the fill written by paint(), and where
  // the head itself sits, as a fraction of the track.
  const read = () =>
    h.page.evaluate(() => {
      const track = document.querySelector(".mdm-audio .abcjs-midi-progress-background");
      const head = track.querySelector(".abcjs-midi-progress-indicator");
      return {
        fill: parseFloat(track.style.getPropertyValue("--mdm-progress")),
        at: ((parseFloat(head.style.left) || 0) / track.offsetWidth) * 100,
        painted: getComputedStyle(track).backgroundImage,
      };
    });
  const start = await read();
  assert.equal(start.fill, 0, "the track starts filled: " + start.fill);
  assert.ok(
    start.painted.includes("gradient"),
    "the track is not painted as a fill: " + start.painted
  );
  const grab = await progressAim(h.page, 0.05);
  const drop = await progressAim(h.page, 0.6);
  await h.page.mouse.move(grab.x, grab.y);
  await h.page.mouse.down();
  await h.page.mouse.move(drop.x, drop.y, { steps: 8 });
  // Read with the button still down: the fill follows the hand, not the
  // landing, since both come off the one call that moves the head.
  const during = await read();
  await h.page.mouse.up();
  assert.ok(
    Math.abs(during.fill - 60) < 3,
    "the fill did not follow the head: " + during.fill
  );
  assert.ok(
    Math.abs(during.fill - during.at) < 1.5,
    "fill and head drifted apart: " + during.fill + " vs " + during.at
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the gutter beside a block offers no cursor and opens nothing", { skip }, async () => {
  const h = await open({});
  const spot = await h.page.evaluate(() => {
    const block = document.querySelector('#app div[data-type="code-block"]');
    block.scrollIntoView({ block: "center" });
    const r = block.getBoundingClientRect();
    return { y: Math.round(r.y + Math.min(30, r.height / 2)), x: Math.round(r.x + 20) };
  });
  const root = () =>
    h.page.evaluate(() => {
      const el = document.querySelector("#app .vditor-ir .vditor-reset");
      return {
        cursor: getComputedStyle(el).cursor,
        gutter: el.classList.contains("mdm-gutter"),
      };
    });
  await h.page.mouse.move(20, spot.y);
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(await root(), { cursor: "default", gutter: true }, "left gutter");
  await h.page.mouse.click(20, spot.y);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(
    await h.page.evaluate(() => !!document.querySelector(".vditor-ir__node--expand")),
    false,
    "a click in the gutter opened the block beside it"
  );
  // Inside the block the beam comes back: the rule is about the margins, not
  // about the document.
  await h.page.mouse.move(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(await root(), { cursor: "auto", gutter: false }, "over the text");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the cursor is told where it is many times a beat", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await pressPlay(h.page);
  // Every distinct position the progress head is put at over a second. abcjs
  // reports once per beat by default, and that same number is where the
  // cursor restarts after a pause while the sound resumes where it stopped,
  // so a coarse report is a cursor out of step with the music.
  const readings = await h.page.evaluate(
    () =>
      new Promise((resolve) => {
        const seen = new Set();
        const el = document.querySelector(
          ".mdm-audio .abcjs-midi-progress-indicator"
        );
        const timer = setInterval(() => seen.add(el.style.left), 16);
        setTimeout(() => {
          clearInterval(timer);
          resolve(seen.size);
        }, 1000);
      })
  );
  // At this tempo a beat is about half a second: one reading per beat would
  // give two or three distinct positions in a second.
  assert.ok(readings >= 10, "progress reported " + readings + " times a second");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the two little buttons of a score are sized to be read", { skip }, async () => {
  const h = await open({});
  const spot = await h.page.evaluate(() => {
    const block = document.querySelector('#app div[data-type="code-block"]');
    block.scrollIntoView({ block: "center" });
    const r = block.querySelector("pre.vditor-ir__preview").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + 8 };
  });
  await h.page.mouse.move(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 200));
  const sizes = await h.page.evaluate(() => {
    const block = document.querySelector('#app div[data-type="code-block"]');
    const speaker = block.querySelector(".mdm-audio-toggle svg").getBoundingClientRect();
    const copy = block.querySelector(".vditor-copy svg").getBoundingClientRect();
    return {
      speaker: Math.round(speaker.height),
      copy: Math.round(copy.height),
      sameLine:
        Math.abs(
          speaker.y + speaker.height / 2 - (copy.y + copy.height / 2)
        ) <= 1.5,
    };
  });
  assert.equal(sizes.speaker, 16);
  assert.ok(sizes.speaker > sizes.copy, "the speaker is not the larger of the two");
  assert.equal(sizes.sameLine, true, "the two buttons are off each other's line");

  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .mdm-audio-stop"),
    { timeout: 15000 }
  );
  const stop = await h.page.evaluate(() => {
    const rect = document
      .querySelector(".mdm-audio .mdm-audio-stop rect")
      .getBoundingClientRect();
    const play = document
      .querySelector(".mdm-audio .abcjs-midi-start svg")
      .getBoundingClientRect();
    return { square: Math.round(rect.width), play: Math.round(play.width) };
  });
  assert.ok(stop.square >= 8, "the stop square is drawn at " + stop.square + "px");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Where a fraction of the tune sits on the progress track, in page
// coordinates. Built from offsetWidth, which is what abcjs divides the x of a
// seek by, so the aim and the reading agree to the pixel.
async function progressAim(page, fraction) {
  return page.evaluate((f) => {
    const bar = document.querySelector(".mdm-audio");
    bar.scrollIntoView({ block: "center" });
    const track = bar.querySelector(".abcjs-midi-progress-background");
    const box = track.getBoundingClientRect();
    const x = box.x + track.offsetWidth * f;
    const y = box.y + box.height / 2;
    return { x: x, y: y, onTrack: track.contains(document.elementFromPoint(x, y)) };
  }, fraction);
}

async function progressState(page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".mdm-audio");
    const track = bar.querySelector(".abcjs-midi-progress-background");
    const head = bar.querySelector(".abcjs-midi-progress-indicator");
    return {
      at: (parseFloat(head.style.left) || 0) / track.offsetWidth,
      clock: bar.querySelector(".abcjs-midi-clock").textContent.trim(),
      valuenow: track.getAttribute("aria-valuenow"),
      focused: document.activeElement === track,
    };
  });
}

test("the progress head follows the pointer, and the tune lands where it is dropped", { skip }, async () => {
  const h = await open({ text: TIMING_FIXTURE });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-progress-background"),
    { timeout: 15000 }
  );
  const grab = await progressAim(h.page, 0.05);
  const drop = await progressAim(h.page, 0.75);
  assert.equal(grab.onTrack, true, "the grab point is not on the track");
  // The track draws a 4px hairline and answers to a band around it, the way
  // the volume slider is an 11px control over a 3px track.
  const reach = await h.page.evaluate(() => {
    const track = document.querySelector(
      ".mdm-audio .abcjs-midi-progress-background"
    );
    const box = track.getBoundingClientRect();
    const x = box.x + track.offsetWidth * 0.4;
    return {
      drawn: Math.round(box.height),
      above: track.contains(document.elementFromPoint(x, box.y - 5)),
      below: track.contains(document.elementFromPoint(x, box.bottom + 5)),
    };
  });
  assert.equal(reach.drawn, 4, "the hairline is " + reach.drawn + "px");
  assert.equal(reach.above, true, "nothing to grab above the hairline");
  assert.equal(reach.below, true, "nothing to grab below the hairline");
  const before = await progressState(h.page);
  assert.equal(before.clock, "0:00");

  await h.page.mouse.move(grab.x, grab.y);
  await h.page.mouse.down();
  await h.page.mouse.move(drop.x, drop.y, { steps: 8 });
  // Read with the button still down: abcjs on its own answers nothing but the
  // click, so the head used to sit where it was until the pointer was let go.
  const during = await progressState(h.page);
  await h.page.mouse.up();
  assert.ok(
    Math.abs(during.at - 0.75) < 0.02,
    "the head sat at " + during.at.toFixed(3) + " while the pointer was at 0.75"
  );

  // The drop reaches the engine, which has to prime the tune first: the clock
  // can only read a time once there is a duration to read it from.
  await h.page.waitForFunction(
    () =>
      document.querySelector(".mdm-audio .abcjs-midi-clock").textContent.trim() !==
      "0:00",
    { timeout: 20000 }
  );
  const after = await progressState(h.page);
  assert.ok(
    Math.abs(after.at - 0.75) < 0.02,
    "the head settled at " + after.at.toFixed(3)
  );
  assert.equal(after.valuenow, "75");
  // Four bars of 4/4 at a quarter = 100 make about 9.6s, so three quarters in
  // is past the seventh second.
  assert.equal(after.clock, "0:07", "the tune did not land where it was dropped");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the playhead lets go of the head while the pointer holds it", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-progress-background"),
    { timeout: 15000 }
  );
  await pressPlay(h.page);
  await h.page.waitForFunction(
    () =>
      parseFloat(
        document.querySelector(".mdm-audio .abcjs-midi-progress-indicator").style
          .left
      ) > 0,
    { timeout: 15000 }
  );
  const aim = await progressAim(h.page, 0.6);
  await h.page.mouse.move(aim.x - 4, aim.y);
  await h.page.mouse.down();
  await h.page.mouse.move(aim.x, aim.y, { steps: 3 });
  const first = await progressState(h.page);
  // A sounding tune reports its playhead sixteen times a beat. Nothing is
  // being waited for here: what is measured is that nothing moves.
  await new Promise((r) => setTimeout(r, 700));
  const second = await progressState(h.page);
  await h.page.mouse.up();
  assert.ok(
    Math.abs(first.at - 0.6) < 0.02,
    "the head is at " + first.at.toFixed(3) + ", not under the pointer"
  );
  assert.equal(
    second.at,
    first.at,
    "the playhead pulled the head out from under the pointer"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the progress bar answers the arrow keys, as the volume slider does", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-progress-background"),
    { timeout: 15000 }
  );
  // A click leaves the focus on the bar, as clicking the volume does, so the
  // keys carry on from where the pointer left off. The player keeps the focus
  // off its buttons on purpose (their mousedown is cancelled); these two are
  // the exceptions.
  const aim = await progressAim(h.page, 0.4);
  await h.page.mouse.click(aim.x, aim.y);
  await h.page.waitForFunction(
    () =>
      document.querySelector(".mdm-audio .abcjs-midi-clock").textContent.trim() !==
      "0:00",
    { timeout: 20000 }
  );
  const clicked = await progressState(h.page);
  assert.equal(clicked.focused, true, "the track did not take the focus");
  assert.ok(Math.abs(clicked.at - 0.4) < 0.01, "the click landed at " + clicked.at);

  for (let i = 0; i < 3; i++) await h.page.keyboard.press("ArrowRight");
  await new Promise((r) => setTimeout(r, 400));
  const stepped = await progressState(h.page);
  assert.ok(
    Math.abs(stepped.at - clicked.at - 0.06) < 0.005,
    "three steps of 2% moved the head to " + stepped.at.toFixed(3)
  );
  assert.equal(stepped.focused, true, "the track lost the focus to a key");
  await h.page.keyboard.press("End");
  await new Promise((r) => setTimeout(r, 400));
  const ended = await progressState(h.page);
  assert.equal(ended.valuenow, "100");
  assert.ok(ended.at > 0.98, "End left the head at " + ended.at.toFixed(3));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("seeks made before the tune is ready add up, and the last one is the one that lands", { skip }, async () => {
  const h = await open({ text: TIMING_FIXTURE });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-progress-background"),
    { timeout: 15000 }
  );
  // Nothing has primed the tune yet, which is the window where this goes
  // wrong: priming zeroes the position the controller holds, and abcjs sets
  // aside a seek asked for during a load and looks again every 500ms. Three
  // steps of 2% have to end on 6%, not on 2% three times over, and not on
  // whichever of them the waits happened to bring back last.
  await h.page.evaluate(() => {
    const track = document.querySelector(
      ".mdm-audio .abcjs-midi-progress-background"
    );
    track.focus();
    // Every reading the head is put at, in order. The head answers a key at
    // once and the engine catches up later, so this is where a request that
    // landed out of turn shows: the head walks back down the steps it just
    // climbed.
    window.__steps = [];
    new MutationObserver(() =>
      window.__steps.push(Number(track.getAttribute("aria-valuenow")))
    ).observe(track, { attributes: true, attributeFilter: ["aria-valuenow"] });
  });
  for (let i = 0; i < 3; i++) await h.page.keyboard.press("ArrowRight");
  await h.page.waitForFunction(
    () =>
      document.querySelector(".mdm-audio .abcjs-midi-clock").parentElement &&
      !document
        .querySelector(".mdm-audio .abcjs-midi-start")
        .classList.contains("abcjs-loading"),
    { timeout: 20000 }
  );
  // Long enough for anything abcjs set aside during the load to come back:
  // it looks again every 500ms.
  await new Promise((r) => setTimeout(r, 1500));
  const steps = await h.page.evaluate(() => window.__steps);
  assert.deepEqual(steps, [2, 4, 6], "the head went " + steps.join(" "));
  const settled = await progressState(h.page);
  assert.equal(settled.valuenow, "6");
  assert.equal(settled.clock, "0:00", "6% of a tune of about 9.6s is under a second");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the tune can be scrubbed without closing the score that is open", { skip }, async () => {
  const h = await open({});
  await openPlayerOnExpandedScore(h.page, 2);
  const aim = await h.page.evaluate(() => {
    document.querySelector(".mdm-audio").scrollIntoView({ block: "center" });
    const track = document.querySelector(
      ".mdm-audio .abcjs-midi-progress-background"
    );
    const box = track.getBoundingClientRect();
    const y = box.y + box.height / 2;
    return {
      from: box.x + track.offsetWidth * 0.1,
      to: box.x + track.offsetWidth * 0.8,
      y: y,
      onTrack: track.contains(
        document.elementFromPoint(box.x + track.offsetWidth * 0.1, y)
      ),
      expanded: !!document.querySelector(".vditor-ir__node--expand"),
      scroll: Math.round(
        document.querySelector("#app .vditor-ir .vditor-reset").scrollTop
      ),
    };
  });
  assert.equal(aim.onTrack, true, "the grab point is not on the track");
  assert.equal(aim.expanded, true);
  // The bar takes the focus here, as the volume slider does, so the guard on
  // blur is the only thing holding the open block open. Without it Vditor
  // collapses the block, which rebuilds the preview the bar lives in, and the
  // drag ends on an element that no longer exists.
  await h.page.mouse.move(aim.from, aim.y);
  await h.page.mouse.down();
  await h.page.mouse.move(aim.to, aim.y, { steps: 8 });
  await h.page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const after = await h.page.evaluate(() => {
    const track = document.querySelector(
      ".mdm-audio .abcjs-midi-progress-background"
    );
    const head = document.querySelector(".mdm-audio .abcjs-midi-progress-indicator");
    return {
      at: (parseFloat(head.style.left) || 0) / track.offsetWidth,
      expanded: !!document.querySelector(".vditor-ir__node--expand"),
      scroll: Math.round(
        document.querySelector("#app .vditor-ir .vditor-reset").scrollTop
      ),
    };
  });
  assert.ok(Math.abs(after.at - 0.8) < 0.02, "the head ended at " + after.at);
  assert.equal(after.expanded, true, "the block closed under the drag");
  assert.equal(after.scroll, aim.scroll, "the document moved under the reader");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the file actions lead the toolbar, and undo/redo wear the rotate arrows", { skip }, async () => {
  const h = await open({});
  const bar = await h.page.evaluate(() => {
    const types = Array.from(
      document.querySelectorAll("#app .vditor-toolbar button[data-type]")
    ).map((b) => b.getAttribute("data-type"));
    const undo = document.querySelector(
      '#app .vditor-toolbar button[data-type="undo"] svg path'
    );
    const redo = document.querySelector(
      '#app .vditor-toolbar button[data-type="redo"] svg path'
    );
    return {
      first: types.slice(0, 6),
      // The swapped drawings: an open ring whose arc starts at these exact
      // coordinates; Vditor's own sprite icons carry no `d` here at all.
      undoPath: undo ? undo.getAttribute("d").slice(0, 5) : null,
      redoPath: redo ? redo.getAttribute("d").slice(0, 5) : null,
      undoDisabled: document
        .querySelector('#app .vditor-toolbar button[data-type="undo"]')
        .parentElement.classList.contains("vditor-menu--disabled"),
    };
  });
  // Export leads (its submenu entries render right after it), then undo/redo.
  assert.deepEqual(bar.first, [
    "mdm-export",
    "mdm-export-html",
    "mdm-export-pdf",
    "mdm-export-both",
    "undo",
    "redo",
  ]);
  assert.equal(bar.undoPath, "M3.32");
  assert.equal(bar.redoPath, "M12.6");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the export entries ask the host for the right format", { skip }, async () => {
  const h = await open({});
  await h.page.evaluate(() => {
    document.querySelector('#app button[data-type="mdm-export-html"]').click();
    document.querySelector('#app button[data-type="mdm-export-pdf"]').click();
    document.querySelector('#app button[data-type="mdm-export-both"]').click();
  });
  const posts = await h.page.evaluate(() =>
    window.__posts.filter((m) => m.type === "export").map((m) => m.to)
  );
  assert.deepEqual(posts, ["html", "pdf", "both"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("resume waits out the cut note in silence, and the next lands on its beat", { skip }, async () => {
  const h = await open({ audioSpy: true, text: TIMING_FIXTURE });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  // Track when each note first lights, against the audio clock the spy sees,
  // and where the sound is at any moment.
  await h.page.evaluate(() => {
    // Where every playback source starts, on the context's own clock: the
    // audioSpy of open() watches connections, not starts, so the recorder
    // lives here, patched in before play is pressed.
    window.__sources = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset) {
      try {
        if (
          this.buffer &&
          this.buffer.duration > 2 &&
          this.context.constructor.name === "AudioContext"
        ) {
          window.__sources.push({
            ctx: this.context,
            calledAt: this.context.currentTime,
            when: when || 0,
            offset: offset || 0,
          });
        }
      } catch (e) {
        // never break playback from the spy
      }
      return start.apply(this, arguments);
    };
    window.__audioPos = function () {
      const s = window.__sources[window.__sources.length - 1];
      return s ? s.ctx.currentTime - Math.max(s.calledAt, s.when) + s.offset : null;
    };
    window.__lit = function () {
      const notes = Array.from(
        document.querySelectorAll(
          "#app [data-mdm-audio] code.language-abc svg .abcjs-note"
        )
      );
      const el = document.querySelector(
        "#app [data-mdm-audio] code.language-abc svg .abcjs-note.abcjs-note_selected"
      );
      return el ? notes.indexOf(el) : -1;
    };
    window.__onsets = {};
    setInterval(function () {
      const n = window.__lit();
      const p = window.__audioPos();
      if (n >= 0 && p !== null && !(n in window.__onsets)) window.__onsets[n] = p;
    }, 25);
  });
  await pressPlay(h.page);
  // Pause squarely inside a note, not on a wall-clock guess: a fixed sleep
  // drifts to the note boundary on a loaded machine, where every resume
  // behaviour looks alike. The watcher presses pause a third of the way into
  // the fourth note (onsets run every ~300 ms on this fixture) and reads the
  // position in the same breath, since the spy's clock keeps running while
  // paused. The onset grid is frozen HERE: anything sampled after the resume
  // could be polluted by ink lighting apart from the sound, which is the very
  // thing under test.
  const atPause = await h.page.evaluate(
    () =>
      new Promise((resolve) => {
        const timer = setInterval(() => {
          const pos = window.__audioPos();
          if (pos !== null && pos >= 1.0) {
            clearInterval(timer);
            document.querySelector(".mdm-audio .abcjs-midi-start").click();
            resolve({
              pos: window.__audioPos(),
              lit: window.__lit(),
              onsets: Object.assign({}, window.__onsets),
            });
          }
        }, 10);
      })
  );
  assert.ok(atPause.lit >= 2, "paused too early to mean anything: " + atPause.lit);
  assert.ok(atPause.pos <= 1.1, "the pause watcher slipped to the note boundary: " + atPause.pos);
  const grid = atPause.onsets;
  const spacing = grid[atPause.lit] - grid[atPause.lit - 1];
  assert.ok(spacing > 0.2 && spacing < 0.4, "the fixture's note grid moved: " + spacing);
  const nextOnset = grid[atPause.lit] + spacing;

  await new Promise((r) => setTimeout(r, 500));
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await new Promise((r) => setTimeout(r, 60));
  const gap = await h.page.evaluate(() => ({
    resumeOffset: window.__sources[window.__sources.length - 1].offset,
    muted: window.__gain ? window.__gain.gain.value : null,
    lit: window.__lit(),
    pushed: document
      .querySelector(".mdm-audio .abcjs-midi-start")
      .classList.contains("abcjs-pushed"),
  }));
  // In the gap: the sound resumed IN PLACE (never ahead: a snap forward is
  // what skipped a measure when the pause fell near a barline), the mute
  // stage holds it at zero, and no ink is lit, since the note the timer
  // reports early must wait for its beat.
  assert.equal(gap.pushed, true, "resume never started");
  assert.ok(
    Math.abs(gap.resumeOffset - atPause.pos) <= 0.06,
    "the sound did not resume in place: " +
      gap.resumeOffset.toFixed(3) +
      " vs pause at " +
      atPause.pos.toFixed(3)
  );
  assert.equal(gap.muted, 0, "the cut note's remainder is not silenced");
  assert.equal(gap.lit, -1, "ink lit during the silent gap: note " + gap.lit);

  // Past the next onset: the due note sounds and lights, and the gain is back.
  const wait = Math.max(0, (nextOnset - atPause.pos) * 1000 - 60) + 140;
  await new Promise((r) => setTimeout(r, wait));
  const landed = await h.page.evaluate(() => ({
    lit: window.__lit(),
    gain: window.__gain ? window.__gain.gain.value : null,
  }));
  assert.equal(
    landed.lit,
    atPause.lit + 1,
    "the due note did not land: ink on " + landed.lit
  );
  assert.equal(landed.gain, 1, "the gain never came back");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a scrub during the resume gap lifts the silence at once", { skip }, async () => {
  const h = await open({ audioSpy: true });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await h.page.evaluate(() => {
    window.__sources = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset) {
      try {
        if (
          this.buffer &&
          this.buffer.duration > 2 &&
          this.context.constructor.name === "AudioContext"
        ) {
          window.__sources.push({
            ctx: this.context,
            calledAt: this.context.currentTime,
            when: when || 0,
            offset: offset || 0,
          });
        }
      } catch (e) {
        // never break playback from the spy
      }
      return start.apply(this, arguments);
    };
    window.__audioPos = function () {
      const s = window.__sources[window.__sources.length - 1];
      return s ? s.ctx.currentTime - Math.max(s.calledAt, s.when) + s.offset : null;
    };
  });
  await pressPlay(h.page);
  await h.page.evaluate(
    () =>
      new Promise((resolve) => {
        const timer = setInterval(() => {
          const pos = window.__audioPos();
          if (pos !== null && pos >= 1.0) {
            clearInterval(timer);
            document.querySelector(".mdm-audio .abcjs-midi-start").click();
            resolve();
          }
        }, 10);
      })
  );
  await new Promise((r) => setTimeout(r, 300));
  // Resume and scrub in the same breath, well inside the ~150ms silent gap:
  // the seek must lift the scheduled silence itself, not wait it out, or the
  // scrubbed-to spot plays its first stretch muted.
  await h.page.evaluate(() => {
    document.querySelector(".mdm-audio .abcjs-midi-start").click();
    const track = document.querySelector(
      ".mdm-audio .abcjs-midi-progress-background"
    );
    const box = track.getBoundingClientRect();
    const x = box.x + box.width * 0.75;
    const y = box.y + box.height / 2;
    const opts = {
      button: 0,
      bubbles: true,
      pointerId: 7,
      clientX: x,
      clientY: y,
    };
    track.dispatchEvent(new PointerEvent("pointerdown", opts));
    track.dispatchEvent(new PointerEvent("pointerup", opts));
  });
  await new Promise((r) => setTimeout(r, 80));
  const out = await h.page.evaluate(() => ({
    mute: window.__gain ? window.__gain.gain.value : null,
    at: window.__audioPos(),
  }));
  assert.equal(out.mute, 1, "the scrubbed-to spot plays muted: gain " + out.mute);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The output kept awake ----------

test("opening a player wakes the output and keeps it awake; the idle minute lets it go", { skip }, async () => {
  const h = await open({ audioLife: true });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 300));
  const open1 = await h.page.evaluate(() => {
    const ctx = window.__contexts[0];
    const p = window.__pilots[0];
    return {
      contexts: window.__contexts.length,
      state: ctx && ctx.state,
      // The engine sees our context, not one of its own.
      registered:
        !!window.abcjsAudioContext &&
        window.abcjsAudioContext.destination instanceof GainNode,
      pilots: window.__pilots.length,
      hz: p && p.osc.frequency.value,
      type: p && p.osc.type,
      level: p && +p.gain.gain.value.toFixed(4),
      sink: p && p.sink,
      stopped: p && p.stopped,
      idleTimers: window.__idle.length,
    };
  });
  // One context for the session: before the Proxy was registered ahead of
  // supportsAudio(), abcjs made a second one that ran for good beside ours.
  assert.equal(open1.contexts, 1, "contexts made: " + open1.contexts);
  assert.equal(open1.state, "running");
  assert.equal(open1.registered, true, "abcjs is not on the volume graph");
  // The pilot: a sub-audible sine straight into the output, past the volume.
  assert.equal(open1.pilots, 1, "pilots started: " + open1.pilots);
  assert.equal(open1.hz, 8);
  assert.equal(open1.type, "sine");
  assert.equal(open1.level, 0.004, "pilot level " + open1.level);
  assert.equal(open1.sink, "AudioDestinationNode", "the pilot goes through " + open1.sink);
  assert.equal(open1.stopped, false);
  assert.equal(open1.idleTimers, 0, "an idle timer was set with the player open");

  // Closing the bar does not let go at once: the minute runs first.
  await clickToggle(h.page, 0);
  await new Promise((r) => setTimeout(r, 200));
  const closed = await h.page.evaluate(() => ({
    state: window.__contexts[0].state,
    stopped: window.__pilots[0].stopped,
    idleTimers: window.__idle.length,
    idleMs: window.__idle.length ? window.__idle[0].ms : null,
  }));
  assert.equal(closed.state, "running", "the output was dropped the moment the bar closed");
  assert.equal(closed.stopped, false, "the pilot stopped the moment the bar closed");
  assert.equal(closed.idleTimers, 1, "no idle timer after the last player closed");
  assert.equal(closed.idleMs, 60000);

  // The minute is up: pilot off, context suspended.
  await h.page.evaluate(() => window.__idle[0].fn());
  await h.page.waitForFunction(() => window.__contexts[0].state === "suspended", {
    timeout: 5000,
  });
  const rested = await h.page.evaluate(() => ({
    stopped: window.__pilots[0].stopped,
    pilots: window.__pilots.length,
  }));
  assert.equal(rested.stopped, true, "the pilot kept running after the idle minute");
  assert.equal(rested.pilots, 1);

  // Opening again wakes it back, on the same context, with a fresh pilot.
  await clickToggle(h.page, 1);
  await h.page.waitForFunction(() => window.__contexts[0].state === "running", {
    timeout: 5000,
  });
  await new Promise((r) => setTimeout(r, 200));
  const reopened = await h.page.evaluate(() => ({
    contexts: window.__contexts.length,
    pilots: window.__pilots.length,
    level: +window.__pilots[1].gain.gain.value.toFixed(4),
    stopped: window.__pilots[1].stopped,
  }));
  assert.equal(reopened.contexts, 1);
  assert.equal(reopened.pilots, 2, "no new pilot on reopening: " + reopened.pilots);
  assert.equal(reopened.level, 0.004);
  assert.equal(reopened.stopped, false);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a hidden webview lets the output go unless a tune is sounding, and takes it back when shown", { skip }, async () => {
  const h = await open({ audioLife: true });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await h.page.evaluate(() => {
    window.__visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      get: () => window.__visibility,
      configurable: true,
    });
    window.__setVisibility = function (v) {
      window.__visibility = v;
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
  // Hidden with the player idle: off.
  await h.page.evaluate(() => window.__setVisibility("hidden"));
  await h.page.waitForFunction(() => window.__contexts[0].state === "suspended", {
    timeout: 5000,
  });
  assert.equal(
    await h.page.evaluate(() => window.__pilots[0].stopped),
    true,
    "the pilot kept running in a hidden webview"
  );
  // Shown again with the player open: back.
  await h.page.evaluate(() => window.__setVisibility("visible"));
  await h.page.waitForFunction(() => window.__contexts[0].state === "running", {
    timeout: 5000,
  });
  assert.equal(await h.page.evaluate(() => window.__pilots.length), 2);
  // Hidden while the tune sounds: the music goes on, and so does the output.
  await pressPlay(h.page);
  await h.page.evaluate(() => window.__setVisibility("hidden"));
  await new Promise((r) => setTimeout(r, 300));
  const sounding = await h.page.evaluate(() => ({
    state: window.__contexts[0].state,
    stopped: window.__pilots[1].stopped,
    pushed: document
      .querySelector(".mdm-audio .abcjs-midi-start")
      .classList.contains("abcjs-pushed"),
  }));
  assert.equal(sounding.pushed, true);
  assert.equal(sounding.state, "running", "hiding the webview stopped a sounding tune");
  assert.equal(sounding.stopped, false);
  assert.deepEqual(h.errors, []);
  await h.close();
});


