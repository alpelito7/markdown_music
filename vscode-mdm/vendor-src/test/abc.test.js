// Tests for the ABC notation stream mode (src/abc.js) and its seat in the
// fence languages (src/languages.js). Run with `npm test` (node --test).

import {test} from "node:test"
import assert from "node:assert/strict"
import {StringStream, ensureSyntaxTree} from "@codemirror/language"
import {EditorState} from "@codemirror/state"
import {markdown, markdownLanguage} from "@codemirror/lang-markdown"
import {highlightTree} from "@lezer/highlight"
import {abc, abcTags} from "../src/abc.js"
import {codeLanguages} from "../src/languages.js"

// Drive the tokenizer by hand: [token, text] for every token of `text`,
// nulls (base ink) kept so a test can pin what is NOT coloured.
function tokenize(text) {
  const state = abc.startState()
  const out = []
  for (const line of text.split("\n")) {
    const stream = new StringStream(line, 4, 4)
    while (!stream.eol()) {
      stream.start = stream.pos
      const tok = abc.token(stream, state)
      assert.ok(stream.pos > stream.start, `tokenizer stuck in ${JSON.stringify(line)}`)
      out.push([tok, line.slice(stream.start, stream.pos)])
    }
  }
  return out
}

// Only the coloured tokens, as "name[text]", for compact expectations.
function colored(text) {
  return tokenize(text).filter(([t]) => t).map(([t, s]) => `${t}[${s}]`)
}

// ---------- fields ----------

test("abc: field labels and the three kinds of value", () => {
  assert.deepEqual(colored("X:1"), ["abcField[X:]", "abcFieldValue[1]"])
  assert.deepEqual(colored("T:Cooley's"), ["abcField[T:]", "abcFieldText[Cooley's]"])
  assert.deepEqual(colored("K:G clef=treble"), ["abcField[K:]", "abcFieldValue[G clef=treble]"])
  assert.deepEqual(colored("M:6/8"), ["abcField[M:]", "abcFieldValue[6/8]"])
  assert.deepEqual(colored("Q:1/4=120"), ["abcField[Q:]", "abcFieldValue[1/4=120]"])
  // An unknown letter reads as text, never louder than wrong music.
  assert.deepEqual(colored("J:whatever"), ["abcField[J:]", "abcFieldText[whatever]"])
  // +: continues the field above; the letter is gone, so text.
  assert.deepEqual(colored("+:more of it"), ["abcField[+:]", "abcFieldText[more of it]"])
})

test("abc: a comment ends a field line and \\% does not", () => {
  assert.deepEqual(colored("T:Sonata % nickname"),
    ["abcField[T:]", "abcFieldText[Sonata ]", "abcComment[% nickname]"])
  assert.deepEqual(colored("T:100\\% true"), ["abcField[T:]", "abcFieldText[100\\% true]"])
})

test("abc: lyrics keep their bars and their comment", () => {
  assert.deepEqual(colored("w: la- la_ * | more % said"), [
    "abcField[w:]", "abcLyric[ la- la_ * ]", "abcBar[|]",
    "abcLyric[ more ]", "abcComment[% said]",
  ])
  assert.deepEqual(colored("W:words after the tune")[1], "abcLyric[words after the tune]")
})

test("abc: inline fields inside the music", () => {
  assert.deepEqual(colored("CDE [M:3/4] efg"), [
    "abcNote[C]", "abcNote[D]", "abcNote[E]",
    "abcField[[M:]", "abcFieldValue[3/4]", "abcField[]]",
    "abcNote[e]", "abcNote[f]", "abcNote[g]",
  ])
})

// ---------- notes ----------

test("abc: pitches, accidentals, octave marks and lengths", () => {
  assert.deepEqual(colored("^c'3/2 _B,2 =e/ G//"), [
    "abcAccidental[^]", "abcNote[c]", "abcAccidental[']", "abcDuration[3/2]",
    "abcAccidental[_]", "abcNote[B]", "abcAccidental[,]", "abcDuration[2]",
    "abcAccidental[=]", "abcNote[e]", "abcDuration[/]",
    "abcNote[G]", "abcDuration[//]",
  ])
  assert.deepEqual(colored("^^F __g"), [
    "abcAccidental[^^]", "abcNote[F]", "abcAccidental[__]", "abcNote[g]",
  ])
})

test("abc: rests and spacers are dim, with their lengths", () => {
  assert.deepEqual(colored("z2 x Z4 y"), [
    "abcRest[z]", "abcDuration[2]", "abcRest[x]",
    "abcRest[Z]", "abcDuration[4]", "abcRest[y]",
  ])
})

test("abc: broken rhythm and tuplets trade in time", () => {
  assert.deepEqual(colored("a>b c<<d (3abc (3:2:3 abc"), [
    "abcNote[a]", "abcDuration[>]", "abcNote[b]",
    "abcNote[c]", "abcDuration[<<]", "abcNote[d]",
    "abcDuration[(3]", "abcNote[a]", "abcNote[b]", "abcNote[c]",
    "abcDuration[(3:2:3]", "abcNote[a]", "abcNote[b]", "abcNote[c]",
  ])
})

test("abc: slurs, ties and chord brackets stay in the base ink", () => {
  const toks = tokenize("(ab-c) [CEG]2")
  const bare = toks.filter(([t]) => !t).map(([, s]) => s).join("")
  assert.equal(bare, "(-) []")
})

// ---------- structure ----------

test("abc: the bar family", () => {
  assert.deepEqual(colored("| || |] [| |: :| :: :|]"),
    ["abcBar[|]", "abcBar[||]", "abcBar[|]]", "abcBar[[|]", "abcBar[|:]",
     "abcBar[:|]", "abcBar[::]", "abcBar[:|]]"])
  assert.deepEqual(colored("|1 CDE :|2 FGA [1,3 B"), [
    "abcBar[|1]", "abcNote[C]", "abcNote[D]", "abcNote[E]",
    "abcBar[:|2]", "abcNote[F]", "abcNote[G]", "abcNote[A]",
    "abcBar[[1,3]", "abcNote[B]",
  ])
  assert.deepEqual(colored("a & b $ c \\"), [
    "abcNote[a]", "abcBar[&]", "abcNote[b]",
    "abcBar[$]", "abcNote[c]", "abcBar[\\]",
  ])
})

test("abc: decorations, long and short, and grace braces", () => {
  assert.deepEqual(colored("!trill!G +fermata+A .b ~c uv {ag}e"), [
    "abcDeco[!trill!]", "abcNote[G]", "abcDeco[+fermata+]", "abcNote[A]",
    "abcDeco[.]", "abcNote[b]", "abcDeco[~]", "abcNote[c]",
    "abcDeco[u]", "abcDeco[v]",
    "abcDeco[{]", "abcNote[a]", "abcNote[g]", "abcDeco[}]", "abcNote[e]",
  ])
  // A bang with no partner is the old line break: structure, like a bar.
  assert.deepEqual(colored("ab!"), ["abcNote[a]", "abcNote[b]", "abcBar[!]"])
})

test("abc: chord symbols and annotations, closed or cut short", () => {
  assert.deepEqual(colored('"Gm7"d "^slow"e'), [
    'abcChord["Gm7"]', "abcNote[d]", 'abcChord["^slow"]', "abcNote[e]",
  ])
  // An unterminated quote takes the rest of its line and no more.
  assert.deepEqual(colored('"Gm7 d\nef'), ['abcChord["Gm7 d]', "abcNote[e]", "abcNote[f]"])
})

test("abc: comments and directives own their lines", () => {
  assert.deepEqual(colored("%%staffwidth 500"), ["abcComment[%%staffwidth 500]"])
  assert.deepEqual(colored("%abc-2.1"), ["abcComment[%abc-2.1]"])
  assert.deepEqual(colored("CDE % turn"),
    ["abcNote[C]", "abcNote[D]", "abcNote[E]", "abcComment[% turn]"])
})

// ---------- the seat in the fence languages ----------

const md = markdown({base: markdownLanguage, codeLanguages})

function highlights(doc) {
  const state = EditorState.create({doc, extensions: [md]})
  const tree = ensureSyntaxTree(state, doc.length, 5000)
  const byTag = new Map(Object.entries(abcTags).map(([name, tag]) => [tag, name]))
  const spans = []
  highlightTree(tree, {style: (tags) => tags.map(t => byTag.get(t)).filter(Boolean)[0] || null},
    (from, to, name) => { if (name) spans.push(`${name}[${doc.slice(from, to)}]`) })
  return spans
}

test("fences: ```abc reaches the abc mode", () => {
  assert.deepEqual(highlights("```abc\nX:1\nCDE |]\n```\n"), [
    "field[X:]", "fieldValue[1]", "note[CDE]", "bar[|]]",
  ])
})

test("fences: the Quarto info string {.abc .play} matches too", () => {
  assert.deepEqual(highlights("```{.abc .play}\nK:G\n```\n"),
    ["field[K:]", "fieldValue[G]"])
})

test("fences: a stream-mode fence parses instead of throwing", () => {
  // Regression: the bare StreamLanguage handed to LanguageDescription made
  // every stream fence (```r, ```sh, ```tex...) throw inside the parser.
  const doc = "```r\nx <- 42 # hey\n```\n"
  const state = EditorState.create({doc, extensions: [md]})
  const tree = ensureSyntaxTree(state, doc.length, 5000)
  let fence = false
  tree.iterate({enter(n) { if (n.name === "FencedCode") fence = true }})
  assert.ok(fence)
})
