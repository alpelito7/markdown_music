# Moving the MDM editor to CodeMirror 6

Status: implemented (2026-08-20) and merged into `main`, tagged
`v0.2.0-cm6-editor` (2026-08-24). The nineteen
decisions below lean towards Obsidian's live preview and towards what the
MDM editor already did; each says what was chosen, and each is open to
revision. Everything under "Measured" was observed on 2026-08-20 on this
machine (Chrome 151 headless via puppeteer-core, VS Code 1.133.0), not taken
from documentation.

## Why

Two requests that Vditor cannot meet: several carets at once inside the
visual editor (Alt+click mandatory, Ctrl+D too, column selection), and
delimiters (`$$`, backticks) editable as ordinary characters, with the block
rendering as soon as its source compiles. Vditor emulates nothing of the
first (one DOM `Range` in Chromium, one `addRange` in its bundle) and lute
re-derives the delimiters from block structure on every keystroke, so a
"broken fence" state cannot exist while lute serialises. A CM6 document
whose text is the file text gives both directly.

## Measured

A throwaway spike, not kept in the tree (an entry module, a harness page and
two probe scripts), CM6 6.0.2 (`@codemirror/view` 6.43.9, `state`
6.7.1, `lang-markdown` 6.5.2, `search` 6.7.1, `@lezer/markdown` 1.7.2), KaTeX
0.18.4, bundled with esbuild 0.28.2 into one IIFE:

- Bundle: 801 KB minified, 1.7 MB unminified. Loads and injects its
  `<style>` elements under a CSP identical to the webview's (`style-src
  'unsafe-inline'`), so no change to `extension.js` CSP is needed.
- Ctrl+D (`selectNextOccurrence` from `searchKeymap`) on a selected word
  gives three ranges; typing writes into all three.
- Alt+click adds carets once `EditorView.clickAddsSelectionRange.of(e =>
  e.altKey && !e.shiftKey)` is set. CM6's default is Ctrl+click on Linux
  (`addsSelectionRange` in `@codemirror/view` falls back to `ctrlKey`),
  which also works. Three carets, `.cm-cursor` × 3 in the DOM, typing writes
  into all three, Escape collapses to one, Ctrl+Z undoes the three inserts
  at once.
- Shift+Alt+drag gives a column selection once `rectangularSelection({
  eventFilter: e => e.altKey && e.shiftKey })` is set (CM6 default is
  Alt+drag); three ranges, typing writes into all three lines.
- A `StateField` of `Decoration.replace` widgets over `$$…$$`, revealing the
  source when any selection range touches the block or KaTeX throws:
  renders on load; clicking the widget puts the caret inside and shows the
  source; typing `\frac{` and leaving keeps the source (compile error);
  finishing `\frac{1}{2}` and leaving renders; deleting one `$` of the
  closing pair leaves `$$E = …$` as plain text and nothing regenerates it;
  retyping the `$` renders again; with two carets, one inside the block and
  one in prose, typing writes in both and only the touched block reveals.
- `@lezer/markdown` has no math or front matter nodes. Both need a
  `MarkdownConfig` extension (`defineNodes` + `parseInline`/`parseBlock`).
- VS Code: the `mdm.editor` custom editor and the native text editor can be
  open at once on the same `.mdm` (same group or beside), sharing one
  `TextDocument`. Not needed for this design, but it means a "open as text"
  escape hatch is cheap to keep alongside.

Answered since, by use inside a real VS Code window: Ctrl+D, Alt+click and
Ctrl+Alt+Up/Down do reach the webview (the iframe sees the keydown first and
VS Code's own bindings for those keys are gated on `editorTextFocus`). What
the real window added was around the edges: a held Alt read by the workbench
as a menu-bar tap, and the workbench replaying its `undo` into the page as
`execCommand("undo")`; both are handled and recorded in `tests/README.md`
(the parity rounds).

## Prior art (surveyed 2026-08-20)

CM6 live-preview implementations that reveal source where the caret is:
Zettlr (GPL-3.0, KaTeX widgets, all selection ranges reveal), ixora
(Apache-2.0, hides inline marks, all ranges), codemirror-live-markdown (MIT,
all ranges, math only inside backticks/fences), atomic-editor (MIT,
whole-line reveal), codemirror-rich-markdoc (MIT, primary range only), Joplin
core (AGPL, primary range only, no math widget). Obsidian is closed; its
docs confirm CM6 and per-token reveal; its tables are a widget that no longer
reveals source. Licences matter: Zettlr and Joplin are read for ideas only,
nothing is copied from them. ink-mde's KaTeX grammar (MIT) is the closest
MIT reference for the Lezer math extension.

CM6 facts that shape the design (from codemirror.net docs and Marijn's
answers, consistent with the spike): decorations that change vertical
layout (block widgets, replaced line breaks) must come from a `StateField`,
not a `ViewPlugin`; `atomicRanges` makes Backspace swallow a whole hidden
range, so hidden marks are revealed near the caret instead; vertical caret
motion does not enter a block replace widget by default, so Up/Down into a
block need a small command of their own.

## Architecture

One `EditorView` over the markdown text of the document (minus the front
matter when `mdm.frontMatter` is `hidden`, exactly as today). The document
text is the file text: `transforms.js` keeps only the front-matter splice,
the `mdm-abc` token and the fence scanner go away because their two reasons
(lute truncating info strings, Vditor rendering `abc` itself) no longer
exist. The `update`/`edit`/`ready`/`setSetting`/`export`/`settings`/`palette`
protocol with `extension.js` stays as is.

Rendering is decorations over the Lezer syntax tree:

- Block widgets (`StateField`, `Decoration.replace({block: true})`): display
  math, fenced code, ABC scores (SVG + player inside the widget), tables
  (later, see D5), images. Revealed (widget removed, source shown, styled
  as a source card) when a selection range touches the block or when the
  block does not compile (math: KaTeX throws; ABC: abcjs reports errors;
  code: never, it always renders).
- Inline replace widgets: inline math, images in a line.
- Hidden marks (`Decoration.replace({})` on `EmphasisMark`, `CodeMark`,
  `HeaderMark`, `LinkMark`, `QuoteMark` ...), revealed per node when a
  selection range touches the node.
- Line decorations for headings, blockquotes, list items, callout bodies,
  front matter.
- Pandoc callouts: a `parseBlock` extension for `::: {.note}` fences, or a
  line scan; the current `decorateCallouts` semantics (fence line shown
  only where the caret is) map directly to decorations.

Reveal rule, one function used everywhere: `touched(from, to) =
state.selection.ranges.some(r => r.from <= to && r.to >= from)`. All ranges,
not `selection.main`, so every caret reveals what it is editing; this is
what Zettlr and ixora do and what the spike verified.

Vendoring and build: the runtime of `vscode-mdm/` stays plain JS without a
bundler. CM6 + KaTeX + the Lezer extensions we write are built once by an
esbuild script into a single committed file
`vscode-mdm/media/vendor/cm6/cm6.bundle.js` (plus `katex.min.css` and its
fonts), exposing `window.CM`. The script, its `package.json` and lockfile
live in `vscode-mdm/vendor-src/` (or `tools/`); rebuilding needs network
once, the editor never does. `main.js` keeps being an IIFE loaded as a
plain `<script>`, so the test harness and `getHtml` change only the vendor
lines. Vditor's 24 MB directory is removed at the end (its KaTeX 0.16 and
highlight.js are replaced; abcjs 5.10.3 inside it is no longer needed
because abcjs 6 is already vendored for the player and can render too).

Multicursor: `EditorState.allowMultipleSelections`, `drawSelection`,
`rectangularSelection`, `crosshairCursor`, `searchKeymap` (Ctrl+D,
Ctrl+Shift+L), `defaultKeymap` (Ctrl+Alt+Up/Down add carets, Escape
collapses). The add-caret modifier mirrors VS Code's
`editor.multiCursorModifier` (read in `extension.js`, sent with settings),
so Alt+click or Ctrl+click follows what the user already uses in text
editors.

What carries over from `main.js` (inventory of 2026-08-20): 1,816 of 2,957
lines portable with DOM re-targeting
(audio player 1,051, theme/palette/settings/toolbar data, score fitting,
copy); 488 rewritten against CM6 (sync, block identity for the player,
callouts, toolbar shape, init and message handler); 653 removed (block
edges, YAML card graft, cut guard, click-to-edit, Vditor-specific
stopPropagation lists). `style.css`: ~500 LOC carry over, ~120 re-scope,
~130 go. Tests: 59 of 72 webview tests keep their intent and are
re-targeted, 13 assert Vditor internals and are dropped; new tests cover
multicursor, reveal, compile-gated rendering and literal delimiter editing.

## Decisions, as taken

D1. Caret inside a block that compiles: **(b)** for display maths, code
  and scores, the source on its card with the render under it as a live
  preview (the score keeps its player under the ABC); **(a)** for inline
  maths and inline marks, source only. A block that does not compile shows
  its source with a red edge while untouched and KaTeX's message under the
  source while touched; the moment it compiles it renders.

D2. Reveal granularity in prose: **per node**. The `**` of one bold span
  show when the caret is in that span, the `#` of a heading when the caret
  is on that line, the `>` of a quote line by line, a callout's fence line
  when the caret is on it.

D3. Code highlighting: **CodeMirror language packages**, highlight.js gone.
  Full parsers for Python, JavaScript/TypeScript/JSX, JSON, YAML, HTML,
  CSS, C++; stream modes for R, Julia, shell, LaTeX, Lua, Ruby, Octave,
  Haskell, C, Java, C#, SQL, TOML, XML, diff (`vendor-src/src/languages.js`).
  The ten `--mdm-syn-*` slots of the palette are spent through one
  HighlightStyle.

D4. Toolbar: **the MDM buttons plus bold, italic, inline code, link,
  heading cycle, bulleted and numbered lists**; export, undo and redo lead.
  Outline, insert-before/after and the table button are gone. A code block
  button joined inline code on 2026-09-19, at the owner's request, its
  glyph the owner's pick of design-code-block.html (B, the chevrons
  between two rules).

  Revisited later: almost none of the shape above survives. The outline
  leads the bar again and export follows it; the heading cycle is a menu of
  Paragraph and the six levels (D19); the table came back inside a group of
  six Insert buttons, with the equation, the equation block, the picture,
  the footnote and the rule; strikethrough, superscript, subscript, small
  caps and the highlight joined the word marks, and the task list and the
  quote the blocks. The bar stands in two rows since it grew that far: what
  a reader writes above, what the document is set in below.

D5. Tables: **(a)**, the source as a monospace grid, editable with
  multicursor; no widget. Revisited later: a table is drawn now, a block
  widget under its source lines like a score or a display equation, and the
  monospace grid is what a caret in it reveals. The cells are set with the
  marks and the maths they carry, the columns take the alignment the second
  row asks for, and a click lands on the cell it was on rather than at the
  head of the table.

D6. Gestures: **all of them**. Alt+click (or Ctrl+click, following VS
  Code's `editor.multiCursorModifier`, read by the host and sent with the
  settings, reconfigured live), Shift+Alt+drag column, Ctrl+D, Ctrl+Shift+L,
  Ctrl+Alt+Up/Down, Escape. Plus Ctrl+B/I/E for the inline marks, Ctrl+K
  for a link, Ctrl+Enter to leave a block, Up/Down walking into rendered
  blocks.

D7. Front matter shown: **literal YAML lines at the top, `---` visible and
  editable, on the card look it had**, highlighted through a mounted YAML
  parse. Hidden: the host strips header and the blank lines under it and
  splices them back from the file (`transforms.js`, now that and nothing
  else).

D8. Vendor build: **`vscode-mdm/vendor-src/`** (esbuild, lockfile, `npm run
  vendor`); the bundle, KaTeX's stylesheet and fonts are committed under
  `media/vendor/cm6/`, the runtime stays plain JS.

D9. Migration: **in place on the branch**, Vditor removed, the suite
  rebuilt (`tests/webview-editing`, `-look`, `-player`).

The decisions below were taken on `feat/markdown-editor` (September 2026),
after a bench of 215 Markdown cases was run against the editor and each
finding verified on a minimal case. The mutations that pin them are in
`tests/README.md`.

D10. The drawing does not change under a pressed button. While a mouse
  button is down the render field neither rebuilds for the selection nor for
  the focus, only follows the text; the release rebuilds. Revealing a block
  at the press moved the text under the pointer, so a click into an unfocused
  document selected a range, three pixels of wobble selected a line, and a
  double click chose the wrong word.

D11. Enter, Backspace, Delete, Tab and Shift+Tab are the editor's own.
  `markdown({addKeymap: false})`: lang-markdown's keymap was installed twice,
  the second time at high precedence, and CodeMirror's newline takes
  whitespace with `\s`, which deleted no-break spaces. The editor's commands
  call lang-markdown's where those do what a Markdown editor does, and decide
  per range, so two carets are answered each on its own. Backspace after the
  `## ` of a heading takes the whole mark, as it does after a list marker;
  the bench had this as a change of D2's spirit to be made with the owner
  watching, and it was made as the plan had it, open to being taken back.

D12. A link is a link when its label is defined. `links.js` replaces
  Lezer's LinkEnd alone: a shortcut, collapsed or full reference is a link
  only if the document defines its label, the definitions read off the whole
  input once per parse. The language sits in a Compartment and is taken up
  again when the set of definitions changes, since a reused fragment is never
  reparsed and a definition typed at the bottom makes links at the top.
  Emoji shortcodes are out of the parser: the export has no such extension.

D13. Containers are a frame on the line, not a class. The walk gathers, per
  line, the levels it stands in (quotes and callouts a bar and 17 px each,
  list items 1.5em of hanging indent), and emits one gradient of bars and one
  inset; a block drawn instead of its source takes the frame on a wrapper.
  The marker of an item is a widget in the hanging gap, its number computed.
  The same measures are in the page's stylesheet.

D14. The dialect: where Pandoc has a switch, or the copy that is rendered
  can be normalized, the export follows the editor; where not, the editor
  follows Pandoc. `commonmark_x` was ruled out as the export's reader: it has
  no citations, inline notes, grid tables or raw TeX. So the copy is given
  its blank lines and margins (`withBreaks`, with a twin in the awk of
  `bin/mdm`, tested on the same cases), the reader gains
  `autolink_bare_uris`, and the editor's parser gains Pandoc's footnotes,
  citations, attributes, spans and raw TeX (`pandoc.js`, `footnote.js`).

D15. Smart punctuation is drawn, not written. Widgets over the ASCII while
  a line is untouched, the source back under the caret, and the glyphs taken
  into the string for what is drawn from a string (a cell, a caption, an
  outline row). The rules of the quotes are those of Pandoc's reader, read
  off pandoc 3.8.3 on the test texts and not supposed: a tree-aware matcher,
  since an emphasis, a link's text, a span and a note are each one inline to
  Pandoc and a pair does not close across their edge.

D16. Two writers of one document are reconciled, not raced. Updates carry
  the document's version and edits the version they were based on; the host
  does not write an edit based on a version an outside change has moved past,
  it sends the document back, and the webview maps what is unconfirmed over
  the host's change and sends again. What the host writes is kept out of the
  webview's undo history. A save waits for the edit held back. The host
  writes the stretch that changed, never the whole document, and tells the
  webview where an outside change was made, which the two texts alone cannot
  say when a line goes in among lines like it.

D17. The decorations are rebuilt in part. They are a function of each
  top-level block's own text and nodes, the carets that touch it, the count
  of lines the host keeps back and the link definitions; so the set is kept,
  mapped through the changes, and only the blocks are rebuilt that a caret
  left or entered, that a change fell in, or over which the two trees
  differ. The whole is rebuilt when the number of lines changes (drawn rules,
  tables and empty cards carry their line's number), when the hidden count
  changes, when a definition is in what changed or the language is taken up
  again, and when the stretch is over half the document. A decoration belongs
  to a region by where it starts: the marker of an item whose text starts on
  the next line ends on that next line. `window.__mdm.checkDecorations`
  compares the set on screen with a whole rebuild, and
  `tests/webview-scale.test.js` asks it after every step.

D18. Characters that draw nothing are named under the caret only. Not
  CodeMirror's highlightSpecialChars, which marks the reading state too: a
  soft hyphen put in a word on purpose would stand as a dot in the prose and
  the row would part from the page's.

D19. **The digit is the level, and a letter names the block that has none**
  (2026-09-19, the owner's call, after a day with none). The rule: a letter
  changes words inside a line (`Ctrl+B`, `Ctrl+I`, `Ctrl+E`, `Ctrl+K`), and
  the second modifier of the code block changes what a line is. The digit is
  the heading's level, `Ctrl+Shift+1` to `6`, with `Ctrl+Shift+0` for the
  paragraph; a letter names the block that has no level. What is bound at
  the end of the day is `Ctrl+Shift+C` for the code block and `Ctrl+Shift+T`
  for the task list: the bulleted and numbered lists and the quote held `U`,
  `O` and `Q` for a day and gave them back, for the reason at the foot of
  this decision. Strikethrough keeps none, as in Word and Obsidian. `Cmd+Option` on a Mac,
  as the code block already was: macOS takes `Cmd+Shift+3`, `4` and `5` for
  its screenshots and `Cmd+Shift+Q` logs the account out. Notion's row was
  the other candidate and is where the 0 comes from; it spends 4 to 7 on the
  blocks because its headings stop at 3, and the six levels of a .mdm want
  the whole row. The bullets are on U and not L because `Ctrl+Shift+L` is
  `selectSelectionMatches` in CodeMirror's own search keymap.

  The code block held Notion's `Ctrl+Shift+8` for a day and lost it the same
  day, at the owner's word, for the symmetry: with C there is no exception
  left, every digit is a level and every block without one is a letter. Not
  E, the letter of its inline twin, because `Ctrl+Shift+E` is Show Explorer
  and is wanted far more often than the external terminal C takes; it never
  shipped on the digit, so nothing had to be migrated. Its button moved with
  it, out of the marks and to the head of the blocks, so that inline code
  and the code block stand on either side of the toolbar's separator: the
  cut the separator makes is the cut between a mark on words inside a line
  and what makes the line a block, which is the cut the keys make too. Weighed and not taken: `Ctrl+1`..`6`
  (Typora's, which is go to editor group N), a `Ctrl+M` prefix for
  everything (VS Code's own idiom, two strokes each), and the four classics
  alone. `Ctrl+Alt+<digit>` is out on any layout where AltGr is Ctrl+Alt: on
  the Spanish one `Ctrl+Alt+2` is the at sign, and brackets go the same way.

  **They are bound in the page's keymap, not as contributed commands**, and
  that is the whole mechanism. VS Code's webview host (its `pre/index.html`
  in 1.133.0) listens for keydown on the page's window in the bubble phase,
  does not look at `defaultPrevented`, and posts every key to the workbench
  as `did-keydown`, which is why `Ctrl+B` set bold and hid the Explorer at
  once. Each of these bindings carries CodeMirror's `stopPropagation`, so a
  key answered in the text never reaches that listener, and with the focus
  out of the text CodeMirror does not hear it and VS Code does. That is the
  owner's own proposal (a key is the editor's while the caret shows, VS
  Code's after a click in the dead margin) with nothing to keep in step: the
  command road would put the same rule in a `when` over a context key the
  page posts to the host, and a key pressed right after a click could be
  resolved against the old value. What that road still buys, if it is ever
  wanted: the commands in the Command Palette, and keys the reader can
  rebind. A second switch to disarm the whole set while a score is being
  edited (the Guitar Pro plan) is an `if` in the page here, and every one of
  these already leaves a score alone, since `setHeading` and the list
  commands skip the lines no mark belongs on.

  What the set takes from the workbench, read in 1.133.0's
  `workbench.desktop.main.js` and only while the caret is in the text: of
  `Ctrl+Shift+0` to `9` it binds 1 (replace, inside the search view) and 5
  (split, with the terminal focused), neither of which a .mdm can be in; of
  the letters, `Ctrl+Shift+T` is Reopen Closed Editor and `Ctrl+Shift+C`
  opens an external terminal. No built-in extension binds
  `ctrl+shift+<digit>`.

  The Paragraph row is back in the heading menu with the keys, after a day
  without it: at the keyboard there is no tick to read, so a hand that
  cannot see what level the line is needs one key that says paragraph
  whatever it was. The toggle a row and a key share (the level a line
  already is takes the heading off) is `applyHeading`, written once, and the
  name of a key is `shortcutLabel`, written once for the tip of a button and
  the right-hand column of a menu row.

  The highlight button that came after them (Pandoc's `[x]{.mark}`) takes
  no key: the letters that read as its own are spent or taken and the owner
  has not asked for one. An underline button stood beside it for a day,
  written the same way, and was taken off on the owner's call: a bracketed
  span leaks its class into any reader that is not Pandoc, and an underline
  is the typewriter's italic, which this editor does not need. The reading
  stayed (`.mdm-underline`), because the page underlines the span whether or
  not a button writes it. That also settles the one key either of them had a
  claim to: `Ctrl+U`, which Word, Docs and Notion spend on underline and
  CodeMirror's history keymap spends on `undoSelection`.

  The four that came in with the Insert menu take no key either: small
  caps, superscript, subscript and the menu itself. The pair has the one
  claim to a standard among them, and it is a divided one: Google Docs
  spends `Ctrl+.` and `Ctrl+,` on the two and Word spends `Ctrl+Shift+=`
  and `Ctrl+=`, both remembered and neither checked against a running copy,
  so nothing was spent on them. Neither do the six of the Insert group, which
  stood in a menu for a day and are buttons of the first row since the bar
  went to two.

  U, O and Q lasted a day. The owner took them off on 2026-09-19, and the
  reason he gave is that `- `, `1. ` and `> ` are so little to type at the
  head of a line that the chord bought nothing; what raised it is that
  `Ctrl+Shift+U` opened a `U+` prompt on his own desktop instead of the
  bullets. What was read out of the running copies while deciding: fcitx5's
  `libunicode.so` carries `Control+Shift+U` as the default of its "Type
  unicode in Hex number", beside `Control+Alt+Shift+U` for the search by
  character name, and no override sits in `~/.config/fcitx5/conf/`; and VS
  Code 1.133.0 binds that chord to nothing on Linux (Toggle Output is
  `primary: 3123` with a `linux` override to the chord `Ctrl+K Ctrl+H`),
  binds nothing anywhere to `Ctrl+Shift+Q` (3119), and keeps `Ctrl+Shift+O`
  for Go to Symbol in Editor (3117). So the three go to VS Code from the
  text now like any chord the page does not bind, which is what the tests
  press them for, and their buttons name no key: a tip that names a key the
  editor no longer answers is a tip that lies.

  Still open: a key has not been pressed on the owner's own keyboard inside
  a real VS Code window. The harness presses the whole set on the Spanish
  layout through CDP, which is where it matters (`Ctrl+Shift+2` arrives as
  `"` there and not as a 2; CodeMirror falls back to the key's base
  name by keyCode, so the binding is the digit and not the character).

Found on the way and settled:
inside VS Code the workbench replays Ctrl+Z into the page as
`document.execCommand("undo")` after the keystroke already reached the
editor, which would run the browser's native undo over CodeMirror's DOM on
top of CodeMirror's own (measured in Chrome by emulating the replay: it ate
the end of the line), so undo and redo are taken off `execCommand` in the
page; Ctrl+Z is answered in the text model under the custom editor as
well, and the host sends the text that undo left: the two undos agree on
the text but not always on where the change stood (the host writes an edit
over the stretch a comparison of the texts finds, and a line put in among
blank lines is found at the end of the run, where CodeMirror put it at the
head), and merging one over the other as two writers' changes took a line
more, on screen and in the file, so a text from the host that is the one
on screen is taken as agreement (2026-09-19, reported from VS Code with
the code block button on a blank line; the workbench's side is inferred
from that report and not read in its code, and emulating it in the harness
reproduces the lost line exactly); CodeMirror renders only the lines in
view, so the player is carried across its widget being rebuilt (by source, and by document position while
the block is off screen); widgets carry no CSS margin, since CodeMirror's
height map does not see it and vertical caret motion landed a line off; the
`$`-deleted state of a `$$` block is a plain paragraph (the Lezer extension
makes no node for an unterminated pair), which is what shows it as source.

## Phases (as executed)

1. Vendor build: `vendor-src/` with esbuild, committed `cm6.bundle.js`,
   KaTeX CSS and fonts, a `npm run vendor` script. Remove nothing yet.
2. Core editor in the webview: CM6 view over the document, sync with the
   host (300 ms debounce, `withFrontMatter` flag, convergence echo), undo,
   multicursor gestures, theme side. Dev-host probe that Ctrl+D/Alt+click
   reach the webview. Tests: sync round trip, multicursor.
3. Lezer extensions: math (inline, display), front matter, callouts; the
   reveal function; hidden marks and line decorations for prose. Tests:
   reveal per node, all ranges.
4. Block widgets: math (compile-gated), fenced code with highlighting,
   ABC scores with the player moved into the widget (block identity by
   position, player survives redraws through widget `eq`/`updateDOM`),
   images. Tests: the 33 player tests re-targeted, compile gate, literal
   `$` deletion.
5. Toolbar, settings buttons, palette, copy buttons, front matter mode,
   export. Tests: the settings/theme/copy groups re-targeted.
6. Remove Vditor and `transforms.js` fence mapping; byte-identical
   round trip of `example.mdm`; README and journal updated; mutation
   checks recorded in `tests/README.md`.
