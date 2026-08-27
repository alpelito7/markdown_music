// ABC notation (abcnotation.com, standard v2.1) as a CodeMirror stream mode,
// for the source of ```abc fences while a caret holds them open.
//
// What a tune is made of, and the colour bucket each piece falls into:
//
//   - Information fields, `X:` `T:` `K:` and the rest, one letter and a colon
//     at the start of a line, plus the inline `[K:G]` form inside the music.
//     The label is structure (abcField); the value after it is either free
//     text (T:itle, C:omposer... -> abcFieldText) or something the player
//     reads (K:ey, M:eter, L:ength, Q:tempo, V:oice... -> abcFieldValue).
//     `w:` and `W:` carry the sung words (abcLyric).
//   - Notes: a pitch letter A-G a-g (abcNote), dressed by accidentals
//     `^ ^^ = _ __` before it and octave marks `'` `,` after it
//     (abcAccidental), and a length after it, `2` `3/2` `/` `//`
//     (abcDuration). Broken rhythm `>` `<` and tuplet openers `(3`, `(p:q:r`
//     trade in time too, so they share abcDuration.
//   - Rests and spacers `z Z x X y` (abcRest): silence, drawn dim.
//   - The measure grid: bar lines `| || |] [| |: :| ::`, variant endings
//     `|1 :|2 [1,3`, the voice overlay `&`, the score line break `$` and the
//     continuation `\` (abcBar).
//   - Decorations: `!trill!` and the deprecated `+trill+`, the shorthands
//     `.` (staccato) `~` (roll) and the reserved letters `H-W h-w` (fermata,
//     bowing and friends), and the braces of grace notes `{...}` (abcDeco).
//   - Chord symbols and annotations, `"Gm7"` `"^text"` (abcChord).
//   - Comments `%` to the end of the line, the `%abc-2.1` version line and
//     `%%directives` such as `%%staffwidth` (abcComment).
//   - What is left, slur parens, ties, the brackets of `[CEG]`, takes no
//     token at all: it is plumbing between notes, not a voice of its own,
//     and the line class the editor puts on a score's source hands it the
//     same ink the bar lines are drawn in.
//
// The buckets are deliberately the extension's own tags (Tag.define() with no
// parent): none of them answers to the standard tags the palette of the VS
// Code theme paints, so a score keeps the extension's own colour, the brass
// of the note in the icon, whatever theme the rest of the code is wearing.
// See "ABC syntax colours" in media/style.css, which spends these twelve
// buckets on seven roles and says why each falls where it does.

import { Tag } from "@lezer/highlight";

export const abcTags = {
  field: Tag.define(),
  fieldText: Tag.define(),
  fieldValue: Tag.define(),
  note: Tag.define(),
  accidental: Tag.define(),
  duration: Tag.define(),
  rest: Tag.define(),
  bar: Tag.define(),
  decoration: Tag.define(),
  chord: Tag.define(),
  lyric: Tag.define(),
  comment: Tag.define(),
};

// The value a field carries, by its letter. Unknown letters read as text:
// wrong colours should never be louder than wrong music.
const LYRIC_FIELDS = /^[wW]$/;
const VALUE_FIELDS = /^[XKLMmPQUVIs]$/;

function fieldKind(letter) {
  if (LYRIC_FIELDS.test(letter)) return "lyric";
  if (VALUE_FIELDS.test(letter)) return "value";
  return "text";
}

// Consume to the end of the line or to an unescaped %, whichever comes
// first. Returns true if anything was eaten.
function eatValue(stream) {
  let ate = false;
  while (!stream.eol()) {
    const ch = stream.peek();
    if (ch === "%") break;
    if (ch === "\\") stream.next();
    stream.next();
    ate = true;
  }
  return ate;
}

export const abc = {
  name: "abc",

  startState() {
    // field: the mode of the rest of a field line; inline: inside [K:...].
    // Neither survives a newline, both are reset at start of line.
    return { field: null, inline: false };
  },

  copyState(state) {
    return { field: state.field, inline: state.inline };
  },

  token(stream, state) {
    if (stream.sol()) {
      state.field = null;
      state.inline = false;
      // Directives (%%staffwidth 1), the %abc version line and plain
      // comments all start the line with %.
      if (stream.match(/^%.*/)) return "abcComment";
      // A field line: one letter and a colon, `+:` continuing the field
      // above (whose letter is gone, so its value reads as text).
      const field = stream.match(/^([A-Za-z+]):/);
      if (field) {
        state.field = field[1] === "+" ? "text" : fieldKind(field[1]);
        return "abcField";
      }
    }

    // The rest of a field line, by the kind its letter declared.
    if (state.field === "text" || state.field === "value") {
      if (stream.peek() === "%") {
        stream.skipToEnd();
        return "abcComment";
      }
      if (eatValue(stream)) return state.field === "text" ? "abcFieldText" : "abcFieldValue";
    }
    if (state.field === "lyric") {
      if (stream.peek() === "%") {
        stream.skipToEnd();
        return "abcComment";
      }
      // The bars of a w: line keep the bar colour, so word and staff align
      // by eye; the syllable plumbing (- _ *) stays part of the words.
      if (stream.match(/^\|+/)) return "abcBar";
      if (stream.match(/^[^%|]+/)) return "abcLyric";
    }

    // A music line from here on.

    if (stream.eatSpace() || stream.eat("`")) return null;

    if (stream.peek() === "%") {
      stream.skipToEnd();
      return "abcComment";
    }

    // Inside an inline field: the value up to the closing bracket.
    if (state.inline) {
      if (stream.eat("]")) {
        state.inline = false;
        return "abcField";
      }
      if (stream.match(/^[^\]]+/)) return "abcFieldValue";
    }

    // "Gm7", "^annotation": to the closing quote, or the end of the line
    // when the quote never comes.
    if (stream.eat('"')) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === "\\") stream.next();
        else if (ch === '"') break;
      }
      return "abcChord";
    }

    // !trill! and +trill+; a bang that never closes is the old line break,
    // which is structure like the bars.
    if (stream.match(/^![^\s!]*!/) || stream.match(/^\+[^\s+]+\+/)) return "abcDeco";
    if (stream.eat("!")) return "abcBar";

    // Grace note braces; the notes inside take their usual colours.
    if (stream.eat("{") || stream.eat("}")) return "abcDeco";

    // The bracket family: [| bars, [1,3 endings, [K:G inline fields, and
    // the plain [ of a chord, which stays in the base ink.
    if (stream.match(/^\[\|\]?/)) return "abcBar";
    if (stream.match(/^\[\d+(?:[,-]\d+)*/)) return "abcBar";
    const inline = stream.match(/^\[([A-Za-z]):/);
    if (inline) {
      state.inline = true;
      return "abcField";
    }

    // Bar lines, with their repeat colons and a variant-ending number
    // ridden straight after (|1, :|2).
    if (stream.match(/^(?::+\|+\]?|\|+\]|\|+:+|\|+|::+)/)) {
      stream.match(/^\d+(?:[,-]\d+)*/);
      return "abcBar";
    }
    if (stream.eat("&") || stream.eat("$") || stream.eat("\\")) return "abcBar";

    // (3 and (p:q:r open tuplets; a bare ( is a slur, left in base ink.
    if (stream.match(/^\(\d+(?::\d*){0,2}/)) return "abcDuration";

    if (stream.match(/^(?:\^{1,2}|_{1,2}|=)/)) return "abcAccidental";
    if (stream.match(/^[A-Ga-g]/)) return "abcNote";
    if (stream.match(/^[',]+/)) return "abcAccidental";
    if (stream.match(/^[zZxXy]/)) return "abcRest";
    if (stream.match(/^\d+(?:\/\d+)*/) || stream.match(/^\/+\d*/)) return "abcDuration";
    if (stream.match(/^[<>]+/)) return "abcDuration";

    // Shorthand decorations: the dot, the roll, and the letters the
    // standard reserves (H-W, h-w; x y z are already rests above).
    if (stream.match(/^[.~H-Wh-w]/)) return "abcDeco";

    stream.next();
    return null;
  },

  tokenTable: {
    abcField: abcTags.field,
    abcFieldText: abcTags.fieldText,
    abcFieldValue: abcTags.fieldValue,
    abcNote: abcTags.note,
    abcAccidental: abcTags.accidental,
    abcDuration: abcTags.duration,
    abcRest: abcTags.rest,
    abcBar: abcTags.bar,
    abcDeco: abcTags.decoration,
    abcChord: abcTags.chord,
    abcLyric: abcTags.lyric,
    abcComment: abcTags.comment,
  },

  languageData: {
    commentTokens: { line: "%" },
  },
};
