// How the pointer of the README's clips moves and how their keys are spaced
// (tools/demo-clips/motion.js), decided on 2026-10-06 when the owner found
// the three takes moved as a machine does: every move a straight line on one
// symmetric curve for whatever time its beat named, every key a fixed
// interval after the last. What was put in its place is held here, since
// nothing in a recording says which of these a later change took out: a take
// still records, and only looks a little more like a machine again.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const CLIPS = path.join(__dirname, "..", "tools", "demo-clips");
const { travel, reach, stroke, keyGaps, readTime, FLOOR } = require(path.join(CLIPS, "motion.js"));

// Moves of every length and direction over a window of the takes' size,
// from a spread of starting points.
function moves() {
  const out = [];
  const starts = [
    { x: 940, y: 590 },
    { x: 80, y: 60 },
    { x: 500, y: 320 },
    { x: 300, y: 500 },
    { x: 760, y: 110 },
  ];
  for (const from of starts) {
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      for (const far of [12, 40, 90, 180, 330, 520, 900]) {
        out.push({ from, to: { x: Math.round(from.x + far * Math.cos(a)), y: Math.round(from.y + far * Math.sin(a)) } });
      }
    }
  }
  return out;
}

// How far a point of a move stands off the straight line between its ends,
// counted positive on the side that is up for a move from left to right.
function off(move, p) {
  const dx = move.to.x - move.from.x;
  const dy = move.to.y - move.from.y;
  return ((p.x - move.from.x) * dy - (p.y - move.from.y) * dx) / Math.hypot(dx, dy);
}

// How far along the straight line a point of a move is, 0 at its start and 1
// at its end.
function along(move, p) {
  const dx = move.to.x - move.from.x;
  const dy = move.to.y - move.from.y;
  return ((p.x - move.from.x) * dx + (p.y - move.from.y) * dy) / (dx * dx + dy * dy);
}

test("a move begins where the pointer is and ends on the point it was sent to", () => {
  for (const move of moves()) {
    const path = travel(move.from, move.to);
    assert.deepEqual(path.at(0), move.from);
    assert.deepEqual(path.at(path.ms), move.to);
    assert.deepEqual(path.at(path.ms + 500), move.to);
  }
  const still = travel({ x: 10, y: 20 }, { x: 10, y: 20 });
  assert.equal(still.ms, 0);
  assert.deepEqual(still.at(0), { x: 10, y: 20 });
});

test("a move takes longer the further it goes and the smaller what it aims at", () => {
  let last = 0;
  for (const far of [10, 40, 120, 300, 600, 1000]) {
    const ms = reach(far, 26);
    assert.ok(ms > last, `${far} px takes ${ms} ms, no longer than a shorter move`);
    last = ms;
  }
  assert.ok(reach(300, 26) > reach(300, 80), "a small target is reached as soon as a wide one");
  // A hop between two neighbours is quick, and the longest travel of a take,
  // from the foot of the pane to the toolbar, is not slow.
  assert.ok(reach(40, 26) < 300, `a hop of 40 px takes ${reach(40, 26)} ms`);
  const across = reach(850, 26);
  assert.ok(across > 520 && across < 760, `850 px takes ${across} ms`);
  // The time a move is given is the time it takes, and pace scales the time
  // its distance gives.
  const a = { x: 0, y: 0 };
  const b = { x: 300, y: 40 };
  assert.equal(travel(a, b, { ms: 420 }).ms, 420);
  assert.equal(travel(a, b, { pace: 1.5 }).ms, Math.round(travel(a, b).ms * 1.5));
});

// How quick a long move may be (motion.js, FLOOR). On 2026-10-15 the owner
// found the pointer of the takes of 2026-10-06 too quick at moments, on the
// straight runs above all, and preferred main's. Measured on the takes, the
// long moves went about two and a half times as fast as main's; the move to
// the rest corner, 970 px onto a target 200 px wide, took 0.4 s where
// main's took 1.8; and the README's GIF, at 14 pictures a second, showed
// the pointer 530 px on from one picture to the next, where main's showed
// it 160 px on at the most but once. Held here: that no move is quicker
// than the floor, whatever it aims at; that no two pictures of the GIF find
// the pointer more than 110 px apart; that the trip to the corner takes as
// long as main's and not longer; and that a hop between two rows of a menu
// stays a hop.
test("a long move is no quicker than main's takes made it, whatever it aims at", () => {
  const PICTURE = 1000 / 14;
  for (const move of moves()) {
    for (const width of [26, 120, 200]) {
      const path = travel(move.from, move.to, { width });
      const least = 1000 * FLOOR * Math.sqrt(path.far);
      assert.ok(path.ms >= least - 1, `a move of ${Math.round(path.far)} px onto ${width} px takes ${path.ms} ms, less than ${Math.round(least)}`);
      // The GIF's pictures, wherever in the move the first of them falls.
      for (const phase of [0, 18, 36, 54]) {
        let last = path.at(0);
        for (let t = phase; t < path.ms + PICTURE; t += PICTURE) {
          const p = path.at(Math.min(t, path.ms));
          const jump = Math.hypot(p.x - last.x, p.y - last.y);
          assert.ok(jump <= 110, `a move of ${Math.round(path.far)} px onto ${width} px is ${Math.round(jump)} px on from one picture of the GIF to the next`);
          last = p;
        }
      }
    }
  }
  // The trip that went quickest in the takes of 2026-10-06: from the
  // player's play button to the corner the pointer rests in.
  const corner = travel({ x: 73, y: 147 }, { x: 945, y: 580 }, { width: 200 });
  assert.ok(corner.ms >= 1300 && corner.ms <= 2000, `the trip to the rest corner takes ${corner.ms} ms`);
  const hop = travel({ x: 200, y: 100 }, { x: 200, y: 130 }, { width: 120 });
  assert.ok(hop.ms <= 300, `a hop from one row of a menu to the next takes ${hop.ms} ms`);
});

test("the pointer is quick off the mark, slow into its target, and never turns back", () => {
  assert.equal(stroke(0), 0);
  assert.equal(stroke(1), 1);
  // Top speed before the middle of the move's time: between 0.3 and 0.45 of
  // it, where a curve the same forwards as backwards has it at the half.
  let top = 0;
  let when = 0;
  for (let u = 0.005; u < 1; u += 0.005) {
    const speed = stroke(u + 0.001) - stroke(u - 0.001);
    if (speed > top) {
      top = speed;
      when = u;
    }
  }
  assert.ok(when > 0.3 && when < 0.45, `top speed at ${when.toFixed(3)} of the move`);
  assert.ok(stroke(0.5) > 0.6, `only ${stroke(0.5).toFixed(2)} of the way at half time`);
  for (const move of moves()) {
    const path = travel(move.from, move.to);
    let before = -1e-9;
    for (let i = 0; i <= 60; i++) {
      const now = along(move, path.at((path.ms * i) / 60));
      assert.ok(now >= before - 1e-9, `the pointer goes back on its way from ${JSON.stringify(move.from)} to ${JSON.stringify(move.to)}`);
      before = now;
    }
  }
});

test("a travel bows off the straight line, by 42 px at the most, and a hop goes straight", () => {
  let bowed = 0;
  let long = 0;
  for (const move of moves()) {
    const path = travel(move.from, move.to, { direct: true });
    let most = 0;
    for (let i = 0; i <= 80; i++) most = Math.max(most, Math.abs(off(move, path.at((path.ms * i) / 80))));
    assert.ok(most <= 42 + 1e-6, `a move of ${Math.round(path.far)} px leaves its line by ${most.toFixed(1)} px`);
    assert.ok(most <= path.far * 0.09, `a move of ${Math.round(path.far)} px bows ${most.toFixed(1)} px`);
    if (path.far < 48) assert.ok(most < 1e-6, `a hop of ${Math.round(path.far)} px is not straight`);
    if (path.far >= 150) {
      long++;
      if (most >= 1.5) bowed++;
    }
  }
  assert.ok(bowed >= long * 0.9, `only ${bowed} of ${long} travels leave the straight line at all`);
});

test("a sweep across the window bows up, and a reach along the wrist's own line hardly bows", () => {
  let up = 0;
  let sweeps = 0;
  for (let i = 0; i < 60; i++) {
    const move = { from: { x: 100 + 7 * i, y: 200 + 5 * i }, to: { x: 520 + 9 * i, y: 200 + 5 * i } };
    const path = travel(move.from, move.to, { direct: true });
    const mid = off(move, path.at(path.ms * 0.4));
    sweeps++;
    if (mid > 0) up++;
  }
  // One in seven goes the other way, by the seed of its two ends.
  assert.ok(up >= sweeps * 0.7 && up < sweeps, `${up} of ${sweeps} sweeps to the right bow up`);
  for (let i = 0; i < 20; i++) {
    // From the top left towards the wrist, at the slope of AWAY.
    const move = { from: { x: 100 + 9 * i, y: 80 + 3 * i }, to: { x: 100 + 9 * i + 180, y: 80 + 3 * i + 356 } };
    const path = travel(move.from, move.to, { direct: true });
    let most = 0;
    for (let k = 0; k <= 40; k++) most = Math.max(most, Math.abs(off(move, path.at((path.ms * k) / 40))));
    assert.ok(most <= path.far * 0.03, `a reach along the wrist's line bows ${most.toFixed(1)} px in ${Math.round(path.far)}`);
  }
});

test("a long move onto a button comes up a few pixels short and closes the gap, more often than not", () => {
  let short = 0;
  let long = 0;
  for (const move of moves()) {
    const path = travel(move.from, move.to, { width: 26 });
    if (path.far < 240) {
      assert.equal(path.gap, 0, `a move of ${Math.round(path.far)} px stops short`);
      continue;
    }
    long++;
    assert.equal(travel(move.from, move.to, { width: 26, direct: true }).gap, 0);
    assert.equal(travel(move.from, move.to, { width: 120 }).gap, 0, "a move onto a wide thing stops short");
    if (!path.gap) continue;
    short++;
    assert.ok(path.gap >= 4 && path.gap <= 9, `the pointer stops ${path.gap} px short`);
    // Where the first stroke ends: that far from the target, three quarters
    // of the way through the move's time, and still short of it.
    const p = path.at(path.ms * 0.76);
    const left = Math.hypot(move.to.x - p.x, move.to.y - p.y);
    assert.ok(Math.abs(left - path.gap) < 1.5, `${left.toFixed(1)} px from the target at the end of the first stroke, for a gap of ${path.gap}`);
    assert.ok(along(move, p) < 1, "the first stroke goes past its target");
  }
  assert.ok(short > long * 0.4 && short < long * 0.8, `${short} of ${long} long moves stop short`);
});

test("a move and a line of typing are the same every time they are asked for", () => {
  for (const move of moves().slice(0, 80)) {
    const a = travel(move.from, move.to);
    const b = travel(move.from, move.to);
    assert.equal(a.ms, b.ms);
    for (let i = 0; i <= 10; i++) assert.deepEqual(a.at((a.ms * i) / 10), b.at((b.ms * i) / 10));
  }
  assert.deepEqual(keyGaps("The extension's icon", 55), keyGaps("The extension's icon", 55));
});

test("typed keys come at uneven intervals, with a breath either side of a space", () => {
  const text = "A table filled a cell at a time, and a caption typed under a picture";
  const base = 50;
  const gaps = keyGaps(text, base);
  assert.equal(gaps.length, text.length);
  assert.ok(new Set(gaps).size > 12, "the keys come at a handful of intervals");
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(mean > base * 0.95 && mean < base * 1.35, `${mean.toFixed(1)} ms a key for ${base} asked`);
  const inside = [];
  const edge = [];
  for (let i = 0; i < text.length - 1; i++) {
    const breath = /\s/.test(text[i]) !== /\s/.test(text[i + 1]);
    (breath ? edge : inside).push(gaps[i]);
    assert.ok(gaps[i] >= base * 0.6 - 1 && gaps[i] <= base * (breath ? 2.1 : 1.4) + 1, `a gap of ${gaps[i]} ms`);
  }
  const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  assert.ok(avg(edge) > avg(inside) * 1.25, `${avg(edge).toFixed(0)} ms round a space and ${avg(inside).toFixed(0)} inside a word`);
});

// The two waits a press can have (rig.pressAt). A press that is not waiting
// for a tooltip comes as a hand's does, not the third to a half of a second
// every click of the first takes waited.
test("a press comes a tenth of a second after the pointer", () => {
  const { SETTLE } = require(path.join(CLIPS, "rig.js"));
  assert.ok(SETTLE >= 60 && SETTLE <= 160, `a press waits ${SETTLE} ms`);
});

// What the tooltips of the three takes say, shortest first.
const TIPS = [
  "Theme",
  "Table",
  "Highlight",
  "LaTeX font",
  "Show player",
  "Justify text",
  "Unordered list",
  "Score navigation",
  "Leave score navigation",
  "Multicursor matches inside words",
  "Move line end left\nOr drag to any barline",
];

// How long a tooltip is left whole on screen before the press that takes it
// away (motion.js, readTime). The takes of the morning of 2026-10-06 pressed
// 560 ms after the pointer came, which left a tip whole for 0.53 to 0.6 s
// whatever it said, and the owner asked for a little more so that it can be
// read. Held here: that every tip gets more than that, by what it says, and
// that the pointer is not left standing either.
test("a tooltip is whole on screen for as long as its words take to read, and no longer", () => {
  let last = 0;
  for (const label of TIPS) {
    const whole = readTime(label);
    const letters = label.replace(/\s+/g, " ").length;
    // More than the 0.6 s the first takes gave, and no tip asked to be read
    // at over 28 characters a second.
    assert.ok(whole >= 650, `"${label}" is whole for ${whole} ms`);
    assert.ok(whole >= letters * 35, `"${label}" is whole for ${whole} ms, ${Math.round((1000 * letters) / whole)} characters a second`);
    // And no pointer left standing: never much over a second and a half,
    // and a second at the most on the two words most buttons have.
    assert.ok(whole <= 1800, `"${label}" is whole for ${whole} ms`);
    if (letters <= 16) assert.ok(whole <= 1000, `"${label}" is whole for ${whole} ms`);
    assert.ok(whole >= last, `"${label}" is given less than a shorter tip`);
    last = whole;
  }
  // One word is not waited on as two lines are: the longest tip gets twice
  // the shortest, where one wait for all gave both the same.
  assert.ok(readTime(TIPS[TIPS.length - 1]) >= 2 * readTime("Theme"));
  assert.ok(readTime("Theme") <= 750, `"Theme" is whole for ${readTime("Theme")} ms`);
  // What is counted is what is read, however the label is spaced or broken.
  assert.equal(readTime("Move line end left\nOr drag to any barline"), readTime("  Move line  end left Or drag to any barline "));
});

// The rig's side of it (rig.js, pressAt and readTip), run on a rig with no
// window. The page is asked what the tip under the pointer says and whether
// it is whole yet, the reading is counted from when it is, and a take that
// waits on a thing with no tip, or on a tip that does not come up, stops.
test("a press left to a tooltip waits for it to be whole and then for what it takes to read, and stops where none comes up", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { Rig, SETTLE } = require(path.join(CLIPS, "rig.js"));
  const turn = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  // A rig whose page answers with `label`, whole from `up` ms after the
  // pointer came (never, with none given).
  const make = (label, up) => {
    const log = [];
    const rig = Object.create(Rig.prototype);
    const began = Date.now();
    rig.moveTo = async () => log.push("there");
    rig.click = async () => log.push("press");
    rig.doubleClick = async () => log.push("press twice");
    rig.evalFrame = async () => ({ label, whole: up !== undefined && Date.now() - began >= up });
    return { rig, log };
  };
  // Run a press to its end, and say how many ms after the pointer it came.
  const pressed = async (rig, log, opts) => {
    let failed = null;
    const done = rig.pressAt({ x: 1, y: 1 }, opts).catch((e) => (failed = e));
    await turn();
    let at = 0;
    while (!log.includes("press") && !failed && at < 6000) {
      t.mock.timers.tick(1);
      at++;
      await turn();
    }
    if (failed) throw failed;
    assert.ok(log.includes("press"), "the press never came");
    await done;
    return at;
  };

  for (const label of ["Theme", "Score navigation", "Move line end left\nOr drag to any barline"]) {
    // Whole as the pointer stops, as after a long travel, and whole 300 ms
    // later, as after a hop: the reading is the same, and the second press
    // comes that much later, to within the 20 ms the page is asked at.
    const ready = make(label, 0);
    assert.equal(await pressed(ready.rig, ready.log, { tip: true }), readTime(label), `the press on "${label}"`);
    assert.deepEqual(ready.log, ["there", "press"]);
    const later = make(label, 300);
    const at = await pressed(later.rig, later.log, { tip: true });
    assert.ok(at >= 300 + readTime(label) && at <= 320 + readTime(label), `the press on "${label}" came ${at} ms after the pointer, its tip whole at 300`);
  }
  // No tip under the pointer, or one that never comes up (put away by a
  // click, it is not shown again until the pointer has left): no press.
  const none = make("", 0);
  await assert.rejects(pressed(none.rig, none.log, { tip: true }), /has none/);
  assert.deepEqual(none.log, ["there"]);
  const away = make("Score navigation");
  await assert.rejects(pressed(away.rig, away.log, { tip: true }), /did not come up/);
  assert.deepEqual(away.log, ["there"]);
  // And a press that asks for no tip does not ask the page for one.
  const plain = make("Theme", 0);
  plain.rig.evalFrame = async () => assert.fail("a plain press asked for a tooltip");
  assert.equal(await pressed(plain.rig, plain.log, {}), SETTLE);
});
