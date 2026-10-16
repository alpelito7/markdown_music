// Moving bars from one line of a score to the next, the way the score mode
// does it (main.js, the score mode). A line of ABC is a system on the page, so
// the text is where the systems are decided: bars go from the head of a line
// to the end of the one above it, or from the end of a line to the head of the
// one below, and the text is rewritten to say so. Shared by the webview and
// the tests, and written against what abcjs hands back from parseOnly, so it
// runs in Node as well (score-bars.test.js).
//
// What it will not do is change the music. A move is rewritten as text and
// then read back by abcjs, and it is only handed out when every voice has the
// same notes, bars, parts and lyrics in the same order as before and the
// synth plays the same events (verify). Anything the rewriting got wrong, or
// a score laid out in a way it does not know, comes back as a refusal with a
// reason, and the score is left as it was.
//
// It also adds a bar: an empty one, a rest as long as the bar, in every voice
// of a line at once (addBar). That one changes the music on purpose, by that
// bar and by nothing else, and is read back the same way (verifyAdd). And it
// writes a note, a chord or a rest on a place of a voice (writeNote): that
// place and nothing else (verifyNote); it puts a note or a rest in beside a
// place (insertPlace, verifyInsert); it takes a place out, a head of a
// chord, a note, a rest or the bar it is all of (takeOut, verifyOut); it
// puts music in at a place, takes a stretch out, or puts music in the place
// of one (pasteMusic, verifyPaste); and it makes rests of the notes of a
// stretch (restMusic, verifyRests).
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MDM_BARS = factory();
  }
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  // ---------- Lines of source ----------

  function lineStart(src, pos) {
    return src.lastIndexOf("\n", pos - 1) + 1;
  }

  function lineEnd(src, pos) {
    const at = src.indexOf("\n", pos);
    return at < 0 ? src.length : at;
  }

  // What a line of the tune body is. The fields are the ones a line can
  // stand for on its own (`K:D`), and w: and s: are read against the music
  // line above them, so they travel with its bars.
  function lineKind(text) {
    if (/^\s*$/.test(text)) return "blank";
    if (/^%%/.test(text)) return "directive";
    if (/^%/.test(text)) return "comment";
    if (/^w:/.test(text)) return "words";
    if (/^s:/.test(text)) return "symbols";
    if (/^\+:/.test(text)) return "continued";
    if (/^V:/.test(text)) return "voice";
    if (/^[A-Za-z]:/.test(text)) return "field";
    return "music";
  }

  // The fields that change the music from where they stand, and that ABC
  // lets be written inside a line: the key, the unit length, the meter, a
  // part and the tempo. A bar that crosses one of them carries it with it,
  // written inline (`[K:D]`), so that it goes on starting at the same note.
  const INLINE_FIELD = /^[KLMPQ]:/;

  // The lines between two points of the source, whole, each with its kind.
  function linesBetween(src, from, to) {
    const out = [];
    let at = from;
    while (at < to) {
      const end = lineEnd(src, at);
      if (end > to) break;
      const text = src.slice(at, end);
      out.push({ from: at, to: end, text: text, kind: lineKind(text) });
      at = end + 1;
    }
    return out;
  }

  // An element abcjs made out of a field standing on a line of its own (a
  // `P:` above the music, a `K:` between two lines of it). abcjs files these
  // with the line above or the line below as it pleases (a part with the
  // line it heads, a key with the line it follows), so they are told by
  // their text and never counted as the music of either line.
  function standsAlone(src, el) {
    return (
      lineStart(src, el.startChar) === el.startChar &&
      /^[A-Za-z]:/.test(src.slice(el.startChar, el.startChar + 2))
    );
  }

  // ---------- Bars ----------

  // The music of one voice on one system: its elements with the field lines
  // left out, and where its text begins and ends. An element begins with
  // the space before it (abcjs counts " e" after a barline as the note), so
  // both ends are drawn in to the first and last character that is not one.
  //
  // What is filed with a line and written elsewhere is left out too: abcjs
  // files a field written inline at the head of a line (`[K:D]`) with the
  // line above, and the line's own stretch of text is the lines its notes
  // and barlines stand on, from the head of the first to the end of the
  // last.
  function voiceOn(src, elems) {
    let lo = Infinity;
    let hi = -1;
    elems.forEach(function (el) {
      if (typeof el.startChar !== "number" || typeof el.endChar !== "number") return;
      if (el.el_type !== "note" && el.el_type !== "bar") return;
      lo = Math.min(lo, el.startChar);
      hi = Math.max(hi, el.endChar);
    });
    if (hi < 0) return [];
    const from = lineStart(src, lo);
    const to = lineEnd(src, hi - 1);
    const music = [];
    for (let i = 0; i < elems.length; i++) {
      const el = elems[i];
      // Some elements are abcjs's own and stand nowhere in the text: under
      // %%score the voices of a shared staff get a `stem` with no chars.
      if (typeof el.startChar !== "number" || typeof el.endChar !== "number") continue;
      if (el.startChar < from || el.endChar > to + 1) continue;
      if (!standsAlone(src, el)) music.push(i);
    }
    return music;
  }

  // Where the music of a line begins in its text: past the voice's mark
  // when it is written inline, and before any field written inline at the
  // head, which abcjs files with the line above or with the line itself
  // and not with its first note (an `[M:2/4]` there is the line's meter, and
  // a `[K:D]` a key element at the end of the line above).
  function lineHead(src, from) {
    let at = from;
    for (;;) {
      at = trimStart(src, at, src.length);
      const mark = /^\[V:[^\]]*\]/.exec(src.slice(at, at + 200));
      if (!mark) return at;
      at += mark[0].length;
    }
  }

  function trimStart(src, pos, limit) {
    while (pos < limit && /[ \t]/.test(src.charAt(pos))) pos++;
    return pos;
  }

  function trimEnd(src, pos, limit) {
    while (pos > limit && /[ \t]/.test(src.charAt(pos - 1))) pos--;
    return pos;
  }

  // The same, over the breaks of a line continued with a backslash as well:
  // a cut that takes the bars after one would otherwise leave the backslash
  // continuing a line into nothing, and an empty line ends an ABC tune.
  function gapAfter(src, pos, limit) {
    for (;;) {
      pos = trimStart(src, pos, limit);
      const m = /^\\[ \t]*\n/.exec(src.slice(pos, limit + 1));
      if (!m || pos + m[0].length > limit + 1) return pos;
      pos += m[0].length;
    }
  }

  function gapBefore(src, pos, limit) {
    for (;;) {
      pos = trimEnd(src, pos, limit);
      const m = /\\[ \t]*\n$/.exec(src.slice(limit, pos));
      if (!m) return pos;
      pos -= m[0].length;
    }
  }

  // The bars of a voice on a system, as runs of its element indexes. A bar
  // ends on a barline that has had a note or a rest before it: a barline
  // that opens the line (`|:` at its head) belongs to the bar it opens.
  // What follows the last barline is a bar of its own, closed or not.
  function barsOf(elems, music) {
    const bars = [];
    let run = [];
    let seen = false;
    music.forEach(function (i) {
      const el = elems[i];
      run.push(i);
      if (el.el_type === "note") seen = true;
      if (el.el_type === "bar" && seen) {
        bars.push(run);
        run = [];
        seen = false;
      }
    });
    if (run.length) {
      // A tail with no note in it (an inline field after the last barline)
      // goes with the bar before it rather than being a bar of nothing.
      if (!seen && bars.length) bars[bars.length - 1] = bars[bars.length - 1].concat(run);
      else bars.push(run);
    }
    return bars;
  }

  // ---------- Lyrics ----------
  //
  // abcjs reads a w: line against the notes of the line above it (addWords
  // in its abc_parse.js), and this is that reading again, keeping where each
  // piece stands in the text so the line can be cut between two bars. A
  // syllable goes to the next note that is not a rest; `*` and a hyphen
  // standing alone skip one note (a rest counts, since abcjs takes any note
  // element there), `_` holds the syllable over one, and `|` skips to the
  // next barline. A syllable is kept with what divides it from the next,
  // which abcjs draws with it where that is a hyphen or a `_` written
  // against it (`la-`, `la_`); a hyphen standing alone gives itself to the
  // piece before it.

  // The part of a w: line abcjs reads: after `w:`, up to a comment.
  function wordsSpan(text) {
    let end = text.indexOf("%");
    if (end < 0) end = text.length;
    let from = 2;
    while (from < end && /\s/.test(text.charAt(from))) from++;
    while (end > from && /\s/.test(text.charAt(end - 1))) end--;
    return { from: from, to: end };
  }

  function lyricTokens(words) {
    const text = words.charAt(words.length - 1) === "-" ? words : words + " ";
    const tokens = [];
    let last = 0;
    let escaped = false;
    function word(i) {
      const raw = text.slice(last, i);
      const from = last;
      last = i + 1;
      if (!raw.trim()) return false;
      const c = text.charAt(i);
      tokens.push({ skip: null, from: from, to: Math.min(i + 1, words.length), divider: c === "_" || c === "-" ? c : " " });
      return true;
    }
    for (let i = 0; i < text.length; i++) {
      const c = text.charAt(i);
      if (c === " " || c === "\x12") word(i);
      else if (c === "-" && !escaped) {
        if (!word(i) && tokens.length) {
          tokens[tokens.length - 1].divider = "-";
          tokens.push({ skip: "next", from: i, to: i + 1 });
        }
      } else if ((c === "_" || c === "*" || c === "|") && !escaped) {
        word(i);
        tokens.push({ skip: c === "_" ? "slur" : c === "*" ? "next" : "bar", from: i, to: i + 1 });
      }
      escaped = c === "\\";
    }
    return tokens;
  }

  // Which element takes each token, or -1 for one nothing takes.
  function alignLyrics(tokens, elems) {
    const taker = tokens.map(function () {
      return -1;
    });
    let t = 0;
    for (let i = 0; i < elems.length && t < tokens.length; i++) {
      const el = elems[i];
      const tok = tokens[t];
      let takes = false;
      if (tok.skip === "bar") takes = el.el_type === "bar";
      else if (tok.skip) takes = el.el_type === "note" && el.pitches !== null;
      else takes = el.el_type === "note" && el.rest === undefined;
      if (takes) taker[t++] = i;
    }
    return taker;
  }

  // The w: lines under a music line: the ones straight after it.
  function wordsUnder(src, musicLineEnd) {
    const out = [];
    let at = musicLineEnd + 1;
    while (musicLineEnd < src.length && at <= src.length) {
      const end = lineEnd(src, at);
      const text = src.slice(at, end);
      const kind = lineKind(text);
      if (kind !== "words") break;
      const span = wordsSpan(text);
      out.push({ line: { from: at, to: end }, from: at + span.from, to: at + span.to, text: text.slice(span.from, span.to) });
      if (end >= src.length) break;
      at = end + 1;
    }
    return out;
  }

  // One `*` per note element: what a w: line needs to pass over notes that
  // take nothing from it, and leave the next syllable for the note after.
  function stars(count) {
    return new Array(count + 1).join("* ").trim();
  }

  function noteCount(elems, indexes) {
    return indexes.filter(function (i) {
      return elems[i].el_type === "note";
    }).length;
  }

  // Whether a verse leaves a barline of the line with nothing: the next
  // token it is offered is then a `|`'s to take, and words carried on past
  // it that open with a `|` of their own (words that begin a bar late, `w: |
  // la li`) would lose it there. Found by fuzzing the module with random
  // tunes. Such words are given one `|` more, for that barline to take.
  function bareBar(read, elems, index) {
    return !!elems[index] && elems[index].el_type === "bar" && read.taker.indexOf(index) < 0;
  }

  function opensWithSkip(tokens) {
    return tokens.length > 0 && tokens[0].skip === "bar";
  }

  // A verse of a line, read against the line's notes: its tokens, the note
  // each goes to, and whether it ends clean, with every token taken.
  function readVerse(verse, elems) {
    const tokens = verse ? lyricTokens(verse.text) : [];
    const taker = alignLyrics(tokens, elems);
    const loose = taker.indexOf(-1);
    return { verse: verse, tokens: tokens, taker: taker, clean: loose < 0, loose: loose };
  }

  // The notes of a line past the last one a verse gives anything to.
  function untaken(read, elems, indexes) {
    let last = -1;
    read.taker.forEach(function (i) {
      if (i > last) last = i;
    });
    return noteCount(
      elems,
      indexes.filter(function (i) {
        return i > last;
      })
    );
  }

  // ---------- The syllables of what is taken out ----------
  //
  // The owner's call of 2026-10-06 for Delete, on a stretch whose syllables
  // had been left in the score's ink because Delete left them: "el delete
  // debe borrarlo todo por lo que debe marcarse todo lo que se borra".
  // Until then a place taken out from over a verse was refused, every
  // syllable after it having to move along by one, but for the last place
  // of a line, which went and left its syllable written under nothing. Now
  // what a verse gave the elements that go, goes with them: a syllable with
  // its note, a `*` or a `_` with the note or the rest that took it, a `|`
  // with its barline. Every element that stays keeps what it had, which
  // the reading back holds it to.
  //
  // The elements that go stand together on the line and a verse is read in
  // their order, so what goes of a verse is one run of its text. Before
  // them an element that stays may have been passed over while the first
  // piece of that run waited for one of them: the notes after a bar's last
  // syllable, the `|` waiting for the barline; a rest, a word waiting for
  // the next note. It would now be offered the piece after the run, so
  // where it would take it a `*` is written for it to take in its place,
  // or a `|` for a barline, where the run stood. Where the run was the end
  // of the verse, the stars are written that a note needs to keep its row
  // among the verses, when a verse under this one gives it a syllable:
  // abcjs counts a note's verses by the ones that reach it, and a verse
  // that has run out before a note leaves its row to the next.
  //
  // The syllable before the run may be drawn a character shorter: the `_`
  // of `la_` goes with the note it held the syllable over, and `la` is
  // left. That is the one thing the reading back is told to let change
  // (`eased`, the elements it is drawn under). The verses of a line that
  // goes whole go with it, and a verse the cut leaves with no syllable
  // goes as well where no verse under it keeps one (versesLeft). The
  // verses are read as abcjs reads them, past what it passes over, and what
  // cannot be read so is refused (versesOf).
  //
  // `removed` names the elements of the voice's line that go. Returns
  // { edits, eased }, or { failed } with the reason.
  function wordsCut(src, elems, music, removed, whole) {
    if (!wordsBelow(src, elems, music)) return { edits: [], eased: [] };
    const block = versesOf(src, elems, music);
    if (block.failed) return block;
    const verses = block.verses;
    if (whole) {
      // The lines of the verses, and not the lines abcjs passes over between
      // them (linesUnder): the verses that stand together go in one piece.
      const lines = [];
      verses.forEach(function (verse) {
        const to = Math.min(src.length, verse.line.to + 1);
        const last = lines[lines.length - 1];
        if (last && last.to === verse.line.from) last.to = to;
        else lines.push({ from: verse.line.from, to: to, insert: "" });
      });
      return { edits: lines, eased: [] };
    }
    const goes = {};
    removed.forEach(function (i) {
      goes[i] = true;
    });
    const reads = verses.map(function (verse) {
      return readVerse(verse, elems);
    });
    const noteLike = function (i) {
      return elems[i].el_type === "note" && elems[i].pitches !== null;
    };
    const sung = function (i) {
      return elems[i].el_type === "note" && elems[i].rest === undefined;
    };
    // Whether a verse under the verse `v` gives the element a syllable.
    const sungBelow = function (v, i) {
      return reads.slice(v + 1).some(function (read) {
        const t = read.taker.indexOf(i);
        return t >= 0 && read.tokens[t].skip === null;
      });
    };
    const runs = [];
    const eased = [];
    for (let v = 0; v < reads.length; v++) {
      const read = reads[v];
      const tokens = read.tokens;
      const text = read.verse.text;
      runs.push([]);
      // The run that goes: the pieces the elements that go took.
      let a = -1;
      let b = -1;
      read.taker.forEach(function (e, t) {
        if (e < 0 || !goes[e]) return;
        if (a < 0) a = t;
        b = t;
      });
      if (a < 0) continue;
      const next = b + 1 < tokens.length ? tokens[b + 1] : null;
      // The elements that stay and were passed over while its first piece
      // waited, and what is written for them to take.
      const passed = [];
      for (let i = a > 0 ? read.taker[a - 1] + 1 : 0; i < read.taker[a]; i++) if (!goes[i]) passed.push(i);
      const fill = [];
      if (next && next.skip === "bar") {
        passed.forEach(function (i) {
          if (elems[i].el_type === "bar") fill.push("|");
        });
      } else {
        let last = -1;
        passed.forEach(function (i, n) {
          const takes = next ? (next.skip ? noteLike(i) : sung(i)) : sung(i) && sungBelow(v, i);
          if (takes) last = n;
        });
        // A star is taken by the first note or rest it is offered to, so
        // every one of them before the last that needs one has its own.
        for (let n = 0; n <= last; n++) if (noteLike(passed[n])) fill.push("*");
      }
      const run = runText(text, tokens, a, b, fill);
      runs[v].push(run);
      // The syllable before the run, read again in the verse as it now is:
      // whether it is still divided from the next as it was.
      const now = text.slice(0, run.from) + run.insert + text.slice(run.to);
      const before = a > 0 && tokens[a - 1].skip === null ? lyricTokens(now)[a - 1] : null;
      if (before && before.divider !== tokens[a - 1].divider) eased.push(read.taker[a - 1]);
    }
    return { edits: versesLeft(src, verses, runs), eased: eased };
  }

  // The pieces `a` to `b` of a verse (its `text`, read as `tokens`) written
  // as `fill`, the pieces put in their place (none for a run that goes), as
  // { from, to, insert } in the text: a piece written against a `_`, a `*`
  // or a `|` ending where that begins, and the spaces that go with it, the
  // ones after it and the ones before it at the end of the verse. Where it
  // was written against the piece before it, the piece after it is not left
  // written against that one instead: `hel-lo world` keeps `hel- world`,
  // and `la_fa` with its `_` gone is `la fa`, two words; but a hyphen of
  // several stays with the others (`Glo---ri` is `Glo--ri`), a hyphen that
  // divides and not one written with a backslash, which is a letter of its
  // word. Shared by what Delete takes (wordsCut) and what 0 takes
  // (wordsRested).
  function runText(text, tokens, a, b, fill) {
    const next = b + 1 < tokens.length ? tokens[b + 1] : null;
    const blank = function (i) {
      return /\s/.test(text.charAt(i));
    };
    let from = tokens[a].from;
    let to = next && next.from < tokens[b].to ? next.from : tokens[b].to;
    const glued = from > 0 && !blank(from - 1);
    let insert = fill.join(" ");
    if (insert || !glued) while (to < text.length && blank(to)) to++;
    if (insert) insert = (glued ? " " : "") + insert + (to < text.length ? " " : "");
    else if (glued && to < text.length && !blank(to)) {
      if (blank(to - 1)) to--;
      else if (text.charAt(from - 1) !== "-" || text.charAt(from - 2) === "\\") insert = " ";
    }
    if (!insert && to >= text.length) while (from > 0 && blank(from - 1)) from--;
    // A hyphen standing alone at the head of a verse is read as nothing
    // (abcjs skips a note for one only after a piece), so one left there
    // is written as the star it was read as.
    if (!insert && a === 0 && next && next.skip === "next" && text.charAt(next.from) === "-") {
      to = next.to;
      insert = "*" + (to < text.length && !blank(to) ? " " : "");
    }
    return { from: from, to: to, insert: insert };
  }

  // The verses of a block as a change leaves them, as edits of the source:
  // `runs[v]` holds the runs written in the verse `v` (runText, in the order
  // they stand), none for a verse the change leaves as it was. A verse left
  // with nothing goes, line and all. So does one the change leaves with no
  // syllable, only the pieces that give the places they reach a blank row,
  // where no verse under it keeps a syllable: a note's rows are the verses
  // that reach it, in their order, so these blank rows come after every
  // row anything is drawn on and taking them out moves nothing drawn.
  // Under a verse that keeps a syllable they hold the row it is drawn on,
  // and stay. Found by the second reading of 0 under a verse (2026-10-15):
  // `w: la_ _ _` over four notes made rests was left as `w: * _ _ _`, a
  // verse nothing is drawn of, which still refused Enter on those rests.
  // Returns the edits.
  function versesLeft(src, verses, runs) {
    const nows = verses.map(function (verse, v) {
      let now = verse.text;
      for (let r = runs[v].length - 1; r >= 0; r--) now = now.slice(0, runs[v][r].from) + runs[v][r].insert + now.slice(runs[v][r].to);
      return now;
    });
    const sung = nows.map(function (now) {
      return lyricTokens(now).some(function (token) {
        return token.skip === null;
      });
    });
    // In the order of the verses, which is the order the pieces a cut takes
    // are named in (cutTakes).
    const edits = [];
    verses.forEach(function (verse, v) {
      if (runs[v].length && (!nows[v].trim() || (!sung[v] && sung.indexOf(true, v + 1) < 0))) {
        edits.push({ from: verse.line.from, to: Math.min(src.length, verse.line.to + 1), insert: "" });
        return;
      }
      runs[v].forEach(function (run) {
        edits.push({ from: verse.from + run.from, to: verse.from + run.to, insert: run.insert });
      });
    });
    return edits;
  }

  // The verses read against a voice's line, as { verses } (each as
  // wordsUnder gives one), or { failed } where they cannot be read here as
  // abcjs reads them (linesUnder).
  function versesOf(src, elems, music) {
    const lines = linesUnder(src, lineEnd(src, elems[music[music.length - 1]].endChar - 1) + 1);
    return lines.refused || !lines.verses.length ? { failed: "noteLyrics" } : { verses: lines.verses };
  }

  // The lines under a voice's line of music, from `at` (the first after
  // it), read as abcjs's parse reads them for the verses of that music, as
  // { verses, refused, found }: the verses read against it; whether
  // anything there is read here otherwise than abcjs reads it, which refuses
  // whatever the change is, one that reaches no syllable too, since which
  // notes such a verse reaches is not known here either; and whether a line
  // of words or of symbols is there at all (wordsBelow). abcjs reads a
  // verse against the music above it past the lines it reads past (bodyLine)
  // and past what an `H:` or a `%%begintext` takes as their own, so they are
  // read past here: until the second reading of 0 under a verse
  // (2026-10-15) the verses stopped at the first line that was not one, and
  // a note made a rest or taken out at the end of the line left the
  // syllable of a verse past it written under no note. Refused: a line of
  // symbols (abcjs gives its symbols to the notes as it gives syllables, so
  // they would move as syllables do); a `+:` after a verse, which abcjs
  // 6.7.0 reads as a line of music where the verse's writer meant it carried
  // on; and a verse misread. A verse line a change takes out from right
  // under what an `H:` takes would give it the music after the verse, and
  // the reading back refuses that. (A `%%beginps` is not looked for: abcjs
  // 6.7.0 does not come back from parsing one followed by any line but
  // `%%endps`, measured, so no score holding one is drawn or written.)
  function linesUnder(src, at) {
    const verses = [];
    let refused = false;
    let found = false;
    let held = null;
    while (at <= src.length) {
      const end = lineEnd(src, at);
      const text = src.slice(at, end);
      // What an `H:` takes: the lines up to one with a colon second, or an
      // empty one; and what `%%begintext` takes, up to `%%endtext`.
      if (held === "history" && text !== "" && text.charAt(1) !== ":") {
        at = end + 1;
        continue;
      }
      if (held === "text") {
        // An empty line ends the tune inside a text block as well (measured:
        // nothing after it is read against the music above).
        if (text === "") break;
        if (text.indexOf("%%endtext") === 0) held = null;
        at = end + 1;
        continue;
      }
      held = null;
      const kind = bodyLine(text);
      if (kind === "words") {
        found = true;
        if (misread(text)) refused = true;
        const span = wordsSpan(text);
        verses.push({ line: { from: at, to: end }, from: at + span.from, to: at + span.to, text: text.slice(span.from, span.to) });
      } else if (kind === "symbols" || (kind === "continued" && verses.length)) {
        found = true;
        refused = true;
      } else if (kind === "history" || kind === "text") {
        held = kind;
      } else if (kind !== "pass") {
        break;
      }
      if (end >= src.length) break;
      at = end + 1;
    }
    return { verses: verses, refused: refused, found: found };
  }

  // What a line of a tune's body is to abcjs's parse, for the verses of the
  // music above it (its parseLine and its parseHeader, read in the 6.7.0
  // sources and measured on the bundle): "words", "symbols" or "continued"
  // (`+:`, a line of music to it); "pass" for a line it reads past, the
  // verses after it read against the same music (a comment or a directive,
  // with spaces before it too, its parse cutting a line at its first `%`; a
  // line of nothing but spaces, only an empty line ending a tune; a line
  // that starts with a backslash, which its parse makes a line of spaces
  // before anything else, taking it for a LaTeX command (found by the
  // fourth reading of 0 under a verse); the fields
  // it keeps as text, A B C D F G I N O R S W Z, the ones it sets, K L M P Q
  // T U, and the ones it ignores, E m); "history" for `H:` and "text" for
  // `%%begintext`, which take the lines after them (linesUnder); and "stop"
  // for music, a voice, another tune (`X:`), an empty line, and a
  // field of a letter abcjs reads as music (`J:`, `Y:`, a small letter but
  // m, s and w: measured, the verse after `J:x` or `r: a remark` is given to
  // what abcjs made of that line, and not to the music above).
  function bodyLine(text) {
    if (text === "") return "stop";
    if (/^%%begintext/.test(text)) return "text";
    if (/^[ \t]*(?:%|$)/.test(text) || text.charAt(0) === "\\") return "pass";
    const kind = lineKind(text);
    if (kind === "words" || kind === "symbols" || kind === "continued") return kind;
    if (/^H:/.test(text)) return "history";
    if (/^[A-GIK-UWZm]:/.test(text)) return "pass";
    return "stop";
  }

  // Whether a w: line is one abcjs reads otherwise than the engine does:
  // carried on to the next line with a backslash, a comment after it or not.
  // abcjs's parse puts a mark in the backslash's place and blanks the
  // comment, and its addWords then reads the next line on from its third
  // character as the same verse; a backslash inside the comment is the
  // comment's and carries nothing on (measured: `w: a b % note \` over
  // `w: c d` is two verses). A percent sign written after a backslash, which
  // abcjs reads as a percent sign and the engine as the start of a comment
  // (wordsSpan), leaves a backslash at the end of what the engine reads, and
  // is refused with it.
  function misread(line) {
    return /\\[ \t]*$/.test(line.split("%")[0]);
  }

  // ---------- The syllables of notes made rests ----------
  //
  // The owner's call of 2026-10-15 for 0, which until then refused a note
  // under a verse ("Lyrics can't make room"): "Si doy cero las notas dben
  // ponerse en silencio y que se borre todo lo que haya escrito". A rest
  // takes no syllable, so a note made one gives up the syllable each verse
  // gave it, and every other note keeps the one it had: what Delete takes
  // from the verses (wordsCut), with the place left standing.
  //
  // A rest takes what a note takes that is no syllable: a `*`, a `_` or a
  // hyphen standing alone, which abcjs gives to the next note element,
  // rests among them (measured: `C z D` under `a * b` gives the rest the
  // star). So what goes of a verse is the syllables on those notes, each
  // run of them together, and nothing else: a `*` or a `_` a note took is
  // left for its rest to take, and shows nothing under the rest as it
  // showed nothing under the note (abcjs draws a syllable's `_` or `-` as
  // text after it, on its own note: addLyric). What stood after a run is
  // then offered to every element from the one after the last that took a
  // piece before the run: a syllable or the end of the verse passes over
  // them all, rests and barlines, but a `*`, a `_` or a lone hyphen would
  // be taken by the first rest among them, and a `|` by a barline among
  // them, so there the run is written as a `*` for each rest it is offered
  // to, the ones that were rests and the ones made rests, which a rest
  // takes and shows nothing for. A verse left with nothing goes, line and
  // all, and so does one left with no syllable where no verse under it
  // keeps one (versesLeft), as under Delete; and what the verses are read
  // from is versesOf, which refuses what abcjs reads otherwise.
  //
  // `turned` names the elements of the voice's line that are made rests,
  // and words or symbols are read against it (wordsBelow). Returns
  // { edits }, or { failed } with the reason.
  function wordsRested(src, elems, music, turned) {
    const block = versesOf(src, elems, music);
    if (block.failed) return block;
    const verses = block.verses;
    const rests = {};
    turned.forEach(function (i) {
      rests[i] = true;
    });
    const runs = verses.map(function (verse) {
      const read = readVerse(verse, elems);
      const tokens = read.tokens;
      // A syllable a note made a rest took.
      const given = function (t) {
        return t < tokens.length && read.taker[t] >= 0 && !!rests[read.taker[t]] && tokens[t].skip === null;
      };
      const out = [];
      for (let a = 0; a < tokens.length; a++) {
        if (!given(a)) continue;
        let b = a;
        while (given(b + 1)) b++;
        // The elements the piece after the run is offered to before the one
        // that took it: the run's, and the ones the run's syllables passed
        // over, back to the element that took the piece before it.
        const next = b + 1 < tokens.length ? tokens[b + 1] : null;
        const fill = [];
        let barred = false;
        for (let i = a > 0 ? read.taker[a - 1] + 1 : 0; i <= read.taker[b]; i++) {
          if (elems[i].el_type === "bar") barred = true;
          else if (elems[i].el_type === "note" && elems[i].pitches !== null) fill.push("*");
        }
        const taken = !!next && (next.skip === "next" || next.skip === "slur" || (next.skip === "bar" && barred));
        out.push(runText(verse.text, tokens, a, b, taken ? fill : []));
        a = b;
      }
      return out;
    });
    return { edits: versesLeft(src, verses, runs) };
  }

  // ---------- The move ----------

  // A barline that opens a numbered ending (`|1`, `:|2`, `|[1`) is two
  // things at once: the end of a bar and the start of the ending over the
  // bars after it. A line broken there takes it apart, the barline ending
  // the line and the ending opening the next as `[1`, which is how ABC
  // writes an ending after a break: left whole at the end of a line, abcjs
  // closes the ending there, over nothing (measured on score-annotations.mdm,
  // where the first ending lost its bracket).
  function splitEnding(src, el) {
    if (!el || el.el_type !== "bar" || !el.startEnding) return null;
    const from = trimStart(src, el.startChar, el.endChar);
    const to = trimEnd(src, el.endChar, from);
    const m = /^([:|\]\[]*?[|\]])\s*\[?\s*([0-9][0-9,\-]*)$/.exec(src.slice(from, to));
    if (!m) return null;
    return { from: from, to: to, bar: m[1], ending: "[" + m[2] };
  }

  // Fields written inline at the head of bars that go to the head of a line
  // are written back on lines of their own above it, which is how ABC is
  // usually written, and how they stood before a move up took them inline:
  // a move down undoes a move up to the character.
  function leadingFields(text) {
    const fields = [];
    let rest = text;
    let m;
    while ((m = /^\[([KLMPQ]:[^\]]*)\]\s*/.exec(rest))) {
      fields.push(m[1]);
      rest = rest.slice(m[0].length);
    }
    return { fields: fields, rest: rest };
  }

  function refuse(reason) {
    return { refused: reason };
  }

  // A voice by its staff and its number on the staff, which is how abcjs
  // keeps it from one system to the next.
  function voicesOf(line) {
    const out = [];
    (line.staff || []).forEach(function (staff, st) {
      (staff.voices || []).forEach(function (voice, vi) {
        out.push({ key: st + "/" + vi, elems: voice || [] });
      });
    });
    return out;
  }

  // Whether a voice of the line `upper` stops without a barline while the
  // same voice on the line `lower`, the next, does not open with one: the
  // bar it stops in goes on across the break. Among the voices `goes`
  // names.
  function runsOn(src, upper, lower, goes) {
    return voicesOf(upper).filter(goes).some(function (voice) {
      const next = voiceIn(lower, voice.key);
      if (!next) return false;
      const music = voiceOn(src, voice.elems);
      const nextMusic = voiceOn(src, next.elems);
      return firstOf(voice.elems, music.slice().reverse()) === "note" && firstOf(next.elems, nextMusic) === "note";
    });
  }

  // Which of a note and a barline comes first among some of a voice's
  // elements, or null for neither.
  function firstOf(elems, order) {
    for (let i = 0; i < order.length; i++) {
      const type = elems[order[i]].el_type;
      if (type === "note" || type === "bar") return type;
    }
    return null;
  }

  // `at` is a character of the score's source inside the bar the reader is
  // on, and `direction` is "up" or "down". Up takes that bar and every bar
  // before it on its line to the end of the line above; down takes it and
  // every bar after it to the head of the line below, or to a line of their
  // own under the last one. Every voice of the system moves the same bars;
  // or, with `only`, the voices it names by their keys and no other, which
  // is how the bars of a voice come up after a bar taken out of it alone
  // (fillLines).
  // Returns { source } or { refused }.
  function moveBars(A, src, at, direction, only) {
    if (!A || typeof A.parseOnly !== "function") return refuse("engine");
    if (/^(?:%%|I:)\s*linebreak\b/m.test(src)) return refuse("linebreak");
    let tune = null;
    try {
      tune = (A.parseOnly(src) || [])[0];
    } catch (e) {
      tune = null;
    }
    if (!tune) return refuse("parse");
    const systems = tune.lines.filter(function (line) {
      return line.staff;
    });
    // The voice and the bar the reader is on.
    let s = -1;
    let ref = null;
    let refIndex = -1;
    systems.forEach(function (line, i) {
      if (ref) return;
      voicesOf(line).forEach(function (voice) {
        if (ref) return;
        for (let e = 0; e < voice.elems.length; e++) {
          const el = voice.elems[e];
          if (el.el_type === "note" && el.startChar <= at && at < el.endChar) {
            s = i;
            ref = voice;
            refIndex = e;
            return;
          }
        }
      });
    });
    if (!ref) return refuse("place");
    const goes = function (voice) {
      return !only || only.indexOf(voice.key) >= 0;
    };
    if (!goes(ref)) return refuse("place");
    const up = direction === "up";
    const t = up ? s - 1 : s + 1;
    if (up && t < 0) return refuse("first");
    const target = t < systems.length ? systems[t] : null;
    // Every voice of the line, and the ones that move.
    const every = voicesOf(systems[s]);
    const here = every.filter(goes);
    const there = target ? voicesOf(target).filter(goes) : null;
    if (there) {
      const shape = function (list) {
        return list
          .map(function (v) {
            return v.key;
          })
          .join(",");
      };
      if (shape(here) !== shape(there)) return refuse("voices");
    }
    // A line that stops without a barline goes on into the next: ABC ends a
    // bar at a barline and not at a line break, and `C D | E F` over `G A |`
    // has the bar E F G A. Bars moved across that break join it, which the
    // lines' bars cannot then be counted to show, and the move was refused
    // as a change of the music though it read the same (verify, given the
    // lines as they came out: measured on that tune, 2026-09-30). Said for
    // what it is, in the owner's words.
    if (target && runsOn(src, up ? target : systems[s], up ? systems[s] : target, goes)) return refuse("runsOn");
    const refMusic = voiceOn(src, ref.elems);
    const refBars = barsOf(ref.elems, refMusic);
    let bar = -1;
    refBars.forEach(function (run, b) {
      if (run.indexOf(refIndex) >= 0) bar = b;
    });
    if (bar < 0) return refuse("place");
    // Up to and including bar `bar`, or from it to the end. The whole line
    // when that is every bar of the reader's voice, which is then the whole
    // line of every voice, however each one is barred.
    const whole = up ? bar === refBars.length - 1 : bar === 0;
    if (!up && !target && whole) return refuse("last");

    const edits = [];
    let failed = null;
    const counts = []; // bars of the reader's voice, for verify

    here.forEach(function (voice, n) {
      if (failed) return;
      const other = there ? there[n] : null;
      const elems = voice.elems;
      const music = voiceOn(src, elems);
      const bars = barsOf(elems, music);
      if (!music.length || !bars.length) {
        failed = "voices";
        return;
      }
      if (!whole && (up ? bars.length <= bar + 1 : bars.length <= bar)) {
        failed = "voices";
        return;
      }
      // The elements that move, as indexes into elems.
      let moving;
      if (whole) moving = music.slice();
      else if (up) moving = [].concat.apply([], bars.slice(0, bar + 1));
      else moving = [].concat.apply([], bars.slice(bar));
      const staying = music.filter(function (i) {
        return moving.indexOf(i) < 0;
      });
      const first = elems[moving[0]];
      const last = elems[moving[moving.length - 1]];
      const lineFrom = lineStart(src, elems[music[0]].startChar);
      const lineTo = lineEnd(src, elems[music[music.length - 1]].endChar - 1);
      // Bars taken from the head of the line take its head with them, the
      // fields written there included; bars from the middle begin at their
      // first element.
      const movedFrom = up || whole ? lineHead(src, lineFrom) : trimStart(src, first.startChar, last.endChar);
      const movedTo = trimEnd(src, last.endChar, movedFrom);
      let moved = src.slice(movedFrom, movedTo);
      if (!moved) {
        failed = "place";
        return;
      }
      // The barline the line is now broken at, when it opens an ending: the
      // barline ends the line and the ending opens the next (splitEnding).
      let opening = null;
      if (!whole && up) {
        const split = splitEnding(src, last);
        if (split && split.to === movedTo) {
          moved = src.slice(movedFrom, split.from) + split.bar;
          opening = split.ending;
        }
      } else if (!whole) {
        const split = splitEnding(src, elems[staying[staying.length - 1]]);
        if (split) {
          edits.push({ from: split.from, to: split.to, insert: split.bar });
          moved = split.ending + " " + moved;
        }
      }
      // What is cut out of this line: the moved text and the spaces that
      // stood between it and what stays. A line left with nothing but its
      // voice mark goes whole, with the w: lines under it.
      const verses = wordsUnder(src, lineTo);
      const reads = verses.map(function (verse) {
        return readVerse(verse, elems);
      });
      if (!whole) {
        if (up) {
          const next = gapAfter(src, movedTo, lineTo);
          edits.push({ from: movedFrom, to: next, insert: "" });
          if (opening) edits.push({ from: next, to: next, insert: opening + " " });
        } else {
          const before = gapBefore(src, movedFrom, lineFrom);
          edits.push({ from: before, to: movedTo, insert: "" });
        }
      } else {
        const rest = src.slice(lineFrom, movedFrom) + src.slice(movedTo, lineTo);
        if (/^\s*(?:\[V:[^\]]*\]\s*)?$/.test(rest)) {
          const blockEnd = verses.length ? verses[verses.length - 1].line.to : lineTo;
          // The line and its break: the one after it, or the one before
          // when it is the last line of the score.
          if (blockEnd < src.length) edits.push({ from: lineFrom, to: blockEnd + 1, insert: "" });
          else edits.push({ from: Math.max(0, lineFrom - 1), to: blockEnd, insert: "" });
        } else {
          edits.push({ from: movedFrom, to: movedTo, insert: "" });
        }
      }

      // The fields between the two lines, in this voice's stretch of the
      // text: written into the moved bars, where they go on taking effect at
      // the same note, and taken off their own lines.
      let fields = [];
      if (other || !up) {
        const otherMusic = other ? voiceOn(src, other.elems) : [];
        let gapFrom;
        let gapTo;
        if (up) {
          gapFrom = lineEnd(src, other.elems[otherMusic[otherMusic.length - 1]].endChar - 1) + 1;
          gapTo = lineFrom;
        } else if (other) {
          gapFrom = (verses.length ? verses[verses.length - 1].line.to : lineTo) + 1;
          gapTo = lineStart(src, other.elems[otherMusic[0]].startChar);
        } else {
          gapFrom = gapTo = 0;
        }
        const between = linesBetween(src, gapFrom, gapTo);
        let lastVoice = -1;
        between.forEach(function (line, i) {
          if (line.kind === "voice") lastVoice = i;
        });
        between.forEach(function (line, i) {
          if (line.kind === "field" && /^T:/.test(line.text)) failed = failed || "title";
          if (line.kind === "continued" || line.kind === "symbols") failed = failed || "lyrics";
          if (line.kind !== "field" || !INLINE_FIELD.test(line.text)) return;
          // Before the first V: of an interleaved stretch the field is the
          // other voices' as much as this one's; past the last it is this
          // voice's own, and the only kind carried.
          if (lastVoice >= 0 && i < lastVoice) {
            failed = failed || "fields";
            return;
          }
          fields.push("[" + line.text.replace(/\s+$/, "") + "]");
          edits.push({ from: line.from, to: Math.min(src.length, line.to + 1), insert: "" });
        });
      }
      if (failed) return;
      const inline = fields.join("");

      // The music, put where it goes.
      let otherVerses = [];
      let otherElems = [];
      let otherIndexes = [];
      if (other) {
        otherElems = other.elems;
        otherIndexes = voiceOn(src, otherElems);
        const otherLineTo = lineEnd(src, otherElems[otherIndexes[otherIndexes.length - 1]].endChar - 1);
        otherVerses = wordsUnder(src, otherLineTo);
      }
      if (up) {
        const endEl = otherElems[otherIndexes[otherIndexes.length - 1]];
        const at = trimEnd(src, endEl.endChar, endEl.startChar);
        edits.push({ from: at, to: at, insert: " " + inline + moved });
      } else if (other) {
        const headLine = lineStart(src, otherElems[otherIndexes[0]].startChar);
        // Before the fields at the head of the line below: they took effect
        // where its music began, which is after the bars coming down now.
        const at = lineHead(src, headLine);
        // An ending the line below opens at its head (`[1`, what splitEnding
        // leaves) is opened again by the barline the moved bars end on, as
        // `|1`: the move that took the two apart, made backwards.
        const head = otherElems[otherIndexes[0]];
        const opened = /^\[([0-9][0-9,\-]*)[ \t]*/.exec(src.slice(at, head.endChar + 8));
        if (
          opened &&
          !inline &&
          head.el_type === "bar" &&
          head.type === "bar_invisible" &&
          head.startEnding &&
          trimStart(src, head.startChar, head.endChar) === at &&
          last.el_type === "bar" &&
          !last.startEnding &&
          /(^|[^:|\]])\|$/.test(moved)
        ) {
          moved += opened[1];
          edits.push({ from: at, to: at + opened[0].length, insert: "" });
        }
        // Back on lines of their own only where there is one voice: a field
        // line in the body of a tune with several is read by abcjs for all of
        // them (measured: an [M:2/4] of the first voice taken to its own line
        // put the second voice's opening bars in 2/4).
        const lead = every.length === 1 ? leadingFields(moved) : { fields: [], rest: moved };
        if (lead.fields.length && !src.slice(headLine, at).trim()) {
          const above = lead.fields.join("\n") + "\n";
          if (headLine === at) {
            edits.push({ from: at, to: at, insert: above + lead.rest + " " + inline });
          } else {
            edits.push({ from: headLine, to: headLine, insert: above });
            edits.push({ from: at, to: at, insert: lead.rest + " " + inline });
          }
        } else {
          edits.push({ from: at, to: at, insert: moved + " " + inline });
        }
      }

      // The lyrics, verse by verse. Each verse of this line is cut where
      // the moved bars end or begin, and the piece goes to the same verse of
      // the other line, which is padded with a `*` for each of its own notes
      // it had nothing for, so the piece lands on the moved notes and on
      // nothing before them.
      const verseCount = Math.max(verses.length, otherVerses.length);
      const newVerses = [];
      for (let j = 0; j < verseCount && !failed; j++) {
        const read = reads[j] || readVerse(null, elems);
        // The tokens the moved notes take.
        const mine = [];
        read.taker.forEach(function (i, k) {
          if (moving.indexOf(i) >= 0) mine.push(k);
        });
        if (!read.clean) {
          // Tokens nothing takes: harmless at the end of a verse that stays
          // where it is, and wrong anywhere they would be followed by more.
          const looseMoves = up ? whole : true;
          if (looseMoves || mine.length) {
            failed = "lyrics";
            break;
          }
        }
        let piece = "";
        let cutFrom = -1;
        let cutTo = -1;
        if (mine.length && read.verse) {
          const tokens = read.tokens;
          const a = tokens[mine[0]];
          const b = tokens[mine[mine.length - 1]];
          // A token that shares its character with the one before (a
          // syllable ending in `_`, and the hold it pushes) is cut there by
          // writing the character on both sides.
          piece = read.verse.text.slice(a.from, b.to).trim();
          cutFrom = a.from;
          cutTo = b.to;
          if (mine[0] > 0 && tokens[mine[0] - 1].to > a.from) cutFrom = tokens[mine[0] - 1].to;
        }
        // The moved notes the verse had nothing for, after its last piece.
        const tail = noteCount(
          elems,
          moving.filter(function (i) {
            let taken = false;
            read.taker.forEach(function (k) {
              if (k >= i) taken = true;
            });
            return !taken;
          })
        );
        if (up) {
          // Onto the end of the verse above, padded out to its last note.
          const otherRead = readVerse(otherVerses[j] || null, otherElems);
          if (!otherRead.clean) {
            failed = "lyrics";
            break;
          }
          if (!piece) continue;
          const pad = untaken(otherRead, otherElems, otherIndexes);
          const skip =
            bareBar(otherRead, otherElems, otherIndexes[otherIndexes.length - 1]) &&
            opensWithSkip(read.tokens.slice(mine[0]));
          const add = (pad ? stars(pad) + " " : "") + (skip ? "| " : "") + piece;
          if (otherVerses[j]) {
            const v = otherVerses[j];
            edits.push({ from: v.to, to: v.to, insert: (v.to > v.from ? " " : "") + add });
          } else {
            newVerses.push({ index: j, text: add, under: "other" });
          }
        } else {
          // Onto the head of the verse below, padded over the moved notes
          // this verse gave nothing to, so the verse below starts on its own
          // first note as before.
          const skip =
            otherVerses[j] &&
            bareBar(read, elems, moving[moving.length - 1]) &&
            opensWithSkip(lyricTokens(otherVerses[j].text))
              ? "|"
              : "";
          const lead = (piece ? [piece, tail ? stars(tail) : "", skip] : [stars(noteCount(elems, moving)), skip])
            .filter(function (part) {
              return part;
            })
            .join(" ");
          if (other) {
            if (otherVerses[j]) {
              const v = otherVerses[j];
              if (lead) edits.push({ from: v.from, to: v.from, insert: lead + (v.to > v.from ? " " : "") });
            } else if (piece) {
              newVerses.push({ index: j, text: lead, under: "other" });
            }
          } else if (piece) {
            newVerses.push({ index: j, text: piece, under: "new" });
          }
        }
        // What stays of this verse. A verse left with nothing goes, line and
        // all: abcjs gives an empty w: line to no note, so the verses under it
        // are read the same with or without it.
        if (piece && read.verse && !whole) {
          const v = read.verse;
          const base = v.from;
          let from;
          let to;
          if (up) {
            from = cutFrom;
            to = trimStart(v.text, cutTo, v.text.length);
          } else {
            from = trimEnd(v.text, cutFrom, 0);
            to = cutTo;
          }
          if (!(v.text.slice(0, from) + v.text.slice(to)).trim()) {
            const line = v.line;
            if (line.to < src.length) edits.push({ from: line.from, to: line.to + 1, insert: "" });
            else edits.push({ from: Math.max(0, line.from - 1), to: line.to, insert: "" });
          } else {
            edits.push({ from: base + from, to: base + to, insert: "" });
          }
        }
      }
      if (failed) return;
      // A verse the other line did not have: a line of its own under the
      // last verse it does have (or under its music), numbered by padding the
      // verses before it with stars.
      const underOther = newVerses.filter(function (v) {
        return v.under === "other";
      });
      if (underOther.length) {
        const otherLineTo = lineEnd(src, otherElems[otherIndexes[otherIndexes.length - 1]].endChar - 1);
        const anchor = otherVerses.length ? otherVerses[otherVerses.length - 1].line.to : otherLineTo;
        let text = "";
        for (let j = otherVerses.length; j <= underOther[underOther.length - 1].index; j++) {
          const v = underOther.filter(function (u) {
            return u.index === j;
          })[0];
          const pad = up ? noteCount(otherElems, otherIndexes) : 0;
          text += "\nw: " + (v ? v.text : stars(up ? pad : noteCount(elems, moving)));
        }
        edits.push({ from: anchor, to: anchor, insert: text });
      }
      if (!up && !other) {
        // Under the last line, a line of its own: the voice mark the line
        // opened with, the bars, and what the verses had for them.
        const mark = /^\s*(\[V:[^\]]*\])/.exec(src.slice(lineFrom, movedFrom));
        const lead = mark || every.length > 1 ? { fields: [], rest: moved } : leadingFields(moved);
        let text =
          "\n" +
          (lead.fields.length ? lead.fields.join("\n") + "\n" : "") +
          (mark ? mark[1] + " " : "") +
          lead.rest;
        const underNew = newVerses.filter(function (v) {
          return v.under === "new";
        });
        for (let j = 0; underNew.length && j <= underNew[underNew.length - 1].index; j++) {
          const v = underNew.filter(function (u) {
            return u.index === j;
          })[0];
          text += "\nw: " + (v ? v.text : stars(noteCount(elems, moving)));
        }
        const anchor = verses.length ? verses[verses.length - 1].line.to : lineTo;
        edits.push({ from: anchor, to: anchor, insert: text });
      }
      if (voice === ref) counts.push(bars.length);
    });
    if (failed) return refuse(failed);

    const out = apply(src, edits);
    if (out === null) return refuse("overlap");
    const moves = up ? (whole ? refBars.length : bar + 1) : whole ? refBars.length : refBars.length - bar;
    const expect = systemBars(src, A, ref.key);
    if (!expect) return refuse("parse");
    if (up) {
      expect[t] += moves;
      expect[s] -= moves;
    } else if (target) {
      expect[t] += moves;
      expect[s] -= moves;
    } else {
      expect[s] -= moves;
      expect.push(moves);
    }
    const layout = expect.filter(function (n) {
      return n > 0;
    });
    const check = verify(A, src, out, ref.key, layout);
    if (check) return refuse(check);
    return { source: out };
  }

  // The edits into the text, the last first so each lands where it was
  // measured. Two cuts that meet are one cut (a field line taken out just
  // above a line that goes whole); anything else that crosses is a fault of
  // the planning above. Two insertions at one point go in in the order they
  // were planned (the bars at the end of a line, then a verse written under
  // it). A score whose last line went keeps ending where it ended, on its
  // last character and not on a line break.
  function apply(src, edits) {
    edits.forEach(function (e, i) {
      e.seq = i;
    });
    const cuts = edits
      .filter(function (e) {
        return !e.insert && e.to > e.from;
      })
      .sort(function (a, b) {
        return a.from - b.from;
      });
    const merged = [];
    cuts.forEach(function (e) {
      const last = merged[merged.length - 1];
      if (last && e.from <= last.to) last.to = Math.max(last.to, e.to);
      else merged.push({ from: e.from, to: e.to, insert: "" });
    });
    const rest = edits.filter(function (e) {
      return e.insert || e.to === e.from;
    });
    const sorted = merged.concat(rest).sort(function (a, b) {
      return b.from - a.from || b.to - a.to || (b.seq || 0) - (a.seq || 0);
    });
    let out = src;
    let floor = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      if (e.to > floor) return null;
      // An insertion inside a cut would be cut with it.
      if (e.insert && merged.some(function (c) {
        return c.from < e.from && e.from < c.to;
      })) return null;
      out = out.slice(0, e.from) + e.insert + out.slice(e.to);
      floor = e.from;
    }
    if (!/\n$/.test(src)) out = out.replace(/\n+$/, "");
    return out;
  }

  // ---------- A bar added ----------
  //
  // The score mode's + (main.js): an empty bar at a barline, in every voice
  // of the line at once, or at the head of a line. What is written is the
  // rest of a bar as long as the bar in each voice: the bar of the meter
  // that voice is in there, or where there is none (no M:, or M:none) the
  // bar beside it. Not `Z`, the rest ABC has for a whole bar: abcjs 6.7.0
  // draws it as a rest of several bars with a 1 over it, with a meter or
  // without one (checked in 2/4, 3/4, 4/4 and with no meter;
  // design-score-editing.html). How the rests' lengths are written is
  // abcjs's to say: the unit length in force there (L:, inline, or a
  // voice's own) is read off a rest of one unit put there first.
  //
  // One rest, where abcjs knows how long the bar is: its engraver draws a
  // rest the length of its bar as the whole-bar rest, the one engraving
  // writes for an empty bar in any meter (seen drawn so in 4/4, 3/4, 2/4,
  // 6/8, 5/8 and 7/8). Where it does not know, the rests a musician would
  // write, the owner's pick of design-score-editing-2.html (A, 2026-09-29;
  // barRests): a meter written as a sum, `2+3/8`, whose bar abcjs takes to
  // be "2+3" over 8 and so no number, has a rest for each group (`z2 z3`),
  // and a bar with no meter to go by has the longest rests first (seven
  // quarters `z4 z3`). One rest eight quarters long, what the partials of
  // example.mdm were given before, abcjs cannot draw at all: it writes
  // "pitch is undefined" in red where the rest should be.
  //
  // The rest goes after the barline and is closed by a barline of its own,
  // so the barline keeps whatever it says (a repeat, an ending) and the new
  // bar is the one after it. The barline that ends a voice (`|]` or `||`,
  // with nothing after it in the tune) is the exception, since a bar after
  // the end of a tune is no bar of it: there the new bar goes in before it,
  // and it goes on ending the tune. A bar that no barline closes, the last
  // of a line written open (a tune with no barline in it, `C D E F`, or one
  // that stops without one) is closed by the barline the new bar opens
  // with, and the new bar is left open as that one was: `C D E F | z4`. Such
  // a tune had nowhere to be given a bar but its head (the owner's report,
  // 2026-09-30).
  //
  // `at` is a character of a note of the bar the barline closes, or that
  // is left open, or, with `where` "head", of the first bar of a line, for a
  // bar before it. With `where` "before" it is of any bar, for a bar before
  // it, past the barlines that open it: the + of a barline that closes no
  // bar, the second of `C | | G`, which is a barline all the same where the
  // reader sees one (the owner's report, 2026-10-02). With `own`, the bar
  // goes into the voice `at` is in and into no other, which is then a bar
  // longer than the rest of its line: the owner's call of 2026-10-03 for
  // the keys, Ctrl with an arrow for the cursor's voice. `own` may be a
  // list of characters as well, one of a note of each voice that is to
  // take the bar on that line beside the one `at` is in: the voices a
  // stretch is chosen over, which that key adds the bar to since
  // 2026-10-06 (the owner's "una vez estén marcadas con ctrl shift, se hace
  // ctrl -> y debe añadirse el compás de silencio al lado"; until then
  // Ctrl+Alt with the arrow added it to every voice there is, as the + adds
  // it, and the two were all there was to ask for). Returns
  // { source, rest }, with where the rest of the voice `at` is in begins in
  // the new source, or { refused }.
  function addBar(A, src, at, where, own) {
    if (!A || typeof A.parseOnly !== "function") return refuse("engine");
    const tune = parsed(A, src);
    if (!tune) return refuse("parse");
    const systems = tune.lines.filter(function (line) {
      return line.staff;
    });
    const found = placeOf(systems, at);
    if (!found) return refuse("addPlace");
    const s = found.system;
    const refBars = barsOf(found.voice.elems, voiceOn(src, found.voice.elems));
    let bar = -1;
    refBars.forEach(function (run, b) {
      if (run.indexOf(found.index) >= 0) bar = b;
    });
    // Before the first bar of a line is at its head.
    const head = where === "head" || (where === "before" && bar === 0);
    const before = where === "before" && bar > 0;
    if (bar < 0 || (where === "head" && bar !== 0)) return refuse("addPlace");
    // The voices that take the bar: every one of the line, or the one `at`
    // is in, alone or with the ones the characters of `own` are in.
    let takers = null;
    if (own) {
      takers = [found.voice.key];
      const others = Array.isArray(own) ? own : [];
      for (let i = 0; i < others.length; i++) {
        const other = placeOf(systems, others[i]);
        if (!other || other.system !== s) return refuse("addPlace");
        if (takers.indexOf(other.voice.key) < 0) takers.push(other.voice.key);
      }
    }

    const plans = [];
    const lyrics = [];
    let failed = null;
    voicesOf(systems[s]).forEach(function (voice) {
      if (failed || (takers && takers.indexOf(voice.key) < 0)) return;
      const elems = voice.elems;
      const music = voiceOn(src, elems);
      const bars = barsOf(elems, music);
      if (!music.length || bars.length <= bar) {
        failed = "addVoices";
        return;
      }
      const plan = { key: voice.key, run: head ? bars[0] : bars[bar] };
      if (head) {
        // Past a barline that opens the line (`|:`, an ending), or else past
        // the voice's mark and the fields written inline at the head, so the
        // new bar opens the line under the line's own meter and key.
        const run = bars[0];
        let opening = -1;
        for (let k = 0; k < run.length && elems[run[k]].el_type !== "note"; k++) {
          if (elems[run[k]].el_type === "bar") opening = run[k];
        }
        if (opening >= 0) {
          const el = elems[opening];
          plan.kind = "after";
          plan.last = opening;
          plan.pos = trimEnd(src, el.endChar, trimStart(src, el.startChar, el.endChar));
        } else {
          let pos = lineHead(src, lineStart(src, elems[music[0]].startChar));
          let field;
          while ((field = /^\[[KLMPQ]:[^\]]*\][ \t]*/.exec(src.slice(pos, pos + 200)))) pos += field[0].length;
          plan.kind = "head";
          plan.last = -1;
          plan.pos = pos;
        }
      } else if (before) {
        // Past the last barline before the bar's first note: one of its own
        // (`C | | G`, where abcjs gives the G's bar both), or the one that
        // closes the bar before it, where it has none.
        const run = bars[bar];
        let opening = -1;
        for (let k = 0; k < run.length && elems[run[k]].el_type !== "note"; k++) {
          if (elems[run[k]].el_type === "bar") opening = run[k];
        }
        const prev = bars[bar - 1];
        if (opening < 0 && elems[prev[prev.length - 1]].el_type === "bar") opening = prev[prev.length - 1];
        if (opening < 0) {
          failed = "addPlace";
          return;
        }
        const el = elems[opening];
        plan.kind = "after";
        plan.last = opening;
        plan.pos = trimEnd(src, el.endChar, trimStart(src, el.startChar, el.endChar));
      } else {
        // The barline that closes the bar: the first one after a note of it.
        let seen = false;
        let close = -1;
        plan.run.forEach(function (i) {
          const el = elems[i];
          if (el.el_type === "note") seen = true;
          else if (el.el_type === "bar" && seen && close < 0) close = i;
        });
        if (close < 0) {
          // Open, and so the last bar of the voice on its line (barsOf): the
          // new barline goes in after the last thing written in it, an
          // inline field included, which stays in the bar it was written in.
          plan.kind = "open";
          plan.last = plan.run[plan.run.length - 1];
          const el = elems[plan.last];
          plan.pos = trimEnd(src, el.endChar, el.startChar);
        } else {
          const el = elems[close];
          const from = trimStart(src, el.startChar, el.endChar);
          if ((el.type === "bar_thin_thick" || el.type === "bar_thin_thin") && lastOfVoice(systems, voice.key, s, close)) {
            plan.kind = "end";
            plan.last = close - 1;
            plan.pos = from;
          } else {
            plan.kind = "after";
            plan.last = close;
            plan.pos = trimEnd(src, el.endChar, from);
          }
        }
      }
      // A tie from the note before into the one after would be cut by it,
      // and so would the voices laid over each other with `&` on this line,
      // which the rest would go into one of and not the other.
      if (tiedAcross(systems, voice.key, s, plan.last)) {
        failed = "addTie";
        return;
      }
      if (/&/.test(musicText(src, elems, music))) {
        failed = "addVoices";
        return;
      }
      const meter = meterAt(systems, voice.key, s, plan.last);
      const measure = meterLength(meter);
      plan.length = measure !== null ? measure : barLength(elems, plan.run);
      if (!(plan.length > 0)) {
        failed = "addMeter";
        return;
      }
      plan.rests = barRests(plan.length, meter, drawnBar(systems, voice.key, s));
      // The verses under the line make room for the new rest and barline
      // (lyricRoom). A symbol line is read against the notes as a verse is,
      // and is not rewritten here.
      const lineTo = lineEnd(src, elems[music[music.length - 1]].endChar - 1);
      const verses = wordsUnder(src, lineTo);
      const below = verses.length ? verses[verses.length - 1].line.to : lineTo;
      if (below < src.length && /^(?:s|\+):/.test(src.slice(below + 1, lineEnd(src, below + 1)))) {
        failed = "addLyrics";
        return;
      }
      verses.forEach(function (verse) {
        if (failed) return;
        const room = lyricRoom(readVerse(verse, elems), plan.last, plan.rests.length);
        if (room === null) failed = "addLyrics";
        else if (room) lyrics.push({ from: verse.from + room.at, to: verse.from + room.at, insert: room.text });
      });
      plans.push(plan);
    });
    if (failed) return refuse(failed);

    // A rest of one unit first, for abcjs to say how long the unit is there.
    const probe = written(src, plans, lyrics, function () {
      return "z";
    });
    const probed = probe ? parsed(A, probe.source) : null;
    if (!probed) return refuse("addUnsafe");
    const texts = {};
    for (let n = 0; n < plans.length; n++) {
      const unit = restIn(probed, probe.source, probe.spans[n]);
      const lengths = plans[n].rests.map(function (length) {
        return unit ? restLength(length, unit.duration) : null;
      });
      if (lengths.indexOf(null) >= 0) return refuse("addMeter");
      texts[plans[n].key] = lengths
        .map(function (length) {
          return "z" + length;
        })
        .join(" ");
    }
    const out = written(src, plans, lyrics, function (plan) {
      return texts[plan.key];
    });
    if (!out) return refuse("addUnsafe");
    const check = verifyAdd(A, src, out.source, s, plans, found.voice.key);
    if (check) return refuse(check);
    const made = parsed(A, out.source);
    let rest = -1;
    plans.forEach(function (plan, n) {
      const el = plan.key === found.voice.key ? restIn(made, out.source, out.spans[n]) : null;
      if (el) rest = el.startChar;
    });
    return { source: out.source, rest: rest };
  }

  function parsed(A, src) {
    try {
      return (A.parseOnly(src) || [])[0] || null;
    } catch (e) {
      return null;
    }
  }

  // The system, the voice and the note a character of the source is in.
  function placeOf(systems, at) {
    for (let i = 0; i < systems.length; i++) {
      const voices = voicesOf(systems[i]);
      for (let v = 0; v < voices.length; v++) {
        const elems = voices[v].elems;
        for (let e = 0; e < elems.length; e++) {
          const el = elems[e];
          if (el.el_type === "note" && el.startChar <= at && at < el.endChar) return { system: i, voice: voices[v], index: e };
        }
      }
    }
    return null;
  }

  function voiceIn(line, key) {
    return voicesOf(line).filter(function (v) {
      return v.key === key;
    })[0];
  }

  // Whether nothing of a voice comes after one of its elements in the tune.
  function lastOfVoice(systems, key, s, e) {
    for (let i = s; i < systems.length; i++) {
      const voice = voiceIn(systems[i], key);
      if (!voice) continue;
      for (let j = i === s ? e + 1 : 0; j < voice.elems.length; j++) {
        const type = voice.elems[j].el_type;
        if (type === "note" || type === "bar") return false;
      }
    }
    return true;
  }

  // Whether the last note of a voice at or before one of its elements (-1
  // for the head of the line, where it is the last note of the line above)
  // is tied into the next.
  function tiedAcross(systems, key, s, e) {
    for (let i = s; i >= 0; i--) {
      const voice = voiceIn(systems[i], key);
      if (!voice) continue;
      for (let j = i === s ? e : voice.elems.length - 1; j >= 0; j--) {
        const el = voice.elems[j];
        if (el.el_type !== "note" || el.rest) continue;
        return (el.pitches || []).some(function (pitch) {
          return !!pitch.startTie;
        });
      }
    }
    return false;
  }

  // The text a voice's music on a line is written in, its chord symbols,
  // annotations, decorations and comments left out.
  function musicText(src, elems, music) {
    const from = lineStart(src, elems[music[0]].startChar);
    const to = lineEnd(src, elems[music[music.length - 1]].endChar - 1);
    return src
      .slice(from, to)
      .replace(/%.*$/gm, "")
      .replace(/"[^"]*"|![^!]*!/g, "");
  }

  // The meter a voice is in just past one of its elements (-1 for the head
  // of the line): the last one its staff was given at the head of a line,
  // or the voice inline, up to there.
  function meterAt(systems, key, s, e) {
    const staff = Number(key.split("/")[0]);
    let meter = null;
    for (let i = 0; i <= s; i++) {
      const line = systems[i].staff[staff];
      if (line && line.meter) meter = line.meter;
      const voice = voiceIn(systems[i], key);
      if (!voice) continue;
      const last = i === s ? e : voice.elems.length - 1;
      for (let j = 0; j <= last && j < voice.elems.length; j++) {
        if (voice.elems[j].el_type === "meter") meter = voice.elems[j];
      }
    }
    return meter;
  }

  // A bar of a meter, in whole notes (C and C| are a whole note, 2+3/8 is
  // five eighths), or null for no meter and for one this does not read.
  function meterLength(meter) {
    if (!meter) return null;
    if (meter.type === "common_time" || meter.type === "cut_time") return 1;
    if (!meter.value || !meter.value.length) return null;
    let sum = 0;
    for (let i = 0; i < meter.value.length; i++) {
      let num = 0;
      String(meter.value[i].num)
        .split("+")
        .forEach(function (part) {
          num += Number(part);
        });
      const den = Number(meter.value[i].den);
      if (!(num > 0) || !(den > 0)) return null;
      sum += num / den;
    }
    return sum;
  }

  // How long a bar lasts by what is written in it, in whole notes: a
  // tuplet's notes each by the multiplier abcjs puts on the first of them.
  function barLength(elems, run) {
    let sum = 0;
    let factor = 1;
    run.forEach(function (i) {
      const el = elems[i];
      if (el.el_type !== "note") return;
      if (el.startTriplet && el.tripletMultiplier) factor = el.tripletMultiplier;
      sum += (el.duration || 0) * factor;
      if (el.endTriplet) factor = 1;
    });
    return sum;
  }

  // How long abcjs's engraver takes a bar of a voice's staff to be on the
  // line `s`: the meter the staff was last given at the head of a line, read
  // as the engraver reads it (the first term's numerator over its
  // denominator, which makes no number of `2+3/8`), a common or a cut time
  // as a whole note, and a whole note where the tune names no meter, which
  // abcjs takes for 4/4. A meter changed inside a line is not read by it
  // (abcjs 6.7.0, read in its bundle): a rest that bar long is drawn there
  // as a rest of its length, and not as the bar's.
  function drawnBar(systems, key, s) {
    const staff = Number(key.split("/")[0]);
    let bar = 1;
    for (let i = 0; i <= s; i++) {
      const line = systems[i].staff[staff];
      const meter = line && line.meter;
      if (!meter) continue;
      bar = meter.type === "specified" && meter.value && meter.value.length ? Number(meter.value[0].num) / Number(meter.value[0].den) : 1;
    }
    return bar;
  }

  // The rests an empty bar `length` whole notes long is written with, as
  // their lengths in whole notes, one after the other (A bar added, above):
  // one for each group of a meter written as a sum, one for the whole bar
  // where abcjs draws that as the bar's rest, and the longest first where
  // it does not. One rest the bar long where they cannot be told, as before.
  function barRests(length, meter, drawn) {
    const groups = meterGroups(meter);
    const total = (groups || []).reduce(function (a, b) {
      return a + b;
    }, 0);
    if (groups && Math.abs(total - length) < 1e-9) {
      let out = [];
      for (let i = 0; i < groups.length; i++) {
        const rests = longestRests(groups[i]);
        if (!rests) return [length];
        out = out.concat(rests);
      }
      return out;
    }
    if (Math.abs(length - drawn) < 1e-9) return [length];
    return longestRests(length) || [length];
  }

  // The groups of a meter written as a sum, in whole notes (`2+3/8` is a
  // quarter and a dotted quarter), or null for any other.
  function meterGroups(meter) {
    if (!meter || meter.type !== "specified" || !meter.value) return null;
    if (!meter.value.some(function (term) {
      return String(term.num).indexOf("+") >= 0;
    })) return null;
    const out = [];
    meter.value.forEach(function (term) {
      String(term.num)
        .split("+")
        .forEach(function (part) {
          out.push(Number(part) / Number(term.den));
        });
    });
    return out.every(function (g) {
      return g > 0;
    })
      ? out
      : null;
  }

  // Rests that make a length, the longest that fits first and again, none
  // longer than a whole rest and any shorter one with its dot: seven
  // quarters are a whole and a dotted half, eight two wholes, a group of
  // three eighths one dotted quarter. Null for a length they do not make
  // (a third of a beat).
  const REST_VALUES = [1, 3 / 4, 1 / 2, 3 / 8, 1 / 4, 3 / 16, 1 / 8, 3 / 32, 1 / 16, 3 / 64, 1 / 32, 1 / 64];
  function longestRests(length) {
    const out = [];
    let left = length;
    while (left > 1e-9 && out.length < 16) {
      const value = REST_VALUES.filter(function (v) {
        return v <= left + 1e-9;
      })[0];
      if (!value) return null;
      out.push(value);
      left -= value;
    }
    return left > 1e-9 ? null : out;
  }

  // What follows `z` for a rest `length` whole notes long where the unit is
  // `unit` long: `2`, `3/2`, `/2`, nothing for one unit; null where no power
  // of two up to 64 divides it into whole units.
  function restLength(length, unit) {
    if (!(unit > 0) || !(length > 0)) return null;
    const n = length / unit;
    for (let q = 1; q <= 64; q *= 2) {
      const p = Math.round(n * q);
      if (p > 0 && Math.abs(p - n * q) < 1e-6) return (p === 1 ? "" : String(p)) + (q === 1 ? "" : "/" + q);
    }
    return null;
  }

  // What a verse needs written for `rests` rests and a barline put in just
  // past the element `last` of its line (-1 for the head of the line). The
  // first piece of the verse not taken before that point is offered to the
  // new rests and the new barline before the notes it went to. A syllable
  // passes over them all; a `*`, a `_` or a lone `-` would be taken by the
  // first rest and the pieces like it after it by the rests after that,
  // and a `|` by the barline, so pieces of their own are written in front
  // of it for them to take, a `*` for each rest or a `|`. { at, text } for
  // that, false for nothing to write, and null where it cannot be written:
  // a `_` sharing its character with the syllable before it (`la_`) can
  // have nothing put between the two.
  function lyricRoom(read, last, rests) {
    let k = 0;
    while (k < read.taker.length && read.taker[k] >= 0 && read.taker[k] <= last) k++;
    if (k >= read.tokens.length) return false;
    const token = read.tokens[k];
    if (!token.skip) return false;
    if (k > 0 && read.tokens[k - 1].to > token.from) return null;
    return { at: token.from, text: token.skip === "bar" ? "| " : new Array((rests || 1) + 1).join("* ") };
  }

  // The source with a rest written for each voice (`text` of its plan) and
  // the verses' room, as { source, spans }: where the new text of each voice
  // stands in it. Null when the edits cross.
  function written(src, plans, lyrics, text) {
    const inserts = plans.map(function (plan) {
      const rest = text(plan);
      if (plan.kind === "end") return "| " + rest + " ";
      if (plan.kind === "open") return " | " + rest;
      if (plan.kind === "head") return rest + " | ";
      return " " + rest + " |";
    });
    const edits = lyrics.map(function (e) {
      return { from: e.from, to: e.to, insert: e.insert };
    });
    plans.forEach(function (plan, n) {
      edits.push({ from: plan.pos, to: plan.pos, insert: inserts[n] });
    });
    const source = apply(src, edits);
    if (source === null) return null;
    // Every edit is an insertion, so a point moves on by what went in
    // before it.
    const spans = plans.map(function (plan, n) {
      let shift = 0;
      edits.forEach(function (e) {
        if (e.from < plan.pos) shift += e.insert.length;
      });
      return { from: plan.pos + shift, to: plan.pos + shift + inserts[n].length };
    });
    return { source: source, spans: spans };
  }

  // The rest written inside a span of a source, as abcjs read it. abcjs
  // starts an element at the spaces before it, which for a rest written
  // after `[V:1] ` or `[M:2/4] ` at the head of a line are outside the span,
  // and ends one past the space after it when a chord symbol or a
  // decoration follows, as one left at the end of a line written open does
  // (`C D E F "Am"`, whose bar was refused for want of a length).
  function restIn(tune, source, span) {
    let from = span.from;
    while (from > 0 && /[ \t]/.test(source.charAt(from - 1))) from--;
    let found = null;
    (tune ? tune.lines : []).forEach(function (line) {
      if (!line.staff || found) return;
      voicesOf(line).forEach(function (voice) {
        voice.elems.forEach(function (el) {
          if (!found && el.el_type === "note" && el.rest && el.startChar >= from && el.startChar < span.to) found = el;
        });
      });
    });
    return found;
  }

  // ---------- A note written ----------
  //
  // The score mode's Enter and its figure keys (main.js): a head put on the
  // place the cursor stands on, at a step of the staff, a place being a
  // note, a chord or a rest of one voice. The owner asked for it on
  // 2026-10-02, and the same evening for it to build chords: Enter on a
  // note at another step adds a head to it, at the note's own length, and a
  // key of a figure on a note adds the head and gives the whole place that
  // figure (C a quarter, a G added with the eighth's key: `[CG]` an
  // eighth). On a rest a head asked for with no figure, which is the mode's
  // Enter there, is a note written as long as the rest (the owner's call of
  // 2026-10-03: "si hay un silencio y se da enter, la nota debe salir con la
  // duración del silencio"). A head is taken off by Delete (takeOut, below),
  // which calls this with `off`.
  //
  // A place written on changes itself and nothing beside it (the owner's
  // call of 2026-10-04: "Si se alarga o se encoge, todo lo demás queda igual,
  // el tiempo no se lo debe quitar a nadie. Es responsabilidad del usuario
  // corregir su compás"). A note made shorter leaves no rest and the bar
  // that much shorter (theirs already, 2026-10-02: "no quiero que se añada
  // silencio, el compás deberá quedarse incompleto"); one made longer leaves
  // the bar that much longer than its meter, the notes and the rests after
  // it coming later; and a note written on a rest takes the rest's place
  // whole, whatever the two last: a quarter on the rest of an empty bar
  // leaves a bar of one quarter ("al marcar 3 sale la negra y el compás
  // queda incompleto"), and a half on a quarter's rest a bar a quarter
  // longer. Until that day a place made longer took the room the meter left
  // in its bar and then the rests after it, and a note shorter than the
  // rest it was written on left the rests a musician would write for what
  // was over, so that a bar kept its length where it could; and until
  // 2026-10-03 a figure too long for the bar was refused ("No room in this
  // bar"). What is done with a bar badly filled is still to decide.
  //
  // What is written is the heads and the length. Everything else on the
  // place stays: its chord symbol, its decorations, its grace notes, the
  // slur it opens or closes, and each head kept as it was written, its
  // accidental with it; the heads of a chord are written from the lowest up.
  // Where the length stays the one it had, a head can be put on or taken
  // off a note inside a tuplet or a broken rhythm; a new length there is
  // refused, and so is a place with a tie on it, which would be left tying
  // what is no longer the same note. Under a verse a note made a rest takes
  // its syllables with it (wordsRested), and a rest is made no note.
  //
  // A note shorter than a quarter, written on a rest or given a new length,
  // is written against the one beside it, with no space between, when both
  // stand in the same beat: ABC beams the notes written together, and eight
  // eighths typed one by one would come out as eight flags otherwise. Not
  // against a note of a tuplet, whose beam is its own (a `d` made an eighth
  // before `(3efg` came out as `d)(3efg`). The spacing of anything else is
  // left as it was written.
  //
  // How a length is written is abcjs's to say, as for a bar added: the unit
  // in force is read off the note written there with none, and so is the
  // step a pitch is drawn at, which the clef in force decides (a `C` is the
  // ledger line under a treble staff and the second space of a bass one).
  //
  // `at` is a character of the place, and `note` is { step, duration, off }
  // for a head at a step of the staff as abcjs counts them (verticalPos):
  // put on, or with `off` taken off when the place has one there (the last
  // head of a place leaves a rest as long); or { rest: true, duration } for
  // the place made a rest. With no duration, the place keeps its own.
  // Returns { source, at, duration, rest }, with where the place begins in
  // the new source and whether it is a rest now, `same` when the place
  // already read so and nothing was written, or { refused }.
  const EPS = 1e-9;

  function writeNote(A, src, at, note) {
    if (!A || typeof A.parseOnly !== "function") return refuse("engine");
    const tune = parsed(A, src);
    if (!tune) return refuse("parse");
    const systems = tune.lines.filter(function (line) {
      return line.staff;
    });
    const found = placeOf(systems, at);
    if (!found || !note) return refuse("notePlace");
    const s = found.system;
    const key = found.voice.key;
    const elems = found.voice.elems;
    const first = found.index;
    const el = elems[first];
    const music = voiceOn(src, elems);
    let run = null;
    barsOf(elems, music).forEach(function (bar) {
      if (bar.indexOf(first) >= 0) run = bar;
    });
    const parts = noteParts(src, el);
    if (!run || !parts) return refuse("noteUnsafe");
    const length = note.duration > 0 ? note.duration : el.duration;
    // `Z`, the rest of a whole bar: what follows it counts bars and is no
    // length, so it is written over as a new length is, and never when it
    // stands for more bars than one.
    const whole = !!el.rest && el.rest.type === "multimeasure";
    if (whole && (parts.length > parts.body || el.rest.text !== 1)) return refuse("noteUnsafe");
    const same = Math.abs(length - el.duration) < EPS;

    // The heads the place is to have: the ones it has, each as it is
    // written, with the one asked for put on, or taken off.
    const had = el.rest
      ? []
      : (el.pitches || []).map(function (pitch) {
          return { step: pitch.verticalPos, name: pitch.name };
        });
    const there = had.some(function (head) {
      return head.step === note.step;
    });
    let heads = had;
    if (note.rest) heads = [];
    else if (there && note.off) {
      heads = had.filter(function (head) {
        return head.step !== note.step;
      });
    } else if (!there && !note.off) {
      heads = had.concat([{ step: note.step, name: null }]);
    }
    heads = heads.slice().sort(function (x, y) {
      return x.step - y.step;
    });
    const rest = heads.length === 0;
    const kept = rest ? !!el.rest : !el.rest && heads.length === had.length;
    if (same && kept) return { source: src, at: el.startChar, duration: length, rest: rest, same: true };
    if (
      (el.pitches || []).some(function (pitch) {
        return !!pitch.startTie || !!pitch.endTie;
      })
    ) {
      return refuse("noteTie");
    }
    // A note made a rest would leave a slur on it with one end: abcjs opens
    // none on a rest (measured: `(z2 D2)` draws no slur, the D keeping the
    // end of it), which the reading back cannot tell from the slur it was.
    if (
      rest &&
      !el.rest &&
      (el.startSlur ||
        el.endSlur ||
        (el.pitches || []).some(function (pitch) {
          return !!pitch.startSlur || !!pitch.endSlur;
        }))
    ) {
      return refuse("noteSlur");
    }
    // The voices laid over each other with `&` share the bar's time between
    // them, which is not counted here.
    if (/&/.test(musicText(src, elems, music))) return refuse("noteUnsafe");
    // A verse gives a syllable to every note and none to a rest. A note made
    // a rest gives up the syllables the verses gave it and every other note
    // keeps its own, the owner's call of 2026-10-15 for 0 (wordsRested);
    // until then it was refused. A rest made a note is refused still, also
    // where no syllable after it would move: what a note written where a rest
    // was should be given is not decided (tests/README.md, Pending).
    const sung = !el.rest !== !rest && wordsBelow(src, elems, music);
    let words = { edits: [] };
    if (sung && !rest) return refuse("noteLyrics");
    if (sung) words = wordsRested(src, elems, music, [first]);
    if (words.failed) return refuse(words.failed);
    const times = barTimes(elems, run);
    if (!same && times[first].tuplet) return refuse("noteUnsafe");
    // A chord is written again from its heads, which keep their pitch and
    // accidental and nothing else: a fingering or a length written inside
    // its brackets would be lost, or misread.
    const chord = src.charAt(parts.from) === "[";
    if (chord && /[^=^_A-Ga-g,'0-9/\s]/.test(src.slice(parts.from + 1, parts.body - 1))) return refuse("noteUnsafe");

    // The text: the place's own, with the heads and the length written
    // anew, and nothing of what stands beside it.
    const meter = meterAt(systems, key, s, first);
    const from = el.startChar;
    const to = el.endChar;
    const own = src.slice(parts.body, parts.length);
    const tail = src.slice(parts.length, trimEnd(src, el.endChar, parts.length));
    const space = src.slice(trimEnd(src, to, parts.length), to);
    // With `verses`, the edits of the verses under the line made with it.
    function draft(body, size, join, verses) {
      let a = from;
      let b = to;
      let head = src.slice(from, parts.from);
      let end = space;
      if (join && join.before !== null) {
        a = join.before;
        head = src.slice(trimStart(src, from, parts.from), parts.from);
      }
      if (join && join.after !== null) {
        b = join.after;
        end = "";
      }
      if (verses && verses.length) return apply(src, [{ from: a, to: b, insert: head + body + size + tail + end }].concat(verses));
      return src.slice(0, a) + head + body + size + tail + end + src.slice(b);
    }

    // The note beside it that it is beamed to, on either side.
    const beat = beatOf(meter).length;
    const beatAt = function (time) {
      return Math.floor(time / beat + 1e-6);
    };
    const beamed = function (other) {
      return !!other && other.el_type === "note" && !other.rest && !!other.pitches && other.duration < 1 / 4 - EPS;
    };
    const join = { before: null, after: null };
    if (!rest && (!same || el.rest) && length < 1 / 4 - EPS) {
      const before = elems[first - 1];
      if (beamed(before) && times[first - 1] && !times[first - 1].tuplet && before.endChar === from && beatAt(times[first - 1].at) === beatAt(times[first].at)) {
        join.before = trimEnd(src, before.endChar, before.startChar);
      }
      const after = elems[first + 1];
      if (beamed(after) && times[first + 1] && !times[first + 1].tuplet && after.startChar === to && beatAt(times[first].at) === beatAt(times[first].at + length)) {
        join.after = trimStart(src, after.startChar, after.endChar);
      }
    }

    // A head put on is first written alone and with no length, for abcjs to
    // say at which step it draws the pitch and how long the unit is there.
    // The length a note had is kept as it was written, but on a chord, whose
    // brackets may hold lengths of their own.
    const fresh = heads.some(function (head) {
      return head.name === null;
    });
    const keep = same && !chord && !whole;
    let unit = null;
    let offset = 0;
    if (fresh || !keep) {
      const probe = parsed(A, draft(fresh ? pitchText(note.step) : "z", "", null));
      const seen = probe ? elementAt(probe, s, key, first) : null;
      if (!seen || seen.el_type !== "note") return refuse("noteUnsafe");
      if (fresh) {
        if (!seen.pitches || seen.pitches.length !== 1) return refuse("noteUnsafe");
        offset = seen.pitches[0].verticalPos - note.step;
      }
      unit = seen.duration;
    }
    const names = heads.map(function (head) {
      return head.name === null ? pitchText(head.step - offset) : head.name;
    });
    const body = rest ? "z" : names.length === 1 ? names[0] : "[" + names.join("") + "]";
    const size = keep ? own : restLength(length, unit);
    if (size === null) return refuse("noteUnsafe");
    const out = draft(body, size, join, words.edits);
    if (out === null) return refuse("noteUnsafe");
    const plan = { key: key, s: s, first: first, heads: heads, length: length };
    const check = verifyNote(A, src, out, plan);
    // Under a verse what the reading back finds is said as it was before the
    // syllables went with a rest.
    if (check) return refuse(sung ? "noteLyrics" : check);
    const made = parsed(A, out);
    const now = made ? elementAt(made, s, key, first) : null;
    if (!now) return refuse("noteUnsafe");
    return { source: out, at: now.startChar, duration: length, rest: rest };
  }

  // Whether a line of words or of symbols is read against the music of a
  // voice's line: straight under it, or past the lines abcjs reads past
  // there, as the verses are read (linesUnder). Until the second reading of
  // 0 under a verse (2026-10-15) only a line straight under the music was
  // seen, and a note made a rest or taken out at the end of its line left
  // the syllable of a verse past such a line written under no note.
  function wordsBelow(src, elems, music) {
    const lineTo = lineEnd(src, elems[music[music.length - 1]].endChar - 1);
    return lineTo < src.length && linesUnder(src, lineTo + 1).found;
  }

  // ---------- A place put in ----------
  //
  // The score mode's Ctrl and Alt with a figure's key or 0 (main.js): a new
  // place put in beside the one the cursor stands on, before it (Ctrl) or
  // after it (Alt), in the same bar, which is that much longer. With a
  // figure's key it is a note of that figure at the cursor's step, and with
  // 0 a rest of the figure kept: the owner's asks of 2026-10-02, "Control 0
  // 1 2 inserta un silencio redonda blanca etc a la derecha/izquierda en el
  // mismo compás", and of the day after, "Ctrl/Alt 0...7 inserta silencio
  // ...[notas]... a la izquierda/derecha" (my first reading had every one of
  // the keys put a rest in, which the owner's own try of Alt+4 beside a
  // `[CE]` set right). With Shift as well the figure's key puts a rest of
  // its own figure in, the owner's keys of 2026-10-06 ("ctrl/alt shift
  // [numero] añade silencio a la izquierda/derecha"). The bar may come out
  // longer than its meter: what is put in is time, and a bar left too long,
  // as one left short, is the reader's to settle.
  //
  // It goes in after everything written on the place (the close of a slur,
  // a tie, the mark of a broken rhythm), or before everything written on it
  // (a chord symbol, a decoration, the opening of a slur or of a tuplet),
  // set apart by a space on either side. A note shorter than a quarter is
  // written against the note beside it instead, when both stand in the same
  // beat and nothing is written between them, as a note written on a rest
  // is (writeNote): eighths put in one after the other come out beamed. A
  // tie it would cut is refused; a tuplet that would take it in, or a
  // broken rhythm that would pair with it (`C>` before `D` is a dotted C
  // and a short D), the reading back finds, and refuses. How its length is
  // written, and at which step a pitch is drawn, are read off the place
  // put there with no length, as for a note written.
  //
  // `at` is a character of the place, `what` is { step, duration } for a
  // note at a step of the staff or { rest: true, duration } for a rest, and
  // `side` "after" or "before". Returns { source, at }, with where the new
  // place begins in the new source, or { refused }.
  function insertPlace(A, src, at, what, side) {
    if (!A || typeof A.parseOnly !== "function") return refuse("engine");
    const tune = parsed(A, src);
    if (!tune) return refuse("parse");
    const systems = tune.lines.filter(function (line) {
      return line.staff;
    });
    const found = placeOf(systems, at);
    const length = what ? what.duration : 0;
    if (!found || !(length > 0)) return refuse("notePlace");
    const s = found.system;
    const key = found.voice.key;
    const elems = found.voice.elems;
    const first = found.index;
    const el = elems[first];
    const music = voiceOn(src, elems);
    let run = null;
    barsOf(elems, music).forEach(function (bar) {
      if (bar.indexOf(first) >= 0) run = bar;
    });
    if (!run) return refuse("noteUnsafe");
    if (/&/.test(musicText(src, elems, music))) return refuse("noteUnsafe");
    const after = side !== "before";
    const rest = !!what.rest;
    if (
      (el.rest ? [] : el.pitches || []).some(function (pitch) {
        return after ? !!pitch.startTie : !!pitch.endTie;
      })
    ) {
      return refuse("noteTie");
    }
    const from = trimStart(src, el.startChar, el.endChar);
    const pos = after ? trimEnd(src, el.endChar, from) : from;

    // The notes on either side it is beamed to: where each one's text ends,
    // or begins, for the new one to be written against.
    const times = barTimes(elems, run);
    const beat = beatOf(meterAt(systems, key, s, first)).length;
    const beatAt = function (time) {
      return Math.floor(time / beat + 1e-6);
    };
    const begins = times[first].at + (after ? times[first].length : 0);
    const beamed = function (i) {
      const other = elems[i];
      return run.indexOf(i) >= 0 && other.el_type === "note" && !other.rest && !!other.pitches && other.duration < 1 / 4 - EPS && !times[i].tuplet;
    };
    let left = null;
    let right = null;
    if (!rest && length < 1 / 4 - EPS) {
      const p = after ? first : first - 1;
      if (beamed(p) && beatAt(times[p].at) === beatAt(begins)) {
        const parts = noteParts(src, elems[p]);
        const end = trimEnd(src, elems[p].endChar, elems[p].startChar);
        if (parts && parts.length === end) left = end;
      }
      const n = after ? first + 1 : first;
      if (beamed(n) && beatAt(begins) === beatAt(begins + length)) {
        const parts = noteParts(src, elems[n]);
        const head = trimStart(src, elems[n].startChar, elems[n].endChar);
        if (parts && parts.from === head) right = head;
      }
    }
    const spaced = function (i) {
      return i >= 0 && i < src.length && !/\s/.test(src.charAt(i)) ? " " : "";
    };
    const a = !after && left !== null ? left : pos;
    const b = after && right !== null ? right : pos;
    const lead = left !== null ? "" : after ? " " : spaced(pos - 1);
    const tail = right !== null ? "" : after ? spaced(pos) : " ";
    const draft = function (text) {
      return src.slice(0, a) + lead + text + tail + src.slice(b);
    };

    const index = after ? first + 1 : first;
    const probe = parsed(A, draft(rest ? "z" : pitchText(what.step)));
    const seen = probe ? elementAt(probe, s, key, index) : null;
    if (!seen || seen.el_type !== "note" || !!seen.rest !== rest) return refuse("noteUnsafe");
    let offset = 0;
    if (!rest) {
      if (!seen.pitches || seen.pitches.length !== 1) return refuse("noteUnsafe");
      offset = seen.pitches[0].verticalPos - what.step;
    }
    const size = restLength(length, seen.duration);
    if (size === null) return refuse("noteUnsafe");
    const out = draft((rest ? "z" : pitchText(what.step - offset)) + size);
    const plan = { key: key, s: s, first: first, side: after ? "after" : "before", length: length, step: rest ? null : what.step };
    const check = verifyInsert(A, src, out, plan);
    if (check) return refuse(wordsBelow(src, elems, music) ? "noteLyrics" : check);
    const made = parsed(A, out);
    const put = made ? elementAt(made, s, key, index) : null;
    if (!put) return refuse("noteUnsafe");
    return { source: out, at: put.startChar };
  }

  // ---------- Music pasted, and a stretch taken out ----------
  //
  // The score mode's Ctrl+V (main.js), the owner's ask of 2026-10-04
  // ("implementa el pegar"): music put in at the cursor, as text. What is
  // pasted is what the mode's copy took (a voice's music as it is written,
  // or several voices each under its `V:`), or any music written elsewhere.
  // And its Delete with a stretch chosen, of the same day: the stretch
  // taken out of the text, with the time it held.
  //
  // Nothing beside what goes in, or out, is changed: the bar is that much
  // longer or shorter after it, and left for the reader to settle. The
  // owner's calls of 2026-10-04, one for each way in: "pegar encima de una
  // nota ... agranda el compás", "Copiar sobre un silencio funciona igual
  // que copiar sobre una nota", "Al copiar sobre una selección reemplaza la
  // selección por lo copiado y el compás queda como quede", and for Delete
  // "se borra toda la selección". (For half a day a paste on a rest took
  // the rest's time, counted against the meter: my pick, before they had
  // tried it.) Which side of the place the music goes in on is the
  // caller's to say: the mode asked for the side before it until
  // 2026-10-06, and asks for the side after it since ("ctrl v sobre nota
  // entra detrás", main.js).
  //
  //   `on`           before the place named, a note or a rest, which comes
  //                  later with everything after it: where the music for a
  //                  voice goes in at the moment a place of another begins
  //   `after`        after the element named: the cursor's place, the open
  //                  end of a voice, and a voice whose line has no place
  //                  left to put the music in before
  //   `over`         in the place of a stretch of one voice, named line by
  //                  line as it runs over the voice's lines, each slice from
  //                  a character of its first place to the end of its last:
  //                  those places go, with everything written between them
  //                  (the barlines inside, a chord symbol, a decoration),
  //                  and the text goes in where the first slice began. With
  //                  no text the stretch is taken out and nothing put in.
  //
  // A stretch that is whole bars, with nothing put in their place, leaves
  // no bar of nothing behind: the bars go with one of their barlines, and a
  // line that is all inside it goes whole, as a bar taken out by its only
  // rest does (barCut). The voice keeps something: a stretch that is all of
  // it is refused. And a line a stretch took bars from, with nothing put
  // in, takes as many again from the line after it (fillLines).
  //
  // The text goes in set apart by a space on either side, so it is beamed
  // to nothing it was not written against. Read back, the voice is the one
  // it was without what went and with the pasted music at that place; every
  // other voice reads as it did. So music that changes what it is pasted
  // beside is refused: a broken rhythm left open at its end, a tuplet that
  // would take the next note in, a key or a meter written inside it, the
  // syllables of a verse under the line moved along. (A stretch taken out
  // with nothing put in moves none: what the verses gave it goes with it,
  // wordsCut.) A slur or a tie with
  // one end inside what goes, or what comes in, and the other outside it,
  // is refused as well, read off the two runs themselves: abcjs would carry
  // the half left on to the next close it met. And a text abcjs warns about
  // where it had no warning is not music to paste.
  //
  // A stretch is a span of time, and a place of another voice may be in it
  // in part: a whole note begun before it, or one sounding on past its
  // end. Such a place is not taken out. It stays, shorter by the part of it
  // the stretch took, and no rest is put in for that part: the owner's call
  // of 2026-10-06, on a whole note under one quarter chosen in the voice
  // above, "yo lo veo como que hay parte de la redonda que se seleccionó y
  // se le dio delete, por lo que la redonda debe reducirse en la duración
  // que se le quitó (sin agregar silencios)". For an hour that day it went
  // whole, with its bar where it was all of it, and before that it was no
  // part of the stretch. So an `over` may say which of its two ends stays
  // (`keep`, { first, last }): what goes then is what stands between the
  // places that stay, a barline between two of them included, as it goes
  // from the voice the stretch was drawn out in; and music put in goes
  // after the first where that one stays. The length each is left with is
  // asked for by itself ({ at, length }), and is written as a figure's key
  // writes one (writeNote), the place keeping everything else it had. A
  // length no one note has (five eighths) is refused, and so is a note tied
  // to another, whose two halves would no longer be the note they were.
  //
  // `pastes` is a list of { at, text, where }, { over, text, keep } or
  // { at, length }, each of the first two for one voice. They are made one
  // after the other, each on the source the
  // one before it left, its places carried along by what that one put in
  // and took out. Returns { source, after }, `after` naming for each where
  // the element after what it put in, or took out, begins in the new source
  // (-1 for none), which is where the cursor goes; or { refused }.
  function pasteMusic(A, src, pastes) {
    if (!A || typeof A.parseOnly !== "function") return refuse("engine");
    if (!pastes || !pastes.length) return refuse("pasteNothing");
    // The place a length is asked of, named by its first character written:
    // abcjs counts the space before a note into the note, and music put in
    // before the note goes in past that space, so that a place named by the
    // space would be found again in the music put in (movedBy).
    const written = function (at) {
      while (at < src.length && /[ \t]/.test(src.charAt(at))) at++;
      return at;
    };
    const todo = pastes.map(function (paste) {
      return {
        at: paste.length > 0 ? written(paste.at) : paste.at,
        where: paste.where,
        text: paste.text,
        length: paste.length,
        keep: paste.keep || null,
        over: paste.over
          ? paste.over.map(function (slice) {
              return { from: slice.from, to: slice.to };
            })
          : null,
      };
    });
    let out = src;
    const after = [];
    const keys = [];
    const wants = [];
    for (let i = 0; i < todo.length; i++) {
      const paste = todo[i];
      const one = paste.over ? cutOne(A, out, paste.over, paste.text, paste.keep) : paste.length > 0 ? lengthOne(A, out, paste.at, paste.length) : pasteOne(A, out, paste.at, paste.text, paste.where);
      if (one.refused) return one;
      const on = function (pos) {
        return movedBy(pos, one.edits);
      };
      for (let m = 0; m < i; m++) if (after[m] >= 0) after[m] = on(after[m]);
      for (let m = i + 1; m < todo.length; m++) {
        if (todo[m].over) {
          todo[m].over.forEach(function (slice) {
            slice.from = on(slice.from);
            slice.to = on(slice.to);
          });
        } else {
          todo[m].at = on(todo[m].at);
        }
      }
      after[i] = one.after;
      keys[i] = one.key;
      if (one.want) wants.push(one.want);
      out = one.source;
    }
    // The lines a stretch was taken out of, with nothing put in its place,
    // take their bars again from the lines after them (fillLines), and the
    // place each voice's cursor goes to is found again where its line now
    // is.
    if (wants.length) {
      const filled = fillLines(A, out, wants);
      if (filled !== out) {
        for (let i = 0; i < after.length; i++) after[i] = carried(A, out, filled, keys[i], after[i]);
        out = filled;
      }
    }
    return { source: out, after: after };
  }

  // Where a character of a source stands once edits were made before it: on
  // by what went in, and back by what went out.
  function movedBy(pos, edits) {
    let shift = 0;
    edits.forEach(function (e) {
      if (e.to <= pos) shift += e.insert.length - (e.to - e.from);
    });
    return pos + shift;
  }

  // The text of a paste as one run of music.
  function clipText(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/\s+/g, " ")
      .trim();
  }

  function glued(src, i) {
    return i >= 0 && i < src.length && !/\s/.test(src.charAt(i));
  }

  // What the check of a paste says for itself. Any other refusal of a
  // change made over a verse is the verse's: its syllables moved along, or
  // could not be taken out with what went.
  const OWN_REASONS = /^(?:pasteText|noteSlur|noteTie)$/;

  // Music put in before a place, or after an element, and nothing taken
  // out.
  function pasteOne(A, src, at, text, where) {
    const tune = parsed(A, src);
    if (!tune) return refuse("parse");
    const music = clipText(text);
    if (!music) return refuse("pasteNothing");
    const systems = tune.lines.filter(function (line) {
      return line.staff;
    });
    const found = placeOf(systems, at);
    if (!found) return refuse("notePlace");
    const elems = found.voice.elems;
    const el = elems[found.index];
    const onLine = voiceOn(src, elems);
    if (/&/.test(musicText(src, elems, onLine))) return refuse("noteUnsafe");
    const after = where === "after";
    if (
      (el.rest ? [] : el.pitches || []).some(function (pitch) {
        return after ? !!pitch.startTie : !!pitch.endTie;
      })
    ) {
      return refuse("noteTie");
    }
    const from = trimStart(src, el.startChar, el.endChar);
    const pos = after ? trimEnd(src, el.endChar, from) : from;
    const insert = (after || glued(src, pos - 1) ? " " : "") + music + (!after || glued(src, pos) ? " " : "");
    const out = src.slice(0, pos) + insert + src.slice(pos);
    const plan = { key: found.voice.key, s: found.system, first: found.index, side: after ? "after" : "before", gone: [], music: true };
    const check = verifyPaste(A, src, out, plan);
    if (check.refused) return OWN_REASONS.test(check.refused) ? check : refuse(wordsBelow(src, elems, onLine) ? "noteLyrics" : check.refused);
    return { source: out, after: check.after, edits: [{ from: pos, to: pos, insert: insert }], key: found.voice.key };
  }

  // Whether a length is one a single note has: a figure, with a dot or
  // with two. Five eighths is a half tied to an eighth, which is two notes.
  function oneFigure(length) {
    for (let figure = 1; figure >= 1 / 128; figure /= 2) {
      if (
        [1, 3 / 2, 7 / 4].some(function (dots) {
          return Math.abs(length - figure * dots) < EPS;
        })
      ) {
        return true;
      }
    }
    return false;
  }

  // A place left another length, and everything else of it as it was: what
  // a stretch leaves of a note it took a part of (pasteMusic). Written as a
  // figure's key writes a length over a note (writeNote), which reads it
  // back, and refuses a note tied to another and one of a tuplet.
  function lengthOne(A, src, at, length) {
    const tune = parsed(A, src);
    if (!tune) return refuse("parse");
    const found = placeOf(
      tune.lines.filter(function (line) {
        return line.staff;
      }),
      at
    );
    if (!found) return refuse("notePlace");
    const el = found.voice.elems[found.index];
    if (el.rest && !/^(?:rest|whole)$/.test(el.rest.type)) return refuse("notePlace");
    if (!oneFigure(length)) return refuse("noteLength");
    const made = writeNote(A, src, at, el.rest ? { rest: true, duration: length } : { step: el.pitches[0].verticalPos, duration: length });
    if (made.refused) return made;
    const now = made.source;
    // The one run of the text that changed: the place's own.
    let a = 0;
    while (a < src.length && a < now.length && src.charAt(a) === now.charAt(a)) a++;
    let b = 0;
    while (b < src.length - a && b < now.length - a && src.charAt(src.length - 1 - b) === now.charAt(now.length - 1 - b)) b++;
    const edits = now === src ? [] : [{ from: a, to: src.length - b, insert: now.slice(a, now.length - b) }];
    return { source: now, after: -1, edits: edits, key: found.voice.key };
  }

  // What a stretch of a voice goes as, before anything is asked of what it
  // leaves behind: the lines it is cut on, the edit of each, and the
  // elements that go with it. `slices` names it line by line, and `music`
  // is what goes in where it began, or nothing. With `keep`, its first
  // place stays, or its last, or both, and what goes is what stands
  // between them. What cutOne makes and then checks, and what cutTakes
  // tells the drawing of.
  function cutPlan(tune, src, slices, music, keep) {
    const systems = tune.lines.filter(function (line) {
      return line.staff;
    });
    if (!slices || !slices.length) return refuse("notePlace");
    let key = null;
    const cuts = [];
    for (let n = 0; n < slices.length; n++) {
      const head = placeOf(systems, slices[n].from);
      const tail = placeOf(systems, slices[n].to - 1);
      if (!head || !tail || head.system !== tail.system || head.voice.key !== tail.voice.key || tail.index < head.index) return refuse("notePlace");
      if (key !== null && head.voice.key !== key) return refuse("notePlace");
      if (cuts.length && head.system <= cuts[cuts.length - 1].s) return refuse("notePlace");
      key = head.voice.key;
      cuts.push({ s: head.system, elems: head.voice.elems, first: head.index, last: tail.index, head: head.index, tail: tail.index });
    }
    // The ends that stay: the cut begins at what is written after the
    // first place, and ends at what is written before the last (some of
    // abcjs's elements stand nowhere in the text, and are no end of it).
    const stays = { first: !!(keep && keep.first), last: !!(keep && keep.last) };
    const inText = function (el) {
      return typeof el.startChar === "number" && typeof el.endChar === "number" && el.endChar > el.startChar;
    };
    if (stays.first) {
      const cut = cuts[0];
      let i = cut.head + 1;
      while (i <= cut.tail && !inText(cut.elems[i])) i++;
      cut.first = i;
    }
    if (stays.last) {
      const cut = cuts[cuts.length - 1];
      let i = cut.tail - 1;
      while (i >= cut.first && !inText(cut.elems[i])) i--;
      cut.last = i;
    }
    // Where the music goes in, for the reading back: before the first
    // thing that goes, or beside the place that stays where nothing goes
    // from the first line.
    let lead = { first: cuts[0].first, side: "before" };
    if (cuts[0].first > cuts[0].last) lead = stays.first ? { first: cuts[0].head, side: "after" } : { first: cuts[0].tail, side: "before" };
    const edits = [];
    const gone = [];
    const eased = [];
    let words = false;
    for (let n = 0; n < cuts.length; n++) {
      const cut = cuts[n];
      const onLine = voiceOn(src, cut.elems);
      if (/&/.test(musicText(src, cut.elems, onLine))) return refuse("noteUnsafe");
      const under = wordsBelow(src, cut.elems, onLine);
      words = words || under;
      if (cut.first > cut.last) {
        // Nothing stands between the places that stay on this line: the
        // music, where there is some, goes in after the first of them, or
        // before the last where the first is not one of them.
        if (n === 0 && music) {
          const el = cut.elems[stays.first ? cut.head : cut.tail];
          const begins = trimStart(src, el.startChar, el.endChar);
          const pos = stays.first ? trimEnd(src, el.endChar, begins) : begins;
          const insert = (stays.first || glued(src, pos - 1) ? " " : "") + music + (!stays.first || glued(src, pos) ? " " : "");
          edits.push({ from: pos, to: pos, insert: insert });
        }
        continue;
      }
      const piece = stretchCut(src, cut.elems, onLine, cut.first, cut.last, n === 0 ? music : "");
      if (!piece) return refuse("noteUnsafe");
      cut.whole = piece.whole;
      edits.push(piece.edit);
      piece.removed.forEach(function (e) {
        gone.push({ s: cut.s, e: e });
      });
      // With nothing put in, the verses under the line give up what they
      // had for what goes. Music put in has no syllable of its own to take
      // their place, and the reading back refuses it for the verse.
      if (under && !music) {
        const sung = wordsCut(src, cut.elems, onLine, piece.removed, piece.whole);
        if (sung.failed) return refuse(sung.failed);
        sung.edits.forEach(function (e) {
          edits.push(e);
        });
        sung.eased.forEach(function (e) {
          eased.push({ s: cut.s, e: e });
        });
      }
    }
    return { systems: systems, key: key, cuts: cuts, edits: edits, gone: gone, eased: eased, words: words, lead: lead };
  }

  // What Delete would take of each stretch named, `overs` holding for each
  // voice its slices as a paste's `over` names them: the runs of the source
  // that would go, { taken: [{ from, to }] }. The owner's rule for what a
  // stretch chosen wears, 2026-10-06: "que se señale en latón todo lo que
  // de apretar Delete será borrado" (inkScoreSelection in main.js draws it
  // from this). The cut's own reckoning, so the barline that goes with
  // whole bars is the one barCut drops, a line that goes whole goes here
  // too, and the syllables that go with the notes are named in the verses
  // they are written in (wordsCut). And so a place that stays, of which
  // the stretch takes a part, takes nothing with it (`keeps`, for each
  // voice what its `over` would be given as `keep`): the bar it is all of
  // keeps its barline.
  //
  // Nothing is asked of what the cut would leave: this is what Delete
  // reaches for, and it is said as well where Delete would then be refused
  // (half a slur inside the stretch, a note of a tuplet, the whole of a
  // voice), so that a stretch is marked the same whether or not it can
  // go. Not where the verses under a line cannot be read here (versesOf: a
  // line of symbols, a verse carried on with a backslash), which refuses
  // the cut and its naming alike, the places chosen being marked then
  // (main.js). The reading back is also what a cut costs, 58 ms a voice
  // on 64 bars of four voices against 2 ms for the parse (measured
  // 2026-10-06), and the drawing asks at every step of the cursor.
  //
  // Each voice is planned on the source as it is, where pasteMusic makes
  // its cuts one after the other: a cut is reckoned from the voice's own
  // elements on its own lines, which another voice's cut moves along in
  // the text and does not change. { refused } where a stretch is not found
  // in the source or is not one a cut is made of.
  function cutTakes(A, src, overs, keeps) {
    if (!A || typeof A.parseOnly !== "function") return refuse("engine");
    const tune = parsed(A, src);
    if (!tune) return refuse("parse");
    const taken = [];
    for (let i = 0; i < (overs || []).length; i++) {
      const made = cutPlan(tune, src, overs[i], "", keeps ? keeps[i] : null);
      if (made.refused) return made;
      made.edits.forEach(function (e) {
        if (e.to > e.from) taken.push({ from: e.from, to: e.to });
      });
    }
    return { taken: taken };
  }

  // A stretch of a voice taken out, and music put in where it began, or
  // none. `slices` names it line by line, and `keep` which of its ends
  // stays.
  function cutOne(A, src, slices, text, keep) {
    const tune = parsed(A, src);
    if (!tune) return refuse("parse");
    const music = clipText(text);
    const made = cutPlan(tune, src, slices, music, keep);
    if (made.refused) return made;
    // Nothing between the places that stay, and nothing to put in.
    if (!made.edits.length) return { source: src, after: -1, edits: [], key: made.key };
    const systems = made.systems;
    const key = made.key;
    const cuts = made.cuts;
    const edits = made.edits;
    const gone = made.gone;
    const words = made.words;
    // The voice keeps a place to stand on: with nothing put in, something
    // of it has to stay that is drawn, a note or a rest somebody sees.
    if (!music) {
      const drawn = function (el) {
        return el.el_type === "note" && (!el.rest || /^(?:rest|whole|multimeasure)$/.test(el.rest.type));
      };
      let places = 0;
      systems.forEach(function (line) {
        const voice = voiceIn(line, key);
        (voice ? voice.elems : []).forEach(function (el) {
          if (drawn(el)) places++;
        });
      });
      const going = gone.filter(function (g) {
        return drawn(voiceIn(systems[g.s], key).elems[g.e]);
      }).length;
      if (going >= places) return refuse("cutAll");
    }
    const out = apply(
      src,
      edits.map(function (e) {
        return { from: e.from, to: e.to, insert: e.insert };
      })
    );
    if (out === null) return refuse("noteUnsafe");
    const plan = { key: key, s: cuts[0].s, first: made.lead.first, side: made.lead.side, gone: gone, eased: made.eased, music: !!music };
    const check = verifyPaste(A, src, out, plan);
    if (check.refused) return OWN_REASONS.test(check.refused) ? check : refuse(words ? "noteLyrics" : check.refused);
    const result = { source: out, after: check.after, edits: edits, key: key };
    // With nothing put in, what each line of the voice that stays is to
    // have again (fillLines), which pasteMusic sees to once every voice is
    // cut.
    if (!music) {
      const whole = cuts
        .filter(function (cut) {
          return cut.whole;
        })
        .map(function (cut) {
          return cut.s;
        });
      result.want = { key: key, counts: barsHad(src, systems, key, whole) };
    }
    return result;
  }

  // The text a stretch of a voice's line goes as, from its element `first`
  // to its element `last`, both notes or rests, as { edit, removed, whole }:
  // the edit, with `text` put in its place where there is one; the elements
  // of the line it takes; and whether that is the whole line. Whole bars
  // with nothing put in go as bars do (barCut). Anything else is the text
  // from the first place to the last and what is written between them, and
  // the notes on either side are left apart as they were: the space after
  // it goes with it, but where it was written against what comes before
  // it; one stays where it stood against both sides and held a space
  // itself, so that two beams it kept apart are not written as one; and at
  // the end of a line the space before it goes too. Null for whole bars
  // that cannot go (barCut).
  function stretchCut(src, elems, music, first, last, text) {
    const bars = barsOf(elems, music);
    let b0 = -1;
    let b1 = -1;
    bars.forEach(function (run, n) {
      if (run.indexOf(first) >= 0) b0 = n;
      if (run.indexOf(last) >= 0) b1 = n;
    });
    if (b0 < 0 || b1 < 0) return null;
    const note = function (i) {
      return elems[i].el_type === "note";
    };
    const opens = !bars[b0].some(function (i) {
      return i < first && note(i);
    });
    const closes = !bars[b1].some(function (i) {
      return i > last && note(i);
    });
    if (!text && opens && closes) return barCut(src, elems, music, bars, b0, b1);
    const removed = [];
    for (let i = first; i <= last; i++) {
      const type = elems[i].el_type;
      if (type === "note" || type === "bar" || type === "part") removed.push(i);
    }
    let from = trimStart(src, elems[first].startChar, elems[first].endChar);
    let to = trimEnd(src, elems[last].endChar, from);
    let insert = "";
    if (text) {
      insert = (glued(src, from - 1) ? " " : "") + text + (glued(src, to) ? " " : "");
    } else {
      const lineTo = lineEnd(src, to);
      if (/^[ \t]*$/.test(src.slice(to, lineTo))) {
        to = lineTo;
        from = trimEnd(src, from, lineStart(src, from));
      } else if (!glued(src, from - 1)) {
        to = trimStart(src, to, lineTo);
      } else if (glued(src, to) && /\s/.test(src.slice(from, to))) {
        insert = " ";
      }
    }
    return { edit: { from: from, to: to, insert: insert }, removed: removed, whole: false };
  }

  // The unit a length is counted in where a place is written, in whole
  // notes (`L:`, which a voice may have of its own, or the one the meter
  // gives a tune that names none): the length of a rest written with no
  // number at the head of the place's line, read by abcjs. What tells music
  // copied under one unit from the place it is pasted at under another,
  // where the same text would be other lengths (main.js). Null where there
  // is no reading it.
  function unitAt(A, src, at) {
    if (!A || typeof A.parseOnly !== "function") return null;
    const tune = parsed(A, src);
    if (!tune) return null;
    const systems = tune.lines.filter(function (line) {
      return line.staff;
    });
    const found = placeOf(systems, at);
    if (!found) return null;
    const el = found.voice.elems[found.index];
    const head = lineHead(src, lineStart(src, trimStart(src, el.startChar, el.endChar)));
    const probe = parsed(A, src.slice(0, head) + "z " + src.slice(head));
    const lines = probe
      ? probe.lines.filter(function (line) {
          return line.staff;
        })
      : [];
    const voice = lines[found.system] ? voiceIn(lines[found.system], found.voice.key) : null;
    const first = voice
      ? voice.elems.filter(function (e) {
          return e.el_type === "note";
        })[0]
      : null;
    return first && first.rest && first.duration > 0 ? first.duration : null;
  }

  // The parts of a text to paste: [{ voice, text }], a part for each `V:`
  // line with the music under it, as the mode's copy writes several voices,
  // and one of no voice (null) for music with none over it, which is the
  // cursor's. The lines of a part are one run of music: where a copy was cut
  // by the end of a line the music goes on. A text with anything else on a
  // line of its own (a field, a verse, a directive) is no music to put in
  // at a place, and neither is one with no music at all.
  function clipParts(text) {
    const parts = [];
    let part = null;
    const lines = String(text || "")
      .replace(/\r\n?/g, "\n")
      .split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const kind = lineKind(line);
      if (kind === "blank") continue;
      if (kind === "voice") {
        const id = /^V:[ \t]*([^\s\]%]+)/.exec(line);
        if (!id) return refuse("pasteText");
        part = { voice: id[1], lines: [] };
        parts.push(part);
        continue;
      }
      if (kind !== "music") return refuse("pasteText");
      if (!part) {
        part = { voice: null, lines: [] };
        parts.push(part);
      }
      part.lines.push(line);
    }
    const out = parts
      .filter(function (p) {
        return p.lines.length > 0;
      })
      .map(function (p) {
        return { voice: p.voice, text: p.lines.join(" ") };
      });
    return out.length ? out : refuse("pasteNothing");
  }

  // ---------- A stretch made rests ----------
  //
  // The score mode's 0 with a stretch chosen (main.js), the owner's ask of
  // 2026-10-04, for the reader who wants the stretch silent and not gone:
  // "al marcar 0 todas las notas del tramo elegido se sustituyen por su
  // silencio". Each note or chord among the places named becomes a rest as
  // long as it was, so every bar keeps its length; the rests among them
  // stay as they are. What is written on a note stays on its rest, as it
  // does where one note is made a rest (writeNote): a chord symbol, a
  // decoration, grace notes.
  //
  // A slur or a tie between two of the notes goes with them, a rest having
  // neither. One with its other end on a note that stays is refused, as it
  // is for a single note. A verse under a line gives its rests no syllable:
  // the ones it gave the notes made rests go with them, and every other note
  // keeps its own (wordsRested, the owner's call of 2026-10-15; until then
  // a verse under the line was refused).
  //
  // `ats` is a character of each place, of any voice. Returns { source },
  // with `same` where they hold no note; or { refused }.
  function restMusic(A, src, ats) {
    if (!A || typeof A.parseOnly !== "function") return refuse("engine");
    const tune = parsed(A, src);
    if (!tune) return refuse("parse");
    const systems = tune.lines.filter(function (line) {
      return line.staff;
    });
    // The notes and rests of each voice in the order they are read, which
    // is what a tie runs along.
    const order = {};
    systems.forEach(function (line, s) {
      voicesOf(line).forEach(function (voice) {
        const list = order[voice.key] || (order[voice.key] = []);
        voice.elems.forEach(function (el, e) {
          if (el.el_type === "note") list.push({ key: voice.key, s: s, e: e, el: el, elems: voice.elems });
        });
      });
    });
    const picked = [];
    const chosen = function (item) {
      return (
        !!item &&
        picked.some(function (p) {
          return p.el === item.el;
        })
      );
    };
    for (let n = 0; n < (ats || []).length; n++) {
      const found = placeOf(systems, ats[n]);
      if (!found) return refuse("notePlace");
      const item = order[found.voice.key].filter(function (o) {
        return o.s === found.system && o.e === found.index;
      })[0];
      if (!item.el.rest && !chosen(item)) picked.push(item);
    }
    if (!picked.length) return { source: src, same: true };
    const keys = Object.keys(order);
    for (let v = 0; v < keys.length; v++) {
      const list = order[keys[v]];
      for (let i = 0; i < list.length; i++) {
        if (!chosen(list[i])) continue;
        const pitches = list[i].el.pitches || [];
        const tied = function (end) {
          return pitches.some(function (pitch) {
            return !!pitch[end];
          });
        };
        if ((tied("startTie") && !chosen(list[i + 1])) || (tied("endTie") && !chosen(list[i - 1]))) return refuse("noteTie");
      }
      const half = heldWhole(
        list.filter(chosen).map(function (item) {
          return item.el;
        })
      );
      if (half) return refuse(half);
    }
    const edits = [];
    for (let n = 0; n < picked.length; n++) {
      const p = picked[n];
      const el = p.el;
      const onLine = voiceOn(src, p.elems);
      if (/&/.test(musicText(src, p.elems, onLine))) return refuse("noteUnsafe");
      const parts = noteParts(src, el);
      if (!parts) return refuse("noteUnsafe");
      const end = trimEnd(src, el.endChar, parts.length);
      // The length as it is written after the note; a chord with lengths
      // inside its brackets has none to keep, and its rest's is counted in
      // the unit abcjs reads a rest written there with none in.
      let size = src.slice(parts.body, parts.length);
      if (src.charAt(parts.from) === "[" && /[0-9/]/.test(src.slice(parts.from + 1, parts.body - 1))) {
        const probe = parsed(A, src.slice(0, parts.from) + "z" + src.slice(parts.length));
        const seen = probe ? elementAt(probe, p.s, p.key, p.e) : null;
        if (!seen || seen.el_type !== "note" || !seen.rest) return refuse("noteUnsafe");
        size = restLength(el.duration, seen.duration);
        if (size === null) return refuse("noteUnsafe");
      }
      const head = withoutSlurs(src.slice(el.startChar, parts.from));
      const tail = src.slice(parts.length, end).replace(/[-)]/g, "");
      edits.push({ from: el.startChar, to: end, insert: head + "z" + size + tail });
    }
    // The verses, a voice's line at a time: the notes made rests on one
    // system in one voice share the list of that voice's elements there
    // (`elems`).
    const lines = [];
    picked.forEach(function (p) {
      const line = lines.filter(function (l) {
        return l.elems === p.elems;
      })[0];
      if (line) line.turned.push(p.e);
      else lines.push({ elems: p.elems, turned: [p.e] });
    });
    let sung = false;
    for (let l = 0; l < lines.length; l++) {
      const onLine = voiceOn(src, lines[l].elems);
      if (!wordsBelow(src, lines[l].elems, onLine)) continue;
      sung = true;
      const words = wordsRested(src, lines[l].elems, onLine, lines[l].turned);
      if (words.failed) return refuse(words.failed);
      words.edits.forEach(function (e) {
        edits.push(e);
      });
    }
    const out = apply(src, edits);
    if (out === null) return refuse("noteUnsafe");
    const check = verifyRests(
      A,
      src,
      out,
      picked.map(function (p) {
        return { key: p.key, s: p.s, e: p.e };
      })
    );
    // Under a verse what the reading back finds is said as it was before the
    // syllables went with the rests.
    if (check) return refuse(sung ? "noteLyrics" : check);
    return { source: out };
  }

  // What is written on a note before it, without the slurs it opens: every
  // `(` that is no tuplet's, outside a chord symbol, a decoration and grace
  // notes, which are read past as noteParts reads them.
  function withoutSlurs(text) {
    let out = "";
    let i = 0;
    while (i < text.length) {
      const c = text.charAt(i);
      const close = c === '"' || c === "!" || c === "+" ? c : c === "{" ? "}" : null;
      if (close) {
        const j = text.indexOf(close, i + 1);
        const to = j < 0 ? text.length : j + 1;
        out += text.slice(i, to);
        i = to;
        continue;
      }
      if (c !== "(" || /[0-9]/.test(text.charAt(i + 1))) out += c;
      i++;
    }
    return out;
  }

  // ---------- A place taken out ----------
  //
  // The score mode's Delete and Backspace (main.js), the one way anything
  // is taken out. What it takes goes with the time it held, a note as a
  // rest does, and the bar is that much shorter: the owner's call of
  // 2026-10-04, when Delete came to take a stretch out whole and 0 to make
  // rests of it, "para que quede la simetría, cambia también el delete
  // sobre una nota, que la borra en vez de poner un silencio". For two days
  // before it a note left a rest as long, and went on a second press (their
  // "cuando la nota se elimine debe aparecer un silencio", 2026-10-02): the
  // key that makes a rest of a note is 0 now, and of nothing else.
  //
  // On a chord the head at the cursor's step goes and the chord stays as
  // long as it was, with the heads it has left (writeNote with `off`). At a
  // step the place has no head at, nothing goes (the owner's call of
  // 2026-10-03: "Delete solo debe funcionar encima de C o G, no en un
  // espacio vacío"). A rest goes from any height.
  //
  // What goes of a place is the place as written, with whatever stands on
  // it (a chord symbol over it, a decoration), and the space after it, or
  // the space before it at the end of a line; and what the verses under
  // the line gave it (wordsCut). A slur that opens or closes on it is
  // refused, and so is a tie; anything else it held together with the
  // music around it (a note of a tuplet, of a broken rhythm) the reading
  // back finds changed, and refuses.
  //
  // The only place of its bar takes the bar with it (the owner's "si hay un
  // silencio que llena todo el compás y se da delete, el compás se borra"),
  // as a bar is added: in every voice of the line where the other voices
  // hold nothing but rests in it, and in the place's own voice alone where
  // another plays there, which keeps its bar (takeBarOut). Read back as
  // everything else is: the voice reads as it did but for that place, or
  // every voice but for that bar, and every line has the bars it had, but
  // the one a bar went from, which then takes one again from the line
  // after it (fillLines). Returns { source, at }, with where the place
  // that took the index of the one that went begins (-1 for none), or the
  // place's own for a head, and `same` with it where there was no head to
  // take; or { refused }.
  function takeOut(A, src, at, step) {
    if (!A || typeof A.parseOnly !== "function") return refuse("engine");
    const tune = parsed(A, src);
    if (!tune) return refuse("parse");
    const systems = tune.lines.filter(function (line) {
      return line.staff;
    });
    const found = placeOf(systems, at);
    if (!found) return refuse("notePlace");
    const s = found.system;
    const key = found.voice.key;
    const elems = found.voice.elems;
    const first = found.index;
    const el = elems[first];
    if (el.rest && !/^(?:rest|whole|multimeasure)$/.test(el.rest.type)) return refuse("notePlace");
    const heads = el.rest ? [] : el.pitches || [];
    if (!el.rest) {
      // No head at the step, which writeNote says as `same`, or a chord,
      // which keeps the heads it has left.
      const there = heads.some(function (pitch) {
        return pitch.verticalPos === step;
      });
      if (!there || heads.length > 1) return writeNote(A, src, at, { step: step, off: true });
      // A tie would be left tying what is no longer the same note.
      if (
        heads.some(function (pitch) {
          return !!pitch.startTie || !!pitch.endTie;
        })
      ) {
        return refuse("noteTie");
      }
    }
    // A slur that opens or closes on the place would be left with one end:
    // abcjs reads the `)` of `(C D)` with its C gone as the end of nothing,
    // and draws no slur (measured), which the reading back cannot tell from
    // the slur it was.
    if (
      el.startSlur ||
      el.endSlur ||
      heads.some(function (pitch) {
        return !!pitch.startSlur || !!pitch.endSlur;
      })
    ) {
      return refuse("noteSlur");
    }
    const music = voiceOn(src, elems);
    const bars = barsOf(elems, music);
    let b = -1;
    bars.forEach(function (run, n) {
      if (run.indexOf(first) >= 0) b = n;
    });
    if (b < 0) return refuse("noteUnsafe");
    if (/&/.test(musicText(src, elems, music))) return refuse("noteUnsafe");
    const others = bars[b].filter(function (i) {
      return i !== first && elems[i].el_type === "note";
    });
    if (!others.length) return takeBarOut(A, src, systems, found, b);
    // The place and the space after it; but where it was written against
    // what comes before it, the space stays, or the notes on either side
    // would be written together (`Cz D` is `C D`, not `CD`); and at the end
    // of a line, the space before it too.
    let from = trimStart(src, el.startChar, el.endChar);
    let to = el.endChar;
    if (from > 0 && !/\s/.test(src.charAt(from - 1))) to = trimEnd(src, el.endChar, from);
    const close = lineEnd(src, to);
    if (/^[ \t]*$/.test(src.slice(to, close))) {
      to = close;
      from = trimEnd(src, from, lineStart(src, from));
    }
    const words = wordsCut(src, elems, music, [first], false);
    if (words.failed) return refuse(words.failed);
    const out = apply(src, [{ from: from, to: to, insert: "" }].concat(words.edits));
    if (out === null) return refuse("noteUnsafe");
    const check = verifyOut(A, src, out, { s: s, key: key, voices: [{ key: key, removed: [first], eased: words.eased }], bars: 0 });
    if (check) return refuse(wordsBelow(src, elems, music) ? "noteLyrics" : check);
    return { source: out, at: placeAfter(A, out, systems, key, s, first) };
  }

  // The bar that the place `found` is all of, in the bar `b` of its line,
  // taken out. A bar of nothing is no bar abcjs counts (`C2 | | D2` reads
  // as two bars), so the bar goes with one of its barlines: the one that
  // closes it, or where that one says more than a plain barline does (a
  // repeat, the end of the tune), the one before it, so that `C4 | z4 |]`
  // is `C4 |]`. A bar no barline closes goes alone, and a bar that is all
  // of its line takes the line. The score's only bar stays: a score of
  // nothing has no place for the cursor to stand on, nor a barline for a
  // bar to be added at.
  //
  // It goes from every voice of the line where the others hold nothing but
  // rests in it, which is how an empty bar is taken out of a score, and
  // one of them that cannot let it go (it has no such bar, verses under
  // it that cannot be read here: versesOf) refuses it for all. With it
  // goes what the verses under each line gave the bar, and the verses of a
  // line that goes whole
  // (wordsCut). Where another voice
  // plays in the bar, that voice keeps it and so do the rest: the bar goes
  // from the place's own voice alone, which is then a bar short of them,
  // as a note taken out leaves it short by the note; on the last of its
  // lines, the bars after it having come up (fillLines). Until 2026-10-04
  // that was refused ("Another voice plays here"), a rest being all that
  // went then, and a bar of rest under music being no one's to take.
  function takeBarOut(A, src, systems, found, b) {
    const s = found.system;
    const key = found.voice.key;
    const counts = systemBars(src, A, key);
    const total = (counts || []).reduce(function (sum, n) {
      return sum + n;
    }, 0);
    if (total <= 1) return refuse("barOnly");
    const cutOf = function (voice) {
      const elems = voice.elems;
      const music = voiceOn(src, elems);
      const bars = barsOf(elems, music);
      if (!music.length || bars.length <= b) return { failed: "voices" };
      if (/&/.test(musicText(src, elems, music))) return { failed: "noteUnsafe" };
      const cut = barCut(src, elems, music, bars, b);
      if (!cut) return { failed: "noteUnsafe" };
      const words = wordsCut(src, elems, music, cut.removed, cut.whole);
      if (words.failed) return { failed: words.failed };
      const played = bars[b].some(function (i) {
        return elems[i].el_type === "note" && !elems[i].rest;
      });
      // The bars its lines are to have again once the bar is out (fillLines).
      const had = barsHad(src, systems, voice.key, cut.whole ? [s] : []);
      return { key: voice.key, edits: [cut.edit].concat(words.edits), removed: cut.removed, eased: words.eased, played: played, had: had };
    };
    const own = cutOf(found.voice);
    if (own.failed) return refuse(own.failed);
    const others = voicesOf(systems[s])
      .filter(function (voice) {
        return voice.key !== key;
      })
      .map(cutOf);
    const plays = others.some(function (other) {
      return !other.failed && other.played;
    });
    const blocked = others.filter(function (other) {
      return !!other.failed;
    })[0];
    if (!plays && blocked) return refuse(blocked.failed);
    const cuts = plays ? [own] : [own].concat(others);
    const out = apply(
      src,
      [].concat.apply(
        [],
        cuts.map(function (cut) {
          return cut.edits;
        })
      )
    );
    if (out === null) return refuse("noteUnsafe");
    const voices = cuts.map(function (cut) {
      return { key: cut.key, removed: cut.removed, eased: cut.eased };
    });
    const check = verifyOut(A, src, out, { s: s, key: key, voices: voices, bars: 1 });
    if (check) return refuse(wordsBelow(src, found.voice.elems, voiceOn(src, found.voice.elems)) ? "noteLyrics" : check);
    // The line takes a bar again from the one after it, in each voice the
    // bar went from.
    const filled = fillLines(
      A,
      out,
      cuts.map(function (cut) {
        return { key: cut.key, counts: cut.had };
      })
    );
    return { source: filled, at: placeAfter(A, filled, systems, key, s, found.index) };
  }

  // The text the bars `b` to `last` of a voice's line go as (takeBarOut, and
  // stretchCut for a stretch that is whole bars), as { edit, removed, whole
  // }: the edit, the elements of the line it takes, and whether that is the
  // whole line. Null for bars that hold more than notes and barlines (a
  // field written inline in one), or whose barlines on either side both say
  // more than a plain one does.
  function barCut(src, elems, music, bars, b, last) {
    if (last === undefined) last = b;
    let run = [];
    for (let n = b; n <= last; n++) run = run.concat(bars[n]);
    if (
      run.some(function (i) {
        return elems[i].el_type !== "note" && elems[i].el_type !== "bar";
      })
    ) {
      return null;
    }
    const notes = run.filter(function (i) {
      return elems[i].el_type === "note";
    });
    const head = notes[0];
    const tail = notes[notes.length - 1];
    // The barline before the bars, on their line, and the one that closes
    // the last of them.
    let open = -1;
    let close = -1;
    run.forEach(function (i) {
      if (elems[i].el_type !== "bar") return;
      if (i < head) open = i;
      else if (i > tail && close < 0) close = i;
    });
    if (open < 0 && b > 0) {
      const before = bars[b - 1][bars[b - 1].length - 1];
      if (elems[before].el_type === "bar") open = before;
    }
    // Every element of the line but barlines in the bars: the line goes.
    const whole = music.every(function (i) {
      return run.indexOf(i) >= 0 || elems[i].el_type === "bar";
    });
    if (whole) {
      const from = lineStart(src, elems[music[0]].startChar);
      const to = lineEnd(src, elems[music[music.length - 1]].endChar - 1);
      const edit = to < src.length ? { from: from, to: to + 1, insert: "" } : { from: Math.max(0, from - 1), to: to, insert: "" };
      return { edit: edit, removed: music.slice(), whole: true };
    }
    const plain = function (i) {
      const el = elems[i];
      return i >= 0 && el.type === "bar_thin" && !el.startEnding && !el.endEnding;
    };
    const lineFrom = lineStart(src, elems[head].startChar);
    let from = trimStart(src, elems[head].startChar, elems[head].endChar);
    let to = trimEnd(src, elems[tail].endChar, from);
    let drop = -1;
    if (close >= 0) {
      if (plain(close)) drop = close;
      else if (plain(open)) drop = open;
      else return null;
    }
    if (drop >= 0 && drop === close) to = trimEnd(src, elems[close].endChar, trimStart(src, elems[close].startChar, elems[close].endChar));
    if (drop >= 0 && drop === open) from = trimStart(src, elems[open].startChar, elems[open].endChar);
    // The spaces after it, or before it where the line ends there or the
    // barline that goes is the one before it.
    const lineTo = lineEnd(src, to);
    if (/^[ \t]*$/.test(src.slice(to, lineTo))) {
      to = lineTo;
      from = trimEnd(src, from, lineFrom);
    } else if (drop >= 0 && drop === open) {
      from = trimEnd(src, from, lineFrom);
    } else {
      to = trimStart(src, to, lineTo);
    }
    // The notes, and the barlines between them.
    const removed = run.filter(function (i) {
      return i >= head && i <= tail;
    });
    if (drop >= 0) removed.push(drop);
    return { edit: { from: from, to: to, insert: "" }, removed: removed, whole: false };
  }

  // Where the place that comes after one of a voice's places begins in the
  // source `out` that place has gone from: the voice's note elements
  // counted across its systems up to it in `systems`, and the one at that
  // count in `out`. -1 for none, past the end of the voice.
  function placeAfter(A, out, systems, key, s, e) {
    let n = 0;
    for (let i = 0; i <= s; i++) {
      const voice = voiceIn(systems[i], key);
      if (!voice) continue;
      for (let j = 0; j < (i === s ? e : voice.elems.length); j++) if (voice.elems[j].el_type === "note") n++;
    }
    const made = parsed(A, out);
    const lines = made
      ? made.lines.filter(function (line) {
          return line.staff;
        })
      : [];
    for (let i = 0; i < lines.length; i++) {
      const voice = voiceIn(lines[i], key);
      if (!voice) continue;
      for (let j = 0; j < voice.elems.length; j++) {
        if (voice.elems[j].el_type !== "note") continue;
        if (n === 0) return voice.elems[j].startChar;
        n--;
      }
    }
    return -1;
  }

  // ---------- The bars after a cut come up ----------
  //
  // The owner's call of 2026-10-06 for Delete: "si elimino un compás entero
  // seleccionado con delete los compases que van delante deben venir a
  // ocupar su lugar". On the line itself they did already, the text closing
  // over what went. But the line was left a bar short for good, drawn out
  // to the width of the page by the bars it kept, and the bars of the lines
  // below stayed where they were (seen on the bench's eighths, the second
  // bar of the first line taken out: one bar across the page over three
  // lines of two). In a voice that lost the bar alone it was worse: the
  // synth plays a voice's lines one after the other, so every line after
  // that one sounded a bar early, and was drawn as though it did not
  // (measured: the notes of the second line began at 1 where the other
  // voice's began at 2).
  //
  // So a line keeps the number of bars it had. What it is short of comes
  // up from the head of the next line of the voice (moveBars, which carries
  // a verse, a field between the lines, an ending with it), and that line,
  // short in its turn, takes from the one after it, down to the last, which
  // is the one left shorter, or gone where it gave all it had. A line with
  // fewer bars than are wanted of it comes up whole, and the one after it
  // is asked for the rest. Where a move is refused (a title between two
  // lines, a line no barline ends) the bars stop coming there and the line
  // above stays short: nothing is said, the cut having been made.
  //
  // `wants` names each voice that lost bars, with the bars each of its
  // lines had, in order, a line that went whole left out: [{ key, counts }].
  // Voices short in the same way move as one, and every voice of the two
  // lines as the move of the line itself, which is the one the buttons at a
  // line's end make. Returns the source.
  function fillLines(A, src, wants) {
    let out = src;
    const stuck = {};
    // A move fills a line for good or takes one up whole, so a voice has
    // fewer moves to make than it has lines.
    let turns = 0;
    wants.forEach(function (want) {
      turns += want.counts.length;
    });
    for (; turns > 0; turns--) {
      const tune = parsed(A, out);
      if (!tune) break;
      const systems = tune.lines.filter(function (line) {
        return line.staff;
      });
      // The first line each voice is short on that has a line after it.
      const short = [];
      wants.forEach(function (want) {
        if (stuck[want.key]) return;
        const lines = [];
        systems.forEach(function (line, s) {
          const voice = voiceIn(line, want.key);
          const music = voice ? voiceOn(out, voice.elems) : [];
          if (music.length) lines.push({ s: s, elems: voice.elems, bars: barsOf(voice.elems, music) });
        });
        if (lines.length !== want.counts.length) {
          stuck[want.key] = true;
          return;
        }
        for (let i = 0; i + 1 < lines.length; i++) {
          const need = want.counts[i] - lines[i].bars.length;
          if (need <= 0) continue;
          short.push({ want: want, i: i, s: lines[i].s, next: lines[i + 1], take: Math.min(need, lines[i + 1].bars.length) });
          return;
        }
      });
      if (!short.length) break;
      const lead = short[0];
      const group = short.filter(function (one) {
        return one.s === lead.s && one.next.s === lead.next.s && one.take === lead.take && one.next.bars.length === lead.next.bars.length;
      });
      const keys = group.map(function (one) {
        return one.want.key;
      });
      let moved = null;
      if (lead.next.s === lead.s + 1) {
        // A note of the last bar that goes up.
        let at = -1;
        lead.next.bars[lead.take - 1].forEach(function (i) {
          const el = lead.next.elems[i];
          if (at < 0 && el.el_type === "note") at = el.endChar - 1;
        });
        const all = voicesOf(systems[lead.s])
          .concat(voicesOf(systems[lead.next.s]))
          .every(function (voice) {
            return keys.indexOf(voice.key) >= 0;
          });
        if (at >= 0) moved = moveBars(A, out, at, "up", all ? undefined : keys);
      }
      if (!moved || moved.refused) {
        keys.forEach(function (key) {
          stuck[key] = true;
        });
        continue;
      }
      // A line that came up whole is a line less to count.
      if (lead.take === lead.next.bars.length) {
        group.forEach(function (one) {
          one.want.counts.splice(one.i + 1, 1);
        });
      }
      out = moved.source;
    }
    return out;
  }

  // The bars a voice has on each of its lines, in order, the lines of the
  // systems `gone` left out: what fillLines is asked to give them back.
  function barsHad(src, systems, key, gone) {
    const had = [];
    systems.forEach(function (line, s) {
      const voice = voiceIn(line, key);
      const music = voice ? voiceOn(src, voice.elems) : [];
      if (music.length && gone.indexOf(s) < 0) had.push(barsOf(voice.elems, music).length);
    });
    return had;
  }

  // Where a place of a voice begins in the source `to` that a move of bars
  // made of `from`: the first of the voice's notes and rests at or past the
  // character `pos` of `from`, found again by its count among them, which
  // no move of bars changes. -1 for none.
  function carried(A, from, to, key, pos) {
    if (pos < 0) return -1;
    const notes = function (src) {
      const tune = parsed(A, src);
      const list = [];
      (tune ? tune.lines : []).forEach(function (line) {
        const voice = line.staff ? voiceIn(line, key) : null;
        (voice ? voice.elems : []).forEach(function (el) {
          if (el.el_type === "note" && typeof el.startChar === "number") list.push(el.startChar);
        });
      });
      return list;
    };
    const n = notes(from).filter(function (start) {
      return start < pos;
    }).length;
    const now = notes(to);
    return n < now.length ? now[n] : -1;
  }

  // An element of a voice on a system of a tune, by its index there.
  function elementAt(tune, s, key, index) {
    const systems = tune.lines.filter(function (line) {
      return line.staff;
    });
    const voice = systems[s] ? voiceIn(systems[s], key) : null;
    return (voice && voice.elems[index]) || null;
  }

  // Where the parts of a note's text stand in the source: `from`, where the
  // note itself begins (a pitch, a chord in its brackets, a rest), past the
  // space abcjs counts with it and what is written on it before (a chord
  // symbol or an annotation in quotes, a decoration between `!` or by its
  // letter, grace notes in braces, a slur's or a tuplet's opening); `body`,
  // where its length begins; and `length`, where the length ends and what
  // follows the note begins (a tie, a slur's close, the mark of a broken
  // rhythm, the space after it). Null for a text this does not read.
  function noteParts(src, el) {
    const end = el.endChar;
    let i = el.startChar;
    for (;;) {
      if (i >= end) return null;
      const c = src.charAt(i);
      if (c === " " || c === "\t" || /[.~HLMOPSTuv]/.test(c)) {
        i++;
        continue;
      }
      const close = c === '"' || c === "!" || c === "+" ? c : c === "{" ? "}" : null;
      if (close) {
        const j = src.indexOf(close, i + 1);
        if (j < 0 || j >= end) return null;
        i = j + 1;
        continue;
      }
      if (c !== "(") break;
      i++;
      while (i < end && /[0-9:]/.test(src.charAt(i))) i++;
    }
    const text = src.slice(i, end);
    let body = 0;
    const pitch = /^(?:\^\^|\^|__|_|=)?[A-Ga-g][,']*/.exec(text);
    if (text.charAt(0) === "[") {
      // A chord, and not a field written inline.
      if (/^\[[A-Za-z]:/.test(text)) return null;
      body = text.indexOf("]") + 1;
    } else if (pitch) {
      body = pitch[0].length;
    } else if (/^[zZ]/.test(text)) {
      body = 1;
    }
    if (!body) return null;
    const size = /^[0-9]*(?:\/[0-9]*)*/.exec(text.slice(body))[0].length;
    return { from: i, body: i + body, length: i + body + size };
  }

  // A pitch as ABC writes it, from the number abcjs gives it: 0 is `C`, the
  // C under the treble staff, 7 the `c` above it, 14 `c'`, and -7 `C,`.
  function pitchText(pitch) {
    const octave = Math.floor(pitch / 7);
    const letter = "CDEFGAB".charAt(pitch - 7 * octave);
    if (octave <= 0) return letter + new Array(1 - octave).join(",");
    return letter.toLowerCase() + new Array(octave).join("'");
  }

  // When each note of a bar begins, from the head of the bar, and how long
  // it lasts, in whole notes, the notes of a tuplet by the multiplier abcjs
  // puts on the first of them (barLength), and whether it is one of them.
  function barTimes(elems, run) {
    const out = {};
    let at = 0;
    let factor = 1;
    let tuplet = false;
    run.forEach(function (i) {
      const el = elems[i];
      if (el.el_type !== "note") return;
      if (el.startTriplet) {
        factor = el.tripletMultiplier || 1;
        tuplet = true;
      }
      const length = (el.duration || 0) * factor;
      out[i] = { at: at, length: length, tuplet: tuplet };
      at += length;
      if (el.endTriplet) {
        factor = 1;
        tuplet = false;
      }
    });
    return out;
  }

  // The beat of a meter, in whole notes, and whether it is a dotted one: a
  // quarter in 4/4, 3/4 and where there is no meter to go by, a half in cut
  // time, and the dotted quarter of 6/8, 9/8 and 12/8.
  function beatOf(meter) {
    if (meter && meter.type === "cut_time") return { length: 1 / 2, dotted: false };
    if (meter && meter.type === "specified" && meter.value && meter.value.length === 1) {
      const num = Number(meter.value[0].num);
      const den = Number(meter.value[0].den);
      if (num > 0 && den > 0) {
        const dotted = den >= 8 && num % 3 === 0;
        return { length: (dotted ? 3 : 1) / den, dotted: dotted };
      }
    }
    return { length: 1 / 4, dotted: false };
  }

  // ---------- Reading the result back ----------

  // The bars of one voice on each system.
  function systemBars(src, A, key) {
    let tune = null;
    try {
      tune = (A.parseOnly(src) || [])[0];
    } catch (e) {
      return null;
    }
    if (!tune) return null;
    return tune.lines
      .filter(function (line) {
        return line.staff;
      })
      .map(function (line) {
        const voice = voicesOf(line).filter(function (v) {
          return v.key === key;
        })[0];
        return voice ? barsOf(voice.elems, voiceOn(src, voice.elems)).length : 0;
      });
  }

  // What must come through a move unchanged: per voice, every note, rest,
  // barline and part in order, with what is written on them (pitches,
  // lengths, chord symbols, decorations, ties and slurs, the lyrics), and
  // what the synth plays. Where each one stands in the text is left out, and
  // so is what the layout decides: the beaming, which the text's spacing
  // decides, and the number a barline gets under %%measurenb, which abcjs
  // prints at the head of each line and so moves with the lines.
  const SKIP_KEYS = { startChar: 1, endChar: 1, startBeam: 1, endBeam: 1, lyric: 1, abselem: 1, barNumber: 1 };

  // The synth's own reading is compared for its notes, when and how long
  // each sounds, and not for how loud: abcjs weighs a note by where it falls
  // in the bar, and a hairpin by where the line it is written on ends, so the
  // same music on other lines can come out a few steps louder or softer
  // (measured on score-annotations.mdm, 108 against 105). The key, the meter
  // and the clef each note is read under are compared instead (reading).
  const SKIP_AUDIO = { startChar: 1, endChar: 1, volume: 1 };

  function clean(value, skip) {
    skip = skip || SKIP_KEYS;
    if (Array.isArray(value)) {
      return value.map(function (v) {
        return clean(v, skip);
      });
    }
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value)
        .sort()
        .forEach(function (k) {
          if (!skip[k]) out[k] = clean(value[k], skip);
        });
      return out;
    }
    return value;
  }

  // The key, the meter and the clef a voice is in, as abcjs keeps them: on
  // each line for the staff (the meter only where it changes), and inline
  // wherever a field changes them inside a line. A field line between two
  // lines is filed at the end of the line above, and the same field inline
  // where a move put it is filed where it stands: read note by note, both
  // put every note under the same key.
  // The sharps and flats of a key, and not the naturals or their order: a
  // key changed on a line of its own draws the naturals that cancel the key
  // before it, and the same key written inline where a move put it lists
  // them apart or not at all (measured: K:D after K:F), while every note is
  // read under the same sharps.
  function keyOf(key) {
    return key && key.accidentals
      ? key.accidentals
          .filter(function (a) {
            return a.acc !== "natural";
          })
          .map(function (a) {
            return a.acc + a.note;
          })
          .sort()
          .join("")
      : "";
  }

  // A note's verses as abcjs keeps them, blanks at the end left off: a star
  // written to pad a verse gives a note an empty syllable where it had none.
  function verses(el) {
    const list = (el.lyric || []).map(function (l) {
      return (l.syllable || "") + "\u0001" + (l.syllable ? l.divider : "");
    });
    while (list.length && list[list.length - 1] === "\u0001") list.pop();
    return list;
  }

  // With `where`, what each item was read from as well, voice by voice: the
  // system (counted among the lines with staves) and the element's index in
  // its voice there, which is how verifyAdd finds the place a bar went in.
  function reading(A, src, where) {
    let tune = null;
    try {
      tune = (A.parseOnly(src) || [])[0];
    } catch (e) {
      return null;
    }
    if (!tune) return null;
    const voices = {};
    const states = {};
    const at = {};
    let system = -1;
    tune.lines.forEach(function (line) {
      if (!line.staff) return;
      system++;
      voicesOf(line).forEach(function (voice) {
        const list = voices[voice.key] || (voices[voice.key] = []);
        const places = at[voice.key] || (at[voice.key] = []);
        const state = states[voice.key] || (states[voice.key] = { clef: "", key: "", meter: "" });
        const staff = line.staff[Number(voice.key.split("/")[0])];
        if (staff.clef) state.clef = staff.clef.type;
        if (staff.key) state.key = keyOf(staff.key);
        if (staff.meter) state.meter = JSON.stringify(staff.meter.value || staff.meter.type);
        voice.elems.forEach(function (el, i) {
          if (el.el_type === "clef") state.clef = el.type;
          if (el.el_type === "key") state.key = keyOf(el);
          if (el.el_type === "meter") state.meter = JSON.stringify(el.value || el.type);
          if (el.el_type !== "note" && el.el_type !== "bar" && el.el_type !== "part") return;
          const item = clean(el);
          // An ending opened at the head of a line (`[1`, an invisible bar
          // with the ending on it) is the barline that closed the line above
          // opening it, written the way a line break makes ABC write it
          // (splitEnding): one barline, as `|1` is in the middle of a line.
          const last = list[list.length - 1];
          if (
            i === 0 &&
            el.el_type === "bar" &&
            el.type === "bar_invisible" &&
            el.startEnding &&
            last &&
            last.el_type === "bar" &&
            !last.startEnding
          ) {
            last.startEnding = el.startEnding;
            return;
          }
          if (el.el_type === "note") {
            item.verses = verses(el);
            item.under = [state.clef, state.key, state.meter].join(" ");
          }
          list.push(item);
          places.push({ system: system, elem: i, type: el.el_type });
        });
      });
    });
    Object.keys(voices).forEach(function (key) {
      const names = new Map();
      voices[key] = voices[key].map(function (item) {
        const cleaned = clean(item);
        relabel(cleaned, names);
        return JSON.stringify(cleaned);
      });
    });
    let audio = "";
    let notes = "";
    try {
      const played = tune.setUpAudio({ chordsOff: true });
      audio = JSON.stringify(clean(played, SKIP_AUDIO));
      notes = notesPlayed(played);
    } catch (e) {
      audio = "";
      notes = "";
    }
    const out = { voices: voices, audio: audio, notes: notes };
    if (where) out.at = at;
    return out;
  }

  // The numbers abcjs gives the slurs of a voice, given again in the order
  // they are met: they are names and not music, and abcjs numbers a slur
  // that opens on a chord from 1 and one that opens on a note from 101, so
  // a head put on the note a slur opens on renumbered the note it closes on
  // (measured: `(c2 d2)` against `([ce]2 d2)`, 101 against 1).
  function relabel(value, names) {
    if (Array.isArray(value)) {
      value.forEach(function (v) {
        relabel(v, names);
      });
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.keys(value).forEach(function (k) {
      const v = value[k];
      if (k === "startSlur" && Array.isArray(v)) {
        v.forEach(function (slur) {
          if (slur && typeof slur.label === "number") slur.label = slurName(slur.label, names);
        });
      } else if (k === "endSlur" && Array.isArray(v)) {
        value[k] = v.map(function (label) {
          return typeof label === "number" ? slurName(label, names) : label;
        });
      } else {
        relabel(v, names);
      }
    });
  }

  function slurName(label, names) {
    if (!names.has(label)) names.set(label, names.size + 1);
    return names.get(label);
  }

  // What the synth plays, note by note in each track, without when: a bar
  // of rest added moves every note after it later and adds none, so this is
  // the part of the synth's reading an added bar leaves as it was.
  function notesPlayed(played) {
    return JSON.stringify(
      (played.tracks || []).map(function (track) {
        return track
          .filter(function (event) {
            return event.cmd === "note";
          })
          .map(function (event) {
            return [event.pitch, event.duration, event.instrument, event.gap].join(",");
          });
      })
    );
  }

  // Null when the move is safe, or why it is not.
  function verify(A, before, after, key, layout) {
    const was = reading(A, before);
    const now = reading(A, after);
    if (!was || !now) return "parse";
    const keys = Object.keys(was.voices).sort();
    if (keys.join() !== Object.keys(now.voices).sort().join()) return "unsafe";
    for (let i = 0; i < keys.length; i++) {
      const a = was.voices[keys[i]];
      const b = now.voices[keys[i]];
      if (a.length !== b.length) return "unsafe";
      for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return "unsafe";
    }
    if (was.audio !== now.audio) return "unsafe";
    const bars = systemBars(after, A, key);
    if (!bars || bars.join() !== layout.join()) return "unsafe";
    return null;
  }

  // Null when a bar went in as it should, or why it did not. Every voice of
  // the line reads as it did but for the rests of the plan (`rests`, or one
  // of its `length`) and a plain barline, together, at the one place asked
  // for: just past the element `last` of the plan, the parts that open a
  // line left before them when the bar goes at its head, and the rests
  // after the new barline when the bar goes before the barline that ends
  // the tune or closes a bar left open. Every other voice reads as it did, the synth plays the same
  // notes in the same order, and the line has one bar more in the voice
  // `key`.
  function verifyAdd(A, before, after, s, plans, key) {
    const was = reading(A, before, true);
    const now = reading(A, after);
    if (!was || !now) return "parse";
    const keys = Object.keys(was.voices).sort();
    if (keys.join() !== Object.keys(now.voices).sort().join()) return "addUnsafe";
    for (let i = 0; i < keys.length; i++) {
      const a = was.voices[keys[i]];
      const b = now.voices[keys[i]];
      const plan = plans.filter(function (p) {
        return p.key === keys[i];
      })[0];
      if (!plan) {
        if (a.join("\n") !== b.join("\n")) return "addUnsafe";
        continue;
      }
      const places = was.at[keys[i]];
      let x = a.length;
      for (let j = 0; j < places.length; j++) {
        const p = places[j];
        const past = p.system > s || (p.system === s && p.elem > plan.last && !(plan.kind === "head" && p.type === "part"));
        if (past) {
          x = j;
          break;
        }
      }
      const pieces = plan.rests || [plan.length];
      const k = pieces.length;
      if (b.length !== a.length + k + 1) return "addUnsafe";
      for (let j = 0; j < a.length; j++) if (a[j] !== b[j < x ? j : j + k + 1]) return "addUnsafe";
      const barFirst = plan.kind === "end" || plan.kind === "open";
      const first = barFirst ? x + 1 : x;
      for (let r = 0; r < k; r++) {
        const rest = JSON.parse(b[first + r]);
        // A rest abcjs draws, of either name it gives one: "whole" for a rest
        // a whole note long (measured: z4 in 4/4 with L:1/4), "rest"
        // otherwise.
        if (rest.el_type !== "note" || !rest.rest || !/^(?:rest|whole)$/.test(rest.rest.type) || rest.pitches) return "addUnsafe";
        if (Math.abs(rest.duration - pieces[r]) > 1e-6) return "addUnsafe";
      }
      const bar = JSON.parse(barFirst ? b[x] : b[x + k]);
      if (bar.el_type !== "bar" || bar.type !== "bar_thin") return "addUnsafe";
    }
    if (was.notes !== now.notes) return "addUnsafe";
    const bars = systemBars(before, A, key);
    const next = systemBars(after, A, key);
    if (!bars || !next || bars.length !== next.length) return "addUnsafe";
    for (let i = 0; i < bars.length; i++) if (next[i] !== bars[i] + (i === s ? 1 : 0)) return "addUnsafe";
    return null;
  }

  // A rest abcjs draws, as verifyAdd reads one: of either name it gives it.
  function drawnRest(item) {
    return item.el_type === "note" && !!item.rest && /^(?:rest|whole)$/.test(item.rest.type) && !item.pitches;
  }

  // Null when a note went in as it should, or why it did not. The voice
  // reads as it did but for the place of the plan, the element `first` of
  // the system `s`, which is now a place of the plan's length with the
  // plan's heads (by their steps, and each head kept by how it was written
  // too), or a rest of that length where it has none; every other voice
  // reads as it did, and every line has the bars it had. What the synth
  // plays is not compared: a note written is a note more to play.
  function verifyNote(A, before, after, plan) {
    const was = reading(A, before, true);
    const now = reading(A, after);
    if (!was || !now) return "parse";
    const keys = Object.keys(was.voices).sort();
    if (keys.join() !== Object.keys(now.voices).sort().join()) return "noteUnsafe";
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== plan.key && was.voices[keys[i]].join("\n") !== now.voices[keys[i]].join("\n")) return "noteUnsafe";
    }
    const a = was.voices[plan.key];
    const b = now.voices[plan.key];
    const x = placeIndex(was.at[plan.key], plan);
    if (x < 0 || b.length !== a.length) return "noteUnsafe";
    for (let j = 0; j < a.length; j++) if (j !== x && a[j] !== b[j]) return "noteUnsafe";
    const note = JSON.parse(b[x]);
    if (note.el_type !== "note" || Math.abs(note.duration - plan.length) > 1e-6) return "noteUnsafe";
    if (!plan.heads.length) {
      if (!drawnRest(note)) return "noteUnsafe";
    } else {
      const pitches = (note.pitches || []).slice().sort(function (p, q) {
        return p.verticalPos - q.verticalPos;
      });
      if (note.rest || pitches.length !== plan.heads.length) return "noteUnsafe";
      for (let h = 0; h < pitches.length; h++) {
        const head = plan.heads[h];
        if (pitches[h].verticalPos !== head.step || (head.name !== null && pitches[h].name !== head.name)) return "noteUnsafe";
      }
    }
    const bars = systemBars(before, A, plan.key);
    const next = systemBars(after, A, plan.key);
    if (!bars || !next || bars.join() !== next.join()) return "noteUnsafe";
    return null;
  }

  // Where the element `first` of the system `s` stands among a voice's
  // items (reading), or -1.
  function placeIndex(places, plan) {
    for (let j = 0; j < places.length; j++) {
      if (places[j].system === plan.s && places[j].elem === plan.first) return j;
    }
    return -1;
  }

  // Null when a place went in as it should, or why it did not: the voice
  // reads as it did with one place more, of the plan's length, a note of one
  // head at the plan's `step` or a rest where it names none, just after the
  // element `first` of the system `s` or, with `side` "before", just before
  // it; every other voice reads as it did, and every line has the bars it
  // had.
  function verifyInsert(A, before, after, plan) {
    const was = reading(A, before, true);
    const now = reading(A, after);
    if (!was || !now) return "parse";
    const keys = Object.keys(was.voices).sort();
    if (keys.join() !== Object.keys(now.voices).sort().join()) return "noteUnsafe";
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== plan.key && was.voices[keys[i]].join("\n") !== now.voices[keys[i]].join("\n")) return "noteUnsafe";
    }
    const a = was.voices[plan.key];
    const b = now.voices[plan.key];
    const x = placeIndex(was.at[plan.key], plan);
    if (x < 0 || b.length !== a.length + 1) return "noteUnsafe";
    const y = plan.side === "before" ? x : x + 1;
    for (let j = 0; j < a.length; j++) if (a[j] !== b[j < y ? j : j + 1]) return "noteUnsafe";
    const put = JSON.parse(b[y]);
    if (put.el_type !== "note" || Math.abs(put.duration - plan.length) > 1e-6) return "noteUnsafe";
    if (typeof plan.step !== "number") {
      if (!drawnRest(put)) return "noteUnsafe";
    } else if (put.rest || !put.pitches || put.pitches.length !== 1 || put.pitches[0].verticalPos !== plan.step) {
      return "noteUnsafe";
    }
    const bars = systemBars(before, A, plan.key);
    const next = systemBars(after, A, plan.key);
    if (!bars || !next || bars.join() !== next.join()) return "noteUnsafe";
    return null;
  }

  // An item of a reading with what divides each of its syllables from the
  // next left out, `la_` and `la-` as `la`: what a note reads as where the
  // syllable under it lost the note it was held over (wordsCut).
  function undivided(item) {
    const value = JSON.parse(item);
    if (Array.isArray(value.verses)) {
      value.verses = value.verses.map(function (verse) {
        return verse.split("\u0001")[0];
      });
    }
    return JSON.stringify(value);
  }

  // An item of a reading with the names of its slurs left out: what tells a
  // voice read before a paste from the same voice after it, where a slur
  // inside the music put in takes a name and every slur after it the next.
  function unslurred(item) {
    const value = JSON.parse(item);
    const strip = function (v) {
      if (Array.isArray(v)) {
        v.forEach(strip);
        return;
      }
      if (!v || typeof v !== "object") return;
      Object.keys(v).forEach(function (k) {
        if (k === "startSlur" && Array.isArray(v[k])) {
          v[k].forEach(function (slur) {
            if (slur && typeof slur === "object") slur.label = 0;
          });
        } else if (k === "endSlur" && Array.isArray(v[k])) {
          v[k] = v[k].map(function () {
            return 0;
          });
        } else {
          strip(v[k]);
        }
      });
    };
    strip(value);
    return JSON.stringify(value);
  }

  // Whether a run of items holds both ends of every slur and of every tie
  // that has one end in it, as "" or the name of what it holds half of: a
  // slur closed in it was opened in it, one opened in it is closed in it,
  // its first note is tied to none before it and its last to none after
  // it. What tells a run that can go, or come in, without leaving the
  // music beside it half a slur, which abcjs would carry on to the next
  // close it met. The slurs are told by the names a reading gives them,
  // counted as they are met, since abcjs gives every slur opened with none
  // open the same one.
  function heldWhole(items) {
    const open = {};
    let loose = false;
    let first = null;
    let last = null;
    items.forEach(function (item) {
      if (item.el_type !== "note") return;
      const holders = [item].concat(item.pitches || []);
      holders.forEach(function (holder) {
        (Array.isArray(holder.startSlur) ? holder.startSlur : []).forEach(function (slur) {
          const name = slur && typeof slur === "object" ? slur.label : slur;
          open[name] = (open[name] || 0) + 1;
        });
      });
      holders.forEach(function (holder) {
        (Array.isArray(holder.endSlur) ? holder.endSlur : []).forEach(function (name) {
          if (open[name] > 0) open[name]--;
          else loose = true;
        });
      });
      if (item.pitches) {
        if (!first) first = item;
        last = item;
      }
    });
    if (
      loose ||
      Object.keys(open).some(function (name) {
        return open[name] > 0;
      })
    ) {
      return "noteSlur";
    }
    const tied = function (item, end) {
      return (
        !!item &&
        item.pitches.some(function (pitch) {
          return !!pitch[end];
        })
      );
    };
    return tied(first, "endTie") || tied(last, "startTie") ? "noteTie" : "";
  }

  // What a paste left, or { refused }. The voice of the plan reads as it
  // did (the names of its slurs apart) without the elements the plan says
  // go (`gone`, each by its system and its index there), and with the
  // music put in, where the plan says there is some (`music`), before the
  // element `first` of the system `s`, or with `side` "after" just after
  // it; every other voice reads as it did. Each item kept stands on the
  // line it stood on, a line that went whole apart, and the music put in
  // on one line. What went, and what came in, each hold both ends of their
  // slurs and ties (heldWhole); the music put in has a note or a rest in
  // it, and brings no warning of abcjs's the score did not have. The items
  // the plan names as `eased` may read with a syllable divided from the
  // next otherwise than it was (undivided). Returns
  // { after }: where the element after what was put in, or taken out,
  // begins in the new source (-1 for none).
  function verifyPaste(A, before, after, plan) {
    const was = reading(A, before, true);
    const now = reading(A, after, true);
    if (!was || !now) return refuse("parse");
    const keys = Object.keys(was.voices).sort();
    if (keys.join() !== Object.keys(now.voices).sort().join()) return refuse("noteUnsafe");
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== plan.key && was.voices[keys[i]].join("\n") !== now.voices[keys[i]].join("\n")) return refuse("noteUnsafe");
    }
    const a = was.voices[plan.key];
    const b = now.voices[plan.key];
    const places = was.at[plan.key];
    const x = placeIndex(places, plan);
    if (x < 0) return refuse("noteUnsafe");
    const going = {};
    const gone = plan.gone || [];
    for (let g = 0; g < gone.length; g++) {
      const j = placeIndex(places, { s: gone[g].s, first: gone[g].e });
      if (j < 0) return refuse("noteUnsafe");
      going[j] = true;
    }
    // The items that stay, and how many of them stand before the music.
    const kept = [];
    let y = 0;
    for (let j = 0; j < a.length; j++) {
      if (going[j]) continue;
      if (j < x || (plan.side === "after" && j === x)) y++;
      kept.push(j);
    }
    // What goes, read first: half a slur or half a tie gone is what the
    // items beside it would be found changed by, and the reason to give.
    const out = Object.keys(going)
      .map(Number)
      .sort(function (p, q) {
        return p - q;
      })
      .map(function (j) {
        return JSON.parse(a[j]);
      });
    const torn = heldWhole(out);
    if (torn) return refuse(torn);
    const k = b.length - kept.length;
    if (plan.music ? k < 1 : k !== 0) return refuse(plan.music ? "pasteText" : "noteUnsafe");
    const eased = {};
    (plan.eased || []).forEach(function (one) {
      const j = placeIndex(places, { s: one.s, first: one.e });
      if (j >= 0) eased[j] = true;
    });
    for (let n = 0; n < kept.length; n++) {
      const there = n < y ? n : n + k;
      const had = eased[kept[n]] ? undivided(a[kept[n]]) : a[kept[n]];
      const has = eased[kept[n]] ? undivided(b[there]) : b[there];
      if (had !== has && unslurred(had) !== unslurred(has)) return refuse("noteUnsafe");
    }
    // The lines, counted among the ones the voice has something on.
    const lines = function (systems) {
      const seen = [];
      return systems
        .map(function (n) {
          if (seen.indexOf(n) < 0) seen.push(n);
          return seen.indexOf(n);
        })
        .join();
    };
    const spots = now.at[plan.key];
    const stood = kept.map(function (j) {
      return places[j].system;
    });
    const stand = kept.map(function (j, n) {
      return spots[n < y ? n : n + k].system;
    });
    if (lines(stood) !== lines(stand)) return refuse("noteUnsafe");
    const put = [];
    for (let j = y; j < y + k; j++) {
      if (spots[j].system !== spots[y].system) return refuse("noteUnsafe");
      put.push(JSON.parse(b[j]));
    }
    const half = heldWhole(put);
    if (half) return refuse(half);
    if (plan.music) {
      if (
        !put.some(function (item) {
          return item.el_type === "note";
        })
      ) {
        return refuse("pasteText");
      }
      const tuneWas = parsed(A, before);
      const tuneNow = parsed(A, after);
      if (!tuneWas || !tuneNow) return refuse("parse");
      if ((tuneNow.warnings || []).length > (tuneWas.warnings || []).length) return refuse("pasteText");
    }
    // What comes after, in the voice's own elements.
    const next = spots[y + k];
    let at = -1;
    if (next) {
      const tune = parsed(A, after);
      const systems = tune
        ? tune.lines.filter(function (line) {
            return line.staff;
          })
        : [];
      const voice = systems[next.system] ? voiceIn(systems[next.system], plan.key) : null;
      if (voice && voice.elems[next.elem]) at = voice.elems[next.elem].startChar;
    }
    return { after: at };
  }

  // Null when a place or a bar went out as it should, or why it did not.
  // The plan names the elements of the system `s` that go, voice by voice
  // (`voices`, each { key, removed }), and how many bars go from that line
  // in the voice `key` (`bars`, none for a place and one for a bar): each
  // of those voices reads as it did without them, every other voice as it
  // did, and every line has the bars it had but that one, which is gone
  // when it has none left. What goes is notes, rests and barlines and
  // nothing else; the elements a voice names as `eased` may read with a
  // syllable divided from the next otherwise than it was (undivided). What
  // the synth plays is not compared: a note taken out is a note less to
  // play.
  function verifyOut(A, before, after, plan) {
    const was = reading(A, before, true);
    const now = reading(A, after);
    if (!was || !now) return "parse";
    const keys = Object.keys(was.voices).sort();
    if (keys.join() !== Object.keys(now.voices).sort().join()) return "noteUnsafe";
    for (let i = 0; i < keys.length; i++) {
      const a = was.voices[keys[i]];
      const mine = plan.voices.filter(function (v) {
        return v.key === keys[i];
      })[0] || { removed: [] };
      const removed = mine.removed;
      const gone = [];
      for (let r = 0; r < removed.length; r++) {
        const x = placeIndex(was.at[keys[i]], { s: plan.s, first: removed[r] });
        if (x < 0) return "noteUnsafe";
        const item = JSON.parse(a[x]);
        if (item.el_type !== "bar" && item.el_type !== "note") return "noteUnsafe";
        gone.push(x);
      }
      const eased = {};
      (mine.eased || []).forEach(function (e) {
        const x = placeIndex(was.at[keys[i]], { s: plan.s, first: e });
        if (x >= 0) eased[x] = true;
      });
      const b = now.voices[keys[i]];
      let n = 0;
      for (let j = 0; j < a.length; j++) {
        if (gone.indexOf(j) >= 0) continue;
        if (n >= b.length) return "noteUnsafe";
        if (a[j] !== b[n] && !(eased[j] && undivided(a[j]) === undivided(b[n]))) return "noteUnsafe";
        n++;
      }
      if (n !== b.length) return "noteUnsafe";
    }
    const bars = systemBars(before, A, plan.key);
    const next = systemBars(after, A, plan.key);
    if (!bars || !next) return "noteUnsafe";
    const expect = bars.slice();
    if (plan.bars) {
      expect[plan.s] -= plan.bars;
      if (expect[plan.s] <= 0) expect.splice(plan.s, 1);
    }
    if (expect.join() !== next.join()) return "noteUnsafe";
    return null;
  }

  // Null when notes were made rests as they should, or why they were not.
  // The plan names them, each by its voice, its system and its index there
  // ({ key, s, e }): each reads as a rest abcjs draws, as long as the note
  // was; everything else reads as it did, the names of its slurs apart;
  // and every line of every voice has the bars it had.
  function verifyRests(A, before, after, plan) {
    const was = reading(A, before, true);
    const now = reading(A, after);
    if (!was || !now) return "parse";
    const keys = Object.keys(was.voices).sort();
    if (keys.join() !== Object.keys(now.voices).sort().join()) return "noteUnsafe";
    for (let i = 0; i < keys.length; i++) {
      const a = was.voices[keys[i]];
      const b = now.voices[keys[i]];
      if (a.length !== b.length) return "noteUnsafe";
      const turned = {};
      const mine = plan.filter(function (p) {
        return p.key === keys[i];
      });
      for (let n = 0; n < mine.length; n++) {
        const x = placeIndex(was.at[keys[i]], { s: mine[n].s, first: mine[n].e });
        if (x < 0) return "noteUnsafe";
        turned[x] = true;
      }
      for (let j = 0; j < a.length; j++) {
        if (!turned[j]) {
          if (a[j] !== b[j] && unslurred(a[j]) !== unslurred(b[j])) return "noteUnsafe";
          continue;
        }
        const note = JSON.parse(a[j]);
        const rest = JSON.parse(b[j]);
        if (!drawnRest(rest) || Math.abs(rest.duration - note.duration) > 1e-6) return "noteUnsafe";
      }
      if (!mine.length) continue;
      const bars = systemBars(before, A, keys[i]);
      const next = systemBars(after, A, keys[i]);
      if (!bars || !next || bars.join() !== next.join()) return "noteUnsafe";
    }
    return null;
  }

  // What a refusal says to the reader, in the words of the score and not of
  // the code, and as short as the names of the buttons it greys out: the
  // owner's call of 2026-09-30, the sentences they were before being too
  // long for a tip. A button that has nothing to act on says so, the two of
  // a pair in the same words: "No bar to bring up" on the upper button of a
  // last line and "No bar to send down" on the lower one of a last line of
  // one bar (the owner's, 2026-09-30, after "Nothing to bring up" and
  // their pick D, "Nothing to send down"); the rest name what stands in the
  // way, without a "here" the tip's place already says (the owner's cut of
  // three of them, 2026-09-30). What the check of a change finds different
  // once it is written says what is kept, "Can't keep the music as
  // written" (the owner's pick, A, 2026-09-30, for "Would change the
  // music").
  const REASONS = {
    first: "Already on the first line",
    // What the lower of a line's two buttons meets on a last line of one
    // bar, which is the only way left to ask for it (main.js).
    last: "No bar to send down",
    next: "No bar to bring up",
    voices: "Voices don't match",
    lyrics: "Lyrics can't split",
    title: "A title keeps them apart",
    fields: "Another voice's field in the way",
    linebreak: "Line breaks set by %%linebreak",
    runsOn: "No barline ends this line",
    unsafe: "Can't keep the music as written",
    parse: "Can't read this score",
    place: "No bar here",
    overlap: "Can't keep the music as written",
    engine: "Can't read this score",
    addPlace: "No bar here",
    addVoices: "Voices don't match",
    addLyrics: "Lyrics can't make room",
    addMeter: "Bar length unknown",
    addTie: "A tie crosses here",
    addUnsafe: "Can't keep the music as written",
    // A note written (writeNote), in the words the bars' refusals already
    // have.
    noteTie: "A tie crosses here",
    noteLyrics: "Lyrics can't make room",
    notePlace: "No note here",
    noteUnsafe: "Can't keep the music as written",
    // What a stretch leaves of a note it took a part of, where no one note
    // is that long (lengthOne): my wording of 2026-10-06 until the owner
    // chooses.
    noteLength: "No note is that long",
    // A place taken out (takeOut) and a bar (takeBarOut), my wording of
    // 2026-10-02 until the owner chooses: a slur on the place, and the last
    // bar of the score. A stretch that is all of its voice (pasteMusic),
    // of 2026-10-04, likewise.
    noteSlur: "A slur starts or ends here",
    barOnly: "The score's only bar",
    cutAll: "Nothing would be left",
    // Music pasted (pasteMusic), my wording of 2026-10-04 until the owner
    // chooses: a clipboard that holds something else than music, one with
    // nothing in it, and a copy of a voice this score does not have.
    pasteText: "Only music can be pasted here",
    pasteNothing: "Nothing to paste",
    pasteVoice: "No voice of that name here",
    pasteUnit: "Copied under another L:",
  };

  function reasonText(reason) {
    return REASONS[reason] || REASONS.unsafe;
  }

  // ---- The barlines of a line kept together ----
  //
  // A bar that is shorter in one voice than in the others. The keys of the
  // score mode leave them on the way to a full one (a figure written over a
  // longer rest takes its own length and nothing more, the owner's rule of
  // 2026-10-04), and abcjs sets every voice of a line by the time its notes
  // add up to: the short voice's barline stood where its notes ended, in the
  // middle of the system, and everything after it on the line was drawn, and
  // sounded, that much early. Seen on an organ score while the README's take
  // of the mode was recorded (2026-10-05): a half note written over the
  // pedal's whole rest, and the pedal's final barline under the third beat
  // of the two manuals.
  //
  // So the time a bar is missing is given back to it as a rest that is not
  // drawn, in the tune abcjs has parsed and never in the text: the bar reads
  // as short in the document, which is what it is, and on the staff its
  // barline stands with the others, the room after its last note empty. The
  // same is done to the tune the synth plays and to the one an audio file is
  // written from (evenScoreBars in main.js), so the gap sounds as the
  // silence it is and the voices are together after it.
  //
  // Only where the voices disagree and at least one of them has a bar that
  // is not the length its meter gives it: two voices under two meters (3/4
  // over 4/4) have bars of two lengths that are both right, and an upbeat is
  // short in every voice alike. A line whose voices do not close the same
  // number of bars, or that holds a rest of several bars (Z), is left as
  // abcjs reads it, since nothing there says which bar goes with which. What
  // comes after a line's last barline is left too: no barline is waiting
  // for it. A voice laid over another with `&` is a voice like the rest
  // here, which is how abcjs hands it over.
  //
  // One case is not told apart. abcjs 6.7.0 keeps no meter that a voice
  // names for itself at the head of its line (with no M: in the header it
  // keeps none, with one it gives every staff the header's; measured, and
  // held in score-bars.test.js), so two voices written under two meters
  // that way, with as many bars each, read as bars ill filled and the
  // shorter is filled. Such a score has one voice ending bars before the
  // other, which is not what two meters are written for.
  //
  // The rest is abcjs's `x`: no ink, the room of its length, and its length
  // on the clock. It is given the place of the barline it stands before and
  // no length in the text, so nothing that reads the source by an element's
  // characters (the ink of the playhead, a click, the mode's places) finds
  // it there.
  function evenBars(tune) {
    if (!tune || !tune.lines) return tune;
    const meters = {};
    tune.lines.forEach(function (line) {
      if (!line.staff) return;
      const voices = [];
      let plain = true;
      line.staff.forEach(function (staff, s) {
        (staff.voices || []).forEach(function (elems, v) {
          const key = s + "/" + v;
          if (staff.meter) meters[key] = staff.meter;
          const bars = closedBars(elems, meters, key);
          if (!bars) plain = false;
          voices.push({ elems: elems, bars: bars });
        });
      });
      if (!plain || voices.length < 2) return;
      const count = voices[0].bars.length;
      const same = voices.every(function (voice) {
        return voice.bars.length === count;
      });
      if (!same) return;
      // From the last bar back: a rest put into a voice moves every element
      // after it, and the bars before it are still where they were read.
      for (let k = count - 1; k >= 0; k--) {
        let longest = 0;
        let amiss = false;
        voices.forEach(function (voice) {
          const bar = voice.bars[k];
          longest = Math.max(longest, bar.length);
          if (bar.meter === null || Math.abs(bar.length - bar.meter) > 1e-6) amiss = true;
        });
        if (!amiss) continue;
        voices.forEach(function (voice) {
          const bar = voice.bars[k];
          const missing = longest - bar.length;
          if (missing <= 1e-6) return;
          const barline = voice.elems[bar.end];
          voice.elems.splice(bar.end, 0, {
            el_type: "note",
            rest: { type: "invisible" },
            duration: missing,
            startChar: barline.startChar,
            endChar: barline.startChar,
          });
        });
      }
    });
    return tune;
  }

  // The bars a voice closes on a line, each with where its barline stands
  // among the voice's elements, how long what is written in it lasts and how
  // long its meter says a bar is (null with no meter, or one this does not
  // read). A barline with nothing before it on the line closes no bar: `|:`
  // at the head of one voice and not of another is one bar fewer in neither.
  // Null for a voice this cannot count (a rest of several bars).
  // The meter a voice is under is kept in `meters` from line to line, as
  // abcjs names it only where it is written.
  function closedBars(elems, meters, key) {
    const bars = [];
    let length = 0;
    let factor = 1;
    let begun = false;
    let odd = false;
    elems.forEach(function (el, i) {
      if (el.el_type === "meter") {
        meters[key] = el;
      } else if (el.el_type === "note") {
        if (el.rest && /multimeasure/.test(el.rest.type)) odd = true;
        if (el.startTriplet && el.tripletMultiplier) factor = el.tripletMultiplier;
        length += (el.duration || 0) * factor;
        if (el.endTriplet) factor = 1;
        begun = true;
      } else if (el.el_type === "bar") {
        if (begun) bars.push({ end: i, length: length, meter: meterLength(meters[key]) });
        length = 0;
        begun = true;
      }
    });
    return odd ? null : bars;
  }

  return {
    moveBars: moveBars,
    addBar: addBar,
    writeNote: writeNote,
    insertPlace: insertPlace,
    pasteMusic: pasteMusic,
    cutTakes: cutTakes,
    clipParts: clipParts,
    unitAt: unitAt,
    takeOut: takeOut,
    restMusic: restMusic,
    reasonText: reasonText,
    // The checks every move and every bar added pass before they are handed
    // out, for the tests to put to work on their own (score-bars.test.js).
    verify: verify,
    verifyAdd: verifyAdd,
    verifyNote: verifyNote,
    verifyInsert: verifyInsert,
    verifyPaste: verifyPaste,
    verifyOut: verifyOut,
    verifyRests: verifyRests,
    lyricTokens: lyricTokens,
    alignLyrics: alignLyrics,
    // The bars of a parsed tune made as long in every voice of a line, for
    // the drawing and the sound (not for the text, which none of this reads).
    evenBars: evenBars,
  };
});
