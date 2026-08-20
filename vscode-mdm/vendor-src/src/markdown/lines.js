// Raw look-ahead over the lines that follow the block parser's current line.
//
// BlockContext exposes only peekLine() (one line) and nextLine() (consumes,
// no rewind), so a parser that must know whether a closing fence exists
// before it commits reads the document text directly. cx.input is the
// @lezer/common Input the parser was created with; it is a plain field of
// BlockContext (not in the public typings, stable since 0.x). When it is
// missing the callback is never invoked and the caller decides the default.
//
// Lines are raw: container prefixes (`> `, list indentation) are not
// stripped, and the scan runs to the end of the input, not to the end of
// the containing block. Callers handle both with forgiving patterns.

const CHUNK = 4096

// Calls fn(text) for each line after the current one until fn returns a
// value other than undefined, which is then returned. Returns undefined at
// the end of the input.
export function forEachLineAfter(cx, line, fn) {
  let input = cx.input
  if (!input) return undefined
  let pos = cx.lineStart + line.text.length + 1
  let carry = ""
  while (pos < input.length) {
    let end = Math.min(input.length, pos + CHUNK)
    let chunk = carry + input.read(pos, end)
    pos = end
    let start = 0
    for (;;) {
      let nl = chunk.indexOf("\n", start)
      if (nl < 0) break
      let result = fn(chunk.slice(start, nl))
      if (result !== undefined) return result
      start = nl + 1
    }
    carry = chunk.slice(start)
  }
  if (carry.length) return fn(carry)
  return undefined
}
