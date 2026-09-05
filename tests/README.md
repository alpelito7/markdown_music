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
npm run test:fast    # unit only (transforms + host + theme + audio assets + packaging), < 1 s
npm run test:render  # Quarto integration only (HTML + PDF, ~20 s, compiles LaTeX)
npm run test:webview # the three webview suites in Chrome only (~3 min)
npm run test:html    # the rendered HTML page in Chrome only (~7 s)
```

Without npm: `node --test tests/transforms.test.js tests/extension-host.test.js tests/theme.test.js tests/audio-assets.test.js tests/packaging.test.js tests/render.test.js`
from the root. Careful: `node --test tests/` (the bare directory) does not
discover the files in this version of Node; the `.test.js` files have to be
passed. Both Chrome suites run with `--test-concurrency=1`: every test opens
a browser of its own and in parallel they trip over each other's waits.

## Layers

| File | What it pins down | Requires |
|---|---|---|
| `transforms.test.js` | 17 tests of `vscode-mdm/transforms.js`: the editor text is the file text, so what is pinned is the one thing the mapping does, the YAML header hidden and spliced back (the blank lines under it taken from the file, one put in when the file has none, a header-only file, a header without its trailing newline, CRLF kept), byte-identical round trips of `example.mdm` in both modes, fence info strings untouched in both directions, `toEditor` idempotent. | Node |
| `extension-host.test.js` | 60 tests of `vscode-mdm/extension.js` against a mock of the API (`mocks/vscode.js`): the settings allowlist against injection from `settings.json` (and the clamp of `mdm.outlineWidth`, the one setting that is a number), the Workspace/Global target when writing, the ready/update/edit protocol, the conditional echo (the first-Enter regression), the `withFrontMatter` flag travelling with the text, external and configuration changes, the syntax palette in the HTML and in the `palette` messages, dispose, and the audio wiring in the HTML (synth and soundfont URIs, the widget css, `unsafe-eval` and `connect-src` in the CSP). And export: it saves a dirty document before rendering (and leaves a clean one alone), runs `quarto render <doc>.qmd [--to html|pdf]` from the document's folder (a fake `quarto` on a PATH holding nothing else records arguments, cwd and the copy it was handed), makes that copy point at the filter the extension ships and leaves the `.mdm` untouched, drops the copy afterwards whether the render worked or not, keeps `format-links` when the document asks for them, names both formats on the command line when both were asked for (a header that declares none used to come back with the HTML alone), offers the Open HTML/PDF buttons that fit, and refuses a format that is not in the table before starting a process (the value comes from the webview). And the light half of it: with no `quarto` on the PATH the notification names Quarto and the log says where to get it, a PDF of a document with scores names both engravers (neither a Chrome nor abcm2ps on the PATH) with the install lines, exports with a Chrome alone (abcm2ps is only the fallback), is waved through when the header names an `mdm.chrome` for the filter to resolve, while one without scores renders anyway, a failed render puts Quarto's whole output in the MDM channel and the "Show log" button opens it, and a `.qmd` already in the way stops the export instead of being overwritten. The header rewrite is checked on its own (block list, flow list, a header with no `filters` key, no header at all, a quote in the path), and so is the dialect written beside it (a header gains it, a document that names a `from:` of its own at the top level or under a format keeps it, and a line of the body that opens with `from:` is prose); so is the fence test that decides whether a score is there, and the filter the extension carries is compared file by file with `_extensions/mdm`. And the look that rides with an export: the side of a named theme, of the three fixed values and of the workbench while on `auto`, the three score settings, the palette spelt without its `#`, and a palette from the other side left behind. And the rule the copy draws: a line of dashes with a line straight under it gets the blank line Pandoc needs, put in the copy and never in the document, with the fences it must not reach inside stepped over. And the two bases an image path hangs from: the folder of the document and the root of its filesystem in the HTML, with the resource roots that make them loadable, and neither of the two for a document that is not a file on disk. The export is named after the document's stem whatever its extension (a `.md` opened through "Open With" used to come out as `notes.md.qmd` and `notes.md.html`). | Node |
| `audio-assets.test.js` | 4 tests of the player's vendored assets: the copies of abcjs 6.7.0 and abcjs-audio.css under `vscode-mdm/media` byte-identical to those in `_extensions` (so they cannot drift), the bundle whole (engraver and synth both exported), the 88 keys A0–C8 of the piano present and carrying a real mp3, and the harness loading the same audio assets the real webview page does (abcjs as a plain script, the soundfont path, the stylesheet, the CM6 bundle). | Node |
| `packaging.test.js` | 5 tests of what the published package carries and claims, which using the editor cannot catch: the `LICENSE` of the repository and the copy of it inside `vscode-mdm/` (vsce reads the one in the package root) byte for byte and against the `license` field of the manifest, every package listed in the bundle's `VERSIONS.json` credited by name and version in both notices files (so a `npm run vendor` that pulls in a new dependency fails until somebody credits it), the licences the extension's notices have to name (abcjs, CodeMirror, KaTeX, and the share-alike of the Musyng Kite soundfont, which is an obligation and not a courtesy), the repository's notices covering a local abcm2ps build when one sits in `tools/bin/` (none is tracked; the check skips without one) with the LGPL and GPL texts present in `licenses/` and the upstream source named, and the note beside the samples agreeing with the notices on the licence. | Node |
| `theme.test.js` | 26 tests of `vscode-mdm/theme.js`: JSON with comments and trailing commas, TextMate scope matching (prefix by dot, the most specific wins, a tie goes to the last, selectors with a space ignored), the `include` chain, finding a theme by id and by `%nls%` label, sanitizing down to hex colours (those values go into the HTML of the webview), `tokenColorCustomizations`, and VS Code's built-in Monokai read from disk when it is installed. | Node |
| `render.test.js` | 32 tests of `bin/mdm` + `_extensions/mdm/mdm.lua`: the CLI guards, HTML (2 figures, `mdm-play`, escaping of `&`/`<`, abcjs deps, and that ` ```music ` is NO LONGER an alias), PDF with the default engraver, the editor’s own abcjs loaded into a headless Chrome and printed to a vector PDF then trimmed with pdfcrop (a cache entry under its own `abcjs` digest with the `.w` sidecar, nothing of the EPS pipeline left beside it and no abcm2ps fallback tripped, `%%staffwidth 200pt` coming out 132 pt of ink and centred, the wide score at the text width, an inkless block refused by its zero-ink bbox and falling all the way back to source text), the equations set by the vendored KaTeX through the same Chrome (a `.pdf` and a `w h d pw ph` `.dim` sidecar per formula on the 8 px pagelet grid, the inline one inserted in a `\makebox`+`\raisebox` that lands it on the baseline, the display one centred in its band, and `mdm-engraver: abcm2ps` leaving every formula to LaTeX), and the abcm2ps pipeline forced by `mdm-engraver: abcm2ps` where its EPS internals are what is pinned (cache by sha1 of the source with its trailing newline, the `.w` sidecar, a BoundingBox trimmed and consistent with `.w`, a narrow score < 330 pt centred in the `.tex`, a wide one at `width=\mdmscorewidth`, a warm cache that does not run abcm2ps again, and a tune naming neither `X:` nor `K:` engraved all the same (forced to abcm2ps: abcjs falls back by itself), with the `X:1` and the `K:C` the engraver wants written into the cached `.abc` while the cache keeps the name of the block as it was written), the fill and the alignment a score is given (a box in the paper of the side, the padding given back so a score at the text width still fits the measure, and the narrow score centred or lined up left), a score of several staff systems cut into one clipped image per system so that a page can break between two of them where the engraving is already blank (the `.cuts` sidecar the engraver writes, one position per gap and each below the one before it; the trims of the slices tiling the drawing exactly, all of them the one image at the text width, in a single band and stack; and a twelve-system score, 856 pt against the 622.7 pt a page holds, coming out over two pages, where the same drawing with its sidecar taken away goes down whole and needs three), the title block drawn only when the header is on screen (`mdm-front-matter:hidden` takes the title, the subtitle and all three of the keys Quarto keeps the author under, in HTML and in the TeX), the typography of the page (the maths at KaTeX's 1.21 and code at the stylesheet's 0.88, ragged right and microtype's expansion off, with the opening paragraph of `example.mdm` breaking after `source` as it does in the editor, read back with ghostscript's txtwrite, and a document naming its own `mathfont` left unscaled), the measure of the page (the editor's 51.25 ems where the paper holds them, the clamp where it does not, and a document with a `geometry` of its own left alone, each read back out of the finished PDF with ghostscript's txtwrite, since the look paints the sheet and the ink of a rule cannot be measured against it), the colours an engraving is drawn in (the ink of the side at the head of the EPS, the grey of the staff lines around the run that draws them, none of it when the staff is asked for in ink, and a cache entry per pair of colours), the dialect the copy is read in (a heading under a paragraph and under the closing fence of a score, and a quote under a paragraph, all of them blocks and not text, while a document naming its own `from:` is left in Pandoc's), and the look block the filter writes on `html:root`: it rides on every HTML render, music or no music (and drags no abcjs along when there is none), it reads the `-M mdm-*` metadata, and it lets nothing else through (a colour by name, a value carrying CSS of its own or a `</style>`, a side or an alignment that is not on the list, all dropped for the fallback), and the margin block of the other formats, which `bin/mdm` turns off (a document declaring html and pdf renders without it, and one that says `format-links: true` keeps it). And the same look on paper, read off the `.tex`: the light side and the fallback palette written out slot by slot when nothing is passed, the ground and the ink of the side that is, the ten slots over Pandoc's token commands with no bold left on them, the sans, the heading sizes and the hairline colour, and a document with no code block at all compiling all the same (Pandoc writes the token commands only for one that has code, so the block that repaints them asks for them first). And what a page and a paper make of a figure: an image named by an absolute path copied into the cache and pointed there, in the HTML and in the TeX, since Quarto rewrites such a path into a relative one that points at nothing. And the engine the formulas are set with: KaTeX, its faces and `mdm-math.js` riding with the page as a dependency, the formulas left as their own LaTeX in a span for it to set, no CDN and no MathJax anywhere, and the whole engine inside the file when the document asks for a self-contained page. It renders in `tests/tmp/` with symlinks to `_extensions/` and `tools/`; it never touches the repo. | quarto, TeX (gs, pdfcrop), google-chrome, abcm2ps (in `tools/bin/` or the PATH) |
| `webview-editing.test.js` | 42 tests of the CodeMirror editor itself (`vscode-mdm/media/main.js`), in a real Chrome on `webview/harness.html`: **multicursor** (Alt+click adds carets and typing lands at both; `editor.multiCursorModifier` = `ctrlCmd` turns that into Ctrl+click, live through a `settings` message; Shift+Alt+drag column; Ctrl+D twice; Ctrl+Shift+L; Ctrl+Alt+Down/Up; Escape; a multi-caret insert undone in one Ctrl+Z; a click that closes an open block moving only the caret that was in it, and a drawing clicked with the modifier down adding a caret instead of replacing them all; an Alt release that followed a mouse press held back from the host's key forwarder, with a bare tap still forwarded), **reveal** (a display equation hidden behind its KaTeX widget, its three source lines and the widget kept while a caret is in it, hidden again when it leaves; a broken equation as source with the broken edge when untouched and with KaTeX's message under it while edited, rendered the moment `}{b}` closes it; inline maths replaced or shown as `.mdm-math-src`; two carets open two equations at once; the `#` of a heading, the `**`, `*` and backticks of inline marks, the `-` of a bullet, the rule, the `>` of a quote and its continuation line, the callout classes by kind with the fence lines small until the caret is on them and nothing at all for an unclosed `:::`, the YAML header lines, the task checkbox flipping `[ ]` to `[x]` in the text), **literal delimiters** (Backspace on one `$` of a closing `$$` leaves a plain paragraph with the text in view and nothing regenerates it, the `$` retyped renders again, Ctrl+Z twice walks back; a backtick of a closing fence deleted and restored; `$$` and a formula typed from scratch end rendered), **sync** (the edit posted with the typed text and `withFrontMatter`, an external update before and after the caret leaves it on its word and posts no echo, the hidden-header mode), **commands** (Ctrl+B at two ranges wrapping and unwrapping, Ctrl+I at a caret, the heading button on three lines with `######` going back to a paragraph, Ctrl+Enter out of a fence onto a fresh line, ArrowDown and ArrowUp into a rendered equation, a click on the equation and on the score drawing landing at the start of the source) and the code chrome (the `python` label, the copy button shown on hover of a code line and gone when the pointer leaves, the fences revealed by a caret). | google-chrome |
| `webview-look.test.js` | 39 tests of the look and the settings of the editor, the old webview tests ported to the new DOM: the memory of the toolbar (an editor opened on a seeded `mdm.outline`, `mdm.outlineWidth` and `mdm.multicursorMatch` comes up with the panel open at that width, both buttons lit and Ctrl+D matching inside words with nothing clicked, and a press asks for the other side; a width wider than the pane is narrowed to fit without writing anything back and grows again when there is room); typing inside the header keeps the caret and the text; code, scores and equations spaced like paragraphs (the blank line is the gap, above and below); a display equation rendered; the header button taking the editor to the top, on and off; the copy button copying the source and pulsing the block (every line of a code block, the `code.language-abc` of a score, which also loses its `%%staffwidth`) with no page selection and the caret left where it was; a setting with no colour in it not repainting; the theme menu listing what the host sent and a click asking for it; the three grounds (light/dark/white, the code on a floor darker than the page, measured on `.cm-editor` and `.mdm-code-line`); a title wider than its staff not cropped; an edited score keeping no card behind it and its widget rebuilt from the edited source; the alignment button; the ten `--mdm-syn-*` applied and spent (the YAML key and the Python `def` take the palette's attr and keyword colours, the fallbacks come back when the palette is from the other side, a `palette` message repaints live, a named theme brings its side); the source of an open score painted in the extension's own brass on both sides (the seven roles measured on the `mdm-abc-*` spans, the notes and the `abc` of the fence in the brass of `--mdm-play-accent`, the staff ink on the line itself so the plumbing takes no theme colour, the lyrics italic, and a seeded palette spent on the Python block but never on the score); inline code on the card ground; staff lines grey by default and back to ink by the button (lit for ink), a darker grey on the dark side; the score fill menu with a tick, one value per side; clicking a rendered equation or score opening its source; an ordinary Delete inside a paragraph staying ordinary; the copy button's "Copied" held for a beat and then put away, with the tooltip back for the next hover; and the blank line between two paragraphs drawn an em tall (the space a rendered page leaves between paragraphs) while the blank lines of a fence keep the height of a line of code. Tables: a pipe table drawn as a table with the alignment its second row asks for, the maths of its cells set by KaTeX and their marks kept, its source out of the flow until a caret is in it and the drawing left standing as the preview while it is, and a click landing on the cell it was on, with the page held where it was rather than sliding down by the height the source took. Images: a relative path hanging from the folder of the document and an absolute one from the root of the filesystem, not from the folder with the path glued behind it, and a figure that carries the pointer and opens its source when it is clicked. | google-chrome |
| `webview-player.test.js` | 50 tests of the player and the toolbar, ported: a toggle on every score (and only there) left of the copy button, shown on hover; opening and closing the bar without opening the source, tooltips naming the destination (and the same on the first click of a file that opens on a score, where the untouched selection sits at character 0: the bar keeps a document that is already somebody's and makes none somebody's); play sounding from the local soundfont (notes over `file://`, nothing to the network, the source staying shut); a byte-identical round trip with the player open; one player at a time; the bar surviving edits of its block and full external updates (and closing with no residue if the scores disappear); silent chord symbols; the session volume (a real GainNode on the playback path); the notes lighting up while they sound (brass per side, computed, no staff line lit) and the ink back on close, every voice of a duet lit at once on its own staff (a treble part over a bass one, both accented, at every moment of the tune), and a written silence lit like a note while the cursor crosses it, the rest one hand holds alone included: it is a moment where nothing attacks, so the silent gap a seek opens runs straight over it to the next sounding note, and the rest used to be painted after its own moment had gone by (the crossing sampled frame by frame, in brass, with the line over the drawing; and the same ink under a head parked on the rest); the brass cursor that walks the engraving while the tune sounds, gliding between attacks instead of hopping note to note (sampled frame by frame: never backwards within a line, no note-sized jumps, distinct positions most frames, the lit note never ahead of it, the system spanned top to bottom), frozen in place by a pause, taken away by stop and by the headphones closing, parked by musical time, not by the drawing, where a head is dropped before the first play (Home walks it back to the first note, which lights), and following the held head live, both ways, clock or no clock, without blinking out in the gap between the release and the seek it asks for (presence sampled every frame from the release itself); a grab on the head muting a sounding tune for the whole drag (the transport runs on; the release's seek lands the sound under the new head through the usual silent gap, gain and ink back together) and putting the brass out, sounding or paused, while a tune the user paused themselves stays paused after the release; play with the source open and the document held still; tooltips following the state; the repeat button really painting; the chrome taking no syntax colour; the two faces of the speaker; stop; no focus box on the slider (the VS Code sheet injected); the volume set without closing the open source; the bar's discs and glyphs; the pointer answers; the filled track; the cursor told 16 times a beat; the sizes of the two little buttons; the progress drag (head under the pointer while the button is down, the tune landing where it is dropped, the clock not pulling the head away, the arrow keys, seeks before the tune is ready adding up in order, a scrub with the source open); resume in silence landing on the beat and a scrub inside the gap lifting it; export/undo/redo at the head of the bar with the rotating arrows and undo greyed on a fresh document; the three export entries posting their format; the output woken by a player and let go after the idle minute, and a hidden webview letting it go unless a tune sounds; and the keyboard: opening a player hands the focus to its bar, where Space plays and pauses (and neither press reaches the document or opens the score), Escape and closing give the keyboard back to a text that had it, while a bar opened on a document nobody was in gives it back to nobody, Ctrl+S goes on rising to the window with the bar focused (where the webview preload forwards it to the workbench: stopped at the bar, the file would not save) while Backspace, Delete, Enter, a letter, ArrowDown and Ctrl+B leave the text byte for byte as it was, and a caret in the text keeps Space for the text with the player still open. The headphones also put their tooltip away on a pointer click, so the half of the toggle that is no longer on offer is not left showing under a pointer that has not moved, and bring it back when the pointer leaves and returns; a click from script, which has no pointer resting anywhere, leaves it alone. | google-chrome |
| `html.test.js` | 9 tests of the **rendered** HTML page, in Chrome: what `_extensions/mdm/resources/mdm.js` and `mdm-look.css` do on load, which the pandoc output does not say. Every block engraved and boxed in a `.mdm-fit`, only the narrow one pinned to a `max-width` and centred; the gap under the score equal to the height of the drawing (the percentage padding fix plus `height:0`); the audio controls on the `.play` block only (three buttons, `abcjs-inline-audio`); no script errors. And the look: the editor's ground with the code card darker than the page, its 16px at 1.7 and its 820px measure, code at 0.88em in the fallback palette with no bold keywords and the line wrappers in the base colour, inline code on the card, and the player bar redrawn (a 30px pill on the card, round 24px buttons, Play/Stop/Repeat, a 4px track with an 11px head and its fill written, the clock at 11px, the volume). A second render carries the look of a dark editor (`-M mdm-look:dark` and the rest) and checks it arrives: the ink, Monokai's colours, the fill under the scores, staff lines back in ink and scores lined up left. Verified to bite: commenting out `height: 0 !important` fails the gap test, dropping the `body` from the player rules hands the bar back to abcjs's own stylesheet, and engraving the first pass without `staffwidth` pins every score to abcjs's own page width. | quarto, google-chrome |
| `../vscode-mdm/vendor-src/test/markdown.test.js` | 32 tests of the three Lezer Markdown extensions that go into the CodeMirror bundle (run with `npm test` inside `vscode-mdm/vendor-src/`, which needs its own `npm install`): maths by Pandoc's rules (`$` not followed by a space, not closed before a digit, `\$` escaped, the first unescaped `$` the only closer, `$$` inline display, a `$$` block over several lines with its exact ranges on `example.mdm`, in a quote and in a list, content never parsed as Markdown, every unterminated form left as a paragraph), the YAML header only at position 0 and only when closed (with YAML nodes mounted inside), and the callouts (both opener forms, the closer, kinds, nesting, unterminated gives no node, `calloutKind`). | Node |
| `../vscode-mdm/vendor-src/test/abc.test.js` | 15 tests of the ABC notation stream mode that colours the source of ```` ```abc ```` fences (same runner as the row above): the field labels with their three kinds of value (text, structured, lyrics, an unknown letter read as text, the `+:` continuation), `\%` escaped and `%` ending a field line, the bars of a `w:` line, inline `[M:3/4]` fields, pitches with accidentals, octave marks and lengths, rests dim with their lengths, broken rhythm and tuplets as time, slurs/ties/chord brackets left in the base ink, the whole bar family with variant endings, decorations long and short with grace braces (a lone `!` the old line break), chord symbols closed or cut short by the line, comments and `%%directives`; and the seat in the fence languages: ```` ```abc ```` reaches the mode, the Quarto info string `{.abc .play}` matches too, and a stream-mode fence (```` ```r ````) parses instead of throwing, the regression of the bare `StreamLanguage` that used to be handed to `LanguageDescription`. | Node |

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
Node; nothing uses it today. It also opens with the part of VS Code's own
webview sheet the editor has to outrank (`@layer vscode-default`, the
scrollbar rules, with the host on a dark theme). Without it the harness draws
bars no webview ever draws, which is how a bar that the editor was losing to
the host inside VS Code came out right here three reports running.

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

The parity round of 2026-08-21 (bugs found against the Vditor version on
`main`) added these, all caught:

- `webview-look`: the gray staff-lines rule dropped from `.abcjs-staff
  path` (left on the group alone). abcjs 6 draws the five lines as `<path>`
  children carrying `fill="currentColor"`, which a fill on the group does
  not override; the check now reads a path, so the group-only rule fails it.
- `webview-editing`: heading spacing drawn with `margin-top` instead of
  `padding-top` (a line drifts 43 px from the height map, so a click on the
  lower half of a paragraph lands on the next line).

The outline test (the button lists the headings and jumps to the one picked,
with the empty note for a document with none) is not mutation-checked by a
one-line break; removing the `outline` entry from the toolbar specs is the
mutation, and the test throws on the missing button.

The second parity round of 2026-08-21 (more regressions the user reported from
VS Code) added these, all caught:

- `webview-look`: the drop-down background taken from
  `--vscode-editorWidget-background` again (dark on dark ink when mdm.theme
  holds the editor light under a dark VS Code theme); the selection layer left
  at CodeMirror's default z-index (a selection inside a code card is hidden
  under it, so Ctrl+D matches in a code comment show nothing).
- `webview-editing`: the inline-math preview widget dropped (no live render
  beside the source while editing); `selectNextOccurrenceMaybe` pinned to
  whole-word (the Ctrl+D substring toggle does nothing); `toggleOutline` never
  adds `mdm-outline--open` (the outline panel does not open). This round also
  watched the `dismissFromGutter` listener on the scroller, which the fourth
  round retired along with its test.

The outline was also rebuilt as a side panel down the left edge (the Vditor
shape the user missed), replacing the earlier drop-down; its test asserts the
panel, the leading button, the marked section and that it stays open on a pick.

The third round added LaTeX syntax highlighting to the maths source: a stex
overlay (parseMixed) on the *MathContent nodes, so the body of an inline or
block equation is coloured by the same palette as code while its source shows.
Mutation checks: the `wrap` removed from `mdmMath` (the vendor-src mount test
`inline math: the LaTeX overlay is mounted over a control sequence` fails); the
`tags.tagName` rule dropped from `mdmHighlight` (the webview test `the LaTeX of
a shown equation is syntax-highlighted` fails, a control sequence loses its
keyword colour). The bundle (`media/vendor/cm6/cm6.bundle.js`) must be rebuilt
with `npm run vendor` in `vscode-mdm/vendor-src/` after any change under
`vendor-src/src/`; the webview tests run against the built bundle, the
vendor-src tests against `src/` directly. The vendor-src math tests were also
made content-based (they located `$$`/`$L$` by line number, which broke when
example.mdm lost some blank lines).

The fourth round of 2026-08-23 (five more reports from VS Code) added these,
all caught:

- `webview-look`: the `color-scheme` rules on `#app` removed (the editor takes
  the scheme VS Code stamps on the webview root, so under a dark VS Code with
  mdm.theme light the browser draws its own scrollbars dark: black bars down
  the side and along the bottom of a drop-down, on a light panel).
- `webview-editing`: `matchTip()` pinned to one string (the Ctrl+D button says
  the same thing whichever way it is set).
- `webview-editing`: the `deadMargin` listener removed from `view.dom` (a click
  in the strip of pane beside the text is answered again, since CodeMirror
  listens on its scroller); and `.cm-content` given back a `max-width` of 920px
  with 50px of padding (its box stands 50px out from the text again, so the
  edge a click stops at and the edge the pointer changes at are no longer the
  same one). The margins were made uniformly live earlier the same day and then
  dead, which is the decision that stands.
- `webview-editing`: the `dismissOpenBlock()` call taken out of `deadMargin` (a
  click in the margin leaves whatever is open for editing open, instead of
  taking the caret out of it so the drawing comes back); and the fallback of
  `positionOutside` put back to the start of the block's own first line, where
  the old gutter handler left the caret (a block that ends the document counts
  as touched from there, so it stays open).
- `webview-player`: the seek wrapper on `controller.seek` reduced to
  `clearResumeHold()` (a head dropped inside a chord marks the chord after it
  and plays that chord's tail with no attack); the `at - here.milliseconds <=
  25` guard dropped from `scheduleSilentGap` (a silence is put in front of a
  note's own attack, the top of the tune included). The second needs a primed
  tune to show: before the first play the timer holds no note timings, so
  nothing is scheduled either way, which is why the test presses play, stops
  and presses again.
- `webview-player`: the rewind of the stop button put back in the tick of the
  pause it follows (abcjs writes down where it paused after that click returns,
  so the rewind is undone: the clock, the head and the ink go back to the top
  and the next play sounds from where the tune was stopped).

The fifth round of 2026-08-23 (five more reports from VS Code) added these,
all caught:

- `webview-look`: the `::-webkit-scrollbar-thumb` rule removed (the bars go
  back to being the browser's, which draws them from the colour scheme of the
  host and put black bars on a light panel). That rule is gone now, and with
  it the mutation: see the third report of the same bar below.
  `scrollbar-gutter: stable` removed
  from `.mdm-menu` (the room the vertical bar takes comes out of the panel's
  width again); the `box-shadow` put back on `.mdm-menu`.
- `webview-editing`: `makeOutlineGrip` never called (the outline's width is
  fixed at 250px again); the `dismissFromOutside` listener removed from the
  document (a click on the outline or the toolbar leaves open for editing
  whatever was open); the language tag put back into `CodeChromeWidget` (the
  corner of a code block names its language beside the copy button).

The sixth round of 2026-08-23 added these, both caught:

- `webview-player`: the 26px `height` taken off `#app .mdm-score .mdm-chrome`
  (the buttons ride over the top right of the engraving again, and a score
  scaled down to a narrow pane brings its last chord symbol up under them);
  `markNoteAt` marking `noteAt` rather than what `soundFrom` says will sound
  (a head dropped inside a chord marks that chord, when what follows from
  there is the silence and the chord that is due should light when it sounds).

Space on the open player (2026-08-23) added these, both caught:

- `webview-player`: the `bar.focus()` taken out of the headphones branch of
  `handleChromeClick` (the bar never holds the keyboard, so Space does
  nothing and the test times out waiting for the tune to start); the
  `at.isContentEditable` guard dropped from `playerTakesSpace` (a space typed
  into the document plays the tune instead of reaching the text). The second
  is the trap of the feature: the bar is a widget of the editor and so hangs
  inside `.cm-content`, the element a caret focuses, so a `closest()` test on
  the event target reads every press as the document's, and the first cut of
  this ran with the key doing nothing at all.

The multicursor against the clicks around it (2026-08-23) added these, both
caught:

- `webview-editing`: `dismissOpenBlock` dispatching the single caret that left
  the block instead of mapping every range (three carets, one of them inside a
  code block, come back as one after a click in the dead margin, on the outline
  or on the toolbar); `revealBlock` ignoring its `adds` argument (a drawing
  clicked with the multicursor modifier down replaces every caret with one at
  its source). Both were reported as "the multicursor loses its carets and does
  not edit": the Alt+click itself was adding the range all along, what threw
  the carets away was the click that landed outside the text or on a drawing.

Alt+click against the host's menu bar (2026-08-23) added this one, caught:

- `webview-editing`: the `stopPropagation()` dropped from the Alt keyup in
  `watchAltPresses` (the release reaches the stand-in for the VS Code preload,
  which is the clean press-and-release pair the workbench's menu bar reads:
  in real VS Code the focus goes to the File menu and the carets stop being
  drawn). The stand-in is a bubble listener on the window, where the preload
  puts its own (`contentWindow.addEventListener('keyup', handleInnerKeyup)`,
  in `workbench/contrib/webview/browser/pre/index.html`); the test also probes
  `view.contentDOM` to show the page itself still gets the release. What the
  harness cannot show is the other half, the menu bar taking the focus: that
  lives in the workbench, and the evidence for it was read off the installed
  build (`ModifierKeyEmitter` in `workbench.desktop.main.js`: `mousedown` on
  `document.body` clears `lastKeyPressed`, and the menu bar focuses on
  `lastKeyPressed === "alt" && lastKeyReleased === "alt"`).

One thing the harness cannot show: the horizontal bar that a long drop-down
grew under its list. It needs bars that take layout space, and this browser
draws them floating over the content, 2px wide. What the test asserts is the
reservation (`scrollbar-gutter`), which is the fix, and the overflow, which
stays at zero here either way. The width of the bar is read off that same
reservation, which does follow `scrollbar-width`: 10px for the `thin` the
editor asks for against the 15px the browser gives on its own.

The bar of the theme menu, reported a third time (2026-08-23), added this,
caught:

- `webview-look`: the `scrollbar-color` on `#app` removed (the bars come back
  from the host, thumb and track both: VS Code's slider grey over its editor
  background, which is the black strip down a white panel that was reported);
  the `scrollbar-width` removed (the bar goes back to the browser's 15px from
  the 10px the editor asks for). Neither mutation shows without the host's
  sheet in the harness, which is the point of the round: the editor was
  painting its bars with `::-webkit-scrollbar` rules, and VS Code sets
  `scrollbar-color` on `html`, which is inherited and which turns those rules
  off wherever it reaches. The rules were dead in VS Code and alive here, so
  the page the tests were reading was never the page the user was looking at.

The four papercuts of 2026-08-23 (the copied sign, the headphones' tooltip,
the name of the Ctrl+D toggle, the gap between paragraphs) added these, all
caught:

- `webview-look`: the `hideTipUntilLeave` call taken out of `copyBlock` (the
  "Copied" sign sits under the pointer until it leaves the block, which is
  what it did); the `mdm-blank` line class never added (the blank line between
  two paragraphs goes back to the height of a line of prose, half again the
  gap a rendered page leaves).
- `webview-player`: the `dismissTip` listener removed from the document (a
  click on the headphones leaves "Show player" showing over the player it has
  just opened); the `:hover` guard dropped from `hideTipUntilLeave` (a click
  from script or from the keyboard puts the tooltip away with no pointer to
  leave the button and bring it back, so it never shows again).
- `webview-editing`: the two texts of the Ctrl+D toggle are pinned, so a
  rename of either fails the toggle test.

The grace note that was not heard (2026-08-23) added these, both caught:

- `webview-player`: `attacks()` built with `midiGraceNotePitches` ignored, one
  attack per note group (a head dropped inside a `{d}c2` waits the whole group
  out, ornament and note together, which is the report); `scheduleSilentGap`
  no longer lighting what it waits for, the ink left to the event alone (the
  gain comes back for the ornamented note with no ink on it, since the event
  abcjs handed over at the seek is the note AFTER the group and now waits for
  its own moment). The tune is `ORNAMENT_FIXTURE`, quarters at a quarter of
  100 with a grace note on the ninth: the group is at 4800 ms, its d sounds
  there, its own C at 5100 and the note after it at 5400, so a gap that runs
  to 5400 is the fault and one that ends at 5100 is the fix.

  What the round turned on is that abcjs keeps the two apart: `midiPitches` on
  a timing is the note alone, `midiGraceNotePitches` the ornament, and the
  timing's `milliseconds` is where the ORNAMENT begins, not the note. Read as
  one attack per timing, an ornamented note looked like a plain one starting
  where its grace does. Measured on the third score of `example.mdm` before
  the fix: seeking to 26400 ms held the output muted for 300 ms, through the
  d and the c both; after it, 0 ms there and 130 ms from 26300, which ends on
  the c's own attack.

The round of 2026-08-25 (the exported HTML dressed as the editor) added
these, all caught:

- `mdm-look.css`: the `body` dropped from the player rules. abcjs ships its
  own stylesheet for the widget and Quarto loads it after ours, so at equal
  weight the bar goes back to its 10 px trough and its 20 px lozenge; the
  test reads the track and the head.
- `mdm.js`: the first, measuring render left without its `staffwidth`. abcjs
  then engraves at a page width of its own (770 px), so a tune with nothing
  to say about its width comes out narrower than a wider box and every score
  is pinned to a size it never asked for; the test reads which scores carry a
  `max-width`.
- `mdm.lua`: `--mdm-syn-card` dropped from the look block. The dark side is
  the one arrangement where the code sits on the theme's own background and
  the page rises above it, so without that property the card and the page
  swap places; the test compares the two.
- `bin/mdm`: the `-M format-links:false` not passed. Quarto then puts its
  "Other Formats" column back in the margin, with a link to a `.pdf` that an
  HTML-only render never made; the test reads the page for that block.
- `extension.js`: `metaColor` returning the colour with its `#`. Quarto reads
  a `-M` value as YAML, where a `#` opens a comment, so the colour would
  arrive empty at the filter; the test reads the argument the renderer was
  called with.

The round of 2026-08-25 (the toolbar remembering what it was left on) added
these, all caught:

- `main.js`: `outlineOpen` back to a plain `false` instead of reading
  `mdm.outline`. The panel is what the button paints, so a document opened on
  a stored `shown` came up shut; the test opens a seeded editor and reads the
  panel.
- `main.js`: the `askSetting` of the grip's drop removed. The width then
  lived as long as the editor did, which is the bug being fixed; the test
  counts one write per drag and compares it with the width on screen.
- `main.js`: the fit against the pane dropped from `applyOutlineWidth` (the
  setting applied as it stands). A width dragged out on a wide window then
  swallows a narrow pane, leaving the editor no column at all; the test
  shrinks the viewport under an open panel.
- `extension.js`: `numberSetting` returning the value it was given. A width
  from a hand-edited settings.json then reaches the webview as it was written,
  which is the one thing the allowlist is there to prevent; the test reads the
  settings block of the HTML.

The export moved inside the extension (2026-08-26) added these, all caught,
each run against `extension-host.test.js`:

- the copy handed to Quarto written from the document unchanged instead of
  through `withFilter` (its `- mdm` entry survives, so Quarto goes looking for
  an `_extensions` folder that an installed extension has no reason to have);
- `onPath("quarto")` falling back to the bare name instead of reporting it
  missing (the export starts a process that dies with ENOENT and says nothing
  about which tool was absent);
- the abcm2ps guard dropped (a PDF of a document with scores renders with the
  scores left as text, exit 0, which reads as a successful export);
- `channel().appendLine(result.log)` removed (a failed render leaves nothing
  in the MDM channel, so the "Show log" button opens an empty page);
- `fs.unlinkSync(copy)` removed (the `.qmd` is left in the user's folder, and
  the next export refuses to run because a file of that name is in the way,
  which is the second test that fails here);
- `FILTER` pointed back at `../_extensions/mdm/mdm.lua` (the path leaves the
  extension directory, so it resolves to nothing once installed from a
  `.vsix`).

The filter the extension carries (`vscode-mdm/render/mdm/`) is compared file
by file with `_extensions/mdm/`, the same way the two abcjs copies are pinned
in `audio-assets.test.js`: the mutation is editing either copy.

Measured while designing that move, on Quarto 1.9.37, in directories holding
no `_extensions` and no `tools/`: Quarto does not walk up the tree looking for
an extension (`_extensions` in the parent folder fails exactly as none at
all), a `--metadata-file` does not outrank the header's own `filters:`, and a
filter named by absolute path renders both formats, copying its five
`resources/` files byte for byte into `doc_files/libs/quarto-contrib/`. The
end to end check of the result: `example.mdm` copied to a bare directory
renders to a 1.8 MB HTML and to a 3 page PDF with its 3 scores engraved into
`mdm_cache/` and embedded as vectors.

The licence and the notices (2026-08-26) added `packaging.test.js`, whose four
mutations were run and caught: the copyright line of `vscode-mdm/LICENSE`
changed by a year (the two copies drift, and a package would go out claiming
something the repository does not say); `Musyng Kite` renamed in the
extension's notices (the share-alike attribution disappears, which is the one
credit here that is an obligation); a package added to `VERSIONS.json` without
being credited (which is what a `npm run vendor` that pulls a new dependency
looks like); and the manifest's `license` field changed to Apache-2.0 (the
Marketplace page and the file in the package would disagree in public).

The ABC syntax colours (2026-08-27) added these, all caught, the first three
against `vendor-src/test/abc.test.js` and the last two against the webview
test (the bundle is only involved in the webview run; the vendor tests read
`src/` directly):

- `abc.js`: the variant-ending digits dropped from the bar match (`:|2`
  loses its number to the duration bucket; the bar-family test pins the
  token text);
- `abc.js`: `K` taken out of the structured fields (the key line's value
  reads as free text, the wrong bucket of the three);
- `languages.js`: the bare `StreamLanguage` handed to `LanguageDescription`
  again (every stream fence throws inside the parser, the regression the
  `LanguageSupport` wrap fixed; the ```` ```r ```` test dies on the throw);
- `style.css`: the dark `--mdm-abc-field` moved one value (#f92673; the
  webview test measures the computed colour of the `T:` span on the dark
  side);
- `main.js`: the `abcTags.field` class entry dropped from `mdmHighlight`
  (the `T:` span loses its `mdm-abc-field` class and the webview test finds
  no token to measure).

The brass of the scores (2026-08-27, the same day, after the colours were
first built on Monokai and stackoverflow-light by mistake) replaced those two
palettes with the extension's own and added these, all caught against the
webview test:

- `style.css`: the dark `--mdm-abc-note` moved one value (#d9a950). It is the
  brass of `--mdm-play-accent`, the colour a note lights up in while it
  sounds, and the source and the engraving are meant to be one colour; the
  test measures the note span and the custom property beside it;
- `main.js`: `mdm-abc-line` dropped from the score's line classes. The
  plumbing between the notes (slurs, ties, the brackets of a chord) then
  falls back to `--mdm-syn-base`, which is the theme's, so a block that is
  supposed to be the extension's own edge to edge takes a theme colour down
  its middle;
- `main.js`: the class of the fence-info mark changed, which is what the
  `abc` of the fence would look like with the decoration never added.

The fourth mutation of that round is the one worth keeping in mind, because
the test did NOT catch it at first: dropping `.mdm-abc-info span` from the
rule left the test green while the word on screen went back to the theme's
colour. The mark decoration wraps the span the Markdown highlighting already
put there, and an inner span with a colour rule of its own wins on the text,
so measuring the wrapper measures nothing. The test now reads the innermost
span, where the paint actually lands, and the mutation fails as it should.

Licences settled by reading the source rather than by memory, since one of
them had been got wrong: the 31 packages inside `cm6.bundle.js` all declare
MIT in their own `package.json` under `vendor-src/node_modules`; abcjs 6.7.0
is MIT per the npm registry entry for that exact version; Musyng Kite is CC
BY-SA 3.0 per the README of `gleitz/midi-js-soundfonts` on its gh-pages
branch, quoted in the notices; and abcm2ps is **LGPL-3.0-or-later**, not the
GPL-2.0 an earlier note in this project claimed, per the header of
`abcm2ps.c` in `lewdlime/abcm2ps`, the fork the notices point at.

The playing cursor (2026-08-28) added these, all caught against the webview
player tests, each restored from a copy and checked by hash (main.js was
uncommitted, so `git diff --quiet` was no use):

- `main.js`: `frac` pinned to 0 in `cursorPlace` (the line stands on each
  attack and hops to the next instead of gliding: 50 sampled frames hold
  only 3 distinct positions, against the 20 the walk test demands);
- `main.js`: the show rule reduced to `total > 0` (the line survives its
  own ends: after a stop, with the clock rewound to nought, it stays on
  the score, and the stop test times out waiting for it to go);
- `main.js`: the `ms > 0 && ms < total` clause dropped from the show rule
  (a head dropped before the first play parks nothing: the tune is not
  sounding and the ink is off inside a note, so the park test never sees
  a cursor);
- `style.css`: the `.mdm-play-cursor` selector unwired (the line draws
  with no stroke, and the computed brass assertion fails).

The cursor under the held head (2026-08-28, the same day) added these, both
caught, restored the same way:

- `main.js`: `cursorDrag` never consulted in `cursorFrame` (a head held
  before the tune is primed places no line: there is no clock yet, so the
  follow test times out waiting for a cursor to appear);
- `main.js`: `cursorDrag` handed back on the release itself instead of when
  the engine's seek lands (the line blinks out for the frames the priming
  takes and comes back on the clock; the presence samples taken every frame
  from the release read false in the middle). The blink lasted three frames
  here, which is why the probe samples frames rather than waiting a settle:
  a 120 ms read after the release came back green over this same mutation.

The grab that silences (2026-08-28, the same day) added these, all caught,
restored the same way. The behaviour itself replaced a first cut that paused
the engine through the play button on the grab and played it again once the
release's seek landed: measured on the timing fixture, a quick click (down
and up milliseconds apart) travelled abcjs's promise chains in the wrong
order, the pause landing AFTER the seek, and the tune came back sounding the
old position under a clock standing on the new one. Muting the output while
the transport runs on has no such race, and the release's seek goes down the
sounding path the suite already pinned:

- `main.js`: the mute block dropped from the grab (the tune keeps sounding
  under the hand; the grab test reads the mute stage at one);
- `main.js`: `clearPlayingHighlight` dropped from the grab (the note that
  was lit stays lit under a hand that has taken the head away);
- `main.js`: the `cursorDrag` guard dropped from `onEvent` (the muted notes
  passing under the old position light up mid-drag, ink walking one place
  while the line follows the hand somewhere else).

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
5. Player seek: measured in the harness (a scratch run under `tests/tmp/`),
   the audio lands on a single source with no overlap, but the head is drawn
   1 to 5 per cent ahead of where abcjs seeks the sound (larger on a short
   tune), because the head uses the buffer duration, release tail included,
   while abcjs seeks against the musical duration. Same code as the Vditor
   editor, so not a rewrite regression, and the report of the head drifting
   as it is dragged is not yet reproduced as a fault of its own. No test
   added.
