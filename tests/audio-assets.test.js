// Tests for the vendored audio assets the editor's player depends on: the
// abcjs 6.7.0 copy in vscode-mdm/media (the engraver and the synth engine),
// the widget stylesheet, and the 88 piano notes of the soundfont. They pin
// what the webview battery cannot see from inside a page: that the files on
// disk are whole and that the two abcjs copies never drift apart.
// Run with: node --test tests/audio-assets.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MEDIA = path.join(__dirname, "..", "vscode-mdm", "media");
const RESOURCES = path.join(__dirname, "..", "_extensions", "mdm", "resources");
const PIANO = path.join(MEDIA, "vendor", "soundfont", "acoustic_grand_piano-mp3");

// The 88 keys of a piano, A0 to C8, in the flat spelling the MIDI.js
// soundfonts use and abcjs asks for (its pitch map spells black keys Db, Eb,
// Gb, Ab, Bb).
function pianoNotes() {
  const names = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const notes = [];
  for (let midi = 21; midi <= 108; midi++) {
    notes.push(names[midi % 12] + (Math.floor(midi / 12) - 1));
  }
  return notes;
}

test("the vendored abcjs 6 is the same file the Quarto extension ships", () => {
  const a = fs.readFileSync(path.join(MEDIA, "vendor", "abcjs", "abcjs-basic-min.js"));
  const b = fs.readFileSync(path.join(RESOURCES, "abcjs-basic-min.js"));
  assert.ok(a.equals(b), "the two abcjs copies drifted apart");
  const c = fs.readFileSync(path.join(MEDIA, "vendor", "abcjs", "abcjs-audio.css"));
  const d = fs.readFileSync(path.join(RESOURCES, "abcjs-audio.css"));
  assert.ok(c.equals(d), "the two abcjs-audio.css copies drifted apart");
});

test("the vendored abcjs 6 is whole: engraver and synth both there", () => {
  const code = fs.readFileSync(
    path.join(MEDIA, "vendor", "abcjs", "abcjs-basic-min.js"),
    "utf8"
  );
  // The page loads it as a plain script (window.ABCJS); here the UMD
  // wrapper is given its CommonJS pair to read the exports back.
  const module = { exports: {} };
  new Function("module", "exports", code)(module, module.exports);
  const A = module.exports;
  assert.match(A.signature, /^abcjs-basic v6\./);
  assert.equal(typeof A.renderAbc, "function");
  assert.equal(typeof A.synth.SynthController, "function");
  assert.equal(typeof A.synth.supportsAudio, "function");
});

test("the piano carries all 88 keys, every one a real mp3", () => {
  const wanted = pianoNotes();
  assert.equal(wanted.length, 88);
  assert.equal(wanted[0], "A0");
  assert.equal(wanted[wanted.length - 1], "C8");
  const onDisk = fs.readdirSync(PIANO).filter((f) => f.endsWith(".mp3"));
  assert.deepEqual(
    onDisk.map((f) => f.replace(/\.mp3$/, "")).sort(),
    wanted.slice().sort()
  );
  for (const note of wanted) {
    const file = path.join(PIANO, note + ".mp3");
    const stat = fs.statSync(file);
    assert.ok(stat.size > 3000, note + ".mp3 is truncated: " + stat.size + " bytes");
    const head = fs.readFileSync(file).subarray(0, 3);
    const id3 = head.toString("latin1").startsWith("ID3");
    const sync = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
    assert.ok(id3 || sync, note + ".mp3 does not look like an mp3");
  }
});

test("the harness mirrors the audio globals the real webview gets", () => {
  const harness = fs.readFileSync(
    path.join(__dirname, "webview", "harness.html"),
    "utf8"
  );
  assert.match(harness, /<script src="[^"]*vendor\/abcjs\/abcjs-basic-min\.js"><\/script>/);
  assert.ok(harness.includes("window.MDM_SOUNDFONT"));
  assert.ok(harness.includes("abcjs-audio.css"));
  assert.ok(harness.includes("vendor/cm6/cm6.bundle.js"));
});
