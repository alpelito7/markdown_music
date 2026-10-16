// The score mode, driven in a real browser: the switch of the Score menu that freezes
// the text and hands the scores the keyboard (scoreMode in main.js), the
// cursor a click puts on a staff, the arrows that walk it, the layers of the
// keyboard it takes its place among, the bars it moves and adds, the notes
// it writes, and what the mode leaves in the text when it is turned off.
//
// The places and the steps are read the way a reader meets them: a click is
// made on a notehead abcjs drew (.abcjs-notehead) or at a height counted off
// the lines of a staff (g.abcjs-staff), and where the cursor stands is read
// off the drawing it leaves in the score (.mdm-score-cursor, which carries
// the stretch of source its place was written from and its step).
// Run with: node --test --test-concurrency=1 tests/webview-score-mode.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  open,
  update,
  lastEdit,
  skip,
  docText,
  setSelection,
  selectionRanges,
  caretInScore,
  coordsAt,
  posOf,
  postSettings,
  setSettingPosts,
  pressBar,
  barState,
  pressPanel,
  panelState,
  keyLines,
  panelFace,
} = require("./webview/helpers.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One voice over three systems, with a chord, a rest, and the two rests that
// draw nothing (`x` and `y`), which are no places for a cursor. The title
// gives the drawing room over the first staff, where a click can be made
// further up than the cursor goes.
const WALK_SOURCE = ["X:1", "T:Walk", "M:4/4", "L:1/4", "K:C", "C [EG] z x y A |", "B c d e |", "f g a b |]"].join("\n");
const WALK = ["# Walk", "", "Some prose to click on.", "", "```abc", WALK_SOURCE, "```", "", "The end.", ""].join("\n");
// Where each place of WALK was written, in its source, in the order the
// voice goes: what the cursor's drawing names as data-mdm-from.
const at = (needle, nth) => {
  let i = -1;
  for (let k = 0; k <= (nth || 0); k++) i = WALK_SOURCE.indexOf(needle, i + 1);
  return i;
};
const WALK_PLACES = [
  at("C [EG]"),
  at("[EG]"),
  at("z x"),
  at("A |"),
  at("B c"),
  at("c d"),
  at("d e"),
  at("e |"),
  at("f g"),
  at("g a"),
  at("a b"),
  at("b |]"),
];

// Two voices on two staves, over two systems: the second voice is its own
// walk, and it is followed into the next system on its own staff.
const DUET_SOURCE = [
  "X:1",
  "M:4/4",
  "L:1/4",
  "K:C",
  "V:1",
  "c G A F | G E F D |",
  "V:2 clef=bass",
  "C, D, E, F, | G,4 |",
  "V:1",
  "e d c B | c4 |",
  "V:2",
  "A, B, C D | C4 |",
].join("\n");
const DUET = ["Two voices.", "", "```abc", DUET_SOURCE, "```", ""].join("\n");

// The switch of the mode pressed where a hand finds it: the first row of the
// Score menu, under its word. The pointer then goes back up to the bar, where
// it rested while the mode had a button of its own: left where the row was
// it stands over the page, and what a score shows under the pointer is not
// what these tests are about.
async function pressMode(page) {
  await pressBar(page, "mdm-score-navigation");
  const bar = await page.$eval("#app .mdm-toolbar", (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.right - 20, y: b.top + b.height / 2 };
  });
  await page.mouse.move(bar.x, bar.y);
  // The text lets go of the focus on the way in, and gets it back on the way
  // out, and the focus is settled a tick after it moves (syncFocus).
  await sleep(150);
}

async function modeState(page) {
  const row = await barState(page, "mdm-score-navigation");
  return Object.assign(
    { ticked: row.on, off: row.off, name: row.name },
    await page.evaluate(() => ({
      on: document.getElementById("app").classList.contains("mdm--score-mode"),
      editable: window.__mdm.view.contentDOM.getAttribute("contenteditable"),
      source: !!document.querySelector("#app .cm-line.mdm-src-line"),
    }))
  );
}

// Where the cursor stands, read off its drawing: the place (by the source it
// was written from), the step, which score it is in, and its column on the
// screen. Null with no cursor drawn.
function cursor(page) {
  return page.evaluate(() => {
    const groups = document.querySelectorAll("#app .mdm-score-cursor");
    if (!groups.length) return null;
    const g = groups[0];
    const beat = g.querySelector(".mdm-score-cursor__beat").getBoundingClientRect();
    const box = g.querySelector(".mdm-score-cursor__step").getBoundingClientRect();
    return {
      count: groups.length,
      score: Array.from(document.querySelectorAll("#app .mdm-score")).indexOf(g.closest(".mdm-score")),
      from: Number(g.getAttribute("data-mdm-from")),
      step: Number(g.getAttribute("data-mdm-step")),
      x: (beat.left + beat.right) / 2,
      top: beat.top,
      bottom: beat.bottom,
      stepY: (box.top + box.bottom) / 2,
    };
  });
}

// The centres of the heads of a score, in the order abcjs drew them.
function heads(page, score) {
  return page.evaluate((i) => {
    const svg = document.querySelectorAll("#app .mdm-score")[i].querySelector("code.language-abc svg");
    return Array.from(svg.querySelectorAll(".abcjs-notehead")).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    });
  }, score);
}

// The staves of a score, top to bottom: the heights of the top and the
// bottom line on the screen, and the left and right ends.
function staves(page, score) {
  return page.evaluate((i) => {
    const svg = document.querySelectorAll("#app .mdm-score")[i].querySelector("code.language-abc svg");
    return Array.from(svg.querySelectorAll("g.abcjs-staff")).map((staff) => {
      const ys = Array.from(staff.children).map((line) => {
        const r = line.getBoundingClientRect();
        return (r.top + r.bottom) / 2;
      });
      const box = staff.getBoundingClientRect();
      return { top: Math.min(...ys), bottom: Math.max(...ys), left: box.left, right: box.right };
    });
  }, score);
}

// The height of a step on a staff: the bottom line is step 2 and the top
// line step 10, whatever the clef.
function stepAt(staff, step) {
  return staff.bottom - ((step - 2) * (staff.bottom - staff.top)) / 8;
}

async function press(page, key, times) {
  for (let i = 0; i < (times || 1); i++) await page.keyboard.press(key);
}

async function chord(page, mods, key) {
  for (const m of mods) await page.keyboard.down(m);
  await page.keyboard.press(key);
  for (const m of mods.slice().reverse()) await page.keyboard.up(m);
}

test("the score mode freezes the text: no caret, no typing, no block open, and what writes into it greys out (SM01)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1 });
  // The caret in the score's source: the block is open and shows it.
  await caretInScore(h.page, 0);
  assert.equal((await modeState(h.page)).source, true);
  const before = await docText(h.page);
  const selection = await selectionRanges(h.page);

  await pressMode(h.page);
  assert.deepEqual(await modeState(h.page), {
    on: true,
    // The row is the way out as it was the way in, under the one name, and
    // says the mode is on with its tick.
    ticked: true,
    off: false,
    name: "Score navigation",
    editable: "false",
    // Every block drawn as it reads, the score included.
    source: false,
  });
  // Nothing typed, broken or formatted reaches the text. Enter, Backspace
  // and Delete are the mode's own since it writes notes (SM51 on): with
  // Shift, which the mode leaves alone, they are the text's keys still, and
  // the text takes none.
  await h.page.keyboard.type("xyz");
  for (const key of ["Enter", "Backspace", "Delete"]) await chord(h.page, ["Shift"], key);
  await chord(h.page, ["Control"], "b");
  await chord(h.page, ["Control"], "Enter");
  // Nor does a click on the prose: no caret, no selection, no block opened.
  const prose = await coordsAt(h.page, await posOf(h.page, "prose to click"));
  await h.page.mouse.click(prose.x + 20, prose.y);
  await h.page.mouse.click(prose.x + 20, prose.y, { clickCount: 2 });
  await h.page.keyboard.type("q");
  assert.equal(await docText(h.page), before);
  assert.deepEqual(await selectionRanges(h.page), selection);
  assert.equal((await modeState(h.page)).source, false);
  // What writes into the text greys out as a button with nothing to do
  // does, a button of the bar and a row of a menu alike, and with them the
  // words that have nothing but such rows under them: Format, Paragraph and
  // Insert say at a glance that the text is frozen, as the two dozen dark
  // buttons did while the bar was buttons. What is about the look, the
  // playing and the way out does not, nor the words over a row that still
  // answers: Edit keeps the switch of Ctrl+D, Page the look, Export all of
  // its rows, and Score everything, the rows of what the mode's keys do
  // among it, which are greyed everywhere else.
  const FROZEN = [
    "menu-format",
    "menu-paragraph",
    "menu-insert",
    "bold",
    "heading-1",
    "paragraph",
    "code-block",
    "line-break",
    "insert-table",
    "insert-symbol",
    "undo",
    "redo",
    "find",
    "replace",
    "select-next-match",
    "delete-line",
    "mdm-hyphenation",
  ];
  const LIVE = [
    "outline",
    "menu-edit",
    "menu-page",
    "menu-export",
    "mdm-match-substring",
    "page-outline",
    "mdm-theme",
    "mdm-text-font",
    "mdm-text-align",
    "mdm-front-matter",
    "mdm-export-html",
    "mdm-export-midi",
    "menu-score",
    "mdm-score-navigation",
    "mdm-score-panel",
    "score-notes",
    "score-note-3",
    "score-rest",
    "score-keys-sides",
    "score-bar-after",
    "score-copy",
    "score-play",
    "mdm-follow",
    "mdm-score-fill",
    "mdm-staff-lines",
    "mdm-score-align",
  ];
  const looks = await h.page.evaluate((names) => {
    const read = (name) => {
      const cs = getComputedStyle(document.querySelector('#app .mdm-toolbar [data-type="' + name + '"]'));
      return cs.opacity + "/" + cs.pointerEvents;
    };
    const out = {};
    names.forEach((n) => (out[n] = read(n)));
    return out;
  }, FROZEN.concat(LIVE));
  for (const name of FROZEN) {
    assert.equal(looks[name], "0.35/none", name + " is not greyed in the score mode");
  }
  for (const name of LIVE) {
    assert.equal(looks[name], "1/auto", name + " is greyed in the score mode");
  }
  // A greyed word opens nothing, and a greyed row of an open menu does
  // nothing: the press goes through it.
  await h.page.mouse.click(...(await h.page.$eval('#app button[data-type="menu-format"]', (b) => [b.getBoundingClientRect().x + 10, b.getBoundingClientRect().y + 10])));
  assert.equal(await h.page.$$eval("#app .mdm-toolbar__item--open", (els) => els.length), 0, "a greyed word opened its menu");
  await h.page.click('#app button[data-type="menu-edit"]');
  await h.page.mouse.click(...(await h.page.$eval('#app button[data-type="delete-line"]', (b) => [b.getBoundingClientRect().x + 20, b.getBoundingClientRect().y + 10])));
  assert.equal(await docText(h.page), before, "a greyed row wrote into the frozen text");
  await h.page.keyboard.press("Escape");

  // Turned off: the text is given back as it was, the caret in the score
  // and its source open again, and it takes what is typed.
  await pressMode(h.page);
  assert.deepEqual(await modeState(h.page), {
    on: false,
    ticked: false,
    off: false,
    name: "Score navigation",
    editable: "true",
    source: true,
  });
  // And what the mode's keys do is greyed again, the keys being the text's.
  for (const name of ["score-note-3", "score-rest", "score-bar-after", "score-copy", "score-play"]) {
    assert.equal((await barState(h.page, name)).off, true, name + " is not greyed out of the score mode");
  }
  assert.equal(await cursor(h.page), null);
  assert.deepEqual(await selectionRanges(h.page), selection);
  assert.equal(
    await h.page.evaluate(() => getComputedStyle(document.querySelector('#app button[data-type="bold"]')).opacity),
    "1"
  );
  await h.page.keyboard.type("Q");
  assert.notEqual(await docText(h.page), before);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// VS Code's webview host hears every key of the page in the bubble phase on
// the window (D19); the listener here stands in for it.
test("the arrows and undo stop at the score mode, and the keys it does not take reach VS Code (SM02)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1 });
  await h.page.evaluate(() => {
    window.__heard = [];
    window.addEventListener("keydown", (e) => {
      if (!/^(Control|Shift|Alt|Meta)$/.test(e.key)) window.__heard.push((e.ctrlKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + e.code);
    });
  });
  const heard = () => h.page.evaluate(() => window.__heard.splice(0));
  const before = await docText(h.page);
  const selection = await selectionRanges(h.page);
  await pressMode(h.page);
  await heard();
  for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) await h.page.keyboard.press(key);
  // Undo and redo would be answered by VS Code on the file, and the host
  // would bring the change into the frozen text.
  await chord(h.page, ["Control"], "z");
  await chord(h.page, ["Control"], "y");
  await chord(h.page, ["Control", "Shift"], "z");
  assert.deepEqual(await heard(), []);
  assert.equal(await docText(h.page), before);
  assert.deepEqual(await selectionRanges(h.page), selection);
  // Saving is VS Code's, frozen text or not.
  await chord(h.page, ["Control"], "s");
  assert.deepEqual(await heard(), ["Ctrl+KeyS"]);
  // And the search row does not open over the frozen text: a match would
  // open nothing, and its field would take the arrows.
  await chord(h.page, ["Control"], "f");
  await sleep(100);
  assert.equal(await h.page.evaluate(() => !!document.querySelector("#app .mdm-search")), false);
  // Turned off, the arrows are the text's again and the cursor has gone.
  await pressMode(h.page);
  await heard();
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await cursor(h.page), null);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a click puts the cursor on the nearest place of the nearest staff, at the nearest step (SM03)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  const st = await staves(h.page, 0);
  assert.equal(st.length, 3, "WALK is not engraved on three systems");
  // The heads in the order drawn: C, the chord's E and G, then A (the rest
  // has none, and x and y draw nothing).
  const A = hs[3];
  // On the middle line, over the A: the A, at step 6.
  await h.page.mouse.click(A.x, stepAt(st[0], 6));
  let c = await cursor(h.page);
  assert.equal(c.from, WALK_PLACES[3]);
  assert.equal(c.step, 6);
  assert.ok(Math.abs(c.x - A.x) < 1, "the column stands " + (c.x - A.x) + "px off the head");
  assert.ok(Math.abs(c.stepY - stepAt(st[0], 6)) < 1, "the step's box is off the middle line");
  // In the top space: step 9, a space, not a line.
  await h.page.mouse.click(A.x + 2, stepAt(st[0], 9) + 1);
  c = await cursor(h.page);
  assert.deepEqual([c.from, c.step], [WALK_PLACES[3], 9]);
  // Five spaces over the staff, among the title, is further than the
  // cursor goes: three ledger lines, step 16.
  await h.page.mouse.click(A.x, stepAt(st[0], 20));
  assert.equal((await cursor(h.page)).step, 16);
  // On the chord's upper head: the chord, at the G's step.
  await h.page.mouse.click(hs[2].x, hs[2].y);
  c = await cursor(h.page);
  assert.deepEqual([c.from, c.step], [WALK_PLACES[1], 4]);
  // Below the lines of the second system, under its second note: that
  // system, that note, and a step under the bottom line.
  const second = await heads(h.page, 0);
  await h.page.mouse.click(second[5].x, stepAt(st[1], 1));
  c = await cursor(h.page);
  assert.deepEqual([c.from, c.step], [WALK_PLACES[5], 1]);
  assert.ok(c.top > st[0].bottom && c.bottom < st[2].top, "the cursor is not on the second system");
  // One cursor in the document, drawn under the ink, and the wash with no
  // frame: the drawing hands its shapes a stroke to inherit.
  assert.equal(c.count, 1);
  assert.equal(await h.page.evaluate(() => getComputedStyle(document.querySelector("#app .mdm-score-cursor__beat")).stroke), "none");
  assert.equal(
    await h.page.evaluate(() => document.querySelector("#app .mdm-score-cursor").previousElementSibling),
    null
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the arrows walk one voice across bars and systems, and the staff a step at a time, three ledger lines past it at most (SM04)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1 });
  await pressMode(h.page);
  // Put down on entering, with no click: the first place of the score on
  // screen, at its highest note (the C, step 0).
  let c = await cursor(h.page);
  assert.deepEqual([c.from, c.step], [WALK_PLACES[0], 0]);
  const st = await staves(h.page, 0);
  const walked = [c.from];
  for (let i = 1; i < WALK_PLACES.length; i++) {
    await h.page.keyboard.press("ArrowRight");
    c = await cursor(h.page);
    walked.push(c.from);
    // The C stands on a ledger line, so the first step across follows the
    // music to the chord's nearest head, its E (step 2); from there, on the
    // staff, the step is kept across, as a tablature editor keeps the
    // string, over the rest and every note after it.
    assert.equal(c.step, 2, "place " + i);
    const system = i < 4 ? 0 : i < 8 ? 1 : 2;
    assert.ok(c.bottom > st[system].top && c.top < st[system].bottom, "place " + i + " is not drawn on system " + system);
  }
  assert.deepEqual(walked, WALK_PLACES);
  // At the end of the voice it stays.
  await press(h.page, "ArrowRight", 2);
  assert.equal((await cursor(h.page)).from, WALK_PLACES[WALK_PLACES.length - 1]);
  // Back to the C along the staff: the height is kept, over the C's column.
  await press(h.page, "ArrowLeft", 20);
  c = await cursor(h.page);
  assert.deepEqual([c.from, c.step], [WALK_PLACES[0], 2]);
  // A step at a time, a line to the space beside it.
  const steps = [];
  for (let i = 0; i < 3; i++) {
    await h.page.keyboard.press("ArrowUp");
    steps.push((await cursor(h.page)).step);
  }
  assert.deepEqual(steps, [3, 4, 5]);
  // Three ledger lines over the top line and under the bottom one.
  await press(h.page, "ArrowUp", 30);
  assert.equal((await cursor(h.page)).step, 16);
  await press(h.page, "ArrowDown", 40);
  assert.equal((await cursor(h.page)).step, -4);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a duet: a click on the lower staff walks the lower voice, into the next system on its own staff (SM05)", { skip }, async () => {
  const h = await open({ text: DUET, scores: 1 });
  await pressMode(h.page);
  const st = await staves(h.page, 0);
  assert.equal(st.length, 4, "the duet is not engraved as two systems of two staves");
  // The heads in the order drawn: the upper voice of the first system, then
  // the lower. The lower voice's D, is its second.
  const hs = await heads(h.page, 0);
  const D = hs[8 + 1];
  await h.page.mouse.click(D.x, (st[1].top + st[1].bottom) / 2);
  let c = await cursor(h.page);
  assert.equal(c.from, DUET_SOURCE.indexOf("D, E,"));
  assert.ok(c.top >= st[0].bottom, "the cursor is on the upper staff");
  // Three more places of the lower voice, then its next system. abcjs
  // starts a note after a bar line at the space before it (" G,4 " is
  // 71..76 here, measured), so the place is named by its text.
  await press(h.page, "ArrowRight", 3);
  assert.ok(DUET_SOURCE.slice((await cursor(h.page)).from).trimStart().startsWith("G,4"));
  await h.page.keyboard.press("ArrowRight");
  c = await cursor(h.page);
  assert.equal(c.from, DUET_SOURCE.indexOf("A, B,"));
  assert.ok(c.bottom > st[3].top && c.top < st[3].bottom, "the lower voice is not followed onto its own staff");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the player's bar keeps its arrows once it holds the keyboard, and a click on the score takes them back (SM06)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[0].x, hs[0].y);
  assert.equal((await cursor(h.page)).from, WALK_PLACES[0]);
  // The headphones open the player and hand its bar the keyboard, rail and
  // all, under the mode as anywhere.
  await h.page.evaluate(() => document.querySelector("#app .mdm-audio-toggle").click());
  await h.page.waitForFunction(() => window.__mdm.player && window.__mdm.player.bar.contains(document.activeElement), { timeout: 15000 });
  await h.page.keyboard.press("ArrowRight");
  assert.equal((await cursor(h.page)).from, WALK_PLACES[0]);
  await h.page.mouse.click(hs[0].x, hs[0].y);
  await h.page.keyboard.press("ArrowRight");
  assert.equal((await cursor(h.page)).from, WALK_PLACES[1]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the cursor comes back onto a score engraved anew (SM07)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1 });
  await pressMode(h.page);
  await press(h.page, "ArrowRight", 5);
  await press(h.page, "ArrowUp", 2);
  const before = await cursor(h.page);
  assert.deepEqual([before.from, before.step], [WALK_PLACES[5], 4]);
  // A change of face engraves every score again, SVG and all.
  await h.page.evaluate(() => document.querySelector("#app .mdm-score code.language-abc svg").setAttribute("data-old", "1"));
  await postSettings(h.page, { textFont: "sans" });
  await h.page.waitForFunction(() => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    return svg && !svg.hasAttribute("data-old") && svg.querySelector(".mdm-score-cursor");
  }, { timeout: 10000 });
  const after = await cursor(h.page);
  assert.deepEqual([after.count, after.from, after.step], [1, before.from, before.step]);
  // And it walks on from there.
  await h.page.keyboard.press("ArrowRight");
  assert.equal((await cursor(h.page)).from, WALK_PLACES[6]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// What the mode changes in a score, the way a button changes it
// (window.__mdm.editScore): into the text there and then, and posted to the
// host in the same turn, not the 300 ms a keystroke is held. The edits the
// page has posted, read in the same evaluate, say it was not held.
const editScore = (page, after, before) =>
  page.evaluate(
    (a, b) => {
      const done = window.__mdm.editScore(window.__mdm.scoreCursor.pos, a, b);
      const sent = window.__posts.filter((m) => m.type === "edit");
      return { done, sent: sent.length, text: sent.length ? sent[sent.length - 1].text : null };
    },
    after,
    before
  );

test("a change the mode makes is a change of the text at once, posted to the host with no wait, and a step of the history of its own (SM08)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1 });
  await pressMode(h.page);
  // Two changes side by side, made within the half second in which
  // CodeMirror joins typing into one step: they stay two.
  const first = WALK_SOURCE.replace("C [EG]", "^C [EG]");
  const second = WALK_SOURCE.replace("C [EG]", "^^C [EG]");
  let out = await editScore(h.page, first);
  assert.deepEqual([out.done, out.text], [true, WALK.replace(WALK_SOURCE, first)]);
  assert.equal(await docText(h.page), WALK.replace(WALK_SOURCE, first));
  assert.equal(await h.page.evaluate(() => document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")), first);
  out = await editScore(h.page, second);
  assert.deepEqual([out.done, out.text], [true, WALK.replace(WALK_SOURCE, second)]);
  const sent = out.sent;
  // Leaving the mode writes nothing more: the text has it all already.
  await pressMode(h.page);
  await sleep(400);
  assert.equal(await docText(h.page), WALK.replace(WALK_SOURCE, second));
  assert.equal(await h.page.evaluate(() => window.__posts.filter((m) => m.type === "edit").length), sent);
  // And one undo takes back one change.
  await chord(h.page, ["Control"], "z");
  assert.equal(await docText(h.page), WALK.replace(WALK_SOURCE, first));
  await chord(h.page, ["Control"], "z");
  assert.equal(await docText(h.page), WALK);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a score in a quote or a list item keeps its lead on a line the mode adds, and the lines it did not touch (SM09)", { skip }, async () => {
  const text = [
    "> ```abc",
    "> X:1",
    "> K:C",
    ">",
    "> CDEF|",
    "> ```",
    "",
    "- item",
    "",
    "  ```abc",
    "  X:1",
    "  K:C",
    "  GABc|",
    "  ```",
    "",
    "> ```abc",
    "> X:1",
    "> K:C",
    "> CDEF|",
    "> ```",
    "",
  ].join("\n");
  const h = await open({ text, scores: 3 });
  await pressMode(h.page);
  // One score at a time, each found again after the one before it was
  // written, since a change moves every score after it.
  const ok = [];
  for (const [n, after] of [
    [0, "X:1\nK:D\n\nCDEF|\nGFED|"],
    [1, "X:1\nK:C\nGABc|\nd2 c2|\nB4|"],
    // A change that starts at the head of a line: it is written after the
    // line's `> `, not over it.
    [2, "X:1\nK:C\nDEFG|"],
  ]) {
    ok.push(
      await h.page.evaluate(
        (i, a) => window.__mdm.editScore(window.__mdm.view.posAtDOM(document.querySelectorAll("#app .mdm-score")[i]), a),
        n,
        after
      )
    );
  }
  assert.deepEqual(ok, [true, true, true]);
  assert.equal(
    await docText(h.page),
    [
      "> ```abc",
      "> X:1",
      "> K:D",
      ">",
      "> CDEF|",
      "> GFED|",
      "> ```",
      "",
      "- item",
      "",
      "  ```abc",
      "  X:1",
      "  K:C",
      "  GABc|",
      "  d2 c2|",
      "  B4|",
      "  ```",
      "",
      "> ```abc",
      "> X:1",
      "> K:C",
      "> DEFG|",
      "> ```",
      "",
    ].join("\n")
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a score the host rewrites under the mode is drawn from the host's text, and a change made from the text before it is not written (SM10)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1, withFrontMatter: false });
  await pressMode(h.page);
  // The file changed on disk while the text was frozen.
  const theirs = WALK.replace("f g a b", "F G A B");
  const source = WALK_SOURCE.replace("f g a b", "F G A B");
  await update(h.page, theirs, false, 1);
  assert.equal(await docText(h.page), theirs);
  assert.equal(await h.page.evaluate(() => document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")), source);
  // A change asked of the score as it read before: the text no longer
  // holds that score, and the host's change is the one somebody saw made.
  assert.equal((await editScore(h.page, WALK_SOURCE.replace("C [EG]", "^C [EG]"), WALK_SOURCE)).done, false);
  assert.equal(await docText(h.page), theirs);
  // One asked of it as it reads now is made on the host's text.
  assert.equal((await editScore(h.page, source.replace("C [EG]", "^C [EG]"))).done, true);
  assert.equal(await docText(h.page), theirs.replace(source, source.replace("C [EG]", "^C [EG]")));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a document with no score has nothing to walk, and the switch of the mode is greyed until the first score is written (SM11)", { skip }, async () => {
  const h = await open({ text: "Just prose.\n", scores: 0 });
  assert.equal((await modeState(h.page)).off, true);
  // A press that gets there anyway does nothing.
  await h.page.evaluate(() => document.querySelector('#app .mdm-toolbar button[data-type="mdm-score-navigation"]').click());
  assert.equal((await modeState(h.page)).on, false);
  await h.page.evaluate(() => window.__mdm.view.dispatch({ changes: { from: 12, insert: "\n```abc\nCDEF|\n```\n" } }));
  await h.page.waitForFunction(() => !document.querySelector('#app .mdm-toolbar button[data-type="mdm-score-navigation"]').classList.contains("mdm-menu__item--off"), { timeout: 5000 });
  assert.equal((await modeState(h.page)).off, false);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A score longer than the pane: twelve systems of four quarters.
const LONG_SOURCE = ["X:1", "M:4/4", "L:1/4", "K:C"]
  .concat(Array.from({ length: 12 }, () => "C D E F |"))
  .join("\n");
const LONG = ["A long one.", "", "```abc", LONG_SOURCE, "```", "", "After it.", ""].join("\n");

test("the cursor is kept on the pane, and the page is left alone while it shows (SM12)", { skip }, async () => {
  const h = await open({ text: LONG, scores: 1, height: 500 });
  await pressMode(h.page);
  const place = () =>
    h.page.evaluate(() => {
      const beat = document.querySelector("#app .mdm-score-cursor__beat").getBoundingClientRect();
      const scroller = window.__mdm.view.scrollDOM;
      const pane = scroller.getBoundingClientRect();
      return {
        inside: beat.top >= pane.top - 1 && beat.bottom <= pane.top + scroller.clientHeight + 1,
        scrollTop: scroller.scrollTop,
      };
    });
  let moved = 0;
  let still = 0;
  for (let i = 1; i < 48; i++) {
    const before = await place();
    await h.page.keyboard.press("ArrowRight");
    const after = await place();
    assert.ok(after.inside, "place " + i + " is off the pane");
    if (after.scrollTop !== before.scrollTop) moved++;
    // Along one system the page does not move: only the step onto the
    // next system may, and only when that system is not on the pane.
    if (i % 4 !== 0) {
      assert.equal(after.scrollTop, before.scrollTop, "place " + i + " moved the page inside its system");
      still++;
    }
  }
  assert.ok(moved > 0, "the page never followed the cursor down");
  assert.equal(still, 36);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("at a narrow pane a score's box is scrolled sideways to the cursor (SM13)", { skip }, async () => {
  const wide = ["X:1", "M:4/4", "L:1/4", "K:C", "C D E F | G A B c | d e f g | a b c' d' |"].join("\n");
  const h = await open({ text: ["Wide.", "", "```abc", wide, "```", ""].join("\n"), scores: 1 });
  await h.page.setViewport({ width: 420, height: 900 });
  await sleep(300);
  const box = () =>
    h.page.evaluate(() => {
      const code = document.querySelector("#app .mdm-score code.language-abc");
      const beat = document.querySelector("#app .mdm-score-cursor__beat").getBoundingClientRect();
      const left = code.getBoundingClientRect().left;
      return {
        scrolls: code.scrollWidth > code.clientWidth,
        inside: beat.left >= left - 1 && beat.right <= left + code.clientWidth + 1,
        scrollLeft: code.scrollLeft,
      };
    });
  await pressMode(h.page);
  let b = await box();
  assert.ok(b.scrolls, "the score does not overflow its box at 420px");
  for (let i = 1; i < 16; i++) {
    await h.page.keyboard.press("ArrowRight");
    b = await box();
    assert.ok(b.inside, "place " + i + " is outside the score's box");
  }
  const far = b.scrollLeft;
  assert.ok(far > 0, "the box was never scrolled");
  // Back to the first place: the box follows it back, by as little as puts
  // the column in, as the page does (the clef may stay out of the box).
  await press(h.page, "ArrowLeft", 15);
  b = await box();
  assert.ok(b.inside, "the first place is outside the score's box");
  assert.ok(b.scrollLeft < far, "the box did not follow the cursor back");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the cursor starts on the score the caret was in, and the caret is given back there (SM14)", { skip }, async () => {
  const two = ["Two tunes.", "", "```abc", "X:1", "K:C", "CDEF|", "```", "", "```abc", "X:1", "K:G", "GABc|", "```", ""].join("\n");
  const h = await open({ text: two, scores: 2 });
  await caretInScore(h.page, 1);
  const selection = await selectionRanges(h.page);
  await pressMode(h.page);
  const c = await cursor(h.page);
  assert.equal(c.score, 1, "the cursor did not start on the caret's score");
  assert.equal(c.from, "X:1\nK:G\n".length);
  // A press on another row of the bar while the mode lasts leaves the
  // caret where the mode found it, though everywhere else a press on the
  // bar puts away the block being edited (dismissFromOutside).
  await pressBar(h.page, "mdm-staff-lines");
  await sleep(100);
  await pressMode(h.page);
  assert.deepEqual(await selectionRanges(h.page), selection);
  assert.equal((await modeState(h.page)).source, true);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the cursor and the changes Ctrl+Z reaches follow their score when the host writes above it (SM15)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1, withFrontMatter: false });
  await pressMode(h.page);
  await press(h.page, "ArrowRight", 3);
  assert.equal((await cursor(h.page)).from, WALK_PLACES[3]);
  const after = WALK_SOURCE.replace("C [EG]", "^C [EG]");
  assert.equal((await editScore(h.page, after)).done, true);
  // The host has written the change, and says so, as it does to every edit
  // (without it, the text the host sends next reads as the change made a
  // second time).
  await h.page.evaluate(() => {
    const sent = window.__posts.filter((m) => m.type === "edit").pop();
    window.postMessage({ type: "applied", seq: sent.seq, version: 2 }, "*");
  });
  // The file changed on disk above the score while the text was frozen.
  const theirs = WALK.replace("Some prose", "Some more of the prose");
  await update(h.page, theirs.replace(WALK_SOURCE, after), false, 1);
  await h.page.keyboard.press("ArrowRight");
  // The next place, counted in the source the score is drawn from now, a
  // sharp longer.
  assert.equal((await cursor(h.page)).from, after.indexOf("B c"));
  // The change is taken back where the score now stands, with the cursor
  // where it stood when the change was made, and made again.
  await chord(h.page, ["Control"], "z");
  assert.equal(await docText(h.page), theirs);
  const back = await cursor(h.page);
  assert.ok(back, "no cursor after the undo");
  assert.equal(back.from, WALK_PLACES[3]);
  await chord(h.page, ["Control"], "y");
  assert.equal(await docText(h.page), theirs.replace(WALK_SOURCE, after));
  await pressMode(h.page);
  assert.equal(await docText(h.page), theirs.replace(WALK_SOURCE, after));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the search row left open opens nothing in the frozen text, and keeps the arrows it holds (SM16)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1 });
  await caretInScore(h.page, 0);
  await chord(h.page, ["Control"], "f");
  await h.page.waitForSelector("#app .mdm-search__input[main-field]");
  await pressMode(h.page);
  assert.equal((await modeState(h.page)).source, false);
  await h.page.click("#app .mdm-search__input[main-field]");
  await sleep(150);
  assert.equal((await modeState(h.page)).source, false, "the caret's block opened under the frozen text");
  const from = (await cursor(h.page)).from;
  await h.page.keyboard.press("ArrowRight");
  assert.equal((await cursor(h.page)).from, from, "the arrow went to the cursor from the search field");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a change of the mode is drawn from the text when the score comes back into the pane, with the cursor on it (SM17)", { skip }, async () => {
  const prose = Array.from({ length: 150 }, (_, i) => "Paragraph " + i + " of the prose after the tune.").join("\n\n");
  const text = ["```abc", WALK_SOURCE, "```", "", prose, ""].join("\n");
  const h = await open({ text, scores: 1, withFrontMatter: false, height: 500 });
  // The caret away from the score: CodeMirror keeps the main caret's line
  // drawn wherever the pane is, and a document opens with it at the top.
  await setSelection(h.page, text.length);
  await h.page.evaluate(() => (window.__mdm.view.scrollDOM.scrollTop = 0));
  await sleep(200);
  await pressMode(h.page);
  const after = WALK_SOURCE.replace("C [EG]", "^C [EG]");
  assert.equal((await editScore(h.page, after)).done, true);
  await h.page.evaluate(() => document.querySelector("#app .mdm-score").setAttribute("data-old", "1"));
  // Far enough down that CodeMirror lets the widget go, and back.
  await h.page.evaluate(() => (window.__mdm.view.scrollDOM.scrollTop = window.__mdm.view.scrollDOM.scrollHeight));
  await h.page.waitForFunction(() => !document.querySelector("#app .mdm-score"), { timeout: 5000 });
  await h.page.evaluate(() => (window.__mdm.view.scrollDOM.scrollTop = 0));
  await h.page.waitForFunction(() => {
    const block = document.querySelector("#app .mdm-score");
    return block && !block.hasAttribute("data-old") && block.querySelector("code.language-abc svg");
  }, { timeout: 5000 });
  await sleep(100);
  assert.equal(await h.page.evaluate(() => document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")), after);
  // And the cursor is on it again.
  assert.equal((await cursor(h.page)).count, 1);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("two voices on one staff: a click takes the voice whose head is nearer the pointer (SM18)", { skip }, async () => {
  const source = ["X:1", "L:1/4", "%%score (1 2)", "K:C", "V:1", "c d e f |", "V:2", "C D E F |"].join("\n");
  const h = await open({ text: ["One staff, two voices.", "", "```abc", source, "```", ""].join("\n"), scores: 1 });
  await pressMode(h.page);
  const st = await staves(h.page, 0);
  assert.equal(st.length, 1, "the two voices are not on one staff");
  // The heads in the order drawn: the upper voice, then the lower. The
  // second beat of each stands at the same x.
  const hs = await heads(h.page, 0);
  const upper = hs[1];
  const lower = hs[4 + 1];
  assert.ok(Math.abs(upper.x - lower.x) < 1, "the two voices' second beats are not one above the other");
  await h.page.mouse.click(lower.x, lower.y);
  assert.equal((await cursor(h.page)).from, source.indexOf("D E F"));
  await h.page.mouse.click(upper.x, upper.y);
  assert.equal((await cursor(h.page)).from, source.indexOf("d e f"));
  // And the lower voice walks on its own.
  await h.page.mouse.click(lower.x, lower.y);
  await h.page.keyboard.press("ArrowRight");
  assert.equal((await cursor(h.page)).from, source.indexOf("E F"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a click stays on the staff it was made on, where the other staff has notes nearer across (SM19)", { skip }, async () => {
  const source = ["X:1", "L:1/8", "K:C", "V:1", "c d e f g a b c' |", "V:2 clef=bass", "C,8 |"].join("\n");
  const h = await open({ text: ["Eighths over a whole note.", "", "```abc", source, "```", ""].join("\n"), scores: 1 });
  await pressMode(h.page);
  const st = await staves(h.page, 0);
  const hs = await heads(h.page, 0);
  // On the lower staff's middle line, under the upper voice's sixth eighth:
  // the whole note, the one place of the lower staff.
  await h.page.mouse.click(hs[5].x, (st[1].top + st[1].bottom) / 2);
  const c = await cursor(h.page);
  assert.equal(c.from, source.indexOf("C,8"));
  assert.equal(c.step, 6);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The partials of example.mdm's first score: a low C two ledger lines and a
// half under the staff, a high c two ledger lines over it, and the chords
// of the ratios after them.
const PARTIALS_SOURCE = [
  "X:1",
  "T:Partials of a vibrating string",
  "L:1/4",
  "K:C clef=treble",
  "P:partials",
  'C, C G c e g "^-31c"_b c\' |',
  "w: n=1 2 3 4 5 6 7 8",
  "P:ratios",
  "[C,C] [CG] [Gc] [ce] [eg] [g_b] [_bc'] |",
  "w: 2:1 3:2 4:3 5:4 6:5 7:6 8:7",
].join("\n");
const PARTIALS = ["Partials.", "", "```abc", PARTIALS_SOURCE, "```", ""].join("\n");

test("off the staff the cursor follows the notes across, and on it keeps its height (SM20)", { skip }, async () => {
  const h = await open({ text: PARTIALS, scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  const walk = async (key) => {
    await h.page.keyboard.press(key);
    const c = await cursor(h.page);
    return [PARTIALS_SOURCE.slice(c.from).trimStart().split(" ")[0], c.step];
  };
  // The low C, two ledger lines and a half down: Right goes to the C beside
  // it, not to the blank the kept height would be.
  await h.page.mouse.click(hs[0].x, hs[0].y);
  assert.equal((await cursor(h.page)).step, -7);
  assert.deepEqual(await walk("ArrowRight"), ["C", 0]);
  // Middle C is on a ledger line too: on to the G's head.
  assert.deepEqual(await walk("ArrowRight"), ["G", 4]);
  // On the staff the height is kept: the c is passed over at the G's line.
  assert.deepEqual(await walk("ArrowRight"), ["c", 4]);
  assert.deepEqual(await walk("ArrowRight"), ["e", 4]);
  // The space just under the bottom line is on the staff too, a note there
  // needing no ledger line: from the D's height the g is passed over.
  await press(h.page, "ArrowDown", 3);
  assert.equal((await cursor(h.page)).step, 1);
  assert.deepEqual(await walk("ArrowRight"), ["g", 1]);
  // The high c, two ledger lines up: Right goes down to the octave under it
  // in the next chord, the nearest of its two heads.
  await h.page.mouse.click(hs[7].x, hs[7].y);
  assert.equal((await cursor(h.page)).step, 14);
  assert.deepEqual(await walk("ArrowRight"), ["[C,C]", 0]);
  // And back up from there, off the staff again.
  assert.deepEqual(await walk("ArrowLeft"), ["c'", 14]);
  // Up and Down still move the height alone, whatever it is.
  await h.page.keyboard.press("ArrowDown");
  assert.equal((await cursor(h.page)).step, 13);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// VS Code's webview is a frame, and the focus is often somewhere else in the
// workbench when a score is clicked. The page stands in a frame here beside
// a field that holds the focus, which is what the workbench does.
test("the mode takes the keyboard from outside the page's frame, on entering and on a click (SM21)", { skip }, async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const puppeteer = require("puppeteer-core");
  const { CHROME, HARNESS } = require("./webview/helpers.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-frame-"));
  const outer = path.join(dir, "outer.html");
  fs.writeFileSync(outer, `<!doctype html><body style="margin:0"><input id="outside"><iframe id="f" src="${HARNESS}" style="width:900px;height:1400px;border:0"></iframe></body>`);
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--allow-file-access-from-files"], defaultViewport: { width: 1000, height: 1500 } });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__settings = {};
      window.__themes = [];
    });
    await page.goto("file://" + outer);
    const frame = await (await page.$("#f")).contentFrame();
    await frame.waitForFunction(() => window.__posts && window.__posts.some((m) => m.type === "ready"), { timeout: 20000 });
    await frame.evaluate((t) => window.postMessage({ type: "update", text: t, frontMatter: "", withFrontMatter: false, hiddenLines: 0 }, "*"), WALK);
    await frame.waitForFunction(() => document.querySelector("#app code.language-abc svg"), { timeout: 20000 });
    await sleep(300);
    const at = async (sel, i) => {
      const f = await (await page.$("#f")).boundingBox();
      const r = await frame.evaluate((s, n) => document.querySelectorAll(s)[n].getBoundingClientRect().toJSON(), sel, i || 0);
      return { x: f.x + (r.left + r.right) / 2, y: f.y + (r.top + r.bottom) / 2 };
    };
    const from = () => frame.evaluate(() => Number(document.querySelector("#app .mdm-score-cursor").getAttribute("data-mdm-from")));
    // Entered with a click on the switch of the Score menu while the field
    // outside has the focus: the arrows walk the score, and nothing is typed
    // outside.
    await page.focus("#outside");
    const word = await at('#app .mdm-toolbar button[data-type="menu-score"]');
    await page.mouse.click(word.x, word.y);
    await sleep(200);
    const row = await at('#app .mdm-toolbar button[data-type="mdm-score-navigation"]');
    await page.mouse.click(row.x, row.y);
    await sleep(200);
    await page.keyboard.press("ArrowRight");
    assert.equal(await from(), WALK_PLACES[1], "the arrow did not reach the score after the switch");
    // The focus taken outside again, and a click on the A's head.
    await page.focus("#outside");
    const A = await at("#app code.language-abc svg .abcjs-notehead", 3);
    await page.mouse.click(A.x, A.y);
    await sleep(100);
    await page.keyboard.press("ArrowRight");
    assert.equal(await from(), WALK_PLACES[4], "the arrow did not reach the score after a click on it");
    assert.equal(await page.$eval("#outside", (el) => el.value), "");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("under the mode the pointer is the arrow over the drawings, and the rail keeps its hand (SM22)", { skip }, async () => {
  const text = ["Prose with $x^2$ in it.", "", "```abc", WALK_SOURCE, "```", "", "| a | b |", "|---|---|", "| 1 | 2 |", ""].join("\n");
  const h = await open({ text, scores: 1 });
  const cursors = () =>
    h.page.evaluate(() => {
      const of = (sel) => getComputedStyle(document.querySelector(sel)).cursor;
      return {
        score: of("#app .mdm-score code.language-abc"),
        math: of("#app .mdm-math"),
        table: of("#app .mdm-table"),
        copy: of("#app .mdm-score .mdm-copy"),
      };
    });
  assert.deepEqual(await cursors(), { score: "pointer", math: "pointer", table: "pointer", copy: "pointer" });
  await pressMode(h.page);
  assert.deepEqual(await cursors(), { score: "default", math: "default", table: "default", copy: "pointer" });
  await pressMode(h.page);
  assert.equal((await cursors()).score, "pointer");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The third round: the music, a stretch, and bars moved ----------
//
// Asked for on 2026-09-29, with the decisions left to the editor and put
// down in main.js (the score mode): Space plays from the cursor and pauses,
// a drag chooses a stretch that plays alone, and a drag of a line's end moves
// bars from line to line. Alt+Up and Alt+Down moved them too until the
// fourth round put that on the staff (the chrome on a score, further down).

// Two lines of even eighths at a quarter of 100: a note every 300 ms, so
// place i of the voice sounds from 0.3 i s and the tune lasts 9.6 s.
const EIGHTHS_SOURCE = ["X:1", "M:4/4", "L:1/8", "Q:1/4=100", "K:C", "CDEF GABc | cBAG FEDC |", "CDEF GABc | cBAG FEDC |]"].join("\n");
const EIGHTHS = ["Eighths.", "", "```abc", EIGHTHS_SOURCE, "```", ""].join("\n");
const EIGHTH = 0.3;
// Where each place of EIGHTHS was written, in the order it sounds.
const EIGHTHS_PLACES = (() => {
  const out = [];
  const re = /[A-Ga-g]/g;
  const body = EIGHTHS_SOURCE.indexOf("CDEF");
  let m;
  while ((m = re.exec(EIGHTHS_SOURCE.slice(body)))) out.push(body + m.index);
  return out;
})();
// The place the cursor stands on, as an index into EIGHTHS_PLACES: its
// drawing names the source it was written from, which after a barline takes
// in the space before the note.
async function eighth(page) {
  const c = await cursor(page);
  if (!c) return null;
  const at = c.from + (EIGHTHS_SOURCE.charAt(c.from) === " " ? 1 : 0);
  return EIGHTHS_PLACES.indexOf(at);
}

// Where the tune is sounding from, off the playback sources abcjs starts on
// the realtime context: the offset each starts at, and where the last one
// has got to.
async function listenSources(page) {
  await page.evaluate(() => {
    window.__starts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset) {
      try {
        if (this.buffer && this.context.constructor.name === "AudioContext") {
          window.__starts.push({ ctx: this.context, calledAt: this.context.currentTime, offset: offset || 0 });
        }
      } catch (e) {
        // never break playback from the spy
      }
      return start.apply(this, arguments);
    };
    window.__heardAt = function () {
      const s = window.__starts[window.__starts.length - 1];
      return s ? s.ctx.currentTime - s.calledAt + s.offset : null;
    };
  });
}
const lastStart = (page) => page.evaluate(() => (window.__starts.length ? window.__starts[window.__starts.length - 1].offset : null));
const sounding = (page) => page.evaluate(() => !!document.querySelector(".mdm-audio .abcjs-midi-start.abcjs-pushed"));
async function untilSounding(page, yes) {
  await page.waitForFunction((want) => !!document.querySelector(".mdm-audio .abcjs-midi-start.abcjs-pushed") === want, { timeout: 15000 }, yes);
}
const cursorShown = (page) =>
  page.evaluate(() => {
    const g = document.querySelector("#app .mdm-score-cursor");
    return !!g && getComputedStyle(g).visibility === "visible";
  });
const lineShown = (page) =>
  page.evaluate(() => {
    const line = document.querySelector("#app .mdm-play-cursor");
    return !!line && getComputedStyle(line).visibility === "visible";
  });

test("Space plays from the cursor and pauses, the cursor stepping aside while it sounds and back on the note it stopped on (SM23)", { skip }, async () => {
  const h = await open({ text: EIGHTHS, scores: 1 });
  await listenSources(h.page);
  // What VS Code would hear of the keys (D19): none of the mode's.
  await h.page.evaluate(() => {
    window.__heard = [];
    window.addEventListener("keydown", (e) => window.__heard.push(e.code));
  });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[4].x, hs[4].y);
  assert.equal(await eighth(h.page), 4);
  assert.equal(await h.page.evaluate(() => !!document.querySelector(".mdm-audio")), false);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  // The player's row opened on this score, the sound started at the G, the
  // line walks and the cursor has stepped aside.
  assert.equal(await h.page.evaluate(() => document.querySelector("#app .mdm-score").hasAttribute("data-mdm-audio")), true);
  assert.ok(Math.abs((await lastStart(h.page)) - 4 * EIGHTH) < 0.03, "the sound started at " + (await lastStart(h.page)));
  await sleep(250);
  assert.equal(await cursorShown(h.page), false);
  assert.equal(await lineShown(h.page), true);
  await sleep(450);
  const heardAt = await h.page.evaluate(() => window.__heardAt());
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  await sleep(100);
  // Back on the note that was sounding, and the paused line out of sight.
  assert.equal(await cursorShown(h.page), true);
  assert.equal(await lineShown(h.page), false);
  const landed = await eighth(h.page);
  // On the note sounding when the key went down, or the next one when the
  // pause landed just past its attack.
  assert.ok(landed >= 5 && landed <= Math.floor((heardAt + 0.1) / EIGHTH), "the cursor landed on " + landed + " at " + heardAt);
  // Space again with the cursor where it landed: the music takes up where it
  // stopped, not from the head of the note.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  const resumed = await lastStart(h.page);
  // From where the pause stopped it: a little after the moment read before
  // the key, and never back at the head of the note the cursor stands on.
  assert.ok(resumed >= heardAt - 0.02 && resumed < heardAt + 0.25, "resumed at " + resumed + " against " + heardAt);
  assert.ok(resumed - landed * EIGHTH > 0.02, "resumed at the head of the note, " + resumed);
  // An arrow while it sounds stops it, and moves from the note sounding.
  await sleep(300);
  const now = await h.page.evaluate(() => window.__heardAt());
  await h.page.keyboard.press("ArrowRight");
  await untilSounding(h.page, false);
  const next = await eighth(h.page);
  assert.ok(Math.abs(next - (Math.floor(now / EIGHTH) + 1)) <= 1, "the arrow went to " + next + " from " + now);
  // Moved, Space plays from the cursor again.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.ok(Math.abs((await lastStart(h.page)) - next * EIGHTH) < 0.03);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  assert.deepEqual(await h.page.evaluate(() => window.__heard.filter((c) => c === "Space" || /^Arrow/.test(c))), []);
  // Leaving the mode leaves the player open, and the line shows where it is.
  await pressMode(h.page);
  assert.equal(await h.page.evaluate(() => !!document.querySelector(".mdm-audio")), true);
  assert.equal(await lineShown(h.page), true);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A tune of four eighths at a quarter of 200: 0.6 s, over before a test
// has to wait for it.
const SHORT_SOURCE = ["X:1", "M:2/4", "L:1/8", "Q:1/4=200", "K:C", "CDEF |]"].join("\n");

test("the end of the tune, and the player's stop, take the cursor back to where the playing began (SM24)", { skip }, async () => {
  const h = await open({ text: ["Short.", "", "```abc", SHORT_SOURCE, "```", ""].join("\n"), scores: 1 });
  await listenSources(h.page);
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[1].x, hs[1].y);
  const from = (await cursor(h.page)).from;
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await untilSounding(h.page, false);
  await sleep(100);
  assert.equal((await cursor(h.page)).from, from);
  assert.equal(await cursorShown(h.page), true);
  // And Space plays from there again.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.ok(Math.abs((await lastStart(h.page)) - 0.15) < 0.03, "the replay started at " + (await lastStart(h.page)));
  await untilSounding(h.page, false);
  // The player's stop, pressed while it sounds: the same.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await h.page.evaluate(() => document.querySelector(".mdm-audio .mdm-audio-stop").click());
  await untilSounding(h.page, false);
  await sleep(100);
  assert.equal((await cursor(h.page)).from, from);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The stretch chosen, read off its drawing: how many bands, and where each
// stands on the screen, and the corners marked on them (SM99).
function selection(page) {
  return page.evaluate(() => {
    const g = document.querySelector("#app .mdm-score-selection");
    if (!g) return null;
    const svg = g.ownerSVGElement;
    const box = (r) => {
      const b = r.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    };
    const band = g.querySelector(".mdm-score-selection__band");
    return {
      first: svg.firstChild === g,
      bands: Array.from(g.querySelectorAll(".mdm-score-selection__band")).map(box),
      corners: Array.from(g.querySelectorAll(".mdm-score-selection__corner")).map(box),
      fill: getComputedStyle(band).fill,
      opacity: getComputedStyle(band).fillOpacity,
    };
  });
}

test("a drag chooses a stretch in the voice it began in, washed under the ink over that voice's staff on each line it runs across (SM25)", { skip }, async () => {
  const h = await open({ text: DUET, scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  const st = await staves(h.page, 0);
  assert.equal(st.length, 4, "DUET is not two systems of two staves");
  // From the second note of the upper voice to the third of its next line.
  const upper = hs.filter((p) => p.y < st[0].bottom + 10 && p.y > st[0].top - 20);
  const upperNext = hs.filter((p) => p.y < st[2].bottom + 10 && p.y > st[2].top - 20);
  await h.page.mouse.move(upper[1].x, upper[1].y);
  await h.page.mouse.down();
  await h.page.mouse.move(upper[4].x, upper[4].y, { steps: 4 });
  await h.page.mouse.move(upperNext[2].x, upperNext[2].y, { steps: 4 });
  await h.page.mouse.up();
  const sel = await selection(h.page);
  assert.equal(sel.bands.length, 2);
  assert.equal(sel.first, true, "the wash is not under everything");
  assert.equal(sel.opacity, "0.1");
  // Each band over the staff of the voice it was drawn in, and not over
  // the other's: the stretch is that voice's until Ctrl says every voice
  // (the owner's keys of 2026-10-03, SM73; until then it lay over both).
  assert.ok(sel.bands[0].top <= st[0].top && sel.bands[0].bottom >= st[0].bottom && sel.bands[0].bottom < st[1].top, "the first band is not the upper staff's");
  assert.ok(sel.bands[1].top <= st[2].top && sel.bands[1].bottom >= st[2].bottom && sel.bands[1].bottom < st[3].top, "the second band is not the upper staff's");
  // From the column of the note pressed to the one let go over.
  assert.ok(Math.abs(sel.bands[0].left + 7 * (sel.bands[0].right - sel.bands[0].left) / (sel.bands[0].right - sel.bands[0].left) - upper[1].x) < 12);
  const model = await h.page.evaluate(() => window.__mdm.scoreCursor);
  assert.equal(model.anchor, 1);
  assert.equal(model.stop, 10);
  // Shift and an arrow stretch it on; Escape lets it go and leaves the
  // cursor where it is.
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await h.page.evaluate(() => [window.__mdm.scoreCursor.anchor, window.__mdm.scoreCursor.stop]), [1, 11]);
  await h.page.keyboard.press("Escape");
  assert.equal(await selection(h.page), null);
  assert.equal(await h.page.evaluate(() => window.__mdm.scoreCursor.stop), 11);
  // Shift with a click stretches from the cursor; a plain arrow lets go,
  // and leaves the cursor on the end of the stretch that side (SM85).
  await h.page.keyboard.down("Shift");
  await h.page.mouse.click(upper[0].x, upper[0].y);
  await h.page.keyboard.up("Shift");
  assert.deepEqual(await h.page.evaluate(() => [window.__mdm.scoreCursor.anchor, window.__mdm.scoreCursor.stop]), [11, 0]);
  assert.equal((await selection(h.page)).bands.length, 2);
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await selection(h.page), null);
  assert.deepEqual(await h.page.evaluate(() => [window.__mdm.scoreCursor.anchor, window.__mdm.scoreCursor.stop]), [null, 11]);
  // Leaving the mode takes the wash with it.
  await chord(h.page, ["Shift"], "ArrowRight");
  await pressMode(h.page);
  assert.equal(await selection(h.page), null);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's J of design/design-score-mode.html, 4 bis (2026-10-06), out of
// six outlines drawn whole for him, a dashed one being what he had turned
// down: "Me quedo con J y sobre el punto 7, el mismo J pero que quede
// abierta". The band keeps its wash and wears its four corners in the
// brass, and where the stretch goes on into another line the band has no
// corners on that side.
const CORNERS_SOURCE = ["X:1", "M:4/4", "L:1/4", "K:C", "C E G c | e f g a |", "c' b a g | f e d c |", "B A G F | E D C2 |]"].join("\n");
const CORNERS = ["Corners.", "", "```abc", CORNERS_SOURCE, "```", "", "Two voices.", "", "```abc", DUET_SOURCE, "```", ""].join("\n");
// Which corners of each band are marked, read off the screen: a corner's
// box stands in a corner of its band, and one that stands in no band's is
// a stray.
function cornersOn(sel) {
  const near = (a, b) => Math.abs(a - b) < 1.5;
  const bands = sel.bands.map(() => []);
  let stray = 0;
  sel.corners.forEach((c) => {
    const i = sel.bands.findIndex((b) => (near(c.left, b.left) || near(c.right, b.right)) && (near(c.top, b.top) || near(c.bottom, b.bottom)));
    if (i < 0) {
      stray++;
      return;
    }
    const b = sel.bands[i];
    bands[i].push((near(c.top, b.top) ? "top" : "bottom") + " " + (near(c.left, b.left) ? "left" : "right"));
  });
  return { bands: bands.map((names) => names.sort()), stray: stray };
}
const FOUR = ["bottom left", "bottom right", "top left", "top right"];
// How far the colour at a point of the page is from the brass, the nearest
// of the pixels within two of it: 0 where the brass itself is drawn.
async function fromBrass(page, x, y) {
  const png = await page.screenshot({ clip: { x: Math.round(x) - 2, y: Math.round(y) - 2, width: 5, height: 5 }, encoding: "base64" });
  return page.evaluate(async (b64) => {
    const hex = getComputedStyle(document.getElementById("app")).getPropertyValue("--mdm-play-accent").trim();
    const brass = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const g = cv.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let least = Infinity;
    for (let i = 0; i < d.length; i += 4) least = Math.min(least, Math.hypot(d[i] - brass[0], d[i + 1] - brass[1], d[i + 2] - brass[2]));
    return least;
  }, png);
}

test("a stretch chosen wears its corners in the brass, half a staff space off the staff and clear of a ledger line at its end, and none on the side where it goes on into another line (SM99)", { skip }, async () => {
  const h = await open({ text: CORNERS, scores: 2 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  const st = await staves(h.page, 0);
  assert.equal(st.length, 3, "CORNERS is not three lines of one staff");
  const space = (st[0].bottom - st[0].top) / 4;
  const unit = space / 7.75;
  // The last two notes of the first line, the second of them on a ledger
  // line over the staff.
  await h.page.mouse.click(hs[6].x, hs[6].y);
  for (let i = 0; i < 2; i++) await chord(h.page, ["Shift"], "ArrowRight");
  await h.page.mouse.move(5, 5);
  let sel = await selection(h.page);
  assert.equal(sel.bands.length, 1);
  assert.deepEqual(cornersOn(sel), { bands: [FOUR], stray: 0 });
  assert.equal(sel.first, true, "the stretch is not drawn under the ink");
  // Half a staff space off the staff's outer lines, where no line of the
  // staff or over it is ever drawn: on the edge the band had before it had
  // corners, a quarter of a space off, a mark along it read as a sixth
  // line.
  const band = sel.bands[0];
  assert.ok(Math.abs(st[0].top - band.top - space / 2) < 0.3, "the band begins " + (st[0].top - band.top) + " over the staff, and a space is " + space);
  assert.ok(Math.abs(band.bottom - st[0].bottom - space / 2) < 0.3, "the band ends " + (band.bottom - st[0].bottom) + " under the staff");
  // Wider than what the notes at its ends draw, the ledger line of the
  // last of them included, which stands under the notes of its system and
  // not in the note's group since main drew it there (sinkLedgers).
  const ends = await h.page.evaluate(() => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    const notes = Array.from(svg.querySelectorAll(".mdm-score-picked.abcjs-note"));
    const drawn = notes.concat(Array.from(svg.querySelectorAll(".abcjs-ledger.mdm-score-picked"))).map((n) => n.getBoundingClientRect());
    return { count: notes.length, left: Math.min(...drawn.map((r) => r.left)), right: Math.max(...drawn.map((r) => r.right)) };
  });
  assert.equal(ends.count, 2);
  assert.ok(ends.right - hs[7].x > 6 * unit, "the last note has no ledger line past its head: " + (ends.right - hs[7].x));
  assert.ok(band.right - ends.right > 1 && ends.left - band.left > 1, "the band stands " + (ends.left - band.left) + " and " + (band.right - ends.right) + " past its notes");
  // Each corner two arms of five units, in the brass at the weight of the
  // cursor's outline, with nothing filled between them.
  sel.corners.forEach((c) => {
    assert.ok(Math.abs(c.right - c.left - 5 * unit) < 0.3 && Math.abs(c.bottom - c.top - 5 * unit) < 0.3, "a corner is " + (c.right - c.left) + " by " + (c.bottom - c.top));
  });
  const look = await h.page.evaluate(() => {
    const el = document.querySelector("#app .mdm-score-selection__corner");
    const cs = getComputedStyle(el);
    const hex = cs.getPropertyValue("--mdm-play-accent").trim();
    const accent = "rgb(" + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ") + ")";
    const step = getComputedStyle(document.querySelector("#app .mdm-score-cursor__step"));
    return { brass: cs.stroke === accent, width: cs.strokeWidth, asTheCursor: cs.strokeWidth === step.strokeWidth, fill: cs.fill, kept: el.getAttribute("vector-effect") };
  });
  assert.deepEqual(look, { brass: true, width: "1.6px", asTheCursor: true, fill: "none", kept: "non-scaling-stroke" });
  // And as the page shows it: the brass at the corners, and none along
  // the edge between two of them, which is the band's wash and no line.
  assert.ok((await fromBrass(h.page, band.left, band.bottom)) < 30, "no brass at the bottom left corner");
  assert.ok((await fromBrass(h.page, band.right, band.bottom)) < 30, "no brass at the bottom right corner");
  assert.ok((await fromBrass(h.page, (band.left + band.right) / 2, band.bottom)) > 100, "a line runs along the bottom of the band");
  // One note: the narrowest band there is, and its corners still apart.
  await h.page.keyboard.press("Escape");
  await h.page.mouse.click(hs[2].x, hs[2].y);
  await chord(h.page, ["Shift"], "ArrowRight");
  await h.page.mouse.move(5, 5);
  sel = await selection(h.page);
  assert.deepEqual(cornersOn(sel), { bands: [FOUR], stray: 0 });
  const tops = sel.corners.filter((c) => Math.abs(c.top - sel.bands[0].top) < 1.5).sort((a, b) => a.left - b.left);
  assert.ok(tops[1].left - tops[0].right > 5 * unit, "the corners of one note stand " + (tops[1].left - tops[0].right) + " apart");
  // Over three lines: the corners of its beginning on the first, those of
  // its end on the third, and the line it passes through with none.
  await h.page.keyboard.press("Escape");
  await h.page.mouse.click(hs[6].x, hs[6].y);
  for (let i = 0; i < 12; i++) await chord(h.page, ["Shift"], "ArrowRight");
  sel = await selection(h.page);
  assert.equal(sel.bands.length, 3);
  assert.deepEqual(cornersOn(sel), { bands: [["bottom left", "top left"], [], ["bottom right", "top right"]], stray: 0 });
  // Drawn back onto its first line, it is closed again, and nothing of the
  // other lines is left behind.
  for (let i = 0; i < 10; i++) await chord(h.page, ["Shift"], "ArrowLeft");
  sel = await selection(h.page);
  assert.equal(sel.bands.length, 1);
  assert.deepEqual(cornersOn(sel), { bands: [FOUR], stray: 0 });
  // Let go, the corners go with the band.
  await h.page.keyboard.press("Escape");
  assert.equal(await selection(h.page), null);
  assert.equal(await h.page.evaluate(() => document.querySelectorAll("#app .mdm-score-selection__corner").length), 0);

  // Two voices on two staves. Over every voice the band lies across both
  // staves and its corners are the band's, not each staff's; from the last
  // note of a line into the next, open on that side.
  const duet = await heads(h.page, 1);
  const ds = await staves(h.page, 1);
  assert.equal(ds.length, 4, "DUET is not two systems of two staves");
  const upper = duet.filter((p) => p.y < ds[0].bottom + 10 && p.y > ds[0].top - 20).sort((a, b) => a.x - b.x);
  await h.page.mouse.click(upper[7].x, upper[7].y);
  for (let i = 0; i < 2; i++) await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await h.page.mouse.move(5, 5);
  sel = await selection(h.page);
  assert.equal(sel.bands.length, 2);
  assert.ok(sel.bands[0].top < ds[0].top && sel.bands[0].bottom > ds[1].bottom && sel.bands[1].top < ds[2].top && sel.bands[1].bottom > ds[3].bottom, "the bands are not across both staves");
  assert.deepEqual(cornersOn(sel), { bands: [["bottom left", "top left"], ["bottom right", "top right"]], stray: 0 });
  // In the upper voice alone, the band and its corners are that staff's.
  await h.page.keyboard.press("Escape");
  await h.page.mouse.click(upper[1].x, upper[1].y);
  for (let i = 0; i < 2; i++) await chord(h.page, ["Shift"], "ArrowRight");
  await h.page.mouse.move(5, 5);
  sel = await selection(h.page);
  assert.equal(sel.bands.length, 1);
  assert.ok(sel.bands[0].bottom < ds[1].top, "the band is not the upper staff's alone");
  assert.deepEqual(cornersOn(sel), { bands: [FOUR], stray: 0 });
  // The lower voice picked as well: a band a staff, each with its four
  // corners; let go of again, its corners go with its band.
  await chord(h.page, ["Control", "Shift"], "ArrowDown");
  await chord(h.page, ["Control", "Shift"], "Space");
  sel = await selection(h.page);
  assert.equal(sel.bands.length, 2);
  assert.ok(sel.bands[0].bottom < ds[1].top && sel.bands[1].top > ds[0].bottom, "the two bands are not a staff each");
  assert.deepEqual(cornersOn(sel), { bands: [FOUR, FOUR], stray: 0 });
  await chord(h.page, ["Control", "Shift"], "Space");
  sel = await selection(h.page);
  assert.equal(sel.bands.length, 1);
  assert.equal(sel.corners.length, 4);
  assert.deepEqual(cornersOn(sel), { bands: [FOUR], stray: 0 });
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("play with a stretch chosen plays it alone, stops at its end, and plays it again from its head, after a pause inside it as well (SM26)", { skip }, async () => {
  // audioSpy: the output's first gain stage is window.__gain, the one the
  // end of a stretch fades on.
  const h = await open({ text: EIGHTHS, scores: 1, audioSpy: true });
  await listenSources(h.page);
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[2].x, hs[2].y);
  for (let i = 0; i < 3; i++) await chord(h.page, ["Shift"], "ArrowRight");
  // Places 2, 3 and 4: from 0.6 s to 1.5 s, where place 5 begins.
  assert.equal((await selection(h.page)).bands.length, 1);
  // What is set on the audio graph's gains while the stretch plays out: the
  // end is faded on the audio clock, on the first frame the sound is heard,
  // before the frame that pauses it. Watched from before the press, since
  // the fade is set at once.
  await h.page.evaluate(() => {
    window.__ramps = [];
    const ramp = AudioParam.prototype.linearRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime = function (value, at) {
      window.__ramps.push({ param: this, value: value, at: at });
      return ramp.apply(this, arguments);
    };
  });
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.ok(Math.abs((await lastStart(h.page)) - 2 * EIGHTH) < 0.03, "the stretch began at " + (await lastStart(h.page)));
  assert.equal(await cursorShown(h.page), false);
  const run = await h.page.evaluate(() => window.__mdm.scoreRun);
  assert.ok(Math.abs(run.from * 9.6 - 0.6) < 0.01 && Math.abs(run.to * 9.6 - 1.5) < 0.01, JSON.stringify(run));
  await untilSounding(h.page, false);
  // Stopped at the end of the stretch and not at the end of the tune, the
  // stretch still chosen and the cursor where it was.
  const stoppedAt = await h.page.evaluate(() => window.__mdm.player.controller.timer.currentMillisecond());
  assert.ok(stoppedAt >= 1500 && stoppedAt < 2100, "stopped at " + stoppedAt);
  assert.equal((await selection(h.page)).bands.length, 1);
  assert.equal(await eighth(h.page), 4);
  assert.equal(await h.page.evaluate(() => window.__mdm.scoreRun), null);
  // Faded to nothing on the audio clock where the stretch ends, 0.9 s of
  // music after the sound began at its head, and let go again once the
  // pause landed.
  const fade = await h.page.evaluate(() => {
    const start = window.__starts[window.__starts.length - 1];
    const ramp = window.__ramps.filter((r) => r.param === window.__gain.gain && r.value === 0)[0];
    return ramp ? ramp.at - start.calledAt : null;
  });
  assert.ok(fade !== null && Math.abs(fade - 0.9) < 0.03, "the end was faded at " + fade);
  // The gain reads what the audio thread last rendered, so it is waited for
  // rather than read at once: a loaded machine renders the next block late.
  await h.page.waitForFunction(() => window.__gain.gain.value === 1, { timeout: 3000 });
  // And Space plays the same stretch again, from its head.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.ok(Math.abs((await lastStart(h.page)) - 2 * EIGHTH) < 0.03);
  // Paused inside it, it is played from its head again and not from where
  // it stopped (the owner's call of 2026-10-04: "si hay un pedazo
  // seleccionado y la reproducción se para por la mitad, al reproducir de
  // nuevo debe empezar desde el principio"), and still stops at its end.
  await sleep(450);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  const pausedAt = await h.page.evaluate(() => window.__mdm.player.controller.timer.currentMillisecond());
  assert.ok(pausedAt > 2 * EIGHTH * 1000 + 200, "paused at " + pausedAt + ", before the stretch was under way");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.ok(Math.abs((await lastStart(h.page)) - 2 * EIGHTH) < 0.03, "after the pause it began at " + (await lastStart(h.page)));
  await untilSounding(h.page, false);
  const again = await h.page.evaluate(() => window.__mdm.player.controller.timer.currentMillisecond());
  assert.ok(again >= 1500 && again < 2100, "stopped at " + again);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("with the player's repeat on, a stretch goes round until it is paused (SM27)", { skip }, async () => {
  const h = await open({ text: EIGHTHS, scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[1].x, hs[1].y);
  for (let i = 0; i < 2; i++) await chord(h.page, ["Shift"], "ArrowRight");
  // Places 1 and 2: 0.3 s to 0.9 s.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await h.page.evaluate(() => document.querySelector(".mdm-audio .abcjs-midi-loop").click());
  const seen = [];
  for (let i = 0; i < 16; i++) {
    seen.push(await h.page.evaluate(() => window.__mdm.player.controller.timer.currentMillisecond()));
    await sleep(100);
  }
  assert.equal(await sounding(h.page), true);
  // Never past the end of the stretch by more than a frame or two, and back
  // at its head at least once.
  assert.ok(Math.max(...seen) < 1000, "went past the stretch: " + seen.join(" "));
  const wraps = seen.filter((ms, i) => i > 0 && ms < seen[i - 1]).length;
  assert.ok(wraps >= 1, "never went round: " + seen.join(" "));
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's example (2026-09-29): "1 | 2 |" over "3 | 4 | 5 |]".
const REGROUP_SOURCE = ["X:1", "L:1/4", "K:C", "C D | E F |", "G A | B c | d e |]"].join("\n");
const REGROUP = ["Two lines.", "", "```abc", REGROUP_SOURCE, "```", ""].join("\n");
const REGROUPED_SOURCE = ["X:1", "L:1/4", "K:C", "C D | E F | G A |", "B c | d e |]"].join("\n");
const staged = (page) => page.evaluate(() => document.querySelector("#app .mdm-score").getAttribute("data-mdm-source"));
const noteAtCursor = async (page) => {
  const c = await cursor(page);
  return (await staged(page)).slice(c.from, c.from + 3).trim().charAt(0);
};
const stagedAt = (page, i) => page.evaluate((n) => document.querySelectorAll("#app .mdm-score")[n].getAttribute("data-mdm-source"), i);

// The chrome a score wears under the mode while the pointer is over it
// (showScoreEdits in main.js): a pair of buttons at every line's end and a +
// at the barline nearest the pointer. Drawn a frame after the pointer moves,
// so it is read after the page has drawn two: a wait of 80 ms alone was too
// short once in a run of the whole file on a busy machine (SM48, 2026-10-03,
// which passed five times out of five on its own).
async function pointAt(page, point) {
  await page.mouse.move(point.x, point.y);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await sleep(80);
}
function ends(page, score) {
  return page.evaluate((i) => {
    const block = document.querySelectorAll("#app .mdm-score")[i];
    return Array.from(block.querySelectorAll(".mdm-score-edit.mdm-score-edit--shown .mdm-score-end__btn")).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        x: (r.left + r.right) / 2,
        y: (r.top + r.bottom) / 2,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        shown: r.width > 0,
        way: b.getAttribute("data-mdm-way"),
        system: Number(b.getAttribute("data-mdm-system")),
        off: b.classList.contains("mdm-score-edit--off"),
        label: b.getAttribute("aria-label"),
      };
    });
  }, score || 0);
}
function plus(page, score) {
  return page.evaluate((i) => {
    const add = document.querySelectorAll("#app .mdm-score")[i].querySelector(".mdm-score-edit--shown .mdm-score-add.mdm-score-add--shown");
    if (!add) return null;
    const r = add.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, system: Number(add.getAttribute("data-mdm-system")), bar: Number(add.getAttribute("data-mdm-bar")), off: add.classList.contains("mdm-score-edit--off"), label: add.getAttribute("aria-label") };
  }, score || 0);
}
// Every button of a score's chrome, the + when it is up among them,
// answered by the engine while the page was idle (askScoreEdit).
function asked(page, score) {
  return page.waitForFunction(
    (i) => {
      const layer = document.querySelectorAll("#app .mdm-score")[i].querySelector(".mdm-score-edit.mdm-score-edit--shown");
      return !!layer && Array.from(layer.querySelectorAll(".mdm-score-end > [role=button], .mdm-score-add.mdm-score-add--shown")).every((b) => b.hasAttribute("data-mdm-asked"));
    },
    { timeout: 5000 },
    score || 0
  );
}
// The tip shown: its name, and the line under it that says a line's end
// can be dragged, when it has one.
const tip = (page) =>
  page.evaluate(() => {
    const t = document.querySelector("#app .mdm-score-edit__tip.mdm-score-edit__tip--shown");
    const name = t && t.querySelector(".mdm-score-edit__name");
    return t ? (name ? name.textContent : t.textContent) : null;
  });
const tipHint = (page) =>
  page.evaluate(() => {
    const hint = document.querySelector("#app .mdm-score-edit__tip.mdm-score-edit__tip--shown .mdm-score-edit__hint");
    return hint ? hint.textContent : null;
  });
const previews = (page) => page.evaluate(() => document.querySelectorAll("#app .mdm-score-edit-preview").length);
// How a mark the chrome lays on a score is drawn: a rect in the brass with
// no edge, under the ink (the engraving's first shape after it), and where
// it stands. The owner's A of design-score-editing-2.html (2026-09-29).
const markLook = (page, selector) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const hex = cs.getPropertyValue("--mdm-play-accent").trim();
    const accent = "rgb(" + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ") + ")";
    const ink = el.ownerSVGElement.querySelector('[class*="abcjs-"]');
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      bar: el.classList.contains("mdm-score-edit-preview--bar"),
      brass: cs.fill === accent,
      stroke: cs.stroke,
      opacity: Number(cs.fillOpacity),
      under: !!(el.compareDocumentPosition(ink) & Node.DOCUMENT_POSITION_FOLLOWING),
      width: Number(el.getAttribute("width")),
      middle: (r.left + r.right) / 2,
      top: r.top,
      bottom: r.bottom,
    };
  }, selector);
// A button of a line's end pressed, `way` "later" or "earlier", with the
// pointer brought over the score first so the chrome is drawn.
async function pressEnd(page, system, way, score) {
  const hs = await heads(page, score || 0);
  await pointAt(page, hs[0]);
  const btn = (await ends(page, score)).filter((b) => b.system === system && b.way === way)[0];
  assert.ok(btn && btn.shown, "no " + way + " button on line " + system);
  await page.mouse.move(btn.x, btn.y, { steps: 2 });
  await sleep(60);
  await page.mouse.click(btn.x, btn.y);
  await sleep(60);
  return btn;
}

test("the buttons at a line's end move a bar at a time, the cursor stays on its note, and the text takes each move as it is made (SM28)", { skip }, async () => {
  const h = await open({ text: REGROUP, scores: 1 });
  await pressMode(h.page);
  let hs = await heads(h.page, 0);
  // The G, head of the second line.
  await h.page.mouse.click(hs[4].x, hs[4].y);
  assert.equal(await noteAtCursor(h.page), "G");
  // A bar later on the first line: the owner's example, in one click.
  await pressEnd(h.page, 0, "later");
  assert.equal(await staged(h.page), REGROUPED_SOURCE);
  // Drawn so: the G now ends the first line.
  const st = await staves(h.page, 0);
  hs = await heads(h.page, 0);
  assert.equal(st.length, 2);
  assert.ok(hs[4].y < st[0].bottom + 10, "the G is not on the first line");
  assert.equal(await noteAtCursor(h.page), "G");
  // In the text at once, and posted to the host.
  assert.equal(await docText(h.page), REGROUP.replace(REGROUP_SOURCE, REGROUPED_SOURCE));
  assert.equal(await lastEdit(h.page), REGROUP.replace(REGROUP_SOURCE, REGROUPED_SOURCE));
  // A bar earlier on the first line: the G A bar goes back down.
  await pressEnd(h.page, 0, "earlier");
  assert.equal(await staged(h.page), REGROUP_SOURCE);
  assert.equal(await noteAtCursor(h.page), "G");
  // A bar earlier on the last line: its last bar makes a line of its own.
  await pressEnd(h.page, 1, "earlier");
  assert.equal(await staged(h.page), ["X:1", "L:1/4", "K:C", "C D | E F |", "G A | B c |", "d e |]"].join("\n"));
  // Three lines now, and the greyed upper button is the new last line's.
  const three = await ends(h.page, 0);
  assert.deepEqual(three.filter((b) => b.way === "later").map((b) => b.off), [false, false, true]);
  await chord(h.page, ["Control"], "z");
  assert.equal(await docText(h.page), REGROUP);
  // Up once more, and out of the mode: the text is as the last move left
  // it, and so is the host's.
  await pressEnd(h.page, 0, "later");
  await pressMode(h.page);
  const written = REGROUP.replace(REGROUP_SOURCE, REGROUPED_SOURCE);
  assert.equal(await docText(h.page), written);
  assert.equal(await lastEdit(h.page), written);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Ctrl+Z and Ctrl+Y take a move back and make it again inside the mode (SM29)", { skip }, async () => {
  const h = await open({ text: REGROUP, scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[4].x, hs[4].y);
  await pressEnd(h.page, 0, "later");
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await staged(h.page), REGROUPED_SOURCE);
  await chord(h.page, ["Control"], "z");
  assert.equal(await staged(h.page), REGROUP_SOURCE);
  // The cursor back where it stood when the move was made.
  assert.equal(await noteAtCursor(h.page), "G");
  await chord(h.page, ["Control"], "y");
  assert.equal(await staged(h.page), REGROUPED_SOURCE);
  await chord(h.page, ["Control"], "z");
  await chord(h.page, ["Control", "Shift"], "z");
  assert.equal(await staged(h.page), REGROUPED_SOURCE);
  // Nothing more to take back than was done.
  await chord(h.page, ["Control"], "z");
  await chord(h.page, ["Control"], "z");
  assert.equal(await staged(h.page), REGROUP_SOURCE);
  // Taken back to where it began, the mode leaves the text as it was.
  await pressMode(h.page);
  assert.equal(await docText(h.page), REGROUP);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a change the engine would refuse greys its button, the tip says why, and a click on it changes nothing (SM30)", { skip }, async () => {
  const titled = ["X:1", "L:1/4", "K:C", "C D | E F |", "T:Second part", "G A | B c |]"].join("\n");
  const single = ["X:1", "L:1/4", "K:C", "C D | E F |", "G A |]"].join("\n");
  const text = ["Two.", "", "```abc", titled, "```", "", "```abc", single, "```", ""].join("\n");
  const h = await open({ text, scores: 2 });
  await pressMode(h.page);
  let hs = await heads(h.page, 0);
  await pointAt(h.page, hs[0]);
  let bs = await ends(h.page, 0);
  // The last line's upper button needs no asking: no line comes after it.
  const last = bs.filter((b) => b.system === 1 && b.way === "later")[0];
  assert.deepEqual([last.off, last.label], [true, "No bar to bring up"]);
  // The first line's is asked before the pointer comes to it, while the
  // page is idle (askScoreEdit), and is grey already: the title between the
  // lines keeps them apart. Nothing is outlined.
  await asked(h.page, 0);
  bs = await ends(h.page, 0);
  const up = bs.filter((b) => b.system === 0 && b.way === "later")[0];
  assert.deepEqual([up.off, up.label], [true, "A title keeps them apart"]);
  await h.page.mouse.move(up.x, up.y, { steps: 2 });
  await sleep(350);
  bs = await ends(h.page, 0);
  assert.deepEqual([bs[0].off, bs[0].label], [true, "A title keeps them apart"]);
  assert.equal(await tip(h.page), "A title keeps them apart");
  assert.equal(await tipHint(h.page), null, "a refusal says only why");
  assert.equal(await previews(h.page), 0);
  await h.page.mouse.click(up.x, up.y);
  await sleep(100);
  assert.equal(await stagedAt(h.page, 0), titled);
  assert.equal(await h.page.evaluate(() => document.querySelectorAll("#app .mdm-score-notice").length), 0);
  // A last line of one bar has no bar to give to a line of its own.
  hs = await heads(h.page, 1);
  await pointAt(h.page, hs[0]);
  const down = (await ends(h.page, 1)).filter((b) => b.system === 1 && b.way === "earlier")[0];
  await h.page.mouse.move(down.x, down.y, { steps: 2 });
  await sleep(350);
  assert.equal(await tip(h.page), "No bar to send down");
  await h.page.mouse.click(down.x, down.y);
  await sleep(100);
  assert.equal(await stagedAt(h.page, 1), single);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The barlines of a score on the screen, by line, top to bottom.
function barlines(page) {
  return page.evaluate(() => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    return Array.from(svg.querySelectorAll(".abcjs-bar")).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    });
  });
}

test("the end of a line is no handle of its own: a press on its barline is a press on the score, and the pair carries the end to another barline (SM31)", { skip }, async () => {
  const h = await open({ text: REGROUP, scores: 1 });
  await pressMode(h.page);
  let bars = await barlines(h.page);
  // The barline a line ends on was a handle, with the sideways arrows over
  // it, until the pair said the drag in its tip: the owner took the arrows
  // off and then the handle, the pair being the button for it (2026-09-30).
  // The pointer is the arrow there as over any barline, and the + of that
  // barline is lit.
  const pointer = () => h.page.evaluate(() => getComputedStyle(document.querySelector("#app .mdm-score code.language-abc")).cursor);
  await h.page.mouse.move(bars[0].x, bars[0].y);
  await sleep(100);
  assert.equal(await pointer(), "default");
  await h.page.mouse.move(bars[1].x, bars[1].y);
  await sleep(100);
  assert.equal(await pointer(), "default");
  assert.ok(await plus(h.page), "no + at the line's end");
  // Pressed there and moved to the next line: no column, and the line ends
  // where it did.
  await h.page.mouse.down();
  await h.page.mouse.move(bars[2].x, bars[2].y, { steps: 5 });
  assert.equal(await h.page.evaluate(() => !!document.querySelector("#app .mdm-score-break")), false);
  await h.page.mouse.up();
  await sleep(100);
  assert.equal(await staged(h.page), REGROUP_SOURCE);
  // From the lower button of the first line's pair, taken down to the
  // first barline of the second line: the G and A come up.
  const lower = async () => {
    await pointAt(h.page, (await heads(h.page, 0))[1]);
    return (await ends(h.page, 0)).filter((b) => b.system === 0 && b.way === "earlier")[0];
  };
  let btn = await lower();
  await h.page.mouse.move(btn.x, btn.y, { steps: 2 });
  await h.page.mouse.down();
  await h.page.mouse.move(bars[2].x, bars[2].y, { steps: 8 });
  // The chrome goes for the drag, the + taken with it, and the barline the
  // line would end on is under the column the + offers its own with.
  assert.equal(await plus(h.page), null);
  const marker = await markLook(h.page, "#app .mdm-score-break");
  assert.deepEqual([marker.tag, marker.brass, marker.stroke, marker.opacity, marker.under, marker.width], ["rect", true, "none", 0.2, true, 10]);
  assert.ok(Math.abs(marker.middle - bars[2].x) < 1.5, "the column stands at " + marker.middle + ", the barline at " + bars[2].x);
  await h.page.mouse.up();
  await sleep(100);
  assert.equal(await staged(h.page), REGROUPED_SOURCE);
  assert.equal(await h.page.evaluate(() => !!document.querySelector("#app .mdm-score-break")), false);
  // And from the new end back to the barline after the E F: they go down.
  bars = await barlines(h.page);
  btn = await lower();
  await h.page.mouse.move(btn.x, btn.y, { steps: 2 });
  await h.page.mouse.down();
  await h.page.mouse.move(bars[1].x, bars[1].y, { steps: 8 });
  await h.page.mouse.up();
  await sleep(100);
  assert.equal(await staged(h.page), REGROUP_SOURCE);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a move of bars while the tune sounds stops it, and the player takes up the score as the move left it (SM32)", { skip }, async () => {
  const h = await open({ text: EIGHTHS, scores: 1 });
  await listenSources(h.page);
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[16].x, hs[16].y);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await sleep(900);
  const heard = await h.page.evaluate(() => window.__heardAt());
  await pressEnd(h.page, 0, "later");
  await untilSounding(h.page, false);
  // The cursor stands where the music was when the button was pressed, as an
  // arrow leaves it (scoreTakeFromPlayer), and not back where playing began.
  // This move leaves every note at its offset in the text, so the places of
  // the voice are counted as they were.
  const landed = await eighth(h.page);
  assert.ok(landed >= Math.floor(heard / EIGHTH) && landed <= Math.floor(heard / EIGHTH) + 3, "the cursor stands on " + landed + ", the music was at " + heard);
  const moved = await staged(h.page);
  assert.equal(moved, ["X:1", "M:4/4", "L:1/8", "Q:1/4=100", "K:C", "CDEF GABc | cBAG FEDC | CDEF GABc |", "cBAG FEDC |]"].join("\n"));
  await h.page.waitForFunction((s) => window.__mdm.player && window.__mdm.player.source === s, { timeout: 5000 }, moved);
  // And plays it: Space from the cursor.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the switch of the mode wears the whole note alone in the cursor's box, in the menu and on the panel (SM33)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1 });
  // One glyph in its two places.
  assert.equal(
    await h.page.$eval('#app .mdm-score-panel button[data-type="mdm-score-navigation"] svg', (el) => el.outerHTML),
    await h.page.$eval('#app .mdm-toolbar button[data-type="mdm-score-navigation"] svg', (el) => el.outerHTML)
  );
  const glyph = await h.page.evaluate(() => {
    const svg = document.querySelector('#app .mdm-toolbar button[data-type="mdm-score-navigation"] svg');
    return { paths: svg.querySelectorAll("path").length, others: svg.querySelectorAll("rect, line, circle").length, box: svg.querySelector("path").getAttribute("d").slice(0, 12) };
  });
  // The box of E in design-score-mode.html, and the note inside it: no line
  // of the staff (the owner's call, 2026-09-29).
  assert.deepEqual(glyph, { paths: 2, others: 0, box: "M3 2.6H13A2 " });
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a + at the barline nearest the pointer adds a bar of rest in every voice, the cursor goes onto it, and undo takes it back (SM34)", { skip }, async () => {
  const h = await open({ text: DUET, scores: 1 });
  await pressMode(h.page);
  const st = await staves(h.page, 0);
  const bars = await h.page.evaluate(() =>
    Array.from(document.querySelectorAll("#app .mdm-score code.language-abc svg .abcjs-bar.abcjs-l0.abcjs-v0")).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    })
  );
  // Near the first barline of the first system: the + stands under its
  // lower staff, since the bar goes into both.
  await pointAt(h.page, { x: bars[0].x + 3, y: (st[0].top + st[0].bottom) / 2 });
  let add = await plus(h.page);
  assert.ok(add, "no + at the barline");
  assert.deepEqual([add.system, add.bar, add.off, add.label], [0, 0, false, "Add bar"]);
  assert.ok(add.y > st[1].bottom && Math.abs(add.x - bars[0].x) < 2, "the + stands at " + JSON.stringify(add));
  // On it: the barline under a column of the brass, across both staves,
  // the tip, and the bar added, in both voices.
  await h.page.mouse.move(add.x, add.y, { steps: 4 });
  await sleep(350);
  assert.equal(await tip(h.page), "Add bar");
  assert.equal(await tipHint(h.page), null, "the + is not dragged");
  assert.equal(await previews(h.page), 1);
  const column = await markLook(h.page, "#app .mdm-score-edit-preview");
  assert.deepEqual(
    [column.tag, column.bar, column.brass, column.stroke, column.opacity, column.under, column.width],
    ["rect", true, true, "none", 0.2, true, 10]
  );
  assert.ok(Math.abs(column.middle - bars[0].x) < 1.5 && column.top < st[0].top && column.bottom > st[1].bottom, "the column stands at " + JSON.stringify(column));
  await h.page.mouse.click(add.x, add.y);
  const added = DUET_SOURCE.replace("c G A F |", "c G A F | z4 |").replace("C, D, E, F, |", "C, D, E, F, | z4 |");
  assert.equal(await staged(h.page), added);
  assert.equal(await noteAtCursor(h.page), "z");
  assert.equal(await docText(h.page), DUET.replace(DUET_SOURCE, added));
  await chord(h.page, ["Control"], "z");
  assert.equal(await staged(h.page), DUET_SOURCE);
  await chord(h.page, ["Control"], "y");
  assert.equal(await staged(h.page), added);
  // Made again, the bar has the cursor on it again.
  assert.equal(await noteAtCursor(h.page), "z");
  await chord(h.page, ["Control"], "z");
  // The tip of a line's upper button clears the whole system, whose middle,
  // where the pair stands, is between the two staves.
  await pointAt(h.page, { x: bars[0].x + 40, y: (st[0].top + st[0].bottom) / 2 });
  const upper = (await ends(h.page)).filter((b) => b.system === 0 && b.way === "later")[0];
  await h.page.mouse.move(upper.x, upper.y, { steps: 2 });
  await sleep(350);
  const tipBox = await h.page.evaluate(() => document.querySelector("#app .mdm-score-edit__tip").getBoundingClientRect().bottom);
  assert.ok(tipBox <= st[0].top, "the tip comes down to " + tipBox + ", over the upper staff at " + st[0].top);
  // At the head of the second system: a bar before its first, in both.
  const hs = await heads(h.page, 0);
  const st2 = await staves(h.page, 0);
  await pointAt(h.page, { x: hs[13].x - 11, y: (st2[2].top + st2[2].bottom) / 2 });
  add = await plus(h.page);
  assert.ok(add, "no + at the head of the line");
  assert.deepEqual([add.system, add.bar], [1, -1]);
  await h.page.mouse.move(add.x, add.y, { steps: 4 });
  await h.page.mouse.click(add.x, add.y);
  const headed = DUET_SOURCE.replace("V:1\ne d c B", "V:1\nz4 | e d c B").replace("V:2\nA, B, C D", "V:2\nz4 | A, B, C D");
  assert.equal(await staged(h.page), headed);
  // Out of the mode: the text takes it.
  await pressMode(h.page);
  assert.equal(await docText(h.page), DUET.replace(DUET_SOURCE, headed));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("under the mode a click on a sounding score sends the music there, the bar's play plays from the cursor, and its stop takes the cursor back (SM35)", { skip }, async () => {
  const h = await open({ text: EIGHTHS, scores: 1 });
  await listenSources(h.page);
  await pressMode(h.page);
  let hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[0].x, hs[0].y);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  // A click on the twelfth note while it sounds: it goes on sounding, from
  // there.
  await sleep(200);
  hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[12].x, hs[12].y);
  await sleep(150);
  assert.equal(await sounding(h.page), true);
  const heard = await h.page.evaluate(() => window.__heardAt());
  assert.ok(heard > 12 * EIGHTH - 0.05 && heard < 12 * EIGHTH + 0.4, "the click sent the music to " + heard);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  // The bar's own play, with the cursor moved: from the cursor.
  await h.page.mouse.click(hs[3].x, hs[3].y);
  await h.page.evaluate(() => document.querySelector(".mdm-audio .abcjs-midi-start").click());
  await untilSounding(h.page, true);
  assert.ok(Math.abs((await lastStart(h.page)) - 3 * EIGHTH) < 0.03, "the bar's play started at " + (await lastStart(h.page)));
  // Paused, then stopped: the cursor back to where the playing began.
  await sleep(400);
  await h.page.evaluate(() => document.querySelector(".mdm-audio .abcjs-midi-start").click());
  await untilSounding(h.page, false);
  await sleep(100);
  assert.ok((await eighth(h.page)) > 3, "the pause did not move the cursor on");
  await h.page.evaluate(() => document.querySelector(".mdm-audio .mdm-audio-stop").click());
  await sleep(100);
  assert.equal(await eighth(h.page), 3);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("leaving the mode while a stretch plays lets the tune play on past it, at full level (SM36)", { skip }, async () => {
  const h = await open({ text: EIGHTHS, scores: 1, audioSpy: true });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[2].x, hs[2].y);
  for (let i = 0; i < 3; i++) await chord(h.page, ["Shift"], "ArrowRight");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await sleep(300);
  await pressMode(h.page);
  // Past the stretch's end (1.5 s) the tune still sounds, and the output
  // was not faded at that end.
  await h.page.waitForFunction(() => window.__mdm.player.controller.timer.currentMillisecond() > 1900, { timeout: 5000 });
  assert.equal(await sounding(h.page), true);
  // A fade left set would have taken it to nothing at 1.5 s and kept it
  // there; read twice, a render block apart, it is at full level.
  await sleep(50);
  assert.equal(await h.page.evaluate(() => window.__gain.gain.value), 1);
  await h.page.evaluate(() => document.querySelector(".mdm-audio .abcjs-midi-start").click());
  await untilSounding(h.page, false);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Space on the player's bar, under the mode, plays from the cursor as well (SM37)", { skip }, async () => {
  const h = await open({ text: EIGHTHS, scores: 1 });
  await listenSources(h.page);
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[5].x, hs[5].y);
  // The headphones open the player and hand its bar the keyboard (SM06).
  await h.page.evaluate(() => document.querySelector("#app .mdm-audio-toggle").click());
  await h.page.waitForFunction(() => window.__mdm.player && window.__mdm.player.controller && window.__mdm.player.bar.contains(document.activeElement), { timeout: 15000 });
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.ok(Math.abs((await lastStart(h.page)) - 5 * EIGHTH) < 0.03, "Space on the bar started at " + (await lastStart(h.page)));
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Alt+Up and Alt+Down are the workbench's: the mode moves no bar and lets them through (SM38)", { skip }, async () => {
  const h = await open({ text: REGROUP, scores: 1 });
  // What the VS Code preload forwards to the workbench: what reaches the
  // window's own listeners.
  await h.page.evaluate(() => {
    window.__host = [];
    window.addEventListener("keydown", (e) => window.__host.push("down:" + e.key));
  });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[4].x, hs[4].y);
  const before = await cursor(h.page);
  await h.page.evaluate(() => (window.__host = []));
  await chord(h.page, ["Alt"], "ArrowUp");
  await chord(h.page, ["Alt"], "ArrowDown");
  assert.equal(await staged(h.page), REGROUP_SOURCE);
  assert.deepEqual(await h.page.evaluate(() => window.__host), ["down:Alt", "down:ArrowUp", "down:Alt", "down:ArrowDown"]);
  // Nor did the cursor take them for arrows.
  assert.deepEqual(await cursor(h.page), before);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a player shut while it sounds gives the cursor back, a press on its score sends the music there, and a moved cursor takes the paused ink with it (SM39)", { skip }, async () => {
  const text = ["Two.", "", "```abc", EIGHTHS_SOURCE, "```", "", "```abc", REGROUP_SOURCE, "```", ""].join("\n");
  const h = await open({ text, scores: 2 });
  await listenSources(h.page);
  await pressMode(h.page);
  const first = await heads(h.page, 0);
  await h.page.mouse.click(first[0].x, first[0].y);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await sleep(200);
  assert.equal(await cursorShown(h.page), false);
  // The headphones shut the player while it sounds: the cursor is back.
  await h.page.evaluate(() => document.querySelector("#app .mdm-score .mdm-audio-toggle").click());
  await sleep(150);
  assert.equal(await h.page.evaluate(() => !!document.querySelector(".mdm-audio")), false);
  assert.equal(await cursorShown(h.page), true);
  // Playing again, the cursor put on the other score, and then a press on
  // the one that sounds: the music goes there.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  const second = await heads(h.page, 1);
  await h.page.mouse.click(second[0].x, second[0].y);
  await sleep(100);
  const hs = await heads(h.page, 0);
  const inked = () => h.page.evaluate(() => document.querySelectorAll("#app .mdm-score code.language-abc svg .abcjs-note_selected").length);
  await h.page.mouse.click(hs[20].x, hs[20].y);
  // The note pressed is inked at once, and the press's own cleaning of
  // abcjs's red does not take the ink with it.
  await sleep(60);
  assert.ok((await inked()) > 0, "the press left the sounding score without ink");
  await sleep(90);
  assert.equal(await sounding(h.page), true);
  const heard = await h.page.evaluate(() => window.__heardAt());
  assert.ok(heard > 20 * EIGHTH - 0.05 && heard < 20 * EIGHTH + 0.4, "the press sent the music to " + heard);
  // Paused, the note it stopped on is inked; the cursor moved off it takes
  // the ink away, since nothing will play from there.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  await sleep(100);
  assert.ok((await inked()) > 0, "the pause left no ink");
  await h.page.keyboard.press("ArrowLeft");
  assert.equal(await inked(), 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("two refusals in a row on two scores each go after their three seconds (SM40)", { skip }, async () => {
  // The drag of a line's end is what still answers a refusal with the
  // notice: a title between the lines keeps them apart.
  const titled = ["X:1", "L:1/4", "K:C", "C D | E F |", "T:Second part", "G A | B c |]"].join("\n");
  const text = ["Two.", "", "```abc", titled, "```", "", "```abc", titled, "```", ""].join("\n");
  const h = await open({ text, scores: 2 });
  await pressMode(h.page);
  const notices = () => h.page.evaluate(() => document.querySelectorAll("#app .mdm-score-notice").length);
  const refuse = async (score) => {
    const bars = await h.page.evaluate(
      (i) =>
        Array.from(document.querySelectorAll("#app .mdm-score")[i].querySelectorAll("code.language-abc svg .abcjs-bar")).map((el) => {
          const r = el.getBoundingClientRect();
          return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
        }),
      score
    );
    // From the lower button of the first line's pair, the handle of its end.
    await pointAt(h.page, (await heads(h.page, score))[1]);
    const btn = (await ends(h.page, score)).filter((e) => e.system === 0 && e.way === "earlier")[0];
    await h.page.mouse.move(btn.x, btn.y, { steps: 2 });
    await h.page.mouse.down();
    await h.page.mouse.move(bars[2].x, bars[2].y, { steps: 8 });
    await h.page.mouse.up();
  };
  await refuse(0);
  await sleep(500);
  await refuse(1);
  assert.equal(await notices(), 2);
  assert.equal(await stagedAt(h.page, 0), titled);
  await sleep(3300);
  assert.equal(await notices(), 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Space on a score whose tune has not been played yet seeks and then
// presses play while the tune is still being primed, and abcjs waits out a
// priming under way by looking again every 500 ms: the first note came half
// a second after the key on every score but the one already playing
// (measured 512 ms, of which the priming was 40 to 100). The press is now
// served the moment the priming ends (runWhenReady, in mountSynth).
test("Space on a score not played yet sounds as soon as its tune is primed, with no half-second wait (SM41)", { skip }, async () => {
  const text = ["Two.", "", "```abc", EIGHTHS_SOURCE, "```", "", "Between.", "", "```abc", SHORT_SOURCE, "```", ""].join("\n");
  const h = await open({ text, scores: 2 });
  await h.page.evaluate(() => {
    window.__times = [];
    const Orig = window.ABCJS.synth.SynthController;
    window.ABCJS.synth.SynthController = function () {
      const c = new Orig();
      const go = c.go;
      c.go = function () {
        const out = go.apply(c, arguments);
        const buffer = c.midiBuffer;
        const start = buffer.start;
        buffer.start = function () {
          window.__times.push({ what: "start", t: performance.now() });
          return start.apply(buffer, arguments);
        };
        out.then(() => window.__times.push({ what: "primed", t: performance.now() }));
        return out;
      };
      return c;
    };
    // abcjs's wait is a setTimeout of 500 ms (runWhenReady).
    window.__waits = 0;
    const later = window.setTimeout;
    window.setTimeout = function (fn, ms) {
      if (ms === 500) window.__waits++;
      return later.apply(window, arguments);
    };
  });
  await pressMode(h.page);
  const gap = async (score) => {
    const hs = await heads(h.page, score);
    await h.page.mouse.click(hs[1].x, hs[1].y);
    await h.page.evaluate(() => {
      window.__times = [];
      window.__waits = 0;
    });
    await h.page.keyboard.press("Space");
    await untilSounding(h.page, true);
    const out = await h.page.evaluate(() => {
      const at = (what) => (window.__times.find((e) => e.what === what) || {}).t;
      return { primed: at("primed"), start: at("start"), waits: window.__waits };
    });
    await h.page.keyboard.press("Space");
    await untilSounding(h.page, false);
    return out;
  };
  // The first score, and then the second, the case it was reported on.
  for (const score of [0, 1]) {
    const g = await gap(score);
    assert.ok(typeof g.primed === "number" && typeof g.start === "number", "score " + score + ": " + JSON.stringify(g));
    assert.equal(g.waits, 0, "score " + score + " waited out abcjs's half second");
    assert.ok(g.start - g.primed < 100, "score " + score + " sounded " + (g.start - g.primed).toFixed(0) + " ms after its priming");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The fourth round: the editing on the staff ----------
//
// Asked for on 2026-09-29: the moves of bars made on the staff and not with
// keys, and bars added, with design-score-editing.html's A (the owner's
// pick): a pair of buttons at every line's end and a + at the barline
// nearest the pointer. SM28 to SM34 and SM38 above were rewritten for it.

test("the chrome shows over a score under the mode alone: a pair past each line's end, the bar a button would move washed, and it goes with the pointer (SM42)", { skip }, async () => {
  const h = await open({ text: REGROUP, scores: 1 });
  let hs = await heads(h.page, 0);
  const shown = () => h.page.evaluate(() => !!document.querySelector("#app .mdm-score-edit.mdm-score-edit--shown"));
  // Not outside the mode.
  await pointAt(h.page, hs[1]);
  assert.equal(await shown(), false);
  await pressMode(h.page);
  await pointAt(h.page, hs[1]);
  assert.equal(await shown(), true);
  const st = await staves(h.page, 0);
  const bs = await ends(h.page, 0);
  assert.deepEqual(
    bs.map((b) => b.system + b.way),
    ["0later", "0earlier", "1later", "1earlier"]
  );
  // Just past each line's end, level with its staff, inside the card.
  const card = await h.page.evaluate(() => document.querySelector("#app .mdm-score").getBoundingClientRect().right);
  for (const n of [0, 1]) {
    const pair = bs.filter((b) => b.system === n);
    const middle = (st[n].top + st[n].bottom) / 2;
    assert.ok(pair[0].left >= st[n].right + 3 && pair[0].left <= st[n].right + 8, "line " + n + ": the pair at " + pair[0].left + ", the line's end at " + st[n].right);
    assert.ok(Math.abs((pair[0].top + pair[1].bottom) / 2 - middle) < 2, "line " + n + ": the pair is not level with its staff");
    assert.ok(pair[0].right <= card + 0.5);
  }
  // Pointing at the first line's upper button washes the bar that would
  // come up, the G A, and names what the click does, by what its arrow
  // moves: the end of the line (the owner's pick, A of
  // design-score-editing-4.html); the lower one names its own.
  // Under the name, that the button can be dragged as well (the owner's
  // pick, A of design-score-editing-3.html).
  await h.page.mouse.move(bs[1].x, bs[1].y, { steps: 2 });
  await sleep(350);
  assert.deepEqual([await tip(h.page), await tipHint(h.page)], ["Move line end left", "Or drag to any barline"]);
  await h.page.mouse.move(bs[0].x, bs[0].y, { steps: 2 });
  await sleep(350);
  assert.deepEqual([await tip(h.page), await tipHint(h.page)], ["Move line end right", "Or drag to any barline"]);
  // Two lines over the upper button, clear of the staff all the same.
  const over = await h.page.evaluate(() => document.querySelector("#app .mdm-score-edit__tip--shown").getBoundingClientRect().bottom);
  assert.ok(over <= st[0].top, "the tip reaches " + over + ", the staff begins at " + st[0].top);
  // One control lit at a time: the + of the barline the line ends on stays
  // down while the pointer is on the pair beside it, whose left edge is
  // within the + barline's reach.
  await pointAt(h.page, { x: bs[0].left + 2, y: bs[0].y });
  assert.equal(await h.page.evaluate((x) => Math.abs(x - Array.from(document.querySelectorAll("#app .mdm-score code.language-abc svg .abcjs-bar"))[1].getBoundingClientRect().right) < 9, bs[0].left + 2), true);
  assert.equal(await plus(h.page), null);
  await pointAt(h.page, bs[0]);
  const box = await h.page.evaluate(() => {
    const r = document.querySelector("#app .mdm-score-edit-preview").getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  hs = await heads(h.page, 0);
  assert.ok(box.left < hs[4].x && hs[5].x < box.right && box.right < hs[6].x, "the wash runs from " + box.left + " to " + box.right);
  assert.ok(box.top < st[1].top && box.bottom > st[1].bottom);
  const wash = await markLook(h.page, "#app .mdm-score-edit-preview");
  assert.deepEqual([wash.tag, wash.bar, wash.brass, wash.stroke, wash.opacity, wash.under], ["rect", false, true, "none", 0.14, true]);
  // Off the button the wash and the tip go.
  await pointAt(h.page, hs[1]);
  assert.equal(await tip(h.page), null);
  assert.equal(await previews(h.page), 0);
  // Over the prose, and out of the text, the chrome goes.
  const prose = await h.page.evaluate(() => {
    const r = document.querySelector("#app .cm-line").getBoundingClientRect();
    return { x: r.left + 20, y: (r.top + r.bottom) / 2 };
  });
  await pointAt(h.page, prose);
  assert.equal(await shown(), false);
  await pointAt(h.page, hs[1]);
  assert.equal(await shown(), true);
  await pointAt(h.page, { x: 10, y: hs[1].y });
  assert.equal(await shown(), false);
  // And with the mode.
  await pointAt(h.page, hs[1]);
  await pressMode(h.page);
  await pointAt(h.page, hs[2]);
  assert.equal(await shown(), false);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a drag begun on a button of a line's end is the drag of the line's end, and moves the bars it is taken over (SM43)", { skip }, async () => {
  const h = await open({ text: REGROUP, scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[0].x, hs[0].y);
  await pointAt(h.page, hs[1]);
  const bs = await ends(h.page, 0);
  const bars = await barlines(h.page);
  await h.page.mouse.move(bs[1].x, bs[1].y, { steps: 2 });
  await h.page.mouse.down();
  await h.page.mouse.move(bars[3].x, bars[3].y, { steps: 8 });
  assert.equal(await h.page.evaluate(() => !!document.querySelector("#app .mdm-score-break")), true);
  await h.page.mouse.up();
  await sleep(100);
  // To the second barline of the next line: its first two bars come up.
  assert.equal(await staged(h.page), ["X:1", "L:1/4", "K:C", "C D | E F | G A | B c |", "d e |]"].join("\n"));
  // The press was no click: the cursor stayed on the C.
  assert.equal(await noteAtCursor(h.page), "C");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("at a pane narrower than the drawing, a line whose end is out of the box shows no pair, and at the end of the box the pair stays inside it (SM44)", { skip }, async () => {
  const h = await open({ text: EIGHTHS, scores: 1, height: 900 });
  await h.page.setViewport({ width: 600, height: 900 });
  await sleep(300);
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await pointAt(h.page, hs[1]);
  let bs = await ends(h.page, 0);
  const box = () => h.page.evaluate(() => {
    const r = document.querySelector("#app .mdm-score code.language-abc").getBoundingClientRect();
    return { left: r.left, right: r.right };
  });
  const code = await box();
  const st = await staves(h.page, 0);
  assert.ok(st[0].right > code.right + 20, "the first line is not wider than the box: " + st[0].right + " against " + code.right);
  assert.equal(bs.filter((b) => b.system === 0 && b.shown).length, 0, "a pair stands for a line's end out of the box");
  // The box scrolled to its end: the pair is drawn again, inside the box.
  await h.page.evaluate(() => {
    const c = document.querySelector("#app .mdm-score code.language-abc");
    c.scrollLeft = c.scrollWidth;
  });
  await sleep(150);
  bs = await ends(h.page, 0);
  const first = bs.filter((b) => b.system === 0);
  assert.ok(first[0].shown && first[0].right <= code.right + 0.5 && first[0].left >= code.left, "the pair stands at " + JSON.stringify(first[0]));
  // And does its work from there.
  await h.page.mouse.move(first[0].x, first[0].y, { steps: 2 });
  await sleep(60);
  await h.page.mouse.click(first[0].x, first[0].y);
  assert.equal(await staged(h.page), ["X:1", "M:4/4", "L:1/8", "Q:1/4=100", "K:C", "CDEF GABc | cBAG FEDC | CDEF GABc |", "cBAG FEDC |]"].join("\n"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Inside VS Code Ctrl+Z is answered twice, by CodeMirror here and by the
// workbench on the text model under the editor, which then sends the text
// that leaves (tests/README.md, Ctrl+Z answered twice). Every change of the
// mode is a step of its own on both sides, so the key goes on to VS Code
// when it took one of them back, and the host's text that comes back is
// the one on screen; with none of the mode's left, it stops here, and a
// change made before the mode stays. The listener stands in for VS Code's
// (D19).
test("Ctrl+Z in the mode goes on to VS Code when it took a change of the mode back, and stops at the changes made before it (SM45)", { skip }, async () => {
  const h = await open({ text: REGROUP, scores: 1, withFrontMatter: false });
  await h.page.evaluate(() => {
    window.__heard = [];
    window.addEventListener("keydown", (e) => {
      if (!/^(Control|Shift|Alt|Meta)$/.test(e.key)) window.__heard.push((e.ctrlKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + e.code);
    });
  });
  const heard = () => h.page.evaluate(() => window.__heard.splice(0));
  // A change of the text before the mode.
  await setSelection(h.page, 3);
  await h.page.keyboard.type("x");
  const typed = REGROUP.replace("Two lines.", "Twox lines.");
  assert.equal(await docText(h.page), typed);
  await pressMode(h.page);
  await pressEnd(h.page, 0, "later");
  const moved = typed.replace(REGROUP_SOURCE, REGROUPED_SOURCE);
  assert.equal(await docText(h.page), moved);
  await heard();
  await chord(h.page, ["Control"], "z");
  assert.deepEqual(await heard(), ["Ctrl+KeyZ"]);
  assert.equal(await docText(h.page), typed);
  // The workbench's undo of the same step, as the host sends it.
  await update(h.page, typed, false, 1);
  assert.equal(await docText(h.page), typed);
  // Nothing of the mode's to take back: the typing stays, here and in VS
  // Code, which never hears the key.
  await chord(h.page, ["Control"], "z");
  assert.deepEqual(await heard(), []);
  assert.equal(await docText(h.page), typed);
  // Made again the same way, once.
  await chord(h.page, ["Control"], "y");
  assert.deepEqual(await heard(), ["Ctrl+KeyY"]);
  assert.equal(await docText(h.page), moved);
  await update(h.page, moved, false, 1);
  await chord(h.page, ["Control"], "y");
  assert.deepEqual(await heard(), []);
  assert.equal(await docText(h.page), moved);
  await sleep(400);
  assert.equal(await lastEdit(h.page), moved);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an undo in the mode leaves the page where it is, though the text's caret is far from the score (SM46)", { skip }, async () => {
  const prose = Array.from({ length: 80 }, (_, i) => "Paragraph " + i + " of the prose after the tune.").join("\n\n");
  const text = ["```abc", REGROUP_SOURCE, "```", "", prose, ""].join("\n");
  const h = await open({ text, scores: 1, withFrontMatter: false, height: 500 });
  // The caret at the foot of the document, and the pane at its head.
  await setSelection(h.page, text.length);
  await h.page.evaluate(() => (window.__mdm.view.scrollDOM.scrollTop = 0));
  await sleep(200);
  await pressMode(h.page);
  await pressEnd(h.page, 0, "later");
  assert.equal(await docText(h.page), text.replace(REGROUP_SOURCE, REGROUPED_SOURCE));
  const top = await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop);
  await chord(h.page, ["Control"], "z");
  // CodeMirror scrolls on its next measure, a frame or two on.
  await sleep(300);
  assert.equal(await docText(h.page), text);
  assert.equal(await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop), top, "the undo took the page to the text's caret");
  await chord(h.page, ["Control"], "y");
  await sleep(300);
  assert.equal(await h.page.evaluate(() => window.__mdm.view.scrollDOM.scrollTop), top, "the redo took the page to the text's caret");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's pick of design-score-editing-2.html (A, 2026-09-29): with no
// meter, a bar of eight quarters is given two whole rests. One rest eight
// quarters long is one abcjs 6.7.0 cannot draw: it writes "pitch is
// undefined" in red in its place (what the partials of example.mdm got).
test("a bar added where there is no meter is drawn with the rests that make it, and abcjs has nothing to say against it (SM47)", { skip }, async () => {
  const source = ["X:1", "L:1/4", "K:C", "C D E F G A B c | d e f g |"].join("\n");
  const h = await open({ text: ["Free.", "", "```abc", source, "```", ""].join("\n"), scores: 1 });
  await pressMode(h.page);
  const st = await staves(h.page, 0);
  const bars = await barlines(h.page);
  const rests = () => h.page.evaluate(() => document.querySelectorAll("#app .mdm-score code.language-abc svg .abcjs-rest").length);
  assert.equal(await rests(), 0);
  await pointAt(h.page, { x: bars[0].x + 3, y: (st[0].top + st[0].bottom) / 2 });
  const add = await plus(h.page);
  assert.ok(add, "no + at the barline");
  await h.page.mouse.move(add.x, add.y, { steps: 3 });
  await sleep(100);
  await h.page.mouse.click(add.x, add.y);
  await sleep(100);
  assert.equal(await staged(h.page), source.replace("B c |", "B c | z4 z4 |"));
  assert.equal(await rests(), 2);
  const said = await h.page.evaluate(() => document.querySelector("#app .mdm-score code.language-abc svg").textContent);
  assert.ok(!/undefined/.test(said), "abcjs wrote: " + said);
  // The cursor on the first of them.
  assert.equal(await noteAtCursor(h.page), "z");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A tune with no barline, as the owner wrote one (2026-09-30): the end of
// its staff, where the barline would be drawn, takes a + as a barline does,
// and the bar goes in after a barline that closes the one there was, left
// open as that one was.
test("a score with no barline takes a + at the end of its staff, which closes the bar and adds one after it (SM48)", { skip }, async () => {
  const h = await open({ text: ["Bare.", "", "```abc", "C", "```", ""].join("\n"), scores: 1 });
  await pressMode(h.page);
  const st = await staves(h.page, 0);
  assert.equal((await barlines(h.page)).length, 0);
  await pointAt(h.page, { x: st[0].right - 3, y: (st[0].top + st[0].bottom) / 2 });
  let add = await plus(h.page);
  assert.ok(add, "no + at the end of the staff");
  assert.deepEqual([add.system, add.bar, add.off, add.label], [0, 0, false, "Add bar"]);
  assert.ok(add.y > st[0].bottom && Math.abs(add.x - st[0].right) < 2, "the + stands at " + JSON.stringify(add) + ", the staff ends at " + st[0].right);
  await h.page.mouse.move(add.x, add.y, { steps: 4 });
  await sleep(350);
  assert.equal(await tip(h.page), "Add bar");
  const column = await markLook(h.page, "#app .mdm-score-edit-preview");
  assert.ok(Math.abs(column.middle - st[0].right) < 1.5, "the column stands at " + column.middle + ", the staff ends at " + st[0].right);
  await h.page.mouse.click(add.x, add.y);
  assert.equal(await staged(h.page), "C | z");
  assert.equal(await noteAtCursor(h.page), "z");
  // The new bar is open as the first was, and its end takes a + in turn.
  assert.equal((await barlines(h.page)).length, 1);
  const again = await staves(h.page, 0);
  await pointAt(h.page, { x: again[0].right - 3, y: (again[0].top + again[0].bottom) / 2 });
  add = await plus(h.page);
  assert.ok(add, "no + at the end of the new bar");
  assert.deepEqual([add.system, add.bar], [0, 1]);
  await h.page.mouse.move(add.x, add.y, { steps: 4 });
  await h.page.mouse.click(add.x, add.y);
  assert.equal(await staged(h.page), "C | z | z");
  assert.equal(await docText(h.page), ["Bare.", "", "```abc", "C | z | z", "```", ""].join("\n"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The chrome is drawn a frame after the pointer moves (hoverScore), and a
// move that came before that frame was dropped, place and all: the chrome
// was drawn for where the pointer had been, and stayed so until it moved
// again. Found behind SM48, which pointed at the end of a new bar a moment
// after a click and found no + there now and then on a busy machine (twice
// in four runs with a VS Code starting beside it, 2026-10-03).
test("of two moves of the pointer within one frame, the chrome is drawn for the last (SM79)", { skip }, async () => {
  const h = await open({ text: REGROUP, scores: 1 });
  await pressMode(h.page);
  const bars = await barlines(h.page);
  const st = await staves(h.page, 0);
  const y = (st[0].top + st[0].bottom) / 2;
  const frames = () => h.page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  // Two moves handed to the page in one go, the way a fast hand's come: at
  // the first barline of the first line, and at the second.
  const move = (points) =>
    h.page.evaluate((points) => {
      points.forEach((p) => {
        const under = document.elementFromPoint(p.x, p.y);
        under.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: p.x, clientY: p.y }));
      });
    }, points);
  await move([{ x: bars[0].x, y: y }, { x: bars[1].x - 2, y: y }]);
  await frames();
  let add = await plus(h.page);
  assert.ok(add, "no + came up");
  assert.deepEqual([add.system, add.bar], [0, 1]);
  // And back, with a third in between.
  await move([{ x: bars[1].x - 2, y: y }, { x: (bars[0].x + bars[1].x) / 2, y: y }, { x: bars[0].x, y: y }]);
  await frames();
  add = await plus(h.page);
  assert.deepEqual([add.system, add.bar], [0, 0]);
  // A pointer gone from the text before the frame came takes the chrome
  // with it.
  await h.page.evaluate((p) => {
    const dom = window.__mdm.view.contentDOM;
    document.elementFromPoint(p.x, p.y).dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: p.x, clientY: p.y }));
    dom.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
  }, { x: bars[1].x - 2, y: y });
  await frames();
  assert.equal(await plus(h.page), null);
  assert.deepEqual(await ends(h.page, 0), []);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The end of a line left open is where the line ends, for the drag as for
// the +: its last barline is a barline inside it, and the bars after that
// one go down when the end is taken there (they stayed, the drag taking
// that barline for the end and the drop for a drop back where it was).
test("the end of a line no barline closes is its end for the drag: to its last barline, the bar after it goes down (SM49)", { skip }, async () => {
  const source = ["X:1", "L:1/4", "K:C", "C D | E F |", "G A | B c"].join("\n");
  const h = await open({ text: ["Open.", "", "```abc", source, "```", ""].join("\n"), scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await pointAt(h.page, hs[5]);
  const bs = (await ends(h.page, 0)).filter((b) => b.system === 1);
  const bars = await barlines(h.page);
  await h.page.mouse.move(bs[1].x, bs[1].y, { steps: 2 });
  await h.page.mouse.down();
  await h.page.mouse.move(bars[2].x, bars[2].y, { steps: 8 });
  await h.page.mouse.up();
  await sleep(100);
  assert.equal(await staged(h.page), ["X:1", "L:1/4", "K:C", "C D | E F |", "G A |", "B c"].join("\n"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A line whose bar goes on into the next line had both of its buttons lit,
// and each went grey only once the pointer was on it (the owner's report,
// 2026-09-30). Every button is asked while the page is idle, the + that is
// up first, and comes up grey where the engine would refuse it.
test("the buttons of the chrome are asked before the pointer comes to them, and one the engine would refuse is grey without being pointed at (SM50)", { skip }, async () => {
  const source = ["X:1", "L:1/4", "K:C", "C D- | D E", "G A | B c |]"].join("\n");
  const h = await open({ text: ["Runs on.", "", "```abc", source, "```", ""].join("\n"), scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await pointAt(h.page, hs[0]);
  await asked(h.page, 0);
  const state = (await ends(h.page, 0)).map((b) => b.system + b.way + ":" + (b.off ? "off" : "on"));
  assert.deepEqual(state, ["0later:off", "0earlier:off", "1later:off", "1earlier:on"]);
  // Said for what it is (the owner's words, 2026-09-30).
  assert.deepEqual(
    (await ends(h.page, 0)).filter((b) => b.system === 0).map((b) => b.label),
    ["No barline ends this line", "No barline ends this line"]
  );
  // The + of the first barline, near it and not on it: a tie crosses there.
  const st = await staves(h.page, 0);
  const bars = await barlines(h.page);
  await pointAt(h.page, { x: bars[0].x + 3, y: (st[0].top + st[0].bottom) / 2 });
  await asked(h.page, 0);
  const add = await plus(h.page);
  assert.deepEqual([add.bar, add.off, add.label], [0, true, "A tie crosses here"]);
  assert.equal(await stagedAt(h.page, 0), source);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- Notes written on the cursor ----------
//
// The keys of the figures, 0, Enter, Delete and Backspace (a note written
// on the cursor, in main.js). What the text is made to say is the engine's and
// is tested without a browser (score-bars.test.js); these are the keys, the
// figure the mode keeps, and where the cursor goes.
const NOTES_SOURCE = ["X:1", "M:4/4", "L:1/8", "K:C", "z8 | z8 |]"].join("\n");
const NOTES = ["Notes.", "", "```abc", NOTES_SOURCE, "```", ""].join("\n");
const notesDoc = (line) => ["Notes.", "", "```abc", "X:1", "M:4/4", "L:1/8", "K:C", line, "```", ""].join("\n");
// The music of a score written on one line, its last.
const music = async (page) => (await staged(page)).split("\n").pop();
// What the cursor stands on, as it is written.
const placeText = (page) =>
  page.evaluate(() => {
    const g = document.querySelector("#app .mdm-score-cursor");
    const source = g.closest(".mdm-score").getAttribute("data-mdm-source");
    return source.slice(Number(g.getAttribute("data-mdm-from")), Number(g.getAttribute("data-mdm-to"))).trim();
  });
// The figure the mode keeps, as the cursor's drawing names it.
const kept = (page) => page.evaluate(() => Number(document.querySelector("#app .mdm-score-cursor").getAttribute("data-mdm-figure")));
// The cursor as it is drawn: the outline at its step, and nothing else.
const cursorLook = (page) =>
  page.evaluate(() => {
    const g = document.querySelector("#app .mdm-score-cursor");
    return {
      outline: getComputedStyle(g.querySelector(".mdm-score-cursor__step")).visibility,
      shapes: g.children.length,
      others: g.parentNode.querySelectorAll(":scope > [class^='mdm-']").length,
    };
  });
const notices = (page) => page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-score-notice")).map((n) => n.textContent));

async function toStep(page, step) {
  const c = await cursor(page);
  // Not `press` with nought, which presses once.
  if (step !== c.step) await press(page, step > c.step ? "ArrowUp" : "ArrowDown", Math.abs(step - c.step));
  assert.equal((await cursor(page)).step, step);
}

const edits = (page) => page.evaluate(() => window.__posts.filter((m) => m.type === "edit").map((m) => m.text));

// The owner's call of 2026-10-02, the second evening: writing leaves the
// cursor where it wrote. Enter is the key of a head at the place's own
// length, and has a test of its own (SM68). And of 2026-10-04: a note
// written on a rest takes the rest's place whole, "al marcar 3 sale la negra
// y el compás queda incompleto".
test("a figure's key writes a note on a rest, in the rest's place, and the cursor stays on it; the text takes each note, and undo takes each back (SM51)", { skip }, async () => {
  const h = await open({ text: notesDoc("z2 z2 z2 z2 | z8 |]"), scores: 1 });
  await pressMode(h.page);
  await toStep(h.page, 6);
  // No figure chosen or met yet: the one the meter counts in.
  assert.equal(await kept(h.page), 0.25);
  assert.deepEqual(await edits(h.page), []);
  await h.page.keyboard.press("3");
  assert.equal(await music(h.page), "B2 z2 z2 z2 | z8 |]");
  // Into the text at once, and to the host, as every change of the mode.
  assert.equal(await docText(h.page), notesDoc("B2 z2 z2 z2 | z8 |]"));
  const sent = await edits(h.page);
  assert.equal(sent[sent.length - 1], notesDoc("B2 z2 z2 z2 | z8 |]"));
  // The cursor on the note it wrote, at the step it was at.
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step], ["B2", 6]);
  // The key again, at the note's own head, and Enter there: there is
  // nothing to write, and a head is Delete's to take off.
  for (const key of ["3", "Enter"]) await h.page.keyboard.press(key);
  assert.equal(await music(h.page), "B2 z2 z2 z2 | z8 |]");
  assert.equal((await edits(h.page)).length, sent.length);
  // On along the bar by the arrows.
  await h.page.keyboard.press("ArrowRight");
  await h.page.keyboard.press("ArrowUp");
  await h.page.keyboard.press("3");
  assert.equal(await music(h.page), "B2 c2 z2 z2 | z8 |]");
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step], ["c2", 7]);
  await h.page.keyboard.press("ArrowRight");
  await h.page.keyboard.press("3");
  assert.equal(await music(h.page), "B2 c2 c2 z2 | z8 |]");
  await h.page.keyboard.press("ArrowRight");
  await h.page.keyboard.press("3");
  assert.equal(await music(h.page), "B2 c2 c2 c2 | z8 |]");
  // Past the barline, onto the next bar.
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step], ["z8", 7]);
  // On the rest of a whole bar the quarter takes the rest's place, and the
  // bar is left with the quarter and nothing after it. A key held down is
  // one note: the second keydown is the key repeating.
  await h.page.keyboard.down("3");
  await h.page.keyboard.down("3");
  await h.page.keyboard.up("3");
  assert.equal(await music(h.page), "B2 c2 c2 c2 | c2 |]");
  assert.equal(await placeText(h.page), "c2");
  assert.deepEqual(await notices(h.page), []);
  // Each note is a step of its own, and the cursor goes back where the note
  // was written from, and with Ctrl+Y onto the note again.
  await chord(h.page, ["Control"], "z");
  assert.equal(await music(h.page), "B2 c2 c2 c2 | z8 |]");
  assert.equal(await placeText(h.page), "z8");
  await chord(h.page, ["Control"], "z");
  assert.equal(await music(h.page), "B2 c2 c2 z2 | z8 |]");
  assert.equal(await placeText(h.page), "z2");
  await chord(h.page, ["Control"], "y");
  assert.equal(await music(h.page), "B2 c2 c2 c2 | z8 |]");
  assert.equal(await placeText(h.page), "c2");
  await press(h.page, "ArrowRight", 4);
  assert.equal(await placeText(h.page), "z8");
  await h.page.keyboard.press("1");
  assert.equal(await music(h.page), "B2 c2 c2 c2 | c8 |]");
  assert.equal(await placeText(h.page), "c8");
  await pressMode(h.page);
  assert.equal(await docText(h.page), notesDoc("B2 c2 c2 c2 | c8 |]"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a key of a figure writes with it, from 1 a whole note to 7 a sixty-fourth, and that is the figure a 0 writes its rest with after (SM52)", { skip }, async () => {
  const h = await open({ text: notesDoc("z8 | z z z z z4 |]"), scores: 1 });
  await pressMode(h.page);
  // A figure is kept for as long as the mode is on, and no longer: left and
  // entered again, the mode writes with the meter's.
  await h.page.keyboard.press("5");
  assert.equal(await kept(h.page), 1 / 16);
  await chord(h.page, ["Control"], "z");
  await pressMode(h.page);
  await pressMode(h.page);
  assert.equal(await kept(h.page), 0.25);
  await toStep(h.page, 6);
  // Written on the rest of a bar, the note is all the bar holds after it.
  const written = { 1: "B8", 2: "B4", 3: "B2", 4: "B", 5: "B/2", 6: "B/4", 7: "B/8" };
  for (const key of Object.keys(written)) {
    await h.page.keyboard.press(key);
    assert.equal(await music(h.page), written[key] + " | z z z z z4 |]", "the key " + key);
    assert.equal(await kept(h.page), 1 / Math.pow(2, Number(key) - 1), "the figure kept after " + key);
    await chord(h.page, ["Control"], "z");
    assert.equal(await music(h.page), "z8 | z z z z z4 |]");
    assert.equal(await placeText(h.page), "z8");
  }
  // Eighths written one after the other over a run of rests, each against
  // the one before it in its beat.
  for (const key of ["ArrowRight", "4", "ArrowRight", "4", "ArrowRight", "4"]) await h.page.keyboard.press(key);
  assert.equal(await music(h.page), "z8 | BB B z z4 |]");
  // The figure is kept: a 0 on the half rest writes an eighth of rest in
  // its place, and nothing for what was left of the half.
  await press(h.page, "ArrowRight", 2);
  assert.equal(await placeText(h.page), "z4");
  await h.page.keyboard.press("0");
  assert.equal(await music(h.page), "z8 | BB B z z |]");
  // With Shift the key writes a rest of its own figure, which is the one
  // kept after it as a note's is (SM97; with Ctrl and with Alt it puts a
  // note in, SM63).
  await chord(h.page, ["Shift"], "3");
  assert.equal(await music(h.page), "z8 | BB B z z2 |]");
  assert.equal(await kept(h.page), 0.25);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the figure kept is the one of the note the cursor is walked or clicked onto, and a rest gives none; a key's own is given to the note it is pressed on, past the bar's meter if it is longer, and Enter's head takes the note's (SM53)", { skip }, async () => {
  const h = await open({ text: notesDoc("c2 ee d3 z | z2 c4 z2 |]"), scores: 1 });
  await pressMode(h.page);
  // On entering, the note the cursor is put on.
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["c2", 0.25]);
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["e", 0.125]);
  await press(h.page, "ArrowRight", 2);
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["d3", 0.375]);
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["z", 0.375]);
  // Up and down stay on the place, and change no figure.
  await h.page.keyboard.press("ArrowUp");
  assert.equal(await kept(h.page), 0.375);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[1].x, hs[1].y);
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["e", 0.125]);
  await h.page.mouse.click(hs[0].x, hs[0].y);
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["c2", 0.25]);
  // A quarter written on the rest that opens the second bar: the cursor
  // stays on it, and the quarter is kept.
  await press(h.page, "ArrowRight", 5);
  assert.equal(await placeText(h.page), "z2");
  await h.page.keyboard.press("3");
  assert.equal(await music(h.page), "c2 ee d3 z | c2 c4 z2 |]");
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["c2", 0.25]);
  // Walked onto, the half note gives its own.
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["c4", 0.5]);
  // The half's key at the note's own head writes nothing, and the half
  // stays the figure kept.
  assert.equal((await cursor(h.page)).step, 7);
  const sent = (await edits(h.page)).length;
  await h.page.keyboard.press("2");
  assert.equal((await edits(h.page)).length, sent);
  assert.equal(await kept(h.page), 0.5);
  // A whole note's key there makes the note a whole one and leaves the rest
  // after it where it was, the bar a half longer than its meter, with
  // nothing said (the owner's calls of 2026-10-03, "Deja que el usuario
  // pueda modificar el compás aunque termine pasado o por debajo", and of
  // the day after, "el tiempo no se lo debe quitar a nadie"; before the
  // first, "No room in this bar", and between the two the note took the
  // rest after it).
  await h.page.keyboard.press("1");
  assert.equal(await music(h.page), "c2 ee d3 z | c2 c8 z2 |]");
  assert.deepEqual(await notices(h.page), []);
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["c8", 1]);
  // At another step the half's key puts a head on, and the chord is a half:
  // shorter, with no rest put after it.
  await press(h.page, "ArrowUp", 2);
  await h.page.keyboard.press("2");
  assert.equal(await music(h.page), "c2 ee d3 z | c2 [ce]4 z2 |]");
  assert.equal(await kept(h.page), 0.5);
  // Enter takes its length from the note, and not from the figure kept: a
  // whole note's key and its undo leave the whole kept and the half on the
  // staff, and the head Enter puts on is a half's.
  await press(h.page, "ArrowUp", 2);
  await h.page.keyboard.press("1");
  assert.equal(await music(h.page), "c2 ee d3 z | c2 [ceg]8 z2 |]");
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await kept(h.page)], ["c2 ee d3 z | c2 [ce]4 z2 |]", 1]);
  await h.page.keyboard.press("Enter");
  assert.equal(await music(h.page), "c2 ee d3 z | c2 [ceg]4 z2 |]");
  assert.equal(await kept(h.page), 1);
  // Out of the mode and in again, none is kept: the cursor's note gives it.
  await pressMode(h.page);
  await pressMode(h.page);
  assert.equal(await kept(h.page), 0.25);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's call of 2026-10-02, the evening of the first round: the
// cursor walks as the box it always was, and the note is seen when it is
// written. The first round drew the note a key would write on the cursor.
test("the cursor is the box it always was: nothing of the figure is drawn on it, and a note the score cannot take is said in words (SM54)", { skip }, async () => {
  const h = await open({ text: notesDoc("z8 | z4 z4 | c4- c4 |]"), scores: 1 });
  await pressMode(h.page);
  const plain = { outline: "visible", shapes: 3, others: 1 };
  assert.deepEqual(await cursorLook(h.page), plain);
  await toStep(h.page, 12);
  assert.deepEqual(await cursorLook(h.page), plain);
  await toStep(h.page, 6);
  await h.page.keyboard.press("1");
  assert.equal(await music(h.page), "B8 | z4 z4 | c4- c4 |]");
  assert.deepEqual(await cursorLook(h.page), plain);
  // An eighth on the first of two half rests, then a whole note on the
  // second: the bar is left three eighths short and then an eighth too
  // long, which the score takes without a word.
  await h.page.keyboard.press("ArrowRight");
  await h.page.keyboard.press("4");
  assert.equal(await music(h.page), "B8 | B z4 | c4- c4 |]");
  await h.page.keyboard.press("ArrowRight");
  await h.page.keyboard.press("1");
  assert.equal(await music(h.page), "B8 | B B8 | c4- c4 |]");
  assert.deepEqual(await notices(h.page), []);
  assert.deepEqual(await cursorLook(h.page), plain);
  // A note with a tie on it takes no other figure: the score says so over
  // the cursor and stays as it was, and the eighth is the figure kept all
  // the same.
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["c4-", 0.5]);
  await h.page.keyboard.press("4");
  assert.equal(await music(h.page), "B8 | B B8 | c4- c4 |]");
  assert.deepEqual(await notices(h.page), ["A tie crosses here"]);
  assert.equal(await kept(h.page), 0.125);
  assert.deepEqual(await cursorLook(h.page), plain);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's calls of 2026-10-02, the second evening: Delete is the one
// way out, for a note as for a rest, and a place that is all its bar takes
// the bar with it. And of 2026-10-04: a note goes as a rest does, with its
// time ("cambia también el delete sobre una nota, que la borra en vez de
// poner un silencio"), 0 being the key that makes a rest of it; for two
// days it left a rest as long and went on a second press.
test("Delete and Backspace take a note out from its head and from nowhere else, and a rest from anywhere, each with the time it held; one that is all its bar takes the bar; and 0 makes a rest of a note (SM55)", { skip }, async () => {
  const h = await open({ text: notesDoc("B2 z2 d2 z2 | z8 | c8 |]"), scores: 1 });
  await pressMode(h.page);
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "z2");
  // A rest goes, and its time: the cursor on the place after it.
  await h.page.keyboard.press("Delete");
  assert.equal(await music(h.page), "B2 d2 z2 | z8 | c8 |]");
  assert.equal(await placeText(h.page), "d2");
  // A note, with the cursor at a step it has no head at: nothing goes, and
  // nothing is said (the owner's call of 2026-10-03). At its head it goes
  // as the rest did, and the cursor is on the place after it.
  assert.notEqual((await cursor(h.page)).step, 8);
  const untouched = (await edits(h.page)).length;
  for (const key of ["Delete", "Backspace"]) await h.page.keyboard.press(key);
  assert.equal(await music(h.page), "B2 d2 z2 | z8 | c8 |]");
  assert.equal((await edits(h.page)).length, untouched);
  assert.deepEqual(await notices(h.page), []);
  await toStep(h.page, 8);
  await h.page.keyboard.press("Delete");
  assert.equal(await music(h.page), "B2 z2 | z8 | c8 |]");
  assert.equal(await placeText(h.page), "z2");
  // Backspace takes out what Delete does, and takes the cursor to the
  // place on the left of it (SM101).
  await h.page.keyboard.press("Backspace");
  assert.equal(await music(h.page), "B2 | z8 | c8 |]");
  assert.equal(await placeText(h.page), "B2");
  // The rest a bar is all of: the bar goes, and the cursor onto the next.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "z8");
  await h.page.keyboard.press("Delete");
  assert.equal(await music(h.page), "B2 | c8 |]");
  assert.equal(await placeText(h.page), "c8");
  // A note alone in its bar takes the bar as the rest did, in the one
  // press, keeping the barline that ends the tune; the cursor onto the
  // place before, there being none after.
  await toStep(h.page, 7);
  await h.page.keyboard.press("Delete");
  assert.equal(await music(h.page), "B2 |]");
  assert.equal(await placeText(h.page), "B2");
  // The score's only bar stays, and says why.
  await toStep(h.page, 6);
  await h.page.keyboard.press("Delete");
  assert.equal(await music(h.page), "B2 |]");
  assert.deepEqual(await notices(h.page), ["The score's only bar"]);
  // Taken back one by one, with the cursor on what changed.
  await chord(h.page, ["Control"], "z");
  assert.equal(await music(h.page), "B2 | c8 |]");
  assert.equal(await placeText(h.page), "c8");
  for (let i = 0; i < 4; i++) await chord(h.page, ["Control"], "z");
  assert.equal(await music(h.page), "B2 z2 d2 z2 | z8 | c8 |]");
  assert.equal(await placeText(h.page), "z2");
  // 0 is a rest of the figure kept over the place, a quarter here, from
  // any height, and the cursor stays on it; on a rest that is that rest
  // already, nothing.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "d2");
  assert.notEqual((await cursor(h.page)).step, 8);
  await h.page.keyboard.press("0");
  assert.equal(await music(h.page), "B2 z2 z2 z2 | z8 | c8 |]");
  // On the second of the three rests, the one written.
  assert.match((await staged(h.page)).slice(0, (await cursor(h.page)).from).split("\n").pop(), /^B2 z2 ?$/);
  const sent = (await edits(h.page)).length;
  await h.page.keyboard.press("0");
  assert.equal((await edits(h.page)).length, sent);
  assert.deepEqual(h.errors, []);
  await h.close();
  // The place the cursor lands on where its own went gives the figure kept,
  // as a place walked onto does: 0 there is a rest as long as that note,
  // and not as the one that went.
  const g = await open({ text: notesDoc("c2 d4 e2 |]"), scores: 1 });
  await pressMode(g.page);
  assert.deepEqual([await placeText(g.page), await kept(g.page), (await cursor(g.page)).step], ["c2", 0.25, 7]);
  await g.page.keyboard.press("Delete");
  assert.equal(await music(g.page), "d4 e2 |]");
  assert.deepEqual([await placeText(g.page), await kept(g.page)], ["d4", 0.5]);
  await g.page.keyboard.press("0");
  assert.equal(await music(g.page), "z4 e2 |]");
  // A figure kept that is not the chord's stays the one kept under Delete.
  const k = await open({ text: notesDoc("[ce]2 d4 e2 |]"), scores: 1 });
  await pressMode(k.page);
  await toStep(k.page, 9);
  await k.page.keyboard.press("5");
  await chord(k.page, ["Control"], "z");
  assert.equal(await kept(k.page), 1 / 16);
  // And so does Delete at a step the chord has no head at, which takes
  // nothing: read once the cursor is drawn again, a step up.
  await toStep(k.page, 4);
  await k.page.keyboard.press("Delete");
  await k.page.keyboard.press("ArrowUp");
  assert.deepEqual([await music(k.page), await kept(k.page)], ["[ce]2 d4 e2 |]", 1 / 16]);
  assert.deepEqual(g.errors.concat(k.errors), []);
  await g.close();
  await k.close();
});

test("a key that writes, while the music sounds on the cursor's score, stops it and writes nothing; pressed again, it writes (SM56)", { skip }, async () => {
  const h = await open({ text: EIGHTHS, scores: 1 });
  await pressMode(h.page);
  // The cursor is put down on a note on the way in, and has its figure:
  // an eighth, where the meter's own is a quarter.
  assert.equal(await kept(h.page), 0.125);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[16].x, hs[16].y);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await sleep(700);
  await h.page.keyboard.press("3");
  await untilSounding(h.page, false);
  assert.equal(await staged(h.page), EIGHTHS_SOURCE);
  // Nor did it change the figure: the eighth of the note clicked.
  assert.equal(await kept(h.page), 0.125);
  // So do the keys with Ctrl and Alt that put places and bars in, and the
  // ones with Shift that write rests, and Ctrl+Down stops it as an arrow
  // does: at once, and not at the end of the tune, which a wait of
  // untilSounding's length would also have seen.
  for (const [mods, key] of [
    [["Control"], "3"],
    [["Alt"], "3"],
    [["Shift"], "3"],
    [["Control", "Shift"], "3"],
    [["Alt", "Shift"], "3"],
    [["Control"], "ArrowRight"],
    [["Control"], "ArrowDown"],
  ]) {
    await h.page.keyboard.press("Space");
    await untilSounding(h.page, true);
    await sleep(300);
    await chord(h.page, mods, key);
    await h.page.waitForFunction(() => !document.querySelector(".mdm-audio .abcjs-midi-start.abcjs-pushed"), { timeout: 2000 });
    assert.equal(await staged(h.page), EIGHTHS_SOURCE, mods.join("+") + "+" + key);
  }
  // Pressed again, 0 makes the note the music stopped on a rest of the
  // eighth kept: one place changes.
  await h.page.keyboard.press("0");
  const now = await staged(h.page);
  assert.notEqual(now, EIGHTHS_SOURCE);
  assert.equal(now.split("z").length - 1, 1);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the keys that write stop at the mode, Ctrl with the arrows and the figures as well, and Shift with the figures; with Alt they go on with no name; and the ones it has no use for go on to VS Code as they are (SM57)", { skip }, async () => {
  const h = await open({ text: NOTES, scores: 1, clipboard: true });
  await h.page.evaluate(() => {
    window.__heard = [];
    window.addEventListener("keydown", (e) => {
      if (!/^(Control|Shift|Alt|Meta)$/.test(e.key)) window.__heard.push((e.ctrlKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + (e.altKey ? "Alt+" : "") + e.code);
    });
  });
  const heard = () => h.page.evaluate(() => window.__heard.splice(0));
  await pressMode(h.page);
  await heard();
  for (const key of ["Enter", "3", "0", "7", "Delete", "Backspace"]) await h.page.keyboard.press(key);
  // Ctrl+1 is VS Code's for the first group of editors, Ctrl+0 for the side
  // bar and Ctrl+Up for a line of scrolling, and the mode's while it holds
  // the keyboard. So are the figures' keys with Shift, which write rests,
  // and Ctrl+Shift+Space, which picks the cursor's voice for a stretch (a
  // key of VS Code's as well: its parameter hints, and in 1.133 a
  // push-to-talk, read off its bundle).
  for (const [mods, key] of [
    [["Control"], "3"],
    [["Control"], "0"],
    [["Shift"], "3"],
    [["Shift"], "7"],
    [["Control", "Shift"], "3"],
    [["Control"], "ArrowRight"],
    [["Control"], "ArrowLeft"],
    [["Control"], "ArrowUp"],
    [["Control"], "ArrowDown"],
    [["Control", "Shift"], "ArrowUp"],
    [["Control", "Shift"], "ArrowDown"],
    [["Control", "Shift"], "Space"],
    [["Control", "Shift"], "ArrowRight"],
    [["Control", "Shift"], "ArrowLeft"],
    [["Control"], "c"],
    [["Control"], "v"],
    // A cut and a select-all of the page under the mode, were they let go
    // on to VS Code (SM107, SM108).
    [["Control"], "x"],
    [["Control"], "a"],
  ]) {
    await chord(h.page, mods, key);
  }
  assert.deepEqual(await heard(), []);
  // With Alt held the key is the mode's as well, and VS Code hears of it
  // as a key with no name (takeScoreKey): Alt+3 is its third tab, and a
  // key it never heard of would leave Alt a clean tap, which opens its
  // File menu. Shift+Alt+1 is its editor moved to the first group.
  for (const [mods, key] of [
    [["Alt"], "3"],
    [["Alt"], "0"],
    [["Shift", "Alt"], "1"],
  ]) {
    await chord(h.page, mods, key);
  }
  assert.deepEqual(await heard(), ["Alt+", "Alt+", "Shift+Alt+"]);
  const written = await staged(h.page);
  assert.notEqual(written, NOTES_SOURCE);
  for (const [mods, key] of [
    [["Control"], "Enter"],
    [["Shift"], "Enter"],
    [["Alt"], "8"],
    [["Control"], "Delete"],
    [["Control"], "8"],
    [["Control"], "9"],
    // 0 names no figure for Shift to make a rest of, and 8 is no figure's.
    [["Shift"], "0"],
    [["Shift"], "8"],
    [["Control", "Shift"], "0"],
    [["Shift", "Alt"], "0"],
    [["Control", "Shift"], "8"],
    [["Control", "Alt"], "3"],
    [["Control", "Shift", "Alt"], "3"],
    [["Control", "Alt"], "ArrowUp"],
    [["Alt"], "ArrowUp"],
    // Ctrl+Alt with Left and Right added a bar to every voice until the
    // owner took Alt out of that as well (2026-10-06, SM103): VS Code's own
    // again, an editor moved into the next group or the one before it.
    [["Control", "Alt"], "ArrowRight"],
    [["Control", "Alt"], "ArrowLeft"],
    // Ctrl+Shift+Alt is no chord of the mode's: the walk over the voices
    // and its Space were under it until the owner took Alt out of them
    // (2026-10-06), and a stretch was drawn out under it as well.
    [["Control", "Shift", "Alt"], "ArrowDown"],
    [["Control", "Shift", "Alt"], "ArrowUp"],
    [["Control", "Shift", "Alt"], "ArrowRight"],
    [["Control", "Shift", "Alt"], "ArrowLeft"],
    [["Control", "Shift", "Alt"], "Space"],
    // The cut and the whole are Ctrl's alone.
    [["Control", "Shift"], "x"],
    [["Control", "Shift"], "a"],
    [["Control", "Alt"], "x"],
    [["Control", "Alt"], "a"],
  ]) {
    await chord(h.page, mods, key);
  }
  assert.deepEqual(await heard(), [
    "Ctrl+Enter",
    "Shift+Enter",
    "Alt+Digit8",
    "Ctrl+Delete",
    "Ctrl+Digit8",
    "Ctrl+Digit9",
    "Shift+Digit0",
    "Shift+Digit8",
    "Ctrl+Shift+Digit0",
    "Shift+Alt+Digit0",
    "Ctrl+Shift+Digit8",
    "Ctrl+Alt+Digit3",
    "Ctrl+Shift+Alt+Digit3",
    "Ctrl+Alt+ArrowUp",
    "Alt+ArrowUp",
    "Ctrl+Alt+ArrowRight",
    "Ctrl+Alt+ArrowLeft",
    "Ctrl+Shift+Alt+ArrowDown",
    "Ctrl+Shift+Alt+ArrowUp",
    "Ctrl+Shift+Alt+ArrowRight",
    "Ctrl+Shift+Alt+ArrowLeft",
    "Ctrl+Shift+Alt+Space",
    "Ctrl+Shift+KeyX",
    "Ctrl+Shift+KeyA",
    "Ctrl+Alt+KeyX",
    "Ctrl+Alt+KeyA",
  ]);
  assert.equal(await staged(h.page), written);
  // Out of the mode they are the text's keys again.
  await pressMode(h.page);
  await h.page.keyboard.press("3");
  assert.deepEqual(await heard(), ["Digit3"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("in a duet the note goes into the voice the cursor is in, at the step of its own clef (SM58)", { skip }, async () => {
  const source = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "z4 |]", "V:2 clef=bass", "z4 |]"].join("\n");
  const h = await open({ text: ["Two voices.", "", "```abc", source, "```", ""].join("\n"), scores: 1 });
  await pressMode(h.page);
  const st = await staves(h.page, 0);
  // The middle line of the lower staff, a D under the bass clef.
  await h.page.mouse.click((st[1].left + st[1].right) / 2, stepAt(st[1], 6));
  assert.deepEqual([(await cursor(h.page)).step, await placeText(h.page)], [6, "z4"]);
  await h.page.keyboard.press("3");
  assert.equal(await staged(h.page), source.replace("V:2 clef=bass\nz4 |]", "V:2 clef=bass\nD, |]"));
  // And the same line of the upper one is a B.
  await h.page.mouse.click((st[0].left + st[0].right) / 2, stepAt(st[0], 6));
  await h.page.keyboard.press("2");
  assert.equal(await staged(h.page), source.replace("V:1\nz4 |]", "V:1\nB2 |]").replace("V:2 clef=bass\nz4 |]", "V:2 clef=bass\nD, |]"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("before any figure is kept, a 0 writes a rest of the one the meter counts in: an eighth in 6/8, a half in cut time (SM59)", { skip }, async () => {
  const jig = ["X:1", "M:6/8", "L:1/8", "K:D", "z6 |]"].join("\n");
  const cut = ["X:1", "M:C|", "L:1/8", "K:C", "z8 |]"].join("\n");
  const h = await open({ text: ["Meters.", "", "```abc", jig, "```", "", "```abc", cut, "```", ""].join("\n"), scores: 2 });
  await pressMode(h.page);
  await toStep(h.page, 6);
  assert.equal(await kept(h.page), 0.125);
  await h.page.keyboard.press("0");
  assert.equal(await stagedAt(h.page, 0), jig.replace("z6", "z"));
  // Nothing was chosen or met, so the other score's meter gives its own.
  await chord(h.page, ["Control"], "z");
  const st = (await staves(h.page, 1))[0];
  await h.page.mouse.click((st.left + st.right) / 2, stepAt(st, 6));
  assert.equal(await kept(h.page), 0.5);
  await h.page.keyboard.press("0");
  assert.equal(await stagedAt(h.page, 1), cut.replace("z8", "z4"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's asks of 2026-10-02: Enter on a note at another step adds the
// head, making a chord, and a C quarter with the cursor up at G and 4 is
// `[CG]` an eighth; the next evening, Delete takes a head off, and the bar
// the eighth leaves short stays so, with no rest put in. A note's only head
// takes the note with it (2026-10-04).
test("on a note, Enter and a figure's key put a head on at the cursor's step and Delete takes one off, the cursor staying on the chord; a figure's key gives the chord its figure and adds no rest (SM60)", { skip }, async () => {
  const h = await open({ text: notesDoc("C2 z2 z4 | z8 |]"), scores: 1 });
  await pressMode(h.page);
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step], ["C2", 0]);
  // The quarter's key and Enter at the C's own head are the C as it is:
  // nothing to write.
  const sent = (await edits(h.page)).length;
  await h.page.keyboard.press("3");
  await h.page.keyboard.press("Enter");
  assert.equal((await edits(h.page)).length, sent);
  const line = async () => [await music(h.page), (await cursor(h.page)).from, (await cursor(h.page)).step];
  const head = async () => (await staged(h.page)).lastIndexOf("\n") + 1;
  for (const [key, step, written] of [
    ["Enter", 2, "[CE]2 z2 z4 | z8 |]"],
    ["3", 4, "[CEG]2 z2 z4 | z8 |]"],
    ["Delete", 2, "[CG]2 z2 z4 | z8 |]"],
    ["Backspace", 0, "G2 z2 z4 | z8 |]"],
  ]) {
    await toStep(h.page, step);
    await h.page.keyboard.press(key);
    // The cursor stays on the place, at its step, for the next head.
    assert.deepEqual(await line(), [written, await head(), step], key + " at step " + step);
  }
  // The last head is the note: Delete at it takes the note out, with its
  // time, and at the step the C was at, where it has no head now, nothing.
  await h.page.keyboard.press("Delete");
  assert.equal(await music(h.page), "G2 z2 z4 | z8 |]");
  await toStep(h.page, 4);
  await h.page.keyboard.press("Delete");
  assert.equal(await music(h.page), "z2 z4 | z8 |]");
  // Each a step of its own for Ctrl+Z.
  for (let i = 0; i < 5; i++) await chord(h.page, ["Control"], "z");
  assert.equal(await music(h.page), "C2 z2 z4 | z8 |]");
  // The owner's example: the bar an eighth short, and left so.
  await toStep(h.page, 4);
  await h.page.keyboard.press("4");
  assert.equal(await music(h.page), "[CG] z2 z4 | z8 |]");
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["[CG]", 0.125]);
  // The quarter's key gives the eighth back, and the bar is as it was.
  await h.page.keyboard.press("3");
  assert.equal(await music(h.page), "[CG]2 z2 z4 | z8 |]");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's ask of 2026-10-02: "cuando el cursor se salga del pentagrama
// vaya mostrando rayitas (quizás en gris) para que se sepa qué nota se va a
// poner". The cursor's ledger lines stand where abcjs draws a note's.
test("off the staff the cursor stands on grey ledger lines, the ones a note written there would have, and on the staff on none (SM61)", { skip }, async () => {
  const h = await open({ text: notesDoc("C2 z2 z4 | z8 |]"), scores: 1 });
  await pressMode(h.page);
  const ledgers = () =>
    h.page.evaluate(() => {
      const path = document.querySelector("#app .mdm-score-cursor .mdm-score-cursor__ledger");
      const d = path.getAttribute("d") || "";
      const svg = path.ownerSVGElement;
      // Where the note's own ledger line is, in the score's units, to set
      // the cursor's against.
      const own = svg.querySelector(".abcjs-ledger");
      const box = own ? own.getBBox() : null;
      const lines = (d.match(/M/g) || []).length;
      const mine = lines ? path.getBBox() : null;
      return {
        lines: lines,
        fill: getComputedStyle(path).fill,
        under: !!(path.compareDocumentPosition(svg.querySelector('[class*="abcjs-"]')) & Node.DOCUMENT_POSITION_FOLLOWING),
        own: box && [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 10) / 10),
        mine: mine && [mine.x, mine.y, mine.width, mine.height].map((n) => Math.round(n * 10) / 10),
      };
    });
  // On the C under the treble staff: one line, the C's own, to a fifth of
  // a unit (the cursor stands on the middle of the head, which abcjs
  // rounds), drawn under the ink and in the staff's grey.
  const look = await ledgers();
  assert.deepEqual([look.lines, look.fill, look.under], [1, "rgb(163, 163, 163)", true]);
  look.mine.forEach((n, i) => assert.ok(Math.abs(n - look.own[i]) <= 0.2, "the line is " + look.mine + ", the C's " + look.own));
  // On the staff and in the spaces just past it, none.
  for (const step of [1, 6, 11]) {
    await toStep(h.page, step);
    assert.equal((await ledgers()).lines, 0, "step " + step);
  }
  // A line at every other step out, up and down.
  for (const [step, lines] of [[12, 1], [13, 1], [14, 2], [16, 3], [-1, 1], [-2, 2], [-4, 3]]) {
    await toStep(h.page, step);
    assert.equal((await ledgers()).lines, lines, "step " + step);
  }
  // The dark side has its own grey, the staff's grey there.
  await postSettings(h.page, { theme: "dark" });
  await sleep(100);
  assert.deepEqual([(await ledgers()).lines, (await ledgers()).fill], [3, "rgb(111, 111, 111)"]);
  // Out of the mode, nothing of the cursor is left.
  await pressMode(h.page);
  assert.equal(await h.page.evaluate(() => document.querySelectorAll("#app .mdm-score-cursor__ledger").length), 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's report of 2026-10-02: in `C | | G` only the first barline
// wore a +.
test("every barline wears a +, a barline that closes no bar as well, which adds the bar past itself (SM62)", { skip }, async () => {
  const source = ["X:1", "M:2/4", "L:1/4", "K:C", "C2 | | G2 | |]"].join("\n");
  const h = await open({ text: ["Empty bars.", "", "```abc", source, "```", ""].join("\n"), scores: 1 });
  await pressMode(h.page);
  const st = await staves(h.page, 0);
  const bars = await barlines(h.page);
  assert.equal(bars.length, 4);
  const point = (bar) => pointAt(h.page, { x: bar.x + 1, y: (st[0].top + st[0].bottom) / 2 });
  const seen = [];
  for (const bar of bars) {
    await point(bar);
    const add = await plus(h.page);
    assert.ok(add, "no + at the barline at " + bar.x);
    assert.ok(Math.abs(add.x - bar.x) < 2, "the + stands at " + add.x + ", the barline at " + bar.x);
    seen.push(add.bar);
  }
  assert.deepEqual(seen, [0, 1, 2, 3]);
  // The second: a bar past it, before the G's, and the cursor on it.
  await point(bars[1]);
  let add = await plus(h.page);
  await h.page.mouse.move(add.x, add.y, { steps: 4 });
  await sleep(350);
  assert.equal(await tip(h.page), "Add bar");
  const column = await markLook(h.page, "#app .mdm-score-edit-preview");
  assert.ok(Math.abs(column.middle - bars[1].x) < 1.5, "the column stands at " + column.middle + ", the barline at " + bars[1].x);
  await h.page.mouse.click(add.x, add.y);
  assert.equal(await staged(h.page), source.replace("C2 | | G2", "C2 | | z2 | G2"));
  assert.equal(await noteAtCursor(h.page), "z");
  await chord(h.page, ["Control"], "z");
  // The last, after the line's last bar: the bar after that one, as at the
  // barline that closes it.
  await point(bars[3]);
  add = await plus(h.page);
  await h.page.mouse.move(add.x, add.y, { steps: 4 });
  await h.page.mouse.click(add.x, add.y);
  assert.equal(await staged(h.page), source.replace("G2 | |]", "G2 | z2 | |]"));
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The keys with Ctrl and Alt ----------
//
// The owner's asks of 2026-10-02, the third evening, and their keys of the
// day after: Ctrl and Alt with a figure's key put a note in before the
// cursor's place and after it, and with 0 a rest; Ctrl with the arrows
// across adds a bar in the cursor's voice, and in the voices a stretch is
// chosen over (Ctrl+Alt added it in every voice until 2026-10-06); up and
// down, Ctrl goes from staff to staff and Ctrl+Shift from line to line.

// The owner's own example: `[CE]` in quarters, the cursor at the step of a
// G, and Alt+4 an eighth of G to its right.
test("Alt and a figure's key put a note of that figure in after the cursor's place at its step, Ctrl before it, and 0 a rest, in the same bar; the cursor goes onto it (SM63)", { skip }, async () => {
  const h = await open({ text: notesDoc("[CE]2 D2 E2 F2- | F8 |]"), scores: 1 });
  await pressMode(h.page);
  assert.equal(await placeText(h.page), "[CE]2");
  await toStep(h.page, 4);
  await chord(h.page, ["Alt"], "4");
  assert.equal(await music(h.page), "[CE]2 G D2 E2 F2- | F8 |]");
  // On the note, at the height it was at, the eighth kept.
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step, await kept(h.page)], ["G", 4, 0.125]);
  // Another after it, in its beat: written against it. And one before the
  // two with Ctrl, a quarter, set apart.
  await h.page.keyboard.press("ArrowUp");
  await chord(h.page, ["Alt"], "4");
  assert.equal(await music(h.page), "[CE]2 GA D2 E2 F2- | F8 |]");
  assert.equal(await placeText(h.page), "A");
  await h.page.keyboard.press("ArrowLeft");
  await chord(h.page, ["Control"], "3");
  assert.equal(await music(h.page), "[CE]2 A2 GA D2 E2 F2- | F8 |]");
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["A2", 0.25]);
  // 0 is a rest as long as the place the cursor stands on, on either side
  // (SM105): the quarter it has just put in, and then the rest put in
  // after that.
  await chord(h.page, ["Alt"], "0");
  assert.equal(await music(h.page), "[CE]2 A2 z2 GA D2 E2 F2- | F8 |]");
  assert.equal(await placeText(h.page), "z2");
  await chord(h.page, ["Control"], "0");
  assert.equal(await music(h.page), "[CE]2 A2 z2 z2 GA D2 E2 F2- | F8 |]");
  // Each a step of its own for Ctrl+Z, the cursor where it was before it.
  await chord(h.page, ["Control"], "z");
  assert.equal(await music(h.page), "[CE]2 A2 z2 GA D2 E2 F2- | F8 |]");
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["[CE]2 A2 GA D2 E2 F2- | F8 |]", "A2"]);
  for (let i = 0; i < 3; i++) await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["[CE]2 D2 E2 F2- | F8 |]", "[CE]2"]);
  // A key held down is one note.
  await h.page.keyboard.down("Alt");
  await h.page.keyboard.down("2");
  await h.page.keyboard.down("2");
  await h.page.keyboard.up("2");
  await h.page.keyboard.up("Alt");
  assert.equal(await music(h.page), "[CE]2 G4 D2 E2 F2- | F8 |]");
  // With Ctrl and Alt both they are not the mode's (with Shift as well
  // each puts a rest in, SM97).
  await chord(h.page, ["Control", "Alt"], "3");
  await chord(h.page, ["Control", "Shift", "Alt"], "3");
  assert.equal(await music(h.page), "[CE]2 G4 D2 E2 F2- | F8 |]");
  // A tie it would cut is said, and nothing is put in; before the tied
  // note, the tie is not crossed.
  await press(h.page, "ArrowRight", 3);
  assert.equal(await placeText(h.page), "F2-");
  await chord(h.page, ["Alt"], "3");
  assert.equal(await music(h.page), "[CE]2 G4 D2 E2 F2- | F8 |]");
  assert.deepEqual(await notices(h.page), ["A tie crosses here"]);
  await chord(h.page, ["Control"], "3");
  assert.equal(await music(h.page), "[CE]2 G4 D2 E2 G2 F2- | F8 |]");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's call of 2026-10-06: "ctrl/alt 0 inserta silencio
// izquierda/derecha con la duración de lo haya donde está el cursor (ya sea
// nota o silencio), no de la última nota que se puso". Until then the rest
// was of the figure kept, which is the last note's the cursor stood on and
// never a rest's: on a half rest come to from a quarter, the key put a
// quarter rest in.
test("Ctrl+0 and Alt+0 put a rest in as long as what the cursor stands on, a rest, a note or a chord, whatever figure is kept; at the open end, where nothing stands, one of the figure kept (SM105)", { skip }, async () => {
  const line = "[CE]2 z4 D2 | E3 F z4 | G2 z4";
  const h = await open({ text: notesDoc(line), scores: 1 });
  await pressMode(h.page);
  const stands = async () => [await placeText(h.page), (await ends2(h.page))[1], await kept(h.page)];
  // On a half rest, come to from a quarter: the quarter is the figure kept
  // still, and the rest put in is a half. The cursor goes onto it, and the
  // key keeps no figure.
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual(await stands(), ["z4", 1, 0.25]);
  await chord(h.page, ["Control"], "0");
  assert.equal(await music(h.page), "[CE]2 z4 z4 D2 | E3 F z4 | G2 z4");
  assert.deepEqual(await stands(), ["z4", 1, 0.25]);
  await chord(h.page, ["Alt"], "0");
  assert.equal(await music(h.page), "[CE]2 z4 z4 z4 D2 | E3 F z4 | G2 z4");
  assert.deepEqual(await stands(), ["z4", 2, 0.25]);
  await chord(h.page, ["Control"], "z");
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await stands()], [line, ["z4", 1, 0.25]]);
  // A length no figure's key names: a dotted quarter.
  await press(h.page, "ArrowRight", 2);
  assert.deepEqual(await stands(), ["E3", 3, 0.375]);
  await chord(h.page, ["Alt"], "0");
  assert.equal(await music(h.page), "[CE]2 z4 D2 | E3 z3 F z4 | G2 z4");
  await chord(h.page, ["Control"], "z");
  // A chord whose length is not the figure kept: made a half with its key
  // and given back by Ctrl+Z, which leaves the half kept. The rest is the
  // chord's quarter.
  await press(h.page, "ArrowLeft", 3);
  await h.page.keyboard.press("2");
  assert.equal(await music(h.page), "[CE]4 z4 D2 | E3 F z4 | G2 z4");
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await stands()], [line, ["[CE]2", 0, 0.5]]);
  await chord(h.page, ["Control"], "0");
  assert.equal(await music(h.page), "z2 [CE]2 z4 D2 | E3 F z4 | G2 z4");
  await chord(h.page, ["Control"], "z");
  // At the open end nothing stands to take a length from: the figure kept,
  // which is the quarter of the last note walked over and not the half of
  // the rest after it.
  await press(h.page, "ArrowRight", 9);
  assert.deepEqual(await stands(), ["", 8, 0.25]);
  await chord(h.page, ["Control"], "0");
  assert.equal(await music(h.page), line + " z2");
  await chord(h.page, ["Control"], "z");
  await chord(h.page, ["Alt"], "0");
  assert.equal(await music(h.page), line + " z2");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's keys of 2026-10-06: "shift [numero] añade silencio con la
// duración del número", and "ctrl/alt shift [numero] añade silencio a la
// izquierda/derecha". A rest of a figure took two keys until then, the
// figure's, which wrote a note, and 0 on the note. That Shift alone makes a
// rest of a note, as 0 does, where "añade" could have meant one put in
// beside it, is my reading of the first. The keys are pressed here by their
// place (`Digit3`), which is how they are read: with Shift the 3 types `#`
// on this keyboard and `·` on the owner's.
test("Shift and a figure's key make the cursor's place a rest of that figure, a note or a chord as a rest, and put one in at the open end; with Ctrl as well the rest goes in before the place and with Alt after it, the cursor onto it; the figure is kept, and what the score cannot take is said (SM97)", { skip }, async () => {
  const after = " | c2 [df]2 e2 f2 | g2 a2";
  const h = await open({ text: notesDoc("z8" + after), scores: 1 });
  await pressMode(h.page);
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["z8", 0.25]);
  // The rest of a whole note is what the bar reads already: nothing to
  // write, and the whole is the figure kept all the same.
  const sent = (await edits(h.page)).length;
  await chord(h.page, ["Shift"], "Digit1");
  assert.deepEqual([await music(h.page), (await edits(h.page)).length, await kept(h.page)], ["z8" + after, sent, 1]);
  // The other figures, down to the sixty-fourth: the rest's place is the
  // key's rest, the bar as much shorter, and the cursor on it.
  const rests = { 2: "z4", 3: "z2", 4: "z", 5: "z/2", 6: "z/4", 7: "z/8" };
  for (const key of Object.keys(rests)) {
    await chord(h.page, ["Shift"], "Digit" + key);
    assert.deepEqual([await music(h.page), await placeText(h.page), await kept(h.page)], [rests[key] + after, rests[key], 1 / Math.pow(2, Number(key) - 1)], "Shift+" + key);
    await chord(h.page, ["Control"], "z");
    assert.deepEqual([await music(h.page), await placeText(h.page)], ["z8" + after, "z8"], "Shift+" + key + " taken back");
  }
  // Into the text at once, and to the host, as every change of the mode.
  await chord(h.page, ["Shift"], "Digit3");
  assert.equal(await docText(h.page), notesDoc("z2" + after));
  const posted = await edits(h.page);
  assert.equal(posted[posted.length - 1], notesDoc("z2" + after));
  // A note is made a rest as a rest is, from any height of the cursor: the
  // eighth's key leaves an eighth of rest where the quarter was.
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["c2", 0.25]);
  await toStep(h.page, 10);
  await chord(h.page, ["Shift"], "Digit4");
  assert.deepEqual([await music(h.page), await placeText(h.page), await kept(h.page), (await cursor(h.page)).step], ["z2 | z [df]2 e2 f2 | g2 a2", "z", 0.125, 10]);
  // And a chord, whole.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "[df]2");
  await chord(h.page, ["Shift"], "Digit2");
  assert.deepEqual([await music(h.page), await placeText(h.page), await kept(h.page)], ["z2 | z z4 e2 f2 | g2 a2", "z4", 0.5]);
  assert.deepEqual(await notices(h.page), []);
  // With Ctrl as well the rest is put in before the cursor's place, and
  // with Alt after it, in the same bar: the cursor goes onto it, at the
  // height it was at, and the place it stood on is as it was.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "e2");
  await chord(h.page, ["Control", "Shift"], "Digit5");
  assert.deepEqual([await music(h.page), await placeText(h.page), await kept(h.page), (await cursor(h.page)).step], ["z2 | z z4 z/2 e2 f2 | g2 a2", "z/2", 1 / 16, 10]);
  await chord(h.page, ["Alt", "Shift"], "Digit4");
  assert.deepEqual([await music(h.page), await placeText(h.page), await kept(h.page), (await cursor(h.page)).step], ["z2 | z z4 z/2 z e2 f2 | g2 a2", "z", 0.125, 10]);
  // A key held down is one rest.
  for (const key of ["Control", "Shift", "Digit6", "Digit6"]) await h.page.keyboard.down(key);
  for (const key of ["Digit6", "Shift", "Control"]) await h.page.keyboard.up(key);
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["z2 | z z4 z/2 z/4 z e2 f2 | g2 a2", "z/4"]);
  // The keys of the numeric pad are the figures' as well, by their place.
  await chord(h.page, ["Shift"], "Numpad3");
  assert.deepEqual([await music(h.page), await kept(h.page)], ["z2 | z z4 z/2 z2 z e2 f2 | g2 a2", 0.25]);
  // Each a step of its own for Ctrl+Z, the cursor where it was before it.
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["z2 | z z4 z/2 z/4 z e2 f2 | g2 a2", "z/4"]);
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["z2 | z z4 z/2 z e2 f2 | g2 a2", "z"]);
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["z2 | z z4 z/2 e2 f2 | g2 a2", "z/2"]);
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["z2 | z z4 e2 f2 | g2 a2", "e2"]);
  // At the open end of the voice there is no place to make a rest of: one
  // is put in after the last, whichever of the three keys asks, and the
  // cursor is on it.
  for (let i = 0; i < 8 && (await placeText(h.page)) !== ""; i++) await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "");
  await chord(h.page, ["Shift"], "Digit3");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["z2 | z z4 e2 f2 | g2 a2 z2", "z2"]);
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "");
  await chord(h.page, ["Control", "Shift"], "Digit4");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["z2 | z z4 e2 f2 | g2 a2 z2 z", "z"]);
  await h.page.keyboard.press("ArrowRight");
  await chord(h.page, ["Alt", "Shift"], "Digit2");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["z2 | z z4 e2 f2 | g2 a2 z2 z z4", "z4"]);
  await pressMode(h.page);
  assert.equal(await docText(h.page), notesDoc("z2 | z z4 e2 f2 | g2 a2 z2 z z4"));
  assert.deepEqual(h.errors, []);
  await h.close();

  // What the score cannot take is said over the cursor and the score left
  // as it was, the key's figure kept all the same: a note with a tie on it
  // is made no rest, and none goes in after it, between the two notes
  // tied. Before it, one does.
  const tied = "c4- c4 | d8 |]";
  const g = await open({ text: notesDoc(tied), scores: 1 });
  await pressMode(g.page);
  assert.deepEqual([await placeText(g.page), await kept(g.page)], ["c4-", 0.5]);
  await chord(g.page, ["Shift"], "Digit3");
  assert.deepEqual([await music(g.page), await notices(g.page), await kept(g.page)], [tied, ["A tie crosses here"], 0.25]);
  await g.page.evaluate(() => document.querySelectorAll("#app .mdm-score-notice").forEach((n) => n.remove()));
  await chord(g.page, ["Alt", "Shift"], "Digit4");
  assert.deepEqual([await music(g.page), await notices(g.page), await kept(g.page)], [tied, ["A tie crosses here"], 0.125]);
  await chord(g.page, ["Control", "Shift"], "Digit4");
  assert.deepEqual([await music(g.page), await placeText(g.page)], ["z c4- c4 | d8 |]", "z"]);
  assert.deepEqual(g.errors, []);
  await g.close();
});

// The owner's ask of 2026-10-06, with the keys of the rests: "trata de
// asegurarte que va a correr en windows al menos". What a keyboard sends is
// the system's to say, and the numeric pad is where the systems part: with
// NumLock on and Shift held its digits come by the names they have with
// NumLock off, under X11 with Shift in the event and on Windows with none
// (the system lets go of Shift while the key is down). No Windows could be
// pressed here: the events are the ones it is known to send, made by hand,
// and the state of NumLock, which a headless browser has none of, is
// answered by the test.
test("a digit of the numeric pad pressed with Shift under NumLock comes by its other name, with Shift in the event or, as Windows sends it, with none, and is the figure's key with Shift all the same; with NumLock off the key is an arrow in earnest; and a key pressed with AltGr is not the mode's (SM98)", { skip }, async () => {
  const line = "c2 d2 e2 f2 | z8 |]";
  const h = await open({ text: notesDoc(line), scores: 1 });
  const lock = (name, on) =>
    h.page.evaluate(
      (name, on) => {
        if (!window.__locks) {
          window.__locks = {};
          const real = KeyboardEvent.prototype.getModifierState;
          KeyboardEvent.prototype.getModifierState = function (k) {
            return k in window.__locks ? window.__locks[k] : real.call(this, k);
          };
        }
        window.__locks[name] = on;
      },
      name,
      on
    );
  const cdp = await h.page.target().createCDPSession();
  // A key of the pad as the test browser's own keyboard does not send it:
  // by a name of its choosing, with the modifiers named.
  const pad = async (key, digit, vk, modifiers) => {
    const event = { key, code: "Numpad" + digit, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, location: 3, isKeypad: true };
    await cdp.send("Input.dispatchKeyEvent", Object.assign({ type: "rawKeyDown" }, event));
    await cdp.send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, event));
  };
  await h.page.evaluate(() => {
    window.__heard = [];
    window.addEventListener("keydown", (e) => {
      if (!/^(Control|Shift|Alt|Meta)$/.test(e.key)) window.__heard.push((e.ctrlKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + (e.altKey ? "Alt+" : "") + e.code);
    });
  });
  const heard = () => h.page.evaluate(() => window.__heard.splice(0));
  await pressMode(h.page);
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "d2");
  // NumLock off, which is the browser's own state here: the pad's 4 is the
  // arrow to the left and its 6 the one to the right, and nothing is written.
  await h.page.keyboard.press("Numpad4");
  assert.deepEqual([await music(h.page), await placeText(h.page)], [line, "c2"]);
  await h.page.keyboard.press("Numpad6");
  assert.deepEqual([await music(h.page), await placeText(h.page)], [line, "d2"]);
  // And its 1 is End: with Ctrl it is not Ctrl with the whole note's key,
  // and goes on to VS Code as it came.
  await heard();
  await chord(h.page, ["Control"], "Numpad1");
  assert.deepEqual([await music(h.page), await heard()], [line, ["Ctrl+Numpad1"]]);
  // NumLock on, and the 4 by the arrow's name with no Shift in the event,
  // as Windows sends it with Shift held: a rest of an eighth where the
  // cursor stands, and the cursor stays.
  await lock("NumLock", true);
  await heard();
  await h.page.keyboard.press("Numpad4");
  assert.deepEqual([await music(h.page), await placeText(h.page), await kept(h.page), await heard()], ["c2 z e2 f2 | z8 |]", "z", 0.125, []]);
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await placeText(h.page)], [line, "d2"]);
  // With Ctrl held, a rest put in before the cursor's place: not the bar
  // that Ctrl with the arrow adds. With Alt, after it, the pad's 2 being
  // the arrow down.
  await chord(h.page, ["Control"], "Numpad4");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["c2 z d2 e2 f2 | z8 |]", "z"]);
  await chord(h.page, ["Control"], "z");
  assert.equal(await placeText(h.page), "d2");
  await chord(h.page, ["Alt"], "Numpad2");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["c2 d2 z4 e2 f2 | z8 |]", "z4"]);
  await chord(h.page, ["Control"], "z");
  assert.equal(await placeText(h.page), "d2");
  // The 3 is PageDown by its other name, and no arrow: a rest of a quarter.
  await h.page.keyboard.press("Numpad3");
  assert.equal(await music(h.page), "c2 z2 e2 f2 | z8 |]");
  await chord(h.page, ["Control"], "z");
  // The 8 is the arrow up, and no figure's key: held with Shift it is
  // nobody's, and the cursor stays at its height.
  const height = (await cursor(h.page)).step;
  await h.page.keyboard.press("Numpad8");
  assert.deepEqual([await music(h.page), (await cursor(h.page)).step], [line, height]);
  // As X11 sends the 4, with Shift in the event: the same rest, where it
  // chose the cursor's place as Shift with the arrow does.
  await pad("ArrowLeft", 4, 37, 8);
  assert.deepEqual([await music(h.page), await placeText(h.page), await selection(h.page)], ["c2 z e2 f2 | z8 |]", "z", null]);
  await chord(h.page, ["Control"], "z");
  // 0 names no figure for Shift to make a rest of: Insert, the pad's 0 by
  // its other name, is not the mode's, and goes on as it came.
  await heard();
  await h.page.keyboard.press("Numpad0");
  await chord(h.page, ["Control"], "Numpad0");
  assert.deepEqual([await music(h.page), await heard()], [line, ["Numpad0", "Ctrl+Numpad0"]]);
  // With no Shift the pad types its digit, and that is the figure's key as
  // it is on the top row: a note of a quarter on the rest of the second bar.
  await press(h.page, "ArrowRight", 3);
  assert.equal(await placeText(h.page), "z8");
  await pad("3", 3, 99, 0);
  assert.match(await music(h.page), /^c2 d2 e2 f2 \| [A-Ga-g][,']*2 \|\]$/);
  await chord(h.page, ["Control"], "z");
  assert.equal(await music(h.page), line);
  // And with Ctrl, a note put in before the cursor's place, where the same
  // key held with Shift puts a rest in.
  await pad("4", 4, 100, 2);
  assert.match(await music(h.page), /^c2 d2 e2 f2 \| [A-Ga-g][,']* z8 \|\]$/);
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await placeText(h.page)], [line, "z8"]);
  // NumLock off again, the keys are arrows again.
  await lock("NumLock", false);
  await h.page.keyboard.press("Numpad4");
  assert.deepEqual([await music(h.page), await placeText(h.page)], [line, "f2"]);
  // A key pressed with AltGr is the key of its third level, `#` on the 3
  // of the owner's keyboard: with Shift as well it is not the rest's key,
  // and goes on as it came. X11 names AltGr in no modifier of the event.
  await lock("AltGraph", true);
  await heard();
  await chord(h.page, ["Shift"], "Digit3");
  assert.deepEqual([await music(h.page), await heard()], [line, ["Shift+Digit3"]]);
  await lock("AltGraph", false);
  await chord(h.page, ["Shift"], "Digit3");
  assert.equal(await music(h.page), "c2 d2 e2 z2 | z8 |]");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Ctrl+Right and Ctrl+Left add a bar of rest after the cursor's bar or before it in the cursor's voice alone, and in every voice of the line once they are chosen with Ctrl+Shift and an arrow; the cursor goes onto it at its height (SM64)", { skip }, async () => {
  const source = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "C4 | D4 |]", "V:2 clef=bass", "C,4 | D,4 |]"].join("\n");
  const h = await open({ text: ["Bars.", "", "```abc", source, "```", ""].join("\n"), scores: 1 });
  await pressMode(h.page);
  assert.equal(await placeText(h.page), "C4");
  await toStep(h.page, 4);
  // Ctrl alone: the upper voice, and the lower as it was.
  await chord(h.page, ["Control"], "ArrowRight");
  const upper = source.replace("C4 | D4", "C4 | z4 | D4");
  assert.equal(await staged(h.page), upper);
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step], ["z4", 4]);
  await chord(h.page, ["Control"], "z");
  assert.equal(await staged(h.page), source);
  assert.equal(await placeText(h.page), "C4");
  // In both: the voices are chosen first, with Ctrl+Shift and an arrow,
  // and the same key adds the bar to the ones chosen (the owner's call of
  // 2026-10-06, which took Ctrl+Alt out; SM103). Asked of the same place on
  // the same source, it is another question to the engine, and another
  // answer. The stretch is let go, and the cursor is on the new bar's rest
  // in the voice it was drawn out in, at its height.
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual([(await stretch(h.page)).voices, await ends2(h.page)], ["all", [0, 0]]);
  await chord(h.page, ["Control"], "ArrowRight");
  const both = upper.replace("C,4 | D,4", "C,4 | z4 | D,4");
  assert.equal(await staged(h.page), both);
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step, await ends2(h.page), await cursorShown(h.page)], ["z4", 4, [null, 1], true]);
  // Before the stretch's bar, which is the one just added, and onto it.
  await chord(h.page, ["Control", "Shift"], "ArrowLeft");
  await chord(h.page, ["Control"], "ArrowLeft");
  const three = source.replace("C4 | D4", "C4 | z4 | z4 | D4").replace("C,4 | D,4", "C,4 | z4 | z4 | D,4");
  assert.equal(await staged(h.page), three);
  assert.match((await staged(h.page)).slice(0, (await cursor(h.page)).from), /\nC4 \|$/);
  // At the head of the line, in the one voice.
  await h.page.keyboard.press("ArrowLeft");
  assert.equal(await placeText(h.page), "C4");
  await chord(h.page, ["Control"], "ArrowLeft");
  const headed = three.replace("V:1\nC4", "V:1\nz4 | C4");
  assert.equal(await staged(h.page), headed);
  // Before the barline that ends the tune, and a key held down is one bar.
  await press(h.page, "ArrowRight", 4);
  assert.equal(await placeText(h.page), "D4");
  await h.page.keyboard.down("Control");
  await h.page.keyboard.down("ArrowRight");
  await h.page.keyboard.down("ArrowRight");
  await h.page.keyboard.up("ArrowRight");
  await h.page.keyboard.up("Control");
  assert.equal(await staged(h.page), headed.replace("D4 |]", "D4 | z4 |]"));
  assert.equal(await placeText(h.page), "z4");
  // Each a step of its own for Ctrl+Z, the last of them back to the
  // stretch the first bar was added beside, chosen over both voices.
  for (let i = 0; i < 4; i++) await chord(h.page, ["Control"], "z");
  assert.equal(await staged(h.page), source);
  assert.deepEqual([(await stretch(h.page)).voices, await ends2(h.page)], ["all", [0, 0]]);
  // From the lower voice, Ctrl adds it in the lower voice alone.
  await chord(h.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(h.page), "C,4");
  await chord(h.page, ["Control"], "ArrowRight");
  const lower = source.replace("C,4 | D,4", "C,4 | z4 | D,4");
  assert.equal(await staged(h.page), lower);
  assert.equal((await cursor(h.page)).from, lower.indexOf("z4") - 1);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// VS Code takes the focus into its File menu on a clean press and release
// of Alt, which it reads off the keys the page sends on: measured in VS Code
// 1.133.0 on 2026-10-03, Alt+3 with Alt let go first left the keyboard in
// the menu while the mode stopped the 3. The listener here stands in for
// the preload's, which reads the key off the event as it comes to it.
test("a key the mode takes with Alt held reaches VS Code as a key with no name, the reader's own, and a tap of Alt reaches it as it is (SM67)", { skip }, async () => {
  const h = await open({ text: notesDoc("C2 D2 E2 F2 | G8 |]"), scores: 1 });
  await h.page.evaluate(() => {
    window.__host = [];
    const hear = (e) => window.__host.push([e.type === "keydown" ? "down" : "up", e.key, e.code, e.keyCode, e.which, e.altKey, e.isTrusted, e.defaultPrevented].join(" "));
    window.addEventListener("keydown", hear);
    window.addEventListener("keyup", hear);
  });
  const host = () => h.page.evaluate(() => window.__host.splice(0));
  await pressMode(h.page);
  await host();
  // Alt let go before the key: the order that took the focus.
  await h.page.keyboard.down("Alt");
  await h.page.keyboard.down("3");
  await h.page.keyboard.up("Alt");
  await h.page.keyboard.up("3");
  assert.equal(await music(h.page), "C2 C2 D2 E2 F2 | G8 |]");
  assert.deepEqual(await host(), [
    "down Alt AltLeft 18 18 true true false",
    "down Unidentified  0 0 true true true",
    "up Alt AltLeft 18 18 false true false",
    "up 3 Digit3 51 51 false true false",
  ]);
  // A tap of Alt is VS Code's: its File menu opens from in here.
  await h.page.keyboard.down("Alt");
  await h.page.keyboard.up("Alt");
  assert.deepEqual(await host(), ["down Alt AltLeft 18 18 true true false", "up Alt AltLeft 18 18 false true false"]);
  // And a key with Alt the mode has no use for goes on by its name.
  await chord(h.page, ["Alt"], "8");
  assert.deepEqual((await host()).slice(1, 2), ["down 8 Digit8 56 56 true true false"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's change of 2026-10-06: "Ctrl [down/up] siempre va a pasar al
// pentagrama que tenga literalmente abajo (da igual si es de otra clave o de
// otra línea), y cuando se haga Ctrl Shift [down/up] entonces sí se salta la
// clave de fa o el pedal del órgano y baja a la próxima línea". Until then
// Ctrl walked the lines in one voice and Ctrl+Shift the voices of one line,
// and neither went from the last staff of a line to the first of the next.
//
// Every place of the cursor's voice from where the cursor stands to the
// voice's end, walked to one by one: the source each was written from, and
// where it is drawn across.
async function placesAhead(page) {
  const places = [];
  for (;;) {
    const c = await cursor(page);
    if (places.length && places[places.length - 1].from === c.from) return places;
    places.push({ from: c.from, x: c.x });
    await page.keyboard.press("ArrowRight");
  }
}
// Of `places`, the one written on a line of a source (the line's number in
// it) that is drawn nearest across to `x`. Two as good as equally near
// would make the answer the layout's and not the editor's: said, and not
// let pass.
function nearestOn(source, places, row, x) {
  const there = places.filter((p) => source.slice(0, p.from + 1).split("\n").length - 1 === row).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
  assert.ok(there.length > 0, "no place on line " + row);
  if (there.length > 1) assert.ok(Math.abs(there[1].x - x) - Math.abs(there[0].x - x) > 2, "two places of line " + row + " are as near as each other to " + x);
  return there[0];
}
// The lines of DUET_SOURCE each voice's music is written on: its first line
// of staves, and its second.
const DUET_ROWS = { upper: [5, 9], lower: [7, 11] };
// Three voices on two staves, the third on the first staff with the first
// and written for the first line alone: on the second line it has no music,
// and no place.
const SHORT_OF_A_LINE = ["X:1", "M:4/4", "L:1/4", "%%score (1 3) 2", "K:C", "V:1", "c d e f |", "V:2 clef=bass", "C,4 |", "V:1", "g a b c' |", "V:3", "E F G A |", "V:2", "G,4 |"].join("\n");
const trackOf = (page) => page.evaluate(() => window.__mdm.scoreCursor.track);

test("Ctrl+Down and Ctrl+Up take the cursor to the staff under it or over it, as the page has them: the voice below or above on its line, at the place that sounds with its own, and past the last staff of a line the first of the line below, at the place nearest across; nowhere past the last staff of the score (SM65)", { skip }, async () => {
  // One voice: the staff below is the line below.
  const h = await open({ text: WALK, scores: 1 });
  await pressMode(h.page);
  // Where every place is drawn across, walked to one by one.
  const xs = [];
  for (let i = 0; i < WALK_PLACES.length; i++) {
    const c = await cursor(h.page);
    assert.equal(c.from, WALK_PLACES[i]);
    xs.push(c.x);
    await h.page.keyboard.press("ArrowRight");
  }
  const line = (i) => (i < 4 ? 0 : i < 8 ? 1 : 2);
  const nearest = (i, to) => {
    let best = -1;
    WALK_PLACES.forEach((from, j) => {
      if (line(j) === to && (best < 0 || Math.abs(xs[j] - xs[i]) < Math.abs(xs[best] - xs[i]))) best = j;
    });
    return best;
  };
  for (let i = 0; i < 4; i++) {
    await press(h.page, "ArrowLeft", 12);
    if (i) await press(h.page, "ArrowRight", i);
    await chord(h.page, ["Control"], "ArrowDown");
    const down = nearest(i, 1);
    assert.equal((await cursor(h.page)).from, WALK_PLACES[down], "down from place " + i);
    await chord(h.page, ["Control"], "ArrowDown");
    assert.equal((await cursor(h.page)).from, WALK_PLACES[nearest(down, 2)], "down again from place " + i);
  }
  // Past the last line, and the first, nowhere.
  const last = (await cursor(h.page)).from;
  await chord(h.page, ["Control"], "ArrowDown");
  assert.equal((await cursor(h.page)).from, last);
  await chord(h.page, ["Control"], "ArrowUp");
  await chord(h.page, ["Control"], "ArrowUp");
  assert.equal(line(WALK_PLACES.indexOf((await cursor(h.page)).from)), 0);
  const first = (await cursor(h.page)).from;
  await chord(h.page, ["Control"], "ArrowUp");
  assert.equal((await cursor(h.page)).from, first);
  // A height on the staff is kept, and a stretch is let go.
  await toStep(h.page, 5);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.ok(await selection(h.page));
  await chord(h.page, ["Control"], "ArrowDown");
  assert.equal((await cursor(h.page)).step, 5);
  assert.equal(await selection(h.page), null);
  assert.deepEqual(h.errors, []);
  await h.close();

  // Two voices on two staves, over two lines: four staves down the page.
  const d = await open({ text: DUET, scores: 1 });
  await pressMode(d.page);
  const stands = async () => [(await cursor(d.page)).from, await trackOf(d.page)];
  const upper = await placesAhead(d.page);
  assert.equal(upper.length, 13);
  // Under the upper voice's last note, the lower voice's.
  await chord(d.page, ["Control"], "ArrowDown");
  assert.deepEqual([await placeText(d.page), await trackOf(d.page)], ["C4", 1]);
  await press(d.page, "ArrowLeft", 9);
  const lower = await placesAhead(d.page);
  assert.equal(lower.length, 10);
  // On a line the voices sound together, and the place is the one at the
  // same beat: the third quarter under the third, and the whole note under
  // the first quarter of its bar. The figure is the note's the cursor comes
  // to.
  await press(d.page, "ArrowLeft", 9);
  await chord(d.page, ["Control"], "ArrowUp");
  assert.deepEqual(await stands(), [DUET_SOURCE.indexOf("c G A F"), 0]);
  await press(d.page, "ArrowRight", 2);
  assert.equal((await cursor(d.page)).from, DUET_SOURCE.indexOf("A F"));
  await chord(d.page, ["Control"], "ArrowDown");
  assert.deepEqual(await stands(), [DUET_SOURCE.indexOf("E, F,"), 1]);
  await chord(d.page, ["Control"], "ArrowUp");
  assert.deepEqual(await stands(), [DUET_SOURCE.indexOf("A F"), 0]);
  await press(d.page, "ArrowRight", 2);
  await chord(d.page, ["Control"], "ArrowDown");
  assert.deepEqual([await placeText(d.page), await kept(d.page)], ["G,4", 1]);
  await chord(d.page, ["Control"], "ArrowUp");
  assert.deepEqual([await placeText(d.page), await kept(d.page)], ["G", 0.25]);
  // Down the page, staff by staff. Under the lower voice of the first line
  // is the upper voice of the second, where the key stopped until that day
  // ("No voice under the lower one"), at the place nearest across; under
  // that the lower voice again, at the same beat; and under that nothing.
  await press(d.page, "ArrowLeft", 2);
  await chord(d.page, ["Control"], "ArrowDown");
  assert.deepEqual(await stands(), [DUET_SOURCE.indexOf("E, F,"), 1]);
  const second = nearestOn(DUET_SOURCE, upper, DUET_ROWS.upper[1], (await cursor(d.page)).x);
  await chord(d.page, ["Control"], "ArrowDown");
  assert.deepEqual(await stands(), [second.from, 0], "under the last staff of the first line");
  const under = lower[5 + upper.indexOf(second) - 8];
  await chord(d.page, ["Control"], "ArrowDown");
  assert.deepEqual(await stands(), [under.from, 1], "under the upper voice of the second line");
  await chord(d.page, ["Control"], "ArrowDown");
  assert.deepEqual(await stands(), [under.from, 1], "past the last staff of the score");
  // And back up it: the upper voice of the second line; over it the lower
  // voice of the first, the last staff of its line, at the place nearest
  // across; the upper voice at the beat of that; and over that nothing.
  await chord(d.page, ["Control"], "ArrowUp");
  assert.deepEqual(await stands(), [second.from, 0]);
  const back = nearestOn(DUET_SOURCE, lower, DUET_ROWS.lower[0], second.x);
  await chord(d.page, ["Control"], "ArrowUp");
  assert.deepEqual(await stands(), [back.from, 1], "over the first staff of the second line");
  const over = upper[lower.indexOf(back)];
  await chord(d.page, ["Control"], "ArrowUp");
  assert.deepEqual(await stands(), [over.from, 0], "over the lower voice of the first line");
  await chord(d.page, ["Control"], "ArrowUp");
  assert.deepEqual(await stands(), [over.from, 0], "past the first staff of the score");
  // With no Shift it is a move of the cursor as any other: a stretch chosen
  // is let go on the way to another voice, as it is on the way to another
  // line.
  await chord(d.page, ["Shift"], "ArrowRight");
  assert.ok(await selection(d.page));
  await chord(d.page, ["Control"], "ArrowDown");
  assert.deepEqual([await selection(d.page), await trackOf(d.page)], [null, 1]);
  assert.deepEqual(d.errors, []);
  await d.close();

  // Two voices on one staff are two stops of the walk, the upper one first;
  // and with one line and no staff under it there is nowhere further.
  const shared = ["X:1", "L:1/4", "%%score (1 2)", "K:C", "V:1", "c d e f |", "V:2", "C D E F |"].join("\n");
  const g = await open({ text: ["One staff, two voices.", "", "```abc", shared, "```", ""].join("\n"), scores: 1 });
  await pressMode(g.page);
  await press(g.page, "ArrowRight", 1);
  assert.equal((await cursor(g.page)).from, shared.indexOf("d e f"));
  await chord(g.page, ["Control"], "ArrowDown");
  assert.equal((await cursor(g.page)).from, shared.indexOf("D E F"));
  await chord(g.page, ["Control"], "ArrowDown");
  assert.equal((await cursor(g.page)).from, shared.indexOf("D E F"));
  await chord(g.page, ["Control"], "ArrowUp");
  assert.equal((await cursor(g.page)).from, shared.indexOf("d e f"));
  await chord(g.page, ["Control"], "ArrowUp");
  assert.equal((await cursor(g.page)).from, shared.indexOf("d e f"));
  assert.deepEqual(g.errors, []);
  await g.close();

  // A voice with no music on a line is no stop on that line. The third
  // voice here shares the first staff with the first and is written for
  // the first line alone: down the page it is a stop under the first voice
  // on the first line, and on the second the staff under the first voice is
  // the second voice's. The place come to on another line is the nearest
  // across, which is the layout's to say; whose staff it is, is not.
  const a = await open({ text: ["A voice short of a line.", "", "```abc", SHORT_OF_A_LINE, "```", ""].join("\n"), scores: 1 });
  await pressMode(a.page);
  assert.equal((await staves(a.page, 0)).length, 4, "two staves a line");
  const walked = async (key) => {
    const stops = [];
    for (let i = 0; i < 5; i++) {
      await chord(a.page, ["Control"], key);
      stops.push([await trackOf(a.page), await placeText(a.page)]);
    }
    return stops;
  };
  const down = await walked("ArrowDown");
  assert.deepEqual(down.map((stop) => stop[0]), [1, 2, 0, 2, 2]);
  assert.deepEqual([down[0][1], down[1][1], down[3][1]], ["E", "C,4", "G,4"]);
  assert.ok(["g", "a", "b", "c'"].includes(down[2][1]), "the first voice's second line, and not " + down[2][1]);
  assert.deepEqual(await walked("ArrowUp"), [[0, "g"], [2, "C,4"], [1, "E"], [0, "c"], [0, "c"]]);
  assert.deepEqual(a.errors, []);
  await a.close();

  // An overlay (`&`) is a voice of the staff it is written on, under the
  // staff's own and over the staff below, on the line that writes it and on
  // no other. The walk goes by the order the voices are kept in, which has
  // to be the page's: abcjs gives the overlay its voice on every line from
  // the first, so it is kept before the lower staff's, where a reading of
  // its code had it met a line late and kept after (2026-10-06). Down three
  // lines and back; into the second line from under it by its bottom staff.
  const overlay = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f |", "V:2 clef=bass", "C,4 |", "V:1", "g a b c' & e f g a |", "V:2", "G,4 |", "V:1", "c'4 |", "V:2", "C,4 |"].join("\n");
  const o = await open({ text: ["An overlay.", "", "```abc", overlay, "```", ""].join("\n"), scores: 1 });
  await pressMode(o.page);
  assert.equal((await staves(o.page, 0)).length, 6, "two staves a line, three lines");
  const stops = async (key, times) => {
    const out = [];
    for (let i = 0; i < times; i++) {
      await chord(o.page, ["Control"], key);
      out.push([await trackOf(o.page), await placeText(o.page)]);
    }
    return out;
  };
  const below = await stops("ArrowDown", 7);
  assert.deepEqual(below.map((stop) => stop[0]), [2, 0, 1, 2, 0, 2, 2]);
  assert.deepEqual([below[0][1], below[3][1], below[4][1], below[5][1]], ["C,4", "G,4", "c'4", "C,4"]);
  assert.ok(["e", "f", "g", "a"].includes(below[2][1]), "the overlay's note, and not " + below[2][1]);
  assert.deepEqual(await stops("ArrowUp", 7), [[0, "c'4"], [2, "G,4"], [1, "e"], [0, "g"], [2, "C,4"], [0, "c"], [0, "c"]]);
  assert.deepEqual(o.errors, []);
  await o.close();
});

// The owner's rule of 2026-10-06, on a chorale of two voices on one staff
// (`%%score (S A)`): "deben tratarse como si fueran partituras diferentes en
// el sentido por ejemplo de que para moverse de S a A hay que hacerlo con
// Ctrl down/up o incluso la selección Ctrl Shift down espacio". The keys
// went from one to the other already (SM65), and nothing on screen said so:
// the cursor kept its height, which on one staff is the same place, and a
// stretch chosen after it was the lower voice's with the cursor drawn on the
// upper one's note. That is what their question of the same day is read as
// here, "por qué la selección en SA solo dibuja las notas de abajo?": a
// stretch took the voice the cursor was in every time it was tried. abcjs
// draws the rests of two voices on a staff apart, the upper voice's high
// and the lower one's low.
const SHARED_SOURCE = ["X:1", "M:4/4", "L:1/4", "%%score (1 2)", "K:C", "V:1", "c d e z |", "V:2", "[EG] z G A |"].join("\n");
test("on a staff two voices share, the cursor taken to the other voice comes to its note, at the head nearest, and to its rest at the sign; a stretch chosen from there is that voice's, and the walk with a stretch kept lands the same way; a voice on a staff of its own is come to at the height kept, and so is an open end (SM106)", { skip }, async () => {
  const h = await open({ text: ["One staff, two voices.", "", "```abc", SHARED_SOURCE, "```", ""].join("\n"), scores: 1 });
  await pressMode(h.page);
  const stands = async () => [await trackOf(h.page), await placeText(h.page), (await cursor(h.page)).step];
  // The sign of a voice's rest, as it is drawn: the top and the bottom of it.
  const restOf = (voice) =>
    h.page.evaluate((v) => {
      const r = document.querySelector("#app .mdm-score svg g.abcjs-rest.abcjs-v" + v).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }, voice);
  const onSign = async (voice) => {
    const c = await cursor(h.page);
    const sign = await restOf(voice);
    return c.stepY > sign.top && c.stepY < sign.bottom;
  };
  assert.deepEqual(await stands(), [0, "c", 7]);
  // Down to the lower voice: onto its chord, at the head nearest the height
  // the cursor came from, and back onto the upper voice's note.
  await chord(h.page, ["Control"], "ArrowDown");
  assert.deepEqual(await stands(), [1, "[EG]", 4]);
  await chord(h.page, ["Control"], "ArrowUp");
  assert.deepEqual(await stands(), [0, "c", 7]);
  await toStep(h.page, 2);
  await chord(h.page, ["Control"], "ArrowDown");
  assert.deepEqual(await stands(), [1, "[EG]", 2]);
  // From a height that is no note's, the same: the note of the voice come to.
  await toStep(h.page, 12);
  await chord(h.page, ["Control"], "ArrowUp");
  assert.deepEqual(await stands(), [0, "c", 7]);
  // A rest is come to at its sign, the lower voice's under the notes of the
  // upper and the upper voice's over those of the lower.
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual(await stands(), [0, "d", 7]);
  assert.equal(await onSign(1), false);
  await chord(h.page, ["Control"], "ArrowDown");
  assert.deepEqual([(await stands()).slice(0, 2), await onSign(1)], [[1, "z"], true]);
  await press(h.page, "ArrowRight", 2);
  await chord(h.page, ["Control"], "ArrowUp");
  assert.deepEqual([(await stands()).slice(0, 2), await onSign(0)], [[0, "z"], true]);
  // A stretch chosen from the voice come to is that voice's.
  await chord(h.page, ["Control"], "ArrowDown");
  assert.deepEqual(await stands(), [1, "A", 5]);
  await chord(h.page, ["Shift"], "ArrowLeft");
  await chord(h.page, ["Shift"], "ArrowLeft");
  assert.deepEqual(await inked(h.page), ["v1 l0 m0 n2", "v1 l0 m0 n3"]);
  await h.page.keyboard.press("Escape");
  // With a stretch kept the walk lands the same way, the cursor drawn on
  // the note of the voice Space would pick.
  await chord(h.page, ["Control"], "ArrowUp");
  assert.deepEqual(await stands(), [0, "e", 9]);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await inked(h.page), ["v0 l0 m0 n2"]);
  await chord(h.page, ["Control", "Shift"], "ArrowDown");
  assert.deepEqual([await stands(), await cursorShown(h.page), await inked(h.page)], [[1, "G", 4], true, ["v0 l0 m0 n2"]]);
  await chord(h.page, ["Control", "Shift"], "Space");
  assert.deepEqual(await inked(h.page), ["v0 l0 m0 n2", "v1 l0 m0 n2"]);
  await chord(h.page, ["Control", "Shift"], "ArrowUp");
  assert.deepEqual([await stands(), await cursorShown(h.page)], [[0, "e", 9], true]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // Two voices on two staves: the height is kept from one staff to the
  // other, as it is from line to line (SM65).
  const d = await open({ text: DUET, scores: 1 });
  await pressMode(d.page);
  await toStep(d.page, 5);
  await chord(d.page, ["Control"], "ArrowDown");
  assert.deepEqual([await trackOf(d.page), (await cursor(d.page)).step], [1, 5]);
  await chord(d.page, ["Control"], "ArrowUp");
  assert.deepEqual([await trackOf(d.page), (await cursor(d.page)).step], [0, 5]);
  assert.deepEqual(d.errors, []);
  await d.close();

  // The open end of the other voice has no note to come to, nor a sign: the
  // height is kept there.
  const ended = ["X:1", "L:1/4", "%%score (1 2)", "K:C", "V:1", "c d e f", "V:2", "E F"].join("\n");
  const o = await open({ text: ["An open end.", "", "```abc", ended, "```", ""].join("\n"), scores: 1 });
  await pressMode(o.page);
  await press(o.page, "ArrowRight", 3);
  assert.deepEqual([await placeText(o.page), (await cursor(o.page)).step], ["f", 7]);
  await chord(o.page, ["Control"], "ArrowDown");
  assert.deepEqual([await trackOf(o.page), await placeText(o.page), (await cursor(o.page)).step], [1, "", 7]);
  assert.deepEqual(o.errors, []);
  await o.close();
});

test("Ctrl+Shift+Down and Ctrl+Shift+Up, with no stretch chosen, take the cursor to the line of staves below or above in its own voice, over the staves between, at the place nearest across; nowhere where there is no line, and they choose nothing (SM66)", { skip }, async () => {
  const h = await open({ text: DUET, scores: 1 });
  await pressMode(h.page);
  const stands = async () => [(await cursor(h.page)).from, await trackOf(h.page), await selection(h.page)];
  const upper = await placesAhead(h.page);
  await chord(h.page, ["Control"], "ArrowDown");
  await press(h.page, "ArrowLeft", 9);
  const lower = await placesAhead(h.page);
  // The lower voice, from the third quarter of its first line: down to its
  // own second line, over the upper voice's staff that lies between the
  // two, and no further, there being no third; and back up over it.
  await press(h.page, "ArrowLeft", 7);
  assert.deepEqual(await stands(), [DUET_SOURCE.indexOf("E, F,"), 1, null]);
  const down = nearestOn(DUET_SOURCE, lower, DUET_ROWS.lower[1], (await cursor(h.page)).x);
  await chord(h.page, ["Control", "Shift"], "ArrowDown");
  assert.deepEqual(await stands(), [down.from, 1, null], "the lower voice, a line down");
  await chord(h.page, ["Control", "Shift"], "ArrowDown");
  assert.deepEqual(await stands(), [down.from, 1, null], "past the last line");
  const up = nearestOn(DUET_SOURCE, lower, DUET_ROWS.lower[0], down.x);
  await chord(h.page, ["Control", "Shift"], "ArrowUp");
  assert.deepEqual(await stands(), [up.from, 1, null], "the lower voice, a line up");
  await chord(h.page, ["Control", "Shift"], "ArrowUp");
  assert.deepEqual(await stands(), [up.from, 1, null], "past the first line");
  // The upper voice the same, over the lower voice's staff.
  await chord(h.page, ["Control"], "ArrowUp");
  assert.equal(await trackOf(h.page), 0);
  const below = nearestOn(DUET_SOURCE, upper, DUET_ROWS.upper[1], (await cursor(h.page)).x);
  await chord(h.page, ["Control", "Shift"], "ArrowDown");
  assert.deepEqual(await stands(), [below.from, 0, null], "the upper voice, a line down");
  const above = nearestOn(DUET_SOURCE, upper, DUET_ROWS.upper[0], below.x);
  // A height on the staff is kept.
  await toStep(h.page, 5);
  await chord(h.page, ["Control", "Shift"], "ArrowUp");
  assert.deepEqual([await stands(), (await cursor(h.page)).step], [[above.from, 0, null], 5], "the upper voice, a line up");
  // With a stretch chosen the two keys are the stretch's, and walk the
  // voices it can be chosen over with the stretch kept (SM74): from here,
  // down to the lower voice of this line, and not a line down.
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Control", "Shift"], "ArrowDown");
  assert.equal(await trackOf(h.page), 1);
  assert.ok(await selection(h.page), "the stretch was let go");
  assert.equal(DUET_SOURCE.slice(0, (await cursor(h.page)).from + 1).split("\n").length - 1, DUET_ROWS.lower[0]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // A voice with no music on the line below goes nowhere (the owner's "si
  // no hay nadie, no hace nada"), while the voice over it on the same staff
  // goes down a line as ever.
  const a = await open({ text: ["A voice short of a line.", "", "```abc", SHORT_OF_A_LINE, "```", ""].join("\n"), scores: 1 });
  await pressMode(a.page);
  await chord(a.page, ["Control"], "ArrowDown");
  assert.deepEqual([await trackOf(a.page), await placeText(a.page)], [1, "E"]);
  await chord(a.page, ["Control", "Shift"], "ArrowDown");
  assert.deepEqual([await trackOf(a.page), await placeText(a.page)], [1, "E"]);
  await chord(a.page, ["Control"], "ArrowUp");
  await chord(a.page, ["Control", "Shift"], "ArrowDown");
  assert.equal(await trackOf(a.page), 0);
  assert.ok(["g", "a", "b", "c'"].includes(await placeText(a.page)), "the first voice's second line, and not " + (await placeText(a.page)));
  assert.deepEqual(a.errors, []);
  await a.close();
});

// The owner's calls of 2026-10-03, the day Enter was taken out to try the
// figures' keys alone: "vamos a retomar el enter pero solo servirá cuando
// hay una nota ya dibujada que fija la duración, por ejemplo, si sobre C se
// da enter en G, ese G sale con la duración de C", and after trying it, "si
// hay un silencio y se da enter, la nota debe salir con la duración del
// silencio". It is what no key of a figure says: the length of a dotted
// note, of one in a broken rhythm, or of the rest that stands there.
test("Enter puts a head on a note at the note's own length, a dotted one and one of a broken rhythm as well, and on a rest writes a note as long as the rest, which 0 gives back (SM68)", { skip }, async () => {
  const h = await open({ text: notesDoc("d3 z c>d z2 | z8 |]"), scores: 1 });
  await pressMode(h.page);
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step], ["d3", 8]);
  await toStep(h.page, 10);
  await h.page.keyboard.press("Enter");
  assert.equal(await music(h.page), "[df]3 z c>d z2 | z8 |]");
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step], ["[df]3", 10]);
  // On the rest it is the rest's length the note takes, an eighth, and not
  // the figure kept, which is the dotted quarter the cursor came from.
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["z", 0.375]);
  await h.page.keyboard.press("Enter");
  assert.equal(await music(h.page), "[df]3 f c>d z2 | z8 |]");
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step], ["f", 10]);
  assert.deepEqual(await notices(h.page), []);
  // The note is the last one written, so its length is the figure kept,
  // and 0 on it is the rest as it was.
  assert.equal(await kept(h.page), 0.125);
  await h.page.keyboard.press("0");
  assert.equal(await music(h.page), "[df]3 z c>d z2 | z8 |]");
  // A rest of a whole bar is a whole note, and one step of the history.
  await press(h.page, "ArrowRight", 4);
  assert.equal(await placeText(h.page), "z8");
  await h.page.keyboard.press("Enter");
  assert.equal(await music(h.page), "[df]3 z c>d z2 | f8 |]");
  assert.equal(await kept(h.page), 1);
  await chord(h.page, ["Control"], "z");
  assert.equal(await music(h.page), "[df]3 z c>d z2 | z8 |]");
  await press(h.page, "ArrowLeft", 3);
  // The long note of a broken rhythm and the short one, each as long as it
  // was.
  assert.equal(await placeText(h.page), "c>");
  await toStep(h.page, 9);
  await h.page.keyboard.press("Enter");
  await h.page.keyboard.press("ArrowRight");
  await toStep(h.page, 10);
  await h.page.keyboard.press("Enter");
  assert.equal(await music(h.page), "[df]3 z [ce]>[df] z2 | z8 |]");
  // A key held down is one head, and each head is a step of its own.
  await toStep(h.page, 12);
  await h.page.keyboard.down("Enter");
  await h.page.keyboard.down("Enter");
  await h.page.keyboard.up("Enter");
  assert.equal(await music(h.page), "[df]3 z [ce]>[dfa] z2 | z8 |]");
  // Three heads, and before them the note written on the rest, the rest
  // put back on it, and the first head.
  for (let i = 0; i < 6; i++) await chord(h.page, ["Control"], "z");
  assert.equal(await music(h.page), "d3 z c>d z2 | z8 |]");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's report of 2026-10-03: "Cuando estoy en modo score navigation y
// hago Alt Tab para cambiar de ventana, al regresar las flechas de teclado
// no me sirven". Measured in VS Code 1.133.0 with another window raised over
// it while Alt was down: back in the mode the first arrow walked the cursor,
// its release took the focus to the File menu, and the arrows after it
// walked the menus. The workbench had seen Alt go down and nothing since, so
// the first release it was sent read as Alt's own, let go cleanly. Raised
// with no Alt, the other window left the arrows as they were. The listener
// here stands in for the preload's, as in SM67.
test("after an Alt that went down and never came up, as Alt+Tab leaves it, the first key the mode takes goes on to VS Code with no name, and the keys after it stop at the mode again (SM69)", { skip }, async () => {
  const h = await open({ text: notesDoc("C2 D2 E2 F2 | G8 |]"), scores: 1 });
  await h.page.evaluate(() => {
    window.__host = [];
    const hear = (e) => window.__host.push([e.type === "keydown" ? "down" : "up", e.key, e.code, e.keyCode, e.which, e.altKey, e.isTrusted, e.defaultPrevented].join(" "));
    window.addEventListener("keydown", hear);
    window.addEventListener("keyup", hear);
  });
  const host = () => h.page.evaluate(() => window.__host.splice(0));
  await pressMode(h.page);
  await host();
  // Alt down and no release: sent past the keyboard the test holds, which
  // would put Alt on every key after it.
  const cdp = await h.page.target().createCDPSession();
  const altDown = () => cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 1 });
  await altDown();
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "D2");
  assert.deepEqual(await host(), [
    "down Alt AltLeft 18 18 true true false",
    "down Unidentified  0 0 false true true",
    "up ArrowRight ArrowRight 39 39 false true false",
  ]);
  // Told once. The next arrow stops at the mode, as every key of its own.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "E2");
  assert.deepEqual(await host(), ["up ArrowRight ArrowRight 39 39 false true false"]);
  // The same for a key that writes.
  await toStep(h.page, 2);
  await host();
  await altDown();
  await h.page.keyboard.press("4");
  assert.equal(await music(h.page), "C2 D2 E F2 | G8 |]");
  assert.deepEqual((await host()).slice(1), ["down Unidentified  0 0 false true true", "up 4 Digit4 52 52 false true false"]);
  // An Alt that did come up owes nothing.
  await h.page.keyboard.down("Alt");
  await h.page.keyboard.up("Alt");
  await host();
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual(await host(), ["up ArrowRight ArrowRight 39 39 false true false"]);
  // Nor one followed by a key that went on to VS Code by itself, which is
  // what told it.
  await altDown();
  await h.page.keyboard.press("x");
  await host();
  await h.page.keyboard.press("ArrowLeft");
  assert.deepEqual(await host(), ["up ArrowLeft ArrowLeft 37 37 false true false"]);
  // Escape with a stretch chosen, and Space, are the mode's keys as well.
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.ok(await selection(h.page));
  await host();
  await altDown();
  await h.page.keyboard.press("Escape");
  assert.equal(await selection(h.page), null);
  assert.deepEqual((await host()).slice(1), ["down Unidentified  0 0 false true true", "up Escape Escape 27 27 false true false"]);
  await altDown();
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.deepEqual((await host()).slice(1), ["down Unidentified  0 0 false true true", "up   Space 32 32 false true false"]);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  assert.deepEqual(await host(), ["up   Space 32 32 false true false"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The same report again, after the answer above: "estoy dando alt tab y al
// regresar sigo sin poder seguir usando ->". What SM69 holds is the window
// come back with nothing sent before the arrow, which is Tab let go before
// Alt. A hand lets Alt go first as often, and then the release of Tab is
// what the window is sent first: measured in VS Code 1.133.0 under kwin_x11
// 5.27.11 with the switcher's own Alt+Tab, it reached the workbench, the
// focus went to the menu bar and three arrows left the cursor where it was.
// It is kept from the host for the whole page (watchAltPresses, and its own
// test in webview-editing.test.js); this is the mode after it.
test("back from another window with Alt let go before Tab, the release of Tab that comes in alone is kept from VS Code, and the arrows walk the cursor, the first going on with no name (SM76)", { skip }, async () => {
  const h = await open({ text: notesDoc("C2 D2 E2 F2 | G8 |]"), scores: 1 });
  await h.page.evaluate(() => {
    window.__host = [];
    const hear = (e) => window.__host.push([e.type === "keydown" ? "down" : "up", e.key, e.code, e.keyCode, e.which, e.altKey, e.isTrusted, e.defaultPrevented].join(" "));
    window.addEventListener("keydown", hear);
    window.addEventListener("keyup", hear);
  });
  const host = () => h.page.evaluate(() => window.__host.splice(0));
  await pressMode(h.page);
  await host();
  const cdp = await h.page.target().createCDPSession();
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 1 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  assert.deepEqual(await host(), ["down Alt AltLeft 18 18 true true false"]);
  await press(h.page, "ArrowRight", 2);
  assert.equal(await placeText(h.page), "E2");
  assert.deepEqual(await host(), [
    "down Unidentified  0 0 false true true",
    "up ArrowRight ArrowRight 39 39 false true false",
    "up ArrowRight ArrowRight 39 39 false true false",
  ]);
  // An Alt used with a click leaves the workbench believing it down as
  // well, its release being held back: the arrow after it owes the same,
  // and its own release goes on once the press has.
  const hs = await heads(h.page, 0);
  await h.page.keyboard.down("Alt");
  await h.page.mouse.click(hs[0].x, hs[0].y);
  await h.page.keyboard.up("Alt");
  assert.deepEqual(await host(), ["down Alt AltLeft 18 18 true true false"]);
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "D2");
  assert.deepEqual(await host(), ["down Unidentified  0 0 false true true", "up ArrowRight ArrowRight 39 39 false true false"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's pictures of 2026-10-03: the cursor three ledger lines over a
// bare staff, cut off by the drawing, and the same place with the note
// written, the staff a little lower and all of it in sight. "Quiero que
// cuando el cuadradito llegue a esa altura (arriba o abajo) el pentagrama
// ajusta su desplazamiento vertical, aunque no se ponga la nota, y si no se
// pone la nota y vuelvo a bajar el pentagrama vuelve a su posición original."
test("past the drawing's ink the cursor is given the room a note there would have: the staff moves as it will for the note, stays as the note is written, and comes back with the cursor (SM70)", { skip }, async () => {
  const h = await open({ text: notesDoc("C2 z2 z4 | z8 |]") + "\nAfter the score.\n", scores: 1 });
  await pressMode(h.page);
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "z2");
  const look = async () => {
    // CodeMirror reads its lines again a frame after it is asked to.
    await sleep(60);
    return h.page.evaluate(() => {
      const svg = document.querySelector("#app .mdm-score code.language-abc svg");
      const r = svg.getBoundingClientRect();
      const beat = svg.querySelector(".mdm-score-cursor__beat").getBoundingClientRect();
      const ys = Array.from(svg.querySelector("g.abcjs-staff").children).map((l) => {
        const b = l.getBoundingClientRect();
        return (b.top + b.bottom) / 2;
      });
      const v = window.__mdm.view;
      return {
        box: svg.getAttribute("viewBox"),
        height: Number(svg.getAttribute("height")),
        room: svg.hasAttribute("data-mdm-room"),
        // The top line under the drawing's top edge, and its bottom edge
        // under the bottom line.
        over: Math.min(...ys) - r.top,
        under: r.bottom - Math.max(...ys),
        space: (Math.max(...ys) - Math.min(...ys)) / 8,
        cut: Math.max(0, r.top - beat.top, beat.bottom - r.bottom),
        // Where CodeMirror has the line after the score.
        after: v.lineBlockAt(v.state.doc.length).top,
      };
    });
  };
  const near = (a, b, slack) => Math.abs(a - b) < (slack || 0.05);
  const was = await look();
  assert.deepEqual([was.room, was.cut], [false, 0]);
  // The pair at the line's end, shown by the pointer, which then stays
  // where it is: how far its middle is from the staff's.
  const hs = await heads(h.page, 0);
  await pointAt(h.page, hs[0]);
  const level = async () => {
    const pair = await ends(h.page, 0);
    const st = (await staves(h.page, 0))[0];
    return (pair[0].top + pair[1].bottom) / 2 - (st.top + st.bottom) / 2;
  };
  assert.ok(Math.abs(await level()) < 2);
  // Two steps over the top line a note still stands inside the drawing.
  await toStep(h.page, 12);
  assert.deepEqual([(await look()).box, (await look()).room], [was.box, false]);
  // Three ledger lines up: the middle of the head a note would have is
  // three steps and the padding under the drawing's top edge, 13.625, where
  // abcjs draws the highest note to a hair, so the staff is that much lower
  // and the cursor is whole.
  await toStep(h.page, 16);
  const up = await look();
  assert.deepEqual([up.room, up.cut], [true, 0]);
  assert.ok(near(up.over - 6 * up.space, 13.625, 0.01), "the cursor's step is " + (up.over - 6 * up.space) + " under the top edge");
  // The chrome went down with the staff.
  assert.ok(Math.abs(await level()) < 2, "the pair is " + (await level()) + " off its staff");
  assert.ok(up.over - was.over > 12, "the staff moved " + (up.over - was.over));
  assert.ok(near(up.under, was.under) && near(up.height - was.height, up.over - was.over));
  // CodeMirror was told: the line after the score is that much lower.
  assert.ok(near(up.after - was.after, up.over - was.over, 0.6), "the line after it moved " + (up.after - was.after));
  // The note written there: the staff stays where the cursor had put it,
  // in a box that is the drawing's own now.
  await h.page.keyboard.press("3");
  assert.equal(await music(h.page), "C2 e'2 z4 | z8 |]");
  const written = await look();
  assert.deepEqual([written.room, written.cut], [false, 0]);
  assert.ok(near(written.over, up.over) && near(written.height, up.height), "the staff moved " + (written.over - up.over) + " as the note was written");
  // Taken back, the room is the cursor's again, and coming down it gives
  // the drawing its own box back.
  await chord(h.page, ["Control"], "z");
  const back = await look();
  assert.deepEqual([back.room, near(back.over, up.over)], [true, true]);
  await toStep(h.page, 13);
  const less = await look();
  assert.ok(near(less.over - 3 * less.space, 13.625, 0.01) && less.over < up.over - 10);
  await toStep(h.page, 12);
  const down = await look();
  assert.deepEqual([down.box, down.height, down.room], [was.box, was.height, false]);
  assert.ok(near(down.after, was.after, 0.6));
  // Under the staff the same: the head's middle 6.05 over the bottom edge,
  // the staff where it was, and the note written moves nothing.
  await toStep(h.page, -4);
  const low = await look();
  assert.deepEqual([low.room, low.cut], [true, 0]);
  assert.ok(near(low.over, was.over));
  assert.ok(near(low.under - 6 * low.space, 6.05, 0.01), "the cursor's step is " + (low.under - 6 * low.space) + " over the bottom edge");
  await h.page.keyboard.press("3");
  assert.equal(await music(h.page), "C2 F,2 z4 | z8 |]");
  const under = await look();
  assert.deepEqual([under.room, near(under.height, low.height), near(under.over, low.over)], [false, true, true]);
  await chord(h.page, ["Control"], "z");
  // Left with the room made, the mode gives the drawing its box back.
  assert.equal((await look()).room, true);
  await pressMode(h.page);
  const left = await h.page.evaluate(() => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    return [svg.getAttribute("viewBox"), Number(svg.getAttribute("height")), svg.hasAttribute("data-mdm-room")];
  });
  assert.deepEqual(left, [was.box, was.height, false]);
  assert.deepEqual(h.errors, []);
  await h.close();
  // Two scores: the room goes with the cursor from one to the other.
  const two = ["```abc", "X:1", "L:1/8", "K:C", "C2 D2 |]", "```", "", "```abc", "X:2", "L:1/8", "K:C", "E2 F2 |]", "```", ""].join("\n");
  const g = await open({ text: "Two.\n\n" + two, scores: 2 });
  await pressMode(g.page);
  const rooms = () => g.page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-score code.language-abc svg")).map((svg) => svg.hasAttribute("data-mdm-room")));
  await toStep(g.page, 16);
  assert.deepEqual(await rooms(), [true, false]);
  const other = await heads(g.page, 1);
  await g.page.mouse.click(other[0].x, other[0].y);
  assert.deepEqual(await rooms(), [false, false]);
  await toStep(g.page, -4);
  assert.deepEqual(await rooms(), [false, true]);
  assert.deepEqual(g.errors, []);
  await g.close();
});

// The owner's ask of 2026-10-03, with a picture of three places and a staff
// that ends with no barline: "En compases que no cierran como el de la
// figura, quiero que cuando el cuadradito esté en la última nota y se dé
// click hacia el lado derecho, el cuadradito camine y entonces uno pueda
// moverse arriba o abajo y seleccionar la nota que quiera".
test("a voice no barline closes has one place more, past its last note: the cursor walks onto it, on the staff's lines drawn on in grey, and a note written there is put in after the last (SM71)", { skip }, async () => {
  const h = await open({ text: notesDoc("C2 D2 E2"), scores: 1 });
  await pressMode(h.page);
  await press(h.page, "ArrowRight", 2);
  assert.equal(await placeText(h.page), "E2");
  const staffEnd = (await staves(h.page, 0))[0].right;
  await h.page.keyboard.press("ArrowRight");
  // No place of the text: where one would be written.
  const end = await cursor(h.page);
  assert.equal(await placeText(h.page), "");
  assert.equal(end.from, NOTES_SOURCE.indexOf("z8 | z8 |]") + "C2 D2 E2".length);
  // The middle of the head a note there will have: half a head past the end
  // the staff has now.
  assert.ok(Math.abs(end.x - (staffEnd + 4.9)) < 0.3, "the end stands " + (end.x - staffEnd) + " past the staff");
  // And no further.
  await h.page.keyboard.press("ArrowRight");
  assert.equal((await cursor(h.page)).x, end.x);
  // The five lines of the staff go on under it, from where the staff ends
  // to where a ledger line would, in the ledger lines' grey.
  const stubs = () =>
    h.page.evaluate(() => {
      const path = document.querySelector("#app .mdm-score-cursor .mdm-score-cursor__ledger");
      const d = path.getAttribute("d") || "";
      const r = path.getBoundingClientRect();
      const ys = Array.from(path.ownerSVGElement.querySelector("g.abcjs-staff").children).map((l) => {
        const b = l.getBoundingClientRect();
        return (b.top + b.bottom) / 2;
      });
      return { count: (d.match(/M/g) || []).length, left: r.left, right: r.right, top: r.top - Math.min(...ys), bottom: r.bottom - Math.max(...ys), fill: getComputedStyle(path).fill };
    });
  const drawn = await stubs();
  assert.equal(drawn.count, 5);
  assert.ok(Math.abs(drawn.left - staffEnd) < 0.3 && Math.abs(drawn.right - (end.x + 6.9)) < 0.3, "the lines run from " + (drawn.left - staffEnd) + " to " + (drawn.right - end.x));
  assert.ok(Math.abs(drawn.top + 0.35) < 0.2 && Math.abs(drawn.bottom - 0.35) < 0.2, "they stand " + drawn.top + " and " + drawn.bottom + " off the staff's own");
  assert.equal(drawn.fill, "rgb(163, 163, 163)");
  // Off the staff, its ledger lines as well.
  await toStep(h.page, 12);
  assert.equal((await stubs()).count, 6);
  // Up and down choose the note; Enter and Delete have nothing to act on.
  await toStep(h.page, 4);
  const sent = (await edits(h.page)).length;
  for (const key of ["Enter", "Delete", "Backspace"]) await h.page.keyboard.press(key);
  assert.equal((await edits(h.page)).length, sent);
  assert.deepEqual(await notices(h.page), []);
  // A figure's key writes the note after the last, and the cursor is on it
  // where it stood: the note is drawn where the end was.
  await h.page.keyboard.press("3");
  assert.equal(await music(h.page), "C2 D2 E2 G2");
  const on = await cursor(h.page);
  assert.deepEqual([await placeText(h.page), on.step], ["G2", 4]);
  assert.ok(Math.abs(on.x - end.x) < 0.3, "the cursor moved " + (on.x - end.x) + " across as the note was written");
  // On to the end again: a rest with 0, and a note with Ctrl or Alt and a
  // figure, which have one side to put it in on.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "");
  await h.page.keyboard.press("0");
  assert.equal(await music(h.page), "C2 D2 E2 G2 z2");
  assert.equal(await placeText(h.page), "z2");
  await h.page.keyboard.press("ArrowRight");
  await chord(h.page, ["Alt"], "4");
  assert.equal(await music(h.page), "C2 D2 E2 G2 z2 G");
  assert.equal(await placeText(h.page), "G");
  // Ctrl puts a place in before the cursor's, and the end has nothing
  // after it to be before: the A goes after the G.
  await h.page.keyboard.press("ArrowRight");
  await h.page.keyboard.press("ArrowUp");
  await chord(h.page, ["Control"], "4");
  assert.equal(await music(h.page), "C2 D2 E2 G2 z2 GA");
  assert.equal(await placeText(h.page), "A");
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "");
  // Ctrl+Right there closes the bar and adds one, whose rest ends the voice
  // open again.
  await chord(h.page, ["Control"], "ArrowRight");
  assert.equal(await music(h.page), "C2 D2 E2 G2 z2 GA | z8");
  assert.equal(await placeText(h.page), "z8");
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "");
  // Each a step of its own for Ctrl+Z.
  for (let i = 0; i < 5; i++) await chord(h.page, ["Control"], "z");
  assert.equal(await music(h.page), "C2 D2 E2");
  // A click past the last note is a click on the end, and one on the note
  // on the note.
  const hs = await heads(h.page, 0);
  const st = (await staves(h.page, 0))[0];
  await h.page.mouse.click(st.right + 3, hs[2].y);
  assert.equal(await placeText(h.page), "");
  await h.page.mouse.click(hs[2].x, hs[2].y);
  assert.equal(await placeText(h.page), "E2");
  assert.deepEqual(h.errors, []);
  await h.close();
  // A barline after the last note closes the voice: the cursor stops on the
  // note. In a duet each voice ends by itself.
  const duet = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c G A F |", "V:2 clef=bass", "C, D, E, F,"].join("\n");
  const g = await open({ text: ["Two voices.", "", "```abc", duet, "```", ""].join("\n"), scores: 1 });
  await pressMode(g.page);
  await press(g.page, "ArrowRight", 6);
  assert.equal(await placeText(g.page), "F");
  await chord(g.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(g.page), "F,");
  await g.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(g.page), "");
  await toStep(g.page, 6);
  await g.page.keyboard.press("3");
  assert.equal(await staged(g.page), duet + " D,");
  assert.deepEqual(g.errors, []);
  await g.close();
  // A rest nobody sees holds its time before the end, though the cursor
  // has no place on it: the note goes after it.
  const unseen = await open({ text: notesDoc("C2 D2 x2"), scores: 1 });
  await pressMode(unseen.page);
  await press(unseen.page, "ArrowRight", 2);
  assert.equal(await placeText(unseen.page), "");
  await toStep(unseen.page, 4);
  await unseen.page.keyboard.press("3");
  assert.equal(await music(unseen.page), "C2 D2 x2 G2");
  assert.deepEqual(unseen.errors, []);
  await unseen.close();
  // A line that fills the drawing from side to side ends at its right edge:
  // the drawing is that much wider while the cursor stands on the end, and
  // no wider after.
  const long = await open({ text: notesDoc(new Array(13).join("CDEF GABc ").trim()), scores: 1 });
  await pressMode(long.page);
  const wide = () =>
    long.page.evaluate(() => {
      const svg = document.querySelector("#app .mdm-score code.language-abc svg");
      const r = svg.getBoundingClientRect();
      const beat = svg.querySelector(".mdm-score-cursor__beat").getBoundingClientRect();
      return { width: Number(svg.getAttribute("width")), cut: Math.max(0, beat.right - r.right), staff: svg.querySelector("g.abcjs-staff").getBoundingClientRect().right - r.left };
    });
  const narrow = await wide();
  assert.ok(narrow.staff > narrow.width - 1, "the staff ends at " + narrow.staff + " of " + narrow.width);
  await press(long.page, "ArrowRight", 96);
  assert.equal(await placeText(long.page), "");
  const grown = await wide();
  assert.deepEqual([grown.cut, grown.width > narrow.width + 10], [0, true]);
  await long.page.keyboard.press("ArrowLeft");
  assert.equal((await wide()).width, narrow.width);
  assert.deepEqual(long.errors, []);
  await long.close();
});

// The owner's picture of 2026-10-03, the day the open end came in: the
// cursor at the end of a staff with no barline, and the two buttons of the
// line's end on top of it ("el compás sin barra al final funciona bien pero
// solapa con los botones de mover el final del compás"). The pair stands
// five pixels past the staff's end, which is where the end's column is.
test("the pair at a line's end stands past the cursor while the cursor is at the line's open end, comes back as it leaves, and is put away where the box has no room past the cursor (SM77)", { skip }, async () => {
  const h = await open({ text: notesDoc("C2 D2 E2"), scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await pointAt(h.page, hs[0]);
  const staffEnd = (await staves(h.page, 0))[0].right;
  const column = (page) =>
    page.evaluate(() => {
      const r = document.querySelector("#app .mdm-score-cursor .mdm-score-cursor__beat").getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
  const pairAt = async (page) => {
    const pair = await ends(page, 0);
    assert.deepEqual(pair.map((b) => [b.way, b.shown]), [["later", true], ["earlier", true]]);
    assert.equal(pair[0].left, pair[1].left);
    return pair[0].left;
  };
  assert.ok(Math.abs((await pairAt(h.page)) - (staffEnd + 5)) < 0.6, "the pair stands " + ((await pairAt(h.page)) - staffEnd) + " past the staff");
  // On the last note it stays where it was: the note is on the staff.
  await press(h.page, "ArrowRight", 2);
  assert.equal(await placeText(h.page), "E2");
  assert.ok(Math.abs((await pairAt(h.page)) - (staffEnd + 5)) < 0.6);
  // At the open end the cursor's column runs past the staff's end, and the
  // pair stands past the column, as far from it as from a staff's end.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "");
  const col = await column(h.page);
  assert.ok(col.left < staffEnd + 5 && col.right > staffEnd + 5, "the column, " + col.left + " to " + col.right + ", is not where the pair stood");
  assert.ok(Math.abs((await pairAt(h.page)) - (col.right + 5)) < 0.6, "the pair stands " + ((await pairAt(h.page)) - col.right) + " past the cursor");
  // Up and down the pair stays put, and back on the note it is at the
  // staff's end again.
  await press(h.page, "ArrowUp", 3);
  assert.ok(Math.abs((await pairAt(h.page)) - (col.right + 5)) < 0.6);
  await h.page.keyboard.press("ArrowLeft");
  assert.ok(Math.abs((await pairAt(h.page)) - (staffEnd + 5)) < 0.6);
  // Put on the end by a click, and taken off it by one.
  const st = (await staves(h.page, 0))[0];
  await h.page.mouse.click(st.right + 3, hs[2].y);
  assert.equal(await placeText(h.page), "");
  await pointAt(h.page, hs[0]);
  assert.ok(Math.abs((await pairAt(h.page)) - (col.right + 5)) < 0.6);
  await h.page.mouse.click(hs[1].x, hs[1].y);
  await pointAt(h.page, hs[0]);
  assert.ok(Math.abs((await pairAt(h.page)) - (staffEnd + 5)) < 0.6);
  // A note written at the end closes nothing: the cursor is on the note,
  // and the pair at the end of the staff as it is now.
  await h.page.keyboard.press("ArrowRight");
  await h.page.keyboard.press("ArrowRight");
  await h.page.keyboard.press("3");
  await pointAt(h.page, hs[0]);
  const longer = (await staves(h.page, 0))[0].right;
  assert.ok(longer > staffEnd + 10, "the staff did not grow with the note");
  assert.ok(Math.abs((await pairAt(h.page)) - (longer + 5)) < 0.6);
  assert.deepEqual(h.errors, []);
  await h.close();

  // Of two lines, the one the cursor is at the open end of: the pair of the
  // line above stays at the end of its own staff.
  const two = await open({ text: notesDoc("C2 D2 E2 F2 | G2 A2 B2 c2 |\nd2 e2 f2"), scores: 1 });
  await pressMode(two.page);
  await pointAt(two.page, (await heads(two.page, 0))[0]);
  await press(two.page, "ArrowRight", 11);
  assert.equal(await placeText(two.page), "");
  await pointAt(two.page, (await heads(two.page, 0))[0]);
  const lineEnds = (await staves(two.page, 0)).map((st) => st.right);
  const beat = await column(two.page);
  const pairs = (await ends(two.page, 0)).filter((b) => b.way === "later").map((b) => [b.system, Math.round(b.left)]);
  assert.deepEqual(pairs, [[0, Math.round(lineEnds[0] + 5)], [1, Math.round(beat.right + 5)]]);
  assert.ok(beat.right > lineEnds[1] + 5, "the cursor is not past the end of the second line");
  assert.deepEqual(two.errors, []);
  await two.close();

  // A line that fills the box from side to side, scrolled to its end: there
  // is no room past the cursor, and a pair there would stand on it. It is
  // put away for as long as the cursor is at the end.
  const long = await open({ text: notesDoc(new Array(13).join("CDEF GABc ").trim()), scores: 1 });
  await pressMode(long.page);
  await pointAt(long.page, (await heads(long.page, 0))[0]);
  await press(long.page, "ArrowRight", 96);
  assert.equal(await placeText(long.page), "");
  await pointAt(long.page, (await heads(long.page, 0)).pop());
  const shown = () =>
    long.page.evaluate(() => {
      const block = document.querySelector("#app .mdm-score");
      const code = block.querySelector("code.language-abc").getBoundingClientRect();
      const pair = block.querySelector(".mdm-score-edit--shown .mdm-score-end");
      const beat = block.querySelector(".mdm-score-cursor__beat").getBoundingClientRect();
      const r = pair ? pair.getBoundingClientRect() : null;
      return { layer: !!pair, pair: !!r && r.width > 0, room: code.right - beat.right };
    });
  const there = await shown();
  assert.deepEqual([there.layer, there.pair], [true, false]);
  assert.ok(there.room < 25, "there was room for the pair: " + there.room);
  await long.page.keyboard.press("ArrowLeft");
  await pointAt(long.page, (await heads(long.page, 0)).pop());
  assert.equal((await shown()).pair, true);
  assert.deepEqual(long.errors, []);
  await long.close();
});

// Space at the open end: there is no music after it, so the tune is heard
// from the voice's last place, and the cursor comes back to the end.
test("Space at the open end plays from the last place of the voice, and the cursor comes back to the end (SM72)", { skip }, async () => {
  const open_ = ["X:1", "M:2/4", "L:1/8", "Q:1/4=200", "K:C", "CDEF"].join("\n");
  const h = await open({ text: ["Short.", "", "```abc", open_, "```", ""].join("\n"), scores: 1 });
  await listenSources(h.page);
  await pressMode(h.page);
  await press(h.page, "ArrowRight", 4);
  assert.equal(await placeText(h.page), "");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  // The F is the fourth eighth at a quarter of 200: 0.45 s in.
  assert.ok(Math.abs((await lastStart(h.page)) - 0.45) < 0.03, "the sound started at " + (await lastStart(h.page)));
  await untilSounding(h.page, false);
  await sleep(100);
  assert.equal(await placeText(h.page), "");
  assert.equal(await cursorShown(h.page), true);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's keys of 2026-10-03 for a stretch over more than one voice:
// "Shift apretado + -> debe seleccionar el current v. Ctrl Shift apretado +
// -> debe seleccionar todas las v. Ctrl Shift Alt apretado down debe ir
// pasando por los v y se seleccionan con espacio, luego al soltar alt y
// dejar el control shift puede moverse uno hacia los lados. Al final uno
// puede hacer control C y se copia al portapapeles."
// And their change of 2026-10-06, which took Alt out of them: "Ctrl Shift ->
// -> [down] Espacio ->: seleccionó dos veces a la derecha, quitó el
// pentagrama del medio, y luego siguió seleccionando a la derecha, es decir,
// que realmente no hace falta Alt". The walk and its Space are Ctrl+Shift's
// while a stretch is chosen; with none chosen, Ctrl+Shift with Up and Down
// is the line above or below (SM66), their other ask of that day.
const TRIO_SOURCE = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | g a b c' |", "V:2", "E F G A | B c d e |", "V:3 clef=bass", "C,4 | G,2 C,2 |"].join("\n");
const TRIO = ["Three voices.", "", "```abc", TRIO_SOURCE, "```", ""].join("\n");
// The stretch as the model holds it, and the staves its bands lie over, by
// their numbers from the top.
const stretch = async (page) => {
  const model = await page.evaluate(() => window.__mdm.scoreCursor);
  const sel = await selection(page);
  const st = await staves(page, 0);
  const over = (band) => st.map((staff, i) => (band.top <= staff.top && band.bottom >= staff.bottom ? i : -1)).filter((i) => i >= 0);
  return { voices: model.voices === undefined ? null : model.voices, anchor: model.anchor, stop: model.stop, track: model.track, bands: sel ? sel.bands.map(over) : null };
};
const copied = (page) => page.evaluate(() => window.__copied.splice(0));
// The notes and rests that wear the ink of a stretch, as abcjs names what it
// drew: the voice, the line, the bar of the line and the note of the bar.
// What else wears it with them, a barline that would go, an arc, is read in
// SM84 and SM100.
const inked = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("#app .mdm-score svg g.abcjs-note.mdm-score-picked, #app .mdm-score svg g.abcjs-rest.mdm-score-picked"))
      .map((el) => {
        const cls = " " + el.getAttribute("class") + " ";
        const n = (k) => (new RegExp(" abcjs-" + k + "(\\d+) ").exec(cls) || [])[1];
        return "v" + n("v") + " l" + n("l") + " m" + n("m") + " n" + n("n");
      })
      .sort()
  );

test("Shift with Left and Right chooses the cursor's place and draws the stretch out from it in the cursor's voice, and Ctrl+Shift over every voice; Ctrl+C copies what it takes in, each voice under its V: (SM73)", { skip }, async () => {
  const h = await open({ text: TRIO, scores: 1, clipboard: true });
  await pressMode(h.page);
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "d");
  // With no stretch, the place the cursor stands on.
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["d"]);
  // The score says so with a pulse of its wash, and no word (SM91).
  assert.deepEqual(await notices(h.page), []);
  // Shift: the cursor's voice alone, a band over its staff and no other.
  // The first press chooses the place the cursor stands on and goes
  // nowhere, and each one after it takes one place more (SM85).
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await stretch(h.page), { voices: null, anchor: 1, stop: 1, track: 0, bands: [[0]] });
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await stretch(h.page), { voices: null, anchor: 1, stop: 3, track: 0, bands: [[0]] });
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["d e f"]);
  // Ctrl+Shift: every voice, one band across the three staves, and what
  // each voice sounds while the stretch does: the whole note of the third
  // began before it and sounds under its d, e and f (the owner's call of
  // 2026-10-06, SM102; until then it was left out for beginning before),
  // and its half begins with the g.
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual(await stretch(h.page), { voices: "all", anchor: 1, stop: 4, track: 0, bands: [[0, 1, 2]] });
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:1\nd e f | g\nV:2\nF G A | B\nV:3\nC,4 | G,2"]);
  // Shift alone again makes it the cursor's voice's, and Ctrl+Shift back
  // the other way every voice's.
  await chord(h.page, ["Shift"], "ArrowLeft");
  assert.deepEqual(await stretch(h.page), { voices: null, anchor: 1, stop: 3, track: 0, bands: [[0]] });
  await chord(h.page, ["Control", "Shift"], "ArrowLeft");
  assert.deepEqual(await stretch(h.page), { voices: "all", anchor: 1, stop: 2, track: 0, bands: [[0, 1, 2]] });
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:1\nd e\nV:2\nF G\nV:3\nC,4"]);
  // Up and down with Shift leave the stretch as it is; Escape lets it go.
  await chord(h.page, ["Shift"], "ArrowUp");
  assert.deepEqual(await stretch(h.page), { voices: "all", anchor: 1, stop: 2, track: 0, bands: [[0, 1, 2]] });
  await h.page.keyboard.press("Escape");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).bands], [null, null]);
  // From the lowest voice: its whole note takes in every note of the bar
  // above it, and the band runs as far as they do.
  await chord(h.page, ["Control"], "ArrowDown");
  await chord(h.page, ["Control"], "ArrowDown");
  await press(h.page, "ArrowLeft", 3);
  assert.equal(await placeText(h.page), "C,4");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual(await stretch(h.page), { voices: "all", anchor: 0, stop: 0, track: 2, bands: [[0, 1, 2]] });
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:1\nc d e f\nV:2\nE F G A\nV:3\nC,4"]);
  // Drawn out and back onto its anchor it is that one place again, and not
  // a stretch of nothing as it was until one place could be chosen.
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await chord(h.page, ["Control", "Shift"], "ArrowLeft");
  assert.deepEqual(await stretch(h.page), { voices: "all", anchor: 0, stop: 0, track: 2, bands: [[0, 1, 2]] });
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:1\nc d e f | g a\nV:2\nE F G A | B c\nV:3\nC,4 | G,2"]);
  const hs = await heads(h.page, 0);
  const wide = (await selection(h.page)).bands[0];
  const xs = hs.map((p) => p.x).sort((a, b) => a - b);
  assert.ok(wide.left < xs[0] && wide.right > xs[0] + 0.7 * (xs[xs.length - 1] - xs[0]) && wide.right < xs[xs.length - 1] - 20, "the band runs from " + wide.left + " to " + wide.right);
  assert.deepEqual(h.errors, []);
  await h.close();
  // A stretch that ends with its line takes in what the other voice has to
  // the end of that line, and nothing of the line after.
  const d = await open({ text: DUET, scores: 1, clipboard: true });
  await pressMode(d.page);
  await press(d.page, "ArrowRight", 4);
  for (let i = 0; i < 4; i++) await chord(d.page, ["Control", "Shift"], "ArrowRight");
  await chord(d.page, ["Control"], "c");
  assert.deepEqual(await copied(d.page), ["V:1\nG E F D\nV:2\nG,4"]);
  // On over the line's end: each voice line by line.
  await chord(d.page, ["Control", "Shift"], "ArrowRight");
  await chord(d.page, ["Control"], "c");
  assert.deepEqual(await copied(d.page), ["V:1\nG E F D\ne\nV:2\nG,4\nA,"]);
  assert.deepEqual(d.errors, []);
  await d.close();
  // A stretch over two lines is copied line by line, with what is written
  // between its places and nothing after its last.
  const lines = ["X:1", "M:4/4", "L:1/8", "K:C", '"Am"!f!(c2 d2) (3efg z2 |', "G2 A2 B2 c2 |]"].join("\n");
  const g = await open({ text: ["Two lines.", "", "```abc", lines, "```", ""].join("\n"), scores: 1, clipboard: true });
  await pressMode(g.page);
  for (let i = 0; i < 8; i++) await chord(g.page, ["Shift"], "ArrowRight");
  await chord(g.page, ["Control"], "c");
  assert.deepEqual(await copied(g.page), ['"Am"!f!(c2 d2) (3efg z2 |\nG2 A2'.replace("z2 |\n", "z2\n")]);
  assert.deepEqual(g.errors, []);
  await g.close();
});

test("with a stretch chosen, Ctrl+Shift with Up and Down walks the voices with the stretch kept, Space under them picks the cursor's voice or lets it go, and Left and Right draw the stretch out over the ones picked; with Alt held as well none of them is the mode's (SM74)", { skip }, async () => {
  const h = await open({ text: TRIO, scores: 1, clipboard: true });
  await pressMode(h.page);
  await press(h.page, "ArrowRight", 4);
  assert.equal(await placeText(h.page), "g");
  const walk = ["Control", "Shift"];
  // With nothing chosen there is nothing to keep, and the two keys are the
  // line's (SM66): on a score of one line they go nowhere. The voice below
  // is Ctrl+Down's (SM65), at the place that sounds with the g.
  await chord(h.page, walk, "ArrowDown");
  assert.deepEqual([await placeText(h.page), await h.page.evaluate(() => window.__mdm.scoreCursor.track)], ["g", 0]);
  await chord(h.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(h.page), "B");
  assert.deepEqual(await stretch(h.page), { voices: null, anchor: null, stop: 4, track: 1, bands: null });
  assert.equal(await h.page.evaluate(() => window.__mdm.scoreCursor.home || null), null);
  // Space picks it: the one place, over its staff. Held down it is one
  // press, and so is Ctrl+C.
  for (const m of walk) await h.page.keyboard.down(m);
  await h.page.keyboard.down("Space");
  await h.page.keyboard.down("Space");
  await h.page.keyboard.up("Space");
  for (const m of walk.slice().reverse()) await h.page.keyboard.up(m);
  assert.deepEqual(await stretch(h.page), { voices: [1], anchor: 4, stop: 4, track: 1, bands: [[1]] });
  await h.page.keyboard.down("Control");
  await h.page.keyboard.down("c");
  await h.page.keyboard.down("c");
  await h.page.keyboard.up("c");
  await h.page.keyboard.up("Control");
  assert.deepEqual(await copied(h.page), ["B"]);
  // On to the third, picked as well, and back up to the first, which is
  // not: the stretch goes with the cursor, and no band lies over its staff.
  await chord(h.page, walk, "ArrowDown");
  assert.equal(await placeText(h.page), "G,2");
  await chord(h.page, walk, "Space");
  assert.deepEqual((await stretch(h.page)).bands, [[1], [2]]);
  await chord(h.page, walk, "ArrowUp");
  await chord(h.page, walk, "ArrowUp");
  assert.equal(await placeText(h.page), "g");
  assert.deepEqual(await stretch(h.page), { voices: [1, 2], anchor: 4, stop: 4, track: 0, bands: [[1], [2]] });
  // No voice over the first.
  await chord(h.page, walk, "ArrowUp");
  assert.equal((await stretch(h.page)).track, 0);
  // Left and Right, the two keys still down, draw it out sideways over the
  // two picked, from its head: the place the first of them was picked at,
  // in the second voice, which the cursor comes back to.
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual(await stretch(h.page), { voices: [1, 2], anchor: 4, stop: 5, track: 1, bands: [[1], [2]] });
  assert.equal(await placeText(h.page), "c");
  // The notes of the two wear its ink, and no note of the first voice.
  assert.deepEqual(await inked(h.page), ["v1 l0 m1 n0", "v1 l0 m1 n1", "v2 l0 m1 n0"]);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:2\nB c\nV:3\nG,2"]);
  // And a place more.
  await chord(h.page, walk, "ArrowRight");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:2\nB c d\nV:3\nG,2 C,2"]);
  // With Alt held as well none of these keys is the mode's (the walk and
  // its Space were Ctrl+Shift+Alt's until 2026-10-06, and a stretch was
  // drawn out under the three keys as under the two): the stretch and the
  // cursor are left as they are by each of them. Looked at after each, and
  // not after the five: Right and then Left, or Up and then Down, would
  // leave them as they were if the keys were still the mode's.
  const asItWas = await stretch(h.page);
  for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Space"]) {
    await chord(h.page, ["Control", "Shift", "Alt"], key);
    assert.deepEqual(await stretch(h.page), asItWas, "Ctrl+Shift+Alt with " + key);
  }
  await chord(h.page, walk, "ArrowUp");
  assert.equal(await placeText(h.page), "b");
  // Space on the first voice puts it among them, and again takes it out;
  // with none left nothing is washed, the copy is the place the cursor
  // stands on as it is with nothing chosen, and one picked again finds the
  // stretch where it was.
  await chord(h.page, walk, "Space");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).bands], [[0, 1, 2], [[0], [1], [2]]]);
  await chord(h.page, walk, "Space");
  assert.deepEqual((await stretch(h.page)).voices, [1, 2]);
  for (let i = 0; i < 2; i++) {
    await chord(h.page, walk, "ArrowDown");
    await chord(h.page, walk, "Space");
  }
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).bands, await inked(h.page)], [[], null, []]);
  // With nothing of it in sight the stretch is still there to be picked
  // for: the two keys go on walking the voices, and are not the line's.
  await chord(h.page, walk, "ArrowUp");
  assert.deepEqual([(await stretch(h.page)).track, (await stretch(h.page)).voices, (await stretch(h.page)).anchor], [1, [], 4]);
  await chord(h.page, walk, "ArrowDown");
  assert.equal((await stretch(h.page)).track, 2);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["C,2"]);
  await chord(h.page, walk, "Space");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["G,2 C,2"]);
  // A plain arrow lets the stretch go, and leaves the cursor on its first
  // place in the voice it was drawn out in, wherever the cursor had walked
  // to.
  await h.page.keyboard.press("ArrowLeft");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).anchor, (await stretch(h.page)).track, await placeText(h.page)], [null, null, 1, "B"]);
  // A stretch drawn out with Shift is the cursor's voice's when the walk
  // begins, and one drawn out with Ctrl+Shift every voice's: the walk
  // leaves them picked.
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, walk, "ArrowUp");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).track], [[1], 0]);
  await h.page.keyboard.press("Escape");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await chord(h.page, walk, "ArrowDown");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).track], [[0, 1, 2], 1]);
  // Shift alone makes it the cursor's voice's again, and a plain arrow
  // lets it go.
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual([(await stretch(h.page)).voices, await placeText(h.page)], [null, "a"]);
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).bands, await placeText(h.page)], [null, null, "a"]);
  // Back from a walk with nowhere further to go across, the cursor is on
  // the place it left, at the height it had there and with its note's
  // figure, whatever it took on in the other voice: out on a ledger line
  // over the last note of the second voice, it follows the third's note
  // down to its own step, and comes back up.
  await chord(h.page, ["Control"], "ArrowDown");
  await press(h.page, "ArrowRight", 2);
  await toStep(h.page, 12);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step, await kept(h.page), (await stretch(h.page)).track], ["e", 12, 0.25, 1]);
  await chord(h.page, walk, "ArrowDown");
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step, await kept(h.page)], ["C,2", 5, 0.5]);
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step, await kept(h.page)], ["e", 12, 0.25]);
  // One place chosen is a stretch for the walk to keep (drawn out and back
  // onto its anchor it was one of nothing, and the walk the plain one,
  // until one place could be chosen).
  await h.page.keyboard.press("Escape");
  await chord(h.page, ["Shift"], "ArrowLeft");
  await chord(h.page, walk, "ArrowUp");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).anchor, (await stretch(h.page)).track, await placeText(h.page)], [[1], 7, 0, "c'"]);
  // Every voice picked let go of leaves a list with nothing in it, and
  // Ctrl+Shift across is then every voice's, as it is with none picked.
  await chord(h.page, walk, "ArrowDown");
  await chord(h.page, walk, "Space");
  assert.deepEqual([(await stretch(h.page)).voices, await inked(h.page)], [[], []]);
  await chord(h.page, ["Control", "Shift"], "ArrowLeft");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).bands], ["all", [[0, 1, 2]]]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's try of 2026-10-03, on a chorale of four voices on three
// staves: "probé control shift alt aquí intentando copiar el primer compás
// de la primera y tercera ... seleccionándolas con espacio excluyendo la
// segunda pero no funcionó". With the same keys sent through the X server
// (kwin_x11, VS Code 1.133.0) the first and the third voice were chosen and
// copied. What the drawing showed was a band over the first staff, which
// the first voice shares with the second (`%%score (S A) T`), and one over
// the second: the picture the first and the second voice would make as
// well, and nothing to say the second was left out. So what is chosen
// wears the ink, note by note (inkScoreSelection).
const CHORALE_SOURCE = [
  "X:1",
  "%%score (S A) T",
  "L:1/4",
  "M:4/4",
  "Q:1/4=120",
  "K:G",
  "V:S",
  "d2 B2 | c A B G | A4 |",
  "g2 d2 | e c d B | G4 |]",
  "V:A",
  "B2 G2 | A F G D | F4 |",
  "B2 G2 | G A F D | D4 |]",
  "V:T clef=bass",
  "G,2 D,2 | E, D, D, B,, | D,4 |",
  "D,2 G,2 | C, E, D, D, | B,,4 |]",
  "V:B",
  "d2 B2 | c A B G | A4 |",
  "g2 d2 | e c d B | G4 |]",
].join("\n");
const CHORALE = ["Four voices.", "", "```abc", CHORALE_SOURCE, "```", "", "```abc", "X:2", "L:1/4", "K:C", "C D E F |]", "```", ""].join("\n");

test("on a staff two voices share, the ink of a stretch says which of them is chosen: the notes of the voices picked wear the brass and the others keep theirs, in the mode and while nothing sounds (SM78)", { skip }, async () => {
  const h = await open({ text: CHORALE, scores: 2, clipboard: true });
  await listenSources(h.page);
  await pressMode(h.page);
  const walk = ["Control", "Shift"];
  const from = async () => (await cursor(h.page)).from;
  // How a note is drawn: in the brass, or in the ink of the score.
  const brass = (name) =>
    h.page.evaluate((name) => {
      const note = document.querySelector("#app .mdm-score svg ." + name.split(" ").map((c) => "abcjs-" + c).join("."));
      const shape = note.querySelector("path") || note;
      const hex = getComputedStyle(shape).getPropertyValue("--mdm-play-accent").trim();
      const accent = "rgb(" + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ") + ")";
      return getComputedStyle(shape).fill === accent;
    }, name);
  assert.equal(await from(), CHORALE_SOURCE.indexOf("d2 B2 | c A"));
  assert.deepEqual(await inked(h.page), []);
  // The owner's keys: Space on the first voice, down past the second,
  // which is on the first's staff, Space on the third, and the stretch
  // drawn out across, Ctrl+Shift down all the while (until 2026-10-06 the
  // walk and its Space wanted Alt as well, let go before the last).
  await chord(h.page, walk, "Space");
  assert.deepEqual(await inked(h.page), ["v0 l0 m0 n0"]);
  await chord(h.page, walk, "ArrowDown");
  assert.equal(await from(), CHORALE_SOURCE.indexOf("B2 G2 | A F"));
  await chord(h.page, walk, "ArrowDown");
  assert.equal(await from(), CHORALE_SOURCE.indexOf("G,2 D,2"));
  await chord(h.page, walk, "Space");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  // The first and the third of four: a band over the staff the first two
  // share and one over the third's, and the ink on the notes of the two.
  assert.deepEqual(await stretch(h.page), { voices: [0, 2], anchor: 0, stop: 1, track: 0, bands: [[0], [1]] });
  assert.deepEqual(await inked(h.page), ["v0 l0 m0 n0", "v0 l0 m0 n1", "v2 l0 m0 n0", "v2 l0 m0 n1"]);
  assert.deepEqual([await brass("v0 l0 m0 n1"), await brass("v1 l0 m0 n1"), await brass("v2 l0 m0 n0"), await brass("v3 l0 m0 n0"), await brass("v0 l0 m1 n0")], [true, false, true, false, false]);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:S\nd2 B2\nV:T\nG,2 D,2"]);
  // While the stretch sounds the brass is the sounding note's alone: the
  // second note of the first voice is in the score's ink until its turn,
  // and in the brass again when the music is over.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.equal(await brass("v0 l0 m0 n1"), false);
  await untilSounding(h.page, false);
  assert.equal(await brass("v0 l0 m0 n1"), true);
  // Every voice, and the second let go of with Space: its staff keeps the
  // band, for the first voice's sake, and its notes the score's ink.
  await h.page.keyboard.press("Escape");
  assert.deepEqual(await inked(h.page), []);
  await chord(h.page, ["Control", "Shift"], "ArrowLeft");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).bands, (await inked(h.page)).length], ["all", [[0, 1, 2]], 4]);
  await chord(h.page, ["Control", "Shift"], "ArrowLeft");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).bands, (await inked(h.page)).length], ["all", [[0, 1, 2]], 8]);
  await chord(h.page, walk, "ArrowDown");
  assert.equal(await from(), CHORALE_SOURCE.indexOf("B2 G2 | A F"));
  await chord(h.page, walk, "Space");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).bands], [[0, 2, 3], [[0], [1], [2]]]);
  assert.deepEqual(await inked(h.page), ["v0 l0 m0 n0", "v0 l0 m0 n1", "v2 l0 m0 n0", "v2 l0 m0 n1", "v3 l0 m0 n0", "v3 l0 m0 n1"]);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:S\nd2 B2\nV:T\nG,2 D,2\nV:B\nd2 B2"]);
  // Space again takes it back in.
  await chord(h.page, walk, "Space");
  assert.equal((await inked(h.page)).length, 8);
  // The cursor gone to another score, the ink does not stay behind in this
  // one; nor when the mode is left.
  const other = await heads(h.page, 1);
  await h.page.mouse.click(other[0].x, other[0].y);
  assert.deepEqual(await inked(h.page), []);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.equal((await inked(h.page)).length, 1);
  // The ledger line of its C is in the brass with the note: a shape with a
  // fill of its own, out of the note's group (sinkLedgers), which the
  // note's brass does not reach.
  assert.equal(
    await h.page.evaluate(() => {
      const ledger = document.querySelectorAll("#app .mdm-score")[1].querySelector("svg .abcjs-ledger.mdm-score-picked");
      const hex = getComputedStyle(ledger).getPropertyValue("--mdm-play-accent").trim();
      return getComputedStyle(ledger).fill === "rgb(" + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ") + ")";
    }),
    true
  );
  await pressMode(h.page);
  assert.deepEqual(await inked(h.page), []);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A beam is a shape of its own in the drawing: left in the score's ink, it
// lay black over two eighths in the brass (seen in the pictures made for
// the owner's sheet of the colours, 2026-10-04).
test("the beam of notes chosen takes their ink once every note it joins is chosen, and the beam of an ornament with the note the ornament is on; a tie and a slur, once both their notes are (SM84)", { skip }, async () => {
  const h = await open({ text: notesDoc("G2 AB c2 {gab}c2 | (3def g/a/b/c'/ d'4 |]"), scores: 1 });
  await pressMode(h.page);
  // Each beam the score draws, in order: the two eighths, the ornament's,
  // the triplet's and the sixteenths'. In the brass, or not chosen.
  const beams = () =>
    h.page.evaluate(() => {
      const svg = document.querySelector("#app .mdm-score code.language-abc svg");
      const hex = getComputedStyle(svg).getPropertyValue("--mdm-play-accent").trim();
      const accent = "rgb(" + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ") + ")";
      return Array.from(svg.querySelectorAll(".abcjs-beam-elem")).map((b) => (b.classList.contains("mdm-score-picked") ? (getComputedStyle(b).fill === accent ? "brass" : "picked") : "-"));
    });
  assert.deepEqual(await beams(), ["-", "-", "-", "-"]);
  // The quarter the cursor is on, and then one of the two eighths, which
  // is not the beam's two.
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.equal((await stretch(h.page)).stop, 0);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await beams(), ["-", "-", "-", "-"]);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await beams(), ["brass", "-", "-", "-"]);
  // The note the ornament is on, and its beam with it.
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await beams(), ["brass", "-", "-", "-"]);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await beams(), ["brass", "brass", "-", "-"]);
  // The three of the triplet, and the four sixteenths.
  for (let i = 0; i < 2; i++) await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await beams(), ["brass", "brass", "-", "-"]);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await beams(), ["brass", "brass", "brass", "-"]);
  for (let i = 0; i < 4; i++) await chord(h.page, ["Shift"], "ArrowRight");
  assert.equal(await placeText(h.page), "c'/");
  assert.deepEqual(await beams(), ["brass", "brass", "brass", "brass"]);
  // A note let go of, and its beam is the score's again; the stretch let
  // go, and all of them.
  await chord(h.page, ["Shift"], "ArrowLeft");
  assert.deepEqual(await beams(), ["brass", "brass", "brass", "-"]);
  await h.page.keyboard.press("Escape");
  assert.deepEqual(await beams(), ["-", "-", "-", "-"]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // A slur over two quarters, and a tie over the barline: each in the ink
  // with both its notes, and not with one. Delete takes an arc with its two
  // notes and is refused with one of them (the owner's rule of 2026-10-06,
  // SM100).
  const g = await open({ text: notesDoc("(c2 d2) e4- | e2 f2 z4 |]"), scores: 1 });
  await pressMode(g.page);
  const arcs = () =>
    g.page.evaluate(() =>
      Array.from(document.querySelectorAll("#app .mdm-score code.language-abc svg .abcjs-slur")).map((arc) => (arc.classList.contains("abcjs-tie") ? "tie " : "slur ") + arc.classList.contains("mdm-score-picked"))
    );
  assert.deepEqual(await arcs(), ["slur false", "tie false"]);
  await chord(g.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await arcs(), ["slur false", "tie false"]);
  await chord(g.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await arcs(), ["slur true", "tie false"]);
  await chord(g.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await arcs(), ["slur true", "tie false"]);
  await chord(g.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await arcs(), ["slur true", "tie true"]);
  await g.page.keyboard.press("Escape");
  assert.deepEqual(await arcs(), ["slur false", "tie false"]);
  assert.deepEqual(g.errors, []);
  await g.close();

  // Arcs cut by the end of a line, which abcjs draws in pieces: a slur
  // from the first line to the third, a piece on each, and two ties, from
  // the first line to the second and from the second to the third, in two
  // pieces each. Every piece of an arc takes the ink with both its notes,
  // wherever they stand, and none with one. The pieces as the score draws
  // them: on the first line the slur's and the first tie's; on the second
  // the slur's, the end of the first tie and the head of the second; on
  // the third the slur's, and the end of the second tie.
  const w = await open({ text: notesDoc("c2 d2 (e2 f2- |\nf2 g2 a2 b2- |\nb2 c'2) a2 g2 |]"), scores: 1 });
  await pressMode(w.page);
  const pieces = () => w.page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-score code.language-abc svg .abcjs-slur")).map((arc) => (arc.classList.contains("mdm-score-picked") ? "x" : ".")).join(""));
  const click = async (n) => {
    const at = (await heads(w.page, 0))[n];
    await w.page.mouse.click(at.x, at.y);
  };
  // The second tie alone, its two notes: its two pieces and no other, the
  // first tie having ended a line above.
  await click(7);
  for (let i = 0; i < 2; i++) await chord(w.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await placeText(w.page), await pieces()], ["b2", "....x.x"]);
  await w.page.keyboard.press("Escape");
  // From the note the slur begins on to the one tied on: nothing yet.
  await click(2);
  for (let i = 0; i < 2; i++) await chord(w.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await placeText(w.page), await pieces()], ["f2-", "......."]);
  // The note it is tied to, on the line below: the first tie.
  await chord(w.page, ["Shift"], "ArrowRight");
  assert.equal(await pieces(), ".x.x...");
  // On to the end of the second line, and to the note tied to it: the
  // second tie with the first.
  for (let i = 0; i < 3; i++) await chord(w.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await placeText(w.page), await pieces()], ["b2-", ".x.x..."]);
  await chord(w.page, ["Shift"], "ArrowRight");
  assert.equal(await pieces(), ".x.xx.x");
  // And to the slur's last note: the slur, all three pieces.
  await chord(w.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await placeText(w.page), await pieces()], ["c'2)", "xxxxxxx"]);
  // Delete takes them with their notes.
  await w.page.keyboard.press("Delete");
  assert.deepEqual((await docText(w.page)).split("\n").slice(7, 9), ["c2 d2 |", "a2 g2 |]"]);
  assert.deepEqual(w.errors, []);
  await w.close();
});

// What a stretch chosen wears, shape by shape: the brass on everything
// Delete would take with it. The owner's rule of 2026-10-06, "que se señale
// en latón todo lo que de apretar Delete será borrado". An hour before, of
// the syllables of example.mdm in the brass under a stretch, he had said
// "más nada que no sea el score y las notas debe estar dibujado en la
// selección", which kept the brass to the notes alone, and took it back
// ("perdón, vira para atrás"). Until that day the brass was the whole group
// abcjs draws for a note, syllable and all, with a beam, a tie and a slur;
// a dynamic, a tuplet's bracket, a hairpin and a barline never took it.
// Under the second rule the syllables kept the score's ink for an hour,
// Delete leaving them written then; his answer to that, "el delete debe
// borrarlo todo por lo que debe marcarse todo lo que se borra", has Delete
// take them with their notes, and they wear the brass.
//
// One voice with each of those things in it. The stretch runs from the
// third beat of the first bar to the end of the sixth, and Delete takes
// all that is written from the one to the other: `C2 | G4 |]` is left.
const INK_SOURCE = [
  "X:1",
  "M:4/4",
  "L:1/4",
  "K:C",
  'C2 "Am"C "^above"E | !1!.G !fermata!c !>!e !p!f | c3/2 d/ ^f/ z/ _B/c/ | {/g}a (a b) c\'- | c\'2 (3def | !<(!g a !<)!b2 | G4 |]',
].join("\n");
const INK = ["Ink.", "", "```abc", INK_SOURCE, "```", ""].join("\n");
// The kinds of shape the score draws over the span of that stretch, every
// one of which Delete takes, and the ones it draws beside it.
const TAKEN = ["accent", "accidental", "annotation", "barline", "beam", "chord symbol", "dot", "dynamic", "fermata", "fingering", "flag", "hairpin", "head", "ledger line", "rest", "slur", "staccato", "stem", "tie", "tuplet"];
const LEFT = ["barline", "head", "ledger line", "stem"];
// A verse under the notes, a syllable a note: Delete takes each with its
// note.
const SUNG_SOURCE = ["X:1", "M:4/4", "L:1/4", "K:C", "C D E F | G A B c |]", "w: one two three four five six sev-en"].join("\n");
const SUNG = ["Sung.", "", "```abc", SUNG_SOURCE, "```", ""].join("\n");
const BARS_SOURCE = ["X:1", "M:4/4", "L:1/4", "K:C", "C E G c | e f g a | c' b a g |]"].join("\n");
const BARS = ["Bars.", "", "```abc", BARS_SOURCE, "```", ""].join("\n");
// Whole bars with a key written inside one: no cut the engine makes.
const KEYED_SOURCE = ["X:1", "M:4/4", "L:1/4", "K:C", "C D [K:G] E F | G4 |]"].join("\n");
const KEYED = ["Keyed.", "", "```abc", KEYED_SOURCE, "```", ""].join("\n");
// Two endings, the first between barlines a stretch of three bars takes.
const ENDED_SOURCE = ["X:1", "M:4/4", "L:1/4", "K:C", "C4 |1 D4 :|2 E4 | F4 |]"].join("\n");
const ENDED = ["Ended.", "", "```abc", ENDED_SOURCE, "```", ""].join("\n");
// Every shape of the first score by its kind, and what the shapes of each
// kind are painted in, [kind, paints] in the order of the kinds' names:
// those that stand over a span of the page, from `left` to `right`, and
// those that stand beside it. A shape is painted by its fill, or by its
// stroke where abcjs draws it with one and no fill (a hairpin).
const paints = (page, span) =>
  page.evaluate((span) => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    const SIGNS = { "scripts.staccato": "staccato", "scripts.ufermata": "fermata", "scripts.sforzato": "accent" };
    const FAMILIES = { accidentals: "accidental", rests: "rest", flags: "flag", dots: "dot" };
    const stroked = (el) => el.getAttribute("stroke") === "currentColor" && !el.getAttribute("fill");
    const kind = (el) => {
      const c = el.classList;
      const name = el.getAttribute("data-name") || "";
      if (c.contains("abcjs-notehead")) return "head";
      if (c.contains("abcjs-stem")) return "stem";
      if (c.contains("abcjs-ledger")) return "ledger line";
      if (c.contains("abcjs-lyric")) return "syllable";
      if (c.contains("abcjs-chord")) return "chord symbol";
      // abcjs draws a fingering as an annotation it gives no name.
      if (c.contains("abcjs-annotation")) return name ? "annotation" : "fingering";
      if (c.contains("abcjs-beam-elem")) return "beam";
      if (c.contains("abcjs-tie")) return "tie";
      if (c.contains("abcjs-slur")) return "slur";
      if (el.closest(".abcjs-dynamics")) return stroked(el) ? "hairpin" : "dynamic";
      if (el.closest(".abcjs-triplet")) return "tuplet";
      if (el.closest(".abcjs-bar")) return "barline";
      if (el.closest(".abcjs-key-signature")) return "key";
      if (SIGNS[name]) return SIGNS[name];
      const family = /^(accidentals|rests|flags|dots)\./.exec(name);
      return family ? FAMILIES[family[1]] : el.tagName + "." + (el.getAttribute("class") || "") + "[" + name + "]";
    };
    const seen = { over: {}, beside: {} };
    // A dynamic of one letter is a shape with the class on it, and one of
    // two is a group of them.
    // The ledger lines by their own class: they stand under the notes of
    // their system since sinkLedgers, out of the notes' groups.
    svg.querySelectorAll("g.abcjs-note *, g.abcjs-rest *, .abcjs-ledger, .abcjs-beam-elem, .abcjs-slur, .abcjs-dynamics, .abcjs-dynamics *, .abcjs-triplet *, .abcjs-bar *").forEach((el) => {
      // What paints a text is its tspans, where it has any.
      if (el.tagName === "g" || (el.tagName === "text" && el.querySelector("tspan"))) return;
      const own = el.tagName === "tspan" ? el.parentNode : el;
      const b = el.getBoundingClientRect();
      const x = (b.left + b.right) / 2;
      const where = seen[x >= span.left && x <= span.right ? "over" : "beside"];
      const k = kind(own);
      const paint = getComputedStyle(el)[stroked(own) ? "stroke" : "fill"];
      if (!where[k]) where[k] = [];
      if (where[k].indexOf(paint) < 0) where[k].push(paint);
    });
    const listed = (of) =>
      Object.keys(of)
        .sort()
        .map((k) => [k, of[k].sort()]);
    return { over: listed(seen.over), beside: listed(seen.beside) };
  }, span);
// The barlines of the first score, in the order they stand: in the brass,
// or in the score's ink.
const barPaints = (page) =>
  page.evaluate(() => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    const hex = getComputedStyle(svg).getPropertyValue("--mdm-play-accent").trim();
    const accent = "rgb(" + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ") + ")";
    return Array.from(svg.querySelectorAll("g.abcjs-bar")).map((bar) => (Array.from(bar.querySelectorAll("path")).every((line) => getComputedStyle(line).fill === accent) ? "brass" : "ink"));
  });
// What is drawn inside a box of the page, read off its pixels: how much ink
// there is, counted in pixels inked whole, and what share of it is the
// brass. The ink of a pixel is how far it stands from the page, whose colour
// is read at the corner of the score, where nothing is drawn; its brass is
// the red it has over the blue, which the page and the greys of the score
// have none of and #a0740f has 145 of. A shape in the brass gives a share
// near 1, and one in the score's ink a share near 0. Summed over the box
// and not read off its reddest pixel: the letters are smoothed a colour to
// a side, and a syllable in grey has pixels at its edges 115 redder than
// they are blue, with as many the other way.
async function inkIn(page, box) {
  const shot = async (clip) => {
    const png = await page.screenshot({ clip: clip, encoding: "base64" });
    return page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = cv.getContext("2d");
      g.drawImage(bmp, 0, 0);
      return Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data);
    }, png);
  };
  const corner = await page.evaluate(() => {
    const b = document.querySelector("#app .mdm-score code.language-abc svg").getBoundingClientRect();
    return { x: Math.ceil(b.left) + 1, y: Math.ceil(b.top) + 1, width: 1, height: 1 };
  });
  const ground = await shot(corner);
  const d = await shot({ x: Math.floor(box.left), y: Math.floor(box.top), width: Math.ceil(box.right) - Math.floor(box.left), height: Math.ceil(box.bottom) - Math.floor(box.top) });
  let ink = 0;
  let brass = 0;
  for (let i = 0; i < d.length; i += 4) {
    ink += (Math.abs(d[i] - ground[0]) + Math.abs(d[i + 1] - ground[1]) + Math.abs(d[i + 2] - ground[2])) / 3;
    brass += d[i] - d[i + 2] - (ground[0] - ground[2]);
  }
  return { ink: Math.round(ink / 2.55) / 100, share: ink ? Math.round((100 * brass) / ink) / 100 : 0 };
}
// Where a shape of the first score stands on the page: the box of the nth
// the selector finds, or for a line (an arc or a hairpin, the widest the
// selector finds, which leaves out the small arc abcjs draws under an
// ornament) the five pixels about the middle of its first stroke, clear of
// the notes at its ends.
const shapeBox = (page, selector, line, nth) =>
  page.evaluate(
    (selector, line, nth) => {
      const found = Array.from(document.querySelectorAll("#app .mdm-score code.language-abc svg " + selector));
      if (!line) {
        const b = found[nth].getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      }
      const el = found.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      // abcjs draws an arc as a shape, out along one curve and back along
      // the other, and a hairpin as two lines: a quarter of the way along
      // is the middle of the first.
      const p = el.getPointAtLength(el.getTotalLength() / 4);
      const m = el.getScreenCTM();
      const x = m.a * p.x + m.c * p.y + m.e;
      const y = m.b * p.x + m.d * p.y + m.f;
      return { left: x - 2, right: x + 3, top: y - 2, bottom: y + 3 };
    },
    selector,
    !!line,
    nth || 0
  );
// A stretch drawn out from a head of the first score, over so many places.
async function chooseFrom(page, head, places) {
  const at = (await heads(page, 0))[head];
  await page.mouse.click(at.x, at.y);
  for (let i = 0; i < places; i++) await chord(page, ["Shift"], "ArrowRight");
}

test("a stretch chosen wears the brass on everything Delete takes with it and on nothing else: the notes with what is written on them, the arcs, the tuplets, the dynamics and the hairpins that go with them, the barlines inside it and the one that goes with whole bars, and the syllables under its notes (SM100)", { skip }, async () => {
  const h = await open({ text: INK, scores: 1 });
  await pressMode(h.page);
  const accent = await h.page.evaluate(() => {
    const hex = getComputedStyle(document.getElementById("app")).getPropertyValue("--mdm-play-accent").trim();
    return "rgb(" + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ") + ")";
  });
  // The stretch, to know the span it stands over, and let go of.
  await chooseFrom(h.page, 1, 23);
  const span = (await selection(h.page)).bands[0];
  await h.page.keyboard.press("Escape");
  // With nothing chosen: the score draws every kind named above over that
  // span, and nothing of it in the brass.
  const rest = await paints(h.page, span);
  assert.deepEqual([rest.over.map((k) => k[0]), rest.beside.map((k) => k[0])], [TAKEN, LEFT]);
  assert.deepEqual(rest.over.concat(rest.beside).filter((k) => k[1].indexOf(accent) >= 0), []);
  // Chosen: all of it over the span in the brass, and what stands beside
  // it painted as it was.
  await chooseFrom(h.page, 1, 23);
  assert.deepEqual(await paints(h.page, span), { over: TAKEN.map((k) => [k, [accent]]), beside: rest.beside });
  // The same on the screen, for what stands clear of the band, which is
  // the brass too: a head to say the measure finds it, and each thing
  // written about the notes.
  const marked = {
    head: await shapeBox(h.page, ".abcjs-notehead", false, 1),
    "chord symbol": await shapeBox(h.page, ".abcjs-chord"),
    annotation: await shapeBox(h.page, ".abcjs-annotation[data-name]"),
    fingering: await shapeBox(h.page, ".abcjs-annotation:not([data-name])"),
    fermata: await shapeBox(h.page, '[data-name="scripts.ufermata"]'),
    dynamic: await shapeBox(h.page, '.abcjs-dynamics:not([stroke="currentColor"])'),
    hairpin: await shapeBox(h.page, '.abcjs-dynamics[stroke="currentColor"]', true),
    "tuplet's number": await shapeBox(h.page, ".abcjs-triplet text"),
    slur: await shapeBox(h.page, ".abcjs-slur:not(.abcjs-tie)", true),
    tie: await shapeBox(h.page, ".abcjs-tie", true),
  };
  for (const name of Object.keys(marked)) {
    const seen = await inkIn(h.page, marked[name]);
    assert.ok(seen.ink > 2 && seen.share > 0.7, "the " + name + " in the brass: " + JSON.stringify(seen));
  }
  // And Delete takes what was marked: all that is written from the first
  // place to the last.
  await h.page.keyboard.press("Delete");
  assert.equal((await docText(h.page)).split("\n")[7], "C2 | G4 |]");
  assert.deepEqual(h.errors, []);
  await h.close();

  // A verse under the notes. The syllables of the notes chosen wear the
  // brass with them, on the screen as well, and the ones beside the
  // stretch keep the score's ink: Delete takes each with its note, and the
  // syllables that stay are under the notes they were under.
  const s = await open({ text: SUNG, scores: 1 });
  await pressMode(s.page);
  // What is drawn under each note, in the order of the notes, and whether
  // it is in the brass. (Read note by note and not off the span of the
  // band, as the shapes above are: abcjs ends a syllable's text on an empty
  // line, which stands nowhere.)
  const sungUnder = () =>
    s.page.evaluate((accent) => {
      return Array.from(document.querySelectorAll("#app .mdm-score code.language-abc svg g.abcjs-note")).map((note) => {
        const text = note.querySelector(".abcjs-lyric");
        return text ? [text.textContent, getComputedStyle(text.querySelector("tspan") || text).fill === accent] : ["", false];
      });
    }, accent);
  const inInk = (words) => words.map((word) => [word, false]);
  assert.deepEqual(await sungUnder(), inInk(["one", "two", "three", "four", "five", "six", "sev-", "en"]));
  await chooseFrom(s.page, 1, 3);
  const under = (await selection(s.page)).bands[0];
  const sung = await paints(s.page, under);
  assert.deepEqual(sung.over, [["head", [accent]], ["stem", [accent]], ["syllable", [accent]]]);
  assert.deepEqual(await sungUnder(), [["one", false], ["two", true], ["three", true], ["four", true]].concat(inInk(["five", "six", "sev-", "en"])));
  const taken = await inkIn(s.page, await shapeBox(s.page, ".abcjs-lyric", false, 1));
  assert.ok(taken.ink > 2 && taken.share > 0.7, "the syllable of a note chosen in the brass: " + JSON.stringify(taken));
  const kept = await inkIn(s.page, await shapeBox(s.page, ".abcjs-lyric", false, 0));
  assert.ok(kept.ink > 2 && kept.share < 0.3, "the syllable beside the stretch in the score's ink: " + JSON.stringify(kept));
  await s.page.keyboard.press("Delete");
  assert.deepEqual([(await docText(s.page)).split("\n").slice(7, 9), await notices(s.page)], [["C | G A B c |]", "w: one five six sev-en"], []]);
  assert.deepEqual(await sungUnder(), inInk(["one", "five", "six", "sev-", "en"]));
  // The last notes of the line, which until this went and left their
  // syllables written under nothing.
  await s.page.keyboard.press("Escape");
  await chooseFrom(s.page, 3, 2);
  await s.page.keyboard.press("Delete");
  assert.deepEqual((await docText(s.page)).split("\n").slice(7, 9), ["C | G A |]", "w: one five six"]);
  assert.deepEqual(await sungUnder(), inInk(["one", "five", "six"]));
  // And one note by itself, with nothing chosen: its syllable goes too.
  await s.page.keyboard.press("Escape");
  const second = (await heads(s.page, 0))[1];
  await s.page.mouse.click(second.x, second.y);
  await s.page.keyboard.press("Delete");
  assert.deepEqual([(await docText(s.page)).split("\n").slice(7, 9), await notices(s.page)], [["C | A |]", "w: one six"], []]);
  assert.deepEqual(await sungUnder(), inInk(["one", "six"]));
  assert.deepEqual(s.errors, []);
  await s.close();

  // Whole bars go with one of their barlines, the one that closes them, or
  // where that one says more than a barline (the end of the tune) the one
  // before them: that barline wears the brass, though it stands outside
  // the band, and the others keep their ink.
  const b = await open({ text: BARS, scores: 1 });
  await pressMode(b.page);
  await chooseFrom(b.page, 4, 4);
  assert.deepEqual(await barPaints(b.page), ["ink", "brass", "ink"]);
  const closing = await shapeBox(b.page, "g.abcjs-bar", false, 1);
  assert.ok(closing.left > (await selection(b.page)).bands[0].right, "the barline that closes the bar stands outside the band");
  const line = await inkIn(b.page, closing);
  assert.ok(line.ink > 2 && line.share > 0.5, "the barline in the brass: " + JSON.stringify(line));
  await b.page.keyboard.press("Delete");
  assert.equal((await docText(b.page)).split("\n")[7], "C E G c | c' b a g |]");
  await chooseFrom(b.page, 4, 4);
  assert.deepEqual(await barPaints(b.page), ["brass", "ink"]);
  await b.page.keyboard.press("Delete");
  assert.equal((await docText(b.page)).split("\n")[7], "C E G c |]");
  // Part of a bar and of the next: the barline between them, and no other.
  await b.page.keyboard.press("Escape");
  const c = await open({ text: BARS, scores: 1 });
  await pressMode(c.page);
  await chooseFrom(c.page, 3, 2);
  assert.deepEqual(await barPaints(c.page), ["brass", "ink", "ink"]);
  // The two notes and no third: the note after them is written with the
  // space before it, which the cut takes and the note does not go with.
  assert.equal(await c.page.evaluate(() => document.querySelectorAll("#app .mdm-score code.language-abc svg g.abcjs-note.mdm-score-picked").length), 2);
  await c.page.keyboard.press("Delete");
  assert.equal((await docText(c.page)).split("\n")[7], "C E G f g a | c' b a g |]");
  assert.deepEqual(b.errors.concat(c.errors), []);
  await b.close();
  await c.close();

  // Where the engine makes no cut, whole bars with a key written inside
  // one, the stretch is marked all the same: its places, and what is
  // written between them; no barline, since none would go.
  const k = await open({ text: KEYED, scores: 1 });
  await pressMode(k.page);
  await chooseFrom(k.page, 0, 4);
  const keyed = await k.page.evaluate(() => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    return { places: svg.querySelectorAll("g.abcjs-note.mdm-score-picked").length, key: svg.querySelectorAll(".abcjs-key-signature.mdm-score-picked").length };
  });
  assert.deepEqual([keyed, await barPaints(k.page)], [{ places: 4, key: 1 }, ["ink", "ink"]]);
  await k.page.keyboard.press("Delete");
  assert.equal((await docText(k.page)).split("\n")[7], "C D [K:G] E F | G4 |]");
  assert.deepEqual(k.errors, []);
  await k.close();

  // The bracket of an ending hangs on two barlines and goes with them. It
  // is drawn by its stroke as well as by its fill, and takes the brass in
  // both, its number with it; the second ending, whose last barline stays,
  // keeps its ink.
  const e = await open({ text: ENDED, scores: 1 });
  await pressMode(e.page);
  await chooseFrom(e.page, 0, 3);
  const brackets = await e.page.evaluate(() => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    const hex = getComputedStyle(svg).getPropertyValue("--mdm-play-accent").trim();
    const accent = "rgb(" + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ") + ")";
    return Array.from(svg.querySelectorAll(".abcjs-ending")).map((ending) => {
      const line = getComputedStyle(ending.querySelector("path"));
      return [line.stroke === accent, line.fill === accent, getComputedStyle(ending.querySelector("text")).fill === accent];
    });
  });
  assert.deepEqual(brackets, [[true, true, true], [false, false, false]]);
  assert.deepEqual(e.errors, []);
  await e.close();
});

// The owner's call of 2026-10-04, asked which voices a stretch should sound
// in: "Que haga sonar todas las pintadas esté el cursor en la partitura que
// esté, pero si se hace una selección ya sea con CtrlShift o con
// CtrlShiftAlt que suene solo la selección". Until then every voice sounded
// for as long as the stretch ran. The voices not chosen are left out of the
// synth (abcjs's voicesOff, which keeps their notes at no volume, so the
// clock is the tune's), and take no ink as the music passes them.
test("a stretch sounds in the voices it is chosen over and in no other, whichever voice the cursor has walked to, and they alone take the ink of what sounds; with no stretch, or from the bar's own play, every voice sounds again (SM80)", { skip }, async () => {
  const h = await open({ text: CHORALE, scores: 2 });
  await listenSources(h.page);
  await pressMode(h.page);
  const walk = ["Control", "Shift"];
  // What the synth was told to leave out, what it holds primed (the
  // loudest note of each voice), and the voices wearing the ink of what
  // sounds.
  // Read once the tune is primed: the play button is pushed in by the press,
  // and the sound waits for the priming.
  const synth = async () => {
    await h.page.waitForFunction(() => {
      const c = window.__mdm.player && window.__mdm.player.controller;
      return !!c && c.isLoaded && !c.isLoading;
    });
    return h.page.evaluate(() => {
      const p = window.__mdm.player;
      const c = p && p.controller;
      const flat = c && c.midiBuffer && c.midiBuffer.flattened;
      const lit = Array.from(document.querySelectorAll("#app .mdm-score svg .abcjs-note_selected")).map((el) => Number((/abcjs-v(\d+)/.exec(el.getAttribute("class")) || [])[1]));
      return {
        told: c && c.options ? c.options.voicesOff : null,
        heard: flat ? flat.tracks.map((track) => track.some((e) => e.cmd === "note" && e.volume > 0)) : null,
        lit: Array.from(new Set(lit)).sort(),
      };
    });
  };
  // The first and the third voice, over the first bar, and the cursor
  // walked down to the second, which is not chosen.
  await chord(h.page, walk, "Space");
  await chord(h.page, walk, "ArrowDown");
  await chord(h.page, walk, "ArrowDown");
  await chord(h.page, walk, "Space");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await chord(h.page, walk, "ArrowDown");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).track], [[0, 2], 1]);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.deepEqual(await synth(), { told: [1, 3], heard: [true, false, true, false], lit: [0, 2] });
  await untilSounding(h.page, false);
  // Drawn out with Shift it is its own voice's alone, and with Ctrl+Shift
  // every voice's.
  await h.page.keyboard.press("Escape");
  await chord(h.page, ["Shift"], "ArrowLeft");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.deepEqual(await synth(), { told: [0, 2, 3], heard: [false, true, false, false], lit: [1] });
  await untilSounding(h.page, false);
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.deepEqual(await synth(), { told: [], heard: [true, true, true, true], lit: [0, 1, 2, 3] });
  await untilSounding(h.page, false);
  // A voice let go of while the music is paused is no pause to take up: the
  // stretch is played again from its head in the voices left. The second
  // bar here, two seconds in at a quarter of 120: the tune set again for
  // other voices is back at its start, and has to be taken to the stretch.
  await h.page.keyboard.press("Escape");
  await press(h.page, "ArrowRight", 2);
  for (let i = 0; i < 3; i++) await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  const head = await lastStart(h.page);
  assert.ok(head > 0.9, "the stretch sounded from the top of the tune: " + head);
  await sleep(300);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  await chord(h.page, walk, "Space");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.equal((await synth()).told.length, 1);
  assert.ok(Math.abs((await lastStart(h.page)) - head) < 0.05, "set again, the stretch sounded from " + (await lastStart(h.page)) + " and not from " + head);
  await untilSounding(h.page, false);
  // The repeat is kept through a change of voices, which sets the tune on
  // the synth again: abcjs lets go of it there.
  const looping = () =>
    h.page.evaluate(() => [window.__mdm.player.controller.isLooping, document.querySelector(".mdm-audio .abcjs-midi-loop").classList.contains("abcjs-pushed")]);
  await h.page.click(".mdm-audio .abcjs-midi-loop");
  assert.deepEqual(await looping(), [true, true]);
  await chord(h.page, walk, "Space");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.deepEqual([(await synth()).told, await looping()], [[], [true, true]]);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  await h.page.click(".mdm-audio .abcjs-midi-loop");
  assert.deepEqual(await looping(), [false, false]);
  // A stretch every voice was let go of is none to play: the music goes on
  // from the cursor in every voice, as with nothing chosen, and so it does
  // once the stretch is let go.
  for (const keys of [[], ["ArrowUp"], ["ArrowDown", "ArrowDown"], ["ArrowDown"]]) {
    for (const key of keys) await chord(h.page, walk, key);
    await chord(h.page, walk, "Space");
  }
  assert.deepEqual([(await stretch(h.page)).voices, await inked(h.page)], [[], []]);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.deepEqual([(await synth()).told, await h.page.evaluate(() => window.__mdm.scoreRun)], [[], null]);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  // The bar's own play, out of the mode, with voices still left out from a
  // stretch: they come back, and the tune goes on from where it stood.
  await h.page.keyboard.press("Escape");
  await press(h.page, "ArrowLeft", 3);
  for (let i = 0; i < 3; i++) await chord(h.page, ["Shift"], "ArrowRight");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await sleep(700);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  const told = (await synth()).told;
  assert.equal(told.length, 3);
  await pressMode(h.page);
  await h.page.click(".mdm-audio .abcjs-midi-start");
  await untilSounding(h.page, true);
  assert.deepEqual([(await synth()).told, (await synth()).heard], [[], [true, true, true, true]]);
  assert.ok((await lastStart(h.page)) > 0.3, "the tune went back to " + (await lastStart(h.page)));
  await h.page.click(".mdm-audio .abcjs-midi-start");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's ask of 2026-10-04: "implementa el pegar". What the text is
// made to say is the engine's and is tested without a browser
// (score-bars.test.js, MDM_BARS.pasteMusic); these are the key, the voices
// the parts of a copy go to, where the cursor is left, and the history.
const PASTE_SOURCE = ["X:1", "M:4/4", "L:1/4", "Q:1/4=120", "K:C", "c d e f | z4 | g2 z2 |"].join("\n");
const pasteDoc = (source) => ["Paste.", "", "```abc", source, "```", ""].join("\n");
const clip = (page, text) => page.evaluate((text) => (window.__clipboard = text), text);

test("Ctrl+V puts what was copied in at the cursor: after a note and after a rest alike, after the last of an open voice; the cursor is left on the last place of it, and each paste is a step of the history (SM81)", { skip }, async () => {
  const h = await open({ text: pasteDoc(PASTE_SOURCE), scores: 1, clipboard: true });
  await pressMode(h.page);
  // Two notes copied, and the stretch let go.
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["c d"]);
  await h.page.keyboard.press("Escape");
  // On a note: after it (the owner's call of 2026-10-06, "ctrl v sobre nota
  // entra detrás"), and the cursor on the last note that came in, so that a
  // second paste goes on from the first.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "e");
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction(() => /c d e c d f/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.equal(await music(h.page), "c d e c d f | z4 | g2 z2 |");
  assert.deepEqual([await placeText(h.page), await ends2(h.page)], ["d", [null, 4]]);
  assert.equal(await selection(h.page), null);
  // Into the text at once, and to the host.
  assert.equal(await docText(h.page), pasteDoc(PASTE_SOURCE.replace("c d e f", "c d e c d f")));
  assert.equal(await lastEdit(h.page), pasteDoc(PASTE_SOURCE.replace("c d e f", "c d e c d f")));
  // A key held down is one paste.
  await h.page.keyboard.down("Control");
  await h.page.keyboard.down("v");
  await h.page.keyboard.down("v");
  await h.page.keyboard.up("v");
  await h.page.keyboard.up("Control");
  await h.page.waitForFunction(() => /c d e c d c d f/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  await sleep(150);
  assert.equal(await music(h.page), "c d e c d c d f | z4 | g2 z2 |");
  assert.deepEqual(await ends2(h.page), [null, 6]);
  // Each is a step of its own, and the cursor comes back with it.
  await chord(h.page, ["Control"], "z");
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["c d e f | z4 | g2 z2 |", "e"]);
  // On a rest it is the same (the owner's call of 2026-10-04: "Copiar sobre
  // un silencio funciona igual que copiar sobre una nota"): after it, the
  // rest left as it was. To put music in the place of a rest, the rest is
  // chosen first (SM90).
  await press(h.page, "ArrowRight", 2);
  assert.equal(await placeText(h.page), "z4");
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction(() => /z4 c d \|/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual([await music(h.page), await placeText(h.page), await ends2(h.page)], ["c d e f | z4 c d | g2 z2 |", "d", [null, 6]]);
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction(() => /z4 c d c d \|/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual([await music(h.page), await ends2(h.page)], ["c d e f | z4 c d c d | g2 z2 |", [null, 8]]);
  // A copy with a barline in it brings its bars, and the cursor is on the
  // last of it, past the barline.
  await clip(h.page, "a2 b2 | c'4");
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "g2");
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction(() => /c'4/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["c d e f | z4 c d c d | g2 a2 b2 | c'4 z2 |", "c'4"]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // After the last note of a line a barline closes, which before the cursor
  // could not be reached: the music went in before the note it stood on.
  const k = await open({ text: notesDoc("C2 D2 E2 F2 |]"), scores: 1, clipboard: true });
  await pressMode(k.page);
  await clip(k.page, "G2 A2");
  await press(k.page, "ArrowRight", 3);
  assert.equal(await placeText(k.page), "F2");
  await chord(k.page, ["Control"], "v");
  await k.page.waitForFunction(() => /F2 G2 A2 \|\]/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual([await music(k.page), await placeText(k.page)], ["C2 D2 E2 F2 G2 A2 |]", "A2"]);
  await chord(k.page, ["Control"], "v");
  await k.page.waitForFunction(() => /G2 A2 G2 A2 \|\]/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual([await music(k.page), await ends2(k.page)], ["C2 D2 E2 F2 G2 A2 G2 A2 |]", [null, 7]]);
  assert.deepEqual(k.errors, []);
  await k.close();

  // At the open end of a voice: after its last note, and the cursor at the
  // end again.
  const g = await open({ text: notesDoc("C2 D2 E2"), scores: 1, clipboard: true });
  await pressMode(g.page);
  await clip(g.page, "G2 A2");
  await press(g.page, "ArrowRight", 3);
  assert.equal(await placeText(g.page), "");
  await chord(g.page, ["Control"], "v");
  await g.page.waitForFunction(() => /G2 A2/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual([await music(g.page), await placeText(g.page)], ["C2 D2 E2 G2 A2", ""]);
  await chord(g.page, ["Control"], "v");
  await g.page.waitForFunction(() => /G2 A2 G2 A2/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual([await music(g.page), await placeText(g.page)], ["C2 D2 E2 G2 A2 G2 A2", ""]);
  // Music that brings the barline the voice lacked leaves no open end to
  // stay at: the cursor is on the last note of it.
  await chord(g.page, ["Control"], "z");
  await clip(g.page, "B2 |");
  assert.equal(await placeText(g.page), "");
  await chord(g.page, ["Control"], "v");
  await g.page.waitForFunction(() => /A2 B2 \|/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual([await music(g.page), await placeText(g.page), await ends2(g.page)], ["C2 D2 E2 G2 A2 B2 |", "B2", [null, 5]]);
  await chord(g.page, ["Control"], "z");
  await clip(g.page, "G2 A2");
  // On its last note, and not at the end: after the note all the same, and
  // the cursor on the last note pasted, short of the end.
  await chord(g.page, ["Control"], "z");
  await g.page.keyboard.press("ArrowLeft");
  assert.equal(await placeText(g.page), "E2");
  await chord(g.page, ["Control"], "v");
  await g.page.waitForFunction(() => /E2 G2 A2/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual([await music(g.page), await placeText(g.page), await ends2(g.page)], ["C2 D2 E2 G2 A2", "A2", [null, 4]]);
  assert.deepEqual(g.errors, []);
  await g.close();
});

test("the copy of several voices is pasted into the voices of those names, each where the cursor's place ends, and the voices it does not name are left alone; one of no name goes into the cursor's (SM82)", { skip }, async () => {
  const source = CHORALE_SOURCE.replace("A4 |\ng2 d2", "z4 |\ng2 d2").replace("D,4 |\nD,2 G,2", "z4 |\nD,2 G,2");
  assert.notEqual(source, CHORALE_SOURCE);
  const h = await open({ text: ["Four voices.", "", "```abc", source, "```", ""].join("\n"), scores: 1, clipboard: true });
  await pressMode(h.page);
  const walk = ["Control", "Shift"];
  const lines = async () => (await staged(h.page)).split("\n").filter((line) => /\|/.test(line));
  const was = await lines();
  // The first bar of the first and the third voice, copied.
  await chord(h.page, walk, "Space");
  await chord(h.page, walk, "ArrowDown");
  await chord(h.page, walk, "ArrowDown");
  await chord(h.page, walk, "Space");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:S\nd2 B2\nV:T\nG,2 D,2"]);
  // To the rest that is the third bar of the first voice, and pasted: each
  // voice takes its own, after the rest it has there, where the cursor's
  // rest ends; the second voice, which shares the first's staff, and the
  // fourth are as they were.
  await h.page.keyboard.press("Escape");
  await press(h.page, "ArrowRight", 5);
  assert.equal(await placeText(h.page), "z4");
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction(() => /B G \| z4 d2 B2/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  const now = await lines();
  assert.deepEqual(now, [was[0].replace("z4", "z4 d2 B2"), was[1], was[2], was[3], was[4].replace("z4", "z4 G,2 D,2"), was[5], was[6], was[7]]);
  // The cursor is on the last of what its own voice took.
  assert.deepEqual([await placeText(h.page), (await stretch(h.page)).track], ["B2", 0]);
  // One step of the history for all of it.
  await chord(h.page, ["Control"], "z");
  assert.deepEqual(await lines(), was);
  await chord(h.page, ["Control"], "y");
  assert.deepEqual(await lines(), now);
  await chord(h.page, ["Control"], "z");
  // From the second voice the copy goes to the same two: it is the names
  // that say where, and the cursor's voice only when.
  await chord(h.page, ["Control"], "ArrowDown");
  assert.deepEqual([await placeText(h.page), (await stretch(h.page)).track], ["F4", 1]);
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction(() => /B G \| z4 d2 B2/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual(await lines(), now);
  // Its own voice took nothing, and the cursor is where it was.
  assert.deepEqual([await placeText(h.page), (await stretch(h.page)).track], ["F4", 1]);
  await chord(h.page, ["Control"], "z");
  // Two parts for one voice, the cursor's by having no name and by its
  // name, are a text this does not read.
  await clip(h.page, "d2\nV:A\nB2");
  await chord(h.page, ["Control"], "v");
  await sleep(150);
  assert.deepEqual([await notices(h.page), await lines()], [["Only music can be pasted here"], was]);
  // One voice copied is music with no name, and goes where the cursor is:
  // the first voice's two notes into the fourth.
  await chord(h.page, ["Control"], "ArrowUp");
  await press(h.page, "ArrowLeft", 6);
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["d2 B2"]);
  await h.page.keyboard.press("Escape");
  for (let i = 0; i < 3; i++) await chord(h.page, ["Control"], "ArrowDown");
  assert.deepEqual([await placeText(h.page), (await stretch(h.page)).track], ["B2", 3]);
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction(() => /d2 B2 d2 B2/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual(await lines(), was.slice(0, 6).concat([was[6].replace("d2 B2", "d2 B2 d2 B2"), was[7]]));
  assert.deepEqual(h.errors, []);
  await h.close();

  // Voices that do not move together: the other voice takes the music
  // after the place of its own that sounds as the cursor's ends, the last
  // to begin before that. Under the second quarter that is the whole note
  // the bar began with: the music goes in after it, in the same bar, and
  // not past the barline, before the next place to begin.
  const uneven = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | g a b c' |", "V:2 clef=bass", "C,4 | G,2 C,2 |"].join("\n");
  const u = await open({ text: pasteDoc(uneven), scores: 1, clipboard: true });
  await pressMode(u.page);
  await clip(u.page, "V:1\na'\nV:2\nC");
  await u.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(u.page), "d");
  await chord(u.page, ["Control"], "v");
  await u.page.waitForFunction(() => /d a' e/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.equal(await staged(u.page), uneven.replace("c d e f", "c d a' e f").replace("C,4 |", "C,4 C |"));
  await chord(u.page, ["Control"], "z");
  // Under the first quarter of the second bar the other voice begins a
  // half note: after the half, which is the one that sounds as the quarter
  // ends. Before the half is where it went while the music was put in
  // before the cursor's place.
  await press(u.page, "ArrowRight", 3);
  assert.equal(await placeText(u.page), "g");
  await chord(u.page, ["Control"], "v");
  await u.page.waitForFunction(() => /g a' a/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.equal(await staged(u.page), uneven.replace("g a b", "g a' a b").replace("G,2 C,2 |", "G,2 C C,2 |"));
  await chord(u.page, ["Control"], "z");
  await press(u.page, "ArrowRight", 3);
  assert.equal(await placeText(u.page), "c'");
  await chord(u.page, ["Control"], "v");
  await u.page.waitForFunction(() => /C,2 C \|/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.equal(await staged(u.page), uneven.replace("b c' |", "b c' a' |").replace("G,2 C,2 |", "G,2 C,2 C |"));
  assert.deepEqual(u.errors, []);
  await u.close();

  // A voice that begins nothing before the cursor's place ends takes the
  // music before its first place: its line opens later than the cursor's.
  const late = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f |", "V:2 clef=bass", "x2 C,2 |"].join("\n");
  const l = await open({ text: pasteDoc(late), scores: 1, clipboard: true });
  await pressMode(l.page);
  await clip(l.page, "V:1\na'\nV:2\nC");
  assert.equal(await placeText(l.page), "c");
  await chord(l.page, ["Control"], "v");
  await l.page.waitForFunction(() => /c a' d/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.equal(await staged(l.page), late.replace("c d e f", "c a' d e f").replace("x2 C,2", "x2 C C,2"));
  assert.deepEqual(l.errors, []);
  await l.close();
});

test("what cannot be pasted is not, and the score says why: a voice it has not, a text that is no music, music that would change what is beside it; an empty clipboard says nothing, and while the music sounds the key stops it (SM83)", { skip }, async () => {
  const eighths = ["X:2", "M:4/4", "L:1/8", "K:C", "z8 | c8 |]"].join("\n");
  const h = await open({ text: pasteDoc(PASTE_SOURCE) + ["", "```abc", eighths, "```", ""].join("\n"), scores: 2, clipboard: true });
  await listenSources(h.page);
  await pressMode(h.page);
  const sent = (await edits(h.page)).length;
  // A notice takes the place of the one before it, and stays three seconds:
  // where none is expected, the last one is waited out first.
  const tried = async (text, quiet) => {
    if (quiet) await sleep(3100);
    await clip(h.page, text);
    await chord(h.page, ["Control"], "v");
    await sleep(120);
    return notices(h.page);
  };
  assert.deepEqual(await tried("V:S\nd2 B2\nV:T\nG,2 D,2"), ["No voice of that name here"]);
  assert.deepEqual(await tried("X:1\nK:C\nc d"), ["Only music can be pasted here"]);
  assert.deepEqual(await tried("hello world"), ["Only music can be pasted here"]);
  assert.deepEqual(await tried("c>"), ["Can't keep the music as written"]);
  assert.deepEqual(await tried("(c d"), ["A slur starts or ends here"]);
  // A voice named, in a tune that names none.
  assert.deepEqual(await tried("c d\nV:1\ne f"), ["No voice of that name here"]);
  assert.deepEqual(await tried("", true), []);
  assert.deepEqual(await tried("  \n"), []);
  assert.equal(await music(h.page), "c d e f | z4 | g2 z2 |");
  assert.equal((await edits(h.page)).length, sent);
  // While the music sounds on the cursor's score: stopped, and nothing
  // pasted, as with the keys that write.
  await clip(h.page, "a b");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await chord(h.page, ["Control"], "v");
  await untilSounding(h.page, false);
  await sleep(150);
  assert.equal(await music(h.page), "c d e f | z4 | g2 z2 |");
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction(() => /a b/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  // What the mode copied under one unit is not pasted under another, where
  // every quarter would come out an eighth: the score pasted into says so.
  // The same notes typed elsewhere say nothing of their unit, and are read
  // in the one they land in.
  await chord(h.page, ["Shift"], "ArrowLeft");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["b"]);
  const other = await heads(h.page, 1);
  const rest = await h.page.evaluate(() => {
    const r = document.querySelectorAll("#app .mdm-score")[1].querySelector("svg .abcjs-rest").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await h.page.mouse.click(rest.x, rest.y);
  assert.equal(await placeText(h.page), "z8");
  await chord(h.page, ["Control"], "v");
  await sleep(150);
  assert.deepEqual([await h.page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-score")[1].querySelectorAll(".mdm-score-notice")).map((n) => n.textContent)), await stagedAt(h.page, 1)], [["Copied under another L:"], eighths]);
  assert.ok(other.length > 0);
  await clip(h.page, "e f");
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction(() => /e f/.test(document.querySelectorAll("#app .mdm-score")[1].getAttribute("data-mdm-source")));
  assert.equal((await stagedAt(h.page, 1)).split("\n").pop(), "z8 e f | c8 |]");
  // A clipboard that answers after the mode is left pastes nothing, and
  // puts no cursor down.
  await h.page.evaluate(() => {
    navigator.clipboard.readText = () => new Promise((done) => setTimeout(() => done("g a"), 200));
  });
  const kept = await docText(h.page);
  await chord(h.page, ["Control"], "v");
  await pressMode(h.page);
  await sleep(400);
  assert.deepEqual([await docText(h.page), await h.page.evaluate(() => window.__mdm.scoreCursor)], [kept, null]);
  await pressMode(h.page);
  await h.page.evaluate(() => {
    navigator.clipboard.readText = () => Promise.resolve(window.__clipboard);
  });
  // Out of the mode the key is the text's again, and nothing of the score's.
  await pressMode(h.page);
  const text = await docText(h.page);
  await chord(h.page, ["Control"], "v");
  await sleep(200);
  assert.equal(await docText(h.page), text);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Voices that do not move together: a whole note under four quarters, and
// an upper voice no barline closes. The stretch is counted in the voice it
// was drawn out in, and the place of another voice that goes with one of
// its own is the one sounding with it, which is not always the nearest
// across: past the last quarter the nearest was the open end of the voice.
const UNEVEN_SOURCE = ["X:1", "M:4/4", "L:1/4", "Q:1/4=120", "K:C", "V:1", "c d e f | g a b c'", "V:2 clef=bass", "C,4 | G,2 C,2 |"].join("\n");

test("the stretch stays in the voice it was drawn out in while the cursor walks the others, which it does by what sounds together; the open end is no place of a stretch (SM75)", { skip }, async () => {
  const h = await open({ text: ["Uneven.", "", "```abc", UNEVEN_SOURCE, "```", ""].join("\n"), scores: 1, clipboard: true });
  await listenSources(h.page);
  await h.page.evaluate(() => {
    window.__heard = [];
    window.addEventListener("keydown", (e) => window.__heard.push(e.key));
  });
  const heard = () => h.page.evaluate(() => window.__heard.splice(0));
  await pressMode(h.page);
  const walk = ["Control", "Shift"];
  // From the fourth quarter, the voice below is at its whole note, and back
  // up from the whole note the upper voice is at the quarter it began with.
  await press(h.page, "ArrowRight", 3);
  assert.equal(await placeText(h.page), "f");
  await chord(h.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(h.page), "C,4");
  await chord(h.page, ["Control"], "ArrowUp");
  assert.equal(await placeText(h.page), "c");
  // A stretch of the last two quarters, and the walk down with it kept: the
  // cursor is on the whole note, the stretch where it was.
  await press(h.page, "ArrowRight", 2);
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await stretch(h.page), { voices: null, anchor: 2, stop: 3, track: 0, bands: [[0]] });
  await chord(h.page, walk, "ArrowDown");
  assert.equal(await placeText(h.page), "C,4");
  assert.deepEqual(await stretch(h.page), { voices: [0], anchor: 2, stop: 0, track: 1, bands: [[0]] });
  const wash = await selection(h.page);
  // The lower voice picked: its whole note began before the stretch and
  // sounds under it, so it is in it (the owner's call of 2026-10-06, SM102;
  // until then Space here picked a voice and nothing was seen of it). Its
  // staff has a band of its own, as wide as the upper voice's and no wider,
  // and the copy is both voices'.
  await chord(h.page, walk, "Space");
  assert.deepEqual((await stretch(h.page)).voices, [0, 1]);
  const both = (await selection(h.page)).bands;
  assert.deepEqual([both.length, both[0], [both[1].left, both[1].right], (await inked(h.page)).length], [2, wash.bands[0], [wash.bands[0].left, wash.bands[0].right], 3]);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:1\ne f\nV:2\nC,4"]);
  // Played from down there, it is the stretch that sounds, from its e, the
  // third quarter at 120: one second in.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.ok(Math.abs((await lastStart(h.page)) - 1) < 0.03, "the stretch sounded from " + (await lastStart(h.page)));
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  assert.deepEqual((await stretch(h.page)).voices, [0, 1]);
  // Shift and a click, with the cursor away, stretch the upper voice from
  // the end the stretch had: the anchor is its own voice's.
  const hs = await heads(h.page, 0);
  const st = await staves(h.page, 0);
  const upper = hs.filter((p) => p.y < st[0].bottom + 10).sort((a, b) => a.x - b.x);
  await h.page.keyboard.down("Shift");
  await h.page.mouse.click(upper[0].x, upper[0].y);
  await h.page.keyboard.up("Shift");
  assert.deepEqual(await stretch(h.page), { voices: null, anchor: 2, stop: 0, track: 0, bands: [[0]] });
  await h.page.keyboard.press("Escape");
  // Back from the walk, the cursor is on the place it left, and the stretch
  // is drawn out from there.
  await press(h.page, "ArrowRight", 2);
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, walk, "ArrowDown");
  await chord(h.page, walk, "ArrowUp");
  assert.equal(await placeText(h.page), "f");
  await chord(h.page, walk, "ArrowDown");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.equal(await placeText(h.page), "g");
  assert.deepEqual(await stretch(h.page), { voices: [0], anchor: 2, stop: 4, track: 0, bands: [[0]] });
  // Escape lets the stretch go, and the walk with it.
  await chord(h.page, walk, "ArrowDown");
  await heard();
  await h.page.keyboard.press("Escape");
  assert.deepEqual(await heard(), []);
  assert.deepEqual(await h.page.evaluate(() => [window.__mdm.scoreCursor.anchor, window.__mdm.scoreCursor.home, window.__mdm.scoreCursor.track]), [null, null, 1]);
  // With nothing picked there is nothing chosen, and the voice above is
  // Ctrl+Up's: Up and Down with Shift leave it so, and are the arrows
  // alone; Escape is not the mode's, and the copy is the place the cursor
  // stands on.
  await chord(h.page, ["Control"], "ArrowUp");
  const height = (await cursor(h.page)).step;
  await chord(h.page, ["Shift"], "ArrowUp");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).anchor, (await stretch(h.page)).bands, (await cursor(h.page)).step], [null, null, null, height + 1]);
  await heard();
  await h.page.keyboard.press("Escape");
  assert.deepEqual(await heard(), ["Escape"]);
  assert.equal(await placeText(h.page), "g");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["g"]);
  // Ctrl+Shift across from there is drawn out in the voice the cursor
  // walked to, over every voice, as it is with none picked.
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).track, await placeText(h.page)], ["all", 0, "g"]);
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).track, await placeText(h.page)], ["all", 0, "a"]);
  await h.page.keyboard.press("Escape");
  // To the open end of the upper voice, where nothing stands: nothing to
  // copy there, with no word from the score, and nothing for Shift and
  // Right to choose.
  await press(h.page, "ArrowRight", 8);
  assert.equal(await placeText(h.page), "");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual([await copied(h.page), await notices(h.page)], [[], []]);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await selection(h.page), (await stretch(h.page)).anchor, await placeText(h.page)], [null, null, ""]);
  // Shift and Left from there choose the last note of the voice, which the
  // cursor comes onto, and the wash stops at the note; drawn out to the
  // right again the stretch stays on its last note and never takes in the
  // end.
  await chord(h.page, ["Shift"], "ArrowLeft");
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop, await placeText(h.page)], [7, 7, "c'"]);
  const toEnd = await selection(h.page);
  assert.equal(toEnd.bands.length, 1);
  assert.ok(toEnd.bands[0].right < st[0].right, "the wash runs " + (toEnd.bands[0].right - st[0].right) + " past the staff");
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop, await placeText(h.page)], [7, 7, "c'"]);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["c'"]);
  await chord(h.page, ["Shift"], "ArrowLeft");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["b c'"]);
  // From the open end the voice below is at its last place, and picked
  // there it is that place, the stretch beginning where the pick does.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "c'");
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "");
  await chord(h.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(h.page), "C,2");
  await chord(h.page, walk, "Space");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).bands, await inked(h.page)], [[1], [[1]], ["v1 l0 m1 n1"]]);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["C,2"]);
  // With that to keep, the walk up is to the place of the upper voice that
  // sounds with it, and the stretch stays below.
  await chord(h.page, walk, "ArrowUp");
  assert.equal(await placeText(h.page), "b");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).bands], [[1], [[1]]]);
  // And nothing is picked at the open end itself, where nothing sounds.
  await h.page.keyboard.press("Escape");
  await press(h.page, "ArrowRight", 2);
  assert.equal(await placeText(h.page), "");
  await chord(h.page, walk, "Space");
  assert.deepEqual([(await stretch(h.page)).voices, (await stretch(h.page)).anchor, await inked(h.page)], [null, null, []]);
  assert.deepEqual(h.errors, []);
  await h.close();
  // A voice that begins its line with a rest nobody sees has no place under
  // the first notes of the other: the cursor goes to its first.
  const late = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f |", "V:2", "x2 E F |"].join("\n");
  const g = await open({ text: ["Late.", "", "```abc", late, "```", ""].join("\n"), scores: 1 });
  await pressMode(g.page);
  assert.equal(await placeText(g.page), "c");
  await chord(g.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(g.page), "E");
  assert.deepEqual(g.errors, []);
  await g.close();

  // A voice that has ended before the stretch's head sounds is walked to
  // at its open end, and is picked there all the same: it is a voice that
  // is picked, and the note of it that begins inside the stretch is in it.
  // Until 2026-10-06 Space did nothing at an open end, stretch or no
  // stretch, and with the stretch drawn out from the left this voice could
  // not be had (from the right it could, the head then sounding with its
  // note): read off the code by a review, and seen here.
  const short = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | g2", "V:2 clef=bass", "C,4 | G, A, B, C |"].join("\n");
  const s = await open({ text: ["A voice that ends early.", "", "```abc", short, "```", ""].join("\n"), scores: 1, clipboard: true });
  await pressMode(s.page);
  await chord(s.page, ["Control"], "ArrowDown");
  await s.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(s.page), "G,");
  for (let i = 0; i < 4; i++) await chord(s.page, ["Shift"], "ArrowRight");
  await chord(s.page, walk, "ArrowUp");
  assert.deepEqual([await placeText(s.page), (await stretch(s.page)).track, (await stretch(s.page)).voices], ["", 0, [1]]);
  await chord(s.page, walk, "Space");
  assert.deepEqual([(await stretch(s.page)).voices, await inked(s.page)], [[0, 1], ["v0 l0 m1 n0", "v1 l0 m1 n0", "v1 l0 m1 n1", "v1 l0 m1 n2", "v1 l0 m1 n3"]]);
  await chord(s.page, ["Control"], "c");
  assert.deepEqual(await copied(s.page), ["V:1\ng2\nV:2\nG, A, B, C"]);
  // And let go of from there as it was picked.
  await chord(s.page, walk, "Space");
  assert.deepEqual([(await stretch(s.page)).voices, (await inked(s.page)).length], [[1], 4]);
  assert.deepEqual(s.errors, []);
  await s.close();
});

// The owner's report of 2026-10-04, "la selección de una única nota (e.g.,
// una negra) no está implementada", and their pick of how one is chosen (A
// of the two put to them): the first Shift with an arrow chooses the place
// the cursor stands on, where it used to take the place beside it as well.
// And their call of the same day for the cursor: "al seleccionar con shift
// (o cualquiera de sus variantes) o arrastrando el cursor, el cuadradito
// debe desaparecer durante la selección".
// The anchor and the place the model holds for the cursor.
const ends2 = (page) => page.evaluate(() => [typeof window.__mdm.scoreCursor.anchor === "number" ? window.__mdm.scoreCursor.anchor : null, window.__mdm.scoreCursor.stop]);

test("the first Shift with Left or Right chooses the place the cursor stands on, and each one after it a place more; the cursor is not drawn while a stretch is chosen; an arrow across lets it go and leaves the cursor on its end that side (SM85)", { skip }, async () => {
  const h = await open({ text: notesDoc("c2 d2 e2 f2 | g2 a2 z2 b2 |]"), scores: 1, clipboard: true });
  await pressMode(h.page);
  await press(h.page, "ArrowRight", 2);
  assert.deepEqual([await placeText(h.page), await cursorShown(h.page)], ["e2", true]);
  // One press, to the right or to the left: the note the cursor is on and
  // no other, washed over one column, in the ink, and the cursor out of
  // sight. Escape gives the cursor back where it was.
  for (const key of ["ArrowRight", "ArrowLeft"]) {
    await chord(h.page, ["Shift"], key);
    assert.deepEqual([await ends2(h.page), await inked(h.page), await cursorShown(h.page)], [[2, 2], ["v0 l0 m0 n2"], false], key);
    const bands = (await selection(h.page)).bands;
    assert.equal(bands.length, 1);
    assert.ok(bands[0].right - bands[0].left < 30, "the wash of one place is " + (bands[0].right - bands[0].left) + " wide");
    await chord(h.page, ["Control"], "c");
    assert.deepEqual(await copied(h.page), ["e2"]);
    await h.page.keyboard.press("Escape");
    assert.deepEqual([await ends2(h.page), await inked(h.page), await cursorShown(h.page), await placeText(h.page)], [[null, 2], [], true, "e2"], key);
    assert.equal(await selection(h.page), null);
  }
  // A rest is chosen as a note is.
  await press(h.page, "ArrowRight", 4);
  assert.equal(await placeText(h.page), "z2");
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await ends2(h.page), await inked(h.page)], [[6, 6], ["v0 l0 m1 n2"]]);
  await h.page.keyboard.press("Escape");
  await press(h.page, "ArrowLeft", 4);
  // Each press after the first takes a place more, and gives it back the
  // other way, down to the one place and out past it on the other side.
  for (let i = 0; i < 3; i++) await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await ends2(h.page), await inked(h.page)], [[2, 4], ["v0 l0 m0 n2", "v0 l0 m0 n3", "v0 l0 m1 n0"]]);
  await chord(h.page, ["Shift"], "ArrowLeft");
  assert.deepEqual(await ends2(h.page), [2, 3]);
  await chord(h.page, ["Shift"], "ArrowLeft");
  assert.deepEqual([await ends2(h.page), await inked(h.page), await cursorShown(h.page)], [[2, 2], ["v0 l0 m0 n2"], false]);
  await chord(h.page, ["Shift"], "ArrowLeft");
  assert.deepEqual([await ends2(h.page), await inked(h.page)], [[2, 1], ["v0 l0 m0 n1", "v0 l0 m0 n2"]]);
  // An arrow with no Shift lets the stretch go and leaves the cursor on
  // its first place, or on its last: no place further, the cursor having
  // been out of sight.
  await h.page.keyboard.press("ArrowLeft");
  assert.deepEqual([await ends2(h.page), await placeText(h.page), await cursorShown(h.page), await selection(h.page)], [[null, 1], "d2", true, null]);
  for (let i = 0; i < 3; i++) await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(h.page), [1, 3]);
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([await ends2(h.page), await placeText(h.page), await cursorShown(h.page)], [[null, 3], "f2", true]);
  // Drawn out leftwards the ends are the same two.
  for (let i = 0; i < 3; i++) await chord(h.page, ["Shift"], "ArrowLeft");
  assert.deepEqual(await ends2(h.page), [3, 1]);
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([await ends2(h.page), await placeText(h.page)], [[null, 3], "f2"]);
  for (let i = 0; i < 3; i++) await chord(h.page, ["Shift"], "ArrowLeft");
  await h.page.keyboard.press("ArrowLeft");
  assert.deepEqual([await ends2(h.page), await placeText(h.page)], [[null, 1], "d2"]);
  // Up and Down. With Shift and nothing chosen they are the arrows alone,
  // and choose nothing; with a stretch chosen they do nothing, a height
  // nobody sees being nothing to move; without Shift they let the stretch
  // go, and the cursor is back where it was, a step up or down.
  const step = (await cursor(h.page)).step;
  await chord(h.page, ["Shift"], "ArrowUp");
  assert.deepEqual([await ends2(h.page), (await cursor(h.page)).step, await selection(h.page)], [[null, 1], step + 1, null]);
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowDown");
  await chord(h.page, ["Shift"], "ArrowUp");
  await chord(h.page, ["Shift"], "ArrowUp");
  assert.deepEqual([await ends2(h.page), (await cursor(h.page)).step, await cursorShown(h.page)], [[1, 2], step + 1, false]);
  await h.page.keyboard.press("ArrowDown");
  assert.deepEqual([await ends2(h.page), (await cursor(h.page)).step, await cursorShown(h.page), await placeText(h.page)], [[null, 2], step, true, "e2"]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // At the open end of a voice nothing stands: Shift with Right chooses
  // nothing there, Shift with Left the last place of the voice, and a
  // stretch drawn out to the right stops on that place.
  const g = await open({ text: notesDoc("c2 d2 e2"), scores: 1 });
  await pressMode(g.page);
  await press(g.page, "ArrowRight", 3);
  assert.equal(await placeText(g.page), "");
  const end = await cursor(g.page);
  await chord(g.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await ends2(g.page), await selection(g.page), await cursorShown(g.page)], [[null, 3], null, true]);
  // Nor is it chosen by a double click, the cursor staying in sight there:
  // with nothing chosen, Escape is not the mode's, and goes on to the page.
  await g.page.mouse.click(end.x, end.stepY, { count: 2 });
  assert.deepEqual([(await ends2(g.page))[1], await selection(g.page), await inked(g.page), await cursorShown(g.page), await placeText(g.page)], [3, null, [], true, ""]);
  await g.page.evaluate(() => {
    window.__escapes = 0;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") window.__escapes++;
    });
  });
  await g.page.keyboard.press("Escape");
  assert.equal(await g.page.evaluate(() => window.__escapes), 1);
  await chord(g.page, ["Shift"], "ArrowLeft");
  assert.deepEqual([await ends2(g.page), await inked(g.page), await placeText(g.page)], [[2, 2], ["v0 l0 m0 n2"], "e2"]);
  await chord(g.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(g.page), [2, 2]);
  await g.page.keyboard.press("Escape");
  await press(g.page, "ArrowLeft", 1);
  for (let i = 0; i < 4; i++) await chord(g.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await ends2(g.page), await inked(g.page)], [[1, 2], ["v0 l0 m0 n1", "v0 l0 m0 n2"]]);
  // And an arrow to the right from it leaves the cursor on its last place,
  // not on the end past it.
  await g.page.keyboard.press("ArrowRight");
  assert.deepEqual([await ends2(g.page), await placeText(g.page)], [[null, 2], "e2"]);
  // A drag can take the stretch's end onto the open end, which adds
  // nothing to it; the arrow then leaves the cursor on the last note too.
  const first = (await heads(g.page, 0)).sort((a, b) => a.x - b.x)[0];
  await g.page.mouse.move(first.x, first.y);
  await g.page.mouse.down();
  await g.page.mouse.move(end.x, end.stepY, { steps: 6 });
  await g.page.mouse.up();
  assert.deepEqual([await ends2(g.page), (await inked(g.page)).length], [[0, 3], 3]);
  await g.page.keyboard.press("ArrowRight");
  assert.deepEqual([await ends2(g.page), await placeText(g.page)], [[null, 2], "e2"]);
  assert.deepEqual(g.errors, []);
  await g.close();
});

// The one place the cursor is still drawn at with a stretch chosen, which
// the owner took with the note that it is an asymmetry to come back to
// (2026-10-04): the walk over the voices, where it says which voice Space
// would pick.
test("while it walks the voices with a stretch kept the cursor is drawn, on the voice Space would pick, and it steps aside again as the stretch is drawn out; with every voice let go it is drawn where it stands (SM86)", { skip }, async () => {
  const h = await open({ text: TRIO, scores: 1 });
  await pressMode(h.page);
  const walk = ["Control", "Shift"];
  await press(h.page, "ArrowRight", 4);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await placeText(h.page), await cursorShown(h.page), (await stretch(h.page)).bands], ["g", false, [[0]]]);
  // Down with the stretch kept: on the second voice, and seen there.
  await chord(h.page, walk, "ArrowDown");
  assert.deepEqual([await placeText(h.page), await cursorShown(h.page), (await stretch(h.page)).voices], ["B", true, [0]]);
  await chord(h.page, walk, "Space");
  assert.deepEqual([await cursorShown(h.page), (await stretch(h.page)).voices], [true, [0, 1]]);
  // Back up on the voice the stretch was drawn out in, the walk still on.
  await chord(h.page, walk, "ArrowUp");
  assert.deepEqual([await placeText(h.page), await cursorShown(h.page)], ["g", true]);
  // Drawn out, the walk is over and the cursor aside.
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual([await cursorShown(h.page), (await stretch(h.page)).voices, (await stretch(h.page)).stop], [false, [0, 1], 5]);
  await chord(h.page, walk, "ArrowDown");
  assert.equal(await cursorShown(h.page), true);
  await h.page.keyboard.press("Escape");
  assert.deepEqual([await cursorShown(h.page), await selection(h.page)], [true, null]);
  // Picked where the cursor stands, with no walk yet, the place is chosen
  // and the cursor aside; let go of there, nothing is chosen, and the
  // cursor is drawn.
  await chord(h.page, walk, "Space");
  assert.deepEqual([await cursorShown(h.page), (await stretch(h.page)).voices, (await inked(h.page)).length], [false, [1], 1]);
  await chord(h.page, walk, "Space");
  assert.deepEqual([await cursorShown(h.page), (await stretch(h.page)).voices, await inked(h.page)], [true, [], []]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's ask of 2026-10-04: "ctrl shift y selección arrastrando el
// cursor debería seleccionar todas las partituras como mismo ctrl shift ->
// -> las selecciona". And my pick for one place with the pointer, a double
// click, beside theirs for the keys.
test("with the pointer: a press drawn sideways on its place chooses it, and so does a double click; a drag back to the place pressed leaves it chosen, Ctrl+Shift with a drag chooses every voice from the place pressed, and Shift with a click draws the stretch out from the cursor (SM87)", { skip }, async () => {
  const h = await open({ text: TRIO, scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  const st = await staves(h.page, 0);
  const row = (i) => hs.filter((p) => p.y > st[i].top - 30 && p.y < st[i].bottom + 12).sort((a, b) => a.x - b.x);
  const top = row(0);
  const mid = row(1);
  assert.deepEqual([top.length, mid.length], [8, 8]);
  // A press let go where it was made puts the cursor down and chooses
  // nothing, a hand that shook on the note or not.
  await h.page.mouse.click(top[1].x, top[1].y);
  assert.deepEqual([await stretch(h.page), await cursorShown(h.page)], [{ voices: null, anchor: null, stop: 1, track: 0, bands: null }, true]);
  await h.page.mouse.move(top[2].x, top[2].y);
  await h.page.mouse.down();
  await h.page.mouse.move(top[2].x + 2, top[2].y + 1);
  await h.page.mouse.move(top[2].x - 1, top[2].y);
  await h.page.mouse.up();
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop, await selection(h.page)], [null, 2, null]);
  // A double click chooses the place, and the cursor steps aside.
  await h.page.mouse.click(top[1].x, top[1].y, { count: 2 });
  assert.deepEqual([await stretch(h.page), await inked(h.page), await cursorShown(h.page)], [{ voices: null, anchor: 1, stop: 1, track: 0, bands: [[0]] }, ["v0 l0 m0 n1"], false]);
  // With a hand that shook on the second press, a staff step up the note,
  // it is chosen all the same.
  await h.page.mouse.click(top[4].x, top[4].y);
  await h.page.mouse.down({ clickCount: 2 });
  const stood = (await cursor(h.page)).step;
  await h.page.mouse.move(top[4].x + 2, top[4].y - 9, { steps: 3 });
  await h.page.mouse.up({ clickCount: 2 });
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop, await inked(h.page), (await cursor(h.page)).step], [4, 4, ["v0 l0 m1 n0"], stood]);
  // The same shake on a first press moves the cursor's height and chooses
  // nothing.
  await h.page.keyboard.press("Escape");
  await h.page.mouse.move(top[4].x, top[4].y);
  await h.page.mouse.down();
  await h.page.mouse.move(top[4].x + 2, top[4].y - 9, { steps: 3 });
  await h.page.mouse.up();
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop, (await cursor(h.page)).step > stood], [null, 4, true]);
  // Drawn sideways on the note pressed, by more than a hand shakes on a
  // click, the press chooses that note, as the first Shift with an arrow
  // does (the owner's call of 2026-10-06, "la selección de 1 sola nota
  // shift -> debe funcionar también haciendo la selección con el mouse"):
  // the pointer has not left the note.
  await h.page.keyboard.press("Escape");
  await h.page.mouse.move(top[2].x, top[2].y);
  await h.page.mouse.down();
  await h.page.mouse.move(top[2].x + 3, top[2].y);
  assert.deepEqual([(await stretch(h.page)).anchor, await selection(h.page), await cursorShown(h.page)], [null, null, true]);
  await h.page.mouse.move(top[2].x + 5, top[2].y + 1);
  assert.deepEqual([await stretch(h.page), await inked(h.page), await cursorShown(h.page)], [{ voices: null, anchor: 2, stop: 2, track: 0, bands: [[0]] }, ["v0 l0 m0 n2"], false]);
  // Brought back under the press it stays chosen, and drawn on, each place
  // the pointer comes over is one more.
  await h.page.mouse.move(top[2].x, top[2].y);
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop], [2, 2]);
  await h.page.mouse.move(top[3].x, top[3].y, { steps: 4 });
  await h.page.mouse.up();
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop, await inked(h.page)], [2, 3, ["v0 l0 m0 n2", "v0 l0 m0 n3"]]);
  // To the left as well, and let go on it: that one note.
  await h.page.mouse.move(top[5].x, top[5].y);
  await h.page.mouse.down();
  await h.page.mouse.move(top[5].x - 6, top[5].y, { steps: 3 });
  await h.page.mouse.up();
  assert.deepEqual([await stretch(h.page), await inked(h.page), await cursorShown(h.page)], [{ voices: null, anchor: 5, stop: 5, track: 0, bands: [[0]] }, ["v0 l0 m1 n1"], false]);
  // Drawn further up the note than across it, the press moves the cursor's
  // height as it did, and chooses nothing.
  await h.page.keyboard.press("Escape");
  await h.page.mouse.move(top[4].x, top[4].y);
  await h.page.mouse.down();
  await h.page.mouse.move(top[4].x + 5, top[4].y - 14, { steps: 3 });
  await h.page.mouse.up();
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop, await selection(h.page), (await cursor(h.page)).step > stood], [null, 4, null, true]);
  // Taken over another place the stretch is drawn out to it, however far
  // under the staff the pointer went on its way: further down than across.
  await h.page.mouse.move(top[1].x, top[1].y);
  await h.page.mouse.down();
  await h.page.mouse.move(top[2].x, top[2].y + 70, { steps: 5 });
  await h.page.mouse.up();
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop, (await stretch(h.page)).track, await inked(h.page)], [1, 2, 0, ["v0 l0 m0 n1", "v0 l0 m0 n2"]]);
  await h.page.keyboard.press("Escape");
  // With Ctrl+Shift held it is chosen over every voice: what sounds while
  // it does, the whole note of the third voice with it, begun before
  // (SM102).
  await h.page.keyboard.down("Control");
  await h.page.keyboard.down("Shift");
  await h.page.mouse.move(mid[2].x, mid[2].y);
  await h.page.mouse.down();
  await h.page.mouse.move(mid[2].x + 6, mid[2].y, { steps: 2 });
  await h.page.mouse.up();
  await h.page.keyboard.up("Shift");
  await h.page.keyboard.up("Control");
  assert.deepEqual([await stretch(h.page), (await inked(h.page)).length], [{ voices: "all", anchor: 2, stop: 2, track: 1, bands: [[0, 1, 2]] }, 3]);
  // Held on its second press and moved, it is drawn out from that place.
  await h.page.mouse.click(top[1].x, top[1].y);
  await h.page.mouse.down({ clickCount: 2 });
  await h.page.mouse.move(top[3].x, top[3].y, { steps: 4 });
  await h.page.mouse.up({ clickCount: 2 });
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop], [1, 3]);
  // A drag taken to the next place and back to the one pressed leaves that
  // one place chosen.
  await h.page.mouse.move(top[5].x, top[5].y);
  await h.page.mouse.down();
  await h.page.mouse.move(top[6].x, top[6].y, { steps: 4 });
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop, await cursorShown(h.page)], [5, 6, false]);
  await h.page.mouse.move(top[5].x, top[5].y, { steps: 4 });
  await h.page.mouse.up();
  assert.deepEqual([await stretch(h.page), await inked(h.page)], [{ voices: null, anchor: 5, stop: 5, track: 0, bands: [[0]] }, ["v0 l0 m1 n1"]]);
  // The place a drag takes the cursor onto gives the figure kept, as one an
  // arrow takes it onto does: from the whole note of the third voice to its
  // half, which is where the cursor is when the stretch is let go.
  const low = row(2);
  assert.equal(low.length, 3);
  await h.page.mouse.move(low[0].x, low[0].y);
  await h.page.mouse.down();
  assert.equal(await kept(h.page), 1);
  await h.page.mouse.move(low[1].x, low[1].y, { steps: 4 });
  await h.page.mouse.up();
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop, (await stretch(h.page)).track, await kept(h.page)], [0, 1, 2, 0.5]);
  // Ctrl+Shift and a drag: every voice, from the place pressed and not
  // from the cursor, which is in another voice. Nothing changes at the
  // press, a press with Shift being a click until it moves.
  await h.page.keyboard.press("Escape");
  await h.page.mouse.click(top[0].x, top[0].y);
  await h.page.keyboard.down("Control");
  await h.page.keyboard.down("Shift");
  await h.page.mouse.move(mid[2].x, mid[2].y);
  await h.page.mouse.down();
  assert.deepEqual(await stretch(h.page), { voices: null, anchor: null, stop: 0, track: 0, bands: null });
  await h.page.mouse.move(mid[5].x, mid[5].y, { steps: 6 });
  await h.page.mouse.up();
  await h.page.keyboard.up("Shift");
  await h.page.keyboard.up("Control");
  assert.deepEqual([await stretch(h.page), await cursorShown(h.page)], [{ voices: "all", anchor: 2, stop: 5, track: 1, bands: [[0, 1, 2]] }, false]);
  // Four places of each of the upper voices, and both notes of the third:
  // the half note that begins inside the stretch, and the whole note begun
  // before it, which sounds under its first two places (SM102).
  assert.equal((await inked(h.page)).length, 10);
  // Shift alone and a drag is a drag like any other: the voice it began
  // in. And so is Ctrl alone.
  for (const key of ["Shift", "Control"]) {
    await h.page.keyboard.press("Escape");
    await h.page.mouse.click(top[0].x, top[0].y);
    await h.page.keyboard.down(key);
    await h.page.mouse.move(mid[1].x, mid[1].y);
    await h.page.mouse.down();
    await h.page.mouse.move(mid[3].x, mid[3].y, { steps: 4 });
    await h.page.mouse.up();
    await h.page.keyboard.up(key);
    assert.deepEqual(await stretch(h.page), { voices: null, anchor: 1, stop: 3, track: 1, bands: [[1]] }, key);
  }
  // Shift and a click draw the stretch out from the cursor, in its voice,
  // and with Ctrl as well over every voice; on the cursor's own place they
  // choose that place.
  await h.page.keyboard.press("Escape");
  await h.page.mouse.click(top[1].x, top[1].y);
  await h.page.keyboard.down("Shift");
  await h.page.mouse.click(top[3].x, top[3].y);
  await h.page.keyboard.up("Shift");
  assert.deepEqual(await stretch(h.page), { voices: null, anchor: 1, stop: 3, track: 0, bands: [[0]] });
  await h.page.keyboard.press("Escape");
  await h.page.mouse.click(top[1].x, top[1].y);
  await h.page.keyboard.down("Control");
  await h.page.keyboard.down("Shift");
  await h.page.mouse.click(top[3].x, top[3].y);
  await h.page.keyboard.up("Shift");
  await h.page.keyboard.up("Control");
  assert.deepEqual(await stretch(h.page), { voices: "all", anchor: 1, stop: 3, track: 0, bands: [[0, 1, 2]] });
  await h.page.keyboard.press("Escape");
  await h.page.mouse.click(top[2].x, top[2].y);
  await h.page.keyboard.down("Shift");
  await h.page.mouse.click(top[2].x, top[2].y);
  await h.page.keyboard.up("Shift");
  assert.deepEqual(await stretch(h.page), { voices: null, anchor: 2, stop: 2, track: 0, bands: [[0]] });
  // A hand that shakes on a click with Shift has clicked: the stretch is
  // drawn out from the cursor, and the cursor has not jumped to the press.
  await h.page.keyboard.press("Escape");
  await h.page.mouse.click(top[1].x, top[1].y);
  await h.page.keyboard.down("Shift");
  await h.page.mouse.move(top[4].x, top[4].y);
  await h.page.mouse.down();
  await h.page.mouse.move(top[4].x + 2, top[4].y - 3);
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop], [null, 1]);
  await h.page.mouse.up();
  await h.page.keyboard.up("Shift");
  assert.deepEqual([(await stretch(h.page)).anchor, (await stretch(h.page)).stop], [1, 4]);
  // The mode left with a press of Shift still held: nothing is drawn out.
  await h.page.keyboard.press("Escape");
  await h.page.keyboard.down("Shift");
  await h.page.mouse.move(top[6].x, top[6].y);
  await h.page.mouse.down();
  await h.page.evaluate(() => document.querySelector('#app .mdm-toolbar button[data-type="mdm-score-navigation"]').click());
  await h.page.mouse.up();
  await h.page.keyboard.up("Shift");
  assert.equal(await h.page.evaluate(() => window.__mdm.scoreCursor), null);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's calls of 2026-10-04 for the keys with a stretch chosen: "3A se
// borra toda la selección, y para si alguien quiere sustituir el tramo
// elegido por silencio, haz que al marcar 0 todas las notas del tramo
// elegido se sustituyen por su silencio".
test("Delete with a stretch chosen takes the stretch out of every voice it is chosen over, the cursor comes back where it began, and undo gives it back chosen; what cannot go says why (SM88)", { skip }, async () => {
  const line = "c2 d2 e2 f2 | g2 a2 b2 c'2 | d'8 |]";
  const h = await open({ text: notesDoc(line), scores: 1 });
  await pressMode(h.page);
  await h.page.keyboard.press("ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  const sent = (await edits(h.page)).length;
  // Two notes inside a bar: gone, with their time, and the cursor on what
  // came into their place. A key held down is one press.
  await h.page.keyboard.down("Delete");
  await h.page.keyboard.down("Delete");
  await h.page.keyboard.up("Delete");
  assert.equal(await music(h.page), "c2 f2 | g2 a2 b2 c'2 | d'8 |]");
  assert.deepEqual([await ends2(h.page), await placeText(h.page), await cursorShown(h.page), await selection(h.page)], [[null, 1], "f2", true, null]);
  assert.equal((await edits(h.page)).length, sent + 1);
  assert.equal(await docText(h.page), notesDoc("c2 f2 | g2 a2 b2 c'2 | d'8 |]"));
  // Undo gives the stretch back, chosen as it was.
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await ends2(h.page), await inked(h.page), await cursorShown(h.page)], [line, [1, 2], ["v0 l0 m0 n1", "v0 l0 m0 n2"], false]);
  // Backspace takes the same out, and leaves the cursor on the place to
  // the left of where the stretch began (SM101).
  await h.page.keyboard.press("Backspace");
  assert.deepEqual([await music(h.page), await ends2(h.page), await placeText(h.page), await cursorShown(h.page)], ["c2 f2 | g2 a2 b2 c'2 | d'8 |]", [null, 0], "c2", true]);
  await chord(h.page, ["Control"], "z");
  // Across a barline the barline goes with it; a whole bar goes with one of
  // its barlines.
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(h.page), [1, 4]);
  await h.page.keyboard.press("Delete");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["c2 a2 b2 c'2 | d'8 |]", "a2"]);
  await chord(h.page, ["Control"], "z");
  await h.page.keyboard.press("Escape");
  assert.equal(await placeText(h.page), "g2");
  for (let i = 0; i < 4; i++) await chord(h.page, ["Shift"], "ArrowRight");
  await h.page.keyboard.press("Delete");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["c2 d2 e2 f2 | d'8 |]", "d'8"]);
  await chord(h.page, ["Control"], "z");
  // One place chosen goes whatever the height the cursor was at, where
  // Delete on a note with the cursor on it wants its head (SM55).
  await h.page.keyboard.press("Escape");
  await toStep(h.page, 3);
  await chord(h.page, ["Shift"], "ArrowLeft");
  await h.page.keyboard.press("Delete");
  assert.deepEqual([await music(h.page), await placeText(h.page)], ["c2 d2 e2 f2 | g2 a2 b2 | d'8 |]", "d'8"]);
  await chord(h.page, ["Control"], "z");
  // The whole of the voice stays, and the score says why, over the stretch
  // still chosen.
  await h.page.keyboard.press("Escape");
  await press(h.page, "ArrowLeft", 9);
  for (let i = 0; i < 9; i++) await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(h.page), [0, 8]);
  const before = (await edits(h.page)).length;
  await h.page.keyboard.press("Delete");
  assert.deepEqual([await music(h.page), await notices(h.page), await ends2(h.page), (await edits(h.page)).length], [line, ["Nothing would be left"], [0, 8], before]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // Half a slur: not taken out, and said.
  const g = await open({ text: notesDoc("c2 (d2 e2) f2 |]"), scores: 1 });
  await pressMode(g.page);
  await g.page.keyboard.press("ArrowRight");
  await chord(g.page, ["Shift"], "ArrowRight");
  await g.page.keyboard.press("Delete");
  assert.deepEqual([await music(g.page), await notices(g.page), await ends2(g.page)], ["c2 (d2 e2) f2 |]", ["A slur starts or ends here"], [1, 1]]);
  // With both its notes it goes.
  await chord(g.page, ["Shift"], "ArrowRight");
  await g.page.keyboard.press("Delete");
  assert.equal(await music(g.page), "c2 f2 |]");
  assert.deepEqual(g.errors, []);
  await g.close();

  // Over several voices: out of each it is chosen over, and of no other.
  const t = await open({ text: TRIO, scores: 1 });
  await pressMode(t.page);
  const walk = ["Control", "Shift"];
  const lines = async () => (await staged(t.page)).split("\n").filter((l) => /\|/.test(l));
  const was = await lines();
  await press(t.page, "ArrowRight", 4);
  await chord(t.page, ["Control", "Shift"], "ArrowRight");
  await chord(t.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual(await stretch(t.page), { voices: "all", anchor: 4, stop: 5, track: 0, bands: [[0, 1, 2]] });
  await t.page.keyboard.press("Delete");
  assert.deepEqual(await lines(), ["c d e f | b c' |", "E F G A | d e |", "C,4 | C,2 |"]);
  assert.deepEqual([await placeText(t.page), (await stretch(t.page)).track, (await stretch(t.page)).anchor], ["b", 0, null]);
  // One step of the history for all of it, and the stretch back over every
  // voice.
  await chord(t.page, ["Control"], "z");
  assert.deepEqual([await lines(), (await stretch(t.page)).voices, (await inked(t.page)).length], [was, "all", 5]);
  // With the second voice let go of, it keeps its notes.
  await chord(t.page, walk, "ArrowDown");
  await chord(t.page, walk, "Space");
  assert.deepEqual((await stretch(t.page)).voices, [0, 2]);
  await t.page.keyboard.press("Delete");
  assert.deepEqual(await lines(), ["c d e f | b c' |", was[1], "C,4 | C,2 |"]);
  // The cursor is back in the voice the stretch was drawn out in.
  assert.deepEqual([await placeText(t.page), (await stretch(t.page)).track], ["b", 0]);
  assert.deepEqual(t.errors, []);
  await t.close();
});

// The owner's ask of 2026-10-06, "Aplica Ctrl X y Ctrl A". What Ctrl+X
// takes is what Ctrl+C copies (SM73) and how it goes is how Delete takes a
// stretch (SM88, SM104): the two are read together here, with what is the
// key's own. That a cut refused leaves the clipboard alone, and that with
// nothing chosen it takes the cursor's place whole, are my picks.
const CUT_SOURCE = ["X:1", "M:4/4", "L:1/4", "Q:1/4=120", "K:C", "V:1", "c d [eg] f | g a b c' |", "V:2 clef=bass", "C,4 | G,2 C,2 |"].join("\n");
// The music stopped by a key, and not by the tune's own end: within two
// seconds, where the tune has more than that left to play.
const stoppedSoon = (page) => page.waitForFunction(() => !document.querySelector(".mdm-audio .abcjs-midi-start.abcjs-pushed"), { timeout: 2000 });
test("Ctrl+X puts on the clipboard what Ctrl+C would and takes it out as Delete takes a stretch: the stretch chosen, in the voices it is chosen over, and with none the cursor's place whole; one step of the history, and the next paste puts it in; what cannot go says why and leaves the clipboard as it was; nothing at the open end, and while the music sounds the key stops it (SM107)", { skip }, async () => {
  const eighths = ["X:2", "M:4/4", "L:1/8", "K:C", "z8 | c8 |]"].join("\n");
  const h = await open({ text: pasteDoc(CUT_SOURCE) + ["", "```abc", eighths, "```", ""].join("\n"), scores: 2, clipboard: true });
  await listenSources(h.page);
  await pressMode(h.page);
  const lines = async () => (await staged(h.page)).split("\n").filter((l) => /\|/.test(l));
  const was = await lines();
  // With nothing chosen, the place the cursor stands on, whole: a chord
  // with both its heads, from a height neither is at, where Delete takes
  // nothing (SM55). A key held down is one cut.
  await press(h.page, "ArrowRight", 2);
  assert.deepEqual([await placeText(h.page), (await cursor(h.page)).step], ["[eg]", 7]);
  await h.page.keyboard.press("Delete");
  assert.deepEqual(await lines(), was);
  const sent = (await edits(h.page)).length;
  await h.page.keyboard.down("Control");
  await h.page.keyboard.down("x");
  await h.page.keyboard.down("x");
  await h.page.keyboard.up("x");
  await h.page.keyboard.up("Control");
  assert.deepEqual([await lines(), await copied(h.page)], [["c d f | g a b c' |", was[1]], ["[eg]"]]);
  // The cursor on what came into the place, as Delete leaves it, and one
  // step of the history, which puts the chord and the cursor back.
  assert.deepEqual([await placeText(h.page), await ends2(h.page), (await edits(h.page)).length], ["f", [null, 2], sent + 1]);
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await lines(), await placeText(h.page), await ends2(h.page)], [was, "[eg]", [null, 2]]);
  // A stretch every voice was let go of is nothing chosen (SM86): the place
  // the cursor stands on goes, and the cursor is left there, not where the
  // stretch nobody sees began.
  await h.page.keyboard.press("ArrowLeft");
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Control", "Shift"], "Space");
  assert.deepEqual([await inked(h.page), await placeText(h.page), await ends2(h.page)], [[], "[eg]", [1, 2]]);
  await chord(h.page, ["Control"], "x");
  assert.deepEqual([await lines(), await copied(h.page), await placeText(h.page), await ends2(h.page)], [["c d f | g a b c' |", was[1]], ["[eg]"], "f", [null, 2]]);
  await chord(h.page, ["Control"], "z");
  await h.page.keyboard.press("Escape");
  assert.deepEqual([await lines(), await placeText(h.page), await ends2(h.page)], [was, "[eg]", [null, 2]]);
  // And with the cursor walked to another voice from such a stretch, it is
  // that voice's place that goes, and the cursor stays in that voice.
  await press(h.page, "ArrowRight", 2);
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Control", "Shift"], "Space");
  await chord(h.page, ["Control", "Shift"], "ArrowDown");
  assert.deepEqual([await inked(h.page), await trackOf(h.page), await placeText(h.page)], [[], 1, "G,2"]);
  await chord(h.page, ["Control"], "x");
  assert.deepEqual([await lines(), await copied(h.page), await trackOf(h.page), await placeText(h.page)], [[was[0], "C,4 | C,2 |"], ["G,2"], 1, "C,2"]);
  await chord(h.page, ["Control"], "z");
  await h.page.keyboard.press("Escape");
  await chord(h.page, ["Control"], "ArrowUp");
  await press(h.page, "ArrowLeft", 2);
  assert.deepEqual([await lines(), await placeText(h.page), await ends2(h.page)], [was, "[eg]", [null, 2]]);
  // A stretch: on the clipboard as Ctrl+C puts it, and gone, the cursor
  // where it began.
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Control"], "x");
  assert.deepEqual([await lines(), await copied(h.page), await placeText(h.page), await selection(h.page)], [["c d | g a b c' |", was[1]], ["[eg] f"], "g", null]);
  // What was cut is what the next paste puts in, after the cursor's place
  // (SM81), under the unit it was cut under.
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction(() => /g \[eg\] f a/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual(await lines(), ["c d | g [eg] f a b c' |", was[1]]);
  await chord(h.page, ["Control"], "z");
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await lines(), await ends2(h.page)], [was, [2, 3]]);
  // Over every voice: out of each as Delete takes it, the lower voice's
  // notes that the stretch takes a part of left shorter (SM104), and on the
  // clipboard as Ctrl+C copies them, whole.
  await h.page.keyboard.press("Escape");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual(await inked(h.page), ["v0 l0 m0 n3", "v0 l0 m1 n0", "v1 l0 m0 n0", "v1 l0 m1 n0"]);
  await chord(h.page, ["Control"], "x");
  assert.deepEqual([await lines(), await copied(h.page)], [["c d [eg] a b c' |", "C,3 G, C,2 |"], ["V:1\nf | g\nV:2\nC,4 | G,2"]]);
  await chord(h.page, ["Control"], "z");
  await h.page.keyboard.press("Escape");
  assert.deepEqual(await lines(), was);
  // While the music sounds on the cursor's score the key stops it, and
  // takes nothing. From the top, with four seconds of it to play.
  await press(h.page, "ArrowLeft", 9);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await chord(h.page, ["Control"], "x");
  await stoppedSoon(h.page);
  await sleep(150);
  assert.deepEqual([await lines(), await copied(h.page)], [was, []]);
  // What was cut under one unit is not pasted under another, as what was
  // copied is not (SM83): the score pasted into says so.
  await chord(h.page, ["Control"], "x");
  assert.equal((await copied(h.page)).length, 1);
  const rest = await h.page.evaluate(() => {
    const r = document.querySelectorAll("#app .mdm-score")[1].querySelector("svg .abcjs-rest").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await h.page.mouse.click(rest.x, rest.y);
  assert.equal(await placeText(h.page), "z8");
  await chord(h.page, ["Control"], "v");
  await sleep(150);
  assert.deepEqual([await h.page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-score")[1].querySelectorAll(".mdm-score-notice")).map((n) => n.textContent)), await stagedAt(h.page, 1)], [["Copied under another L:"], eighths]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // What cannot go: nothing at the open end, where nothing stands; and half
  // a slur, which says so, chosen or under the cursor, the clipboard left
  // with what it held.
  const g = await open({ text: notesDoc("c2 (d2 e2) f2 | g2"), scores: 1, clipboard: true });
  await pressMode(g.page);
  await clip(g.page, "held");
  const state = async () => [await music(g.page), await copied(g.page), await g.page.evaluate(() => window.__clipboard), (await edits(g.page)).length];
  const before = await state();
  await press(g.page, "ArrowRight", 6);
  assert.equal(await placeText(g.page), "");
  await chord(g.page, ["Control"], "x");
  assert.deepEqual([await state(), await notices(g.page)], [before, []]);
  await press(g.page, "ArrowLeft", 4);
  assert.equal(await placeText(g.page), "(d2");
  await chord(g.page, ["Control"], "x");
  assert.deepEqual([await state(), await notices(g.page)], [before, ["A slur starts or ends here"]]);
  await chord(g.page, ["Shift"], "ArrowRight");
  await chord(g.page, ["Control"], "x");
  assert.deepEqual([await state(), await notices(g.page), await ends2(g.page)], [before, ["A slur starts or ends here"], [1, 1]]);
  // With both its notes it goes, and is what the clipboard holds.
  await chord(g.page, ["Shift"], "ArrowRight");
  await chord(g.page, ["Control"], "x");
  assert.deepEqual([await music(g.page), await copied(g.page)], ["c2 f2 | g2", ["(d2 e2)"]]);
  assert.deepEqual(g.errors, []);
  await g.close();
});

// The lower voice comes in a bar after the upper one and is written for the
// first line alone, with no barline to close it: the voices of a score that
// is still being written. A stretch drawn out in it from its first place to
// its last takes of the upper voice the four notes that sound with it.
const WHOLE_SOURCE = ["X:1", "M:4/4", "L:1/4", "Q:1/4=120", "K:C", "V:1", "c d e f | g a b c' |", "c' b a g | f e d c |", "V:2 clef=bass", "x4 | G,2 C,2"].join("\n");
test("Ctrl+A chooses the whole score, every place of every voice whatever the cursor's voice has of it, and the cursor stays where it stands: Escape gives it back there, an arrow across lets go at that end of its voice; the keys of a stretch are its keys, it is played from the top, and its voices are let go one by one (SM108)", { skip }, async () => {
  const h = await open({ text: pasteDoc(WHOLE_SOURCE), scores: 1, clipboard: true });
  await listenSources(h.page);
  await pressMode(h.page);
  const lines = async () => (await staged(h.page)).split("\n").filter((l) => /\|/.test(l));
  const was = await lines();
  const stands = async () => [await trackOf(h.page), await placeText(h.page), (await cursor(h.page)).step];
  const upper = [];
  for (const l of [0, 1]) for (const m of [0, 1]) for (const n of [0, 1, 2, 3]) upper.push("v0 l" + l + " m" + m + " n" + n);
  const lower = ["v1 l0 m1 n0", "v1 l0 m1 n1"];
  // From the lower voice. Drawn out there from end to end, a stretch over
  // every voice is the second bar of the first line.
  await chord(h.page, ["Control"], "ArrowDown");
  await toStep(h.page, 6);
  assert.deepEqual((await stands()).slice(0, 2), [1, "G,2"]);
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual(await inked(h.page), upper.slice(4, 8).concat(lower));
  await h.page.keyboard.press("Escape");
  const stood = await stands();
  assert.deepEqual(stood, [1, "C,2", 6]);
  // Ctrl+A: all of both, one band over the two staves of the first line and
  // one over the staff of the second, and the cursor where it stood, out of
  // sight as under any stretch.
  await chord(h.page, ["Control"], "a");
  assert.deepEqual(await inked(h.page), upper.concat(lower));
  const s = await stretch(h.page);
  assert.deepEqual([s.voices, s.track, s.stop, s.bands, await cursorShown(h.page)], ["all", 1, 1, [[0, 1], [2]], false]);
  // The band of the first line from the first note of the upper voice,
  // which sounds a bar before the cursor's voice has a place.
  const st = await staves(h.page, 0);
  const first = Math.min(...(await heads(h.page, 0)).filter((p) => p.y < st[0].bottom + 10 && p.y > st[0].top - 20).map((p) => p.x));
  const band = (await selection(h.page)).bands[0];
  assert.ok(band.left < first && band.right > first, "the band of the first line, from " + band.left + ", leaves out the note at " + first);
  // Ctrl+C copies it, each voice under its V:.
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:1\nc d e f | g a b c'\nc' b a g | f e d c\nV:2\nG,2 C,2"]);
  // Played, it sounds from the top of the tune, a bar before the cursor's
  // voice comes in; and chosen while the music sounds, the music stops.
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  assert.ok((await lastStart(h.page)) < 0.1, "the whole score was played from " + (await lastStart(h.page)) + " s");
  await chord(h.page, ["Control"], "a");
  await stoppedSoon(h.page);
  await sleep(150);
  assert.deepEqual(await inked(h.page), upper.concat(lower));
  // Escape gives the cursor back where it stood, and nothing is chosen.
  // Nothing of the whole is left behind either: Space under Ctrl+Shift
  // picks the cursor's place, as it does with nothing chosen.
  await h.page.keyboard.press("Escape");
  assert.deepEqual([await stands(), await selection(h.page), await cursorShown(h.page)], [stood, null, true]);
  await chord(h.page, ["Control", "Shift"], "Space");
  assert.deepEqual(await inked(h.page), [lower[1]]);
  await h.page.keyboard.press("Escape");
  // An arrow across lets it go at that end of the cursor's voice.
  await chord(h.page, ["Control"], "a");
  await h.page.keyboard.press("ArrowRight");
  assert.deepEqual([(await stands()).slice(0, 2), await selection(h.page)], [[1, "C,2"], null]);
  await chord(h.page, ["Control"], "a");
  await h.page.keyboard.press("ArrowLeft");
  assert.deepEqual([(await stands()).slice(0, 2), await selection(h.page)], [[1, "G,2"], null]);
  // The keys of a stretch. Delete would leave nothing, and says so, as
  // Ctrl+X does; 0 makes a rest of every note and leaves it chosen.
  await chord(h.page, ["Control"], "a");
  await h.page.keyboard.press("Delete");
  assert.deepEqual([await lines(), await notices(h.page)], [was, ["Nothing would be left"]]);
  await chord(h.page, ["Control"], "x");
  assert.deepEqual([await lines(), await copied(h.page)], [was, []]);
  await h.page.keyboard.press("0");
  assert.deepEqual([await lines(), (await inked(h.page)).length], [["z z z z | z z z z |", "z z z z | z z z z |", "x4 | z2 z2"], 18]);
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await lines(), (await inked(h.page)).length], [was, 18]);
  // Its voices are let go and taken back as any stretch's: with the upper
  // one let go, the whole of the lower alone.
  await chord(h.page, ["Control", "Shift"], "ArrowUp");
  assert.deepEqual([await trackOf(h.page), await cursorShown(h.page), await inked(h.page)], [0, true, upper.concat(lower)]);
  await chord(h.page, ["Control", "Shift"], "Space");
  assert.deepEqual([(await stretch(h.page)).voices, await inked(h.page)], [[1], lower]);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["G,2 C,2"]);
  await chord(h.page, ["Control", "Shift"], "Space");
  assert.deepEqual(await inked(h.page), upper.concat(lower));
  // Shift with an arrow after it draws a stretch out from the cursor, in
  // the cursor's voice.
  await h.page.keyboard.press("Escape");
  await chord(h.page, ["Control"], "a");
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual([(await inked(h.page)).length, (await stretch(h.page)).voices], [2, null]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The owner's call of 2026-10-06: "si elimino un compás entero seleccionado
// con delete los compases que van delante deben venir a ocupar su lugar".
// What the text is made to say is the engine's and is tested without a
// browser (score-bars.test.js, fillLines); these are the key, the cursor and
// the history.
test("a bar taken out with Delete brings the bars after it up over the lines, chosen as a stretch or by the place that is all of it, in the voices it went from; the cursor is on what came into its place, and undo gives it all back (SM96)", { skip }, async () => {
  const source = ["X:1", "M:4/4", "L:1/8", "K:C", "c8 | z8 |", "e8 | f8 |", "g8 | a8 |]"].join("\n");
  const was = ["c8 | z8 |", "e8 | f8 |", "g8 | a8 |]"];
  const up = ["c8 | e8 |", "f8 | g8 |", "a8 |]"];
  const lines = async (page) => (await staged(page)).split("\n").filter((l) => /\|/.test(l));
  const h = await open({ text: pasteDoc(source), scores: 1 });
  await pressMode(h.page);
  // The rest that is all its bar: the bar goes, and each line below gives
  // its first bar to the line above it.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "z8");
  const sent = (await edits(h.page)).length;
  await h.page.keyboard.press("Delete");
  assert.deepEqual(await lines(h.page), up);
  assert.deepEqual([await placeText(h.page), await ends2(h.page), await cursorShown(h.page)], ["e8", [null, 1], true]);
  // Three systems still, the last a bar shorter.
  assert.equal((await staves(h.page, 0)).length, 3);
  // One change of the text, and one step of the history.
  assert.equal((await edits(h.page)).length, sent + 1);
  assert.equal(await docText(h.page), pasteDoc(source.replace(was.join("\n"), up.join("\n"))));
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await lines(h.page), await placeText(h.page)], [was, "z8"]);
  // Chosen and taken out, the same; undo gives it back chosen.
  await chord(h.page, ["Shift"], "ArrowRight");
  await h.page.keyboard.press("Delete");
  assert.deepEqual([await lines(h.page), await placeText(h.page), await cursorShown(h.page)], [up, "e8", true]);
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await lines(h.page), await ends2(h.page)], [was, [1, 1]]);
  // A line chosen whole goes as a line, and nothing comes up to it.
  await chord(h.page, ["Shift"], "ArrowLeft");
  assert.deepEqual(await ends2(h.page), [1, 0]);
  await h.page.keyboard.press("Delete");
  assert.deepEqual([await lines(h.page), await placeText(h.page)], [["e8 | f8 |", "g8 | a8 |]"], "e8"]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // Two voices on two lines. A bar chosen in the upper alone: its bars come
  // up, and the lower keeps the lines it had.
  const d = await open({ text: DUET, scores: 1 });
  await pressMode(d.page);
  const duet = await lines(d.page);
  assert.deepEqual(duet, ["c G A F | G E F D |", "C, D, E, F, | G,4 |", "e d c B | c4 |", "A, B, C D | C4 |"]);
  for (let i = 0; i < 4; i++) await chord(d.page, ["Shift"], "ArrowRight");
  await d.page.keyboard.press("Delete");
  assert.deepEqual(await lines(d.page), ["G E F D | e d c B |", duet[1], "c4 |", duet[3]]);
  assert.deepEqual([await placeText(d.page), (await stretch(d.page)).track], ["G", 0]);
  await chord(d.page, ["Control"], "z");
  assert.deepEqual(await lines(d.page), duet);
  // Over both: the line's first bar comes up in both.
  await d.page.keyboard.press("Escape");
  await press(d.page, "ArrowLeft", 4);
  assert.equal(await placeText(d.page), "c");
  for (let i = 0; i < 4; i++) await chord(d.page, ["Control", "Shift"], "ArrowRight");
  assert.equal((await stretch(d.page)).voices, "all");
  await d.page.keyboard.press("Delete");
  assert.deepEqual(await lines(d.page), ["G E F D | e d c B |", "G,4 | A, B, C D |", "c4 |", "C4 |"]);
  await chord(d.page, ["Control"], "z");
  assert.deepEqual(await lines(d.page), duet);
  assert.deepEqual(d.errors, []);
  await d.close();
});

// The owner's call of 2026-10-06: "Quiero hacer una distinción entre Delete y
// Backspace, uno deja el cursor donde está (Delete) y el otro lo mueve hacia
// la nota de atrás (Backspace)". Until then they were one key. What they take
// out is the same and has its own tests (SM55, SM60, SM88, SM96); this is
// where each leaves the cursor.
test("Delete leaves the cursor where it stands, on what comes into its place, and Backspace takes it to the place on the left of what went: a note, a rest, the bar a place is all of, a stretch; where the place stays or nothing goes the cursor stays, and the first place of a voice has nothing on its left (SM101)", { skip }, async () => {
  const line = "c2 d2 z2 f2 | B8 | [Ac]4 G4 |]";
  const h = await open({ text: notesDoc(line), scores: 1 });
  await pressMode(h.page);
  // The music, what the cursor stands on, and which place of its voice.
  const at = async (page) => [await music(page), await placeText(page), (await ends2(page))[1]];
  const undo = (page) => chord(page, ["Control"], "z");
  // A note between two places. Delete: the cursor on the rest that was on
  // its right, which has the note's index now.
  await h.page.keyboard.press("ArrowRight");
  await toStep(h.page, 8);
  await h.page.keyboard.press("Delete");
  assert.deepEqual(await at(h.page), ["c2 z2 f2 | B8 | [Ac]4 G4 |]", "z2", 1]);
  await undo(h.page);
  assert.deepEqual(await at(h.page), [line, "d2", 1]);
  // Backspace: the same music, and the cursor on the note that was on its
  // left. One change of the text, as Delete's is, and a key held down is
  // one press.
  const sent = (await edits(h.page)).length;
  await h.page.keyboard.down("Backspace");
  await h.page.keyboard.down("Backspace");
  await h.page.keyboard.up("Backspace");
  assert.deepEqual(await at(h.page), ["c2 z2 f2 | B8 | [Ac]4 G4 |]", "c2", 0]);
  assert.equal((await edits(h.page)).length, sent + 1);
  assert.deepEqual([await cursorShown(h.page), await selection(h.page)], [true, null]);
  // Undo puts the cursor back on the note that went, and redo where
  // Backspace left it.
  await undo(h.page);
  assert.deepEqual(await at(h.page), [line, "d2", 1]);
  await chord(h.page, ["Control"], "y");
  assert.deepEqual(await at(h.page), ["c2 z2 f2 | B8 | [Ac]4 G4 |]", "c2", 0]);
  // A rest goes from any height, and the cursor the same way.
  await h.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(h.page), "z2");
  await h.page.keyboard.press("Backspace");
  assert.deepEqual(await at(h.page), ["c2 f2 | B8 | [Ac]4 G4 |]", "c2", 0]);
  // The first place of the voice has nothing on its left: the cursor is
  // left on what came into it, as under Delete.
  await toStep(h.page, 7);
  await h.page.keyboard.press("Backspace");
  assert.deepEqual(await at(h.page), ["f2 | B8 | [Ac]4 G4 |]", "f2", 0]);
  await undo(h.page);
  assert.deepEqual(await at(h.page), ["c2 f2 | B8 | [Ac]4 G4 |]", "c2", 0]);
  // The place a bar is all of takes the bar: Backspace leaves the cursor on
  // the last place of the bar before it, Delete on the first of the bar
  // after it.
  await press(h.page, "ArrowRight", 2);
  await toStep(h.page, 6);
  assert.equal(await placeText(h.page), "B8");
  await h.page.keyboard.press("Backspace");
  assert.deepEqual(await at(h.page), ["c2 f2 | [Ac]4 G4 |]", "f2", 1]);
  await undo(h.page);
  await h.page.keyboard.press("Delete");
  assert.deepEqual(await at(h.page), ["c2 f2 | [Ac]4 G4 |]", "[Ac]4", 2]);
  await undo(h.page);
  assert.deepEqual(await at(h.page), ["c2 f2 | B8 | [Ac]4 G4 |]", "B8", 2]);
  // A head taken off a chord leaves the place, and the cursor on it, under
  // either key; and at a step the place has no head at nothing goes, and
  // the cursor with nothing.
  await h.page.keyboard.press("ArrowRight");
  for (const key of ["Backspace", "Delete"]) {
    await toStep(h.page, 5);
    await h.page.keyboard.press(key);
    assert.deepEqual(await at(h.page), ["c2 f2 | B8 | c4 G4 |]", "c4", 3], key);
    const still = (await edits(h.page)).length;
    await h.page.keyboard.press(key);
    assert.deepEqual([await at(h.page), (await edits(h.page)).length], [["c2 f2 | B8 | c4 G4 |]", "c4", 3], still], key + " with no head under it");
    await undo(h.page);
    assert.deepEqual(await at(h.page), ["c2 f2 | B8 | [Ac]4 G4 |]", "[Ac]4", 3]);
  }
  // The last place of a voice a barline closes: nothing comes into it, and
  // both leave the cursor on the place before.
  await h.page.keyboard.press("ArrowRight");
  await toStep(h.page, 4);
  for (const key of ["Backspace", "Delete"]) {
    await h.page.keyboard.press(key);
    assert.deepEqual(await at(h.page), ["c2 f2 | B8 | [Ac]4 |]", "[Ac]4", 3], key);
    await undo(h.page);
    assert.deepEqual(await at(h.page), ["c2 f2 | B8 | [Ac]4 G4 |]", "G4", 4]);
  }
  assert.deepEqual(await notices(h.page), []);
  assert.deepEqual(h.errors, []);
  await h.close();

  // The last note of a voice no barline closes: Delete leaves the cursor
  // at the open end, where it stood by its index, and Backspace on the note
  // before.
  const o = await open({ text: notesDoc("c2 d2 e2"), scores: 1 });
  await pressMode(o.page);
  await press(o.page, "ArrowRight", 2);
  await toStep(o.page, 9);
  assert.deepEqual(await at(o.page), ["c2 d2 e2", "e2", 2]);
  await o.page.keyboard.press("Delete");
  assert.deepEqual(await at(o.page), ["c2 d2", "", 2]);
  await undo(o.page);
  await o.page.keyboard.press("Backspace");
  assert.deepEqual(await at(o.page), ["c2 d2", "d2", 1]);
  assert.deepEqual(o.errors, []);
  await o.close();

  // The place the cursor is taken to gives the figure kept, as a place
  // walked onto does: 0 there is a rest as long as that note.
  const g = await open({ text: notesDoc("c2 d4 e2 |]"), scores: 1 });
  await pressMode(g.page);
  await g.page.keyboard.press("ArrowRight");
  await toStep(g.page, 8);
  assert.deepEqual([await placeText(g.page), await kept(g.page)], ["d4", 0.5]);
  await g.page.keyboard.press("Backspace");
  assert.deepEqual([await at(g.page), await kept(g.page)], [["c2 e2 |]", "c2", 0], 0.25]);
  // The drawing names that figure in the task of the key itself. It named
  // the half that went until the cursor was drawn again, two frames later,
  // and the line above read it so once, in a run of the whole file with
  // the machine loaded (2026-10-06). The half is kept again first, by a
  // walk off the note and back.
  await undo(g.page);
  await g.page.keyboard.press("ArrowRight");
  await g.page.keyboard.press("ArrowLeft");
  assert.deepEqual([await placeText(g.page), await kept(g.page)], ["d4", 0.5]);
  const named = await g.page.evaluate(() => {
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", bubbles: true, cancelable: true }));
    return Number(document.querySelector("#app .mdm-score-cursor").getAttribute("data-mdm-figure"));
  });
  assert.deepEqual([named, await at(g.page)], [0.25, ["c2 e2 |]", "c2", 0]]);
  await g.page.keyboard.press("0");
  assert.equal(await music(g.page), "z2 e2 |]");
  assert.deepEqual(g.errors, []);
  await g.close();

  // A stretch: Delete leaves the cursor where the stretch began, on what
  // came into it, and Backspace on the place to the left of that; undo
  // gives the stretch back chosen after either.
  const tune = "c2 d2 e2 f2 | g2 a2 b2 c'2 | d'8 |]";
  const s = await open({ text: notesDoc(tune), scores: 1 });
  await pressMode(s.page);
  await press(s.page, "ArrowRight", 2);
  await chord(s.page, ["Shift"], "ArrowRight");
  await chord(s.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(s.page), [2, 3]);
  await s.page.keyboard.press("Delete");
  assert.deepEqual([await at(s.page), await cursorShown(s.page), await selection(s.page)], [["c2 d2 | g2 a2 b2 c'2 | d'8 |]", "g2", 2], true, null]);
  await undo(s.page);
  assert.deepEqual([await music(s.page), await ends2(s.page)], [tune, [2, 3]]);
  await s.page.keyboard.press("Backspace");
  assert.deepEqual([await at(s.page), await cursorShown(s.page), await selection(s.page)], [["c2 d2 | g2 a2 b2 c'2 | d'8 |]", "d2", 1], true, null]);
  await undo(s.page);
  assert.deepEqual([await music(s.page), await ends2(s.page), await cursorShown(s.page)], [tune, [2, 3], false]);
  // One that begins the voice has nothing on its left.
  await s.page.keyboard.press("Escape");
  await press(s.page, "ArrowLeft", 3);
  await chord(s.page, ["Shift"], "ArrowRight");
  await chord(s.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(s.page), [0, 1]);
  await s.page.keyboard.press("Backspace");
  assert.deepEqual(await at(s.page), ["e2 f2 | g2 a2 b2 c'2 | d'8 |]", "e2", 0]);
  assert.deepEqual(s.errors, []);
  await s.close();

  // Over several voices the cursor comes back to the voice the stretch was
  // drawn out in, to the left of the stretch under Backspace. With that
  // voice let go of, nothing went from it: its places are where they were,
  // and the cursor on its own under either key.
  const t = await open({ text: TRIO, scores: 1 });
  await pressMode(t.page);
  const lines = async () => (await staged(t.page)).split("\n").filter((l) => /\|/.test(l));
  const was = await lines();
  const landed = async () => [await placeText(t.page), (await stretch(t.page)).track, (await stretch(t.page)).stop];
  await press(t.page, "ArrowRight", 4);
  await chord(t.page, ["Control", "Shift"], "ArrowRight");
  await chord(t.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual([(await stretch(t.page)).voices, await ends2(t.page)], ["all", [4, 5]]);
  await t.page.keyboard.press("Backspace");
  assert.deepEqual([await lines(), await landed()], [["c d e f | b c' |", "E F G A | d e |", "C,4 | C,2 |"], ["f", 0, 3]]);
  await undo(t.page);
  assert.deepEqual([await lines(), (await stretch(t.page)).voices], [was, "all"]);
  await chord(t.page, ["Control", "Shift"], "Space");
  assert.deepEqual((await stretch(t.page)).voices, [1, 2]);
  for (const key of ["Backspace", "Delete"]) {
    await t.page.keyboard.press(key);
    assert.deepEqual([await lines(), await landed()], [[was[0], "E F G A | d e |", "C,4 | C,2 |"], ["a", 0, 5]], key);
    await undo(t.page);
    assert.deepEqual([await lines(), (await stretch(t.page)).voices], [was, [1, 2]]);
  }
  assert.deepEqual(t.errors, []);
  await t.close();
});

// The owner's call of 2026-10-06: "ctrl shift -> debe seleccionar la primera
// nota de cada parte". Until then a place of another voice was in a stretch
// for beginning inside it, and a voice holding a longer note under the
// cursor's place had nothing chosen: under three of the four quarters of the
// upper voice's first bar here, the bass and its whole note. What begins
// inside a stretch and sounds on past its end was in it already; what began
// before it and sounds on into it is in it as well now.
test("a stretch over several voices takes in the note of each that is still sounding as it begins: the first Ctrl+Shift with an arrow chooses a place of every voice, the keys act on that place as on the rest, and the band stays the stretch's own span (SM102)", { skip }, async () => {
  const t = await open({ text: TRIO, scores: 1, clipboard: true });
  await pressMode(t.page);
  const all = ["Control", "Shift"];
  const lines = async () => (await staged(t.page)).split("\n").filter((l) => /\|/.test(l));
  const was = await lines();
  // The notes and rests in the ink, and not the barline that goes with a
  // bar chosen whole (SM100).
  const notes = async () => (await inked(t.page)).filter((name) => /n\d+$/.test(name)).join(", ");
  // One press at each place of the upper voice: its own note, the one the
  // second voice begins with it, and the bass's, begun with it or before it.
  const first = [];
  for (let i = 0; i < 8; i++) {
    await chord(t.page, all, "ArrowRight");
    first.push(await notes());
    await t.page.keyboard.press("Escape");
    await t.page.keyboard.press("ArrowRight");
  }
  assert.deepEqual(first, [
    "v0 l0 m0 n0, v1 l0 m0 n0, v2 l0 m0 n0",
    "v0 l0 m0 n1, v1 l0 m0 n1, v2 l0 m0 n0",
    "v0 l0 m0 n2, v1 l0 m0 n2, v2 l0 m0 n0",
    "v0 l0 m0 n3, v1 l0 m0 n3, v2 l0 m0 n0",
    "v0 l0 m1 n0, v1 l0 m1 n0, v2 l0 m1 n0",
    "v0 l0 m1 n1, v1 l0 m1 n1, v2 l0 m1 n0",
    "v0 l0 m1 n2, v1 l0 m1 n2, v2 l0 m1 n1",
    "v0 l0 m1 n3, v1 l0 m1 n3, v2 l0 m1 n1",
  ]);
  // From the bass's half note, what the upper voices begin under it, as it
  // was: the note before, which has ended by then, is not in it.
  await chord(t.page, ["Control"], "ArrowDown");
  await chord(t.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(t.page), "C,2");
  await chord(t.page, all, "ArrowRight");
  assert.equal(await notes(), "v0 l0 m1 n2, v0 l0 m1 n3, v1 l0 m1 n2, v1 l0 m1 n3, v2 l0 m1 n1");
  await t.page.keyboard.press("Escape");
  await chord(t.page, ["Control"], "ArrowUp");
  await chord(t.page, ["Control"], "ArrowUp");
  await press(t.page, "ArrowLeft", 7);
  await t.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(t.page), "d");
  // The band says when and the ink says what: one band over the three
  // staves, at the column of the d, and not drawn back over the c and the
  // E to the whole note written under them.
  await chord(t.page, all, "ArrowRight");
  assert.deepEqual([await stretch(t.page), await notes()], [{ voices: "all", anchor: 1, stop: 1, track: 0, bands: [[0, 1, 2]] }, "v0 l0 m0 n1, v1 l0 m0 n1, v2 l0 m0 n0"]);
  const st = await staves(t.page, 0);
  const hs = await heads(t.page, 0);
  const upper = hs.filter((p) => p.y < st[0].bottom + 10).sort((a, b) => a.x - b.x);
  const bass = hs.filter((p) => p.y > st[2].top - 10).sort((a, b) => a.x - b.x);
  assert.deepEqual([upper.length, bass.length], [8, 3]);
  assert.ok(Math.abs(bass[0].x - upper[0].x) < 4, "the whole note is not under the c: " + bass[0].x + " and " + upper[0].x);
  const band = (await selection(t.page)).bands[0];
  assert.ok(band.left > upper[0].x + 6 && band.left < upper[1].x && band.right > upper[1].x && band.right < upper[2].x - 6, "the band runs from " + band.left + " to " + band.right + ", and the c, the d and the e are at " + [upper[0].x, upper[1].x, upper[2].x].join(", "));
  // Ctrl+C copies it under its voice with the rest. 0 makes rests of the
  // notes that are in the stretch whole, and leaves this one, of which the
  // stretch has a part (SM104).
  await chord(t.page, ["Control"], "c");
  assert.deepEqual(await copied(t.page), ["V:1\nd\nV:2\nF\nV:3\nC,4"]);
  await t.page.keyboard.press("0");
  assert.deepEqual(await lines(), ["c z e f | g a b c' |", "E z G A | B c d e |", was[2]]);
  await chord(t.page, ["Control"], "z");
  assert.deepEqual([await lines(), await notes()], [was, "v0 l0 m0 n1, v1 l0 m0 n1, v2 l0 m0 n0"]);
  // Drawn out, the stretch keeps the note it began under.
  await chord(t.page, all, "ArrowRight");
  assert.equal(await notes(), "v0 l0 m0 n1, v0 l0 m0 n2, v1 l0 m0 n1, v1 l0 m0 n2, v2 l0 m0 n0");
  await chord(t.page, all, "ArrowLeft");
  // The bass let go of wears no ink, and picked again it wears it: the
  // cursor walks down to the note that sounds, and Space there is seen.
  await chord(t.page, all, "ArrowDown");
  await chord(t.page, all, "ArrowDown");
  assert.equal(await placeText(t.page), "C,4");
  await chord(t.page, all, "Space");
  assert.deepEqual([(await stretch(t.page)).voices, await notes()], [[0, 1], "v0 l0 m0 n1, v1 l0 m0 n1"]);
  await chord(t.page, all, "Space");
  assert.deepEqual([(await stretch(t.page)).voices, await notes()], [[0, 1, 2], "v0 l0 m0 n1, v1 l0 m0 n1, v2 l0 m0 n0"]);
  // With the two upper voices let go of, all the stretch holds on the line
  // is the note begun before it: the band is over that note, on its staff.
  await chord(t.page, all, "ArrowUp");
  await chord(t.page, all, "Space");
  await chord(t.page, all, "ArrowUp");
  await chord(t.page, all, "Space");
  assert.deepEqual([(await stretch(t.page)).voices, await notes()], [[2], "v2 l0 m0 n0"]);
  const low = (await selection(t.page)).bands;
  assert.equal(low.length, 1);
  assert.ok(low[0].top > st[1].bottom && low[0].top <= st[2].top && low[0].bottom >= st[2].bottom, "the band is not the bass staff's");
  assert.ok(low[0].left < bass[0].x && low[0].right > bass[0].x && low[0].right < upper[1].x - 6, "the band runs from " + low[0].left + " to " + low[0].right + ", and the whole note is at " + bass[0].x);
  // Delete takes of it the quarter the stretch has, and leaves the rest
  // (the owner's call of the same afternoon, SM104; for the hour before it
  // the note went whole, with the bar it is all of).
  await t.page.keyboard.press("Escape");
  await chord(t.page, all, "ArrowRight");
  assert.deepEqual([(await stretch(t.page)).voices, await ends2(t.page)], ["all", [1, 1]]);
  await t.page.keyboard.press("Delete");
  assert.deepEqual(await lines(), ["c e f | g a b c' |", "E G A | B c d e |", "C,3 | G,2 C,2 |"]);
  await chord(t.page, ["Control"], "z");
  assert.deepEqual(await lines(), was);
  assert.deepEqual(await notices(t.page), []);
  assert.deepEqual(t.errors, []);
  await t.close();

  // On a line the stretch goes on into, the band begins with the line: a
  // place there is no note held from before the stretch, however early in
  // its own line it begins. From the second quarter of the first line to
  // the third of the second.
  const d = await open({ text: DUET, scores: 1 });
  await pressMode(d.page);
  await d.page.keyboard.press("ArrowRight");
  for (let i = 0; i < 10; i++) await chord(d.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(d.page), [1, 10]);
  const lower = await staves(d.page, 0);
  const next = (await heads(d.page, 0)).filter((p) => p.y < lower[2].bottom + 10 && p.y > lower[2].top - 20).sort((a, b) => a.x - b.x);
  const over = (await selection(d.page)).bands;
  assert.equal(over.length, 2);
  assert.ok(over[1].left < next[0].x && over[1].right > next[2].x && over[1].right < next[3].x, "the band of the second line runs from " + over[1].left + " to " + over[1].right + ", and its notes are at " + next.map((p) => p.x).join(", "));
  assert.deepEqual(d.errors, []);
  await d.close();
});

// The owner's call of 2026-10-06: "quita el ctrl alt -> y sustituyelo por: una
// vez estén marcadas con ctrl shift, se hace ctrl -> y debe añadirse el compás
// de silencio al lado". Until then Ctrl+Alt with the arrow added the bar to
// every voice, and with a stretch chosen Ctrl with it did nothing.
test("Ctrl+Right and Ctrl+Left with a stretch chosen add the bar of rest beside the stretch, after the bar of its last place or before the bar of its first, in the voices it is chosen over and in no other; the stretch is let go, the cursor is on the new rest, and undo gives the stretch back (SM103)", { skip }, async () => {
  const t = await open({ text: TRIO, scores: 1 });
  await pressMode(t.page);
  const walk = ["Control", "Shift"];
  const lines = async (page) => (await staged(page)).split("\n").filter((l) => /\|/.test(l));
  const was = await lines(t.page);
  const undo = (page) => chord(page, ["Control"], "z");
  // What the cursor stands on, in which voice, at what height, with no
  // stretch left, and drawn.
  const landed = async (page) => [await placeText(page), (await stretch(page)).track, (await cursor(page)).step, await ends2(page), await cursorShown(page), await selection(page)];
  const height = (await cursor(t.page)).step;
  // In one voice, drawn out with Shift: the bar goes into that voice alone,
  // after the bar the stretch is in. One change of the text.
  await t.page.keyboard.press("ArrowRight");
  await chord(t.page, ["Shift"], "ArrowRight");
  await chord(t.page, ["Shift"], "ArrowRight");
  assert.deepEqual([await ends2(t.page), (await stretch(t.page)).voices], [[1, 2], null]);
  const sent = (await edits(t.page)).length;
  await chord(t.page, ["Control"], "ArrowRight");
  assert.deepEqual(await lines(t.page), ["c d e f | z4 | g a b c' |", was[1], was[2]]);
  assert.deepEqual(await landed(t.page), ["z4", 0, height, [null, 4], true, null]);
  assert.equal((await edits(t.page)).length, sent + 1);
  // Undo gives the stretch back, chosen as it was.
  await undo(t.page);
  assert.deepEqual([await lines(t.page), await ends2(t.page), (await stretch(t.page)).voices, await cursorShown(t.page)], [was, [1, 2], null, false]);
  // Before the bar of its first place, here the head of the line. A key
  // held down is one bar.
  await t.page.keyboard.down("Control");
  await t.page.keyboard.down("ArrowLeft");
  await t.page.keyboard.down("ArrowLeft");
  await t.page.keyboard.up("ArrowLeft");
  await t.page.keyboard.up("Control");
  assert.deepEqual(await lines(t.page), ["z4 | c d e f | g a b c' |", was[1], was[2]]);
  assert.deepEqual(await landed(t.page), ["z4", 0, height, [null, 0], true, null]);
  await undo(t.page);
  // Across a barline: after the bar of its last place, and before the bar
  // of its first.
  await chord(t.page, ["Shift"], "ArrowRight");
  await chord(t.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(t.page), [1, 4]);
  await chord(t.page, ["Control"], "ArrowRight");
  assert.deepEqual([await lines(t.page), (await landed(t.page)).slice(0, 4)], [["c d e f | g a b c' | z4 |", was[1], was[2]], ["z4", 0, height, [null, 8]]]);
  await undo(t.page);
  await chord(t.page, ["Control"], "ArrowLeft");
  assert.deepEqual([await lines(t.page), (await landed(t.page)).slice(0, 4)], [["z4 | c d e f | g a b c' |", was[1], was[2]], ["z4", 0, height, [null, 0]]]);
  await undo(t.page);
  assert.deepEqual(await ends2(t.page), [1, 4]);
  // Over every voice, which the first Ctrl+Shift with an arrow marks, the
  // bass by the note it holds under the d (SM102): the bar in each.
  await t.page.keyboard.press("ArrowLeft");
  assert.equal(await placeText(t.page), "d");
  await chord(t.page, walk, "ArrowRight");
  assert.deepEqual([(await stretch(t.page)).voices, await ends2(t.page)], ["all", [1, 1]]);
  await chord(t.page, ["Control"], "ArrowRight");
  assert.deepEqual(await lines(t.page), ["c d e f | z4 | g a b c' |", "E F G A | z4 | B c d e |", "C,4 | z4 | G,2 C,2 |"]);
  assert.deepEqual(await landed(t.page), ["z4", 0, height, [null, 4], true, null]);
  await undo(t.page);
  assert.deepEqual([await lines(t.page), await ends2(t.page), (await stretch(t.page)).voices], [was, [1, 1], "all"]);
  // Over the voices picked: the second let go of, and the bar in the two
  // others; the cursor in the voice the stretch was drawn out in.
  await chord(t.page, walk, "ArrowDown");
  await chord(t.page, walk, "Space");
  assert.deepEqual((await stretch(t.page)).voices, [0, 2]);
  await chord(t.page, ["Control"], "ArrowLeft");
  assert.deepEqual(await lines(t.page), ["z4 | c d e f | g a b c' |", was[1], "z4 | C,4 | G,2 C,2 |"]);
  assert.deepEqual((await landed(t.page)).slice(0, 4), ["z4", 0, height, [null, 0]]);
  await undo(t.page);
  assert.deepEqual([await lines(t.page), (await stretch(t.page)).voices], [was, [0, 2]]);
  // With the voice it was drawn out in let go of as well, the bar goes into
  // the one left, beside the note it holds, and the cursor onto its rest.
  await chord(t.page, walk, "ArrowUp");
  await chord(t.page, walk, "Space");
  assert.deepEqual((await stretch(t.page)).voices, [2]);
  await chord(t.page, ["Control"], "ArrowRight");
  assert.deepEqual(await lines(t.page), [was[0], was[1], "C,4 | z4 | G,2 C,2 |"]);
  assert.deepEqual((await landed(t.page)).slice(0, 2), ["z4", 2]);
  await undo(t.page);
  assert.deepEqual([await lines(t.page), (await stretch(t.page)).voices], [was, [2]]);
  assert.deepEqual(await notices(t.page), []);
  assert.deepEqual(t.errors, []);
  await t.close();

  // On two lines, over the voices picked: the bar goes beside the end of
  // the stretch on the line that end is on, in each of them. The lower
  // voice is in the stretch on its first line by the whole note it holds
  // there (SM102), and takes the bar before it for that.
  const d = await open({ text: DUET, scores: 1 });
  await pressMode(d.page);
  const duet = await lines(d.page);
  await press(d.page, "ArrowRight", 6);
  for (let i = 0; i < 4; i++) await chord(d.page, walk, "ArrowRight");
  await chord(d.page, walk, "Space");
  await chord(d.page, walk, "Space");
  assert.deepEqual([(await stretch(d.page)).voices, await ends2(d.page)], [[0, 1], [6, 9]]);
  await chord(d.page, ["Control"], "ArrowRight");
  assert.deepEqual(await lines(d.page), [duet[0], duet[1], "e d c B | z4 | c4 |", "A, B, C D | z4 | C4 |"]);
  await undo(d.page);
  await chord(d.page, ["Control"], "ArrowLeft");
  assert.deepEqual(await lines(d.page), ["c G A F | z4 | G E F D |", "C, D, E, F, | z4 | G,4 |", duet[2], duet[3]]);
  assert.deepEqual(await notices(d.page), []);
  assert.deepEqual(d.errors, []);
  await d.close();

  // What the text cannot be made to say is not written, and the score says
  // why over the stretch still chosen: every voice asked for a bar where
  // one of them has none to put it beside.
  const short = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | g a b c' | c4 |", "V:2 clef=bass", "C,4 | G,4 |"].join("\n");
  const u = await open({ text: ["Short.", "", "```abc", short, "```", ""].join("\n"), scores: 1 });
  await pressMode(u.page);
  await press(u.page, "ArrowRight", 8);
  assert.equal(await placeText(u.page), "c4");
  await chord(u.page, walk, "ArrowRight");
  const before = (await edits(u.page)).length;
  await chord(u.page, ["Control"], "ArrowRight");
  assert.deepEqual([await staged(u.page), (await edits(u.page)).length, await notices(u.page), await ends2(u.page), (await stretch(u.page)).voices], [short, before, ["Voices don't match"], [8, 8], "all"]);
  assert.deepEqual(u.errors, []);
  await u.close();
});

// The owner's call of 2026-10-06, on the whole note of a bass under one
// quarter chosen in the voice above, which Delete took whole and with its
// bar for the hour before: "yo lo veo como que hay parte de la redonda que se
// seleccionó y se le dio delete, por lo que la redonda debe reducirse en la
// duración que se le quitó (sin agregar silencios)". A stretch is a span of
// time, and a place of another voice may be in it in part.
test("a place of another voice that a stretch takes a part of is left by Delete, shorter by that part and with no rest put in, whether it began before the stretch, sounds on past its end, or both; 0 leaves it as it is, a paste goes in after it, and it wears the ink without the barline of its bar (SM104)", { skip }, async () => {
  const t = await open({ text: TRIO, scores: 1, clipboard: true });
  await pressMode(t.page);
  const all = ["Control", "Shift"];
  const lines = async (page) => (await staged(page)).split("\n").filter((l) => /\|/.test(l));
  const was = await lines(t.page);
  const undo = (page) => chord(page, ["Control"], "z");
  // The barlines that wear the ink of a stretch.
  const barsInked = (page) => page.evaluate(() => document.querySelectorAll("#app .mdm-score svg .abcjs-bar.mdm-score-picked").length);
  const home = async (page, steps) => {
    await page.keyboard.press("Escape");
    await press(page, "ArrowLeft", 9);
    if (steps) await press(page, "ArrowRight", steps);
  };
  // One quarter of the upper voice, its second, over every voice. The
  // bass's whole note began before it and sounds under it: it wears the
  // ink, and the barline of its bar does not, the bar being left.
  await t.page.keyboard.press("ArrowRight");
  await chord(t.page, all, "ArrowRight");
  assert.deepEqual([await inked(t.page), await barsInked(t.page)], [["v0 l0 m0 n1", "v1 l0 m0 n1", "v2 l0 m0 n0"], 0]);
  // Delete: the two quarters go, and the whole note is three quarters
  // long, with no rest after it. One change of the text, and the cursor on
  // what came into the d's place.
  const sent = (await edits(t.page)).length;
  await t.page.keyboard.press("Delete");
  const short = ["c e f | g a b c' |", "E G A | B c d e |", "C,3 | G,2 C,2 |"];
  assert.deepEqual(await lines(t.page), short);
  assert.deepEqual([await placeText(t.page), await ends2(t.page), await cursorShown(t.page), (await edits(t.page)).length], ["e", [null, 1], true, sent + 1]);
  // Undo gives it all back in one step, the stretch chosen.
  await undo(t.page);
  assert.deepEqual([await lines(t.page), await ends2(t.page), (await stretch(t.page)).voices], [was, [1, 1], "all"]);
  // Backspace takes the same, and leaves the cursor to the left (SM101).
  await t.page.keyboard.press("Backspace");
  assert.deepEqual([await lines(t.page), await placeText(t.page)], [short, "c"]);
  await undo(t.page);
  // Two quarters, and three: the note is left what the stretch did not
  // take of it.
  await chord(t.page, all, "ArrowRight");
  await t.page.keyboard.press("Delete");
  assert.deepEqual(await lines(t.page), ["c f | g a b c' |", "E A | B c d e |", "C,2 | G,2 C,2 |"]);
  await undo(t.page);
  await chord(t.page, all, "ArrowRight");
  await t.page.keyboard.press("Delete");
  assert.deepEqual(await lines(t.page), ["c | g a b c' |", "E | B c d e |", "C, | G,2 C,2 |"]);
  await undo(t.page);
  // Across the barline, both ends of the bass's part of it stay: the whole
  // note keeps the three quarters before the stretch and the half note the
  // quarter after it, and the barline between them goes as it goes from the
  // voices above.
  await home(t.page, 3);
  assert.equal(await placeText(t.page), "f");
  await chord(t.page, all, "ArrowRight");
  await chord(t.page, all, "ArrowRight");
  assert.deepEqual(await ends2(t.page), [3, 4]);
  await t.page.keyboard.press("Delete");
  assert.deepEqual(await lines(t.page), ["c d e a b c' |", "E F G c d e |", "C,3 G, C,2 |"]);
  await undo(t.page);
  // Sounding on past the end: from the first quarter the whole note begins
  // with the stretch and outlasts it. 0 makes rests of the notes that are
  // in the stretch whole and leaves that one as it is.
  await home(t.page, 0);
  await chord(t.page, all, "ArrowRight");
  assert.deepEqual([await ends2(t.page), await inked(t.page), await barsInked(t.page)], [[0, 0], ["v0 l0 m0 n0", "v1 l0 m0 n0", "v2 l0 m0 n0"], 0]);
  await t.page.keyboard.press("Delete");
  assert.deepEqual(await lines(t.page), ["d e f | g a b c' |", "F G A | B c d e |", "C,3 | G,2 C,2 |"]);
  await undo(t.page);
  await t.page.keyboard.press("0");
  assert.deepEqual([await lines(t.page), await ends2(t.page)], [["z d e f | g a b c' |", "z F G A | B c d e |", was[2]], [0, 0]]);
  await undo(t.page);
  // The whole bar: the note is in the stretch whole, and goes as it did,
  // with its bar, whose barline wears the ink for it.
  for (let i = 0; i < 3; i++) await chord(t.page, all, "ArrowRight");
  assert.deepEqual(await ends2(t.page), [0, 3]);
  assert.ok((await barsInked(t.page)) > 0, "no barline wears the ink of a bar chosen whole");
  await t.page.keyboard.press("Delete");
  assert.deepEqual(await lines(t.page), ["g a b c' |", "B c d e |", "G,2 C,2 |"]);
  await undo(t.page);
  assert.deepEqual(await lines(t.page), was);
  // A paste over the stretch goes in as into what Delete would leave: in
  // each voice in the place of what goes, and after the note that stays.
  await home(t.page, 4);
  await chord(t.page, all, "ArrowRight");
  await chord(t.page, all, "ArrowRight");
  await chord(t.page, ["Control"], "c");
  assert.deepEqual(await copied(t.page), ["V:1\ng a\nV:2\nB c\nV:3\nG,2"]);
  await home(t.page, 1);
  await chord(t.page, all, "ArrowRight");
  await chord(t.page, ["Control"], "v");
  await t.page.waitForFunction(() => /c g a e f/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.deepEqual(await lines(t.page), ["c g a e f | g a b c' |", "E B c G A | B c d e |", "C,3 G,2 | G,2 C,2 |"]);
  await undo(t.page);
  assert.deepEqual(await lines(t.page), was);
  assert.deepEqual(await notices(t.page), []);
  assert.deepEqual(t.errors, []);
  await t.close();

  // Over two lines. The bass's whole note is left the half it sounded
  // before the stretch; on the line the stretch goes on into it begins with
  // the line, and every place there is in it whole, however early in its
  // own line it begins.
  const d = await open({ text: DUET, scores: 1 });
  await pressMode(d.page);
  const duet = await lines(d.page);
  await press(d.page, "ArrowRight", 6);
  for (let i = 0; i < 4; i++) await chord(d.page, all, "ArrowRight");
  assert.deepEqual([await ends2(d.page), (await stretch(d.page)).voices], [[6, 9], "all"]);
  await d.page.keyboard.press("Delete");
  assert.deepEqual(await lines(d.page), ["c G A F | G E |", "C, D, E, F, | G,2 |", "c B | c4 |", "C D | C4 |"]);
  await undo(d.page);
  assert.deepEqual(await lines(d.page), duet);
  // 0 over it: the whole note, which the stretch has half of, is left, and
  // the two quarters of the second line, in it whole, are rests.
  await d.page.keyboard.press("0");
  assert.deepEqual(await lines(d.page), ["c G A F | G E z z |", "C, D, E, F, | G,4 |", "z z c B | c4 |", "z z C D | C4 |"]);
  await undo(d.page);
  assert.deepEqual(await lines(d.page), duet);
  assert.deepEqual([await notices(d.page), d.errors], [[], []]);
  await d.close();

  // What is left has to be a length one note has. Seven eighths is a half
  // with two dots; five eighths is a half tied to an eighth, which is two
  // notes: not written, and said, with the stretch still chosen.
  const eighths = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d/ e/ f/ g/ a | c'4 |", "V:2 clef=bass", "C,4 | G,4 |"].join("\n");
  const e = await open({ text: ["Eighths.", "", "```abc", eighths, "```", ""].join("\n"), scores: 1 });
  await pressMode(e.page);
  await e.page.keyboard.press("ArrowRight");
  await chord(e.page, all, "ArrowRight");
  await e.page.keyboard.press("Delete");
  assert.deepEqual(await lines(e.page), ["c e/ f/ g/ a | c'4 |", "C,7/2 | G,4 |"]);
  await undo(e.page);
  await chord(e.page, all, "ArrowRight");
  await chord(e.page, all, "ArrowRight");
  assert.deepEqual(await ends2(e.page), [1, 3]);
  const before = (await edits(e.page)).length;
  await e.page.keyboard.press("Delete");
  assert.deepEqual([await staged(e.page), (await edits(e.page)).length, await notices(e.page), await ends2(e.page)], [eighths, before, ["No note is that long"], [1, 3]]);
  assert.deepEqual(e.errors, []);
  await e.close();

  // A rest held under the stretch is shortened as a note is. A note tied to
  // the next is not: the two would no longer be the note they were.
  const held = (bass) => ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | g4 |", "V:2 clef=bass", bass].join("\n");
  const r = await open({ text: ["Held.", "", "```abc", held("z4 | G,4 |"), "```", "", "```abc", held("C,4- | C,4 |"), "```", ""].join("\n"), scores: 2 });
  await pressMode(r.page);
  await r.page.keyboard.press("ArrowRight");
  await chord(r.page, all, "ArrowRight");
  await r.page.keyboard.press("Delete");
  assert.deepEqual(await lines(r.page), ["c e f | g4 |", "z3 | G,4 |"]);
  const tied = await r.page.evaluate(() => {
    const svg = document.querySelectorAll("#app .mdm-score")[1].querySelector("code.language-abc svg");
    const box = svg.querySelectorAll(".abcjs-notehead")[1].getBoundingClientRect();
    return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  });
  await r.page.mouse.click(tied.x, tied.y);
  await chord(r.page, all, "ArrowRight");
  await r.page.keyboard.press("Delete");
  assert.deepEqual([await stagedAt(r.page, 1), await notices(r.page)], [held("C,4- | C,4 |"), ["A tie crosses here"]]);
  assert.deepEqual(r.errors, []);
  await r.close();
});

test("0 with a stretch chosen makes rests of its notes, as long as they were, and the stretch stays chosen; the keys that write on one place write nothing while one is chosen, and keep no figure (SM89)", { skip }, async () => {
  const line = "c2 d2 z2 f2 | [gb]4 a4 |]";
  const h = await open({ text: notesDoc(line), scores: 1 });
  await pressMode(h.page);
  await h.page.keyboard.press("ArrowRight");
  for (let i = 0; i < 4; i++) await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(h.page), [1, 4]);
  const figure = await kept(h.page);
  const sent = (await edits(h.page)).length;
  // The keys of the figures, Enter, Ctrl and Alt with a figure's key or 0,
  // and Shift with a figure's key, alone and with either: nothing written,
  // no figure kept, nothing said, and the stretch as it was. Ctrl with Left
  // and Right were among them until 2026-10-06, and add a bar beside the
  // stretch since (SM103).
  for (const key of ["1", "2", "3", "4", "5", "6", "7", "Enter"]) await h.page.keyboard.press(key);
  for (const [mods, key] of [
    [["Control"], "3"],
    [["Alt"], "3"],
    [["Control"], "0"],
    [["Alt"], "0"],
    [["Shift"], "1"],
    [["Control", "Shift"], "1"],
    [["Alt", "Shift"], "1"],
  ]) {
    await chord(h.page, mods, key);
  }
  assert.deepEqual([await music(h.page), (await edits(h.page)).length, await kept(h.page), await notices(h.page), await ends2(h.page)], [line, sent, figure, [], [1, 4]]);
  // The figure is read off the cursor's drawing, which keys that did nothing
  // left as it was. Escape draws the cursor again where it stands, on the
  // chord, and takes no figure from it: it names the one kept, which is the
  // one it was. The stretch is then drawn out again.
  await h.page.keyboard.press("Escape");
  assert.deepEqual([await placeText(h.page), await kept(h.page)], ["[gb]4", figure]);
  await press(h.page, "ArrowLeft", 3);
  for (let i = 0; i < 4; i++) await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(h.page), [1, 4]);
  // 0: the two notes and the chord are rests as long as they were, the
  // rest among them is as it was, and the stretch is still chosen.
  await h.page.keyboard.press("0");
  assert.equal(await music(h.page), "c2 z2 z2 z2 | z4 a4 |]");
  assert.deepEqual([await ends2(h.page), (await inked(h.page)).length, await cursorShown(h.page), (await edits(h.page)).length], [[1, 4], 4, false, sent + 1]);
  assert.equal(await docText(h.page), notesDoc("c2 z2 z2 z2 | z4 a4 |]"));
  // Again there is nothing to write.
  await h.page.keyboard.press("0");
  assert.equal((await edits(h.page)).length, sent + 1);
  // Delete then takes them out, and each key is a step of its own.
  await h.page.keyboard.press("Delete");
  assert.equal(await music(h.page), "c2 a4 |]");
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await ends2(h.page)], ["c2 z2 z2 z2 | z4 a4 |]", [1, 4]]);
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await ends2(h.page)], [line, [1, 4]]);
  // The stretch let go, the keys write again, on the place the cursor
  // comes back to.
  await h.page.keyboard.press("ArrowLeft");
  assert.equal(await placeText(h.page), "d2");
  await h.page.keyboard.press("0");
  assert.equal(await music(h.page), "c2 z2 z2 f2 | [gb]4 a4 |]");
  assert.deepEqual(h.errors, []);
  await h.close();

  // Half a tie stays, and the score says why; with both its notes chosen
  // the tie goes with them.
  const g = await open({ text: notesDoc("c2 d2- | d2 f2 |]"), scores: 1 });
  await pressMode(g.page);
  await g.page.keyboard.press("ArrowRight");
  await chord(g.page, ["Shift"], "ArrowRight");
  await g.page.keyboard.press("0");
  assert.deepEqual([await music(g.page), await notices(g.page)], ["c2 d2- | d2 f2 |]", ["A tie crosses here"]]);
  await chord(g.page, ["Shift"], "ArrowRight");
  await g.page.keyboard.press("0");
  assert.equal(await music(g.page), "c2 z2 | z2 f2 |]");
  assert.deepEqual(g.errors, []);
  await g.close();
});

// "Al copiar sobre una selección reemplaza la selección por lo copiado y el
// compás queda como quede" (the owner, 2026-10-04). Which voice takes what,
// where the copy and the stretch are not of the same voices, is my pick.
test("Ctrl+V with a stretch chosen puts the music in its place: a rest chosen is how an empty bar is filled; in the voices the copy names and the stretch is chosen over, and before the place where it begins in the others; undo gives the stretch back (SM90)", { skip }, async () => {
  const source = ["X:1", "M:4/4", "L:1/4", "K:C", "c d e f | z4 | g2 a2 |"].join("\n");
  const h = await open({ text: pasteDoc(source), scores: 1, clipboard: true });
  await pressMode(h.page);
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["c d"]);
  const now = (re) => h.page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")), {}, re.source);
  // The rest of the empty bar, chosen: the music takes its place, and the
  // cursor is on the last of it, the stretch let go.
  await h.page.keyboard.press("Escape");
  await press(h.page, "ArrowRight", 3);
  assert.equal(await placeText(h.page), "z4");
  await chord(h.page, ["Shift"], "ArrowRight");
  const sent = (await edits(h.page)).length;
  await chord(h.page, ["Control"], "v");
  await now(/f \| c d \|/);
  assert.equal(await music(h.page), "c d e f | c d | g2 a2 |");
  assert.deepEqual([await ends2(h.page), await placeText(h.page), await cursorShown(h.page), await selection(h.page), (await edits(h.page)).length], [[null, 5], "d", true, null, sent + 1]);
  assert.equal(await lastEdit(h.page), pasteDoc(source.replace("z4", "c d")));
  // One step of the history, which gives the rest back chosen.
  await chord(h.page, ["Control"], "z");
  assert.deepEqual([await music(h.page), await ends2(h.page), await cursorShown(h.page)], ["c d e f | z4 | g2 a2 |", [4, 4], false]);
  await chord(h.page, ["Control"], "y");
  assert.equal(await music(h.page), "c d e f | c d | g2 a2 |");
  await chord(h.page, ["Control"], "z");
  // Notes chosen, across a barline: gone with the barline, and the music
  // in their place.
  await h.page.keyboard.press("ArrowLeft");
  assert.equal(await placeText(h.page), "z4");
  await h.page.keyboard.press("ArrowLeft");
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(h.page), [3, 4]);
  await chord(h.page, ["Control"], "v");
  await now(/c d e c d \|/);
  assert.deepEqual([await music(h.page), await placeText(h.page), await ends2(h.page)], ["c d e c d | g2 a2 |", "d", [null, 4]]);
  await chord(h.page, ["Control"], "z");
  // Music nobody sees, over the first place of the voice: there is no last
  // place of it to stand on, nor one before it, and the cursor is on what
  // comes after it.
  await h.page.keyboard.press("Escape");
  await press(h.page, "ArrowLeft", 4);
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(h.page), [0, 0]);
  await clip(h.page, "x");
  await chord(h.page, ["Control"], "v");
  await now(/x d e f/);
  assert.deepEqual([await music(h.page), await placeText(h.page), await ends2(h.page)], ["x d e f | z4 | g2 a2 |", "d", [null, 0]]);
  await chord(h.page, ["Control"], "z");
  await h.page.keyboard.press("Escape");
  await press(h.page, "ArrowRight", 3);
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual(await ends2(h.page), [3, 4]);
  // What cannot go in is not put in, the score says why, and the stretch
  // stays chosen.
  await clip(h.page, "(c d");
  await chord(h.page, ["Control"], "v");
  await sleep(150);
  assert.deepEqual([await music(h.page), await notices(h.page), await ends2(h.page)], ["c d e f | z4 | g2 a2 |", ["A slur starts or ends here"], [3, 4]]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // Three voices. The copy of all three, pasted over a stretch chosen in
  // the first alone: the first takes its part in the place of the stretch,
  // and the other two theirs before the place that begins where the
  // stretch does.
  const t = await open({ text: TRIO, scores: 1, clipboard: true });
  await pressMode(t.page);
  const walk = ["Control", "Shift"];
  const lines = async () => (await staged(t.page)).split("\n").filter((l) => /\|/.test(l));
  const was = await lines();
  const wait = (re) => t.page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")), {}, re.source);
  await chord(t.page, ["Control", "Shift"], "ArrowRight");
  await chord(t.page, ["Control", "Shift"], "ArrowRight");
  await chord(t.page, ["Control"], "c");
  assert.deepEqual(await copied(t.page), ["V:1\nc d\nV:2\nE F\nV:3\nC,4"]);
  await t.page.keyboard.press("Escape");
  await press(t.page, "ArrowRight", 3);
  assert.equal(await placeText(t.page), "g");
  await chord(t.page, ["Shift"], "ArrowRight");
  await chord(t.page, ["Shift"], "ArrowRight");
  await chord(t.page, ["Control"], "v");
  await wait(/f \| c d b/);
  assert.deepEqual(await lines(), ["c d e f | c d b c' |", "E F G A | E F B c d e |", "C,4 | C,4 G,2 C,2 |"]);
  assert.deepEqual([await placeText(t.page), (await stretch(t.page)).track, await ends2(t.page)], ["d", 0, [null, 5]]);
  await chord(t.page, ["Control"], "z");
  assert.deepEqual([await lines(), await ends2(t.page)], [was, [4, 5]]);
  // The stretch over every voice, and the copy of the three: each in the
  // place of its own.
  await chord(t.page, ["Control", "Shift"], "ArrowLeft");
  assert.deepEqual([(await stretch(t.page)).voices, await ends2(t.page)], ["all", [4, 4]]);
  await chord(t.page, ["Control"], "v");
  await wait(/f \| c d a b/);
  // The bass's half note begins with the stretch and sounds a quarter past
  // its end: it is left that quarter, and the music goes in before it (the
  // owner's call of 2026-10-06 for a note a stretch takes a part of, SM104;
  // until then the half note went whole).
  assert.deepEqual(await lines(), ["c d e f | c d a b c' |", "E F G A | E F c d e |", "C,4 | C,4 G, C,2 |"]);
  await chord(t.page, ["Control"], "z");
  // Music of no name goes to the cursor's voice, and in the place of its
  // stretch; the voices chosen that none came for keep theirs.
  await clip(t.page, "a b");
  await chord(t.page, ["Control"], "v");
  await wait(/f \| a b a b c'/);
  assert.deepEqual(await lines(), ["c d e f | a b a b c' |", was[1], was[2]]);
  await chord(t.page, ["Control"], "z");
  // With the cursor walked to another voice, that voice is the cursor's.
  await chord(t.page, walk, "ArrowDown");
  assert.equal(await placeText(t.page), "B");
  await chord(t.page, ["Control"], "v");
  await wait(/A \| a b c d e/);
  assert.deepEqual(await lines(), [was[0], "E F G A | a b c d e |", was[2]]);
  assert.equal((await stretch(t.page)).track, 1);
  // The voice the stretch was drawn out in, let go of: the music that
  // comes for it goes in before the place where the stretch begins, as in
  // any voice it is not chosen over, and the other two take theirs in the
  // place of it.
  await chord(t.page, ["Control"], "z");
  await chord(t.page, walk, "ArrowUp");
  await chord(t.page, walk, "Space");
  assert.deepEqual((await stretch(t.page)).voices, [1, 2]);
  await clip(t.page, "V:1\nc d\nV:2\nE F\nV:3\nC,4");
  await chord(t.page, ["Control"], "v");
  await wait(/f \| c d g a/);
  // The bass's half note is left its quarter past the stretch here too.
  assert.deepEqual(await lines(), ["c d e f | c d g a b c' |", "E F G A | E F c d e |", "C,4 | C,4 G, C,2 |"]);
  assert.deepEqual(t.errors, []);
  await t.close();
});

// The owner's call of 2026-10-04, in the place of the word "Copied" over the
// cursor: "que haga algo parecido a cuando se usa el botón de copiar que
// hace un flashazo". The wash of what was copied pulses, and nothing else.
test("Ctrl+C says it has copied with a pulse of the wash of what it copied, the stretch's or the cursor's column, and with no word; where there is nothing to copy, with nothing (SM91)", { skip }, async () => {
  const h = await open({ text: notesDoc("c2 d2 e2 f2"), scores: 1, clipboard: true });
  await pressMode(h.page);
  const pulse = () =>
    h.page.evaluate(() => {
      const svg = document.querySelector("#app .mdm-score code.language-abc svg");
      const look = (sel) => {
        const el = svg.querySelector(sel);
        return el ? [getComputedStyle(el).animationName, Number(getComputedStyle(el).fillOpacity)] : null;
      };
      return { on: svg.classList.contains("mdm-score-copied"), beat: look(".mdm-score-cursor__beat"), band: look(".mdm-score-selection__band") };
    });
  assert.deepEqual(await pulse(), { on: false, beat: ["none", 0.16], band: null });
  // The cursor's place: its column, from the weight of the copy button's
  // pulse back to its own.
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["c2"]);
  const beat = await pulse();
  assert.deepEqual([beat.on, beat.beat[0], beat.band], [true, "mdm-score-copy-beat", null]);
  assert.ok(beat.beat[1] > 0.16 && beat.beat[1] <= 0.28, "the column pulses at " + beat.beat[1]);
  assert.deepEqual(await notices(h.page), []);
  await sleep(750);
  assert.deepEqual(await pulse(), { on: false, beat: ["none", 0.16], band: null });
  // A stretch: its wash.
  await chord(h.page, ["Shift"], "ArrowRight");
  await chord(h.page, ["Shift"], "ArrowRight");
  assert.deepEqual((await pulse()).band, ["none", 0.1]);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["c2 d2"]);
  const band = await pulse();
  assert.deepEqual([band.on, band.band[0]], [true, "mdm-score-copy-band"]);
  assert.ok(band.band[1] > 0.1 && band.band[1] <= 0.28, "the wash pulses at " + band.band[1]);
  assert.deepEqual(await notices(h.page), []);
  // Copied again before it settled, it pulses from the top again, and for
  // its whole half second: the first copy's end does not cut it short.
  await sleep(300);
  const late = (await pulse()).band[1];
  await chord(h.page, ["Control"], "c");
  const again = (await pulse()).band[1];
  assert.ok(again > late, "the second copy pulsed from " + again + ", after " + late);
  await sleep(400);
  assert.equal((await pulse()).on, true);
  await sleep(450);
  assert.deepEqual([(await pulse()).on, (await pulse()).band], [false, ["none", 0.1]]);
  // At the open end there is nothing to copy, and nothing pulses.
  await h.page.keyboard.press("Escape");
  await press(h.page, "ArrowRight", 4);
  assert.equal(await placeText(h.page), "");
  await copied(h.page);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual([await copied(h.page), (await pulse()).on], [[], false]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Seen in a real window on the owner's chorale, 2026-10-04: the empty third
// bar of the upper voices, chosen over every voice, left out the whole note
// the fourth voice plays in it. A rest that is all its bar is drawn in the
// middle of the bar, and the places of two voices were told to sound
// together by where they stood across. They are told by when they begin.
test("the places of two voices that sound together are told by when they begin, and not by where they are drawn: a rest that is all its bar goes with what another voice begins the bar with (SM92)", { skip }, async () => {
  const source = CHORALE_SOURCE.replace("A4 |\ng2 d2", "z4 |\ng2 d2").replace("D,4 |\nD,2 G,2", "z4 |\nD,2 G,2");
  const h = await open({ text: ["Four voices.", "", "```abc", source, "```", ""].join("\n"), scores: 1, clipboard: true });
  await pressMode(h.page);
  const lines = async () => (await staged(h.page)).split("\n").filter((line) => /\|/.test(line));
  const was = await lines();
  await press(h.page, "ArrowRight", 6);
  assert.equal(await placeText(h.page), "z4");
  // The rest of the first voice is drawn in the middle of its bar, right of
  // where the second voice's note of that bar begins.
  const across = await h.page.evaluate(() => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    const x = (sel) => svg.querySelector(sel).getBoundingClientRect().left;
    return x(".abcjs-rest.abcjs-v0.abcjs-l0.abcjs-m2") - x(".abcjs-note.abcjs-v1.abcjs-l0.abcjs-m2");
  });
  assert.ok(across > 10, "the rest stands " + across + " px from the note under it");
  // Chosen over every voice: the two rests, and the two notes that fill the
  // bar under them.
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.deepEqual(await inked(h.page), ["v0 l0 m2 n0", "v1 l0 m2 n0", "v2 l0 m2 n0", "v3 l0 m2 n0"]);
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:S\nz4\nV:A\nF4\nV:T\nz4\nV:B\nA4"]);
  // And taken out of all four, which keep in step: the first bar of the
  // line below comes up in each of them, to the place of the bar that went
  // (SM96).
  await h.page.keyboard.press("Delete");
  assert.deepEqual(await lines(), [
    "d2 B2 | c A B G | g2 d2 |",
    "e c d B | G4 |]",
    "B2 G2 | A F G D | B2 G2 |",
    "G A F D | D4 |]",
    "G,2 D,2 | E, D, D, B,, | D,2 G,2 |",
    "C, E, D, D, | B,,4 |]",
    "d2 B2 | c A B G | g2 d2 |",
    "e c d B | G4 |]",
  ]);
  await chord(h.page, ["Control"], "z");
  await h.page.keyboard.press("Escape");
  // The walk: down from the rest to the note that sounds with it, and back
  // up from that note to the rest, which begins when it does though it is
  // drawn after it.
  await chord(h.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(h.page), "F4");
  await chord(h.page, ["Control"], "ArrowUp");
  assert.equal(await placeText(h.page), "z4");
  assert.deepEqual(h.errors, []);
  await h.close();

  // Four quarters under a bar of rest: the rest sounds with the first of
  // them, each of them with the rest, and music pasted from the rest goes
  // in after the rest and after the last of the four, which is the one
  // sounding as the rest ends: in the bar of each, and not past the
  // barline of the second voice, before the note that begins there.
  const under = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "z4 | c4 |", "V:2 clef=bass", "C, D, E, F, | G,4 |"].join("\n");
  const g = await open({ text: pasteDoc(under), scores: 1, clipboard: true });
  await pressMode(g.page);
  assert.equal(await placeText(g.page), "z4");
  await chord(g.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(g.page), "C,");
  await press(g.page, "ArrowRight", 3);
  await chord(g.page, ["Control"], "ArrowUp");
  assert.equal(await placeText(g.page), "z4");
  await chord(g.page, ["Control", "Shift"], "ArrowRight");
  assert.equal((await inked(g.page)).length, 5);
  await g.page.keyboard.press("Escape");
  await clip(g.page, "V:1\ne\nV:2\nB,,");
  await chord(g.page, ["Control"], "v");
  await g.page.waitForFunction(() => /F, B,,/.test(document.querySelector("#app .mdm-score").getAttribute("data-mdm-source")));
  assert.equal(await staged(g.page), under.replace("z4 | c4", "z4 e | c4").replace("C, D, E, F,", "C, D, E, F, B,,"));
  assert.deepEqual(g.errors, []);
  await g.close();

  // In a tuplet the count is the tuplet's, and after it the plain one
  // again: three eighths in the time of two fill the first beat, so the
  // eighth after them begins with the second beat of the voice under it,
  // and the one after that with that beat's second eighth.
  const triplets = ["X:1", "M:2/4", "L:1/8", "K:C", "V:1", "(3cde f g |", "V:2 clef=bass", "C,2 D, E, |"].join("\n");
  const t = await open({ text: pasteDoc(triplets), scores: 1 });
  await pressMode(t.page);
  await press(t.page, "ArrowRight", 3);
  assert.equal(await placeText(t.page), "f");
  await chord(t.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(t.page), "D,");
  await chord(t.page, ["Control"], "ArrowUp");
  await t.page.keyboard.press("ArrowRight");
  assert.equal(await placeText(t.page), "g");
  await chord(t.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(t.page), "E,");
  // The third of the three sounds over the half the beat begins with.
  await chord(t.page, ["Control"], "ArrowUp");
  await press(t.page, "ArrowLeft", 2);
  assert.equal(await placeText(t.page), "e");
  await chord(t.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(t.page), "C,2");
  assert.deepEqual(t.errors, []);
  await t.close();

  // The open end of a voice is when its last note ends: what the voice
  // under it begins there sounds with it, and not what began with that
  // last note.
  const ended = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | g2", "V:2 clef=bass", "C,4 | G, A, B, C |"].join("\n");
  const e = await open({ text: pasteDoc(ended), scores: 1 });
  await pressMode(e.page);
  await press(e.page, "ArrowRight", 5);
  assert.equal(await placeText(e.page), "");
  await chord(e.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(e.page), "B,");
  assert.deepEqual(e.errors, []);
  await e.close();
});

// The README's take of the mode (scoreNavigation in tools/demo-clips/clips.js)
// is a run of keys on a document of its own, and what each of those keys
// does is the mode's to change: the owner was still settling, the week it was
// recorded, what a figure written over a longer rest leaves of the bar and
// where a paste goes. A rule changed after the take leaves the README
// showing an editor that is no longer the one installed, and nothing says so
// until somebody records it again and the take stops halfway. So the same
// keys are pressed here on the same document, and the line's end dragged as
// the take drags it, and have to leave the score the take is held to at the
// same places (expectMusic in clips.js). The one key left out is Space: what
// it plays changes nothing in the text, and the playing from the cursor is
// SM20's.
//
// The take begins on three staves of rests and writes every note of its
// phrase (the owner's ask of 2026-10-06), so what is held here is also that
// a score can be written from nothing with the keys alone: where the cursor
// lands as it goes from one part to the next is what the phrase was chosen
// for, and a change to it would have the take write other notes.
test("the keys of the README's take of the mode write the phrase its script expects, a beat at a time (SM93)", { skip }, async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const clips = path.join(__dirname, "..", "tools", "demo-clips");
  const take = require(path.join(clips, "clips.js")).clips.find((c) => c.id === "score-navigation");
  // As the editor holds it: without the header the host keeps back.
  const text = fs.readFileSync(path.join(clips, take.doc), "utf8").replace(/^---\n[\s\S]*?\n---\n\n/, "");
  const h = await open({ text, scores: 1, clipboard: true });
  const lines = async () => (await staged(h.page)).split("\n").filter((line) => /\|/.test(line));
  assert.deepEqual(await lines(), take.before, "the take's document is not the score its script begins on");
  const rests = take.before[0];
  await pressMode(h.page);

  // The click of the take: the right hand's first rest, at the height of
  // the G over the top line of its staff, the first of three.
  const all = await staves(h.page, 0);
  assert.equal(all.length, 3, "an organ score is three staves");
  const right = all[0];
  // What stands on the right hand's staff, left to right: its rests before
  // the take writes, its heads after.
  const onRight = (selector) =>
    h.page.evaluate(
      (selector, top, bottom) =>
        Array.from(document.querySelectorAll("#app .mdm-score code.language-abc svg " + selector))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => (r.top + r.bottom) / 2 > top - 10 && (r.top + r.bottom) / 2 < bottom + 10)
          .map((r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }))
          .sort((a, b) => a.x - b.x),
      selector,
      right.top,
      right.bottom
    );
  await h.page.mouse.click((await onRight(".abcjs-rest"))[0].x, stepAt(right, 11));
  assert.equal((await cursor(h.page)).step, 11);
  assert.equal(await placeText(h.page), "z4");

  // The right hand: a quarter over the bar's whole rest, which leaves the
  // bar short, a half after it two steps down, a quarter put in between
  // the two, and a whole note in the next bar at the height the cursor
  // has.
  await h.page.keyboard.press("3");
  assert.equal((await lines())[0], "g | z4 | z4 | z4 |]");
  // Short in the text, and on the staff its barline with the others'
  // (SM95): the first barline of each of the three voices in one place.
  const first = await h.page.evaluate(() =>
    [0, 1, 2].map((v) => {
      const bar = document.querySelectorAll("#app .mdm-score code.language-abc svg .abcjs-bar.abcjs-v" + v)[0];
      return bar ? Math.round(bar.getBoundingClientRect().left) : null;
    })
  );
  assert.ok(first[0] !== null && first[0] === first[1] && first[1] === first[2], "the barlines after the short bar stand at " + first.join(", "));
  await press(h.page, "ArrowDown", 2);
  await chord(h.page, ["Alt"], "2");
  assert.equal((await lines())[0], "g e2 | z4 | z4 | z4 |]");
  assert.equal(await placeText(h.page), "e2");
  await h.page.keyboard.press("ArrowUp");
  await chord(h.page, ["Control"], "3");
  assert.equal((await lines())[0], "g f e2 | z4 | z4 | z4 |]");
  assert.equal(await placeText(h.page), "f");
  await press(h.page, "ArrowRight", 2);
  assert.equal(await placeText(h.page), "z4");
  await h.page.keyboard.press("1");
  assert.deepEqual(await lines(), [take.right, rests, rests]);

  // The left hand: the cursor comes down in the bar it left, at the height
  // it had, which on this staff is the A; a third under it with Enter, and
  // the same a step down in the bar before.
  await chord(h.page, ["Control"], "ArrowDown");
  assert.equal(await placeText(h.page), "z4");
  assert.equal((await cursor(h.page)).step, 10);
  await h.page.keyboard.press("1");
  assert.equal((await lines())[1], "z4 | A,4 | z4 | z4 |]");
  await press(h.page, "ArrowDown", 2);
  await h.page.keyboard.press("Enter");
  assert.equal((await lines())[1], "z4 | [F,A,]4 | z4 | z4 |]");
  await h.page.keyboard.press("ArrowLeft");
  await h.page.keyboard.press("ArrowUp");
  await h.page.keyboard.press("1");
  assert.equal((await lines())[1], "G,4 | [F,A,]4 | z4 | z4 |]");
  await press(h.page, "ArrowDown", 2);
  await h.page.keyboard.press("Enter");
  assert.deepEqual(await lines(), [take.right, take.left, rests]);

  // The pedal: a step under where the left hand stopped, a whole note a
  // bar.
  await chord(h.page, ["Control"], "ArrowDown");
  assert.equal((await cursor(h.page)).step, 7);
  await h.page.keyboard.press("ArrowDown");
  await h.page.keyboard.press("1");
  await h.page.keyboard.press("ArrowRight");
  await h.page.keyboard.press("1");
  assert.deepEqual(await lines(), [take.right, take.left, take.pedal]);
  assert.equal(await placeText(h.page), "D,4");

  // The first two bars in every voice from the pedal's second note, and
  // the left hand, which is the voice in the middle, let go of: the first
  // staff and the third are what is copied.
  for (let i = 0; i < 2; i++) await chord(h.page, ["Control", "Shift"], "ArrowLeft");
  assert.equal((await inked(h.page)).length, 8);
  await chord(h.page, ["Control", "Shift"], "ArrowUp");
  await chord(h.page, ["Control", "Shift"], "Space");
  const chosen = await inked(h.page);
  assert.equal(chosen.length, 6);
  assert.ok(chosen.every((name) => !/^v1 /.test(name)), "a note of the left hand is still chosen: " + chosen.join(", "));
  await chord(h.page, ["Control"], "c");
  assert.deepEqual(await copied(h.page), ["V:RH\ng f e2 | f4\nV:Ped\nD,4 | D,4"]);

  // The last two bars chosen in every voice and the copy over them: the two
  // voices it names take it, and the left hand keeps its rests.
  await press(h.page, "ArrowRight", 2);
  assert.equal(await placeText(h.page), "z4");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  await chord(h.page, ["Control", "Shift"], "ArrowRight");
  assert.equal((await inked(h.page)).length, 6);
  await chord(h.page, ["Control"], "v");
  await h.page.waitForFunction((want) => document.querySelector("#app .mdm-score").getAttribute("data-mdm-source").includes(want), {}, take.pasted[0]);
  assert.deepEqual(await lines(), [take.pasted[0], take.left, take.pasted[1]]);

  // The click of the take on the third bar, the right hand's fifth note,
  // which is where it then plays from.
  const fifth = (await onRight(".abcjs-notehead"))[4];
  await h.page.mouse.click(fifth.x, fifth.y);
  assert.equal(await placeText(h.page), "g");
  assert.equal((await cursor(h.page)).step, 11);

  // Two bars to a line: the end of the first line taken by the lower
  // button of its pair, which the take finds by what it reads, and dragged
  // to the second barline. On the way the barline the line would end on is
  // under the column, and the pair's tip has said the button can be
  // dragged, which is what the take waits on it for.
  const lower = (await ends(h.page, 0)).filter((b) => b.system === 0 && b.way === "earlier")[0];
  assert.ok(lower && lower.shown && !lower.off, "no button to take the first line's end leftwards");
  assert.equal(lower.label, "Move line end left");
  await h.page.mouse.move(lower.x, lower.y, { steps: 2 });
  await sleep(120);
  assert.deepEqual(
    await h.page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-score-edit__tip--shown span")).map((el) => el.textContent)),
    ["Move line end left", "Or drag to any barline"]
  );
  const second = await h.page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll("#app .mdm-score code.language-abc svg .abcjs-bar.abcjs-v0"))
      .map((el) => el.getBoundingClientRect())
      .sort((a, b) => a.left - b.left);
    return (bars[1].left + bars[1].right) / 2;
  });
  await h.page.mouse.down();
  await h.page.mouse.move(second, lower.y, { steps: 8 });
  const marker = await markLook(h.page, "#app .mdm-score-break");
  assert.ok(Math.abs(marker.middle - second) < 1.5, "the column stands at " + marker.middle + ", the second barline at " + second);
  await h.page.mouse.up();
  await sleep(100);
  assert.deepEqual(await lines(), take.written);
  assert.equal((await staves(h.page, 0)).length, 6, "the score is not two systems of three staves");
  // The cursor where the click put it, now at the head of the second line.
  assert.equal(await placeText(h.page), "g");
  // Nothing was refused on the way: a refusal is said over the cursor.
  assert.deepEqual(await h.page.evaluate(() => Array.from(document.querySelectorAll("#app .mdm-score-notice")).map((n) => n.textContent)), []);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The notes after a stretch were lit as it ended. abcjs hands an event over
// a moment before it is due and the stretch is stopped on the frame after
// its end, so the note that follows took the playhead's ink, and kept it,
// the music paused on it: brass, as what is chosen is, outside the stretch
// (seen on the frames of the README's take, 2026-10-05, where the two notes
// after a bar chosen and played read as chosen with it). And the stretch's
// own last note kept the ink once the stretch was let go.
test("a stretch played to its end lights no note past it, and leaves none lit (SM94)", { skip }, async () => {
  const h = await open({ text: EIGHTHS, scores: 1 });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[2].x, hs[2].y);
  for (let i = 0; i < 3; i++) await chord(h.page, ["Shift"], "ArrowRight");
  // Every note that takes the playhead's ink from here on, by its number
  // among the notes of the score: read off the fill as it is set, since a
  // note lit for one frame is in no picture taken afterwards.
  await h.page.evaluate(() => {
    window.__lit = [];
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    new MutationObserver((changes) => {
      changes.forEach((change) => {
        const el = change.target;
        if (!el.getAttribute || el.getAttribute("fill") !== "#a0740f") return;
        const n = Array.from(svg.querySelectorAll(".abcjs-note")).indexOf(el.closest(".abcjs-note"));
        if (window.__lit.indexOf(n) < 0) window.__lit.push(n);
      });
    }).observe(svg, { attributes: true, attributeFilter: ["fill"], subtree: true });
  });
  const inked = () => h.page.evaluate(() => document.querySelectorAll('#app .mdm-score code.language-abc svg [fill="#a0740f"]').length);
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await untilSounding(h.page, false);
  // The stop is answered on the frame after it (scoreHearsPlayer).
  await h.page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  // Places 2, 3 and 4 were lit as they sounded, and place 5 never.
  assert.deepEqual(await h.page.evaluate(() => window.__lit.slice().sort((a, b) => a - b)), [2, 3, 4]);
  assert.equal(await inked(), 0, "a note is left in the playhead's ink after the stretch");
  assert.equal((await selection(h.page)).bands.length, 1);
  // Round again with the repeat on: the note after the stretch is not lit
  // at the turn of a lap either.
  await h.page.click(".mdm-audio .abcjs-midi-loop");
  await h.page.evaluate(() => (window.__lit = []));
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await sleep(1300);
  assert.equal(await sounding(h.page), true, "the stretch did not go round");
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, false);
  assert.deepEqual(await h.page.evaluate(() => window.__lit.slice().sort((a, b) => a - b)), [2, 3, 4]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A bar shorter in one voice than in the others: the barline of the short
// voice stood where its notes ended, in the middle of the system, and what
// followed it on the line was drawn and sounded early (MDM_BARS.evenBars,
// which has the picture it was seen in). The editor reads a score three
// times, for the drawing, for the synth and for an audio file, and the three
// have to make the same thing of such a bar: what the same score is with the
// gap written out as a rest nobody sees.
const SHORT_BAR = (gap) =>
  ["X:1", "M:4/4", "L:1/4", "Q:1/4=120", "K:C", "V:1", "c d e f | g a b c' | c'4 |]", "V:2 clef=bass", "C,4 | G,,2" + gap + " | C,4 |]"].join("\n");
test("a bar left short in one voice is drawn, played and written to a file as the same bar with its gap as a rest nobody sees (SM95)", { skip }, async () => {
  const text = ["Short.", "", "```abc", SHORT_BAR(""), "```", "", "Written out.", "", "```abc", SHORT_BAR(" x2"), "```", ""].join("\n");
  const h = await open({ text, scores: 2 });
  // The drawing: every note and every barline where the other score has it.
  const drawn = (i) =>
    h.page.evaluate((n) => {
      const svg = document.querySelectorAll("#app .mdm-score")[n].querySelector("code.language-abc svg");
      const left = svg.getBoundingClientRect().left;
      const xs = (sel) => Array.from(svg.querySelectorAll(sel)).map((el) => Math.round((el.getBoundingClientRect().left - left) * 10) / 10);
      // With every stroke of ink counted: the rest that fills the gap draws
      // none, as the `x` of the other score draws none.
      return { notes: xs(".abcjs-note"), bars: xs(".abcjs-bar"), ink: svg.querySelectorAll("path").length };
    }, i);
  const short = await drawn(0);
  const written = await drawn(1);
  assert.deepEqual(short, written);
  // And said outright: the two voices' barlines stand together, three a voice.
  assert.equal(short.bars.length, 6);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(short.bars[k] - short.bars[k + 3]) < 0.6, "barline " + k + " stands at " + short.bars[k] + " in one voice and " + short.bars[k + 3] + " in the other");
  // The text is as it was written: the rest is in the drawing alone.
  assert.equal((await docText(h.page)).split("```")[1], "abc\n" + SHORT_BAR("") + "\n");

  // The synth: when each note of the lower voice begins, read off the timer
  // the player keeps, for each of the two scores in turn. The moments of the
  // tune alone would not tell: the upper voice begins a note on every beat,
  // so the lower one a bar early still begins on moments the tune has.
  await pressMode(h.page);
  const lower = async (i, source) => {
    const hs = await heads(h.page, i);
    await h.page.mouse.click(hs[0].x, hs[0].y);
    await h.page.keyboard.press("Space");
    await untilSounding(h.page, true);
    const from = source.indexOf("C,4 | G,,2");
    const out = await h.page.evaluate(
      (from) =>
        window.__mdm.player.controller.timer.noteTimings
          .filter((t) => t.type === "event" && (t.startCharArray || []).some((c) => c >= from))
          .map((t) => Math.round(t.milliseconds)),
      from
    );
    await h.page.keyboard.press("Space");
    await untilSounding(h.page, false);
    return out;
  };
  // Three bars of four quarters at 120: the lower voice's whole note, its
  // half note at 2 s, the gap at 3 s, which is a rest on the clock, and its
  // last whole note at 4 s with the upper voice's. Read as abcjs alone reads
  // it the list ends at 3 s, on that last note come a half bar early.
  assert.deepEqual(await lower(0, SHORT_BAR("")), [0, 2000, 3000, 4000]);
  assert.deepEqual(await lower(1, SHORT_BAR(" x2")), [0, 2000, 3000, 4000]);
  await pressMode(h.page);

  // The file: the same bytes for the two.
  await h.page.evaluate(() => {
    window.__files = [];
    window.__toHost = function (message) {
      if (!message || message.type !== "exportAudio") return;
      if (message.step === "file") window.__files.push(Array.from(message.bytes).join(","));
      if (message.step === "done") return;
      const reply = message.step === "start" ? { type: "exportAudio", id: message.id, ok: true } : { type: "exportAudio", id: message.id, number: message.number, ok: true };
      setTimeout(() => window.postMessage(reply, "*"), 0);
    };
  });
  await h.page.evaluate(() => window.__mdm.exportAudio("midi"));
  const files = await h.page.evaluate(() => window.__files);
  assert.equal(files.length, 2);
  assert.ok(files[0].length > 100 && files[0] === files[1], "the MIDI of the short bar is not the MIDI of the bar with its rest");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A tune started from where a seek put it reads, for its first frame, a
// little short of that place, which is the tail of the note before: 16 ms
// in this harness and 76 in a VS Code that was being recorded, since what
// it is short by is how long the page was busy when the music was started
// (abcjs counts from the stamp of the frame, and that frame was begun
// before the start). Within a line that is the same spot to the eye. With the seek on
// the first note of a line, which is where Space in the mode puts it when
// the cursor heads a line, the note before is the last of the line above,
// and the playing line was drawn for that frame at the far end of the
// system above: a brass stroke blinking at the right of a line that is not
// sounding (one frame of the README's take of 2026-10-06, where the second
// of two lines was played from its head), and the page told that the music
// was up there. The line holds to the place the music was put at for as
// long as the timer's own start has the music there or past it
// (cursorFrame, playerClock). Numbered after the take's own test and
// not in the run of the mode's, which another round was adding to the same
// morning.
const TWO_LINES = ["```abc", "X:1", "M:4/4", "L:1/4", "Q:1/4=120", "K:D", "V:1", "g f e2 | f4 |", "g f e2 | f4 |]", "V:2 clef=bass", "D,4 | D,4 |", "D,4 | D,4 |]", "```", ""].join("\n");

test("music started at the head of a line draws its playing line on that line from the first frame (SM93b)", { skip }, async () => {
  const h = await open({ text: TWO_LINES, scores: 1, height: 760 });
  await pressMode(h.page);
  const st = await staves(h.page, 0);
  assert.equal(st.length, 4, "the score is not two lines of two staves");
  // The first note of the second line: the fifth head of the upper voice.
  const hs = await heads(h.page, 0);
  const lower = hs.filter((p) => p.y > st[1].bottom).sort((a, b) => a.y - b.y || a.x - b.x);
  const top = lower.filter((p) => Math.abs(p.y - lower[0].y) < 30).sort((a, b) => a.x - b.x)[0];
  await h.page.mouse.click(top.x, top.y);
  assert.equal(await placeText(h.page), "g");
  // Every height the playing line is given from here on, as it is set: a
  // line drawn for one frame is in no picture taken afterwards.
  await h.page.evaluate(() => {
    window.__tops = [];
    window.__lefts = [];
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    new MutationObserver((changes) => {
      changes.forEach((change) => {
        const el = change.target;
        if (!el.classList || !el.classList.contains("mdm-play-cursor")) return;
        if (change.attributeName === "y1") window.__tops.push(Number(el.getAttribute("y1")));
        else window.__lefts.push(Number(el.getAttribute("x1")));
      });
    }).observe(svg, { attributes: true, attributeFilter: ["y1", "x1"], subtree: true });
  });
  await h.page.keyboard.press("Space");
  await untilSounding(h.page, true);
  await sleep(500);
  await h.page.keyboard.press("Space");
  const tops = await h.page.evaluate(() => window.__tops);
  assert.ok(tops.length >= 10, "the playing line was set " + tops.length + " times in half a second of music");
  // Where the second line's system begins, in the score's own units: every
  // frame of the line is on it, and none on the system above.
  const unique = Array.from(new Set(tops.map((y) => Math.round(y))));
  assert.equal(unique.length, 1, "the playing line was drawn at the heights " + unique.join(", ") + " in the first half second");
  // And it goes on with the music from there: held to the place the music
  // was put at for a frame that reads short of it, not for as long as the
  // music is past it. Half a second at 120 is a beat, the first note of the
  // line to the second.
  const lefts = await h.page.evaluate(() => window.__lefts);
  const second = hs.filter((p) => Math.abs(p.y - top.y) < 30 && p.x > top.x + 2).sort((a, b) => a.x - b.x)[0];
  const unit = await h.page.evaluate(() => document.querySelector("#app .mdm-score code.language-abc svg").getScreenCTM().a);
  const went = (lefts[lefts.length - 1] - lefts[0]) * unit;
  assert.ok(went > (second.x - top.x) * 0.5, "in half a second of music the playing line went " + went.toFixed(1) + " px, with the next note " + (second.x - top.x).toFixed(1) + " px on");
  const firstTop = await h.page.evaluate(() => {
    const svg = document.querySelector("#app .mdm-score code.language-abc svg");
    const m = svg.getScreenCTM();
    const line = svg.querySelector(".mdm-play-cursor");
    return line ? m.d * Number(line.getAttribute("y1")) + m.f : null;
  });
  assert.ok(firstTop !== null && firstTop > st[1].bottom, "the playing line stands at " + firstTop + ", over the second line's system at " + st[2].top);

  // The same with the clock held by hand, since the music does not show its
  // step back on every start: without the hold the half second above drew
  // the line on the upper system in two runs of six here, and by 16 ms,
  // where the window of the take drew it there by 76. The music, paused
  // now, is put on the head of the second line as the mode puts it (the
  // player's own seek, half way through four bars), and the timer is then
  // set as a start leaves it: running from that place by the clock of the
  // page, and reading short of it, as the frame begun before the start
  // reads. The line stays on the second line however short the reading,
  // 76 ms as measured or the third of a second of a busier page.
  const lineTop = () =>
    h.page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const line = document.querySelector("#app .mdm-score code.language-abc svg .mdm-play-cursor");
                done(line ? Math.round(Number(line.getAttribute("y1"))) : null);
              })
            )
          )
        )
    );
  await untilSounding(h.page, false);
  await h.page.evaluate(() => window.__mdm.player.seekTo(0.5));
  await sleep(300);
  const onSecond = await lineTop();
  assert.equal(onSecond, unique[0], "a seek to the head of the second line does not put the playing line on it");
  // The timer as it would stand `since` ms after a start from `began` ms
  // into the tune (or paused at `paused` of it, with no start given), its
  // clock reading `reads`.
  const timerAs = (state) =>
    h.page.evaluate((state) => {
      const timer = window.__mdm.player.controller.timer;
      // Its clock is a function of the timer's own and not of a prototype:
      // kept with the rest, since deleting the stand-in leaves no clock.
      if (!window.__kept) window.__kept = { isRunning: timer.isRunning, startTime: timer.startTime, pausedPercent: timer.pausedPercent, currentMillisecond: timer.currentMillisecond };
      if (state.began !== undefined) {
        timer.isRunning = true;
        timer.pausedPercent = null;
        timer.startTime = performance.now() - state.began;
      } else {
        timer.isRunning = false;
        timer.pausedPercent = state.paused;
        timer.startTime = performance.now() - state.paused * timer.lastMoment;
      }
      timer.currentMillisecond = function () {
        return state.reads;
      };
    }, state);
  const timerBack = () =>
    h.page.evaluate(() => {
      Object.assign(window.__mdm.player.controller.timer, window.__kept);
      window.__kept = null;
    });
  const held = () => h.page.evaluate(() => window.__mdm.player.from);
  await timerAs({ began: 4000, reads: 4000 - 16 });
  assert.equal(await lineTop(), onSecond, "with the clock 16 ms short of the start the playing line left the line the music was put on");
  await timerAs({ began: 4000, reads: 4000 - 76 });
  assert.equal(await lineTop(), onSecond, "with the clock 76 ms short of the start, as the window of the take read, the playing line left the line the music was put on");
  await timerAs({ began: 4000, reads: 4000 - 320 });
  assert.equal(await lineTop(), onSecond, "with the clock a third of a second short of the start the playing line left the line the music was put on");
  // Paused on that frame, which leaves the clock at the short reading for
  // as long as the pause lasts: the place of the pause is the music's.
  await timerAs({ paused: 0.501, reads: 4000 - 76 });
  assert.equal(await lineTop(), onSecond, "paused on the frame that read short, the playing line left the line the music stands on");
  assert.equal(await held(), 0.5, "the place the music was put at was let go of while the music stood on it");
  // Music that is before the place, by the timer's own start as well as by
  // the reading, was taken there by some other road: the line goes with it
  // to the line above, and the place is let go of.
  await timerAs({ began: 3800, reads: 3800 + 16 });
  const moved = await lineTop();
  assert.ok(moved !== null && moved < onSecond, "with the music a fifth of a second before the place it had been put at, the playing line is still held to that place, at " + moved);
  assert.equal(await held(), null, "the place the music was put at is still kept, with the music before it");
  // And paused before the place, the same.
  await timerBack();
  await h.page.evaluate(() => window.__mdm.player.seekTo(0.5));
  await sleep(300);
  assert.equal(await lineTop(), onSecond);
  await timerAs({ paused: 0.45, reads: 3600 });
  const back = await lineTop();
  assert.ok(back !== null && back < onSecond, "with the music paused before the place it had been put at, the playing line is still held to that place, at " + back);
  await timerBack();
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- The keys of the mode on the bar and at the side (2026-10-13) ----
//
// What the mode's keys do is written once (scoreRoster in main.js) and shown
// twice: under the Score menu, and on the score panel down the right edge.
// Whatever names one key there is a command, and does what the key does.

// A tune with room to write in, and a tied pair on its second line, which
// the score will not let a figure's key rewrite.
const ROSTER_SOURCE = ["X:1", "M:4/4", "L:1/4", "K:C", "C D E F | G A B c |", "c2- c2 | A G F E |]"].join("\n");
const ROSTER = ["Words.", "", "```abc", ROSTER_SOURCE, "```", ""].join("\n");
// The same with a verse under its first line, where a note made a rest
// takes its syllable with it (SM125).
const ROSTER_SUNG = ROSTER.replace("C D E F | G A B c |", "C D E F | G A B c |\nw: one two three four five six sev-en eight");

// What a command leaves behind it: the text, where the cursor stands and
// what is chosen from it, the figure in use, what went to the clipboard, and
// whether anything sounds.
function rosterState(page) {
  return page.evaluate(() => {
    const c = window.__mdm.scoreCursor;
    // The figure in use, lit on the pad, and not the word of the face in
    // sight, which wears the same disc.
    const lit = [...document.querySelectorAll("#app .mdm-score-panel .mdm-score-panel__key.mdm-btn--on")].map((el) => el.getAttribute("data-type"));
    return {
      text: window.__mdm.view.state.doc.toString(),
      cursor: c ? { track: c.track, stop: c.stop, step: c.step, anchor: c.anchor, whole: !!c.whole } : null,
      figure: lit,
      copied: (window.__copied || []).slice(),
      sounding: !!document.querySelector(".mdm-audio .abcjs-midi-start.abcjs-pushed"),
    };
  });
}

// One command done one way, on a page of its own: by its key, by its row
// under the Score menu, or on the score panel (a key of the pad, or its row
// there). The panel is up in all three, so the score is drawn at one width
// and a click finds the same head.
async function rosterRun(one, way) {
  const h = await open({ text: one.text || ROSTER, scores: 1, clipboard: true, seed: { settings: { scorePanel: "shown" } } });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  // The cursor on the D of the first bar, by a click on its head.
  await h.page.mouse.click(hs[1].x, hs[1].y);
  await sleep(150);
  if (one.setup) await one.setup(h.page);
  await sleep(150);
  const before = await rosterState(h.page);
  if (way === "key") await one.key(h.page);
  else if (way === "row") await pressBar(h.page, one.name);
  else await pressPanel(h.page, one.name);
  if (one.sounds) await untilSounding(h.page, true);
  await sleep(400);
  const after = await rosterState(h.page);
  assert.deepEqual(h.errors, [], one.name + " by its " + way);
  await h.close();
  return { before, after };
}

async function rosterAgree(commands) {
  for (const one of commands) {
    const name = one.name + (one.what ? " " + one.what : "");
    const byKey = await rosterRun(one, "key");
    assert.notDeepEqual(byKey.after, byKey.before, name + ": its key did nothing here, so the three ways compare nothing");
    for (const way of ["row", "panel"]) {
      const other = await rosterRun(one, way);
      assert.deepEqual(other.before, byKey.before, name + ": the " + way + " started from another place than the key");
      assert.deepEqual(other.after, byKey.after, name + ": pressed on the " + (way === "row" ? "Score menu" : "score panel") + " it does not do what its key does");
    }
  }
}

const up = (n) => (page) => press(page, "ArrowUp", n);
const WRITES = [1, 2, 3, 4, 5, 6, 7]
  .map((digit) => ({
    name: "score-note-" + digit,
    // A step over the D: the key puts a head there and gives the place its
    // figure, so every one of the seven changes the text, the quarter too.
    setup: up(1),
    key: (page) => page.keyboard.press(String(digit)),
  }))
  .concat([
    { name: "score-rest", key: (page) => page.keyboard.press("0") },
    // Under a verse, where the rest takes the note's syllable with it
    // (the owner's call of 2026-10-15 for 0, SM125): the row and the
    // panel's key as the key.
    { name: "score-rest", what: "under a verse", text: ROSTER_SUNG, key: (page) => page.keyboard.press("0") },
    { name: "score-chord", setup: up(2), key: (page) => page.keyboard.press("Enter") },
    { name: "score-take-out", key: (page) => page.keyboard.press("Delete") },
    { name: "score-bar-before", key: (page) => chord(page, ["Control"], "ArrowLeft") },
    { name: "score-bar-after", key: (page) => chord(page, ["Control"], "ArrowRight") },
  ]);

test("a row of the Score menu that writes, and its key on the score panel, do what the key of the keyboard does (SM109)", { skip }, async () => {
  await rosterAgree(WRITES);
});

const chooseTwo = async (page) => {
  await chord(page, ["Shift"], "ArrowRight");
  await chord(page, ["Shift"], "ArrowRight");
};
const CHOOSES = [
  { name: "score-select-all", key: (page) => chord(page, ["Control"], "a") },
  { name: "score-copy", setup: chooseTwo, key: (page) => chord(page, ["Control"], "c") },
  { name: "score-cut", setup: chooseTwo, key: (page) => chord(page, ["Control"], "x") },
  {
    name: "score-paste",
    setup: (page) => page.evaluate(() => (window.__clipboard = "G2 A2")),
    key: (page) => chord(page, ["Control"], "v"),
  },
  { name: "score-let-go", setup: chooseTwo, key: (page) => page.keyboard.press("Escape") },
  { name: "score-play", sounds: true, key: (page) => page.keyboard.press("Space") },
];

test("a row of the Score menu that chooses, copies, pastes or plays does what its key does, on the menu and on the score panel (SM110)", { skip }, async () => {
  await rosterAgree(CHOOSES);
});

// The figure in use is the one a key would write with: the note's the
// cursor is put on, or the one the last figure's key left. Nothing on the
// staff has shown it since the figure drawn on the cursor went (2026-10-02),
// and it is what 0 writes a rest of. The Score menu ticks it among the
// figures and the score panel lights it on the pad, and both follow it
// wherever it changes: a note the cursor comes to, a key, and a key the
// score then refuses, which changes the figure and draws nothing.
test("the figure in use is ticked under Notes and lit on the pad, and follows the cursor and the keys, a refused one too (SM111)", { skip }, async () => {
  const h = await open({ text: ROSTER, scores: 1, seed: { settings: { scorePanel: "shown" } } });
  const inUse = async (page) => {
    const out = { ticked: [], lit: [] };
    for (const digit of [1, 2, 3, 4, 5, 6, 7]) {
      const name = "score-note-" + digit;
      if ((await barState(page || h.page, name)).on) out.ticked.push(digit);
      if ((await panelState(page || h.page, name)).on) out.lit.push(digit);
    }
    return out;
  };
  // None out of the mode.
  assert.deepEqual(await inUse(), { ticked: [], lit: [] });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  await h.page.mouse.click(hs[1].x, hs[1].y);
  await sleep(150);
  assert.deepEqual(await inUse(), { ticked: [3], lit: [3] }, "on a quarter");
  // A key of a figure.
  await h.page.keyboard.press("2");
  await sleep(300);
  assert.match(await docText(h.page), /C D2 E F \|/);
  assert.deepEqual(await inUse(), { ticked: [2], lit: [2] }, "after the key of the half note");
  // The cursor on a note of another figure takes it.
  await press(h.page, "ArrowRight");
  await sleep(150);
  assert.deepEqual(await inUse(), { ticked: [3], lit: [3] }, "on the quarter after it");
  // A key the score refuses: the first of the tied pair is not rewritten,
  // and the figure the key left is in use all the same.
  const tied = (await heads(h.page, 0))[8];
  await h.page.mouse.click(tied.x, tied.y);
  await sleep(150);
  assert.deepEqual(await inUse(), { ticked: [2], lit: [2] }, "on the tied half note");
  const text = await docText(h.page);
  await h.page.keyboard.press("4");
  await sleep(300);
  assert.equal(await docText(h.page), text, "the tied note was rewritten, so the refusal reads nothing");
  assert.ok(await h.page.$("#app .mdm-score-notice"), "the score did not say why");
  assert.deepEqual(await inUse(), { ticked: [4], lit: [4] }, "after a key the score refused");
  // The tick is a row's own mark and the disc a button's: read with the
  // menu open, the tick stands after the name.
  await pressBar(h.page, "score-notes");
  await sleep(120);
  const row = await h.page.$eval('#app .mdm-toolbar button[data-type="score-note-4"]', (b) => {
    const tick = b.querySelector(".mdm-swatch__tick");
    return { pressed: b.getAttribute("aria-pressed"), afterName: !!tick && tick.previousSibling.nodeType === 3, ground: getComputedStyle(b).backgroundColor };
  });
  assert.deepEqual(row, { pressed: "true", afterName: true, ground: "rgba(0, 0, 0, 0)" });
  assert.equal(await h.page.$eval('#app .mdm-score-panel button[data-type="score-note-4"]', (b) => b.getAttribute("aria-pressed")), "true");
  await h.page.keyboard.press("Escape");
  // And none again with the mode off.
  await pressMode(h.page);
  assert.deepEqual(await inUse(), { ticked: [], lit: [] }, "out of the mode");
  assert.deepEqual(h.errors, []);
  await h.close();

  // A score that opens with a rest: the cursor starts on it, no figure is
  // kept yet, and the one in use is the one the meter counts in, which is
  // what 0 would write there: an eighth under 6/8.
  const rest = await open({ text: ["Words.", "", "```abc", "X:1", "M:6/8", "L:1/8", "K:C", "z3 CDE |]", "```", ""].join("\n"), scores: 1, seed: { settings: { scorePanel: "shown" } } });
  await pressMode(rest.page);
  assert.deepEqual(await inUse(rest.page), { ticked: [4], lit: [4] }, "on the rest a score opens with");
  assert.deepEqual(rest.errors, []);
  await rest.close();
});

// The score panel is chrome, and a press on it never takes the keyboard: in
// the mode it stays the mode's, so a key of the pad and the arrow after it
// are one gesture. The switch at its head is the way out of the mode, in one
// press (the panel is up only under the mode: SM113): it gives the caret
// back where the mode found it, as the row of the menu does.
test("a press on the score panel leaves the keyboard with the mode, and its switch gives the caret back to the text (SM112)", { skip }, async () => {
  const two = ["Two tunes.", "", "```abc", "X:1", "K:C", "CDEF|", "```", "", "```abc", "X:1", "K:G", "GABc|", "```", ""].join("\n");
  const h = await open({ text: two, scores: 2, seed: { settings: { scorePanel: "shown" } } });
  await caretInScore(h.page, 1);
  const selection = await selectionRanges(h.page);
  assert.equal((await modeState(h.page)).source, true);
  await pressMode(h.page);
  assert.equal((await modeState(h.page)).on, true);
  let c = await cursor(h.page);
  assert.equal(c.score, 1, "the cursor did not start on the caret's score");
  const holds = () => h.page.evaluate(() => document.activeElement.className);
  assert.equal(await holds(), "mdm-score-keys");
  // A key of the pad, a row, a word over the faces and a line of the Keys
  // face: the keyboard is still the mode's after each, and the next arrow
  // walks the cursor.
  for (const name of ["score-note-2", "score-copy", "score-face-keys"]) {
    await pressPanel(h.page, name);
    await sleep(150);
    assert.equal(await holds(), "mdm-score-keys", "a press on " + name + " took the keyboard from the mode");
  }
  await postSettings(h.page, { scorePanel: "shown", scorePanelFace: "keys" });
  await sleep(150);
  await h.page.click('#app .mdm-score-panel [data-line="score-keys-step"]');
  await sleep(150);
  assert.equal(await holds(), "mdm-score-keys", "a press on a line of the Keys face took the keyboard from the mode");
  // A half note where the tune counts in eighths: four of them.
  assert.match(await docText(h.page), /G4ABc\|/, "the key of the pad did not write");
  await press(h.page, "ArrowRight");
  await sleep(100);
  assert.notEqual((await cursor(h.page)).from, c.from, "the arrow after a press on the panel did not walk the cursor");
  // Off from the same switch: the caret where the mode found it, in a text
  // that takes what is typed.
  await pressPanel(h.page, "mdm-score-navigation");
  await sleep(200);
  assert.equal((await modeState(h.page)).on, false);
  // Where it was in the text: the caret stood at the foot of the score, and
  // the one character the pad wrote stands before it.
  assert.deepEqual(await selectionRanges(h.page), selection.map((range) => range.map((pos) => pos + 1)));
  assert.equal((await modeState(h.page)).source, true, "the block the caret is in did not open again");
  const before = await docText(h.page);
  await h.page.keyboard.type("Q");
  assert.notEqual(await docText(h.page), before, "the text did not take the keyboard back");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- The score panel and the mode (2026-10-13, the third round) ----

// What the page says of the panel: whether its row of the Score menu is
// ticked, whether the panel is on screen, and whether the mode is on.
async function panelSays(page) {
  const row = await barState(page, "mdm-score-panel");
  return page.evaluate((ticked) => {
    const panel = document.querySelector("#app .mdm-score-panel");
    return {
      ticked,
      up: getComputedStyle(panel).display !== "none" && panel.getBoundingClientRect().width > 0,
      mode: document.getElementById("app").classList.contains("mdm--score-mode"),
    };
  }, row.on);
}

// The score panel is up while two things are so, that it is asked for and
// that the mode is on, and neither alone brings it (the owner's rule of
// 2026-10-13, after trying it kept up out of the mode: "solo debe aparecer
// cuando está en on Y score navigation también en on"). Its row in the Score
// menu is ticked by the asking alone, whatever the mode ("si score navigation
// está en off ... debe mostrar la palomita aunque no se vea"): out of the
// mode the row says what the mode will bring. The row writes the setting in
// the mode and out of it, and under the mode the panel follows the setting
// at once, the mode staying as it is.
test("the score panel is up only while it is asked for and the mode is on, and its row is ticked by the asking alone (SM113)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1, seed: { settings: { scorePanel: "shown" } } });
  const editor = () => h.page.$eval("#app .mdm-editor", (el) => Math.round(el.getBoundingClientRect().width));
  const asks = async () => (await setSettingPosts(h.page)).filter((p) => p.key === "scorePanel").map((p) => p.value);
  // Opened with the panel asked for: a ticked row, and no panel.
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: false, mode: false }, "asked for, out of the mode");
  const whole = await editor();

  // The mode brings it, and the editor gives it its width.
  await pressMode(h.page);
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: true, mode: true }, "asked for, under the mode");
  const panel = await h.page.$eval("#app .mdm-score-panel", (el) => Math.round(el.getBoundingClientRect().width));
  assert.equal(await editor(), whole - panel, "the panel did not take its width from the editor");

  // Its row pressed under the mode asks the host for the other way, and as
  // the setting comes back the panel goes and the mode stays.
  await pressBar(h.page, "mdm-score-panel");
  assert.deepEqual(await asks(), ["hidden"]);
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: true, mode: true }, "the panel went before the host answered");
  await postSettings(h.page, { scorePanel: "hidden" });
  await sleep(200);
  assert.deepEqual(await panelSays(h.page), { ticked: false, up: false, mode: true }, "not asked for, under the mode");
  assert.equal(await editor(), whole, "the editor did not take its width back");
  assert.ok(await cursor(h.page), "the cursor went with the panel");
  // And asked for again there: up at once.
  await pressBar(h.page, "mdm-score-panel");
  assert.deepEqual(await asks(), ["hidden", "shown"]);
  await postSettings(h.page, { scorePanel: "shown" });
  await sleep(200);
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: true, mode: true }, "asked for again, under the mode");

  // The mode left: the panel goes with it, and the row keeps its tick.
  await pressMode(h.page);
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: false, mode: false }, "asked for, the mode left");
  assert.equal(await editor(), whole, "the editor did not take its width back as the mode was left");

  // Out of the mode the row writes the setting still, and nothing comes up
  // or goes as it comes back, one way or the other.
  await pressBar(h.page, "mdm-score-panel");
  assert.deepEqual(await asks(), ["hidden", "shown", "hidden"]);
  await postSettings(h.page, { scorePanel: "hidden" });
  await sleep(200);
  assert.deepEqual(await panelSays(h.page), { ticked: false, up: false, mode: false }, "not asked for, out of the mode");
  await postSettings(h.page, { scorePanel: "shown" });
  await sleep(200);
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: false, mode: false }, "asked for out of the mode: the setting alone brought the panel up");
  assert.equal(await editor(), whole);

  // And the mode alone brings none.
  await postSettings(h.page, { scorePanel: "hidden" });
  await sleep(200);
  await pressMode(h.page);
  assert.deepEqual(await panelSays(h.page), { ticked: false, up: false, mode: true }, "not asked for, under the mode: the mode alone brought the panel up");
  assert.equal(await editor(), whole);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The panel takes its width from the column, so in a pane with no room to
// spare the text wraps again as it comes up, and what stands under a
// paragraph moves down by the lines the paragraph gained, and back up as it
// goes. The score the cursor is on, while the cursor is in the pane, is what
// the reader is looking at, and it stays where it stands: as the panel comes
// up under the mode, as it goes, as the mode is left and the panel goes with
// it, and as the mode brings it up, where the cursor is put down first, on
// the score the pane showed when the mode was asked for. Left to itself that
// score went past the foot of the pane in the press that started the mode on
// it.
//
// Two pages. On the first the paragraph that gains lines is in the pane,
// over the score. On the second the paragraphs are over the head of the pane
// and drawn there: CodeMirror keeps the line at the head of the pane where it
// is by scrolling for what grew above it, working from the heights it had
// before the change, and a page moved before that measure was moved twice
// for the same lines (the review of this round, 2026-10-13: seen once the
// score was held by a scroll made the moment the panel came).
const WRAPS = (sentences) => Array.from({ length: sentences }, (_, i) => "Sentence " + (i + 1) + " of a paragraph long enough to gain lines when the column loses a third of its width to the panel beside it.").join(" ");
const TUNE = (key, notes) => ["```abc", "X:1", "K:" + key, notes, "```"];
const PUSHED = ["First.", "", ...TUNE("C", "CDEF|GABc|"), "", WRAPS(16), "", ...TUNE("G", "GABc|defg|"), "", WRAPS(16), "", WRAPS(16), ""].join("\n");
const OVERHEAD = ["First.", "", ...TUNE("C", "CDEF|GABc|"), "", WRAPS(6), "", WRAPS(6), "", WRAPS(6), "", WRAPS(6), "", ...TUNE("G", "GABc|defg|"), "", WRAPS(16), "", WRAPS(16), ""].join("\n");
// And a page with short paragraphs on both sides of the second score, so that
// whichever side of the pane the score is out of, a paragraph that wraps
// stands whole between it and the block at the head of the pane.
const BETWEEN = ["First.", "", ...TUNE("C", "CDEF|GABc|"), "", WRAPS(6), "", WRAPS(6), "", WRAPS(6), "", ...TUNE("G", "GABc|defg|"), "", WRAPS(6), "", WRAPS(6), "", WRAPS(6), "", WRAPS(6), "", WRAPS(16), "", WRAPS(16), ""].join("\n");

// The pane, and where the second score of the page stands in it.
function paneOf(page) {
  return page.evaluate(() => {
    const scroller = window.__mdm.view.scrollDOM;
    const top = scroller.getBoundingClientRect().top;
    // The score by its key, the first one being out of what CodeMirror keeps
    // drawn once the page has been taken far enough down.
    const block = [...document.querySelectorAll("#app .mdm-score")].find((el) => (el.getAttribute("data-mdm-source") || "").indexOf("K:G") >= 0);
    const box = block ? block.getBoundingClientRect() : null;
    // The block at the head of the pane, which CodeMirror holds where it is:
    // the first of the document's lines and drawings that reaches under it.
    const line = [...document.querySelector("#app .cm-content").children].find((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.bottom > top + 8;
    });
    return {
      paneTop: top,
      paneBottom: top + scroller.clientHeight,
      scrollTop: scroller.scrollTop,
      score: box ? { top: box.top, bottom: box.bottom } : null,
      head: line ? { says: line.textContent.slice(0, 24), top: line.getBoundingClientRect().top - top } : null,
    };
  });
}

// The second score put `down` pixels under the head of the pane.
async function scoreDown(page, down) {
  const now = await paneOf(page);
  await page.evaluate((by) => (window.__mdm.view.scrollDOM.scrollTop += by), Math.round(now.score.top - now.paneTop - down));
  await sleep(250);
}

test("the score the cursor is on stays where it stands as the score panel comes and goes and the text wraps again (SM114)", { skip }, async () => {
  for (const [what, text, tall, down] of [
    ["the paragraph in the pane", PUSHED, 700, 520],
    ["the paragraphs over the head of the pane", OVERHEAD, 700, 420],
    ["the paragraphs over the head of the pane, the score high in it", OVERHEAD, 700, 150],
  ]) {
    const h = await open({ text, scores: 2 });
    await h.page.setViewport({ width: 900, height: tall });
    await sleep(300);
    await scoreDown(h.page, down);
    const before = await paneOf(h.page);
    assert.ok(before.score.top > before.paneTop && before.score.bottom <= before.paneBottom, what + ": the second score is not whole in the pane to begin with: " + JSON.stringify(before));
    // How tall the paragraphs over the second score are, of the ones
    // CodeMirror has drawn: what gains lines as the column narrows.
    const over = () =>
      h.page.evaluate(() => {
        const score = [...document.querySelectorAll("#app .mdm-score")].find((el) => (el.getAttribute("data-mdm-source") || "").indexOf("K:G") >= 0).getBoundingClientRect();
        return [...document.querySelectorAll("#app .cm-line")]
          .filter((l) => l.textContent.startsWith("Sentence 1 ") && l.getBoundingClientRect().bottom <= score.top)
          .reduce((sum, l) => sum + l.getBoundingClientRect().height, 0);
      });
    const short = await over();

    // The mode with no panel asked for: the cursor is put down on the second
    // score, the first being out of the pane, and where that score stands
    // then is where it is to stay.
    await pressMode(h.page);
    await sleep(300);
    const stood = await paneOf(h.page);
    let c = await cursor(h.page);
    assert.ok(c && c.top >= stood.paneTop && c.bottom <= stood.paneBottom, what + ": the cursor is not in the pane as the mode starts: " + JSON.stringify([c, stood]));
    const stays = async (why) => {
      const now = await paneOf(h.page);
      assert.ok(now.score && Math.abs(now.score.top - stood.score.top) <= 1, what + ": " + why + ": it stood at " + stood.score.top + " and stands at " + (now.score && now.score.top));
    };

    // The panel asked for under the mode. The text gains lines, by more than
    // the room the score had under it; and the score does not move.
    await postSettings(h.page, { scorePanel: "shown" });
    await sleep(450);
    assert.deepEqual(await panelSays(h.page), { ticked: true, up: true, mode: true });
    const gained = (await over()) - short;
    assert.ok(gained > 100, what + ": the text over the score gained " + gained + "px, so this reads nothing");
    await stays("the score moved as the panel came up under the mode");
    // And still there once the page has settled.
    await sleep(500);
    await stays("the score moved a moment after the panel came up");
    c = await cursor(h.page);
    assert.ok(c.top >= stood.paneTop && c.bottom <= stood.paneBottom, what + ": the cursor's line left the pane");
    // As it goes.
    await postSettings(h.page, { scorePanel: "hidden" });
    await sleep(450);
    await stays("the score moved as the panel went under the mode");

    // The mode left with the panel up: the panel goes with it, and the score
    // the cursor was on stays, with no cursor on it any more.
    await postSettings(h.page, { scorePanel: "shown" });
    await sleep(450);
    await pressMode(h.page);
    await sleep(450);
    assert.deepEqual(await panelSays(h.page), { ticked: true, up: false, mode: false });
    await stays("the score moved as the mode was left and the panel went with it");
    // And entered again, the panel coming with it: the cursor on the score
    // the pane showed when the mode was asked for, and the score where it
    // stood.
    await pressMode(h.page);
    await sleep(450);
    assert.deepEqual(await panelSays(h.page), { ticked: true, up: true, mode: true });
    c = await cursor(h.page);
    assert.ok(c, what + ": the mode put no cursor down as it brought the panel");
    await stays("the score moved as the mode brought the panel up");
    assert.ok(c.top >= stood.paneTop && c.bottom <= stood.paneBottom, what + ": the cursor's line is out of the pane as the mode brought the panel: " + JSON.stringify([c, stood]));
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

// A cursor the reader has scrolled away from holds nothing: the page is left
// to CodeMirror, which keeps the block at the head of the pane where it is,
// as the panel comes and as it goes. Taking the page back to the cursor, or
// holding a score nobody is looking at while the text in the pane slides, is
// not what the row was pressed for. With the cursor's line under the foot of
// the pane, and with it over the head; near enough in both for CodeMirror to
// keep the score drawn, and with a paragraph whole between the score and the
// block at the head of the pane: a score held there drags that block with it
// by the lines the paragraph gains, which is what this would see.
test("a cursor out of the pane holds nothing as the score panel comes and goes: the head of the pane stays (SM115)", { skip }, async () => {
  const h = await open({ text: BETWEEN, scores: 2 });
  await h.page.setViewport({ width: 900, height: 700 });
  await sleep(300);
  await scoreDown(h.page, 420);
  await pressMode(h.page);
  await sleep(300);
  const where = async () => {
    const [c, now] = [await cursor(h.page), await paneOf(h.page)];
    return !c ? "gone" : c.top > now.paneBottom ? "under" : c.bottom < now.paneTop ? "over" : "in";
  };
  assert.equal(await where(), "in");
  for (const want of ["under", "over"]) {
    const [c, now] = [await cursor(h.page), await paneOf(h.page)];
    const by = want === "under" ? c.top - now.paneBottom - 300 : c.bottom - now.paneTop + 500;
    await h.page.evaluate((by) => (window.__mdm.view.scrollDOM.scrollTop += by), Math.round(by));
    await sleep(300);
    assert.equal(await where(), want, "the cursor's line was not put " + want + " the pane, so this reads nothing");
    for (const scorePanel of ["shown", "hidden"]) {
      const head = (await paneOf(h.page)).head;
      await postSettings(h.page, { scorePanel });
      await sleep(450);
      assert.equal(await where(), want, "the page was taken to a cursor the reader had scrolled away from, " + want + " the pane: the panel " + scorePanel);
      const after = (await paneOf(h.page)).head;
      assert.ok(head && after && after.says === head.says && Math.abs(after.top - head.top) <= 1, "the head of the pane moved with the cursor " + want + " the pane, the panel " + scorePanel + ": from " + JSON.stringify(head) + " to " + JSON.stringify(after));
    }
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A score wider than the column scrolls in its own box, and the column the
// panel leaves may be narrower than a score that fitted the pane: the note
// under the cursor is brought into the box as the panel comes up, as an arrow
// brings it (SM13). And by the panel alone: with the box scrolled away from
// the cursor by hand, a setting that is not the panel's leaves it there.
test("the cursor's note is brought into the box of a score the panel leaves no room for, and by no other setting (SM116)", { skip }, async () => {
  const wide = ["X:1", "M:4/4", "L:1/4", "K:C", "C D E F | G A B c | d e f g | a b c' d' |"].join("\n");
  const h = await open({ text: ["Wide.", "", "```abc", wide, "```", ""].join("\n"), scores: 1 });
  await h.page.setViewport({ width: 900, height: 700 });
  await sleep(300);
  const box = () =>
    h.page.evaluate(() => {
      const code = document.querySelector("#app .mdm-score code.language-abc");
      const beat = document.querySelector("#app .mdm-score-cursor__beat").getBoundingClientRect();
      const left = code.getBoundingClientRect().left;
      return {
        scrolls: code.scrollWidth > code.clientWidth,
        inside: beat.left >= left - 1 && beat.right <= left + code.clientWidth + 1,
        scrollLeft: code.scrollLeft,
      };
    });
  await pressMode(h.page);
  // The cursor on the last note of the line, by a click on its head.
  const last = (await heads(h.page, 0)).pop();
  await h.page.mouse.click(last.x, last.y);
  await sleep(200);
  let b = await box();
  assert.deepEqual([b.scrolls, b.inside], [false, true], "the score does not fit the pane without the panel, so this reads nothing");

  await postSettings(h.page, { scorePanel: "shown" });
  await sleep(450);
  b = await box();
  assert.ok(b.scrolls, "the score fits the column the panel leaves, so this reads nothing");
  assert.ok(b.inside && b.scrollLeft > 0, "the cursor's note is out of its score's box as the panel came up: " + JSON.stringify(b));

  // The box taken back to its start by hand: the cursor is out of it, and a
  // setting come back with the panel as it was leaves it so.
  await h.page.evaluate(() => (document.querySelector("#app .mdm-score code.language-abc").scrollLeft = 0));
  await sleep(150);
  assert.equal((await box()).inside, false, "the cursor is in the box with the box at its start, so this reads nothing");
  await postSettings(h.page, { scorePanel: "shown", staffLines: "ink" });
  await sleep(450);
  assert.deepEqual([(await box()).scrollLeft, (await box()).inside], [0, false], "a setting that is not the panel's took the box to the cursor");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// As the mode is left the text takes the keyboard back, and the block the
// caret is in opens: a score's source comes up over its drawing, which moves
// down by it. That is so with the panel up as with no panel: the score is
// held against the panel's going and against nothing else, so the page is
// where it would be had no panel been asked for. In a pane wide enough for
// the panel to move no line, so that all there is to hold against is the
// source.
test("the mode left with the caret's score opening leaves the page where it would be with no panel (SM117)", { skip }, async () => {
  const doc = [WRAPS(16), "", ...TUNE("G", "GABc|defg|"), "", WRAPS(16), "", WRAPS(16), ""].join("\n");
  const run = async (scorePanel) => {
    const h = await open({ text: doc, scores: 1, seed: { settings: { scorePanel } } });
    await h.page.setViewport({ width: 1400, height: 700 });
    await sleep(300);
    const drawing = () =>
      h.page.evaluate(() => {
        const scroller = window.__mdm.view.scrollDOM;
        const svg = document.querySelector("#app .mdm-score code.language-abc svg");
        return { top: Math.round(svg.getBoundingClientRect().top - scroller.getBoundingClientRect().top), scroll: Math.round(scroller.scrollTop), source: !!document.querySelector("#app .cm-line.mdm-src-line") };
      });
    // The page taken down so that it can go either way, and the caret put in
    // the score's source, which opens it.
    await h.page.evaluate(() => (window.__mdm.view.scrollDOM.scrollTop = 300));
    await sleep(200);
    await caretInScore(h.page, 0);
    await sleep(200);
    const open_ = await drawing();
    await pressMode(h.page);
    await sleep(300);
    const under = await drawing();
    const up = (await panelSays(h.page)).up;
    await pressMode(h.page);
    await sleep(450);
    const left = await drawing();
    assert.deepEqual(h.errors, []);
    await h.close();
    return { open: open_, under, left, up };
  };
  const bare = await run("hidden");
  const panelled = await run("shown");
  assert.deepEqual([bare.up, panelled.up], [false, true], "the panel was not up in the one run and down in the other, so this compares nothing");
  assert.deepEqual([bare.open.source, bare.under.source, bare.left.source], [true, false, true], "the score's source did not go and come back with the mode, so this reads nothing");
  assert.notEqual(bare.left.top, bare.under.top, "the source coming back moved no drawing, so this reads nothing: " + JSON.stringify(bare));
  assert.deepEqual(panelled.under, bare.under, "under the mode the page is not where it is with no panel");
  assert.deepEqual(panelled.left, bare.left, "the mode left with the panel up, the page is not where it is with no panel: the drawing was held against its own source");
});

// ---- The panel's two faces (2026-10-14) ----
//
// The owner's pick of E1 in design/design-score-key-help-E.html, with the
// figures in one line ("Elige todo en lineas pero no vayas nota por nota,
// comprime 1...7"): the panel has two faces, Buttons and Keys, chosen by two
// words under its switch. Buttons holds the pad and the rows that do what
// the keys do; Keys, every key of the mode, on lines to be read beside the
// score while it is written with the keyboard ("La idea es que el usuario
// pueda tener el pentagrama y al lado el panel de score navigation para
// irse fijando mientras edita el score").

// The face in sight is a setting, mdm.scorePanelFace, as whether the panel
// comes at all is: a word asks the host for its face, the face changes as
// the setting comes back, the word of the face in sight wears the disc, and
// the panel comes back on the face it was left on, as the mode is taken
// again and in a document opened again. A press on a word leaves the
// keyboard with the mode.
test("the score panel has two faces, Buttons and Keys, chosen by the two words at its head through a setting, and comes back on the face it was left on (SM118)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1, seed: { settings: { scorePanel: "shown" } } });
  await pressMode(h.page);
  const asks = async () => (await setSettingPosts(h.page)).filter((p) => p.key === "scorePanelFace").map((p) => p.value);
  const on = (face) => ({
    shown: [face],
    away: [face === "buttons" ? "keys" : "buttons"],
    buttons: { on: face === "buttons", pressed: String(face === "buttons") },
    keys: { on: face === "keys", pressed: String(face === "keys") },
  });
  assert.deepEqual(await panelFace(h.page), on("buttons"), "with no setting the panel did not come up on Buttons");
  const c = await cursor(h.page);
  // Keys asked for: nothing moves until the host answers.
  await pressPanel(h.page, "score-face-keys");
  await sleep(150);
  assert.deepEqual(await asks(), ["keys"], "the word did not ask for its face");
  assert.deepEqual(await panelFace(h.page), on("buttons"), "the face changed before the setting came back");
  assert.equal(await h.page.evaluate(() => document.activeElement.className), "mdm-score-keys", "a press on a word took the keyboard from the mode");
  await postSettings(h.page, { scorePanel: "shown", scorePanelFace: "keys" });
  await sleep(200);
  assert.deepEqual(await panelFace(h.page), on("keys"), "the setting came back and the Keys face is not in sight");
  // The word of the face in sight asks for nothing.
  await pressPanel(h.page, "score-face-keys");
  await sleep(120);
  assert.deepEqual(await asks(), ["keys"], "the word of the face in sight asked for it again");
  // And the keyboard is the mode's: the next arrow walks the cursor.
  await press(h.page, "ArrowRight");
  await sleep(120);
  assert.notEqual((await cursor(h.page)).from, c.from, "the arrow after a press on a word did not walk the cursor");
  // The mode left and taken again: the panel is back on Keys.
  await pressMode(h.page);
  assert.equal((await modeState(h.page)).on, false);
  await pressMode(h.page);
  await sleep(150);
  assert.deepEqual(await panelFace(h.page), on("keys"), "the mode taken again, the panel came back on another face");
  // Buttons asked for, and given.
  await pressPanel(h.page, "score-face-buttons");
  await sleep(120);
  assert.deepEqual(await asks(), ["keys", "buttons"], "the word of Buttons did not ask for its face");
  await postSettings(h.page, { scorePanel: "shown", scorePanelFace: "buttons" });
  await sleep(200);
  assert.deepEqual(await panelFace(h.page), on("buttons"), "the setting came back and the Buttons face is not in sight");
  assert.deepEqual(h.errors, []);
  await h.close();
  // A document opened with the panel left on Keys comes up on Keys with the
  // mode.
  const again = await open({ text: WALK, scores: 1, seed: { settings: { scorePanel: "shown", scorePanelFace: "keys" } } });
  await pressMode(again.page);
  assert.deepEqual(await panelFace(again.page), on("keys"), "a document opened with the panel left on Keys came up on another face");
  assert.deepEqual(again.errors, []);
  await again.close();
});

// What the Keys face says, top to bottom: the runs of the Buttons face, with
// the moves as a run of their own before the choosing, and the playing and
// the history last; a line to a key or to a pair or a run of keys, the
// seven figures one line under the quarter note's glyph, and the two sides of
// a note one line, and of a rest (the owner's asks of 2026-10-14, "ponle
// iconito una negra" and "comprime note to the left/right"); and the keys
// that have no row anywhere written
// there, under names of mine that follow what the owner's have in common
// (B14): a rest of a figure to either side, Backspace, and with a stretch
// chosen the walk over the parts and the pick of one. A rest to the left is
// Ctrl+Shift on a Mac, whose system takes Cmd+Shift+3, 4 and 5. Each line:
// its name, what it says, its key on a PC and on a Mac, and whether it has
// a glyph.
const KEYS_FACE = [
  "# Notes",
  ["score-keys-note", "Note of given length", "1\u20267", "1\u20267", true],
  ["score-rest", "Rest", "0", "0", true],
  ["score-keys-rest", "Rest of given length", "Shift+1\u20267", "\u21e71\u20267", true],
  "|",
  ["score-keys-sides", "Note to the left/right", "Ctrl/Alt+1\u20267", "\u2318/\u23251\u20267", false],
  ["score-keys-rest-sides", "Rest to the left/right", "Ctrl/Alt+Shift+1\u20267", "\u2303/\u2325\u21e71\u20267", false],
  ["score-chord", "A note more in the chord", "Enter", "Enter", true],
  ["score-take-out", "Take out", "Delete", "Delete", true],
  ["score-keys-back", "Take out and move left", "Backspace", "Backspace", false],
  "# Bars",
  ["score-bar-before", "Add bar to the left", "Ctrl+\u2190", "\u2318\u2190", true],
  ["score-bar-after", "Add bar to the right", "Ctrl+\u2192", "\u2318\u2192", true],
  "# Move",
  ["score-keys-across", "Move left/right", "\u2190 \u2192", "\u2190 \u2192", false],
  ["score-keys-step", "Step up/down", "\u2191 \u2193", "\u2191 \u2193", false],
  ["score-keys-staff", "Staff above/below", "Ctrl+\u2191 \u2193", "\u2318\u2191 \u2193", false],
  ["score-keys-line", "Line above/below", "Ctrl+Shift+\u2191 \u2193", "\u21e7\u2318\u2191 \u2193", false],
  "# Selection",
  ["score-keys-select", "Select", "Shift+\u2190 \u2192", "\u21e7\u2190 \u2192", false],
  ["score-keys-select-parts", "Select in every part", "Ctrl+Shift+\u2190 \u2192", "\u21e7\u2318\u2190 \u2192", false],
  ["score-keys-parts", "Part above/below", "Ctrl+Shift+\u2191 \u2193", "\u21e7\u2318\u2191 \u2193", false],
  ["score-keys-pick", "Add/remove part", "Ctrl+Shift+Space", "\u21e7\u2318Space", false],
  "|",
  ["score-select-all", "Select all scores", "Ctrl+A", "\u2318A", false],
  ["score-copy", "Copy", "Ctrl+C", "\u2318C", false],
  ["score-cut", "Cut", "Ctrl+X", "\u2318X", false],
  ["score-paste", "Paste", "Ctrl+V", "\u2318V", false],
  ["score-let-go", "Let go", "Escape", "Escape", false],
  "|",
  ["score-play", "Play/pause", "Space", "Space", true],
  ["score-keys-undo", "Undo", "Ctrl+Z", "\u2318Z", true],
  ["score-keys-redo", "Redo", "Ctrl+Y", "\u21e7\u2318Z", true],
];

// The Keys face holds every key the mode answers to but Ctrl/Alt+0, whose
// line waits for the owner's name (B20) (KEYS_FACE, in that order), each key as the platform writes it, a Mac's signs as its menus
// have them; and a line that is a row says what the row says, its glyph
// included: a row of the Score menu, or for Undo and Redo the Edit menu's,
// whose binding the two lines read. Every row of the Score menu's three
// lists is a line of it, but for the seven figures, which are the one line.
test("the Keys face names every key of the mode as the bar writes it, and a key that has a row says what its row says (SM119)", { skip }, async () => {
  for (const [platform, column] of [
    [undefined, 2],
    ["MacIntel", 3],
  ]) {
    const where = platform || "a PC";
    const h = await open({ text: WALK, scores: 1, platform, seed: { settings: { scorePanel: "shown", scorePanelFace: "keys" } } });
    await pressMode(h.page);
    assert.deepEqual((await panelFace(h.page)).shown, ["keys"], where);
    const lines = await keyLines(h.page);
    assert.deepEqual(
      lines.map((l) => (typeof l === "string" ? l : [l.line, l.name, l.key, l.glyph !== ""])),
      KEYS_FACE.map((l) => (typeof l === "string" ? l : [l[0], l[1], l[column], l[4]])),
      where + ": the Keys face"
    );
    const said = lines.filter((l) => typeof l !== "string");
    let twins = 0;
    for (const l of said) {
      const s = await barState(h.page, { "score-keys-undo": "undo", "score-keys-redo": "redo" }[l.line] || l.line);
      if (!s) continue;
      twins++;
      assert.deepEqual([l.name, l.key, l.glyph], [s.name, s.key, s.glyph], where + ": " + l.line + " does not say on the Keys face what its row says");
    }
    // The lines that are rows: every one of the Score menu's lists but the
    // figures, the play, and the two of the Edit menu.
    assert.equal(twins, 25 - 7 + 1 + 2, where + ": the lines that are rows");
    // The line of the seven figures wears the quarter note's glyph, the very
    // one of the quarter's row.
    assert.equal(said.find((l) => l.line === "score-keys-note").glyph, (await barState(h.page, "score-note-3")).glyph, where + ": the line of the figures does not wear the quarter note");
    const rows = await h.page.$$eval(
      '#app .mdm-toolbar [data-type="score-notes"] + .mdm-menu > [data-type], #app .mdm-toolbar [data-type="score-bars"] + .mdm-menu > [data-type], #app .mdm-toolbar [data-type="score-moves"] + .mdm-menu > [data-type]',
      (els) => els.map((el) => el.getAttribute("data-type"))
    );
    const named = said.map((l) => l.line);
    assert.deepEqual(
      rows.filter((r) => named.indexOf(r) < 0),
      [1, 2, 3, 4, 5, 6, 7].map((n) => "score-note-" + n),
      where + ": a row of the Score menu is not on the Keys face, or a figure is a line of its own"
    );
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

// A line of the Keys face is read and not pressed: no button, no hand, no
// wash under the pointer and no place in the order of the focus, as a
// legend of a menu; a press on every one of them writes nothing, moves no
// cursor, chooses, copies and plays nothing, asks the host for nothing, and
// leaves the keyboard with the mode. (Its look: webview-look.test.js.)
test("a line of the Keys face is read and not pressed: a press on every one changes nothing and leaves the keyboard with the mode (SM120)", { skip }, async () => {
  const h = await open({ text: ROSTER, scores: 1, clipboard: true, seed: { settings: { scorePanel: "shown", scorePanelFace: "keys" } } });
  await pressMode(h.page);
  const hs = await heads(h.page, 0);
  // The cursor on the D of the first bar, by a click on its head.
  await h.page.mouse.click(hs[1].x, hs[1].y);
  await sleep(150);
  const before = await rosterState(h.page);
  const asked = (await setSettingPosts(h.page)).length;
  const names = (await keyLines(h.page)).filter((l) => typeof l !== "string").map((l) => l.line);
  assert.equal(names.length, KEYS_FACE.filter((l) => typeof l !== "string").length);
  for (const name of names) {
    const at = '#app .mdm-score-panel [data-line="' + name + '"]';
    const look = await h.page.$eval(at, (el) => ({ tag: el.tagName, role: el.getAttribute("role"), cursor: getComputedStyle(el).cursor, focus: el.tabIndex }));
    assert.deepEqual(look, { tag: "DIV", role: null, cursor: "default", focus: -1 }, name + " is drawn as a control");
    await h.page.hover(at);
    await sleep(30);
    assert.equal(await h.page.$eval(at, (el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)", name + " wears a wash under the pointer");
    await h.page.click(at);
    await sleep(40);
    assert.equal(await h.page.evaluate(() => document.activeElement.className), "mdm-score-keys", "a press on " + name + " took the keyboard from the mode");
  }
  await sleep(400);
  assert.deepEqual(await rosterState(h.page), before, "a press on a line of the Keys face did something");
  assert.equal((await setSettingPosts(h.page)).length, asked, "a press on a line of the Keys face asked the host for something");
  // And the keyboard still writes: a half note on the cursor's place.
  await h.page.keyboard.press("2");
  await sleep(150);
  assert.notEqual(await docText(h.page), before.text, "the mode's keys did nothing after the presses on the Keys face");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The two faces are laid out at once, the one out of sight with no height,
// so the panel is as wide as the wider of them whichever is in sight; and
// while either is taller than the pane it is wider by the room of a scroll
// bar on both, the face that scrolls having its bar there and the other its
// rows, with no bare strip down the right (fitScorePanelWidth). As the face
// changes the text keeps its column and its wrap, the score the cursor is
// on stays where it stands with no hold of its own, and nothing on either
// face is cut. On a page whose paragraphs wrap in the pane, as SM114 has
// it, where a column a pixel narrower moves what stands under them; with
// the scroll bars drawn, in a pane the Keys face is taller than and the
// Buttons face is not, which is how a window of VS Code has it (seen
// 2026-10-14: the Keys face scrolled and its bar took 10px more for the
// panel off the editor, 271 to 281). In a pane tall enough for both faces
// the panel is as wide as the wider face and no wider.
test("changing the panel's face moves nothing on the page: the panel keeps its width, the text its column, the score its place (SM121)", { skip }, async () => {
  const h = await open({ text: PUSHED, scores: 2, bars: true, seed: { settings: { scorePanel: "shown" } } });
  await h.page.setViewport({ width: 900, height: 700 });
  await sleep(300);
  await pressMode(h.page);
  await sleep(200);
  const look = () =>
    h.page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect();
      const panel = document.querySelector("#app .mdm-score-panel");
      const edge = box(panel).left + panel.clientLeft + panel.clientWidth;
      // The switches of the head too, by their box alone: a switch's own
      // overflow is its tip, laid out unseen until the pointer comes.
      const cut = [...panel.querySelectorAll(".mdm-menu__item, .mdm-menu__legend, .mdm-score-panel__pad, .mdm-score-panel__toggle")].filter((el) => {
        const key = el.querySelector(".mdm-menu__key");
        const tipped = el.classList.contains("mdm-score-panel__toggle");
        return box(el).right > edge + 0.5 || (key && box(key).right > edge + 0.5) || (!tipped && el.scrollWidth > el.clientWidth + 0.5);
      });
      const scores = [...document.querySelectorAll("#app .mdm-score")].map((el) => Math.round(box(el).top * 10) / 10);
      return {
        panel: box(panel).width,
        content: box(document.querySelector("#app .cm-content")).width,
        lines: [...document.querySelectorAll("#app .cm-content > .cm-line")].map((el) => Math.round(box(el).height)),
        scores,
        scroll: window.__mdm.view.scrollDOM.scrollTop,
        cut: cut.map((el) => el.getAttribute("data-type") || el.getAttribute("data-line") || el.className),
        // Whether the face in sight is taller than the pane, read off the
        // panel with that face up and not off the face out of sight, whose
        // being laid out is what this test holds.
        scrolls: panel.scrollHeight > panel.clientHeight,
        // What the panel keeps down its right edge, its bar's or a gutter's.
        strip: panel.offsetWidth - panel.clientWidth - panel.clientLeft,
        faces: [...panel.querySelectorAll(".mdm-score-panel__face")].map((f) => f.scrollWidth <= panel.clientWidth),
      };
    });
  const buttons = await look();
  assert.ok(buttons.scores.length >= 1, "no score is drawn, so this reads nothing");
  assert.deepEqual(buttons.cut, [], "on the Buttons face something is cut by the panel's edge");
  assert.deepEqual(buttons.faces, [true, true], "a face is wider than the panel");
  await postSettings(h.page, { scorePanel: "shown", scorePanelFace: "keys" });
  await sleep(300);
  const keys = await look();
  assert.deepEqual([buttons.scrolls, keys.scrolls], [false, true], "the pane is not one the Keys face is taller than and the Buttons face is not, so this reads nothing");
  // The Keys face has its bar down the right edge, and the Buttons face no
  // strip there: its room is its rows'.
  assert.ok(keys.strip > 0, "the Keys face scrolls with no bar drawn, so this reads nothing");
  assert.equal(buttons.strip, 0, "the Buttons face, which does not scroll, keeps a bare strip of " + buttons.strip + "px down its right edge");
  assert.deepEqual(keys.cut, [], "on the Keys face something is cut by the panel's edge");
  assert.ok(Math.abs(keys.panel - buttons.panel) < 0.05, "the panel went from " + buttons.panel + "px to " + keys.panel + " as the face changed");
  assert.deepEqual([keys.content, keys.lines, keys.scores, keys.scroll], [buttons.content, buttons.lines, buttons.scores, buttons.scroll], "the page moved as the face changed");
  await postSettings(h.page, { scorePanel: "shown", scorePanelFace: "buttons" });
  await sleep(300);
  assert.deepEqual(await look(), buttons, "the page is not where it was when the face came back");
  // A pane tall enough for both faces: the panel as wide as the wider face,
  // the room of the bar given back, on either face.
  await h.page.setViewport({ width: 900, height: 1300 });
  await sleep(300);
  const tall = await look();
  assert.deepEqual([tall.scrolls, tall.strip], [false, 0], "the pane of 1300px is not tall enough for the Buttons face");
  assert.equal(tall.panel, buttons.panel - keys.strip, "in a pane tall enough for both faces the panel kept the room of a bar");
  await postSettings(h.page, { scorePanel: "shown", scorePanelFace: "keys" });
  await sleep(300);
  const tallKeys = await look();
  assert.deepEqual([tallKeys.scrolls, tallKeys.strip, tallKeys.panel], [false, 0, tall.panel], "in a pane tall enough for both faces the Keys face is not as the Buttons face is");
  // Back to the short pane with the Keys face up, which scrolls there: the
  // panel fitted with the face that scrolls in sight is as wide as it was
  // fitted with the other, its bar counted once (the second reading of
  // this test: the panel came up on Buttons, and nothing fitted it with a
  // face that scrolls in sight).
  await h.page.setViewport({ width: 900, height: 700 });
  await sleep(300);
  const back = await look();
  assert.deepEqual([back.scrolls, back.strip, back.panel], [true, keys.strip, buttons.panel], "back in the short pane with the Keys face up, the panel is not as wide as it was: " + JSON.stringify([back.panel, buttons.panel]));
  // And a pane too narrow for the panel and the editor's column, short as
  // well, fitted with either face in sight (it is fitted as the pane is
  // resized): the room of the bar does not take the editor's column, which
  // the panel gives way to as it always has. The Buttons face, which does
  // not scroll there, is the one whose own width does not give the room
  // back.
  for (const face of ["keys", "buttons"]) {
    await postSettings(h.page, { scorePanel: "shown", scorePanelFace: face });
    await h.page.setViewport({ width: 900, height: 700 });
    await sleep(200);
    await h.page.setViewport({ width: 380, height: 700 });
    await sleep(300);
    const narrow = await h.page.evaluate(() => ({
      editor: Math.round(document.querySelector("#app .mdm-editor").getBoundingClientRect().width),
      panel: Math.round(document.querySelector("#app .mdm-score-panel").getBoundingClientRect().width),
    }));
    assert.equal(narrow.editor, 200, "in a pane of 380px, fitted with the " + face + " face up, the room of the bar took the editor's column: " + JSON.stringify(narrow));
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The two words over the faces are buttons of the bar, and the one the
// keyboard reaches wears the ring a button of the bar wears, whole: the box
// they stand in clips nothing of it (found by a second reading of the code,
// 2026-10-14: the box clipped its words, and the ring with them). Reached as
// a reader reaches it, Shift+Tab from the mode with the Keys face up, whose
// word is the last thing on the panel that takes the focus; the ring read in
// the pixels just outside the box, over the word and over the other one.
test("the word over the panel's faces that the keyboard reaches wears the ring of a button of the bar, whole (SM122)", { skip }, async () => {
  for (const side of ["light", "dark"]) {
    const h = await open({ text: WALK, scores: 1, seed: { settings: { theme: side, scorePanel: "shown", scorePanelFace: "keys" } } });
    await pressMode(h.page);
    await h.page.keyboard.down("Shift");
    await h.page.keyboard.press("Tab");
    await h.page.keyboard.up("Shift");
    await sleep(150);
    const at = await h.page.evaluate(() => {
      const el = document.activeElement;
      const box = document.querySelector("#app .mdm-score-panel__switch").getBoundingClientRect();
      const other = document.querySelector('#app [data-type="score-face-buttons"]').getBoundingClientRect();
      const word = el.getBoundingClientRect();
      return { name: el.getAttribute("data-type"), ring: el.matches(":focus-visible"), above: Math.floor(box.top) - 1, x: Math.round((word.left + word.right) / 2), otherX: Math.round((other.left + other.right) / 2) };
    });
    assert.deepEqual([at.name, at.ring], ["score-face-keys", true], side + ": Shift+Tab from the mode did not bring the keyboard to the word of the Keys face");
    const pixel = async (x, y) => {
      const png = await h.page.screenshot({ clip: { x, y, width: 1, height: 1 }, encoding: "base64" });
      return h.page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const g = cv.getContext("2d");
        g.drawImage(bmp, 0, 0);
        return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
      }, png);
    };
    const over = await pixel(at.x, at.above);
    const bare = await pixel(at.otherX, at.above);
    const far = Math.max(...over.map((v, i) => Math.abs(v - bare[i])));
    assert.ok(far >= 12, side + ": over the word with the focus, just outside the box, the panel's ground shows as it does over the other word: no ring (" + over + " against " + bare + ")");
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

// Score navigation comes with its panel unless the Side panel row has said
// otherwise (the owner's ask of 2026-10-14), and the page reads a setting it
// is given no word for as the host reads it (readSettings: the allowlist's
// first word, shown), at its opening and as the settings come back, as it
// reads the playhead's. The host sends every setting, so this holds the page
// to the host and is no road VS Code takes; null is what the page reads with
// no word for it, since a seed cannot leave out a key of the harness's own.
test("a page given no word for the side panel brings it with the mode, as the host's fallback does (SM123)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1, seed: { settings: { scorePanel: null } } });
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: false, mode: false }, "no word for it, out of the mode");
  await pressMode(h.page);
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: true, mode: true }, "no word for it, under the mode");
  // Hidden as the host answers, and back with a message that has no word
  // for it.
  await postSettings(h.page, { scorePanel: "hidden" });
  await sleep(200);
  assert.deepEqual(await panelSays(h.page), { ticked: false, up: false, mode: true }, "hidden, under the mode");
  await postSettings(h.page, { scorePanel: null });
  await sleep(200);
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: true, mode: true }, "a settings message with no word for it");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The head of the score panel holds the two switches that bring it, the
// mode's and its own (the owner's pick of 2026-10-15, variant 2 of
// design-score-panel-rest.html, with "el Side panel de la barra de pestañas
// debe tener el icono"): each the button its row of the Score menu is, with
// that row's glyph, the row's name in its tip (2026-10-15, "solo con los
// iconos"), lit while on, and the side panel's glyph its own. A press on Side panel there asks the host to hide the panel, and as
// the setting comes back the panel goes and the mode stays on, with the
// keyboard and the cursor; asked for again from the menu, it is back with
// its switches lit. The mode's switch leaves the mode, the panel with it,
// and the Side panel row keeps its tick.
test("the head of the score panel holds its two switches, each its row of the Score menu as a lit button, and Side panel there takes the panel away and leaves the mode on (SM124)", { skip }, async () => {
  const h = await open({ text: WALK, scores: 1, seed: { settings: { scorePanel: "shown" } } });
  await pressMode(h.page);
  for (const name of ["mdm-score-navigation", "mdm-score-panel"]) {
    const [s, p] = [await barState(h.page, name), await panelState(h.page, name)];
    assert.ok(s.glyph !== "", name + " wears no glyph in the Score menu");
    assert.deepEqual([p.kind, p.name, p.glyph, p.on, p.off], ["switch", s.name, s.glyph, true, false], name + " at the head of the panel");
  }
  assert.notEqual((await panelState(h.page, "mdm-score-panel")).glyph, (await panelState(h.page, "mdm-score-navigation")).glyph, "the side panel wears the mode's glyph");
  const asks = async () => (await setSettingPosts(h.page)).filter((p) => p.key === "scorePanel").map((p) => p.value);
  await pressPanel(h.page, "mdm-score-panel");
  await sleep(150);
  assert.deepEqual(await asks(), ["hidden"], "Side panel at the head did not ask the host to hide the panel");
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: true, mode: true }, "the panel went before the host answered");
  await postSettings(h.page, { scorePanel: "hidden" });
  await sleep(200);
  assert.deepEqual(await panelSays(h.page), { ticked: false, up: false, mode: true }, "hidden from its own head");
  assert.equal(await h.page.evaluate(() => document.activeElement.className), "mdm-score-keys", "the press took the keyboard from the mode");
  assert.ok(await cursor(h.page), "the cursor went with the panel");
  // Back from the menu's row, its switches lit again.
  await pressBar(h.page, "mdm-score-panel");
  assert.deepEqual(await asks(), ["hidden", "shown"]);
  await postSettings(h.page, { scorePanel: "shown" });
  await sleep(200);
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: true, mode: true }, "asked for again from the menu");
  assert.deepEqual([(await panelState(h.page, "mdm-score-navigation")).on, (await panelState(h.page, "mdm-score-panel")).on], [true, true], "the switches are not lit as the panel comes back");
  // The mode's switch leaves the mode, the panel with it, the row ticked.
  await pressPanel(h.page, "mdm-score-navigation");
  await sleep(250);
  assert.deepEqual(await panelSays(h.page), { ticked: true, up: false, mode: false }, "the mode's switch at the head");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- 0 under a verse (2026-10-15) ----
//
// The owner's call of 2026-10-15, on three notes chosen under a verse where
// 0 said "Lyrics can't make room": "Si doy cero las notas dben ponerse en
// silencio y que se borre todo lo que haya escrito". The notes are made
// rests and the syllables they had go; every other note keeps the one it
// had (MDM_BARS.wordsRested; what a verse is written with, case by case, is
// the engine's, in score-bars.test.js). The Rest row of the Score menu and
// its key on the score panel do what 0 does under a verse as well (SM109).
const VERSE_SOURCE = ["X:1", "M:4/4", "L:1/4", "K:C", "C D E F | G A B c |]", "w: 1 2 3 4 5 6 7 8"].join("\n");
const VERSE = ["Verse.", "", "```abc", VERSE_SOURCE, "```", ""].join("\n");
// What is drawn under each note and each rest of the first score, in the
// order they stand: a rest as z, a note by its syllable.
const underNotes = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelector("#app .mdm-score code.language-abc svg").querySelectorAll("g.abcjs-note, g.abcjs-rest")).map((g) => {
      const text = g.querySelector(".abcjs-lyric");
      return (g.classList.contains("abcjs-rest") ? "z" : "") + (text ? text.textContent : "");
    })
  );

test("0 under a verse makes rests of the notes and takes the syllables they had with them, every other note keeping its own: a stretch chosen, the note under the cursor, Shift with a figure's key; undo gives the syllables back; a verse abcjs reads otherwise than its lines say is refused as it was (SM125)", { skip }, async () => {
  const h = await open({ text: VERSE, scores: 1 });
  await pressMode(h.page);
  const lines = async () => (await docText(h.page)).split("\n").slice(7, 9);
  assert.deepEqual(await underNotes(h.page), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  // The owner's: the three notes under 2, 3 and 4 chosen, and the 5 of the
  // note after them left under it.
  await chooseFrom(h.page, 1, 3);
  await h.page.keyboard.press("0");
  assert.deepEqual([await lines(), await notices(h.page)], [["C z z z | G A B c |]", "w: 1 5 6 7 8"], []]);
  assert.deepEqual(await underNotes(h.page), ["1", "z", "z", "z", "5", "6", "7", "8"]);
  // One step of the history, which brings the notes back with their
  // syllables.
  await chord(h.page, ["Control"], "z");
  assert.deepEqual(await lines(), ["C D E F | G A B c |]", "w: 1 2 3 4 5 6 7 8"]);
  assert.deepEqual(await underNotes(h.page), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  // The note under the cursor, with nothing chosen; then Shift with the
  // eighth's key on the note after it, an eighth of rest.
  await h.page.keyboard.press("Escape");
  const e = (await heads(h.page, 0))[2];
  await h.page.mouse.click(e.x, e.y);
  await h.page.keyboard.press("0");
  assert.deepEqual([await lines(), await notices(h.page)], [["C D z F | G A B c |]", "w: 1 2 4 5 6 7 8"], []]);
  await h.page.keyboard.press("ArrowRight");
  await chord(h.page, ["Shift"], "Digit4");
  assert.deepEqual([await lines(), await notices(h.page)], [["C D z z/2 | G A B c |]", "w: 1 2 5 6 7 8"], []]);
  assert.deepEqual(await underNotes(h.page), ["1", "2", "z", "z", "5", "6", "7", "8"]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // A verse carried on to the next line with a backslash is one verse to
  // abcjs, and the engine, which reads its lines one at a time, refuses it:
  // 0 says so over the score, as it did, and writes nothing.
  const carried = VERSE.replace("w: 1 2 3 4 5 6 7 8", "w: 1 2 3 4 \\\nw: 5 6 7 8");
  const g = await open({ text: carried, scores: 1 });
  await pressMode(g.page);
  const d = (await heads(g.page, 0))[1];
  await g.page.mouse.click(d.x, d.y);
  await g.page.keyboard.press("0");
  assert.deepEqual([await docText(g.page), await notices(g.page)], [carried, ["Lyrics can't make room"]]);
  assert.deepEqual(g.errors, []);
  await g.close();
});
