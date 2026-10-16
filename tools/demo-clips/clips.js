// The clips, one object each, written as beats. There are three: the tour, on
// demo.mdm, the Markdown one, on markdown.mdm, and the one of the score mode,
// on score-navigation.mdm. The README carries the first two, and the third
// from the day it has a section for the mode.
//
// A loop has no seam: a clip ends on the frame it opened on, or ends
// elsewhere and dissolves back into its first frame as the tour does, and
// record.js measures that the two ends agree (rig.js, seam).
//
// How the pointer moves is the rig's (motion.js): a move takes the time its
// distance makes it take, and a press comes a tenth of a second after the
// pointer arrives (rig.pressAt). What a take decides is where the pointer
// waits, and it waits in three places only. The takes used to wait a third
// to a half of a second before every click, whatever it was on, and stand
// still through every hold after one; the owner found the pointer did not
// move as a person's does and stood where it had no reason to (2026-10-06).
//
// - On a toolbar button nothing else on screen names, for its tooltip
//   (`tip`), which names the button without a caption having to. How long
//   is the rig's to say and not the take's: until the tip has been whole on
//   screen for what it takes to read, by what it says (rig.readTip, and
//   readTime in motion.js), which is 0.7 s for "Theme" and twice that for
//   the five words of the multicursor button. The takes of the morning of
//   2026-10-06 left every tip whole for a little over half a second, and
//   the owner asked for a little more, so that they can be read.
// - After a press whose result has to be looked at, for a third to a half
//   of a second, and then it leaves for its next errand while the result is
//   still being read: what a result is given is the time to the next press,
//   not the time the pointer stands still.
// - Where something has to be read: a header's two lines, a table drawn, an
//   entry in its file.
//
// What repeats goes faster each time: the second and third word picked, the
// later cells of a table, a chord pressed four times. The tour carries no
// caption at all: the one it had under Ctrl+D pulled the eye off the four
// notes changing (owner, 2026-09-14).
//
// frame() puts the document where the take needs it and is never recorded;
// beats() is the take. alt is what ships with the clip: on the Marketplace an
// animation with no alt text is a blank to anybody not watching it.
//
// The pane is about 504 CSS px tall at the zoom these are shot at (rig.js),
// and the demo document's score costs 129 drawn and 185 more as source
// (measured by clicking it open, 2026-09-11, on the document as it reads
// now). The tour frames the score's top at 88 (frame(), below), and the page
// moves down 41 px as the click opens the source, so the drawing's foot comes
// to 88 + 41 + 185 + 129 = 443; the 35 px of the player's row take it to 478,
// inside the 504. The 41 px was measured on a recorded take (the light one of
// 2026-09-11): the prose above the score comes down by that much as the
// source opens.
//
// The document is written as a guide to the take: the words on screen while
// the toolbar is used name what its buttons set, and the words over the
// score while its ABC is edited say what the edit means (`e` is `E` an
// octave up, `_e` is `e` flat). A change to what the take does is a change
// to the words it shows.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { sleep } = require("./rig.js");
const { readTime } = require("./motion.js");
const { REPO, WORKSPACE } = require("./paths.js");

// ---------------------------------------------------------------- helpers

// Both side bars out of the way, so the editor group has the whole window.
//
// Not cosmetic. With the explorer open the pane is 552 CSS px wide, narrower
// than the editor's own content, so the document is drawn clipped behind a
// horizontal scrollbar and the engraving comes out a third of its size. It is
// checked rather than toggled: Ctrl+B is a toggle, and a take that follows one
// that already closed the bar would open it again.
async function clearLayout(rig) {
  const widths = () =>
    rig.page.evaluate(() => ({
      side: (document.querySelector(".part.sidebar") || {}).offsetWidth || 0,
      aux: (document.querySelector(".part.auxiliarybar") || {}).offsetWidth || 0,
    }));
  for (let i = 0; i < 3; i++) {
    const w = await widths();
    if (!w.side && !w.aux) return;
    if (w.aux) {
      await rig.press("Control+Alt+b");
      await sleep(600);
    }
    if (w.side) {
      await rig.press("Control+b");
      await sleep(600);
    }
  }
  if ((await widths()).side) throw new Error("the side bar would not close");
}

// Closes every editor, with the chord sent to the workbench and never to the
// document. Ctrl+K is the editor's own link command, so a Ctrl+K W sent while
// the document had the focus wrote "[]()" at the caret and typed the "w"
// inside it, and every take after the first began on a document the take
// before it had edited. Focusing the active tab first moves the keyboard out
// of the webview, so VS Code's keybindings get the chord.
async function closeAll(rig) {
  await rig.page.evaluate(() => {
    const tab = document.querySelector(".tabs-container .tab.active") || document.querySelector(".tabs-container .tab");
    if (tab) tab.focus();
  });
  await sleep(250);
  const inWebview = await rig.page.evaluate(() => (document.activeElement || {}).tagName === "IFRAME");
  if (inWebview) throw new Error("the keyboard is still in the webview; Ctrl+K would edit the document");
  await rig.press("Control+k");
  await rig.press("w");
  await sleep(800);
  // A save dialog here means a take left a document edited; the check at the
  // end of every take in record.js should have stopped the run before this.
  // It is in the workbench's DOM only because record.js asks for VS Code's own
  // dialogs (window.dialogStyle): the native one is a window of its own that
  // nothing here can see. The dialog is quoted, since it is not always that
  // one: a probe that had written the profile's settings without
  // workbench.enableExperiments left VS Code asking for a restart when
  // record.js put the setting back, and the run stopped here blaming a take
  // (2026-10-01).
  const asked = await rig.page.evaluate(() => {
    const dialog = document.querySelector(".monaco-dialog-box");
    return dialog ? dialog.textContent : null;
  });
  if (asked) throw new Error(`VS Code is asking before it closes the editors: ${asked.slice(0, 200)}`);
}

async function openDoc(rig, name) {
  await rig.press("Control+p");
  await sleep(600);
  await rig.type(name, 25);
  await sleep(800);
  await rig.press("Enter");
  await sleep(2600);
}

// CodeMirror blinks the caret on a CSS animation. At the frame rate a GIF is
// delivered at, that reads as a rendering fault rather than as a caret, so it
// is held on for the takes. Nothing else about the editor is touched.
async function pinCaret(rig) {
  await rig.frame.evaluate(() => {
    if (document.getElementById("__mdm_pin")) return;
    const s = document.createElement("style");
    s.id = "__mdm_pin";
    s.textContent =
      ".cm-cursorLayer{animation:none!important}" +
      ".cm-cursor,.cm-cursor-primary,.cm-cursor-secondary{opacity:1!important}";
    document.head.appendChild(s);
  });
}

// Where the pointer waits at both ends of a take: the bottom right of the
// document pane, right of the text, where nothing reacts to it. Inside the
// webview on purpose. Parked over the status bar, the pointer left the webview
// holding the hover of the last thing it crossed, so a score's headphones
// stayed drawn on the first frame of a take and were gone by its last.
async function rest(rig) {
  const off = await rig.webviewOffset();
  const pane = await rig.evalFrame(() => {
    const r = document.querySelector("#app .cm-scroller").getBoundingClientRect();
    return { right: r.right, bottom: r.bottom };
  });
  return { x: Math.round(off.x + pane.right - 55), y: Math.round(off.y + pane.bottom - 24) };
}

// Where a click puts the caret outside every block: the blank line above the
// score's fence, which the tour's frame shows with the score open or shut.
// Found through CodeMirror (coordsAtPos on that line), not by a coordinate,
// so a take follows the document when the document changes; an early version
// aimed at a word of prose instead, found its first match above the pane and
// clicked the title bar.
async function prose(rig) {
  const off = await rig.webviewOffset();
  const c = await rig.evalFrame(() => {
    const view = window.__mdm.view;
    const doc = view.state.doc;
    for (let i = 2; i <= doc.lines; i++) {
      if (doc.line(i).text.startsWith("```{.abc") && doc.line(i - 1).text.trim() === "") {
        const at = view.coordsAtPos(doc.line(i - 1).from);
        const pane = document.querySelector("#app .cm-scroller").getBoundingClientRect();
        if (!at || at.top < pane.top || at.bottom > pane.bottom) return null;
        return { x: at.left + 120, y: (at.top + at.bottom) / 2 };
      }
    }
    return null;
  });
  if (!c) throw new Error("the blank line above the score is not on screen");
  return { x: Math.round(off.x + c.x), y: Math.round(off.y + c.y) };
}

// The caret outside every block before the camera rolls, so the take opens on
// the state it closes on. Without it the caret is at offset 0, on the first
// line of the text, and the first toolbar click (which calls view.focus())
// shows that line's source for the rest of the clip: the backticks of its
// code now, and the "###" of the heading the document opened on until
// 2026-10-05.
async function settleCaret(rig) {
  const p = await prose(rig);
  await rig.warp(p.x, p.y);
  await rig.click();
  await sleep(500);
}

// Where a click puts the caret on the first note of the tune written as a bare
// letter, which the editor takes for a whole word. Ctrl+D from a caret selects
// the word the caret is in, so only a bare note makes that selection the note
// alone; from there Ctrl+D with "matches inside words" on adds the same letter
// inside E2 and inside [Ec], and with it off adds only other bare ones, of
// which the tune has none (measured in the editor, 2026-09-10). Found through
// CodeMirror in the line that closes the tune, the one ending in |].
async function atBareNote(rig, letter) {
  const off = await rig.webviewOffset();
  const c = await rig.evalFrame((l) => {
    const view = window.__mdm.view;
    const doc = view.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (!/\|\]\s*$/.test(line.text)) continue;
      const m = new RegExp(`(^|[\\s|])${l}(?=[\\s|]|$)`).exec(line.text);
      if (!m) return null;
      const at = view.coordsAtPos(line.from + m.index + m[1].length);
      return at ? { x: at.left + 2, y: (at.top + at.bottom) / 2 } : null;
    }
    return null;
  }, letter);
  if (!c) throw new Error(`no bare ${letter} of the tune is on screen`);
  return { x: Math.round(off.x + c.x), y: Math.round(off.y + c.y) };
}

// The first play fetches the piano, and until it is loaded the start button
// carries abcjs-loading and a click on it does nothing visible. Playing once
// before the camera rolls is what keeps that out of the clip. Three seconds
// of it, and then the headphones close the player, which stops the sound
// (closePlayer in main.js destroys the player's controller).
async function warmPiano(rig) {
  await rig.frameAt("#app .mdm-score", 120);
  // A score's buttons are put away until the pointer is on it or its source
  // is open, and a pointer warped straight to where the headphones stand
  // meets the margin: it is put on the drawing and brought across to them.
  const on = await rig.at("#app .mdm-score", { fy: 0.5 });
  await rig.warp(on.x, on.y);
  await sleep(200);
  await rig.moveTo(await rig.at("#app .mdm-score .mdm-audio-toggle"), 300);
  await sleep(200);
  await rig.click();
  await rig.waitFor(() => !!document.querySelector("#app .abcjs-midi-start"), { timeout: 20000 });
  const start = await rig.at("#app .abcjs-midi-start");
  await rig.warp(start.x, start.y);
  await rig.click();
  await sleep(3000);
  const back = await rig.at("#app .mdm-score .mdm-audio-toggle");
  await rig.warp(back.x, back.y);
  await rig.click();
  await sleep(800);
}

// ---------------------------------------------------------------- the bar

// The bar is the outline's button and seven words, each over a menu (the
// owner's pick of 2026-10-13), where it was two rows of buttons named by
// their tooltips. What a take sets is a row of a menu: the pointer goes to
// the word and presses it, the menu opens, the pointer comes down to the
// row, stays on it for as long as its name takes to read (motion.js,
// readTime, the time a tooltip was left up), and presses it. A row in a
// submenu, a theme or a language, is reached through the row it hangs from,
// which opens it under the pointer on the way.
function wordAt(rig, word) {
  return rig.at(`#app .mdm-toolbar button[data-type="${word}"]`);
}
// On the row's name, a third of the way in, where a hand reading it stops.
function rowAt(rig, type) {
  return rig.at(`#app .mdm-toolbar button.mdm-menu__item[data-type="${type}"]`, { fx: 0.3 });
}
// A row of a submenu by its name, the themes' indices being whatever themes
// are installed.
function subRowAt(rig, label) {
  return rig.atLabel("#app .mdm-toolbar .mdm-menu--sub .mdm-menu__item", label);
}
async function opened(rig, word) {
  await rig.waitFor((w) => !!document.querySelector(`#app .mdm-toolbar__item--open > button[data-type="${w}"]`), {
    arg: word,
    timeout: 3000,
    poll: 40,
  });
}
// `row` is the data-type of a row of the word's menu, or { label, via } for
// a row of the submenu that hangs from the row `via`. `says` is its name.
async function pick(rig, word, row, says) {
  await rig.pressAt(await wordAt(rig, word), { size: 60 });
  await opened(rig, word);
  await sleep(220);
  let at;
  if (typeof row === "string") {
    at = await rowAt(rig, row);
  } else {
    await rig.moveTo(await rowAt(rig, row.via), undefined, { size: 160 });
    await rig.waitFor(
      (v) => {
        const r = document.querySelector(`#app .mdm-toolbar button.mdm-menu__item[data-type="${v}"]`);
        return !!r && !!r.closest(".mdm-menu__group--open");
      },
      { arg: row.via, timeout: 3000, poll: 40 }
    );
    await sleep(200);
    at = await subRowAt(rig, row.label);
  }
  await rig.moveTo(at, undefined, { size: 160 });
  await sleep(readTime(says));
  await rig.click();
}
// The same off camera: no travel, no reading.
async function pickNow(rig, word, row) {
  const w = await wordAt(rig, word);
  await rig.warp(w.x, w.y);
  await rig.click();
  await opened(rig, word);
  await sleep(150);
  let at;
  if (typeof row === "string") {
    at = await rowAt(rig, row);
  } else {
    const via = await rowAt(rig, row.via);
    await rig.warp(via.x, via.y);
    await sleep(400);
    at = await subRowAt(rig, row.label);
  }
  await rig.warp(at.x, at.y);
  await rig.click();
}

// The LaTeX font row of the Page menu, pressed. It is a switch, and the take
// opens on the sans (mdm.textFont in the tour's settings), so the first press
// sets the document in Latin Modern. frame() uses it off camera to measure
// the page on the face the scroll will land in.
async function pressTextFont(rig) {
  await pickNow(rig, "menu-page", "mdm-text-font");
  // CodeMirror re-measures the width of a character and the height of a line
  // on a face swap (applyTextFont in main.js); the prose is not at its new
  // height until that has been through.
  await sleep(700);
}

// The score's top below the top of the pane, in CSS px.
async function scoreTop(rig) {
  return rig.evalFrame(() =>
    Math.round(
      document.querySelector("#app .mdm-score").getBoundingClientRect().top -
        document.querySelector("#app .cm-scroller").getBoundingClientRect().top
    )
  );
}

// ---------------------------------------------------------------- the clips

// Several of the editor's features in one take, in the order a reader meets
// them: the face, the theme, the staff lines, the multicursor setting, the
// source under a click, four notes edited at once (two of them inside
// chords), the tune played with the playhead on the staff, and the score's
// export button opened on the two files it writes.
//
// The face goes first, before the theme, by the owner's order (2026-09-19;
// asked the other way round the same evening and put back). It is in the take
// for what it says about the editor: it opens in the font Markdown is usually
// written in, the sans the rest of VS Code is set in, so the press that puts
// the document in Latin Modern is the difference between the two faces and
// not a face the reader is given no measure of.
//
// It opens on the sans and on MDM Dark whichever window it is shot in
// (settings) and ends away from where it began, in Latin Modern on MDM Light
// with the tune edited and playing. Walking
// all of that back on camera would add seconds that show nothing new, so the
// take is put back off camera (after) and its last stretch dissolves into its
// first frame (dissolve, rig.js dissolveHome), which is what closes its loop.
// Where the page stands when the score opens, measured off camera by frame()
// and scrolled to on camera by beats().
const scoreView = { scrollTop: 0, top: 0 };

const tour = {
  id: "tour",
  title: "The editor in one take",
  alt:
    "The toolbar sets the document in Latin Modern, switches it to MDM Light, draws the staff lines in ink and lets Ctrl+D match inside words. A click on the score opens its ABC, and Ctrl+D selects its four E's, which typing turns into E flats an octave up while the drawing follows. The player sounds the edited tune with a brass playhead on the staff, and the score's export button offers it as MIDI or WAV.",
  frameRate: 16,
  needsPiano: true,
  // The sans, so the first press has somewhere to come from: every other
  // mdm.* is put back to its shipped default by writeSettings, and the roman
  // is the shipped default of this one.
  settings: { "mdm.theme": "dark", "mdm.textFont": "sans" },
  dissolve: 0.6,
  // The edit made in the tune: every E, the first of them bare, becomes the E
  // flat an octave up. demo.mdm's tune is written round it, in C: every E is
  // the third of a C major chord, so the one edit turns each of them minor,
  // and the four flats land in the top space, on the staff, spread over bars
  // 1, 3 and 5. Spread out, they read as four notes changing at once; an
  // earlier tune put three of them in one bar, which read as a bar darkening.
  edit: { target: "E", typed: "_e" },
  // It opens on the top of the document, title block and all: framed on the
  // score, the first frame began on a row cut halfway through a paragraph,
  // which read as a crop (owner, 2026-09-14). What stands at the top is the
  // header, drawn: demo.mdm names its title there and nowhere else since the
  // editor draws the block (owner, 2026-10-05), where it used to open on a
  // heading of the same words. The frame for the score is still measured
  // here, where it can settle and take the cut row off the top, and beats()
  // scrolls to that offset on camera once the toolbar has been used.
  async frame(rig) {
    // High enough that the open source, the drawing under it and the
    // player's row all fit. Framed at 170, the row pushed the drawing's foot
    // below the pane and play then scrolled the page 221 px to keep the
    // sounding staff whole (2026-09-10). At 100 (88 once clearTopEdge has
    // taken the cut row off the top) the open source leaves the drawing's
    // foot at 443 of the pane's 504, 478 with the row (2026-09-11).
    //
    // Measured with the roman already on, because beats() presses the face
    // before it scrolls and the two faces set the prose to different heights:
    // a scrollTop measured on the sans lands somewhere else once the button
    // has been pressed, and the check in beats() stops the take.
    await pressTextFont(rig);
    await rig.frameAt("#app .mdm-score", 100);
    scoreView.scrollTop = await rig.atScrollTop();
    scoreView.top = await scoreTop(rig);
    await rig.scrollTop(0);
    await pressTextFont(rig);
  },
  async beats(rig) {
    const edit = tour.edit;
    await sleep(500);

    // The face, first of the four, from the Page menu. What changes is every
    // word on the page and not one row, so the pointer stays on a little
    // longer after this press than after the next ones.
    await pick(rig, "menu-page", "mdm-text-font", "LaTeX font");
    await sleep(520);

    // The three settings after it, each in the menu of its kind: the theme
    // from the submenu of its row of Page, the staff lines from Score, and
    // Ctrl+D inside words from Edit, which is the setting the edit below
    // turns on.
    await pick(rig, "menu-page", { via: "mdm-theme", label: "MDM Light" }, "MDM Light");
    await sleep(480);

    await pick(rig, "menu-score", "mdm-staff-lines", "Ink staff lines");
    await sleep(420);

    await pick(rig, "menu-edit", "mdm-match-substring", "Match inside words");
    await sleep(480);

    // Down to the score, to the offset frame() measured. The theme and the ink
    // are set by now; if either had moved the score, the page would open it
    // somewhere the heights above were not measured for, so that stops the take.
    await rig.smoothScrollTo(scoreView.scrollTop, 620);
    await sleep(260);
    const landed = await scoreTop(rig);
    if (Math.abs(landed - scoreView.top) > 3) {
      throw new Error(`the score stands at ${landed} and not at ${scoreView.top} after the scroll`);
    }

    // The score opens its ABC above the drawing.
    await rig.pressAt(await rig.at("#app .mdm-score", { fy: 0.62 }), { size: 160 });
    await sleep(950);

    // Four notes at once: the first Ctrl+D selects the bare note under the
    // caret, and the next three add the same letter inside the other notes and
    // chords, which is what the setting just turned on allows. The first is
    // given the time to be seen for what it is, a note selected, and the
    // three after it come as a hand repeats a chord, quicker each time.
    await rig.pressAt(await atBareNote(rig, edit.target), { size: 12, direct: true });
    await sleep(140);
    // Off the note before anything is selected. Over text the pointer is the
    // I-beam, centred on its point, and left where the click was it stood on
    // the first E through all four selections and hid it.
    await rig.moveTo({ x: rig.x + 14, y: rig.y + 32 }, undefined, { size: 30 });
    await sleep(300);
    for (const held of [560, 380, 300, 300]) {
      await rig.press("Control+d");
      await sleep(held);
    }
    await sleep(200);
    // The letter first and the sign in front of it after. Typed in the order
    // it is written, "_" then "e", the score redrew between the two keys with
    // "_" in place of every E, which drew [_c] as a C flat and dropped the lone
    // E's for a frame. Letter first, the step between is a real one: the four
    // notes an octave up, and then the flats.
    const letter = edit.typed.slice(-1);
    const sign = edit.typed.slice(0, -1);
    await rig.type(letter, 120);
    await sleep(800);
    await rig.press("ArrowLeft");
    await sleep(200);
    await rig.type(sign, 120);
    await sleep(1100);

    // The player, and the playhead across the edited tune. The headphones
    // stand in the margin beside the first line of the open source, up while
    // the source is open, and the pointer goes straight to them: it used to
    // go down to the drawing first and stop there, a corner no hand turns.
    await rig.pressAt(await rig.at("#app .mdm-score .mdm-audio-toggle"), { tip: true });
    await rig.waitFor(() => !!document.querySelector("#app .abcjs-midi-start"), { timeout: 12000 });
    // Off the rail as soon as the player is there. Its row pushes the page
    // down under the pointer, which is then on the button over the
    // headphones, and a pointer left there a third of a second brought up
    // that button's tooltip, "Copy" (the first take of 2026-10-06).
    await sleep(120);
    await rig.pressAt(await rig.at("#app .abcjs-midi-start"), { settle: 260 });
    await rig.moveTo(await rest(rig), undefined, { size: 200 });

    // The score's export button, pressed while the tune plays, so the take
    // shows that a score can be written out as a file (owner, 2026-09-28).
    // It stands in the rail under the headphones, up while the source is
    // open; its tooltip names it on the way in, and the press opens the two
    // formats beside the rail. Nothing is picked: a row would open VS Code's
    // save dialog over the window.
    //
    // Timed by the player's clock and not by sleeps. The tune is 7.5 s (five
    // bars of 3/4 at 120), and a take that ran past it would show the player
    // stop and reset under the menu. Leaving the rest when the clock reads
    // 0:02, the press comes a little over a second later, the travel and the
    // wait for the tooltip, and the menu is held for 2.5 s, the last 0.6 of
    // them the dissolve.
    await rig.waitFor(
      () => {
        const clock = document.querySelector("#app .abcjs-midi-clock");
        const m = clock && /(\d+):(\d\d)/.exec(clock.textContent);
        return !!m && Number(m[1]) * 60 + Number(m[2]) >= 2;
      },
      { timeout: 8000, poll: 40 }
    );
    await rig.pressAt(await rig.at("#app .mdm-score .mdm-audio-export"), { tip: true });
    await sleep(2500);
    // Held to the tune still sounding when the camera stops: past its end
    // the player resets under the menu.
    const playing = await rig.evalFrame(() => {
      const start = document.querySelector("#app .abcjs-midi-start");
      return !!start && start.classList.contains("abcjs-pushed");
    });
    if (!playing) throw new Error("the tune ended before the take did");
  },
  // Off camera: the player shut, the edit undone, the block folded. The theme
  // and the two toolbar settings go back with the next take's settings.
  async after(rig, ctx) {
    // The export menu the take ends on, shut as a reader shuts it: a second
    // press on its button. The headphones below would shut it too, but only
    // while the player is open.
    if (await rig.evalFrame(() => !!document.querySelector("#app .mdm-audio-export.mdm-toolbar__item--open"))) {
      const ex = await rig.at("#app .mdm-score .mdm-audio-export");
      await rig.warp(ex.x, ex.y);
      await rig.click();
      await sleep(400);
    }
    if (await rig.evalFrame(() => !!document.querySelector("#app .abcjs-midi-start"))) {
      const hp = await rig.at("#app .mdm-score .mdm-audio-toggle");
      await rig.warp(hp.x, hp.y);
      await rig.click();
      await sleep(900);
    }
    await rig.evalFrame(() => window.__mdm.view.focus());
    for (let i = 0; i < 6 && !(await ctx.isPristine()); i++) {
      await rig.press("Control+z");
      await sleep(350);
    }
    // From the top, where the blank line above the fence shows with the
    // source still open, for settleCaret to click.
    await rig.scrollTop(0);
    await settleCaret(rig);
  },
};

// ---------------------------------------------------------------- markdown

// The window point of a stretch of the document's text, found through
// CodeMirror as prose() finds its line, so the take follows markdown.mdm when
// its words change: where the stretch starts, or where it ends with end set,
// or the middle of it with mid set, or that share of the way along it with
// along. Null means it is not in the pane, which a beat treats as a take
// gone wrong rather than clicking the title bar.
async function atText(rig, needle, opts) {
  const o = opts || {};
  const off = await rig.webviewOffset();
  const c = await rig.evalFrame(
    (n, o) => {
      const view = window.__mdm.view;
      const i = view.state.doc.toString().indexOf(n);
      if (i < 0) return null;
      const a = view.coordsAtPos(i, 1);
      const b = view.coordsAtPos(i + n.length, -1);
      const pane = document.querySelector("#app .cm-scroller").getBoundingClientRect();
      const at = o.end ? b : a;
      if (!at || at.top < pane.top || at.bottom > pane.bottom) return null;
      const share = o.mid ? 0.5 : o.along;
      const x = share !== undefined && b && Math.abs(b.top - a.top) < 2 ? a.left + (b.right - a.left) * share : at.left;
      return { x, y: (at.top + at.bottom) / 2 };
    },
    needle,
    o
  );
  if (!c) throw new Error(`${JSON.stringify(needle)} is not on screen`);
  return { x: Math.round(off.x + c.x), y: Math.round(off.y + c.y) };
}

// The window point of the empty line n lines under the one holding needle,
// a little into it, found as atText finds its text. An empty line is where
// a click puts the caret outside every paragraph, and where a paste starts
// a paragraph of its own; one that is not empty, or not in the pane, stops
// the take.
async function emptyBelow(rig, needle, n) {
  const off = await rig.webviewOffset();
  const c = await rig.evalFrame(
    (needle, n) => {
      const view = window.__mdm.view;
      const doc = view.state.doc;
      const i = doc.toString().indexOf(needle);
      if (i < 0) return null;
      const no = doc.lineAt(i).number + n;
      if (no > doc.lines || doc.line(no).text !== "") return null;
      const at = view.coordsAtPos(doc.line(no).from);
      const pane = document.querySelector("#app .cm-scroller").getBoundingClientRect();
      if (!at || at.top < pane.top || at.bottom > pane.bottom) return null;
      return { x: at.left + 120, y: (at.top + at.bottom) / 2 };
    },
    needle,
    n
  );
  if (!c) throw new Error(`the line ${n} under ${JSON.stringify(needle)} is not an empty line on screen`);
  return { x: Math.round(off.x + c.x), y: Math.round(off.y + c.y) };
}

// The scroll offset that puts the line holding needle a little under the top
// of the pane, read from CodeMirror's own heights at the moment it is asked
// for. Measured on camera and not in frame(): by then the take has justified
// the prose, divided its words and made three of them bold, and every one of
// those moves the lines below.
async function scrollFor(rig, needle, below) {
  return rig.evalFrame(
    (n, below) => {
      const view = window.__mdm.view;
      const i = view.state.doc.toString().indexOf(n);
      return Math.max(0, Math.round(view.lineBlockAt(i).top + view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop - below));
    },
    needle,
    below === undefined ? 14 : below
  );
}

// A scroll offset moved up to the top of the row of text the pane's top edge
// would cut at it, so the frame opens on a whole row. rig.clearTopEdge does
// the same by moving down, which a page already at its foot cannot do, and
// reads only .cm-line: a picture's caption is drawn in its widget, and the
// first take framed at the foot of markdown.mdm opened on the bottom half of
// "The extension's icon" (2026-09-30). Reads the rows CodeMirror has drawn,
// which reach past the pane either side.
async function wholeRowAt(rig, target) {
  return rig.evalFrame((t) => {
    const sc = document.querySelector("#app .cm-scroller");
    const shift = sc.getBoundingClientRect().top - sc.scrollTop;
    let top = t;
    for (const el of document.querySelectorAll("#app .cm-content .cm-line, #app .mdm-figcaption")) {
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of range.getClientRects()) {
        if (r.height && r.top - shift < t - 0.5 && r.bottom - shift > t + 0.5) top = Math.min(top, Math.floor(r.top - shift) - 2);
      }
    }
    return top;
  }, target);
}

// Whether the tab of the file named name is in the workbench's tab bars,
// found by the label VS Code gives a tab, which opens on the file's name
// ("markdown.bib" or "markdown.bib, preview"), waited for until it is open
// (open true) or gone.
async function waitTab(rig, name, open) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const has = await rig.page.evaluate(
      (n) => [...document.querySelectorAll(".tabs-container .tab")].some((t) => (t.getAttribute("aria-label") || "").startsWith(n)),
      name
    );
    if (has === open) return;
    if (Date.now() > deadline) throw new Error(`the tab of ${name} did not ${open ? "open" : "close"}`);
    await sleep(100);
  }
}

// The window point of the close button on the tab of the file named name.
// Drawn on the tab that is active in its group, as the one a click on an
// entry opens is.
async function tabClose(rig, name) {
  const r = await rig.page.evaluate((n) => {
    const tab = [...document.querySelectorAll(".tabs-container .tab")].find((t) => (t.getAttribute("aria-label") || "").startsWith(n));
    const x = tab && tab.querySelector(".tab-actions .action-label");
    const b = x && x.getBoundingClientRect();
    return b && b.width ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
  }, name);
  if (!r) throw new Error(`no close button on the tab of ${name}`);
  return { x: Math.round(r.x), y: Math.round(r.y) };
}

// What a take pastes: the extension's own icon, a picture that belongs to the
// project and reads at the size the editor draws it.
const PICTURE = path.join(REPO, "vscode-mdm", "media", "icon.png");

// A picture pasted into the text. The event is the one Ctrl+V fires, built
// with the picture in its clipboardData and dispatched on CodeMirror's
// content, so the editor takes it through its own paste handler, to the host,
// which writes the file, and back, as it takes a real one; the clipboard
// alone is left out. The rig's VS Code shares the desktop's clipboard, and
// putting the picture on it would throw away whatever the owner had copied.
// Named image.png, the name Chrome gives a screenshot pasted from the
// clipboard (pictureFiles in main.js).
async function pastePicture(rig, file) {
  const bytes = fs.readFileSync(file).toString("base64");
  await rig.evalFrame((b64) => {
    const bin = atob(b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    const clip = new DataTransfer();
    clip.items.add(new File([data], "image.png", { type: "image/png" }));
    window.__mdm.view.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: clip, bubbles: true, cancelable: true })
    );
  }, bytes);
}

// Where a pasted picture of doc goes: `<stem>-images` beside it
// (PICTURE_FOLDER_SUFFIX in extension.js).
function picturesOf(doc) {
  return path.join(WORKSPACE, path.basename(doc, path.extname(doc)) + "-images");
}

// The file put back as it is on disk, through VS Code's own File: Revert
// File. Some of what the Markdown take writes is not in the editor's undo
// history: the host writes the `lang:` line into the header, and the header
// is hidden from the editor's text. The chord goes to the workbench from the
// active tab, as closeAll's does.
async function revertFile(rig) {
  await rig.page.evaluate(() => {
    const tab = document.querySelector(".tabs-container .tab.active");
    if (tab) tab.focus();
  });
  await sleep(250);
  await rig.press("Control+Shift+p");
  await sleep(600);
  await rig.type("File: Revert File", 10);
  await sleep(700);
  await rig.press("Enter");
  await sleep(1500);
  await rig.webview();
  await rig.waitFor(() => !!document.querySelector("#app .mdm-toolbar"), { timeout: 15000 });
}

// The caret on the blank line under the heading before the camera rolls, for
// the reason settleCaret gives for the tour: without it the caret is on the
// heading and the first press on the bar shows its "###" for the rest of the
// take.
async function settleUnderHeading(rig) {
  const off = await rig.webviewOffset();
  const c = await rig.evalFrame(() => {
    const view = window.__mdm.view;
    const doc = view.state.doc;
    for (let i = 1; i < doc.lines; i++) {
      if (doc.line(i).text.startsWith("#") && doc.line(i + 1).text.trim() === "") {
        const at = view.coordsAtPos(doc.line(i + 1).from);
        return at && { x: at.left + 120, y: (at.top + at.bottom) / 2 };
      }
    }
    return null;
  });
  if (!c) throw new Error("the blank line under the heading is not on screen");
  await rig.warp(Math.round(off.x + c.x), Math.round(off.y + c.y));
  await rig.click();
  await sleep(500);
}

// The Markdown the editor writes and draws, in one take, in the order the
// owner gave (2026-09-28): the prose justified, its words divided once a
// language is chosen and the YAML header that choice writes opened and shut
// again, three words picked with the multicursor and made bold by typing
// `**` over them, three lines made a list, words highlighted, a table
// written cell by cell, and a picture pasted with its caption. Then, asked
// for on 2026-09-30 to show that the editor handles citations, the page
// ends as a paper does: an equation numbered at the margin and named by its
// number in the prose, and a citation typed as its key, drawn as the page
// prints it with its work listed under it; a click on the work opens the
// .bib at its entry, and its tab is closed again. It goes last because it
// is the furthest from plain Markdown, and because the list of works cited
// stands at the end of a document that has no `::: {#refs}`. It opens in
// Latin Modern, the editor's default, on MDM Light.
//
// markdown.mdm is the take's guide as demo.mdm is the tour's: every paragraph
// says what is about to be done to it, and the three lines the list button
// turns into a list name what the page has done before them.
//
// It opens ragged (settings), so that the first press has somewhere to go.
// Its YAML header names the bibliography and nothing else, and is hidden
// (mdm.frontMatter), so choosing a language adds `lang: en` to it
// (writeLanguage in extension.js) and the YAML button then shows the two
// lines, the second of them the one the take just wrote. Until 2026-09-30 the
// document had no header, and the choice wrote one; a citation needs the
// header to name its bibliography. It ends a long way from where it began,
// and like the tour it is put back off camera (after) and dissolves into its
// first frame.
const markdown = {
  id: "markdown",
  title: "Markdown in one take",
  doc: "markdown.mdm",
  // Copied beside the document before every take, as the document is.
  files: ["markdown.bib"],
  alt:
    "In Latin Modern on MDM Light, the Page menu justifies the text, and English chosen under Hyphenation divides its words and writes lang: en into the YAML header, which the YAML header row shows and hides. Three words turn bold as two asterisks are typed over them, three lines become a list, a phrase is highlighted, a table is filled cell by cell and a pasted picture is saved beside the document. Under an equation numbered at the margin, a citation typed as its key is drawn as the page prints it, and a click on its work, listed at the end, opens the bibliography beside the document at its entry.",
  frameRate: 14,
  settings: { "mdm.textAlign": "left" },
  dissolve: 0.6,
  // The citation the take types: the paper that introduced the cent, whose
  // formula the page numbers, from markdown.bib. Its details were checked
  // against IMSLP's record of the paper and Wikipedia's "Cent (music)"
  // (2026-09-30). They are noted here and not in the .bib, which the take
  // opens on camera.
  cite: "[@ellis1885]",
  // What the table button's empty table is filled with, header first, a cell
  // at a time with Tab between them. The rows are the marks the take has just
  // used, as they are drawn and as they are written, so the table says what
  // the take did; its third row is the one Tab adds after the last cell of the
  // two the button writes (TABLE_BLOCK in main.js).
  //
  // Not the highlight, though the take has just used it: a bracketed span in
  // a cell is drawn in the editor without its class, so `[x]{.mark}` there
  // shows no wash where the page would write <mark> (cellParts in main.js,
  // found by this take on 2026-09-28 and left for its own round).
  cells: ["Drawn", "Written", "**bold**", "`**bold**`", "*italic*", "`*italic*`", "~~struck~~", "`~~struck~~`"],
  async frame(rig) {
    await rig.scrollTop(0);
  },
  settle: settleUnderHeading,
  async beats(rig) {
    await sleep(500);

    // Justified, from the Page menu: every paragraph on screen squares up at
    // once.
    await pick(rig, "menu-page", "mdm-text-align", "Justified text");
    await sleep(460);

    // English, from the submenu of Hyphenation. The host writes the header
    // and answers, and the row of English is ticked once the language is
    // dividing the prose: waited for, so the hold after it is a hold on
    // divided words and not on a round trip.
    await pick(rig, "menu-page", { via: "mdm-hyphenation", label: "English" }, "English");
    await rig.waitFor(
      () => {
        const row = document.querySelector('#app button[data-type="mdm-hyphenation-en"]');
        return !!row && row.getAttribute("aria-pressed") === "true";
      },
      { timeout: 8000 }
    );
    await sleep(750);

    // The header the choice wrote, opened above the heading by the YAML
    // header row, left open for as long as its two lines take to read, and
    // put away by the same row.
    await pick(rig, "menu-page", "mdm-front-matter", "YAML header");
    await sleep(1500);
    await pick(rig, "menu-page", "mdm-front-matter", "YAML header");
    await sleep(420);

    // Three words at once: a double click takes the first, and Alt with a
    // double click adds each of the others. Then two asterisks typed over the
    // three selections wrap every one of them (surroundSelection in main.js).
    //
    // As a hand picks three words in a row: the first aimed at, the other
    // two a flick each, and the pointer gone from a word as soon as it is
    // taken. It used to stand on each for a second and a half, 0.6 s before
    // the double click and 0.9 after, and the time after showed the arrow in
    // place of the I-beam, since what is under the pointer then is the
    // selection's own layer: three words, three stops, the pointer changing
    // shape at each (the owner's "esta rara", 2026-10-06; on the frames of
    // the take then published the pointer reaches the first word at 14.4 s
    // and leaves the third at 20.1).
    const words = ["melody", "harmony", "rhythm"];
    for (let i = 0; i < words.length; i++) {
      await rig.pressAt(await atText(rig, words[i], { along: 0.8 }), {
        clickCount: 2,
        modifiers: i ? 1 : 0,
        size: 44,
        pace: i ? 0.8 : 1,
        settle: i ? 70 : 110,
        direct: true,
      });
      // Under the 180 ms after which the rig looks again at what a still
      // pointer is on (reshapeLater): on a word just selected that is the
      // arrow, and the first take of this beat showed it for two frames.
      // Each word is taken near its end, for the same reason: the pointer
      // has less of the selection to cross on its way out of it.
      await sleep(80);
    }
    // Off the last word at once and briskly, down and to the right, where
    // nothing is under the pointer while the keys work.
    await rig.moveTo({ x: rig.x + 30, y: rig.y + 38 }, undefined, { size: 40, pace: 0.7 });
    await sleep(400);
    await rig.type("*", 0);
    await sleep(260);
    await rig.type("*", 0);
    await sleep(1000);

    // Down to the list, and the three lines made one.
    await rig.smoothScrollTo(await scrollFor(rig, "Unordered list, in the Paragraph menu"), 620);
    await sleep(250);
    const first = await atText(rig, "Justified the text");
    await rig.moveTo({ x: first.x + 1, y: first.y }, undefined, { size: 14 });
    await sleep(120);
    await rig.dragTo(await atText(rig, "Made three words bold", { end: true }), undefined, { size: 14, pace: 1.15, hold: 120 });
    await sleep(220);
    await pick(rig, "menu-paragraph", "unordered-list", "Unordered list");
    await sleep(700);

    // A phrase highlighted.
    const phrase = "as it marks these";
    const from = await atText(rig, phrase);
    await rig.moveTo({ x: from.x + 1, y: from.y }, undefined, { size: 14 });
    await sleep(120);
    await rig.dragTo(await atText(rig, phrase, { end: true }), undefined, { size: 14, pace: 1.15, hold: 120 });
    await sleep(220);
    await pick(rig, "menu-format", "highlight", "Highlight");
    await sleep(800);

    // The table. Scrolled first so that its paragraph, the source the row
    // writes under it and the table drawn under that are all in the pane
    // while it is filled in.
    await rig.smoothScrollTo(await scrollFor(rig, "Table, in the Insert menu"), 600);
    await sleep(250);
    await rig.pressAt(await atText(rig, "after the last one.", { end: true }), { size: 14 });
    await sleep(240);
    await pick(rig, "menu-insert", "insert-table", "Table");
    await sleep(450);
    // The pointer to its corner while the keyboard works, so nothing stands
    // over the cells. The head of the table
    // is typed at a pace it can be followed at, and the rows under it, which
    // say nothing new about how a table is filled, as fast as a hand that
    // knows what it is writing.
    await rig.moveTo(await rest(rig), undefined, { size: 200 });
    for (let i = 0; i < markdown.cells.length; i++) {
      await rig.type(markdown.cells[i], i < 2 ? 46 : 30);
      if (i < markdown.cells.length - 1) {
        await sleep(i < 2 ? 130 : 80);
        await rig.press("Tab");
        await sleep(i < 2 ? 190 : 110);
      }
    }
    await sleep(700);
    // Out of the table: a click on its paragraph, and the source goes,
    // leaving the table drawn.
    await rig.pressAt(await atText(rig, "after the last one.", { end: true }), { size: 14 });
    await sleep(1000);

    // The picture, pasted into the empty line kept for it under its
    // paragraph, and its caption typed into the label the paste leaves the
    // caret in (writePicture in main.js). A click on the paragraph above
    // draws it.
    await rig.smoothScrollTo(await scrollFor(rig, "A picture pasted"), 600);
    await sleep(250);
    const intro = await atText(rig, "where the caret is:", { end: true });
    await rig.pressAt(await emptyBelow(rig, "where the caret is:", 2), { size: 60 });
    await sleep(350);
    await pastePicture(rig, PICTURE);
    await rig.waitFor(() => /!\[\]\([^)]*-images\/image\.png\)/.test(window.__mdm.view.state.doc.toString()), {
      timeout: 8000,
    });
    await sleep(600);
    await rig.moveTo({ x: rig.x + 16, y: rig.y + 38 }, undefined, { size: 40 });
    await rig.type("The extension's icon", 48);
    await sleep(450);
    await rig.pressAt({ x: intro.x + 3, y: intro.y }, { size: 14 });
    await sleep(250);
    // Down to the picture whole, caption and all, as soon as it is drawn,
    // measured again now that it is: the heights the scroll before the paste
    // was taken from had an empty line where the picture now stands.
    await rig.smoothScrollTo(await scrollFor(rig, "A picture pasted"), 600);
    await rig.moveTo(await rest(rig), undefined, { size: 200 });
    await sleep(1300);

    // The end of the page: the equation numbered at the margin and named as
    // "Equation 1" in the paragraph above it, both drawn from the start, and
    // the citation typed where the formula is introduced. Held first, so the
    // number and the reference to it are read before anything moves.
    //
    // Short of the foot of the page, where the paragraph's offset put it.
    // Scrolled to within 4 px of the bottom, CodeMirror anchors the view
    // on the document's end (scrolledToBottom in its view state), so the
    // list of works cited, arriving under the equation, pushed the page up
    // by its own height and took the paragraph that names the equation out
    // of the frame for the whole of the last hold (the first take,
    // 2026-09-30).
    const foot = await rig.evalFrame(() => {
      const s = window.__mdm.view.scrollDOM;
      return s.scrollHeight - s.clientHeight;
    });
    const toEnd = Math.min(await scrollFor(rig, "An equation given a label"), foot - 12);
    await rig.smoothScrollTo(await wholeRowAt(rig, toEnd), 700);
    await sleep(1200);
    const where = "between two frequencies";
    await rig.pressAt(await atText(rig, where, { end: true }), { size: 10, direct: true });
    await sleep(250);
    // The click aims at the end of the word, and a pixel either side of it
    // is the colon after it; typed there, the key would stand outside the
    // sentence it cites for.
    const caret = await rig.evalFrame((n) => {
      const view = window.__mdm.view;
      return view.state.selection.main.head - (view.state.doc.toString().indexOf(n) + n.length);
    }, where);
    if (caret !== 0) throw new Error(`the caret is ${caret} characters from the end of "${where}"`);
    // Off the text while it is typed, onto the empty line under the
    // paragraph where the next click goes, and right of the words so as to
    // stand over none of them. Not lower down: stepped off as before the
    // bold and the caption, the pointer stood where the list of works cited
    // is drawn, and the entry arrived in the blue an entry takes under the
    // pointer (the first take, 2026-09-30).
    const off = () => emptyBelow(rig, where, 1).then((p) => ({ x: p.x + 160, y: p.y }));
    await rig.moveTo(await off(), undefined, { size: 60 });
    await sleep(160);
    await rig.type(" " + markdown.cite, 70);
    await sleep(600);
    // The caret out of the paragraph, onto the empty line under it: a line
    // shows its source while the caret is on it, and the citation is drawn
    // once it is not. Pandoc prints it in the host (citationService in
    // extension.js), a round trip waited for rather than slept through, so
    // the hold after it is a hold on the drawn citation and its entry. The
    // line is found again, in case the key typed took the paragraph to
    // another row.
    await rig.pressAt(await off(), { size: 60 });
    await rig.waitFor(
      () => !!document.querySelector("#app .mdm-cited:not(.mdm-cited--missing)") && !!document.querySelector("#app .mdm-refs .csl-entry"),
      { timeout: 10000 }
    );
    await rig.moveTo(await rest(rig), undefined, { size: 200 });
    await sleep(1300);

    // The entry clicked, and the bibliography opened at it in the group to
    // the right (openEntry in extension.js), then its tab closed, which gives
    // the document the window back (owner, 2026-09-30). A plain click: the
    // entry opens its file with that and nothing else (handleMouseDown in
    // main.js), and it does so only once the host has said which file holds
    // it, the class waited for here. The pointer on it turns it blue with the
    // hand, which says it is a thing to click before the click does, so the
    // pointer is on it for half a second before it presses.
    const bib = markdown.files[0];
    await rig.waitFor(() => !!document.querySelector("#app .mdm-refs .csl-entry.mdm-refs-entry--source"), {
      timeout: 8000,
    });
    const entry = await rig.at("#app .mdm-refs .csl-entry", { fx: 0.35, fy: 0.3 });
    const pageAt = () => rig.evalFrame(() => window.__mdm.view.scrollDOM.scrollTop);
    const stood = await pageAt();
    await rig.pressAt(entry, { settle: 520, size: 200 });
    await waitTab(rig, bib, true);
    // Long enough to read the entry in its file.
    await sleep(2000);
    await rig.pressAt(await tabClose(rig, bib), { settle: 260, size: 16 });
    await waitTab(rig, bib, false);
    // The document takes the width back, and CodeMirror sets its lines again
    // at it, before the pointer looks for its corner. It comes back on the
    // line it was on, and the take is held to that: this close to the foot
    // of the page it used to come back at the foot, four lines further on,
    // and the last hold lost the paragraph that names the equation (the
    // take of 2026-09-30; keepPlace in main.js is what keeps it now).
    await sleep(450);
    const back = await pageAt();
    if (Math.abs(back - stood) > 1) {
      throw new Error(`the page stood at ${stood} before the .bib opened and is at ${back} after it closed`);
    }
    await rig.moveTo(await rest(rig), undefined, { size: 200 });
    // Long enough to see the document whole again before the last 0.6 s of
    // the take dissolve into its first frame.
    await sleep(1900);
  },
  // Off camera: the division turned off for this document, which the
  // extension keeps per file, the file reverted, and the picture's folder
  // gone, so the next take pastes image.png again and not image-2.png.
  async after(rig) {
    await pickNow(rig, "menu-page", { via: "mdm-hyphenation", label: "No hyphenation" });
    await sleep(600);
    await revertFile(rig);
    await pinCaret(rig);
    fs.rmSync(picturesOf(markdown.doc), { recursive: true, force: true });
    await rig.scrollTop(0);
    await settleUnderHeading(rig);
  },
};

// ---------------------------------------------------------------- score navigation

// Whether the keys of a take are named on screen as they are pressed. On by
// default, each with a few words on what it does the first time it comes up.
// MDM_DEMO_KEYS=caps records the same take with the caps and no words, and
// MDM_DEMO_KEYS=off with nothing named, to set the three side by side.
const KEYS_NAMED = process.env.MDM_DEMO_KEYS !== "off";
const KEYS_SAID = process.env.MDM_DEMO_KEYS !== "caps";

// A key pressed with its name on screen: the caps of the chord and, where
// the press is the first of its kind, a few words on what it does. The mode
// is worked from the keyboard, and a press leaves nothing in a recording to
// say which key it was; the tour could do without a caption because its one
// chord is named by the words of its document (clips.js, at the top), and
// this take presses seventeen different ones (the owner's pick of the three
// ways it was recorded, 2026-10-05).
//
// A name with words goes up a third of a second before its key, so the eye
// has it when the staff changes, and stays up for as long as it takes to
// read (readingTime), which is the hold when none is given: at the pace of
// the first takes, under a second a name, the owner asked for a pause after
// each. A key with no words is seen and not read: an arrow, or a key whose
// words were up a moment ago, and it keeps a hand's pace, a tenth of a
// second before it and a quarter after, less where the beat says so.
// opts.lead, in ms, is the wait before the key where that is not wanted.
//
// A chord pressed again says how many times it has been, since the name
// alone does not change between two presses and four steps down read as one
// (seen on the frames of the third take).
const CAPS = { Control: "Ctrl", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
const pressed = { chord: null, times: 0 };
// How far the names stand from the foot of the window: by the foot (rig.js)
// with nothing set, or under the score while its one line leaves room there
// (namesUnderScore).
const names = { bottom: undefined };

// How long a name is left up to be read: a beat to find it, the words at
// about the pace of a subtitle, and a moment for every cap of the chord.
function readingTime(says, caps) {
  return 420 + 42 * says.length + 110 * caps;
}

async function key(rig, chord, says, hold, opts) {
  const o = opts || {};
  const parts = chord.split("+");
  pressed.times = pressed.chord === chord ? pressed.times + 1 : 1;
  pressed.chord = chord;
  if (KEYS_NAMED) {
    const caps = parts.map((k) => `[[${CAPS[k] || (k.length === 1 ? k.toUpperCase() : k)}]]`).join("");
    const count = pressed.times > 1 ? ` ×${pressed.times}` : "";
    await rig.caption(says && KEYS_SAID ? `${caps}${count}  ${says}` : caps + count, names.bottom);
    await sleep(o.lead === undefined ? (says ? 320 : 100) : o.lead);
  }
  await rig.press(chord);
  await sleep(hold === undefined ? (says ? readingTime(says, parts.length) : 250) : hold);
}

// The names of the keys put away, and the count of presses with them.
async function keysAway(rig) {
  pressed.chord = null;
  if (KEYS_NAMED) await rig.caption(null);
}

// The names set just under the score, where the eye already is, for as long
// as the score is one line and the page has room under it: at the foot of
// the window they stood 150 px from the staff the keys were writing on (the
// frame of this take is taller than the other two's, see its settings).
// Measured once, on the empty score, with room for what the drawing grows
// by as it is written in (16 px, when the pedal of an earlier phrase had a
// half note on its middle line), so the names do not hop when it does.
async function namesUnderScore(rig) {
  const off = await rig.webviewOffset();
  const foot = await rig.evalFrame(() => document.querySelector("#app .mdm-score code.language-abc svg").getBoundingClientRect().bottom);
  const height = (await rig.viewport()).h;
  const bottom = Math.round(height - (off.y + foot + 34 + 38));
  if (bottom < 9) throw new Error(`no room for the names of the keys under the score: ${bottom} px`);
  names.bottom = bottom;
}

// The window point of a place on a staff of the take's score: the staff
// counted from the top, `of` a selector for what stands there (the nth of
// them on that staff, left to right, the first with no nth), and the step
// the point is at, counted as the mode counts it, 2 on the bottom line and 10
// on the top one. With no step, the middle of the thing itself.
async function onStaff(rig, staff, of, step, nth) {
  const off = await rig.webviewOffset();
  const p = await rig.evalFrame(
    (staff, of, step, nth) => {
      const svg = document.querySelector("#app .mdm-score code.language-abc svg");
      const lines = Array.from(svg.querySelectorAll("g.abcjs-staff")).map((g) => {
        const ys = Array.from(g.children).map((l) => {
          const r = l.getBoundingClientRect();
          return (r.top + r.bottom) / 2;
        });
        return { top: Math.min(...ys), bottom: Math.max(...ys) };
      });
      const s = lines[staff];
      if (!s) return null;
      const space = (s.bottom - s.top) / 4;
      const here = Array.from(svg.querySelectorAll(of))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => (r.top + r.bottom) / 2 > s.top - 2 * space && (r.top + r.bottom) / 2 < s.bottom + 2 * space)
        .sort((a, b) => a.left - b.left)[nth];
      if (!here) return null;
      return {
        x: (here.left + here.right) / 2,
        y: step === null ? (here.top + here.bottom) / 2 : s.bottom - ((step - 2) * space) / 2,
      };
    },
    staff,
    of,
    step === undefined ? null : step,
    nth || 0
  );
  if (!p) throw new Error(`nothing matching ${of} on staff ${staff} of the score`);
  return { x: Math.round(off.x + p.x), y: Math.round(off.y + p.y) };
}

// Where the pointer waits over the score's head: beside the heading, right
// of the text, as far in from the pane's edge as rest() is. From there the
// toolbar is reached without crossing the score, whose buttons come up
// under a pointer on it and go as it leaves: on its way from rest() to the
// toolbar the third take showed the rail and the pair at the line's end for
// three frames, and a + under the last barline for one.
async function above(rig) {
  const off = await rig.webviewOffset();
  const p = await rig.evalFrame(() => {
    const pane = document.querySelector("#app .cm-scroller").getBoundingClientRect();
    const head = document.querySelector("#app .cm-content .cm-line").getBoundingClientRect();
    return { x: pane.right - 55, y: (head.top + head.bottom) / 2 };
  });
  return { x: Math.round(off.x + p.x), y: Math.round(off.y + p.y) };
}

// Where the pointer waits once the score fills the pane and nowhere on the
// page is off it: on the bar, right of its last word, where nothing answers
// a pointer.
async function aside(rig) {
  const off = await rig.webviewOffset();
  const p = await rig.evalFrame(() => {
    const bar = document.querySelector("#app .mdm-toolbar").getBoundingClientRect();
    return { x: bar.right - 150, y: (bar.top + bar.bottom) / 2 };
  });
  return { x: Math.round(off.x + p.x), y: Math.round(off.y + p.y) };
}

// The switch of the mode at the head of the side panel, which is up while
// the mode is on: the way out that stands nearest the score.
function modeSwitch(rig) {
  return rig.at('#app .mdm-score-panel__toggle[data-type="mdm-score-navigation"]');
}

// The caret on the blank line over the score's fence, so that the press
// that turns the mode on, which starts on the score the caret is at, finds
// it, and no mark of the prose is shown.
async function settleOverScore(rig) {
  const off = await rig.webviewOffset();
  const c = await rig.evalFrame(() => {
    const view = window.__mdm.view;
    const doc = view.state.doc;
    for (let i = 2; i <= doc.lines; i++) {
      if (doc.line(i).text.startsWith("```") && doc.line(i - 1).text.trim() === "") {
        const at = view.coordsAtPos(doc.line(i - 1).from);
        return at && { x: at.left + 120, y: (at.top + at.bottom) / 2 };
      }
    }
    return null;
  });
  if (!c) throw new Error("the blank line over the score is not on screen");
  await rig.warp(Math.round(off.x + c.x), Math.round(off.y + c.y));
  await rig.click();
  await sleep(500);
}

// The window x of the nth barline of the score's first line, counted from
// the left on its top staff: where a line's end is dropped to end the line
// there.
async function barlineX(rig, nth) {
  const off = await rig.webviewOffset();
  const x = await rig.evalFrame((nth) => {
    const bars = Array.from(document.querySelectorAll("#app .mdm-score code.language-abc svg .abcjs-bar.abcjs-v0"))
      .map((b) => b.getBoundingClientRect())
      .sort((a, b) => a.top - b.top || a.left - b.left);
    const first = bars.filter((b) => Math.abs(b.top - bars[0].top) < 4).sort((a, b) => a.left - b.left)[nth];
    return first ? (first.left + first.right) / 2 : null;
  }, nth);
  if (x === null) throw new Error(`the score's first line has no barline ${nth}`);
  return Math.round(off.x + x);
}

// The window point of the button at the end of the score's first line that
// reads `label` (EDIT_TIPS in main.js), which is on the page only while the
// pointer is on the score. Null while it is not drawn, or is greyed out.
async function lineEnd(rig, label) {
  const off = await rig.webviewOffset();
  const p = await rig.evalFrame((label) => {
    const btn = Array.from(document.querySelectorAll("#app .mdm-score .mdm-score-edit .mdm-score-end__btn")).filter(
      (b) => b.getAttribute("aria-label") === label && b.getAttribute("data-mdm-system") === "0" && b.getBoundingClientRect().width > 0 && !b.classList.contains("mdm-score-edit--off")
    )[0];
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, label);
  return p && { x: Math.round(off.x + p.x), y: Math.round(off.y + p.y) };
}

// What the mode has made of the score: its lines of music, one a part, as
// the document holds them, and what the mode shows of itself.
async function scoreState(rig) {
  return rig.evalFrame(() => {
    const doc = window.__mdm.view.state.doc.toString();
    const g = document.querySelector("#app .mdm-score-cursor");
    return {
      music: doc.split("\n").filter((l) => /\|/.test(l)),
      mode: document.getElementById("app").classList.contains("mdm--score-mode"),
      step: g ? Number(g.getAttribute("data-mdm-step")) : null,
      picked: document.querySelectorAll("#app .mdm-score svg .mdm-score-picked.abcjs-note, #app .mdm-score svg .mdm-score-picked.abcjs-rest").length,
      notices: Array.from(document.querySelectorAll("#app .mdm-score-notice")).map((n) => n.textContent),
    };
  });
}

// A beat held to what it should have left in the document: a take whose keys
// went somewhere else is stopped here and not encoded.
async function expectMusic(rig, after, lines) {
  const s = await scoreState(rig);
  if (s.notices.length) throw new Error(`after ${after} the mode says: ${s.notices.join(" / ")}`);
  if (s.music.join("\n") !== lines.join("\n")) {
    throw new Error(`after ${after} the score reads\n  ${s.music.join("\n  ")}\nand not\n  ${lines.join("\n  ")}`);
  }
}

// Whether the score's player is sounding, as the editor reads it (isSounding
// in main.js): the face abcjs gives its play button while the tune runs.
const sounding = () => {
  const start = document.querySelector("#app .abcjs-midi-start");
  return !!start && start.classList.contains("abcjs-pushed");
};

// The score mode in one take (asked for on 2026-10-05, "the most of it in
// the least time", on an organ score, whose three staves give the keys that
// work across parts something to work on). It begins on nothing: four bars
// of rests on each of the three staves (the owner, 2026-10-06, "empieza el
// pentagrama desde cero"; the first two versions began with both hands
// written and only the pedal to write). The take writes two bars in each
// part with the keys of the figures, selects them in the right hand and the
// pedal alone, copies them into the two bars after, sets the four bars on
// two lines by dragging the first line's end to a barline, and plays the
// second line.
//
// What the owner asked of it once the first version had been seen: the
// names of the keys on screen and each left up long enough to read; a
// selection of the first and the third staff, copied and pasted; a note put
// in between two others with Ctrl or Alt and a figure; and, the day after,
// the end of the line dragged and not pressed.
//
// The phrase is the take's own, in D over a held tonic: the right hand
// falls from G to E and settles on F sharp, the left hand's third, E and G,
// steps up to F sharp and A under it, and the pedal holds D through both
// bars. It is written to be written quickly. The cursor keeps its height
// when it goes from one part to the next, so each part begins a step or
// none from where the last one ended: the right hand stops on its F sharp,
// which on the bass staff under it is the A the left hand's second chord
// has on top; the left hand stops on E, a step over the pedal's D. Of the
// thirteen arrows the phrase costs, none is pressed more than twice
// running.
//
// The right hand is where a note is put in between two others: the G and
// the E are written first, a quarter and a half, and the F sharp between
// them with Ctrl and the figure. Until the bar's last note is in, the bar is
// short, which a figure written over a longer rest leaves it (the owner's
// rule of 2026-10-04, nothing takes time from its neighbours), and the
// editor keeps the barlines of the three parts together all the same
// (MDM_BARS.evenBars; the first take of all showed a part's final barline
// in the middle of the system).
//
// What is copied is what the selection holds once the left hand is let go
// of: the first staff and the third. Pasted over the two empty bars chosen
// in every part, it fills the right hand and the pedal, and the left hand,
// which the copy has nothing for, stays the two rests it was.
//
// `%%stretchlast true` sets the one line to the full measure from the first
// frame: left to its own width the system grew to the right as it was
// written. The frame is taller than the other two takes' (settings): two
// systems of three staves are 508 px, and the pane of the others is 473.
//
//   mouse     the Score navigation button; a click on the right hand's first
//             rest at the height of its G, which is where the cursor stands
//   3                             a quarter note there
//   ↓ ↓, Alt+2                    down to E, and a half note after the G
//   ↑, Ctrl+3                     a quarter on F sharp, put in before the E
//   → →, 1                        the next bar, a whole note
//   Ctrl+↓                        the left hand, at the height the cursor had
//   1, ↓ ↓, Enter                 a whole note, and a third under it
//   ←, ↑, 1, ↓ ↓, Enter           the bar before, the same a step down
//   Ctrl+↓, ↓, 1, →, 1            the pedal, a whole note a bar
//   Ctrl+Shift+← (two)            the two bars chosen in every part
//   Ctrl+Shift+↑ and Space        the left hand walked to, and left out
//   Ctrl+C                        the right hand and the pedal copied
//   → →, Ctrl+Shift+→ (two)       the two empty bars chosen in every part
//   Ctrl+V                        pasted: the left hand keeps its rests
//   mouse                         a click on the third bar; the first
//                                 line's end dragged to its second barline:
//                                 two bars to a line
//   Space                         played from the cursor, on the second line
//   mouse                         the button again, out of the mode
//
// Like the other two it ends away from where it began, is put back off
// camera (after) and dissolves into its first frame.
const scoreNavigation = {
  id: "score-navigation",
  title: "Score navigation in one take",
  doc: "score-navigation.mdm",
  alt:
    "With Score navigation on, a click puts a cursor on an empty organ score and the keys write it: 3, 2 and 1 a quarter, a half and a whole note where the arrows stand, Alt or Ctrl with them a note after or before, Ctrl+↓ the part below and Enter a second note in a chord. Ctrl+Shift with the arrows selects two bars in all three parts and walks up to the left hand, which Space leaves out, and Ctrl+C and Ctrl+V copy the right hand and the pedal into the next two bars. The end of the line, dragged to a barline, sets the four bars on two lines, and Space plays the second as the mode is left.",
  frameRate: 16,
  needsPiano: true,
  dissolve: 0.6,
  // A frame larger in the editor's own pixels than the other takes' (zoom
  // level 1 for their 2: 1200x750 for 1000x625, in the same 1440x900
  // window). Two systems of three staves stand whole in the pane under the
  // player's row from 1.25 (1146x716), and the side panel, up with the mode
  // since 2026-10-14 and shown in the take at the owner's word of
  // 2026-10-15, takes some 290 px of the width: at 1.25 the score was wider
  // than the column the panel left it, and scrolled. Everything in the
  // frame is drawn at 83% of the size it has in the other two.
  settings: { "window.zoomLevel": 1 },
  // The score before the take, as each part stands once the keys have
  // written it, and after the paste and the drag, a line of music a line.
  // The take is held to them on its way (expectMusic), so a key that did
  // something else stops it, and so are the mode's tests (SM93).
  before: ["z4 | z4 | z4 | z4 |]", "z4 | z4 | z4 | z4 |]", "z4 | z4 | z4 | z4 |]"],
  right: "g f e2 | f4 | z4 | z4 |]",
  left: "[E,G,]4 | [F,A,]4 | z4 | z4 |]",
  pedal: "D,4 | D,4 | z4 | z4 |]",
  pasted: ["g f e2 | f4 | g f e2 | f4 |]", "D,4 | D,4 | D,4 | D,4 |]"],
  written: ["g f e2 | f4 |", "g f e2 | f4 |]", "[E,G,]4 | [F,A,]4 |", "z4 | z4 |]", "D,4 | D,4 |", "D,4 | D,4 |]"],
  // What the desktop's clipboard held before the take copied onto it, put
  // back by after(): the rig's VS Code shares the clipboard of the desktop
  // it is started on.
  clipboard: null,
  // The pointer opens the take over the score's head, and not at the foot of
  // the pane as the other takes do: its first errand is the toolbar.
  rest: above,
  async frame(rig) {
    await rig.scrollTop(0);
    scoreNavigation.clipboard = await rig.evalFrame(() => navigator.clipboard.readText().catch(() => null));
    names.bottom = undefined;
    await namesUnderScore(rig);
  },
  settle: settleOverScore,
  async beats(rig) {
    const clip = scoreNavigation;
    const rests = clip.before[0];
    pressed.chord = null;
    await expectMusic(rig, "nothing", clip.before);
    await sleep(450);

    // Into the mode, from its row of the Score menu. The side panel comes up
    // at the right with the mode's buttons, and the column narrows to make
    // room for it: the names of the keys are measured again under the score
    // as it stands now.
    await pick(rig, "menu-score", "mdm-score-navigation", "Score navigation");
    await rig.waitFor(() => !!document.querySelector("#app.mdm-score-panel--open .mdm-score-panel"), { timeout: 4000, poll: 40 });
    await sleep(450);
    await namesUnderScore(rig);

    // A click on the right hand's first bar, at the height of the G over
    // its top line (step 11): the cursor stands where the click was made,
    // bar and pitch. The pointer leaves at once, to the foot of the pane:
    // left where it clicked, the arrow stood over the cursor it had just
    // put there.
    await rig.pressAt(await onStaff(rig, 0, ".abcjs-rest", 11), { size: 30 });
    await sleep(140);
    await rig.moveTo(await rest(rig), undefined, { size: 160 });
    if ((await scoreState(rig)).step !== 11) throw new Error("the click did not put the cursor at the height of the G");

    // The right hand: a quarter, a half after it two steps down, a quarter
    // put in between them, and a whole note in the next bar.
    await key(rig, "3", "a quarter note");
    await key(rig, "ArrowDown", "", 150);
    await key(rig, "ArrowDown", "", 260);
    await key(rig, "Alt+2", "a half note, after it");
    await expectMusic(rig, "Alt+2", ["g e2 | z4 | z4 | z4 |]", rests, rests]);
    await key(rig, "ArrowUp", "", 260);
    await key(rig, "Control+3", "a quarter, before it");
    await key(rig, "ArrowRight", "", 160);
    await key(rig, "ArrowRight", "", 280);
    await key(rig, "1", "a whole note");
    await expectMusic(rig, "the right hand", [clip.right, rests, rests]);

    // The left hand: the cursor comes down at the height it had, which is
    // the A its second chord has on top, and Enter sets a third under the
    // whole note written there. The bar before it is the same again, a step
    // down, and goes faster: nothing in it is new.
    await key(rig, "Control+ArrowDown", "the part below");
    await key(rig, "1", "", 300);
    await key(rig, "ArrowDown", "", 150);
    await key(rig, "ArrowDown", "", 260);
    await key(rig, "Enter", "a note into the chord");
    await key(rig, "ArrowLeft", "", 200);
    await key(rig, "ArrowUp", "", 190);
    await key(rig, "1", "", 220);
    await key(rig, "ArrowDown", "", 130);
    await key(rig, "ArrowDown", "", 190);
    await key(rig, "Enter", "", 380);
    await expectMusic(rig, "the left hand", [clip.right, clip.left, rests]);

    // The pedal, a step under where the left hand stopped: two whole notes,
    // at the same pace.
    await key(rig, "Control+ArrowDown", "", 340);
    await key(rig, "ArrowDown", "", 190);
    await key(rig, "1", "", 220);
    await key(rig, "ArrowRight", "", 190);
    await key(rig, "1", "", 520);
    await expectMusic(rig, "the pedal", [clip.right, clip.left, clip.pedal]);

    // From the pedal's second note leftwards: its two notes are the two
    // bars, chosen in every part.
    await key(rig, "Control+Shift+ArrowLeft", "select, in every part", 340);
    await key(rig, "Control+Shift+ArrowLeft", "select, in every part", undefined, { lead: 120 });
    if ((await scoreState(rig)).picked !== 8) throw new Error("the first two bars are not chosen in all three parts");

    // The left hand walked to and left out: the first staff and the third
    // stay chosen, and are what is copied.
    await key(rig, "Control+Shift+ArrowUp", "walk the parts");
    await key(rig, "Control+Shift+Space", "leave this one out");
    if ((await scoreState(rig)).picked !== 6) throw new Error("the left hand is still among the parts chosen");
    await key(rig, "Control+c", "copy", 900);

    // The two bars after them, chosen in every part, and the copy pasted
    // over: the right hand and the pedal take it, and the left hand, which
    // the copy has nothing for, keeps its rests.
    await key(rig, "ArrowRight", "", 170);
    await key(rig, "ArrowRight", "", 300);
    await key(rig, "Control+Shift+ArrowRight", "select, in every part", 340);
    await key(rig, "Control+Shift+ArrowRight", "select, in every part", 700, { lead: 120 });
    await key(rig, "Control+v", "paste", 0);
    await rig.waitFor((want) => window.__mdm.view.state.doc.toString().includes(want), { timeout: 5000, arg: clip.pasted[0] });
    await sleep(950);
    await expectMusic(rig, "the paste", [clip.pasted[0], clip.left, clip.pasted[1]]);

    // The cursor onto the third bar, which is where the music will be
    // played from once it heads the second line. Put there before the
    // line's end is moved and not after: the paste leaves the cursor on the
    // pedal's last bar, and the page goes at once to the bar the cursor is
    // in when that bar leaves the pane (the sixth take, where a press on
    // the line's end threw the page up a hundred pixels under the
    // pointer). On the top staff of the third bar it stays in sight when
    // that bar becomes the head of a second line.
    await keysAway(rig);
    names.bottom = undefined;
    await rig.pressAt(await onStaff(rig, 0, ".abcjs-notehead", undefined, 4), { size: 24 });
    await sleep(220);

    // Two bars to a line, with the line's end: the pair of buttons is on
    // the page while the pointer is on the score, and the tooltip of the
    // one that takes the end leftwards says that it can be dragged to any
    // barline as well as pressed, two lines of it, left up long enough to
    // read. Dragged, the barline the line would end on is washed as the
    // pointer passes each (the owner's ask of 2026-10-06, where the take
    // before pressed the button twice); let go on the second, the last two
    // bars go down to a line of their own.
    const lineEndButton = async () => {
      for (let tries = 0; tries < 20; tries++) {
        const at = await lineEnd(rig, "Move line end left");
        if (at) return at;
        await sleep(100);
      }
      throw new Error("the button at the end of the first line is not on the page");
    };
    const grip = await lineEndButton();
    await rig.moveTo(grip, undefined, { size: 20 });
    const said = await rig.readTip();
    if (!/^Move line end left\n.*drag/.test(said)) throw new Error(`the tooltip of the line's end reads ${JSON.stringify(said)}`);
    await rig.dragTo({ x: await barlineX(rig, 1), y: grip.y }, undefined, { size: 12, pace: 1.5, hold: 320 });
    await sleep(260);
    // Off the score at once: a pointer on it brings up a + at the barline
    // it is nearest, and the pair at each line's end.
    await rig.moveTo(await aside(rig), undefined, { size: 120 });
    await expectMusic(rig, "the line's end", clip.written);

    // The page down to hold both lines: the second is drawn half under the
    // pane's foot, and a line the pane cut would have the page go to it as
    // it began to sound (the sixth take, where the page turned as Space was
    // pressed). The score's head to the head of the pane, and both lines
    // held to standing whole there with the room the player's row takes.
    const head = await rig.evalFrame(() => {
      const sc = document.querySelector("#app .cm-scroller");
      const block = document.querySelector("#app .mdm-score code.language-abc svg").getBoundingClientRect();
      return Math.max(0, Math.round(sc.scrollTop + block.top - sc.getBoundingClientRect().top - 4));
    });
    await rig.smoothScrollTo(head, 560);
    await sleep(300);
    const fits = await rig.evalFrame(() => {
      const sc = document.querySelector("#app .cm-scroller").getBoundingClientRect();
      const block = document.querySelector("#app .mdm-score code.language-abc svg").getBoundingClientRect();
      return { over: Math.round(sc.top - block.top), under: Math.round(sc.bottom - 36 - block.bottom) };
    });
    if (fits.over > 6 || fits.under < 0) throw new Error(`the two systems do not stand whole in the pane: ${JSON.stringify(fits)}`);

    // Space, from the head of the second line.
    await key(rig, "Space", "play from the cursor", 0);
    await rig.waitFor(sounding, { timeout: 6000, poll: 40 });

    // Out of the mode while it plays, which the music takes no notice of:
    // the switch at the head of the side panel, named by its tooltip, and
    // the panel goes with the mode. The text is the reader's again with
    // everything the keys wrote in it.
    await sleep(700);
    await keysAway(rig);
    await rig.pressAt(await modeSwitch(rig), { tip: true });
    // The switch is left to its tooltip for about a second, and the phrase
    // is two bars long: a press that came after its last note would show a
    // mode left in silence, which is not what this beat is for.
    if (!(await rig.evalFrame(sounding))) throw new Error("the music had stopped when the mode was left");
    await sleep(260);
    await rig.moveTo(await aside(rig), undefined, { size: 120 });
    // To the end of the phrase, which the player's face says.
    await rig.waitFor(() => {
      const start = document.querySelector("#app .abcjs-midi-start");
      return !!start && !start.classList.contains("abcjs-pushed");
    }, { timeout: 9000, poll: 40 });
    await sleep(200);
    if ((await scoreState(rig)).mode) throw new Error("the take ends inside the mode");
  },
  // Off camera: the music stopped, the player shut, the file as it is on
  // disk again (every change of the mode is a change of the document, sent
  // to the host as it is made), and the clipboard as the take found it.
  async after(rig) {
    await rig.caption(null);
    names.bottom = undefined;
    if (await rig.evalFrame(() => !!document.querySelector("#app .abcjs-midi-start"))) {
      const on = await rig.at("#app .mdm-score", { fy: 0.3 });
      await rig.warp(on.x, on.y);
      await sleep(250);
      await rig.moveTo(await rig.at("#app .mdm-score .mdm-audio-toggle"), 300);
      await sleep(200);
      await rig.click();
      await sleep(900);
    }
    // Only a text that was read: an empty one is also what a picture on the
    // clipboard reads as, and writing it back would be no putting back.
    if (scoreNavigation.clipboard) {
      await rig.evalFrame((text) => navigator.clipboard.writeText(text).catch(() => {}), scoreNavigation.clipboard);
    }
    await revertFile(rig);
    await pinCaret(rig);
    await rig.scrollTop(0);
    await settleOverScore(rig);
  },
};

module.exports = {
  clips: [tour, markdown, scoreNavigation],
  picturesOf,
  clearLayout,
  closeAll,
  openDoc,
  pinCaret,
  warmPiano,
  rest,
  settleCaret,
};
