// The clips, one object each, written as beats. There are two and the README
// carries both: the tour, on demo.mdm, and the Markdown one, on markdown.mdm.
//
// A loop has no seam: a clip ends on the frame it opened on, or ends
// elsewhere and dissolves back into its first frame as the tour does, and
// record.js measures that the two ends agree (rig.js, seam). Every click the
// camera sees waits 320 to 520 ms with the pointer on it: long enough for the
// eye to arrive before the change does, and long enough for the editor to
// draw its own tooltip (style.css waits 200 ms and fades it in over 100),
// which names a button without a caption having to. The multicursor button
// waits 1500 ms, because its tooltip has to be read and not only seen. The
// tour carries no caption at all: the one it had under Ctrl+D pulled the eye
// off the four notes changing (owner, 2026-09-14).
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

// The toolbar's font button, pressed. It is a toggle, and the take opens on
// the sans (mdm.textFont in the tour's settings), so the first press sets the
// document in Latin Modern. frame() uses it off camera to measure the page on
// the face the scroll will land in.
async function pressTextFont(rig) {
  const btn = await rig.at('#app button[data-type="mdm-text-font"]');
  await rig.warp(btn.x, btn.y);
  await rig.click();
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
    const button = (type) => rig.at(`#app button[data-type="${type}"]`);
    const row = (label) => rig.atLabel("#app .mdm-menu__item", label);
    await sleep(800);

    // The face, first of the four. Its tooltip reads "LaTeX font" here and
    // not "Usual Markdown font": textFontTip (main.js) names the press and
    // not the state, so on the sans it says where the press goes. It is held
    // 1300 ms after the press, longer than the theme and the staff lines are,
    // because what changes is every word on the page and not one button.
    await rig.moveTo(await button("mdm-text-font"), 600);
    await sleep(520);
    await rig.click();
    await sleep(1300);

    // The three settings after it. Each dwell is long enough for the button's
    // own tooltip to name it, so no caption has to.
    await rig.moveTo(await button("mdm-theme"), 480);
    await sleep(420);
    await rig.click();
    await sleep(520);
    await rig.moveTo(await row("MDM Light"), 420);
    await sleep(340);
    await rig.click();
    await sleep(1100);

    await rig.moveTo(await button("mdm-staff-lines"), 520);
    await sleep(520);
    await rig.click();
    await sleep(1000);

    // Longer on this one. Its tooltip names the setting the edit below turns
    // on, and at 620 ms it was gone before it could be read.
    await rig.moveTo(await button("mdm-match-substring"), 420);
    await sleep(1500);
    await rig.click();
    await sleep(900);

    // Down to the score, to the offset frame() measured. The theme and the ink
    // are set by now; if either had moved the score, the page would open it
    // somewhere the heights above were not measured for, so that stops the take.
    await rig.smoothScrollTo(scoreView.scrollTop, 700);
    await sleep(400);
    const landed = await scoreTop(rig);
    if (Math.abs(landed - scoreView.top) > 3) {
      throw new Error(`the score stands at ${landed} and not at ${scoreView.top} after the scroll`);
    }

    // The score opens its ABC above the drawing.
    await rig.moveTo(await rig.at("#app .mdm-score", { fy: 0.62 }), 620);
    await sleep(360);
    await rig.click();
    await sleep(1600);

    // Four notes at once: the first Ctrl+D selects the bare note under the
    // caret, and the next three add the same letter inside the other notes and
    // chords, which is what the setting just turned on allows.
    await rig.moveTo(await atBareNote(rig, edit.target), 560);
    await sleep(320);
    await rig.click();
    await sleep(300);
    // Off the note before anything is selected. Over text the pointer is the
    // I-beam, centred on its point, and left where the click was it stood on
    // the first E through all four selections and hid it.
    await rig.moveTo({ x: rig.x + 12, y: rig.y + 30 }, 240);
    await sleep(600);
    for (let i = 0; i < 4; i++) {
      await rig.press("Control+d");
      await sleep(i ? 480 : 620);
    }
    await sleep(250);
    // The letter first and the sign in front of it after. Typed in the order
    // it is written, "_" then "e", the score redrew between the two keys with
    // "_" in place of every E, which drew [_c] as a C flat and dropped the lone
    // E's for a frame. Letter first, the step between is a real one: the four
    // notes an octave up, and then the flats.
    const letter = edit.typed.slice(-1);
    const sign = edit.typed.slice(0, -1);
    await rig.type(letter, 120);
    await sleep(900);
    await rig.press("ArrowLeft");
    await sleep(260);
    await rig.type(sign, 120);
    await sleep(1300);

    // The player, and the playhead across the edited tune. The headphones
    // stand in the margin beside the first line of the open source, up while
    // the source is open, and the pointer crosses the drawing on its way to
    // them.
    await rig.moveTo(await rig.at("#app .mdm-score", { fy: 0.55 }), 520);
    await sleep(260);
    await rig.moveTo(await rig.at("#app .mdm-score .mdm-audio-toggle"), 380);
    await sleep(480);
    await rig.click();
    await rig.waitFor(() => !!document.querySelector("#app .abcjs-midi-start"), { timeout: 12000 });
    await sleep(600);
    await rig.moveTo(await rig.at("#app .abcjs-midi-start"), 560);
    await sleep(380);
    await rig.click();
    await rig.moveTo(await rest(rig), 900);

    // The score's export button, pressed while the tune plays, so the take
    // shows that a score can be written out as a file (owner, 2026-09-28).
    // It stands in the rail under the headphones, up while the source is
    // open; its tooltip names it on the way in, and the press opens the two
    // formats beside the rail. Nothing is picked: a row would open VS Code's
    // save dialog over the window.
    //
    // Timed by the player's clock and not by sleeps. The tune is 7.5 s (five
    // bars of 3/4 at 120), and a take that ran past it would show the player
    // stop and reset under the menu. By sleeps alone the first take with this
    // beat pressed 7 s into the tune: the moves ran longer than their
    // nominal times, and the screencast drops the frames still in flight when
    // the camera stops, about 0.85 s of that take's end, which with the
    // 0.6 s dissolve left the menu 0.6 s on screen (measured on its frames).
    // Leaving the rest at 0:02, the press came about 4 s into the tune (the
    // click itself costs some 0.3 s over its sleeps), and a hold of 3.2 s
    // stopped the take a quarter of a second before the tune's end; 2.8 s
    // leaves the menu about 2 s on screen before the dissolve and more than
    // half a second to spare.
    await rig.waitFor(
      () => {
        const clock = document.querySelector("#app .abcjs-midi-clock");
        const m = clock && /(\d+):(\d\d)/.exec(clock.textContent);
        return !!m && Number(m[1]) * 60 + Number(m[2]) >= 2;
      },
      { timeout: 8000, poll: 40 }
    );
    await rig.moveTo(await rig.at("#app .mdm-score .mdm-audio-export"), 700);
    await sleep(520);
    await rig.click();
    await sleep(2800);
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
// or the middle of it with mid set. Null means it is not in the pane, which a
// beat treats as a take gone wrong rather than clicking the title bar.
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
      const x = o.mid && b && Math.abs(b.top - a.top) < 2 ? (a.left + b.right) / 2 : at.left;
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
    "In Latin Modern on MDM Light, the toolbar justifies the text, and English chosen from the hyphenation menu divides its words and writes lang: en into the YAML header that the YAML button shows and hides. Three words turn bold as two asterisks are typed over them, three lines become a list, a phrase is highlighted, a table is filled cell by cell and a pasted picture is saved beside the document. Under an equation numbered at the margin, a citation typed as its key is drawn as the page prints it, and a click on its work, listed at the end, opens the bibliography beside the document at its entry.",
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
    const button = (type) => rig.at(`#app button[data-type="${type}"]`);
    await sleep(900);

    // Justified. The tooltip reads "Justify text" on the ragged page
    // (textAlignTip names the press), and every paragraph on screen squares
    // up at once.
    await rig.moveTo(await button("mdm-text-align"), 620);
    await sleep(520);
    await rig.click();
    await sleep(1300);

    // English, from the hyphenation menu. The host writes the header and
    // answers, and the button lights once the language is dividing the
    // prose: waited for, so the hold after it is a hold on divided words and
    // not on a round trip.
    await rig.moveTo(await button("mdm-hyphenation"), 380);
    await sleep(420);
    await rig.click();
    await sleep(600);
    await rig.moveTo(await rig.atLabel("#app .mdm-menu__item", "English"), 420);
    await sleep(380);
    await rig.click();
    await rig.waitFor(
      () => document.querySelector('#app button[data-type="mdm-hyphenation"]').classList.contains("mdm-btn--on"),
      { timeout: 8000 }
    );
    await sleep(1500);

    // The header the choice wrote, opened above the heading and shut again.
    await rig.moveTo(await button("mdm-front-matter"), 380);
    await sleep(520);
    await rig.click();
    await sleep(2000);
    await rig.click();
    await sleep(1100);

    // Three words at once: a double click takes the first, and Alt with a
    // double click adds each of the others. Then two asterisks typed over the
    // three selections wrap every one of them (surroundSelection in main.js).
    const words = ["melody", "harmony", "rhythm"];
    for (let i = 0; i < words.length; i++) {
      await rig.moveTo(await atText(rig, words[i], { mid: true }), i ? 460 : 720);
      await sleep(i ? 240 : 320);
      await rig.doubleClick({ modifiers: i ? 1 : 0 });
      await sleep(460);
    }
    // Off the word before the typing, as the tour steps off its note: left on
    // it, the I-beam stood over the last selection.
    await rig.moveTo({ x: rig.x + 14, y: rig.y + 34 }, 240);
    await sleep(520);
    await rig.type("*", 0);
    await sleep(320);
    await rig.type("*", 0);
    await sleep(1500);

    // Down to the list, and the three lines made one.
    await rig.smoothScrollTo(await scrollFor(rig, "The list button"), 800);
    await sleep(500);
    const first = await atText(rig, "Justified the text");
    await rig.moveTo({ x: first.x + 1, y: first.y }, 620);
    await sleep(260);
    await rig.dragTo(await atText(rig, "Made three words bold", { end: true }), 650);
    await sleep(420);
    await rig.moveTo(await button("unordered-list"), 640);
    await sleep(500);
    await rig.click();
    await sleep(1300);

    // A phrase highlighted.
    const phrase = "as it marks these";
    const from = await atText(rig, phrase);
    await rig.moveTo({ x: from.x + 1, y: from.y }, 640);
    await sleep(260);
    await rig.dragTo(await atText(rig, phrase, { end: true }), 520);
    await sleep(400);
    await rig.moveTo(await button("highlight"), 640);
    await sleep(500);
    await rig.click();
    await sleep(1300);

    // The table. Scrolled first so that its paragraph, the source the button
    // writes under it and the table drawn under that are all in the pane
    // while it is filled in.
    await rig.smoothScrollTo(await scrollFor(rig, "The table button"), 700);
    await sleep(450);
    await rig.moveTo(await atText(rig, "after the last one.", { end: true }), 620);
    await sleep(300);
    await rig.click();
    await sleep(500);
    await rig.moveTo(await button("insert-table"), 700);
    await sleep(500);
    await rig.click();
    await sleep(900);
    // The pointer to its corner while the keyboard works, so the button's
    // tooltip goes and nothing stands over the cells.
    await rig.moveTo(await rest(rig), 700);
    for (let i = 0; i < markdown.cells.length; i++) {
      await rig.type(markdown.cells[i], 45);
      if (i < markdown.cells.length - 1) {
        await sleep(160);
        await rig.press("Tab");
        await sleep(220);
      }
    }
    await sleep(900);
    // Out of the table: a click on its paragraph, and the source goes,
    // leaving the table drawn.
    await rig.moveTo(await atText(rig, "after the last one.", { end: true }), 700);
    await sleep(300);
    await rig.click();
    await sleep(1400);

    // The picture, pasted into the empty line kept for it under its
    // paragraph, and its caption typed into the label the paste leaves the
    // caret in (writePicture in main.js). A click on the paragraph above
    // draws it.
    await rig.smoothScrollTo(await scrollFor(rig, "A picture pasted"), 700);
    await sleep(450);
    const intro = await atText(rig, "where the caret is:", { end: true });
    await rig.moveTo(await emptyBelow(rig, "where the caret is:", 2), 620);
    await sleep(300);
    await rig.click();
    await sleep(600);
    await pastePicture(rig, PICTURE);
    await rig.waitFor(() => /!\[\]\([^)]*-images\/image\.png\)/.test(window.__mdm.view.state.doc.toString()), {
      timeout: 8000,
    });
    await sleep(900);
    await rig.moveTo({ x: rig.x + 16, y: rig.y + 38 }, 240);
    await rig.type("The extension's icon", 55);
    await sleep(700);
    await rig.moveTo({ x: intro.x + 3, y: intro.y }, 620);
    await sleep(300);
    await rig.click();
    await sleep(350);
    // Down to the picture whole, caption and all, as soon as it is drawn,
    // measured again now that it is: the heights the scroll before the paste
    // was taken from had an empty line where the picture now stands.
    await rig.smoothScrollTo(await scrollFor(rig, "A picture pasted"), 700);
    await rig.moveTo(await rest(rig), 700);
    await sleep(1800);

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
    await rig.smoothScrollTo(await wholeRowAt(rig, toEnd), 800);
    await sleep(1600);
    const where = "between two frequencies";
    await rig.moveTo(await atText(rig, where, { end: true }), 640);
    await sleep(300);
    await rig.click();
    await sleep(350);
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
    await rig.moveTo(await off(), 380);
    await sleep(300);
    await rig.type(" " + markdown.cite, 80);
    await sleep(900);
    // The caret out of the paragraph, onto the empty line under it: a line
    // shows its source while the caret is on it, and the citation is drawn
    // once it is not. Pandoc prints it in the host (citationService in
    // extension.js), a round trip waited for rather than slept through, so
    // the hold after it is a hold on the drawn citation and its entry. The
    // line is found again, in case the key typed took the paragraph to
    // another row.
    await rig.moveTo(await off(), 200);
    await sleep(300);
    await rig.click();
    await rig.waitFor(
      () => !!document.querySelector("#app .mdm-cited:not(.mdm-cited--missing)") && !!document.querySelector("#app .mdm-refs .csl-entry"),
      { timeout: 10000 }
    );
    await rig.moveTo(await rest(rig), 700);
    await sleep(1600);

    // The entry clicked, and the bibliography opened at it in the group to
    // the right (openEntry in extension.js), then its tab closed, which gives
    // the document the window back (owner, 2026-09-30). A plain click: the
    // entry opens its file with that and nothing else (handleMouseDown in
    // main.js), and it does so only once the host has said which file holds
    // it, the class waited for here. The pointer on it turns it blue with the
    // hand, which says it is a thing to click before the click does.
    const bib = markdown.files[0];
    await rig.waitFor(() => !!document.querySelector("#app .mdm-refs .csl-entry.mdm-refs-entry--source"), {
      timeout: 8000,
    });
    await rig.moveTo(await rig.at("#app .mdm-refs .csl-entry", { fx: 0.35, fy: 0.3 }), 700);
    await sleep(700);
    const pageAt = () => rig.evalFrame(() => window.__mdm.view.scrollDOM.scrollTop);
    const stood = await pageAt();
    await rig.click();
    await waitTab(rig, bib, true);
    // Long enough to read the entry in its file.
    await sleep(2600);
    await rig.moveTo(await tabClose(rig, bib), 800);
    await sleep(500);
    await rig.click();
    await waitTab(rig, bib, false);
    // The document takes the width back, and CodeMirror sets its lines again
    // at it, before the pointer looks for its corner. It comes back on the
    // line it was on, and the take is held to that: this close to the foot
    // of the page it used to come back at the foot, four lines further on,
    // and the last hold lost the paragraph that names the equation (the
    // take of 2026-09-30; keepPlace in main.js is what keeps it now).
    await sleep(500);
    const back = await pageAt();
    if (Math.abs(back - stood) > 1) {
      throw new Error(`the page stood at ${stood} before the .bib opened and is at ${back} after it closed`);
    }
    await rig.moveTo(await rest(rig), 700);
    // Long enough to see the document whole again: the screencast drops the
    // frames still in flight when the camera stops (about 0.85 s, the tour's
    // note) and the dissolve takes 0.6 s more, so 2.2 s here left the last
    // picture of the take on screen for about 1.5 s (2026-09-28).
    await sleep(2600);
  },
  // Off camera: the division turned off for this document, which the
  // extension keeps per file, the file reverted, and the picture's folder
  // gone, so the next take pastes image.png again and not image-2.png.
  async after(rig) {
    const hy = await rig.at('#app button[data-type="mdm-hyphenation"]');
    await rig.warp(hy.x, hy.y);
    await rig.click();
    await sleep(500);
    const none = await rig.atLabel("#app .mdm-menu__item", "No hyphenation");
    await rig.warp(none.x, none.y);
    await rig.click();
    await sleep(600);
    await revertFile(rig);
    await pinCaret(rig);
    fs.rmSync(picturesOf(markdown.doc), { recursive: true, force: true });
    await rig.scrollTop(0);
    await settleUnderHeading(rig);
  },
};

module.exports = {
  clips: [tour, markdown],
  picturesOf,
  clearLayout,
  closeAll,
  openDoc,
  pinCaret,
  warmPiano,
  rest,
  settleCaret,
};
