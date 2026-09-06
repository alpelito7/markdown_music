// The player, driven in a real browser: the headphones toggle in the corner
// of every score, the bar it opens under the engraving (play, stop, repeat,
// progress, volume), the sounding notes lit on the score, the session
// volume, resume on the beat, and the output kept awake while a player is
// open. Plus the toolbar's file actions, which live in the same part of the
// old suite.
//
// The editor is CodeMirror 6 (see tests/webview/helpers.js): a score is a
// block widget `.mdm-score` placed after its source lines, which are hidden
// while no caret is in the block. "Open for editing" means a caret inside the
// block: the source shows above the widget (`.cm-line.mdm-src-line`), and the
// widget stays as the live preview, with the player bar in it.
// Run with: node --test --test-concurrency=1 tests/webview-player.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
  settingsMessage,
  postSettings,
  setSettingPosts,
} = require("./webview/helpers.js");

// Shared helpers: the score widgets in document order, and the state the
// player tests keep asserting.
async function playerState(page) {
  return page.evaluate(() => {
    const scores = Array.from(document.querySelectorAll("#app .mdm-score"));
    return {
      bars: document.querySelectorAll(".mdm-audio").length,
      widgets: document.querySelectorAll(".mdm-audio .abcjs-inline-audio").length,
      // Which score is playing. Not the block that holds the bar any more:
      // the bar is a row of the toolbar and belongs to no score. What says it
      // is the mark the block carries while its player is open, which is also
      // what lights the disc under its headphones.
      onIndex: scores.findIndex((b) => b.hasAttribute("data-mdm-audio")),
      attrs: document.querySelectorAll("[data-mdm-audio]").length,
      labels: scores.map((b) =>
        b.querySelector(".mdm-audio-toggle").getAttribute("aria-label")
      ),
    };
  });
}

async function clickToggle(page, index) {
  await page.evaluate((i) => {
    document
      .querySelectorAll("#app .mdm-score")
      [i].querySelector(".mdm-audio-toggle")
      .click();
  }, index);
}

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

// Whether a score's source is showing: a caret in the block reveals its lines
// above the widget. This is what "the block is open for editing" means now.
function sourceShowing() {
  return !!document.querySelector("#app .cm-line.mdm-src-line");
}

// Puts a caret in the first line of prose, which is what makes the document
// somebody's without opening anything: only code and maths blocks show their
// source. A reader who has put no caret anywhere is a different document, and
// what a player borrows the focus from decides what it gives back.
async function caretInProse(page) {
  const at = await page.evaluate(() => {
    const doc = window.__mdm.view.state.doc;
    let inHeader = doc.line(1).text === "---";
    for (let i = 2; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (inHeader) {
        if (line.text === "---") inHeader = false;
        continue;
      }
      if (line.text.trim() && !line.text.startsWith("```")) return line.from + 4;
    }
    return 0;
  });
  await setSelection(page, at);
}

// The audio probe the resume and seek tests measure with: where every playback
// source starts on the context's own clock (the audioSpy of open() watches
// connections, not starts, so the recorder lives in the page), which note is
// lit, where the mute stage stands, and the moment each note first lit, which
// is the tune's onset grid.
async function installAudioProbe(page) {
  await page.evaluate(() => {
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
    window.__mute = function () {
      return window.__gain ? window.__gain.gain.value : null;
    };
    window.__onsets = {};
    setInterval(function () {
      const n = window.__lit();
      const p = window.__audioPos();
      if (n >= 0 && p !== null && !(n in window.__onsets)) window.__onsets[n] = p;
    }, 25);
  });
}

// One pointer event on the track, at a fraction of its width: the pieces a
// drag is made of, for the tests that hold the head rather than drop it.
async function headEvent(page, percent, type) {
  await page.evaluate(
    (p, t) => {
      const track = document.querySelector(
        ".mdm-audio .abcjs-midi-progress-background"
      );
      const box = track.getBoundingClientRect();
      track.dispatchEvent(
        new PointerEvent(t, {
          button: 0,
          bubbles: true,
          pointerId: 7,
          clientX: box.x + box.width * p,
          clientY: box.y + box.height / 2,
        })
      );
    },
    percent,
    type
  );
}

// The head dropped at a fraction of the track, the gesture a pointer makes.
async function dropHead(page, percent) {
  await page.evaluate((p) => {
    const track = document.querySelector(
      ".mdm-audio .abcjs-midi-progress-background"
    );
    const box = track.getBoundingClientRect();
    const opts = {
      button: 0,
      bubbles: true,
      pointerId: 7,
      clientX: box.x + box.width * p,
      clientY: box.y + box.height / 2,
    };
    track.dispatchEvent(new PointerEvent("pointerdown", opts));
    track.dispatchEvent(new PointerEvent("pointerup", opts));
  }, percent);
}

// The tune's own grid, read off the primed timings: what the seek tests aim at.
async function noteGrid(page) {
  return page.evaluate(() => {
    const t = window.__mdm.player.controller.timer;
    const notes = (t.noteTimings || []).filter(
      (x) => x.midiPitches && x.midiPitches.length
    );
    return { total: t.lastMoment, onsets: notes.map((x) => x.milliseconds) };
  });
}

test("every score gets a player toggle beside the copy button; other code does not", { skip }, async () => {
  const h = await open({});
  const counts = await h.page.evaluate(() => {
    const scores = Array.from(document.querySelectorAll("#app .mdm-score"));
    // A code block that is not a score renders as lines, with its chrome
    // (language tag, copy) on the first of them.
    const others = Array.from(document.querySelectorAll("#app .mdm-chrome--code"));
    return {
      scores: scores.length,
      withToggle: scores.filter((b) => b.querySelector(".mdm-audio-toggle")).length,
      others: others.length,
      othersWithToggle: others.filter((c) => c.querySelector(".mdm-audio-toggle"))
        .length,
    };
  });
  assert.equal(counts.scores, 3);
  assert.equal(counts.withToggle, 3);
  assert.ok(counts.others >= 1, "the fixture keeps a non-score code block");
  assert.equal(counts.othersWithToggle, 0);

  // Hidden until the block is hovered, like the copy button, and then sitting
  // on its left at the same height. The chrome fades in (opacity), so that is
  // what is read.
  const spot = await h.page.evaluate(() => {
    const block = document.querySelector("#app .mdm-score");
    block.scrollIntoView({ block: "center" });
    const r = block.querySelector("code.language-abc").getBoundingClientRect();
    const chrome = block.querySelector(".mdm-chrome");
    return {
      x: r.x + r.width / 2,
      y: r.y + 8,
      hiddenBefore: getComputedStyle(chrome).opacity === "0",
    };
  });
  assert.equal(spot.hiddenBefore, true, "toggle visible without hover");
  await h.page.mouse.move(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 200));
  const boxes = await h.page.evaluate(() => {
    const block = document.querySelector("#app .mdm-score");
    const toggle = block.querySelector(".mdm-audio-toggle");
    const copy = block.querySelector(".mdm-copy");
    const t = toggle.getBoundingClientRect();
    const c = copy.getBoundingClientRect();
    return {
      visible:
        getComputedStyle(block.querySelector(".mdm-chrome")).opacity === "1" &&
        t.width > 0,
      tx: t.x,
      cx: c.x,
      // Centres, not top edges: the headphones are drawn a size larger than
      // the copy button, so their boxes no longer start at the same y.
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

// The same on the first click of a document nobody has been in yet, which is
// where it failed. A document carries a selection before anybody has put a
// caret in it, at character 0, and the rendering ignores it while the document
// is nobody's. The headphones hand the player bar the focus so that Space
// plays, and the bar lives inside the view: counted as somebody arriving, that
// untouched selection woke and the block at the top of the file came up as
// source under a caret nobody had put there. The bar keeps a document that is
// already somebody's (the second half below, and the volume and scrub tests
// further down); it does not make one somebody's.
test("the headphones of a fresh document open no source, and keep one that is open", { skip }, async () => {
  const h = await open({ text: TOP_SCORE_FIXTURE, scores: 2 });
  const fresh = await h.page.evaluate(() => ({
    source: !!document.querySelector("#app .cm-line.mdm-src-line"),
    selection: window.__mdm.view.state.selection.ranges.map((r) => [r.from, r.to]),
  }));
  assert.deepEqual(
    fresh,
    { source: false, selection: [[0, 0]] },
    "the fixture must open with the untouched caret on the score at the top"
  );
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  const opened = await h.page.evaluate(() => ({
    source: !!document.querySelector("#app .cm-line.mdm-src-line"),
    bars: document.querySelectorAll(".mdm-audio").length,
    onBar: !!document.activeElement.closest(".mdm-audio"),
  }));
  assert.deepEqual(
    opened,
    { source: false, bars: 1, onBar: true },
    "the headphones brought up the source of the block at the top of the file"
  );
  await clickToggle(h.page, 0); // close, and leave the document as it was
  await new Promise((r) => setTimeout(r, 200));
  // Closing gives back what was taken, and nobody had it: the keyboard does
  // not land in the text, where it would draw a caret at the first character
  // of the file and open the block there, which is the same bug one click
  // later.
  assert.deepEqual(
    await h.page.evaluate(() => ({
      source: !!document.querySelector("#app .cm-line.mdm-src-line"),
      bars: document.querySelectorAll(".mdm-audio").length,
      editor: window.__mdm.view.hasFocus,
    })),
    { source: false, bars: 0, editor: false },
    "closing the player put a caret in a document nobody had been in"
  );
  // The other half: with a caret really in the second score, the headphones
  // of the first must leave that block open, since the document is somebody's
  // already and the bar is not asked to say otherwise.
  const at = await posOf(h.page, "GABc", 0, 0);
  await setSelection(h.page, at);
  assert.equal(
    await h.page.evaluate(() => !!document.querySelector("#app .cm-line.mdm-src-line")),
    true,
    "a caret in the second score did not open it"
  );
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  assert.equal(
    await h.page.evaluate(() => !!document.querySelector("#app .cm-line.mdm-src-line")),
    true,
    "the player closed the source the caret was keeping open"
  );
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
    const bar = document.querySelector(".mdm-audio");
    const toolbar = document.querySelector("#app .mdm-toolbar");
    const items = toolbar.querySelectorAll(".mdm-toolbar__item");
    const last = items[items.length - 1].getBoundingClientRect();
    const box = bar.getBoundingClientRect();
    return {
      // "Expanded" used to be Vditor's open block; now it is the source
      // lines showing, which the toggle must not bring up.
      expanded: !!document.querySelector("#app .cm-line.mdm-src-line"),
      play: !!bar.querySelector(".abcjs-midi-start"),
      loop: !!bar.querySelector(".abcjs-midi-loop"),
      progress: !!bar.querySelector(".abcjs-midi-progress-background"),
      // The bar lives in the toolbar, and nothing of it is left in the text.
      inToolbar: !!bar.closest("#app .mdm-toolbar"),
      underScore: document.querySelectorAll("#app .mdm-score .mdm-audio").length,
      inContent: document.querySelectorAll(".cm-content .mdm-audio").length,
      // A row of its own, below every button, spanning the whole strip: the
      // toolbar's padding is the only thing either side of it.
      ownRow: box.top >= last.bottom - 1,
      barWidth: box.width,
      toolbarWidth: toolbar.getBoundingClientRect().width,
      // Nothing is left of the cap the old bar took from its score.
      maxWidth: bar.style.maxWidth,
      // Five controls among the document's formatting buttons: what ties
      // them together for a keyboard walking the toolbar, where the lit disc
      // says nothing.
      role: bar.getAttribute("role"),
      named: bar.getAttribute("aria-label"),
    };
  });
  assert.equal(openState.expanded, false, "opening the player expanded the block");
  assert.equal(openState.play && openState.loop && openState.progress, true);
  assert.equal(openState.inToolbar, true, "the bar did not open in the toolbar");
  assert.equal(openState.underScore, 0, "a bar was left under the score");
  assert.equal(openState.inContent, 0, "the bar is still inside the text");
  assert.equal(openState.ownRow, true, "the bar shares its line with the buttons");
  assert.equal(openState.maxWidth, "", "the bar kept a width taken from a score");
  assert.ok(
    Math.abs(openState.barWidth - openState.toolbarWidth) <= 1,
    "the bar is " + openState.barWidth + " in a toolbar of " + openState.toolbarWidth
  );
  assert.equal(openState.role, "group", "the row is not a group of its own");
  assert.equal(openState.named, "Player", "the row has no name");
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

// A score with a page of prose under it, so the block can be scrolled clean
// out of CodeMirror's viewport (where its widget is destroyed) while the tune
// goes on sounding. Four 4/4 bars of even eighths at a quarter of 100, the
// same grid the timing fixture uses: about 9.6 seconds.
const FAR_SCORE_FIXTURE = [
  "---",
  'title: "A long page"',
  "---",
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
]
  .join("\n")
  .concat(
    Array.from(
      { length: 200 },
      (_, i) => "Paragraph " + i + " of the page that runs under the score.\n"
    ).join("\n")
  );

// A score of many staff systems, taller than any pane the harness opens: what
// a seek has to move the page for. Sixty 4/4 bars at a quarter of 240, so the
// whole tune is about a minute and the engraving runs to a dozen systems.
const TALL_SCORE_FIXTURE = [
  "---",
  'title: "A tall score"',
  "---",
  "",
  "```{.abc .play}",
  "X:1",
  "M:4/4",
  "L:1/8",
  "Q:1/4=240",
  "K:C",
]
  .concat(
    Array.from({ length: 15 }, (_, i) =>
      (i % 2 ? "cBAG FEDC | GABc defg | cBAG FEDC | GABc defg |"
             : "CDEF GABc | cBAG FEDC | CDEF GABc | cBAG FEDC |")
    )
  )
  .concat(["```", ""])
  .join("\n");

// The bar carries the same headphones the corner of the score does, lit the
// same way, and they do the same thing: shut the player. Without them the
// only way out was the block's own toggle, and a block can be a page long or
// scrolled off the screen entirely, so closing what you were listening to
// meant going to look for it.
test("the bar's headphones sit by repeat, lit, and shut the player", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  const button = await h.page.evaluate(() => {
    const b = document.querySelector(".mdm-audio .mdm-audio-close");
    if (!b) return null;
    const disc = getComputedStyle(b).backgroundColor;
    const lit = getComputedStyle(
      document.querySelector("#app .mdm-score[data-mdm-audio] .mdm-audio-toggle")
    ).backgroundColor;
    return {
      label: b.getAttribute("aria-label"),
      // The transport first, then the button that puts the player away.
      after: b.previousElementSibling.className.match(/abcjs-midi-\w+/)[0],
      // Drawn like the rest of the bar's buttons: a round target of the same
      // size, its glyph in a <g> so the bar's own colour rules reach it.
      size: Math.round(b.getBoundingClientRect().width),
      glyph: getComputedStyle(b.querySelector("g")).fill,
      // Lit at rest, and lit with the same brass as the toggle on the block.
      disc: disc,
      sameAsBlock: disc === lit,
      tip: b.classList.contains("mdm-tip") && b.classList.contains("mdm-tip--s"),
    };
  });
  assert.ok(button, "the bar has no headphones of its own");
  assert.equal(button.label, "Hide player");
  assert.equal(button.after, "abcjs-midi-loop", "the headphones are not beside repeat");
  assert.equal(button.size, 24, "not the size of the bar's other buttons");
  assert.equal(button.tip, true, "no tooltip, or one drawn north");
  assert.notEqual(button.disc, "rgba(0, 0, 0, 0)", "the headphones are not lit");
  assert.equal(button.sameAsBlock, true, "lit in a different brass from the block's toggle");
  // The glyph goes to the deep brass on that disc, the way a pushed play does.
  assert.match(button.glyph, /^(rgb|color)/);
  assert.notEqual(button.glyph, "rgb(0, 0, 0)");

  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .mdm-audio-close").click()
  );
  await new Promise((r) => setTimeout(r, 300));
  const shut = await playerState(h.page);
  assert.equal(shut.bars, 0, "the headphones in the bar did not shut the player");
  assert.equal(shut.attrs, 0, "the block was left lit with no player on it");
  assert.deepEqual(shut.labels, ["Show player", "Show player", "Show player"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Scrubbing the progress bar is a way of moving through the score, so the
// page follows the head: dropping it halfway through a page-long score puts
// the music on a system that may be nowhere near the pane, and a reader left
// listening to something they cannot see is the same complaint the bar was
// moved for. A tune left to play is followed too, at the crossing from one
// staff system to the next, which is the test under this one.
test("a seek brings the pane to the part that is sounding", { skip }, async () => {
  const h = await open({ text: TALL_SCORE_FIXTURE, scores: 1 });
  await h.page.setViewport({ width: 900, height: 520 });
  await new Promise((r) => setTimeout(r, 500));
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 20000 }
  );
  const geom = await h.page.evaluate(() => {
    const sc = window.__mdm.view.scrollDOM;
    sc.scrollTop = 0;
    return {
      score: Math.round(
        document.querySelector("#app code.language-abc svg").getBoundingClientRect().height
      ),
      pane: Math.round(sc.getBoundingClientRect().height),
    };
  });
  assert.ok(
    geom.score > geom.pane * 1.5,
    "the fixture is not tall enough to have to scroll: " + geom.score + " in " + geom.pane
  );
  // A drag of the head to a fraction of the tune, released there.
  const seekTo = async (percent) => {
    const at = await h.page.evaluate((p) => {
      const b = document
        .querySelector(".mdm-audio .abcjs-midi-progress-background")
        .getBoundingClientRect();
      return { x: b.left + b.width * p, y: b.top + b.height / 2 };
    }, percent);
    await h.page.mouse.move(at.x, at.y);
    await h.page.mouse.down();
    await h.page.mouse.move(at.x + 1, at.y);
    await h.page.mouse.up();
    await new Promise((r) => setTimeout(r, 900));
    return h.page.evaluate(() => {
      const pane = window.__mdm.view.scrollDOM.getBoundingClientRect();
      const line = document.querySelector("#app .mdm-play-cursor");
      const b = line && line.getBoundingClientRect();
      return {
        scroll: Math.round(window.__mdm.view.scrollDOM.scrollTop),
        drawn: !!line,
        // Wholly inside the pane, which is what "brought on screen" means.
        onScreen: !!b && b.top >= pane.top - 1 && b.bottom <= pane.bottom + 1,
      };
    });
  };
  const far = await seekTo(0.9);
  assert.equal(far.drawn, true, "the seek drew no cursor to follow");
  assert.ok(far.scroll > geom.pane, "the page did not follow the head: " + far.scroll);
  assert.equal(far.onScreen, true, "the head was left off the pane");
  const back = await seekTo(0.1);
  assert.ok(
    back.scroll < far.scroll - 100,
    "the page did not come back with the head: " + far.scroll + " -> " + back.scroll
  );
  assert.equal(back.onScreen, true, "the head was left off the pane on the way back");
  // A head already on the pane leaves the page alone. Read by nudging the
  // page off the middle first, so that a rule which centred every seek would
  // have something to snap back to: without the guard the score would slide
  // under the reader on every move of a scrub inside one system.
  await h.page.evaluate(() => {
    window.__mdm.view.scrollDOM.scrollTop += 40;
  });
  await new Promise((r) => setTimeout(r, 200));
  const nudged = await h.page.evaluate(() =>
    Math.round(window.__mdm.view.scrollDOM.scrollTop)
  );
  const again = await seekTo(0.1);
  assert.equal(
    again.onScreen,
    true,
    "the nudge alone took the head off the pane: the case is not being read"
  );
  assert.ok(
    Math.abs(again.scroll - nudged) <= 2,
    "a seek to where the head already was pulled the page back: " +
      nudged +
      " -> " +
      again.scroll
  );
  // A seek made with the keyboard sends no pointermove, so here it is the
  // landing of the seek and not the drag that has to bring the page. Six
  // PageUps, a tenth of the tune each, walk the head from a tenth to about
  // seven tenths, which on this fixture is several systems down. Not End: it
  // parks the clock on the total, where the cursor is deliberately not drawn
  // (a finished tune is not standing anywhere), so there would be nothing to
  // bring on screen.
  await h.page.evaluate(() => {
    const track = document.querySelector(".mdm-audio .abcjs-midi-progress-background");
    track.focus();
    for (let i = 0; i < 6; i++) {
      track.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 1200));
  const ended = await h.page.evaluate(() => {
    const pane = window.__mdm.view.scrollDOM.getBoundingClientRect();
    const b = document.querySelector("#app .mdm-play-cursor");
    return {
      scroll: Math.round(window.__mdm.view.scrollDOM.scrollTop),
      onScreen: !!b && b.getBoundingClientRect().top >= pane.top - 1 &&
        b.getBoundingClientRect().bottom <= pane.bottom + 1,
    };
  });
  assert.ok(
    ended.scroll > again.scroll + 100,
    "the keyboard seek did not bring the page down: " +
      again.scroll +
      " -> " +
      ended.scroll
  );
  assert.equal(ended.onScreen, true, "the keyboard seek left the head off the pane");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The same complaint the seek answers, arrived at by waiting instead of by
// dragging: a tune left to play walks the cursor down the engraving, and on a
// page-long score it walks clean off the pane, so what is sounding cannot be
// seen. The page keeps the head on the pane now, and keeps it there whenever
// it leaves: while the music walks along one staff system the head does not
// move down the page and nothing is scrolled, so a score that fits the pane
// is never touched, and a page taken away from the music comes back at once
// rather than at the end of the line. It was the crossing alone until the
// toolbar toggle arrived, and waiting a line of music to see what is sounding
// is what the toggle made unnecessary: a reader who wants the page turns
// following off.
test("a tune left to play keeps the head on the pane, and a pause hands it back", { skip }, async () => {
  const h = await open({ text: TALL_SCORE_FIXTURE, scores: 1 });
  await h.page.setViewport({ width: 900, height: 520 });
  await new Promise((r) => setTimeout(r, 500));
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 20000 }
  );
  await h.page.evaluate(() => {
    window.__mdm.view.scrollDOM.scrollTop = 0;
  });
  const onScreen = () =>
    h.page.evaluate(() => {
      const pane = window.__mdm.view.scrollDOM.getBoundingClientRect();
      const line = document.querySelector("#app .mdm-play-cursor");
      const b = line && line.getBoundingClientRect();
      return {
        scroll: Math.round(window.__mdm.view.scrollDOM.scrollTop),
        drawn: !!line,
        onScreen: !!b && b.top >= pane.top - 1 && b.bottom <= pane.bottom + 1,
      };
    });
  await pressPlay(h.page);
  // Waited for rather than timed: the fixture is a minute of music over a
  // dozen systems, and how long the first crossing takes is the tempo's
  // business, not the test's.
  await h.page.waitForFunction(
    () => window.__mdm.view.scrollDOM.scrollTop > 20,
    { timeout: 30000 }
  );
  const moved = await onScreen();
  assert.equal(moved.drawn, true, "the tune is playing with no cursor to follow");
  assert.equal(moved.onScreen, true, "the page moved and left the head off the pane");
  // The next turn, waited for so that what follows begins where a system
  // does: the music has a whole line to walk before it crosses again, which
  // is the window the two parks below are read in.
  await h.page.waitForFunction(
    (from) => Math.round(window.__mdm.view.scrollDOM.scrollTop) !== from,
    { timeout: 30000 },
    moved.scroll
  );
  // The page taken away mid-line comes straight back. Parked a whole pane past
  // the music, so the head is off the pane, and read within the window the
  // wait above opened: the music has a line to walk before it crosses again,
  // so a follow held to the crossing would leave the page parked for seconds.
  const park = () =>
    h.page.evaluate(() => {
      const sc = window.__mdm.view.scrollDOM;
      sc.scrollTop += sc.getBoundingClientRect().height;
      return Math.round(sc.scrollTop);
    });
  const parked = await park();
  const off = await onScreen();
  assert.equal(
    off.onScreen,
    false,
    "the park left the head on the pane: the case is not being read"
  );
  await new Promise((r) => setTimeout(r, 700));
  const back = await onScreen();
  assert.equal(back.onScreen, true, "the head was left off the pane");
  assert.ok(
    Math.abs(back.scroll - parked) > 2,
    "the page was left where it was parked, a line of music from the head: " +
      parked +
      " -> " +
      back.scroll
  );
  // Paused, the reader has the page for good: a stopped clock walks nowhere,
  // and nothing else may move the page either.
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await new Promise((r) => setTimeout(r, 300));
  const stopped = await park();
  await new Promise((r) => setTimeout(r, 1500));
  const held = await onScreen();
  assert.equal(held.drawn, true, "the pause took the cursor away");
  assert.ok(
    Math.abs(held.scroll - stopped) <= 2,
    "the page moved under a paused tune: " + stopped + " -> " + held.scroll
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A short score, one staff system and no crossing anywhere in it, with prose
// on both sides of it: whatever moves the page around this one was the press
// of play and not a page turn. The run-out matters as much as the run-up. With
// the score at the end of the document there is nowhere to scroll to (the
// bottom padding gives about 50px, measured), so a reader who walks away from
// it cannot be drawn, and a test of that would pass whatever the rule was.
const ONE_SYSTEM_FIXTURE = ["---", 'title: "One system"', "---", ""]
  .concat(
    Array.from({ length: 25 }, (_, i) => "Paragraph " + (i + 1) + " of the run-up.\n")
  )
  .concat([
    "```{.abc .play}",
    "X:1",
    "M:4/4",
    "L:1/8",
    "Q:1/4=100",
    "K:C",
    "CDEF GABc | cBAG FEDC |",
    "```",
    "",
  ])
  .concat(
    Array.from({ length: 25 }, (_, i) => "Paragraph " + (i + 1) + " of the run-out.\n")
  )
  .join("\n");

// Where the head stands against the pane, and where the page is.
function headPlace(page) {
  return page.evaluate(() => {
    const sc = window.__mdm.view.scrollDOM;
    const pane = sc.getBoundingClientRect();
    const line = document.querySelector("#app .mdm-play-cursor");
    const box = line && line.getBoundingClientRect();
    return {
      scroll: Math.round(sc.scrollTop),
      drawn: !!line,
      onScreen: !!box && box.top >= pane.top - 1 && box.bottom <= pane.bottom + 1,
    };
  });
}

// The system a tune starts on was taken as read: a press of play moved
// nothing, and the page came to the music only at the crossing to the second
// system. Which is right while the score is in front of the reader and wrong
// when it is not: a tune started with its engraving under the fold sounded
// with nothing to see, for as long as a line of music lasts, and on a score
// of one system for the whole of it. The rule is the same one the follow
// keeps everywhere now, and needs no case of its own: the head belongs on the
// pane, so a play that leaves it off the pane brings the page to it. Read on
// a score of one staff system, where no crossing can be the thing that moved
// the page.
test("a play made with the score under the fold brings the page to the head", { skip }, async () => {
  const h = await open({ text: ONE_SYSTEM_FIXTURE, scores: 1 });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 20000 }
  );
  await h.page.setViewport({ width: 900, height: 520 });
  await new Promise((r) => setTimeout(r, 500));
  // The top of the engraving 30px above the bottom edge: the block is on the
  // pane and the staff it draws is not, which is the case a reader meets by
  // scrolling down to a score and pressing play as it comes into sight.
  const parked = await h.page.evaluate(() => {
    const sc = window.__mdm.view.scrollDOM;
    const block = document.querySelector("#app .mdm-score");
    sc.scrollTop +=
      block.getBoundingClientRect().top - (sc.getBoundingClientRect().bottom - 30);
    return Math.round(sc.scrollTop);
  });
  await new Promise((r) => setTimeout(r, 300));
  await pressPlay(h.page);
  await h.page.waitForFunction(
    (from) => Math.round(window.__mdm.view.scrollDOM.scrollTop) !== from,
    { timeout: 15000 },
    parked
  );
  const seen = await headPlace(h.page);
  assert.equal(seen.drawn, true, "the tune is sounding with no head to show");
  assert.equal(seen.onScreen, true, "the page moved and left the head off the pane");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The tall score with prose either side of it. TALL_SCORE_FIXTURE opens on its
// engraving, so there is nothing above it to scroll and it cannot be put under
// the fold at all: a park written against it moves the page by nothing and the
// test that follows would pass whatever the rule was (measured: scrollTop 0
// before and after).
const TALL_RUNUP_FIXTURE = ["---", 'title: "A tall score, read down to"', "---", ""]
  .concat(
    Array.from({ length: 25 }, (_, i) => "Paragraph " + (i + 1) + " of the run-up.\n")
  )
  .concat(TALL_SCORE_FIXTURE.split("\n").slice(4))
  .concat(
    Array.from({ length: 10 }, (_, i) => "Paragraph " + (i + 1) + " of the run-out.\n")
  )
  .join("\n");

// The same tall score at a crawl: a quarter every second and a half, so a
// staff system lasts tens of seconds and a reading taken within a second of a
// scroll cannot be a crossing in disguise. Prose either side, so the score can
// be put wherever on the pane the test wants it.
const SLOW_TALL_FIXTURE = ["---", 'title: "A tall score, slowly"', "---", ""]
  .concat(
    Array.from({ length: 25 }, (_, i) => "Paragraph " + (i + 1) + " of the run-up.\n")
  )
  .concat(["```{.abc .play}", "X:1", "M:4/4", "L:1/8", "Q:1/4=40", "K:C"])
  .concat(
    Array.from({ length: 12 }, (_, i) =>
      i % 2
        ? "cBAG FEDC | GABc defg | cBAG FEDC | GABc defg |"
        : "CDEF GABc | cBAG FEDC | CDEF GABc | cBAG FEDC |"
    )
  )
  .concat(["```", ""])
  .concat(
    Array.from({ length: 10 }, (_, i) => "Paragraph " + (i + 1) + " of the run-out.\n")
  )
  .join("\n");

// What counts as the head being in the reader's sight, which is the one thing
// the follow reads before it decides to move anything: the staff system that
// is sounding, showing whole. Not "with room to spare at both edges", which is
// what it used to ask for and which took a system resting a dozen pixels off
// an edge, perfectly readable, and threw the page half a pane to centre it.
// The band read here is the cursor's own box, the reach of the whole staff
// group, so on this duet-less score it is the one staff and on a duet it would
// be both.
test("a system showing whole is left where it is, however near an edge", { skip }, async () => {
  const h = await open({ text: SLOW_TALL_FIXTURE, scores: 1 });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 20000 }
  );
  await h.page.setViewport({ width: 900, height: 520 });
  await new Promise((r) => setTimeout(r, 500));
  await h.page.evaluate(() => {
    const sc = window.__mdm.view.scrollDOM;
    sc.scrollTop = sc.scrollHeight;
  });
  await new Promise((r) => setTimeout(r, 400));
  await pressPlay(h.page);
  await h.page.waitForFunction(
    () => document.querySelector("#app .mdm-play-cursor"),
    { timeout: 20000 }
  );
  await new Promise((r) => setTimeout(r, 800));

  // Places the sounding band `gap` pixels clear of the pane's bottom edge: a
  // positive gap leaves it whole on the pane, a negative one hangs it over.
  const place = (gap) =>
    h.page.evaluate((g) => {
      const sc = window.__mdm.view.scrollDOM;
      const pane = sc.getBoundingClientRect();
      const box = document.querySelector("#app .mdm-play-cursor").getBoundingClientRect();
      sc.scrollTop += box.bottom - (pane.bottom - g);
      return Math.round(sc.scrollTop);
    }, gap);
  const read = () =>
    h.page.evaluate(() => {
      const sc = window.__mdm.view.scrollDOM;
      const pane = sc.getBoundingClientRect();
      const line = document.querySelector("#app .mdm-play-cursor");
      const box = line && line.getBoundingClientRect();
      return {
        scroll: Math.round(sc.scrollTop),
        whole: !!box && box.top >= pane.top - 1 && box.bottom <= pane.bottom + 1,
        clearOfBottom: box ? Math.round(pane.bottom - box.bottom) : null,
      };
    });

  // Six pixels off the bottom edge: inside the 24 the old rule wanted, and
  // whole on the pane, so nothing may move.
  const near = await place(6);
  await new Promise((r) => setTimeout(r, 700));
  const held = await read();
  assert.equal(held.whole, true, "the band is not whole on the pane: the case is not being read");
  assert.ok(
    held.clearOfBottom < 24,
    "the band is not near enough the edge to read the case: " + held.clearOfBottom
  );
  assert.ok(
    Math.abs(held.scroll - near) <= 2,
    "the page moved under a system that was showing whole: " + near + " -> " + held.scroll
  );

  // And hung over the edge, it is brought back.
  const over = await place(-14);
  await h.page.waitForFunction(
    (from) => Math.round(window.__mdm.view.scrollDOM.scrollTop) !== from,
    { timeout: 15000 },
    over
  );
  const brought = await read();
  assert.equal(brought.whole, true, "the band was left hanging over the edge");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The page keeping up with the music is right until it is not: a score can be
// longer than the pane and worth listening to while the document around it is
// read, and there was no way to ask for that. The toolbar toggle is the whole
// of the choice, on by default, and off it means the music never moves the
// page: not at a crossing, not at a play made with the score under the fold,
// and not at a scrub of the progress bar either, which is one rule with no
// exceptions to remember. In the toolbar and not in the player row, since it
// says what the editor does with a tune rather than what this tune is doing,
// and it can be set before a player is open at all.
test("the follow button says what the page does, and a press asks for the other", { skip }, async () => {
  const h = await open({ text: ONE_SYSTEM_FIXTURE, scores: 1 });
  const state = () =>
    h.page.evaluate(() => {
      const b = document.querySelector('#app button[data-type="mdm-follow"]');
      return b && { lit: b.classList.contains("mdm-btn--on"), label: b.getAttribute("aria-label") };
    });
  const on = await state();
  assert.ok(on, "the transport carries no follow button");
  assert.equal(on.lit, true, "the page follows by default and the button does not say so");
  await h.page.evaluate(() =>
    document.querySelector('#app button[data-type="mdm-follow"]').click()
  );
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "followMusic", value: "still" },
  ]);
  // The button paints itself from what the host sends back, the way every
  // other toggle of this editor does.
  assert.equal((await state()).lit, true, "the button lit itself before the host answered");
  await postSettings(h.page, { followMusic: "still" });
  await new Promise((r) => setTimeout(r, 300));
  const off = await state();
  assert.equal(off.lit, false, "the setting came back and the button kept its disc");
  assert.notEqual(off.label, on.label, "the button says the same thing either way");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("with the follow off a tune plays on and the page is the reader's", { skip }, async () => {
  // The tall score with a run-up, so it can be put under the fold, and where
  // the music crosses from one staff system to the next every couple of
  // seconds: with the follow on, the press alone would bring the page to the
  // head, and each crossing after it would turn the page again.
  const h = await open({
    text: TALL_RUNUP_FIXTURE,
    scores: 1,
    seed: { settings: { followMusic: "still" } },
  });
  // The player is opened on the tall window the harness makes, before the pane
  // is shrunk: at 520 the score is past the end of what CodeMirror renders and
  // there is no toggle in the document to click.
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 20000 }
  );
  await h.page.setViewport({ width: 900, height: 520 });
  await new Promise((r) => setTimeout(r, 500));
  // Down to the run-out first: at 520 with the page at the top, the score is
  // past what CodeMirror renders and there is no widget to measure. From the
  // foot of the document it is one screen up, well inside the margin.
  await h.page.evaluate(() => {
    const sc = window.__mdm.view.scrollDOM;
    sc.scrollTop = sc.scrollHeight;
  });
  await new Promise((r) => setTimeout(r, 400));
  // Parked with the engraving under the fold, which with the follow on is the
  // press that brings the page to the head.
  const parked = await h.page.evaluate(() => {
    const sc = window.__mdm.view.scrollDOM;
    const block = document.querySelector("#app .mdm-score");
    sc.scrollTop +=
      block.getBoundingClientRect().top - (sc.getBoundingClientRect().bottom - 30);
    return Math.round(sc.scrollTop);
  });
  const under = await h.page.evaluate(() => {
    const sc = window.__mdm.view.scrollDOM;
    const pane = sc.getBoundingClientRect();
    return document.querySelector("#app .mdm-score").getBoundingClientRect().top >
      pane.bottom - 60;
  });
  assert.equal(under, true, "the score was not put under the fold: the park did nothing");
  await new Promise((r) => setTimeout(r, 300));
  await pressPlay(h.page);
  // Long enough for several crossings at this tempo, and long past the press
  // itself, which with the follow on is the first thing that would move it.
  await new Promise((r) => setTimeout(r, 6000));
  const after = await h.page.evaluate(() => ({
    scroll: Math.round(window.__mdm.view.scrollDOM.scrollTop),
    sounding: document
      .querySelector(".mdm-audio .abcjs-midi-start")
      .classList.contains("abcjs-pushed"),
  }));
  assert.equal(after.sounding, true, "the tune stopped before the reading");
  assert.ok(
    Math.abs(after.scroll - parked) <= 2,
    "the music moved the page with the follow off: " + parked + " -> " + after.scroll
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The whole reason the bar moved. A score can be a page long (duet.mdm is),
// and the bar used to sit at its foot: playing meant scrolling to the bottom,
// pressing play and scrolling back up to read what was sounding. In the
// toolbar it is there whatever the reader is looking at, the block gone from
// the viewport included, which is where CodeMirror has thrown the widget away
// and there is no score on screen at all.
test("the bar stays in reach with its score scrolled out of the viewport", { skip }, async () => {
  // The follow seeded off, because with it on the reader cannot leave a
  // sounding score behind at all: the page comes back to the head the frame
  // after it is scrolled, so the widget is never thrown away and the case
  // this reads does not arise. Reading past a playing score is what the
  // toggle is for, and this is that reader.
  const h = await open({
    text: FAR_SCORE_FIXTURE,
    scores: 1,
    seed: { settings: { followMusic: "still" } },
  });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  await pressPlay(h.page);
  // Down to the foot of the page, far past the margin CodeMirror renders
  // beyond the viewport: the score's widget goes, and with it the lit disc.
  await h.page.evaluate(() => {
    const s = window.__mdm.view.scrollDOM;
    s.scrollTop = s.scrollHeight;
  });
  await h.page.waitForFunction(
    () => document.querySelectorAll("#app [data-mdm-audio]").length === 0,
    { timeout: 15000 }
  );
  const away = await h.page.evaluate(() => {
    const bar = document.querySelector("#app .mdm-toolbar .mdm-audio");
    const play = bar && bar.querySelector(".abcjs-midi-start");
    const box = play.getBoundingClientRect();
    return {
      bars: document.querySelectorAll(".mdm-audio").length,
      inToolbar: !!bar,
      scores: document.querySelectorAll("#app .mdm-score").length,
      pushed: play.classList.contains("abcjs-pushed"),
      // Reachable with nothing scrolled to: the point on the play button
      // really is the play button.
      onButton: play.contains(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      ),
      // Where the tune has got to. Not the clock, which is whole seconds and
      // would read 0:00 through the whole of a short wait: this is the
      // property the editor writes on every move of the head (paint, in
      // makeProgressDraggable), which the synth's timer drives whether or not
      // the score is on screen.
      progress: getComputedStyle(
        bar.querySelector(".abcjs-midi-progress-background")
      ).getPropertyValue("--mdm-progress"),
    };
  });
  assert.equal(away.scores, 0, "the score's widget is still rendered");
  assert.equal(away.bars, 1, "the bar went with the widget");
  assert.equal(away.inToolbar, true);
  assert.equal(away.pushed, true, "the tune stopped when its score left the view");
  assert.equal(away.onButton, true, "the play button cannot be pointed at");
  await new Promise((r) => setTimeout(r, 700));
  const later = await h.page.evaluate(() =>
    getComputedStyle(
      document.querySelector(".mdm-audio .abcjs-midi-progress-background")
    ).getPropertyValue("--mdm-progress")
  );
  assert.notEqual(later, away.progress, "the tune stood still off screen");
  assert.ok(parseFloat(later) > 0, "the head never left the top: " + later);
  // And stop still reaches it from up there.
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .mdm-audio-stop").click()
  );
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(
    await h.page.evaluate(() =>
      document
        .querySelector(".mdm-audio .abcjs-midi-start")
        .classList.contains("abcjs-pushed")
    ),
    false,
    "stop did not reach the tune from the toolbar"
  );
  // Back up, and the block takes its mark again.
  await h.page.evaluate(() => {
    window.__mdm.view.scrollDOM.scrollTop = 0;
  });
  await h.page.waitForFunction(
    () => document.querySelectorAll("#app [data-mdm-audio]").length === 1,
    { timeout: 15000 }
  );
  assert.deepEqual((await playerState(h.page)).labels, ["Hide player"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The row is as wide as the pane, and it stays that way while the pane is
// dragged: the track is a flex child that absorbs what is left, and the parts
// that cannot shrink are given up in a stated order rather than pushing the
// row past the edge. The pane widths below are read as the webview's own,
// which is what a VS Code editor group is.
test("the player row follows the width of the pane, and sheds its parts in order", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  for (const width of [1400, 1000, 800, 620, 480, 400, 360, 300, 260]) {
    await h.page.setViewport({ width, height: 1000 });
    await new Promise((r) => setTimeout(r, 250));
    const seen = await h.page.evaluate(() => {
      const bar = document.querySelector(".mdm-audio");
      const toolbar = document.querySelector("#app .mdm-toolbar");
      const track = bar.querySelector(".abcjs-midi-progress-background");
      const hit = (el) => {
        const r = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        );
      };
      const shown = (sel) => {
        const el = bar.querySelector(sel);
        return !!el && getComputedStyle(el).display !== "none";
      };
      return {
        bar: bar.getBoundingClientRect().width,
        toolbar: toolbar.getBoundingClientRect().width,
        track: track.offsetWidth,
        left: Math.round(bar.getBoundingClientRect().left),
        right: Math.round(bar.getBoundingClientRect().right),
        overflow: bar.scrollWidth - bar.clientWidth,
        play: hit(bar.querySelector(".abcjs-midi-start")),
        stop: hit(bar.querySelector(".mdm-audio-stop")),
        loop: hit(bar.querySelector(".abcjs-midi-loop")),
        slider: shown('.mdm-audio-vol input[type="range"]'),
        clock: shown(".abcjs-midi-clock"),
        volume: shown(".mdm-audio-vol"),
      };
    });
    const at = " at a pane of " + width + "px";
    assert.ok(
      Math.abs(seen.bar - seen.toolbar) <= 1,
      "the bar is " + seen.bar + " in a toolbar of " + seen.toolbar + at
    );
    // The row's own box, and not the page's scrollWidth: CodeMirror's content
    // overhangs its scroller by a few pixels at narrow widths, which has
    // nothing to do with the toolbar and would fail this on its behalf.
    assert.equal(seen.left, 0, "the row does not start at the edge of the pane" + at);
    assert.ok(seen.right <= width + 1, "the row runs past the pane, to " + seen.right + at);
    assert.ok(seen.overflow <= 1, "the row overflows itself" + at);
    assert.ok(seen.track >= 44, "the track is only " + seen.track + "px" + at);
    assert.equal(seen.play && seen.stop && seen.loop, true, "a transport button cannot be pointed at" + at);
    // What goes, and in what order: the volume slider first (the mute stays,
    // since the level is a setting of the session and silence is not), then
    // the clock, then the volume group whole. Play, stop, repeat and the
    // track never go.
    assert.equal(seen.slider, width > 380, "the volume slider is on the wrong side of its threshold" + at);
    assert.equal(seen.clock, width > 320, "the clock is on the wrong side of its threshold" + at);
    assert.equal(seen.volume, width > 260, "the volume group is on the wrong side of its threshold" + at);
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The outline panel is a column inside the body, below the toolbar, so it
// takes its width from the text and never from the row. Worth pinning: the
// obvious wrong build of this feature puts the row in the body, where the
// panel would push it about.
test("the outline panel narrows the text, not the player row", { skip }, async () => {
  const h = await open({
    seed: { settings: { outline: "shown", outlineWidth: 260 } },
  });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  const seen = await h.page.evaluate(() => {
    const bar = document.querySelector(".mdm-audio").getBoundingClientRect();
    return {
      open: document.getElementById("app").classList.contains("mdm-outline--open"),
      panel: document.querySelector("#app .mdm-outline").getBoundingClientRect().width,
      bar: bar.width,
      toolbar: document.querySelector("#app .mdm-toolbar").getBoundingClientRect().width,
      editor: document.querySelector("#app .mdm-editor").getBoundingClientRect().width,
      // Nothing of the panel is under the left end of the row.
      clear: !document
        .elementFromPoint(bar.x + 4, bar.y + bar.height / 2)
        .closest(".mdm-outline"),
    };
  });
  assert.equal(seen.open, true, "the fixture did not open the outline");
  assert.ok(seen.panel > 200, "the panel is only " + seen.panel + "px");
  assert.ok(
    Math.abs(seen.bar - seen.toolbar) <= 1,
    "the outline took width from the bar: " + seen.bar + " of " + seen.toolbar
  );
  assert.ok(
    seen.editor < seen.toolbar - 200,
    "the panel did not narrow the text: " + seen.editor + " of " + seen.toolbar
  );
  assert.equal(seen.clear, true, "the panel sits over the player row");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The row is chrome, and chrome takes its room from the pane: the toolbar
// grows by the height of the row and the text moves down with it, then comes
// back up when the player closes. What must NOT move is the reader's place in
// the document. The scroller was nudged by the row's height once, so that the
// page did not move at all; that held the pixels still by spending the text
// under them, and the row came down over the line and a half that had been at
// the top of the pane. So the two readings here are opposite on purpose: the
// scroll position is pinned to the pixel, and the score is required to have
// moved down by exactly what the toolbar gained. Read on a document long
// enough to have room to scroll.
test("the row takes its room from the pane, and hides no text taking it", { skip }, async () => {
  const h = await open({ text: FAR_SCORE_FIXTURE, scores: 1 });
  await h.page.evaluate(() => {
    window.__mdm.view.scrollDOM.scrollTop = 120;
  });
  await new Promise((r) => setTimeout(r, 200));
  const read = () =>
    h.page.evaluate(() => {
      const score = document.querySelector("#app .mdm-score");
      return {
        toolbar: document.querySelector("#app .mdm-toolbar").getBoundingClientRect().height,
        top: score ? Math.round(score.getBoundingClientRect().top) : null,
        scroll: Math.round(window.__mdm.view.scrollDOM.scrollTop),
        rows: document.querySelectorAll("#app .mdm-toolbar .mdm-audio").length,
      };
    });
  const idle = await read();
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  const open1 = await read();
  assert.equal(open1.rows, 1);
  const grew = open1.toolbar - idle.toolbar;
  assert.ok(grew > 20, "the toolbar did not grow a row: " + idle.toolbar + " -> " + open1.toolbar);
  // The reader's place in the document, which is the thing the row must not
  // spend. A scroller nudged to hold the page still shows here as a jump of
  // exactly `grew`.
  assert.equal(
    open1.scroll,
    idle.scroll,
    "opening the player scrolled the document: " + idle.scroll + " -> " + open1.scroll
  );
  // And the text really did move down, by the room the row took and no more:
  // that is what says the row is above the text rather than over it.
  assert.ok(
    Math.abs(open1.top - idle.top - grew) <= 1,
    "the text did not follow the toolbar: " +
      idle.top +
      " -> " +
      open1.top +
      " for a row of " +
      grew
  );
  await clickToggle(h.page, 0);
  await new Promise((r) => setTimeout(r, 300));
  const shut = await read();
  assert.equal(shut.rows, 0, "the row outlived the player");
  assert.equal(
    await h.page.evaluate(() => document.querySelectorAll(".mdm-audio").length),
    0,
    "the bar was hidden rather than taken away"
  );
  assert.equal(shut.toolbar, idle.toolbar, "the toolbar kept the room the row had");
  assert.equal(
    shut.scroll,
    idle.scroll,
    "closing the player scrolled the document: " + idle.scroll + " -> " + shut.scroll
  );
  assert.ok(
    Math.abs(shut.top - idle.top) <= 1,
    "the text did not come back up: " + idle.top + " -> " + shut.top
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Using the player must not put the document away, and must not stop it from
// being put away either. The bar left the editor's own DOM when it moved into
// the toolbar, so both halves of that are held up by rules written for it by
// name: the .mdm-audio exemption in dismissFromOutside, the bar's clause in
// somebodyInside, and a pair of focus listeners on the bar, without which the
// focus LEAVING it is seen by nobody and the document stays somebody's for
// good (measured before they were added: with a player open, a click on the
// bare strip of the toolbar left the heading marks showing).
test("the player keeps the document somebody's, and lets it be put away", { skip }, async () => {
  const h = await open({});
  // A caret in a heading, whose marks are shown while somebody is in the
  // document and hidden when nobody is.
  const at = await posOf(h.page, "## ", 3, 0);
  await setSelection(h.page, at);
  await new Promise((r) => setTimeout(r, 250));
  const heading = () =>
    h.page.evaluate(() => {
      const line = Array.from(
        document.querySelectorAll("#app .cm-content .cm-line")
      ).find((l) => /^##\s|^From /.test(l.textContent));
      return {
        marks: line ? line.textContent.slice(0, 2) === "##" : null,
        focused: window.__mdm.view.hasFocus,
        onBar: !!(document.activeElement.closest &&
          document.activeElement.closest(".mdm-audio")),
      };
    });
  const before = await heading();
  assert.equal(before.marks, true, "the fixture must open its heading marks");
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  const held = await heading();
  assert.equal(held.onBar, true, "the headphones did not hand the bar the focus");
  assert.equal(held.focused, false, "the text kept the focus");
  assert.equal(
    held.marks,
    true,
    "opening the player put the document away: its marks went with it"
  );
  // The bare strip of the toolbar, past the last button: a press out there is
  // somebody leaving, player or no player.
  const bare = await h.page.evaluate(() => {
    const items = document.querySelectorAll("#app .mdm-toolbar__item");
    const last = items[items.length - 1].getBoundingClientRect();
    return { x: last.right + 40, y: last.top + last.height / 2 };
  });
  await h.page.mouse.click(bare.x, bare.y);
  await new Promise((r) => setTimeout(r, 400));
  const away = await heading();
  assert.equal(away.onBar, false, "the bar kept the focus a click took away");
  assert.equal(
    away.marks,
    false,
    "the document could not be put away while a player was open"
  );
  // The player is still there, and still the player: putting the document
  // away is not closing it.
  assert.equal(
    await h.page.evaluate(
      () => document.querySelectorAll("#app .mdm-toolbar .mdm-audio").length
    ),
    1,
    "the click closed the player"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The headphones name what the click leads to, "Show player" and "Hide
// player", so the label flips under a pointer that has not moved. The tooltip
// is put away by the click and comes back when the pointer leaves and
// returns, the manners the toolbar has had since the Vditor days: showing the
// new text at once would read as a flicker under a resting pointer, and it
// says nothing the lit disc of the block does not say already. Only a pointer
// click has anything to put away, which is why the rest of this file, which
// clicks the toggle from script, never meets this.
//
// Read on the SECOND score with a player already open on the first, and that
// is the whole reason the setup is not the obvious one: the row the player
// takes in the toolbar comes out of the pane, so the FIRST player opened
// moves every block down by the height of the row and the toggle leaves the
// pointer, which fires the mouseleave that brings the tooltip back and makes
// the case unreadable. Switching an open player from one score to another
// swaps one row for another in the same task, so the toolbar keeps its height
// and nothing moves: a pointer resting on the toggle is still resting on it
// after the click, which is the state this test is about.
test("a click on the headphones puts its tooltip away until the pointer leaves", { skip }, async () => {
  const h = await open({});
  await clickToggle(h.page, 0); // from script: no pointer, nothing to put away
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
    { timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 200));
  // The chrome of a score is drawn at opacity 0 and shown on hover.
  const spot = await h.page.evaluate(() => {
    const score = document.querySelectorAll("#app .mdm-score")[1];
    score.scrollIntoView({ block: "center" });
    const s = score.getBoundingClientRect();
    const r = score.querySelector(".mdm-audio-toggle").getBoundingClientRect();
    return {
      block: { x: s.x + s.width / 2, y: s.y + Math.min(30, s.height / 2) },
      button: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
    };
  });
  const read = () =>
    h.page.evaluate(() => {
      const btn = document
        .querySelectorAll("#app .mdm-score")[1]
        .querySelector(".mdm-audio-toggle");
      return {
        label: btn.getAttribute("aria-label"),
        drawn: getComputedStyle(btn, "::after").display !== "none",
        hovered: btn.matches(":hover"),
      };
    });
  await h.page.mouse.move(spot.block.x, spot.block.y);
  await new Promise((r) => setTimeout(r, 300));
  await h.page.mouse.move(spot.button.x, spot.button.y);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(
    await read(),
    { label: "Show player", drawn: true, hovered: true },
    "the tooltip is not up on the button the pointer is resting on"
  );
  await h.page.mouse.click(spot.button.x, spot.button.y);
  await h.page.waitForFunction(() => !!document.querySelector(".mdm-audio"), {
    timeout: 15000,
  });
  assert.deepEqual(
    await read(),
    { label: "Hide player", drawn: false, hovered: true },
    "the tooltip stayed up naming the other half of the toggle"
  );
  // Away and back: it says what the next click leads to.
  await h.page.mouse.move(5, 5);
  await new Promise((r) => setTimeout(r, 200));
  await h.page.mouse.move(spot.button.x, spot.button.y);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(
    await read(),
    { label: "Hide player", drawn: true, hovered: true },
    "the tooltip never came back"
  );
  // A click that no pointer made leaves nothing to put away: the mouseleave
  // that brings the tooltip back would never come, and the button would go
  // quiet for good.
  await h.page.mouse.move(5, 5);
  await new Promise((r) => setTimeout(r, 200));
  await clickToggle(h.page, 1);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(
    await h.page.evaluate(() =>
      document
        .querySelectorAll("#app .mdm-score")[1]
        .querySelector(".mdm-audio-toggle")
        .classList.contains("mdm-tip--off")
    ),
    false,
    "a click from script left the tooltip put away with no pointer to bring it back"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the bar takes the keyboard: Space plays and pauses, Escape gives it back", { skip }, async () => {
  const h = await open({});
  const before = await docText(h.page);
  // Somebody is in the document before the player opens, which is what the
  // bar borrows the keyboard from and, on the way out, gives it back to. The
  // reader who never put a caret anywhere is pinned in the test above: the
  // bar takes the focus from nobody and returns it to nobody.
  await caretInProse(h.page);
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  // Opening a player hands the keyboard to its bar. The caret leaving the
  // text is what says so on screen, and what keeps a space typed into the
  // document a space (the test below).
  assert.deepEqual(
    await h.page.evaluate(() => ({
      bar: document.activeElement.classList.contains("mdm-audio"),
      editor: window.__mdm.view.hasFocus,
    })),
    { bar: true, editor: false }
  );

  await h.page.keyboard.press(" ");
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start").classList.contains("abcjs-pushed"),
    { timeout: 15000 }
  );
  await h.page.keyboard.press(" ");
  await h.page.waitForFunction(
    () => !document.querySelector(".mdm-audio .abcjs-midi-start").classList.contains("abcjs-pushed"),
    { timeout: 15000 }
  );
  // Neither press reached the document, and neither opened the score.
  assert.equal(await docText(h.page), before);
  assert.equal(await h.page.evaluate(sourceShowing), false);

  // Closing hands the keyboard back to the text it came from: the bar it was
  // on is gone.
  await clickToggle(h.page, 0);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await playerState(h.page)).bars, 0);
  assert.equal(await h.page.evaluate(() => window.__mdm.view.hasFocus), true);

  // And so does Escape, with the player left open.
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await h.page.keyboard.press("Escape");
  assert.deepEqual(
    await h.page.evaluate(() => ({
      editor: window.__mdm.view.hasFocus,
      bars: document.querySelectorAll(".mdm-audio").length,
    })),
    { editor: true, bars: 1 }
  );
  assert.equal(await docText(h.page), before);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Ctrl+S while the bar holds the keyboard, and with it every other shortcut
// of the workbench. The keys leave the page through a bubble listener the
// webview preload puts on the window (handleInnerKeydown, in
// workbench/contrib/webview/browser/pre/index.html), which is what this
// stands in for; the bar stopped every keydown and keyup at itself, so
// nothing rose that far and the document would not save with a player open.
// What keeps those keys off the text is not that stop but the widget they are
// inside (ScoreWidget.ignoreEvent), which is the second half here.
test("the keys of the workbench leave the page with the bar focused", { skip }, async () => {
  const h = await open({});
  await h.page.evaluate(() => {
    window.__toWindow = [];
    window.addEventListener("keydown", function (e) {
      window.__toWindow.push((e.ctrlKey ? "Ctrl+" : "") + e.key);
    });
  });
  await caretInProse(h.page);
  const before = await docText(h.page);
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  assert.equal(
    await h.page.evaluate(() => !!document.activeElement.closest(".mdm-audio")),
    true,
    "the bar did not take the keyboard, so the case is not the one being tested"
  );
  await h.page.evaluate(() => {
    window.__toWindow = [];
  });
  await h.page.keyboard.down("Control");
  await h.page.keyboard.press("s");
  await h.page.keyboard.up("Control");
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(
    (await h.page.evaluate(() => window.__toWindow)).includes("Ctrl+s"),
    "Ctrl+S never rose to the window: the workbench would never see it and the file would not save"
  );
  // And the text is not the one answering them: the keys that would edit it.
  for (const key of ["Backspace", "Delete", "Enter", "a", "ArrowDown"]) {
    await h.page.keyboard.press(key);
  }
  await h.page.keyboard.down("Control");
  await h.page.keyboard.press("b"); // the keymap's bold
  await h.page.keyboard.up("Control");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(
    await docText(h.page),
    before,
    "a key pressed on the bar reached the text"
  );
  assert.equal(await h.page.evaluate(sourceShowing), false);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a caret in the document keeps Space for the text, player open or not", { skip }, async () => {
  const h = await open({});
  const before = await docText(h.page);
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  // The end of the first body paragraph, wherever the wording of example.mdm
  // has drifted to.
  const at = await h.page.evaluate(() => {
    const text = window.__mdm.view.state.doc.toString();
    const para = text.replace(/^---\n[\s\S]*?\n---\n\n/, "").split("\n")[0];
    return text.indexOf(para) + para.length;
  });
  await setSelection(h.page, at); // which focuses the editor, as a click does
  await h.page.keyboard.press(" ");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await docText(h.page), before.slice(0, at) + " " + before.slice(at));
  assert.deepEqual(
    await h.page.evaluate(() => ({
      pushed: document
        .querySelector(".mdm-audio .abcjs-midi-start")
        .classList.contains("abcjs-pushed"),
      bars: document.querySelectorAll(".mdm-audio").length,
    })),
    { pushed: false, bars: 1 },
    "the space typed into the document reached the player"
  );
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
  // pressing play falls through to the editor's click handler and the score
  // opens for editing (its source lines come up).
  const expanded = await h.page.evaluate(sourceShowing);
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
  // The caret at the end of the first body paragraph, found the way
  // typedIntoFirstParagraph finds it.
  const body = EXAMPLE.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n/, "");
  const firstPara = body.split(/\n\n/)[0];
  await setSelection(h.page, await posOf(h.page, firstPara, firstPara.length));
  await h.page.keyboard.type("QQ");
  const sent = await lastEdit(h.page);
  assert.ok(sent, "the webview sent no edit");
  // The editor text is the file text: what comes back is what went in, plus
  // the two letters.
  assert.equal(sent, typedIntoFirstParagraph(EXAMPLE, "QQ"));
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
      document.querySelector("#app .mdm-toolbar .mdm-audio .abcjs-inline-audio") &&
      document.querySelectorAll("#app [data-mdm-audio]").length === 1,
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
  // An edit inside the open block: the widget is rebuilt from the new
  // source, and the player reopens in place with the new tune, stopped. The
  // caret goes to the end of the second score's ABC (just before its closing
  // fence), which shows the source above the engraving.
  const text = await docText(h.page);
  const fence = await posOf(h.page, "```abc", 0, 1);
  const end = text.indexOf("\n```\n", fence);
  assert.ok(fence > 0 && end > fence, "the second score was not found");
  await setSelection(h.page, end);
  await h.page.keyboard.type(" A");
  // Walked down from the lit block rather than up from the bar: the bar is in
  // the toolbar and belongs to no score, so the mark on the block is what
  // says which one the re-armed player came back on.
  await h.page.waitForFunction(
    () => {
      const block = document.querySelector("#app [data-mdm-audio]");
      const bar = document.querySelector("#app .mdm-toolbar .mdm-audio");
      return (
        block &&
        bar &&
        bar.querySelector(".abcjs-inline-audio") &&
        /A\n?$/.test(block.getAttribute("data-mdm-source"))
      );
    },
    { timeout: 15000 }
  );
  assert.equal(
    await h.page.evaluate(
      () => document.querySelectorAll("#app .mdm-toolbar .mdm-audio").length
    ),
    1,
    "the re-armed player grew a second row"
  );
  const pushed = await h.page.evaluate(() =>
    document
      .querySelector(".mdm-audio .abcjs-midi-start")
      .classList.contains("abcjs-pushed")
  );
  assert.equal(pushed, false, "a re-armed player must come back stopped");
  assert.equal((await playerState(h.page)).onIndex, 1);

  // A full external update replaces the stretch that differs; the player
  // carries over by position. Removing the scores altogether closes it
  // without residue.
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
  // The highlight lands on the on-screen engraving, in the accent colour,
  // driven by the chars the synth reports.
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
  // While the tune sounds the play button is a held state like the repeat:
  // abcjs marks it pushed (pushPlay), and the mark has to land as the brass
  // disc, through the same !important fight as every background in the bar.
  const playing = await h.page.evaluate(() => {
    const start = document.querySelector(".mdm-audio .abcjs-midi-start");
    return {
      pushed: start.classList.contains("abcjs-pushed"),
      disc: getComputedStyle(start).backgroundColor,
    };
  });
  assert.equal(playing.pushed, true, "abcjs did not mark the playing button");
  assert.notEqual(playing.disc, "rgba(0, 0, 0, 0)", "the sounding play sits on no disc");
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

// A duet lights on every staff at once. The event the synth reports names one
// stretch of source in startChar/endChar, and only one: abcjs fills that pair
// from the first note it walks into the group and puts every note of the
// group, that one included, in startCharArray/endCharArray. Read off the pair
// alone, the highlight lit the voice engraved first and left the rest of the
// system in ink for the whole tune, which under a treble part is the bass one.
test("every voice of a duet lights up, on its own staff", { skip }, async () => {
  const h = await open({ text: DUET_FIXTURE, scores: 1 });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await pressPlay(h.page);
  // Sampled while it sounds rather than read once at the end: the mark moves
  // with the tune, and a single reading could land in the silence after it.
  // Each reading is a whole moment, since the repaint clears and lights again
  // in one turn, and only the moments with something lit are kept.
  await h.page.evaluate(() => {
    window.__lit = [];
    window.__litTimer = setInterval(function () {
      const lit = Array.from(
        document.querySelectorAll(
          "#app [data-mdm-audio] code.language-abc svg .abcjs-note.abcjs-note_selected"
        )
      ).map(function (el) {
        const classes = (el.getAttribute("class") || "").split(" ");
        return {
          voice: classes.filter((c) => /^abcjs-v\d+$/.test(c))[0],
          fill: getComputedStyle(el).fill,
          y: Math.round(el.getBoundingClientRect().top),
        };
      });
      if (lit.length) window.__lit.push(lit);
    }, 50);
  });
  await h.page
    .waitForFunction(() => window.__lit.length >= 8, { timeout: 20000 })
    .catch(() => {
      // Let the assertions below say what was lit instead of timing out here.
    });
  const lit = await h.page.evaluate(() => {
    clearInterval(window.__litTimer);
    return window.__lit;
  });
  assert.ok(lit.length >= 8, "the tune did not play: " + lit.length + " moments lit");
  const voices = lit.map((moment) =>
    moment.map((note) => note.voice).sort().join(",")
  );
  assert.deepEqual(
    Array.from(new Set(voices)),
    ["abcjs-v0,abcjs-v1"],
    "a moment of the duet lit only one of the two voices"
  );
  // Two staves and not two notes on one: the bass part is drawn below the
  // treble one, and it is the accent that has to reach it, not just the class.
  const moment = lit[0];
  const top = moment.filter((note) => note.voice === "abcjs-v0")[0];
  const bottom = moment.filter((note) => note.voice === "abcjs-v1")[0];
  assert.ok(bottom.y > top.y, "the two voices were lit on the same staff");
  assert.deepEqual(
    Array.from(new Set(moment.map((note) => note.fill))),
    ["rgb(160, 116, 15)"], // the light brass of --mdm-play-accent
    "a voice of the duet was marked without being accented"
  );
  await clickToggle(h.page, 0); // close: playback stops, highlight cleared
  await new Promise((r) => setTimeout(r, 300));
  const leftoverDuet = await h.page.evaluate(
    () =>
      document.querySelectorAll("code.language-abc svg .abcjs-note_selected")
        .length
  );
  assert.equal(leftoverDuet, 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A written silence takes the ink like a note while the cursor is on it. It
// always did when the tune was played from the top, where the synth reports
// the rest as an event of its own and the highlight lights it. What it did
// not do was after a seek: the silent gap that carries a head dropped inside
// a note runs to the next SOUNDING attack, and a rest attacks nothing, so the
// gap ran straight over it and every event inside the gap waited for its end.
// The rest was painted after its own moment had gone by, and the cursor
// walked over it in ink.
//
// A rest one hand holds alone is what shows it: a rest that shares its moment
// with a note on another staff belongs to an event that sounds, and it was
// lit with that note all along, which is why a two-hand score lit some of its
// rests and not others.
test("a rest is lit while the cursor crosses it, after a seek too", { skip }, async () => {
  const h = await open({ text: REST_FIXTURE, scores: 1 });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  // A first drop primes the tune, which is what puts its timings on the timer.
  await dropHead(h.page, 0);
  await h.page.waitForFunction(
    () => {
      const p = window.__mdm.player;
      return !!(p && p.controller && p.controller.timer && p.controller.timer.noteTimings);
    },
    { timeout: 15000 }
  );
  // The moment nothing at all attacks: the quarter rest the treble holds while
  // the bass is inside its dotted half. Read off the timer and not counted by
  // hand, so the fixture can be re-voiced without silently aiming elsewhere.
  const grid = await h.page.evaluate(() => {
    const timer = window.__mdm.player.controller.timer;
    const events = (timer.noteTimings || []).filter(
      (t) => t.type === "event" && typeof t.startChar === "number"
    );
    const silent = events.filter((t) => !(t.midiPitches && t.midiPitches.length));
    const rest = silent[0];
    const before = events.filter((t) => t.milliseconds < rest.milliseconds).pop();
    return {
      total: timer.lastMoment,
      rest: rest ? rest.milliseconds : null,
      before: before ? before.milliseconds : null,
    };
  });
  assert.ok(
    grid.rest > 0 && grid.before !== null && grid.before < grid.rest,
    "the fixture must hold a rest with nothing sounding under it: " +
      JSON.stringify(grid)
  );

  // Every moment of the crossing, sampled: the lit elements, what they are
  // painted, and where the line stands. A single reading would land wherever
  // the sampling happened to fall.
  const watch = () =>
    h.page.evaluate(() => {
      window.__ink = [];
      window.__inkTimer = setInterval(function () {
        const line = document.querySelector(
          "#app code.language-abc svg .mdm-play-cursor"
        );
        const lit = Array.from(
          document.querySelectorAll(
            "#app [data-mdm-audio] code.language-abc svg .abcjs-note_selected"
          )
        ).map(function (el) {
          const box = el.getBBox();
          return {
            rest: (el.getAttribute("class") || "").split(" ").indexOf("abcjs-rest") >= 0,
            fill: getComputedStyle(el).fill,
            from: box.x,
            to: box.x + box.width,
          };
        });
        window.__ink.push({
          x: line ? parseFloat(line.getAttribute("x1")) : null,
          lit: lit,
        });
      }, 25);
    });

  // The head dropped inside the note before the rest, which is the gesture
  // that used to lose it: the gap starts there and ends past the rest.
  await dropHead(h.page, (grid.before + grid.rest) / 2 / grid.total);
  await watch();
  await pressPlay(h.page);
  await new Promise((r) => setTimeout(r, (grid.rest - grid.before) * 1.5 + 800));
  const seeked = await h.page.evaluate(() => {
    clearInterval(window.__inkTimer);
    document.querySelector(".mdm-audio .mdm-audio-stop").click();
    return window.__ink;
  });
  const onRest = seeked.filter(
    (m) => m.lit.length === 1 && m.lit[0].rest && m.x !== null
  );
  assert.ok(
    onRest.length > 0,
    "the rest was never lit while the cursor crossed it: " +
      JSON.stringify(seeked.map((m) => m.lit.length))
  );
  assert.deepEqual(
    Array.from(new Set(onRest.map((m) => m.lit[0].fill))),
    ["rgb(160, 116, 15)"], // the light brass of --mdm-play-accent
    "the rest was marked without being accented"
  );
  // And lit where it stands: the line never runs behind the rest's drawing
  // while the rest is lit, and passes over it somewhere in the crossing, which
  // is the moment the ink was missing from. Past the glyph it keeps walking,
  // to the x of the note that ends the silence, so the far edge is no bound.
  const behind = onRest.filter((m) => m.x < m.lit[0].from - 2);
  assert.equal(
    behind.length,
    0,
    "the rest was lit before the cursor reached it: " + JSON.stringify(behind[0])
  );
  const over = onRest.filter(
    (m) => m.x >= m.lit[0].from - 2 && m.x <= m.lit[0].to + 2
  );
  assert.ok(over.length > 0, "the cursor never passed over the lit rest");

  // A head parked on the rest, with nothing playing: the same ink, since the
  // rest's own event went by before the head arrived and nothing reports it
  // again.
  await h.page.evaluate(() => {
    window.__ink = [];
  });
  await dropHead(h.page, (grid.rest + 30) / grid.total);
  await new Promise((r) => setTimeout(r, 400));
  const parked = await h.page.evaluate(() => {
    const lit = Array.from(
      document.querySelectorAll(
        "#app [data-mdm-audio] code.language-abc svg .abcjs-note_selected"
      )
    ).map((el) => (el.getAttribute("class") || "").split(" ").indexOf("abcjs-rest") >= 0);
    return {
      lit: lit,
      sounding: !!document.querySelector(".abcjs-midi-start.abcjs-pushed"),
    };
  });
  assert.equal(parked.sounding, false, "the drop started playback");
  assert.deepEqual(parked.lit, [true], "a head parked on a rest lights nothing");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Opens the player on a score whose block is OPEN for editing (a click on the
// drawing puts the caret in the ABC source, which shows above the engraving).
// The bar itself needs no scrolling to any more, wherever the block is: it
// opens in the toolbar, which does not scroll. What the tests below are for
// is the other half, that a press on the bar is not a press "outside the
// text": the source has to stay open under it (main.js, the .mdm-audio
// exemption in dismissFromOutside and the bar's own clause in
// somebodyInside).
async function openPlayerOnExpandedScore(page, index) {
  await page.evaluate((i) => {
    document
      .querySelectorAll("#app .mdm-score")
      [i].scrollIntoView({ block: "center" });
  }, index);
  await new Promise((r) => setTimeout(r, 200));
  const score = await page.evaluate((i) => {
    const r = document
      .querySelectorAll("#app .mdm-score")
      [i].querySelector("code.language-abc")
      .getBoundingClientRect();
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
      expanded: !!document.querySelector("#app .cm-line.mdm-src-line"),
      scroll: Math.round(document.querySelector("#app .cm-scroller").scrollTop),
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
      expanded: !!document.querySelector("#app .cm-line.mdm-src-line"),
      scroll: Math.round(document.querySelector("#app .cm-scroller").scrollTop),
    };
  });
  // The button is focusable, so without the mousedown default prevented its
  // press pulls the focus out of the editor, and a press that reaches the
  // editor would move the caret out of the block, which hides the source the
  // bar was aimed under. Measured before the fix, in the old engine: playback
  // never started and the document slid 258px.
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
    // South, the way the toolbar's own buttons are tipped: the bar is a row
    // of that toolbar and north would draw over the buttons above it.
    const tipped = (el) =>
      el.classList.contains("mdm-tip") &&
      el.classList.contains("mdm-tip--s") &&
      !el.classList.contains("mdm-tip--n");
    return {
      startLabel: start.getAttribute("aria-label"),
      loopLabel: loop.getAttribute("aria-label"),
      // A native title never shows inside the webview, so the CSS tooltip of
      // this editor is what labels them; carrying both would show two.
      startTitle: start.getAttribute("title"),
      loopTitle: loop.getAttribute("title"),
      // The editor's own tooltip (.mdm-tip, drawn from aria-label), south.
      // Every labelled control of the bar, the two abcjs ships and the two
      // this editor adds: the stop button and the mute carry the class
      // written by hand, and were the two a flip could miss.
      tooltipped:
        tipped(start) &&
        tipped(loop) &&
        tipped(document.querySelector(".mdm-audio .mdm-audio-stop")) &&
        tipped(document.querySelector(".mdm-audio .mdm-audio-mute")),
      playFirst: buttons.indexOf(start) < buttons.indexOf(loop),
    };
  });
  assert.equal(idle.startLabel, "Play");
  assert.equal(idle.loopLabel, "Repeat");
  assert.equal(idle.startTitle, null);
  assert.equal(idle.loopTitle, null);
  assert.equal(idle.tooltipped, true);
  assert.equal(idle.playFirst, true, "play should lead the bar");
  // And they give way to an open drop-down, as the toolbar's own do: a panel
  // hangs over the row, and a tooltip from a control under it would be drawn
  // on top of the panel (the tip is z-index 10 against the menu's 5).
  await h.page.click('#app button[data-type="mdm-theme"]');
  await new Promise((r) => setTimeout(r, 200));
  const withMenu = await h.page.evaluate(() => ({
    menus: document.querySelectorAll("#app .mdm-toolbar__item--open").length,
    play: getComputedStyle(
      document.querySelector(".mdm-audio .abcjs-midi-start"),
      "::after"
    ).display,
    volume: getComputedStyle(
      document.querySelector(".mdm-audio .mdm-audio-mute"),
      "::after"
    ).display,
  }));
  assert.equal(withMenu.menus, 1, "the theme menu did not open");
  assert.equal(withMenu.play, "none", "the play tooltip is drawn over the open panel");
  assert.equal(withMenu.volume, "none", "the mute tooltip is drawn over the open panel");
  await h.page.evaluate(() => document.body.click());
  await new Promise((r) => setTimeout(r, 200));

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
  // The discs climb a ladder of the accent, never of a syntax colour: a
  // light wash (12%) under the pointed-at button, the state weight (22%)
  // under the held repeat, the same brass the sounding note takes. The
  // expected values are mixed by the browser from the properties in force,
  // so the test follows a change of theme and only fails if a disc stops
  // taking them.
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
      brass12: mix("--mdm-play-accent", 12),
      brass22: mix("--mdm-play-accent", 22),
    };
  });
  assert.equal(discs.hover, discs.brass12, "the hovered disc is not the light brass wash");
  assert.equal(discs.pushed, discs.brass22, "the repeat disc is not the brass of the accent");
  assert.notEqual(discs.hover, discs.brass22, "hover took the disc of a held state");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the toggle wears headphones, and lights up while its player is open", { skip }, async () => {
  const h = await open({});
  const read = () =>
    h.page.evaluate(() => {
      // The toggle is a single element: it carries the drawing, the label
      // and the disc.
      const toggles = Array.from(document.querySelectorAll("#app .mdm-audio-toggle"));
      return toggles.map((s) => ({
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

// The playing cursor: the brass line that walks the engraving while the tune
// sounds (cursorFrame in main.js). It glides between attacks rather than
// hopping note to note, which is what makes a note read as being drawn the
// moment the line reaches it, and it spans the whole system top to bottom.
// Sampled frame by frame on the third score of the timing fixture, whose
// notes come every 300 ms and whose first line lasts seconds: within one
// line x never goes backwards, no frame jumps a whole note gap (adjacent
// noteheads sit tens of units apart while an interpolated frame moves a few),
// and the count of distinct readings says it moved most frames, not once per
// note. The line the cursor is drawn with is the play accent, and the note
// that is lit is never ahead of it.
test("a brass cursor walks the score continuously while the tune sounds", { skip }, async () => {
  const h = await open({ text: TIMING_FIXTURE });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await pressPlay(h.page);
  await h.page.waitForFunction(
    () =>
      document.querySelector(
        "#app [data-mdm-audio] code.language-abc svg .mdm-play-cursor"
      ),
    { timeout: 15000 }
  );
  const seen = await h.page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = [];
        function tick() {
          const el = document.querySelector(
            "#app [data-mdm-audio] code.language-abc svg .mdm-play-cursor"
          );
          if (el) {
            out.push({
              x: parseFloat(el.getAttribute("x1")),
              y1: parseFloat(el.getAttribute("y1")),
              y2: parseFloat(el.getAttribute("y2")),
            });
          }
          if (out.length >= 50) resolve(out);
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      })
  );
  assert.equal(seen.length, 50);
  const xs = seen.map((s) => s.x);
  assert.ok(
    xs.every((x) => isFinite(x)),
    "a frame drew the cursor nowhere"
  );
  const steps = [];
  for (let i = 1; i < xs.length; i++) steps.push(xs[i] - xs[i - 1]);
  assert.ok(
    steps.every((d) => d > -0.5),
    "the cursor walked backwards inside a line"
  );
  assert.ok(
    Math.max.apply(null, steps) < 40,
    "the cursor hopped: a frame moved " + Math.max.apply(null, steps) + " units"
  );
  const distinct = new Set(xs).size;
  assert.ok(
    distinct >= 20,
    "the cursor stood in only " + distinct + " positions over 50 frames"
  );
  assert.ok(
    xs[xs.length - 1] - xs[0] > 20,
    "the cursor barely advanced: " + (xs[xs.length - 1] - xs[0]) + " units"
  );
  assert.ok(
    seen.every((s) => s.y2 - s.y1 >= 20),
    "the cursor does not span the system"
  );
  const look = await h.page.evaluate(() => {
    const el = document.querySelector("code.language-abc svg .mdm-play-cursor");
    const lit = document.querySelector(
      "code.language-abc svg .abcjs-note.abcjs-note_selected"
    );
    return {
      stroke: getComputedStyle(el).stroke,
      x: parseFloat(el.getAttribute("x1")),
      litX: lit ? lit.getBBox().x : null,
    };
  });
  assert.equal(look.stroke, "rgb(160, 116, 15)", "the cursor is not brass");
  assert.ok(look.litX !== null, "no note lit under a walking cursor");
  assert.ok(
    look.x >= look.litX - 8,
    "the lit note is ahead of the cursor: " + look.x + " vs " + look.litX
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Pausing holds the line where the music stopped, the way every sequencer
// does; stop takes it away (the clock is rewound to nought and nothing is
// standing anywhere), and the headphones going out take it away with the
// whole player.
test("the cursor freezes on pause, leaves on stop, and goes with the player", { skip }, async () => {
  const h = await open({ text: TIMING_FIXTURE });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await pressPlay(h.page);
  await h.page.waitForFunction(
    () => document.querySelector("code.language-abc svg .mdm-play-cursor"),
    { timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 500));
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await h.page.waitForFunction(
    () =>
      !document
        .querySelector(".mdm-audio .abcjs-midi-start")
        .classList.contains("abcjs-pushed"),
    { timeout: 5000 }
  );
  // The button unpushes on the click itself while the engine's pause lands
  // behind its promises a few milliseconds later, so the first reading waits
  // that out; after it the line must not move by a hair.
  const frozen = await h.page.evaluate(
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          const el = document.querySelector(
            "code.language-abc svg .mdm-play-cursor"
          );
          const first = el ? el.getAttribute("x1") : null;
          setTimeout(() => {
            const again = document.querySelector(
              "code.language-abc svg .mdm-play-cursor"
            );
            resolve({
              first: first,
              later: again ? again.getAttribute("x1") : null,
            });
          }, 300);
        }, 200);
      })
  );
  assert.ok(frozen.first !== null, "the pause took the cursor away");
  assert.equal(frozen.later, frozen.first, "the cursor kept walking while paused");
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .mdm-audio-stop").click()
  );
  await h.page.waitForFunction(
    () => !document.querySelector("code.language-abc svg .mdm-play-cursor"),
    { timeout: 5000 }
  );
  await pressPlay(h.page);
  await h.page.waitForFunction(
    () => document.querySelector("code.language-abc svg .mdm-play-cursor"),
    { timeout: 15000 }
  );
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () =>
      !document.querySelector(".mdm-audio") &&
      !document.querySelector(".mdm-play-cursor"),
    { timeout: 5000 }
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A head dropped before the first play parks the cursor where the music
// would begin, without a sound: the seek primes the tune, moves its clock,
// and the line stands inside the note the head landed in, placed by musical
// time and not by the drawing (an unjustified single measure leaves most of
// the staff width empty, so the two disagree wildly). Dropped at 44% of
// eight even eighths the clock sits halfway through the fourth, so the line
// stands strictly between the fourth and fifth noteheads. Home from there
// walks it back to the first note, where the clock reads nought and it is
// the ink (a seek lights the attack it lands on) that keeps the line from
// reading as stopped.
test("a head dropped before play parks the cursor where the music would start", { skip }, async () => {
  const h = await open({ text: TIMING_FIXTURE });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await dropHead(h.page, 0.44);
  await h.page.waitForFunction(
    () => document.querySelector("code.language-abc svg .mdm-play-cursor"),
    { timeout: 15000 }
  );
  const parked = await h.page.evaluate(() => {
    const el = document.querySelector("code.language-abc svg .mdm-play-cursor");
    const notes = Array.from(
      document.querySelectorAll(
        "#app [data-mdm-audio] code.language-abc svg .abcjs-note"
      )
    )
      .map((n) => n.getBBox().x)
      .sort((a, b) => a - b);
    return {
      x: parseFloat(el.getAttribute("x1")),
      notes: notes,
      sounding: !!document.querySelector(".abcjs-midi-start.abcjs-pushed"),
    };
  });
  assert.equal(parked.sounding, false, "the drop started playback");
  assert.equal(parked.notes.length, 8, "the fixture is not eight note groups");
  assert.ok(
    parked.x > parked.notes[3] + 2 && parked.x < parked.notes[4] - 2,
    "the cursor is not inside the fourth note: " +
      parked.x +
      " against heads at " +
      parked.notes.join(", ")
  );
  await h.page.evaluate(() => {
    const track = document.querySelector(
      ".mdm-audio .abcjs-midi-progress-background"
    );
    track.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await h.page.waitForFunction(
    (was) => {
      const el = document.querySelector(
        "code.language-abc svg .mdm-play-cursor"
      );
      return el && parseFloat(el.getAttribute("x1")) < was * 0.6;
    },
    { timeout: 15000 },
    parked.x
  );
  const home = await h.page.evaluate(() => {
    const el = document.querySelector("code.language-abc svg .mdm-play-cursor");
    return {
      x: parseFloat(el.getAttribute("x1")),
      lit: document.querySelectorAll(
        "code.language-abc svg .abcjs-note_selected"
      ).length,
    };
  });
  assert.ok(
    home.x <= parked.notes[0] + 8,
    "Home left the cursor at " + home.x + ", past the first head at " + parked.notes[0]
  );
  assert.ok(home.lit > 0, "the first note is not lit under the parked cursor");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// While a hand holds the progress head, the cursor follows it, both ways and
// live, the way scrubbing moves the playhead in any sequencer; the engine is
// only seeked on release (midiBuffer.seek stutters at pointermove rate), so
// the line reads the hand, not the clock, and holds the spot through the
// seek that lands after the release. That works before the tune has ever
// been primed, when there is no clock at all, and paused mid-tune alike.
// Regions are read in musical time against the eight noteheads of the first
// fixture score: at p of the track the clock stands p*8 eighths in, so the
// line falls strictly between heads floor(p*8) and the next.
test("the cursor follows the head while it is held, before the seek lands", { skip }, async () => {
  const h = await open({ text: TIMING_FIXTURE });
  await clickToggle(h.page, 0);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  const cursorX = () =>
    h.page.evaluate(() => {
      const el = document.querySelector(
        "code.language-abc svg .mdm-play-cursor"
      );
      return el ? parseFloat(el.getAttribute("x1")) : null;
    });
  const settle = () => new Promise((r) => setTimeout(r, 120));
  const notes = await h.page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        "#app [data-mdm-audio] code.language-abc svg .abcjs-note"
      )
    )
      .map((n) => n.getBBox().x)
      .sort((a, b) => a - b)
  );
  assert.equal(notes.length, 8, "the fixture is not eight note groups");
  const between = (x, i, what) =>
    assert.ok(
      x !== null && x > notes[i] + 2 && x < notes[i + 1] - 2,
      what + ": the cursor at " + x + " is not between heads " + i + " and " +
        (i + 1) + " (" + notes[i] + ", " + notes[i + 1] + ")"
    );
  // Held before the tune was ever primed: no clock exists, the hand alone
  // places the line.
  await headEvent(h.page, 0.2, "pointerdown");
  await h.page.waitForFunction(
    () => document.querySelector("code.language-abc svg .mdm-play-cursor"),
    { timeout: 5000 }
  );
  between(await cursorX(), 1, "held at 20%");
  await headEvent(h.page, 0.6, "pointermove");
  await settle();
  between(await cursorX(), 4, "dragged to 60%");
  await headEvent(h.page, 0.3, "pointermove");
  await settle();
  between(await cursorX(), 2, "dragged back to 30%");
  // The release seeks, which primes the tune first, and the line must hold
  // the spot right through: handed back to a clock that has not landed yet
  // (it reads nought until the seek is served) it would blink out until the
  // priming ends and come back. The priming can be quick here (a small tune,
  // a local soundfont, a warm browser), so presence is sampled every frame
  // from the release itself: a blink of one frame is a blink seen.
  const heldThrough = await h.page.evaluate(
    () =>
      new Promise((resolve) => {
        const track = document.querySelector(
          ".mdm-audio .abcjs-midi-progress-background"
        );
        const box = track.getBoundingClientRect();
        track.dispatchEvent(
          new PointerEvent("pointerup", {
            button: 0,
            bubbles: true,
            pointerId: 7,
            clientX: box.x + box.width * 0.3,
            clientY: box.y + box.height / 2,
          })
        );
        const seen = [];
        const t0 = performance.now();
        (function tick() {
          seen.push(
            !!document.querySelector("code.language-abc svg .mdm-play-cursor")
          );
          if (performance.now() - t0 > 400) resolve(seen);
          else requestAnimationFrame(tick);
        })();
      })
  );
  assert.ok(
    heldThrough.every(Boolean),
    "the line blinked out after the release: [" + heldThrough.join(",") + "]"
  );
  // Once served, the clock stands where the hand left it and the line must
  // not move off the spot.
  await h.page.waitForFunction(
    () => {
      const p = window.__mdm.player;
      return !!(p && p.controller && p.controller.timer);
    },
    { timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 300));
  between(await cursorX(), 2, "after the release");
  assert.equal(
    await h.page.evaluate(
      () => !!document.querySelector(".abcjs-midi-start.abcjs-pushed")
    ),
    false,
    "the drag started playback"
  );
  // The same hold, paused mid-tune: play a moment, pause, and the line
  // follows the hand off the spot the pause left it on.
  await pressPlay(h.page);
  await new Promise((r) => setTimeout(r, 250));
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await h.page.waitForFunction(
    () =>
      !document
        .querySelector(".mdm-audio .abcjs-midi-start")
        .classList.contains("abcjs-pushed"),
    { timeout: 5000 }
  );
  await settle();
  await headEvent(h.page, 0.8, "pointerdown");
  await settle();
  between(await cursorX(), 6, "held at 80% while paused");
  await headEvent(h.page, 0.06, "pointermove");
  await settle();
  between(await cursorX(), 0, "dragged to 6% while paused");
  await headEvent(h.page, 0.06, "pointerup");
  await new Promise((r) => setTimeout(r, 300));
  between(await cursorX(), 0, "after the paused release");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A hand on the head takes the sound and the ink with it. The engine cannot
// seek at pointermove rate, and pausing it on the grab races the release's
// seek through abcjs's promise chains (a quick click landed the pause after
// the seek and came back sounding the old spot under a clock on the new
// one), so what the grab does is mute the output while the transport runs
// on: silence for the whole drag, and the release's seek lands the sound
// under the new head with the silent gap the sounding path always had. The
// brass goes out on the grab too, and stays out for the drag, whether the
// tune was sounding or was paused with its last note still lit: what is lit
// is where the music stands, and the head is leaving. A tune the user paused
// themselves stays paused after the release.
test("a grab on the head silences the tune and puts the ink out; the release plays on", { skip }, async () => {
  const h = await open({ audioSpy: true, text: TIMING_FIXTURE });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await installAudioProbe(h.page);
  const state = () =>
    h.page.evaluate(() => ({
      pushed: !!document.querySelector(".abcjs-midi-start.abcjs-pushed"),
      lit: document.querySelectorAll(
        "code.language-abc svg .abcjs-note_selected"
      ).length,
      cursor: !!document.querySelector("code.language-abc svg .mdm-play-cursor"),
      mute: window.__mute(),
    }));
  const settle = () => new Promise((r) => setTimeout(r, 200));
  await pressPlay(h.page);
  await h.page.waitForFunction(
    () =>
      document.querySelector(
        "code.language-abc svg .abcjs-note_selected"
      ),
    { timeout: 15000 }
  );
  // The grab, mid-play: the output goes quiet and the brass goes out, while
  // the line stays with the hand.
  await headEvent(h.page, 0.5, "pointerdown");
  await settle();
  let s = await state();
  assert.equal(s.mute, 0, "the tune kept sounding under the grab");
  assert.equal(s.lit, 0, "the ink stayed lit under the grab");
  assert.equal(s.cursor, true, "the grab lost the cursor");
  await headEvent(h.page, 0.25, "pointermove");
  await settle();
  s = await state();
  assert.equal(s.mute, 0, "the drag lifted the mute");
  assert.equal(s.lit, 0, "the ink came back mid-drag");
  // The release: the seek lands, the gap passes, and the tune sounds on from
  // under the new head, ink and gain back together.
  await headEvent(h.page, 0.25, "pointerup");
  await h.page.waitForFunction(
    () =>
      window.__mute() === 1 &&
      !!document.querySelector("code.language-abc svg .abcjs-note_selected"),
    { timeout: 15000 }
  );
  s = await state();
  assert.equal(s.pushed, true, "the release left the tune stopped");
  // The same grab on a tune the user paused: the lit note goes out, nothing
  // is muted (nothing sounds), and the release starts nothing.
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await h.page.waitForFunction(
    () =>
      !document
        .querySelector(".mdm-audio .abcjs-midi-start")
        .classList.contains("abcjs-pushed"),
    { timeout: 5000 }
  );
  await settle();
  s = await state();
  assert.ok(s.lit > 0, "the pause left no note lit to put out");
  await headEvent(h.page, 0.7, "pointerdown");
  await settle();
  s = await state();
  assert.equal(s.lit, 0, "the grab left the paused note lit");
  assert.equal(s.pushed, false, "the grab started a paused tune");
  assert.equal(s.mute, 1, "a grab on a paused tune muted the output");
  await headEvent(h.page, 0.7, "pointerup");
  await new Promise((r) => setTimeout(r, 500));
  s = await state();
  assert.equal(s.pushed, false, "the release played a tune the user had paused");
  assert.equal(s.cursor, true, "the parked cursor is gone");
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
  await installAudioProbe(h.page);
  const order = await h.page.evaluate(() => {
    const widget = document.querySelector(".mdm-audio .abcjs-inline-audio");
    return Array.from(widget.querySelectorAll(".abcjs-btn")).map((b) =>
      b.classList.contains("abcjs-midi-start")
        ? "play"
        : b.classList.contains("mdm-audio-stop")
        ? "stop"
        : b.classList.contains("abcjs-midi-loop")
        ? "repeat"
        : b.classList.contains("mdm-audio-close")
        ? "close"
        : "?"
    );
  });
  // The transport in the order a player is read in, and then the headphones
  // that put the player away, which are not part of it.
  assert.deepEqual(order, ["play", "stop", "repeat", "close"]);

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
  // The sound goes back to the top with the clock. abcjs writes down where it
  // paused after the click that pauses it returns, so the rewind waits a
  // microtask on that: done in the same tick it was undone, and the next play
  // sounded from where the tune was stopped while the ink ran from the
  // beginning.
  await h.page.evaluate(() => (window.__sources.length = 0));
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await h.page.waitForFunction(() => window.__sources.length > 0, {
    timeout: 15000,
  });
  const restarted = await h.page.evaluate(() => window.__sources[0].offset);
  assert.equal(restarted, 0, "play after stop sounded from " + restarted + "s in");
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
    const el = document.querySelector(".mdm-audio .mdm-audio-vol input");
    const r = el.getBoundingClientRect();
    const x = r.x + r.width * 0.4;
    const y = r.y + r.height / 2;
    return {
      x: x,
      y: y,
      onSlider: document.elementFromPoint(x, y) === el,
      value: el.value,
      expanded: !!document.querySelector("#app .cm-line.mdm-src-line"),
      scroll: Math.round(document.querySelector("#app .cm-scroller").scrollTop),
    };
  });
  assert.equal(aim.onSlider, true, "the slider is not under the aim point");
  assert.equal(aim.expanded, true);
  await h.page.mouse.click(aim.x, aim.y);
  await new Promise((r) => setTimeout(r, 400));
  const after = await h.page.evaluate(() => ({
    value: document.querySelector(".mdm-audio .mdm-audio-vol input").value,
    expanded: !!document.querySelector("#app .cm-line.mdm-src-line"),
    scroll: Math.round(document.querySelector("#app .cm-scroller").scrollTop),
  }));
  // A form control has to take the focus for its own drag, and the caret
  // must stay in the block all the same: the source keeps showing. In the
  // old engine this click closed the block and slid the document 258px.
  assert.notEqual(after.value, aim.value, "the slider did not move");
  assert.equal(after.expanded, true, "the block closed under the slider");
  assert.equal(after.scroll, aim.scroll, "the document moved under the reader");
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

test("the repeat state is drawn as the disc alone, in the brass of the accent", { skip }, async () => {
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
        // The brass the score marks the sounding note with, and its deep
        // form. Held state is the one thing of the bar drawn in it, and it
        // is drawn as the GROUND: the repeat sits on the accent disc while
        // its glyph stays where it was, in the chrome ink every control of
        // the editor is written in.
        accent: resolve("--mdm-play-accent"),
        accentInk: resolve("--mdm-play-accent-ink"),
        chromeInk: resolve("--mdm-chrome-ink"),
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
  assert.equal(
    on.glyph,
    off.glyph,
    "the held glyph changed colour: the state is meant to be the disc alone"
  );
  assert.equal(on.glyph, on.chromeInk, "the glyph is not the chrome ink: " + on.glyph);
  assert.notEqual(on.glyph, on.ink);
  // The disc is the accent at some weight, never the ink or a syntax colour:
  // it is a mix of the accent with transparency, so its channels are the
  // accent's. A color-mix() computes to color(srgb …) with channels from 0
  // to 1, while a plain colour reads as rgb() from 0 to 255; both are
  // brought to the same scale before they are compared.
  const channels = (colour) =>
    (colour.match(/[\d.]+/g) || [])
      .slice(0, 3)
      .map((n) => (Number(n) > 1 ? Number(n) / 255 : Number(n)));
  const near = (a, b) => a.every((n, i) => Math.abs(n - b[i]) < 0.01);
  assert.ok(
    near(channels(on.disc), channels(on.accent)),
    "the state disc is not drawn in the brass of the accent: " + on.disc
  );
  assert.ok(
    !near(channels(on.disc), channels(on.ink)),
    "the state disc stayed in the ink of the bar: " + on.disc
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

// The buttons in the corner of a score keep clear of its engraving. A score is
// scaled to the width of the pane, so the narrower the pane the higher its top
// row of ink climbs: past about 500px the last chord symbol came up under the
// buttons and was covered by them. They have a strip of their own above the
// drawing now, so no width brings the two together.
test("the buttons of a score keep clear of the engraving at any width", { skip }, async () => {
  const h = await open({});
  // The player open on the last score, so its buttons stay up without a hover.
  await h.page.evaluate(() => {
    const blocks = document.querySelectorAll("#app .mdm-score");
    blocks[blocks.length - 1].querySelector(".mdm-audio-toggle").click();
  });
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  for (const width of [1200, 800, 620, 500]) {
    await h.page.setViewport({ width, height: 1000 });
    await new Promise((r) => setTimeout(r, 400));
    const seen = await h.page.evaluate(() => {
      const blocks = document.querySelectorAll("#app .mdm-score");
      const block = blocks[blocks.length - 1];
      block.scrollIntoView({ block: "center" });
      const svg = block.querySelector("code.language-abc svg");
      const marks = Array.from(svg.querySelectorAll("path,text,rect,tspan"));
      const covers = (btn) => {
        const b = btn.getBoundingClientRect();
        return marks.some((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 0 && r.height > 0 &&
            r.left < b.right && r.right > b.left &&
            r.top < b.bottom && r.bottom > b.top
          );
        });
      };
      return {
        onCopy: covers(block.querySelector(".mdm-copy")),
        onToggle: covers(block.querySelector(".mdm-audio-toggle")),
        drawn: marks.length,
      };
    });
    assert.ok(seen.drawn > 20, "the score is not engraved at " + width + "px");
    assert.equal(seen.onCopy, false, "the copy button sits on the ink at " + width + "px");
    assert.equal(seen.onToggle, false, "the player button sits on the ink at " + width + "px");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the two little buttons of a score are sized to be read", { skip }, async () => {
  const h = await open({});
  const spot = await h.page.evaluate(() => {
    const block = document.querySelector("#app .mdm-score");
    block.scrollIntoView({ block: "center" });
    const r = block.querySelector("code.language-abc").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + 8 };
  });
  await h.page.mouse.move(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 200));
  const sizes = await h.page.evaluate(() => {
    const block = document.querySelector("#app .mdm-score");
    const toggle = block.querySelector(".mdm-audio-toggle svg").getBoundingClientRect();
    const copy = block.querySelector(".mdm-copy svg").getBoundingClientRect();
    return {
      toggle: Math.round(toggle.height),
      copy: Math.round(copy.height),
      sameLine:
        Math.abs(
          toggle.y + toggle.height / 2 - (copy.y + copy.height / 2)
        ) <= 1.5,
    };
  });
  assert.equal(sizes.toggle, 18);
  assert.ok(sizes.toggle > sizes.copy, "the toggle is not the larger of the two");
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
    const track = bar.querySelector(".abcjs-midi-progress-background");
    const box = track.getBoundingClientRect();
    const x = box.x + track.offsetWidth * f;
    const y = box.y + box.height / 2;
    return {
      x: x,
      y: y,
      onTrack: track.contains(document.elementFromPoint(x, y)),
      // The bar is in the toolbar, so it is on screen with nothing scrolled
      // to: this is what the scrollIntoView that used to stand here was for.
      inView: box.top >= 0 && box.bottom <= window.innerHeight,
    };
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
  assert.equal(grab.inView, true, "the track is off screen without a scroll");
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
      expanded: !!document.querySelector("#app .cm-line.mdm-src-line"),
      scroll: Math.round(document.querySelector("#app .cm-scroller").scrollTop),
    };
  });
  assert.equal(aim.onTrack, true, "the grab point is not on the track");
  assert.equal(aim.expanded, true);
  // The bar takes the focus here, as the volume slider does, and the drag
  // has to leave the caret where it is: a gesture that reached the editor
  // would move it out of the block, hide the source and rebuild the widget
  // the bar lives in, so the drag would end on an element that no longer
  // exists.
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
      expanded: !!document.querySelector("#app .cm-line.mdm-src-line"),
      scroll: Math.round(document.querySelector("#app .cm-scroller").scrollTop),
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
      document.querySelectorAll("#app .mdm-toolbar button[data-type]")
    ).map((b) => b.getAttribute("data-type"));
    const undo = document.querySelector(
      '#app .mdm-toolbar button[data-type="undo"] svg path'
    );
    const redo = document.querySelector(
      '#app .mdm-toolbar button[data-type="redo"] svg path'
    );
    return {
      first: types.slice(0, 7),
      // The rotate arrows: an open ring whose arc starts at these exact
      // coordinates.
      undoPath: undo ? undo.getAttribute("d").slice(0, 5) : null,
      redoPath: redo ? redo.getAttribute("d").slice(0, 5) : null,
      // Greyed out on a fresh document: nothing to undo yet.
      undoDisabled: document
        .querySelector('#app .mdm-toolbar button[data-type="undo"]')
        .classList.contains("mdm-btn--off"),
    };
  });
  // Outline leads (its panel opens down the left edge), then export with its
  // menu entries, then undo/redo.
  assert.deepEqual(bar.first, [
    "outline",
    "mdm-export",
    "mdm-export-html",
    "mdm-export-pdf",
    "mdm-export-both",
    "undo",
    "redo",
  ]);
  assert.equal(bar.undoPath, "M3.32");
  assert.equal(bar.redoPath, "M12.6");
  assert.equal(bar.undoDisabled, true);
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
  await installAudioProbe(h.page);
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

// The rule has one exception, and it is the commonest case of all: on a note's
// attack, the top of the tune above every other, what sounds first is that
// note's own beginning, so there is nothing to wait out and no silence goes in
// front of it.
test("play from the top sounds at once, with no silence in front of it", { skip }, async () => {
  const h = await open({ audioSpy: true, text: TIMING_FIXTURE });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await installAudioProbe(h.page);
  // Prime the tune and take it back to the top. The press under test is this
  // second one: before a tune is primed the timer holds no note timings at
  // all, so there is nothing to schedule a silence against either way.
  await pressPlay(h.page);
  await h.page.waitForFunction(() => window.__sources.length > 0, {
    timeout: 15000,
  });
  await new Promise((r) => setTimeout(r, 300));
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .mdm-audio-stop").click()
  );
  await new Promise((r) => setTimeout(r, 250));
  await h.page.evaluate(() => (window.__sources.length = 0));
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await h.page.waitForFunction(() => window.__sources.length > 0, {
    timeout: 15000,
  });
  await new Promise((r) => setTimeout(r, 100));
  const out = await h.page.evaluate(() => ({
    mute: window.__mute(),
    lit: window.__lit(),
    offset: window.__sources[0].offset,
  }));
  assert.equal(out.offset, 0, "the tune did not start at the top: " + out.offset);
  assert.equal(out.mute, 1, "silence was put in front of the first note");
  assert.equal(out.lit, 0, "the first note is not the one lit: note " + out.lit);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A head dropped inside a chord marks nothing: what follows from there is the
// silence, and the chord that is due lights when it sounds and not before. The
// engine marks the chord AFTER the head, its event pointer having moved on the
// moment it was told to seek, and it sounded the tail of the chord the head is
// in with no attack, an echo of the one that was going. Dropped on an attack
// instead, that note is marked at once: what sounds from there is its own
// beginning.
test("a head dropped inside a chord marks nothing, and play waits out its remainder", { skip }, async () => {
  const h = await open({ audioSpy: true, text: TIMING_FIXTURE });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await installAudioProbe(h.page);
  // Prime the tune and take it back to the top: the timings the marks are read
  // from are the primed ones.
  await pressPlay(h.page);
  await new Promise((r) => setTimeout(r, 400));
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .mdm-audio-stop").click()
  );
  await new Promise((r) => setTimeout(r, 250));
  // The fixture's grid: a note every 300 ms over 9600 ms. The head goes half
  // way into the seventeenth, which is where a scrub lands as often as not.
  const grid = await noteGrid(h.page);
  assert.equal(grid.total, 9600, "the fixture's clock moved");
  assert.equal(grid.onsets[16], 4800, "the fixture's note grid moved");
  const at = 4950;
  await dropHead(h.page, at / grid.total);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(
    await h.page.evaluate(() => window.__lit()),
    -1,
    "a chord was marked for a head dropped inside one"
  );
  // On an attack there is nothing to wait out, so that note is marked.
  await dropHead(h.page, grid.onsets[20] / grid.total);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(
    await h.page.evaluate(() => window.__lit()),
    20,
    "a head dropped on an attack did not mark its note"
  );
  await dropHead(h.page, at / grid.total);
  await new Promise((r) => setTimeout(r, 300));

  // Play from there: the sound picks up where the head is but muted, and no
  // ink is lit while the remainder of that chord passes.
  await h.page.evaluate(() => (window.__sources.length = 0));
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await new Promise((r) => setTimeout(r, 60));
  const gap = await h.page.evaluate(() => ({
    lit: window.__lit(),
    mute: window.__mute(),
    offset: (window.__sources[0] || {}).offset,
  }));
  assert.equal(gap.mute, 0, "the remainder of the chord under the head sounds");
  assert.equal(gap.lit, -1, "ink lit during the silent gap: note " + gap.lit);
  assert.ok(
    Math.abs(gap.offset - at / 1000) <= 0.06,
    "the sound did not pick up under the head: " + gap.offset
  );

  // Past the next onset: the chord that is due sounds and lights.
  await new Promise((r) => setTimeout(r, 220));
  const landed = await h.page.evaluate(() => ({
    lit: window.__lit(),
    mute: window.__mute(),
  }));
  assert.equal(landed.lit, 17, "the due chord did not land: ink on " + landed.lit);
  assert.equal(landed.mute, 1, "the gain never came back");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A scrub while the tune sounds is answered the same way, and the silence it
// sets is its own: scrubbing in the middle of a resume gap does not wait out
// the gap it interrupted, it waits out the chord under the new head. What
// tells the two apart is the note that lights, one near the head that was
// dropped and not one near the point the tune was paused at. The grab also
// mutes the output for as long as the drag lasts (makeProgressDraggable),
// so the probe does not read at a fixed delay: it waits for the source that
// starts under the new head and reads the gap right then.
test("a scrub while the tune sounds waits out the chord under the new head", { skip }, async () => {
  const h = await open({ audioSpy: true, text: TIMING_FIXTURE });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await installAudioProbe(h.page);
  await pressPlay(h.page);
  const grid = await noteGrid(h.page);
  assert.equal(grid.onsets[25], 7500, "the fixture's note grid moved");
  // Pause squarely inside a note, so that the resume below schedules a gap of
  // its own for the scrub to override.
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
  // Resume and scrub in the same breath, well inside the resume's own gap: the
  // head goes half way into the twenty-sixth note (7500-7800 ms).
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await dropHead(h.page, 7650 / grid.total);
  const gap = await h.page.evaluate(
    () =>
      new Promise((resolve) => {
        const read = () => {
          const s = window.__sources[window.__sources.length - 1] || {};
          return { lit: window.__lit(), mute: window.__mute(), offset: s.offset };
        };
        const timer = setInterval(() => {
          const s = window.__sources[window.__sources.length - 1];
          if (s && Math.abs(s.offset - 7.65) <= 0.06) {
            clearInterval(timer);
            resolve(read());
          }
        }, 10);
        setTimeout(() => {
          clearInterval(timer);
          resolve(read());
        }, 5000);
      })
  );
  assert.equal(gap.mute, 0, "the chord under the new head is not waited out");
  assert.equal(gap.lit, -1, "ink lit during the silent gap: note " + gap.lit);
  assert.ok(
    Math.abs(gap.offset - 7.65) <= 0.06,
    "the sound did not pick up under the new head: " + gap.offset
  );
  // Past the onset the scrub was waiting for: the chord there sounds and
  // lights, and it is the head's neighbour, not the pause's.
  await new Promise((r) => setTimeout(r, 220));
  const landed = await h.page.evaluate(() => ({
    lit: window.__lit(),
    mute: window.__mute(),
  }));
  assert.equal(landed.lit, 26, "the due chord did not land: ink on " + landed.lit);
  assert.equal(landed.mute, 1, "the gain never came back");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// An ornament is more than one sound, and the rule above has to see all of
// them. Same shape as TIMING_FIXTURE, with a grace note on the third bar of
// the tune: quarters at a quarter of 100, so a note falls every 600 ms, the
// ornamented note is the ninth (4800 ms), its d sounds there and its own C a
// grace note later.
const ORNAMENT_FIXTURE = [
  "---",
  'title: "Ornament fixture"',
  "---",
  "",
  "A tune with an ornament in it, and two more so the player mounts as it does in the document.",
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
  "Four 4/4 bars of quarters at a quarter of 100: 9.6 seconds, a note every 600 ms, and a grace note on the ninth.",
  "",
  "```{.abc .play}",
  "X:1",
  "M:4/4",
  "L:1/8",
  "Q:1/4=100",
  "K:C",
  "C2D2E2F2 | G2A2B2c2 | {d}C2D2E2F2 | G2A2B2c2 |",
  "```",
  "",
].join("\n");

// A grace note sounds where its note is written and pushes the note itself
// back behind it, so an ornamented note holds two attacks and the silence in
// front of a resume must end at the second, not at the note after the group.
// Read as one attack, {d}C2 looked like a single note beginning at its d, and
// a head dropped in it waited the whole group out: the ornament AND the note
// it decorates passed muted, which is what "the grace note is not heard" was.
test("an ornament is not swallowed: the note under it lands on its own beat", { skip }, async () => {
  const h = await open({ audioSpy: true, text: ORNAMENT_FIXTURE });
  await clickToggle(h.page, 2);
  await h.page.waitForFunction(
    () => document.querySelector(".mdm-audio .abcjs-midi-start"),
    { timeout: 15000 }
  );
  await installAudioProbe(h.page);
  // Prime the tune and take it back to the top: the timings the marks are read
  // from are the primed ones.
  await pressPlay(h.page);
  await new Promise((r) => setTimeout(r, 400));
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .mdm-audio-stop").click()
  );
  await new Promise((r) => setTimeout(r, 250));
  const grid = await noteGrid(h.page);
  assert.equal(grid.total, 9600, "the fixture's clock moved");
  assert.equal(grid.onsets[8], 4800, "the fixture's note grid moved");

  // The head on the group's own moment, which is where its grace note sounds:
  // there is nothing to wait out, so that note is marked.
  await dropHead(h.page, grid.onsets[8] / grid.total);
  await new Promise((r) => setTimeout(r, 300));
  const onAttack = await h.page.evaluate(() => window.__lit());
  assert.ok(onAttack >= 0, "a head dropped on the ornament marked nothing");

  // The head inside the ornament: what comes first from there is the silence,
  // so nothing is marked until the note it decorates attacks.
  await dropHead(h.page, 4950 / grid.total);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(
    await h.page.evaluate(() => window.__lit()),
    -1,
    "a note was marked for a head dropped inside an ornament"
  );

  // Play from there: the remainder of the grace note passes muted.
  await h.page.evaluate(() => (window.__sources.length = 0));
  await h.page.evaluate(() =>
    document.querySelector(".mdm-audio .abcjs-midi-start").click()
  );
  await new Promise((r) => setTimeout(r, 60));
  const gap = await h.page.evaluate(() => ({
    lit: window.__lit(),
    mute: window.__mute(),
    offset: (window.__sources[0] || {}).offset,
  }));
  assert.equal(gap.mute, 0, "the remainder of the grace note sounds");
  assert.equal(gap.lit, -1, "ink lit during the silent gap: note " + gap.lit);
  assert.ok(
    Math.abs(gap.offset - 4.95) <= 0.06,
    "the sound did not pick up under the head: " + gap.offset
  );

  // The note the ornament decorates is due at 5100 ms, a grace note after the
  // group's moment and half a beat before the note after it. The gain comes
  // back for it and the ink lands on it: read as one attack, both waited for
  // 5400 and the note was never heard.
  await new Promise((r) => setTimeout(r, 200));
  const landed = await h.page.evaluate(() => ({
    lit: window.__lit(),
    mute: window.__mute(),
  }));
  assert.equal(landed.mute, 1, "the ornamented note was swallowed with its grace");
  assert.equal(
    landed.lit,
    onAttack,
    "the ornamented note did not land: ink on " + landed.lit
  );
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
