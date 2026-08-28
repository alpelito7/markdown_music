# Moving the MDM editor to CodeMirror 6

Status: implemented (2026-08-20) and merged into `main`, tagged
`v0.2.0-cm6-editor` (2026-08-24). The nine
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
  Outline, insert-before/after and the table button are gone.

D5. Tables: **(a)**, the source as a monospace grid, editable with
  multicursor; no widget.

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

Found on the way and settled:
inside VS Code the workbench replays Ctrl+Z into the page as
`document.execCommand("undo")` after the keystroke already reached the
editor, which would run the browser's native undo over CodeMirror's DOM on
top of CodeMirror's own (measured in Chrome by emulating the replay: it ate
the end of the line), so undo and redo are taken off `execCommand` in the
page; CodeMirror renders only the lines in view, so the player is carried
across its widget being rebuilt (by source, and by document position while
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
