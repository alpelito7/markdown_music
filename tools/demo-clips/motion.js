// How the drawn pointer travels and how typed keys are spaced: the part of
// the rig that decides what a hand would do, apart from the part that sends
// it (rig.js), so it can be read, and tested, without a VS Code.
//
// The takes were first recorded with every move a straight line on one
// symmetric curve, each for the time its beat gave it, and every key a fixed
// number of milliseconds after the last. The owner's word for the result was
// that the pointer did not move as a person's does, and stood too long where
// it had no reason to (2026-10-06). What is here instead:
//
// - A move takes the time its distance and its target make it take, which is
//   the form of Fitts's law: a hop between two words is quick and a travel
//   across the window is not slow. The two constants are picked by eye on
//   the takes, not taken from a paper.
// - The pointer gets up to speed early and spends the longer part of the
//   move arriving, where the old curve was the same forwards as backwards.
// - It travels on a shallow arc, bowed the way a hand turning on its wrist
//   bows it, and not along a ruler.
// - A long move onto a small thing comes up a few pixels short and closes
//   the gap, as often as not.
// - Keys come at uneven intervals, with a breath between words.
// - On a button left to its own tooltip to name it, the pointer stays until
//   the tooltip has been up for what it takes to read, by what it says.
// - A long move is given no less time than main's takes gave it, whatever it
//   aims at (FLOOR): Fitts's law alone made the long moves about two and a
//   half times as quick as main's, which the owner found too quick to follow
//   (2026-10-15).
//
// Nothing here is random from one run to the next. Every choice is a
// function of what is asked (the two ends of a move, the text typed), so the
// light and the dark take of a clip move alike, and a take recorded again
// moves as it did.

"use strict";

// A number in [0, 1) made of the numbers it is given and of nothing else.
function chance(seed, salt) {
  let h = 0x811c9dc5 ^ (salt | 0);
  for (const v of seed) {
    h ^= Math.round(v) | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The share of a stroke covered at the share u of its time, on the curve of
// least jerk: off from rest and into rest, with no corner at either end.
function glide(u) {
  return u * u * u * (10 + u * (-15 + 6 * u));
}

// The same stroke with its top speed brought forward, to 0.37 of its time
// from the half of it (the speed of glide(u^g) peaks where u^g is
// (3g - 1) / (5g - 1), which for g = 0.78 is at u = 0.37): the pointer is
// most of the way there by the middle of the move and slows into its target.
const EARLY = 0.78;
function stroke(u) {
  return glide(Math.pow(u, EARLY));
}

// How long a move of `far` px onto a thing `width` px across takes, in ms.
// 130 + 105 a bit: 270 ms for a hop of 40 px between two toolbar buttons,
// 510 for 300 px onto a button, 660 for the 850 from the foot of the pane
// to the toolbar. FLOOR, below, gives the longer ones more.
const REACH_FIRST = 130;
const REACH_BIT = 105;
function reach(far, width) {
  return REACH_FIRST + REACH_BIT * Math.log2(far / Math.max(4, width) + 1);
}

// The least time a move is given, whatever it aims at: FLOOR s for each
// square root of a pixel of its distance, the time a stroke of this shape
// takes when its top acceleration is held to one value. Fitts's law alone,
// which grows with the logarithm of the distance and shortens a move onto a
// wide thing further still, gave the long moves of the takes of 2026-10-06
// about two and a half times the speed of main's (moves of 300 px or more,
// measured on the takes): the move to the rest corner, 970 px onto a target
// 200 px wide, took 0.4 s where main's took 1.8, and the README's GIF, at 14
// pictures a second, showed the pointer 530 px on from one picture to the
// next, where main's showed it 160 px on at the most but once. The owner
// found it too quick at moments, on the straight runs above all, and
// preferred main's (2026-10-15). 0.048 is the median, over main's long
// moves in the takes of 0.7.3, of their time over the square root of their
// distance: 0.48 s for 100 px, 0.96 s for 400 and 1.44 s for 900, which
// gives main's top speeds and main's steps from one picture to the next.
// It is the third of four versions put side by side for him (main, the
// takes of 2026-10-06, this floor and 0.032; design/design-clip-speed.html
// of the branch), the one proposed, and applied when he said to go on.
const FLOOR = 0.048;

// The arc. A hand on a mouse turns on the wrist and the forearm, which lie
// below the pointer and to its right, so a sweep across the window bows up
// and a move up or down it bows left; along the line that runs through the
// wrist, top left to bottom right, the arm only reaches, and the move is
// nearly straight. AWAY is the direction from the wrist. The bow is 3.5 to
// 8.5 hundredths of the distance at the most, never over 42 px, and one
// move in seven bows the other way, as a hand resting elsewhere would.
const BOW_FROM = 48; // px: a shorter move is straight
const BOW_MOST = 42;
const AWAY = { x: -0.45, y: -0.89 };

// A long move onto a small target stops short of it and closes the gap in a
// second stroke, six times in ten: 2% of the distance short, 4 to 9 px,
// which on a toolbar button is still on the button. The second stroke is the
// last quarter of the move's time.
const SHORT_FROM = 240; // px
const SHORT_WIDTH = 44; // px
const SHORT_ODDS = 0.6;
const SHORT_SHARE = 0.24;

// A move from one point to another: how long it takes, and where the
// pointer is at each moment of it. opts.width is how wide the thing aimed at
// is (a toolbar button with none given), opts.pace stretches or shortens the
// time the distance gives, opts.ms sets the time outright for a move that
// has to keep step with something, and opts.direct has it go all the way in
// one stroke.
function travel(from, to, opts) {
  const o = opts || {};
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const far = Math.hypot(dx, dy);
  const width = o.width || 26;
  const seed = [from.x, from.y, to.x, to.y];
  if (far < 0.5) return { ms: 0, far: 0, bow: 0, gap: 0, at: () => ({ x: to.x, y: to.y }) };
  const ms = Math.max(1, Math.round(o.ms !== undefined ? o.ms : Math.max(reach(far, width), 1000 * FLOOR * Math.sqrt(far)) * (o.pace || 1)));

  // The normal to the move, turned to the side away from the wrist.
  let nx = -dy / far;
  let ny = dx / far;
  let lean = nx * AWAY.x + ny * AWAY.y;
  if (lean < 0) {
    nx = -nx;
    ny = -ny;
    lean = -lean;
  }
  let bow = 0;
  if (far >= BOW_FROM) {
    bow = Math.min(BOW_MOST, far * (0.035 + 0.05 * chance(seed, 1))) * (0.3 + 0.7 * lean);
    if (chance(seed, 2) < 1 / 7) bow = -bow;
  }
  // A cubic whose first handle leans out twice as far as its second: the
  // pointer leaves off its line and is back on it as it comes in, so the
  // last of the move is aimed at the target and not past it. The two handles
  // put the curve's middle 0.9 of the bow off the straight line.
  const c1 = { x: from.x + dx / 3 + nx * bow * 1.6, y: from.y + dy / 3 + ny * bow * 1.6 };
  const c2 = { x: from.x + (2 * dx) / 3 + nx * bow * 0.8, y: from.y + (2 * dy) / 3 + ny * bow * 0.8 };
  const on = (s) => {
    const r = 1 - s;
    const a = r * r * r;
    const b = 3 * r * r * s;
    const c = 3 * r * s * s;
    const d = s * s * s;
    return { x: a * from.x + b * c1.x + c * c2.x + d * to.x, y: a * from.y + b * c1.y + c * c2.y + d * to.y };
  };

  const short = !o.direct && far >= SHORT_FROM && width <= SHORT_WIDTH && chance(seed, 3) < SHORT_ODDS;
  const gap = short ? Math.min(9, Math.max(4, far * 0.02)) : 0;
  const stop = 1 - gap / far;
  const first = short ? ms * (1 - SHORT_SHARE) : ms;
  return {
    ms,
    far,
    bow,
    gap,
    at(t) {
      if (t >= ms) return { x: to.x, y: to.y };
      if (t <= 0) return { x: from.x, y: from.y };
      return on(t < first ? stop * stroke(t / first) : stop + (1 - stop) * glide((t - first) / (ms - first)));
    },
  };
}

// How long to wait after each character of a text typed at `base` ms a key:
// between 0.6 and 1.4 of it, and half as long again going into a space or
// coming out of one, which is where a hand typing words takes its breath.
function keyGaps(text, base) {
  const gaps = [];
  for (let i = 0; i < text.length; i++) {
    let gap = base * (0.6 + 0.8 * chance([text.charCodeAt(i), i, text.length], 7));
    const next = text[i + 1];
    if (next !== undefined && /\s/.test(text[i]) !== /\s/.test(next)) gap *= 1.5;
    gaps.push(Math.round(gap));
  }
  return gaps;
}

// How long a tooltip is left whole on screen before the press that takes it
// away, by what it says, in ms: 550 to find it and 28 a character, which is
// 0.7 s for "Theme", 1 s for "Score navigation", and 1.7 s for the two lines
// of a line end's tip. It is counted from the tip being whole, which the rig
// asks the page for (rig.js, readTip), and not from the pointer's arrival:
// a tip starts up as the pointer comes onto its button, a quarter of a
// second before a long travel ends and hardly at all before a hop does.
//
// The first takes of 2026-10-06 pressed 560 ms after the pointer arrived,
// whatever the tip said, which left it whole for 0.53 to 0.6 s (measured on
// the score take), and the owner asked for a little more, so that it can be
// read. One wait for all, long enough for the five words of the multicursor
// button, would stand twice as long as "Table" needs on "Table", in takes
// whose pointer was taken off everything it stood on for no reason that
// same day.
const READ_FIRST = 550;
const READ_CHAR = 28;
function readTime(label) {
  const said = String(label).replace(/\s+/g, " ").trim();
  return READ_FIRST + READ_CHAR * said.length;
}

module.exports = { travel, reach, stroke, glide, keyGaps, chance, readTime, FLOOR };
