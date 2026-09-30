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
// Citations (PX04): `@key`, `@key [p. 33]`, `[@key, p. 33]`, `[-@key]`,
// `[see @a; @b]`, which Quarto also uses for its cross-references
// (`@fig-x`, `@sec-x`), read as Pandoc's reader reads them (see the
// citations section below). A `@` inside a word or a mail address opens
// none.


const BACKSLASH = 92, OPEN_BRACE = 123, CLOSE_BRACE = 125, OPEN_BRACKET = 91, CLOSE_BRACKET = 93
const AT = 64, NEWLINE = 10, STAR = 42

function isLetter(ch) { return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) }
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

// Read as Pandoc's Markdown reader reads them (Readers/Markdown.hs and
// Parsing/Citations.hs of pandoc 3.8.3, each rule below checked against
// `quarto pandoc` with the export's reader on 2026-09-29; the cases are in
// the tests):
//
// A key is `@` and a letter, a digit, `_` or `*` (the `@*` of nocite), then
// letters, digits and `_`, with `:.#$%&-+?<>~/` kept inside it only before
// a letter, a digit or `_` (`@a--b` is `@a` and text) and `:` or `/` before
// a `/` (`@https://x.org/a`). Letters and digits are any of Unicode's, as
// Haskell's isAlphaNum has them (`@núñez2020`), and a combining mark is
// neither: a decomposed ñ ends the key at its `n`. `@{...}` takes anything
// but a space, its braces balanced. A `-` straight before the `@` is
// suppress-author, and part of the citation.
//
// No key is read straight after what Pandoc reads as a word
// (notAfterString): a letter or a digit, or a `.` that a word has taken
// (`a.@k`, `.@k`; `...` is an ellipsis, and `...@k` a citation). Nor inside
// an email address, which the page links instead: `café@k`, `a-@k`, and
// `*a*@k`, which is the address `a*@k`.
//
// A key takes the bracket after it, past spaces and at most one line end:
// as more citations when the bracket is a citation (`@key [@b]`), and as
// its locator (`@key [p. 33]`, `@key[p. 33]`) unless a `[`, `(` or `{`
// follows the bracket or it is a defined reference. A bracketed citation
// (`[see @a, p. 3; @b]`) may run over lines and hold brackets, links, code
// and maths; each part between two `;` holds a key, or none of it is a
// citation; an emphasis opened in it and not closed there runs on past its
// `]` (Pandoc's emphasis parser stops at no bracket), so there is none; and
// a link's destination, an attribute block or a label straight after the
// `]` make it a link, a span or a reference instead, with an in-text
// citation inside.
//
// The brackets are closed where links are, at the `]` (links.js, LinkEnd),
// once what is inside them has been parsed: a `]` in code, maths or raw TeX
// is not the citation's, a `[` inside pairs with its own `]`, and nothing
// is looked for ahead of the text. The scan to the end of the line from
// every `[` that this replaces cost a line of unclosed brackets the square
// of its length: 3.4 s for 60,000 characters of `[a `, 16 ms now (measured
// 2026-09-29).
//
// Citation(CitationKey...): the key of each citation, `@key` or `@{key}`,
// without the `-`. A citation Pandoc reads inside another's prefix or
// suffix (`[@a and @b]`, `[see [@b] @a]`) is a Citation of its own inside
// it. The prefixes and suffixes are not children: main.js draws a citation
// whole, as written or as the page prints it (CiteWidget), and a link or
// maths node inside one would be drawn and followed by the parts of main.js
// that walk the tree on their own.
//
// Where the editor still reads otherwise (each seen in Pandoc's output on
// 2026-09-29): Pandoc's prefix stops at a `]` and reads a key after it, so
// `[see ]@k]` is one citation to it and `@k` to the editor, which closes
// the bracket at its first `]`; an emphasis, a quote or an HTML span that
// Pandoc reads across a `]` (`[@k, *a] b*]`, `[@k, "a] b"]`) ends the
// citation at a later `]` than the editor's; inside a link's text Pandoc
// links no address, so `[a-@k](u)` holds a citation of `k`, which the
// editor, at its `@`, cannot know the bracket to be; a locator that is a
// heading's text (`@k [Intro]` beside `# Intro`) is a link to the heading
// for Pandoc and a locator here, where no heading is a reference; and a
// destination with a space in it longer than SOURCE_LIMIT is a link to
// Pandoc and none here. `(@good)` is an example list's number to Pandoc
// and three citations to the editor.

const DASH = 45, DOT = 46, SLASH = 47, COLON = 58, SEMICOLON = 59, UNDERSCORE = 95, CARET = 94
const HASH = 35, EQUALS = 61, QUOTE = 34, APOSTROPHE = 39, LESS = 60, GREATER = 62
const OPEN_PAREN = 40, CLOSE_PAREN = 41
const ALNUM = /[\p{L}\p{N}]/u, LETTER = /\p{L}/u
// Haskell's isSpace: the ASCII spaces and controls, and Unicode's space
// separators (a no-break space among them).
const HASKELL_SPACE = /[\t\n\v\f\r\p{Zs}]/u
const KEY_PUNCT = new Set(Array.from(":.#$%&-+?<>~/", c => c.charCodeAt(0)))
const EMAIL_PUNCT = new Set(Array.from("!\"#$%&'*+-/=?^_{|}~;", c => c.charCodeAt(0)))

// The code point at pos, or -1 outside the section.
function codeAt(cx, pos) {
  return pos < cx.offset || pos >= cx.end ? -1 : cx.text.codePointAt(pos - cx.offset)
}

// The code point that ends at pos, or -1 at the start of the section.
function codeBefore(cx, pos) {
  if (pos <= cx.offset || pos > cx.end) return -1
  let low = cx.text.charCodeAt(pos - 1 - cx.offset)
  if (low >= 0xdc00 && low < 0xe000 && pos - 2 >= cx.offset) {
    let high = cx.text.charCodeAt(pos - 2 - cx.offset)
    if (high >= 0xd800 && high < 0xdc00) return (high - 0xd800) * 0x400 + low - 0xdc00 + 0x10000
  }
  return low
}

function width(code) { return code > 0xffff ? 2 : 1 }

// A letter or a digit as Haskell's isAlphaNum reads one.
function isAlnum(code) {
  if (code < 128) return code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122
  return ALNUM.test(String.fromCodePoint(code))
}

function isKeyChar(code) { return code == UNDERSCORE || isAlnum(code) }

// The end of the key whose `@` stands at pos, or -1 (citeKey and
// simpleCiteIdentifier in Parsing/Citations.hs).
function keyEnd(cx, pos) {
  let first = codeAt(cx, pos + 1)
  if (first == OPEN_BRACE) return bracedKeyEnd(cx, pos + 1)
  if (first != STAR && !isKeyChar(first)) return -1
  let end = pos + 1 + width(first)
  for (;;) {
    let code = codeAt(cx, end)
    if (isKeyChar(code)) { end += width(code); continue }
    if (!KEY_PUNCT.has(code)) return end
    let next = codeAt(cx, end + 1)
    if (!isKeyChar(next) && !((code == COLON || code == SLASH) && next == SLASH)) return end
    end++
  }
}

// `{...}`: anything but a space, the braces inside it balanced
// (charsInBalanced), and empty too: `@{}` is a citation with no key.
function bracedKeyEnd(cx, pos) {
  let depth = 0
  for (let i = pos; i < cx.end; i++) {
    let ch = cx.char(i)
    if (ch == OPEN_BRACE) depth++
    else if (ch == CLOSE_BRACE) { if (--depth == 0) return i + 1 }
    else if ((ch <= 32 || ch >= 127) && HASKELL_SPACE.test(String.fromCharCode(ch))) return -1
  }
  return -1
}

function isDelimiter(part) { return typeof part.side == "number" }

function nodeName(cx, elt) { return cx.parser.nodeSet.types[elt.type].name }

function isBlank(code) { return code == 32 || code == 9 || code == NEWLINE || code == 13 }

// The end of the last element that ends past `from` (code, maths, raw TeX,
// an escape...), or `from`. The parts are in document order, and a spent
// opener (null) stands before any run of word characters after it, so the
// look back stops at it.
function elementFloor(cx, from) {
  for (let j = cx.parts.length - 1; j >= 0; j--) {
    let part = cx.parts[j]
    if (!part || part.to <= from) break
    if (!isDelimiter(part)) return part.to
  }
  return from
}

// Where the token that each `@` of the section begins or stands in ends,
// as parseCitation meets them, left to right. Pandoc's reader reads an
// `@` as part of an email address, else as a citation, else as an example
// reference (exampleRef: the `@` and a label, which may be empty), and none
// of the three is a word to notAfterString: `a@k1@b2` is the address `a@k1`
// and a citation of `b2`, and `a.@k1@b2` the text `a.@k1` and a citation.
const atEnds = new WeakMap()

function setAtEnd(cx, at, end) {
  let ends = atEnds.get(cx)
  if (!ends) atEnds.set(cx, ends = new Map())
  ends.set(at, end)
}

// Where the stretch before pos that Pandoc reads as words and marks starts:
// after the last space, element (code, maths, raw TeX, an escape, a
// citation...) or token that an `@` began. The look back stops at the
// nearest `@`, so a word of many costs its length once.
function wordFloor(cx, pos) {
  let p = pos, at = -1
  for (let code; (code = codeBefore(cx, p)) >= 0 && !isBlank(code); p -= width(code))
    if (code == AT) { at = p - 1; break }
  let floor = elementFloor(cx, at < 0 ? p : at)
  if (at >= floor) {
    let ends = atEnds.get(cx), end = ends ? ends.get(at) : null
    floor = Math.max(floor, end == null ? at + 1 : end)
  }
  return floor
}

// The end of the domain of an email address whose `@` is at pos: labels of
// letters, digits and `-` before one of them, joined by single dots.
function domainEnd(cx, pos) {
  let p = pos + 1
  for (;;) {
    let from = p
    for (let code; (code = codeAt(cx, p)) >= 0; p += width(code))
      if (!isAlnum(code) && !(code == DASH && isAlnum(codeAt(cx, p + 1)))) break
    if (p == from) return from - 1
    if (cx.char(p) != DOT) return p
    p++
  }
}

// The end of an example reference at pos: `@`, then letters and digits,
// with a `_` or a `-` between two runs of them.
function exampleRefEnd(cx, pos) {
  let p = pos + 1
  for (let code; (code = codeAt(cx, p)) >= 0;) {
    if (isAlnum(code)) p += width(code)
    else if ((code == UNDERSCORE || code == DASH) && isAlnum(codeAt(cx, p + 1))) p++
    else break
  }
  return p
}

// Whether pos stands straight after what Pandoc reads as a word, where no
// key starts (notAfterString): its `str` takes letters, digits and a `.`
// not followed by another, and is the only reader that sets the position.
// Raw TeX (`\alpha@k`), an escape (`\.@k`), code, maths, a citation and an
// address that ends there are no word, and the rest of a run of dots is an
// ellipsis (`...@k`); an escaped dot is none of it. An address GFM links
// that is no email (`http://x.org@k`) Pandoc reads on over the `@`.
function afterString(cx, pos, floor) {
  let last = cx.parts.length ? cx.parts[cx.parts.length - 1] : null
  if (last && last.to == pos) {
    if (!isDelimiter(last))
      return nodeName(cx, last) == "URL" && cx.slice(last.from, last.to).indexOf("@") < 0 && isAlnum(codeBefore(cx, pos))
    // An emphasis that closes here sets the position too, as a word does
    // (ender in Readers/Markdown.hs): `*$m$*@k` holds no citation.
    if (last.type.resolve == "Emphasis" && closesEmphasis(cx, last)) return true
  }
  if (floor >= pos) return false
  let before = codeBefore(cx, pos)
  return before == DOT ? dotsBefore(cx, pos, floor) % 3 != 0 : isAlnum(before)
}

// The dots straight before pos, down to floor: a run of three is an
// ellipsis, a dot left over a word's.
function dotsBefore(cx, pos, floor) {
  let run = 0
  while (pos - run > floor && cx.char(pos - run - 1) == DOT) run++
  return run
}

// Whether the emphasis run that is the last part closes one to Pandoc's
// reader, which pairs the runs of a mark left to right, innermost first,
// whatever flanks them (enclosure, one, two and three): `*` closes `*`,
// `**` closes `**`, any of the three closes `***`, and a `_` only before no
// letter or digit; a run that closes nothing opens one if it can
// (opensEmphasis). `*a**@k` opens a strong at the `**` and closes nothing.
function closesEmphasis(cx, delim) {
  let open = []
  let closes = part => {
    let size = part.to - part.from, top = open[open.length - 1]
    return open.length > 0 && (size == top || top == 3 && size < 3) &&
      !(cx.char(part.from) == UNDERSCORE && isAlnum(codeAt(cx, part.to)))
  }
  for (let j = 0; j < cx.parts.length - 1; j++) {
    let part = cx.parts[j]
    if (!part || !isDelimiter(part) || part.type != delim.type) continue
    if (closes(part)) open.pop()
    else if (opensEmphasis(cx, part)) open.push(part.to - part.from)
  }
  return closes(delim)
}

// Whether the `@` at pos is inside an email address, which Pandoc's reader
// takes before a citation wherever a word may start (bareURL, emailAddress
// in Parsing/General.hs): words of letters, digits and !"#$%&'*+-/=?^_{|}~;
// that start with a letter or a digit, joined by single dots, then the `@`
// and a domain that starts with a letter, a digit, or a `-` before one. A
// word starts after a space, a mark, an ellipsis or another inline, not
// inside a run of letters, digits and dots, which Pandoc's `str` has taken
// already (`a..b@k` is no address, `...a-@k` is one).
function inEmail(cx, pos, floor) {
  let domain = codeAt(cx, pos + 1)
  if (!isAlnum(domain) && !(domain == DASH && isAlnum(codeAt(cx, pos + 2)))) return false
  for (let i = pos; i > floor;) {
    let code = codeBefore(cx, i), from = i - width(code)
    if (code == DOT) {
      // A dot joins two words: it neither ends the mailbox nor stands
      // before anything but a letter or a digit.
      if (i == pos || !isAlnum(codeAt(cx, i))) return false
    } else if (isAlnum(code)) {
      let prev = from > floor ? codeBefore(cx, from) : -1
      if (!isAlnum(prev) && (prev != DOT || dotsBefore(cx, from, floor) % 3 == 0)) return true
    } else if (!EMAIL_PUNCT.has(code)) {
      return false
    }
    i = from
  }
  return false
}

// A key as the text has it: `@key`, `-@key` or `@{key}`, with the bracket
// after it, if any, joined at its `]` (citationEnd, locatorEnd).
function parseCitation(cx, next, pos) {
  let at = next == DASH ? pos + 1 : pos
  if (cx.char(at) != AT) return -1
  let floor = wordFloor(cx, at)
  if (inEmail(cx, at, floor)) {
    setAtEnd(cx, at, domainEnd(cx, at))
    return -1
  }
  if (next == DASH) {
    // Pandoc's smart dashes take `--` and `---` first: the `-` is the
    // citation's when the run of them before the `@` leaves one over
    // (`----@k` is an em dash and a suppress-author citation). Otherwise
    // the `@` is read on its own, next.
    let run = 1
    while (pos - run >= floor && cx.char(pos - run) == DASH) run++
    if (run % 3 != 1 || afterString(cx, pos, floor)) return -1
  }
  let end = next != DASH && afterString(cx, at, floor) ? -1 : keyEnd(cx, at)
  if (end < 0) {
    if (next != DASH) setAtEnd(cx, at, exampleRefEnd(cx, at))
    return -1
  }
  setAtEnd(cx, at, end)
  return cx.addElement(cx.elt("Citation", pos, end, [cx.elt("CitationKey", at, end)]))
}

// ---------- bracketed citations, closed at the `]` (links.js) ----------

// A citation read at its `@` or `-`, as against one made of a bracket.
function isBare(cx, elt) { return nodeName(cx, elt) == "Citation" && cx.char(elt.from) != OPEN_BRACKET }

// Whether an emphasis delimiter left unmatched inside a bracket opens one
// to Pandoc's reader, which then reads on past the `]` to a closer or to
// the end of the paragraph (enclosure, one, two and three in
// Readers/Markdown.hs): a run of one to three `*` or `_` with no space or
// tab after it (a line end is no stop), the `_` not inside a word.
function opensEmphasis(cx, delim) {
  let ch = cx.char(delim.from), from = delim.from, to = delim.to
  while (from > cx.offset && cx.char(from - 1) == ch) from--
  while (cx.char(to) == ch) to++
  let after = cx.char(to)
  return to - from <= 3 && after >= 0 && after != 32 && after != 9 &&
    !(ch == UNDERSCORE && isAlnum(codeBefore(cx, from)))
}

// The inside of the bracket that cx.parts[i] opens and the `]` at `close`
// ends, as Pandoc's citeList reads it: its elements with the emphasis in
// them resolved, cut at each `;` that stands outside them, and the first
// key of each part. The emphasis is resolved on a copy of the parts, since
// the bracket may yet be text and its delimiters left to what is around it.
// A bracket inside that was left as text is one inline to Pandoc (the
// fallback of a reference link), so a `;` or a key in it is not the outer
// one's. Null when an emphasis opened inside is never closed there.
function readBracket(cx, i, close) {
  let saved = cx.parts, content
  cx.parts = saved.slice(i + 1)
  try {
    content = cx.resolveMarkers(0)
    for (let part of cx.parts)
      if (part && isDelimiter(part) && part.type.resolve == "Emphasis" && opensEmphasis(cx, part)) return null
  } finally {
    cx.parts = saved
  }
  let parts = [{key: null}], at = saved[i].to, depth = 0
  let cut = to => {
    for (; at < to; at++) {
      let ch = cx.char(at)
      if (ch == OPEN_BRACKET) depth++
      else if (ch == CLOSE_BRACKET) depth = Math.max(0, depth - 1)
      else if (ch == SEMICOLON && !depth) parts.push({key: null})
    }
  }
  for (let elt of content) {
    cut(elt.from)
    let last = parts[parts.length - 1]
    if (!last.key && !depth && isBare(cx, elt)) last.key = elt
    at = elt.to
  }
  cut(close)
  return {content, parts}
}

// Whether any key stands directly among the parts after cx.parts[i]: the
// cheap test before a bracket is read, as most brackets hold none.
function holdsKey(cx, i) {
  for (let j = i + 1; j < cx.parts.length; j++) {
    let part = cx.parts[j]
    if (part && !isDelimiter(part) && isBare(cx, part)) return true
  }
  return false
}

// A key that has taken the bracket after it, against what the bracket
// holds when the key is read as a key of a citation around them instead:
// `[see @a [@b]]` is one citation of `a` to Pandoc, with `[@b]` a citation
// of its own in its suffix, where `@a [@b]` alone is one citation of both;
// and a locator is text there, with the keys in it in-text citations.
// Inside a bracket the key is joined to its own before the `]` of the
// bracket around them is reached.
const joined = new WeakMap()

// Every citation among `elts` and inside them, outermost first.
function citationsIn(cx, elts, out) {
  for (let elt of elts) {
    if (nodeName(cx, elt) == "Citation") out.push(elt)
    else citationsIn(cx, elt.children, out)
  }
  return out
}

// What a citation made of a bracket holds, after `out`: each part's key
// (a lone key's CitationKey, with what the bracket of a key that took one
// holds), and every other citation inside, in a prefix, a suffix, an
// emphasis or a link, nested.
function citationChildren(cx, bracket, out) {
  let keys = new Set(bracket.parts.map(part => part.key))
  for (let elt of citationsIn(cx, bracket.content, [])) {
    if (!keys.has(elt)) out.push(elt)
    else if (joined.has(elt)) out.push(elt.children[0], ...joined.get(elt))
    else out.push(...elt.children)
  }
  return out
}

// The index of the lone key before the bracket that cx.parts[i] opens,
// with nothing between them but spaces and at most one line end (spnl, a
// HardBreak when two spaces end the line), or -1. With only spaces between
// them no other part can stand there, so the key is the part before the
// opener or before its HardBreak: looking further back, past every spent
// opener of the paragraph, made `[a] ` repeated cost the square of its
// length.
function keyBefore(cx, i) {
  let j = i - 1, key = j >= 0 ? cx.parts[j] : null
  if (key && !isDelimiter(key) && nodeName(cx, key) == "HardBreak") key = --j >= 0 ? cx.parts[j] : null
  if (!key || isDelimiter(key) || !isBare(cx, key) || key.children.length != 1 || key.children[0].to != key.to) return -1
  return /^[ \t]*(?:\n[ \t]*)?$/.test(cx.slice(key.to, cx.parts[i].from)) ? j : -1
}

// Where each `[` of the section closes, read once per section and only
// when asked for: Pandoc's label (inBalancedBrackets) after a citation's
// `]`, its brackets balanced, and those in an escape, a code span or inline
// maths skipped (`[@k][`a]`` is followed by no label, `[@k][$a]$]` is).
const closers = new WeakMap()

function labelFollows(cx, pos) {
  if (cx.char(pos) != OPEN_BRACKET || cx.char(pos + 1) == CARET) return false
  let map = closers.get(cx)
  if (!map) {
    map = new Map()
    let open = []
    for (let p = cx.offset; p < cx.end; p++) {
      let ch = cx.char(p)
      if (ch == BACKSLASH) p++
      else if (ch == 96 || ch == 36) p = skippedEnd(cx, p, ch) - 1
      else if (ch == OPEN_BRACKET) open.push(p)
      else if (ch == CLOSE_BRACKET && open.length) map.set(open.pop(), p + 1)
    }
    closers.set(cx, map)
  }
  return map.has(pos)
}

// The end of the code span (`ch` a backtick) or inline maths (a dollar)
// that opens at p, or p + the opening run when none closes: a run of
// backticks closes at the next run as long, and maths that does not open
// on a space closes at a `$` after no space and before no digit.
function skippedEnd(cx, p, ch) {
  let run = p
  while (cx.char(run) == ch) run++
  if (ch == 96) {
    for (let q = run; q < cx.end;) {
      if (cx.char(q) != 96) { q++; continue }
      let end = q
      while (cx.char(end) == 96) end++
      if (end - q == run - p) return end
      q = end
    }
  } else if (run - p == 1 && !isBlank(cx.char(run))) {
    for (let q = run + 1; q < cx.end; q++) {
      let c = cx.char(q)
      if (c == BACKSLASH) q++
      else if (c == 36 && !isBlank(cx.char(q - 1)) && !(cx.char(q + 1) >= 48 && cx.char(q + 1) <= 57)) return q + 1
    }
  }
  return run
}

// Labels of undefined full references, `[x][label]`, which Pandoc's reader
// reads again on their own (the fallback of referenceLink): a citation
// there is one whatever follows it (`[x][@b](u)` holds a citation of `b`,
// then the text `(u)`). links.js notes them as it leaves such a reference
// as text.
const isolated = new WeakMap()

export function isolateLabel(cx, pos) {
  let set = isolated.get(cx)
  if (!set) isolated.set(cx, set = new Set())
  set.add(pos)
}

// Spaces and at most one line end (spnl), or -1 where a blank line follows.
function spnl(cx, p) {
  while (cx.char(p) == 32 || cx.char(p) == 9) p++
  if (cx.char(p) == NEWLINE) {
    p++
    while (cx.char(p) == 32 || cx.char(p) == 9) p++
  }
  return cx.char(p) == NEWLINE ? -1 : p
}

// What a look bounded by SOURCE_LIMIT answers when the bound, and not the
// text, ended it.
const UNKNOWN = -2

// The end of a quoted title that opens at p, or -1 (quotedTitle): no space
// straight inside the quote (`[@k](a " t")` is no link to Pandoc, where
// CommonMark takes the title), which closes where no letter or digit
// follows.
function titleEnd(cx, p, limit) {
  let q = cx.char(p)
  if (q != QUOTE && q != APOSTROPHE || HASKELL_SPACE.test(String.fromCharCode(cx.char(p + 1)))) return -1
  for (let i = p + 1; i < limit; i++) {
    let ch = cx.char(i)
    if (ch == BACKSLASH) i++
    else if (ch == q && !isAlnum(codeAt(cx, i + 1))) return i + 1
  }
  return limit < cx.end ? UNKNOWN : -1
}

// A title after spnl, if one stands at p, then spaces and the `)`.
function sourceClose(cx, p, limit) {
  let at = spnl(cx, p), title = at < 0 ? -1 : titleEnd(cx, at, limit)
  if (title == UNKNOWN) return UNKNOWN
  if (title >= 0) p = title
  while (cx.char(p) == 32 || cx.char(p) == 9) p++
  return cx.char(p) == CLOSE_PAREN ? p + 1 : -1
}

// Where a link's destination that starts at pos stops: at the first space
// or line end, or at the first `)` that no `(` after pos opens, an escaped
// parenthesis counting for neither. That is where CommonMark's destination
// ends (parseURL in links.js) and where Pandoc's parentheses close. Read
// for every position of the section at once, right to left, and only when
// first asked for: scanned afresh from each `](`, a paragraph of `[x](`
// with no space in it cost the square of its length (4.3 s for 80,000
// characters, 28 ms now, measured 2026-09-29).
const stopTables = new WeakMap()

export function destinationStop(cx, pos) {
  let table = stopTables.get(cx)
  if (!table) {
    let text = cx.text, n = text.length
    let escaped = new Uint8Array(n + 1)
    for (let i = 0; i < n; i++) if (text.charCodeAt(i) == BACKSLASH && !escaped[i]) escaped[i + 1] = 1
    let space = new Int32Array(n + 1), paren = new Int32Array(n + 1)
    space[n] = paren[n] = n
    for (let i = n - 1; i >= 0; i--) {
      let ch = text.charCodeAt(i)
      space[i] = isBlank(ch) ? i : space[i + 1]
      // A `(` is closed where the parentheses after it first fall short,
      // and from there on its own start stops where that one does.
      paren[i] = escaped[i] ? paren[i + 1] : ch == CLOSE_PAREN ? i
        : ch == OPEN_PAREN ? (paren[i + 1] < n ? paren[paren[i + 1] + 1] : n) : paren[i + 1]
    }
    stopTables.set(cx, table = {space, paren})
  }
  let i = pos - cx.offset
  return {space: table.space[i] + cx.offset, paren: table.paren[i] + cx.offset}
}

const SOURCE_LIMIT = 2000

// Pandoc's destination of a link after a `]` (`source`), or -1: `(`, spaces,
// an address in `<>` or one that may hold spaces and line ends where
// CommonMark's may not (`[@k](my page.html)` is a link to the page), its
// parentheses balanced, then a title in quotes after a space, spaces and
// the `)`. Without a `)` to close it there is none (destinationStop), and
// it is looked for no further than SOURCE_LIMIT characters, so that a
// paragraph of `[@k](` costs its length times that at most, and not its
// square; Pandoc has no bound, so where the bound ends the look the answer
// is UNKNOWN, and CommonMark's destination, which links.js reads with none
// and which is Pandoc's for every address without a space, decides.
function pandocSourceEnd(cx, pos) {
  if (cx.char(pos) != OPEN_PAREN) return -1
  let limit = Math.min(cx.end, pos + SOURCE_LIMIT)
  let start = pos + 1
  while (cx.char(start) == 32 || cx.char(start) == 9) start++
  if (cx.char(start) == LESS) {
    let q = start + 1
    while (q < limit && cx.char(q) != GREATER) q += cx.char(q) == BACKSLASH ? 2 : 1
    if (q < limit) return sourceClose(cx, q + 1, limit)
    if (limit < cx.end) return UNKNOWN
  }
  if (destinationStop(cx, start).paren >= cx.end) return -1
  for (let p = start, depth = 0; p < limit; p++) {
    let ch = cx.char(p)
    if (ch == BACKSLASH) p++
    else if (ch == OPEN_PAREN) depth++
    else if (ch == CLOSE_PAREN) { if (depth-- == 0) return p + 1 }
    else if (depth == 0 && (ch == QUOTE || ch == APOSTROPHE) && p > start) {
      // After spaces the address ends and a title must follow; after a
      // line end it does only if the title reads, and is text if not.
      let prev = cx.char(p - 1)
      if (prev != 32 && prev != 9 && prev != NEWLINE) continue
      let title = titleEnd(cx, p, limit)
      if (title == UNKNOWN) return UNKNOWN
      if (title >= 0) return sourceClose(cx, title, limit)
      let q = p - 1
      while (cx.char(q) == 32 || cx.char(q) == 9) q--
      if (cx.char(q) != NEWLINE) return -1
    }
  }
  return limit < cx.end ? UNKNOWN : -1
}

// Pandoc's attribute block (`attributes`), or -1: `{`, then ids, classes,
// key=value pairs and `-`, each followed by spnl, then `}`. It may be empty
// (`[x]{}` is a span), and a raw format (`{=html}`) is not one.
function pandocAttributesEnd(cx, pos) {
  if (cx.char(pos) != OPEN_BRACE) return -1
  let p = spnl(cx, pos + 1)
  while (p >= 0 && cx.char(p) != CLOSE_BRACE) {
    let end = attributeItemEnd(cx, p)
    p = end < 0 ? -1 : spnl(cx, end)
  }
  return p < 0 ? -1 : p + 1
}

// Letters, digits and `-_:.` from p (identifier after its first letter).
function nameEnd(cx, p) {
  for (let code; (code = codeAt(cx, p)) >= 0; p += width(code))
    if (!isAlnum(code) && code != DASH && code != UNDERSCORE && code != COLON && code != DOT) break
  return p
}

function isLetterCode(code) { return code >= 0 && LETTER.test(String.fromCodePoint(code)) }

// One item of an attribute block (identifierAttr, classAttr, keyValAttr,
// specialAttr), or -1.
function attributeItemEnd(cx, p) {
  let ch = cx.char(p)
  if (ch == HASH) { let end = nameEnd(cx, p + 1); return end > p + 1 ? end : -1 }
  if (ch == DASH) return p + 1
  if (ch == DOT) {
    let first = codeAt(cx, p + 1)
    return isLetterCode(first) ? nameEnd(cx, p + 1 + width(first)) : -1
  }
  let first = codeAt(cx, p)
  if (!isLetterCode(first)) return -1
  let eq = nameEnd(cx, p + width(first))
  if (cx.char(eq) != EQUALS) return -1
  let v = eq + 1, q = cx.char(v)
  if (q == QUOTE || q == APOSTROPHE) {
    // A quoted value holds something and does not open with a space;
    // `""` is an empty one; anything else is read unquoted.
    if (cx.char(v + 1) == q) return v + 2
    if (!HASKELL_SPACE.test(String.fromCharCode(cx.char(v + 1))))
      for (let i = v + 1; i < cx.end; i++) {
        let c = cx.char(i)
        if (c == BACKSLASH) i++
        else if (c == q) return i + 1
      }
  }
  while (v < cx.end) {
    let c = cx.char(v)
    if (c == BACKSLASH) v += 2
    else if (c == 32 || c == 9 || c == NEWLINE || c == 13 || c == CLOSE_BRACE) break
    else v++
  }
  return Math.min(v, cx.end)
}

// The `]` at `close` of the bracket that cx.parts[i] opens (`kind` "Link"
// or "Image", from links.js), as a citation: its end, or -1 to leave the
// bracket to the link reader. `after` is what links.js reads after the
// `]` and `defined` whether that makes the bracket a defined reference.
//
// A bracketed citation is Pandoc's normalCite: every part holds a key, and
// no link's destination, attribute block or label follows the `]`. Right
// after a lone key it joins the key (textualCite). A label read again on
// its own (isolateLabel), and the bracket after a picture's `!` that makes
// no picture, which Pandoc's reader falls back to reading on its own too
// (referenceLink), are citations if they hold one, whatever follows them.
export function citationEnd(cx, i, close, kind, after, defined) {
  if (cx.parser.nodeTypes.Citation == null || !holdsKey(cx, i)) return -1
  let opener = cx.parts[i]
  let image = kind == "Image", labels = isolated.get(cx)
  let alone = image || labels != null && labels.has(opener.from)
  let linked = () => {
    let source = pandocSourceEnd(cx, close + 1)
    return source >= 0 || source == UNKNOWN && after.label === null
  }
  if (image ? defined || linked()
      : !alone && (linked() || pandocAttributesEnd(cx, close + 1) >= 0 || labelFollows(cx, close + 1))) return -1
  let bracket = readBracket(cx, i, close)
  if (!bracket || !bracket.parts.every(part => part.key)) return -1
  let children = citationChildren(cx, bracket, [])
  let j = alone ? -1 : keyBefore(cx, i)
  if (j >= 0) {
    let key = cx.parts[j]
    let citation = cx.elt("Citation", key.from, close + 1, [key.children[0], ...children])
    joined.set(citation, [cx.elt("Citation", opener.from, close + 1, children)])
    cx.parts.length = j
    cx.parts[j] = citation
  } else {
    cx.parts.length = i
    cx.parts[i] = cx.elt("Citation", image ? opener.from + 1 : opener.from, close + 1, children)
  }
  return close + 1
}

// A bracket that is no citation, link or span of its own, after a lone
// key: the key's locator, `@key [p. 33]` (bareloc): not a note's `[^`, no
// `[`, `(` or `{` after its `]`, and each part after its first `;` a
// citation. links.js asks before it leaves the bracket as text; a defined
// reference is a link by then, as Pandoc's reader makes it one (the
// referenceLink fallback of textualCite).
export function locatorEnd(cx, i, close) {
  if (cx.parser.nodeTypes.Citation == null) return -1
  let after = cx.char(close + 1)
  if (cx.char(cx.parts[i].to) == CARET || after == OPEN_BRACKET || after == OPEN_PAREN || after == OPEN_BRACE) return -1
  let j = keyBefore(cx, i)
  if (j < 0) return -1
  let bracket = readBracket(cx, i, close)
  if (!bracket || !bracket.parts.slice(1).every(part => part.key)) return -1
  let key = cx.parts[j]
  let citation = cx.elt("Citation", key.from, close + 1, citationChildren(cx, bracket, [key.children[0]]))
  joined.set(citation, citationsIn(cx, bracket.content, []))
  cx.parts.length = j
  cx.parts[j] = citation
  return close + 1
}

export const mdmPandoc = {
  defineNodes: [
    {name: "RawTeX"},
    {name: "RawTeXBlock", block: true},
    {name: "Attribute"},
    {name: "Citation"},
    {name: "CitationKey"},
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
