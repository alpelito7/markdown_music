// Exporting the audio of a score, driven in a real browser: the button under
// the headphones in a score's rail, the menu of formats it opens, the numbers
// the files are named by, and the bytes themselves. What the editor hands the
// host is what this file reads, through the same seam a real host sits on
// (the harness passes every posted message to window.__toHost).
//
// The arithmetic of the bytes is not here: MIDI and WAV are pinned in
// tests/audio-export.test.js, which needs no browser. What needs one is
// everything below: the rendering of the samples (abcjs primes an AudioBuffer
// and Node has no Web Audio), the count of the scores in a document longer
// than the viewport, and the rail.
// Run with: node --test --test-concurrency=1 tests/webview-audio-export.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const { open, skip } = require("./webview/helpers.js");

// For the one test that runs the real host on the other end of the wire:
// require("vscode") is the mock, as in extension-host.test.js and
// webview-memory.test.js.
const MOCK = path.join(__dirname, "mocks", "vscode.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "vscode") return MOCK;
  return origResolve.call(this, request, ...rest);
};
const vscode = require("vscode");
const ext = require("../vscode-mdm/extension.js");

// Two tunes, one with a title and one without, with prose between them, and a
// block of code that is not a score: the export counts fences, and a fence that
// is not music must not be one of them. It also keeps every test in this file
// on a document with both kinds of block, which is how a fault in the walk over
// the tree shows up here rather than only in the suites that read the example.
const TWO_SCORES = [
  "# Two tunes",
  "",
  "A paragraph before the first.",
  "",
  "```abc",
  "X:1",
  "T:Cooley's Reel",
  "M:4/4",
  "L:1/8",
  "K:Emin",
  "EBBA B2 EB|",
  "```",
  "",
  "Between them.",
  "",
  "```abc",
  "X:1",
  "M:6/8",
  "L:1/8",
  "K:G",
  "GAB d2 d|",
  "```",
  "",
  "And a block of code, which is not a tune:",
  "",
  "```python",
  "print('not a score')",
  "```",
  "",
].join("\n");

// A tune the extension has no instrument for, and one it has.
const VIOLIN = [
  "# A part for another instrument",
  "",
  "```abc",
  "X:1",
  "T:Not the piano",
  "M:4/4",
  "L:1/8",
  "%%MIDI program 40",
  "K:C",
  "CDEF|",
  "```",
  "",
].join("\n");

const NO_SCORES = ["# Prose alone", "", "Nothing here sounds.", ""].join("\n");

// A document with nothing that sounds in it and too long to be read at a
// press: the blocks are code, so a walk that finds none has to have gone all
// the way to the end to know it.
function longProse(count) {
  const out = ["# Nothing sounds here", ""];
  for (let n = 1; n <= count; n++) {
    out.push("Paragraph " + n + ", written so the blocks stand apart.", "");
    out.push("```python", "print(" + n + ")", "```", "");
  }
  return out.join("\n");
}

// Long enough that CodeMirror draws only some of it: what the export counts
// is the document and not the viewport.
function manyScores(count) {
  const out = ["# Many tunes", ""];
  for (let n = 1; n <= count; n++) {
    out.push("Paragraph " + n + ", written so the scores stand apart.", "");
    out.push("```abc", "X:1");
    if (n % 3 !== 0) out.push("T:Tune " + n);
    out.push("M:4/4", "L:1/8", "K:C", "CDEF|", "```", "");
  }
  return out.join("\n");
}

// A host on the other end of the wire, inside the page: it records the run and
// answers it, since the editor renders a score only once the one before it has
// been written. `opts.refuse` turns the run away at the start, `opts.failAt`
// answers that file with an error, as a host that could not write does.
async function installHost(page, opts) {
  await page.evaluate((options) => {
    window.__hostSaid = [];
    window.__toHost = function (message) {
      if (!message || message.type !== "exportAudio") return;
      window.__hostSaid.push(message.step + (message.number ? ":" + message.number : ""));
      if (message.step === "done") return;
      const reply =
        message.step === "start"
          ? { type: "exportAudio", id: message.id, ok: !options.refuse }
          : {
              type: "exportAudio",
              id: message.id,
              number: message.number,
              ok: options.failAt !== message.number,
              error: options.failAt === message.number ? "the disk is full" : undefined,
            };
      setTimeout(function () {
        window.postMessage(reply, "*");
      }, 0);
    };
  }, opts || {});
}

// Runs `what` in the page and hands back the messages the editor posted for
// that run, in order.
async function exported(page, what, args) {
  return page.evaluate(
    async (source, given) => {
      const before = window.__posts.length;
      // eslint-disable-next-line no-new-func
      await new Function("args", "return (" + source + ")(args)")(given);
      const posts = window.__posts.slice(before).filter((m) => m.type === "exportAudio");
      return posts.map((m) => {
        const out = {
          step: m.step,
          number: m.number,
          title: m.title,
          count: m.count,
          total: m.total,
          format: m.format,
          reason: m.reason,
          program: m.program,
          pitch: m.pitch,
          aborted: m.aborted,
          unread: m.unread,
        };
        if (m.bytes) {
          out.kind = m.bytes.constructor.name;
          out.length = m.bytes.length;
          out.head = String.fromCharCode.apply(null, Array.from(m.bytes.slice(0, 4)));
          out.mark = String.fromCharCode.apply(null, Array.from(m.bytes.slice(8, 12)));
          const view = new DataView(m.bytes.buffer, m.bytes.byteOffset, m.bytes.byteLength);
          if (out.head === "RIFF") {
            out.rate = view.getUint32(24, true);
            out.frames = (m.bytes.length - 44) / 4;
            let sum = 0;
            for (let i = 0; i < out.frames; i++) {
              const sample = view.getInt16(44 + i * 4, true) / 32767;
              sum += sample * sample;
            }
            out.rms = Math.sqrt(sum / out.frames);
          }
        }
        return out;
      });
    },
    what.toString(),
    args === undefined ? null : args
  );
}

const railOf = (page, n) =>
  page.evaluate((index) => {
    const chrome = document.querySelectorAll("#app .mdm-score .mdm-chrome")[index];
    return {
      buttons: Array.prototype.map.call(chrome.children, (el) => el.classList[0]),
      rows: Array.prototype.map.call(
        chrome.querySelectorAll(".mdm-audio-export .mdm-menu__item"),
        (el) => el.dataset.type + "=" + el.textContent
      ),
    };
  }, n);

test("a score's export offers MIDI and WAV in a menu that behaves like the toolbar's", { skip }, async () => {
  const h = await open({ text: TWO_SCORES, scores: 2 });
  const { page } = h;
  await installHost(page, {});
  assert.deepEqual((await railOf(page, 0)).buttons, [
    "mdm-copy",
    "mdm-audio-toggle",
    "mdm-audio-export",
  ]);
  assert.deepEqual((await railOf(page, 0)).rows, [
    "mdm-audio-export-midi=MIDI",
    "mdm-audio-export-wav=WAV",
  ]);
  // The block of code at the end of the fixture is a fence like a score's and
  // is not one: it carries the copy alone, and the export does not count it.
  assert.deepEqual(
    await page.evaluate(() =>
      Array.prototype.map.call(
        document.querySelectorAll("#app .mdm-chrome"),
        (chrome) => chrome.children.length
      )
    ),
    [3, 3, 1]
  );
  assert.equal(await page.evaluate(() => window.__mdm.documentScores().length), 2);

  const press = (selector) =>
    page.evaluate((sel) => {
      document.querySelector(sel).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, selector);

  // Put away until the button is pressed, and then held open: the rail of a
  // score is drawn under the pointer, and a menu that went with the pointer
  // could not be read, let alone pressed.
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector("#app .mdm-score .mdm-menu")).display),
    "none"
  );
  await press("#app .mdm-score .mdm-audio-export");
  const open1 = await page.evaluate(() => {
    const block = document.querySelector("#app .mdm-score");
    const menu = block.querySelector(".mdm-menu");
    const button = block.querySelector(".mdm-audio-export");
    const style = getComputedStyle(menu);
    const row = getComputedStyle(menu.querySelector(".mdm-menu__item"));
    const bar = document.querySelector("#app .mdm-toolbar .mdm-menu__item");
    const barRow = bar ? getComputedStyle(bar) : null;
    const m = menu.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const scroller = document.querySelector("#app .cm-scroller").getBoundingClientRect();
    const middle = (el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit && hit.closest("[class]") ? hit.closest("[class]").classList[0] : null;
    };
    return {
      display: style.display,
      face: row.fontFamily,
      barFace: barRow ? barRow.fontFamily : null,
      size: row.fontSize,
      adjust: row.fontSizeAdjust,
      // Beside the rail and not under it: the panel keeps clear of the
      // buttons, wherever in the pane the score stands.
      leftOfTheButton: m.right <= b.left,
      insideThePane: m.left >= scroller.left && m.right <= scroller.right,
      levelWithTheButton: Math.abs(m.top - b.top) <= 1,
      copyStillPressable: middle(block.querySelector(".mdm-copy")),
      phonesStillPressable: middle(block.querySelector(".mdm-audio-toggle")),
      // A row inside the panel it is drawn in, and no room kept for a
      // scrollbar two rows never need: both are what the panel inherits from
      // the toolbar's own menus, which are tall and hold buttons.
      rowOverhang: Math.round(menu.querySelector(".mdm-menu__item").getBoundingClientRect().right - m.right),
      gutter: menu.offsetWidth - menu.clientWidth,
    };
  });
  assert.equal(open1.display, "block");
  assert.equal(open1.face, open1.barFace, "the rows are not set in the chrome's face");
  assert.equal(open1.size, "13px");
  assert.equal(open1.adjust, "none", "the prose's size adjustment reached the rows");
  assert.ok(open1.leftOfTheButton, "the menu is not beside the rail");
  assert.ok(open1.insideThePane, "the menu hangs outside the pane");
  assert.ok(open1.levelWithTheButton, "the menu is not level with its button");
  assert.equal(open1.copyStillPressable, "mdm-copy");
  assert.equal(open1.phonesStillPressable, "mdm-audio-toggle");
  assert.ok(open1.rowOverhang <= 0, "a row stands " + open1.rowOverhang + "px past the panel");
  assert.ok(open1.gutter <= 2, "the panel keeps " + open1.gutter + "px for a scrollbar it never uses");

  // The pointer leaving the block does not take the menu with it.
  await page.mouse.move(10, 10);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector("#app .mdm-score .mdm-menu")).display),
    "block",
    "the menu went away with the pointer"
  );

  // Escape closes it, as it closes the toolbar's.
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector("#app .mdm-score .mdm-menu")).display),
    "none"
  );

  // A press on the copy of the same rail closes it too: before this, a click
  // on the rail stopped short of the document, so nothing closed the menus.
  await press("#app .mdm-score .mdm-audio-export");
  await press("#app .mdm-score .mdm-copy");
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector("#app .mdm-score .mdm-menu")).display),
    "none",
    "the copy left the menu open"
  );

  // And so does opening a menu of the toolbar.
  await press("#app .mdm-score .mdm-audio-export");
  await press('#app .mdm-toolbar [data-type="mdm-theme"]');
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector("#app .mdm-score .mdm-menu")).display),
    "none",
    "the toolbar's menu opened over an open rail menu"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the export of a score is drawn with the toolbar's export glyph", { skip }, async () => {
  const h = await open({ text: TWO_SCORES, scores: 2 });
  const same = await h.page.evaluate(() => {
    const rail = document.querySelector("#app .mdm-score .mdm-audio-export svg");
    const bar = document.querySelector('#app .mdm-toolbar [data-type="mdm-export"] svg');
    return {
      rail: rail.innerHTML.replace(/\s+/g, " ").trim(),
      bar: bar.innerHTML.replace(/\s+/g, " ").trim(),
      label: document.querySelector("#app .mdm-score .mdm-audio-export").getAttribute("aria-label"),
    };
  });
  assert.equal(same.rail, same.bar, "the rail draws another arrow than the bar");
  assert.equal(same.label, "Export audio");
  await h.close();
});

test("a score's number is where it is written, on screen or not", { skip }, async () => {
  const h = await open({ text: manyScores(30), scores: 3 });
  const { page } = h;
  await installHost(page, {});
  const drawn = await page.evaluate(() => document.querySelectorAll("#app .mdm-score").length);
  assert.ok(drawn < 30, "the fixture was meant to be longer than the viewport, " + drawn + " drawn");
  assert.equal(await page.evaluate(() => window.__mdm.documentScores().length), 30);

  const posts = await exported(page, () => window.__mdm.exportAudio("midi"));
  assert.equal(posts[0].step, "start");
  assert.deepEqual([posts[0].count, posts[0].total, posts[0].format], [30, 30, "midi"]);
  const files = posts.filter((m) => m.step === "file");
  assert.equal(files.length, 30);
  assert.deepEqual(files.map((m) => m.number), Array.from({ length: 30 }, (_, i) => i + 1));
  // Every third score has no T:, and a file for it carries no title rather
  // than the title of the one before.
  assert.deepEqual(
    files.map((m) => m.title),
    Array.from({ length: 30 }, (_, i) => ((i + 1) % 3 === 0 ? null : "Tune " + (i + 1)))
  );
  assert.equal(posts[posts.length - 1].step, "done");

  // A score's own button asks for its own number, and the scores of this
  // fixture are written from the same source, so the number cannot be read
  // off the tune.
  const railPosts = await exported(page, () => {
    const block = document.querySelectorAll("#app .mdm-score")[2];
    block.querySelector('[data-type="mdm-audio-export-midi"]').dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    return new Promise((resolve) => {
      const wait = setInterval(() => {
        if (window.__posts.some((m) => m.type === "exportAudio" && m.step === "done" && m.id !== "r1")) {
          clearInterval(wait);
          resolve();
        }
      }, 50);
    });
  });
  const one = railPosts.filter((m) => m.step === "file");
  assert.equal(one.length, 1, "a score's button exported " + one.length + " files");
  assert.equal(one[0].number, 3, "the third score on screen did not report itself as the third");
  assert.equal(railPosts[0].total, 1);
  assert.equal(railPosts[0].count, 30, "the document's count is not what the run reports");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a document too long to have been read yet is still counted whole", { skip }, async () => {
  // CodeMirror parses in the background with a budget per frame, so the tree it
  // has to hand is short for a while after a long document arrives: measured
  // here, 2000 scores (about 200KB) leave it at 1489 the moment the edit lands.
  // The export reads the tree with ensureSyntaxTree, which finishes the parse
  // before it counts, or says it could not (the run then tells the host, which
  // asks the reader to try again rather than writing a part of the document).
  const h = await open({ text: NO_SCORES, scores: 0 });
  const { page } = h;
  const counted = await page.evaluate((many) => {
    const CM = window.__mdm.CM;
    const view = window.__mdm.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: many } });
    let parsed = 0;
    CM.syntaxTree(view.state).iterate({
      enter: function (ref) {
        if (ref.name === "FencedCode") {
          parsed++;
          return false;
        }
      },
    });
    return { parsed: parsed, counted: window.__mdm.documentScores().length };
  }, manyScores(2000));
  assert.ok(
    counted.parsed < 2000,
    "the fixture was meant to outrun the parser; it read all " + counted.parsed + " at once"
  );
  assert.equal(counted.counted, 2000, "the export counted only what had been parsed so far");
  await h.close();
});

test("the bytes of a file cross as a typed array", { skip }, async () => {
  const h = await open({ text: TWO_SCORES, scores: 2 });
  const { page } = h;
  await installHost(page, {});
  const midi = await exported(page, () => window.__mdm.exportAudio("midi", 1));
  const file = midi.find((m) => m.step === "file");
  // A DataView, an AudioBuffer or a Blob would look like an object here and
  // reach the host as an empty one: VS Code carries an ArrayBuffer and the
  // eleven typed arrays over its wire, and nothing else.
  assert.equal(file.kind, "Uint8Array");
  assert.equal(file.head, "MThd");
  assert.ok(file.length > 40);

  const wav = await exported(page, () => window.__mdm.exportAudio("wav", 2));
  const sound = wav.find((m) => m.step === "file");
  assert.equal(sound.kind, "Uint8Array");
  assert.equal(sound.head, "RIFF");
  assert.equal(sound.mark, "WAVE");
  assert.ok(sound.rms > 0, "the WAV is silence");
  await h.close();
});

test("a WAV is the tune the player plays, sample for sample", { skip }, async () => {
  const h = await open({ text: TWO_SCORES, scores: 2, audioLife: true });
  const { page } = h;
  await installHost(page, {});
  // The player primes the whole tune into a buffer before it sounds a note;
  // that buffer is what the file has to carry.
  await page.evaluate(() =>
    document.querySelectorAll("#app .mdm-audio-toggle")[1].dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    )
  );
  await page.waitForFunction(() => document.querySelector(".mdm-audio .abcjs-midi-start"), {
    timeout: 20000,
  });
  await page.evaluate(() => document.querySelector(".mdm-audio .abcjs-midi-start").click());
  await page.waitForFunction(
    () => {
      const p = window.__mdm.player;
      return !!(p && p.controller && p.controller.midiBuffer && p.controller.midiBuffer.audioBuffers.length);
    },
    { timeout: 25000 }
  );
  const played = await page.evaluate(() => {
    const buffer = window.__mdm.player.controller.midiBuffer.audioBuffers[0];
    const samples = buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return {
      frames: buffer.length,
      rate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      rms: Math.sqrt(sum / samples.length),
    };
  });
  assert.ok(played.frames > 0 && played.rms > 0, "the player rendered nothing to compare with");

  const posts = await exported(page, () => window.__mdm.exportAudio("wav", 2));
  const file = posts.find((m) => m.step === "file");
  assert.ok(file, "no file came out of the export");
  assert.equal(file.rate, played.rate, "the WAV is not at the rate the output runs at");
  assert.equal(file.frames, played.frames, "the WAV is not as long as what the player primed");
  // The difference is the 16 bits it was written in, and nothing else: the
  // tempo, the soundfont and its volume are the player's own.
  assert.ok(
    Math.abs(file.rms - played.rms) / played.rms < 0.001,
    "the file is " + file.rms.toFixed(5) + " against the player's " + played.rms.toFixed(5)
  );

  // The player it was exported beside is left alone: still open, still
  // sounding, on the same context and the same controller.
  const after = await page.evaluate(() => ({
    sounding: !!document.querySelector(".mdm-audio .abcjs-midi-start.abcjs-pushed"),
    open: !!window.__mdm.player,
    contexts: window.__contexts.length,
    state: window.__contexts[0].state,
  }));
  assert.equal(after.open, true, "the export closed the player");
  assert.equal(after.sounding, true, "the export stopped the sound");
  assert.equal(after.contexts, 1, "the export made an output of its own");
  assert.equal(after.state, "running");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a MIDI export sounds nothing and opens no output", { skip }, async () => {
  const h = await open({ text: TWO_SCORES, scores: 2, audioLife: true });
  const { page } = h;
  await installHost(page, {});
  const asked = [];
  page.on("request", (r) => asked.push(r.url()));
  const posts = await exported(page, () => window.__mdm.exportAudio("midi"));
  assert.equal(posts.filter((m) => m.step === "file").length, 2);
  assert.equal(
    await page.evaluate(() => window.__contexts.length),
    0,
    "a MIDI export opened an audio output"
  );
  assert.equal(
    await page.evaluate(() => window.__pilots.length),
    0,
    "a MIDI export started the pilot tone"
  );
  assert.deepEqual(
    asked.filter((url) => url.indexOf("soundfont") !== -1),
    [],
    "a MIDI export fetched piano samples"
  );
  await h.close();
});

test("an export that needs no player lets the output go back to sleep", { skip }, async () => {
  const h = await open({ text: TWO_SCORES, scores: 2, audioLife: true });
  const { page } = h;
  await installHost(page, {});
  await exported(page, () => window.__mdm.exportAudio("wav", 1));
  await page.waitForFunction(() => window.__contexts[0] && window.__contexts[0].state === "suspended", {
    timeout: 10000,
  });
  assert.equal(await page.evaluate(() => window.__contexts.length), 1);
  await h.close();
});

test("an export that crosses the idle minute does not spend it", { skip }, async () => {
  // The minute after the last player closes is one timer, and an export that
  // is still running when it fires used to swallow it: the run held the output
  // (a suspended context never returns from the resume prime waits on), the
  // timer was gone, and the pilot tone went on sounding into an editor nobody
  // was playing anything in until another player was opened and closed.
  const h = await open({ text: TWO_SCORES, scores: 2, audioLife: true });
  const { page } = h;
  await installHost(page, {});
  await page.evaluate(() =>
    document.querySelector("#app .mdm-audio-toggle").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    )
  );
  await page.waitForFunction(() => document.querySelector(".mdm-audio .abcjs-midi-start"), {
    timeout: 20000,
  });
  await page.evaluate(() =>
    document.querySelector("#app .mdm-audio-toggle").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    )
  );
  await page.waitForFunction(() => window.__idle.length === 1, { timeout: 10000 });

  const state = await page.evaluate(async () => {
    // The run is held open by the host, which answers the start and then takes
    // its time over the file, so the minute can be fired in the middle of it.
    let release = null;
    window.__toHost = function (message) {
      if (!message || message.type !== "exportAudio" || message.step === "done") return;
      if (message.step === "start") {
        window.postMessage({ type: "exportAudio", id: message.id, ok: true }, "*");
        return;
      }
      release = function () {
        window.postMessage(
          { type: "exportAudio", id: message.id, number: message.number, ok: true },
          "*"
        );
      };
    };
    // The spy catches every timer of half a minute or more, so the run's own
    // waits for the host are in this list beside the idle minute. The one
    // armed by closing the player is the one that was there before the run.
    const idleTimer = window.__idle[0];
    const run = window.__mdm.exportAudio("wav", 1);
    await new Promise((r) => setTimeout(r, 400));
    const before = window.__idle.length;
    idleTimer.fn();
    const armedAgain = window.__idle.length - before;
    if (release) release();
    await run;
    return { armedAgain: armedAgain, afterRun: window.__idle.length };
  });
  assert.equal(state.armedAgain, 1, "the minute the export crossed was swallowed");

  // And the minute that was started again does put the output to sleep.
  await page.evaluate(() => window.__idle.forEach((t) => t.fn()));
  await page.waitForFunction(() => window.__contexts[0].state === "suspended", { timeout: 10000 });
  assert.equal(
    await page.evaluate(() => window.__pilots.every((p) => p.stopped)),
    true,
    "the pilot tone is still sounding"
  );
  await h.close();
});

test("a cancelled run stops at once instead of waiting out its answer", { skip }, async () => {
  // The host ends a cancelled run and drops the message already on its way, so
  // the page is left standing on an answer that is never coming. Without the
  // cancel waking that wait, the run held the output for the whole minute of
  // AUDIO_ACK_MS before it gave up.
  const h = await open({ text: TWO_SCORES, scores: 2 });
  const { page } = h;
  const timing = await page.evaluate(async () => {
    window.__toHost = function (message) {
      if (!message || message.type !== "exportAudio") return;
      if (message.step === "start") {
        window.postMessage({ type: "exportAudio", id: message.id, ok: true }, "*");
        return;
      }
      // A file arrives and is never acknowledged; the reader presses Cancel.
      if (message.step === "file") {
        setTimeout(function () {
          window.postMessage({ type: "exportAudio", id: message.id, cancel: true }, "*");
        }, 50);
      }
    };
    const started = performance.now();
    const before = window.__posts.length;
    await window.__mdm.exportAudio("midi");
    const posts = window.__posts.slice(before).filter((m) => m.type === "exportAudio");
    return {
      took: performance.now() - started,
      steps: posts.map((m) => m.step),
      aborted: posts[posts.length - 1].aborted,
    };
  });
  assert.ok(timing.took < 5000, "the run took " + Math.round(timing.took) + "ms to give up");
  assert.deepEqual(timing.steps, ["start", "file", "done"], "the run went on after the cancel");
  assert.equal(timing.aborted, true);
  await h.close();
});

test("a score that cannot be read is skipped, and the scores after it are written", { skip }, async () => {
  const h = await open({ text: TWO_SCORES, scores: 2 });
  const { page } = h;
  await installHost(page, {});
  const posts = await exported(page, () => {
    // Everything before the synth is synchronous, so a tune abcjs cannot read
    // throws where the run would have carried it: the seam is stood in for
    // here, since abcjs takes even nonsense without complaining.
    const real = window.MDM_AUDIO.midiBytes;
    let first = true;
    window.MDM_AUDIO.midiBytes = function () {
      if (first) {
        first = false;
        throw new Error("no tune in there");
      }
      return real.apply(null, arguments);
    };
    return window.__mdm.exportAudio("midi").then(function () {
      window.MDM_AUDIO.midiBytes = real;
    });
  });
  const skipped = posts.filter((m) => m.step === "skip");
  const files = posts.filter((m) => m.step === "file");
  assert.equal(skipped.length, 1, "the score that threw was not skipped");
  assert.equal(skipped[0].reason, "failed");
  assert.deepEqual(files.map((m) => m.number), [2], "the score after it was not written");
  assert.equal(posts[posts.length - 1].step, "done");
  assert.equal(posts[posts.length - 1].aborted, false, "one bad score ended the whole run");
  await h.close();
});

test("a score the piano cannot sound is named, and nothing is fetched for it", { skip }, async () => {
  const h = await open({ text: VIOLIN, scores: 1 });
  const { page } = h;
  await installHost(page, {});
  const asked = [];
  page.on("request", (r) => asked.push(r.url()));
  const wav = await exported(page, () => window.__mdm.exportAudio("wav"));
  const skipped = wav.find((m) => m.step === "skip");
  assert.ok(skipped, "the score was not skipped");
  assert.equal(skipped.reason, "instrument");
  assert.equal(skipped.program, 40);
  assert.equal(skipped.title, "Not the piano");
  assert.equal(wav.filter((m) => m.step === "file").length, 0);
  assert.deepEqual(
    asked.filter((url) => url.indexOf("violin") !== -1),
    [],
    "a sample the extension does not carry was asked for anyway"
  );
  // The MIDI of the same score is written: it carries the program number and
  // says nothing about which samples the editor happens to have.
  const midi = await exported(page, () => window.__mdm.exportAudio("midi"));
  const file = midi.find((m) => m.step === "file");
  assert.ok(file && file.head === "MThd");
  await h.close();
});

test("a document with no score renders nothing and says how many it has", { skip }, async () => {
  const h = await open({ text: NO_SCORES, scores: 0 });
  const { page } = h;
  await installHost(page, {});
  const posts = await exported(page, () => window.__mdm.exportAudio("wav"));
  assert.equal(posts.length, 2, "more than a start and a done was posted");
  assert.deepEqual([posts[0].step, posts[0].count, posts[0].total], ["start", 0, 0]);
  assert.equal(posts[0].unread, false, "the tree was read; there are no scores to find");
  assert.equal(posts[1].step, "done");
  await h.close();
});

test("a run the host turns away renders nothing", { skip }, async () => {
  const h = await open({ text: TWO_SCORES, scores: 2, audioLife: true });
  const { page } = h;
  await installHost(page, { refuse: true });
  const asked = [];
  page.on("request", (r) => asked.push(r.url()));
  const posts = await exported(page, () => window.__mdm.exportAudio("wav"));
  assert.deepEqual(posts.map((m) => m.step), ["start", "done"]);
  assert.deepEqual(
    asked.filter((url) => url.indexOf("soundfont") !== -1),
    [],
    "the editor rendered a score for a host that had said no"
  );
  await h.close();
});

test("a file the host could not write ends the run there", { skip }, async () => {
  const h = await open({ text: manyScores(4), scores: 3 });
  const { page } = h;
  await installHost(page, { failAt: 2 });
  const posts = await exported(page, () => window.__mdm.exportAudio("midi"));
  const files = posts.filter((m) => m.step === "file");
  assert.deepEqual(files.map((m) => m.number), [1, 2], "the run went on after a file was refused");
  const done = posts[posts.length - 1];
  assert.equal(done.step, "done");
  assert.equal(done.aborted, true, "the run ended as though everything had been written");
  await h.close();
});

test("a second export asked for while one is in flight does not strand the first", { skip }, async () => {
  // The host turns the second away, and the first has to go on hearing its own
  // answers. They are told apart by the id the run carries: with only "the run
  // that is open" to go by, the first run's acknowledgements went to the
  // second and it sat out its own timeout before giving up.
  const h = await open({ text: TWO_SCORES, scores: 2 });
  const { page } = h;
  await page.evaluate(() => {
    let started = 0;
    window.__toHost = function (message) {
      if (!message || message.type !== "exportAudio" || message.step === "done") return;
      const reply =
        message.step === "start"
          ? { type: "exportAudio", id: message.id, ok: ++started === 1 }
          : { type: "exportAudio", id: message.id, number: message.number, ok: true };
      // The second run is answered first, which is what made the first run's
      // answers go astray.
      setTimeout(function () {
        window.postMessage(reply, "*");
      }, message.step === "start" && started === 1 ? 30 : 0);
    };
  });
  const posts = await page.evaluate(async () => {
    const before = window.__posts.length;
    const first = window.__mdm.exportAudio("midi");
    const second = window.__mdm.exportAudio("midi");
    await Promise.all([first, second]);
    return window.__posts.slice(before).filter((m) => m.type === "exportAudio").map((m) => ({
      id: m.id,
      step: m.step,
      number: m.number,
    }));
  });
  const runs = {};
  posts.forEach((m) => {
    runs[m.id] = runs[m.id] || [];
    runs[m.id].push(m.step + (m.number ? ":" + m.number : ""));
  });
  const ids = Object.keys(runs);
  assert.equal(ids.length, 2, "the two runs did not keep their own names");
  const [went, turned] = ids.map((id) => runs[id]);
  assert.deepEqual(went, ["start", "file:1", "file:2", "done"], "the run the host took did not finish");
  assert.deepEqual(turned, ["start", "done"], "the run the host turned away wrote something");
  await h.close();
});

test("an export runs to its end without a single animation frame", { skip }, async () => {
  // A panel that is not on screen runs no frames at all, and a reader who
  // changes tab in the middle of an export would otherwise leave the run
  // standing there for good, holding the host's notification and its lock.
  const h = await open({ text: TWO_SCORES, scores: 2 });
  const { page } = h;
  await installHost(page, {});
  await page.evaluate(() => {
    window.requestAnimationFrame = function () {
      return 0;
    };
  });
  const posts = await exported(page, () => window.__mdm.exportAudio("midi"));
  assert.equal(posts.filter((m) => m.step === "file").length, 2);
  assert.equal(posts[posts.length - 1].step, "done");
  await h.close();
});

// ---- The two halves together ----

// A file open in the editor, with the real extension.js answering it: the host
// resolves a panel, the page comes up on the settings the host wrote into its
// HTML, and every message crosses both ways from then on (the pattern of
// webview-memory.test.js).
async function openFile(provider, uri) {
  let page = null;
  let receive = null;
  let dispose = null;
  const panel = {
    webview: {
      asWebviewUri: (u) => u,
      cspSource: "vscode-resource:",
      postMessage(msg) {
        if (!page) return Promise.resolve(false);
        return page.evaluate((m) => window.postMessage(m, "*"), msg).then(
          () => true,
          () => false
        );
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
  const settings = JSON.parse(/window\.MDM_SETTINGS = (\{.*?\});/.exec(panel.webview.html)[1]);
  const h = await open({
    seed: { settings },
    scores: 2,
    toHost: (msg, p) => {
      page = p;
      // What VS Code's own wire does and puppeteer's does not: a typed array
      // is carried as bytes rather than turned into an object keyed by index.
      // Rebuilt here so the host is handed what it would really be handed. A
      // DataView, which VS Code does NOT carry, arrives as an empty object and
      // stays one, so the host still refuses it.
      if (msg && msg.bytes && !(msg.bytes instanceof Uint8Array)) {
        const keys = Object.keys(msg.bytes);
        const bytes = new Uint8Array(keys.length);
        keys.forEach((k) => {
          bytes[Number(k)] = msg.bytes[k];
        });
        msg = Object.assign({}, msg, { bytes: bytes });
      }
      return receive(msg);
    },
  });
  return {
    page: h.page,
    errors: h.errors,
    close: async () => {
      dispose();
      await h.close();
    },
  };
}

test("a score's own button writes its file beside the document, end to end", { skip }, async () => {
  vscode._reset();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-audio-e2e-"));
  const file = path.join(tmp, "two tunes.mdm");
  fs.writeFileSync(file, TWO_SCORES);
  const uri = "file://" + file;
  vscode._state.documents.set(uri, TWO_SCORES);
  ext.activate({ subscriptions: [], extensionUri: vscode.Uri.file("/ext"), globalState: vscode._memento() });
  const providers = vscode._state.registeredProviders;
  const h = await openFile(providers[providers.length - 1].provider, uri);
  try {
    // The first score, from its own rail: the menu, then MIDI.
    await h.page.evaluate(() => {
      const block = document.querySelector("#app .mdm-score");
      block.querySelector(".mdm-audio-export").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      block
        .querySelector('[data-type="mdm-audio-export-midi"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const wanted = path.join(tmp, "two tunes 1 - Cooley's Reel.mid");
    const until = Date.now() + 20000;
    while (!fs.existsSync(wanted) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(
      fs.existsSync(wanted),
      "nothing was written; the folder holds " + JSON.stringify(fs.readdirSync(tmp))
    );
    const bytes = fs.readFileSync(wanted);
    assert.equal(bytes.slice(0, 4).toString("latin1"), "MThd");
    assert.ok(bytes.length > 40);
    // The name carries the score's place and its title, and only that score
    // was written.
    assert.deepEqual(
      fs.readdirSync(tmp).sort(),
      ["two tunes 1 - Cooley's Reel.mid", "two tunes.mdm"]
    );
    // And the reader is told, with the button that opens it.
    await new Promise((r) => setTimeout(r, 200));
    const said = vscode._state.infoMessages.map((m) => m.message);
    assert.ok(
      said.some((m) => m.indexOf("two tunes 1 - Cooley's Reel.mid") !== -1),
      "the host said " + JSON.stringify(said)
    );
    assert.deepEqual(vscode._state.errorMessages, []);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The panel of the toolbar's export button, which is the other half of the
// same feature: the rail writes one score and this writes them all, and the
// two branches (the document, and the audio of the scores in it) are told
// apart by the headers over their rows.
const exportPanel = (page) =>
  page.evaluate(() => {
    const btn = document.querySelector('#app button[data-type="mdm-export"]');
    // A press on an open button shuts it, so a panel already open is shut
    // first: every call of this leaves the panel open and freshly read.
    if (btn.parentElement.classList.contains("mdm-toolbar__item--open")) btn.click();
    btn.click();
    const panel = document.querySelector("#app .mdm-toolbar__item--open .mdm-menu");
    return Array.prototype.map.call(panel.children, (el) => ({
      kind: el.className.replace("mdm-menu__", ""),
      text: el.textContent,
      type: el.dataset.type || null,
      off: el.disabled === true,
    }));
  });

test("the export panel names its two branches, and audio is one file per score", { skip }, async () => {
  const h = await open({ text: TWO_SCORES, scores: 2 });
  const { page } = h;
  await installHost(page, {});
  assert.deepEqual(await exportPanel(page), [
    { kind: "head", text: "Document", type: null, off: false },
    { kind: "item", text: "HTML", type: "mdm-export-html", off: false },
    { kind: "item", text: "PDF", type: "mdm-export-pdf", off: false },
    { kind: "item", text: "HTML + PDF", type: "mdm-export-both", off: false },
    { kind: "head", text: "Audio", type: null, off: false },
    { kind: "note", text: "one file per score", type: null, off: false },
    { kind: "item", text: "MIDI", type: "mdm-export-midi", off: false },
    { kind: "item", text: "WAV", type: "mdm-export-wav", off: false },
  ]);
  // A header is not something to press: it reaches no click handler of its
  // own and takes no pointer, so a press aimed at it lands on the panel.
  const inert = await page.evaluate(() => {
    const head = document.querySelectorAll("#app .mdm-toolbar .mdm-menu__head")[1];
    const box = head.getBoundingClientRect();
    const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { tag: head.tagName, hit: at.className };
  });
  assert.equal(inert.tag, "DIV");
  assert.ok(/mdm-menu\b/.test(inert.hit), "a header took the pointer: " + inert.hit);

  // And the row under it writes every score of the document, not the one the
  // caret is in.
  const posts = await exported(page, () =>
    new Promise((resolve) => {
      document.querySelector('#app button[data-type="mdm-export-midi"]').click();
      const wait = setInterval(() => {
        if (window.__posts.some((m) => m.type === "exportAudio" && m.step === "done")) {
          clearInterval(wait);
          resolve();
        }
      }, 50);
    })
  );
  assert.equal(posts[0].format, "midi");
  assert.equal(posts[0].total, 2, "the toolbar exported " + posts[0].total + " of the two scores");
  assert.deepEqual(
    posts.filter((m) => m.step === "file").map((m) => m.number),
    [1, 2]
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("with no score to write, the audio rows grey out and the document's do not", { skip }, async () => {
  const h = await open({ text: NO_SCORES, scores: 0 });
  const { page } = h;
  await installHost(page, {});
  const rows = (panel) => panel.filter((e) => e.kind.startsWith("item"));
  const shut = await exportPanel(page);
  assert.deepEqual(
    rows(shut).map((e) => e.type + (e.off ? " off" : "")),
    [
      "mdm-export-html",
      "mdm-export-pdf",
      "mdm-export-both",
      "mdm-export-midi off",
      "mdm-export-wav off",
    ]
  );
  // Greyed at the weight of a button of the bar with nothing to do, which is
  // one declaration in the stylesheet for both.
  const weights = await page.evaluate(() => {
    const row = document.querySelector('#app .mdm-toolbar button[data-type="mdm-export-midi"]');
    const undo = document.querySelector('#app .mdm-toolbar button[data-type="undo"]');
    return {
      row: getComputedStyle(row).opacity,
      undo: getComputedStyle(undo).opacity,
      pointer: getComputedStyle(row).pointerEvents,
    };
  });
  assert.equal(weights.row, "0.35");
  assert.equal(weights.undo, weights.row, "the row and the greyed button of the bar differ");
  assert.equal(weights.pointer, "none");
  // And it takes no press: nothing is asked of the host at all.
  const posts = await exported(page, () =>
    new Promise((resolve) => {
      document.querySelector('#app button[data-type="mdm-export-midi"]').click();
      setTimeout(resolve, 200);
    })
  );
  assert.deepEqual(posts, [], "a greyed row started a run");

  // The document gains a score: the rows come back when the panel is next
  // opened, because what a row can do is read then and not when it was built.
  await page.evaluate(() => {
    const view = window.__mdm.view;
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\n```abc\nX:1\nK:C\nCDEF|\n```\n" },
    });
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(
    rows(await exportPanel(page)).map((e) => e.off),
    [false, false, false, false, false]
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a document too long to read in the time the panel has keeps its rows live", { skip }, async () => {
  // Greying says "this document has nothing to write", and the only thing
  // that knows is the tree. The panel gives the parser 100 ms, which is the
  // press that opens it; a document it cannot reach the end of in that time
  // is not a document with no score, so the rows stay live and a press on one
  // is answered by the host, which names what a score is.
  //
  // Measured here at 950 KB: the parse stops at the 100 ms it is given and
  // needs about 230 ms more (155 KB finishes in 55). The document arrives and
  // the panel opens inside one task, so no background parsing can happen in
  // between and the fixture cannot be read in time by accident.
  const h = await open({ text: NO_SCORES, scores: 0 });
  const { page } = h;
  const out = await page.evaluate((text) => {
    const CM = window.__mdm.CM;
    const view = window.__mdm.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    const btn = document.querySelector('#app button[data-type="mdm-export"]');
    btn.click();
    return {
      unread: !CM.ensureSyntaxTree(view.state, view.state.doc.length, 0),
      rows: Array.prototype.map.call(
        document.querySelectorAll("#app .mdm-toolbar__item--open .mdm-menu__item"),
        (el) => el.dataset.type + (el.disabled ? " off" : "")
      ),
    };
  }, longProse(12000));
  assert.equal(out.unread, true, "the fixture was meant to outrun the parser");
  assert.deepEqual(out.rows, [
    "mdm-export-html",
    "mdm-export-pdf",
    "mdm-export-both",
    "mdm-export-midi",
    "mdm-export-wav",
  ]);
  assert.deepEqual(h.errors, []);
  await h.close();
});
