// The clips, one object each, written as beats. There is one, the tour, and
// the README carries it.
//
// A loop has no seam: a clip ends on the frame it opened on, or ends
// elsewhere and dissolves back into its first frame as the tour does, and
// record.js measures that the two ends agree (rig.js, seam). Every click the
// camera sees waits 320 to 520 ms with the pointer on it: long enough for the
// eye to arrive before the change does, and long enough for the editor to
// draw its own tooltip (style.css waits 200 ms and fades it in over 100),
// which names a button without a caption having to. The multicursor button
// waits 1500 ms, because its tooltip has to be read and not only seen.
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

const { sleep } = require("./rig.js");

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
  // A save dialog here means a take left the document edited; the check at the
  // end of every take in record.js should have stopped the run before this.
  if (await rig.page.evaluate(() => !!document.querySelector(".monaco-dialog-box"))) {
    throw new Error("VS Code asks to save demo.mdm: a take left it edited");
  }
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
// the state it closes on. Without it the caret is at offset 0, on the heading, and
// the first toolbar click (which calls view.focus()) shows the heading's "###"
// for the rest of the clip.
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
  const hp = await rig.at("#app .mdm-score .mdm-audio-toggle");
  await rig.warp(hp.x, hp.y);
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

// ---------------------------------------------------------------- the clips

// Several of the editor's features in one take, in the order a reader meets
// them: the theme, the staff lines, the multicursor setting, the source under
// a click, four notes edited at once (two of them inside chords), and the
// tune played with the playhead on the staff.
//
// It opens on MDM Dark whichever window it is shot in (settings) and ends away
// from where it began, in MDM Light with the tune edited and playing. Walking
// all of that back on camera would add seconds that show nothing new, so the
// take is put back off camera (after) and its last stretch dissolves into its
// first frame (dissolve, rig.js dissolveHome), which is what closes its loop.
const tour = {
  id: "tour",
  title: "The editor in one take",
  alt:
    "The document opens in MDM Dark. The theme menu switches it to MDM Light, one toolbar button draws the staff lines in ink and another turns on multicursor matches inside words. A click on the engraved score opens its ABC above the drawing. A click on a bare E, then Ctrl+D four times, selects the four E's of the tune, two of them inside chords; typing e moves all four up an octave, and a flat typed in front of them makes them E flats, each step showing at once in the drawing underneath. The headphones open the player, and play moves a brass playhead across the edited staff, each note turning brass as it sounds.",
  frameRate: 16,
  needsPiano: true,
  settings: { "mdm.theme": "dark" },
  dissolve: 0.6,
  // The edit made in the tune: every E, the first of them bare, becomes the E
  // flat an octave up. demo.mdm's tune is written round it, in C: every E is
  // the third of a C major chord, so the one edit turns each of them minor,
  // and the four flats land in the top space, on the staff, spread over bars
  // 1, 3 and 5. Spread out, they read as four notes changing at once; an
  // earlier tune put three of them in one bar, which read as a bar darkening.
  edit: { target: "E", typed: "_e" },
  async frame(rig) {
    // High enough that the open source, the drawing under it and the
    // player's row all fit. Framed at 170, the row pushed the drawing's foot
    // below the pane and play then scrolled the page 221 px to keep the
    // sounding staff whole (2026-09-10). At 100 (88 once clearTopEdge has
    // taken the cut row off the top) the open source leaves the drawing's
    // foot at 443 of the pane's 504, 478 with the row (2026-09-11).
    await rig.frameAt("#app .mdm-score", 100);
  },
  async beats(rig) {
    const edit = tour.edit;
    const button = (type) => rig.at(`#app button[data-type="${type}"]`);
    const row = (label) => rig.atLabel("#app .mdm-menu__item", label);
    await sleep(800);

    // The three toolbar settings. Each dwell is long enough for the button's
    // own tooltip to name it, so no caption has to.
    await rig.moveTo(await button("mdm-theme"), 600);
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
    await sleep(150);
    await rig.caption("[[Ctrl]][[D]] adds the next one, inside words too");
    await sleep(450);
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
    await rig.caption(null);

    // The player, and the playhead across the edited tune. The headphones show
    // only under a pointer, so the pointer crosses the drawing on its way.
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
    await sleep(4200);
  },
  // Off camera: the player shut, the edit undone, the block folded. The theme
  // and the two toolbar settings go back with the next take's settings.
  async after(rig, ctx) {
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

module.exports = {
  clips: [tour],
  clearLayout,
  closeAll,
  openDoc,
  pinCaret,
  warmPiano,
  rest,
  settleCaret,
};
