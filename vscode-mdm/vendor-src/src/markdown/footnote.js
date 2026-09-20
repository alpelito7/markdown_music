// Lezer Markdown extension: Pandoc's footnotes (PX01 of the markdown-editor
// branch). `[^label]` in the text is a reference, `^[text]` an inline note,
// and `[^label]: text` at the head of a line, with the lines under it that
// are indented four spaces (and the blank lines between them), the note
// itself. CommonMark has none of these: the reference was a bracketed
// text, the definition a link reference definition with `^label` for its
// label, and the note's second paragraph, indented four, an indented code
// block. The nodes let the editor draw a note as a note and the page's
// reader agree with it.
//
// FootnoteRef(FootnoteMark, FootnoteMark): `[^` and `]` around the label.
// FootnoteInline(FootnoteMark, ...inline, FootnoteMark): `^[` and `]`.
// FootnoteDef(FootnoteMark, Paragraph...): the `[^label]:` and each
// paragraph of the note, inline-parsed.

const OPEN_BRACKET = 91, CLOSE_BRACKET = 93, CARET = 94, BACKSLASH = 92

const DEF = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*/

function parseFootnoteRef(cx, next, pos) {
  if (next != OPEN_BRACKET || cx.char(pos + 1) != CARET) return -1
  let end = pos + 2
  for (;;) {
    let ch = cx.char(end)
    if (ch < 0 || ch == 32 || ch == 9 || ch == 10 || ch == OPEN_BRACKET) return -1
    if (ch == CLOSE_BRACKET) break
    end++
  }
  if (end == pos + 2) return -1
  return cx.addElement(cx.elt("FootnoteRef", pos, end + 1, [
    cx.elt("FootnoteMark", pos, pos + 2),
    cx.elt("FootnoteMark", end, end + 1)
  ]))
}

function parseFootnoteInline(cx, next, pos) {
  if (next != CARET || cx.char(pos + 1) != OPEN_BRACKET) return -1
  let depth = 0, end = -1
  for (let i = pos + 1; i < cx.end; i++) {
    let ch = cx.char(i)
    if (ch == BACKSLASH) { i++; continue }
    if (ch == OPEN_BRACKET) depth++
    else if (ch == CLOSE_BRACKET && --depth == 0) { end = i; break }
  }
  if (end < 0) return -1
  let inner = cx.parser.parseInline(cx.slice(pos + 2, end), pos + 2)
  return cx.addElement(cx.elt("FootnoteInline", pos, end + 1, [
    cx.elt("FootnoteMark", pos, pos + 2),
    ...inner,
    cx.elt("FootnoteMark", end, end + 1)
  ]))
}

// `[^label]:` at the head of a line, at the top level, with the lines under
// it that belong to the note: the next lines while they are not blank
// (lazy continuation), and after a blank line those indented four or more,
// each run of them a paragraph of the note. The definition line's own
// paragraph runs to the first blank line.
function parseFootnoteDef(cx, line) {
  if (line.next != OPEN_BRACKET || cx.depth != 1) return false
  let m = DEF.exec(line.text.slice(line.pos))
  if (!m) return false
  let start = cx.lineStart + line.pos
  let markTo = start + m[0].replace(/[ \t]*$/, "").length
  let paragraphs = [] // [from, to] of each paragraph's text
  let from = start + m[0].length
  let to = cx.lineStart + line.text.length
  let end = to
  let inBlank = false
  for (;;) {
    if (!cx.nextLine()) break
    let text = line.text
    if (!/\S/.test(text)) {
      if (!inBlank) { paragraphs.push([from, to]); inBlank = true }
      continue
    }
    if (inBlank) {
      if (!/^(?: {4}|\t)/.test(text)) break
      from = cx.lineStart + (/^\t/.test(text) ? 1 : 4)
      inBlank = false
    }
    to = cx.lineStart + text.length
    end = to
  }
  if (!inBlank) paragraphs.push([from, to])
  let children = [cx.elt("FootnoteMark", start, markTo)]
  for (let [a, b] of paragraphs) {
    if (b > a) children.push(cx.elt("Paragraph", a, b, cx.parser.parseInline(cx.input.read(a, b), a)))
  }
  cx.addElement(cx.elt("FootnoteDef", start, end, children))
  return true
}

export const mdmFootnotes = {
  defineNodes: [
    {name: "FootnoteRef"},
    {name: "FootnoteInline"},
    {name: "FootnoteMark"},
    {name: "FootnoteDef", block: true}
  ],
  parseBlock: [{
    name: "FootnoteDef",
    parse: parseFootnoteDef,
    before: "LinkReference"
  }],
  parseInline: [
    {name: "FootnoteRef", parse: parseFootnoteRef, before: "Link"},
    // Ahead of Emphasis, which puts it ahead of lang-markdown's Superscript
    // (`^sup^`, added after the core parsers) where that one is on, and
    // names a parser every configuration has.
    {name: "FootnoteInline", parse: parseFootnoteInline, before: "Emphasis"}
  ]
}
