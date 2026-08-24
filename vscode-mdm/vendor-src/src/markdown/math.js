// Lezer Markdown extension for Pandoc tex_math_dollars math.
//
// Nodes:
//   InlineMath       `$x$` inside a paragraph. Children: InlineMathMark (each `$`),
//                    InlineMathContent (the source between the marks).
//   InlineBlockMath  `$$x$$` found inside a paragraph (Pandoc renders it as
//                    display math but it is inline-level syntax: it sits among
//                    text and may span soft line breaks). Children:
//                    InlineBlockMathMark, InlineBlockMathContent. It is a
//                    separate node, rather than InlineMath with longer marks,
//                    so the editor can decide display vs inline by name alone.
//   BlockMath        A `$$` fence on its own line(s). Children: BlockMathMark
//                    (each `$$`), BlockMathContent, plus any container markers
//                    (QuoteMark) of the lines it spans.
//
// Math content is never parsed as Markdown: the content elements carry no
// children, so `$a_b$` does not become emphasis.
//
// A broken construct produces no node at all and its source falls back to
// plain paragraph text; nothing is lenient on purpose.

import {tags} from "@lezer/highlight"
import {parseMixed} from "@lezer/common"
import {StreamLanguage} from "@codemirror/language"
import {stexMath} from "@codemirror/legacy-modes/mode/stex"

const DOLLAR = 36, BACKSLASH = 92

// The body of a `$...$`, `$$...$$` or block `$$` is LaTeX in math mode, so it
// is highlighted with the stex math grammar (control sequences, braces,
// numbers, comments). Mounted as an overlay, like the YAML of the header, so
// the *MathContent node stays in the Markdown tree (the editor reads it by
// name) while the LaTeX tree is reachable at its positions for highlighting.
const texParser = StreamLanguage.define(stexMath).parser
const MATH_CONTENT = /^(?:InlineMathContent|InlineBlockMathContent|BlockMathContent)$/

function isSpace(ch) { return ch == 32 || ch == 9 || ch == 10 || ch == 13 }
function isDigit(ch) { return ch >= 48 && ch <= 57 }

// Port of the private injectMarks from @lezer/markdown: nest container
// markers (QuoteMark and the like) into the element whose range covers them,
// otherwise splice them in at the right position.
function injectMarks(elements, marks, cx) {
  if (!marks.length) return elements
  if (!elements.length) return marks
  let elts = elements.slice(), eI = 0
  for (let mark of marks) {
    while (eI < elts.length && elts[eI].to < mark.to) eI++
    if (eI < elts.length && elts[eI].from < mark.from) {
      let e = elts[eI]
      elts[eI] = cx.elt(e.type, e.from, e.to, injectMarks(e.children, [mark], cx))
    } else {
      elts.splice(eI++, 0, mark)
    }
  }
  return elts
}

// ---------- inline ----------

// Pandoc rules (Text.Pandoc.Parsing, mathDisplayWith / mathInlineWith).
// Double dollar is tried first: the first `$$` after the opener closes it, no
// whitespace rules. Otherwise single dollar: the opener must be followed by a
// non-space character, the content is at least one character (so `$$$` is
// math with content `$`, as in Pandoc), and the first `$` after that is the
// only candidate closer: it must be preceded by a non-space character and
// must not be followed by a digit ("$5 and $6" is not math); when it fails
// the rules the whole construct fails, there is no search for a later one.
// Both forms may span the paragraph's soft line breaks. `\$` never opens
// (the Escape parser runs first and consumes it) and never closes: a
// backslash skips the next character while scanning, in both forms (Pandoc
// does not honour `\$` inside `$$`, but KaTeX does, and this is for KaTeX).
function parseInlineMath(cx, next, pos) {
  if (next != DOLLAR) return -1
  if (cx.char(pos + 1) == DOLLAR) {
    let from = pos + 2
    for (let i = from; i < cx.end; i++) {
      let ch = cx.char(i)
      if (ch == BACKSLASH) { i++; continue }
      if (ch != DOLLAR || cx.char(i + 1) != DOLLAR) continue
      if (i == from) break
      return cx.addElement(cx.elt("InlineBlockMath", pos, i + 2, [
        cx.elt("InlineBlockMathMark", pos, from),
        cx.elt("InlineBlockMathContent", from, i),
        cx.elt("InlineBlockMathMark", i, i + 2)
      ]))
    }
  }
  let from = pos + 1
  let first = cx.char(from)
  if (first < 0 || isSpace(first)) return -1
  for (let i = first == BACKSLASH ? from + 2 : from + 1; i < cx.end; i++) {
    let ch = cx.char(i)
    if (ch == BACKSLASH) { i++; continue }
    if (ch != DOLLAR) continue
    if (isSpace(cx.char(i - 1)) || isDigit(cx.char(i + 1))) return -1
    return cx.addElement(cx.elt("InlineMath", pos, i + 1, [
      cx.elt("InlineMathMark", pos, from),
      cx.elt("InlineMathContent", from, i),
      cx.elt("InlineMathMark", i, i + 1)
    ]))
  }
  return -1
}

// ---------- block ----------

// True when the line, after the container markup and up to 3 spaces of
// indentation, starts with `$$`.
function isBlockMathStart(line) {
  return line.next == DOLLAR && line.indent - line.baseIndent < 4 &&
    line.text.charCodeAt(line.pos + 1) == DOLLAR
}

// Text of the line from the container base, with the container prefix
// replaced by spaces so that offsets stay document-relative (what the
// private Line.scrub does for paragraphs).
function scrub(line) {
  return " ".repeat(line.basePos) + line.text.slice(line.basePos)
}

// The `$$` block. Lezer block parsers consume lines with cx.nextLine() and
// cannot rewind, so the parser consumes the candidate lines and, when no
// closing line turns up before a blank line, the end of the containing
// block or the end of the document, it emits the consumed lines itself as
// the Paragraph the default parser would have produced. That is how an
// unterminated `$$` shows as source: there is no BlockMath node.
//
// Closing line: the first line whose text contains `$$` after the opener.
// If that `$$` is not at the end of the line (trailing spaces allowed) the
// block is broken and falls back too; Pandoc closes display math at the
// first `$$`, so a block whose first `$$` sits mid-line cannot be the
// multi-line fence this parser is for. A single line `$$ x $$` is complete.
function parseBlockMath(cx, line) {
  if (!isBlockMathStart(line)) return false
  let from = cx.lineStart + line.pos
  let openTo = from + 2
  let lines = [line.text.slice(line.pos)], starts = [from]
  let marks = []
  let contentFrom = -1, contentTo = -1, closeFrom = -1, closeTo = -1
  let rest = line.text.slice(line.pos + 2)
  let mid = rest.indexOf("$$")
  if (mid > -1) {
    // Closer on the opening line: complete only when it ends the line.
    if (mid != rest.trimEnd().length - 2) return false
    closeFrom = openTo + mid
    closeTo = closeFrom + 2
    contentFrom = openTo
    contentTo = closeFrom
    cx.nextLine()
  } else {
    // The opening line keeps any text after `$$` as content; when it has
    // none the content starts on the next line.
    if (rest.trim().length) contentFrom = openTo
    let closed = false
    while (cx.nextLine() && line.depth >= cx.depth) {
      if (line.pos == line.text.length) break
      let text = line.text, lineFrom = cx.lineStart
      for (let m of line.markers) marks.push(m)
      lines.push(scrub(line))
      starts.push(lineFrom)
      let idx = text.indexOf("$$", line.basePos)
      if (idx < 0) {
        if (contentFrom < 0) contentFrom = lineFrom + line.basePos
        continue
      }
      if (idx != text.trimEnd().length - 2) break
      closeFrom = lineFrom + idx
      closeTo = closeFrom + 2
      if (contentFrom < 0) contentFrom = lineFrom + line.basePos
      // Content ends before the closer; a closing line with nothing of its
      // own before `$$` ends the content at the previous line's end.
      contentTo = text.slice(line.basePos, idx).trim().length ? closeFrom : cx.prevLineEnd()
      if (contentTo < contentFrom) contentTo = contentFrom
      closed = true
      cx.nextLine()
      break
    }
    if (!closed) {
      fallbackParagraph(cx, lines, starts, marks)
      return true
    }
  }
  let children = [cx.elt("BlockMathMark", from, openTo)]
  let inner = []
  for (let m of marks) {
    if (m.from >= contentFrom && m.to <= contentTo) inner.push(m)
    else children.push(m)
  }
  if (contentTo > contentFrom) children.push(cx.elt("BlockMathContent", contentFrom, contentTo, inner))
  children.push(cx.elt("BlockMathMark", closeFrom, closeTo))
  children.sort((a, b) => a.from - b.from)
  cx.addElement(cx.elt("BlockMath", from, closeTo, children))
  return true
}

// Re-emit consumed lines as the Paragraph the default parser would have
// built: inline-parsed content with the container markers injected.
function fallbackParagraph(cx, lines, starts, marks) {
  let start = starts[0]
  let content = lines[0]
  for (let i = 1; i < lines.length; i++) content += "\n" + lines[i]
  let to = start + content.length
  let inline = injectMarks(cx.parser.parseInline(content, start), marks, cx)
  cx.addElement(cx.elt("Paragraph", start, to, inline))
}

// A `$$` line interrupts a paragraph (lazy continuation) so that the block
// parser sees it, unless the paragraph already holds an open `$$`: then the
// line is the closer of an inline display math and stays in the paragraph.
function endLeafOnBlockMath(_cx, line, leaf) {
  if (!isBlockMathStart(line)) return false
  let open = 0
  for (let i = 0; i < leaf.content.length; i++) {
    let ch = leaf.content.charCodeAt(i)
    if (ch == BACKSLASH) { i++; continue }
    if (ch == DOLLAR && leaf.content.charCodeAt(i + 1) == DOLLAR) { open ^= 1; i++ }
  }
  return open == 0
}

export const mdmMath = {
  defineNodes: [
    {name: "InlineMath"},
    {name: "InlineMathMark", style: tags.processingInstruction},
    {name: "InlineMathContent", style: tags.monospace},
    {name: "InlineBlockMath"},
    {name: "InlineBlockMathMark", style: tags.processingInstruction},
    {name: "InlineBlockMathContent", style: tags.monospace},
    {name: "BlockMath", block: true},
    {name: "BlockMathMark", style: tags.processingInstruction},
    {name: "BlockMathContent", style: tags.monospace}
  ],
  parseInline: [{
    name: "InlineMath",
    parse: parseInlineMath,
    before: "Emphasis"
  }],
  parseBlock: [{
    name: "BlockMath",
    parse: parseBlockMath,
    endLeaf: endLeafOnBlockMath,
    // Nothing else claims a `$$` line; before FencedCode just groups it
    // with the other fence-like blocks. Indented (4+) `$$` is left to
    // IndentedCode by the indent check above.
    before: "FencedCode"
  }],
  wrap: parseMixed(node => MATH_CONTENT.test(node.type.name)
    ? {parser: texParser, overlay: [{from: node.from, to: node.to}]}
    : null)
}
