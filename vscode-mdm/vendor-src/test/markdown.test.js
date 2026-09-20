// Tests for the MDM Lezer Markdown extensions (math, front matter, callouts).
// Run with `npm test` (node --test).

import {test} from "node:test"
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {dirname, resolve} from "node:path"
import {parser} from "@lezer/markdown"
import {markdownLanguage} from "@codemirror/lang-markdown"
import {TreeFragment} from "@lezer/common"
import {mdmMath, mdmFrontMatter, mdmCallout, mdmMarkdownExtensions, calloutKind} from "../src/markdown/index.js"

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
  assert.deepEqual(nodes(parse("As shown by [@knuth1984, p. 33] and in @fig-brass."), /Citation/), ["Citation@12-31", "Citation@39-49"])
  assert.deepEqual(nodes(parse("[see @a; -@b]"), /Citation/), ["Citation@0-13"])
  assert.deepEqual(nodes(parse("mail me@example.org today"), /Citation/), [])
  assert.deepEqual(nodes(parse("[text](url) and [no cite] and @"), /Citation/), [])
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

