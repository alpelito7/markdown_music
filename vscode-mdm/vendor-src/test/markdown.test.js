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
  assert.equal(lineEnd(example, 13), 214)
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

test("example.mdm: the $$ block at lines 21-25", () => {
  const tree = parse(example)
  const from = lineStart(example, 21), to = lineEnd(example, 25)
  assert.equal(example.slice(from, from + 2), "$$")
  assert.deepEqual(nodes(tree, /^BlockMath/), [
    `BlockMath@${from}-${to}`,
    `BlockMathMark@${from}-${from + 2}`,
    `BlockMathContent@${lineStart(example, 22)}-${lineEnd(example, 24)}`,
    `BlockMathMark@${to - 2}-${to}`
  ])
  assert.equal(from, 665)
  assert.equal(to, 839)
  // The content is not parsed as Markdown (it holds `_` and `\`).
  const content = tree.resolveInner(lineStart(example, 22) + 5, 1)
  assert.equal(content.name, "BlockMathContent")
  assert.equal(content.firstChild, null)
})

test("example.mdm: inline math on line 19 and a digit-heavy one on line 29", () => {
  const tree = parse(example)
  const l19 = lineStart(example, 19)
  const L = l19 + example.slice(l19).indexOf("$L$")
  assert.equal(L, 412)
  const inline = nodes(tree, /^InlineMath/, example)
  assert.deepEqual(inline.slice(0, 4), ["InlineMath[$L$]", "InlineMathMark[$]", "InlineMathContent[L]", "InlineMathMark[$]"])
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
  assert.deepEqual(nodes(tree, /Emphasis/), [])
  assert.equal(nodes(tree, /^InlineMath$/).length, 2)
  const content = tree.resolveInner(4, 1)
  assert.equal(content.name, "InlineMathContent")
  assert.equal(content.firstChild, null)
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
  for (const text of ["$$\nx\n", "$$\nx\n\ny $$ z", "$$ x", "$$\n  x\n$$ y"]) {
    const tree = parse(text)
    assert.deepEqual(nodes(tree, /^BlockMath/), [], JSON.stringify(text))
    assert.equal(tree.topNode.firstChild.name, "Paragraph", JSON.stringify(text))
  }
  // The fallback paragraph is inline-parsed: a mid-line closer turns the
  // fence into display math inside the paragraph, as Pandoc reads it.
  assert.deepEqual(nodes(parse("$$\n  x\n$$ y"), /^InlineBlockMath$/), ["InlineBlockMath@0-9"])
  assert.deepEqual(nodes(parse("$$\nx\n"), /Math/), [])
  // The fallback paragraph has the same extent the default parser gives
  // (up to the blank line) and its inline content is still parsed.
  const tree = parse("$$\nx *em*\n\nafter")
  assert.deepEqual(nodes(tree, /Paragraph|Emphasis/), ["Paragraph@0-9", "Emphasis@5-9", "EmphasisMark@5-6", "EmphasisMark@8-9", "Paragraph@11-16"])
})

test("block math: a mid-line $$ on the opening line is not a block", () => {
  const text = "$$a$$ and $$b$$\n"
  assert.deepEqual(nodes(parse(text), /^BlockMath$/), [])
  assert.equal(nodes(parse(text), /^InlineBlockMath$/).length, 2)
})

test("block math: content is not parsed as Markdown", () => {
  const tree = parse("$$\n- a_b\n# c\n$$\n")
  assert.deepEqual(nodes(tree, /List|Heading|Emphasis/), [])
  assert.deepEqual(nodes(tree, /^BlockMathContent$/), ["BlockMathContent@3-12"])
  assert.equal(tree.resolveInner(5, 1).firstChild, null)
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
  for (const open of ["::: {.callout-warning title=\"T\"}", ":::{.callout-tip}", "::::: {#refs}", "::: warning", "::: callout-tip  "]) {
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
  // A closer that belongs to a nested opener does not count for the outer one.
  assert.equal(parse("::: {.note}\n::: {.tip}\ntext\n:::\n").toString(),
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
  assert.equal(parse("- item\n  ::: {.note}\n  in list\n  :::\n- next").toString(),
    "Document(BulletList(ListItem(ListMark,Paragraph,Callout(CalloutMark,Paragraph,CalloutMark)),ListItem(ListMark,Paragraph)))")
  assert.equal(parse("::: {.note}\n\n- a\n- b\n\n:::\n").toString(),
    "Document(Callout(CalloutMark,BulletList(ListItem(ListMark,Paragraph),ListItem(ListMark,Paragraph)),CalloutMark))")
  // A `:::` line interrupts a paragraph; math blocks live inside callouts.
  assert.equal(parse("text\n::: {.note}\n$$\nx\n$$\n:::").toString(),
    "Document(Paragraph,Callout(CalloutMark,BlockMath(BlockMathMark,BlockMathContent,BlockMathMark),CalloutMark))")
})

test("calloutKind", () => {
  assert.equal(calloutKind("::: {.callout-note}"), "note")
  assert.equal(calloutKind("::: {.callout-warning title=\"x\"}"), "warning")
  assert.equal(calloutKind(":::{.callout-tip}"), "tip")
  assert.equal(calloutKind("::::: {.callout-important icon=false}  "), "important")
  assert.equal(calloutKind("::: {.callout-caution}"), "caution")
  assert.equal(calloutKind("::: callout-caution"), "caution")
  // Any fenced div counts as a callout and defaults to note (as main.js does).
  assert.equal(calloutKind("::: {#refs}"), "note")
  assert.equal(calloutKind("::: {.mycallout-tip}"), "note")
  assert.equal(calloutKind("::: warning"), "note")
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
