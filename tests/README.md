# MDM regression suite

Tests that pin down the verified behaviour of the project: the editor in
the webview, the host↔webview protocol, the text mapping and the Quarto
render chain (HTML and PDF). They run on the native Node runner (>= 20), with no
frameworks.

## How to run

```sh
cd tests
npm install          # first time only (puppeteer-core, for the webview suite)
npm test             # everything
npm run test:fast    # unit only (transforms + host + theme + audio assets), < 1 s
npm run test:render  # Quarto integration only (HTML + PDF, ~20 s, compiles LaTeX)
npm run test:webview # the three webview suites in Chrome only (~3 min)
npm run test:html    # the rendered HTML page in Chrome only (~7 s)
```

Without npm: `node --test tests/transforms.test.js tests/extension-host.test.js tests/theme.test.js tests/render.test.js`
from the root. Careful: `node --test tests/` (the bare directory) does not
discover the files in this version of Node; the `.test.js` files have to be
passed. Both Chrome suites run with `--test-concurrency=1`: every test opens
a browser of its own and in parallel they trip over each other's waits.

## Layers

| File | What it pins down | Requires |
|---|---|---|
| `transforms.test.js` | 17 tests of `vscode-mdm/transforms.js`: the editor text is the file text, so what is pinned is the one thing the mapping does, the YAML header hidden and spliced back (the blank lines under it taken from the file, one put in when the file has none, a header-only file, a header without its trailing newline, CRLF kept), byte-identical round trips of `example.mdm` in both modes, fence info strings untouched in both directions, `toEditor` idempotent. | Node |
| `extension-host.test.js` | 34 tests of `vscode-mdm/extension.js` against a mock of the API (`mocks/vscode.js`): the settings allowlist against injection from `settings.json`, the Workspace/Global target when writing, the ready/update/edit protocol, the conditional echo (the first-Enter regression), the `withFrontMatter` flag travelling with the text, external and configuration changes, the syntax palette in the HTML and in the `palette` messages, dispose, and the audio wiring in the HTML (synth and soundfont URIs, the widget css, `unsafe-eval` and `connect-src` in the CSP). And export: it saves a dirty document before rendering (and leaves a clean one alone), runs `bin/mdm render <doc> [--to html|pdf]` from the document's folder (a fake shell bin/mdm records arguments and cwd), offers the Open HTML/PDF buttons that fit, shows the stderr if the renderer fails, and refuses a format that is not in the table (the value comes from the webview). | Node |
| `audio-assets.test.js` | 4 tests of the player's vendored assets: the copies of abcjs 6.7.0 and abcjs-audio.css under `vscode-mdm/media` byte-identical to those in `_extensions` (so they cannot drift), the bundle whole (engraver and synth both exported), the 88 keys A0–C8 of the piano present and carrying a real mp3, and the harness loading the same audio assets the real webview page does (abcjs as a plain script, the soundfont path, the stylesheet, the CM6 bundle). | Node |
| `theme.test.js` | 26 tests of `vscode-mdm/theme.js`: JSON with comments and trailing commas, TextMate scope matching (prefix by dot, the most specific wins, a tie goes to the last, selectors with a space ignored), the `include` chain, finding a theme by id and by `%nls%` label, sanitizing down to hex colours (those values go into the HTML of the webview), `tokenColorCustomizations`, and VS Code's built-in Monokai read from disk when it is installed. | Node |
| `render.test.js` | 6 tests of `bin/mdm` + `_extensions/mdm/mdm.lua`: the CLI guards, HTML (2 figures, `mdm-play`, escaping of `&`/`<`, abcjs deps, and that ` ```music ` is NO LONGER an alias), PDF (cache by sha1 of the source with its trailing newline, the `.w` sidecar, a BoundingBox trimmed and consistent with `.w`, a narrow score < 330 pt centred in the `.tex`, a wide one at `width=100%`, a warm cache that does not run abcm2ps again). It renders in `tests/tmp/` with symlinks to `_extensions/` and `tools/`; it never touches the repo. | quarto, TeX, gs |
| `webview-editing.test.js` | 32 tests of the CodeMirror editor itself (`vscode-mdm/media/main.js`), in a real Chrome on `webview/harness.html`: **multicursor** (Alt+click adds carets and typing lands at both; `editor.multiCursorModifier` = `ctrlCmd` turns that into Ctrl+click, live through a `settings` message; Shift+Alt+drag column; Ctrl+D twice; Ctrl+Shift+L; Ctrl+Alt+Down/Up; Escape; a multi-caret insert undone in one Ctrl+Z), **reveal** (a display equation hidden behind its KaTeX widget, its three source lines and the widget kept while a caret is in it, hidden again when it leaves; a broken equation as source with the broken edge when untouched and with KaTeX's message under it while edited, rendered the moment `}{b}` closes it; inline maths replaced or shown as `.mdm-math-src`; two carets open two equations at once; the `#` of a heading, the `**`, `*` and backticks of inline marks, the `-` of a bullet, the rule, the `>` of a quote and its continuation line, the callout classes by kind with the fence lines small until the caret is on them and nothing at all for an unclosed `:::`, the YAML header lines, the task checkbox flipping `[ ]` to `[x]` in the text), **literal delimiters** (Backspace on one `$` of a closing `$$` leaves a plain paragraph with the text in view and nothing regenerates it, the `$` retyped renders again, Ctrl+Z twice walks back; a backtick of a closing fence deleted and restored; `$$` and a formula typed from scratch end rendered), **sync** (the edit posted with the typed text and `withFrontMatter`, an external update before and after the caret leaves it on its word and posts no echo, the hidden-header mode), **commands** (Ctrl+B at two ranges wrapping and unwrapping, Ctrl+I at a caret, the heading button on three lines with `######` going back to a paragraph, Ctrl+Enter out of a fence onto a fresh line, ArrowDown and ArrowUp into a rendered equation, a click on the equation and on the score drawing landing at the start of the source) and the code chrome (the `python` label, the copy button shown on hover of a code line and gone when the pointer leaves, the fences revealed by a caret). | google-chrome |
| `webview-look.test.js` | 24 tests of the look and the settings of the editor, the old webview tests ported to the new DOM: typing inside the header keeps the caret and the text; code, scores and equations spaced like paragraphs (the blank line is the gap, above and below); a display equation rendered; the header button taking the editor to the top, on and off; the copy button copying the source and pulsing the block (every line of a code block, the `code.language-abc` of a score, which also loses its `%%staffwidth`) with no page selection and the caret left where it was; a setting with no colour in it not repainting; the theme menu listing what the host sent and a click asking for it; the three grounds (light/dark/white, the code on a floor darker than the page, measured on `.cm-editor` and `.mdm-code-line`); a title wider than its staff not cropped; an edited score keeping no card behind it and its widget rebuilt from the edited source; the alignment button; the ten `--mdm-syn-*` applied and spent (the YAML key and the Python `def` take the palette's attr and keyword colours, the fallbacks come back when the palette is from the other side, a `palette` message repaints live, a named theme brings its side); inline code on the card ground; staff lines grey by default and back to ink by the button (lit for ink), a darker grey on the dark side; the score fill menu with a tick, one value per side; clicking a rendered equation or score opening its source; an ordinary Delete inside a paragraph staying ordinary. | google-chrome |
| `webview-player.test.js` | 34 tests of the player and the toolbar, ported: a toggle on every score (and only there) left of the copy button, shown on hover; opening and closing the bar without opening the source, tooltips naming the destination; play sounding from the local soundfont (notes over `file://`, nothing to the network, the source staying shut); a byte-identical round trip with the player open; one player at a time; the bar surviving edits of its block and full external updates (and closing with no residue if the scores disappear); silent chord symbols; the session volume (a real GainNode on the playback path); the notes lighting up while they sound (brass per side, computed, no staff line lit) and the ink back on close; play with the source open and the document held still; tooltips following the state; the repeat button really painting; the chrome taking no syntax colour; the two faces of the speaker; stop; no focus box on the slider (the VS Code sheet injected); the volume set without closing the open source; the bar's discs and glyphs; the pointer answers; the filled track; the cursor told 16 times a beat; the sizes of the two little buttons; the progress drag (head under the pointer while the button is down, the tune landing where it is dropped, the clock not pulling the head away, the arrow keys, seeks before the tune is ready adding up in order, a scrub with the source open); resume in silence landing on the beat and a scrub inside the gap lifting it; export/undo/redo at the head of the bar with the rotating arrows and undo greyed on a fresh document; the three export entries posting their format; the output woken by a player and let go after the idle minute, and a hidden webview letting it go unless a tune sounds. | google-chrome |
| `html.test.js` | 5 tests of the **rendered** HTML page, in Chrome: what `_extensions/mdm/resources/mdm.js` does on load, which the pandoc output does not say. The three blocks engraved; only the narrow one wrapped in `.mdm-fit` with its `max-width` and centred; the gap under the score equal to the height of the drawing (the percentage padding fix plus `height:0`); the audio controls on the `.play` block only (three buttons, `abcjs-inline-audio`); no script errors. Verified to bite: commenting out `height: 0 !important` fails the gap test, and removing the `.mdm-fit` wrapper fails two. | quarto, google-chrome |
| `../vscode-mdm/vendor-src/test/markdown.test.js` | 31 tests of the three Lezer Markdown extensions that go into the CodeMirror bundle (run with `npm test` inside `vscode-mdm/vendor-src/`, which needs its own `npm install`): maths by Pandoc's rules (`$` not followed by a space, not closed before a digit, `\$` escaped, the first unescaped `$` the only closer, `$$` inline display, a `$$` block over several lines with its exact ranges on `example.mdm`, in a quote and in a list, content never parsed as Markdown, every unterminated form left as a paragraph), the YAML header only at position 0 and only when closed (with YAML nodes mounted inside), and the callouts (both opener forms, the closer, kinds, nesting, unterminated gives no node, `calloutKind`). | Node |

The expected values come from real measurements: the `.w` widths of
`example.mdm` are 378 / 512 / 143 pt, and a "wide" fixture block needs two
systems (512 pt), because the crop is to real ink and a lone bar with a
short title stays around 275 pt. abcm2ps 8.14.15 does not emit
`%%HiResBoundingBox` (the rewrite in `mdm.lua` is defensive).

## Traps of the webview harness

Measured and current, to be respected when cases are added. The editor is
CodeMirror 6 and the page exposes it as `window.__mdm.view` (plus the
bundle as `window.__mdm.CM`); `webview/helpers.js` wraps the common moves
(`open`, `update`, `lastEdit`, `setSelection`, `selectionRanges`, `posOf`,
`docText`, `coordsAt`, `lineAt`). CodeMirror renders only the lines in view
plus a margin, so `open()` launches a 2400 px tall window: in a short one
the scores further down simply do not exist in the DOM and `update()` waits
for its three SVGs for ever. A widget scrolled out of view is destroyed and
built again on the way back (the player bar is carried across). What is
rendered depends on the carets: put them with `setSelection` (the arrows
would do the same) and read the lines with `lineAt`; a block is "open" when
a selection range overlaps or touches its lines, so a caret at the very end
of the line above does not open it and one at the start of its first line
does. The hidden source of a rendered block is a `div[contenteditable=false]`
with no class and zero height between the lines. The chrome of a block (copy,
player toggle) is drawn at opacity 0 and shown on hover: read
`getComputedStyle(el).opacity`, never `display`; the code chrome rides the
first code line as an inline widget and main.js marks it `mdm-chrome--show`
on `mouseover` of any line of the block. Tooltips are `.mdm-tip` pseudo
elements drawn from `aria-label`. Puppeteer clicks made less than ~500 ms
apart at nearby points count as a double click in Chrome (word selection):
space Alt+clicks by 600 ms. The host messages come in through
`window.postMessage`, the same channel VS Code uses, and an `update` that
arrives while an edit is debounced (300 ms) is dropped, so wait for
`lastEdit` before posting one. `open()` takes `scores: 0` for a document
with no scores and `text` for a fixture; `harness.html` seeds
`window.__settings/__palette/__side/__themes` with `evaluateOnNewDocument`
and leaves a `window.__toHost` hook for running the real `extension.js` in
Node; nothing uses it today.

## Mutation checks

Every round of tests is verified by breaking what it protects, running the
test, restoring and checking the file is back, in one command. The round of
2026-08-20 (the move to CodeMirror) recorded these, all caught:

- Lezer extensions: the digit rule of inline maths removed; `cx.lineStart
  != 0` of the header removed; the innermost-callout check disabled; the
  callout closer look-ahead removed; the block maths `endLeaf` removed.
- `webview-editing`: `touchedBy` always false (the display-equation test);
  the caret modifiers swapped (Alt+click and ctrlCmd); `Mod-b` wrapping in
  `__`; `replaceText` replacing the whole document (the external-update
  caret test); `leaveBlock` inserting one newline; the chrome language
  label forced to `text`; `cycleHeading` inserting `- `; `stepIntoBlock`
  never finding a block; the error class of a broken equation dropped.
- `webview-look`: left-aligned scores keeping `margin: 0 auto` (style.css);
  `applyPalette` using a palette from either side; the scroll to top after
  the header toggle disabled; inline code on the page ground (style.css);
  the staff button lit on `gray`; `revealBlock` returning at once.
- `webview-player`: `#app .mdm-score:hover .mdm-chrome` renamed
  (style.css); the toggle label "Hide player" changed; the `.mdm-audio`
  guard removed from `handleChromeClick` (pressing play opened the source);
  the slider pinned to 100; `ArrowRight` stepping 3 %; the export entries
  renamed.
- Host and transforms: covered by their own assertions on the new text
  mapping (the `multiCursorModifier` key, the CSP without `unsafe-eval`, the
  bundle in the page, the converged echo on blank lines typed under a
  hidden header).

## Pending

1. `h.errors` is asserted empty in many tests but not all; moving it to the
   helper's `close()` would cover the rest for free.
2. Images (`![alt](path)` shown as a widget from the document's folder) have
   no test: the harness passes an empty `MDM_DOC_BASE`.
3. The keyboard path inside a real VS Code window (the webview host replays
   the workbench `undo` into the page as `execCommand("undo")`, which the
   editor now ignores; copy, paste and select-all replayed the same way) is
   covered in Chrome by emulating the replay, not in VS Code itself.
4. The three webview files share `webview/helpers.js`; a cold-start flake
   was seen once (the first `open()` of a run timing out on its three SVGs)
   and not reproduced.
