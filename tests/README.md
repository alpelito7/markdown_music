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
npm run test:webview # the webview suites in Chrome only
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
| `transforms.test.js` | 24 tests of `vscode-mdm/transforms.js`: the editor text is the file text save for two things, and both are pinned here, the YAML header hidden and spliced back (the blank lines under it taken from the file, one put in when the file has none, a header-only file, a header without its trailing newline), the line endings (the editor text is LF whatever the file uses, since CodeMirror holds no CR, and the ending of the file goes back on whatever is written to it, with a lone CR counted as a line ending on the way in, though VS Code only ever calls a file LF or CRLF), byte-identical round trips of `example.mdm` in both modes, fence info strings untouched in both directions, `toEditor` idempotent, and the count of the lines the editor is not sent (the header plus the blank lines under it, zero whenever the two texts already agree, and the first line of the editor landing on the file's line of the same text in `example.mdm`), which is what the numbers the editor draws in its margin count from. | Node |
| `extension-host.test.js` | 82 tests of `vscode-mdm/extension.js` against a mock of the API (`mocks/vscode.js`): the settings allowlist against injection from `settings.json` (and the clamp of `mdm.outlineWidth`, the one setting that is a number), what a document keeps of its own word division (kept in `globalState` under the document's URI and never written to `settings.json`; one document's division not another's, and coming back with it across a restart; a press answered in its own editor, while a look pressed beside it goes to `settings.json` and reaches both editors, each with its own division over it; `mdm.hyphenation` as where a document starts, with what the document was left on outranking it; a kept value held to the same allowlist on its way into the page; the 500 documents used last kept and the rest forgotten oldest first; and an export dividing as the document it is exported from), the ready/update/edit protocol, the conditional echo (the first-Enter regression), the `withFrontMatter` flag travelling with the text and the count of the lines the editor is not being sent travelling with it (four for a document whose header is hidden, zero shown and zero for a file with no header), a CRLF document (the caret jump on Windows: it reaches the editor in LF, is written back with its CRLFs read raw out of the mock's store, and neither grows nor echoes however much is typed into it, which needs the mock to report the document's EOL the way VS Code does, a vote and not the first line break it finds), external and configuration changes, the syntax palette in the HTML and in the `palette` messages, dispose, and the audio wiring in the HTML (synth and soundfont URIs, the widget css, `unsafe-eval` and `connect-src` in the CSP). And export: it saves a dirty document before rendering (and leaves a clean one alone), runs `quarto render <doc>.qmd [--to html|pdf]` from the document's folder (a fake `quarto` on a PATH holding nothing else records arguments, cwd and the copy it was handed), makes that copy point at the filter the extension ships and leaves the `.mdm` untouched, drops the copy afterwards whether the render worked or not, keeps `format-links` when the document asks for them, names both formats on the command line when both were asked for (a header that declares none used to come back with the HTML alone), offers the Open HTML/PDF buttons that fit, and refuses a format that is not in the table before starting a process (the value comes from the webview). And the light half of it: with no `quarto` on the PATH the notification names Quarto and the log says where to get it, a PDF of a document with scores names both engravers (neither a Chrome nor abcm2ps on the PATH) with the install lines, exports with a Chrome alone (abcm2ps is only the fallback), is waved through when the header names an `mdm.chrome` for the filter to resolve, while one without scores renders anyway, a failed render puts Quarto's whole output in the MDM channel and the "Show log" button opens it, and a `.qmd` already in the way stops the export instead of being overwritten. The header rewrite is checked on its own (block list, flow list, a header with no `filters` key, no header at all, a quote in the path), and so is the dialect written beside it (a header gains it, a document that names a `from:` of its own at the top level or under a format keeps it, and a line of the body that opens with `from:` is prose); so is the fence test that decides whether a score is there, and the filter the extension carries is compared file by file with `_extensions/mdm`. And the look that rides with an export: the side of a named theme, of the three fixed values and of the workbench while on `auto`, the three score settings, the palette spelt without its `#`, and a palette from the other side left behind. And the rule the copy draws: a line of dashes with a line straight under it gets the blank line Pandoc needs, put in the copy and never in the document, with the fences it must not reach inside stepped over. And the two bases an image path hangs from: the folder of the document and the root of its filesystem in the HTML, with the resource roots that make them loadable, and neither of the two for a document that is not a file on disk. The export is named after the document's stem whatever its extension (a `.md` opened through "Open With" used to come out as `notes.md.qmd` and `notes.md.html`). | Node |
| `audio-assets.test.js` | 4 tests of the player's vendored assets: the copies of abcjs 6.7.0 and abcjs-audio.css under `vscode-mdm/media` byte-identical to those in `_extensions` (so they cannot drift), the bundle whole (engraver and synth both exported), the 88 keys A0–C8 of the piano present and carrying a real mp3, and the harness loading the same audio assets the real webview page does (abcjs as a plain script, the soundfont path, the stylesheet, the CM6 bundle). | Node |
| `packaging.test.js` | 5 tests of what the published package carries and claims, which using the editor cannot catch: the `LICENSE` of the repository and the copy of it inside `vscode-mdm/` (vsce reads the one in the package root) byte for byte and against the `license` field of the manifest, every package listed in the bundle's `VERSIONS.json` credited by name and version in both notices files (so a `npm run vendor` that pulls in a new dependency fails until somebody credits it), the licences the extension's notices have to name (abcjs, CodeMirror, KaTeX, and the share-alike of the Musyng Kite soundfont, which is an obligation and not a courtesy), the repository's notices covering a local abcm2ps build when one sits in `tools/bin/` (none is tracked; the check skips without one) with the LGPL and GPL texts present in `licenses/` and the upstream source named, and the note beside the samples agreeing with the notices on the licence. | Node |
| `theme.test.js` | 26 tests of `vscode-mdm/theme.js`: JSON with comments and trailing commas, TextMate scope matching (prefix by dot, the most specific wins, a tie goes to the last, selectors with a space ignored), the `include` chain, finding a theme by id and by `%nls%` label, sanitizing down to hex colours (those values go into the HTML of the webview), `tokenColorCustomizations`, and VS Code's built-in Monokai read from disk when it is installed. | Node |
| `render.test.js` | 51 tests of `bin/mdm` + `_extensions/mdm/mdm.lua`: the CLI guards, HTML (2 figures, `mdm-play`, escaping of `&`/`<`, abcjs deps, and that ` ```music ` is NO LONGER an alias), PDF with the default engraver, the editor’s own abcjs loaded into a headless Chrome and printed to a vector PDF then trimmed with pdfcrop (a cache entry under its own `abcjs` digest with the `.w` sidecar, nothing of the EPS pipeline left beside it and no abcm2ps fallback tripped, `%%staffwidth 200pt` coming out 132 pt of ink and centred, the wide score at the text width, an inkless block refused by its zero-ink bbox and falling all the way back to source text), the equations set by the vendored KaTeX through the same Chrome (a `.pdf` and a `w h d pw ph` `.dim` sidecar per formula on the 8 px pagelet grid, the inline one inserted in a `\makebox`+`\raisebox` that lands it on the baseline, the display one centred in its band, and `mdm-engraver: abcm2ps` leaving every formula to LaTeX), and the abcm2ps pipeline forced by `mdm-engraver: abcm2ps` where its EPS internals are what is pinned (cache by sha1 of the source with its trailing newline, the `.w` sidecar, a BoundingBox trimmed and consistent with `.w`, a narrow score < 330 pt centred in the `.tex`, a wide one at `width=\mdmscorewidth`, a warm cache that does not run abcm2ps again, and a tune naming neither `X:` nor `K:` engraved all the same (forced to abcm2ps: abcjs falls back by itself), with the `X:1` and the `K:C` the engraver wants written into the cached `.abc` while the cache keeps the name of the block as it was written), the fill and the alignment a score is given (a box in the paper of the side, the padding given back so a score at the text width still fits the measure, and the narrow score centred or lined up left), a score of several staff systems cut into one clipped image per system so that a page can break between two of them where the engraving is already blank (the `.cuts` sidecar the engraver writes, one position per gap and each below the one before it; the trims of the slices tiling the drawing exactly, all of them the one image at the text width, in a single band and stack; and a twelve-system score, 856 pt against the 622.7 pt a page holds, coming out over two pages, where the same drawing with its sidecar taken away goes down whole and needs three), the title block drawn only when the header is on screen (`mdm-front-matter:hidden` takes the title, the subtitle and all three of the keys Quarto keeps the author under, in HTML and in the TeX), the typography of the page (the maths at KaTeX's 1.21 and code at the stylesheet's 0.88, ragged right and microtype's expansion off, with the opening paragraph of `example.mdm` breaking after `source` as it does in the editor, read back with ghostscript's txtwrite, and a document naming its own `mathfont` left unscaled), the measure of the page (the editor's 51.25 ems where the paper holds them, the clamp where it does not, and a document with a `geometry` of its own left alone, each read back out of the finished PDF with ghostscript's txtwrite, since the look paints the sheet and the ink of a rule cannot be measured against it), the colours an engraving is drawn in (the ink of the side at the head of the EPS, the grey of the staff lines around the run that draws them, none of it when the staff is asked for in ink, and a cache entry per pair of colours), the dialect the copy is read in (a heading under a paragraph and under the closing fence of a score, and a quote under a paragraph, all of them blocks and not text, while a document naming its own `from:` is left in Pandoc's), and the look block the filter writes on `html:root`: it rides on every HTML render, music or no music (and drags no abcjs along when there is none), it reads the `-M mdm-*` metadata, and it lets nothing else through (a colour by name, a value carrying CSS of its own or a `</style>`, a side or an alignment that is not on the list, all dropped for the fallback), and the margin block of the other formats, which `bin/mdm` turns off (a document declaring html and pdf renders without it, and one that says `format-links: true` keeps it). And the same look on paper, read off the `.tex`: the light side and the fallback palette written out slot by slot when nothing is passed, the ground and the ink of the side that is, the ten slots over Pandoc's token commands with no bold left on them, the sans, the heading sizes and the hairline colour, and a document with no code block at all compiling all the same (Pandoc writes the token commands only for one that has code, so the block that repaints them asks for them first). And what a page and a paper make of a figure: an image named by an absolute path copied into the cache and pointed there, in the HTML and in the TeX, since Quarto rewrites such a path into a relative one that points at nothing. And the engine the formulas are set with: KaTeX, its faces and `mdm-math.js` riding with the page as a dependency, the formulas left as their own LaTeX in a span for it to set, no CDN and no MathJax anywhere, and the whole engine inside the file when the document asks for a self-contained page. And an SVG figure printed to PDF by the filter's own Chrome, named after the drawing and at the drawing's own size, with no `\includesvg` left for LaTeX. And the rule under h1 and h2 in the `.tex`: one `\mdmheadrule` for both kinds of class, hung from the heading's baseline (`\prevdepth` taken off) at the distance the editor draws it in the face, and titlesec's own `\titlerule` gone. And the face the words are set in: `mdm-text-font:roman` puts Latin Modern in `--mdm-text`, brings the four woff2 faces beside the page as their own dependency with the rule that takes KaTeX's 1.21 back off the maths, and takes all four inside the file on a self-contained export (24 inlined faces against the 20 of KaTeX alone), while a render that did not ask for it carries none of it, which is what `bin/mdm` on its own gets; and on paper the roman drops the sans main font and the `\familydefault` push under pdfTeX, keeps `\setsansfont` for a `\textsf`, and sets the maths in Latin Modern Math with no `Scale=1.21` anywhere, both of which were answers to a sans standing beside them. And the headings on paper, measured: the six levels in either face and under four kinds of class (`documentclass: article`, the KOMA class Quarto gives a document that names none, and report and scrreprt, where `#` is `\chapter`), and under KOMA with `indent: true`, each read back with txtwrite as a size over the prose (by its x-height in the roman, whose bold is drawn at a scale of its own) and held to the ladder the editor draws, 2 / 1.5 / 1.25 / 1.125 / 1.0625 / 1 in both faces, every level bold and flush with the first, which is also a fifth level that compiles under a standard class (a `#####` used to stop the PDF with titlesec's "No format for this command") and a sixth that is a heading in an article, `\mdmheadsix` with its label, where Pandoc wrote a plain paragraph; the four shapes of the roman drawn at one x-height; a heading that wraps set at the editor's 1.3 leading under both kinds of class, read off pdftotext's word boxes; the rule under h1 and h2 where the editor draws it, read off the pixels at 600 dpi under the four classes; a chapter opening its page (a right-hand one under book and scrbook, a `#` straight under another included) and standing within half an em of where the same `#` stands without chapters; and the title of the YAML block at twice the body and bold, with the subtitle not bold. It renders in `tests/tmp/` with symlinks to `_extensions/` and `tools/`; it never touches the repo. | quarto, TeX (gs, pdfcrop), google-chrome, abcm2ps (in `tools/bin/` or the PATH) |
| `webview-editing.test.js` | 46 tests of the CodeMirror editor itself (`vscode-mdm/media/main.js`), in a real Chrome on `webview/harness.html`: **multicursor** (Alt+click adds carets and typing lands at both; `editor.multiCursorModifier` = `ctrlCmd` turns that into Ctrl+click, live through a `settings` message; Shift+Alt+drag column; Ctrl+D twice; Ctrl+Shift+L; Ctrl+Alt+Down/Up; Escape; a multi-caret insert undone in one Ctrl+Z; a click that closes an open block moving only the caret that was in it, and a drawing clicked with the modifier down adding a caret instead of replacing them all; an Alt release that followed a mouse press held back from the host's key forwarder, with a bare tap still forwarded), **reveal** (a display equation hidden behind its KaTeX widget, its three source lines and the widget kept while a caret is in it, hidden again when it leaves; a broken equation as source with the broken edge when untouched and with KaTeX's message under it while edited, rendered the moment `}{b}` closes it; inline maths replaced or shown as `.mdm-math-src`; two carets open two equations at once; the `#` of a heading, the `**`, `*` and backticks of inline marks, the `-` of a bullet, the rule, the `>` of a quote and its continuation line, the callout classes by kind with the fence lines small until the caret is on them and nothing at all for an unclosed `:::`, the YAML header lines, the task checkbox flipping `[ ]` to `[x]` in the text), **literal delimiters** (Backspace on one `$` of a closing `$$` leaves a plain paragraph with the text in view and nothing regenerates it, the `$` retyped renders again, Ctrl+Z twice walks back; a backtick of a closing fence deleted and restored; `$$` and a formula typed from scratch end rendered), **sync** (the edit posted with the typed text and `withFrontMatter`, an external update before and after the caret leaves it on its word and posts no echo, an update carrying CRs that neither gains a line nor throws the caret to line 1, the hidden-header mode), **commands** (Ctrl+B at two ranges wrapping and unwrapping, Ctrl+I at a caret, the heading button on three lines with `######` going back to a paragraph, Ctrl+Enter out of a fence onto a fresh line, ArrowDown and ArrowUp into a rendered equation, a click on the equation and on the score drawing landing at the start of the source) and the code chrome (the `python` label, the copy button shown on hover of a code line and gone when the pointer leaves, the fences revealed by a caret). And **the numbers in the margin**, which ride on a `data-mdm-line` attribute the stylesheet prints: every line carries one and a paragraph that wraps carries a single number for all its rows (with the class list of a line unchanged, since the rest of the suite reads it), and a block that is drawn instead of its source is numbered by its first line alone, on the cover over that source, until a caret opens the block and every line of it carries its own again (nothing special-cases a block: a decoration inside a block replacement is never reached, so the cover is the only thing left to say it), with the whole numbering following an edit above it, cover included. The cover is also what the display-equation test now reads: it is the extension's own placeholder over hidden source, of no height and not editable as CodeMirror's own was, carrying the block's first line. | google-chrome |
| `webview-look.test.js` | 59 tests of the look and the settings of the editor, the old webview tests ported to the new DOM: the memory of the toolbar (an editor opened on a seeded `mdm.outline`, `mdm.outlineWidth` and `mdm.multicursorMatch` comes up with the panel open at that width, both buttons lit and Ctrl+D matching inside words with nothing clicked, and a press asks for the other side; a width wider than the pane is narrowed to fit without writing anything back and grows again when there is room); typing inside the header keeps the caret and the text; code, scores and equations spaced like paragraphs (the blank line is the gap, above and below); a display equation rendered; the header button taking the editor to the top, on and off; the copy button copying the source and pulsing the block (every line of a code block, the `code.language-abc` of a score, which also loses its `%%staffwidth`) with no page selection and the caret left where it was; a setting with no colour in it not repainting; the theme menu listing what the host sent and a click asking for it; the three grounds (light/dark/white, the code on the material the outline panel is drawn in, a step off the page on either side and lighter than it in the dark, measured on `.cm-editor`, `.mdm-code-line` and `.mdm-outline`); a title wider than its staff not cropped; an edited score keeping no card behind it and its widget rebuilt from the edited source; the alignment button; the ten `--mdm-syn-*` applied and spent (the YAML key and the Python `def` take the palette's attr and keyword colours, the fallbacks come back when the palette is from the other side, a `palette` message repaints live, a named theme brings its side, and none of the three MDM looks takes a palette at all, whatever side the theme it would come from is on); the source of an open score painted in the extension's own brass on both sides (the seven roles measured on the `mdm-abc-*` spans, the notes and the `abc` of the fence in the brass of `--mdm-play-accent`, the staff ink on the line itself so the plumbing takes no theme colour, the lyrics italic, and a seeded palette spent on the Python block but never on the score); inline code on the card ground; staff lines grey by default and back to ink by the button (lit for ink), a darker grey on the dark side; the score fill menu with a tick, one value per side; clicking a rendered equation or score opening its source; an ordinary Delete inside a paragraph staying ordinary; the copy button's "Copied" held for a beat and then put away, with the tooltip back for the next hover; and the blank line between two paragraphs drawn an em tall (the space a rendered page leaves between paragraphs) while the blank lines of a fence keep the height of a line of code. Tables: a pipe table drawn as a table with the alignment its second row asks for, the maths of its cells set by KaTeX and their marks kept, its source out of the flow until a caret is in it and the drawing left standing as the preview while it is, and a click landing on the cell it was on, with the page held where it was rather than sliding down by the height the source took. Images: a relative path hanging from the folder of the document and an absolute one from the root of the filesystem, not from the folder with the path glued behind it, and a figure that carries the pointer and opens its source when it is clicked. The numbers in the margin: they stand in one column beside the text whatever a line draws to its left (the quote and the callout are given back the 3px of their own bar, which the padding box the number is placed against starts inside, and the cover over a drawn block stands in that column too), left of the column and inside the 50px the scroller carries, with room for four digits, absolute and unselectable and taking no pointer, each carrying alt text of nothing so a screen reader does not read it before every line, and every one of them drawn in the same face, which is what keeps a heading's 600 or a card's monospace from reaching the number through the pseudo-element; and each standing in the middle of the row it counts, its box the line's own line height (`1lh`, where `inherit` had handed down the ratio and put every number at the top of its row), read in the pixels at two to the CSS pixel in both faces over prose, a paragraph that wraps, three levels of heading, a blank line, a quote, a line of code and the cover of an equation; and, with the header hidden (the default of `mdm.frontMatter`), the numbers counting the file's lines and not the editor's, so that the first body line of a document with a three-line header reads 6 in the margin as it does in the text editor beside it, while the same file shown counts from 1. And the chrome is brass: every glyph of it (a toolbar button, the copy and the headphones on a block, the transport of the player row and the headphones in it) computes to --mdm-chrome-ink and every number in the margin to --mdm-line-ink, neither of them the --mdm-play-accent-ink a held state is drawn with, on both sides, with the pointer resting on the play button, which is where the vendored abcjs sheet claims the glyph (#f4f4f4, #cccccc hovered) and where the editor's rules have to outrank it; and a held state is the ground alone, read by turning repeat on and finding its disc changed and its glyph not. And the caret keeps its place in its own line while the outline panel opens and shuts: the gap between the drawn caret and the left edge of the line it is in, sampled at the end of every frame for twenty frames after the setting lands, on a pane wide enough (1400) that the panel moves the text column without changing its width, which is the case CodeMirror is slowest to notice. And the face the words are set in: a fresh editor comes up in the roman (`mdm.textFont`), with the vendored Latin Modern measured as having actually arrived rather than read off `getComputedStyle`, which reports the declared list whether or not the file was fetched; the toolbar stays in the interface sans while the text is in the roman; a formula computes to the size of the words (16px, KaTeX's 1.21 being the compensation for a sans) and back to 19.36px with the sans; the press asks the host and repaints nothing until the value comes back; and an editor opened on a seeded `textFont: sans` comes up in the sans with nothing clicked. And the headings: one ladder for both faces, Markdown's 2, 1.5 and 1.25 and then 1.125, 1.0625 and the body, read off the lines in the roman and in the sans, and a heading's line box held at 1.3 of its size with the caret away from it and in it (CodeMirror's widget buffers around the hidden `## ` stood over a roman heading's line and grew it by 4 to 7px, and the heading jumped when the caret came in). | google-chrome |
| `webview-player.test.js` | 62 tests of the player and the toolbar, ported: a toggle on every score (and only there) left of the copy button, shown on hover; the bar opening as a row of the toolbar and nothing left under the score (in the toolbar, out of `.cm-content`, on a line below every button, as wide as the toolbar, with no width taken from the score it plays), staying in reach with its score scrolled clean out of CodeMirror's viewport, read with the follow seeded off, since with it on the page comes back the frame after it is scrolled and the widget is never thrown away (the widget gone, the tune running on, the clock advancing, play and stop still pointable without a scroll, the mark back on the block when it returns), following the pane at nine widths from 1400 down to 260 and giving up its parts in the stated order (the volume slider at 380, the clock at 320, the volume group at 260, the transport and a 44px track never), keeping its full width when the outline panel narrows the text beside it, and being taken and given back without moving the page under it (the toolbar grows and shrinks by the row, the scroller is nudged by the same amount, and the bar is removed rather than hidden); opening and closing the bar without opening the source, tooltips naming the destination (and the same on the first click of a file that opens on a score, where the untouched selection sits at character 0: the bar keeps a document that is already somebody's and makes none somebody's); play sounding from the local soundfont (notes over `file://`, nothing to the network, the source staying shut); a byte-identical round trip with the player open; one player at a time; the bar surviving edits of its block and full external updates (and closing with no residue if the scores disappear); silent chord symbols; the session volume (a real GainNode on the playback path); the notes lighting up while they sound (brass per side, computed, no staff line lit) and the ink back on close, every voice of a duet lit at once on its own staff (a treble part over a bass one, both accented, at every moment of the tune), and a written silence lit like a note while the cursor crosses it, the rest one hand holds alone included: it is a moment where nothing attacks, so the silent gap a seek opens runs straight over it to the next sounding note, and the rest used to be painted after its own moment had gone by (the crossing sampled frame by frame, in brass, with the line over the drawing; and the same ink under a head parked on the rest); the brass cursor that walks the engraving while the tune sounds, gliding between attacks instead of hopping note to note (sampled frame by frame: never backwards within a line, no note-sized jumps, distinct positions most frames, the lit note never ahead of it, the system spanned top to bottom), frozen in place by a pause, taken away by stop and by the headphones closing, parked by musical time, not by the drawing, where a head is dropped before the first play (Home walks it back to the first note, which lights), and following the held head live, both ways, clock or no clock, without blinking out in the gap between the release and the seek it asks for (presence sampled every frame from the release itself); the pane brought to what is sounding, by a drag of the head (both ways down a score a dozen systems tall, by a keyboard seek that sends no pointermove, and never for a head already on the pane) and by the music itself, which keeps the staff system that is sounding whole on the pane: it moves when part of that band leaves it and not while the band shows entire, however near an edge it rests (read by placing the band 6px off the bottom, inside the 24 the rule used to want clear at each edge, and finding the page unmoved, then hanging it 14px over and finding it brought back) (21 readings of the scroll over two seconds show at most three positions, where a page pulled by the clock would show one a frame, since the head does not go down the page inside a staff system), brings a page parked a whole pane away straight back rather than at the end of the line, and leaves a paused tune's page where the reader parked it; a grab on the head muting a sounding tune for the whole drag (the transport runs on; the release's seek lands the sound under the new head through the usual silent gap, gain and ink back together) and putting the brass out, sounding or paused, while a tune the user paused themselves stays paused after the release; play with the source open and the document held still; tooltips following the state; the repeat button really painting; the chrome taking no syntax colour (and the tooltips of the bar pointing south, the way the toolbar's own do, on all four labelled controls); the two faces of the speaker; stop; no focus box on the slider (the VS Code sheet injected); the volume set without closing the open source; the bar's discs and glyphs; the pointer answers; the filled track; the cursor told 16 times a beat; the sizes of the two little buttons; the progress drag (head under the pointer while the button is down, the tune landing where it is dropped, the clock not pulling the head away, the arrow keys, seeks before the tune is ready adding up in order, a scrub with the source open); resume in silence landing on the beat and a scrub inside the gap lifting it; export/undo/redo at the head of the bar with the rotating arrows and undo greyed on a fresh document; the three export entries posting their format; the output woken by a player and let go after the idle minute, and a hidden webview letting it go unless a tune sounds; and the keyboard: opening a player hands the focus to its bar, where Space plays and pauses (and neither press reaches the document or opens the score), Escape and closing give the keyboard back to a text that had it, while a bar opened on a document nobody was in gives it back to nobody, Ctrl+S goes on rising to the window with the bar focused (where the webview preload forwards it to the workbench: stopped at the bar, the file would not save) while Backspace, Delete, Enter, a letter, ArrowDown and Ctrl+B leave the text byte for byte as it was, and a caret in the text keeps Space for the text with the player still open. The headphones also put their tooltip away on a pointer click, so the half of the toggle that is no longer on offer is not left showing under a pointer that has not moved, and bring it back when the pointer leaves and returns; a click from script, which has no pointer resting anywhere, leaves it alone. Following the music, on a score of one staff system where no crossing can be the thing that moved the page: a play made with the score under the fold brings the page to the head. And the toolbar toggle: lit by default, a press asking the host for `still` without lighting itself first, the setting coming back unlighting it, and with it off a tall score parked under the fold playing for six seconds and several crossings without the page moving at all. | google-chrome |
| `webview-memory.test.js` | 1 test of the memory of word division end to end: the editor in Chrome and the real `extension.js` in Node on the other end of the wire (`open({ toHost })`, the harness's `window.__toHost`), with VS Code's `globalState` under both. A file left with the staff lines in ink, which is the editor's, and Spanish dividing its words, which is its own; the file beside it coming up with the ink and with no division, though its own header names a language; both of them as they were left after VS Code is started again; and `settings.json` holding the ink and nothing about the division. The configuration event that carries a `settings.json` write to every editor is fired by hand here, since the mock records the write without firing it. | google-chrome || `html.test.js` | 15 tests of the **rendered** HTML page, in Chrome: what `_extensions/mdm/resources/mdm.js` and `mdm-look.css` do on load, which the pandoc output does not say. Every block engraved and boxed in a `.mdm-fit`, every one of them pinned to the `max-width` it was engraved at rather than stretched to the column, and the narrow one centred; the gap under the score equal to the height of the drawing (the percentage padding fix plus `height:0`); the audio controls on the `.play` block only (three buttons, `abcjs-inline-audio`); no script errors. And the look: the editor's ground with the code card darker than the page, its 16px at 1.7 and its 820px measure, code at 0.88em in the fallback palette with no bold keywords and the line wrappers in the base colour, inline code on the card, and the player bar redrawn (a 30px pill on the card, round 24px buttons, Play/Stop/Repeat, a 4px track with an 11px head and its fill written, the clock at 11px, the volume). A second render carries the look of a dark editor (`-M mdm-look:dark` and the rest) and checks it arrives: the ink, Monokai's colours, the fill under the scores, staff lines back in ink and scores lined up left. And the headings: the six levels drawn on the page at the size the editor draws them, level by level and in either face, against the editor opened on the same document, and the title of the YAML block at twice the body in either face; and the air around them, gap by gap against the editor and from the top of the column to the first line, in three documents (the six levels with a quotation under the prose, a paragraph and then `##` as `example.mdm` opens, and a column that opens on an `##`), which answers two rules of Quarto's own about the head of the document and Bootstrap's padding on a quotation. Verified to bite: commenting out `height: 0 !important` fails the gap test, dropping the `body` from the player rules hands the bar back to abcjs's own stylesheet, and engraving the first pass without `staffwidth` pins every score to abcjs's own page width. | quarto, google-chrome |
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
Node, which `webview-memory.test.js` uses through `open({ toHost })`, the
host answering the page's `ready` itself. It also opens with the part of VS
Code's own
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
  (style.css); the toggle label "Hide player" changed; the slider pinned to
  100; `ArrowRight` stepping 3 %; the export entries renamed. And the three
  guards the bar's move into the toolbar turned into load-bearing code: the
  `.mdm-audio` exemption taken out of `dismissFromOutside` (the first press
  on play shuts the score whose source is open), the bar's own clause taken
  out of `somebodyInside` (the document drops into visual mode the moment
  the headphones hand the bar the focus, and closing the player then gives
  the keyboard back to nobody), and `playerBlock` given back its old
  `bar.closest('.mdm-score')` fast path (which now answers null for ever: no
  note lights, no cursor walks, no disc lights, and the headphones of the
  playing score reopen it instead of closing it).
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
- `mdm.js`: the first, measuring render given a `staffwidth` of the box it
  is drawn in. That is what this render used to ask for, and the round of
  2026-09-08 took it away: the editor asks abcjs for no width either, so a
  page that filled its column was engraving the same tune 11% larger than the
  editor did. The test reads the drawn size of a score on the page against
  the editor's own.
- `mdm.lua`: `--mdm-syn-card` dropped from the look block. On the dark side
  the filter writes the page up to the tint and the card 4% of the ink above
  it, the step the editor draws; with the property gone the card falls to this
  stylesheet's own value, which is the tint as well, so card and page land on
  the same colour and the step between the code and the prose disappears. The
  test compares the two on both sides, and they run opposite ways: darker on
  the light side, lighter on the dark one.
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

The face of the text (2026-09-07) added these nine, each caught by one test and
no other:

- `style.css`: the `--mdm-text` of `#app.mdm-text--roman` dropped (the class
  lands, the button lights, and every word stays in the sans: the whole
  feature is the one declaration);
- `style.css`: `font-family: var(--mdm-text)` put back on `#app` as well as on
  the scroller (the toolbar, the drop-down menus and the outline panel go
  roman too, through the three `font: inherit` rules that hang off `#app`,
  and the editor stops looking like an application);
- `main.js`: the button repainting itself before asking (`textFont` flipped and
  `applyTextFont()` called in the click handler), which is the one thing the
  toolbar of this editor never does;
- `main.js`: `applyTextFont()` dropped from the settings handler (the first
  press is the last: the value comes back from the host and nothing reads it);
- `main.js`: `SETTINGS.textFont` ignored at start-up, hard-coded to `roman` (a
  document left in the sans reopens in the roman, which is the memory of the
  toolbar gone);
- `extension.js`: the `-M mdm-text-font` pair dropped from `exportLook()` (the
  editor is in the roman and the export comes out in the sans, since the
  filter's own fallback is the sans on purpose);
- `mdm.lua`: the filter's fallback flipped from `sans` to `roman` (a plain
  `bin/mdm render`, which passes no look at all, changes the page it has always
  drawn, and carries 191 KB of faces into every self-contained export that
  never asked for them);
- `mdm.lua`: `[Scale=1.21]` left on `\setmathfont` in the roman branch (the
  same fifth too tall as the second mutation, on paper);
- `media/fonts/LatinModernRoman-Regular.woff2` deleted (the fallback serif
  draws the page and nothing says so, which is the failure the arrival check
  exists for).

One trap, in the runner rather than in the harness: a mutation applied with
`open(p, "w").write(mutate(open(p).read()))` truncates the file before the
argument is evaluated, so the mutation is handed an empty string, every anchor
misses and a whole round reports nothing. Read the file, then open it for
writing.

The outline and the follow (2026-09-06) added these five, each caught by one
test and no other:

- `main.js`: the `remeasureText()` dropped from `applyOutline()` (the caret
  keeps the place the old column gave it for four painted frames after the
  panel opens or shuts, which coming back from an open panel is 93px left of
  its line, out past the number);
- `main.js`: the `revealPlayhead()` at the end of `followPlayhead` dropped (a
  play made with the score under the fold sounds with nothing to see, and a
  page taken away from the music is never brought back);
- `main.js`: the `if (!following) return` dropped from `revealPlayhead()` (the
  setting is ignored and the music moves the page anyway);
- `main.js`: the `REVEAL_SLACK` of the guard in `showPlayhead` put back to the
  24px of room to spare it used to ask for at each edge (a system showing whole
  but resting near an edge throws the page half a pane to centre itself);
- `main.js`: `followPlayhead` given back the guard it used to carry, which kept
  the staff system the head was last seen on and revealed only when that
  changed (the follow waits for a crossing again, and a page taken away from
  the music mid-system is left parked for the length of a staff system before
  it comes back).

Two traps found while writing those, both of which had made a test pass for no
reason at all:

- a fixture whose score is the last thing in the document cannot be scrolled
  past (the bottom padding leaves about 50px), so "the reader walks away from
  it" is a scroll that clamps and moves nothing;
- `TALL_SCORE_FIXTURE` opens on its engraving, so there is nothing above the
  score to scroll and it cannot be put under the fold at all: the park moved
  the page by nothing, measured, and the test passed whatever the rule was.
  Both fixtures have prose on both sides of the score now, and the test
  asserts the park worked before it reads anything.

The brass chrome (2026-09-05) added this one, caught the same way:

- `style.css`: the `#app` dropped from the `#app .mdm-audio .abcjs-btn g`
  selector, which is the whole reason the ID is there. The vendored
  `abcjs-audio.css` paints the same glyphs through
  `.abcjs-inline-audio .abcjs-btn:hover g`, and at (0,3,1) that beats the
  (0,2,2) the rule is left with: the play button under the pointer came back
  #cccccc, the grey abcjs draws for the dark slab it ships with, on both
  sides.

The page turning with the music (2026-09-05) added these, all three caught,
each restored from a copy and checked by hash:

- `main.js`: the `revealPlayhead()` at the end of `followPlayhead` dropped (the
  crossing turns no page: the follow test waits out its 30 seconds for a
  scroll that never comes);
- `main.js`: the `place.top === followedSystem` guard dropped, so the page is
  brought to the head on every frame rather than at the crossing (the reader's
  park mid-system is undone within a frame, and the follow test reads the page
  back where the music is). Worth noting what did NOT catch this: 21 readings
  of the scroll over two seconds, which stay at one or two positions under the
  mutation as well, because `showPlayhead` leaves a head already on the pane
  alone and most frames of a pull are therefore no-ops. What tells the two
  apart is a reader taking the page away from the head, not the page standing
  still while nobody touches it;
- `main.js`: the `followedSystem === null` branch never taken, so the system a
  tune starts on is revealed instead of taken as read (a play press followed
  by a scroll to the foot of a long page is undone a second later, when the
  tune finishes priming: the bar test waits out its 15 seconds for the score's
  widget to be thrown away, and it never is).

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

The line numbers in the margin (2026-09-05) added eleven, all caught:

- `main.js`: the number decoration dropped from the walk of the document (no
  line carries one); the cover over a drawn block built with no widget (the
  block goes back to being a hole in the numbering); the cover left out of the
  test `hiddenBlockAt` makes for source out of the flow, which was written as
  "a block replacement with no widget" and had to become "with none of its own"
  (Up and Down walk past a score or an equation instead of stepping into it,
  which is how the two arrow tests caught it); the field the host's count is
  held in read as 0 (the editor numbers its own lines and stops agreeing with
  the text editor beside it).
- `extension.js`: `hiddenLines` posted as 0 (the host stops saying what it
  keeps back).
- `transforms.js`: the gap under the header left out of the count (every
  number is one short of the file's).
- `style.css`: the 3px the quote and the callout are given back (their numbers
  come out of column by the width of their bar); `pointer-events: none`
  dropped (the number is hit-testable, so a click on it is answered with a
  caret instead of being dead like the rest of the margin); the alt text of
  the `content` dropped (a screen reader reads the number before the text of
  every line); the weight and the style of the face dropped (a heading's line
  is 600 and its number came out bold with the rest of them at 400); the cover
  left without `position: relative` (its number is placed against the content
  box instead of the block, so it lands at the top of the document).

The YAML header on the exported page (2026-09-08) added five, all caught. The
block Quarto draws from a document's `title`, `subtitle` and `author` was held
only from the side that takes it away: `render.test.js` said it goes when the
editor is hiding the header and nothing said it comes back when the editor is
showing it, and nothing at all held the button that decides. The five run
against the whole chain, button to page:

- `mdm.lua`: the `hidden` branch taken whatever the metadata says (the page
  opens with no block at all, in either face).
- `mdm-look.css`: `#title-block-header` given `display: none` (the block is in
  the markup and drawn at nothing, which is what reading the HTML cannot
  catch and measuring the ink can).
- `mdm-roman.css`: `.title` dropped from the ladder's first level, leaving
  `body h1` alone (the page's own title falls out of the article ladder and
  back to Quarto's size while every heading under it keeps ours).
- `mdm-look.css`: the column put back on `width: 100%; max-width: 820px` (both
  faces fall to Quarto's 802px track; this is the rule the roman broke the
  first paragraph a word early under, and the sans did not, which is why the
  measure is now asserted equal between the two faces).
- `main.js`: the click's `askSetting` dropped (the button lights and the
  export goes on carrying the old value), and separately each of the two
  locks on a file with no header, the handler's `headerText === ""` guard and
  the `mdm-btn--off` class that makes the rule unreachable to the pointer.

One thing this round moved rather than added: `body .mdm-fit { font-size-adjust:
none }` lived in `mdm-roman.css` and now lives in `mdm-look.css` beside the rest
of the score's rules. It is a compensation on the engraving, not on the face,
and it was only harmless in the sans by accident, the sans setting no adjust to
inherit.

The face on paper and the words on a staff (2026-09-08) added these eight,
each caught by one test and no other. It also retires the tenth mutation of
the round above: `#app.mdm-text--roman .katex { font-size: 1em }` was how the
maths was held to the prose before `font-size-adjust` arrived, and there is no
such rule to drop now. What holds the maths today is the first of these.

- `style.css`: `font-size-adjust: ex-height 0.528` dropped from
  `#app.mdm-text--roman .cm-content` (the roman is drawn at its own 0.431
  x-height, a fifth small, and everything sized against the prose stays where
  it was: the headings, KaTeX's 1.21 and the words on a staff).
- `main.js`: `format: scoreFormat(prose)` dropped from the engraving call (the
  score goes back to abcjs's own sizes, a title at 27px beside a 16px
  paragraph, and the test reads the drawn size against the prose's lowercase).
- `main.js`: the follow lamp back to lighting while the page follows (the bar
  opens with a lamp on that nobody asked for, which is the convention the
  other four toggles keep).
- `extension.js`: the `!own &&` dropped from the `usable` guard of
  `exportLook` (an export made from MDM Dark carries the colours of whatever
  VS Code theme happened to be on, ground, card and ten syntax slots).
- `mdm.lua`: `PALETTE_SIDES` mapping the dark side to the light fallback
  table, which is one mutation caught twice, once on each path: the HTML block
  writes stackoverflow-light's slots onto a dark page, and the `.tex` writes
  them into a dark preamble.
- `mdm.lua`: the roman heading ladder falling back to the sans one (the paper
  heads a section 15% smaller than the screen does, which is the drift the
  export rule is written against).
- `mdm.js`: the measuring render given back its `staffwidth: box` (the page
  engraves at the width of the column where the editor engraves at abcjs's
  own, so the whole drawing, staff and notes and words, comes out 11% larger
  on the page).

The words on paper against the equations (2026-09-10) added these four,
three caught by a measurement of the printed page and one by the preamble
alone:

- `mdm.lua`: the Scale dropped from the roman's `\setmainfont`. The words go
  back to Latin Modern's own x-height, 9.96 pt of text under 12.05 of KaTeX
  maths, and the measurement reads the maths at 1.238 of the words; the
  preamble test misses its lever.
- `mdm.lua`: the Scale dropped from LaTeX's own Latin Modern Math. Caught by
  the preamble test alone, and that is a finding rather than a gap: Pandoc's
  template sets `\defaultfontfeatures{Scale=MatchLowercase}` before this block
  is read, which scales a maths face asked for with no Scale of its own to the
  lowercase of the main font, so the formulas still land at 12.21 pt beside
  words at 12.21 and no measurement of this page can tell the two apart. The
  explicit Scale is what holds under a template without that default: in a
  plain document an unscaled Latin Modern Math came out at 9.96 pt beside
  words at 12.21.
- `mdm.lua`: the roman asked for by its family name instead of the lmroman10
  files (luaotfload would hand the scaled body to Latin Modern 12, a narrower
  drawing than the editor's; the preamble test reads the file name).
- `mdm.lua`: a document's own `mainfont` overridden by the roman (the test
  that renders one with `mainfont: TeX Gyre Termes`).

The staff on paper against the words (2026-09-10) added these four, each
caught; two of them by one test only, which is worth knowing before either
test is thinned:

- `mdm.lua`: the print page asks abcjs for a 703 px staff again. Caught by
  the width the cache records (529 bp of ink against the 557 of abcjs's own
  740 px) and by nothing that measures the page: the gap between the lines of
  an abcjs staff does not depend on its width, so the staff on paper is the
  right size either way and only the line breaks move.
- `mdm.lua`: the 0.5 px stroke back on the staff lines. Caught by the
  measurement alone: the lines read 0.744 bp on a 4.826 bp gap, 1.71 of the
  editor's weight.
- `mdm.lua`: an abcjs score stretched to the box again (`width=\mdmscorewidth`).
  The staff reads 1.103 of the editor's size beside the words, 5.325 bp
  between lines under a 9.96 bp em; the preamble test misses its lever.
- `mdm.lua`: an abcjs score at Chrome's 0.75 bp a pixel instead of a
  sixteenth of the em. Caught the same way and with the same numbers, which
  is the clamp doing its job rather than a coincidence: the natural width is
  55.9 em and the box is 51.25, so the score is set at the box and draws
  exactly what the stretch above draws.

The words on a staff back at abcjs's own sizes (2026-09-10). The owner took
back the ladder it had, `SCORE_TEXT_ROLES` and `scoreFormat` in `main.js` and
in `resources/mdm.js`, so every title, part label, lyric and chord is drawn at
the size abcjs gives it, in the editor, on the page and on paper alike. The
reset that keeps the prose's `font-size-adjust` off the engraving stays: the
roman would otherwise draw abcjs's Times a seventh larger than abcjs does. The
three tests of the ladder in `webview-look.test.js` became two, `the words on
a score keep abcjs's own sizes` (word for word against a stock render of the
same tune, in the same page) and `a score that names a font size of its own
keeps it`; the page's test in `html.test.js` became `the score's own text is
drawn at abcjs's own sizes`. Three mutations, all caught:

- `main.js`: a `format` handed back to `renderAbc` (titlefont 17.22,
  gchordfont 9.97): the editor's words stop matching the stock render.
- `style.css`: the `#app code.language-abc` reset dropped: the words inherit
  the prose's 0.528, and the test reads the adjust on the title.
- `resources/mdm.js`: a `format` handed back to the page's engraving: the
  page's title leaves 27px, and the side-by-side test with the editor fails
  with it.

This also retires a mutation of the 2026-09-08 round above: dropping
`format: scoreFormat(prose)` from the engraving call is now what ships.

A selection that keeps its letters (2026-09-11). The selection layer, lifted
above the text so a selection shows on a code block's card, is blended into
the text instead of laid over it: VS Code's own themes give the selection an
opaque colour (#add6ff in Light Modern, #264f78 in Dark Modern, read off the
webview), and the four notes Ctrl+D picked in a tune came out as solid
boxes. `a word under an opaque selection colour keeps its letters` in
`webview-look.test.js` selects a word in a code block under each colour, on
its own side, and reads the pixels of the painted box. One mutation, caught:

- `style.css`: the two `mix-blend-mode` declarations on `.cm-selectionLayer`
  dropped: 0.0% of the box under #add6ff stands out of its ground.

The heading ladder back to Markdown's (2026-09-11). The roman's headings
leave article.cls's sizes (2.074 / 1.728 / 1.44 / 1.2 / 1.1) for Markdown's
top three and a halving below them, 2 / 1.5 / 1.25 / 1.125 / 1.0625 / 1, on
screen, on the page and on paper, while the sans keeps 2 / 1.5 / 1.25 / 1.1 /
1 / 1. The fifth level on paper has a format in both faces now, which is also
what lets a `#####` compile under `documentclass: article` (it stopped the
PDF with titlesec's "No format for this command"). `the roman heads a
document the way Markdown does, down to the body` in `webview-look.test.js`
replaces the article.cls test. New are `every heading is drawn on the page at
the size the editor draws it, in either face` in `html.test.js` and `on paper
every heading is the size the editor draws it, in either face, under article
and under KOMA` in `render.test.js`, which also holds the weight of every
level as it stands, h6 regular on paper where the editor draws 600 (open, and
noted over `HEAD` in `mdm.lua`). Twelve mutations over two passes, all
caught. The first pass skipped the four on `style.css`, whose hash moved under
it while the selection round above was landing, and the second ran them
against the new one.

- `style.css`: the roman h4 back at the sans's 1.1: the editor reads 17.6
  where it wants 18, and the page, still at 18, disagrees with it.
- `style.css`: article.cls's 1.728 back on the roman h2: the editor's top
  three read 32, 27.648, 20.
- `style.css`: the sans's h4 at the roman's 1.125: the sans test reads 18
  against 17.6, and the sans page disagrees with the editor.
- `style.css`: the roman h5 rule dropped from the editor: 16 where it wants
  17, against a page that keeps 17.
- `mdm-roman.css`: the h5 rule dropped from the page: the sheet check misses
  1.0625em, and the page reads [32, 24, 20, 18, 16, 16] against the editor's
  [32, 24, 20, 18, 17, 16].
- `mdm-roman.css`: the page's h5 at 1em rather than dropped: caught by the
  sheet check in the first pass and by the page against the editor in the
  second.
- `mdm-roman.css`: article.cls's 2.074 back on `body h1, body .title`: the
  sheet sizes h1 itself, the title reads 33.18 against 32, and the page's h1
  is 33.184 against the editor's 32.
- `mdm.lua`: no titlesec format for `\subparagraph`: the preamble check misses
  it, and the paper test's article render stops with the titlesec error.
- `mdm.lua`: no KOMA size for `\subparagraph`: 1.0625 is on one branch of the
  preamble, and on paper the roman's h5 under KOMA reads 1.0000 of the body.
- `mdm.lua`: the roman's h4 on paper at the sans's `{ "1.1", "1.43" }`:
  neither branch carries 1.125, and under article h4 reads 1.1000 of the body.
- `mdm.lua`: the sans's fifth level written at a leading of 1.2: caught by the
  preamble test, the only one that can see it, since the paper test reads
  sizes and a leading shows only in a heading that wraps.
- `mdm.lua`: `\bfseries` dropped from the titlesec format: the sizes do not
  move, and the paper test reads h1 under article as not set in a bold face.

This retires one mutation of the 2026-09-08 rounds above and restates
another. `.title` dropped from the first level of `mdm-roman.css` has nothing
left to drop: that sheet sizes h4 and h5 alone, and the title takes the 2em
of `mdm-look.css` in either face (dropping `.title` there is the same slip,
and it was not run in this round). The roman ladder falling back to the
sans's on paper is the `{ "1.1", "1.43" }` above, at its new margin: the two
ladders part at h4 and h5 only, so the paper is 2% off at h4 where it used to
be 15% off at h2.

The number in the middle of its row (2026-09-11). The box of a line's number
takes the line's own line height, `1lh`, where `inherit` handed down the
line's ratio for the number's 11px to multiply: an 18.7px box in a row of
27.2 and 14.3 in a heading's row of 41.6, so every number rode at the top of
its row, and the words, which their face places lower in the row, showed it
most in the roman. `a number stands in the middle of the row it counts, in
either face` in `webview-look.test.js` reads the box off the pseudo-element
and the digits' ink off a screenshot at two to the CSS pixel, for prose, a
paragraph that wraps, three levels of heading, a blank line, a quote, a line
of code and the cover of an equation, in the roman and in the sans. Three
mutations, each made by exact string, run alone and put back with the hash
of `style.css` checked, all caught:

- `style.css`: `line-height: inherit` back on the number: the `#` of the roman
  reads a 14.3px box in a row of 41.6.
- `style.css`: the prose row's 27.2px stated for every number: the same `#`
  reads 27.2 against 41.6.
- `style.css`: `top: 0` on the number, which overrides the static position:
  the `#` of the roman stands 13.43px above the middle of its row, the
  heading's padding.

The README's pictures (2026-09-11). The README the Marketplace shows carries
the tour clip as a GIF and a picture of a score block in the editor's colours
(`tools/demo-clips/abc-card.js`), both fetched from `vscode-mdm/docs/` on
main, which the package leaves out. Four tests in `packaging.test.js`: every
picture is in the docs folder with its alt text, the score block among them;
the folder holds nothing else but its notes in Markdown; every clip marker is
followed by its GIF; no ABC is written as plain code. All four caught:

- `docs/abc-card.png` moved out of the folder: the first fails on the name.
- The two screenshots the clip replaced and the two `.mdm` files they were
  taken from, still in `docs/` when the test was written: the second fails
  naming the four, and passes once they are deleted.
- The clip's line written as a `<video>`: the third fails.
- An indented ```` ```abc ```` block appended: the fourth fails on its `X:`
  and `K:` lines.

The own looks' selection (2026-09-11). MDM Light, Dark and White select in
brass, `--mdm-selection`: the accent ink at 25% on white and 30% on black,
half that out of focus. They used to take the VS Code theme's colour, which
belongs to the theme's side. `the editor's own looks select in brass` in
`webview-look.test.js` reads the computed colour of a selection in and out of
focus under each own look, with the other side's VS Code colours handed over,
and under Light Modern, which keeps VS Code's. It failed before the change:
MDM Light took Dark Modern's `rgb(38, 79, 120)`. `a word under an opaque
selection colour keeps its letters` moved its VS Code cases onto named
themes, since the own looks no longer spend VS Code's colour, and keeps MDM
Light and Dark as cases of their own. Three mutations, each by exact string
and put back by the same string, all caught:

- `style.css`: the two blocks that set `--mdm-selection` removed: MDM Light
  reads Dark Modern's blue and grey.
- `main.js`: the line that sets `mdm-look--own` removed: the same.
- `style.css`: both `mix-blend-mode` declarations removed: the pixel test
  finds 0.0% of the box standing out under Light Modern's
  `rgb(173, 214, 255)`.

The six points on the headings (2026-09-11). One ladder in both faces, 2 /
1.5 / 1.25 / 1.125 / 1.0625 / 1, the sans giving up its 1.1 / 1 / 1, on
screen, on the page and on paper. On paper a sixth level is a heading, bold,
set by the preamble's `\mdmheadsix` with its label; the bold roman is drawn at
the editor's x-height (`ROMAN_BOLD_SCALE`, 0.528 / 0.444, where the four files
shared the regular's scale and the bold came out 3% large); a class with
chapters sizes a heading by its Markdown level (`heading_commands` asks
Pandoc's writer which command draws `#`), and a `#` opens a page as the class
does; the title is 2em and bold; a heading that wraps steps 1.3 of its size;
KOMA indents no level under `indent: true`; and the rule under h1 and h2 hangs
from the heading's baseline at the distance the editor draws it. The page
leaves the editor's air around a heading, a blank line and the heading's
padding, against two rules of Quarto's about the head of the document and
Bootstrap's padding on a quotation. In the editor CodeMirror's widget buffers
stand at the top of a heading's line, where they grew a roman heading's line
by 4 to 7px and let it drop when the caret came in.

New in `render.test.js`: `on paper the four shapes of the roman are drawn at
the editor's x-height`, `on paper a heading that wraps is set at the editor's
leading, under both kinds of class`, `on paper the rule under h1 and h2 stands
where the editor draws it, under four kinds of class`,
``on paper a chapter opens its page and stands where an article's `#` stands``,
`a sixth-level heading reaches the paper as a heading, with its label` and `on
paper the title is the size and weight the page gives it, under both kinds of
class`. The ladder on paper is now `... in either face and under four kinds of
class`, with report, scrreprt and KOMA under `indent: true` added and every
level held bold and flush; `a heading leaves the editor's air over its rule`
reads the preamble's one rule. New in `html.test.js`: `the page leaves the air
around a heading that the editor leaves, in either face`, over three documents
and the head of the column. In `webview-look.test.js` the ladder is one test
per face, and `a heading's line keeps its height, with the caret away and in
it` is new. Twenty-four mutations, each made by exact string, run alone and
put back with the hash of every file checked, all caught, every file back byte
for byte:

- `mdm.lua`: no `\linespread{1}` in a heading's font: a wrapped roman h1 under
  article steps 1.8421 of its size, and every level with it.
- `mdm.lua`: the level-to-command map not read from the writer, every class
  taken for an article: the roman h1 under report reads 2.4879 of the body.
- `mdm.lua`: the two bold roman files at the regular's scale: the bold is
  drawn at 1.0302 of the regular's x-height.
- `mdm.lua`: the rule hung from the bottom of the heading's line (no
  `\prevdepth`): 1.530 em under a roman h1 under article where the editor
  draws it at 0.749, and the preamble check misses the baseline.
- `mdm.lua`: the rule distances of the two faces swapped: 1.060 em under the
  same h1.
- `mdm.lua`: the Header filter leaving a sixth level to Pandoc: the `.tex` has
  no `\mdmheadsix{Six}\label{six}`.
- `mdm.lua`: the sixth level's label dropped: the same assertion, which reads
  the heading and its label as one string.
- `mdm.lua`: both `\@maketitle` patches dropped: the roman title under article
  reads 1.7280 of the body.
- `mdm.lua`: KOMA's subtitle left in the disposition's bold: the subtitle
  under KOMA comes out bold.
- `mdm.lua`: the `\@title` patch dropped: the subtitle under article comes out
  bold.
- `mdm.lua`: `indent=\z@` dropped from KOMA's redeclaration: under
  `indent: true` the roman h5 starts at x 56 where h1 starts at 43.
- `mdm.lua`: KOMA's levels under the first not redeclared: a wrapped h4 and h5
  step 1.5644 and 1.6565 of their size under KOMA.
- `mdm.lua`: titlesec's `\chapter` left in its top class: the first `#` under
  report stands 4.228 em lower than under article.
- `mdm.lua`: no `\chapterbreak`: under report the chapters are not a page
  each.
- `mdm.lua`: no `\@nobreakfalse` before a chapter: the same, the `#` straight
  under another staying on its page.
- `mdm.lua`: KOMA's chapter left with its own skips: the first `#` under
  scrreprt stands 6.616 em lower than under KOMA's article.
- `mdm.lua`: the rule taken out of KOMA's chapter line format: one rule on the
  page under scrreprt, where h1 and h2 have one each.
- `mdm.lua`: `\bfseries` dropped from `\mdmheadsix`: h6 under article is not
  set in a bold face.
- `style.css`: the widget buffers of a heading back at text-top: the roman
  h1's line is 48.58px where 1.3 of its size is 41.60.
- `mdm-look.css`: a heading's margins back to Quarto's: 16.99px from a roman
  h1 to the prose under it on the page, 23.4 in the editor.
- `mdm-look.css`: Quarto's 2rem under a paragraph before a section: 34px from
  the opening paragraph to its `##` on the page, 30.4 in the editor.
- `mdm-look.css`: Quarto's zero margin over the first section's h2: the same
  gap at 16px.
- `mdm-look.css`: a heading that opens the column keeping the blank line over
  it: its text 28.8px under the top of the column, 12.8 in the editor.
- `mdm-look.css`: Bootstrap's padding back on a quotation: 26.63px from the
  prose to the quotation's text, 16 in the editor.

The preamble check of the round above now reads each level on its own command
instead of counting pairs of sizes, since the title writes 2 / 2.6 a second
time, and titlesec's `\titlerule` is asserted gone.

### Word division (2026-09-11)

Run the feature's three suites with `npm run test:hyphenation` from `tests/`.
Final verification: all 13 feature tests passed. The complete suite ran 363
tests; its four failures (a render copy still being synchronized, the PDF
ragged-edge expectation, the old whole-word default, and the toolbar order)
were corrected and passed on a focused rerun. The fast suite also passed.

`hyphenation.test.js` checks the bundled English and Spanish cuts, exception
words, minimum fragments, all ten languages, unsupported languages, safe
language tags and byte-identical copies of the engine and dictionaries.
`webview-hyphenation.test.js` checks the enabled default, stored off choice,
the settings round trip, actual wrapping, Backspace from the lower fragment
through the upper one, drawn caret alignment, Delete with multiple carets,
undo/redo, typing, resize, selection/copy and clean outgoing text. It also
checks that code, formulas, headings and URLs stay untouched and that a
hidden header and an external language change select the correct patterns.
`hyphenation-export.test.js` renders self-contained English and Spanish HTML,
compares its opportunities with the editor, measures a visible hyphen, copies
the prose and tests the off setting. Its narrow PDFs require an actual split
in both languages when enabled and none when disabled, checked with pdftotext.

Two isolated mutations were caught: reversing the pattern weight parity in
a copy of the engine failed the known-cut assertion; suppressing generated
hyphens with an injected stylesheet failed the browser's actual-wrap check.
The unchanged unit and webview tests then passed (10 tests). These mutations
used temporary copies and a separate browser page so concurrent sessions
never saw an altered repository file. The existing PDF whole-word measure
test now explicitly selects `mdm-hyphenation:none`; the enabled case uses
finite right stretch so TeX can divide words while keeping a ragged edge.

PDF uses its own language patterns and line-breaking algorithm, so its exact
cuts can differ from HTML. Regional tags select the bundled base language
(English uses American patterns); language is selected per document, not
detected word by word. The dictionary build is reproducible with
`vscode-mdm/vendor-src/build-hyphenation.py` and requires TeX Live only when
regenerating the bundled data.

### Word division without a language, and its lamp (2026-09-11)

Decided with the owner: a document whose header names no language keeps its
words whole, in the editor and in both exports, and the hyphenation button is
lit while a language is dividing the prose, which is division on and the
header naming a language the extension has patterns for. Before, a missing
`lang` was read as English and the button never lit.

The export follows the lamp and not the setting (`exportHyphenation` in
`extension.js`), because the filter cannot tell on its own: Quarto 1.9.37
hands a Lua filter `lang: en` for a document that names none, and writes
`<html lang="en">`. Measured with a probe filter printing `meta.lang` on two
documents that differed only in a `lang: es` line: `en` without it, `es`
with it.

The tests. `hyphenation.test.js`: a header naming no language gives `""`,
and `positions` and `segments` with no language give nothing.
`transforms.test.js`, "the host reads the header's language as the editor
does": `langOf` against `language()` over every header of the withLang
table, in LF and in CRLF, and a `lang:` in the body ignored.
`extension-host.test.js`, "the export divides the words the editor divides,
and no others": `es`, `es-CU` and a CRLF file send `auto`; no `lang`, no
header, `ca` and division off send `none`. `webview-hyphenation.test.js`:
the lamp dark on the default, lit with Spanish, dark again after "No
hyphenation", lit on `es-CU` and dark on `ja`, plus a new test where a header
naming no language divides nothing, ticks nothing and leaves the lamp dark
until a `lang: en` typed on screen divides, ticks and lights at once. The
Delete and multiple-caret test now runs under a hidden `lang: en` header,
since without one nothing divides.

Fixed in the same round: the two "self-contained HTML uses the editor's cuts"
tests of `hyphenation-export.test.js` had been red since the default became
`none`. The editor side of the comparison was opened without division, so it
divided nothing and every cut on the exported page read as a disagreement. It
is now seeded with `hyphenation: "auto"`, and both pass.

Mutations, each applied, run and restored in one command, with the four
source files checksummed before and after the whole run:

- `language()` falling back to `en`: caught by the language test, the
  host-reads-as-editor test and the identical-copies test, and in Chrome by
  the no-language test.
- `positions()` losing its guard and assuming `en`: caught by the language
  test (and the identical-copies test).
- The export sending the setting alone: caught by the export-divides test.
- The export ignoring the patterns (`lang !== ""`): caught by the same test,
  on `ca`.
- The lamp never lit: caught by four webview tests.
- The lamp lit on the setting alone: caught by the no-language test and the
  `ja` case.
- No lamp update on a document change: caught by the no-language test, on
  the typed `lang:`.
- No lamp update once the view exists: caught by the hidden-header `es-CU`
  test.
- `langOf` without its `toLf`: nothing failed. An equivalent mutant, since
  `splitFrontMatter` takes CRLF and a multiline `$` stops before a `\r`, so
  the `toLf` was dropped and the CRLF assertions kept.

Results after the round: `npm run test:fast` 146 of 146, `npm run
test:hyphenation` 17 of 17, and the whole suite (`npm test`) 392 of 392.

### The tick on "No hyphenation", and lines that end where the page ends them (2026-09-11)

The owner saw a document without `lang` open the menu with no entry ticked.
The tick now says what the page is doing: the language while one divides,
and "No hyphenation" whenever nothing does (off, no `lang`, or a language
without patterns such as `ja`), so there is always exactly one, and the lamp
is lit exactly when it is on a language. Mutation: returning `""` instead of
`"none"` for a document that divides nothing failed the no-language test and
the hidden-header `es-CU`/`ja` test.

The owner then reported that the division "does not come out in the HTML".
The page was right and the editor was not: on example.mdm with the column at
820 px on both surfaces, every word sat at the same x to a tenth of a pixel,
and "The boundary" ended at 818.95 px, yet the editor set "bound-|ary" and
the page kept the word. CodeMirror wraps with `white-space: break-spaces`
(its `.cm-lineWrapping`, CodeMirror 6.43.9), in which the space after the
last word of a line takes room and has to fit; the page lets it hang. Toggled
on the real pages: the editor at `pre-wrap` stopped dividing the word, the
page at `pre-wrap` still kept it. Not a fault of word division: without it
the editor moved "boundary" down a line instead. `html.test.js` only compared
the first line of the first paragraph, which ends nowhere near the margin.

The test, "every paragraph of the page ends its lines where the editor ends
them", compares the word each line ends on for every paragraph that shows the
same characters on both surfaces (formula text left out, and a row counted
as new only half a line down, since KaTeX's sub- and superscripts sit off
their row). Seen to fail before the fix, with hyphenation off: the string
paragraph ended its lines on `The`, `wavelength` in the editor and on
`boundary`, `an` on the page. The fix is `#app .cm-lineWrapping { white-space:
pre-wrap }` in `style.css`, after which the test passes; at 1400 px neither
surface divides a word of example.mdm and at 900 px both divide "bound|ary".
The whole suite afterwards: 393 of 393.

Found on the way: below a pane of about 680 px the two columns parted again,
the editor's held at 579 px and the page's at 500 in a 600 px window. The
next round has the cause and the fix.

### What is wider than the column, and the fill under a score (2026-09-11)

The editor's column would not go under 579 px. First blamed, wrongly, on the
code blocks; hiding each kind of block in turn at a 600 px pane settled it:
hiding the display equation of the string took the column to 500, hiding
code, scores, tables or the header changed nothing, and every line of prose
or code had a min-content of 80 px or less. `.cm-content` is a flex item and
its `min-width: auto` is its min-content, which the 579 px equation set even
though its `.katex-display` scrolls. The fix is `min-width: 0` on
`.cm-content` (style.css). The page had the mirror fault: its column was
500 px, but the equation stood out of it and the whole page scrolled
sideways. It now scrolls inside its own box (`body .katex-display` in
mdm-look.css), with the editor's 0.25em of room above and below so that
`overflow-y: hidden` crops none of the 3.3 px KaTeX draws under the sum.
Measured and not resolved: the space around that equation at 1200 px is 16.5
px above and 11.7 below on the page against 23.6 and 19.8 in the editor; the
room brings each side 4 px nearer.

The fill under a score, decided by the owner: the fill spans the column on
both surfaces, and its side padding gives way before the drawing does
(`clamp(0px, (100% - natural) / 2, 0.8em)`, the natural width written on
each card by `fitScores` in the editor and by mdm.js on the page's new
`.mdm-card`), so a score is drawn at the same size with a fill as without
one at every width. Before, the editor lost the 1.6em as soon as the column
was narrower than drawing and padding (574 px against 600 in a 600 px
column), and the page hugged the drawing with the fill and drew it 714 px
wide where the editor drew 740. The PDF is untouched: there the fill still
takes 1.4em from a score that fills the measure.

Tests: `webview-look.test.js`, "a narrow pane narrows the column, and a wide
equation scrolls in its own box" (600 and 500 px) and "a fill under a score
never makes the drawing smaller" (1400, 850, 700 and 400 px: filled and bare
drawings equal, the card the width of the column, the ground whole, in part
and gone); `html.test.js`, "a narrow window narrows both columns alike, and a
wide equation scrolls in its own box" (600 px, no page scroll, no crop) and
"a filled score is drawn at the editor's size, on a card the width of the
column" (1200 and 700 px, on a new render of example.mdm with the paper
fill). The dark-look test reads the fill on `.mdm-card` now.

Mutations, each applied, run and restored in one command with the files
checksummed before and after:

- No `min-width: 0` on the column: both narrow-width tests failed.
- The editor's fill back to a fixed 0.8em: the editor's fill test failed.
- `fitScores` writing no natural width: the same test failed.
- The page's card back to a fixed side padding: the page's fill test failed.
- mdm.js writing no natural width on the card: the same test failed.
- The page's equation rule removed: the narrow-window test failed.
- The page's equation box without its room: the same test failed.

### The header the hyphenation menu writes (2026-09-11)

The owner, who keeps the header shown, chose a language for a file that had
none and watched three lines of YAML appear over the document. What was
asked for: write the header, since that is where a document's language goes,
but do not show it, and let the YAML button go from greyed to pressable so
the reader can open it when they want it.

So `writeLanguage` (`extension.js`) puts the document on the hidden mode
before it writes the line, and only when the file had no header at all and
was showing headers. `sendSettings` tells the editor at once. Where the mode
is kept is whatever mdm.frontMatter is at the time: another session was
rewriting that very thing while this landed, and the test reads it from
wherever `writeSetting` puts it rather than naming a store. Before the edit and not after,
because the update the edit sends back would otherwise carry the header for
one frame and the reader would see it flash.

A first attempt is worth naming, since the code is gone: a header holding
nothing but `lang:` was made invisible to the editor everywhere, button
greyed for good. It was wrong on the owner's terms, the button has to become
pressable, and it also left a document unable to grow a real header.

Two things kept from it. The webview reads the document's language from the
header in its text only while the text carries the file's header
(`documentLanguage` in `main.js`): with the header kept aside, a header typed
at the top of the text is a block below the file's, and reading the language
there took word division away in the editor while the export, which reads the
file's first header, was still told to divide. And the settings message takes
the editor to the top of the document only when there is a header to appear
or disappear there, because the menu now changes that mode for a document
whose text does not move, and a reader choosing a language halfway down was
thrown back to the first line.

Tests: `extension-host.test.js`, "a header the menu creates comes up hidden,
and the button can open it" (the mode kept, the editor told, the text without
the header, the margin counting 4, and no update anywhere carrying the
header) and "a language written into a header already showing leaves it
showing"; the existing "a file with no header gains one" now also pins that
nothing is written when the document was already hiding; `webview-look.test.js`,
"a mode change with no header to move leaves the reader where they were";
`webview-hyphenation.test.js`, "while the file's header is kept aside, a
header typed in the text does not name the language".

Mutations, each swapped in, run and swapped back in one command with the file
checksummed before and after (the swap back undoes its own string, since
another session was editing `extension.js` at the time; removing a block by
replacing it with the empty string breaks that and left the file mutated
once, so a removal puts a marker comment in its place):

- The created header not hidden: the comes-up-hidden test failed.
- The mode written after the line instead of before: the same test failed, on
  the update that carried the header.
- The mode written for a file that already had a header: the
  already-showing test failed.
- No guard on the scroll to the top: the reader-where-they-were test failed.
- The language read from any header parsed in the text: the typed-header test
  failed.
- The flag adopted after the language is read, as it used to be: nothing
  failed. The text change that follows the update reads the language again,
  so no result depends on the order; kept as the order that reads right.

### Word division is the document's own (2026-09-11)

Earlier that evening every button of the bar was made the document's own,
kept in `globalState` under the document's URI. The owner turned it back the
same night, "I am leaving the global config as it was, from settings", and
then drew the line where it belongs: "one can have documents in several
languages, so hyphenation will be the only button that has to be remembered
document-wise". So the bar went back to `settings.json`, one state for every
document at once, and `mdm.hyphenation` alone is kept per document, with the
setting as where a document starts.

What that leaves in `extension.js`: `readSettings` and `readPalette` as they
were, `writeSetting` taking the document and sending the division to
`keepDivision` while every other key goes to `settings.json` as before, and
`documentSettings` laying the division kept over the settings for the page,
for the settings message and for the export. What `writeSetting` returns says
which of the two happened, because a write to `settings.json` reaches every
editor through the configuration listener while a division reaches only the
editor it was pressed in.

Kept from the round that was reverted: `vscode._memento()` in the mock (the
Memento VS Code hands an extension, held as JSON), `boot`'s fifth argument,
the `toHost` option of `open()` in `webview/helpers.js` with the host
answering the page's own `ready`, and `webview-memory.test.js`, rewritten to
the line the owner drew. The hyphenation menu's hook of the same evening
(`writeLanguage` hiding a header it creates) now writes `mdm.frontMatter`
into `settings.json`, so it hides the header of every open document, and its
test reads the write from there.

Mutations, each written in, run, and taken back out by the inverse
replacement in one command, with the file hashed before and after. Every one
was caught and the file came back to the same hash each time:

- `documentSettings` ignoring the division kept: 4 host tests and the
  end-to-end test failed.
- One division for every document, which is the setting again: 5 host tests
  and the end-to-end test.
- The division written to `settings.json` like a look: 5 host tests.
- The division kept but its editor not told: 2 host tests and the end-to-end
  test.
- A kept division let past the allowlist: the allowlist test.
- `exportLook` reading the setting instead of the document: the export test.
- The bound forgetting the newest documents instead of the oldest: the bound
  test.
- Opening a document not counted as using its division: the bound test.
- The page built on the settings alone: 2 host tests and the end-to-end test.
- The hyphenation menu's hook taken out: the comes-up-hidden test of the
  session that wrote it.

Before and after the round: host 82 of 82, end to end 1 of 1. The rounds run
that evening against the version where the whole bar was the document's are
gone with the code they measured.

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
