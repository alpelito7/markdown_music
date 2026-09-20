// The MDM Lezer Markdown extensions: math, YAML front matter, callouts, the
// long delimiter runs that are text, links that know the document's
// definitions, the ATX heading written with a tab, the pipe table whose
// cells hold code and maths whole, and the Pandoc syntax the export reads
// (raw TeX, attributes, bracketed spans, citations, footnotes).
// Pass `mdmMarkdownExtensions` to markdown({extensions}) from
// @codemirror/lang-markdown or to parser.configure() from @lezer/markdown.

export {mdmMath} from "./math.js"
export {mdmFrontMatter} from "./frontmatter.js"
export {mdmCallout, calloutKind} from "./callout.js"

import {mdmMath} from "./math.js"
import {mdmFrontMatter} from "./frontmatter.js"
import {mdmCallout} from "./callout.js"
import {mdmLinks} from "./links.js"
import {mdmTabHeading} from "./heading.js"
import {mdmPandoc} from "./pandoc.js"
import {mdmFootnotes} from "./footnote.js"

// Without Emoji: lang-markdown's language reads `:tada:` as an Emoji node,
// and the page, Pandoc's markdown reader with no emoji extension, prints it
// as the text it is (G016). The removal is a no-op on a parser without it.
export const mdmMarkdownExtensions = [mdmMath, mdmFrontMatter, mdmCallout, mdmLongRuns, mdmLinks, mdmTabHeading, mdmTable, mdmPandoc, mdmFootnotes, {remove: ["Emoji"]}]
