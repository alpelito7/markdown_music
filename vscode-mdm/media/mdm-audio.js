// The audio of a score, as bytes: a MIDI file and a WAV, plus the options the
// editor's player sounds a tune with. Shared by the webview and the tests, and
// written so that none of it needs a DOM or Web Audio. Everything here is
// arithmetic over what abcjs hands back, which is why it can be tested in
// Node; the one step that has to happen in a browser is the rendering of the
// samples themselves, since abcjs primes an AudioBuffer for that.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MDM_AUDIO = factory();
  }
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  // What the extension carries is a piano, the 88 keys A0 to C8, as mp3s under
  // media/vendor/soundfont/acoustic_grand_piano-mp3 (audio-assets.test.js holds
  // that count). abcjs asks for <instrument>-mp3/<note>.mp3 for whatever
  // program and pitch a tune names, and a request that 404s leaves a rejected
  // promise in its cache which prime() then throws with the raw URL in it. So a
  // score asking for anything else is turned away before a note is fetched.
  const PIANO = 0;
  const LOWEST_KEY = 21; // A0
  const HIGHEST_KEY = 108; // C8

  // The options the player mounts a tune with (mountSynth in main.js), and the
  // ones an export has to sound with, or the file would not be the tune the
  // reader heard:
  //   soundFontVolumeMultiplier: 3 — the vendored Musyng Kite samples are quiet
  //     against the font abcjs reaches for by default, and this is the boost
  //     the player has had since the audio landed.
  //   chordsOff: true — a chord symbol over the staff is not a part, so the
  //     editor does not strum it (webview-player.test.js, "chord symbols draw
  //     but do not sound").
  // A fresh object each call: abcjs keeps the object it is given and writes its
  // own keys into it.
  function synthOptions(soundFontUrl) {
    return {
      soundFontUrl: soundFontUrl,
      soundFontVolumeMultiplier: 3,
      chordsOff: true,
    };
  }

  // ---------- MIDI ----------

  // abcjs writes a MIDI file that does not play what its own synth plays. Three
  // corrections are made here, each measured against the flattened events the
  // synth sounds (2026-09-15, vendored abcjs 6.7.0):
  //
  //   1. The tempo. abc_midi_create.js only converts the tune's tempo into
  //      quarter notes when the meter's denominator is 8, so the file comes out
  //      at 2x in 2/2 and 3/2, 2x in 6/4 and 9/4 without a Q: and 3x with one,
  //      4x and 6x in 6/2, and 0.25x in 3/16. See withTempo.
  //   2. Staccato and slurs. The writer subtracts the gap the flattener asks
  //      for with no cap, while the synth caps it at two thirds of the note
  //      (create-note-map.js). Above about 95 beats per minute, and 180 is what
  //      a tune without a Q: gets, the note-off then lands before its note-on
  //      and the note hangs for the rest of the file. See midiTune.
  //   3. The channel of a program change. The renderer writes "%00%C0" whatever
  //      channel the track is on (abc_midi_renderer.js setInstrument), so in a
  //      tune of several voices every program change lands on channel 0 while
  //      the notes are on 0, 1, 2. See withChannels.

  // Whole notes in a measure. A tune with no meter (M:none) gives a fraction
  // with no denominator, and the synth reads that as one whole note a measure.
  function meterSize(tune) {
    const meter = tune.getMeterFraction();
    return meter && meter.den ? meter.num / meter.den : 1;
  }

  // Microseconds per quarter note, from the same number the player sets its
  // clock by (millisecondsPerMeasure, which SynthController.go passes to the
  // synth). ms/measure / (whole notes per measure) is ms per whole note, and a
  // quarter is a fourth of it: x 1000 / 4 / 1000 leaves the 250.
  function microsPerQuarter(tune) {
    const micros = Math.round((tune.millisecondsPerMeasure() * 250) / meterSize(tune));
    return Math.max(1, Math.min(0xffffff, micros));
  }

  // Beats per second exactly as abc_midi_create.js computes them, including its
  // own fix-up for x/8 meters, because that is the number the writer multiplies
  // a gap by.
  function beatsPerSecond(tune, flattened) {
    const meter = tune.getMeterFraction();
    if (meter && meter.den === 8 && meter.num !== 5 && meter.num !== 7) {
      const perMeasure = tune.millisecondsPerMeasure();
      return 60000 / (perMeasure / meter.num) / 2 / 60;
    }
    return flattened.tempo / 60;
  }

  // Text for a meta event. encodeString in abc_midi_renderer.js writes the
  // length in one byte and one byte per character of the string, so a title of
  // 128 characters writes 0x80 as a length, which is not a length at all, and a
  // character over U+00FF writes four hex digits where three are counted. Both
  // make the file unreadable; the file is what leaves the editor, so it is cut
  // and folded here rather than left to a reader to cope with.
  function midiText(text) {
    if (typeof text !== "string") return text;
    let out = "";
    for (let i = 0; i < text.length && out.length < 127; i++) {
      const code = text.charCodeAt(i);
      out += code > 0xff ? "?" : text.charAt(i);
    }
    return out;
  }

  // The tune as the MIDI writer should see it: the flattened events with their
  // gaps in the writer's own units, and a title it can encode. abcjs's create()
  // calls setUpAudio once and reads metaText.title, and everything else it asks
  // for comes off the tune itself, which this still is.
  function midiTune(tune, options) {
    const flattened = tune.setUpAudio(options || {});
    const bps = beatsPerSecond(tune, flattened);
    flattened.tracks.forEach(function (track) {
      // Where a note of the same pitch follows on the same track, the one
      // before it cannot end after it starts: a MIDI reader has one note-off
      // per pitch, so an overlap (a slur asks for one, gap -0.001) cuts the
      // second note short instead of joining the two. The synth has no such
      // trouble, since every note there is its own buffer.
      const nextOfPitch = Object.create(null);
      for (let i = track.length - 1; i >= 0; i--) {
        const event = track[i];
        if (event.cmd === "text") {
          event.text = midiText(event.text);
          continue;
        }
        if (event.cmd !== "note" || !(event.duration > 0)) continue;
        const capped = Math.min(event.gap || 0, (event.duration * 2) / 3);
        let end = event.start + event.duration - capped;
        const next = nextOfPitch[event.pitch];
        if (next !== undefined && end > next) end = next;
        if (end < event.start) end = event.start;
        // The writer does `end = start + duration - gap * beatsPerSecond`.
        event.gap = bps ? (event.start + event.duration - end) / bps : 0;
        nextOfPitch[event.pitch] = event.start;
      }
    });
    const shadow = Object.create(tune);
    shadow.setUpAudio = function () {
      return flattened;
    };
    if (tune.metaText) {
      shadow.metaText = Object.assign({}, tune.metaText, {
        title: midiText(tune.metaText.title),
      });
    }
    return shadow;
  }

  // ---------- reading the bytes back ----------

  // Enough of a reader to find the events this file has to correct: the chunks,
  // and inside a track the status bytes, running status included.
  function eachTrack(bytes, fn) {
    if (bytes.length < 14 || string(bytes, 0, 4) !== "MThd") return;
    let at = 8 + be32(bytes, 4);
    while (at + 8 <= bytes.length) {
      const length = be32(bytes, at + 4);
      const from = at + 8;
      const to = Math.min(from + length, bytes.length);
      if (string(bytes, at, 4) === "MTrk") fn(from, to);
      at = from + length;
    }
  }

  function eachEvent(bytes, from, to, fn) {
    let at = from;
    let running = 0;
    while (at < to) {
      while (at < to && bytes[at] & 0x80) at++; // the delta time
      at++;
      if (at >= to) return;
      let status = bytes[at];
      let statusAt = at;
      if (status & 0x80) at++;
      else {
        // Running status: the status byte of the event before stands for this
        // one too, and there is none of this event's own to point at.
        status = running;
        statusAt = -1;
      }
      if (status === 0xff) {
        const meta = bytes[at++];
        let length = 0;
        let byte;
        do {
          byte = bytes[at++];
          length = (length << 7) | (byte & 0x7f);
        } while (byte & 0x80);
        fn(status, meta, at, statusAt);
        at += length;
        continue;
      }
      if (status >= 0xf0) return; // sysex: abcjs writes none, and its length rules differ
      running = status;
      const high = status & 0xf0;
      const size = high === 0xc0 || high === 0xd0 ? 1 : 2;
      fn(status, -1, at, statusAt);
      at += size;
    }
  }

  function be32(bytes, at) {
    return (bytes[at] * 0x1000000) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
  }

  function string(bytes, at, length) {
    let out = "";
    for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[at + i]);
    return out;
  }

  // The one tempo event of the file, rewritten. abcjs writes it as the first
  // event of the first track (setGlobalInfo), and nothing else writes another;
  // the bytes are a copy, so the caller's array is left alone. A file with no
  // tempo event is returned unchanged, which is the honest answer: there is
  // nothing to correct and nothing was.
  function withTempo(bytes, micros) {
    const out = bytes.slice();
    let done = false;
    eachTrack(out, function (from, to) {
      if (done) return;
      eachEvent(out, from, to, function (status, meta, at) {
        if (done || status !== 0xff || meta !== 0x51) return;
        out[at] = (micros >> 16) & 0xff;
        out[at + 1] = (micros >> 8) & 0xff;
        out[at + 2] = micros & 0xff;
        done = true;
      });
    });
    return out;
  }

  // Each track's program change put on the channel that track's notes are on.
  // The channel is read from the controller events the renderer writes right
  // after the program change (setChannel, "%00%B<n>"), so a track with no
  // controllers is left alone.
  function withChannels(bytes) {
    const out = bytes.slice();
    eachTrack(out, function (from, to) {
      let channel = -1;
      const programs = [];
      eachEvent(out, from, to, function (status, meta, at, statusAt) {
        const high = status & 0xf0;
        if (high === 0xb0 && channel < 0) channel = status & 0x0f;
        if (high === 0xc0 && statusAt >= 0) programs.push(statusAt);
      });
      if (channel < 0) return;
      programs.forEach(function (at) {
        out[at] = 0xc0 | channel;
      });
    });
    return out;
  }

  // The MIDI of one tune, as the editor plays it.
  function midiBytes(A, tune, options) {
    const opts = Object.assign({}, options || {}, { midiOutputType: "binary" });
    const bytes = A.synth.getMidiFile(midiTune(tune, options), opts);
    return withChannels(withTempo(bytes, microsPerQuarter(tune)));
  }

  // ---------- what the piano cannot sound ----------

  // Every note event of the flattened tune, the decorations and grace notes
  // included: they are fetched and sounded like any other.
  function eachNote(flattened, fn) {
    (flattened.tracks || []).forEach(function (track) {
      track.forEach(function (event) {
        if (event.cmd === "note") fn(event);
      });
    });
  }

  function noteCount(flattened) {
    let count = 0;
    eachNote(flattened, function () {
      count++;
    });
    return count;
  }

  // What would make prime() throw, found before a single note is fetched: an
  // instrument that is not the piano, and a pitch above the piano's top key
  // that abcjs still has a name for (it names 21 to 121, and the extension
  // carries 21 to 108, so 109 to 121 are asked for and 404). A pitch abcjs
  // cannot name at all is dropped by abcjs itself, silently, in the player too.
  // The names are for the reader: "violin" says more than "program 40".
  function unplayable(A, flattened) {
    const found = [];
    const seen = Object.create(null);
    const add = function (key, entry) {
      if (seen[key]) return;
      seen[key] = true;
      found.push(entry);
    };
    eachNote(flattened, function (event) {
      const program = event.instrument;
      if (program !== undefined && program !== PIANO) {
        const names = A && A.synth ? A.synth.instrumentIndexToName : null;
        const name = names && names[program] ? names[program] : null;
        add("i" + program, { reason: "instrument", program: program, name: name });
      }
      if (event.pitch > HIGHEST_KEY && event.pitch <= 121) {
        add("h", { reason: "range", pitch: event.pitch });
      }
    });
    return found;
  }

  // ---------- WAV ----------

  // 16-bit PCM, the format abcjs's own download writes (download-buffer.js),
  // written here because that one hands back a blob: URL and the webview's CSP
  // has no blob: to read it back with. Interleaved, little-endian, and clamped:
  // the synth sums its notes into the buffer and a loud chord can pass 1.0,
  // which would wrap round to silence-with-a-click if it were let through.
  function wavBytes(channels, sampleRate) {
    const count = channels.length;
    const frames = count ? channels[0].length : 0;
    const data = frames * count * 2;
    const out = new Uint8Array(44 + data);
    const view = new DataView(out.buffer);
    const ascii = function (at, text) {
      for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + data, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true); // the size of this header
    view.setUint16(20, 1, true); // PCM, no compression
    view.setUint16(22, count, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * count * 2, true); // bytes a second
    view.setUint16(32, count * 2, true); // bytes a frame
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, data, true);
    let at = 44;
    for (let frame = 0; frame < frames; frame++) {
      for (let channel = 0; channel < count; channel++) {
        let sample = channels[channel][frame];
        // Held at the ceiling and the floor, and silence for a NaN, which fails
        // every comparison and so falls out of the first test.
        if (!(sample >= -1 && sample <= 1)) sample = sample > 1 ? 1 : sample < -1 ? -1 : 0;
        view.setInt16(at, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
        at += 2;
      }
    }
    return out;
  }

  return {
    synthOptions: synthOptions,
    microsPerQuarter: microsPerQuarter,
    beatsPerSecond: beatsPerSecond,
    midiText: midiText,
    midiTune: midiTune,
    withTempo: withTempo,
    withChannels: withChannels,
    midiBytes: midiBytes,
    noteCount: noteCount,
    unplayable: unplayable,
    wavBytes: wavBytes,
    PIANO: PIANO,
    LOWEST_KEY: LOWEST_KEY,
    HIGHEST_KEY: HIGHEST_KEY,
  };
});
