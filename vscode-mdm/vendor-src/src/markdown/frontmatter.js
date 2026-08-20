// Lezer Markdown extension for the YAML header of an .mdm file.
//
// Only a document that starts, at position 0, with a line that is exactly
// `---` (trailing spaces allowed) and is later closed by a line that is
// exactly `---` or `...` gets a FrontMatter node, with children
// FrontMatterMark (both fence lines) and FrontMatterContent (the YAML,
// which parseMixed hands to the YAML parser so that it highlights and
// behaves as YAML in the editor). An unterminated header produces no node:
// the `---` is then the thematic break it would be for CommonMark. A `---`
// anywhere else is never front matter.

import {parseMixed} from "@lezer/common"
import {tags} from "@lezer/highlight"
import {yamlLanguage} from "@codemirror/lang-yaml"
import {forEachLineAfter} from "./lines.js"

const OPEN = /^---[ \t]*$/
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/

function parseFrontMatter(cx, line) {
  if (cx.lineStart != 0 || cx.depth != 1 || !OPEN.test(line.text)) return false
  // Commit only when the closer exists; nextLine() cannot be undone.
  let found = forEachLineAfter(cx, line, text => CLOSE.test(text) ? true : undefined)
  if (!found) return false
  let openTo = line.text.length
  let contentFrom = -1, contentTo = -1
  for (;;) {
    // The look-ahead guarantees a closer, so this never runs out of lines;
    // the guard only keeps a hypothetical mismatch from spinning.
    if (!cx.nextLine()) return true
    if (CLOSE.test(line.text)) break
    if (contentFrom < 0) contentFrom = cx.lineStart
    contentTo = cx.lineStart + line.text.length
  }
  let closeFrom = cx.lineStart, closeTo = closeFrom + line.text.length
  cx.nextLine()
  let children = [cx.elt("FrontMatterMark", 0, openTo)]
  if (contentFrom > -1) children.push(cx.elt("FrontMatterContent", contentFrom, contentTo))
  children.push(cx.elt("FrontMatterMark", closeFrom, closeTo))
  cx.addElement(cx.elt("FrontMatter", 0, closeTo, children))
  return true
}

export const mdmFrontMatter = {
  defineNodes: [
    {name: "FrontMatter", block: true},
    {name: "FrontMatterMark", style: tags.processingInstruction},
    {name: "FrontMatterContent"}
  ],
  parseBlock: [{
    name: "FrontMatter",
    parse: parseFrontMatter,
    // First in line: a `---` at position 0 must not reach HorizontalRule.
    before: "LinkReference"
  }],
  // Mounted as an overlay (like CodeText in fenced code) so that
  // FrontMatterContent stays a visible node of the Markdown tree while the
  // YAML tree is reachable at its positions (resolveInner, highlighting).
  wrap: parseMixed(node => node.type.name == "FrontMatterContent"
    ? {parser: yamlLanguage.parser, overlay: [{from: node.from, to: node.to}]}
    : null)
}
