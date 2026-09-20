// Lezer Markdown extension: a long run of emphasis delimiters is text.
//
// CommonMark reads a run of asterisks or underscores as nested emphasis, a
// level for every two or three of them, and @lezer/markdown writes the tree
// of one paragraph recursively, a stack frame per level (Element.writeTo).
// A paragraph of 12,000 `*` a side, pasted or generated, overflowed that
// stack, the editor never built its view and a paste of the run was dropped
// (G107). No reader gives a run that long a meaning: Pandoc's markdown, the
// reader the export runs, leaves `******foo******` as literal text. So a run
// of LONG_RUN delimiters or more is taken as text here, ahead of Emphasis,
// with no node of its own. Runs shorter than that nest as before.

const STAR = 42, UNDERSCORE = 95

export const LONG_RUN = 20

function parseLongRun(cx, next, pos) {
  if (next != STAR && next != UNDERSCORE) return -1
  let end = pos + 1
  while (end < cx.end && cx.char(end) == next) end++
  if (end - pos < LONG_RUN) return -1
  return end
}

export const mdmLongRuns = {
  parseInline: [{
    name: "LongDelimiterRun",
    parse: parseLongRun,
    before: "Emphasis"
  }]
}
