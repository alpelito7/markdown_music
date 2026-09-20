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
// stays plain text. The check is a raw look-ahead over the document (see
// lines.js), so the closer is found through container prefixes but not
// bounded by the containing block: `> ::: {.note}` closed by a `:::` after
// the blockquote ends yields a Callout that ends with the quote and has no
// closing mark. A `:::` line inside a fenced code block closes the callout
// (the fence cannot shield it, exactly as a missing `>` ends a code block
// inside a blockquote); Pandoc would keep it as code.

import {tags} from "@lezer/highlight"
import {forEachLineAfter} from "./lines.js"

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
  return kind ? kind[1] : "note"
}

// True when a matching closing fence follows the opener: openers nest, so
// the scan counts depth and stops at the closer that brings it back to 0.
function hasCloser(cx, line) {
  let depth = 1
  return forEachLineAfter(cx, line, text => {
    let rest = text.slice(RAW_PREFIX.exec(text)[0].length)
    if (rest.charCodeAt(0) != COLON) return undefined
    if (CLOSE.test(rest)) return --depth == 0 ? true : undefined
    if (OPEN.test(rest)) depth++
    return undefined
  }) === true
}

function parseCallout(cx, line) {
  if (line.next != COLON || line.indent - line.baseIndent >= 4) return false
  let text = line.text.slice(line.pos)
  if (!OPEN.test(text) || !hasCloser(cx, line)) return false
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
