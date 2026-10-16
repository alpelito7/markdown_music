// Tests for moving bars from one line of a score to the next, for adding a
// bar and for writing a note: vscode-mdm/media/mdm-bars.js, which the score
// mode calls from the buttons at a line's end, the drag of a line's end, the
// + at a barline (the chrome on a score in main.js) and the keys that write
// (a note written on the cursor, there). None of it needs a browser: the module
// rewrites the text and reads it back with abcjs's parseOnly, which runs in
// Node, so it is tested here and the gestures that ask for a change are
// tested in webview-score-mode.test.js.
//
// What a move must never do is change the music. The module checks that for
// itself before it hands a move out (verify); these tests check it again with
// a reading of their own (music), so a fault in the module's check cannot
// pass unseen, and sweep every note of every fixture in both directions.
// Run with: node --test tests/score-bars.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MEDIA = path.join(__dirname, "..", "vscode-mdm", "media");
const MDM_BARS = require(path.join(MEDIA, "mdm-bars.js"));

// The bundle the webview loads as a plain script, given its CommonJS pair here
// (the same way audio-export.test.js reads it).
const ABCJS = (function () {
  const code = fs.readFileSync(path.join(MEDIA, "vendor", "abcjs", "abcjs-basic-min.js"), "utf8");
  const module_ = { exports: {} };
  new Function("module", "exports", code)(module_, module_.exports);
  return module_.exports;
})();

function move(source, needle, direction, nth) {
  let at = -1;
  for (let i = 0; i <= (nth || 0); i++) at = source.indexOf(needle, at + 1);
  assert.ok(at >= 0, "no " + needle + " in the fixture");
  return MDM_BARS.moveBars(ABCJS, source, at, direction);
}

// The music of a score as a reader of the page meets it, voice by voice: the
// notes and rests with their pitches, lengths and verses, and the barlines.
// Written apart from the module's own check on purpose.
function music(source) {
  const tune = ABCJS.parseOnly(source)[0];
  const voices = {};
  tune.lines.forEach((line) => {
    (line.staff || []).forEach((staff, s) => {
      (staff.voices || []).forEach((voice, v) => {
        const list = voices[s + "/" + v] || (voices[s + "/" + v] = []);
        voice.forEach((el, i) => {
          // `[1` at the head of a line is the ending the barline closing the
          // line above opens: one barline with its ending, as `|1` is.
          if (i === 0 && el.el_type === "bar" && el.type === "bar_invisible" && el.startEnding && /^bar /.test(list[list.length - 1])) {
            list[list.length - 1] += " ending " + el.startEnding;
            return;
          }
          if (el.el_type === "bar") list.push("bar " + el.type + (el.startEnding ? " ending " + el.startEnding : ""));
          if (el.el_type !== "note") return;
          const pitches = (el.pitches || []).map((p) => p.pitch + (p.accidental || "")).join(",");
          const words = (el.lyric || []).map((l) => l.syllable + (l.syllable ? l.divider : ""));
          while (words.length && !words[words.length - 1]) words.pop();
          list.push([el.rest ? "rest " + el.rest.type : pitches, el.duration, words.join("|")].join(" "));
        });
      });
    });
  });
  return voices;
}

// How many bars each line of a score holds, in its first voice.
function layout(source) {
  const tune = ABCJS.parseOnly(source)[0];
  return tune.lines
    .filter((line) => line.staff)
    .map((line) => {
      const voice = line.staff[0].voices[0];
      let bars = 0;
      let seen = false;
      voice.forEach((el) => {
        if (el.el_type === "note") seen = true;
        if (el.el_type === "bar" && seen) {
          bars++;
          seen = false;
        }
      });
      return bars + (seen ? 1 : 0);
    });
}

function assertSameMusic(before, after) {
  assert.deepEqual(music(after), music(before), "the move changed the music");
}

// The owner's own example, 2026-09-29: two lines regrouped.
const OWNER = ["X:1", "L:1/4", "K:C", "C D | E F |", "G A | B c | d e |]"].join("\n");

test("the owner's example: the head of a line goes up to the end of the one above, and back down", () => {
  const up = move(OWNER, "G A", "up");
  assert.equal(up.source, ["X:1", "L:1/4", "K:C", "C D | E F | G A |", "B c | d e |]"].join("\n"));
  assertSameMusic(OWNER, up.source);
  // The bar and every bar after it on its line go down, to the head of the
  // next: the reverse of the move up, to the character.
  const down = move(up.source, "G A", "down");
  assert.equal(down.source, OWNER);
});

test("down from the last line makes a line of its own, and a whole line going up or down goes whole", () => {
  const split = move(OWNER, "d e", "down");
  assert.equal(split.source, ["X:1", "L:1/4", "K:C", "C D | E F |", "G A | B c |", "d e |]"].join("\n"));
  const joined = move(OWNER, "d e", "up");
  assert.equal(joined.source, ["X:1", "L:1/4", "K:C", "C D | E F | G A | B c | d e |]"].join("\n"));
  const first = move(OWNER, "C D", "down");
  assert.equal(first.source, ["X:1", "L:1/4", "K:C", "C D | E F | G A | B c | d e |]"].join("\n"));
  assert.deepEqual(layout(first.source), [5]);
});

test("a move that has nowhere to go is refused with a reason for the reader", () => {
  assert.equal(move(OWNER, "C D", "up").refused, "first");
  const one = ["X:1", "L:1/4", "K:C", "C D | E F |]"].join("\n");
  assert.equal(move(one, "C D", "down").refused, "last");
  for (const reason of ["first", "last", "voices", "lyrics", "title", "fields", "linebreak", "runsOn", "unsafe", "parse", "place"]) {
    assertShortReason(reason);
  }
});

// A line that stops without a barline, over one that opens without one,
// has a bar that goes on across the break (`E F` and `G A` below are one
// bar), which bars moved across it would join: refused for that, in the
// owner's words (2026-09-30), and not as a change of the music, since the
// music moved there reads the same. Moved to where no bar is joined, the
// same bars go.
test("a move across the break of a line that stops without a barline is refused for that, in its own words", () => {
  const open = ["X:1", "L:1/4", "K:C", "C D | E F", "G A | B c |]"].join("\n");
  assert.equal(move(open, "E F", "down").refused, "runsOn");
  assert.equal(move(open, "G A", "up").refused, "runsOn");
  assert.equal(MDM_BARS.reasonText("runsOn"), "No barline ends this line");
  // It read the same, bar for bar, which only the count of the lines' bars
  // could not tell.
  const joined = ["X:1", "L:1/4", "K:C", "C D |", "E F G A | B c |]"].join("\n");
  assert.deepEqual(music(joined), music(open));
  // In every voice of the line, and under its verses.
  const duet = ["X:1", "L:1/4", "K:C", "V:1", "C D | E F", "V:2", "C, D, | E, F, |", "V:1", "G A | B c |]", "V:2", "G, A, | B, C |]"].join("\n");
  assert.equal(move(duet, "E F", "down").refused, "runsOn");
  const song = ["X:1", "L:1/4", "K:C", "C D | E F", "w: a b c d", "G A | B c |]", "w: e f g h"].join("\n");
  assert.equal(move(song, "G A", "up").refused, "runsOn");
  // A line opened by a barline ends the bar of the line above: that is not
  // the break a bar goes on across, whatever else stands in the way.
  const repeat = ["X:1", "L:1/4", "K:C", "C D | E F", "|: G A :| B c |]"].join("\n");
  assert.notEqual(move(repeat, "E F", "down").refused, "runsOn");
  // A last line left open sends its bars to a line of their own, and a line
  // closed over it takes its bars up: nothing is joined.
  const last = ["X:1", "L:1/4", "K:C", "C D | E F |", "G A | B c"].join("\n");
  assert.equal(move(last, "B c", "down").source, ["X:1", "L:1/4", "K:C", "C D | E F |", "G A |", "B c"].join("\n"));
  assert.equal(move(last, "G A", "up").source, ["X:1", "L:1/4", "K:C", "C D | E F | G A |", "B c"].join("\n"));
});

// A refusal is said in a tip over the button it greys out, as short as the
// button's own name, with no full stop (the owner's call, 2026-09-30); the
// lower button of a last line of one bar and the upper button of a last
// line say what they have nothing to act on, in the same words (the
// owner's, 2026-09-30).
function assertShortReason(reason) {
  const text = MDM_BARS.reasonText(reason);
  assert.ok(/^[A-Z][^.]*[^.\s]$/.test(text), reason + " is not a short name: " + text);
  assert.ok(text.length <= 32, reason + " is " + text.length + " characters long: " + text);
}

test("a button with nothing to act on says so in its own words", () => {
  assert.equal(MDM_BARS.reasonText("last"), "No bar to send down");
  assert.equal(MDM_BARS.reasonText("next"), "No bar to bring up");
});

// Three the owner cut short, the tip's place being the "here" they said
// (2026-09-30).
test("a refusal says what stands in the way, and not where", () => {
  assert.deepEqual(
    ["voices", "addVoices", "lyrics", "addMeter"].map(MDM_BARS.reasonText),
    ["Voices don't match", "Voices don't match", "Lyrics can't split", "Bar length unknown"]
  );
  // And a change its check finds different once written, moved or added
  // (the owner's pick, A, 2026-09-30).
  assert.deepEqual(["unsafe", "overlap", "addUnsafe"].map(MDM_BARS.reasonText), Array(3).fill("Can't keep the music as written"));
});

// example.mdm's first score: a part named over each line, and a verse under
// each, which have to travel with the bars they belong to.
const PARTIALS = [
  "%%stretchlast 1",
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

test("the partials: the part over a line goes inline with it, the verses join, and down gives both back", () => {
  const up = move(PARTIALS, "[CG]", "up");
  assert.deepEqual(up.source.split("\n").slice(5), [
    "P:partials",
    'C, C G c e g "^-31c"_b c\' | [P:ratios][C,C] [CG] [Gc] [ce] [eg] [g_b] [_bc\'] |',
    "w: n=1 2 3 4 5 6 7 8 2:1 3:2 4:3 5:4 6:5 7:6 8:7",
  ]);
  assertSameMusic(PARTIALS, up.source);
  // The part is still named where the second bar begins.
  const parts = ABCJS.parseOnly(up.source)[0].lines[0].staff[0].voices[0].filter((el) => el.el_type === "part");
  assert.deepEqual(parts.map((p) => p.title), ["partials", "ratios"]);
  // Down again: the part back on a line of its own over the bar it names.
  assert.equal(move(up.source, "[CG]", "down").source, PARTIALS);
  // And the first line down onto the second is the same line as the second
  // up onto the first.
  assert.equal(move(PARTIALS, "c'", "down").source, up.source);
});

// duet.mdm's second score, cut to two lines: two voices written one after the
// other, each line of the first voice drawn with the same line of the second.
const DUET = [
  "T: Sea To Sea (duet)",
  "V:1",
  "M:4/4",
  "L:1/4",
  "[EGc]2 [FAc]2 | [EGc]2 [FGB]2 | [EGc]4 | [CEG]4 |",
  "[CFA]2 [CFA]2 | [DGB]2 [FGB]2 | [FGc]4 | [EGc]4 |",
  "V:2",
  "c G A F | G E F D | E C E G | c B A G |",
  "F D2  F | B G2  B | c G A F | E G C G |",
].join("\n");

test("two voices move the same bars together, from either voice", () => {
  const up = move(DUET, "[CFA]2 [CFA]2", "up");
  assert.deepEqual(up.source.split("\n").slice(4), [
    "[EGc]2 [FAc]2 | [EGc]2 [FGB]2 | [EGc]4 | [CEG]4 | [CFA]2 [CFA]2 |",
    "[DGB]2 [FGB]2 | [FGc]4 | [EGc]4 |",
    "V:2",
    "c G A F | G E F D | E C E G | c B A G | F D2  F |",
    "B G2  B | c G A F | E G C G |",
  ]);
  assertSameMusic(DUET, up.source);
  assert.deepEqual(layout(up.source), [5, 3]);
  // From the lower voice, the same move.
  assert.equal(move(DUET, "F D2", "up").source, up.source);
  const down = move(DUET, "c B A G", "down");
  assert.deepEqual(layout(down.source), [3, 5]);
  assertSameMusic(DUET, down.source);
});

test("voices written line by line, or marked inline, keep their marks where they are", () => {
  const interleaved = ["X:1", "L:1/4", "M:4/4", "K:C", "V:1", "cdef | gabc' |", "V:2", "CDEF | GABc |", "V:1", "c'bag | fedc |]", "V:2", "cBAG | FEDC |]"].join("\n");
  const up = move(interleaved, "c'bag", "up");
  assert.deepEqual(up.source.split("\n").slice(4), ["V:1", "cdef | gabc' | c'bag |", "V:2", "CDEF | GABc | cBAG |", "V:1", "fedc |]", "V:2", "FEDC |]"]);
  assertSameMusic(interleaved, up.source);
  const inline = ["X:1", "L:1/4", "M:4/4", "K:C", "[V:1] cdef | gabc' |", "[V:2] CDEF | GABc |", "[V:1] c'bag | fedc |]", "[V:2] cBAG | FEDC |]"].join("\n");
  const down = move(inline, "fedc", "down");
  assertSameMusic(inline, down.source);
  assert.deepEqual(layout(down.source), [2, 1, 1]);
  // The new line of each voice opens with the voice's mark.
  assert.ok(down.source.includes("[V:1] fedc |]"), down.source);
  assert.ok(down.source.includes("[V:2] FEDC |]"), down.source);
});

// A song: two verses under the first line, the second a syllable short, and
// a word divided with a hyphen.
const SONG = [
  "X:1",
  "L:1/4",
  "M:3/4",
  "K:G",
  "G A B | c2 B | A G F |",
  "w: This is the first line of the song",
  "w: And a se-cond verse for it",
  "G3 | B A G | D3 |]",
  "w: Here it ends",
  "w: and here",
].join("\n");

test("verses are cut between the bars that move, and padded where a verse ran short", () => {
  const up = move(SONG, "B A G", "up");
  assert.deepEqual(up.source.split("\n").slice(4), [
    "G A B | c2 B | A G F | G3 | B A G |",
    "w: This is the first line of the song Here it ends",
    // The second verse gave the last note of the line nothing: a star keeps
    // that note bare, so `and` lands on G3 as before.
    "w: And a se-cond verse for it * and here",
    "D3 |]",
  ]);
  assertSameMusic(SONG, up.source);
  // A hyphenated word divided at the barline stays divided across the lines.
  const down = move(SONG, "c2 B", "down");
  assert.deepEqual(down.source.split("\n").slice(4), [
    "G A B |",
    "w: This is the",
    "w: And a se-",
    "c2 B | A G F | G3 | B A G | D3 |]",
    "w: first line of the song Here it ends",
    "w: cond verse for it * and here",
  ]);
  assertSameMusic(SONG, down.source);
});

test("a verse the line above does not have is written for it, bare over its own notes", () => {
  const one = ["X:1", "L:1/4", "K:C", "C D | E F |", "G A | B c |]", "w: la li lo lu"].join("\n");
  const up = move(one, "G A", "up");
  assert.deepEqual(up.source.split("\n").slice(3), ["C D | E F | G A |", "w: * * * * la li", "B c |]", "w: lo lu"]);
  assertSameMusic(one, up.source);
});

test("words nothing takes above a line keep the bars below it where they are", () => {
  const surplus = ["X:1", "L:1/4", "K:C", "C D | E F |", "w: a b c d e f", "G A | B c |]"].join("\n");
  assert.equal(move(surplus, "G A", "up").refused, "lyrics");
});

test("a key between two lines goes on taking effect at the same note, inline, and back on its line", () => {
  const keyed = ["X:1", "L:1/4", "M:4/4", "K:C", "C D E F | G A B c |", "K:D", "F G A B | c d e f |]"].join("\n");
  const up = move(keyed, "F G A B", "up");
  assert.deepEqual(up.source.split("\n").slice(4), ["C D E F | G A B c | [K:D]F G A B |", "c d e f |]"]);
  assertSameMusic(keyed, up.source);
  assert.equal(move(up.source, "F G A B", "down").source, keyed);
});

test("a line continued with a backslash is one line, and a cut across the break takes the backslash", () => {
  const continued = ["X:1", "L:1/4", "K:C", "C D | E F | \\", "G A | B c |", "d e | f g |]"].join("\n");
  const up = move(continued, "d e", "up");
  assert.deepEqual(up.source.split("\n").slice(3), ["C D | E F | \\", "G A | B c | d e |", "f g |]"]);
  assertSameMusic(continued, up.source);
  const down = move(continued, "G A", "down");
  assert.deepEqual(down.source.split("\n").slice(3), ["C D | E F |", "G A | B c | d e | f g |]"]);
  assertSameMusic(continued, down.source);
});

test("comments stay at the end of their lines, repeats keep their signs", () => {
  const commented = ["X:1", "L:1/4", "K:C", "C D | E F | % one", "G A | B c | % two"].join("\n");
  assert.deepEqual(move(commented, "G A", "up").source.split("\n").slice(3), ["C D | E F | G A | % one", "B c | % two"]);
  const repeats = ["X:1", "L:1/4", "K:C", "|: C D | E F :|", "|: G A | B c :|"].join("\n");
  const up = move(repeats, "G A", "up");
  assertSameMusic(repeats, up.source);
  assert.deepEqual(layout(up.source), [3, 1]);
});

test("what keeps two lines apart is said, and the score is left alone", () => {
  const titled = ["X:1", "L:1/4", "K:C", "C D | E F |", "T:Part two", "G A | B c |]"].join("\n");
  assert.equal(move(titled, "G A", "up").refused, "title");
  const broken = ["X:1", "%%linebreak $", "L:1/4", "K:C", "C D | E F |$ G A |", "B c |]"].join("\n");
  assert.equal(move(broken, "G A", "up").refused, "linebreak");
  const uneven = ["X:1", "L:1/4", "K:C", "V:1", "A B | C D |", "E F | G A |", "V:2", "a b | c d |", "e f g a |"].join("\n");
  assert.equal(move(uneven, "E F", "up").refused, "voices");
  // Nothing under the character asked about (the X of the header).
  assert.equal(MDM_BARS.moveBars(ABCJS, OWNER, 0, "up").refused, "place");
});

// score-annotations.mdm's first score, cut down: a first ending opened by the
// barline a move breaks the line at.
const ENDINGS = [
  "X:1",
  "L:1/8",
  "M:4/4",
  "K:G",
  "[V:1] G2 A2 B2 c2 | d2 c2 B2 A2 |",
  "[V:2] G,4 F,4 | G,4 A,,4 |",
  "[V:1] e2 d2 c2 B2 |1 A2 G2 F2 G2 :|2 G8 |]",
  "[V:2] E,4 C,4 |1 D,4 D,,4 :|2 G,,8 |]",
].join("\n");

test("a barline that opens an ending, broken at, ends the line and opens the next with the ending", () => {
  const up = move(ENDINGS, "e2 d2", "up");
  assert.deepEqual(up.source.split("\n").slice(4), [
    "[V:1] G2 A2 B2 c2 | d2 c2 B2 A2 | e2 d2 c2 B2 |",
    "[V:2] G,4 F,4 | G,4 A,,4 | E,4 C,4 |",
    "[V:1] [1 A2 G2 F2 G2 :|2 G8 |]",
    "[V:2] [1 D,4 D,,4 :|2 G,,8 |]",
  ]);
  // The bracket still opens over A2 and not over nothing at the line's end.
  const bars = ABCJS.parseOnly(up.source)[0].lines.map((l) => l.staff[0].voices[0].filter((e) => e.el_type === "bar"));
  assert.equal(bars[0][bars[0].length - 1].endEnding, undefined);
  assert.equal(bars[1][0].startEnding, "1");
  // And down again, the ending back on its barline.
  assert.equal(move(up.source, "e2 d2", "down").source, ENDINGS);
  assert.equal(move(ENDINGS, "A2 G2 F2", "down").refused, undefined);
});

test("with several voices a field stays inline at the head of a line, where it is that voice's alone", () => {
  const metered = [
    "X:1",
    "L:1/4",
    "M:4/4",
    "K:C",
    "V:1",
    "C D E F | G A B c |",
    "[M:2/4] c B | A G |]",
    "V:2",
    "C, D, E, F, | G, A, B, C |",
    "[M:2/4] C B, | A, G, |]",
  ].join("\n");
  const up = move(metered, "c B", "up");
  assertSameMusic(metered, up.source);
  const down = move(up.source, "c B", "down");
  assertSameMusic(metered, down.source);
  // Not taken to a line of its own, which abcjs reads for both voices.
  assert.ok(!/^M:2\/4$/m.test(down.source), down.source);
});

test("elements abcjs keeps for itself, with no place in the text, are no part of a line", () => {
  // %%score puts two voices on one staff and gives each a stem with no chars.
  const shared = [
    "X:1",
    "%%score (S A) T",
    "L:1/4",
    "K:C",
    "V:S",
    "cdef | gabc' |",
    "c'bag | fedc |]",
    "V:A",
    "CDEF | GABc |",
    "cBAG | FEDC |]",
    "V:T clef=bass",
    "C,D,E,F, | G,A,B,C |",
    "C B, A, G, | F, E, D, C, |]",
  ].join("\n");
  const up = move(shared, "c'bag", "up");
  assert.deepEqual(up.source.split("\n").slice(4), [
    "V:S",
    "cdef | gabc' | c'bag |",
    "fedc |]",
    "V:A",
    "CDEF | GABc | cBAG |",
    "FEDC |]",
    "V:T clef=bass",
    "C,D,E,F, | G,A,B,C | C B, A, G, |",
    "F, E, D, C, |]",
  ]);
});

// The check itself, put to work on texts made by hand: what a move is
// allowed to change (where the lines break, and what abcjs decides from
// that) passes, and anything a reader would see or hear otherwise does not.
test("the check a move passes lets a new layout through and stops a changed note, word, key or meter", () => {
  const two = ["X:1", "L:1/4", "M:4/4", "K:C", "C D E F | G A B c |", "d e f g | a b c' d' |]"].join("\n");
  const relaid = ["X:1", "L:1/4", "M:4/4", "K:C", "C D E F |", "G A B c | d e f g |", "a b c' d' |]"].join("\n");
  assert.equal(MDM_BARS.verify(ABCJS, two, relaid, "0/0", [1, 2, 1]), null);
  // The layout asked for is checked too.
  assert.equal(MDM_BARS.verify(ABCJS, two, relaid, "0/0", [2, 2]), "unsafe");
  assert.equal(MDM_BARS.verify(ABCJS, two, relaid.replace("G A", "G ^A"), "0/0", [1, 2, 1]), "unsafe");
  const sung = two.replace("C D E F | G A B c |", "C D E F | G A B c |\nw: a b c d e f g h");
  assert.equal(MDM_BARS.verify(ABCJS, sung, sung.replace("e f g h", "e f g"), "0/0", [2, 2]), "unsafe");
  // A key or a meter that stopped taking effect where it did.
  const keyed = two.replace("\nd e f g", "\nK:D\nd e f g");
  assert.equal(MDM_BARS.verify(ABCJS, keyed, two, "0/0", [2, 2]), "unsafe");
  const metered = ["X:1", "L:1/4", "M:4/4", "K:C", "C D E F | G A B c |", "M:3/4", "d e f | g a b |]"].join("\n");
  assert.equal(MDM_BARS.verify(ABCJS, metered, metered.replace("M:3/4\n", ""), "0/0", [2, 2]), "unsafe");
  // The numbers %%measurenb prints at the head of each line follow the
  // lines, and are no change to the music.
  const numbered = "%%measurenb 1\n" + two;
  assert.equal(MDM_BARS.verify(ABCJS, numbered, "%%measurenb 1\n" + relaid, "0/0", [1, 2, 1]), null);
});

// What the rewriting does not know is left to that check: a symbol the
// reader defined between the two lines (U:) would be used before it is
// defined once its bar went up, and the fermata it stands for would go.
test("a move the rewriting gets wrong is stopped by the check, and the score is left as it was", () => {
  const defined = ["X:1", "L:1/4", "K:C", "C D | E F |", "U: W = !fermata!", "W G A | B c |]"].join("\n");
  assert.equal(move(defined, "G A", "up").refused, "unsafe");
});

test("a voice missing from one of the two lines keeps them apart", () => {
  const missing = ["X:1", "L:1/4", "K:C", "V:1", "C D | E F |", "G A | B c |]", "V:2", "C, D, | E, F, |"].join("\n");
  assert.equal(move(missing, "G A", "up").refused, "voices");
});

test("a field written after a line's last barline goes with that bar, and the line goes whole", () => {
  const tailed = ["X:1", "L:1/4", "K:C", "C D | E F |", "G A | B c | [K:G]", "d e | f g |]"].join("\n");
  const up = move(tailed, "B c", "up");
  assert.deepEqual(up.source.split("\n").slice(3), ["C D | E F | G A | B c | [K:G]", "d e | f g |]"]);
  assertSameMusic(tailed, up.source);
});

test("a star over a rest is the rest's, as abcjs reads it, and the words after it stay on their notes", () => {
  const rested = ["X:1", "L:1/4", "K:C", "C z E F | G A B c |", "w: a * b c d e f g", "d e f g |]"].join("\n");
  const down = move(rested, "G A", "down");
  assert.deepEqual(down.source.split("\n").slice(3), ["C z E F |", "w: a * b c", "G A B c | d e f g |]", "w: d e f g"]);
  assertSameMusic(rested, down.source);
});

// A verse can open a bar late (`w: | la li`, the words beginning in the
// second bar), and a barline a verse gives nothing to takes that `|` from
// whatever comes next: the verse carried past such a barline is given a `|`
// of its own for it. Found by fuzzing the module with random tunes.
test("a verse that skips a bar with `|` keeps its words on their notes across a move", () => {
  const late = ["X:1", "L:1/4", "K:C", "C D E F | G A B c |", "w: | la li lo lu", "d e f g | a b c' d' |]", "w: | ma me mi mo"].join("\n");
  const down = move(late, "G A", "down");
  assert.deepEqual(down.source.split("\n").slice(3), ["C D E F |", "w: |", "G A B c | d e f g | a b c' d' |]", "w: la li lo lu | | ma me mi mo"]);
  assertSameMusic(late, down.source);
  const early = ["X:1", "L:1/4", "K:C", "C D E F | G A B c |", "w: la li lo lu", "d e f g | a b c' d' |]", "w: | ma me mi mo"].join("\n");
  const up = move(early, "a b", "up");
  assert.deepEqual(up.source.split("\n").slice(3), ["C D E F | G A B c | d e f g | a b c' d' |]", "w: la li lo lu * * * * | | ma me mi mo"]);
  assertSameMusic(early, up.source);
});

// A key changed on a line of its own draws the naturals that cancel the key
// before it; written inline, where a move up puts it, abcjs lists them
// otherwise. The notes are read under the same sharps either way.
test("a key after another carried inline is the same key, its cancelling naturals aside", () => {
  const rekeyed = ["X:1", "L:1/4", "K:F", "F G A B | c d e f |", "K:D", "d e f g | a b c' d' |]"].join("\n");
  const up = move(rekeyed, "d e f g", "up");
  assert.deepEqual(up.source.split("\n").slice(3), ["F G A B | c d e f | [K:D]d e f g |", "a b c' d' |]"]);
  assertSameMusic(rekeyed, up.source);
  // Down to a line of its own under the last, whose head draws D with no
  // natural to cancel, the line above being in D already.
  const down = move(rekeyed, "a b", "down");
  assert.deepEqual(down.source.split("\n").slice(3), ["F G A B | c d e f |", "K:D", "d e f g |", "a b c' d' |]"]);
  assertSameMusic(rekeyed, down.source);
});

// Every note of every fixture, both ways: a move is refused, or it keeps the
// music and moves the bars it says. What the sweep would catch is a move the
// module let through that a reader would hear or see differently.
test("a sweep of every note, both ways: refused, or the same music with the bars moved", () => {
  const fixtures = {
    OWNER,
    PARTIALS,
    DUET,
    SONG,
    ENDINGS,
    tuplets: "X:1\nL:1/8\nM:2/4\nK:C\n(3CDE F2 | (3GAB c2- |\nc2 (3dcB | A4 |]",
    ties: "X:1\nL:1/4\nK:C\n(C D | E F) | G- |\nG A | (B c | d) e |]",
    ornaments: "X:1\nL:1/8\nK:D\n{g}A2 !trill!B2 | .c .d ~e2 |\n!fermata!f4 | {ag}f2 e2 |]",
    pickup: "X:1\nL:1/4\nM:3/4\nK:G\nD | G A B | c2 B |\nA G F | G2 |]",
    rests: "X:1\nL:1/4\nM:4/4\nK:C\nC D E F | Z4 |\nG A B c | z4 |]",
    repeats: "X:1\nL:1/4\nK:C\n|: C D | E F :|\n|1 G A | B c :|2 d e | f g |]",
  };
  let made = 0;
  Object.keys(fixtures).forEach((name) => {
    const source = fixtures[name];
    const tune = ABCJS.parseOnly(source)[0];
    const lines = layout(source);
    tune.lines.forEach((line, l) => {
      if (!line.staff) return;
      line.staff[0].voices[0].forEach((el) => {
        if (el.el_type !== "note") return;
        ["up", "down"].forEach((direction) => {
          const out = MDM_BARS.moveBars(ABCJS, source, el.startChar, direction);
          if (out.refused) return;
          made++;
          assertSameMusic(source, out.source);
          const now = layout(out.source);
          const total = (list) => list.reduce((a, b) => a + b, 0);
          assert.equal(total(now), total(lines), name + ": bars went missing");
          assert.notDeepEqual(now, lines, name + ": nothing moved " + direction + " at " + el.startChar);
        });
      });
    });
  });
  assert.ok(made > 40, "the sweep made only " + made + " moves");
});

// ---------- A bar added ----------

function add(source, needle, where, nth) {
  let at = -1;
  for (let i = 0; i <= (nth || 0); i++) at = source.indexOf(needle, at + 1);
  assert.ok(at >= 0, "no " + needle + " in the fixture");
  return MDM_BARS.addBar(ABCJS, source, at, where || "after");
}

// The music after a bar was added, read apart from the module's own check:
// in every voice of the line, the music before with rests and one plain
// barline more, together, and nothing else changed; the rests lasting
// `length` whole notes between them, and `pieces` one by one when it is
// given; and the line one bar longer.
function assertAddedBar(before, after, length, pieces) {
  const was = music(before);
  const now = music(after);
  assert.deepEqual(Object.keys(now).sort(), Object.keys(was).sort());
  let added = 0;
  Object.keys(was).forEach((key) => {
    const a = was[key];
    const b = now[key];
    if (b.length === a.length) {
      assert.deepEqual(b, a, "voice " + key + " changed");
      return;
    }
    const count = b.length - a.length - 1;
    assert.ok(count >= 1, "voice " + key + " grew by " + (b.length - a.length));
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    const run = b.slice(i, i + count + 1);
    // Before the barline that ends the tune, and after a bar left open, the
    // barline comes first.
    const bar = /^bar /.test(run[0]) ? run[0] : run[count];
    const rests = /^bar /.test(run[0]) ? run.slice(1) : run.slice(0, count);
    rests.forEach((rest) => assert.match(rest, /^rest (rest|whole) /, "voice " + key + ": no rest where the bar went in: " + rest));
    const lengths = rests.map((rest) => Number(rest.split(" ")[2]));
    const total = lengths.reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(total - length) < 1e-9, "voice " + key + ": the rests last " + lengths.join(" + "));
    if (pieces) assert.deepEqual(lengths, pieces, "voice " + key + ": the rests are " + lengths.join(" + "));
    assert.match(bar, /^bar bar_thin$/);
    assert.deepEqual(b.slice(i + count + 1), a.slice(i), "voice " + key + " changed after the bar");
    added++;
  });
  assert.ok(added > 0, "no voice has the bar");
  const total = (list) => list.reduce((x, y) => x + y, 0);
  assert.equal(total(layout(after)), total(layout(before)) + 1);
}

test("the owner's example: a bar of rest at a barline, at the end of a line, at the head of one, and before the barline that ends the tune", () => {
  const cases = [
    ["C D", "after", 0, "C D | z2 | E F |"],
    ["E F", "after", 0, "C D | E F | z2 |"],
    ["C D", "head", 0, "z2 | C D | E F |"],
    ["d e", "after", 0, "G A | B c | d e | z2 |]"],
  ];
  for (const [needle, where, nth, line] of cases) {
    const out = add(OWNER, needle, where, nth);
    assert.ok(!out.refused, needle + " " + where + ": " + out.refused);
    assert.ok(out.source.split("\n").indexOf(line) >= 0, needle + " " + where + " wrote " + JSON.stringify(out.source));
    assert.equal(out.source.slice(out.rest).trim().slice(0, 2), "z2");
    assertAddedBar(OWNER, out.source, 0.5);
  }
});

// A bar no barline closes, the last of a tune written with none or of one
// that stops without one (the owner's report, 2026-09-30, on a score of one
// C): the new bar's barline closes it, and the new bar is left open as it
// was; what was written in the bar stays in it, an inline field and a
// comment included.
test("a bar no barline closes is closed by the barline of the bar added after it, and the new one is left open", () => {
  const cases = [
    ["C", "C", "C | z", 0.125],
    ["X:1\nL:1/4\nK:C\nC D E F", "C D", "C D E F | z4", 1],
    ["X:1\nL:1/4\nM:3/4\nK:C\nC D E", "C D", "C D E | z3", 0.75],
    ["X:1\nL:1/8\nM:6/8\nK:C\nCDE FGA", "CDE", "CDE FGA | z6", 0.75],
    ["X:1\nL:1/4\nK:C\nC D | E F", "E F", "C D | E F | z2", 0.5],
    ["X:1\nL:1/4\nK:C\nC D E F [K:G]", "C D", "C D E F [K:G] | z4", 1],
    ["X:1\nL:1/4\nK:C\nC D E F %end", "C D", "C D E F | z4 %end", 1],
    // A chord symbol left after the last note: abcjs ends the note, and then
    // the rest, one past the space before it.
    ["X:1\nL:1/4\nK:C\nC D E F \"Am\"", "C D", "C D E F | z4 \"Am\"", 1],
    ["X:1\nL:1/4\nK:C\nC D E F\nw: a b c d", "C D", "C D E F | z4", 1],
    ["X:1\nL:1/4\nK:C\nV:1\nC D | E F\nV:2\nC, D, | E, F, |", "E F", "C D | E F | z2", 0.5],
  ];
  for (const [source, needle, line, length] of cases) {
    const out = add(source, needle);
    assert.ok(!out.refused, JSON.stringify(source) + ": " + out.refused);
    assert.ok(out.source.split("\n").indexOf(line) >= 0, JSON.stringify(source) + " wrote " + JSON.stringify(out.source));
    assert.equal(out.source.slice(out.rest).trim().charAt(0), "z");
    assertAddedBar(source, out.source, length);
  }
  // A voice closed where another is open is given its bar as at any barline.
  assert.ok(add(cases[9][0], "E F").source.split("\n").indexOf("C, D, | E, F, | z2 |") >= 0);
  // A tie at the end of the bar would be cut by the barline.
  assert.equal(add("X:1\nL:1/4\nK:C\nC D E F-", "C D").refused, "addTie");
});

test("the rest lasts a bar of the meter in force, written in the unit in force, or the bar beside it where there is no meter", () => {
  const tune = (head, body) => ["X:1"].concat(head, ["K:C"], body).join("\n");
  const cases = [
    [tune(["M:3/4", "L:1/8"], ["CDEFGA | ABcdef |"]), "CDEF", "z6", 0.75],
    [tune(["M:6/8", "L:1/8"], ["CDEFGA | ABcdef |"]), "CDEF", "z6", 0.75],
    [tune(["M:C", "L:1/8"], ["CDEFGABc | cBAGFEDC |"]), "CDEF", "z8", 1],
    [tune(["M:C|", "L:1/4"], ["C D E F | G A B c |"]), "C D", "z4", 1],
    [tune(["M:2+3/8", "L:1/8"], ["CDEFG | ABcde |"]), "CDEF", "z2 z3", 0.625],
    [tune(["M:5/8", "L:1/4"], ["C D E/ | F G A/ |"]), "C D", "z5/2", 0.625],
    [tune(["M:2/4", "L:1/8"], ["CD EF | [L:1/16] CDEF GABc | c2d2 e2f2 |"]), "CDEF", "z8", 0.5],
    [tune(["M:4/4", "L:1/4"], ["C D E F | [M:3/4] G A B | c d e |"]), "G A B", "z3", 0.75],
    [tune(["L:1/4"], ["C D | E F |"]), "C D", "z2", 0.5],
    [tune(["L:1/8"], ["(3CDE F | G2 A |"]), "(3CDE", "z3", 0.375],
  ];
  // At the head of a line that opens on a field of its own, after the field:
  // the bar opens the line in the line's meter.
  const opened = tune(["M:3/4", "L:1/4"], ["d e f | g a b |", "[M:2/4] c' b | a g |]"]);
  const head = add(opened, "c' b", "head");
  assert.equal(head.source.split("\n").pop(), "[M:2/4] z2 | c' b | a g |]");
  assertAddedBar(opened, head.source, 0.5);
  for (const [source, needle, rests, length] of cases) {
    const out = add(source, needle);
    assert.ok(!out.refused, source + ": " + out.refused);
    assert.equal(out.source.slice(out.rest).trim().split(" |")[0], rests, source);
    assertAddedBar(source, out.source, length);
  }
  // A voice with a unit of its own writes the same bar in its own unit.
  const voices = ["X:1", "M:2/4", "L:1/8", "K:C", "V:1", "CD EF | GA Bc |", "V:2", "L:1/4", "C D | E F |"].join("\n");
  const out = add(voices, "CD EF");
  assert.equal(out.source, voices.replace("CD EF |", "CD EF | z4 |").replace("C D |", "C D | z2 |"));
  assertAddedBar(voices, out.source, 0.5);
});

// The owner's pick of design-score-editing-2.html (A, 2026-09-29): one
// rest where abcjs knows the bar, which it draws as the whole-bar rest, and
// where it does not, the rests a musician writes. The partials of
// example.mdm have no meter and bars of eight and seven quarters: one rest
// of eight quarters is one abcjs cannot draw ("pitch is undefined", in red).
test("a new bar has the rest of the bar where abcjs knows the bar, a rest a group for a sum, and the longest rests first where there is no meter", () => {
  const tune = (head, body) => ["X:1"].concat(head, ["K:C"], body).join("\n");
  const cases = [
    [tune(["M:4/4", "L:1/4"], ["C D E F | G A B c |"]), "C D", "z4", [1]],
    [tune(["M:3/4", "L:1/4"], ["C D E | G A B |"]), "C D", "z3", [0.75]],
    [tune(["M:6/8", "L:1/8"], ["CDE FGA | ABc def |"]), "CDE", "z6", [0.75]],
    [tune(["M:5/8", "L:1/8"], ["CDEFG | ABcde |"]), "CDE", "z5", [0.625]],
    [tune(["M:7/8", "L:1/8"], ["CDEFGAB | cdefgab |"]), "CDE", "z7", [0.875]],
    [tune(["M:2+3/8", "L:1/8"], ["CDEFG | ABcde |"]), "CDE", "z2 z3", [0.25, 0.375]],
    [tune(["M:3+2+2/8", "L:1/8"], ["CDEFGAB | cdefgab |"]), "CDE", "z3 z2 z2", [0.375, 0.25, 0.25]],
    [tune(["L:1/4"], ["C D | E F |"]), "C D", "z2", [0.5]],
    [tune(["L:1/4"], ["C D E F | G A B c |"]), "C D", "z4", [1]],
    [tune(["L:1/4"], ["C D E F G | c d |"]), "C D", "z4 z", [1, 0.25]],
    [tune(["L:1/4"], ["C D E F G A B | c d |"]), "C D", "z4 z3", [1, 0.75]],
    [tune(["M:none", "L:1/4"], ["C D E F G A B | c d |"]), "C D", "z4 z3", [1, 0.75]],
    [tune(["L:1/8"], ["CDEFG | cd |"]), "CDE", "z4 z", [0.5, 0.125]],
    // A meter changed inside a line abcjs's engraver does not read: the
    // bar's one rest there, drawn as the rest of its length.
    [tune(["M:4/4", "L:1/4"], ["C D E F | [M:3/4] G A B | c d e |"]), "G A B", "z3", [0.75]],
  ];
  for (const [source, needle, rests, pieces] of cases) {
    const out = add(source, needle);
    assert.ok(!out.refused, source + ": " + out.refused);
    assert.equal(out.source.slice(out.rest).trim().split(" |")[0], rests, source);
    assertAddedBar(source, out.source, pieces.reduce((a, b) => a + b, 0), pieces);
  }
  // The partials: two wholes after the bar of eight, a whole and a dotted
  // half after the bar of seven, the verses under them left on their notes.
  const first = add(PARTIALS, "C, C G");
  assert.ok(first.source.split("\n").indexOf('C, C G c e g "^-31c"_b c\' | z4 z4 |') >= 0, JSON.stringify(first));
  assertAddedBar(PARTIALS, first.source, 2, [1, 1]);
  const second = add(PARTIALS, "[C,C]");
  assert.ok(second.source.split("\n").indexOf("[C,C] [CG] [Gc] [ce] [eg] [g_b] [_bc'] | z4 z3 |") >= 0, JSON.stringify(second));
  assertAddedBar(PARTIALS, second.source, 1.75, [1, 0.75]);
});

test("a verse makes room for every rest of the new bar: a `*` apiece where a rest would take one", () => {
  const verse = (words) => ["X:1", "L:1/4", "K:C", "A B C D E F G | C D |", "w: " + words].join("\n");
  const out = add(verse("a b c d e f g * i"), "A B");
  assert.equal(out.source, verse("a b c d e f g * * * i").replace("G |", "G | z4 z3 |"));
  assertAddedBar(verse("a b c d e f g * i"), out.source, 1.75, [1, 0.75]);
});

test("every voice of the line takes the bar at the same place, in blocks, line by line or marked inline", () => {
  // Asked from the second voice, as from the first.
  const block = add(DUET, "c G A F");
  assert.equal(block.source, DUET.replace("[EGc]2 [FAc]2 |", "[EGc]2 [FAc]2 | z4 |").replace("c G A F |", "c G A F | z4 |"));
  assertAddedBar(DUET, block.source, 1);
  const head = add(DUET, "[CFA]2 [CFA]2", "head");
  assert.equal(head.source, DUET.replace("[CFA]2 [CFA]2", "z4 | [CFA]2 [CFA]2").replace("F D2  F", "z4 | F D2  F"));
  assertAddedBar(DUET, head.source, 1);
  const inline = ["X:1", "L:1/4", "M:4/4", "K:C", "[V:1] cdef | gabc' |", "[V:2] CDEF | GABc |"].join("\n");
  const marked = add(inline, "cdef", "head");
  assert.equal(marked.source, inline.replace("[V:1] cdef", "[V:1] z4 | cdef").replace("[V:2] CDEF", "[V:2] z4 | CDEF"));
  assertAddedBar(inline, marked.source, 1);
});

test("the verses keep every syllable on its note: a `*` or a `|` goes in where the rest or the new barline would take one", () => {
  const verse = (words) => ["X:1", "L:1/4", "K:C", "A B | C D | E F |", "w: " + words].join("\n");
  const cases = [
    ["a b c d e f", "a b c d e f"],
    ["a b * d e f", "a b * * d e f"],
    ["a b | | e f", "a b | | | e f"],
  ];
  for (const [words, written] of cases) {
    const out = add(verse(words), "A B");
    assert.equal(out.source, verse(written).replace("A B |", "A B | z2 |"), words);
    assertAddedBar(verse(words), out.source, 0.5);
  }
  // Words that begin a bar late, with a bar before the line's first.
  const late = ["X:1", "L:1/4", "K:C", "A B | C D |", "w: | c d"].join("\n");
  const out = add(late, "A B", "head");
  assert.equal(out.source, ["X:1", "L:1/4", "K:C", "z2 | A B | C D |", "w: | | c d"].join("\n"));
  assertAddedBar(late, out.source, 0.5);
  // A syllable held over the barline (`b_`) can have nothing put in it.
  assert.equal(add(verse("a b_ c d"), "A B").refused, "addLyrics");
  // A symbol line is read against the notes as a verse is, and is not
  // rewritten.
  assert.equal(add(["X:1", "L:1/4", "K:C", "A B | C D |", "s: * * | !fermata! *"].join("\n"), "A B").refused, "addLyrics");
});

test("a repeat or an ending keeps its sign: the bar goes in after the barline, inside what it opens", () => {
  const cases = [
    ["G2 A2", "head", "|: z8 | G2 A2 B2 c2 | d2 c2 B2 A2 |"],
    ["e2 d2", "after", "e2 d2 c2 B2 |1 z8 | A2 G2 F2 G2 :|2 G8 |]"],
    ["A2 G2 F2", "after", "e2 d2 c2 B2 |1 A2 G2 F2 G2 :|2 z8 | G8 |]"],
    ["G8", "after", "e2 d2 c2 B2 |1 A2 G2 F2 G2 :|2 G8 | z8 |]"],
  ];
  const source = ["X:1", "L:1/8", "M:4/4", "K:G", "|: G2 A2 B2 c2 | d2 c2 B2 A2 |", "e2 d2 c2 B2 |1 A2 G2 F2 G2 :|2 G8 |]"].join("\n");
  for (const [needle, where, line] of cases) {
    const out = add(source, needle, where);
    assert.ok(out.source && out.source.split("\n").indexOf(line) >= 0, needle + ": " + JSON.stringify(out));
    assertAddedBar(source, out.source, 1);
  }
});

// The owner's report of 2026-10-02: in `C | | G` only the first barline
// wore a +. The second closes no bar, and adds one past itself, before the
// bar after it; asked of a bar with no barline of its own before it, the
// bar goes after the one that closes the bar before.
test("a bar asked for before a bar goes past the barlines that open it, or past the one that closes the bar before", () => {
  const empty = "X:1\nL:1/4\nM:2/4\nK:C\nC2 | | G2 |";
  const out = add(empty, "G2", "before");
  assert.equal(out.source.split("\n").pop(), "C2 | | z2 | G2 |");
  assert.equal(out.source.slice(out.rest).trim().slice(0, 2), "z2");
  assertAddedBar(empty, out.source, 0.5);
  const plain = "X:1\nL:1/4\nM:2/4\nK:C\nC2 | G2 |";
  assert.equal(add(plain, "G2", "before").source.split("\n").pop(), "C2 | z2 | G2 |");
  // Before the first bar of a line is at its head.
  assert.equal(add(plain, "C2", "before").source.split("\n").pop(), "z2 | C2 | G2 |");
  // Every voice of the line, each past its own barlines.
  const duet = ["X:1", "L:1/4", "M:2/4", "K:C", "V:1", "C2 | | G2 |", "V:2", "E2 | B2 |"].join("\n");
  const both = add(duet, "G2", "before");
  assert.equal(both.source, duet.replace("C2 | | G2", "C2 | | z2 | G2").replace("E2 | B2", "E2 | z2 | B2"));
  assertAddedBar(duet, both.source, 0.5);
});

// The owner's call of 2026-10-03 for the keys: Ctrl with an arrow adds the
// bar in the cursor's voice alone, and Ctrl+Alt in every voice there is;
// and of 2026-10-06, which took Ctrl+Alt out: the voices are chosen first,
// and the bar goes into the ones chosen (the test after this one).
test("with `own`, a bar goes into the voice asked and into no other, after its bar or before it", () => {
  const duet = ["X:1", "L:1/4", "M:2/4", "K:C", "V:1", "C2 | G2 |", "V:2", "E2 | B2 |"].join("\n");
  const upper = MDM_BARS.addBar(ABCJS, duet, duet.indexOf("C2"), "after", true);
  assert.equal(upper.source, duet.replace("C2 | G2", "C2 | z2 | G2"));
  assert.equal(upper.source.slice(upper.rest).trim().slice(0, 2), "z2");
  const lower = MDM_BARS.addBar(ABCJS, duet, duet.indexOf("B2"), "before", true);
  assert.equal(lower.source, duet.replace("E2 | B2", "E2 | z2 | B2"));
  assert.equal(lower.source.slice(lower.rest).trim().slice(0, 2), "z2");
  assert.equal(MDM_BARS.addBar(ABCJS, duet, duet.indexOf("E2"), "head", true).source, duet.replace("E2 | B2", "z2 | E2 | B2"));
  // Without it, every voice of the line, as the + adds it.
  assert.equal(MDM_BARS.addBar(ABCJS, duet, duet.indexOf("C2"), "after").source, duet.replace("C2 | G2", "C2 | z2 | G2").replace("E2 | B2", "E2 | z2 | B2"));
  // A voice that differs from the others is no obstacle to its own bar.
  const uneven = ["X:1", "L:1/4", "K:C", "V:1", "C D | E F | G A |", "V:2", "C, D, | E, F, |"].join("\n");
  assert.equal(MDM_BARS.addBar(ABCJS, uneven, uneven.indexOf("G A"), "after").refused, "addVoices");
  assert.equal(MDM_BARS.addBar(ABCJS, uneven, uneven.indexOf("G A"), "after", true).source, uneven.replace("G A |", "G A | z2 |"));
});

test("with a list for `own`, a bar goes into the voice asked and into the voices the list names, and into no other", () => {
  const trio = ["X:1", "L:1/4", "M:2/4", "K:C", "V:1", "C2 | G2 |", "V:2", "E2 | B2 |", "V:3", "A,2 | D2 |"].join("\n");
  const upper = trio.replace("C2 | G2", "C2 | z2 | G2");
  // The first and the third: the second is left as it was. The rest handed
  // back is the one of the voice asked.
  const two = MDM_BARS.addBar(ABCJS, trio, trio.indexOf("C2"), "after", [trio.indexOf("A,2")]);
  assert.equal(two.source, upper.replace("A,2 | D2", "A,2 | z2 | D2"));
  assert.ok(two.rest > two.source.indexOf("C2") && two.rest < two.source.indexOf("V:2"), "the rest handed back is not the first voice's");
  // Any note of a voice on the line names it, the bar being told by the
  // place asked alone; a voice named twice, or the one asked named as
  // well, is that voice once.
  const named = MDM_BARS.addBar(ABCJS, trio, trio.indexOf("C2"), "after", [trio.indexOf("D2"), trio.indexOf("A,2"), trio.indexOf("G2")]);
  assert.equal(named.source, two.source);
  // All three named is every voice, as with no `own`.
  assert.equal(MDM_BARS.addBar(ABCJS, trio, trio.indexOf("E2"), "before", [trio.indexOf("C2"), trio.indexOf("A,2")]).source, MDM_BARS.addBar(ABCJS, trio, trio.indexOf("E2"), "before").source);
  // A list of nothing is the voice asked alone.
  assert.equal(MDM_BARS.addBar(ABCJS, trio, trio.indexOf("C2"), "after", []).source, upper);
  // A character that is no note's names no voice, and one of another line
  // none of this one: refused, and nothing written.
  assert.equal(MDM_BARS.addBar(ABCJS, trio, trio.indexOf("C2"), "after", [trio.indexOf("V:2")]).refused, "addPlace");
  const lines = ["X:1", "L:1/4", "M:2/4", "K:C", "V:1", "C2 | G2 |", "A2 | c2 |", "V:2", "E2 | B2 |", "F2 | d2 |"].join("\n");
  assert.equal(MDM_BARS.addBar(ABCJS, lines, lines.indexOf("C2"), "after", [lines.indexOf("F2")]).refused, "addPlace");
  assert.equal(MDM_BARS.addBar(ABCJS, lines, lines.indexOf("C2"), "after", [lines.indexOf("E2")]).source, lines.replace("C2 | G2", "C2 | z2 | G2").replace("E2 | B2", "E2 | z2 | B2"));
  // A voice named that has no such bar is the reason the others get none.
  const uneven = ["X:1", "L:1/4", "K:C", "V:1", "C D | E F | G A |", "V:2", "C, D, | E, F, |"].join("\n");
  assert.equal(MDM_BARS.addBar(ABCJS, uneven, uneven.indexOf("G A"), "after", [uneven.indexOf("C, D,")]).refused, "addVoices");
});

// The owner's call of 2026-10-06: "yo lo veo como que hay parte de la redonda
// que se seleccionó y se le dio delete, por lo que la redonda debe reducirse
// en la duración que se le quitó (sin agregar silencios)". The editor names
// the ends of a voice's stretch that stay and the length each is left with
// (stretchCutOf in main.js); this is what the text is made to say.
test("a stretch that takes a part of a place of another voice leaves the place, shorter: what goes is what stands between the places that stay, and each is then written the length it is left", () => {
  const trio = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | g a b c' |", "V:2", "E F G A | B c d e |", "V:3 clef=bass", "C,4 | G,2 C,2 |"].join("\n");
  const over = (src, a, b) => ({ from: src.indexOf(a), to: src.indexOf(b || a) + (b || a).length });
  const lines = (made) => (made.refused ? made.refused : made.source.split("\n").filter((l) => /\|/.test(l)));
  const cut = (src, pastes) => lines(MDM_BARS.pasteMusic(ABCJS, src, pastes));
  const both = { first: true, last: true };
  const C4 = trio.indexOf("C,4");
  const G2 = trio.indexOf("G,2");
  // One quarter of the upper voices, over the bass's whole note: the whole
  // note is three quarters long, and its bar keeps its barline.
  assert.deepEqual(cut(trio, [{ over: [over(trio, "d")], text: null }, { over: [over(trio, "F")], text: null }, { over: [over(trio, "C,4")], text: null, keep: both }, { at: C4, length: 0.75 }]), ["c e f | g a b c' |", "E G A | B c d e |", "C,3 | G,2 C,2 |"]);
  // The place alone, with nothing between its ends and nothing to put in,
  // is the source as it was; and the length alone is the note written again.
  assert.equal(MDM_BARS.pasteMusic(ABCJS, trio, [{ over: [over(trio, "C,4")], text: null, keep: both }]).source, trio);
  assert.deepEqual(cut(trio, [{ at: C4, length: 0.5 }]), ["c d e f | g a b c' |", "E F G A | B c d e |", "C,2 | G,2 C,2 |"]);
  // Across the barline both ends stay, and the barline between them goes,
  // as it goes from the voices the stretch is whole notes of.
  assert.deepEqual(cut(trio, [{ over: [over(trio, "f", "g")], text: null }, { over: [over(trio, "A", "B")], text: null }, { over: [over(trio, "C,4", "G,2")], text: null, keep: both }, { at: C4, length: 0.75 }, { at: G2, length: 0.25 }]), ["c d e a b c' |", "E F G c d e |", "C,3 G, C,2 |"]);
  // The first alone stays: what is after it goes, to the end of the last.
  assert.deepEqual(cut(trio, [{ over: [over(trio, "C,4", "G,2")], text: null, keep: { first: true, last: false } }, { at: C4, length: 0.75 }]), ["c d e f | g a b c' |", "E F G A | B c d e |", "C,3 C,2 |"]);
  // The last alone stays: a bar that is all before it goes as a bar does,
  // with its barline.
  assert.deepEqual(cut(trio, [{ over: [over(trio, "C,4", "G,2")], text: null, keep: { first: false, last: true } }, { at: G2, length: 0.25 }]), ["c d e f | g a b c' |", "E F G A | B c d e |", "G, C,2 |"]);
  // Music put in goes after the first where it stays, and before the last
  // where the first does not.
  assert.deepEqual(cut(trio, [{ over: [over(trio, "C,4")], text: "D,", keep: both }, { at: C4, length: 0.75 }]), ["c d e f | g a b c' |", "E F G A | B c d e |", "C,3 D, | G,2 C,2 |"]);
  assert.deepEqual(cut(trio, [{ over: [over(trio, "G,2")], text: "D,", keep: { first: false, last: true } }, { at: G2, length: 0.25 }]), ["c d e f | g a b c' |", "E F G A | B c d e |", "C,4 | D, G, C,2 |"]);
  // The place named by the space before it, which abcjs counts into it, is
  // the same place still once the music stands between the two.
  assert.deepEqual(cut(trio, [{ over: [over(trio, "G,2")], text: "D,", keep: { first: false, last: true } }, { at: G2 - 1, length: 0.25 }]), ["c d e f | g a b c' |", "E F G A | B c d e |", "C,4 | D, G, C,2 |"]);
  assert.deepEqual(cut(trio, [{ over: [over(trio, "C,4", "G,2")], text: "D,", keep: both }, { at: C4, length: 0.75 }, { at: G2, length: 0.25 }]), ["c d e f | g a b c' |", "E F G A | B c d e |", "C,3 D, G, C,2 |"]);
  // After the first, where it is the last thing written on its line: the
  // reading back is told the place it stands after, there being none to
  // stand before.
  const open = trio.replace("G,2 C,2 |", "G,4");
  assert.deepEqual(cut(open, [{ over: [over(open, "G,4")], text: "D,", keep: both }, { at: open.indexOf("G,4"), length: 0.75 }])[2], "C,4 | G,3 D,");
  // A rest is shortened as a note is, and a chord keeps its heads and what
  // is written on it. A rest nobody sees is no place to shorten.
  const unseen = trio.replace("C,4", "x4");
  assert.equal(cut(unseen, [{ at: unseen.indexOf("x4"), length: 0.75 }]), "notePlace");
  const rest = trio.replace("C,4", "z4");
  assert.deepEqual(cut(rest, [{ over: [over(rest, "z4")], text: null, keep: both }, { at: rest.indexOf("z4"), length: 0.75 }])[2], "z3 | G,2 C,2 |");
  const chord = trio.replace("C,4", '"C"[C,E,G,]4');
  assert.deepEqual(cut(chord, [{ over: [over(chord, "[C,E,G,]4")], text: null, keep: both }, { at: chord.indexOf("[C,"), length: 0.75 }])[2], '"C"[C,E,G,]3 | G,2 C,2 |');
  // Seven eighths is one note, with two dots. Five eighths is two, and a
  // third of a whole note none: refused, in words of their own.
  assert.deepEqual(cut(trio, [{ at: C4, length: 0.875 }])[2], "C,7/2 | G,2 C,2 |");
  assert.equal(cut(trio, [{ at: C4, length: 0.625 }]), "noteLength");
  assert.equal(cut(trio, [{ at: C4, length: 1 / 3 }]), "noteLength");
  assertShortReason("noteLength");
  // A note tied to the next is not shortened, and no place is one to
  // shorten where no note stands.
  const tied = trio.replace("C,4 | G,2", "C,4- | C,2");
  assert.equal(cut(tied, [{ over: [over(tied, "C,4")], text: null, keep: both }, { at: tied.indexOf("C,4"), length: 0.75 }]), "noteTie");
  assert.equal(cut(trio, [{ at: trio.indexOf("V:3"), length: 0.5 }]), "notePlace");
  // What Delete would take, for the drawing: of a place that stays,
  // nothing, where the whole note going would take its bar and barline.
  const all = MDM_BARS.cutTakes(ABCJS, trio, [[over(trio, "C,4")]]);
  assert.equal(all.taken.length, 1);
  assert.ok(trio.slice(all.taken[0].from, all.taken[0].to).includes("|"), "the bar that went whole did not take its barline");
  assert.deepEqual(MDM_BARS.cutTakes(ABCJS, trio, [[over(trio, "C,4")]], [both]), { taken: [] });
  // And of two that stay, the barline between them.
  const between = MDM_BARS.cutTakes(ABCJS, trio, [[over(trio, "C,4", "G,2")]], [both]);
  assert.deepEqual(between.taken.map((run) => trio.slice(run.from, run.to).trim()), ["|"]);
});

test("a bar that would cut a tie, or go into one of two voices laid over each other, or where the voices differ, is refused with a reason", () => {
  assert.equal(add("X:1\nL:1/4\nK:C\nC D- | D E |", "C D").refused, "addTie");
  assert.equal(add("X:1\nL:1/4\nK:C\nC D E F & A, B, C D | G A B c |", "C D").refused, "addVoices");
  assert.equal(add(["X:1", "L:1/4", "K:C", "V:1", "C D | E F | G A |", "V:2", "C, D, | E, F, |"].join("\n"), "G A").refused, "addVoices");
  // Each has words of its own, but a bar that would change the music, whose
  // words are those of a move that would.
  for (const reason of ["addPlace", "addVoices", "addLyrics", "addMeter", "addTie", "next", "last"]) {
    assert.notEqual(MDM_BARS.reasonText(reason), MDM_BARS.reasonText("unsafe"), reason + " has no words of its own");
  }
  for (const reason of ["addPlace", "addVoices", "addLyrics", "addMeter", "addTie", "addUnsafe", "next", "last"]) {
    assertShortReason(reason);
  }
});

// Every barline and every head of line of every fixture: refused with a
// reason of its own, or a bar of the meter's length where it was asked.
test("a sweep of every barline and every head of line: refused, or the same music with one bar of rest more", () => {
  // With the length of a bar where the fixture has a meter, and null where
  // it has none and a bar is as long as the one beside it.
  const fixtures = {
    OWNER: [OWNER, null],
    PARTIALS: [PARTIALS, null],
    DUET: [DUET, 1],
    SONG: [SONG, 0.75],
    ENDINGS: [ENDINGS, 1],
    tuplets: ["X:1\nL:1/8\nM:2/4\nK:C\n(3CDE F2 | (3GAB c2- |\nc2 (3dcB | A4 |]", 0.5],
    ornaments: ["X:1\nL:1/8\nM:4/4\nK:D\n{g}A2 !trill!B2 z4 | .c .d ~e2 z4 |\n!fermata!f8 | {ag}f4 e4 |]", 1],
    pickup: ["X:1\nL:1/4\nM:3/4\nK:G\nD | G A B | c2 B |\nA G F | G2 z |]", 0.75],
    rests: ["X:1\nL:1/4\nM:4/4\nK:C\nC D E F | Z4 |\nG A B c | z4 |]", 1],
    repeats: ["X:1\nL:1/4\nM:2/4\nK:C\n|: C D | E F :|\n|1 G A | B c :|2 d e | f g |]", 0.5],
    // Bars no barline closes, at the end of the tune and of a line.
    bare: ["C", null],
    unbarred: ["X:1\nL:1/4\nK:C\nC D E F G A B c", null],
    open: ["X:1\nL:1/4\nM:2/4\nK:C\nC D | E F\nG A | B c", 0.5],
  };
  const reasons = new Set(["addTie", "addVoices", "addLyrics", "addMeter"]);
  let made = 0;
  Object.keys(fixtures).forEach((name) => {
    const [source, meter] = fixtures[name];
    const tune = ABCJS.parseOnly(source)[0];
    tune.lines.forEach((line) => {
      if (!line.staff) return;
      // Each bar's first note, and how long the bar lasts by its notes.
      const asks = [];
      let note = null;
      let sum = 0;
      line.staff[0].voices[0].forEach((el) => {
        if (el.el_type === "note") {
          if (note === null) note = el.startChar;
          sum += el.duration;
        }
        if (el.el_type === "bar" && note !== null) {
          if (!asks.length) asks.push([note, "head", sum]);
          asks.push([note, "after", sum]);
          note = null;
          sum = 0;
        }
      });
      // And the end of a bar no barline closes.
      if (note !== null) {
        if (!asks.length) asks.push([note, "head", sum]);
        asks.push([note, "after", sum]);
      }
      asks.forEach(([at, where, beside]) => {
        const out = MDM_BARS.addBar(ABCJS, source, at, where);
        if (out.refused) {
          assert.ok(reasons.has(out.refused), name + " at " + at + " " + where + ": " + out.refused);
          return;
        }
        made++;
        assertAddedBar(source, out.source, meter === null ? beside : meter);
      });
    });
  });
  assert.ok(made > 30, "the sweep added only " + made + " bars");
});

// A line of seven quarters, with no meter: the bar after it has two rests.
const SEVEN = ["X:1", "L:1/4", "K:C", "C D E F G A B | c d |"].join("\n");

// The check every bar added passes, on its own: what it is handed is where
// the bar was asked for (the plan addBar makes: the voice, where in its
// line, and how long the rest is to last), and it lets through the bar put
// there and nothing else.
test("the check a bar added passes lets the bar through where it was asked, and stops one of another length, in another place, or anything else changed", () => {
  // The first barline of the owner's first line is element 2 of its voice.
  const plan = [{ key: "0/0", kind: "after", last: 2, length: 0.5 }];
  const check = (after) => MDM_BARS.verifyAdd(ABCJS, OWNER, after, 0, plan, "0/0");
  const right = OWNER.replace("C D |", "C D | z2 |");
  assert.equal(check(right), null);
  assert.equal(check(OWNER.replace("C D |", "C D | z3 |")), "addUnsafe", "a rest of another length");
  assert.equal(check(OWNER.replace("E F |", "E F | z2 |")), "addUnsafe", "a bar in another place");
  assert.equal(check(OWNER.replace("C D |", "C D | x2 |")), "addUnsafe", "a rest nobody sees");
  assert.equal(check(OWNER.replace("C D |", "C D | z2 ||")), "addUnsafe", "a barline of another kind");
  assert.equal(check(right.replace("E F", "E G")), "addUnsafe", "a note changed");
  assert.equal(check(right.replace("G A |", "G A | z2 |")), "addUnsafe", "a second bar");
  assert.equal(check(right.replace("E F |\n", "E F | ")), "addUnsafe", "two lines made one");
  // A line break moved along with the bar: every voice reads the same, and
  // only the lines tell it, as they tell a move (verify).
  assert.equal(check(right.replace("E F |\nG A |", "E F | G A |\n")), "addUnsafe", "a line break moved");
  // A bar of several rests: the rests of the plan, in their order.
  const partials = [{ key: "0/0", kind: "after", last: 7, length: 1.75, rests: [1, 0.75] }];
  const bars = (after) => MDM_BARS.verifyAdd(ABCJS, SEVEN, after, 0, partials, "0/0");
  assert.equal(bars(SEVEN.replace("B |", "B | z4 z3 |")), null);
  assert.equal(bars(SEVEN.replace("B |", "B | z3 z4 |")), "addUnsafe", "the rests in another order");
  assert.equal(bars(SEVEN.replace("B |", "B | z7 |")), "addUnsafe", "one rest for two");
  assert.equal(bars(SEVEN.replace("B |", "B | z4 z2 |")), "addUnsafe", "rests short of the bar");
  assert.equal(bars(SEVEN.replace("B |", "B | z4 C3 |")), "addUnsafe", "a note among the rests");
  // A bar left open: the barline first, and the rests after it.
  const unbarred = "X:1\nL:1/4\nK:C\nC D E F";
  const open = [{ key: "0/0", kind: "open", last: 3, length: 1 }];
  const opened = (after) => MDM_BARS.verifyAdd(ABCJS, unbarred, after, 0, open, "0/0");
  assert.equal(opened(unbarred + " | z4"), null);
  assert.equal(opened(unbarred + " z4 |"), "addUnsafe", "the rest before the barline");
  assert.equal(opened(unbarred + " | z4 |"), "addUnsafe", "a barline more");
});

// ---------- A note written ----------

function write(source, needle, note, nth) {
  let at = -1;
  for (let i = 0; i <= (nth || 0); i++) at = source.indexOf(needle, at + 1);
  assert.ok(at >= 0, "no " + needle + " in the fixture");
  return MDM_BARS.writeNote(ABCJS, source, at, note);
}

// The music of a fixture written on one line, its last, and a result's.
const lastLine = (out) => {
  assert.equal(out.refused, undefined, "refused: " + out.refused);
  return out.source.split("\n").pop();
};
const COMMON = "X:1\nM:4/4\nL:1/8\nK:C\n";
const JIG = "X:1\nM:6/8\nL:1/8\nK:D\n";
const WALTZ = "X:1\nM:3/4\nL:1/4\nK:G\n";
const WHOLE = 1;
const HALF = 1 / 2;
const QUARTER = 1 / 4;
const EIGHTH = 1 / 8;
const SIXTEENTH = 1 / 16;

// The notes and rests of a score, voice by voice in the order they are
// read, each with where it is written: the places a cursor of the score
// mode stands on, but for the rests abcjs does not draw.
function places(source) {
  const tune = ABCJS.parseOnly(source)[0];
  const voices = {};
  tune.lines.forEach((line) => {
    (line.staff || []).forEach((staff, s) => {
      (staff.voices || []).forEach((voice, v) => {
        const list = voices[s + "/" + v] || (voices[s + "/" + v] = []);
        voice.forEach((el) => {
          if (el.el_type === "note") list.push(el);
        });
      });
    });
  });
  return voices;
}

// The owner's call of 2026-10-04: "al marcar 3 sale la negra y el compás
// queda incompleto". Until then what the note left of the rest stayed
// behind it, as the rests a musician would write, and the bar kept its
// length.
test("a note written on a rest takes the rest's place whole, whatever the two last, and leaves nothing behind it", () => {
  const bar = COMMON + "z8 |";
  const quarter = write(bar, "z8", { step: 6, duration: QUARTER });
  assert.equal(lastLine(quarter), "B2 |");
  // Where the note is in the new source, for the cursor to be put on it.
  assert.equal(quarter.source.slice(quarter.at, quarter.at + 2), "B2");
  assert.equal(quarter.duration, QUARTER);
  assert.equal(lastLine(write(bar, "z8", { step: 6, duration: EIGHTH })), "B |");
  assert.equal(lastLine(write(bar, "z8", { step: 6, duration: SIXTEENTH })), "B/2 |");
  assert.equal(lastLine(write(bar, "z8", { step: 6, duration: HALF })), "B4 |");
  assert.equal(lastLine(write(bar, "z8", { step: 6, duration: 3 / 8 })), "B3 |");
  assert.equal(lastLine(write(bar, "z8", { step: 6, duration: WHOLE })), "B8 |");
  // The rests after it are nobody's to take, and stay as they were written:
  // where the note is shorter than its rest, and where it is longer.
  assert.equal(lastLine(write(COMMON + "B2 z2 z4 |", "z2", { step: 7, duration: EIGHTH })), "B2 c z4 |");
  assert.equal(lastLine(write(COMMON + "B2 z2 z4 |", "z2", { step: 7, duration: HALF })), "B2 c4 z4 |");
  // Written against the note after it, it stays written against it.
  assert.equal(lastLine(write(COMMON + "z2d2 z4 |", "z2", { step: 7, duration: EIGHTH })), "cd2 z4 |");
  // An eighth beside one of its beat is beamed to it.
  assert.equal(lastLine(write(COMMON + "B z3 z4 |", "z3", { step: 7, duration: EIGHTH })), "Bc z4 |");
  // Whatever the meter counts in.
  assert.equal(lastLine(write(WALTZ + "z3 |", "z3", { step: 6, duration: QUARTER })), "B |");
  assert.equal(lastLine(write(JIG + "z6 |", "z6", { step: 5, duration: EIGHTH })), "A |");
  assert.equal(lastLine(write(JIG + "z6 |", "z6", { step: 5, duration: 3 / 8 })), "A3 |");
  // `Z`, a bar of rest by its other name, is written over as `z8` is.
  assert.equal(lastLine(write(COMMON + "Z |", "Z", { step: 4, duration: QUARTER })), "G2 |");
  assert.equal(lastLine(write(COMMON + "Z |", "Z", { step: 4, duration: WHOLE })), "G8 |");
  assert.equal(write(COMMON + "Z2 |", "Z2", { step: 4, duration: QUARTER }).refused, "noteUnsafe");
});

// A run of rests written over one after the other: a note on a place, then
// on the place after it, and so on.
function typed(source, steps, duration) {
  let at = source.lastIndexOf("\n") + 1;
  steps.forEach((step, i) => {
    const out = MDM_BARS.writeNote(ABCJS, source, at, { step: step, duration: duration });
    assert.equal(out.refused, undefined, "note " + i + " refused: " + out.refused);
    source = out.source;
    const list = places(source)["0/0"];
    const here = list.findIndex((el) => el.startChar <= out.at && out.at < el.endChar);
    at = list[Math.min(here + 1, list.length - 1)].startChar;
  });
  return source.split("\n").pop();
}

test("typed one after another, notes shorter than a quarter are written together within a beat and apart across it", () => {
  assert.equal(typed(COMMON + "z z z z z z z z |", [0, 1, 2, 3, 4, 5, 6, 7], EIGHTH), "CD EF GA Bc |");
  assert.equal(typed(JIG + "z z z z z z |", [0, 1, 2, 3, 4, 5], EIGHTH), "CDE FGA |");
  assert.equal(typed("X:1\nM:2/4\nL:1/8\nK:C\nz/2 z/2 z/2 z/2 z/2 z/2 z/2 z/2 |", [0, 1, 2, 3, 4, 5, 6, 7], SIXTEENTH), "C/2D/2E/2F/2 G/2A/2B/2c/2 |");
  // Quarters are written apart, as they were going to be drawn anyway, and
  // so is an eighth from the quarter that shares its dotted beat.
  assert.equal(typed(COMMON + "z2 z2 z2 z2 |", [0, 1, 2, 3], QUARTER), "C2 D2 E2 F2 |");
  assert.equal(lastLine(write(JIG + "A2 z z3 |", "z", { step: 6, duration: EIGHTH })), "A2 B z3 |");
  assert.equal(lastLine(write(JIG + "z B2 z3 |", "z", { step: 5, duration: EIGHTH })), "A B2 z3 |");
  // A note between two of its beat is written against both, and a rest
  // between two notes keeps them apart.
  assert.equal(lastLine(write(COMMON + "C z z2 z4 |", "z", { step: 1, duration: EIGHTH })), "CD z2 z4 |");
  assert.equal(lastLine(write(COMMON + "z D z2 z4 |", "z", { step: 0, duration: EIGHTH })), "CD z2 z4 |");
  assert.equal(lastLine(write(COMMON + "C z E z z4 |", "z", { step: 1, duration: EIGHTH })), "CD E z z4 |");
  // A head put on a note keeps the spacing the note was written with.
  assert.equal(lastLine(write(COMMON + "C D E F z4 |", "D", { step: 4 })), "C [DG] E F z4 |");
  // Not against a note of a tuplet, whose beam is its own.
  assert.equal(lastLine(write(COMMON + "C/D/ z z2 z4 |", "z z2", { step: 7, duration: EIGHTH })), "C/D/c z2 z4 |");
  assert.equal(lastLine(write(COMMON + "(3C/D/E/ z z2 z4 |", "z z2", { step: 7, duration: EIGHTH })), "(3C/D/E/ c z2 z4 |");
});

test("the step is the one on the staff: the pitch written is the one the clef in force draws there", () => {
  // The second space of a bass staff is the C under middle C.
  assert.equal(lastLine(write("X:1\nM:3/4\nL:1/4\nK:G clef=bass\nz3 |", "z3", { step: 5, duration: QUARTER })), "C, |");
  assert.equal(lastLine(write("X:1\nM:3/4\nL:1/4\nK:G clef=bass\nz3 |", "z3", { step: 12, duration: QUARTER })), "C |");
  // The middle line of an alto staff is middle C.
  assert.equal(lastLine(write("X:1\nM:3/4\nL:1/4\nK:C clef=alto\nz3 |", "z3", { step: 6, duration: QUARTER })), "C |");
  // A clef changed inside the line is the clef from there on.
  const changed = "X:1\nM:4/4\nL:1/4\nK:C\nz4 | [K:bass] z4 |";
  assert.equal(lastLine(write(changed, "z4", { step: 6, duration: WHOLE })), "B4 | [K:bass] z4 |");
  assert.equal(lastLine(write(changed, "z4", { step: 6, duration: WHOLE }, 1)), "z4 | [K:bass] D,4 |");
  // And a head put on a chord in the bass, at the step of its own clef.
  assert.equal(lastLine(write("X:1\nM:3/4\nL:1/4\nK:G clef=bass\nC, z z |", "C,", { step: 9 })), "[C,G,] z z |");
  // Out on ledger lines, both ways, and every octave's own way of writing.
  const steps = { "-7": "C,", "-1": "B,", 0: "C", 6: "B", 7: "c", 13: "b", 14: "c'", 21: "c''" };
  Object.keys(steps).forEach((step) => {
    assert.equal(lastLine(write(COMMON + "z8 |", "z8", { step: Number(step), duration: WHOLE })), steps[step] + "8 |", "step " + step);
  });
});

// The owner's calls of 2026-10-03, "Deja que el usuario pueda modificar el
// compás aunque termine pasado o por debajo", and of the day after: "Si se
// alarga o se encoge, todo lo demás queda igual, el tiempo no se lo debe
// quitar a nadie. Es responsabilidad del usuario corregir su compás". Until
// the first a figure the bar had no time for was refused ("No room in this
// bar"); until the second a place made longer took the rests after it.
test("a place written on takes time from nothing beside it: the rests and the notes after it stay, and the bar is that much longer or shorter", () => {
  // A note written on a rest, longer than it: the rests after it stay.
  assert.equal(lastLine(write(COMMON + "B2 z2 z4 |", "z2", { step: 8, duration: HALF })), "B2 d4 z4 |");
  assert.equal(lastLine(write(COMMON + "B2 z2 z2 z2 |", "z2", { step: 8, duration: HALF })), "B2 d4 z2 z2 |");
  assert.equal(lastLine(write(COMMON + "B2 z2 z4 |", "z2", { step: 8, duration: WHOLE })), "B2 d8 z4 |");
  // A note made longer leaves them the same, a rest beside it or a note.
  assert.equal(lastLine(write(COMMON + "B2 z2 z4 |", "B2", { step: 6, duration: HALF })), "B4 z2 z4 |");
  assert.equal(lastLine(write(COMMON + "B2 c2 d4 |", "B2", { step: 8, duration: HALF })), "[Bd]4 c2 d4 |");
  assert.equal(lastLine(write(COMMON + "z2 c2 z4 |", "z2", { step: 8, duration: HALF })), "d4 c2 z4 |");
  // Whatever the rest after it is: one with a chord symbol on it, one
  // nobody sees.
  assert.equal(lastLine(write(COMMON + 'z4 "G"z4 |', "z4", { step: 6, duration: WHOLE })), 'B8 "G"z4 |');
  assert.equal(lastLine(write(COMMON + "z4 x4 |", "z4", { step: 6, duration: WHOLE })), "B8 x4 |");
  // A bar too long is written in as any other.
  assert.equal(lastLine(write(COMMON + "C8 z2 |", "z2", { step: 6, duration: EIGHTH })), "C8 B |");
  assert.equal(lastLine(write(COMMON + "C8 D z |", "z", { step: 6, duration: QUARTER })), "C8 D B2 |");
  assert.equal(lastLine(write(COMMON + "C8 D2 |", "D2", { step: 1, duration: HALF })), "C8 D4 |");
  // Made short again, the note gives the bar back its length.
  const long = write(COMMON + "C2 D2 E2 F2 |", "F2", { step: 3, duration: HALF });
  assert.equal(lastLine(long), "C2 D2 E2 F4 |");
  assert.equal(lastLine(MDM_BARS.writeNote(ABCJS, long.source, long.at, { step: 3, duration: QUARTER })), "C2 D2 E2 F2 |");
});

test("a note made longer leaves its bar that much longer, the notes and rests after it coming later, with a meter or with none", () => {
  // Two eighths in a bar of four quarters: the second may be a quarter, a
  // half, the six eighths left, or a whole note that leaves the bar an
  // eighth too long.
  assert.equal(lastLine(write(COMMON + "C D |", "D", { step: 1, duration: QUARTER })), "C D2 |");
  assert.equal(lastLine(write(COMMON + "C D |", "D", { step: 1, duration: 3 / 4 })), "C D6 |");
  assert.equal(lastLine(write(COMMON + "C D |", "D", { step: 1, duration: WHOLE })), "C D8 |");
  // A full bar grows all the same.
  assert.equal(lastLine(write(COMMON + "C2 D2 E2 F2 |", "F2", { step: 3, duration: HALF })), "C2 D2 E2 F4 |");
  // A bar no barline closes grows the same.
  assert.equal(lastLine(write(COMMON + "C D", "D", { step: 1, duration: HALF })), "C D4");
  // A pickup may be made longer, to a bar and past it.
  assert.equal(lastLine(write(WALTZ + "D | G A B |", "D", { step: 1, duration: HALF })), "D2 | G A B |");
  assert.equal(lastLine(write(WALTZ + "D | G A B |", "D", { step: 1, duration: WHOLE })), "D4 | G A B |");
  // With no meter there is no bar to keep to.
  assert.equal(lastLine(write("X:1\nK:C\nC | z", "z", { step: 4, duration: QUARTER })), "C | G2");
  assert.equal(lastLine(write("X:1\nK:C\nC | z", "z", { step: 4, duration: 2 })), "C | G16");
  // Any place of the bar grows it, and the rest after it is kept, whether
  // the meter left the bar room for the figure or not.
  assert.equal(lastLine(write(COMMON + "C D |", "C D", { step: 0, duration: QUARTER })), "C2 D |");
  assert.equal(lastLine(write(COMMON + "C z D |", "C z", { step: 0, duration: HALF })), "C4 z D |");
  assert.equal(lastLine(write(COMMON + "C z D4 |", "C z", { step: 0, duration: HALF })), "C4 z D4 |");
  assert.equal(lastLine(write(COMMON + "C z D |", "C z", { step: 0, duration: WHOLE })), "C8 z D |");
});

// The owner's asks of 2026-10-02: a head put on a note at another step
// makes a chord of it, and a figure's key on a note puts the head on and
// gives the place its figure; the next evening, a note made shorter leaves
// no rest, and the bar is that much shorter. A head asked for with no
// figure goes on at the place's own length, which is the mode's Enter.
test("a head is put on a note at another step, making a chord, and a figure's key gives the chord its figure and no rest after it", () => {
  const steps = [];
  let source = COMMON + "C2 z2 z4 |";
  // A head with no figure, again and again on the place at the head of
  // the line.
  const enter = (step) => {
    const out = MDM_BARS.writeNote(ABCJS, source, source.lastIndexOf("\n") + 1, { step: step });
    assert.equal(out.refused, undefined, "refused at " + step + ": " + out.refused);
    if (!out.same) source = out.source;
    steps.push(out.same ? "same" : lastLine(out));
    return out;
  };
  enter(2);
  enter(4);
  // At a head it has: nothing, the head being Delete's to take off.
  enter(2);
  enter(0);
  assert.deepEqual(steps, ["[CE]2 z2 z4 |", "[CEG]2 z2 z4 |", "same", "same"]);
  // On a rest it writes a note, with the length asked for or the rest's own.
  assert.equal(lastLine(write(COMMON + "z8 |", "z8", { step: 6, duration: QUARTER })), "B2 |");
  assert.equal(lastLine(write(COMMON + "z2 z2 z4 |", "z2", { step: 6 })), "B2 z2 z4 |");
  // The owner's example: a C quarter, the eighth's key at the step of a G.
  // The bar is an eighth shorter, and left so.
  assert.equal(lastLine(write(COMMON + "C2 z2 z4 |", "C2", { step: 4, duration: EIGHTH })), "[CG] z2 z4 |");
  assert.equal(lastLine(write(COMMON + "C2 D2 E2 F2 |", "C2", { step: 4, duration: EIGHTH })), "[CG] D2 E2 F2 |");
  // A figure's key at a head the place has keeps the head and gives it the
  // figure; the figure it has already is nothing to write.
  assert.equal(lastLine(write(COMMON + "[CG]2 z2 z4 |", "[CG]", { step: 4, duration: EIGHTH })), "[CG] z2 z4 |");
  assert.equal(write(COMMON + "[CG]2 z2 z4 |", "[CG]", { step: 4, duration: QUARTER }).same, true);
  // Made longer again, the bar is as it was.
  assert.equal(lastLine(write(COMMON + "[CG] z2 z4 |", "[CG]", { step: 4, duration: QUARTER })), "[CG]2 z2 z4 |");
  // Where the result says the place is, and what it is.
  const out = write(COMMON + "z2 C2 z4 |", "C2", { step: 2 });
  assert.equal(out.source.slice(out.at, out.at + 6), "[CE]2 ");
  assert.equal(out.rest, false);
  // `off` takes a head off, which is what Delete asks of a chord
  // (takeOut); asked of a place's only head, it leaves a rest as long.
  assert.equal(lastLine(write(COMMON + "[CE]2 z6 |", "[", { step: 0, off: true })), "E2 z6 |");
  const gone = write(COMMON + "C2 z6 |", "C2", { step: 0, off: true });
  assert.deepEqual([lastLine(gone), gone.rest], ["z2 z6 |", true]);
  assert.equal(write(COMMON + "C2 z6 |", "C2", { step: 2, off: true }).same, true);
});

// The owner's call of 2026-10-03: "si hay un silencio y se da enter, la nota
// debe salir con la duración del silencio". The mode's Enter is a head asked
// for with no figure, and on a rest it is a note as long as the rest,
// whatever its length is: the ones no key of a figure says as well.
test("a head with no figure on a rest is a note as long as the rest: a bar's, a dotted one's, `Z`, one no figure says, one in a tuplet or a broken rhythm", () => {
  assert.equal(lastLine(write(COMMON + "z8 | z8 |]", "z8", { step: 6 })), "B8 | z8 |]");
  assert.equal(lastLine(write(COMMON + "c2 z2 z4 |]", "z4", { step: 6 })), "c2 z2 B4 |]");
  assert.equal(lastLine(write(COMMON + "c z3 z4 |]", "z3", { step: 6 })), "c B3 z4 |]");
  assert.equal(lastLine(write(COMMON + "z5 c3 |]", "z5", { step: 6 })), "B5 c3 |]");
  assert.equal(lastLine(write(COMMON + "z7 c |]", "z7", { step: 6 })), "B7 c |]");
  // The length the result names is the rest's, which is the figure the mode
  // keeps after it.
  assert.equal(write(COMMON + "c z3 z4 |]", "z3", { step: 6 }).duration, 3 / 8);
  // An eighth and shorter, beamed to the note beside it in its beat as one
  // written with a figure is.
  assert.equal(lastLine(write(COMMON + "d3 z c>d z2 |]", "z", { step: 6 })), "d3 B c>d z2 |]");
  assert.equal(lastLine(write(COMMON + "c z/ d/ z6 |]", "z/", { step: 6 })), "cB/d/ z6 |]");
  // In a tuplet and in a broken rhythm it keeps the length they give it.
  assert.equal(lastLine(write(COMMON + "(3z2c2d2 z4 |]", "z2", { step: 6 })), "(3B2c2d2 z4 |]");
  assert.equal(lastLine(write(COMMON + "z>c d2 z4 |]", "z", { step: 6 })), "B>c d2 z4 |]");
  // What is written on the rest stays on the note.
  assert.equal(lastLine(write(COMMON + '"Am"z4 !fermata!z4 |]', "z4", { step: 6 }, 1)), '"Am"z4 !fermata!B4 |]');
  // A bar of rest, written as a rest or as `Z`, is a note as long as its
  // meter's bar, in the unit in force.
  assert.equal(lastLine(write(COMMON + "Z | c8 |]", "Z", { step: 6 })), "B8 | c8 |]");
  assert.equal(lastLine(write(WALTZ + "z3 | Z |]", "Z", { step: 6 })), "z3 | B3 |]");
  assert.equal(lastLine(write("X:1\nM:6/8\nL:1/8\nK:C\nz6 | z3 c3 |]", "z6", { step: 6 })), "B6 | z3 c3 |]");
  assert.equal(lastLine(write("X:1\nM:5/4\nL:1/4\nK:C\nz5 | Z |]", "Z", { step: 6 })), "z5 | B5 |]");
  // The step is the staff's, and the clef says which note it is.
  assert.equal(lastLine(write("X:1\nM:4/4\nL:1/4\nK:C clef=bass\nz2 z2 |]", "z2", { step: 6 })), "D,2 z2 |]");
  // Not on the rest of several bars, nor on the one that draws nothing, nor
  // over a verse, which gives the note a syllable and moves the rest of them.
  assert.equal(write(COMMON + "Z2 | c8 |]", "Z2", { step: 6 }).refused, "noteUnsafe");
  assert.equal(write(COMMON + "x4 c4 |]", "x4", { step: 6 }).refused, "noteUnsafe");
  assert.equal(write(COMMON + "c2 z2 z4 |]\nw: la", "z2", { step: 6 }).refused, "noteLyrics");
});

test("a head put on or taken off leaves everything else written on the place where it was, each head as it was written", () => {
  const dressed = COMMON + '"Am"!f!(c2 d2) (3efg z2 |';
  // The slur opens on the chord now, and still closes on the d (abcjs
  // numbers it otherwise for that, which is no change: relabel).
  assert.equal(lastLine(write(dressed, "c2", { step: 9 })), '"Am"!f!([ce]2 d2) (3efg z2 |');
  // A shorter figure: the slur still closes on the note, and the tuplet
  // after it keeps its own beam.
  assert.equal(lastLine(write(dressed, "d2", { step: 8, duration: EIGHTH })), '"Am"!f!(c2 d) (3efg z2 |');
  // A note of a tuplet takes a head and loses one, and takes no other length.
  const head = write(dressed, "fg", { step: 12 });
  assert.equal(lastLine(head), '"Am"!f!(c2 d2) (3e[fa]g z2 |');
  assert.equal(lastLine(MDM_BARS.takeOut(ABCJS, head.source, head.at, 10)), '"Am"!f!(c2 d2) (3eag z2 |');
  assert.equal(write(dressed, "fg", { step: 10, duration: QUARTER }).refused, "noteUnsafe");
  assert.equal(write(dressed, "efg", { step: 9, duration: SIXTEENTH }).refused, "noteUnsafe");
  // The short note of a broken rhythm, by the length abcjs gives it.
  assert.equal(lastLine(write(COMMON + "F>G A2 z4 |", "G", { step: 6 })), "F>[GB] A2 z4 |");
  // Grace notes and a decoration by its name or its letter.
  const ornate = COMMON + "{g}A2 !trill!B2 .c2 z2 |";
  assert.equal(lastLine(write(ornate, "B2", { step: 8 })), "{g}A2 !trill![Bd]2 .c2 z2 |");
  assert.equal(lastLine(write(ornate, "A2", { step: 7 })), "{g}[Ac]2 !trill!B2 .c2 z2 |");
  assert.equal(lastLine(write(ornate, ".c2", { step: 4 })), "{g}A2 !trill!B2 .[Gc]2 z2 |");
  // An accidental stays with its head, and goes with it.
  assert.equal(lastLine(write(COMMON + "^F2 z2 z4 |", "^F", { step: 5 })), "[^FA]2 z2 z4 |");
  assert.equal(lastLine(MDM_BARS.takeOut(ABCJS, COMMON + "[^FA]2 z2 z4 |", COMMON.length, 3)), "A2 z2 z4 |");
  assert.equal(lastLine(write("X:1\nM:4/4\nL:1/8\nK:C\n[_B=E^C]2 z6 |", "[", { step: 4 })), "[^C=EG_B]2 z6 |");
  // A chord is written from its heads up, its length outside the brackets.
  assert.equal(lastLine(write(COMMON + "[e2C2]2 z4 |", "[", { step: 4 })), "[CGe]4 z4 |");
  // What else a chord holds inside its brackets is not written again.
  assert.equal(write(COMMON + "[!1!CE]2 z2 z4 |", "[", { step: 4 }).refused, "noteUnsafe");
});

test("a place that already reads as the note asked for is left as it is, and said to be the same", () => {
  const source = COMMON + "B2 ^c2 z4 |";
  const same = write(source, "B2", { step: 6, duration: QUARTER });
  assert.deepEqual([same.source, same.same, source.slice(same.at, same.at + 2)], [source, true, "B2"]);
  // The note is there, sharp or not: a figure's key at its own head and
  // length rewrites nothing of it, and a head the place has, asked for with
  // no figure, is nothing either, a head being Delete's to take off.
  assert.equal(write(source, "^c2", { step: 7, duration: QUARTER }).same, true);
  assert.equal(write(source, "^c2", { step: 7 }).same, true);
  assert.equal(write(COMMON + "[B^d]2 z6 |", "[", { step: 8 }).same, true);
  assert.equal(write(source, "z4", { rest: true, duration: HALF }).same, true);
  assert.equal(write(source, "z4", { rest: true }).same, true);
  // Another step, or another length, is another place.
  assert.equal(write(source, "B2", { step: 5, duration: QUARTER }).same, undefined);
  assert.equal(write(source, "B2", { step: 6, duration: EIGHTH }).same, undefined);
});

test("a rest is written over a note as over a rest, of the length asked for or the place's own", () => {
  const source = COMMON + "B2 c2 d4 |";
  assert.equal(lastLine(write(source, "c2", { rest: true })), "B2 z2 d4 |");
  assert.equal(lastLine(write(source, "d4", { rest: true })), "B2 c2 z4 |");
  // Shorter than the note, it leaves the bar shorter, as a shorter note does.
  assert.equal(lastLine(write(source, "c2", { rest: true, duration: EIGHTH })), "B2 z d4 |");
  // A rest longer than the place leaves the bar longer, the rests after it
  // kept as a note keeps them.
  assert.equal(lastLine(write(COMMON + "c2 z2 z4 |", "c2", { rest: true, duration: HALF })), "z4 z2 z4 |");
  assert.equal(lastLine(write(source, "c2", { rest: true, duration: HALF })), "B2 z4 d4 |");
  // What was written on the note stays where it was.
  assert.equal(lastLine(write(COMMON + '"Am"c2 (3efg z4 |', "c2", { rest: true })), '"Am"z2 (3efg z4 |');
  assert.equal(lastLine(write(COMMON + '"Am"c2 (3efg z4 |', "fg", { rest: true })), '"Am"c2 (3ezg z4 |');
});

test("a tie on the place, a verse that would shift under it and voices laid over each other are refused, each for its reason", () => {
  const tied = COMMON + "c4- c4 |";
  assert.equal(write(tied, "c4", { step: 2 }).refused, "noteTie");
  assert.equal(write(tied, "c4", { step: 2, duration: HALF }, 1).refused, "noteTie");
  assert.equal(MDM_BARS.takeOut(ABCJS, tied, tied.indexOf("c4"), 7).refused, "noteTie");
  assert.equal(write(tied, "c4", { rest: true }).refused, "noteTie");
  // A syllable goes to every note and to no rest: a head more or less on a
  // note keeps every one where it was, and a rest made a note would move
  // the ones after it. A note made a rest gives its syllable up, the
  // owner's call of 2026-10-15 (the test of what 0 takes from the verses).
  const sung = COMMON + "C2 z2 E2 F2 |\nw: do mi fa";
  assert.equal(write(sung, "C2", { step: 4 }).source, COMMON + "[CG]2 z2 E2 F2 |\nw: do mi fa");
  assert.equal(write(sung, "z2", { step: 4, duration: QUARTER }).refused, "noteLyrics");
  assert.equal(write(sung, "E2", { rest: true }).source, COMMON + "C2 z2 z2 F2 |\nw: do fa");
  // A note taken out takes its syllable with it, and none moves (the test
  // of what the verses give up, below).
  assert.equal(MDM_BARS.takeOut(ABCJS, sung, sung.indexOf("E2"), 2).source, COMMON + "C2 z2 F2 |\nw: do fa");
  assert.equal(write(COMMON + "C2 z2 E2 F2 |\ns: !f! * !p!", "z2", { step: 4, duration: QUARTER }).refused, "noteLyrics");
  assert.equal(write(COMMON + "C2 D2 E2 F2 & c8 |", "D2", { step: 4 }).refused, "noteUnsafe");
  // Nothing to write on at a barline.
  assert.equal(write(COMMON + "C8 |", "|", { step: 4, duration: QUARTER }).refused, "notePlace");
  for (const reason of ["noteTie", "noteLyrics", "notePlace", "noteUnsafe", "noteSlur", "barOnly", "cutAll"]) assertShortReason(reason);
});

test("a note written in one voice leaves every other as it was written", () => {
  const duet = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c G A F | z4 |", "V:2 clef=bass", "C, D, E, F, | z4 |"].join("\n");
  const upper = write(duet, "z4", { step: 6, duration: HALF });
  assert.equal(upper.source, duet.replace("c G A F | z4 |", "c G A F | B2 |"));
  const lower = write(duet, "z4", { step: 6, duration: HALF }, 1);
  assert.equal(lower.source, duet.replace("C, D, E, F, | z4 |", "C, D, E, F, | D,2 |"));
  assert.equal(write(duet, "C,", { step: 9 }).source, duet.replace("C, D, E, F, |", "[C,G,] D, E, F, |"));
  // Marked inline, each on its own line of the text.
  const inline = ["X:1", "M:4/4", "L:1/4", "K:C", "[V:1] z4 |", "[V:2] z4 |"].join("\n");
  assert.equal(write(inline, "z4", { step: 6, duration: QUARTER }, 1).source, inline.replace("[V:2] z4 |", "[V:2] B |"));
});

const NOTE_FIXTURES = {
  OWNER: [OWNER, null],
  PARTIALS: [PARTIALS, null],
  DUET: [DUET, 1],
  SONG: [SONG, 0.75],
  ENDINGS: [ENDINGS, 1],
  tuplets: ["X:1\nL:1/8\nM:2/4\nK:C\n(3CDE F2 | (3GAB c2- |\nc2 (3dcB | A4 |]", 0.5],
  ornaments: ["X:1\nL:1/8\nM:4/4\nK:D\n{g}A2 !trill!B2 z4 | .c .d ~e2 z4 |\n!fermata!f8 | {ag}f4 e4 |]", 1],
  chords: ["X:1\nL:1/8\nM:4/4\nK:C\n[CEG]2 [^FA]2 z4 | ([ce]2 d2) [e2C2]2 z2 |]", 1],
  pickup: ["X:1\nL:1/4\nM:3/4\nK:G\nD | G A B | c2 B |\nA G F | G2 z |]", 0.75],
  rests: ["X:1\nL:1/4\nM:4/4\nK:C\nC D E F | Z |\nG z z2 | z4 |]", 1],
  repeats: ["X:1\nL:1/4\nM:2/4\nK:C\n|: C D | E F :|\n|1 G A | B c :|2 d e | f g |]", 0.5],
  jig: [JIG + "z6 | A z z z3 | ABc z3 |]", 0.75],
  bass: ["X:1\nM:4/4\nL:1/8\nK:F clef=bass\nz8 | F,2 z2 z4 | [K:treble] z8 |]", 1],
  bare: ["C", null],
  unbarred: ["X:1\nL:1/4\nK:C\nC D E F G A B c", null],
  open: ["X:1\nL:1/4\nM:2/4\nK:C\nC D | E F\nG A | B c", 0.5],
  // Bars shorter and longer than their meter, with rests in them: what a
  // note made shorter and one made longer leave behind.
  uneven: ["X:1\nL:1/8\nM:4/4\nK:C\nC z D | E2 z2 F2 z2 G2 |\nz A z2 | c8 z2 |]", 1],
  // Two voices whose bars are one place in one of them and several in the
  // other, or a rest under a note: what a place that is all its bar takes
  // with it.
  apart: ["X:1\nL:1/4\nM:4/4\nK:C\nV:1\nC4 | z4 | E4 | z4 |\nV:2\nC,4 | E,2 G,2 | z4 | z2 z2 |", 1],
};

// The lengths of a voice's bars, by what is written in them (music).
function barSums(list) {
  const sums = [0];
  list.forEach((entry) => {
    if (/^bar /.test(entry)) sums.push(0);
    else sums[sums.length - 1] += Number(entry.split(" ")[/^rest /.test(entry) ? 2 : 1]);
  });
  return sums;
}

// Every place of every fixture, at steps on the staff and off it, with
// every figure and with none (which puts a head on): refused for a
// reason of the engine's, the same already, or that place made what was
// asked and nothing else of the music moved, not a rest beside it. Read
// apart from the module's own check, as the sweeps above are.
test("a sweep of every place, at several steps, with figures and without: refused, or that place as asked and every other where it was", () => {
  const reasons = new Set(["noteTie", "noteLyrics", "noteUnsafe"]);
  let made = 0;
  let refused = 0;
  let chords = 0;
  let over = 0;
  let under = 0;
  Object.keys(NOTE_FIXTURES).forEach((name) => {
    const [source, meter] = NOTE_FIXTURES[name];
    const voices = places(source);
    const was = music(source);
    Object.keys(voices).forEach((key) => {
      voices[key].forEach((el, index) => {
        // Not the rests nobody sees, which are no place of the cursor's.
        if (el.rest && !/^(?:rest|whole|multimeasure)$/.test(el.rest.type)) return;
        const had = el.rest ? [] : el.pitches.map((p) => p.verticalPos);
        [-3, 2, 6, 11].forEach((step) => {
          const asks = [WHOLE, QUARTER, 3 / 8, EIGHTH, SIXTEENTH].map((d) => ({ step: step, duration: d })).concat([{ step: step }]);
          asks.forEach((ask) => {
            const label = [name, key, index, JSON.stringify(ask)].join(" ");
            const out = MDM_BARS.writeNote(ABCJS, source, el.startChar, ask);
            if (out.refused) {
              assert.ok(reasons.has(out.refused), label + ": " + out.refused);
              refused++;
              return;
            }
            if (out.same) {
              assert.equal(out.source, source, label);
              return;
            }
            made++;
            const now = music(out.source);
            assert.deepEqual(Object.keys(now).sort(), Object.keys(was).sort(), label);
            Object.keys(was).forEach((other) => {
              if (other !== key) assert.deepEqual(now[other], was[other], label + ": voice " + other + " changed");
            });
            // The place, where the result says it is: its heads the ones it
            // had with the step put on, and its length the one asked for or
            // its own.
            let heads = had.indexOf(step) < 0 ? had.concat([step]) : had;
            heads = heads.slice().sort((x, y) => x - y);
            const written = places(out.source)[key].filter((e) => e.startChar <= out.at && out.at < e.endChar)[0];
            assert.ok(written, label + ": nothing at " + out.at);
            const length = ask.duration || el.duration;
            assert.ok(Math.abs(written.duration - length) < 1e-9, label + ": it lasts " + written.duration);
            if (!heads.length) {
              assert.ok(written.rest && out.rest, label + ": no rest where the last head went");
            } else {
              assert.deepEqual(written.pitches.map((p) => p.verticalPos).sort((x, y) => x - y), heads, label);
              if (heads.length > 1) chords++;
            }
            // Everything else of the voice as it was, in its order: every
            // note, every rest and every barline.
            const nths = was[key].map((entry, i) => i).filter((i) => !/^bar /.test(was[key][i]));
            assert.equal(now[key].length, was[key].length, label + ": an entry more or less");
            was[key].forEach((entry, i) => {
              if (i !== nths[index]) assert.equal(now[key][i], entry, label + ": entry " + i + " changed");
            });
            // Every bar as long as it was, but the one written in, which is
            // longer or shorter by what the place is, and by nothing else.
            const sums = barSums(was[key]);
            const own = was[key].slice(0, nths[index]).filter((entry) => /^bar /.test(entry)).length;
            barSums(now[key]).forEach((sum, bar) => {
              const expected = sums[bar] + (bar === own ? length - el.duration : 0);
              assert.ok(Math.abs(sum - expected) < 1e-9, label + ": bar " + bar + " is " + sum + ", not " + expected);
              if (bar === own && sum > Math.max(meter === null ? 0 : meter, sums[bar]) + 1e-9) over++;
              if (bar === own && sum < sums[bar] - 1e-9) under++;
            });
          });
        });
      });
    });
  });
  assert.ok(made > 4800, "the sweep wrote only " + made + " places");
  assert.ok(chords > 4000, "the sweep made only " + chords + " chords");
  assert.ok(refused > 150, "the sweep met only " + refused + " refusals");
  assert.ok(over > 1200, "the sweep left only " + over + " bars longer than their meter");
  assert.ok(under > 1800, "the sweep left only " + under + " bars shorter than they were");
});

// The check every note written passes, on its own: what it is handed is the
// plan writeNote makes (the voice, the place, and the heads and the length
// it is to have), and it lets through that and nothing else.
test("the check a note written passes lets the place through as asked, and stops another head, another length, a place more or less, or anything else changed", () => {
  const before = COMMON + "z8 | C8 |\nD8 |";
  const plan = { key: "0/0", s: 0, first: 0, heads: [{ step: 6, name: null }], length: 0.25 };
  const check = (line, with_) => MDM_BARS.verifyNote(ABCJS, before, before.replace("z8 |", line), with_ || plan);
  assert.equal(check("B2 |"), null);
  assert.equal(check("c2 |"), "noteUnsafe", "another step");
  assert.equal(check("B4 |"), "noteUnsafe", "another length");
  assert.equal(check("B2 z2 |"), "noteUnsafe", "a rest left after it");
  assert.equal(check("z2 B2 |"), "noteUnsafe", "a rest left before it");
  assert.equal(check("[Bd]2 |"), "noteUnsafe", "a head more");
  assert.equal(check("z2 |"), "noteUnsafe", "a rest for the note");
  assert.equal(check("B2 | z8 |"), "noteUnsafe", "a bar more");
  assert.equal(check("B2 ||"), "noteUnsafe", "the barline after it changed");
  assert.equal(MDM_BARS.verifyNote(ABCJS, before, before.replace("z8 |", "B2 |") + " [P:X]", plan), "noteUnsafe", "a part marked after the last barline");
  assert.equal(MDM_BARS.verifyNote(ABCJS, before, before.replace("z8 |", "B2 |").replace("C8", "E8"), plan), "noteUnsafe", "the bar after it changed");
  assert.equal(MDM_BARS.verifyNote(ABCJS, before, before.replace("z8 |", "B2 |").replace("|\nD8", "| D8"), plan), "noteUnsafe", "two lines made one");
  // A rest asked for: no heads.
  const rest = Object.assign({}, plan, { heads: [] });
  assert.equal(check("z2 |", rest), null);
  assert.equal(check("B2 |", rest), "noteUnsafe", "a note for the rest");
  assert.equal(check("x2 |", rest), "noteUnsafe", "a rest nobody sees for the rest");
  // A chord: every head at its step, and the heads kept as they were written.
  const sharp = COMMON + "[^CE]2 z6 |";
  const chord = { key: "0/0", s: 0, first: 0, heads: [{ step: 0, name: "^C" }, { step: 2, name: "E" }, { step: 4, name: null }], length: 0.25 };
  const chordCheck = (line) => MDM_BARS.verifyNote(ABCJS, sharp, sharp.replace("[^CE]2", line), chord);
  assert.equal(chordCheck("[^CEG]2"), null);
  assert.equal(chordCheck("[CEG]2"), "noteUnsafe", "a head kept but written otherwise");
  assert.equal(chordCheck("[^CG]2"), "noteUnsafe", "a head lost");
  assert.equal(chordCheck("[^CEA]2"), "noteUnsafe", "the new head at another step");
  // The rest after the place is no part of it: taken, it is a place gone.
  const two = COMMON + "z2 z2 C4 |";
  const longer = { key: "0/0", s: 0, first: 0, heads: [{ step: 6, name: null }], length: 0.5 };
  assert.equal(MDM_BARS.verifyNote(ABCJS, two, COMMON + "B4 z2 C4 |", longer), null);
  assert.equal(MDM_BARS.verifyNote(ABCJS, two, COMMON + "B4 C4 |", longer), "noteUnsafe", "the rest after it taken");
});

// ---------- A place put in ----------

// A rest of a length, or with `step` a note of it at that step of the staff.
function insert(source, needle, length, side, step, nth) {
  let at = -1;
  for (let i = 0; i <= (nth || 0); i++) at = source.indexOf(needle, at + 1);
  assert.ok(at >= 0, "no " + needle + " in the fixture");
  const what = typeof step === "number" ? { step: step, duration: length } : { rest: true, duration: length };
  return MDM_BARS.insertPlace(ABCJS, source, at, what, side);
}

// The owner's asks of 2026-10-02 and of the day after: Ctrl and Alt with a
// figure's key put a note of it in before the place and after it, and with
// 0 a rest, in the same bar. Their own example: `[CE]` in quarters, the
// cursor at the step of a G, and Alt+4.
test("a note put in goes after the place or before it at the step asked, of the figure asked, and the bar is that much longer", () => {
  const out = insert(COMMON + "[CE]2 z6 |", "[CE]", EIGHTH, "after", 4);
  assert.equal(lastLine(out), "[CE]2 G z6 |");
  assert.equal(out.source.slice(out.at).trim().slice(0, 2), "G ");
  assert.equal(lastLine(insert(COMMON + "C2 D2 |", "D2", QUARTER, "before", 4)), "C2 G2 D2 |");
  // Longer than the meter: it is time put in, and the bar keeps it.
  assert.equal(lastLine(insert(COMMON + "C8 |", "C8", WHOLE, "after", 4)), "C8 G8 |");
  // In the unit in force, at the step of the clef in force, in one voice.
  assert.equal(lastLine(insert("X:1\nM:4/4\nL:1/4\nK:C\nC D E F |", "C D", SIXTEENTH, "after", 4)), "C G/4 D E F |");
  assert.equal(lastLine(insert("X:1\nM:4/4\nL:1/8\nK:C clef=bass\nC,2 z6 |", "C,2", QUARTER, "after", 5)), "C,2 C,2 z6 |");
  const duet = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "C D E F |", "V:2", "C, D, E, F, |"].join("\n");
  assert.equal(insert(duet, "D,", QUARTER, "after", 6).source, duet.replace("C, D, E,", "C, D, B E,"));
  // Eighths put in one after the other are written together within a beat
  // and apart across it, as the ones written on rests are.
  assert.equal(lastLine(insert(COMMON + "[CE]2 G z6 |", "G z6", EIGHTH, "after", 5)), "[CE]2 GA z6 |");
  assert.equal(lastLine(insert(COMMON + "[CE]2 GA z6 |", "A z6", EIGHTH, "after", 6)), "[CE]2 GA B z6 |");
  assert.equal(lastLine(insert(COMMON + "C2 A z5 |", "A z5", EIGHTH, "before", 4)), "C2 GA z5 |");
  assert.equal(lastLine(insert(COMMON + "CD z6 |", "D z6", EIGHTH, "before", 4)), "CG D z6 |");
  assert.equal(lastLine(insert(COMMON + "CD z6 |", "D z6", EIGHTH, "after", 4)), "CD G z6 |");
  // Not against a note with something written between the two, in its own
  // beat as it is: the close of a slur after the one before it, a chord
  // symbol on the one after it. Nor against a note of a tuplet, whose beam
  // is its own, nor a quarter against anything.
  assert.equal(lastLine(insert(COMMON + "(C2 D) z5 |", "D)", EIGHTH, "after", 4)), "(C2 D) G z5 |");
  assert.equal(lastLine(insert(COMMON + 'C2 "Am"D z5 |', '"Am"', EIGHTH, "before", 4)), 'C2 G "Am"D z5 |');
  assert.equal(lastLine(insert(COMMON + "(3D/E/F/ z7 |", "F/", EIGHTH, "after", 4)), "(3D/E/F/ G z7 |");
  assert.equal(lastLine(insert(COMMON + 'C "Am"D z6 |', "C ", EIGHTH, "after", 4)), 'CG "Am"D z6 |');
  assert.equal(lastLine(insert(COMMON + "CD z6 |", "D z6", QUARTER, "before", 4)), "C G2 D z6 |");
});

test("a rest put in goes after the place or before it, in the same bar, set apart from both, and the bar is that much longer", () => {
  const four = COMMON + "C2 D2 E2 F2 |";
  const after = insert(four, "C2", QUARTER, "after");
  assert.equal(lastLine(after), "C2 z2 D2 E2 F2 |");
  assert.equal(after.source.slice(after.at).trim().slice(0, 2), "z2");
  assert.equal(lastLine(insert(four, "D2", QUARTER, "before")), "C2 z2 D2 E2 F2 |");
  assert.equal(lastLine(insert(COMMON + "C8 |", "C8", WHOLE, "after")), "C8 z8 |");
  assert.equal(lastLine(insert(COMMON + "C8 |", "C8", 3 / 8, "before")), "z3 C8 |");
  // Out of a beam, on either side.
  assert.equal(lastLine(insert(COMMON + "CDEF z4 |", "DEF", EIGHTH, "after")), "CD z EF z4 |");
  assert.equal(lastLine(insert(COMMON + "CDEF z4 |", "CDEF", EIGHTH, "before")), "z CDEF z4 |");
  assert.equal(lastLine(insert(COMMON + "CDEF z4 |", "DEF", EIGHTH, "before")), "C z DEF z4 |");
  // After what is written after the place, before what is written on it.
  const dressed = COMMON + '"Am"!f!(c2 d2) z4 |';
  assert.equal(lastLine(insert(dressed, '"Am"', QUARTER, "before")), 'z2 "Am"!f!(c2 d2) z4 |');
  assert.equal(lastLine(insert(dressed, "d2", QUARTER, "after")), '"Am"!f!(c2 d2) z2 z4 |');
  assert.equal(lastLine(insert(COMMON + "(3CDE z6 |", "(3", EIGHTH, "before")), "z (3CDE z6 |");
  assert.equal(lastLine(insert(COMMON + "(3CDE z6 |", "E z6", EIGHTH, "after")), "(3CDE z z6 |");
  // The last place of a bar, before its barline; a line marked with its voice.
  assert.equal(insert(COMMON + "C2 D2 |\nE8 |", "D2", QUARTER, "after").source, COMMON + "C2 D2 z2 |\nE8 |");
  const marked = ["X:1", "M:4/4", "L:1/4", "K:C", "[V:1] C D E F |", "[V:2] C, D, E, F, |"].join("\n");
  assert.equal(insert(marked, "C D", QUARTER, "before").source, marked.replace("[V:1] C", "[V:1] z C"));
  assert.equal(lastLine(insert("X:1\nM:4/4\nL:1/4\nK:C\nC D E F |", "C D", HALF, "after")), "C z2 D E F |");
  // A rest takes no syllable, and a verse stays on its notes; but a `*`
  // takes a rest as a note, and one before the C would give the C the b.
  assert.equal(insert(COMMON + "C2 D2 |\nw: a b", "C2", QUARTER, "after").source, COMMON + "C2 z2 D2 |\nw: a b");
  assert.equal(insert(COMMON + "C2 D2 |\nw: * b", "C2", QUARTER, "before").refused, "noteLyrics");
});

test("a place that would cut a tie, go into a tuplet, pair with a broken rhythm, shift a verse, or go into one of two voices laid over each other, is not put in", () => {
  assert.equal(insert(COMMON + "c4- c4 |", "c4-", QUARTER, "after").refused, "noteTie");
  assert.equal(insert(COMMON + "c4- c4 |", "c4 |", QUARTER, "before", 4).refused, "noteTie");
  // On the side the tie is not, it goes in.
  assert.equal(lastLine(insert(COMMON + "c4- c4 |", "c4-", QUARTER, "before")), "z2 c4- c4 |");
  assert.equal(insert(COMMON + "(3CDE z6 |", "DE", EIGHTH, "after").refused, "noteUnsafe");
  assert.equal(insert(COMMON + "(3CDE z6 |", "E z6", EIGHTH, "before", 4).refused, "noteUnsafe");
  assert.equal(insert(COMMON + "C>D z6 |", "C>", EIGHTH, "after", 4).refused, "noteUnsafe");
  assert.equal(insert(COMMON + "C>D z6 |", "D z6", EIGHTH, "before").refused, "noteUnsafe");
  // A syllable goes to every note: one more would take the next one's.
  assert.equal(insert(COMMON + "C2 D2 |\nw: a b", "C2", QUARTER, "after", 4).refused, "noteLyrics");
  assert.equal(insert(COMMON + "C2 D2 & c4 |", "C2", QUARTER, "after").refused, "noteUnsafe");
  assert.equal(insert(COMMON + "C8 | D8 |", "|", QUARTER, "after", 4).refused, "notePlace");
});

// Every place of every fixture, a rest and a note at a step off the staff
// and at one on it, of several lengths, after it and before it: refused for
// a reason of the engine's, or the voice as it was with that place beside
// it, every other voice as it was, and every line with the bars it had.
test("a sweep of every place, a rest or a note after it and before it: refused, or that place there and nothing else", () => {
  const reasons = new Set(["noteTie", "noteLyrics", "noteUnsafe"]);
  let rests = 0;
  let notes = 0;
  let refused = 0;
  Object.keys(NOTE_FIXTURES).forEach((name) => {
    const [source] = NOTE_FIXTURES[name];
    const voices = places(source);
    const was = music(source);
    Object.keys(voices).forEach((key) => {
      voices[key].forEach((el, index) => {
        if (el.rest && !/^(?:rest|whole|multimeasure)$/.test(el.rest.type)) return;
        const entry = was[key].map((e, i) => i).filter((i) => !/^bar /.test(was[key][i]))[index];
        for (const side of ["after", "before"]) {
          for (const step of [null, -3, 6]) {
            for (const length of [WHOLE, QUARTER, 3 / 8, SIXTEENTH]) {
              const label = [name, key, index, side, step, length].join(" ");
              const what = step === null ? { rest: true, duration: length } : { step: step, duration: length };
              const result = MDM_BARS.insertPlace(ABCJS, source, el.startChar, what, side);
              if (result.refused) {
                assert.ok(reasons.has(result.refused), label + ": " + result.refused);
                refused++;
                continue;
              }
              const now = music(result.source);
              Object.keys(was).forEach((other) => {
                if (other !== key) assert.deepEqual(now[other], was[other], label + ": voice " + other + " changed");
              });
              const y = side === "after" ? entry + 1 : entry;
              assert.deepEqual(now[key].slice(0, y).concat(now[key].slice(y + 1)), was[key], label);
              assert.deepEqual(layout(result.source), layout(source), label);
              // The place itself, where the result says it is.
              const put = places(result.source)[key].filter((e) => e.startChar <= result.at && result.at < e.endChar)[0];
              assert.ok(put, label + ": nothing at " + result.at);
              assert.ok(Math.abs(put.duration - length) < 1e-9, label + ": it lasts " + put.duration);
              if (step === null) {
                assert.ok(put.rest && /^(?:rest|whole)$/.test(put.rest.type), label + ": no rest");
                rests++;
              } else {
                assert.deepEqual([!!put.rest, put.pitches.map((p) => p.verticalPos)], [false, [step]], label);
                notes++;
              }
            }
          }
        }
      });
    });
  });
  assert.ok(rests > 1000, "the sweep put in only " + rests + " rests");
  assert.ok(notes > 2000, "the sweep put in only " + notes + " notes");
  assert.ok(refused > 500, "the sweep met only " + refused + " refusals");
});

// The check every place put in passes, on its own.
test("the check a place put in passes lets that place through where it was asked, and stops one of another length, at another step, in another place, or anything else changed", () => {
  const before = COMMON + "C2 D2 E2 F2 |";
  const plan = { key: "0/0", s: 0, first: 0, side: "after", length: QUARTER, step: null };
  const check = (after, with_) => MDM_BARS.verifyInsert(ABCJS, before, after, with_ || plan);
  assert.equal(check(COMMON + "C2 z2 D2 E2 F2 |"), null);
  assert.equal(check(COMMON + "z2 C2 D2 E2 F2 |"), "noteUnsafe", "before it");
  assert.equal(check(COMMON + "z2 C2 D2 E2 F2 |", Object.assign({}, plan, { side: "before" })), null);
  assert.equal(check(COMMON + "C2 z D2 E2 F2 |"), "noteUnsafe", "another length");
  assert.equal(check(COMMON + "C2 x2 D2 E2 F2 |"), "noteUnsafe", "a rest nobody sees");
  assert.equal(check(COMMON + "C2 G2 D2 E2 F2 |"), "noteUnsafe", "a note");
  assert.equal(check(COMMON + "C2 z2 z2 D2 E2 F2 |"), "noteUnsafe", "two rests");
  assert.equal(check(COMMON + "C2 z2 | D2 E2 F2 |"), "noteUnsafe", "a bar more");
  assert.equal(check(COMMON + "C2 z2 D2 E2 G2 |"), "noteUnsafe", "a note changed");
  assert.equal(check(COMMON + "C2 z2\nD2 E2 F2 |"), "noteUnsafe", "a line broken");
  // A note asked for: one head, at the step.
  const note = Object.assign({}, plan, { step: 4 });
  assert.equal(check(COMMON + "C2 G2 D2 E2 F2 |", note), null);
  assert.equal(check(COMMON + "C2 A2 D2 E2 F2 |", note), "noteUnsafe", "another step");
  assert.equal(check(COMMON + "C2 [GB]2 D2 E2 F2 |", note), "noteUnsafe", "a head more");
  assert.equal(check(COMMON + "C2 z2 D2 E2 F2 |", note), "noteUnsafe", "a rest for the note");
  assert.equal(check(COMMON + "C2 G D2 E2 F2 |", note), "noteUnsafe", "another length");
});

// ---------- Music pasted ----------

// One voice pasted into, at the place written `needle`: "on" it, or "after".
function paste(source, needle, text, where, nth) {
  let at = -1;
  for (let i = 0; i <= (nth || 0); i++) at = source.indexOf(needle, at + 1);
  assert.ok(at >= 0, "no " + needle + " in the fixture");
  return MDM_BARS.pasteMusic(ABCJS, source, [{ at: at, text: text, where: where || "on" }]);
}
// What the cursor is put on after it: the text from there.
const cursorOn = (result, length) => (result.after[0] < 0 ? "" : result.source.slice(result.after[0], result.after[0] + (length || 2)));

// The owner's ask of 2026-10-04: "implementa el pegar". A note is never
// cut: the music goes in beside it, on the side the caller names. The mode
// asked for the side before the cursor's note until 2026-10-06, and asks
// for the side after it since (webview-score-mode.test.js, SM81).
test("music pasted on a note goes in before it, set apart from it, and the bar is that much longer; after an element, it goes after it", () => {
  const bar = COMMON + "C2 D2 E2 F2 |";
  const mid = paste(bar, "E2", "g a");
  assert.equal(lastLine(mid), "C2 D2 g a E2 F2 |");
  // The cursor's place is the note it stood on, which comes after the music.
  assert.equal(cursorOn(mid), "E2");
  const head = paste(bar, "C2", "g a");
  assert.deepEqual([lastLine(head), cursorOn(head)], ["g a C2 D2 E2 F2 |", "C2"]);
  // Written against the note before it, the music is given a space.
  assert.equal(lastLine(paste(COMMON + "C2D2 E2 F2 |", "D2", "g")), "C2 g D2 E2 F2 |");
  // After the last element of a voice no barline closes, and there is
  // nothing after it for the cursor.
  const end = paste(COMMON + "C2 D2", "D2", "e2 f2", "after");
  assert.deepEqual([lastLine(end), end.after[0]], ["C2 D2 e2 f2", -1]);
  assert.equal(lastLine(paste(COMMON + "C2 D2 |", "C2", "e2", "after")), "C2 e2 D2 |");
  // Set apart from what was written against the element.
  assert.equal(lastLine(paste(COMMON + "C2D2 |", "C2", "e2", "after")), "C2 e2 D2 |");
  // The lines of a copy cut by the end of a line are one run of music.
  assert.equal(lastLine(paste(bar, "E2", "g a |\n  b")), "C2 D2 g a | b E2 F2 |");
  // Everything written on the music comes with it.
  assert.equal(lastLine(paste(bar, "E2", '"G7"!f!c2 {d}e2 (3fga')), 'C2 D2 "G7"!f!c2 {d}e2 (3fga E2 F2 |');
  // With no meter there is nothing to count, and the music goes in the same.
  assert.equal(lastLine(paste("X:1\nK:C\nC D E F", "E", "c d")), "C D c d E F");
});

// The owner's call of 2026-10-04: "Copiar sobre un silencio funciona igual
// que copiar sobre una nota". For half a day a rest gave the music its time,
// counted against the meter.
test("music pasted on a rest goes in before it as before a note, and the rest stays with everything written on it", () => {
  const empty = COMMON + "z8 | z8 |]";
  const whole = paste(empty, "z8", "d4 B4");
  assert.equal(lastLine(whole), "d4 B4 z8 | z8 |]");
  // The cursor's place is the rest it stood on, which comes after the music.
  assert.equal(cursorOn(whole), "z8");
  assert.equal(lastLine(paste(empty, "z8", "c2")), "c2 z8 | z8 |]");
  assert.equal(lastLine(paste(JIG + "z6 | z6 |]", "z6", "A B")), "A B z6 | z6 |]");
  // Shorter than the rest, as long, or longer: nothing is counted.
  const quarter = COMMON + "C2 z2 z4 |";
  assert.equal(lastLine(paste(quarter, "z2", "d")), "C2 d z2 z4 |");
  assert.equal(lastLine(paste(quarter, "z2", "d2 e2 f2 g2")), "C2 d2 e2 f2 g2 z2 z4 |");
  // What is written on the rest stays on it, and `Z` is a rest like another,
  // of one bar or of several.
  assert.equal(lastLine(paste(COMMON + '"Am"z8 | c8 |]', "z8", "c8")), 'c8 "Am"z8 | c8 |]');
  assert.equal(lastLine(paste(COMMON + "Z | c8 |]", "Z", "d4")), "d4 Z | c8 |]");
  assert.equal(lastLine(paste(COMMON + "Z2 | c8 |]", "Z2", "d4")), "d4 Z2 | c8 |]");
  // Music with barlines of its own brings its bars.
  assert.equal(lastLine(paste(empty, "z8", "d4 B4 | c2 A2 B2 G2 |")), "d4 B4 | c2 A2 B2 G2 | z8 | z8 |]");
  // Before a rest that opens a tuplet or a broken rhythm, which stay whole.
  assert.equal(lastLine(paste(COMMON + "(3z2c2d2 z4 |", "z2", "e2 f2")), "e2 f2 (3z2c2d2 z4 |");
  assert.equal(lastLine(paste(COMMON + "z>c d2 z4 |", "z", "e")), "e z>c d2 z4 |");
  // And before a rest nobody sees, a place of the text like any other.
  assert.equal(lastLine(paste(COMMON + "C2 x2 E2 |", "x2", "c")), "C2 c x2 E2 |");
  // With no meter it is the same.
  assert.equal(lastLine(paste("X:1\nL:1/4\nK:C\nC z4 D", "z4", "e")), "C e z4 D");
});

test("music that would change what it is pasted beside is not pasted, nor a text that is no music, each for its reason", () => {
  const bar = COMMON + "C2 D2 E2 F2 |";
  // A broken rhythm left open pairs with the note after it, a tuplet short
  // of its notes takes it in, a tie ties into it.
  assert.equal(paste(bar, "E2", "c>").refused, "noteUnsafe");
  assert.equal(paste(bar, "E2", "(3cd").refused, "noteUnsafe");
  assert.equal(paste(bar, "E2", "E2-").refused, "noteUnsafe");
  // A key written inside it would be the key of everything after.
  assert.equal(paste(bar, "E2", "[K:D]c").refused, "noteUnsafe");
  // A slur it opens and does not close, or closes and did not open; one it
  // opens and closes goes in, whatever slurs the voice has after it.
  assert.equal(paste(bar, "E2", "(c d").refused, "noteSlur");
  assert.equal(paste(bar, "E2", "c d)").refused, "noteSlur");
  assert.equal(lastLine(paste(COMMON + "C2 (D2 E2) F2 |", "C2", "(c d)")), "(c d) C2 (D2 E2) F2 |");
  assert.equal(lastLine(paste(COMMON + "(C2 D2) (E2 F2) |", "E2", "(c d)", "on", 0)), "(C2 D2) (c d) (E2 F2) |");
  // A tie that reaches the place from the note before it would be cut.
  assert.equal(paste(COMMON + "C2 D2- D2 F2 |", "D2 F2", "c").refused, "noteTie");
  assert.equal(paste(COMMON + "C2 D2- D2 F2 |", "D2-", "c", "after").refused, "noteTie");
  // The syllables of a verse would move along.
  assert.equal(paste(bar + "\nw: la la la la", "E2", "c").refused, "noteLyrics");
  // Voices laid over each other share the bar's time, which is not counted.
  assert.equal(paste(COMMON + "C2 D2 & E2 F2 |", "D2", "c").refused, "noteUnsafe");
  // Text that is no music: abcjs warns of it, or reads no note in it.
  assert.equal(paste(bar, "E2", "hello world").refused, "pasteText");
  assert.equal(paste(bar, "E2", "|").refused, "pasteText");
  assert.equal(paste(bar, "E2", "   ").refused, "pasteNothing");
  assert.equal(MDM_BARS.pasteMusic(ABCJS, bar, []).refused, "pasteNothing");
  // No place there.
  assert.equal(MDM_BARS.pasteMusic(ABCJS, bar, [{ at: 2, text: "c", where: "on" }]).refused, "notePlace");
});

test("several voices are pasted into at once, each at its own place, and every other voice is left as it was written", () => {
  const duet = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | z4 |]", "V:2 clef=bass", "C,4 | z4 |]", "V:3", "E4 | E4 |]"].join("\n");
  const pastes = [
    { at: duet.indexOf("z4"), text: "g a b c'", where: "on" },
    { at: duet.lastIndexOf("z4"), text: "G,2 C,2", where: "on" },
  ];
  const result = MDM_BARS.pasteMusic(ABCJS, duet, pastes);
  assert.equal(result.source, duet.replace("c d e f | z4", "c d e f | g a b c' z4").replace("C,4 | z4", "C,4 | G,2 C,2 z4"));
  // Where the cursor goes in each, in the source as it is now: the rest
  // pasted before.
  assert.deepEqual(result.after.map((at) => result.source.slice(at, at + 2)), ["z4", "z4"]);
  assert.ok(result.after[0] < result.after[1]);
  // In whatever order they are asked for.
  assert.equal(MDM_BARS.pasteMusic(ABCJS, duet, pastes.slice().reverse()).source, result.source);
  // One of them refused, and nothing is pasted.
  assert.equal(MDM_BARS.pasteMusic(ABCJS, duet, [pastes[0], { at: pastes[1].at, text: "(G,2 C,2", where: "on" }]).refused, "noteSlur");
  // A voice written in pieces between the lines of another.
  const woven = ["X:1", "M:2/4", "L:1/4", "K:C", "V:1", "c d |", "V:2", "E F |", "V:1", "e f |", "V:2", "G A |"].join("\n");
  const both = MDM_BARS.pasteMusic(ABCJS, woven, [
    { at: woven.indexOf("e f"), text: "g", where: "on" },
    { at: woven.indexOf("G A"), text: "B", where: "on" },
  ]);
  assert.equal(both.source, woven.replace("e f", "g e f").replace("G A", "B G A"));
  assert.deepEqual(both.after.map((at) => both.source.slice(at, at + 1)), ["e", "G"]);
});

test("the text to paste is read as parts: the music under each V: for that voice, music with none over it for the cursor's, and nothing else", () => {
  assert.deepEqual(MDM_BARS.clipParts("d e f | g"), [{ voice: null, text: "d e f | g" }]);
  // As the mode's copy writes several voices.
  assert.deepEqual(MDM_BARS.clipParts("V:S\nd2 B2\nV:T\nG,2 D,2"), [
    { voice: "S", text: "d2 B2" },
    { voice: "T", text: "G,2 D,2" },
  ]);
  // The lines of one voice are one run, whatever ends them, and a V: with
  // nothing under it is no part.
  assert.deepEqual(MDM_BARS.clipParts("c d e f |\r\n  g a\n"), [{ voice: null, text: "c d e f | g a" }]);
  assert.deepEqual(MDM_BARS.clipParts("V:1\n\nV:2 clef=bass\nC, D,"), [{ voice: "2", text: "C, D," }]);
  // Music before the first V: is the cursor's.
  assert.deepEqual(MDM_BARS.clipParts("c d\nV:2\nE F"), [
    { voice: null, text: "c d" },
    { voice: "2", text: "E F" },
  ]);
  // A tune, a verse or a directive is not music to put in at a place.
  for (const text of ["X:1\nK:C\nc d", "c d\nw: la la", "%%score 1 2\nc", "% a comment", "V:\nc"]) assert.deepEqual(MDM_BARS.clipParts(text), { refused: "pasteText" }, text);
  for (const text of ["", "  \n ", "V:1\n", null]) assert.deepEqual(MDM_BARS.clipParts(text), { refused: "pasteNothing" }, String(text));
});

test("the unit a place's lengths are counted in is read at the head of its line: the tune's L:, a voice's own, or the one the meter gives", () => {
  const unit = (source, needle) => MDM_BARS.unitAt(ABCJS, source, source.lastIndexOf(needle));
  assert.equal(unit(COMMON + "C2 D2 E2 F2 |", "E2"), 1 / 8);
  assert.equal(unit(WALTZ + "G A B |", "A"), 1 / 4);
  // With no L: the meter says: an eighth from 3/4 up, a sixteenth under it.
  assert.equal(unit("X:1\nM:4/4\nK:C\nC2 D2 |", "D2"), 1 / 8);
  assert.equal(unit("X:1\nM:2/4\nK:C\nC2 D2 |", "D2"), 1 / 16);
  assert.equal(unit("C", "C"), 1 / 8);
  // A voice with a unit of its own, and a voice named inline.
  const two = "X:1\nM:4/4\nL:1/8\nK:C\nV:1\nC2 D2 |\nV:2\nL:1/4\nE F |";
  assert.deepEqual([unit(two, "D2"), unit(two, "F")], [1 / 8, 1 / 4]);
  assert.equal(unit("X:1\nM:4/4\nL:1/8\nK:C\n[V:1] C>D (3EFG |\n[V:2] c4 |", "(3EFG"), 1 / 8);
  // Past the mark of the voice, where the line is the second voice's: before
  // it the rest read would be the first's.
  assert.equal(unit("X:1\nM:4/4\nL:1/8\nK:C\n[V:1] c4 |\n[V:2] C2 D2 |", "D2"), 1 / 8);
  // The line's, where the unit changes inside it: the next line has the new.
  const inline = COMMON + "C2 | [L:1/16] D2 E2 |\nF2 G2 |";
  assert.deepEqual([unit(inline, "E2"), unit(inline, "G2")], [1 / 8, 1 / 16]);
  // No place there, no unit.
  assert.equal(MDM_BARS.unitAt(ABCJS, COMMON + "C2 |", 2), null);
});

// Every place of every fixture, several pieces of music on it and after it:
// refused for a reason of the engine's, or the voice as it was with the
// music put in at the place and nothing gone, every other voice as it was.
// Read apart from the module's own check, as the sweeps above are.
test("a sweep of every place, music pasted on it and after it: refused, or the music there and everything else where it was", () => {
  const reasons = new Set(["noteTie", "noteLyrics", "noteUnsafe", "noteSlur"]);
  const pieces = ["c", "c2 d2", "c4 | d4", "z", "(3cde", '"G"c8', "(c d)", "x2 c"];
  // What each piece reads as, by itself, in the order music() lists a voice.
  const counts = { c: 1, "c2 d2": 2, "c4 | d4": 3, z: 1, "(3cde": 3, '"G"c8': 1, "(c d)": 2, "x2 c": 2 };
  let made = 0;
  let rests = 0;
  let refused = 0;
  Object.keys(NOTE_FIXTURES).forEach((name) => {
    const [source] = NOTE_FIXTURES[name];
    const voices = places(source);
    const was = music(source);
    Object.keys(voices).forEach((key) => {
      const entries = was[key].map((e, i) => i).filter((i) => !/^bar /.test(was[key][i]));
      voices[key].forEach((el, index) => {
        for (const where of ["on", "after"]) {
          for (const piece of pieces) {
            const label = [name, key, index, where, piece].join(" ");
            const result = MDM_BARS.pasteMusic(ABCJS, source, [{ at: el.startChar, text: piece, where: where }]);
            if (result.refused) {
              assert.ok(reasons.has(result.refused), label + ": " + result.refused);
              refused++;
              continue;
            }
            const now = music(result.source);
            Object.keys(was).forEach((other) => {
              if (other !== key) assert.deepEqual(now[other], was[other], label + ": voice " + other + " changed");
            });
            // The voice as it was, in order, with the piece's own entries
            // put in at the place and nothing gone, a rest no more than a
            // note.
            const entry = entries[index];
            const y = where === "after" ? entry + 1 : entry;
            const k = counts[piece];
            assert.deepEqual(now[key].slice(0, y), was[key].slice(0, y), label + ": before the place");
            assert.deepEqual(now[key].slice(y + k), was[key].slice(y), label + ": after the music");
            if (el.rest && where === "on") rests++;
            made++;
          }
        }
      });
    });
  });
  assert.ok(made > 2800, "the sweep pasted only " + made + " times");
  assert.ok(rests > 200, "the sweep pasted before only " + rests + " rests");
  assert.ok(refused > 400, "the sweep met only " + refused + " refusals");
});

// The check every paste passes, on its own: what it is handed is the plan
// pasteMusic makes (the voice, the place the music goes before or after,
// the elements that go, and whether there is music to put in), and it lets
// through that and nothing else.
test("the check a paste passes lets the music through where it was asked, without what was to go, and stops anything else", () => {
  const before = COMMON + "C2 z2 z4 | (D2 E2) |";
  const plan = { key: "0/0", s: 0, first: 1, side: "before", gone: [], music: true };
  const check = (after, with_) => MDM_BARS.verifyPaste(ABCJS, before, after, Object.assign({}, plan, with_ || {}));
  // Before the rest, and where the element after the music begins.
  const put = COMMON + "C2 g a z2 z4 | (D2 E2) |";
  assert.deepEqual(check(put), { after: put.indexOf("z2") });
  assert.equal(check(COMMON + "C2 g | a z2 z4 | (D2 E2) |").refused, undefined);
  // After it, and not where it was not asked.
  const behind = COMMON + "C2 z2 g a z4 | (D2 E2) |";
  assert.deepEqual(check(behind, { side: "after" }), { after: behind.indexOf("z4") });
  assert.equal(check(put, { side: "after" }).refused, "noteUnsafe");
  // In the place of what goes: a rest, a note, a barline with them.
  const over = COMMON + "C2 g a z4 | (D2 E2) |";
  assert.deepEqual(check(over, { gone: [{ s: 0, e: 1 }] }), { after: over.indexOf("z4") });
  assert.equal(check(COMMON + "g a z2 z4 | (D2 E2) |", { first: 0, gone: [{ s: 0, e: 0 }] }).refused, undefined);
  assert.equal(check(COMMON + "C2 g a | (D2 E2) |", { gone: [{ s: 0, e: 1 }, { s: 0, e: 2 }] }).refused, undefined);
  assert.equal(check(COMMON + "C2 g a (D2 E2) |", { gone: [{ s: 0, e: 1 }, { s: 0, e: 2 }, { s: 0, e: 3 }] }).refused, undefined);
  // Something went that was not to.
  assert.equal(check(over).refused, "noteUnsafe");
  // With no music to put in, what goes goes and nothing comes.
  const cut = COMMON + "C2 z4 | (D2 E2) |";
  assert.deepEqual(check(cut, { gone: [{ s: 0, e: 1 }], music: false }), { after: cut.indexOf("z4") });
  assert.equal(check(over, { gone: [{ s: 0, e: 1 }], music: false }).refused, "noteUnsafe");
  // Nothing put in where music was to come, or no note in it.
  assert.equal(check(before).refused, "pasteText");
  assert.equal(check(cut, { gone: [{ s: 0, e: 1 }] }).refused, "pasteText");
  assert.equal(check(COMMON + "C2 | z2 z4 | (D2 E2) |").refused, "pasteText");
  // A slur of its own, closed, leaves the one after it as it was but for
  // its name; left open it is refused, and so is anything else changed.
  assert.equal(check(COMMON + "C2 (g a) z2 z4 | (D2 E2) |").refused, undefined);
  assert.equal(check(COMMON + "C2 (g a z2 z4 | (D2 E2) |").refused, "noteSlur");
  assert.equal(check(COMMON + "C2 g a z2 z4 | (D2 F2) |").refused, "noteUnsafe");
  assert.equal(check(COMMON + "C2 g a z2 z4 | D2 E2 |").refused, "noteUnsafe");
  // Half a slur among what goes, or half a tie, read off what goes.
  const slurred = { gone: [{ s: 0, e: 4 }], music: false };
  assert.equal(check(COMMON + "C2 z2 z4 | E2) |", slurred).refused, "noteSlur");
  const tied = COMMON + "C2- C2 D4 |";
  assert.equal(MDM_BARS.verifyPaste(ABCJS, tied, COMMON + "C2 D4 |", { key: "0/0", s: 0, first: 0, side: "before", gone: [{ s: 0, e: 0 }], music: false }).refused, "noteTie");
  assert.equal(MDM_BARS.verifyPaste(ABCJS, tied, COMMON + "C2- D4 |", { key: "0/0", s: 0, first: 1, side: "before", gone: [{ s: 0, e: 1 }], music: false }).refused, "noteTie");
  assert.equal(MDM_BARS.verifyPaste(ABCJS, tied, COMMON + "D4 |", { key: "0/0", s: 0, first: 0, side: "before", gone: [{ s: 0, e: 0 }, { s: 0, e: 1 }], music: false }).refused, undefined);
  // A line broken, or the music on two lines, with everything else on the
  // line it was on.
  assert.equal(check(COMMON + "C2 g a z2 z4 |\n(D2 E2) |").refused, "noteUnsafe");
  assert.equal(check(COMMON + "C2 g\na z2 z4 | (D2 E2) |").refused, "noteUnsafe");
  const twoLines = COMMON + "C2 z2 |\nD2 E2 |";
  const head = { key: "0/0", s: 1, first: 0, side: "before", gone: [], music: true };
  assert.equal(MDM_BARS.verifyPaste(ABCJS, twoLines, COMMON + "C2 z2 |\ng a D2 E2 |", head).refused, undefined);
  assert.equal(MDM_BARS.verifyPaste(ABCJS, twoLines, COMMON + "C2 z2 | g\na D2 E2 |", head).refused, "noteUnsafe");
  // A warning of abcjs's the score did not have.
  assert.equal(check(COMMON + "C2 g ? a z2 z4 | (D2 E2) |").refused, "pasteText");
  // Another voice changed.
  const two = (upper, lower) => COMMON + "V:1\n" + upper + "\nV:2\n" + lower;
  const pair = { key: "0/0", s: 0, first: 1, side: "before", gone: [], music: true };
  assert.equal(MDM_BARS.verifyPaste(ABCJS, two("C2 z2 |", "E4 |"), two("C2 g z2 |", "E4 |"), pair).refused, undefined);
  assert.equal(MDM_BARS.verifyPaste(ABCJS, two("C2 z2 |", "E4 |"), two("C2 g z2 |", "F4 |"), pair).refused, "noteUnsafe");
});

// ---------- A stretch taken out, and music put in its place ----------

// Where the music of a fixture begins, past its header.
const bodyOf = (source) => (/^K:.*$/m.test(source) ? source.indexOf("\n", source.search(/^K:/m)) + 1 : 0);

// A stretch of one voice, named as the mode names it: line by line, each
// slice from where the place written `from` begins to where the one written
// `to` ends (the first of each in the music, or the `nth`).
function slicesOf(source, slices) {
  return slices.map(([from, to, nth]) => {
    let a = bodyOf(source) - 1;
    for (let i = 0; i <= (nth || 0); i++) a = source.indexOf(from, a + 1);
    assert.ok(a >= 0, "no " + from + " in the fixture");
    const b = source.indexOf(to, a);
    assert.ok(b >= 0, "no " + to + " after " + from);
    return { from: a, to: b + to.length };
  });
}

// The stretch taken out, or with `text` music put in its place.
function over(source, slices, text) {
  return MDM_BARS.pasteMusic(ABCJS, source, [{ over: slicesOf(source, slices), text: text === undefined ? null : text }]);
}
const body = (result) => {
  assert.equal(result.refused, undefined, "refused: " + result.refused);
  return result.source.slice(bodyOf(result.source));
};

// The owner's call of 2026-10-04 for Delete with a stretch chosen: "se borra
// toda la selección", and the bar is as it comes out.
test("a stretch taken out goes with everything written between its ends, the notes on either side left apart as they were", () => {
  const two = COMMON + "C2 D2 E2 F2 | G2 A2 B2 c2 |";
  const mid = over(two, [["D2", "E2"]]);
  assert.equal(body(mid), "C2 F2 | G2 A2 B2 c2 |");
  // Where the place that took its place begins, for the cursor.
  assert.equal(cursorOn(mid), "F2");
  // One place is a stretch, a note or a rest.
  assert.equal(body(over(two, [["D2", "D2"]])), "C2 E2 F2 | G2 A2 B2 c2 |");
  assert.equal(body(over(COMMON + "C2 z2 E2 F2 |", [["z2", "z2"]])), "C2 E2 F2 |");
  // Across a barline, the barline goes with it and the two bars are one.
  assert.equal(body(over(two, [["E2", "A2"]])), "C2 D2 B2 c2 |");
  // What is written on its places goes with them.
  assert.equal(body(over(COMMON + 'C2 "Am"!f!D2 {g}E2 F2 |', [['"Am"', "E2"]])), "C2 F2 |");
  // A slur, a tie or a tuplet that is all inside it goes with it.
  assert.equal(body(over(COMMON + "C2 (D2 E2) F2 |", [["(D2", "E2)"]])), "C2 F2 |");
  assert.equal(body(over(COMMON + "C2 D2- D2 F2 |", [["D2-", "- D2"]])), "C2 F2 |");
  assert.equal(body(over(COMMON + "C2 (3DEF G2 z2 |", [["(3D", "F"]])), "C2 G2 z2 |");
  // Notes written together stay together, the ones it kept apart stay
  // apart, and no space is left double.
  assert.equal(body(over(COMMON + "CDEF G4 |", [["D", "E"]])), "CF G4 |");
  assert.equal(body(over(COMMON + "CD EF G4 |", [["D", "E"]])), "C F G4 |");
  assert.equal(body(over(COMMON + "C D E F G4 |", [["D", "E"]])), "C F G4 |");
  assert.equal(body(over(COMMON + "CD E FG A2 z |", [["E", "E"]])), "CD FG A2 z |");
  assert.equal(body(over(COMMON + "C2 |D2 E2 F2 |", [["D2", "D2"]])), "C2 | E2 F2 |");
  // At the end of a line the space before it goes too, and at its head the
  // space after it.
  assert.equal(body(over(COMMON + "C2 D2 E2\nF2 |", [["D2", "E2"]])), "C2\nF2 |");
  assert.equal(body(over(COMMON + "C2 D2 E2 F2\nG8 |", [["C2", "D2"]])), "E2 F2\nG8 |");
});

test("a stretch that is whole bars takes them with one of their barlines, and a line that is all inside it goes whole", () => {
  const four = COMMON + "C8 | D2 D2 D2 D2 | E8 | F8 |";
  assert.equal(body(over(four, [["D2", "D2 D2 D2 D2"]])), "C8 | E8 | F8 |");
  const bars = over(four, [["D2", "E8"]]);
  assert.equal(body(bars), "C8 | F8 |");
  assert.equal(cursorOn(bars, 4).trim(), "F8");
  // From the head of a line, to its end, and the barline that says more
  // than a plain one stays, the one before the bars going in its place.
  assert.equal(body(over(four, [["C8", "D2 D2 D2 D2"]])), "E8 | F8 |");
  assert.equal(body(over(four, [["E8", "F8"]])), "C8 | D2 D2 D2 D2 |");
  assert.equal(body(over(COMMON + "C8 | D8 | E8 |]", [["D8", "E8"]])), "C8 |]");
  assert.equal(body(over(COMMON + "C8 | D8 :| E8 |", [["D8", "D8"]])), "C8 :| E8 |");
  // A bar no barline closes goes alone.
  assert.equal(body(over(COMMON + "C8 | D8", [["D8", "D8"]])), "C8 |");
  // A repeat on either side of them, or a field written inline in one, and
  // they stay.
  assert.equal(over(COMMON + "C8 |: D8 :| E8 |", [["D8", "D8"]]).refused, "noteUnsafe");
  assert.equal(over(COMMON + "C8 | [K:G] D8 | E8 |", [["D8", "D8"]]).refused, "noteUnsafe");
  // Over several lines: the end of the first, the head of the last, and
  // every line between them whole. What is left of the last comes up to
  // the first, which had two bars (the bars after a cut come up, below).
  const lines = COMMON + "C8 | D8 |\nE8 | F8 |\nG8 | A8 |";
  assert.equal(body(over(lines, [["D8", "D8"], ["E8", "F8"], ["G8", "G8"]])), "C8 | A8 |");
  assert.equal(body(over(lines, [["E8", "F8"]])), "C8 | D8 |\nG8 | A8 |");
  assert.equal(body(over(lines, [["G8", "A8"]])), "C8 | D8 |\nE8 | F8 |");
  // A stretch that ends inside a bar leaves that bar what is left of it.
  assert.equal(body(over(COMMON + "C8 | D4 E4 |\nF4 G4 | A8 |", [["E4", "E4"], ["F4", "F4"]])), "C8 | D4 |\nG4 | A8 |");
  // The voice keeps something to stand on.
  assert.equal(over(COMMON + "C8 | D8 |]", [["C8", "D8"]]).refused, "cutAll");
  assert.equal(over(lines, [["C8", "D8"], ["E8", "F8"], ["G8", "A8"]]).refused, "cutAll");
  // A rest nobody sees is no place to stand on.
  assert.equal(over(COMMON + "C8 | x8 |", [["C8", "C8"]]).refused, "cutAll");
  assert.equal(body(over(COMMON + "C8 | x8 | D8 |", [["C8", "C8"]])), "x8 | D8 |");
  assert.equal(MDM_BARS.reasonText("cutAll"), "Nothing would be left");
});

// ---------- The bars after a cut come up ----------

// The bars of every voice on each of its lines, read apart from the module:
// a bar is closed by a barline with a note or a rest before it, and what
// follows the last barline is one more.
function barsBy(source) {
  const tune = ABCJS.parseOnly(source)[0];
  const voices = {};
  tune.lines.forEach((line) => {
    (line.staff || []).forEach((staff, s) => {
      (staff.voices || []).forEach((voice, v) => {
        let bars = 0;
        let seen = false;
        voice.forEach((el) => {
          if (el.el_type === "note") seen = true;
          if (el.el_type === "bar" && seen) {
            bars++;
            seen = false;
          }
        });
        if (bars + (seen ? 1 : 0) > 0) (voices[s + "/" + v] || (voices[s + "/" + v] = [])).push(bars + (seen ? 1 : 0));
      });
    });
  });
  return voices;
}

// The line of a voice one of its places is written on, counted among the
// lines the voice has places on (`list`, from places()).
function lineIn(source, list, el) {
  const lineOf = (e) => source.slice(0, e.startChar).split("\n").length;
  const lines = [];
  list.forEach((e) => {
    if (lines.indexOf(lineOf(e)) < 0) lines.push(lineOf(e));
  });
  return lines.indexOf(lineOf(el));
}

// When the synth begins the note or rest written at `needle` (the first in
// the music, or the `nth`), in whole notes.
function soundsAt(source, needle, nth) {
  let at = bodyOf(source) - 1;
  for (let i = 0; i <= (nth || 0); i++) at = source.indexOf(needle, at + 1);
  assert.ok(at >= 0, "no " + needle + " in the fixture");
  const played = ABCJS.parseOnly(source)[0].setUpAudio({ chordsOff: true });
  let start = null;
  played.tracks.forEach((track) => {
    track.forEach((event) => {
      if (event.cmd === "note" && event.startChar <= at && at < event.endChar && start === null) start = event.start;
    });
  });
  assert.notEqual(start, null, "nothing sounds at " + needle);
  return start;
}

// The owner's call of 2026-10-06: "si elimino un compás entero seleccionado
// con delete los compases que van delante deben venir a ocupar su lugar".
// On its own line they did, the text closing over what went; the line was
// left a bar short, and the bars of the lines below stayed below.
const FOUR_LINES = COMMON + "C8 | D8 |\nE8 | F8 |\nG8 | A8 |\nB8 | c8 |]";

test("the bars after a stretch taken out come up from the lines below: every line keeps the bars it had, down to the last, which is the one left shorter", () => {
  const second = over(FOUR_LINES, [["D8", "D8"]]);
  assert.equal(body(second), "C8 | E8 |\nF8 | G8 |\nA8 | B8 |\nc8 |]");
  assert.deepEqual(layout(second.source), [2, 2, 2, 1]);
  // The same music as the cut made, with nothing but its lines moved.
  assert.deepEqual(music(second.source), music(COMMON + "C8 |\nE8 | F8 |\nG8 | A8 |\nB8 | c8 |]"));
  // The cursor's place is the bar that came into the place of the one that
  // went, now on its line.
  assert.equal(cursorOn(second, 3).trim(), "E8");
  // The first bar of a line, and a bar of a line further down.
  assert.equal(body(over(FOUR_LINES, [["C8", "C8"]])), "D8 | E8 |\nF8 | G8 |\nA8 | B8 |\nc8 |]");
  assert.equal(body(over(FOUR_LINES, [["F8", "F8"]])), "C8 | D8 |\nE8 | G8 |\nA8 | B8 |\nc8 |]");
  // The last line has no line to take from, and the barline that ends the
  // tune stays where it ends.
  assert.equal(body(over(FOUR_LINES, [["B8", "B8"]])), "C8 | D8 |\nE8 | F8 |\nG8 | A8 |\nc8 |]");
  assert.equal(body(over(FOUR_LINES, [["c8", "c8"]])), "C8 | D8 |\nE8 | F8 |\nG8 | A8 |\nB8 |]");
  // A line that goes whole leaves every other with the bars it had: nothing
  // comes up, the lines below are a line higher as they are.
  assert.equal(body(over(FOUR_LINES, [["E8", "F8"]])), "C8 | D8 |\nG8 | A8 |\nB8 | c8 |]");
  // A line with as many bars as are wanted of it comes up whole, and there
  // is a line less.
  assert.equal(body(over(FOUR_LINES, [["D8", "D8"], ["E8", "E8"]])), "C8 | F8 |\nG8 | A8 |\nB8 | c8 |]");
  const three = COMMON + "C8 | D8 | E8 |\nF8 | G8 |\nA8 | B8 |";
  assert.equal(body(over(three, [["D8", "E8"]])), "C8 | F8 | G8 |\nA8 | B8 |");
  // One with fewer comes up whole and the line after it gives the rest; it
  // is that line that is left short.
  const lone = COMMON + "C8 | D8 | E8 |\nF8 |\nG8 | A8 |";
  assert.equal(body(over(lone, [["D8", "E8"]])), "C8 | F8 | G8 |\nA8 |");
  // It is the bars that are counted, whatever went: the halves of two bars,
  // with the barline between them, leave one bar where there were two.
  const halves = COMMON + "C4 D4 | E4 F4 |\nG8 | A8 |";
  assert.equal(body(over(halves, [["D4", "E4"]])), "C4 F4 | G8 |\nA8 |");
  // A stretch inside a bar leaves the line every bar it had, and nothing
  // comes up.
  assert.equal(body(over(halves, [["D4", "D4"]])), "C4 | E4 F4 |\nG8 | A8 |");
  // Music put in the place of a stretch brings no bar up: the line is as
  // the music leaves it (the owner's "el compás queda como quede").
  assert.equal(body(over(FOUR_LINES, [["D8", "D8"]], "c4 d4")), "C8 | c4 d4 |\nE8 | F8 |\nG8 | A8 |\nB8 | c8 |]");
  assert.equal(body(over(halves, [["D4", "E4"]], "c4")), "C4 c4 F4 |\nG8 | A8 |");
});

test("where the bars cannot come up the cut is made all the same, and the line above stays short: a title between two lines, a line no barline ends", () => {
  // A title keeps the lines of two parts apart: nothing crosses it, and
  // past it the lines of the second part close up among themselves.
  const titled = COMMON + "C8 | D8 |\nT:Second part\nE8 | F8 |\nG8 | A8 |]";
  assert.equal(body(over(titled, [["C8", "C8"]])), "D8 |\nT:Second part\nE8 | F8 |\nG8 | A8 |]");
  assert.equal(body(over(titled, [["E8", "E8"]])), "C8 | D8 |\nT:Second part\nF8 | G8 |\nA8 |]");
  // A line no barline ends runs on into the next: the bar that is on both
  // is not taken apart, and the bars stop coming at the line before it.
  const running = COMMON + "C8 | D8 |\nE8 | F4\nG4 | A8 |]";
  assert.equal(body(over(running, [["C8", "C8"]])), "D8 | E8 |\nF4\nG4 | A8 |]");
  // Line breaks the text says for itself are not this module's to move.
  const broken = "X:1\n%%linebreak $\nM:4/4\nL:1/8\nK:C\nC8 | D8 |\nE8 | F8 |";
  assert.equal(body(over(broken, [["D8", "D8"]])), "C8 |\nE8 | F8 |");
  // A key between two lines goes up with the bar it was written before, so
  // that the bar is read under it still; and a verse with its bar.
  const keyed = COMMON + "C8 | D8 |\nK:G\nF8 | G8 |\nA8 | B8 |]";
  const up = over(keyed, [["D8", "D8"]]);
  assert.equal(body(up), "C8 | [K:G]F8 |\nG8 | A8 |\nB8 |]");
  assert.deepEqual(music(up.source), music(COMMON + "C8 |\nK:G\nF8 | G8 |\nA8 | B8 |]"));
  const sung = COMMON + "C8 | D8 |\nE8 | F8 |\nw: mi fa\nG8 | A8 |]\nw: sol la";
  const verse = over(sung, [["D8", "D8"]]);
  assert.equal(verse.refused, undefined, "refused: " + verse.refused);
  assert.deepEqual(layout(verse.source), [2, 2, 1]);
  assert.deepEqual(music(verse.source), music(COMMON + "C8 |\nE8 | F8 |\nw: mi fa\nG8 | A8 |]\nw: sol la"));
});

test("a bar taken out of one voice brings that voice's bars up alone, and out of every voice, every voice's together; the lines then begin together in the sound as they do on the page", () => {
  const duet = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c4 | d4 | e4 |", "f4 | g4 | a4 |]", "V:2 clef=bass", "C,4 | D,4 | E,4 |", "F,4 | G,4 | A,4 |]"].join("\n");
  const cut = (source, voices) => MDM_BARS.pasteMusic(ABCJS, source, voices.map((v) => ({ over: slicesOf(source, v), text: null })));
  // The upper voice alone: its bars come up, the lower keeps its lines.
  const one = cut(duet, [[["d4", "d4"]]]);
  assert.equal(one.refused, undefined, "refused: " + one.refused);
  assert.equal(one.source, duet.replace("c4 | d4 | e4 |\nf4 | g4 | a4 |]", "c4 | e4 | f4 |\ng4 | a4 |]"));
  assert.deepEqual(barsBy(one.source), { "0/0": [3, 2], "1/0": [3, 3] });
  // What the reader sees is what sounds: the voice plays a bar early from
  // there on, and the bar that came up is drawn over the bar it sounds
  // with. Left on its line it sounded there all the same, and was drawn a
  // bar late.
  assert.equal(soundsAt(one.source, "f4"), soundsAt(one.source, "E,4"));
  assert.equal(soundsAt(one.source, "g4"), soundsAt(one.source, "F,4"));
  // Both voices: one move of the line, as the buttons at its end make it.
  const both = cut(duet, [[["d4", "d4"]], [["D,4", "D,4"]]]);
  assert.equal(both.source, duet.replace("c4 | d4 | e4 |\nf4 | g4 | a4 |]", "c4 | e4 | f4 |\ng4 | a4 |]").replace("C,4 | D,4 | E,4 |\nF,4 | G,4 | A,4 |]", "C,4 | E,4 | F,4 |\nG,4 | A,4 |]"));
  assert.deepEqual(barsBy(both.source), { "0/0": [3, 2], "1/0": [3, 2] });
  // Where each is cut after its own, to the cursor of each.
  assert.deepEqual(both.after.map((at) => both.source.slice(at).trim().slice(0, 2)), ["e4", "E,"]);
  // Two voices short on two lines: each takes what its own line wants.
  const apart = cut(duet, [[["d4", "d4"]], [["G,4", "G,4"]]]);
  assert.deepEqual(barsBy(apart.source), { "0/0": [3, 2], "1/0": [3, 2] });
  assert.equal(apart.source, duet.replace("c4 | d4 | e4 |\nf4 | g4 | a4 |]", "c4 | e4 | f4 |\ng4 | a4 |]").replace("F,4 | G,4 | A,4 |]", "F,4 | A,4 |]"));
  // And where both have a line below to take from: the upper from its
  // second line on, the lower from its third, neither moved with the other.
  const three = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c4 | d4 |", "e4 | f4 |", "g4 | a4 |]", "V:2 clef=bass", "C,4 | D,4 |", "E,4 | F,4 |", "G,4 | A,4 |]"].join("\n");
  const two = cut(three, [[["d4", "d4"]], [["F,4", "F,4"]]]);
  assert.equal(two.source, three.replace("c4 | d4 |\ne4 | f4 |\ng4 | a4 |]", "c4 | e4 |\nf4 | g4 |\na4 |]").replace("E,4 | F,4 |\nG,4 | A,4 |]", "E,4 | G,4 |\nA,4 |]"));
  // A stretch taken out of one voice and music put into another, in one
  // go: the first has its bars again, and the place after each is where it
  // now is.
  const mixed = MDM_BARS.pasteMusic(ABCJS, duet, [
    { over: slicesOf(duet, [["d4", "d4"]]), text: null },
    { at: duet.indexOf("D,4"), text: "B,,4", where: "after" },
  ]);
  assert.equal(mixed.source, duet.replace("c4 | d4 | e4 |\nf4 | g4 | a4 |]", "c4 | e4 | f4 |\ng4 | a4 |]").replace("C,4 | D,4 | E,4 |", "C,4 | D,4 B,,4 | E,4 |"));
  assert.deepEqual(mixed.after.map((at) => mixed.source.slice(at).replace(/^[ |]+/, "").slice(0, 2)), ["e4", "E,"]);
  // A voice that runs on over the break does not keep another from taking
  // its bars up: it is that voice's bar that crosses the lines, and it
  // stays where it is.
  const run = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c4 | d4 |", "e4 | f4 |]", "V:2 clef=bass", "C,4 | D,2", "E,2 | F,4 |]"].join("\n");
  assert.equal(cut(run, [[["c4", "c4"]]]).source, run.replace("c4 | d4 |\ne4 | f4 |]", "d4 | e4 |\nf4 |]"));
  // Voices written line by line, and marked inside the line.
  const woven = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c4 | d4 |", "V:2 clef=bass", "C,4 | D,4 |", "V:1", "e4 | f4 |]", "V:2", "E,4 | F,4 |]"].join("\n");
  assert.deepEqual(barsBy(cut(woven, [[["c4", "c4"]]]).source), { "0/0": [2, 1], "1/0": [2, 2] });
  assert.deepEqual(barsBy(cut(woven, [[["c4", "c4"]], [["C,4", "C,4"]]]).source), { "0/0": [2, 1], "1/0": [2, 1] });
  const marked = ["X:1", "M:4/4", "L:1/4", "K:C", "[V:1] c4 | d4 |", "[V:2] C4 | D4 |", "[V:1] e4 | f4 |]", "[V:2] E4 | F4 |]"].join("\n");
  const inline = cut(marked, [[["c4", "c4"]]]);
  assert.equal(inline.source, marked.replace("[V:1] c4 | d4 |", "[V:1] d4 | e4 |").replace("[V:1] e4 | f4 |]", "[V:1] f4 |]"));
  // The place after the cut is found where it now is: the bar that headed
  // the voice's second line, two lines up from where it was written.
  const ended = cut(marked, [[["d4", "d4"]]]);
  assert.equal(ended.source, marked.replace("[V:1] c4 | d4 |", "[V:1] c4 | e4 |").replace("[V:1] e4 | f4 |]", "[V:1] f4 |]"));
  assert.equal(ended.source.slice(ended.after[0]).trim().slice(0, 2), "e4");
  // A voice whose bars cannot come up does not keep another from taking
  // its own: the upper runs on from its second line into its third, and
  // is left short there; the lower, cut on its first, closes up to its
  // last.
  const stopped = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c4 | d4 |", "e4 | f4", "g4 | a4 |]", "V:2 clef=bass", "C,4 | D,4 |", "E,4 | F,4 |", "G,4 | A,4 |]"].join("\n");
  const kept = cut(stopped, [[["e4", "e4"]], [["C,4", "C,4"]]]);
  assert.equal(kept.source, stopped.replace("e4 | f4\n", "f4\n").replace("C,4 | D,4 |\nE,4 | F,4 |\nG,4 | A,4 |]", "D,4 | E,4 |\nF,4 | G,4 |\nA,4 |]"));
  // Where the voice's last line would go up whole while the other keeps a
  // line there, it stays, and the voice is left short above it: abcjs files
  // the staves of a line by the voices it has, so that a line one voice has
  // left reads as another voice's, which is no reading to hand a change out
  // on (verify). With both voices cut the line goes, for both.
  const short = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c4 | d4 |", "e4 |]", "V:2 clef=bass", "C,4 | D,4 |", "E,4 |]"].join("\n");
  assert.equal(cut(short, [[["d4", "d4"]]]).source, short.replace("c4 | d4 |", "c4 |"));
  assert.equal(cut(short, [[["d4", "d4"]], [["D,4", "D,4"]]]).source, short.replace("c4 | d4 |\ne4 |]", "c4 | e4 |]").replace("C,4 | D,4 |\nE,4 |]", "C,4 | E,4 |]"));
});

test("the bar a place was all of brings the next line's first up as a stretch does, in each voice it went from", () => {
  const lines = COMMON + "C8 | z8 |\nD8 | E8 |\nF8 | G8 |]";
  const gone = out(lines, "z8", 6);
  assert.equal(gone.source, COMMON + "C8 | D8 |\nE8 | F8 |\nG8 |]");
  // The cursor on what came into the place.
  assert.equal(gone.source.slice(gone.at).trim().slice(0, 2), "D8");
  // A note alone in its bar, at its head.
  assert.equal(out(COMMON + "C8 | D8 |\nE8 | F8 |]", "D8", 1).source, COMMON + "C8 | E8 |\nF8 |]");
  // Out of both voices where the other rests there too, and out of its own
  // alone where the other plays.
  const duet = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c4 | z4 |", "e4 | f4 |]", "V:2 clef=bass", "C,4 | z4 |", "E,4 | F,4 |]"].join("\n");
  assert.equal(out(duet, "z4", 6).source, duet.replace("c4 | z4 |\ne4 | f4 |]", "c4 | e4 |\nf4 |]").replace("C,4 | z4 |\nE,4 | F,4 |]", "C,4 | E,4 |\nF,4 |]"));
  const played = duet.replace("C,4 | z4 |", "C,4 | D,4 |");
  assert.equal(out(played, "z4", 6).source, played.replace("c4 | z4 |\ne4 | f4 |]", "c4 | e4 |\nf4 |]"));
  // A bar that is all its line takes the line, and nothing comes up.
  assert.equal(out(COMMON + "C8 | D8 |\nz8 |\nE8 | F8 |", "z8", 6).source, COMMON + "C8 | D8 |\nE8 | F8 |");
  // The cursor's place is told in the text as the bars left it: with the
  // voices marked inside their lines, the bar that came up was written two
  // lines below.
  const marked = ["X:1", "M:4/4", "L:1/4", "K:C", "[V:1] c4 | z4 |", "[V:2] C4 | D4 |", "[V:1] e4 | f4 |]", "[V:2] E4 | F4 |]"].join("\n");
  const up = out(marked, "z4", 6);
  assert.equal(up.source, marked.replace("[V:1] c4 | z4 |", "[V:1] c4 | e4 |").replace("[V:1] e4 | f4 |]", "[V:1] f4 |]"));
  assert.equal(up.source.slice(up.at).trim().slice(0, 2), "e4");
});

test("bars are moved in the voices named and in no other, which keep their lines", () => {
  const duet = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c4 | d4 |", "e4 | f4 |]", "V:2 clef=bass", "C,4 | D,4 |", "E,4 | F,4 |]"].join("\n");
  const up = MDM_BARS.moveBars(ABCJS, duet, duet.indexOf("e4"), "up", ["0/0"]);
  assert.equal(up.source, duet.replace("c4 | d4 |\ne4 | f4 |]", "c4 | d4 | e4 |\nf4 |]"));
  assertSameMusic(duet, up.source);
  const down = MDM_BARS.moveBars(ABCJS, duet, duet.indexOf("d4"), "down", ["0/0"]);
  assert.equal(down.source, duet.replace("c4 | d4 |\ne4 | f4 |]", "c4 |\nd4 | e4 | f4 |]"));
  assertSameMusic(duet, down.source);
  // Every voice named is every voice: the move the buttons make.
  assert.equal(MDM_BARS.moveBars(ABCJS, duet, duet.indexOf("e4"), "up", ["0/0", "1/0"]).source, MDM_BARS.moveBars(ABCJS, duet, duet.indexOf("e4"), "up").source);
  // The bar the move is asked at has to be of a voice that moves.
  assert.equal(MDM_BARS.moveBars(ABCJS, duet, duet.indexOf("e4"), "up", ["1/0"]).refused, "place");
  // On the first line there is no line above, for one voice as for all.
  assert.equal(MDM_BARS.moveBars(ABCJS, duet, duet.indexOf("d4"), "up", ["0/0"]).refused, "first");
  // A field written inline at the head of bars that go down stays inline
  // where the tune has other voices, moved or not: on a line of its own it
  // would be read for every one of them.
  const keyed = duet.replace("c4 | d4 |", "c4 | [K:G] d4 |");
  const below = MDM_BARS.moveBars(ABCJS, keyed, keyed.indexOf("d4"), "down", ["0/0"]);
  assert.equal(below.source, keyed.replace("c4 | [K:G] d4 |\ne4 | f4 |]", "c4 |\n[K:G] d4 | e4 | f4 |]"));
  assertSameMusic(keyed, below.source);
  const last = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c4 | [K:G] d4 |]", "V:2 clef=bass", "C,4 | D,4 |]"].join("\n");
  const under = MDM_BARS.moveBars(ABCJS, last, last.indexOf("d4"), "down", ["0/0"]);
  assert.equal(under.source, last.replace("c4 | [K:G] d4 |]", "c4 |\n[K:G] d4 |]"));
});

test("half a slur, half a tie, part of a tuplet or of a broken rhythm, what is written under the line and is no verse, is not taken out, each for its reason", () => {
  const slurred = COMMON + "C2 (D2 E2) F2 |";
  assert.equal(over(slurred, [["(D2", "(D2"]]).refused, "noteSlur");
  assert.equal(over(slurred, [["E2)", "E2)"]]).refused, "noteSlur");
  assert.equal(over(slurred, [["C2", "(D2"]]).refused, "noteSlur");
  // One slur closed and another opened inside it are two halves, not one
  // slur whole.
  assert.equal(over(COMMON + "(C2 D2) (E2 F2) |", [["D2)", "(E2"]]).refused, "noteSlur");
  const tied = COMMON + "C2 D2- D2 F2 |";
  assert.equal(over(tied, [["D2-", "D2-"]]).refused, "noteTie");
  assert.equal(over(tied, [["D2 F", "D2"]]).refused, "noteTie");
  assert.equal(over(tied, [["C2", "D2-"]]).refused, "noteTie");
  assert.equal(over(COMMON + "(3CDE F2 z4 |", [["D", "D"]]).refused, "noteUnsafe");
  assert.equal(over(COMMON + "C>D E2 z4 |", [["C>", "C>"]]).refused, "noteUnsafe");
  // A line of symbols, and a verse carried on to a line of its own, are
  // read against the notes as a verse is and are not read here: what they
  // hold for the notes after the stretch would move. (A verse gives up what
  // it had for the stretch, and is no reason: the test of that, below.)
  assert.equal(over(COMMON + "C2 D2 E2 F2 |\ns: !f! * !p! *", [["D2", "E2"]]).refused, "noteLyrics");
  assert.equal(over(COMMON + "C2 D2 E2 F2 |\nw: do re\n+: mi fa", [["D2", "E2"]]).refused, "noteLyrics");
  assert.equal(over(COMMON + "C8 |\nD8 |\ns: !f!\nE8 |", [["D8", "D8"]]).refused, "noteLyrics");
  assert.equal(over(COMMON + "C2 D2 E2 F2 & c8 |", [["D2", "E2"]]).refused, "noteUnsafe");
  // A key written inside it would be gone for everything after it.
  assert.equal(over(COMMON + "C2 D2 [K:G] E2 F2 G2 |", [["D2", "E2"]]).refused, "noteUnsafe");
  // No stretch of a voice: nothing named, a slice that ends before it
  // begins, or one that runs from a voice into another.
  const duet = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f |", "V:2", "C D E F |"].join("\n");
  assert.equal(MDM_BARS.pasteMusic(ABCJS, duet, [{ over: [], text: null }]).refused, "notePlace");
  assert.equal(MDM_BARS.pasteMusic(ABCJS, duet, [{ over: [{ from: duet.indexOf("e f"), to: duet.indexOf("d e") + 1 }], text: null }]).refused, "notePlace");
  assert.equal(MDM_BARS.pasteMusic(ABCJS, duet, [{ over: [{ from: duet.indexOf("e f"), to: duet.indexOf("D E") + 1 }], text: null }]).refused, "notePlace");
  assert.equal(MDM_BARS.pasteMusic(ABCJS, duet, [{ over: [{ from: duet.indexOf("d e"), to: duet.indexOf("E F") + 1 }], text: null }]).refused, "notePlace");
  assert.equal(MDM_BARS.pasteMusic(ABCJS, duet, [{ over: [{ from: 2, to: 4 }], text: null }]).refused, "notePlace");
  // Nor slices of two voices, or two of one line.
  const slice = (needle) => ({ from: duet.indexOf(needle), to: duet.indexOf(needle) + 1 });
  assert.equal(MDM_BARS.pasteMusic(ABCJS, duet, [{ over: [slice("d e"), slice("D E")], text: null }]).refused, "notePlace");
  assert.equal(MDM_BARS.pasteMusic(ABCJS, duet, [{ over: [slice("c d"), slice("e f")], text: null }]).refused, "notePlace");
  assert.equal(MDM_BARS.pasteMusic(ABCJS, duet, [{ over: [slice("d e")], text: null }]).refused, undefined);
  // On two lines as well: a line of one voice, then a line of the other.
  const woven = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f |", "V:2", "C D E F |", "V:1", "g a b c' |", "V:2", "G A B c |"].join("\n");
  const of = (needle) => ({ from: woven.indexOf(needle), to: woven.indexOf(needle) + 1 });
  assert.equal(MDM_BARS.pasteMusic(ABCJS, woven, [{ over: [of("d e"), of("A B")], text: null }]).refused, "notePlace");
  assert.equal(MDM_BARS.pasteMusic(ABCJS, woven, [{ over: [of("d e"), of("a b")], text: null }]).refused, undefined);
});

// "Al copiar sobre una selección reemplaza la selección por lo copiado y el
// compás queda como quede" (the owner, 2026-10-04).
test("music pasted over a stretch takes its place: the stretch goes, the music goes in where it began, and the bars are what comes out", () => {
  const bar = COMMON + "C2 D2 E2 F2 |";
  const one = over(bar, [["D2", "D2"]], "g a");
  assert.equal(body(one), "C2 g a E2 F2 |");
  // The cursor's place is what comes after the music.
  assert.equal(cursorOn(one), "E2");
  assert.equal(body(over(bar, [["D2", "E2"]], "g")), "C2 g F2 |");
  // A rest chosen is how an empty bar is filled with what was copied.
  const empty = over(COMMON + "C8 | z8 | D8 |", [["z8", "z8"]], "E2 F2 G2 A2");
  assert.equal(body(empty), "C8 | E2 F2 G2 A2 | D8 |");
  assert.equal(cursorOn(empty, 4), "| D8");
  // Two bars by one, one by two with a barline of their own, and the whole
  // of a voice, which keeps the barlines the stretch did not hold.
  assert.equal(body(over(COMMON + "C8 | D8 | E8 | F8 |", [["D8", "E8"]], "G4 A4")), "C8 | G4 A4 | F8 |");
  assert.equal(body(over(COMMON + "C8 | D8 | E8 |", [["D8", "D8"]], "G8 | A8")), "C8 | G8 | A8 | E8 |");
  assert.equal(body(over(COMMON + "C8 | D8 |]", [["C8", "D8"]], "g8")), "g8 |]");
  // Set apart from what the stretch was written against.
  assert.equal(body(over(COMMON + "C2D2E2 F2 |", [["D2", "D2"]], "g")), "C2 g E2 F2 |");
  // Over several lines the music goes in on the first, and the rest of the
  // stretch goes as it does with nothing put in.
  const lines = COMMON + "C8 | D8 |\nE8 | F8 |\nG8 | A8 |";
  assert.equal(body(over(lines, [["D8", "D8"], ["E8", "F8"], ["G8", "G8"]], "z4 c4")), "C8 | z4 c4 |\nA8 |");
  assert.equal(body(over(lines, [["E8", "F8"]], "c8")), "C8 | D8 |\nc8 |\nG8 | A8 |");
  // The lines of a copy are one run of music.
  assert.equal(body(over(bar, [["D2", "E2"]], "g a |\n  b")), "C2 g a | b F2 |");
  // What it is put beside is not changed by it: half a slur in the text, a
  // tie cut by the stretch, a verse under the line, a text that is no music.
  assert.equal(over(bar, [["D2", "D2"]], "(g a").refused, "noteSlur");
  assert.equal(over(COMMON + "C2 D2- D2 F2 |", [["D2 F", "D2"]], "g").refused, "noteTie");
  assert.equal(over(bar + "\nw: do re mi fa", [["D2", "D2"]], "g a").refused, "noteLyrics");
  // A rest put in as well: the verse gives up a syllable for what is taken
  // out and nothing is put in for, and here a place is.
  assert.equal(over(bar + "\nw: do re mi fa", [["D2", "D2"]], "z2").refused, "noteLyrics");
  assert.equal(over(bar, [["D2", "D2"]], "hello world").refused, "pasteText");
  assert.equal(over(bar, [["D2", "D2"]], "|").refused, "pasteText");
});

test("several voices at once: a stretch out of each, music over one and before a place of another, each as if it were alone and in whatever order", () => {
  // A voice written in pieces between the lines of another, so that what
  // goes from one moves the places of the other in the text.
  const woven = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f |", "V:2", "C D E F |", "V:1", "g a b c' |", "V:2", "G A B c |"].join("\n");
  const slices = (list) => slicesOf(woven, list);
  const upper = { over: slices([["e", "f"], ["g", "a"]]), text: null };
  const lower = { over: slices([["E", "F"], ["G", "A"]]), text: null };
  const cut = MDM_BARS.pasteMusic(ABCJS, woven, [upper, lower]);
  const expected = woven.replace("c d e f |", "c d |").replace("g a b c' |", "b c' |").replace("C D E F |", "C D |").replace("G A B c |", "B c |");
  assert.equal(cut.source, expected);
  // Where the cursor goes in each, in the source as it is at the end: the
  // barline after what went, of the upper voice's first line and of the
  // lower's.
  const lineAt = (source, at) => source.slice(0, at).split("\n").length;
  assert.deepEqual(cut.after.map((at) => [cut.source.slice(at, at + 1), lineAt(cut.source, at)]), [["|", 6], ["|", 8]]);
  const turned = MDM_BARS.pasteMusic(ABCJS, woven, [lower, upper]);
  assert.equal(turned.source, expected);
  assert.deepEqual(turned.after.map((at) => [turned.source.slice(at, at + 1), lineAt(turned.source, at)]), [["|", 8], ["|", 6]]);
  // Music over the stretch of one voice and before a place of the other.
  const mixed = [
    { over: slices([["e", "f"], ["g", "a"]]), text: "z2" },
    { at: woven.indexOf("E F"), text: "A,", where: "on" },
  ];
  const put = MDM_BARS.pasteMusic(ABCJS, woven, mixed);
  const written = woven.replace("c d e f |", "c d z2 |").replace("g a b c' |", "b c' |").replace("C D E F |", "C D A, E F |");
  assert.equal(put.source, written);
  assert.deepEqual(put.after.map((at) => put.source.slice(at, at + 1)), ["|", "E"]);
  assert.equal(MDM_BARS.pasteMusic(ABCJS, woven, mixed.slice().reverse()).source, written);
  // One of them refused, and nothing is changed.
  assert.equal(MDM_BARS.pasteMusic(ABCJS, woven, [upper, { over: slices([["C", "B c"]]), text: null }]).refused, "notePlace");
  const whole = { over: slices([["C", "F"], ["G", "B c"]]), text: null };
  assert.equal(MDM_BARS.pasteMusic(ABCJS, woven, [upper, whole]).refused, "cutAll");
});

// Every stretch of every fixture, of one place, of two and of four, taken
// out and with music put in its place: refused for a reason of the
// engine's, or the voice as it was without the stretch, and barlines that
// stood beside it where bars or a line went whole, with the music where it
// began, and every other voice as it was. Read apart from the module's own
// check, as the sweeps above are.
test("a sweep of every stretch, taken out and pasted over: refused, or the stretch gone, the music in its place, and nothing else", () => {
  const reasons = new Set(["noteTie", "noteLyrics", "noteUnsafe", "noteSlur", "cutAll"]);
  const pieces = [null, "c2 d2", "c4 | d4"];
  const isBar = (entry) => /^bar /.test(entry);
  // Whether a list is another with some of its entries left out.
  const within = (some, all) => {
    let i = 0;
    all.forEach((entry) => {
      if (i < some.length && some[i] === entry) i++;
    });
    return i === some.length;
  };
  let cut = 0;
  let put = 0;
  let beside = 0;
  let refused = 0;
  let raised = 0;
  let short = 0;
  const total = (list) => list.reduce((p, q) => p + q, 0);
  Object.keys(NOTE_FIXTURES).forEach((name) => {
    const [source] = NOTE_FIXTURES[name];
    const voices = places(source);
    const was = music(source);
    const had = barsBy(source);
    const lineOf = (el) => source.slice(0, el.startChar).split("\n").length;
    Object.keys(voices).forEach((key) => {
      const entries = was[key].map((e, i) => i).filter((i) => !isBar(was[key][i]));
      voices[key].forEach((first, index) => {
        [1, 2, 4].forEach((span) => {
          const last = index + span - 1;
          if (last >= voices[key].length) return;
          // The stretch, line by line.
          const slices = [];
          voices[key].slice(index, last + 1).forEach((el) => {
            const slice = slices[slices.length - 1];
            if (slice && slice.line === lineOf(el)) slice.to = el.endChar;
            else slices.push({ line: lineOf(el), from: el.startChar, to: el.endChar });
          });
          // What stood between the place before the stretch and the one
          // after it: the stretch, and barlines. The barlines between two of
          // its places on one line are inside it; the others stand beside it.
          const lo = index > 0 ? entries[index - 1] : -1;
          const hi = last + 1 < entries.length ? entries[last + 1] : was[key].length;
          const outside = [];
          for (let e = lo + 1; e < hi; e++) {
            if (!isBar(was[key][e])) continue;
            let n = index;
            while (n < last && entries[n + 1] < e) n++;
            const inside = e > entries[index] && e < entries[last] && lineOf(voices[key][n]) === lineOf(voices[key][n + 1]);
            if (!inside) outside.push(was[key][e]);
          }
          pieces.forEach((piece) => {
            const label = [name, key, index, span, piece].join(" ");
            const result = MDM_BARS.pasteMusic(ABCJS, source, [{ over: slices.map((x) => ({ from: x.from, to: x.to })), text: piece }]);
            if (result.refused) {
              assert.ok(reasons.has(result.refused), label + ": " + result.refused);
              // Taken out, a stretch takes what the verses gave it, and none
              // of these fixtures has anything else written under a line.
              if (piece === null) assert.notEqual(result.refused, "noteLyrics", label + ": refused for the verse under it");
              refused++;
              return;
            }
            const now = music(result.source);
            const has = barsBy(result.source);
            Object.keys(was).forEach((other) => {
              if (other === key) return;
              assert.deepEqual(now[other], was[other], label + ": voice " + other + " changed");
              // On the lines it was on: the bars of the voice cut come up
              // alone.
              assert.deepEqual(has[other], had[other], label + ": the lines of voice " + other + " changed");
            });
            // A line the stretch took bars from, and left something of, has
            // its bars again where a line after it could give them (raised),
            // or is left short where none could (short): never more than it
            // had, and with music put in, as the music leaves it.
            const li = lineIn(source, voices[key], first);
            const mine = has[key] || [];
            const onLine = voices[key].filter((el) => lineOf(el) === lineOf(first)).length;
            if (slices.length === 1 && span < onLine && lineIn(source, voices[key], voices[key][voices[key].length - 1]) === had[key].length - 1) {
              assert.ok(mine[li] <= had[key][li] || piece !== null, label + ": the line has more bars than it had");
              if (piece === null && total(mine) < total(had[key]) && li < had[key].length - 1) {
                if (mine[li] === had[key][li]) raised++;
                else short++;
              }
            }
            // The voice up to the place before the stretch, and from the
            // place after it, as it was.
            const head = was[key].slice(0, lo + 1);
            const tail = was[key].slice(hi);
            assert.deepEqual(now[key].slice(0, head.length), head, label + ": before the stretch");
            assert.deepEqual(now[key].slice(now[key].length - tail.length), tail, label + ": after the stretch");
            // Between the two, none of the stretch: the music put in, two
            // notes with its own barline between them where it brings one,
            // and of the barlines that stood beside the stretch the ones
            // that stay, in their order.
            const middle = now[key].slice(head.length, now[key].length - tail.length);
            const notes = middle.map((entry, i) => i).filter((i) => !isBar(middle[i]));
            let kept = middle;
            if (piece === null) {
              assert.equal(notes.length, 0, label + ": something of the stretch stayed: " + middle.join(", "));
              cut++;
            } else {
              assert.deepEqual(notes.map((i) => middle[i].split(" ")[0]), ["7", "8"], label + ": " + middle.join(", "));
              const own = middle.slice(notes[0] + 1, notes[1]);
              assert.deepEqual(own, piece.indexOf("|") < 0 ? [] : ["bar bar_thin"], label + ": between the two notes put in");
              kept = middle.slice(0, notes[0]).concat(middle.slice(notes[1] + 1));
              put++;
            }
            assert.ok(within(kept, outside), label + ": the barlines beside it are not the ones that were\n" + kept.join(", ") + "\nagainst\n" + outside.join(", "));
            if (kept.length < outside.length) {
              // A barline went with it: whole bars, or a line, taken out
              // with nothing put in their place on that line.
              assert.ok(piece === null || slices.length > 1, label + ": a barline went beside music pasted on its line");
              beside++;
            }
          });
        });
      });
    });
  });
  assert.ok(cut > 500, "the sweep took only " + cut + " stretches out");
  assert.ok(put > 900, "the sweep pasted over only " + put + " stretches");
  assert.ok(beside > 90, "the sweep took a barline with only " + beside + " stretches");
  assert.ok(refused > 160, "the sweep met only " + refused + " refusals");
  // The lines left short are the ones nothing could come up to: a line no
  // barline ends (the fixture `open`, twice).
  assert.ok(raised > 60, "only " + raised + " lines took their bars again from the line below");
  assert.ok(short < 6, short + " lines were left short above a line with bars to give");
});

// ---------- A stretch made rests ----------

// The places written `needles` (each the first in the music, or with a
// number the nth) made rests.
function rests(source, needles) {
  const ats = needles.map((needle) => {
    const [text, nth] = Array.isArray(needle) ? needle : [needle, 0];
    let at = bodyOf(source) - 1;
    for (let i = 0; i <= nth; i++) at = source.indexOf(text, at + 1);
    assert.ok(at >= 0, "no " + text + " in the fixture");
    return at;
  });
  return MDM_BARS.restMusic(ABCJS, source, ats);
}

// The owner's call of 2026-10-04, for 0 with a stretch chosen: "al marcar 0
// todas las notas del tramo elegido se sustituyen por su silencio".
test("the notes of a stretch are made rests as long as they were, the rests among them left, and what is written on a note kept on its rest", () => {
  assert.equal(body(rests(COMMON + "C2 D2 E2 F2 |", ["D2", "E2"])), "C2 z2 z2 F2 |");
  // One note, a rest among them, and nothing but rests, which is the source
  // as it was and said to be the same.
  assert.equal(body(rests(COMMON + "C2 D2 E2 F2 |", ["D2"])), "C2 z2 E2 F2 |");
  assert.equal(body(rests(COMMON + "C2 z2 E2 F2 |", ["C2", "z2", "E2"])), "z2 z2 z2 F2 |");
  const idle = rests(COMMON + "C2 z2 z2 F2 |", ["z2", ["z2", 1]]);
  assert.deepEqual([idle.refused, idle.same, idle.source], [undefined, true, COMMON + "C2 z2 z2 F2 |"]);
  // Every length as it is written, a chord's after its brackets or inside
  // them, and the spacing of everything as it was.
  assert.equal(body(rests(COMMON + "[CE]4 D/E/ F3 |", ["[CE]4", "D/", "E/", "F3"])), "z4 z/z/ z3 |");
  assert.equal(body(rests(COMMON + "[C2E2] D2 z4 |", ["[C2E2]"])), "z2 D2 z4 |");
  assert.equal(body(rests(COMMON + "[C2E2]2 D2 z2 |", ["[C2E2]2"])), "z4 D2 z2 |");
  // In a tuplet and in a broken rhythm each keeps the length they give it.
  assert.equal(body(rests(COMMON + "(3CDE F>G A2 z2 |", ["(3C", "D", "E", "F>", "G"])), "(3zzz z>z A2 z2 |");
  // A chord symbol, a decoration and grace notes stay on the rest.
  assert.equal(body(rests(COMMON + '"Am"C2 !f!D2 {g}E2 .F2 |', ['"Am"', "!f!", "{g}", ".F2"])), '"Am"z2 !f!z2 {g}z2 .z2 |');
  // A slur or a tie between two of them goes with them, a rest having
  // neither; the tuplet's mark, the chord symbol's and the grace notes'
  // brackets are not slurs.
  assert.equal(body(rests(COMMON + "C2 (D2 E2) F2 |", ["(D2", "E2)"])), "C2 z2 z2 F2 |");
  assert.equal(body(rests(COMMON + "((C2 D2) E2) F2 |", ["((C2", "D2)", "E2)"])), "z2 z2 z2 F2 |");
  assert.equal(body(rests(COMMON + "C2 D2-|D2 F2 z4 |", ["D2-", ["D2", 1]])), "C2 z2|z2 F2 z4 |");
  assert.equal(body(rests(COMMON + "[CE]2-[CE]2 F4 |", ["[CE]2-", ["[CE]2", 1]])), "z2z2 F4 |");
  assert.equal(body(rests(COMMON + '"C(add9)"(3(CDE) {(ga)}F2 z4 |', ['"C(add9)"', "D", "E)", "{(ga)}"])), '"C(add9)"(3zzz {(ga)}z2 z4 |');
  // Over several lines, and over several voices at once.
  assert.equal(body(rests(COMMON + "C8 | D8 |\nE8 | F8 |", ["D8", "E8"])), "C8 | z8 |\nz8 | F8 |");
  const duet = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f |", "V:2", "C D E F |"].join("\n");
  assert.equal(rests(duet, ["d", "e", "D", "E"]).source, duet.replace("c d e f", "c z z f").replace("C D E F", "C z z F"));
  // The same place named twice is made a rest once.
  assert.equal(body(rests(COMMON + "C2 D2 E2 F2 |", ["D2", "D2"])), "C2 z2 E2 F2 |");
});

test("half a slur, half a tie, a verse abcjs reads otherwise than its lines say or voices laid over each other, and the notes stay as they are", () => {
  const slurred = COMMON + "C2 (D2 E2) F2 |";
  assert.equal(rests(slurred, ["(D2"]).refused, "noteSlur");
  assert.equal(rests(slurred, ["E2)", "F2"]).refused, "noteSlur");
  const tied = COMMON + "C2 D2-|D2 F2 z4 |";
  assert.equal(rests(tied, ["D2-"]).refused, "noteTie");
  assert.equal(rests(tied, [["D2", 1], "F2"]).refused, "noteTie");
  // The notes named need not be a run: a tie is the two notes it joins,
  // whatever else is named around them.
  assert.equal(rests(tied, ["D2-", "F2"]).refused, "noteTie");
  assert.equal(rests(tied, ["C2", ["D2", 1]]).refused, "noteTie");
  // A chord tied by one of its heads is tied.
  assert.equal(rests(COMMON + "[C-E]2 C2 F4 |", ["[C-E]2"]).refused, "noteTie");
  // A verse carried on to the next line, which abcjs reads as one verse
  // with it, and a line of symbols. (What a verse gives up is the test of
  // 2026-10-15, below.)
  assert.equal(rests(COMMON + "C2 D2 E2 F2 |\nw: do re \\\nw: mi fa", ["D2"]).refused, "noteLyrics");
  assert.equal(rests(COMMON + "C2 D2 E2 F2 |\ns: !f! * !p! *", ["D2"]).refused, "noteLyrics");
  assert.equal(rests(COMMON + "C2 D2 E2 F2 & c8 |", ["D2"]).refused, "noteUnsafe");
  // No place there.
  assert.equal(MDM_BARS.restMusic(ABCJS, COMMON + "C2 D2 |", [2]).refused, "notePlace");
  assert.equal(MDM_BARS.restMusic(ABCJS, COMMON + "C2 D2 |", []).same, true);
});

// The check every stretch made rests passes, on its own: what it is handed
// is the notes that were asked for, each by its voice, its system and its
// index there, and it lets through those made rests as long and nothing
// else.
test("the check a stretch made rests passes lets those notes through as rests as long, and stops anything else", () => {
  const before = COMMON + "C2 (D2 E2) F2 | G8 |";
  const plan = [
    { key: "0/0", s: 0, e: 1 },
    { key: "0/0", s: 0, e: 2 },
  ];
  const check = (line, with_) => MDM_BARS.verifyRests(ABCJS, before, COMMON + line, with_ || plan);
  assert.equal(check("C2 z2 z2 F2 | G8 |"), null);
  assert.equal(check("C2 z2 E2 F2 | G8 |"), "noteUnsafe", "one of them left a note");
  assert.equal(check("C2 z2 z2 z2 | G8 |"), "noteUnsafe", "a note more made a rest");
  assert.equal(check("C2 z z2 F2 | G8 |"), "noteUnsafe", "a rest of another length");
  assert.equal(check("C2 x2 z2 F2 | G8 |"), "noteUnsafe", "a rest nobody sees");
  assert.equal(check("C2 z4 F2 | G8 |"), "noteUnsafe", "one rest for the two");
  assert.equal(check("C2 z2 z2 F2 | A8 |"), "noteUnsafe", "a note after them changed");
  assert.equal(check("C2 z2 z2 | F2 G8 |"), "noteUnsafe", "a barline moved");
  assert.equal(check("C2 z2 z2 F2 |\nG8 |"), "noteUnsafe", "a line broken");
  // A slur that went with them renames the ones after it, which is no
  // change; one that lost an end is.
  const later = COMMON + "(C2 D2) (E2 F2) | (G4 A4) |";
  const two = [
    { key: "0/0", s: 0, e: 2 },
    { key: "0/0", s: 0, e: 3 },
  ];
  assert.equal(MDM_BARS.verifyRests(ABCJS, later, COMMON + "(C2 D2) z2 z2 | (G4 A4) |", two), null);
  assert.equal(MDM_BARS.verifyRests(ABCJS, later, COMMON + "(C2 D2) z2 z2 | G4 A4 |", two), "noteUnsafe");
  // abcjs names a slur that opens on a chord apart from one that opens on
  // a note (1 and 101), and a reading names them in the order it meets
  // them: with the chords' slur gone the one after it has another name.
  const chords = COMMON + "([CE]2 [DF]2) (G2 A2) |";
  const heads = [
    { key: "0/0", s: 0, e: 0 },
    { key: "0/0", s: 0, e: 1 },
  ];
  assert.equal(MDM_BARS.verifyRests(ABCJS, chords, COMMON + "z2 z2 (G2 A2) |", heads), null);
  assert.equal(MDM_BARS.verifyRests(ABCJS, chords, COMMON + "z2 z2 G2 A2 |", heads), "noteUnsafe");
  // Something more after the last barline.
  assert.equal(check("C2 z2 z2 F2 | G8 | [P:X]"), "noteUnsafe", "a part marked at the end");
  // Another voice changed.
  const pair = (upper, lower) => COMMON + "V:1\n" + upper + "\nV:2\n" + lower;
  const one = [{ key: "0/0", s: 0, e: 0 }];
  assert.equal(MDM_BARS.verifyRests(ABCJS, pair("C4 D4 |", "E8 |"), pair("z4 D4 |", "E8 |"), one), null);
  assert.equal(MDM_BARS.verifyRests(ABCJS, pair("C4 D4 |", "E8 |"), pair("z4 D4 |", "z8 |"), one), "noteUnsafe");
});

// Every stretch of every fixture, of one place, of two and of four: refused
// for a reason of the engine's, the same where it holds no note, or each
// of its notes a rest as long and everything else of the score where it
// was. Read apart from the module's own check, as the sweeps above are.
test("a sweep of every stretch made rests: refused, or its notes rests as long, and nothing else", () => {
  const reasons = new Set(["noteTie", "noteLyrics", "noteUnsafe", "noteSlur"]);
  let made = 0;
  let turned = 0;
  let same = 0;
  let refused = 0;
  // Notes that had a syllable under them (since 2026-10-15 a verse gives
  // its syllables up with the notes, and SONG's verses refuse nothing).
  let sung = 0;
  Object.keys(NOTE_FIXTURES).forEach((name) => {
    const [source] = NOTE_FIXTURES[name];
    const voices = places(source);
    const was = music(source);
    Object.keys(voices).forEach((key) => {
      const entries = was[key].map((e, i) => i).filter((i) => !/^bar /.test(was[key][i]));
      voices[key].forEach((first, index) => {
        [1, 2, 4].forEach((span) => {
          const last = index + span - 1;
          if (last >= voices[key].length) return;
          const label = [name, key, index, span].join(" ");
          const stretch = voices[key].slice(index, last + 1);
          const result = MDM_BARS.restMusic(ABCJS, source, stretch.map((el) => el.startChar));
          if (result.refused) {
            assert.ok(reasons.has(result.refused), label + ": " + result.refused);
            refused++;
            return;
          }
          if (result.same) {
            assert.ok(stretch.every((el) => el.rest), label + ": said to be the same with a note in it");
            assert.equal(result.source, source, label);
            same++;
            return;
          }
          const now = music(result.source);
          Object.keys(was).forEach((other) => {
            if (other !== key) assert.deepEqual(now[other], was[other], label + ": voice " + other + " changed");
          });
          assert.equal(now[key].length, was[key].length, label + ": an entry more or less");
          was[key].forEach((entry, i) => {
            const at = entries.indexOf(i);
            const el = at >= index && at <= last ? voices[key][at] : null;
            if (!el || el.rest) {
              assert.equal(now[key][i], entry, label + ": entry " + i + " changed");
              return;
            }
            const [kind, type, length] = now[key][i].split(" ");
            assert.equal(kind, "rest", label + ": entry " + i + " is no rest: " + now[key][i]);
            assert.match(type, /^(?:rest|whole)$/, label + ": entry " + i);
            assert.equal(Number(length), el.duration, label + ": entry " + i + " lasts " + length);
            turned++;
            if (entry.split(" ")[2]) sung++;
          });
          assert.deepEqual(layout(result.source), layout(source), label);
          made++;
        });
      });
    });
  });
  assert.ok(made > 400, "the sweep made rests of only " + made + " stretches");
  assert.ok(turned > 800, "the sweep made only " + turned + " notes rests");
  assert.ok(same > 30, "the sweep met only " + same + " stretches with no note");
  assert.ok(refused > 8, "the sweep met only " + refused + " refusals");
  assert.ok(sung > 120, "the sweep made rests of only " + sung + " notes with a syllable");
});

// ---------- The syllables of notes made rests ----------

// What abcjs gives every note and rest of a score, read here and not by the
// engine, line by line and on each line staff by staff and voice by voice:
// the note as it is written, or `z` for a rest, and its rows of words as
// they are drawn (`la_`, `hel-`), after an `=` and joined by `/`, the blank
// rows at the end left off.
function sungUnder(source) {
  const out = [];
  ABCJS.parseOnly(source)[0].lines.forEach((line) => {
    (line.staff || []).forEach((staff) => {
      (staff.voices || []).forEach((voice) => {
        voice.forEach((el) => {
          if (el.el_type !== "note") return;
          const rows = (el.lyric || []).map((l) => l.syllable + (l.divider === " " ? "" : l.divider));
          while (rows.length && !rows[rows.length - 1]) rows.pop();
          out.push((el.rest ? "z" : source.slice(el.startChar, el.endChar).trim()) + (rows.length ? "=" + rows.join("/") : ""));
        });
      });
    });
  });
  return out.join(" ");
}

// The owner's call of 2026-10-15, on three notes under a verse that 0 had
// refused ("Lyrics can't make room"): "Si doy cero las notas dben ponerse
// en silencio y que se borre todo lo que haya escrito". The notes are made
// rests, the syllables they had go with them, and every other note keeps
// the one it had: what Delete takes from the verses (the test of what is
// taken out, further down), with the places left standing.
test("a note made a rest takes the syllables the verses gave it, and every other note keeps its own: a syllable of a word, a hold, a skip, a barline in the verse, several verses, a chord, a note no verse reaches, a verse left with no syllable, verses past a comment, a field or a line of spaces; what the engine cannot read as abcjs does is refused, under Delete as well: a line of symbols, +:, a verse carried on with a backslash or holding a \\% (2026-10-15)", () => {
  const H = "X:1\nM:4/4\nL:1/4\nK:C\n";
  const at = (body, needle, nth) => {
    let i = -1;
    for (let k = 0; k <= (nth || 0); k++) i = body.indexOf(needle, i + 1);
    assert.ok(i >= 0, "no " + needle + " in " + body);
    return H.length + i;
  };
  const left = (result, label) => {
    assert.equal(result.refused, undefined, label + ": refused: " + result.refused);
    return result.source.slice(H.length);
  };
  // 0 on the place written `needle`, by the cursor; on several, a stretch;
  // and Shift with a figure's key, a rest of that figure.
  const zero = (body, needle, length) => left(MDM_BARS.writeNote(ABCJS, H + body, at(body, needle), length ? { rest: true, duration: length } : { rest: true }), body + " at " + needle);
  const zeros = (body, needles) => left(MDM_BARS.restMusic(ABCJS, H + body, needles.map((n) => at(body, n))), body + " at " + needles);
  const under = (body) => sungUnder(H + body);

  // The owner's case: three notes chosen under 2, 3 and 4, and the 5 of the
  // note after them under it still.
  const owner = "C D E F | G A B c |]\nw: 1 2 3 4 5 6 7 8";
  assert.equal(under(owner), "C=1 D=2 E=3 F=4 G=5 A=6 B=7 c=8");
  assert.equal(zeros(owner, ["D", "E", "F"]), "C z z z | G A B c |]\nw: 1 5 6 7 8");
  assert.equal(under(zeros(owner, ["D", "E", "F"])), "C=1 z z z G=5 A=6 B=7 c=8");
  // One note, by the cursor, and by Shift with the eighth's key.
  assert.equal(zero(owner, "E"), "C D z F | G A B c |]\nw: 1 2 4 5 6 7 8");
  assert.equal(zero(owner, "E", EIGHTH), "C D z/2 F | G A B c |]\nw: 1 2 4 5 6 7 8");
  // Across a barline the verse takes, which stays.
  const barred = "C D | E F |]\nw: a b | c d";
  assert.equal(zeros(barred, ["D", "E"]), "C z | z F |]\nw: a | d");
  assert.equal(under(zeros(barred, ["D", "E"])), "C=a z z F=d");

  // A syllable of a word: the one before keeps its hyphen, as under Delete.
  const word = "C D E F |]\nw: hel-lo world now";
  assert.equal(zero(word, "D"), "C z E F |]\nw: hel- world now");
  assert.equal(under(zero(word, "D")), "C=hel- z E=world F=now");
  assert.equal(zero(word, "C"), "z D E F |]\nw: lo world now");
  // A syllable held over the notes after it, and the hyphens that skip
  // them: what they skip stays skipped, the rest taking a star where its
  // syllable stood, and a note the hold or a hyphen reached made a rest
  // takes its star or its `_` as it stands.
  const glory = "C D E F |]\nw: Glo---ri";
  assert.equal(zero(glory, "C"), "z D E F |]\nw: * --ri");
  assert.equal(under(zero(glory, "C")), "z D E F=ri");
  assert.equal(zero(glory, "F"), "C D E z |]\nw: Glo---");
  assert.equal(under(zero(glory, "F")), "C=Glo- D E z");
  const held = "C D E F |]\nw: la_ _ fa";
  assert.equal(zero(held, "C"), "z D E F |]\nw: * _ _ fa");
  assert.equal(zero(held, "D"), "C z E F |]\nw: la_ _ fa");
  assert.equal(under(zero(held, "D")), "C=la_ z E F=fa");
  // A star or a lone hyphen after the syllable, offered to the rests: one
  // star for each, the rest that was there and the one made.
  const starred = "C z D E F |]\nw: a b * c";
  assert.equal(zero(starred, "D"), "C z z E F |]\nw: a * * * c");
  assert.equal(under(zero(starred, "D")), "C=a z z E F=c");
  assert.equal(zero("C z D E F |]\nw: a b - c", "D"), "C z z E F |]\nw: a * * - c");
  assert.equal(under(zero("C z D E F |]\nw: a b - c", "D")), "C=a z z E F=c");
  // A `|` after it, with a barline the syllable passed over: the barline
  // would take the `|`, so the rest takes a star.
  const late = "C | D E | F G |]\nw: a b | c";
  assert.equal(zero(late, "D"), "C | z E | F G |]\nw: a * | c");
  assert.equal(under(zero(late, "D")), "C=a z E F=c G");
  // A syllable of several words, and one with a hyphen of its own.
  const tied = "C D E F |]\nw: of~the one\\-two three four";
  assert.equal(zero(tied, "D"), "C z E F |]\nw: of~the three four");
  assert.equal(under(zero(tied, "D")), "C=of" + String.fromCharCode(160) + "the z E=three F=four");

  // Every verse gives its syllable up. A verse that ran out before a note
  // gives it nothing, and the note's first row is then the verse under it
  // (abcjs gives a note its rows in the order of the verses that reach it):
  // E is drawn with `g` on its first row, and keeps it there.
  const two = "C D E F |]\nw: a b c d\nw: e f g h";
  assert.equal(zero(two, "D"), "C z E F |]\nw: a c d\nw: e g h");
  assert.equal(under(zero(two, "D")), "C=a/e z E=c/g F=d/h");
  const short = "C D E F |]\nw: a b\nw: e f g h";
  assert.equal(under(short), "C=a/e D=b/f E=g F=h");
  assert.equal(zero(short, "E"), "C D z F |]\nw: a b\nw: e f h");
  assert.equal(under(zero(short, "E")), "C=a/e D=b/f z F=h");
  assert.equal(zero(short, "C"), "z D E F |]\nw: b\nw: f g h");
  assert.equal(zero("C D E F |]\nw: a b", "E"), "C D z F |]\nw: a b");
  // A chord takes one syllable, and gives it up whole.
  assert.equal(zero("[CE] D E F |]\nw: a b c d", "[CE]"), "z D E F |]\nw: b c d");
  // A verse left with nothing goes, line and all.
  assert.equal(zeros("C D E F |]\nw: a b c d", ["C", "D", "E", "F"]), "z z z z |]");
  assert.equal(zeros("C D E F |]\nw: a b c d\nw: e f", ["C", "D"]), "z z E F |]\nw: c d");
  assert.equal(zeros("C D E F |]\nw: a b\nw: e f g h", ["C", "D"]), "z z E F |]\nw: g h");
  assert.equal(under(zeros("C D E F |]\nw: a b\nw: e f g h", ["C", "D"])), "z z E=g F=h");
  // And so does one left with no syllable, holds and stars that give the
  // places they reach a blank row, where no verse under it keeps one (found
  // by the second reading: left as `w: * _ _ _`, nothing of it drawn, it
  // still refused Enter on those rests).
  const all = ["C", "D", "E", "F"];
  for (const verse of ["la_ _ _", "Glo---ri", "a * * b"]) assert.equal(zeros("C D E F |]\nw: " + verse, all), "z z z z |]", verse);
  assert.equal(MDM_BARS.writeNote(ABCJS, H + "z z z z |]", at("z z z z", "z", 1), { step: 4 }).source.slice(H.length), "z G z z |]");
  // Under a verse that keeps one it stays: its blank rows hold the row the
  // verse under it is drawn on.
  assert.equal(zero("C D E F |]\nw: la_ _ _\nw: a b c d", "C"), "z D E F |]\nw: * _ _ _\nw: b c d");
  assert.equal(under(zero("C D E F |]\nw: la_ _ _\nw: a b c d", "C")), "z D=/b E=/c F=/d");
  // A verse of stars the change did not touch is the reader's, and stays,
  // and one under the verse left with none keeps no row for it.
  assert.equal(zero("C D E F |]\nw: a b c d\nw: * * * *", "C"), "z D E F |]\nw: b c d\nw: * * * *");
  // Over one that keeps a syllable it goes: its blank rows are the last a
  // note has.
  assert.equal(zero("C D E F |]\nw: a b c d\nw: la_ _ _", "C"), "z D E F |]\nw: b c d");
  assert.equal(zero("C D E F |]\nw: la_ _ _\nw: * * * *", "C"), "z D E F |]\nw: * * * *");
  // Delete does the same with what it leaves (wordsCut): C and then F out
  // from under `a * * b` used to leave `w: * *` under D and E.
  const taken = MDM_BARS.takeOut(ABCJS, H + "C D E F |]\nw: a * * b", at("C D E F", "C"), 0).source;
  assert.equal(taken.slice(H.length), "D E F |]\nw: * * b");
  assert.equal(MDM_BARS.takeOut(ABCJS, taken, taken.indexOf("F |]"), 3).source.slice(H.length), "D E |]");
  // A stretch over two lines, and over two voices.
  const lines = "C D E F |\nw: a b c d\nG A B c |]\nw: e f g h";
  assert.equal(zeros(lines, ["F", "G"]), "C D E z |\nw: a b c\nz A B c |]\nw: f g h");
  assert.equal(under(zeros(lines, ["F", "G"])), "C=a D=b E=c z z A=f B=g c=h");
  const duet = "V:1\nC D E F |\nw: a b c d\nV:2\nE, F, G, A, |\nw: e f g h";
  assert.equal(zeros(duet, ["D", "F,"]), "V:1\nC z E F |\nw: a c d\nV:2\nE, z G, A, |\nw: e g h");
  assert.equal(under(zeros(duet, ["D", "F,"])), "C=a z E=c F=d E,=e z G,=g A,=h");

  // Verses past a comment, a directive, a field or a line of spaces, which
  // abcjs reads against the same notes, are read past them here as well
  // (versesOf): found by the second reading, 0 on F, the last note, left
  // `h` written under no note, and the next note put in after it took it.
  // Delete the same. The lines in between stay. An empty line ends the tune,
  // and the words after it are no verse of it.
  const out = (body, needle, step) => MDM_BARS.takeOut(ABCJS, H + body, at(body, needle), step);
  const commented = "C D E F |]\nw: a b c d\n% the second verse\nw: e f g h";
  assert.equal(under(commented), "C=a/e D=b/f E=c/g F=d/h");
  assert.equal(zero(commented, "F"), "C D E z |]\nw: a b c\n% the second verse\nw: e f g");
  assert.equal(left(out(commented, "F", 3), "Delete F"), "C D E |]\nw: a b c\n% the second verse\nw: e f g");
  assert.equal(zero("C D E F |]\nw: a b c d\nP:B\nw: e f g h", "F"), "C D E z |]\nw: a b c\nP:B\nw: e f g");
  assert.equal(zero("C D E F |]\n% the words\nw: a b c d", "E"), "C D z F |]\n% the words\nw: a b d");
  assert.equal(zero("C D E F |]\n%%vocalfont Times 14\nw: a b c d", "F"), "C D E z |]\n%%vocalfont Times 14\nw: a b c");
  assert.equal(zero("C D E F |]\n \nw: a b c d", "F"), "C D E z |]\n \nw: a b c");
  assert.equal(zero("C D E F |]\nw: a b c d\n\t\nw: e f g h", "F"), "C D E z |]\nw: a b c\n\t\nw: e f g");
  assert.equal(zero("C D E F |]\n\nw: a b c d", "F"), "C D E z |]\n\nw: a b c d");
  // A note no verse reaches goes as before, past such a line too; and a line
  // taken out whole takes its verses, and leaves what stands between them.
  assert.equal(left(out("C D E F G |]\n% the words\nw: a b c d", "G", 4), "Delete G"), "C D E F |]\n% the words\nw: a b c d");
  const labelled = "C D E F |\nw: a b c d\n% two\nw: e f g h\nG A B c |]\nw: i j k l";
  const first = { from: at(labelled, "C D"), to: at(labelled, "F |") + 1 };
  assert.equal(left(MDM_BARS.pasteMusic(ABCJS, H + labelled, [{ over: [first], text: null }]), "the first line"), "% two\nG A B c |]\nw: i j k l");
  // A field between two lines of music hides no words.
  assert.equal(zero("C D E F |\nw: a b c d\nK:G\nG A B c |]\nw: e f g h", "D"), "C z E F |\nw: a c d\nK:G\nG A B c |]\nw: e f g h");
  // Read as abcjs's parse reads the lines (found by the third and fourth
  // readings): a field it ignores (`m:`), a comment with spaces before it,
  // the lines an `H:` takes, a text block and a line that starts with a
  // backslash, which it blanks, are read past; another tune (`X:`), a field
  // of a letter it reads as music (`J:`, `r:`) and what a `%%begintext`
  // takes are the end of the verses, the verse after them given to no note
  // of this line, and left as it is.
  for (const passed of ["m: x", "  % note", "\t%%vocalfont Times 14", "H:old\nmore history", "%%begintext\nsome text\n%%endtext", "\\latex line"]) {
    assert.equal(zero("C D E F |]\n" + passed + "\nw: a b c d", "F"), "C D E z |]\n" + passed + "\nw: a b c", passed);
  }
  for (const stop of ["X:2", "J:x", "r: a remark"]) {
    assert.equal(under("C D E F |]\n" + stop + "\nw: a b c d").slice(0, 7), "C D E F", stop);
    assert.equal(zero("C D E F |]\n" + stop + "\nw: a b c d", "F"), "C D E z |]\n" + stop + "\nw: a b c d", stop);
  }
  assert.equal(zero("C D E F |]\n%%begintext\nw: a b c d\n%%endtext", "F"), "C D E z |]\n%%begintext\nw: a b c d\n%%endtext");
  assert.equal(zero("C D E F |]\n%%begintext\nsome text\n\nw: a b c d", "F"), "C D E z |]\n%%begintext\nsome text\n\nw: a b c d");

  // What the engine reads otherwise than abcjs is refused, as every verse
  // was before; under Delete as well, and whatever the change is, one that
  // reaches no syllable too: where a verse is not read as abcjs reads it,
  // which notes it reaches is not known either (versesOf). A line of
  // symbols, under the music or among the verses, whose symbols abcjs gives
  // the notes as it gives syllables (E has `!p!`); a verse followed by `+:`,
  // which abcjs 6.7.0 reads as music.
  const refused = (body, needle) => MDM_BARS.writeNote(ABCJS, H + body, at(body, needle), { rest: true }).refused;
  assert.equal(under("C D E F |]\ns: !f! * !p!"), "C=!f! D E=!p! F");
  assert.equal(refused("C D E F |]\ns: !f!", "E"), "noteLyrics");
  assert.equal(refused("C D E F |]\ns: !f! * !p!", "E"), "noteLyrics");
  assert.equal(refused("C D E F |]\nw: a b c d\ns: !f!", "E"), "noteLyrics");
  assert.equal(refused("C D E F |]\nw: a b c d\n% a comment\ns: !f!", "E"), "noteLyrics");
  assert.equal(refused("C D E F |]\nw: a b c d\n+: e f", "E"), "noteLyrics");
  assert.equal(MDM_BARS.restMusic(ABCJS, H + "C D E F |]\nw: a b c d\n+: e f", [at("C D E F |]", "E")]).refused, "noteLyrics");
  // A verse carried on to the next line with a backslash, a comment after
  // it or not, is one verse to abcjs, and the engine reads its lines one at
  // a time. Found by the second reading: 0 on C took the `e` abcjs draws
  // under no note, and on D the backslash, read as a syllable there, which
  // made one verse two. Delete took them so as well, and now refuses them,
  // the rest under such a verse too.
  assert.equal(under("C D E F |]\nw: a b \\\nw: c d"), "C=a D=b E=c F=d");
  assert.equal(refused("C D E F |]\nw: a b \\\nw: c d", "E"), "noteLyrics");
  assert.equal(refused("C D E F |]\nw: a b \\ % on\nw: c d", "E"), "noteLyrics");
  assert.equal(refused("C D E F |]\nw: a b c d \\\nw: e f", "C"), "noteLyrics");
  assert.equal(refused("C D E z F |]\nw: a \\\nw: _ * * b", "D"), "noteLyrics");
  assert.equal(out("C D E F |]\nw: a b c d \\\nw: e f", "C", 0).refused, "noteLyrics");
  assert.equal(out("C D z F |]\nw: a b \\\nw: c", "z", 0).refused, "noteLyrics");
  // Refused also where the lines taken one at a time happen to come out as
  // abcjs reads them (0 on F would leave `w: a b c \ % c` over `w: e f`,
  // drawn as before but for F): a verse carried on is not read here at all.
  assert.equal(refused("C D E F |]\nw: a b c d \\ % c\nw: e f", "F"), "noteLyrics");
  // A backslash at the end of a comment is the comment's, and carries
  // nothing on: two verses to abcjs, and here.
  assert.equal(under("C D E F |]\nw: a b % note \\\nw: c d"), "C=a/c D=b/d E F");
  assert.equal(zero("C D E F |]\nw: a b % note \\\nw: c d", "D"), "C z E F |]\nw: a % note \\\nw: c");
  // A backslash inside a syllable is a letter of it and carries nothing
  // on. One before a percent sign makes a letter of the percent sign, where
  // the engine would read a comment and the line carried on: refused, as it
  // was.
  assert.equal(zero("C D E F |]\nw: a\\b c d e", "E"), "C D z F |]\nw: a\\b c e");
  assert.equal(refused("C D E F |]\nw: a b c\\%d e", "E"), "noteLyrics");
  assert.equal(refused("C D E F |]\nw: a b c\\%d e", "F"), "noteLyrics");
  // Two voices written inline on one line: abcjs reads the verse under it
  // against the last of them, and the engine against each, so for the first
  // it takes out a syllable of the second. The reading back finds the
  // second voice changed, and the change is refused with the reason it had;
  // on the second voice the syllable goes.
  const inline = "[V:1] C D E F | [V:2] c d e f |\nw: a b c d";
  assert.equal(under(inline), "C D E F c=a d=b e=c f=d");
  assert.equal(refused(inline, "D"), "noteLyrics");
  assert.equal(MDM_BARS.restMusic(ABCJS, H + inline, [at(inline, "D"), at(inline, "E")]).refused, "noteLyrics");
  assert.equal(zero(inline, "d"), "[V:1] C D E F | [V:2] c z e f |\nw: a c d");
  // And a rest is made no note under a verse, where the note would take
  // the syllable of the note after it, and where no syllable would move as
  // well: what a rest made a note gives the verse is not decided.
  const note = (body, needle) => MDM_BARS.writeNote(ABCJS, H + body, at(body, needle), { step: 4, duration: QUARTER }).refused;
  assert.equal(note("C z E F |]\nw: a b c", "z"), "noteLyrics");
  assert.equal(note("C D z2 |]\nw: a b", "z2"), "noteLyrics");
});

// Verses written with everything a verse read here is written with, under
// every kind of place (no verse carried on with a backslash, nothing between
// the verses: those are refused, above), and every place and stretch of them
// made rests: nothing in them is a thing to refuse, so nothing is refused;
// every note that stays keeps what it had, drawn as it was, and every one
// made a rest has nothing under it. Read apart from the module's own check,
// as the sweeps above are.
const SUNG_FIXTURES = {
  SONG: SONG,
  words: "X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c | d e f g |]\nw: hel-lo world_ _ Glo---ri-a of~the it\\-is\nw: * a | b c - d e f g h",
  marks: "X:1\nM:3/4\nL:1/4\nK:G\n|: G z [GB] | x A B | c2 z :|\nw: la_la * so | fa mi_ re\nw: | | one two",
  lines: "X:1\nM:4/4\nL:1/8\nK:D\nD2 F2 A2 d2 | c B A G F2 E2 |\nw: Sing a song of six-pence, a pock-et\nd4 z2 A2 | d6 z2 |]\nw: full of rye_ _\nw: and so on",
  duet: "X:1\nM:4/4\nL:1/4\nK:C\nV:1\nC D E F | G A B c |\nw: a b c d e f g h\nV:2 clef=bass\nC, D, E, F, | G, A, B, C |\nw: one two * four | five six\nV:1\nd e f g |]\nw: i j k\nV:2\nD E F G |]\nw: sev-en eight_",
};

test("a sweep of every place and every stretch of verses made rests: nothing refused, every note that stays drawn with the syllables it had, every note made a rest with none (2026-10-15)", () => {
  let made = 0;
  let sung = 0;
  // The notes and rests of each voice, the places a cursor stands on.
  const placesOf = (all) => {
    const voices = {};
    Object.keys(all).forEach((key) => {
      voices[key] = all[key].filter((el) => !el.rest || el.rest.type === "rest");
    });
    return voices;
  };
  const rows = (source) => {
    const out = {};
    ABCJS.parseOnly(source)[0].lines.forEach((line) => {
      (line.staff || []).forEach((staff, s) => {
        (staff.voices || []).forEach((voice, v) => {
          const list = out[s + "/" + v] || (out[s + "/" + v] = []);
          voice.forEach((el) => {
            if (el.el_type !== "note") return;
            const drawn = (el.lyric || []).map((l) => l.syllable + (l.divider === " " ? "" : l.divider));
            while (drawn.length && !drawn[drawn.length - 1]) drawn.pop();
            list.push({ rest: !!el.rest, type: el.rest ? el.rest.type : "", duration: el.duration, name: source.slice(el.startChar, el.endChar).trim(), drawn: drawn.join("/") });
          });
        });
      });
    });
    return out;
  };
  Object.keys(SUNG_FIXTURES).forEach((name) => {
    const source = SUNG_FIXTURES[name];
    const all = places(source);
    const voices = placesOf(all);
    const was = rows(source);
    Object.keys(voices).forEach((key) => {
      voices[key].forEach((first, index) => {
        [0, 1, 2, 3, 4, 6].forEach((span) => {
          // Nought is the one place, by the cursor (writeNote); a span is a
          // stretch of so many places (restMusic).
          const last = index + Math.max(span, 1) - 1;
          if (last >= voices[key].length) return;
          const stretch = voices[key].slice(index, last + 1);
          const label = [name, key, index, span].join(" ");
          const result = span ? MDM_BARS.restMusic(ABCJS, source, stretch.map((el) => el.startChar)) : MDM_BARS.writeNote(ABCJS, source, first.startChar, { rest: true });
          assert.equal(result.refused, undefined, label + ": refused: " + result.refused);
          if (result.same) {
            assert.ok(stretch.every((el) => el.rest), label + ": said to be the same with a note in it");
            return;
          }
          made++;
          const now = rows(result.source);
          assert.deepEqual(Object.keys(now).sort(), Object.keys(was).sort(), label);
          Object.keys(was).forEach((other) => {
            assert.equal(now[other].length, was[other].length, label + ": voice " + other + " has a place more or less");
            was[other].forEach((entry, i) => {
              const turned = other === key && stretch.indexOf(all[key][i]) >= 0 && !entry.rest;
              if (!turned) {
                assert.deepEqual([now[other][i].name, now[other][i].drawn], [entry.name, entry.drawn], label + ": voice " + other + ", place " + i);
                return;
              }
              assert.deepEqual([now[other][i].rest, now[other][i].type, now[other][i].duration, now[other][i].drawn], [true, "rest", entry.duration, ""], label + ": place " + i + " made a rest");
              if (entry.drawn) sung++;
            });
          });
        });
      });
    });
  });
  assert.ok(made > 300, "the sweep made rests only " + made + " times");
  assert.ok(sung > 600, "the sweep took only " + sung + " notes' syllables");
});

// ---------- A place taken out ----------

function out(source, needle, step, nth) {
  let at = -1;
  for (let i = 0; i <= (nth || 0); i++) at = source.indexOf(needle, at + 1);
  assert.ok(at >= 0, "no " + needle + " in the fixture");
  return MDM_BARS.takeOut(ABCJS, source, at, step);
}

// The owner's call of 2026-10-04: "cambia también el delete sobre una nota,
// que la borra en vez de poner un silencio", for Delete to take a note as it
// takes a stretch, 0 being the key that makes a rest of one. For two days
// before it a note left a rest as long. And of 2026-10-03: "Delete solo debe
// funcionar encima de C o G, no en un espacio vacío".
test("a note taken out at its head goes with the time it held, as a rest does, and nothing goes at a step it has no head at", () => {
  // A note, at the step of its head: it goes, with what was written on it,
  // and the bar is that much shorter.
  assert.equal(lastLine(out(COMMON + "C2 D2 z4 |", "D2", 1)), "C2 z4 |");
  assert.equal(lastLine(out(COMMON + "CDE z5 |", "D", 1)), "CE z5 |");
  assert.equal(lastLine(out(COMMON + 'C2 "Am"D2 E2 z2 |', '"Am"', 1)), "C2 E2 z2 |");
  // Out of a beam it leaves the beam's other notes as they were written.
  assert.equal(lastLine(out(COMMON + "CD EF G4 |", "D", 1)), "C EF G4 |");
  assert.equal(lastLine(out(COMMON + "CD EF G4 |", "E", 2)), "CD F G4 |");
  // At any other step there is nothing under the cursor to take out, on a
  // note as on a chord: the source as it was, and said to be the same.
  for (const [source, needle, step] of [
    [COMMON + "C2 D2 z4 |", "D2", -3],
    [COMMON + "C2 D2 z4 |", "D2", 2],
    [COMMON + "[CEG]2 D2 z4 |", "[", 5],
    [COMMON + "[CEG]2 D2 z4 |", "[", 1],
  ]) {
    const idle = out(source, needle, step);
    assert.deepEqual([idle.refused, idle.same, idle.source], [undefined, true, source], needle + " at " + step);
  }
  // Where the place that took its index begins, for the cursor.
  const note = out(COMMON + "C2 D2 z4 |", "D2", 1);
  assert.equal(note.source.slice(note.at, note.at + 3), "z4 ");
  // A rest, and its time with it.
  assert.equal(lastLine(out(COMMON + "C2 z2 D2 z2 |", "z2", 6)), "C2 D2 z2 |");
  assert.equal(lastLine(out(COMMON + "C2 D2 z4 |", "z4", 6)), "C2 D2 |");
  assert.equal(lastLine(out(COMMON + "C2 | z2 D2 |", "z2", 6)), "C2 | D2 |");
  assert.equal(lastLine(out(COMMON + 'C2 "G"z2 D2 |', '"G"', 6)), "C2 D2 |");
  assert.equal(lastLine(out(COMMON + "Cz D z z4 |", "z", 6)), "C D z z4 |");
  assert.equal(lastLine(out(COMMON + "C2 |z2 D2 |", "z2", 6)), "C2 | D2 |");
  // At the end of a line the space before it goes, and the next line stays.
  assert.equal(out(COMMON + "C2 z2\nD2 |", "z2", 6).source, COMMON + "C2\nD2 |");
  assert.equal(out(COMMON + "C2 D2 z2\nE2 |", "z2", 6).source, COMMON + "C2 D2\nE2 |");
  assert.equal(out(COMMON + "C2 D2z2 \nE2 |", "z2", 6).source, COMMON + "C2 D2\nE2 |");
  assert.equal(out(COMMON + "C2 D2\nE2 |", "D2", 1).source, COMMON + "C2\nE2 |");
  // Where the place that took its index begins, for the cursor: none past
  // the end of the voice.
  const after = out(COMMON + "C2 z2 D2 z2 |", "z2", 6);
  assert.equal(after.source.slice(after.at, after.at + 2), "D2");
  const barline = out(COMMON + "C2 D2 z4 | E8 |", "z4", 6);
  assert.equal(barline.source.slice(barline.at).trim().slice(0, 2), "E8");
  assert.equal(out(COMMON + "C2 D2 z4 |", "z4", 6).at, -1);
  assert.equal(out(COMMON + "C2 D2 E4 |", "E4", 2).at, -1);
});

test("on a chord, the head at the cursor's step goes and the chord stays as long, the cursor's place where it was", () => {
  const taken = out(COMMON + "[CEG]2 z6 |", "[", 2);
  assert.equal(lastLine(taken), "[CG]2 z6 |");
  assert.equal(taken.source.slice(taken.at, taken.at + 5), "[CG]2");
  assert.equal(lastLine(out(COMMON + "[CE]2 z6 |", "[", 0)), "E2 z6 |");
  // Each head as it was written, its accidental with it.
  assert.equal(lastLine(out(COMMON + "[^C=EG_B]2 z6 |", "[", 2)), "[^CG_B]2 z6 |");
  // A slur on a chord stays on it.
  assert.equal(lastLine(out(COMMON + "([ce]2 d2) z4 |", "[", 9)), "(c2 d2) z4 |");
});

// "Si hay un silencio que llena todo el compás y se da delete, el compás se
// borra" (the owner, 2026-10-02): the only place of a bar takes the bar, a
// rest and since 2026-10-04 a note as well.
test("a place that is all its bar takes the bar with it, and one of its barlines; a bar that is all its line takes the line", () => {
  const cases = [
    ["C8 | z8 | D8 |", "z8", "C8 | D8 |"],
    ["z8 | C8 | D8 |", "z8", "C8 | D8 |"],
    ["C8 | D8 | z8 |", "z8", "C8 | D8 |"],
    // The barline that ends the tune, or a repeat's, stays: the one before
    // the bar goes in its place.
    ["C8 | z8 |]", "z8", "C8 |]"],
    ["C8 | z8 :| D8 |", "z8", "C8 :| D8 |"],
    ["|: C8 | z8 :|", "z8", "|: C8 :|"],
    // A bar no barline closes goes alone.
    ["C8 | z8", "z8", "C8 |"],
    ["C8 | Z | E8 |", "Z", "C8 | E8 |"],
  ];
  for (const [line, needle, written] of cases) {
    const result = out(COMMON + line, needle, 6);
    assert.equal(lastLine(result), written, line);
    const total = (list) => list.reduce((x, y) => x + y, 0);
    assert.equal(total(layout(result.source)), total(layout(COMMON + line)) - 1, line);
  }
  // A note alone in its bar takes it as a rest does, at its head and at no
  // other step.
  const lone = out(COMMON + "C8 | D8 | E8 |", "D8", 1);
  assert.equal(lastLine(lone), "C8 | E8 |");
  assert.equal(lone.source.slice(lone.at).trim().slice(0, 2), "E8");
  assert.equal(out(COMMON + "C8 | D8 | E8 |", "D8", 4).same, true);
  assert.equal(lastLine(out(COMMON + "C8 | D8 |]", "D8", 1)), "C8 |]");
  assert.equal(out(COMMON + "C8 | D8 |\nE8 |\nF8 |", "E8", 2).source, COMMON + "C8 | D8 |\nF8 |");
  // A bar that is all of its line takes the line, and the next one stays.
  assert.equal(out(COMMON + "C8 | D8 |\nz8 |\nE8 |", "z8", 6).source, COMMON + "C8 | D8 |\nE8 |");
  assert.equal(out(COMMON + "C8 | D8 |\nz8 |", "z8", 6).source, COMMON + "C8 | D8 |");
  assert.equal(out(COMMON + "C8 | D8 |\n| z8 |\nE8 |", "z8", 6).source, COMMON + "C8 | D8 |\nE8 |");
  // The cursor goes on to the bar after it.
  const next = out(COMMON + "C8 | z8 | D8 |", "z8", 6);
  assert.equal(next.source.slice(next.at).trim().slice(0, 2), "D8");
  // Every voice of the line loses the bar, the rests of the others with it.
  const duet = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "C4 | z4 | D4 |", "V:2 clef=bass", "C,4 | z2 z2 | D,4 |"].join("\n");
  assert.equal(out(duet, "z4", 6).source, duet.replace("C4 | z4 |", "C4 |").replace("C,4 | z2 z2 |", "C,4 |"));
  // Asked from the lower voice, of one of its two rests, the rest goes.
  assert.equal(out(duet, "z2", 6).source, duet.replace("z2 z2", "z2"));
  // A note that is all its bar over a bar of rests takes it from both the
  // same.
  const sung = duet.replace("C4 | z4 | D4", "C4 | E4 | D4");
  assert.equal(out(sung, "E4", 2).source, sung.replace("C4 | E4 |", "C4 |").replace("C,4 | z2 z2 |", "C,4 |"));
  // Where another voice plays in the bar, that voice keeps it: the bar goes
  // from the place's own voice alone, which is a bar short of it after
  // (until 2026-10-04 that was refused, "Another voice plays here").
  const played = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "C4 | z4 | D4 |", "V:2 clef=bass", "C,4 | E,4 | D,4 |"].join("\n");
  assert.equal(out(played, "z4", 6).source, played.replace("C4 | z4 |", "C4 |"));
  const both = played.replace("C4 | z4 | D4", "C4 | E4 | D4");
  assert.equal(out(both, "E4", 2).source, both.replace("C4 | E4 |", "C4 |"));
  assert.equal(out(both, "E,4", 7).source, both.replace("C,4 | E,4 |", "C,4 |"));
  // With three voices, one of them playing is enough to keep it for all but
  // the place's own.
  const trio = played + "\nV:3\nG4 | z4 | A4 |";
  assert.equal(out(trio, "z4", 6).source, trio.replace("C4 | z4 |", "C4 |"));
  // A voice that cannot let the bar go refuses it for all, while none plays.
  const uneven = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "C4 | z4 | D4 |", "V:2", "C,4 |"].join("\n");
  assert.equal(out(uneven, "z4", 6).refused, "voices");
});

test("the score's only bar, a tie or a slur on the place, a place over a line of symbols, or what the reading back finds changed, is not taken out", () => {
  assert.equal(out(COMMON + "z8 |", "z8", 6).refused, "barOnly");
  assert.equal(out(COMMON + "C8 |", "C8", 0).refused, "barOnly");
  assert.equal(out(COMMON + "z8 |]", "z8", 6).refused, "barOnly");
  assert.equal(MDM_BARS.reasonText("barOnly"), "The score's only bar");
  // A repeat on either side of it, and no plain barline to take with it.
  assert.equal(out(COMMON + "C8 |: z8 :| D8 |", "z8", 6).refused, "noteUnsafe");
  // A field written inline in the bar.
  assert.equal(out(COMMON + "C8 | [K:G] z8 | D8 |", "z8", 6).refused, "noteUnsafe");
  assert.equal(out(COMMON + "C2- C2 z4 |", "C2-", 0).refused, "noteTie");
  assert.equal(out(COMMON + "C2- C2 z4 |", "C2 z4", 0).refused, "noteTie");
  // A slur would be left with one end, which abcjs draws as no slur: on a
  // note or a rest taken out, and on a note made a rest.
  assert.equal(out(COMMON + "(C2 D2) z4 |", "(C2", 0).refused, "noteSlur");
  assert.equal(out(COMMON + "(C2 D2) z4 |", "D2)", 1).refused, "noteSlur");
  assert.equal(out(COMMON + "(C2 z2) z4 |", "z2)", 6).refused, "noteSlur");
  assert.equal(write(COMMON + "(C2 D2) z4 |", "(C2", { rest: true }).refused, "noteSlur");
  assert.equal(MDM_BARS.reasonText("noteSlur"), "A slur starts or ends here");
  // A line of symbols under the place, or under a line its bar is all of:
  // read against the notes as a verse is, and not read here. (A verse gives
  // up what it had for the place: the test of that, below.)
  assert.equal(out(COMMON + "C2 D2 E2 F2 |\ns: !f! * !p! *", "D2", 1).refused, "noteLyrics");
  assert.equal(out(COMMON + "C8 |\nz8 |\ns: !f!\nD8 |", "z8", 6).refused, "noteLyrics");
  assert.equal(lastLine(out(COMMON + "C2 z2 E2 z2 |\nw: do mi", "z2", 6)), "w: do mi");
  // A rest or a note of a tuplet, whose count it is part of, and the long
  // note of a broken rhythm, which the short one is short by.
  assert.equal(out(COMMON + "(3CzE z2 z4 |", "zE", 6).refused, "noteUnsafe");
  assert.equal(out(COMMON + "(3CDE z2 z4 |", "DE", 1).refused, "noteUnsafe");
  assert.equal(out(COMMON + "C>D E2 z4 |", "C>", 0).refused, "noteUnsafe");
  assert.equal(out(COMMON + "C2 z2 E2 z2 & c8 |", "z2", 6).refused, "noteUnsafe");
  // Nothing to take out at a barline.
  assert.equal(out(COMMON + "C8 | D8 |", "|", 4).refused, "notePlace");
});

// Every place of every fixture, at steps on the staff and off it and at
// each of its own heads: refused for a reason of the engine's; or nothing,
// at a step a note has no head at; or a head of a chord gone and the chord
// as long; or the voice as it was without that place, every other voice as
// it was, and every line with the bars it had; or a bar gone with the place
// that was all of it, from its own voice, and from the others with nothing
// but rests where none of them plays in it.
test("a sweep of every place: refused, or nothing, a head gone, or a note, a rest or its bar gone, and nothing else", () => {
  // None for a verse under the place, which gives up what it had for it.
  const reasons = new Set(["noteUnsafe", "noteTie", "noteSlur", "barOnly", "voices"]);
  let heads = 0;
  let notes = 0;
  let rests = 0;
  let bars = 0;
  let alone = 0;
  let idle = 0;
  Object.keys(NOTE_FIXTURES).forEach((name) => {
    const [source] = NOTE_FIXTURES[name];
    const voices = places(source);
    const was = music(source);
    Object.keys(voices).forEach((key) => {
      voices[key].forEach((el, index) => {
        if (el.rest && !/^(?:rest|whole|multimeasure)$/.test(el.rest.type)) return;
        const own = el.rest ? [] : el.pitches.map((p) => p.verticalPos);
        new Set([-3, 2, 6, 11].concat(own)).forEach((step) => {
          const label = [name, key, index, step].join(" ");
          const result = MDM_BARS.takeOut(ABCJS, source, el.startChar, step);
          if (!el.rest && own.indexOf(step) < 0) {
            // No head at the step: nothing, whatever the place.
            assert.deepEqual([result.refused, result.same, result.source], [undefined, true, source], label);
            idle++;
            return;
          }
          if (result.refused) {
            assert.ok(reasons.has(result.refused), label + ": " + result.refused);
            return;
          }
          const now = music(result.source);
          assert.deepEqual(Object.keys(now).sort(), Object.keys(was).sort(), label);
          const entry = was[key].map((e, i) => i).filter((i) => !/^bar /.test(was[key][i]))[index];
          const others = () =>
            Object.keys(was).forEach((other) => {
              if (other !== key) assert.deepEqual(now[other], was[other], label + ": voice " + other + " changed");
            });
          if (own.length > 1) {
            // A head of a chord, the chord one head fewer and as long, and
            // nothing else changed.
            heads++;
            others();
            assert.equal(now[key].length, was[key].length, label);
            was[key].forEach((item, i) => {
              if (i !== entry) assert.equal(now[key][i], item, label + ": entry " + i + " changed");
            });
            const [pitches, length] = now[key][entry].split(" ");
            assert.equal(pitches.split(",").length, own.length - 1, label);
            assert.equal(Number(length), el.duration, label);
            assert.deepEqual(layout(result.source), layout(source), label);
            return;
          }
          if (now[key].length === was[key].length - 1) {
            // The place, a note or a rest, and nothing else.
            if (el.rest) rests++;
            else notes++;
            others();
            assert.deepEqual(now[key], was[key].slice(0, entry).concat(was[key].slice(entry + 1)), label);
            assert.deepEqual(layout(result.source), layout(source), label);
            return;
          }
          // A bar: the place and a barline gone from its own voice, and from
          // each of the others a run of rests and barlines, or nothing from
          // any of them.
          bars++;
          const run = (voice) => {
            const a = was[voice];
            const b = now[voice];
            const count = a.length - b.length;
            let x = 0;
            while (x < b.length && a[x] === b[x]) x++;
            assert.deepEqual(b, a.slice(0, x).concat(a.slice(x + count)), label + ": voice " + voice);
            return a.slice(x, x + count);
          };
          const mine = run(key);
          assert.ok(mine.indexOf(was[key][entry]) >= 0, label + ": the place stayed");
          assert.equal(mine.filter((item) => !/^bar /.test(item)).length, 1, label + ": more than the place went: " + mine.join(", "));
          assert.equal(mine.filter((item) => /^bar /.test(item)).length <= 1, true, label + ": more than one barline went");
          const rest = Object.keys(was).filter((voice) => voice !== key);
          const took = rest.filter((voice) => now[voice].length !== was[voice].length);
          if (took.length) {
            assert.equal(took.length, rest.length, label + ": the bar went from some voices and not from others");
            rest.forEach((voice) => {
              const lost = run(voice);
              lost.forEach((item) => assert.match(item, /^(?:bar |rest )/, label + ": voice " + voice + " lost " + item));
              assert.ok(lost.some((item) => /^bar /.test(item)), label + ": voice " + voice + " kept every barline");
            });
          } else {
            others();
            if (rest.length) alone++;
            // Its bars come up alone: the others are on the lines they were.
            rest.forEach((voice) => assert.deepEqual(barsBy(result.source)[voice], barsBy(source)[voice], label + ": the lines of voice " + voice + " changed"));
          }
          // One bar fewer in the first voice, when it is the place's own or
          // the bar went from them all.
          const total = (list) => list.reduce((p, q) => p + q, 0);
          const fewer = key === "0/0" || took.length ? 1 : 0;
          assert.equal(total(layout(result.source)), total(layout(source)) - fewer, label);
        });
      });
    });
  });
  assert.ok(heads > 50, "the sweep took only " + heads + " heads off");
  assert.ok(notes > 140, "the sweep took only " + notes + " notes out");
  assert.ok(idle > 650, "the sweep met only " + idle + " steps with no head");
  assert.ok(rests > 70, "the sweep took only " + rests + " rests out");
  assert.ok(bars > 30, "the sweep took only " + bars + " bars out");
  assert.ok(alone > 6, "the sweep took only " + alone + " bars from one voice of several");
});

// The check every place taken out passes, on its own: what it is handed is
// the plan takeOut makes (the elements of the system that go in each voice,
// and how many bars go from the line), and it lets through that and
// nothing else.
test("the check a place taken out passes lets that place or that bar go, and stops anything else", () => {
  const before = COMMON + "C2 z2 D2 z2 |";
  const plan = { key: "0/0", s: 0, voices: [{ key: "0/0", removed: [1] }], bars: 0 };
  const check = (after, with_) => MDM_BARS.verifyOut(ABCJS, before, after, with_ || plan);
  assert.equal(check(COMMON + "C2 D2 z2 |"), null);
  assert.equal(check(COMMON + "C2 z2 z2 |"), "noteUnsafe", "another place taken out");
  assert.equal(check(COMMON + "C2 D2 |"), "noteUnsafe", "two rests taken out");
  assert.equal(check(COMMON + "C2 D2 z |"), "noteUnsafe", "another rest changed");
  assert.equal(check(COMMON + "C2\nD2 z2 |"), "noteUnsafe", "a line broken");
  assert.equal(check(COMMON + "C2 D2 z2"), "noteUnsafe", "the barline taken out with it");
  // A note asked for goes as a rest does.
  const note = { key: "0/0", s: 0, voices: [{ key: "0/0", removed: [2] }], bars: 0 };
  assert.equal(check(COMMON + "C2 z2 z2 |", note), null);
  assert.equal(check(COMMON + "C2 D2 z2 |", note), "noteUnsafe", "the rest before it taken out for it");
  // A bar: its place and its barline, and one bar fewer on its line.
  const three = COMMON + "C8 | z8 | D8 |";
  const bar = { key: "0/0", s: 0, voices: [{ key: "0/0", removed: [2, 3] }], bars: 1 };
  const barCheck = (after, with_) => MDM_BARS.verifyOut(ABCJS, three, after, with_ || bar);
  assert.equal(barCheck(COMMON + "C8 | D8 |"), null);
  assert.equal(barCheck(COMMON + "C8 | | D8 |"), "noteUnsafe", "the barline kept");
  assert.equal(barCheck(COMMON + "C8 | D8 | z8 |"), "noteUnsafe", "a bar put back elsewhere");
  assert.equal(barCheck(COMMON + "C8 |\nD8 |"), "noteUnsafe", "a line broken");
  assert.equal(barCheck(COMMON + "C8 | E8 |"), "noteUnsafe", "a note changed");
  assert.equal(barCheck(COMMON + "C8 | D8 |", Object.assign({}, bar, { bars: 0 })), "noteUnsafe", "a bar gone that was not to go");
  // A bar with a note in it goes the same.
  const notes = COMMON + "C8 | E8 | D8 |";
  assert.equal(MDM_BARS.verifyOut(ABCJS, notes, COMMON + "C8 | D8 |", bar), null);
  // Anything but notes, rests and barlines is not its to take.
  const parts = "X:1\nM:4/4\nL:1/8\nK:C\nC8 | [P:B] D8 |";
  assert.equal(MDM_BARS.verifyOut(ABCJS, parts, "X:1\nM:4/4\nL:1/8\nK:C\nC8 | D8 |", { key: "0/0", s: 0, voices: [{ key: "0/0", removed: [2] }], bars: 0 }), "noteUnsafe");
});

// ---- The barlines of a line kept together (evenBars) ----

// A voice of a parsed tune as its lengths: a note or a rest by how long it
// lasts, the rest evenBars puts in as `x`, a barline as `|`.
function lengths(tune) {
  const out = {};
  tune.lines.forEach((line, l) => {
    (line.staff || []).forEach((staff, s) => {
      staff.voices.forEach((voice, v) => {
        out[l + ":" + s + "/" + v] = voice
          .map((el) => {
            if (el.el_type === "bar") return "|";
            if (el.el_type !== "note") return "";
            return (el.rest && el.rest.type === "invisible" ? "x" : "") + el.duration;
          })
          .filter(Boolean)
          .join(" ");
      });
    });
  });
  return out;
}
const evened = (source) => lengths(MDM_BARS.evenBars(ABCJS.parseOnly(source)[0]));
const asRead = (source) => lengths(ABCJS.parseOnly(source)[0]);

test("a bar shorter in one voice than in the others is given the time it is missing as a rest that is not drawn, before its barline", () => {
  // The organ score the README's take of the mode is recorded on, with a
  // half note written over the pedal's whole rest: what the take showed for
  // a second on 2026-10-05, the pedal's final barline under the third beat.
  const organ = ["X:1", "%%score {RH LH} Ped", "M:4/4", "L:1/4", "K:D", "V:RH", "f e d2 | e4 |]", "V:LH clef=bass", "A, G, F,2 | B,2 A,2 |]", "V:Ped clef=bass", "D,4 | G,,2 |]"].join("\n");
  assert.deepEqual(evened(organ), {
    "0:0/0": "0.25 0.25 0.5 | 1 |",
    "0:1/0": "0.25 0.25 0.5 | 0.5 0.5 |",
    "0:2/0": "1 | 0.5 x0.5 |",
  });
  // The rest stands where the barline does and takes no character of the
  // text, so nothing that reads the source by an element's place finds it.
  const tune = MDM_BARS.evenBars(ABCJS.parseOnly(organ)[0]);
  const pedal = tune.lines[0].staff[2].voices[0];
  const put = pedal.filter((el) => el.rest && el.rest.type === "invisible")[0];
  const barline = pedal[pedal.indexOf(put) + 1];
  assert.equal(barline.el_type, "bar");
  assert.deepEqual([put.startChar, put.endChar], [barline.startChar, barline.startChar]);
  assert.equal(organ.slice(barline.startChar, barline.endChar), "|]");

  // A bar too long in one voice: the others are given the time it runs over.
  const over = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f g | a4 |", "V:2", "C D E F | G4 |"].join("\n");
  assert.deepEqual(evened(over), { "0:0/0": "0.25 0.25 0.25 0.25 0.25 | 1 |", "0:1/0": "0.25 0.25 0.25 0.25 x0.25 | 1 |" });

  // An empty bar between two barlines, and a bar the tuplet of which is
  // counted by what it lasts: three eighths in the time of two.
  const empty = ["X:1", "M:2/4", "L:1/8", "K:C", "V:1", "(3cde f2 | g4 |", "V:2", "C4 | |"].join("\n");
  assert.deepEqual(evened(empty), { "0:0/0": "0.125 0.125 0.125 0.25 | 0.5 |", "0:1/0": "0.5 | x0.5 |" });

  // A voice laid over another with `&` is a voice like the others: short,
  // it is filled, and so is the voice it is laid over.
  const laid = ["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d & e2 | e4 |", "V:2", "C4 | G4 |"].join("\n");
  assert.deepEqual(evened(laid), { "0:0/0": "0.25 0.25 x0.5 | 1 |", "0:0/1": "0.5 x0.5 | x1 |", "0:1/0": "1 | 1 |" });

  // The meter is the one the line above was under when the line names none.
  const lines = ["X:1", "M:3/4", "L:1/4", "K:C", "V:1", "c d e |", "f g a |", "V:2", "C3 |", "F |"].join("\n");
  assert.deepEqual(evened(lines), { "0:0/0": "0.25 0.25 0.25 |", "0:1/0": "0.75 |", "1:0/0": "0.25 0.25 0.25 |", "1:1/0": "0.25 x0.5 |" });
});

test("bars that are as their voices mean them are left as abcjs reads them: an upbeat, two meters, one voice, and a line whose voices cannot be counted against each other", () => {
  const same = (source) => assert.deepEqual(evened(source), asRead(source), source);
  // An upbeat and the bar that completes it, short in every voice alike.
  same(["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c | d e f g | a3 |]", "V:2", "C | D E F G | A3 |]"].join("\n"));
  // A change of meter inside the line, in both voices: bars of two lengths,
  // each the length its meter gives it.
  same(["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | [M:3/4] f g a |", "V:2", "C D E F | [M:3/4] G A B |"].join("\n"));
  // Two voices under two meters, where abcjs holds both: the change written
  // inside the line of one of them.
  same(["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | [M:3/4] f g a |", "V:2", "C D E F | G A B c |"].join("\n"));
  // One voice has nobody to keep its barlines with.
  same(["X:1", "M:4/4", "L:1/4", "K:C", "c d | e4 |"].join("\n"));
  // Voices that do not close the same number of bars on the line, and a
  // voice with a rest of several bars.
  same(["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d | e4 | f4 |", "V:2", "C4 | G4 |"].join("\n"));
  same(["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d | e4 |", "V:2", "Z2 | G4 |"].join("\n"));
  // A voice laid over another with `&` is one more voice of the line, and
  // a full bar of it is a full bar.
  same(["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f & e4 | e4 |", "V:2", "C4 | G4 |"].join("\n"));
  // What follows a line's last barline is closed by none, and is left.
  same(["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "c d e f | g2", "V:2", "C4 | G"].join("\n"));
  // A barline at the head of one voice and not of the other closes no bar.
  assert.deepEqual(evened(["X:1", "M:4/4", "L:1/4", "K:C", "V:1", "|: c d e f | g2 :|", "V:2", "C4 | G4 |"].join("\n"))["0:0/0"], "| 0.25 0.25 0.25 0.25 | 0.5 x0.5 |");
});

// What cannot be told apart, and is read as bars ill filled. abcjs 6.7.0
// keeps no meter a voice names for itself at the head of its line: with no
// M: in the header it keeps none at all, and with one it gives every staff
// the header's (measured here). So two voices written under two meters that
// way, with as many bars each, look like one meter and bars of the wrong
// length, and the shorter is filled. The music then has one voice ending
// bars before the other, which no score means; the test is here so that the
// limit is on record and a change of it is seen.
test("two meters named at the heads of two voices are not told from bars ill filled, since abcjs keeps neither", () => {
  const two = ["X:1", "L:1/4", "K:C", "V:1", "[M:3/4] c d e | f g a |", "V:2", "[M:4/4] C D E F | G A B c |"].join("\n");
  const tune = ABCJS.parseOnly(two)[0];
  assert.deepEqual(
    tune.lines[0].staff.map((staff) => staff.meter),
    [undefined, undefined]
  );
  assert.deepEqual(evened(two), { "0:0/0": "0.25 0.25 0.25 x0.25 | 0.25 0.25 0.25 x0.25 |", "0:1/0": "0.25 0.25 0.25 0.25 | 0.25 0.25 0.25 0.25 |" });
});

// What Delete would take of a stretch, said without making the cut. The
// owner's rule for what a stretch chosen wears, 2026-10-06: "que se señale
// en latón todo lo que de apretar Delete será borrado". The drawing asks at
// every step of the cursor, so cutTakes reads nothing back, and says what
// the cut reaches for where the cut itself is then refused.
test("what a cut would take is named as the cut takes it: what is written from the first place to the last, the barline that goes with whole bars, a line that goes whole, the syllables in the verses under them; in every voice at once, on the source as it is; and also where the cut is then refused for what it would leave", () => {
  const H = "X:1\nM:4/4\nL:1/4\nK:C\n";
  // A stretch on one line: from where `first` is written to the end of the
  // next `last` after it.
  const over = (source, first, last) => {
    const from = source.indexOf(first);
    assert.ok(from >= 0, "no " + first + " in the fixture");
    return { from: from, to: source.indexOf(last, from) + last.length };
  };
  const takes = (source, overs) => MDM_BARS.cutTakes(ABCJS, source, overs);
  const cut = (source, overs) => MDM_BARS.pasteMusic(ABCJS, source, overs.map((slices) => ({ over: slices, text: null })));
  // The text of each run named, and the source with the runs taken out.
  const named = (source, overs) => takes(source, overs).taken.map((run) => source.slice(run.from, run.to));
  const without = (source, overs) => {
    let out = source;
    takes(source, overs)
      .taken.slice()
      .sort((a, b) => b.from - a.from)
      .forEach((run) => {
        out = out.slice(0, run.from) + out.slice(run.to);
      });
    return out;
  };
  // The cut may leave a space where two notes it was written between would
  // be beamed: the two are the same but for the spaces.
  const bare = (text) => text.replace(/[ \t]/g, "");
  const same = (source, overs) => assert.equal(bare(without(source, overs)), bare(cut(source, overs).source));

  const three = H + "C E G c | e f g a | c' b a g |]";
  // Part of two bars: the notes, and the barline between them.
  assert.deepEqual(named(three, [[over(three, "c |", "e")]]), ["c | e "]);
  same(three, [[over(three, "c |", "e")]]);
  // Whole bars go with the barline that closes them, and where that one is
  // not a plain barline, with the one before them.
  assert.deepEqual(named(three, [[over(three, "e f", "a")]]), ["e f g a | "]);
  same(three, [[over(three, "e f", "a")]]);
  assert.deepEqual(named(three, [[over(three, "C E", "c")]]), ["C E G c | "]);
  assert.deepEqual(named(three, [[over(three, "c' b", "a g")]]), [" | c' b a g"]);
  same(three, [[over(three, "c' b", "a g")]]);
  // A line that is all inside the stretch goes with its end.
  const two = H + "C E G c |\ne f g a |]";
  assert.deepEqual(named(two, [[over(two, "C E", "c")]]), ["C E G c |\n"]);
  same(two, [[over(two, "C E", "c")]]);
  // A stretch over two lines of a voice is a run a line.
  const lines = H + "C E G c | e f g a |\nc' b a g | f e d c |]";
  const wrapped = [[over(lines, "g a |", "a"), over(lines, "c' b", "b")]];
  assert.deepEqual(named(lines, wrapped), ["g a ", "c' b "]);
  same(lines, wrapped);
  // Two voices: each one's run is where it stands in the source as it is,
  // though the cut is made one voice after the other.
  const duet = H + "V:1\nc d e f | g a b c' |\nV:2\nC D E F | G A B c |";
  const bars = [[over(duet, "g a", "c'")], [over(duet, "G A", "c")]];
  assert.deepEqual(named(duet, bars), [" g a b c' |", " G A B c |"]);
  same(duet, bars);
  assert.deepEqual(named(duet, bars.slice().reverse()), [" G A B c |", " g a b c' |"]);
  const parts = [[over(duet, "d e", "e")], [over(duet, "D E", "E")]];
  assert.deepEqual(named(duet, parts), ["d e ", "D E "]);
  same(duet, parts);
  // The syllables of the notes that go, each run in the verse it is
  // written in; a verse left with nothing, its line; and under a line that
  // goes whole, every verse.
  const verse = H + "C D E F | G A B c |]\nw: a b c\nw: one two three four five six sev-en";
  assert.deepEqual(named(verse, [[over(verse, "D E", "E")]]), ["D E ", " b c", "two three "]);
  same(verse, [[over(verse, "D E", "E")]]);
  assert.deepEqual(named(verse, [[over(verse, "C D", "F")]]), ["C D E F | ", "w: a b c\n", "one two three four "]);
  same(verse, [[over(verse, "C D", "F")]]);
  // A star left at the head of a verse is no part of the run before it.
  const starred = H + "C D E F |]\nw: la * fa so";
  assert.deepEqual(named(starred, [[over(starred, "C D", "C")]]), ["C ", "la "]);
  const sung = H + "C D E F |\nw: one two three four\nw: a b\nG A B c |]";
  assert.deepEqual(named(sung, [[over(sung, "C D", "F")]]), ["C D E F |\n", "w: one two three four\nw: a b\n"]);
  same(sung, [[over(sung, "C D", "F")]]);
  // What the cut would be refused for once made is named all the same:
  // half a slur, a key written inside.
  const slur = H + "c (a b) c' | g a b c' |]";
  assert.equal(cut(slur, [[over(slur, "(a", "a")]]).refused, "noteSlur");
  assert.deepEqual(named(slur, [[over(slur, "(a", "a")]]), ["(a "]);
  const keyed = H + "C D [K:G] E F | G4 |]";
  assert.equal(cut(keyed, [[over(keyed, "D [", "E")]]).refused, "noteUnsafe");
  assert.deepEqual(named(keyed, [[over(keyed, "D [", "E")]]), ["D [K:G] E "]);
  // And what is no cut at all has no run to name: a stretch that is not
  // found, whole bars with a field written in them, a line of symbols
  // under the stretch, no engine to read with. One voice refused, and
  // nothing is named of the others.
  assert.deepEqual(takes(three, [[{ from: 2, to: 4 }]]), { refused: "notePlace" });
  assert.deepEqual(takes(three, [[]]), { refused: "notePlace" });
  assert.deepEqual(takes(keyed, [[over(keyed, "C D", "F")]]), { refused: "noteUnsafe" });
  const signed = H + "C D E F |\ns: !f! * !p! *\nG A B c |]";
  assert.deepEqual(takes(signed, [[over(signed, "D E", "E")]]), { refused: "noteLyrics" });
  const both = H + "C D E F |\nw: a b c d\ns: !f! * !p! *\nG A B c |]";
  assert.deepEqual(takes(both, [[over(both, "D E", "E")]]), { refused: "noteLyrics" });
  assert.deepEqual(takes(duet, [[over(duet, "d e", "e")], [{ from: 2, to: 4 }]]), { refused: "notePlace" });
  assert.deepEqual(MDM_BARS.cutTakes(null, three, [[over(three, "e f", "a")]]), { refused: "engine" });
  assert.deepEqual(takes(three, []), { taken: [] });
});

// The owner's call of 2026-10-06 for Delete, on a stretch whose syllables
// had been left in the score's ink because Delete left them: "el delete debe
// borrarlo todo por lo que debe marcarse todo lo que se borra". Until then a
// place taken out from over a verse was refused ("Lyrics can't make room"),
// but for the last place of a line, which went and left its syllable
// written under nothing.
test("what is taken out takes what the verses under it gave it: a syllable with its note, a star or a hold with the place that took it, a | with its barline, the verses of a line that goes whole; and every note that stays keeps what it had", () => {
  const H = "X:1\nM:4/4\nL:1/4\nK:C\n";
  const slicesOn = (source, pairs) =>
    pairs.map(([first, last]) => {
      const from = source.indexOf(first);
      assert.ok(from >= 0, "no " + first + " in the fixture");
      return { from: from, to: source.indexOf(last, from) + last.length };
    });
  // A stretch taken out, from where `first` is written to the end of the
  // next `last`, a pair a line; and the place at `needle`, by the key that
  // takes one place out.
  const stretch = (body, pairs) => MDM_BARS.pasteMusic(ABCJS, H + body, [{ over: slicesOn(H + body, pairs), text: null }]);
  const place = (body, needle, step) => MDM_BARS.takeOut(ABCJS, H + body, (H + body).indexOf(needle), step);
  const left = (result, label) => {
    assert.equal(result.refused, undefined, label + ": refused: " + result.refused);
    return result.source.slice(H.length);
  };
  // What abcjs draws under each note and rest, verse by verse, read here
  // and not by the engine.
  const under = (body) => {
    const out = [];
    ABCJS.parseOnly(H + body)[0].lines.forEach((line) => {
      (line.staff || []).forEach((staff) => {
        (staff.voices || []).forEach((voice) => {
          voice.forEach((el) => {
            if (el.el_type !== "note") return;
            const rows = (el.lyric || []).map((l) => l.syllable + (l.divider === " " ? "" : l.divider));
            while (rows.length && !rows[rows.length - 1]) rows.pop();
            out.push((el.rest ? "z" : (H + body).slice(el.startChar, el.endChar).trim()) + (rows.length ? "=" + rows.join("/") : ""));
          });
        });
      });
    });
    return out.join(" ");
  };
  const cut = (body, pairs) => left(stretch(body, pairs), body);

  // A syllable goes with its note, from the middle of a verse, from its
  // head and from its end, and the others stay under the notes they were
  // under.
  const eight = "C D E F | G A B c |]\nw: one two three four five six sev-en";
  assert.equal(under(eight), "C=one D=two E=three F=four G=five A=six B=sev- c=en");
  assert.equal(cut(eight, [["D E", "E"]]), "C F | G A B c |]\nw: one four five six sev-en");
  assert.equal(under(cut(eight, [["D E", "E"]])), "C=one F=four G=five A=six B=sev- c=en");
  assert.equal(cut(eight, [["C D", "C"]]), "D E F | G A B c |]\nw: two three four five six sev-en");
  assert.equal(cut(eight, [["B c", "c"]]), "C D E F | G A |]\nw: one two three four five six");
  // Whole bars, and the barline that goes with them.
  assert.equal(cut(eight, [["C D", "F"]]), "G A B c |]\nw: five six sev-en");
  assert.equal(cut(eight, [["G A", "c"]]), "C D E F |]\nw: one two three four");
  // Half a word: the half that stays is left as it was written, with its
  // hyphen, and apart from the word after it.
  const word = "C D E F |]\nw: hel-lo world now";
  assert.equal(cut(word, [["D E", "D"]]), "C E F |]\nw: hel- world now");
  assert.equal(cut(word, [["C D", "C"]]), "D E F |]\nw: lo world now");
  // More syllables than notes: the ones no note takes stay as they were,
  // under no note. Fewer: nothing to go.
  assert.equal(cut("C D E F |]\nw: one two three four five six", [["D E", "E"]]), "C F |]\nw: one four five six");
  assert.equal(under(cut("C D E F |]\nw: one two three four five six", [["D E", "E"]])), "C=one F=four");
  assert.equal(cut("C D E F |]\nw: one", [["D E", "E"]]), "C F |]\nw: one");
  // A word of two, and a hyphen that is no divider.
  assert.equal(cut("C D E F |]\nw: of~the one\\-two three four", [["D E", "D"]]), "C E F |]\nw: of~the three four");

  // A syllable held over a note with `_`: the note it is held over goes
  // with its `_`, and the syllable is drawn without it, the one thing a
  // note that stays is let change; the note with the syllable goes and the
  // hold stays for the note it was for, which had nothing under it and
  // still has not.
  const held = "C D E F |]\nw: la_ fa so";
  assert.equal(under(held), "C=la_ D E=fa F=so");
  assert.equal(cut(held, [["D E", "D"]]), "C E F |]\nw: la fa so");
  assert.equal(under(cut(held, [["D E", "D"]])), "C=la E=fa F=so");
  assert.equal(cut(held, [["C D", "C"]]), "D E F |]\nw: _ fa so");
  assert.equal(under(cut(held, [["C D", "C"]])), "D E=fa F=so");
  // Written against the next word, the two are left apart; and so is a
  // word that ends on a hyphen written with a backslash, which is a letter
  // of it and no divider.
  assert.equal(cut("C D E F |]\nw: la_fa so", [["D E", "D"]]), "C E F |]\nw: la fa so");
  assert.equal(cut("C D E F |]\nw: la\\-_fa so", [["D E", "D"]]), "C E F |]\nw: la\\- fa so");
  assert.equal(under(cut("C D E F |]\nw: la\\-_fa so", [["D E", "D"]])), "C=la- E=fa F=so");
  // Hyphens that skip a note each, one of several and one alone; and one
  // that would be left at the head of the verse, where abcjs reads it as
  // nothing, is written as the star it was read as.
  assert.equal(cut("C D E F G |]\nw: Glo---ri-a", [["D E", "D"]]), "C E F G |]\nw: Glo--ri-a");
  assert.equal(under(cut("C D E F G |]\nw: Glo---ri-a", [["D E", "D"]])), "C=Glo- E F=ri- G=a");
  assert.equal(cut("C D E F |]\nw: la - fa so", [["D E", "D"]]), "C E F |]\nw: la fa so");
  assert.equal(cut("C D E F |]\nw: la fa - so", [["D E", "D"]]), "C E F |]\nw: la - so");
  assert.equal(under(cut("C D E F |]\nw: la fa - so", [["D E", "D"]])), "C=la- E F=so");
  assert.equal(cut("C D E F |]\nw: la - fa so", [["C D", "C"]]), "D E F |]\nw: * fa so");
  assert.equal(under(cut("C D E F |]\nw: la - fa so", [["C D", "C"]])), "D E=fa F=so");

  // A star goes with the note or the rest that took it, and a rest that
  // took nothing takes nothing with it.
  assert.equal(cut("C z E F |]\nw: do * mi fa", [["z E", "z"]]), "C E F |]\nw: do mi fa");
  assert.equal(cut("C z E F |]\nw: do mi fa", [["z E", "z"]]), "C E F |]\nw: do mi fa");
  // A `|` goes with its barline. The notes it was waited for over, after
  // the bar's last syllable, would be offered the syllable after it: a
  // star is written for each to take in its place.
  const barred = "C D E | F G |]\nw: la | fa so";
  assert.equal(under(barred), "C=la D E F=fa G=so");
  assert.equal(cut(barred, [["E |", "F"]]), "C D G |]\nw: la * so");
  assert.equal(under(cut(barred, [["E |", "F"]])), "C=la D G=so");
  // The bar after it goes with the barline that opens it, the one that
  // closes it being the tune's: the verse ends where the run stood, and no
  // star is owed.
  assert.equal(cut(barred, [["F G", "G"]]), "C D E |]\nw: la");
  // But where a verse under it gives those notes a syllable: a note's
  // verses are counted by the ones that reach it, and without its star the
  // second verse would be drawn as the first.
  const stacked = barred + "\nw: a b c d e";
  assert.equal(under(stacked), "C=la/a D=/b E=/c F=fa/d G=so/e");
  assert.equal(cut(stacked, [["F G", "G"]]), "C D E |]\nw: la * *\nw: a b c");
  assert.equal(under(cut(stacked, [["F G", "G"]])), "C=la/a D=/b E=/c");
  assert.equal(cut(stacked, [["E |", "F"]]), "C D G |]\nw: la * so\nw: a b e");
  // Not where the verse under it gives them a star and no syllable, nor
  // where the verse with syllables for them is the one above.
  assert.equal(cut(barred + "\nw: a * * d e", [["F G", "G"]]), "C D E |]\nw: la\nw: a * *");
  assert.equal(cut("C D E | F G |]\nw: a b c d e\nw: la | fa so", [["F G", "G"]]), "C D E |]\nw: a b c\nw: la");
  // The star stands apart from the syllable before it, where the `|` that
  // went was written against that one.
  assert.equal(cut("C D E | F G |]\nw: la|fa so", [["E |", "F"]]), "C D G |]\nw: la * so");
  // A rest among them takes no syllable and is owed no star; but before a
  // note that is owed one it has its own, a star going to the first note
  // or rest it is offered to.
  assert.equal(cut("C z E | F G |]\nw: la | fa so", [["E |", "F"]]), "C z G |]\nw: la so");
  assert.equal(cut("C z D E | F G |]\nw: la | fa so", [["E |", "F"]]), "C z D G |]\nw: la * * so");
  assert.equal(under(cut("C z D E | F G |]\nw: la | fa so", [["E |", "F"]])), "C=la z D G=so");
  // A rest before what goes is offered the star after it, and a barline
  // the `|`: each is given one of its own.
  assert.equal(cut("z C D E |]\nw: la * fa", [["C D", "C"]]), "z D E |]\nw: * * fa");
  assert.equal(under(cut("z C D E |]\nw: la * fa", [["C D", "C"]])), "z D E=fa");
  assert.equal(cut("C | D E | F |]\nw: la mi | fa", [["D E", "D"]]), "C | E | F |]\nw: la | | fa");
  assert.equal(under(cut("C | D E | F |]\nw: la mi | fa", [["D E", "D"]])), "C=la E F=fa");

  // A verse left with nothing goes, line and all, and the verse under it
  // is then the first, as it was for the notes the first never reached.
  assert.equal(cut("C D E F |]\nw: one two", [["C D", "D"]]), "E F |]");
  assert.equal(cut("C D E F |]\nw: one two\nw: a b c d", [["C D", "D"]]), "E F |]\nw: c d");
  assert.equal(under(cut("C D E F |]\nw: one two\nw: a b c d", [["C D", "D"]])), "E=c F=d");
  // A line that goes whole takes its verses, the first line of the score
  // and the last; and a stretch over two lines, each line's own.
  // (The second verse has a syllable no note takes: it goes with the line,
  // and stays where the line does.)
  const two = "C D E F |\nw: one two three four\nw: a b c d e\nG A B c |]\nw: five six sev-en";
  assert.equal(cut(two, [["C D", "F"]]), "G A B c |]\nw: five six sev-en");
  assert.equal(cut(two, [["G A", "c"]]), "C D E F |\nw: one two three four\nw: a b c d e");
  assert.equal(cut(two, [["E F", "F"], ["G A", "A"]]), "C D |\nw: one two\nw: a b e\nB c |]\nw: sev-en");

  // Two voices at once, each with a verse: the second is cut on the source
  // the first left, its place carried past the syllables that went, and
  // the cursor of each comes onto the note after what went.
  const duet = H + "V:1\nc d e f |\nw: a b c d\nV:2\nC D E F |\nw: e f g h";
  const both = MDM_BARS.pasteMusic(ABCJS, duet, [
    { over: slicesOn(duet, [["d e", "e"]]), text: null },
    { over: slicesOn(duet, [["D E", "E"]]), text: null },
  ]);
  assert.equal(both.source, H + "V:1\nc f |\nw: a d\nV:2\nC F |\nw: e h");
  assert.deepEqual(both.after.map((at) => both.source.slice(at, at + 1)), ["f", "F"]);

  // One place taken out by its key: a note of the middle, the last of the
  // line (which until this went and left its syllable), a rest with its
  // star.
  assert.equal(left(place("C D E F |\nw: do re mi fa", "D", 1), "a note"), "C E F |\nw: do mi fa");
  assert.equal(left(place("C D E F |\nw: do re mi fa", "F", 3), "the last note"), "C D E |\nw: do re mi");
  assert.equal(left(place("C z E z |\nw: do * mi", "z", 6), "a rest"), "C E z |\nw: do mi");
  assert.equal(left(place("C D E F |\nw: la_ fa so", "D", 1), "the note a syllable is held over"), "C E F |\nw: la fa so");
  // The place that is all of its bar takes the bar: a note with its
  // syllable, a rest with the `|` its barline took, and a line that is one
  // bar with the verses under it.
  assert.equal(left(place("C4 | E4 | D4 |\nw: a e d", "E4", 2), "a bar of one note"), "C4 | D4 |\nw: a d");
  assert.equal(left(place("C4 | z4 | D4 |\nw: a | | b", "z4", 6), "a bar of rest"), "C4 | D4 |\nw: a | b");
  assert.equal(left(place("C4 | E4 | D4 |\nw: a_ d", "E4", 2), "a bar a syllable is held over"), "C4 | D4 |\nw: a d");
  assert.equal(left(place("C4 |\nE4 |\nw: e and more\nw: f\nD4 |", "E4", 2), "a line of one bar"), "C4 |\nD4 |");

  // The reading back, put to work on its own: a note that stays may be
  // drawn with its syllable divided from the next otherwise than it was
  // only where the plan names it, and nowhere else.
  const was = H + "C D E F |]\nw: la_ fa so";
  const now = H + "C E F |]\nw: la fa so";
  const paste = (eased) => MDM_BARS.verifyPaste(ABCJS, was, now, { key: "0/0", s: 0, first: 1, side: "before", gone: [{ s: 0, e: 1 }], eased: eased, music: false });
  assert.equal(paste([{ s: 0, e: 0 }]).refused, undefined);
  assert.equal(paste([]).refused, "noteUnsafe");
  assert.equal(paste([{ s: 0, e: 2 }]).refused, "noteUnsafe");
  const out = (eased) => MDM_BARS.verifyOut(ABCJS, was, now, { s: 0, key: "0/0", voices: [{ key: "0/0", removed: [1], eased: eased }], bars: 0 });
  assert.deepEqual([out([0]), out([]), out([2])], [null, "noteUnsafe", "noteUnsafe"]);
  // And never with another syllable under it.
  assert.equal(MDM_BARS.verifyPaste(ABCJS, was, H + "C E F |]\nw: li fa so", { key: "0/0", s: 0, first: 1, side: "before", gone: [{ s: 0, e: 1 }], eased: [{ s: 0, e: 0 }], music: false }).refused, "noteUnsafe");
  assert.equal(MDM_BARS.verifyOut(ABCJS, was, H + "C E F |]\nw: li fa so", { s: 0, key: "0/0", voices: [{ key: "0/0", removed: [1], eased: [0] }], bars: 0 }), "noteUnsafe");
  // A place taken out leaves the voice that much shorter and no more, nor
  // less: a note more at its end, or one fewer.
  const one = { s: 0, key: "0/0", voices: [{ key: "0/0", removed: [1] }], bars: 0 };
  assert.deepEqual([MDM_BARS.verifyOut(ABCJS, H + "C D E F", H + "C E F", one), MDM_BARS.verifyOut(ABCJS, H + "C D E F", H + "C E F G", one), MDM_BARS.verifyOut(ABCJS, H + "C D E F", H + "C E", one)], [null, "noteUnsafe", "noteUnsafe"]);

  // Every stretch of one place, of two and of four, and every place, of
  // scores whose verses hold every kind of piece: none is refused for the
  // verse, and each note that stays has under it the syllables it had,
  // read here apart from the engine's own check (how each is divided from
  // the next aside, which the cases above read).
  const sweeps = [
    "C D z F | G A B c |\nw: one two * three | four_ _ five-six\nw: a b | c d e f\nc B A G | z F E D |]\nw: se-ven eight nine ten | * e-le-ven\nw: g",
    "C D E | F G A | B c |]\nw: la | fa so | ti\nw: | a b c d",
    "z C D E | F z G A |]\nw: la_fa - so la--ti\nw: * x * y z w v\nw: one",
  ];
  const sung = (source) => {
    const out = [];
    ABCJS.parseOnly(source)[0].lines.forEach((line) => {
      (line.staff || []).forEach((staff) => {
        staff.voices[0].forEach((el) => {
          if (el.el_type !== "note") return;
          const rows = (el.lyric || []).map((l) => l.syllable);
          while (rows.length && !rows[rows.length - 1]) rows.pop();
          out.push({ from: el.startChar, to: el.endChar, line: source.slice(0, el.startChar).split("\n").length, says: (el.rest ? "z" : source.slice(el.startChar, el.endChar).trim()) + "=" + rows.join("/") });
        });
      });
    });
    return out;
  };
  let made = 0;
  let places = 0;
  sweeps.forEach((body) => {
    const source = H + body;
    const all = sung(source);
    all.forEach((first, index) => {
      [1, 2, 4].forEach((span) => {
        if (index + span > all.length) return;
        const slices = [];
        all.slice(index, index + span).forEach((el) => {
          const slice = slices[slices.length - 1];
          if (slice && slice.line === el.line) slice.to = el.to;
          else slices.push({ line: el.line, from: el.from, to: el.to });
        });
        const label = body + " from " + index + " over " + span;
        const result = MDM_BARS.pasteMusic(ABCJS, source, [{ over: slices.map((x) => ({ from: x.from, to: x.to })), text: null }]);
        assert.equal(result.refused, undefined, label + ": refused: " + result.refused);
        const kept = all.filter((el, i) => i < index || i >= index + span).map((el) => el.says);
        assert.deepEqual(sung(result.source).map((el) => el.says), kept, label);
        assert.doesNotMatch(result.source, /^w:\s*$|^w:.*[ \t]$/m, label + ": a verse left with nothing, or ending on a space");
        made++;
      });
      const step = first.says.charAt(0) === "z" ? 6 : "CDEFGABc".indexOf(first.says.charAt(0));
      const result = MDM_BARS.takeOut(ABCJS, source, first.from, step);
      const label = body + " place " + index;
      assert.equal(result.refused, undefined, label + ": refused: " + result.refused);
      assert.deepEqual(sung(result.source).map((el) => el.says), all.filter((el, i) => i !== index).map((el) => el.says), label);
      places++;
    });
  });
  // Every one of them: 3n - 4 stretches of a score of n places, and n places.
  assert.deepEqual([made, places], [84, 32]);
});
