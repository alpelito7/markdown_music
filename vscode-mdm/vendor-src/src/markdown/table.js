// Lezer Markdown extension: pipe tables whose cells hold code and maths.
//
// GFM's table parser (@lezer/markdown, Table) splits a row at every
// unescaped `|`, inside a code span and inside `$...$` too: `| a | $|x|$ |`
// came out as four cells under a two-column header, and `` `x || y` ``
// as three (G011). Pandoc, which reads the file for the page, keeps a code
// span and an inline formula whole, and so does this parser: a `|` inside
// a run of backticks (closed by a run of the same length, CommonMark 6.1)
// or inside inline maths (Pandoc's tex_math_dollars: a `$` not followed by
// a space, closed by a `$` not preceded by one and not followed by a
// digit; `$$...$$` likewise) is the cell's, and `\|` stays an escaped pipe
// as in GFM. Everything else is Lezer's own parser, ported: the delimiter
// line, the header's cell count against the delimiter's, the row nodes
// (Table, TableHeader, TableDelimiter, TableRow, TableCell) and a table
// interrupting a paragraph when a delimiter line follows a line of pipes.
//
// The parser replaces GFM's by name (a parseBlock of the same name takes
// its place in the block order), but Lezer keeps every endLeaf ever
// registered: GFM's own, counting cells its way, still decides with this
// one whether a pipe line under a paragraph starts a table. The two count
// alike unless a pipe sits inside code or maths on that line, a case the
// bench has not met. The node types are GFM's, so the parser needs the
// Table extension beside it (lang-markdown's language has it) and stands
// aside on a parser without it.

const PIPE = 124, BACKSLASH = 92, BACKTICK = 96, DOLLAR = 36

function isSpace(ch) { return ch == 32 || ch == 9 }
function isDigit(ch) { return ch >= 48 && ch <= 57 }

// The end of a code span opened at `i` (a run of backticks), or -1 when it
// does not close on the line: the position after the closing run.
function codeSpanEnd(text, i) {
  let run = 0
  while (text.charCodeAt(i + run) == BACKTICK) run++
  for (let j = i + run; j < text.length; j++) {
    if (text.charCodeAt(j) != BACKTICK) continue
    let n = 0
    while (text.charCodeAt(j + n) == BACKTICK) n++
    if (n == run) return j + n
    j += n - 1
  }
  return -1
}

// The end of inline maths opened at `i`, by Pandoc's rules (math.js has
// the same for the inline parser), or -1.
function mathEnd(text, i) {
  if (text.charCodeAt(i + 1) == DOLLAR) {
    for (let j = i + 2; j < text.length; j++) {
      let ch = text.charCodeAt(j)
      if (ch == BACKSLASH) { j++; continue }
      if (ch == DOLLAR && text.charCodeAt(j + 1) == DOLLAR && j > i + 2) return j + 2
    }
    return -1
  }
  let first = text.charCodeAt(i + 1)
  if (Number.isNaN(first) || isSpace(first) || first == DOLLAR) return -1
  for (let j = first == BACKSLASH ? i + 3 : i + 2; j < text.length; j++) {
    let ch = text.charCodeAt(j)
    if (ch == BACKSLASH) { j++; continue }
    if (ch != DOLLAR) continue
    if (isSpace(text.charCodeAt(j - 1)) || isDigit(text.charCodeAt(j + 1))) return -1
    return j + 1
  }
  return -1
}

// Where a span that shields its pipes ends, when one opens at `i`; else -1.
function shieldEnd(text, i) {
  let ch = text.charCodeAt(i)
  if (ch == BACKTICK) return codeSpanEnd(text, i)
  if (ch == DOLLAR) return mathEnd(text, i)
  return -1
}

// Parse a line as a table row and return the cell count. When `elts` is
// given, push the cells and the pipes onto it. Lezer's parseRow, with the
// shielded spans skipped whole.
function parseRow(cx, line, startI, elts, offset) {
  let count = 0, first = true, cellStart = -1, cellEnd = -1, esc = false
  let parseCell = () => {
    elts.push(cx.elt("TableCell", offset + cellStart, offset + cellEnd,
      cx.parser.parseInline(line.slice(cellStart, cellEnd), offset + cellStart)))
  }
  for (let i = startI; i < line.length; i++) {
    let next = line.charCodeAt(i)
    if (!esc) {
      let end = shieldEnd(line, i)
      if (end > -1) {
        if (cellStart < 0) cellStart = i
        cellEnd = end
        i = end - 1
        continue
      }
    }
    if (next == PIPE && !esc) {
      if (!first || cellStart > -1) count++
      first = false
      if (elts) {
        if (cellStart > -1) parseCell()
        elts.push(cx.elt("TableDelimiter", i + offset, i + offset + 1))
      }
      cellStart = cellEnd = -1
    } else if (esc || !isSpace(next)) {
      if (cellStart < 0) cellStart = i
      cellEnd = i + 1
    }
    esc = !esc && next == BACKSLASH
  }
  if (cellStart > -1) {
    count++
    if (elts) parseCell()
  }
  return count
}

function hasPipe(str, start) {
  for (let i = start; i < str.length; i++) {
    let next = str.charCodeAt(i)
    if (next == PIPE) return true
    if (next == BACKSLASH) i++
  }
  return false
}

const delimiterLine = /^[>\s]*\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$/

// Whether the parser's node set has GFM's table nodes, once per parser.
const HAS_TABLE = new WeakMap()
function hasTableNodes(cx) {
  let parser = cx.parser, has = HAS_TABLE.get(parser)
  if (has === undefined) {
    has = parser.nodeSet.types.some(t => t.name == "Table")
    HAS_TABLE.set(parser, has)
  }
  return has
}

class TableParser {
  constructor() {
    // Null before the second line, false when this is no table, and an
    // array of the rows parsed so far when it is.
    this.rows = null
  }
  nextLine(cx, line, leaf) {
    if (this.rows == null) {
      this.rows = false
      let lineText
      if ((line.next == 45 || line.next == 58 || line.next == 124) && delimiterLine.test(lineText = line.text.slice(line.pos))) {
        let firstRow = [], firstCount = parseRow(cx, leaf.content, 0, firstRow, leaf.start)
        if (firstCount == parseRow(cx, lineText, 0))
          this.rows = [cx.elt("TableHeader", leaf.start, leaf.start + leaf.content.length, firstRow),
            cx.elt("TableDelimiter", cx.lineStart + line.pos, cx.lineStart + line.text.length)]
      }
    } else if (this.rows) {
      let content = []
      parseRow(cx, line.text, line.pos, content, cx.lineStart)
      this.rows.push(cx.elt("TableRow", cx.lineStart + line.pos, cx.lineStart + line.text.length, content))
    }
    return false
  }
  finish(cx, leaf) {
    if (!this.rows) return false
    cx.addLeafElement(leaf, cx.elt("Table", leaf.start, leaf.start + leaf.content.length, this.rows))
    return true
  }
}

export const mdmTable = {
  parseBlock: [{
    name: "Table",
    leaf(cx, leaf) { return hasTableNodes(cx) && hasPipe(leaf.content, 0) ? new TableParser : null },
    endLeaf(cx, line, leaf) {
      if (!hasTableNodes(cx) || leaf.parsers.some(p => p instanceof TableParser) || !hasPipe(line.text, line.basePos)) return false
      let next = cx.peekLine()
      return delimiterLine.test(next) && parseRow(cx, line.text, line.basePos) == parseRow(cx, next, line.basePos)
    },
    before: "SetextHeading"
  }]
}
