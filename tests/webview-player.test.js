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
  typedIntoFirstParagraph,
  open,
  update,
  lastEdit,
  skip,
  docText,
  posOf,
  setSelection,
} = require("./webview/helpers.js");

// Shared helpers: the score widgets in document order, and the state the
// player tests keep asserting.
async function playerState(page) {
  return page.evaluate(() => {
    const scores = Array.from(document.querySelectorAll("#app .mdm-score"));
    return {
      bars: document.querySelectorAll(".mdm-audio").length,
      widgets: document.querySelectorAll(".mdm-audio .abcjs-inline-audio").length,
      onIndex: scores.findIndex((b) => b.querySelector(".mdm-audio")),
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
      // "Expanded" used to be Vditor's open block; now it is the source
      // lines showing, which the toggle must not bring up.
      expanded: !!document.querySelector("#app .cm-line.mdm-src-line"),
      play: !!bar.querySelector(".abcjs-midi-start"),
      loop: !!bar.querySelector(".abcjs-midi-loop"),
      progress: !!bar.querySelector(".abcjs-midi-progress-background"),
      // The bar lives in the widget, right under the engraving.
      insidePreview:
        !!bar.closest(".mdm-score") &&
        bar.previousElementSibling.matches("code.language-abc"),
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
  await h.page.waitForFunction(
    () => {
      const bar = document.querySelector(".mdm-audio");
      const block = bar && bar.closest(".mdm-score");
      return (
        block &&
        bar.querySelector(".abcjs-inline-audio") &&
        /A\n?$/.test(block.getAttribute("data-mdm-source"))
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

// Opens the player on a score whose block is OPEN for editing (a click on the
// drawing puts the caret in the ABC source, which shows above the engraving),
// and leaves the bar in view: with the source showing above it, the bar can
// sit below the fold, and a click aimed there lands outside the editor
// instead (which blurs it, and looks exactly like the bug this fixes).
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
    const tipped = (el) =>
      el.classList.contains("mdm-tip") && el.classList.contains("mdm-tip--n");
    return {
      startLabel: start.getAttribute("aria-label"),
      loopLabel: loop.getAttribute("aria-label"),
      // A native title never shows inside the webview, so the CSS tooltip of
      // this editor is what labels them; carrying both would show two.
      startTitle: start.getAttribute("title"),
      loopTitle: loop.getAttribute("title"),
      // The editor's own tooltip (.mdm-tip, drawn from aria-label), north.
      tooltipped: tipped(start) && tipped(loop),
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
  assert.equal(sizes.toggle, 16);
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
