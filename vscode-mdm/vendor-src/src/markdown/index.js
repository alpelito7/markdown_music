// The MDM Lezer Markdown extensions: math, YAML front matter and callouts.
// Pass `mdmMarkdownExtensions` to markdown({extensions}) from
// @codemirror/lang-markdown or to parser.configure() from @lezer/markdown.

export {mdmMath} from "./math.js"
export {mdmFrontMatter} from "./frontmatter.js"
export {mdmCallout, calloutKind} from "./callout.js"

import {mdmMath} from "./math.js"
import {mdmFrontMatter} from "./frontmatter.js"
import {mdmCallout} from "./callout.js"

export const mdmMarkdownExtensions = [mdmMath, mdmFrontMatter, mdmCallout]
