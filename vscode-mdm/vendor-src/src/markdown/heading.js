// Lezer Markdown extension: an ATX heading whose marks are followed by a tab.
//
// CommonMark 4.2 lets the opening run of `#` be followed by a space or a
// tab; @lezer/markdown's isAtxHeading takes a space alone, so `#\tTitle`
// was a paragraph in the editor and a heading on the page, in CommonMark,
// GFM and Pandoc alike (G042). This parser takes the tab case only, ahead
// of Lezer's, and builds the node Lezer builds (ATXHeading1..6 with its
// HeaderMark children and inline content one character past the marks),
// so the editor reads it as any heading. Like an ATX heading it interrupts
// a paragraph.

const HASH = 35, TAB = 9

function space(ch) { return ch == 32 || ch == 9 || ch == 10 || ch == 13 }
function skipSpaceBack(text, i, to) {
  while (i > to && space(text.charCodeAt(i - 1))) i--
  return i
}

// The level of the heading, or -1 when the line is not `#{1,6}` and a tab.
function tabHeadingSize(line) {
  if (line.next != HASH || line.indent - line.baseIndent >= 4) return -1
  let pos = line.pos + 1
  while (pos < line.text.length && line.text.charCodeAt(pos) == HASH) pos++
  if (pos >= line.text.length || line.text.charCodeAt(pos) != TAB) return -1
  let size = pos - line.pos
  return size > 6 ? -1 : size
}

function parseTabHeading(cx, line) {
  let size = tabHeadingSize(line)
  if (size < 0) return false
  let off = line.pos, from = cx.lineStart + off, text = line.text
  // A closing run of `#`, preceded by whitespace, is a mark too (Lezer's
  // own rule, kept as it is).
  let endOfSpace = skipSpaceBack(text, text.length, off), after = endOfSpace
  while (after > off && text.charCodeAt(after - 1) == HASH) after--
  if (after == endOfSpace || after == off || !space(text.charCodeAt(after - 1))) after = text.length
  let children = [cx.elt("HeaderMark", from, from + size)]
  for (let e of cx.parser.parseInline(text.slice(off + size + 1, after), from + size + 1)) children.push(e)
  if (after < text.length) children.push(cx.elt("HeaderMark", cx.lineStart + after, cx.lineStart + endOfSpace))
  cx.addElement(cx.elt("ATXHeading" + size, from, cx.lineStart + text.length, children))
  cx.nextLine()
  return true
}

export const mdmTabHeading = {
  parseBlock: [{
    name: "ATXHeadingTab",
    parse: parseTabHeading,
    endLeaf: (cx, line) => tabHeadingSize(line) > -1,
    before: "ATXHeading"
  }]
}
