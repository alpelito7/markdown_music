// Tests for the audio a score is exported as: vscode-mdm/media/mdm-audio.js,
// the bytes of a MIDI file and of a WAV. None of it needs a browser, so it runs
// here rather than in the Chrome battery: what a browser is needed for is the
// rendering of the samples, and that is webview-audio-export.test.js.
//
// The three corrections this pins were all measured against the vendored abcjs
// 6.7.0 on 2026-09-15, and each is a defect of abcjs's own MIDI writer: the
// tempo of any meter whose denominator is not 4 or 8, the gap of a staccato or
// a slur, and the channel a program change lands on.
// Run with: node --test tests/audio-export.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MEDIA = path.join(__dirname, "..", "vscode-mdm", "media");
const MDM_AUDIO = require(path.join(MEDIA, "mdm-audio.js"));

// The bundle the webview loads as a plain script, given its CommonJS pair here
// (the same way audio-assets.test.js reads it).
const ABCJS = (function () {
  const code = fs.readFileSync(path.join(MEDIA, "vendor", "abcjs", "abcjs-basic-min.js"), "utf8");
  const module_ = { exports: {} };
  new Function("module", "exports", code)(module_, module_.exports);
  return module_.exports;
})();

const TICKS_PER_WHOLE = 480 * 4; // abcjs writes 480 per quarter (division 01e0)
const OPTIONS = MDM_AUDIO.synthOptions("");

function tuneOf(abc) {
  const tunes = ABCJS.parseOnly(abc);
  assert.ok(tunes.length, "the fixture did not parse");
  return tunes[0];
}

// A reader of its own, written against the MIDI file format and not against the
// walker in mdm-audio.js, so that a fault in that walker cannot pass unseen.
// Returns every chunk's events with absolute ticks.
function readMidi(bytes) {
  const b = Buffer.from(bytes);
  assert.equal(b.slice(0, 4).toString("latin1"), "MThd", "no MThd header");
  assert.equal(b.readUInt32BE(4), 6, "the header chunk is not 6 bytes");
  const file = {
    format: b.readUInt16BE(8),
    trackCount: b.readUInt16BE(10),
    division: b.readUInt16BE(12),
    tracks: [],
    tempos: [],
  };
  let at = 14;
  while (at < b.length) {
    assert.equal(b.slice(at, at + 4).toString("latin1"), "MTrk", "bad chunk at " + at);
    const length = b.readUInt32BE(at + 4);
    const end = at + 8 + length;
    assert.ok(end <= b.length, "a track runs past the end of the file");
    let p = at + 8;
    let tick = 0;
    let running = 0;
    const events = [];
    while (p < end) {
      let delta = 0;
      let byte;
      do {
        byte = b[p++];
        delta = (delta << 7) | (byte & 0x7f);
      } while (byte & 0x80);
      tick += delta;
      let status = b[p];
      if (status & 0x80) p++;
      else status = running;
      if (status === 0xff) {
        const meta = b[p++];
        let size = 0;
        do {
          byte = b[p++];
          size = (size << 7) | (byte & 0x7f);
        } while (byte & 0x80);
        const data = b.slice(p, p + size);
        p += size;
        events.push({ tick, meta, size, data });
        if (meta === 0x51) file.tempos.push({ tick, micros: (data[0] << 16) | (data[1] << 8) | data[2] });
        continue;
      }
      running = status;
      const high = status & 0xf0;
      if (high === 0xc0 || high === 0xd0) {
        events.push({ tick, cmd: high, channel: status & 0x0f, a: b[p++] });
        continue;
      }
      const a = b[p++];
      const velocity = b[p++];
      events.push({
        tick,
        cmd: high === 0x90 && velocity === 0 ? 0x80 : high,
        channel: status & 0x0f,
        a,
        v: velocity,
      });
    }
    assert.equal(p, end, "a track's events do not fill its chunk");
    file.tracks.push(events);
    at = end;
  }
  assert.equal(file.tracks.length, file.trackCount, "the header's track count is wrong");
  return file;
}

// Note-ons paired with their note-offs, in order, per channel and pitch. A note
// with no off, or an off with no on, comes back with a null in it.
function pairNotes(file) {
  const all = [];
  file.tracks.forEach((events, track) => {
    const open = new Map();
    events.forEach((e) => {
      const key = e.channel + ":" + e.a;
      if (e.cmd === 0x90) {
        if (!open.has(key)) open.set(key, []);
        open.get(key).push(e.tick);
      } else if (e.cmd === 0x80) {
        const stack = open.get(key);
        if (!stack || !stack.length) all.push({ track, pitch: e.a, on: null, off: e.tick });
        else all.push({ track, pitch: e.a, on: stack.shift(), off: e.tick });
      }
    });
    open.forEach((stack, key) =>
      stack.forEach((on) => all.push({ track, pitch: Number(key.split(":")[1]), on, off: null }))
    );
  });
  return all;
}

// The notes the synth sounds, in ticks: its own cap on the gap (create-note-map
// in abcjs) is what the MIDI has to agree with.
function synthNotes(tune) {
  const flattened = tune.setUpAudio(OPTIONS);
  const notes = [];
  flattened.tracks.forEach((track) =>
    track.forEach((event) => {
      if (event.cmd !== "note") return;
      const gap = Math.min(event.gap || 0, (event.duration * 2) / 3);
      notes.push({
        pitch: event.pitch,
        on: event.start * TICKS_PER_WHOLE,
        off: (event.start + event.duration - gap) * TICKS_PER_WHOLE,
      });
    })
  );
  return notes;
}

// Seconds a whole note lasts, as the player's clock has it: the synth is handed
// millisecondsPerMeasure and divides it by the meter (SynthController.go).
function secondsPerWhole(tune) {
  const meter = tune.getMeterFraction();
  return tune.millisecondsPerMeasure() / 1000 / (meter && meter.den ? meter.num / meter.den : 1);
}

function head(meter, tempo) {
  return "X:1\nM:" + meter + "\nL:1/8\n" + (tempo ? "Q:" + tempo + "\n" : "") + "K:C\n";
}

test("a WAV is 16-bit PCM at the rate it was rendered at, interleaved and clamped", () => {
  const left = new Float32Array([0.5, 1.5, NaN, -2]);
  const right = new Float32Array([-1, -0.5, 0, 0.25]);
  const bytes = MDM_AUDIO.wavBytes([left, right], 48000);
  assert.ok(bytes instanceof Uint8Array, "the bytes are not a Uint8Array");
  assert.equal(bytes.byteLength, bytes.buffer.byteLength, "the buffer is larger than the file");
  const b = Buffer.from(bytes);
  assert.equal(b.slice(0, 4).toString("latin1"), "RIFF");
  assert.equal(b.readUInt32LE(4), bytes.length - 8, "the RIFF size is not the rest of the file");
  assert.equal(b.slice(8, 12).toString("latin1"), "WAVE");
  assert.equal(b.slice(12, 16).toString("latin1"), "fmt ");
  assert.equal(b.readUInt32LE(16), 16);
  assert.equal(b.readUInt16LE(20), 1, "not PCM");
  assert.equal(b.readUInt16LE(22), 2, "not stereo");
  assert.equal(b.readUInt32LE(24), 48000);
  assert.equal(b.readUInt32LE(28), 48000 * 2 * 2, "the byte rate forgets a channel");
  assert.equal(b.readUInt16LE(32), 4, "the frame is not two 16-bit samples");
  assert.equal(b.readUInt16LE(34), 16);
  assert.equal(b.slice(36, 40).toString("latin1"), "data");
  assert.equal(b.readUInt32LE(40), 4 * 2 * 2);
  // Interleaved: left, right, left, right. 1.5 and NaN are held at the ceiling
  // and at silence, -2 at the floor.
  const samples = [];
  for (let at = 44; at < b.length; at += 2) samples.push(b.readInt16LE(at));
  assert.deepEqual(samples, [16384, -32768, 32767, -16384, 0, 0, -32768, 8192]);

  const mono = MDM_AUDIO.wavBytes([new Float32Array([0, 1])], 44100);
  const m = Buffer.from(mono);
  assert.equal(m.readUInt16LE(22), 1, "mono is not one channel");
  assert.equal(m.readUInt16LE(32), 2, "a mono frame is not one 16-bit sample");
  assert.equal(m.readUInt32LE(28), 44100 * 2);
  assert.equal(mono.length, 44 + 4);
});

test("the MIDI of a score plays at the tempo the editor plays it at", () => {
  // abcjs only converts its tempo into quarter notes for x/8 meters, so without
  // the correction 2/2 and 3/2 come out at half speed, 6/4 and 9/4 at a half or
  // a third, 6/2 at a quarter or a sixth, and 3/16 four times too fast.
  const meters = ["4/4", "3/4", "2/4", "C", "C|", "2/2", "3/2", "6/2", "6/4", "9/4", "12/4",
    "6/8", "9/8", "12/8", "3/8", "5/8", "7/8", "3/16", "6/16", "none"];
  const tempos = [null, "1/4=100", "1/2=80", "3/8=120", "120"];
  let checked = 0;
  meters.forEach((meter) => {
    tempos.forEach((tempo) => {
      const tune = tuneOf(head(meter, tempo) + "CDEF GABc|");
      const file = readMidi(MDM_AUDIO.midiBytes(ABCJS, tune, OPTIONS));
      assert.equal(file.tempos.length, 1, meter + " " + tempo + ": not one tempo event");
      const midiWhole = (4 * file.tempos[0].micros) / 1e6;
      const ratio = midiWhole / secondsPerWhole(tune);
      assert.ok(
        Math.abs(ratio - 1) < 0.0005,
        "M:" + meter + " Q:" + tempo + " plays at " + ratio.toFixed(3) + " of the editor's speed"
      );
      checked++;
    });
  });
  assert.equal(checked, 100);

  // A tempo change inside the tune is left where abcjs put it: only the one
  // event at the head of the file is rewritten.
  const shifting = tuneOf("X:1\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\nCDEF|\nQ:1/4=60\nGABc|\n");
  const file = readMidi(MDM_AUDIO.midiBytes(ABCJS, shifting, OPTIONS));
  assert.ok(file.tempos.length >= 1);
  assert.equal(file.tempos[0].tick, 0, "the tempo of the file is not at its head");
});

test("a staccato or a slurred note lasts in the MIDI what it lasts in the player", () => {
  // abcjs subtracts the flattener's gap with no cap while its synth caps it at
  // two thirds of the note, so over about 95 beats a minute the note-off landed
  // before the note-on and the note hung. 180 is what a tune with no Q: gets.
  const fixtures = [
    ["staccato, no Q:", head("4/4") + ".C.D.E.F.G.A.B.c|"],
    ["staccato, Q:1/4=200", head("4/4", "1/4=200") + ".C.D.E.F.G.A.B.c|"],
    ["staccato, Q:1/4=60", head("4/4", "1/4=60") + ".C.D.E.F.G.A.B.c|"],
    ["staccato in 2/2", head("2/2") + ".C.D.E.F|"],
    ["legato, no Q:", head("4/4") + "CDEF GABc|"],
  ];
  fixtures.forEach(([label, abc]) => {
    const tune = tuneOf(abc);
    const file = readMidi(MDM_AUDIO.midiBytes(ABCJS, tune, OPTIONS));
    const played = pairNotes(file);
    const hanging = played.filter((n) => n.on === null || n.off === null || n.off <= n.on);
    assert.deepEqual(hanging, [], label + ": a note has no end, or ends before it starts");
    const wanted = synthNotes(tune);
    assert.equal(played.length, wanted.length, label + ": not the player's number of notes");
    wanted.forEach((note) => {
      const hit = played.find((p) => p.pitch === note.pitch && Math.abs(p.on - note.on) < 1);
      assert.ok(hit, label + ": the player's note at " + note.on + " is not in the file");
      assert.ok(
        Math.abs(hit.off - note.off) < 1,
        label + ": a note lasts " + (hit.off - hit.on) + " ticks against the player's " +
          (note.off - note.on)
      );
    });
  });

  // A slur asks for a negative gap, which would run a note past the next of the
  // same pitch. MIDI has one note-off per pitch, so the note before is ended
  // where the next begins instead of being cut short by it.
  const tune = tuneOf(head("4/4", "1/4=120") + "(CC) DE|");
  const played = pairNotes(readMidi(MDM_AUDIO.midiBytes(ABCJS, tune, OPTIONS)));
  const cs = played.filter((n) => n.pitch === 60).sort((a, b) => a.on - b.on);
  assert.equal(cs.length, 2);
  assert.equal(cs[0].off, cs[1].on, "the first C does not end where the second begins");
  assert.ok(cs[1].off > cs[1].on + 100, "the second C was cut short");
});

test("a MIDI carries the written notes, on the channel its voice is on", () => {
  const plain = readMidi(MDM_AUDIO.midiBytes(ABCJS, tuneOf(head("4/4") + "CDEF|"), OPTIONS));
  assert.equal(plain.format, 1);
  assert.equal(plain.division, 480);
  assert.equal(plain.trackCount, 2, "one track of settings and one voice");
  const program = plain.tracks[1].find((e) => e.cmd === 0xc0);
  assert.deepEqual([program.channel, program.a], [0, 0], "the voice is not the piano on channel 0");

  // Chord symbols are drawn and not sounded (chordsOff), so they change no byte.
  const bare = MDM_AUDIO.midiBytes(ABCJS, tuneOf(head("4/4") + "C4|"), OPTIONS);
  const chorded = MDM_AUDIO.midiBytes(ABCJS, tuneOf(head("4/4") + '"Dm7"C4|'), OPTIONS);
  assert.deepEqual(Array.from(chorded), Array.from(bare), "a chord symbol was strummed into the file");

  // abcjs writes every program change on channel 0 whatever channel the notes
  // of that track are on, which leaves a two-voice tune saying that channel 0
  // is a violin and a flute at once.
  const duet = readMidi(
    MDM_AUDIO.midiBytes(
      ABCJS,
      tuneOf("X:1\nM:4/4\nL:1/8\nK:C\nV:1\n%%MIDI program 40\nCDEF|\nV:2\n%%MIDI program 73\nGABc|\n"),
      OPTIONS
    )
  );
  assert.equal(duet.trackCount, 3);
  [1, 2].forEach((track) => {
    const change = duet.tracks[track].find((e) => e.cmd === 0xc0);
    const notes = duet.tracks[track].filter((e) => e.cmd === 0x90);
    assert.ok(change, "voice " + track + " has no program change");
    assert.ok(notes.length, "voice " + track + " has no notes");
    notes.forEach((note) =>
      assert.equal(note.channel, change.channel, "voice " + track + " sounds on another channel than its program")
    );
  });
  assert.deepEqual(
    [duet.tracks[1].find((e) => e.cmd === 0xc0).a, duet.tracks[2].find((e) => e.cmd === 0xc0).a],
    [40, 73]
  );

  // Percussion is channel 10 (9 counting from zero), and its program change
  // goes there too.
  const drums = readMidi(
    MDM_AUDIO.midiBytes(ABCJS, tuneOf("X:1\nM:4/4\nL:1/8\n%%MIDI channel 10\nK:C\nCDEF|\n"), OPTIONS)
  );
  assert.equal(drums.tracks[1].find((e) => e.cmd === 0xc0).channel, 9);
});

test("a title or a voice name too long for MIDI is cut, not written broken", () => {
  // encodeString in abcjs writes the length in a single byte and one byte per
  // character, so 128 characters write 0x80, which is not a length, and a
  // character over U+00FF writes four hex digits where three are counted. The
  // reader here walks every event, so a broken length fails the test.
  const long = "a".repeat(128);
  const file = readMidi(MDM_AUDIO.midiBytes(ABCJS, tuneOf("X:1\nT:" + long + "\nM:4/4\nL:1/8\nK:C\nCD|"), OPTIONS));
  const text = file.tracks[0].find((e) => e.meta === 0x01);
  assert.ok(text, "the title is not in the file");
  assert.ok(text.size <= 127, "the title is " + text.size + " bytes, which no length byte can say");

  const named = readMidi(
    MDM_AUDIO.midiBytes(ABCJS, tuneOf('X:1\nM:4/4\nL:1/8\nK:C\nV:1 name="' + "c".repeat(130) + '"\nCD|'), OPTIONS)
  );
  const name = named.tracks[1].find((e) => e.meta === 0x03);
  assert.ok(name && name.size <= 127, "a voice name of 130 characters was written whole");

  const cjk = readMidi(MDM_AUDIO.midiBytes(ABCJS, tuneOf("X:1\nT:漢字 tune\nM:4/4\nL:1/8\nK:C\nCD|"), OPTIONS));
  const folded = cjk.tracks[0].find((e) => e.meta === 0x01);
  assert.equal(folded.data.toString("latin1"), "?? tune", "a character over U+00FF was not folded");
  assert.equal(folded.size, folded.data.length, "the length byte does not count the bytes written");
});

test("a score the piano cannot sound is named before a note is fetched", () => {
  const flattened = (abc) => tuneOf(abc).setUpAudio(OPTIONS);
  const only = (abc) => MDM_AUDIO.unplayable(ABCJS, flattened(abc));

  assert.deepEqual(only(head("4/4") + "CDEF|"), [], "the piano is not playable");
  assert.deepEqual(only("X:1\nM:4/4\nL:1/8\n%%MIDI program 40\nK:C\nCD|"), [
    { reason: "instrument", program: 40, name: "violin" },
  ]);
  // Not only %%MIDI program: a drum line, channel 10 and the bagpipe key all
  // ask for an instrument that is not in the extension.
  assert.deepEqual(only("X:1\nM:4/4\nL:1/8\n%%MIDI channel 10\nK:C\nCD|"), [
    { reason: "instrument", program: 128, name: "percussion" },
  ]);
  assert.deepEqual(only("X:1\nM:4/4\nL:1/8\nK:HP\nCD|"), [
    { reason: "instrument", program: 71, name: "clarinet" },
  ]);
  // A program abcjs has no name for is still named as a number by the host.
  assert.deepEqual(only("X:1\nM:4/4\nL:1/8\n%%MIDI program 200\nK:C\nCD|"), [
    { reason: "instrument", program: 200, name: null },
  ]);
  // The soundfont is the 88 keys A0 to C8. abcjs names pitches up to 121, so
  // anything from 109 up is asked for and 404s.
  assert.deepEqual(only("X:1\nM:4/4\nL:1/8\nK:C\nc''''|"), [{ reason: "range", pitch: 120 }]);
  assert.deepEqual(only("X:1\nM:4/4\nL:1/8\nK:C\nc'''|"), [], "C8 is the top key and is playable");

  // What counts as empty is that nothing sounds: a bar of rests lasts, and
  // plays nothing.
  assert.equal(MDM_AUDIO.noteCount(flattened(head("4/4") + "z4|")), 0);
  assert.ok(flattened(head("4/4") + "z4|").totalDuration > 0, "the rests were expected to last");
  assert.equal(MDM_AUDIO.noteCount(flattened(head("4/4") + "CD|")), 2);
});
