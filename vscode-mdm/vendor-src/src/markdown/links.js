// Lezer Markdown extension: links that know the document's definitions.
//
// @lezer/markdown closes every `[...]` into a Link node, defined or not,
// because an inline parser sees one paragraph and cannot know what
// `[label]: url` lines the document holds. CommonMark 6.3 says a shortcut
// (`[text]`), collapsed (`[text][]`) or full (`[text][label]`) reference is
// a link only when its label matches a link reference definition; without
// one the brackets are text, and an undefined `[b]` inside `[a [b] c](url)`
// does not deactivate the outer link (CommonMark 6.3, balanced brackets).
// So `[sic]`, `[Ctrl]`, `[^1]` and `[@key]` used to be blue links with their
// brackets hidden (G002), and `[Sonata [K. 331]](url)` was no link at all
// (G003).
//
// The definitions are read off the whole input once per parse, by a block
// parser that claims nothing and runs at every block start (a paragraph is
// started and finished inside one BlockContext.advance(), so the set read
// at its first line is the one its inline content is parsed with). They
// are read raw, with a pattern rather than Lezer's own LinkReference
// parser: a definition inside a fenced code block, or one indented four
// spaces, counts here and not for the page. That is the price of one pass;
// the reference case is rare enough in a score-and-prose document that
// the difference has not been met. A parse reads the definitions afresh
// (CodeMirror hands the parser a new input on every change), but a
// fragment of the tree reused across an edit is not parsed again, so the
// editor asks for a whole parse when the set of definitions changes
// (main.js, definitionsChanged).
//
// Only LinkEnd is replaced; the `[` and `![` openers stay Lezer's own, so
// that InlineContext.hasOpenLink, which the GFM autolinker reads to stop a
// bare URL at the `]` of the link it is in, keeps working. Lezer's opener
// delimiters are private objects, told apart here by what they are not:
// a delimiter with no resolve and no mark, one character long for a link
// and two for an image.

import {attributeEnd} from "./pandoc.js"

const CLOSE_BRACKET = 93, OPEN_BRACKET = 91, OPEN_PAREN = 40, CLOSE_PAREN = 41, OPEN_BRACE = 123
const BACKSLASH = 92

function space(ch) { return ch == 32 || ch == 9 || ch == 10 || ch == 13 }

// ---------- the definitions of the document ----------

// `[label]:` at the head of a line, after any quote marks and indentation,
// followed by a destination on the line or on the next. The label is what
// CommonMark allows: up to 999 characters, no unescaped brackets.
const DEFINITION = /^[ \t>]*\[((?:[^\[\]\\\n]|\\.){1,999})\]:[ \t]*(?:\S|\n[ \t]*\S)/gm

// A label as CommonMark 4.7 matches it: trimmed, its whitespace collapsed,
// case folded.
export function normalizeLabel(label) {
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase()
}

export function scanDefinitions(text) {
  let defs = new Set()
  DEFINITION.lastIndex = 0
  for (let m; (m = DEFINITION.exec(text));) {
    let key = normalizeLabel(m[1])
    if (key) defs.add(key)
  }
  return defs
}

// The definitions of the input a BlockContext is parsing, read once per
// input. `cx.input` is the @lezer/common Input the parse was started with,
// a plain field of BlockContext (see lines.js).
let current = {input: null, defs: new Set()}

function definitionsFor(cx) {
  let input = cx.input
  if (!input) return current.defs
  if (current.input !== input) {
    current = {input, defs: scanDefinitions(input.read(0, input.length))}
  }
  return current.defs
}

// ---------- the link end ----------

// Lezer's LinkStart and ImageStart, recognised by shape (see the head).
function openerKind(cx, part) {
  if (!part || typeof part.side != "number" || !part.type || part.type.resolve || part.type.mark) return null
  let len = part.to - part.from
  if (len == 1 && cx.slice(part.from, part.to) == "[") return "Link"
  if (len == 2 && cx.slice(part.from, part.to) == "![") return "Image"
  return null
}

// Ports of the private helpers of @lezer/markdown (parseURL, parseLinkTitle,
// parseLinkLabel), returning an element, false when the text is not one, or
// null at the end of the input.
function parseURL(cx, text, start, offset) {
  let next = text.charCodeAt(start)
  if (next == 60 /* < */) {
    for (let pos = start + 1; pos < text.length; pos++) {
      let ch = text.charCodeAt(pos)
      if (ch == 62 /* > */) return cx.elt("URL", start + offset, pos + 1 + offset)
      if (ch == 60 || ch == 10) return false
    }
    return null
  }
  let depth = 0, pos = start
  for (let escaped = false; pos < text.length; pos++) {
    let ch = text.charCodeAt(pos)
    if (space(ch)) break
    else if (escaped) escaped = false
    else if (ch == OPEN_PAREN) depth++
    else if (ch == CLOSE_PAREN) { if (!depth) break; depth-- }
    else if (ch == BACKSLASH) escaped = true
  }
  return pos > start ? cx.elt("URL", start + offset, pos + offset) : pos == text.length ? null : false
}

function parseLinkTitle(cx, text, start, offset) {
  let next = text.charCodeAt(start)
  if (next != 39 && next != 34 && next != 40) return false
  let end = next == 40 ? 41 : next
  for (let pos = start + 1, escaped = false; pos < text.length; pos++) {
    let ch = text.charCodeAt(pos)
    if (escaped) escaped = false
    else if (ch == end) return cx.elt("LinkTitle", start + offset, pos + 1 + offset)
    else if (ch == BACKSLASH) escaped = true
  }
  return null
}

function parseLinkLabel(cx, text, start, offset) {
  for (let escaped = false, pos = start + 1, end = Math.min(text.length, pos + 999); pos < end; pos++) {
    let ch = text.charCodeAt(pos)
    if (escaped) escaped = false
    else if (ch == CLOSE_BRACKET) return cx.elt("LinkLabel", start + offset, pos + 1 + offset)
    else if (ch == OPEN_BRACKET) return false
    else if (ch == BACKSLASH) escaped = true
  }
  return null
}

// What follows the closing bracket at `close` (the position after `]`):
// an inline link's destination and title with their parentheses, a
// reference label, or nothing. `label` is the text a reference is looked
// up by, or null for an inline link.
function tail(cx, contentFrom, close) {
  let {text, offset} = cx
  let next = cx.char(close)
  if (next == OPEN_PAREN) {
    let pos = cx.skipSpace(close + 1)
    let dest = parseURL(cx, text, pos - offset, offset), title
    if (dest) {
      pos = cx.skipSpace(dest.to)
      // The destination and title must be separated by whitespace.
      if (pos != dest.to) {
        title = parseLinkTitle(cx, text, pos - offset, offset)
        if (title) pos = cx.skipSpace(title.to)
      }
    }
    if (cx.char(pos) == CLOSE_PAREN) {
      let elts = [cx.elt("LinkMark", close, close + 1)]
      if (dest) elts.push(dest)
      if (title) elts.push(title)
      elts.push(cx.elt("LinkMark", pos, pos + 1))
      return {to: pos + 1, elts, label: null}
    }
  } else if (next == OPEN_BRACKET) {
    let label = parseLinkLabel(cx, text, close - offset, offset)
    if (label) {
      // `[]` is the collapsed form, looked up by the link's own text.
      let inner = label.to - label.from > 2 ? cx.slice(label.from + 1, label.to - 1) : cx.slice(contentFrom, close - 1)
      return {to: label.to, elts: [label], label: inner}
    }
  }
  // The shortcut form, and what an unfinished tail falls back to.
  return {to: close, elts: [], label: cx.slice(contentFrom, close - 1)}
}

function linkEnd(cx, next, start) {
  if (next != CLOSE_BRACKET) return -1
  // Scanning back to the nearest link or image opener.
  for (let i = cx.parts.length - 1; i >= 0; i--) {
    let part = cx.parts[i]
    let kind = openerKind(cx, part)
    if (!kind) continue
    // An opener set invalid (it would hold a link), or an empty `[]` with
    // no tail: both brackets are text.
    if (!part.side || cx.skipSpace(part.to) == start && !/[(\[]/.test(cx.slice(start + 1, start + 2))) {
      cx.parts[i] = null
      return -1
    }
    // `[text]{.class}`: Pandoc's bracketed span, an attribute block straight
    // after the closing bracket (pandoc.js). Not an image.
    if (kind == "Link" && cx.char(start + 1) == OPEN_BRACE) {
      let attrEnd = attributeEnd(cx, start + 1)
      if (attrEnd > 0) {
        let content = cx.takeContent(i)
        content.unshift(cx.elt("LinkMark", part.from, part.to))
        content.push(cx.elt("LinkMark", start, start + 1))
        content.push(cx.elt("Attribute", start + 1, attrEnd))
        let span = cx.parts[i] = cx.elt("Span", part.from, attrEnd, content)
        return span.to
      }
    }
    let after = tail(cx, part.to, start + 1)
    if (after.label != null && !definitionsFor(cx).has(normalizeLabel(after.label))) {
      // A reference with no definition: the brackets are text, the opener
      // is spent, and an opener outside them stays live (G003).
      cx.parts[i] = null
      return -1
    }
    let content = cx.takeContent(i)
    content.unshift(cx.elt("LinkMark", part.from, part.to))
    content.push(cx.elt("LinkMark", start, start + 1))
    for (let e of after.elts) content.push(e)
    let link = cx.parts[i] = cx.elt(kind, part.from, after.to, content)
    // Links may not contain links: every link opener before this one is
    // spent. An image may hold a link, so an image spends none.
    if (kind == "Link")
      for (let j = 0; j < i; j++) {
        let p = cx.parts[j]
        if (openerKind(cx, p) == "Link") p.side = 0
      }
    return link.to
  }
  return -1
}

// A block parser that claims nothing: it is where the definitions are read
// for the input the context is parsing (see the head).
function readDefinitions(cx) {
  definitionsFor(cx)
  return false
}

export const mdmLinks = {
  parseBlock: [{name: "LinkDefinitions", parse: readDefinitions, before: "LinkReference"}],
  parseInline: [{name: "LinkEnd", parse: linkEnd}]
}
