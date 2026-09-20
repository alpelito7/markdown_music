// Lezer Markdown extension for Pandoc fenced divs, Quarto's callouts among
// them.
//
//   ::: {.callout-note title="..."}     opening fence: 3+ colons, optional
//   ::: {#refs}                         spaces, then an attribute block in
//   ::: callout-warning                 braces (any attributes; a `}` inside
//   ::: {.callout-tip} :::              a quoted value is fine, the block
//                                       ends at the last brace) or a single
//                                       bare class word (Pandoc's short
//                                       form), then optional colons (Pandoc
//                                       allows them after the attributes).
//   :::                                 closing fence: 3+ colons alone.
//
// Nodes: Callout, a composite block like Blockquote whose inner lines are
// parsed as ordinary Markdown (Paragraph, StrongEmphasis, lists, nested
// Callout, ...), with CalloutMark children for the opening line (attributes
// included) and the closing line. Every fenced div is a Callout node, so
// the editor can put its fences away; calloutKind(line) says which are
// Quarto's callouts: the X of a `callout-X` class, or null for any other
// div (`{.column}`, `{#refs}`, a bare `warning`), which the page prints
// bare (G051), and null for a line that is no opening fence.
//
// An opening fence straight under a paragraph line does not interrupt the
// paragraph: Pandoc's fenced_divs need a blank line before the opener, and
// the line is prose there (G053).
//
// Unterminated: a fence without a later closing line produces no node and
// stays plain text. The check reads the raw lines of the whole input (as
// lines.js does), so the closer is found through container prefixes but not
// bounded by the containing block: `> ::: {.note}` closed by a `:::` after
// the blockquote ends yields a Callout that ends with the quote and has no
// closing mark. A `:::` line inside a fenced code block closes the callout
// (the fence cannot shield it, exactly as a missing `>` ends a code block
// inside a blockquote); Pandoc would keep it as code.

import {tags} from "@lezer/highlight"

const COLON = 58

// Opening fence after the container markup. Group 1 is the brace content
// (greedy, to the last brace on the line), group 2 the bare word.
const OPEN = /^:{3,}[ \t]*(?:\{(.*)\}|([A-Za-z0-9_-]+))[ \t]*:*[ \t]*$/
const CLOSE = /^:{3,}[ \t]*$/
// Raw look-ahead forms: blockquote markers and indentation are skipped.
const RAW_PREFIX = /^[ \t>]*/

export function calloutKind(text) {
  let m = OPEN.exec(text)
  if (!m) return null
  let attrs = m[1] != null ? m[1] : m[2]
  let kind = /(?:^|[\s.])callout-([a-z]+)/.exec(attrs)
  return kind ? kind[1] : null
}

// The openers a closing fence answers, by the position of their line.
// Openers nest, so a closer answers the nearest opener still waiting above
// it, and one that finds none waiting answers nothing: what a look-ahead
// from each opener, counting depth down to 0, finds too.
export function closedOpeners(text) {
  let closed = new Set(), waiting = []
  for (let pos = 0;;) {
    let nl = text.indexOf("\n", pos)
    let line = text.slice(pos, nl < 0 ? text.length : nl)
    let rest = line.slice(RAW_PREFIX.exec(line)[0].length)
    if (rest.charCodeAt(0) == COLON) {
      if (CLOSE.test(rest)) { if (waiting.length) closed.add(waiting.pop()) }
      else if (OPEN.test(rest)) waiting.push(pos)
    }
    if (nl < 0) break
    pos = nl + 1
  }
  return closed
}

// Read off the whole input once per parse, as links.js reads its
// definitions. The look-ahead used to run from every opener to the end of
// the input, so a document of unclosed openers cost the square of its
// length (2.9 s for 5000 of them, measured in Node), which is past the 3 s
// CodeMirror gives a background parse: the tree was never committed and the
// rest of the document stayed raw source (G038).
let current = {input: null, closed: new Set()}

// True when a matching closing fence follows the opener on the current line.
function hasCloser(cx) {
  let input = cx.input
  if (!input) return false
  if (current.input !== input) current = {input, closed: closedOpeners(input.read(0, input.length))}
  return current.closed.has(cx.lineStart)
}

function parseCallout(cx, line) {
  if (line.next != COLON || line.indent - line.baseIndent >= 4) return false
  let text = line.text.slice(line.pos)
  if (!OPEN.test(text) || !hasCloser(cx)) return false
  // value = this block's index in the context stack, so the line handler
  // can tell the innermost Callout from an outer one (see skipCallout).
  cx.startComposite("Callout", line.pos, cx.depth)
  cx.addElement(cx.elt("CalloutMark", cx.lineStart + line.pos, cx.lineStart + line.pos + text.trimEnd().length))
  line.moveBase(line.text.length)
  return null
}

// Per-line continuation of the composite. Every line belongs to the callout
// until its closing fence; that line is consumed here as a marker and the
// handler returns false, which BlockContext takes as "the block ends after
// the markers this handler added" (readLine extends the block end to the
// marker and advance() adds it before closing the context). When a deeper
// Callout is open the fence is its closer, not ours.
function skipCallout(cx, line, value) {
  if (line.next != COLON || !CLOSE.test(line.text.slice(line.pos))) return true
  for (let d = value + 1; d < cx.depth; d++)
    if (cx.parentType(d).name == "Callout") return true
  let to = cx.lineStart + line.pos + line.text.slice(line.pos).trimEnd().length
  line.addMarker(cx.elt("CalloutMark", cx.lineStart + line.pos, to))
  line.moveBase(line.text.length)
  return false
}

export const mdmCallout = {
  defineNodes: [
    {name: "Callout", composite: skipCallout},
    {name: "CalloutMark", style: tags.processingInstruction}
  ],
  parseBlock: [{
    name: "Callout",
    parse: parseCallout,
    // No endLeaf: a `:::` line under a paragraph line is the paragraph's
    // (see the head).
    before: "FencedCode"
  }]
}
