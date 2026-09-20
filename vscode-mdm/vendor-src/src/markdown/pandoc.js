// Lezer Markdown extension: the Pandoc syntax the export reads and the
// editor had no node for, so that what the page does with it is drawn and
// nothing is swallowed in silence (P6 of the markdown-editor branch).
//
// Raw TeX (G013): a backslash before letters, with the `{...}` and `[...]`
// groups that follow, is a raw inline to Pandoc's Markdown (raw_tex, on by
// default), which the HTML writer drops and the LaTeX writer copies
// through; CommonMark reads a literal backslash. A `\begin{env}` line down
// to its `\end{env}` is the block form. Either way the node lets the editor
// say what it is instead of drawing prose the page then loses.
//
// Attributes (G014): `{#id .class key=val}`, which Pandoc reads after a
// heading, an image, a link, a code span and a bracketed span
// (header_attributes, link_attributes, inline_code_attributes,
// bracketed_spans), and CommonMark prints as text. The node is flat; the
// editor reads what it needs off its text. It is only taken where Pandoc
// takes it: straight after a `)`, a backtick or a `]`, or standing alone
// as the tail of a `$$` closer (math.js parses that tail on its own); a
// brace group in prose stays text. A heading's attributes are not a node:
// an inline parser cannot tell a heading's line from a paragraph's, and
// the editor reads them off the heading's text instead.
//
// Citations (PX04): `@key`, `[@key, p. 33]`, `[-@key]`, `[see @a; @b]`,
// which Quarto also uses for its cross-references (`@fig-x`, `@sec-x`). A
// `@` inside a word, a mail address, opens none.


const BACKSLASH = 92, OPEN_BRACE = 123, CLOSE_BRACE = 125, OPEN_BRACKET = 91, CLOSE_BRACKET = 93
const AT = 64, NEWLINE = 10, STAR = 42

function isLetter(ch) { return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) }
function isWordChar(ch) { return isLetter(ch) || (ch >= 48 && ch <= 57) || ch == 95 }
function isSpace(ch) { return ch == 32 || ch == 9 || ch == NEWLINE || ch == 13 || ch < 0 }

// The end of a balanced group opened at pos, on one line, or -1.
function groupEnd(cx, pos, open, close) {
  let depth = 0
  for (let i = pos; i < cx.end; i++) {
    let ch = cx.char(i)
    if (ch == BACKSLASH) { i++; continue }
    if (ch == NEWLINE) return -1
    if (ch == open) depth++
    else if (ch == close && --depth == 0) return i + 1
  }
  return -1
}

// ---------- raw TeX ----------

function parseRawTeX(cx, next, pos) {
  if (next != BACKSLASH || !isLetter(cx.char(pos + 1))) return -1
  let end = pos + 1
  while (end < cx.end && isLetter(cx.char(end))) end++
  if (cx.char(end) == STAR) end++
  for (;;) {
    let ch = cx.char(end)
    let close = ch == OPEN_BRACE ? groupEnd(cx, end, OPEN_BRACE, CLOSE_BRACE)
      : ch == OPEN_BRACKET ? groupEnd(cx, end, OPEN_BRACKET, CLOSE_BRACKET) : -1
    if (close < 0) break
    end = close
  }
  return cx.addElement(cx.elt("RawTeX", pos, end))
}

const BEGIN = /^\\begin\{([^}\s]+)\}/

// Where the last `\end{env}` of each environment stands in the input, read
// off the whole input once per parse (as links.js reads its definitions): a
// closer follows an opener when the last one of its name stands past it. A
// look-ahead from every opener read the rest of the input each time, so a
// document of environments that never end cost the square of its length,
// the fault the callouts had (G038).
let current = {input: null, ends: new Map()}

export function lastEnds(text) {
  let ends = new Map(), re = /\\end\{([^}\s]+)\}/g, m
  while ((m = re.exec(text))) ends.set(m[1], m.index)
  return ends
}

function closesAfter(cx, name, pos) {
  let input = cx.input
  if (!input) return false
  if (current.input !== input) current = {input, ends: lastEnds(input.read(0, input.length))}
  return current.ends.has(name) && current.ends.get(name) >= pos
}

// `\begin{env}` at the head of a line, down to the line holding its
// `\end{env}`. Committed only when that line exists: nextLine() cannot be
// undone, and without the closer the lines are the paragraph they read as.
// At the top level only: the look-ahead reads raw lines past the end of a
// quote or an item, and a closer out there would take the container's
// lines with it.
function parseRawTeXBlock(cx, line) {
  if (line.next != BACKSLASH || cx.depth != 1 || line.indent > 3) return false
  let m = BEGIN.exec(line.text.slice(line.pos))
  if (!m) return false
  let closer = "\\end{" + m[1] + "}"
  let start = cx.lineStart + line.pos
  let onLine = line.text.indexOf(closer, line.pos + m[0].length) >= 0
  if (!onLine && !closesAfter(cx, m[1], cx.lineStart + line.text.length)) return false
  if (!onLine) {
    do {
      if (!cx.nextLine()) return true
    } while (line.text.indexOf(closer) < 0)
  }
  let end = cx.lineStart + line.text.length
  cx.nextLine()
  cx.addElement(cx.elt("RawTeXBlock", start, end))
  return true
}

// ---------- attributes ----------

// An id, a class, a key=value pair, the `-` of unnumbered, or the `=format`
// of a raw span or block (raw_attribute).
const ATTR_ITEM = /^(?:#[^\s}#.]+|\.[^\s}#.]+|[^\s}=]+=(?:"[^"]*"|'[^']*'|[^\s}]+)|=[^\s}]+|-)$/

// The end of an attribute block opened at pos, or -1 when what stands
// there is no attribute block: every item an id, a class, a key=value pair
// or the `-` of unnumbered.
export function attributeEnd(cx, pos) {
  if (cx.char(pos) != OPEN_BRACE) return -1
  let end = groupEnd(cx, pos, OPEN_BRACE, CLOSE_BRACE)
  if (end < 0) return -1
  let inner = cx.slice(pos + 1, end - 1).trim()
  if (!inner) return -1
  let items = inner.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  for (let item of items) if (!ATTR_ITEM.test(item)) return -1
  return end
}

function parseAttribute(cx, next, pos) {
  if (next != OPEN_BRACE) return -1
  let end = attributeEnd(cx, pos)
  if (end < 0) return -1
  let before = pos > cx.offset ? cx.char(pos - 1) : -1
  let placed = before == 41 /* ) */ || before == 96 /* ` */ || before == CLOSE_BRACKET ||
    (before == -1 && cx.slice(end, cx.end).search(/\S/) < 0)
  if (!placed) return -1
  return cx.addElement(cx.elt("Attribute", pos, end))
}

// ---------- citations ----------

const KEY_CHAR = /[\w:.#$%&\-+?<>~/]/

function citationKeyEnd(cx, pos) {
  let end = pos + 1
  if (!isWordChar(cx.char(end))) return -1
  while (end < cx.end && KEY_CHAR.test(String.fromCharCode(cx.char(end)))) end++
  // Internal punctuation is the key's, trailing punctuation is the prose's.
  while (end > pos + 1 && !isWordChar(cx.char(end - 1))) end--
  return end
}

function parseCitation(cx, next, pos) {
  if (next == AT) {
    if (isWordChar(cx.char(pos - 1))) return -1
    let end = citationKeyEnd(cx, pos)
    if (end < 0) return -1
    return cx.addElement(cx.elt("Citation", pos, end))
  }
  if (next == OPEN_BRACKET) {
    let end = groupEnd(cx, pos, OPEN_BRACKET, CLOSE_BRACKET)
    if (end < 0) return -1
    let inner = cx.slice(pos + 1, end - 1)
    if (inner.indexOf("[") >= 0 || !/(?:^|[\s;(-])@[\w]/.test(inner)) return -1
    return cx.addElement(cx.elt("Citation", pos, end))
  }
  return -1
}

export const mdmPandoc = {
  defineNodes: [
    {name: "RawTeX"},
    {name: "RawTeXBlock", block: true},
    {name: "Attribute"},
    {name: "Citation"},
    {name: "Span"}
  ],
  parseBlock: [{
    name: "RawTeXBlock",
    parse: parseRawTeXBlock,
    before: "LinkReference"
  }],
  parseInline: [
    {name: "RawTeX", parse: parseRawTeX, before: "Escape"},
    {name: "Attribute", parse: parseAttribute, before: "Emphasis"},
    {name: "Citation", parse: parseCitation, before: "Link"}
  ]
}
