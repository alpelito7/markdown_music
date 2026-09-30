// Tests for the MDM Lezer Markdown extensions (math, front matter, callouts).
// Run with `npm test` (node --test).

import {test} from "node:test"
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {dirname, resolve} from "node:path"
import {parser} from "@lezer/markdown"
import {markdown, markdownLanguage} from "@codemirror/lang-markdown"
import {TreeFragment} from "@lezer/common"
import {mdmMath, mdmFrontMatter, mdmCallout, mdmLinks, mdmTable, mdmMarkdownExtensions, calloutKind, closedOpeners, LONG_RUN, scanDefinitions, normalizeLabel} from "../src/markdown/index.js"
import {GFM, Superscript} from "@lezer/markdown"

const here = dirname(fileURLToPath(import.meta.url))
const EXAMPLE = resolve(here, "../../../example.mdm")

const mdm = parser.configure(mdmMarkdownExtensions)

// Flat list of "Name@from-to" for the nodes whose name matches `re`.
function nodes(tree, re, text) {
  let out = []
  tree.iterate({enter(n) {
    if (re.test(n.name)) out.push(text == null ? `${n.name}@${n.from}-${n.to}` : `${n.name}[${text.slice(n.from, n.to)}]`)
  }})
  return out
}

function parse(text, p = mdm) { return p.parse(text) }

// Offset of the start of 1-based line `n` in `text`.
function lineStart(text, n) {
  let pos = 0
  for (let i = 1; i < n; i++) pos = text.indexOf("\n", pos) + 1
  return pos
}
function lineEnd(text, n) {
  let end = text.indexOf("\n", lineStart(text, n))
  return end < 0 ? text.length : end
}

// ---------- example.mdm ----------

const example = readFileSync(EXAMPLE, "utf8")

test("example.mdm: front matter spans lines 1-13 with YAML inside", () => {
  const tree = parse(example)
  assert.deepEqual(nodes(tree, /^FrontMatter/), [
    `FrontMatter@0-${lineEnd(example, 13)}`,
    "FrontMatterMark@0-3",
    `FrontMatterContent@${lineStart(example, 2)}-${lineEnd(example, 12)}`,
    `FrontMatterMark@${lineStart(example, 13)}-${lineEnd(example, 13)}`
  ])
  // The two fences by content, not by an absolute offset: example.mdm is a
  // living document and its header is rewritten with it. The literal that
  // used to stand here went stale the day the title line was reworded, and
  // said nothing the ranges above do not already say.
  assert.equal(example.slice(0, lineEnd(example, 1)), "---")
  assert.equal(example.slice(lineStart(example, 13), lineEnd(example, 13)), "---")
  // The YAML overlay is reachable at positions inside the content.
  const key = tree.resolveInner(lineStart(example, 2) + 1, 1)
  assert.equal(key.name, "Literal")
  assert.equal(key.parent.name, "Key")
  let top = key
  while (top.parent) top = top.parent
  assert.equal(top.name, "Document")
  // No YAML node leaks outside the content range.
  assert.equal(tree.resolveInner(lineStart(example, 15) + 1, 1).name, "Paragraph")
})

// Located by content, not by line number: example.mdm is a living document
// and its blank lines move.
test("example.mdm: the display $$ block", () => {
  const tree = parse(example)
  let bmFrom = -1, bmTo = -1, contentFrom = -1, contentTo = -1
  tree.iterate({enter(n) {
    if (n.name == "BlockMath") { bmFrom = n.from; bmTo = n.to }
    else if (n.name == "BlockMathContent") { contentFrom = n.from; contentTo = n.to }
  }})
  assert.ok(bmFrom >= 0, "no BlockMath node")
  assert.equal(example.slice(bmFrom, bmFrom + 2), "$$")
  assert.equal(example.slice(bmTo - 2, bmTo), "$$")
  assert.deepEqual(nodes(tree, /^BlockMath/), [
    `BlockMath@${bmFrom}-${bmTo}`,
    `BlockMathMark@${bmFrom}-${bmFrom + 2}`,
    `BlockMathContent@${contentFrom}-${contentTo}`,
    `BlockMathMark@${bmTo - 2}-${bmTo}`
  ])
  // The content is LaTeX (the stex overlay), never Markdown: its `_` makes no
  // emphasis, and resolving inside it lands in the mounted math tree.
  let emph = 0
  tree.iterate({from: contentFrom, to: contentTo, enter(n) { if (/Emphasis|Strong/.test(n.name)) emph++ }})
  assert.equal(emph, 0)
  const inner = tree.resolveInner(contentFrom + 1, 1)
  assert.notEqual(inner.name, "BlockMathContent", "the LaTeX overlay is not mounted")
  let top = inner; while (top.parent) top = top.parent
  assert.equal(top.name, "Document")
})

test("example.mdm: inline math, including a digit-heavy one", () => {
  const tree = parse(example)
  const inline = nodes(tree, /^InlineMath/, example)
  assert.ok(inline.includes("InlineMath[$L$]"))
  assert.ok(inline.includes("InlineMathContent[L]"))
  assert.ok(inline.includes("InlineMath[$y(0,t) = y(L,t) = 0$]"))
  assert.ok(inline.includes("InlineMath[$31$]"))
  assert.ok(inline.includes("InlineMath[$\\Delta_2 \\approx 702$]"))
  assert.deepEqual(nodes(tree, /^InlineBlockMath$/), [])
  assert.deepEqual(nodes(tree, /^Callout/), [])
  // Fenced blocks are untouched.
  assert.deepEqual(nodes(tree, /^CodeInfo$/, example),
    ["CodeInfo[abc]", "CodeInfo[python]", "CodeInfo[abc]", "CodeInfo[{.abc .play}]"])
})

test("the extensions also configure @codemirror/lang-markdown's parser", () => {
  const p = markdownLanguage.parser.configure(mdmMarkdownExtensions)
  const tree = p.parse(example)
  assert.equal(nodes(tree, /^BlockMath$/).length, 1)
  assert.equal(nodes(tree, /^FrontMatter$/).length, 1)
  assert.ok(nodes(tree, /^InlineMath$/).length > 10)
})

// ---------- inline math ----------

test("inline math: basic, ranges and children", () => {
  const text = "a $x+y$ b"
  assert.deepEqual(nodes(parse(text), /Math/), [
    "InlineMath@2-7", "InlineMathMark@2-3", "InlineMathContent@3-6", "InlineMathMark@6-7"
  ])
})

test("inline math: content is not parsed as Markdown", () => {
  const tree = parse("x $a_b_c$ y and $*z*$")
  // Neither the `_` nor the `*z*` becomes Markdown emphasis: the content is
  // LaTeX, not Markdown.
  assert.deepEqual(nodes(tree, /Emphasis/), [])
  assert.equal(nodes(tree, /^InlineMath$/).length, 2)
  assert.equal(nodes(tree, /^InlineMathContent$/).length, 2)
  // The stex overlay is mounted: resolving inside the content lands in the
  // math tree, not on the InlineMathContent node itself.
  const inner = tree.resolveInner(4, 1)
  assert.notEqual(inner.name, "InlineMathContent")
  let top = inner; while (top.parent) top = top.parent
  assert.equal(top.name, "Document")
})

test("inline math: the LaTeX overlay is mounted over a control sequence", () => {
  // The stex tree is opaque to iterate() but reachable with resolveInner: a
  // position on `\frac` resolves into the mounted math tree, which is what the
  // editor highlights. (The colours themselves are checked in the webview.)
  const tree = parse("see $\\frac{a}{b}$ here")
  const at = "see $\\fr".length // inside \frac
  const inner = tree.resolveInner(at, 1)
  assert.notEqual(inner.name, "InlineMathContent", "no overlay over the command")
  let top = inner; while (top.parent) top = top.parent
  assert.equal(top.name, "Document")
  assert.deepEqual(nodes(tree, /Emphasis/), [])
})

test("inline math: unterminated $ stays text", () => {
  for (const text of ["a $x b", "$", "a$", "$x\n\ny$", "$ x$", "$x $"])
    assert.deepEqual(nodes(parse(text), /Math/), [], JSON.stringify(text))
})

test("inline math: escaped \\$ neither opens nor closes", () => {
  assert.deepEqual(nodes(parse("\\$x$ y"), /Math/), [])
  assert.deepEqual(nodes(parse("$x\\$y$ z", mdm), /Math/, "$x\\$y$ z"),
    ["InlineMath[$x\\$y$]", "InlineMathMark[$]", "InlineMathContent[x\\$y]", "InlineMathMark[$]"])
})

test("inline math: a closing $ followed by a digit does not close", () => {
  assert.deepEqual(nodes(parse("$5 and $6"), /Math/), [])
  assert.deepEqual(nodes(parse("$a$1"), /Math/), [])
  // A digit inside or a space after the closer is fine.
  assert.deepEqual(nodes(parse("$31$ cents"), /^InlineMath$/), ["InlineMath@0-4"])
})

test("inline math: the first candidate closer decides (Pandoc)", () => {
  // `$a $` fails on the space, and no later `$` is considered.
  assert.deepEqual(nodes(parse("$a $ b$"), /Math/), [])
  // `$$x$` is single-dollar math with content `$x`, as in Pandoc.
  assert.deepEqual(nodes(parse("$$x$"), /Content/, "$$x$"), ["InlineMathContent[$x]"])
})

test("inline math: may span a soft line break inside the paragraph", () => {
  const text = "a $b\nc$ d"
  assert.deepEqual(nodes(parse(text), /^InlineMath$/), ["InlineMath@2-7"])
})

test("inline math: $$ inside a paragraph line is InlineBlockMath", () => {
  const text = "a $$ x+y $$ b"
  assert.deepEqual(nodes(parse(text), /Math/), [
    "InlineBlockMath@2-11", "InlineBlockMathMark@2-4", "InlineBlockMathContent@4-9", "InlineBlockMathMark@9-11"
  ])
  // Two on one line, and one spanning lines after text.
  assert.equal(nodes(parse("$$a$$ and $$b$$"), /^InlineBlockMath$/).length, 2)
  assert.deepEqual(nodes(parse("so $$\nE\n$$ holds"), /^InlineBlockMath$/), ["InlineBlockMath@3-10"])
  // Unterminated `$$` is text.
  assert.deepEqual(nodes(parse("a $$ x b"), /Math/), [])
})

test("inline math inside a blockquote carries the quote mark inside", () => {
  const text = "> $a\n> b$"
  assert.deepEqual(nodes(parse(text), /Math|QuoteMark/), [
    "QuoteMark@0-1", "InlineMath@2-9", "InlineMathMark@2-3", "InlineMathContent@3-8", "QuoteMark@5-6", "InlineMathMark@8-9"
  ])
})

// ---------- block math ----------

test("block math: fence lines, ranges and children", () => {
  const text = "$$\nx = 1\n$$\n"
  assert.deepEqual(nodes(parse(text), /Math/), [
    "BlockMath@0-11", "BlockMathMark@0-2", "BlockMathContent@3-8", "BlockMathMark@9-11"
  ])
  assert.equal(parse(text).toString(), "Document(BlockMath(BlockMathMark,BlockMathContent,BlockMathMark))")
})

test("block math: one-line `$$ x $$` and content on the fence lines", () => {
  assert.deepEqual(nodes(parse("$$ x $$"), /Math/), [
    "BlockMath@0-7", "BlockMathMark@0-2", "BlockMathContent@2-5", "BlockMathMark@5-7"
  ])
  assert.deepEqual(nodes(parse("$$ a\nb $$  "), /Math/), [
    "BlockMath@0-9", "BlockMathMark@0-2", "BlockMathContent@2-7", "BlockMathMark@7-9"
  ])
})

test("block math: unterminated $$ falls back to a paragraph, no node", () => {
  for (const text of ["$$\nx\n", "$$\nx\n\ny $$ z", "$$ x"]) {
    const tree = parse(text)
    assert.deepEqual(nodes(tree, /^BlockMath/), [], JSON.stringify(text))
    assert.equal(tree.topNode.firstChild.name, "Paragraph", JSON.stringify(text))
  }
  assert.deepEqual(nodes(parse("$$\nx\n"), /Math/), [])
  // The fallback paragraph has the same extent the default parser gives
  // (up to the blank line) and its inline content is still parsed.
  const tree = parse("$$\nx *em*\n\nafter")
  assert.deepEqual(nodes(tree, /Paragraph|Emphasis/), ["Paragraph@0-9", "Emphasis@5-9", "EmphasisMark@5-6", "EmphasisMark@8-9", "Paragraph@11-16"])
})

test("block math: a closer with text after it closes the block there, the text a paragraph of its own (G052)", () => {
  // A Quarto label after the closer, and the next block straight under it:
  // two blocks, the label between them. The closing line used to break the
  // block and be read again as an opener, which took the next block's `$$`.
  const a = "$$\nE = mc^2\n$$ {#eq-mass}\n$$\nF = ma\n$$\n"
  assert.deepEqual(nodes(parse(a), /^(BlockMath|BlockMathContent|Paragraph)$/, a), [
    "BlockMath[$$\nE = mc^2\n$$]", "BlockMathContent[E = mc^2]", "Paragraph[{#eq-mass}]",
    "BlockMath[$$\nF = ma\n$$]", "BlockMathContent[F = ma]"
  ])
  // Prose after the closer, inline-parsed.
  const b = "$$\na^2\n$$ where *c* is.\n"
  assert.deepEqual(nodes(parse(b), /^(BlockMath|Paragraph|Emphasis)$/, b), [
    "BlockMath[$$\na^2\n$$]", "Paragraph[where *c* is.]", "Emphasis[*c*]"
  ])
  // In a quote, and a closer with spaces only after it is a plain closer.
  assert.equal(parse("> $$\n> x\n> $$ tail\n").toString(),
    "Document(Blockquote(QuoteMark,BlockMath(BlockMathMark,QuoteMark,BlockMathContent,QuoteMark,BlockMathMark),Paragraph))")
  assert.equal(parse("$$\nx\n$$   \n").toString(), "Document(BlockMath(BlockMathMark,BlockMathContent,BlockMathMark))")
})

test("block math: a mid-line $$ on the opening line is not a block", () => {
  const text = "$$a$$ and $$b$$\n"
  assert.deepEqual(nodes(parse(text), /^BlockMath$/), [])
  assert.equal(nodes(parse(text), /^InlineBlockMath$/).length, 2)
})

test("block math: content is not parsed as Markdown", () => {
  const tree = parse("$$\n- a_b\n# c\n$$\n")
  // The `- `, the `#` and the `_` are LaTeX, not a list, a heading or emphasis.
  assert.deepEqual(nodes(tree, /List|Heading|Emphasis/), [])
  assert.deepEqual(nodes(tree, /^BlockMathContent$/), ["BlockMathContent@3-12"])
  // The stex overlay is mounted inside the content, not a Markdown parse.
  const inner = tree.resolveInner(5, 1)
  assert.notEqual(inner.name, "BlockMathContent")
  let top = inner; while (top.parent) top = top.parent
  assert.equal(top.name, "Document")
})

test("block math: $$ after a paragraph line starts the block", () => {
  const text = "text\n$$\ny\n$$\nafter"
  assert.equal(parse(text).toString(),
    "Document(Paragraph,BlockMath(BlockMathMark,BlockMathContent,BlockMathMark),Paragraph)")
  // With a blank line in between too, of course.
  assert.equal(parse("text\n\n$$\ny\n$$\n\nafter").toString(),
    "Document(Paragraph,BlockMath(BlockMathMark,BlockMathContent,BlockMathMark),Paragraph)")
  // But a `$$` line that closes an inline display math stays in the paragraph.
  assert.equal(parse("so $$\nE\n$$\nafter").toString(),
    "Document(Paragraph(InlineBlockMath(InlineBlockMathMark,InlineBlockMathContent,InlineBlockMathMark)))")
})

test("block math: inside a blockquote and a list item", () => {
  const quote = "> $$\n> x+y\n> z\n> $$\n"
  assert.equal(parse(quote).toString(),
    "Document(Blockquote(QuoteMark,BlockMath(BlockMathMark,QuoteMark,BlockMathContent(QuoteMark),QuoteMark,BlockMathMark)))")
  assert.deepEqual(nodes(parse(quote), /^BlockMath/), [
    "BlockMath@2-19", "BlockMathMark@2-4", "BlockMathContent@7-14", "BlockMathMark@17-19"
  ])
  assert.equal(parse("- item\n  $$\n  x\n  $$\n").toString(),
    "Document(BulletList(ListItem(ListMark,Paragraph,BlockMath(BlockMathMark,BlockMathContent,BlockMathMark))))")
  // Unterminated inside a blockquote: the quote ends it, paragraph fallback.
  assert.equal(parse("> $$\n> x\n\nafter").toString(), "Document(Blockquote(QuoteMark,Paragraph(QuoteMark)),Paragraph)")
})

// ---------- front matter ----------

test("front matter: closed by --- or ..., with trailing spaces", () => {
  for (const close of ["---", "...", "---  "]) {
    const text = `--- \ntitle: x\n${close}\n\nbody`
    const tree = parse(text)
    assert.deepEqual(nodes(tree, /^FrontMatter/), [
      `FrontMatter@0-${14 + close.length}`, "FrontMatterMark@0-4", "FrontMatterContent@5-13", `FrontMatterMark@14-${14 + close.length}`
    ], close)
    assert.equal(tree.resolveInner(6, 1).parent.name, "Key", close)
  }
  // Empty header.
  assert.deepEqual(nodes(parse("---\n---\nx"), /^FrontMatter/), ["FrontMatter@0-7", "FrontMatterMark@0-3", "FrontMatterMark@4-7"])
})

test("front matter: unterminated or not at position 0 gives no node", () => {
  assert.deepEqual(nodes(parse("---\ntitle: x\n\nbody"), /FrontMatter/), [])
  // A `---` over a blank line is a rule, whatever closes later (Pandoc's
  // reading, G040): the paragraph and the second rule stay in the body.
  assert.deepEqual(nodes(parse("---\n\nFirst para.\n\n---\n\nAfter.\n"), /FrontMatter/), [])
  assert.equal(parse("---\n\nFirst para.\n\n---\n\nAfter.\n").toString(), "Document(HorizontalRule,Paragraph,HorizontalRule,Paragraph)")
  assert.equal(parse("---\ntitle: x\n\nbody").topNode.firstChild.name, "HorizontalRule")
  assert.deepEqual(nodes(parse("\n---\ntitle: x\n---\n"), /FrontMatter/), [])
  assert.deepEqual(nodes(parse("a\n---\nb\n---\n"), /FrontMatter/), [])
  assert.deepEqual(nodes(parse("text\n\n---\ntitle: x\n---\n"), /FrontMatter/), [])
  assert.deepEqual(nodes(parse("----\nx\n---\n"), /FrontMatter/), [])
  assert.deepEqual(nodes(parse("--- a\nx\n---\n"), /FrontMatter/), [])
})

// ---------- callouts ----------

test("callout: composite block with marks, inner Markdown parsed", () => {
  const text = "::: {.callout-note}\nsome **bold** text\n:::\nafter"
  const tree = parse(text)
  assert.equal(tree.toString(),
    "Document(Callout(CalloutMark,Paragraph(StrongEmphasis(EmphasisMark,EmphasisMark)),CalloutMark),Paragraph)")
  assert.deepEqual(nodes(tree, /^Callout/), ["Callout@0-42", "CalloutMark@0-19", "CalloutMark@39-42"])
  assert.equal(tree.resolveInner(28, 1).name, "StrongEmphasis")
  assert.equal(tree.resolveInner(28, 1).parent.parent.name, "Callout")
})

test("callout: opening forms accepted and trailing spaces trimmed from marks", () => {
  for (const open of ["::: {.callout-warning title=\"T\"}", ":::{.callout-tip}", "::::: {#refs}", "::: warning", "::: callout-tip  ",
                      // Pandoc's colons after the attributes, and a brace inside a quoted value (G053).
                      "::: {.callout-tip} :::", "::: {.callout-important title=\"Braces {inside}\"}", "::: callout-note ::: "]) {
    const text = `${open}\n\nbody\n\n::::  \n`
    const tree = parse(text)
    assert.deepEqual(nodes(tree, /^Callout/, text),
      ["Callout[" + text.trimEnd() + "]", "CalloutMark[" + open.trimEnd() + "]", "CalloutMark[::::]"], open)
  }
})

test("callout: not an opener", () => {
  for (const text of [":::\nx\n:::", "::: {.x\nx\n:::", "::: two words\nx\n:::", ":: {.note}\nx\n:::", "    ::: {.note}\nx\n:::"])
    assert.deepEqual(nodes(parse(text), /Callout/), [], JSON.stringify(text))
})

test("callout: unterminated gives no node, text stays plain", () => {
  const tree = parse("::: {.callout-note}\nno closer\n\ntext")
  assert.equal(tree.toString(), "Document(Paragraph,Paragraph)")
  // A closer that belongs to a nested opener does not count for the outer
  // one, whose line is then prose; the inner opener straight under that
  // prose line is prose too (G053), and a callout once a blank line parts
  // them.
  assert.equal(parse("::: {.note}\n::: {.tip}\ntext\n:::\n").toString(), "Document(Paragraph)")
  assert.equal(parse("::: {.note}\n\n::: {.tip}\ntext\n:::\n").toString(),
    "Document(Paragraph,Callout(CalloutMark,Paragraph,CalloutMark))")
})

test("callout: the closers are looked for once per parse, not once per opener (G038)", () => {
  // The extensions read ahead through `input.read`, which the parser itself
  // does not use, so what they read is what a look-ahead costs. 3000 unclosed
  // openers used to read the rest of the input 3000 times.
  const text = "::: {.callout-note}\n\ntext\n\n".repeat(3000)
  let read = 0
  const input = {
    length: text.length,
    lineChunks: false,
    chunk(from) { return text.slice(from, from + 4096) },
    read(from, to) { read += to - from; return text.slice(from, to) },
  }
  const tree = mdm.parse(input)
  assert.equal(nodes(tree, /^Callout$/).length, 0)
  assert.ok(read <= 4 * text.length, `read ${read} characters of a ${text.length}-character input`)
  // And the same answers as the depth-counting look-ahead gave: a closer
  // goes to the nearest opener waiting, an outer one may stay open.
  assert.deepEqual([...closedOpeners("::: {.a}\n::: {.b}\nx\n:::\n")], [9])
  assert.deepEqual([...closedOpeners("::: {.a}\n\n::: {.b}\nx\n:::\n\n:::\n")].sort((a, b) => a - b), [0, 10])
  assert.deepEqual([...closedOpeners(":::\n::: {.a}\n")], [])
  assert.deepEqual([...closedOpeners("> ::: {.a}\n> x\n> :::\n")], [0])
})

test("raw TeX: the end of an environment is looked for once per parse, not once per opener (G038)", () => {
  const text = "\\begin{foo}\n\ntext\n\n".repeat(3000)
  let read = 0
  const input = {
    length: text.length,
    lineChunks: false,
    chunk(from) { return text.slice(from, from + 4096) },
    read(from, to) { read += to - from; return text.slice(from, to) },
  }
  const tree = mdm.parse(input)
  assert.equal(nodes(tree, /^RawTeXBlock$/).length, 0)
  assert.ok(read <= 4 * text.length, `read ${read} characters of a ${text.length}-character input`)
  // The closer has to stand past the opener, and be of its name.
  const closed = "\\begin{a}\nx\n\\end{a}\n\n\\begin{a}\ny\n"
  assert.deepEqual(nodes(parse(closed), /^RawTeXBlock$/), ["RawTeXBlock@0-19"])
  // The second opener has an `\\end{a}` above it and none below: it stays the
  // paragraph it reads as, where a block would swallow the lines to the end.
  assert.equal(parse(closed).toString(), "Document(RawTeXBlock,Paragraph(RawTeX))")
  // Two of a name, each with its own end: it is the last end that is kept.
  assert.equal(parse("\\begin{a}\nx\n\\end{a}\n\n\\begin{a}\ny\n\\end{a}\n").toString(), "Document(RawTeXBlock,RawTeXBlock)")
  assert.deepEqual(nodes(parse("\\begin{a}\nx\n\\end{b}\n"), /^RawTeXBlock$/), [])
})

test("callout: nested callouts and blank lines inside", () => {
  const text = "::: {.callout-tip}\nouter\n\n::: {.callout-warning}\ninner\n:::\n\nback\n:::\n"
  const tree = parse(text)
  assert.equal(tree.toString(),
    "Document(Callout(CalloutMark,Paragraph,Callout(CalloutMark,Paragraph,CalloutMark),Paragraph,CalloutMark))")
  assert.deepEqual(nodes(tree, /^Callout$/), ["Callout@0-68", "Callout@26-58"])
})

test("callout: inside a blockquote and a list item, lists inside", () => {
  assert.equal(parse("> ::: {.note}\n> quoted\n> :::\n").toString(),
    "Document(Blockquote(QuoteMark,Callout(CalloutMark,QuoteMark,Paragraph,QuoteMark,CalloutMark)))")
  // After a blank line, as Pandoc asks (G053): straight under the item's
  // text the opener would be the paragraph's.
  assert.equal(parse("- item\n\n  ::: {.note}\n  in list\n  :::\n- next").toString(),
    "Document(BulletList(ListItem(ListMark,Paragraph,Callout(CalloutMark,Paragraph,CalloutMark)),ListItem(ListMark,Paragraph)))")
  assert.equal(parse("::: {.note}\n\n- a\n- b\n\n:::\n").toString(),
    "Document(Callout(CalloutMark,BulletList(ListItem(ListMark,Paragraph),ListItem(ListMark,Paragraph)),CalloutMark))")
  // Math blocks live inside callouts.
  assert.equal(parse("::: {.note}\n$$\nx\n$$\n:::").toString(),
    "Document(Callout(CalloutMark,BlockMath(BlockMathMark,BlockMathContent,BlockMathMark),CalloutMark))")
})

test("callout: an opener straight under a paragraph line is the paragraph's (Pandoc needs a blank line, G053)", () => {
  assert.equal(parse("A paragraph line\n::: {.callout-note}\nUnder a paragraph.\n:::\n").toString(), "Document(Paragraph)")
  // The `$$` still interrupts, and the `:::` after it is prose, no callout having opened.
  assert.equal(parse("text\n::: {.note}\n$$\nx\n$$\n:::").toString(),
    "Document(Paragraph,BlockMath(BlockMathMark,BlockMathContent,BlockMathMark),Paragraph)")
  // With the blank line, the callout.
  assert.equal(parse("A paragraph line\n\n::: {.callout-note}\nWith blank.\n:::\n").toString(),
    "Document(Paragraph,Callout(CalloutMark,Paragraph,CalloutMark))")
})

test("calloutKind", () => {
  assert.equal(calloutKind("::: {.callout-note}"), "note")
  assert.equal(calloutKind("::: {.callout-warning title=\"x\"}"), "warning")
  assert.equal(calloutKind(":::{.callout-tip}"), "tip")
  assert.equal(calloutKind("::::: {.callout-important icon=false}  "), "important")
  assert.equal(calloutKind("::: {.callout-caution}"), "caution")
  assert.equal(calloutKind("::: callout-caution"), "caution")
  assert.equal(calloutKind("::: {.callout-tip} :::"), "tip")
  assert.equal(calloutKind("::: {.callout-important title=\"Braces {inside}\"}"), "important")
  // Any other fenced div is a div and no callout: the page prints it bare (G051).
  assert.equal(calloutKind("::: {#refs}"), null)
  assert.equal(calloutKind("::: {.mycallout-tip}"), null)
  assert.equal(calloutKind("::: warning"), null)
  assert.equal(calloutKind("::: {.column width=\"50%\"}"), null)
  assert.equal(calloutKind(":::"), null)
  assert.equal(calloutKind("::: {.x"), null)
  assert.equal(calloutKind("text"), null)
})

// ---------- incremental parsing ----------

test("incremental reparse after an edit keeps the same tree", () => {
  const before = example
  const at = lineStart(before, 27)
  const after = before.slice(0, at) + "New text.\n\n" + before.slice(at)
  const tree = parse(before)
  const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [{fromA: at, toA: at, fromB: at, toB: at + 11}])
  const incremental = mdm.parse(after, fragments)
  const fresh = mdm.parse(after)
  assert.equal(incremental.toString(), fresh.toString())
  assert.deepEqual(nodes(incremental, /^(BlockMath|FrontMatter|InlineMath)$/), nodes(fresh, /^(BlockMath|FrontMatter|InlineMath)$/))
})

test("each extension works on its own", () => {
  assert.equal(parser.configure([mdmMath]).parse("$x$").toString(), "Document(Paragraph(InlineMath(InlineMathMark,InlineMathContent,InlineMathMark)))")
  assert.equal(parser.configure([mdmFrontMatter]).parse("---\na: 1\n---\n").toString(), "Document(FrontMatter(FrontMatterMark,FrontMatterContent,FrontMatterMark))")
  assert.equal(parser.configure([mdmCallout]).parse("::: {.note}\nx\n:::").toString(), "Document(Callout(CalloutMark,Paragraph,CalloutMark))")
})

// ---------- long delimiter runs ----------

test("a run of emphasis delimiters at the long-run length or more is text", () => {
  for (const ch of ["*", "_"]) {
    const text = ch.repeat(LONG_RUN) + "foo" + ch.repeat(LONG_RUN) + "\n"
    assert.deepEqual(nodes(parse(text), /Emphasis/), [], ch + " run of " + LONG_RUN)
    assert.deepEqual(nodes(parse(text), /^Paragraph$/), ["Paragraph@0-" + (text.length - 1)])
  }
})

test("a run one short of the long-run length still nests as CommonMark reads it", () => {
  const text = "*".repeat(LONG_RUN - 1) + "foo" + "*".repeat(LONG_RUN - 1) + "\n"
  assert.ok(nodes(parse(text), /^(Emphasis|StrongEmphasis)$/).length > 0)
  assert.deepEqual(nodes(parse("**foo**\n"), /^StrongEmphasis$/), ["StrongEmphasis@0-7"])
  assert.deepEqual(nodes(parse("snake_case_name\n"), /Emphasis/), [])
})

test("a paragraph of 12,000 asterisks a side parses, and quickly", () => {
  const text = "*".repeat(12000) + "a" + "*".repeat(12000) + "\n"
  const t0 = Date.now()
  const tree = parse(text)
  assert.equal(tree.length, text.length)
  assert.deepEqual(nodes(tree, /Emphasis/), [])
  assert.ok(Date.now() - t0 < 2000, "took " + (Date.now() - t0) + " ms")
})

// ---------- links that know the definitions ----------

const gfm = parser.configure([GFM, ...mdmMarkdownExtensions])

// The links and images of a parse, each with its label and destination
// nodes, as "Name[text]".
function links(text, p = gfm) {
  return nodes(parse(text, p), /^(Link|Image|LinkLabel|URL)$/, text)
}

test("links: bracketed text with no definition is text, with one it is a link (CM 6.3, G002)", () => {
  assert.deepEqual(links("He wrote [sic] and press [Ctrl] then [x].\n"), [])
  assert.deepEqual(links("A [real] link, [nope][missing], [Real][] and [full][real].\n\n[real]: http://example.com\n"), [
    "Link[[real]]",
    "Link[[Real][]]", "LinkLabel[[]]",
    "Link[[full][real]]", "LinkLabel[[real]]",
    "LinkLabel[[real]]", "URL[http://example.com]"
  ])
  // An inline link needs no definition, an empty destination included.
  assert.deepEqual(links("[inline](http://a.b) and [empty]()\n"), [
    "Link[[inline](http://a.b)]", "URL[http://a.b]", "Link[[empty]()]"
  ])
})

test("links: balanced brackets inside a link's text stay inside it (CM 6.3, G003)", () => {
  assert.deepEqual(links("One [a [b] c](https://example.com) end.\n"), [
    "Link[[a [b] c](https://example.com)]", "URL[https://example.com]"
  ])
  assert.deepEqual(links("Three [Sonata [K. 331]](https://en.wikipedia.org/wiki/X_(Y)) end.\n"), [
    "Link[[Sonata [K. 331]](https://en.wikipedia.org/wiki/X_(Y))]", "URL[https://en.wikipedia.org/wiki/X_(Y)]"
  ])
  // A defined inner reference is the link, and spends the outer opener:
  // links may not contain links.
  assert.deepEqual(links("[a [real] b](url)\n\n[real]: /r\n"), ["Link[[real]]", "LinkLabel[[real]]", "URL[/r]"])
})

test("links: an image by reference needs its definition too, and may hold a link", () => {
  assert.deepEqual(links("![pic][img] and ![lone] here\n\n[img]: <a.png>\n"), [
    "Image[![pic][img]]", "LinkLabel[[img]]", "LinkLabel[[img]]", "URL[<a.png>]"
  ])
  assert.deepEqual(links("![a [t](u) b](p.png)\n"), ["Image[![a [t](u) b](p.png)]", "Link[[t](u)]", "URL[u]", "URL[p.png]"])
})

test("links: a label matches its definition case-folded and with its whitespace collapsed (CM 4.7)", () => {
  assert.deepEqual(links("[Foo  Bar] and [foo\nbar]\n\n[FOO BAR]: /x\n"), [
    "Link[[Foo  Bar]]", "Link[[foo\nbar]]", "LinkLabel[[FOO BAR]]", "URL[/x]"
  ])
  assert.equal(normalizeLabel("  Foo \t Bar\n"), "foo bar")
  // Read raw off the input: a definition after its use, inside a quote,
  // with the destination on the next line; not a label with no destination.
  assert.deepEqual([...scanDefinitions("[a]\n\n> [B]: /b\n[c]:\n  /c\n[d]:\n\n[e]: \n")], ["b", "c"])
})

test("links: the GFM autolinker still stops at the bracket of the link it is in", () => {
  // hasOpenLink reads Lezer's own openers, which links.js leaves in place.
  assert.deepEqual(links("[https://a.example](https://b.example)\n"), [
    "Link[[https://a.example](https://b.example)]", "URL[https://a.example]", "URL[https://b.example]"
  ])
})

test("emoji: `:tada:` is text, as the page prints it", () => {
  const withEmoji = markdownLanguage.parser
  assert.deepEqual(nodes(parse("a :tada: b\n", withEmoji), /^Emoji$/), ["Emoji@2-8"])
  assert.deepEqual(nodes(parse("a :tada: b\n", withEmoji.configure(mdmMarkdownExtensions)), /^Emoji$/), [])
})

test("links: the extension works on its own", () => {
  assert.deepEqual(links("[sic] and [real]\n\n[real]: /r\n", parser.configure(mdmLinks)), ["Link[[real]]", "LinkLabel[[real]]", "URL[/r]"])
})

// ---------- the ATX heading written with a tab ----------

test("atx heading: a tab after the marks is a heading (CM 4.2, G042)", () => {
  const text = "#\tTab heading\n\n##\tSecond ##\n\n#\t\n\n####### too many\n"
  assert.deepEqual(nodes(parse(text), /^(ATXHeading[1-6]|HeaderMark)$/, text), [
    "ATXHeading1[#\tTab heading]", "HeaderMark[#]",
    "ATXHeading2[##\tSecond ##]", "HeaderMark[##]", "HeaderMark[##]",
    "ATXHeading1[#\t]", "HeaderMark[#]"
  ])
  // The content starts past the tab, as Lezer's starts past the space.
  const tree = parse(text)
  assert.equal(tree.resolveInner(2, 1).name, "ATXHeading1")
  // It interrupts a paragraph, as any ATX heading does; indented four it is code.
  assert.equal(parse("text\n#\tH\n").toString(), "Document(Paragraph,ATXHeading1(HeaderMark))")
  assert.equal(parse("    #\tH\n").toString(), "Document(CodeBlock(CodeText))")
  // Lezer's own heading is untouched.
  assert.equal(parse("# Space\n").toString(), "Document(ATXHeading1(HeaderMark))")
})

// ---------- pipe tables whose cells hold code and maths ----------

// The cells of every row of a parse, as "TableCell[text]" with the inline
// nodes the bench cares about.
function cells(text, p = gfm) {
  return nodes(parse(text, p), /^(TableHeader|TableRow|TableCell|InlineMath|InlineCode)$/, text)
}

test("table: a pipe inside inline maths or a code span is the cell's, as Pandoc reads it (G011)", () => {
  const a = "| name | formula |\n|------|---------|\n| magnitude | $|x|$ |\n"
  assert.deepEqual(cells(a), [
    "TableHeader[| name | formula |]", "TableCell[name]", "TableCell[formula]",
    "TableRow[| magnitude | $|x|$ |]", "TableCell[magnitude]", "TableCell[$|x|$]", "InlineMath[$|x|$]"
  ])
  const b = "| e | m |\n|---|---|\n| `a \\| b` | c |\n| `x || y` | d |\n| $$a|b$$ | e |\n"
  assert.deepEqual(cells(b).filter(c => /^TableCell/.test(c)), [
    "TableCell[e]", "TableCell[m]",
    "TableCell[`a \\| b`]", "TableCell[c]",
    "TableCell[`x || y`]", "TableCell[d]",
    "TableCell[$$a|b$$]", "TableCell[e]"
  ])
  // GFM's own parser, for the record, splits them.
  assert.equal(nodes(parse(a, parser.configure(GFM)), /^TableCell$/).length, 6)
})

test("table: an escaped pipe is text, a run of backticks that does not close shields nothing, and `$5|$6` is no maths", () => {
  // `$5|$6`: the closing `$` is followed by a digit, so Pandoc reads no
  // maths there and the pipe splits (three cells, the third dropped by
  // the editor's fit to the header); `$5 | $6` fails on the space before
  // the closer already.
  const a = "| a | b |\n|---|---|\n| x \\| y | z |\n| `open | w |\n| $5 | $6 |\n| $5|$6 | pair |\n"
  assert.deepEqual(cells(a).filter(c => /^TableCell/.test(c)), [
    "TableCell[a]", "TableCell[b]",
    "TableCell[x \\| y]", "TableCell[z]",
    "TableCell[`open]", "TableCell[w]",
    "TableCell[$5]", "TableCell[$6]",
    "TableCell[$5]", "TableCell[$6]", "TableCell[pair]"
  ])
})

test("table: the header's count against the delimiter's, and a table interrupting a paragraph, as GFM has them", () => {
  // A header of two cells over a delimiter of three is no table.
  assert.deepEqual(nodes(parse("| a | b |\n|---|---|---|\n| 1 | 2 |\n", gfm), /^Table$/), [])
  // A pipe line straight under a paragraph line starts a table when a
  // delimiter line follows it with the same count.
  assert.equal(parse("para\n| a | b |\n|---|---|\n| 1 | 2 |\n", gfm).toString(),
    "Document(Paragraph,Table(TableHeader(TableDelimiter,TableCell,TableDelimiter,TableCell,TableDelimiter),TableDelimiter,TableRow(TableDelimiter,TableCell,TableDelimiter,TableCell,TableDelimiter)))")
  // With a shielded pipe in the header, this parser and GFM's count alike
  // when the maths holds no pipe.
  assert.deepEqual(nodes(parse("| $x$ | b |\n|---|---|\n", gfm), /^TableCell$/).length, 2)
})

test("table: the parser stands aside on a language without GFM's table nodes", () => {
  assert.equal(parse("| a | b |\n|---|---|\n| 1 | 2 |\n").toString(), "Document(Paragraph)")
  assert.equal(parse("| a | b |\n|---|---|\n", parser.configure(mdmTable)).toString(), "Document(Paragraph)")
})

// ---------- Pandoc syntax ----------

test("raw TeX: a backslash before letters, with its groups, is a raw inline; the block form runs to its \\end", () => {
  assert.deepEqual(nodes(parse("A \\textbf{bold} word and \\alpha here."), /RawTeX/), ["RawTeX@2-15", "RawTeX@25-31"])
  // A Windows path is raw TeX to Pandoc too, and the page loses it; an
  // escape and a double backslash are not.
  assert.deepEqual(nodes(parse("C:\\Users\\bach \\* \\\\ x"), /RawTeX/), ["RawTeX@2-8", "RawTeX@8-13"])
  // Inside code or maths, nothing.
  assert.deepEqual(nodes(parse("`\\alpha` and $\\alpha$"), /RawTeX/), [])
  // The block, closed on a later line or on its own, and unclosed the
  // paragraph it reads as, with the inline raw in it.
  const block = "\\begin{center}\nx\n\\end{center}\n\nafter"
  assert.equal(parse(block).toString(), "Document(RawTeXBlock,Paragraph)")
  assert.deepEqual(nodes(parse(block), /RawTeXBlock/), ["RawTeXBlock@0-" + (block.indexOf("\\end{center}") + 12)])
  assert.deepEqual(nodes(parse("\\begin{x}\\end{x}\n"), /RawTeXBlock/), ["RawTeXBlock@0-16"])
  assert.equal(parse("\\begin{center}\nx\n").toString(), "Document(Paragraph(RawTeX))")
  // Inside a quote it stays inline: the look-ahead reads past the quote.
  assert.equal(parse("> \\begin{c}\n> x\n> \\end{c}\n").toString(), "Document(Blockquote(QuoteMark,Paragraph(RawTeX,QuoteMark,QuoteMark,RawTeX)))")
})

test("attributes: taken after an image, a link, a code span, a `$$` closer and a bracketed span, and left as text in prose", () => {
  // A heading's attributes are no node (the editor reads them off the
  // heading's text): an inline parser cannot tell the heading's line.
  assert.deepEqual(nodes(parse("## Attributed {#sec-attr .unnumbered}"), /Attribute/), [])
  assert.deepEqual(nodes(parse("![alt](i.png){#fig-x width=30%}"), /Attribute/), ["Attribute@13-31"])
  assert.deepEqual(nodes(parse("[t](u){.x}"), /Attribute/), ["Attribute@6-10"])
  assert.deepEqual(nodes(parse("`raw`{=html}"), /Attribute/), ["Attribute@5-12"])
  assert.deepEqual(nodes(parse("$$\nE\n$$ {#eq-mass}\n"), /Attribute/), ["Attribute@8-18"])
  assert.deepEqual(nodes(parse("$$\nE\n$$ {#eq-mass} and text\n"), /Attribute/), [])
  assert.equal(parse("[small caps]{.smallcaps} x").toString(), "Document(Paragraph(Span(LinkMark,LinkMark,Attribute)))")
  assert.deepEqual(nodes(parse("[small caps]{.smallcaps} x"), /Span|Attribute/), ["Span@0-24", "Attribute@12-24"])
  // A brace group in the middle of prose, or holding no attribute, is text.
  assert.deepEqual(nodes(parse("a {.x} b"), /Attribute/), [])
  assert.deepEqual(nodes(parse("a {not an attribute}"), /Attribute/), [])
  assert.deepEqual(nodes(parse("[text]{not one}"), /Span|Attribute/), [])
  // A quoted value may hold spaces.
  assert.deepEqual(nodes(parse("[t](u){title=\"a b\" .c}"), /Attribute/), ["Attribute@6-22"])
})

test("citations: bracketed and bare, Quarto's cross-references among them, and never inside a word", () => {
  assert.deepEqual(nodes(parse("As shown by [@knuth1984, p. 33] and in @fig-brass."), /^Citation$/), ["Citation@12-31", "Citation@39-49"])
  assert.deepEqual(nodes(parse("[see @a; -@b]"), /^Citation$/), ["Citation@0-13"])
  assert.deepEqual(nodes(parse("mail me@example.org today"), /^Citation$/), [])
  assert.deepEqual(nodes(parse("[text](url) and [no cite] and @"), /^Citation$/), [])
})

// ---------- citations as Pandoc reads them ----------

// The parser the editor runs (main.js, markdownLanguage()): lang-markdown's
// markdown() over its GFM base, with the MDM extensions. The code languages
// main.js gives it as well parse only inside fences.
const editor = markdown({base: markdownLanguage, extensions: mdmMarkdownExtensions, addKeymap: false, pasteURLAsLink: false}).language.parser

// Each Citation of a parse, parents before children, as its text, "=>" and
// the ids of its CitationKey children (`@{x}` read as x), after "> " for
// each Citation it stands in.
function cites(text) {
  let out = []
  editor.parse(text).iterate({enter(n) {
    if (n.name != "Citation") return
    let depth = 0
    for (let p = n.node.parent; p; p = p.parent) if (p.name == "Citation") depth++
    let ids = n.node.getChildren("CitationKey").map(k => text.slice(k.from, k.to).replace(/^@\{([^]*)\}$|^@/, "$1"))
    out.push("> ".repeat(depth) + text.slice(n.from, n.to) + " => " + ids.join(", "))
  }})
  return out
}

// Rows of a text and the citations in it, as cites() writes them. Every
// reading is Pandoc's: pandoc 3.8.3 (quarto pandoc) with the export's
// reader, markdown-blank_before_header-blank_before_blockquote
// +autolink_bare_uris, read off its JSON on 2026-09-29, each citation
// found where its content, which Pandoc builds from the text as written,
// stands in the text.
function assertCites(rows) {
  for (let [text, want] of rows) assert.deepEqual(cites(text), want, JSON.stringify(text))
}

// The 73 cases of the comparison of 2026-09-29 but the example list,
// `(@good)`, which Pandoc numbers and the editor still reads as citations.
test("citations: the cases compared with Pandoc (PX04)", () => {
  assertCites([
    ["As @knuth1984 shows.", ["@knuth1984 => knuth1984"]],
    ["As @knuth1984 [p. 33] shows.", ["@knuth1984 [p. 33] => knuth1984"]],
    ["As @knuth1984[p. 33] shows.", ["@knuth1984[p. 33] => knuth1984"]],
    ["As @knuth1984\n[p. 33] shows.", ["@knuth1984\n[p. 33] => knuth1984"]],
    ["As @knuth1984 [p. 33; @shannon1948] shows.", ["@knuth1984 [p. 33; @shannon1948] => knuth1984, shannon1948"]],
    ["As @knuth1984 [@shannon1948] shows.", ["@knuth1984 [@shannon1948] => knuth1984, shannon1948"]],
    ["As @knuth1984 [the book](http://x.org) shows.", ["@knuth1984 => knuth1984"]],
    ["As @knuth1984[^1] shows.\n\n[^1]: A note.", ["@knuth1984 => knuth1984"]],
    ["It is known [@knuth1984].", ["[@knuth1984] => knuth1984"]],
    ["Known [@knuth1984, p. 33].", ["[@knuth1984, p. 33] => knuth1984"]],
    ["He wrote \"@knuth1984\" there.", ["@knuth1984 => knuth1984"]],
    ["A snake_@knuth1984 form.", []],
    ["Known (@knuth1984, p. 33) here.", ["@knuth1984 => knuth1984"]],
    ["It is known[@knuth1984].", ["[@knuth1984] => knuth1984"]],
    ["Knuth says so [-@knuth1984].", ["[-@knuth1984] => knuth1984"]],
    ["Knuth says so -@knuth1984 too.", ["-@knuth1984 => knuth1984"]],
    ["Known [see @knuth1984, pp. 33-35; also @shannon1948, chap. 1].", ["[see @knuth1984, pp. 33-35; also @shannon1948, chap. 1] => knuth1984, shannon1948"]],
    ["Known [@knuth1984;@shannon1948].", ["[@knuth1984;@shannon1948] => knuth1984, shannon1948"]],
    ["Known [@knuth1984, pp. 33--35].", ["[@knuth1984, pp. 33--35] => knuth1984"]],
    ["Known [@knuth1984 p. 33].", ["[@knuth1984 p. 33] => knuth1984"]],
    ["Known [@knuth1984 and @shannon1948].", ["[@knuth1984 and @shannon1948] => knuth1984", "> @shannon1948 => shannon1948"]],
    ["Known [see (@knuth1984)].", ["[see (@knuth1984)] => knuth1984"]],
    ["Known (as @knuth1984 says) and (@shannon1948).", ["@knuth1984 => knuth1984", "@shannon1948 => shannon1948"]],
    ["As @doe:2020 says.", ["@doe:2020 => doe:2020"]],
    ["As @Doe_2020.a says.", ["@Doe_2020.a => Doe_2020.a"]],
    ["As @a-b says.", ["@a-b => a-b"]],
    ["As @a--b says.", ["@a => a"]],
    ["As @a.-b says.", ["@a => a"]],
    ["As said by @doe.", ["@doe => doe"]],
    ["As @doe: it holds.", ["@doe => doe"]],
    ["In @knuth1984's book.", ["@knuth1984 => knuth1984"]],
    ["As @1984book says.", ["@1984book => 1984book"]],
    ["Como dice @núñez2020 aquí.", ["@núñez2020 => núñez2020"]],
    ["As @müller1999 says.", ["@müller1999 => müller1999"]],
    ["As @https://x.org/a says.", ["@https://x.org/a => https://x.org/a"]],
    ["As @{https://x.org/a} says.", ["@{https://x.org/a} => https://x.org/a"]],
    ["Known [@{https://x.org/a}, p. 3].", ["[@{https://x.org/a}, p. 3] => https://x.org/a"]],
    ["Wildcard @* here.", ["@* => *"]],
    ["Write to me@example.org today.", []],
    ["The a@b and x@knuth1984 forms.", []],
    ["Un café@knuth1984 aquí.", []],
    ["Not a cite: \\@knuth1984 here.", []],
    ["Follow @alpelito7 on the forum.", ["@alpelito7 => alpelito7"]],
    ["Meet me @ the hall, at 5.", []],
    ["Text <!-- @knuth1984 --> more.", []],
    ["As \\cite{knuth1984} shows.", []],
    ["Read [see @knuth1984](http://x.org) now.", ["@knuth1984 => knuth1984"]],
    ["Read [@knuth1984](http://x.org) now.", ["@knuth1984 => knuth1984"]],
    ["Read *as @knuth1984 says* and **[@shannon1948]**.", ["@knuth1984 => knuth1984", "[@shannon1948] => shannon1948"]],
    ["Code `@knuth1984` and `[@shannon1948]`.", []],
    ["## On @knuth1984 and [@shannon1948]\n\nText.", ["@knuth1984 => knuth1984", "[@shannon1948] => shannon1948"]],
    ["| Source | Where |\n|---|---|\n| @knuth1984 | [@shannon1948, p. 3] |\n", ["@knuth1984 => knuth1984", "[@shannon1948, p. 3] => shannon1948"]],
    ["Text.^[See @knuth1984, p. 3.]", ["@knuth1984 => knuth1984"]],
    ["Text.[^1]\n\n[^1]: See @knuth1984 and [@shannon1948].", ["@knuth1984 => knuth1984", "[@shannon1948] => shannon1948"]],
    ["- @knuth1984 says\n- so [@shannon1948]\n", ["@knuth1984 => knuth1984", "[@shannon1948] => shannon1948"]],
    ["> As @knuth1984 says [p. 3].\n", ["@knuth1984 => knuth1984"]],
    ["::: {.callout-note}\nAs @knuth1984 says.\n:::\n", ["@knuth1984 => knuth1984"]],
    ["![Brass, after @knuth1984.](brass.png){#fig-brass}\n", ["@knuth1984 => knuth1984"]],
    ["Read [see @knuth1984]{.mark} now.", ["@knuth1984 => knuth1984"]],
    ["Read [@knuth1984]{.class} now.", ["@knuth1984 => knuth1984"]],
    ["As shown [see @knuth1984,\np. 33] here.", ["[see @knuth1984,\np. 33] => knuth1984"]],
    ["Known [@knuth1984;\n@shannon1948] here.", ["[@knuth1984;\n@shannon1948] => knuth1984, shannon1948"]],
    ["Known [see\n@knuth1984] here.", ["[see\n@knuth1984] => knuth1984"]],
    ["Known [@knuth1984, *passim*].", ["[@knuth1984, *passim*] => knuth1984"]],
    ["Known [see *The TeXbook*, @knuth1984].", ["[see *The TeXbook*, @knuth1984] => knuth1984"]],
    ["Known [@knuth1984, eq. $x^2$].", ["[@knuth1984, eq. $x^2$] => knuth1984"]],
    ["Known [see [the preface] @knuth1984].", ["[see [the preface] @knuth1984] => knuth1984"]],
    ["Known [@knuth1984, see [here](http://x.org)].", ["[@knuth1984, see [here](http://x.org)] => knuth1984"]],
    ["See @fig-brass, @tbl-notes, @eq-mass, @sec-intro and @thm-main.", ["@fig-brass => fig-brass", "@tbl-notes => tbl-notes", "@eq-mass => eq-mass", "@sec-intro => sec-intro", "@thm-main => thm-main"]],
    ["@Fig-brass shows it.", ["@Fig-brass => Fig-brass"]],
    ["As shown [@fig-brass] and [-@fig-brass].", ["[@fig-brass] => fig-brass", "[-@fig-brass] => fig-brass"]],
    ["As in [Figure @fig-brass].", ["[Figure @fig-brass] => fig-brass"]],
  ])
})

test("citations: a key is Pandoc's: Unicode letters and digits and no combining mark, its punctuation only before more of it, `:` and `/` before a `/`, braces balanced, and the nocite wildcard", () => {
  assertCites([
    ["x @a- y", ["@a => a"]],
    ["x @a::b y", ["@a => a"]],
    ["x @a:/ y", ["@a: => a:"]],
    ["x @a//b y", ["@a//b => a//b"]],
    ["x @_ y", ["@_ => _"]],
    ["x @*a y", ["@*a => *a"]],
    ["x @** y", ["@* => *"]],
    ["x @١٢ y", ["@١٢ => ١٢"]],
    ["x @n\u0303u y", ["@n => n"]],
    ["x @nu\u0303 y", ["@nu => nu"]],
    ["x @\u0303a y", []],
    ["x @a² y", ["@a² => a²"]],
    ["x @ǅa y", ["@ǅa => ǅa"]],
    ["x @a\u200db y", ["@a => a"]],
    ["x @𝔸b y", ["@𝔸b => 𝔸b"]],
    ["x @a𝔸 y", ["@a𝔸 => a𝔸"]],
    ["x @{a{b}c} y", ["@{a{b}c} => a{b}c"]],
    ["x @{} y", ["@{} => "]],
    ["x @{a b} y", []],
    ["x @{a}b y", ["@{a} => a"]],
    ["x @{a}} y", ["@{a} => a"]],
    ["x @{{a} y", []],
    ["x -@{a} y", ["-@{a} => a"]],
    ["x @{a\u00a0b} y", []],
    ["x @a#b y", ["@a#b => a#b"]],
    ["x @a+b y", ["@a+b => a+b"]],
    ["x @a!b y", ["@a => a"]],
    ["x @a'b y", ["@a => a"]],
  ])
})

test("citations: no key straight after a word, in an email address or after an emphasis that closes there, and a run of dashes leaves suppress-author to the one left over", () => {
  assertCites([
    ["x a.@k y", []],
    ["x .@k y", []],
    ["x ..@k y", []],
    ["x ...@k y", ["@k => k"]],
    ["x ....@k y", []],
    ["x ......@k y", ["@k => k"]],
    ["x a...@k y", ["@k => k"]],
    ["x _@k y", ["@k => k"]],
    ["x a_@k y", []],
    ["x a-@k y", []],
    ["x a+@k y", []],
    ["x a!@k y", []],
    ["x a!@_k y", ["@_k => _k"]],
    ["x a-@* y", ["@* => *"]],
    ["x a@* y", []],
    ["x a@{k} y", []],
    ["x a-@{k} y", ["@{k} => k"]],
    ["x a.b-@k y", []],
    ["x a..b@k y", []],
    ["x a..b-@k y", ["@k => k"]],
    ["x a.-@k y", ["@k => k"]],
    ["x n\u0303@k y", ["@k => k"]],
    ["x ²@k y", []],
    ["x #a@k y", []],
    ["x +@k y", ["@k => k"]],
    ["x …@k y", ["@k => k"]],
    ["-@k y", ["-@k => k"]],
    ["x (-@k) y", ["-@k => k"]],
    ["x .-@k y", ["@k => k"]],
    ["x --@k y", ["@k => k"]],
    ["x ---@k y", ["@k => k"]],
    ["x ----@k y", ["-@k => k"]],
    ["x -----@k y", ["@k => k"]],
    ["x a--@k y", []],
    ["x \\alpha@k y", ["@k => k"]],
    ["x \\.@k y", ["@k => k"]],
    ["x `c`@k y", ["@k => k"]],
    ["x $m$@k y", ["@k => k"]],
    ["x @a@b y", ["@a => a", "@b => b"]],
    ["x @a-@b y", ["@a => a", "-@b => b"]],
    ["x [x](u)@k y", ["@k => k"]],
    ["x &amp;@k y", ["@k => k"]],
    ["x &amp@k y", []],
    ["x http://x.org@k y", []],
    ["x www.x.org@k y", []],
    ["x \\_@k y", ["@k => k"]],
    ["x a@k1@b2 y", ["@b2 => b2"]],
    ["x a@k1-@b2 y", ["-@b2 => b2"]],
    ["x a@k1.@c2 y", []],
    ["x a@k1.-@b2 y", ["@b2 => b2"]],
    ["x a@k1-b@c2 y", ["@c2 => c2"]],
    ["x a.@k3@k4 y", ["@k4 => k4"]],
    ["x \\...@k3@k4 y", ["@k4 => k4"]],
    ["x \\--@k y", ["-@k => k"]],
    ["x \\---@k y", ["@k => k"]],
    ["x ...a-@k y", []],
    ["x ....a-@k y", ["@k => k"]],
    ["x *a*@k y", []],
    ["x *$m$*@k y", []],
    ["x **$m$**@k y", []],
    ["x *$m$*-@k y", ["@k => k"]],
    ["x *a *@k* y", []],
    ["x *a* @k y", ["@k => k"]],
    ["x *@k* y", ["@k => k"]],
    ["x @*@k1**-@k2 y", ["@* => *", "@k1 => k1", "-@k2 => k2"]],
    ["x *$m$**@k y", ["@k => k"]],
    ["x **$m$*@k y", ["@k => k"]],
    ["x ***$m$*@k y", []],
    ["x ***$m$**@k y", []],
  ])
})

test("citations: a key takes the bracket after it, past spaces and one line end, as its locator or as more citations, unless a note, a link, a span, a label or a defined reference has it", () => {
  assertCites([
    ["x @k  [p. 3] y", ["@k  [p. 3] => k"]],
    ["x @k \n [p. 3] y", ["@k \n [p. 3] => k"]],
    ["x @k\n\n[p. 3] y", ["@k => k"]],
    ["x @k  \n[p. 3] y", ["@k  \n[p. 3] => k"]],
    ["x @k\\\n[p. 3] y", ["@k => k"]],
    ["x @k \\[p. 3] y", ["@k => k"]],
    ["x @k\u00a0[p. 3] y", ["@k => k"]],
    ["x @k [^1] y\n\n[^1]: n", ["@k => k"]],
    ["x @k [^ x] y", ["@k => k"]],
    ["x @k [p. 3](u) y", ["@k => k"]],
    ["x @k [p. 3]{.c} y", ["@k => k"]],
    ["x @k [p. 3]{=html} y", ["@k => k"]],
    ["x @k [p. 3][r] y", ["@k => k"]],
    ["x @k [p. 3][ y", ["@k => k"]],
    ["x @k [p. 3](u y", ["@k => k"]],
    ["x @k [p. 3; see] y", ["@k => k"]],
    ["x @k [p. 3; see @b] y", ["@k [p. 3; see @b] => k, b"]],
    ["x @k [p; 3] y", ["@k => k"]],
    ["x @k [;@b] y", ["@k [;@b] => k, b"]],
    ["x @k [] y", ["@k [] => k"]],
    ["x @k [ ] y", ["@k [ ] => k"]],
    ["x @k [p. [3]] y", ["@k [p. [3]] => k"]],
    ["x @k [*p*] y", ["@k [*p*] => k"]],
    ["x @k [*a;b*] y", ["@k [*a;b*] => k"]],
    ["x @k [a*b] y", ["@k => k"]],
    ["x @k [*a] y", ["@k => k"]],
    ["x @k [see @b] y", ["@k [see @b] => k, b"]],
    ["x @k [@b, p. 3] y", ["@k [@b, p. 3] => k, b"]],
    ["x @k [@b; @c] y", ["@k [@b; @c] => k, b, c"]],
    ["x @k [p. 3] [@b] y", ["@k [p. 3] => k", "[@b] => b"]],
    ["x -@k [p. 3] y", ["-@k [p. 3] => k"]],
    ["x @k [@b](u) y", ["@k => k", "@b => b"]],
    ["x @k [@b]{.c} y", ["@k => k", "@b => b"]],
    ["x @k [@b][r] y", ["@k => k", "@b => b"]],
    ["x @k [p. 3] y\n\n[p. 3]: /r", ["@k => k"]],
    ["x @k [ref] y\n\n[ref]: /r", ["@k => k"]],
    ["x @{k} [p. 3] y", ["@{k} [p. 3] => k"]],
    ["x @* [p. 3] y", ["@* [p. 3] => *"]],
    ["x [see @k [p. 3]](u) y", ["@k [p. 3] => k"]],
    ["x (@k [p. 3]) y", ["@k [p. 3] => k"]],
    ["x @k [p. 3]] y", ["@k [p. 3] => k"]],
    ["x @k [x [p. 3] y", ["@k => k"]],
    ["x @a [p. 3] [p. 4] y", ["@a [p. 3] => a"]],
    ["x @a [p. 3][p. 4] y", ["@a => a"]],
    ["x @k [p. 3 and @b] y", ["@k [p. 3 and @b] => k, b"]],
    ["x @a [@b] [@c] y", ["@a [@b] => a, b", "[@c] => c"]],
    ["> x @k\n> [p. 3] y", ["@k\n> [p. 3] => k"]],
    ["- x @k\n  [p. 3] y", ["@k\n  [p. 3] => k"]],
    ["x @k's [p. 3] y", ["@k => k"]],
    ["x @k [see [x](u)] y", ["@k [see [x](u)] => k"]],
    ["x @k [x](u) y", ["@k => k"]],
  ])
})

test("citations: a bracketed citation runs over lines and holds brackets, code, maths and links; a part with no key, or an emphasis opened in it and never closed, makes none", () => {
  assertCites([
    ["x [@k; see p. 3] y", ["@k => k"]],
    ["x [@k, pp. 3; 5] y", ["@k => k"]],
    ["x [@k;] y", ["@k => k"]],
    ["x [;@k] y", ["@k => k"]],
    ["x [@k,] y", ["[@k,] => k"]],
    ["x [ @k ] y", ["[ @k ] => k"]],
    ["x [@k ; @b] y", ["[@k ; @b] => k, b"]],
    ["x [@k;;@b] y", ["@k => k", "@b => b"]],
    ["x [see a; b @k] y", ["@k => k"]],
    ["x [see; @k] y", ["@k => k"]],
    ["x [@k [p. 3]] y", ["[@k [p. 3]] => k"]],
    ["x [see @a [@b]] y", ["[see @a [@b]] => a", "> [@b] => b"]],
    ["x [see [@b] @a] y", ["[see [@b] @a] => a", "> [@b] => b"]],
    ["x [see [@b]] y", ["[@b] => b"]],
    ["x [see [ @k] y", ["[ @k] => k"]],
    ["x [@k]] y", ["[@k] => k"]],
    ["x [[@k] y", ["[@k] => k"]],
    ["x [see @a [p. 3] and @b] y", ["[see @a [p. 3] and @b] => a", "> @b => b"]],
    ["x [see @a [p. 3; @b]] y", ["[see @a [p. 3; @b]] => a", "> @b => b"]],
    ["x [@k\np. 3] y", ["[@k\np. 3] => k"]],
    ["x [\n@k] y", ["[\n@k] => k"]],
    ["x [@k\n] y", ["[@k\n] => k"]],
    ["x [see\n\n@k] y", ["@k => k"]],
    ["x [see \n @k] y", ["[see \n @k] => k"]],
    ["x [@k  \np. 3] y", ["[@k  \np. 3] => k"]],
    ["x [see\nmore\ntext @k] y", ["[see\nmore\ntext @k] => k"]],
    ["x [see\n@k\n; @b] y", ["[see\n@k\n; @b] => k, b"]],
    ["> x [see\n> @k] y", ["[see\n> @k] => k"]],
    ["x [@k, `a]b`] y", ["[@k, `a]b`] => k"]],
    ["x [@k, $a]b$] y", ["[@k, $a]b$] => k"]],
    ["x [@k, \\]] y", ["[@k, \\]] => k"]],
    ["x [@k, <http://a.org/]>] y", ["[@k, <http://a.org/]>] => k"]],
    ["x [@k, ^[note]] y", ["[@k, ^[note]] => k"]],
    ["x [@k, [^1]] y\n\n[^1]: n", ["[@k, [^1]] => k"]],
    ["x [@k, \\textit{a]b}] y", ["[@k, \\textit{a]b}] => k"]],
    ["x [@k, *a;b*] y", ["[@k, *a;b*] => k"]],
    ["x [*a;b* @k] y", ["[*a;b* @k] => k"]],
    ["x [@k, `a;b`] y", ["[@k, `a;b`] => k"]],
    ["x [@k, [a;b]] y", ["[@k, [a;b]] => k"]],
    ["x [@k, \\; x] y", ["[@k, \\; x] => k"]],
    ["x [@k, &amp; x] y", ["[@k, &amp; x] => k"]],
    ["x [*see @k*] y", ["@k => k"]],
    ["x [*see* @k] y", ["[*see* @k] => k"]],
    ["x [see **@k**] y", ["@k => k"]],
    ["x [see @k*] y", ["@k => k"]],
    ["x [@k, *a] y", ["@k => k"]],
    ["x [see *this @k] y", ["@k => k"]],
    ["x [@k, a*b] y", ["@k => k"]],
    ["x [@k, a*\nb] y", ["@k => k"]],
    ["x [@k, a_b] y", ["[@k, a_b] => k"]],
    ["x [@k, _a] y", ["@k => k"]],
    ["x [@k, a **b] y", ["@k => k"]],
    ["x [@k, a ****b] y", ["[@k, a ****b] => k"]],
    ["x [@k, ***a*] y", ["@k => k"]],
    ["x [@k, *a*] y", ["[@k, *a*] => k"]],
    ["x [@k, a * b] y", ["[@k, a * b] => k"]],
    ["x [see [@b; x] @a] y", ["[see [@b; x] @a] => a", "> @b => b"]],
    ["x [see -@k] y", ["[see -@k] => k"]],
    ["x [see a-@k] y", []],
    ["x [see (-@k)] y", ["[see (-@k)] => k"]],
    ["x [see me@k.org, @b] y", ["[see me@k.org, @b] => b"]],
    ["x [see @k's book] y", ["[see @k's book] => k"]],
  ])
})

test("citations: a destination, an attribute block or a label after the `]` make a link, a span or a reference of the bracket, and a label or a picture's bracket read again on its own is a citation whatever follows", () => {
  assertCites([
    ["x [@k](u) y", ["@k => k"]],
    ["x [@k] (u) y", ["[@k] => k"]],
    ["x [@k](u y", ["[@k] => k"]],
    ["x [@k]{.c} y", ["@k => k"]],
    ["x [@k]{not attr} y", ["[@k] => k"]],
    ["x [@k]{=html} y", ["[@k] => k"]],
    ["x [@k]{} y", ["@k => k"]],
    ["x [@k]{-} y", ["@k => k"]],
    ["x [@k]{key=\"a b\"} y", ["@k => k"]],
    ["x [@k]{key=\" a\"} y", ["[@k] => k"]],
    ["x [@k]{.1a} y", ["[@k] => k"]],
    ["x [@k]{#1a} y", ["@k => k"]],
    ["x [@k]{.a\n.b} y", ["@k => k"]],
    ["x [@k][ref] y", ["@k => k"]],
    ["x [@k][] y", ["@k => k"]],
    ["x [@k][ y", ["[@k] => k"]],
    ["x [@k][^1] y\n\n[^1]: n", ["[@k] => k"]],
    ["x [@k][ref] y\n\n[ref]: /r", ["@k => k"]],
    ["x [@k][@b] y", ["@k => k", "[@b] => b"]],
    ["x [@k] [@b] y", ["[@k] => k", "[@b] => b"]],
    ["x [@k][a [b] c] y", ["@k => k"]],
    ["x [@k][`a]` y", ["[@k] => k"]],
    ["x [@k][$a]$] y", ["@k => k"]],
    ["x [@k][a `]` b] y", ["@k => k"]],
    ["x [@k](<u>) y", ["@k => k"]],
    ["x [@k](u \"t\") y", ["@k => k"]],
    ["x [@k](u \"t) y", ["[@k] => k"]],
    ["x [@k]() y", ["@k => k"]],
    ["x [@k](a b) y", ["@k => k"]],
    ["x [@k](a\nb) y", ["@k => k"]],
    ["x [@k](a(b) y", ["[@k] => k"]],
    ["x [@k](a(b)c) y", ["@k => k"]],
    ["x [@k](a \"b\" c) y", ["[@k] => k"]],
    ["x [@k](a \" t\") y", ["[@k] => k"]],
    ["x [@k](<a b>) y", ["@k => k"]],
    ["x [@k](a\n\"t\") y", ["@k => k"]],
    ["x [x][@b][p. 3] y", ["[@b] => b"]],
    ["x [x][@b](u) y", ["[@b] => b"]],
    ["x [@b1][@b2][p. 3] y", ["@b1 => b1", "[@b2] => b2"]],
    ["x ![@k] y", ["[@k] => k"]],
    ["x ![@k](i.png) y", ["@k => k"]],
    ["x ![see @k] y", ["[see @k] => k"]],
    ["x ![x][@b][p. 3] y", ["[@b] => b"]],
  ])
  // A destination longer than pandoc.js looks for its end (SOURCE_LIMIT) is
  // CommonMark's to decide: a picture's inline data is a link to Pandoc.
  let data = "(data:image/png;base64," + "A".repeat(2500) + ")"
  assertCites([
    ["x [@k]" + data + " y", ["@k => k"]],
    ["x ![see @k]" + data + " y", ["@k => k"]],
  ])
})

test("citations: the tree is Citation(CitationKey...), a citation Pandoc nests in another a Citation inside it, and nothing of a prefix or a suffix", () => {
  // The key without the `-` of suppress-author; a prefix's emphasis, a
  // suffix's maths and link are not children (main.js draws a citation as
  // written).
  let text = "See [see *The TeXbook*, @k, eq. $x$ and [here](u)] and -@b."
  assert.equal(editor.parse(text).toString(), "Document(Paragraph(Citation(CitationKey),Citation(CitationKey)))")
  assert.deepEqual(nodes(editor.parse(text), /^CitationKey$/, text), ["CitationKey[@k]", "CitationKey[@b]"])
  assert.equal(editor.parse("x [see @a [@b] and @c] y").toString(),
    "Document(Paragraph(Citation(CitationKey,Citation(CitationKey),Citation(CitationKey))))")
  assert.equal(editor.parse("x @a [p. 3; see *it* @b] y").toString(), "Document(Paragraph(Citation(CitationKey,CitationKey)))")
  // Over a line of a quote, the quote's mark hangs inside the citation, as
  // it does inside a link.
  assert.equal(editor.parse("> x [see\n> @k] y").toString(), "Document(Blockquote(QuoteMark,Paragraph(Citation(QuoteMark,CitationKey))))")
  // Without the Pandoc extension a parser has no Citation node, and the
  // links are read as they were.
  assert.deepEqual(links("[@k] and [x](u) and @k\n", parser.configure([GFM, mdmLinks])), ["Link[[x](u)]", "URL[u]"])
})

// The citations were read with a look from every `[` to the end of its
// line, 3.4 s over a line of 60,000 characters of `[a `, and the link
// reader looked for a destination from every `](` to the end of the line,
// 4.3 s over 80,000 of `[x](` (measured 2026-09-29; 16 and 28 ms now). The brackets are
// closed at their `]` now; a destination's end and a label's are read off
// tables made once per paragraph, a locator's key is the part before its
// bracket, and the word before an `@` is read back to the `@` before it.
test("citations: long lines of unclosed brackets, destinations, labels and spent brackets parse in linear time", () => {
  for (let text of ["[a ".repeat(20000), "[@a ".repeat(20000), "[x](".repeat(20000), "[@k](".repeat(20000),
                    "[@k][".repeat(20000), "[a] ".repeat(60000), "a@".repeat(20000)]) {
    let t0 = Date.now()
    let tree = editor.parse(text)
    assert.equal(tree.length, text.length)
    assert.ok(Date.now() - t0 < 1500, JSON.stringify(text.slice(0, 5)) + " took " + (Date.now() - t0) + " ms")
  }
})

test("footnotes: a reference, an inline note and the note itself with its indented paragraphs are nodes, not a link, a superscript and a code block", () => {
  const text = "A claim.[^1] Another with an inline note.^[This note is *inline*.]\n\n[^1]: The footnote text, with *emphasis* and $x$.\n\n    A second paragraph of the same footnote, indented.\n\nAfter.\n"
  const tree = parse(text)
  assert.equal(tree.toString(), "Document(Paragraph(FootnoteRef(FootnoteMark,FootnoteMark),FootnoteInline(FootnoteMark,Emphasis(EmphasisMark,EmphasisMark),FootnoteMark)),FootnoteDef(FootnoteMark,Paragraph(Emphasis(EmphasisMark,EmphasisMark),InlineMath(InlineMathMark,InlineMathContent,InlineMathMark)),Paragraph),Paragraph)")
  assert.deepEqual(nodes(tree, /^FootnoteRef$|^FootnoteInline$|^FootnoteDef$/), [
    "FootnoteRef@8-12",
    "FootnoteInline@" + text.indexOf("^[") + "-" + (text.indexOf("inline*.]") + 9),
    "FootnoteDef@" + text.indexOf("[^1]:") + "-" + (text.indexOf("indented.") + 9)
  ])
  // The note's paragraphs: the definition line's text, and the indented one
  // without its indentation.
  const paras = nodes(tree, /^Paragraph$/)
  assert.equal(paras[1], "Paragraph@" + text.indexOf("The footnote") + "-" + (text.indexOf("$x$.") + 4))
  assert.equal(paras[2], "Paragraph@" + text.indexOf("A second") + "-" + (text.indexOf("indented.") + 9))
  // A reference needs a label with no space and no bracket; a caret with no
  // bracket after it is the superscript it was.
  assert.deepEqual(nodes(parse("[^ x] and [^] and ^sup^"), /Footnote/), [])
  const sup = parser.configure([Superscript, ...mdmMarkdownExtensions])
  assert.deepEqual(nodes(parse("x^2^ and ^[note]", sup), /^Superscript$|^FootnoteInline$/), ["Superscript@1-4", "FootnoteInline@9-16"])
  // A definition under a paragraph line is the paragraph's, as Pandoc has
  // it, and inside a quote it is the link reference it was.
  assert.equal(parse("text\n[^1]: note\n").toString(), "Document(Paragraph(FootnoteRef(FootnoteMark,FootnoteMark)))")
  assert.equal(parse("> [^1]: note\n").toString(), "Document(Blockquote(QuoteMark,LinkReference(LinkLabel,LinkMark,URL)))")
})

