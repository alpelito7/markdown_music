# MDM regression suite

Tests that pin down the verified behaviour of the project: the editor in
the webview, the host↔webview protocol, the text mapping and the Quarto
render chain (HTML and PDF). They run on the native Node runner (>= 20), with no
frameworks.

## How to run

```sh
cd tests
npm install          # first time only (puppeteer-core, for the webview suite)
npm test             # everything (~22 min on the owner's machine, 2026-09-12)
npm run test:quick   # everything but render.test.js, which alone is ~13 min of PDF renders (~9 min)
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
| `extension-host.test.js` | 97 tests of `vscode-mdm/extension.js` against a mock of the API (`mocks/vscode.js`): the settings allowlist against injection from `settings.json` (and the clamp of `mdm.outlineWidth`, the one setting that is a number), what a document keeps of its own word division (kept in `globalState` under the document's URI and never written to `settings.json`; one document's division not another's, and coming back with it across a restart; a press answered in its own editor, while a look pressed beside it goes to `settings.json` and reaches both editors, each with its own division over it; `mdm.hyphenation` as where a document starts, with what the document was left on outranking it; a kept value held to the same allowlist on its way into the page; the 500 documents used last kept and the rest forgotten oldest first; and an export dividing as the document it is exported from), the ready/update/edit protocol, the conditional echo (the first-Enter regression), the `withFrontMatter` flag travelling with the text and the count of the lines the editor is not being sent travelling with it (four for a document whose header is hidden, zero shown and zero for a file with no header), a CRLF document (the caret jump on Windows: it reaches the editor in LF, is written back with its CRLFs read raw out of the mock's store, and neither grows nor echoes however much is typed into it, which needs the mock to report the document's EOL the way VS Code does, a vote and not the first line break it finds), external and configuration changes, the syntax palette in the HTML and in the `palette` messages, dispose, and the audio wiring in the HTML (synth and soundfont URIs, the widget css, `unsafe-eval` and `connect-src` in the CSP). And export: it saves a dirty document before rendering (and leaves a clean one alone), runs `quarto render <doc>.qmd [--to html|pdf]` from the document's folder (a fake `quarto` on a PATH holding nothing else records arguments, cwd and the copy it was handed), makes that copy point at the filter the extension ships and leaves the `.mdm` untouched, drops the copy afterwards whether the render worked or not, keeps `format-links` when the document asks for them, names both formats on the command line when both were asked for (a header that declares none used to come back with the HTML alone), offers the Open HTML/PDF buttons that fit, and refuses a format that is not in the table before starting a process (the value comes from the webview). And the light half of it: with no `quarto` on the PATH the notification names Quarto and the log says where to get it, a PDF with scores stops only when no Chrome can print it and neither filter road is whole, prints the HTML page when Chrome exists but TeX's helpers do not, is waved through when the header names an `mdm.chrome` for the filter to resolve, while one without scores renders anyway; when Quarto reports no TeX, Chrome prints the HTML as PDF without overwriting an existing HTML, `.tex` or resource folder, a failed print falls back to the TeX notice, and a failed render puts Quarto's whole output in the MDM channel and the "Show log" button opens it, and a `.qmd` already in the way stops the export instead of being overwritten. The header rewrite is checked on its own (block list, flow list, a header with no `filters` key, no header at all, a quote in the path), and so is the dialect written beside it (a header gains it, a document that names a `from:` of its own at the top level or under a format keeps it, and a line of the body that opens with `from:` is prose); so is the fence test that decides whether a score is there, and the filter the extension carries is compared file by file with `_extensions/mdm`. And the look that rides with an export: the side of a named theme, of the three fixed values and of the workbench while on `auto`, the three score settings, the palette spelt without its `#`, and a palette from the other side left behind. And the rule the copy draws: a line of dashes with a line straight under it gets the blank line Pandoc needs, put in the copy and never in the document, with the fences it must not reach inside stepped over. And the two bases an image path hangs from: the folder of the document and the root of its filesystem in the HTML, with the resource roots that make them loadable, and neither of the two for a document that is not a file on disk. The export is named after the document's stem whatever its extension (a `.md` opened through "Open With" used to come out as `notes.md.qmd` and `notes.md.html`). And what it does when something goes wrong under it: the reader's own `.tex` put aside for the render that would write over it and put back after, a Chrome that never finishes printing stopped by a wall clock, a folder that cannot be written to named instead of a Quarto that never ran, a render error inside the print fallback kept apart from a missing TeX, one export of a document at a time with the second told so, and the page named after the document in the copy Quarto reads. | Node |
| `audio-assets.test.js` | 4 tests of the player's vendored assets: the copies of abcjs 6.7.0 and abcjs-audio.css under `vscode-mdm/media` byte-identical to those in `_extensions` (so they cannot drift), the bundle whole (engraver and synth both exported), the 88 keys A0–C8 of the piano present and carrying a real mp3, and the harness loading the same audio assets the real webview page does (abcjs as a plain script, the soundfont path, the stylesheet, the CM6 bundle). | Node |
| `packaging.test.js` | 5 tests of what the published package carries and claims, which using the editor cannot catch: the `LICENSE` of the repository and the copy of it inside `vscode-mdm/` (vsce reads the one in the package root) byte for byte and against the `license` field of the manifest, every package listed in the bundle's `VERSIONS.json` credited by name and version in both notices files (so a `npm run vendor` that pulls in a new dependency fails until somebody credits it), the licences the extension's notices have to name (abcjs, CodeMirror, KaTeX, and the share-alike of the Musyng Kite soundfont, which is an obligation and not a courtesy), the repository's notices covering a local abcm2ps build when one sits in `tools/bin/` (none is tracked; the check skips without one) with the LGPL and GPL texts present in `licenses/` and the upstream source named, and the note beside the samples agreeing with the notices on the licence. | Node |
| `theme.test.js` | 26 tests of `vscode-mdm/theme.js`: JSON with comments and trailing commas, TextMate scope matching (prefix by dot, the most specific wins, a tie goes to the last, selectors with a space ignored), the `include` chain, finding a theme by id and by `%nls%` label, sanitizing down to hex colours (those values go into the HTML of the webview), `tokenColorCustomizations`, and VS Code's built-in Monokai read from disk when it is installed. | Node |
| `render.test.js` | 51 tests of `bin/mdm` + `_extensions/mdm/mdm.lua`: the CLI guards, HTML (2 figures, `mdm-play`, escaping of `&`/`<`, abcjs deps, and that ` ```music ` is NO LONGER an alias), PDF with the default engraver, the editor’s own abcjs loaded into a headless Chrome and printed to a vector PDF then trimmed with pdfcrop (a cache entry under its own `abcjs` digest with the `.w` sidecar, nothing of the EPS pipeline left beside it and no abcm2ps fallback tripped, `%%staffwidth 200pt` coming out 132 pt of ink and centred, the wide score at the text width, an inkless block refused by its zero-ink bbox and falling all the way back to source text), the equations set by the vendored KaTeX through the same Chrome (a `.pdf` and a `w h d pw ph` `.dim` sidecar per formula on the 8 px pagelet grid, the inline one inserted in a `\makebox`+`\raisebox` that lands it on the baseline, the display one centred in its band, and `mdm-engraver: abcm2ps` leaving every formula to LaTeX), and the abcm2ps pipeline forced by `mdm-engraver: abcm2ps` where its EPS internals are what is pinned (cache by sha1 of the source with its trailing newline, the `.w` sidecar, a BoundingBox trimmed and consistent with `.w`, a narrow score < 330 pt centred in the `.tex`, a wide one at `width=\mdmscorewidth`, a warm cache that does not run abcm2ps again, and a tune naming neither `X:` nor `K:` engraved all the same (forced to abcm2ps: abcjs falls back by itself), with the `X:1` and the `K:C` the engraver wants written into the cached `.abc` while the cache keeps the name of the block as it was written), the fill and the alignment a score is given (a box in the paper of the side, the padding given back so a score at the text width still fits the measure, and the narrow score centred or lined up left), a score of several staff systems cut into one clipped image per system so that a page can break between two of them where the engraving is already blank (the `.cuts` sidecar the engraver writes, one position per gap and each below the one before it; the trims of the slices tiling the drawing exactly, all of them the one image at the text width, in a single band and stack; and a twelve-system score, 856 pt against the 622.7 pt a page holds, coming out over two pages, where the same drawing with its sidecar taken away goes down whole and needs three), the title block drawn only when the header is on screen (`mdm-front-matter:hidden` takes the title, the subtitle and all three of the keys Quarto keeps the author under, in HTML and in the TeX), the typography of the page (the maths at KaTeX's 1.21 and code at the stylesheet's 0.88, ragged right and microtype's expansion off, with the opening paragraph of `example.mdm` breaking after `source` as it does in the editor, read back with ghostscript's txtwrite, and a document naming its own `mathfont` left unscaled), the measure of the page (the editor's 51.25 ems where the paper holds them, the clamp where it does not, and a document with a `geometry` of its own left alone, each read back out of the finished PDF with ghostscript's txtwrite, since the look paints the sheet and the ink of a rule cannot be measured against it), the colours an engraving is drawn in (the ink of the side at the head of the EPS, the grey of the staff lines around the run that draws them, none of it when the staff is asked for in ink, and a cache entry per pair of colours), the dialect the copy is read in (a heading under a paragraph and under the closing fence of a score, and a quote under a paragraph, all of them blocks and not text, while a document naming its own `from:` is left in Pandoc's), and the look block the filter writes on `html:root`: it rides on every HTML render, music or no music (and drags no abcjs along when there is none), it reads the `-M mdm-*` metadata, and it lets nothing else through (a colour by name, a value carrying CSS of its own or a `</style>`, a side or an alignment that is not on the list, all dropped for the fallback), and the margin block of the other formats, which `bin/mdm` turns off (a document declaring html and pdf renders without it, and one that says `format-links: true` keeps it). And the same look on paper, read off the `.tex`: the light side and the fallback palette written out slot by slot when nothing is passed, the ground and the ink of the side that is, the ten slots over Pandoc's token commands with no bold left on them, the sans, the heading sizes and the hairline colour, and a document with no code block at all compiling all the same (Pandoc writes the token commands only for one that has code, so the block that repaints them asks for them first). And what a page and a paper make of a figure: an image named by an absolute path copied into the cache and pointed there, in the HTML and in the TeX, since Quarto rewrites such a path into a relative one that points at nothing. And the engine the formulas are set with: KaTeX, its faces and `mdm-math.js` riding with the page as a dependency, the formulas left as their own LaTeX in a span for it to set, no CDN and no MathJax anywhere, and the whole engine inside the file when the document asks for a self-contained page. And an SVG figure printed to PDF by the filter's own Chrome, named after the drawing and at the drawing's own size, with no `\includesvg` left for LaTeX. And the rule under h1 and h2 in the `.tex`: one `\mdmheadrule` for both kinds of class, hung from the heading's baseline (`\prevdepth` taken off) at the distance the editor draws it in the face, and titlesec's own `\titlerule` gone. And the face the words are set in: `mdm-text-font:roman` puts Latin Modern in `--mdm-text`, brings the four woff2 faces beside the page as their own dependency with the rule that takes KaTeX's 1.21 back off the maths, and takes all four inside the file on a self-contained export (24 inlined faces against the 20 of KaTeX alone), while a render that did not ask for it carries none of it, which is what `bin/mdm` on its own gets; and on paper the roman drops the sans main font and the `\familydefault` push under pdfTeX, keeps `\setsansfont` for a `\textsf`, and sets the maths in Latin Modern Math with no `Scale=1.21` anywhere, both of which were answers to a sans standing beside them. And the headings on paper, measured: the six levels in either face and under four kinds of class (`documentclass: article`, the KOMA class Quarto gives a document that names none, and report and scrreprt, where `#` is `\chapter`), and under KOMA with `indent: true`, each read back with txtwrite as a size over the prose (by its x-height in the roman, whose bold is drawn at a scale of its own) and held to the ladder the editor draws, 2 / 1.5 / 1.25 / 1.125 / 1.0625 / 1 in both faces, every level bold and flush with the first, which is also a fifth level that compiles under a standard class (a `#####` used to stop the PDF with titlesec's "No format for this command") and a sixth that is a heading in an article, `\mdmheadsix` with its label, where Pandoc wrote a plain paragraph; the four shapes of the roman drawn at one x-height; a heading that wraps set at the editor's 1.3 leading under both kinds of class, read off pdftotext's word boxes; the rule under h1 and h2 where the editor draws it, read off the pixels at 600 dpi under the four classes; a chapter opening its page (a right-hand one under book and scrbook, a `#` straight under another included) and standing within half an em of where the same `#` stands without chapters; and the title of the YAML block at twice the body and bold, with the subtitle not bold. It renders in `tests/tmp/` with symlinks to `_extensions/` and `tools/`; it never touches the repo. | quarto, TeX (gs, pdfcrop), google-chrome, abcm2ps (in `tools/bin/` or the PATH) |
| `webview-editing.test.js` | 98 tests of the CodeMirror editor itself (`vscode-mdm/media/main.js`), in a real Chrome on `webview/harness.html`: **multicursor** (Alt+click adds carets and typing lands at both; `editor.multiCursorModifier` = `ctrlCmd` turns that into Ctrl+click, live through a `settings` message; Shift+Alt+drag column; Ctrl+D twice; Ctrl+Shift+L; Ctrl+Alt+Down/Up; Escape; a multi-caret insert undone in one Ctrl+Z; a click that closes an open block moving only the caret that was in it, and a drawing clicked with the modifier down adding a caret instead of replacing them all; an Alt release that followed a mouse press held back from the host's key forwarder, with a bare tap still forwarded), **reveal** (a display equation hidden behind its KaTeX widget, its three source lines and the widget kept while a caret is in it, hidden again when it leaves; a broken equation as source with the broken edge when untouched and with KaTeX's message under it while edited, rendered the moment `}{b}` closes it; inline maths replaced or shown as `.mdm-math-src`; two carets open two equations at once; the `#` of a heading, the `**`, `*` and backticks of inline marks, the `-` of a bullet, the rule, the `>` of a quote and its continuation line, the callout classes by kind with the fence lines small until the caret is on them and nothing at all for an unclosed `:::`, the YAML header lines, the task checkbox flipping `[ ]` to `[x]` in the text), **literal delimiters** (Backspace on one `$` of a closing `$$` leaves a plain paragraph with the text in view and nothing regenerates it, the `$` retyped renders again, Ctrl+Z twice walks back; a backtick of a closing fence deleted and restored; `$$` and a formula typed from scratch end rendered), **sync** (the edit posted with the typed text and `withFrontMatter`, an external update before and after the caret leaves it on its word and posts no echo, an update carrying CRs that neither gains a line nor throws the caret to line 1, the hidden-header mode; and the two sides writing at once: an update that arrives while an edit is debounced is merged over the typing and the merge goes out on the host's version, a host change that crosses an edit in flight is merged when the document comes back and sent again, and Ctrl+Z undoes only what was typed here and never what the host wrote; a `flush` from the host sending the held edit at once and answering behind it, Ctrl+S sending it ahead of the save, and the header button reading the text rather than the setting, lit and offering to hide a header the host keeps on screen), **pointer** (a click into an unfocused document putting a caret and not a range, a 3 px wobble between press and release taking at most the character it crosses, a double click taking the word from the caret the first press placed, with the marks revealed under it, and a run of punctuation as CodeMirror's own does, a triple click taking the line with its break), **vertical motion** (the line CodeMirror measures text by is prose and never a heading, setext first in the document or ATX typed at the top with its marks in view; ArrowDown and ArrowUp in the roman face stopping on the blank row under a heading and on each of two blank lines, keeping the column across them and extending with Shift the same way; both walking past a rule; a picture that arrives after its line was measured measured again, the map agreeing with the drawn figure (the picture with its caption under it, since a picture alone in its paragraph is a figure) and a click under it landing on its word, with the extension's own icon as the picture from a folder the harness is told is the document's, and a caption drawn again when its marks go although its words do not, since a widget that says it is equal keeps its DOM), **Enter** (a no-break space beside the caret kept on either side, a line of one no-break space kept as the paragraph it is, a list item ending in one carried on with the space in place, and the list and quote gestures: a numbered item continued, an empty item unmade with a blank line put before the caret's line, whether it is the second item or a later one, a quote carried on; spaces and tabs after the caret still taken and the line's indentation carried on), **the editing drills of the bench** (Enter continuing a numbered list and renumbering what follows; Enter twice at the end of a list ending it with a blank line so the next text is a paragraph, inside a quote the blank line the quote's, an empty nested item unnested with no line of spaces left behind; a task carried on unchecked, on an ordered item too, and a marker followed by a tab; two carets answered each on its own; Enter at the head of a heading's text opening a line above it; Enter in a fence inside a quote or an item keeping the new line in the container, and a bare fence keeping CodeMirror's own newline; Ctrl+Enter leaving a paragraph of two source lines whole; Backspace after a later item's marker taking the marker and parting the line from the item above, the first item's marker alone, a nested item's text kept in the item around it, an ordered list renumbered past it, a quote's mark the same way, and spaces beyond the one after the marker taken back to that space; Backspace after the hashes of a heading taking them all, and one step further in the ordinary deletion; Delete and Backspace at the edge of a hidden block opening it and taking nothing; Backspace after an emoji with a skin tone or a keycap taking the whole glyph, and an accent alone coming off its letter; Tab nesting an item under the one above at that item's content column, two under `- ` and three under `1. `, with its children along, an ordered block numbered from one or on from the nested list it joins and the items left behind closing up, a selection taking every item it reaches, inside a quote past the quote's mark, and Shift+Tab bringing the item out after the one that held it with the siblings it leaves behind as its children, a top-level item staying put; Tab in prose a tab at the caret and nothing at the head of the line's text, with the focus kept, and in a fence the unit of indentation at the caret, Shift+Tab one unit off the line), **what must open** (a paragraph of twelve thousand asterisks a side, read as text and drawn), **links by definition** (a `[foo]: url` typed under a paragraph turning the `[foo]` above it into a link, and its deletion turning it back, which is the parse started over on a change to the set of definitions), **commands** (Ctrl+B at two ranges wrapping and unwrapping, Ctrl+I at a caret, the heading button on three lines with `######` going back to a paragraph; and the drills of the bench: Ctrl+B, Ctrl+I and Ctrl+E with the caret inside a run of their kind taking its marks off and at the end of its text stepping out past them, so bold typed after Ctrl+B is closed by the next, a caret in a word wrapping the word; a selection wrapped with its edge spaces outside the marks, line by line across paragraphs and items, each line's own text, a selection running out of a bold run extending the run, Ctrl+I on the text of bold making it bold italic and over a selection starting in bold writing marks Pandoc reads as meant, a selection inside a run taken out of it, code holding a backtick fenced longer; Ctrl+K inside a link selecting its address or putting the caret between empty parentheses instead of nesting a link, a selected address made the destination with the caret in the label; the Bold button working on a word selected in a table cell and on inline maths where it is; the list buttons changing the kind of a list, taking it off on the second press, leaving blank lines blank and uncounted and a quote's mark in front, replacing a heading's hashes and keeping a task box; the heading button putting its hashes after a quote's mark and in place of a list marker, and making ATX of a setext heading; and the clicks of the bench: a click on the drawn bullet or number putting the caret at the item's text, a task box flipping its own text inside a quote and on a `2)` item, Ctrl+click following a link through the host (an autolink and a bare address their own destination, an address with an @ mail), Alt+click following it when Ctrl adds a caret, a plain click editing it, a link to a heading of the document moving the caret there, a paste that carries no text leaving the selection as it was, and Up and Down stepping into a hidden block past a rule glued to it; **the outline and the search**: the panel listing every heading of an 80-section document opened with it shown and no caret moved, and of a 300-section one past the parser's own reach, its rows reading as the editor draws the heading (marks off, a link its label, an equation set, `F#` keeping its sharp, a setext heading of two lines whole, an attribute block off, headings inside a quote and an item listed), Ctrl+F opening the search panel from an unfocused document with the field focused, and the next match inside a hidden code block opening the block, Ctrl+Enter out of a fence onto a fresh line, ArrowDown and ArrowUp into a rendered equation, ArrowDown crossing every visual row of a wrapped paragraph before opening an adjacent score, a click on the equation and on the score drawing landing at the start of the source) and the code chrome (the copy button alone, in the rail in the margin, not brought up by a pointer on a code line and brought up by a caret in the block, which also reveals the fences and takes the rail to the fence line at the top of the card). And **the numbers in the margin**, which ride on a `data-mdm-line` attribute the stylesheet prints: every line carries one and a paragraph that wraps carries a single number for all its rows (with the class list of a line unchanged, since the rest of the suite reads it), and a block that is drawn instead of its source is numbered by its first line alone, on the cover over that source, until a caret opens the block and every line of it carries its own again (nothing special-cases a block: a decoration inside a block replacement is never reached, so the cover is the only thing left to say it), with the whole numbering following an edit above it, cover included. The cover is also what the display-equation test now reads: it is the extension's own placeholder over hidden source, of no height and not editable as CodeMirror's own was, carrying the block's first line. | google-chrome |
| `webview-look.test.js` | 83 tests of the look and the settings of the editor, the old webview tests ported to the new DOM: the memory of the toolbar (an editor opened on a seeded `mdm.outline`, `mdm.outlineWidth` and `mdm.multicursorMatch` comes up with the panel open at that width, both buttons lit and Ctrl+D matching inside words with nothing clicked, and a press asks for the other side; a width wider than the pane is narrowed to fit without writing anything back and grows again when there is room); typing inside the header keeps the caret and the text; code, scores and equations spaced like paragraphs (the blank line is the gap, above and below); a display equation rendered; the header button taking the editor to the top, on and off; the copy button copying the source and pulsing the block (every line of a code block, the `code.language-abc` of a score, which also loses its `%%staffwidth`, and the box of a display equation, whose formula is copied as written between its `$$`), pressed in the rail of each with the caret in it, with no page selection and the caret left where it was; every block's buttons in a rail 10px right of the column, level with the top of what it belongs to (the drawing of a score or an equation, the top line of a card of code, the fence while it shows and the first line of code while it does not), inside the pane, drawn and taking the pointer on every block, as the caret walks from a score to an equation to a code block and out into the prose and marks the rail of the block it is in and no other; the rail of the block under the pointer (a score, its own copy, a line of code below the first, an equation, not the margin under a rail) drawn over every other, and the caret's over the rest; with the score and the equation not drawn again as their rails come and go; a selection over several blocks marking one rail, where its head is (Shift+Arrow from a score into the code under it), and none under Ctrl+A, and a fence inside a list item or a quote carrying its rail 10px off the column and level with the top of its card; a block's rail taking no room (a score's box its drawing's, and every box of the document and where the text of a card and the maths of an equation start the same with every rail of the three kinds forced up, put away, and taken out of the page); a setting with no colour in it not repainting; the theme menu listing what the host sent and a click asking for it; the three grounds (light/dark/white, the code on the material the outline panel is drawn in, a step off the page on either side and lighter than it in the dark, measured on `.cm-editor`, `.mdm-code-line` and `.mdm-outline`); a title wider than its staff not cropped; an edited score keeping no card behind it and its widget rebuilt from the edited source; the alignment button; the ten `--mdm-syn-*` applied and spent (the YAML key and the Python `def` take the palette's attr and keyword colours, the fallbacks come back when the palette is from the other side, a `palette` message repaints live, a named theme brings its side, and none of the three MDM looks takes a palette at all, whatever side the theme it would come from is on); the source of an open score painted in the extension's own brass on both sides (the seven roles measured on the `mdm-abc-*` spans, the notes and the `abc` of the fence in the brass of `--mdm-play-accent`, the staff ink on the line itself so the plumbing takes no theme colour, the lyrics italic, and a seeded palette spent on the Python block but never on the score); inline code on the card ground; staff lines grey by default and back to ink by the button (lit for ink), a darker grey on the dark side; the score fill menu with a tick, one value per side; clicking a rendered equation or score opening its source, and an equation whose closer carries a label (`$$ {#eq-mass}`, the label a paragraph of its own on the block's last line) opening at the head of its maths; an ordinary Delete inside a paragraph staying ordinary; the copy button's "Copied" held for a beat and then put away, with the tooltip back for the next hover; and the blank line between two paragraphs drawn an em tall (the space a rendered page leaves between paragraphs) while the blank lines of a fence keep the height of a line of code. Tables: a pipe table drawn as a table with the alignment its second row asks for, the maths of its cells set by KaTeX and their marks kept, its source out of the flow until a caret is in it and the drawing left standing as the preview while it is, and a click landing on the cell it was on, with the page held where it was rather than sliding down by the height the source took; and a table of fourteen columns at a 600px pane squeezing its columns to their longest word and scrolling the rest inside its box, with every word of every cell read as a Range and found in one box (CodeMirror's `overflow-wrap: anywhere` used to cut them). Images: a relative path hanging from the folder of the document and an absolute one from the root of the filesystem, not from the folder with the path glued behind it, a `file://` URL kept as it is, and a figure that carries the pointer and opens its source when it is clicked, the caret landing at the head of that source, the `![`. The numbers in the margin: they stand in one column beside the text whatever a line draws to its left (the quote and the callout are given back the 3px of their own bar, which the padding box the number is placed against starts inside, and the cover over a drawn block stands in that column too), left of the column and inside the 50px the scroller carries, with room for four digits, absolute and unselectable and taking no pointer, each carrying alt text of nothing so a screen reader does not read it before every line, and every one of them drawn in the same face, which is what keeps a heading's 600 or a card's monospace from reaching the number through the pseudo-element; and each standing in the middle of the row it counts, its box the line's own line height (`1lh`, where `inherit` had handed down the ratio and put every number at the top of its row), read in the pixels at two to the CSS pixel in both faces over prose, a paragraph that wraps, three levels of heading, a blank line, a quote, a line of code and the cover of an equation; and, with the header hidden (the default of `mdm.frontMatter`), the numbers counting the file's lines and not the editor's, so that the first body line of a document with a three-line header reads 6 in the margin as it does in the text editor beside it, while the same file shown counts from 1. And the chrome is brass: every glyph of it (a toolbar button, the copy and the headphones on a block, the transport of the player row and the headphones in it) computes to --mdm-chrome-ink and every number in the margin to --mdm-line-ink, neither of them the --mdm-play-accent-ink a held state is drawn with, on both sides, with the pointer resting on the play button, which is where the vendored abcjs sheet claims the glyph (#f4f4f4, #cccccc hovered) and where the editor's rules have to outrank it; and a held state is the ground alone, read by turning repeat on and finding its disc changed and its glyph not. And the caret keeps its place in its own line while the outline panel opens and shuts: the gap between the drawn caret and the left edge of the line it is in, sampled at the end of every frame for twenty frames after the setting lands, on a pane wide enough (1400) that the panel moves the text column without changing its width, which is the case CodeMirror is slowest to notice. And the face the words are set in: a fresh editor comes up in the roman (`mdm.textFont`), with the vendored Latin Modern measured as having actually arrived rather than read off `getComputedStyle`, which reports the declared list whether or not the file was fetched; the toolbar stays in the interface sans while the text is in the roman; a formula computes to the size of the words (16px, KaTeX's 1.21 being the compensation for a sans) and back to 19.36px with the sans; the press asks the host and repaints nothing until the value comes back; and an editor opened on a seeded `textFont: sans` comes up in the sans with nothing clicked. And the headings: one ladder for both faces, Markdown's 2, 1.5 and 1.25 and then 1.125, 1.0625 and the body, read off the lines in the roman and in the sans, and a heading's line box held at 1.3 of its size with the caret away from it and in it (CodeMirror's widget buffers around the hidden `## ` stood over a roman heading's line and grew it by 4 to 7px, and the heading jumped when the caret came in), and a row of prose held at the same height with a mark hidden or a glyph drawn in it, in both faces, the last row not moving when the caret enters one (the same buffers made a roman row 28.19px where a plain one is 27.19, G103). | google-chrome |
| `webview-markdown.test.js` | The Markdown conformance of the editor, row by row: a snippet goes in, the document is left in the reading state (unfocused, nothing revealed), and every row the editor draws (`rows()` in `webview/helpers.js`: file line in the margin, mdm-* roles, visible text with the widgets named, an equation as ⟦math:tex⟧, a checkbox as ☐/☑, a rule as ⟦hr⟧) is held to what a reader of the exported page sees, written by hand from the CommonMark spec and from Pandoc 3.8.3 with the export's reader and never computed in the test. The cases come from the Markdown torture bench (`md-torture/`, not shipped) and keep its ids. A case the editor does not pass yet is a `todo` naming the package of `feat/markdown-editor` that owes it (the runner reports it without failing the run), and the fix takes the mark off in its own commit: 27 cases, 16 passing and 11 owed at the start of the branch (headings, emphasis, strikethrough, links, autolinks, a quote, bullets, tasks, a code card, a table, inline and display maths and a callout pass; sub/sup, the stripped space of a code span, escapes, entities, reference links and bare brackets, the margin number of a rule, nested quote bars, computed list numbers, the bullet of an item that opens a rule, and empty table cells are owed). Since 2026-09-16 the container cases are green: nested quotes in and out again (Q03), a quote holding a heading, a list, a card, a table, an equation, a task and a rule inside its bar (Q05), a quote in a callout and a callout in a quote (Q08), a callout in a callout with its own kind (D03), a callout holding a list, a card, an equation and a table (D04), an equation in an item and in a quote (M10), and the three rules numbered in the margin (T01); `rows()` reads a drawn block through the frame it is wrapped in (`mdm-block-framed`), its roles being the wrapper's and the block's and its number the block's own. The list cases followed the same day: any marker a bullet (L01), the number the list gives an item (L02), five levels of mixed lists (L06), an item holding paragraphs, a card, a quote and a table (L07), a rule or an equation on the item's line keeping the bullet (L14), a blank line inside an item (L15), a table inside an item (TB09) and task boxes standing alone in the gap (TL01); and a fence on the item's line keeping it beside the card (L14b). Then the blocks read whole: a score in an item and in a quote engraved from all its lines (MU01, drawn as ⟦score⟧ by `rows()`), an empty fence as an empty card with its number (F06), a fence of three lines in a quote one card with a blank line kept (F07), a display equation of two lines in a quote and in an item typeset without the marks (M10b), and a setext heading of two lines with the air above the first and the rule under the last (H09b). The inline marks, the links and the figures followed on 2026-09-17: a subscript and a superscript in `<sub>` and `<sup>` boxes (S02), the space CommonMark strips from a code span stripped (C01), an escaped character drawn without its backslash (X01), an entity drawn as its character and `&bogus;` as written (X04), a hard break marked ↵ at the end of its row while a soft break stays a row (B01), a link's tail folded whole with the spaces, the title and the angle brackets typed in it and the tooltip carrying the destination with the Markdown title beside it (K02, read off the span over the link's first character, one per Link node of the tree, by `linkTips`), a link whose label is an address going where its parentheses say (K03), the three forms of reference link resolved to their definition with the definition's line set small and faint (K05), an autolink and a bare URL drawn in the link colour down to their glyphs (A01, A03, by `linkInk`), an image alone in its paragraph drawn as a figure with the alt text under it (I01), one beside text kept in its line (I02) and one written by reference drawn from its definition (I06). Then the tables, the same day: empty cells keeping their column (TB10), a row fitted to the header, a short one given empty cells and a long one losing its excess (TB05), a table without its outer pipes (TB02) and a `<br>` in a cell drawn as a line break with any other raw tag left as written (TB04), the cells read by `tableCells`. And the links by definition, the same day, once the parser knew them: bare brackets with no definition are text (K11, with no link span at all), balanced brackets inside a link's text stay in it (K12), and a reference with no definition is text, brackets and all, beside one that has it (K13). And the parser's other three, the same day: a heading written with a tab after its hashes, the text starting past the tab (H03); a `$$` closer with a Quarto label or prose after it closing its block there, the tail drawn under the equation with its marks read and the next block its own (M11, M12; `rows()` writes the tail after the ⟦math⟧); a fenced div that is no callout drawn bare with its fences put away (D05), an opener with colons after its attributes or a brace inside a quoted value taken as the callout it is (D06), and an opener straight under a paragraph line left as the prose Pandoc reads it as (D07). And the table parser, the same day: a pipe inside inline maths is the formula's, the cell read by KaTeX's annotation (TB11), and an escaped pipe is text while a pipe inside a code span is the code's, escaped or not (TB03). The dialect and the Pandoc syntax (P6): a bare address with a scheme and a mail address links and a `www.` one text (A04), a `---` over a blank line at the head of the file a rule and not a header (F03), raw TeX drawn as the source it is (RT01), attributes hidden and in effect (AT01), citations and cross-references in the link colour (CT01), footnotes with the reference raised, the inline note in a card and the note a faint block (FN01), and the punctuation Pandoc's `smart` prints, every row read off pandoc 3.8.3 on the same text: quotes, dashes and the ellipsis with the source back under the caret (SP01), the reader's rules for a quote that cannot open, one that never closes, a pair in a pair, a line end, a code span and an emphasis (SP02), the leaves left alone and the blocks that carry it (SP03), and the cell, the caption, the prose after an equation and the outline row (SP04). The small ones of P7: an element, a comment and a processing instruction all raw HTML (HB01), a line of one no-break space a paragraph where a line of spaces is the gap (NB01), the whitespace a reader drops not drawn, with its return under the caret (WS01), and the characters that draw nothing left to the page's drawing and named under the caret (SC01). And the cell that reads what the prose reads (2026-09-18): the bench's own row of an entity, a raw `<br>`, an escape and a link by reference, the reference resolved to its definition with the label off the drawn text and the Markdown title beside the destination (TB12), and a destination in angle brackets stripped of them for a picture and for a link (TB12b), and a note, a citation and raw TeX in a cell drawn as the prose draws them, the raw TeX saying what it is because the page leaves it out of the cell altogether (TB12c); and the caption of a figure read the same way, its marks drawn and its words alone in the alt attribute, as the page writes both (I01b). 80 cases, all passing; a case the editor does not pass yet goes in as a `todo` naming the package that owes it. | google-chrome |
| `webview-player.test.js` | 64 tests of the player and the toolbar, ported: a toggle on every score (and only there) under the copy button, in a rail in the margin right of the column, put away at rest and up under the pointer and while the score's source is open; the lit headphones of an open player still in view and under the pointer with the caret and the pointer elsewhere; the caret's mark going from one score to the one straight under it in the same task, two carets in two scores one mark (the main caret's), and a real press on the copy of each score, nobody in the document, copying that score and opening neither; a rail longer than its score (two buttons put in by hand, the way a new one would go) growing down past it without the score growing or the next one moving, the last of them, inside the box the next score's own rail takes, the one a pointer meets, a real press on it copying its own score, and its buttons still working there (the copy copies without moving a caret that is mid-tune, a press on the rail between two buttons moves nothing, the headphones open the player); the bar opening as a row of the toolbar and nothing left under the score (in the toolbar, out of `.cm-content`, on a line below every button, as wide as the toolbar, with no width taken from the score it plays), staying in reach with its score scrolled clean out of CodeMirror's viewport, read with the follow seeded off, since with it on the page comes back the frame after it is scrolled and the widget is never thrown away (the widget gone, the tune running on, the clock advancing, play and stop still pointable without a scroll, the mark back on the block when it returns), following the pane at nine widths from 1400 down to 260 and giving up its parts in the stated order (the volume slider at 380, the clock at 320, the volume group at 260, the transport and a 44px track never), keeping its full width when the outline panel narrows the text beside it, and being taken and given back without moving the page under it (the toolbar grows and shrinks by the row, the scroller is nudged by the same amount, and the bar is removed rather than hidden); opening and closing the bar without opening the source, tooltips naming the destination (and the same on the first click of a file that opens on a score, where the untouched selection sits at character 0: the bar keeps a document that is already somebody's and makes none somebody's); play sounding from the local soundfont (notes over `file://`, nothing to the network, the source staying shut); a byte-identical round trip with the player open; one player at a time; the bar surviving edits of its block and full external updates (and closing with no residue if the scores disappear); silent chord symbols; the session volume (a real GainNode on the playback path); the notes lighting up while they sound (brass per side, computed, no staff line lit) and the ink back on close, every voice of a duet lit at once on its own staff (a treble part over a bass one, both accented, at every moment of the tune), and a written silence lit like a note while the cursor crosses it, the rest one hand holds alone included: it is a moment where nothing attacks, so the silent gap a seek opens runs straight over it to the next sounding note, and the rest used to be painted after its own moment had gone by (the crossing sampled frame by frame, in brass, with the line over the drawing; and the same ink under a head parked on the rest); the brass cursor that walks the engraving while the tune sounds, gliding between attacks instead of hopping note to note (sampled frame by frame: never backwards within a line, no note-sized jumps, distinct positions most frames, the lit note never ahead of it, the system spanned top to bottom), frozen in place by a pause, taken away by stop and by the headphones closing, parked by musical time, not by the drawing, where a head is dropped before the first play (Home walks it back to the first note, which lights), and following the held head live, both ways, clock or no clock, without blinking out in the gap between the release and the seek it asks for (presence sampled every frame from the release itself); the pane brought to what is sounding, by a drag of the head (both ways down a score a dozen systems tall, by a keyboard seek that sends no pointermove, and never for a head already on the pane) and by the music itself, which keeps the staff system that is sounding whole on the pane: it moves when part of that band leaves it and not while the band shows entire, however near an edge it rests (read by placing the band 6px off the bottom, inside the 24 the rule used to want clear at each edge, and finding the page unmoved, then hanging it 14px over and finding it brought back) (21 readings of the scroll over two seconds show at most three positions, where a page pulled by the clock would show one a frame, since the head does not go down the page inside a staff system), brings a page parked a whole pane away straight back rather than at the end of the line, and leaves a paused tune's page where the reader parked it; a grab on the head muting a sounding tune for the whole drag (the transport runs on; the release's seek lands the sound under the new head through the usual silent gap, gain and ink back together) and putting the brass out, sounding or paused, while a tune the user paused themselves stays paused after the release; play with the source open and the document held still; tooltips following the state; the repeat button really painting; the chrome taking no syntax colour (and the tooltips of the bar pointing south, the way the toolbar's own do, on all four labelled controls); the two faces of the speaker; stop; no focus box on the slider (the VS Code sheet injected); the volume set without closing the open source; the bar's discs and glyphs; the pointer answers; the filled track; the cursor told 16 times a beat; the sizes of the two little buttons; the progress drag (head under the pointer while the button is down, the tune landing where it is dropped, the clock not pulling the head away, the arrow keys, seeks before the tune is ready adding up in order, a scrub with the source open); resume in silence landing on the beat and a scrub inside the gap lifting it; export/undo/redo at the head of the bar with the rotating arrows and undo greyed on a fresh document; the three export entries posting their format; the output woken by a player and let go after the idle minute, and a hidden webview letting it go unless a tune sounds; and the keyboard: opening a player hands the focus to its bar, where Space plays and pauses (and neither press reaches the document or opens the score), Escape and closing give the keyboard back to a text that had it, while a bar opened on a document nobody was in gives it back to nobody, Ctrl+S goes on rising to the window with the bar focused (where the webview preload forwards it to the workbench: stopped at the bar, the file would not save) while Backspace, Delete, Enter, a letter, ArrowDown and Ctrl+B leave the text byte for byte as it was, and a caret in the text keeps Space for the text with the player still open. The headphones also put their tooltip away on a pointer click, so the half of the toggle that is no longer on offer is not left showing under a pointer that has not moved, and bring it back when the pointer leaves and returns; a click from script, which has no pointer resting anywhere, leaves it alone. Following the music, on a score of one staff system where no crossing can be the thing that moved the page: a play made with the score under the fold brings the page to the head. And the toolbar toggle: lit by default, a press asking the host for `still` without lighting itself first, the setting coming back unlighting it, and with it off a tall score parked under the fold playing for six seconds and several crossings without the page moving at all. | google-chrome |
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
with no class and zero height between the lines. The chrome of a block (a
score's player toggle under its copy, the copy of a display equation and of a
code block) is a rail in the margin right of the column. Its buttons are
`visibility: hidden` at rest: read `getComputedStyle(button).visibility`, not
the rail's, whose box stays. They are up while `.mdm-chrome--hover` is on the
rail of the block under the pointer (from a `mousemove` on the scroller, so a
puppeteer pointer left resting over a block from an earlier click keeps it)
or `.mdm-chrome--open` on the rail of a block whose source is open, and a
score's headphones on their own while its player is open.
`.mdm-chrome--active`, on the rail of the block the main caret is in, only
decides which rail is on top where two meet. A rail is read off the pane like
anything else: a hit test on a block scrolled out of view meets nothing. The code chrome is an inline widget at the top line
of its card (the fence while the block is open, the first line of code while
it is not), placed against the column. Tooltips are `.mdm-tip` pseudo
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

### Intact, and then a scroll (2026-09-12)

What each kind of block did as the pane was squeezed, measured on example.mdm
before anything was touched: the prose rewrapped and the column followed the
pane; a code block rewrapped too, CodeMirror breaking inside a word when a
line had nothing else to break on (3 rows for one line at a 500 px column); a
table squeezed its columns; a display equation kept its size and scrolled
inside its own box from a 680 px pane down; and the score alone was scaled
down whole, with nothing under it. The staff's line spacing went 7.9 px at a
820 px column, 7.5 at 700, 6.4 at 600, 5.4 at 500, 4.3 at 400, 2.8 at 260,
with the prose beside it at 16 px throughout, and the title of the first
score from 27 px to 9.5.

The rule the owner asked for, and it is the equations' rule made general:
**every block keeps itself intact while it fits, and a block that no longer
fits is reached by scrolling, never made smaller and never broken.** So the
score is drawn at the size abcjs engraves it at whatever the column does
(`max-width: none`, where `max-width: 100%` used to scale it), and a line of
source keeps its line (`white-space: pre` on the card's lines, where
CodeMirror's `pre-wrap` with `overflow-wrap: anywhere` under it used to break
it). The prose still rewraps, because that is what prose does.

Which box carries the scroll is not the same for the two, and the reason is
structural rather than a matter of taste: a score is a widget with a box of
its own, so the part that does not fit belongs to that box, while a code
block in the editor is a run of editable lines with no box around them, so
the editor itself scrolls sideways. A page-wide scroll for a score would drag
the prose along with it, and a per-line scroll for code would lose the caret,
which CodeMirror keeps in view by scrolling the scroller (measured: with the
line whole, the caret at the end of an 819 px line put the scroller at 219).

Four things the code change needed, each measured:

- The card's ground stopped at the column, so 269 px of a 819 px line stood
  on the page's own ground with no card under it. The line box is as wide as
  the block's longest line now (`width: max-content`).
- `min-width: 100%` without `box-sizing: border-box` under it made every card
  25 px wider than the column, padding and all.
- The copy button is placed against its line, so on a block with a long line
  it rode off the pane with it. It is held to the right edge of the column by
  a container query (`.cm-content` is the container, `left: calc(100cqi -
  32px)`), which is the only piece of this that is new CSS rather than a
  correction.
- With every line as wide as its own text, the card's ground came out with a
  ragged right edge: twenty different edges between 470 and 633 px on the
  python block of example.mdm at a 520 px pane, and the first of them inside
  the pane without scrolling at all. The lines of a card share one width now,
  their longest line's, which the walk that classes them counts off the
  document and writes on each line (`--mdm-card-chars`, spent in `ch` by the
  sheet, the advance of the monospace they are all set in). Counted and not
  measured because CodeMirror renders the lines in view and a little beyond:
  measured, a card longer than the viewport would change width as it was
  scrolled through. The count can land a tenth of a pixel under the real
  advance of a line, which is what `width: max-content` under it is for.

And two on the page, which is the same document on another surface and had
to stop scaling too (mdm.js no longer asks abcjs for a `responsive` render,
mdm.css no longer caps the drawing at `max-width: 100%`):

- abcjs writes `overflow: hidden` into the style attribute of the box it
  draws into, so the drawing was cropped rather than scrollable: at a 500 px
  column the page showed the left 500 px of a 740 px engraving with nothing
  to scroll. The paper is `overflow: visible !important` and the card, which
  carries the fill, is the box that scrolls. The editor has the same trap and
  the same answer (`overflow-x: auto !important` on the `<code>`, which is
  abcjs's own box there and carries the fill too).
- abcjs sizes a drawing from the engraved music alone, so a title wider than
  any staff hangs outside the box it declares. The editor has widened that
  box to the ink since 5.10.3 (`fitScores`); the page now does the same
  (`fitPaper`), and without it the first score of example.mdm lost 20.7 px of
  its title off the left at a 360 px window.

The two surfaces now agree at every width measured (820 down to 260 px of
column): the same drawing, the same systems, the same 7.9 px a space, and the
same number of pixels held back by the box (740 less the column).

The paper is untouched and cannot follow the rule all the way: mdm.lua builds
its own Chrome page and engraves at abcjs's own width there too, but a page
has no scroll, so a score wider than the measure is still scaled down to it
(`\mdmscorewidth`, which is where it has always been). At the default
geometry that clamp does not bite: 740 CSS px is 46.25 em of the body, about
16.3 cm at a 10 pt em, inside an 18 cm measure.

Tests: `webview-narrow.test.js`, new, five tests over one fixture carrying one
of each kind of block and three scores (a wide one, one whose two parts are a
line each, one that names its own `%%staffwidth`): the prose rewraps and the
column follows the pane; a line of source keeps its line, the editor scrolls
to the end of it, the ground runs under the whole line, the lines of a card share
an edge, a card with nothing long in it is exactly the column, and the copy
button stays on the pane; an equation and a
table keep their size and scroll in their own box; a score is drawn at its
engraved size at 900, 700, 600, 500 and 420 px and its box holds back exactly
what does not fit; and a wide score never scrolls the document. `html.test.js`
gains "a narrow window leaves the music at its engraved size on both
surfaces" (600 px: drawing, systems, staff spacing and pixels held back, side
by side) and "the page draws the same engraving at every window, and scrolls
the card" (1000 against 500 px), keeps "a title wider than its staff is not
cropped on the page" (360 px), and its filled-score test now reads the first
two scores instead of the first. `editorAt` takes a height, since a narrow
pane makes the document taller than CodeMirror renders. And one test of an
earlier round was restated: "a narrow pane narrows the column, and a wide
equation scrolls in its own box" (webview-look.test.js) asked as well that
the document never scrolled sideways, which is no longer true of a document
with a long line of source in it, so it now asks the thing that decision was
about, that the equation's box is the column and does not stand out of it.
What may and may not scroll the document is tested in the new file, on a
document with no line of source to overflow.

Mutations, each applied, run and restored in one command with the file
checksummed before and after. Caught:

- The card's ground left at the column (`width: max-content` gone): the
  source-line test failed, the ground ending 269 px before the ink.
- The card without `box-sizing: border-box` under its `min-width: 100%`:
  the same test failed, every card 25 px wider than the column.
- The copy button left riding with its line (the container query swapped back
  for `right: 8px`): the same test failed, the button off the pane. The
  fixture had to be written for it first: the button is an inline widget
  inside the FIRST line of its block, so a block whose first line is short
  never shows the drift, and the long line was moved up to be first.
- The score scaled to the column again (`max-width: 100%`): the score test
  failed.
- The score's box clipping instead of scrolling: the score test failed.
- The page back to a responsive drawing: five tests failed, the two of this
  round among them.
- abcjs's own box left to clip the drawing on the page (`overflow: hidden`
  where the paper now says visible): the two tests of this round failed, the
  page showing the left 500 px of a 740 px engraving with nothing to scroll.
- The drawing capped at the column on the page (`max-width: 100%` in
  mdm.css): three tests failed.
- The card not scrolling the drawing: the page test failed, and so did the
  equation test of the earlier round, the page scrolling sideways instead.
- A code card not told its widest line (the call taken out of the walk): the
  source-line test failed, the lines of one card no longer sharing an edge.
- The lines of a card not sharing a width (the sheet back to a flat
  `min-width: 100%`): the same test failed.
- The page not widening the box to the ink (`fitPaper` handed the declared
  box): the crop test failed. That test had to be rewritten first: with the
  reflow gone the page engraves at 740 px whatever the window, so a title
  narrower than a 740 px staff can no longer overhang, and the case now has
  a page of its own (a score that asks for 200pt of staff under a title
  wider than that, which is the editor's own fixture for it).

Not caught, and why:

- `white-space: pre` swapped back to `pre-wrap` on the source cards: no
  measurement moved. A box as wide as its own max-content has nothing left to
  wrap, so while the width stands the `white-space` cannot be observed. Left
  in, with the overlap written down in the sheet: it says what the rule is
  and it is what would keep a line whole if the width ever went.

Two restores failed on the way, both because the text written back was not
unique in the file (`white-space: pre-wrap;`, which the prose's own rule also
carries, and an anchor that had already been changed by the failed one before
it). Both files were found mutated, put back by hand at once, and the runs in
between were re-run.

### The bar under the music, the delimiters and the caret (2026-09-12)

What the round above could not see, and two looks the owner asked for after
seeing the first one in a real window.

**The harness drew no scrollbars at all.** puppeteer launches every headless
browser it starts with `--hide-scrollbars`, and hidden, a bar takes no room:
every box in the page measured the same whether it scrolled or not, which is
why nothing above caught what a bar covers. `open({ bars: true })` in
`webview/helpers.js` and a fifth argument on `pageAt` in `html.test.js` drop
that flag for the tests that are about it. It costs the pane 15 px to the
vertical bar, so a measurement taken with the bars drawn is never compared
with one from a test that has them hidden.

With them drawn, at a 500 px pane:

- the score's box held a 10 px bar and the bar was taken out of the content
  box, because abcjs writes a height into the style attribute of the element
  it engraves into: 9.6 px of the drawing stood under it, which is the space
  below the staff and, on a score with words or a second voice, the words or
  the voice;
- the equation never had that trouble: nothing states a height on a
  `.katex-display`, so its box grows by the bar instead (65 px to 75) and the
  maths keeps all of itself. That is what the owner meant by "la ecuación
  funciona bien";
- the page never had it either, and for the same reason: the card's height is
  its content's (368 px to 383 at a 500 px window).

So the score's box takes its height from the drawing now (`height: auto
!important`, beside the `overflow-x` that already beats abcjs's inline
`overflow: hidden`): 78 px to 88 at that pane, the drawing whole, and nothing
added at a width where it does not scroll. Tests: "the bar of a score is
drawn under the music and not over it" (webview-narrow) and "the bar under a
score on the page is drawn below the music" (html), which also writes down
that the two bars are not the same size, 15 px in a browser against the 10 px
VS Code draws inside a webview: that is the platform's furniture and not the
document, and what has to agree is that neither of them stands on the music.

**The delimiters of code and of maths** are drawn in the brass of the numbers
in the margin (`--mdm-line-ink`): the three backticks of a fence, the pair
around inline code, and the `$` and `$$` of an equation. They said the same
thing a number says and they were taking the grey every mark Lezer tags a
processing instruction takes (`.mdm-mark`), which is also the `*` of a bold
span and the `#` of a heading. `buildDecorations` marks the marker nodes
themselves (`CodeMark` under `FencedCode` and under `InlineCode`,
`BlockMathMark`, `InlineMathMark`, `InlineBlockMathMark`) and only while they
show, so nothing reaches a mark the editor has hidden. Test: "the backticks
of code and the $ of maths are drawn in the brass of the numbers"
(webview-look), which counts the ten runs of the fixture, reads the colour off
the `::before` that prints a number, and checks the other marks kept the grey.

The trap here is the one the `.mdm-fence-info` rule already carried, and it
was walked into again: a mark decoration wraps whatever the highlighting has
already put there, so the grey sits on an inner span that carries its own
colour rule and wins on the text. The first version of the rule named the
marked run alone, the computed colour on it read brass, the test passed, and
every backtick on screen was still grey; a zoomed picture is what caught it.
The rule reaches the inner box now (`#app .mdm-delim *`) and the test reads
the colour off the deepest box that holds the text, which is what paints the
glyphs. The `.mdm-mark` runs inside a delimiter are left out of the "other
marks keep the grey" half, since a backtick's inner span is one of them.

**The caret** was drawn at the height of the text's own box, which in Latin
Modern is a good deal more than the letters: an ascent of 1.127em against a
descent of 0.29, drawn at 1.225 of its size. Measured against the ink of
"Ahgy" in the row's own face (canvas `actualBoundingBoxAscent`/`Descent`,
with `fontBoundingBoxDescent` placing the baseline inside the box the browser
laid the row out in):

| row | box | letters | over them | under them |
| --- | --- | --- | --- | --- |
| `#` roman | 54 | 29 | 23 | 2 |
| `##` roman | 40 | 22 | 16 | 2 |
| prose roman | 28 | 15 | 12 | 1 |
| prose sans | 17 | 15 | 2 | 0 |
| code | 19 | 15 | 4 | 0 |

`fitCaret` in main.js cuts it back to the row's own em and a seventh from the
foot up, and never grows it: 54 px to 36.8 on a `#`, 40 to 27.6, 28 to 18.4,
19 to 16.2, and the sans left exactly as CodeMirror drew it. The row is
looked for under the caret's own foot (`elementFromPoint`) rather than taken
from the selection, so several carets need no bookkeeping and one CodeMirror
has not drawn is not there to be found; the fit hangs off a MutationObserver
on the cursor layer, because drawSelection writes the carets in the measure
phase and an observer callback lands before the frame is painted. Test: "the
caret is cut back to the letters of the row it stands in" (webview-look), over
both faces and four kinds of row.

Mutations, each applied, run and restored in one command with the file
compared before and after. Caught:

- The score's box back to abcjs's height (`height: auto` gone): the score bar
  test failed, the bar taken out of the music's room (68 px of content where
  the wide pane gives 78).
- The page's card given a height of its own: the page bar test failed, 353 px
  of content against 368.
- The colour taken off the delimiters: the delimiter test failed on the first
  fence it read.
- The fences no longer marked (the call in the `FencedCode` branch gone): the
  delimiter test failed, six runs found where the fixture has ten. The same
  with inline code's backticks and with the `$$` of a display equation.
- The inner span left to the highlighting (the rule back to `.mdm-delim`
  alone): the delimiter test failed, which is the trap above under test.
- The caret cut to 0.7 em instead of 1.15: the caret test failed, the caret
  8.6 px shorter than the letters of a `#`.
- The caret's height left alone (the write gone): the caret test failed.

One test had to be changed, and it is the kind that must be said out loud:
"a divided word deletes across rows" (webview-hyphenation, both languages)
reads the drawn caret against the text's own coordinates, and it read the
two tops. The caret's top is by design no longer the top of the box the text
was laid out in, so it now reads the two feet, which is where drawSelection
puts the caret and where the fit leaves it. The assertion was checked to
still bite by moving the foot 10 px: both languages failed on it.

Not caught, and why:

- `fitCarets()` called from the update listener as well as from the observer:
  the caret test passed with it gone, because the observer on the cursor
  layer already covers every write drawSelection makes and the layer itself
  is found on the frame after the view is built. The call was taken out
  rather than left in untested. The layer survives a reconfiguration of the
  `gestures` compartment, which is the only one the editor makes.

**Left as it is, and it is the owner's call.** The abc source card leaving the
document is the rule of the round above working as written: a card is as wide
as its longest line, and the abc of example.mdm's `.play` block has a line of
121 characters, so the card is 1031.5 px wide whatever the pane. At a 1071 px
pane the column is 820 and the card runs 86 px past the pane's right edge,
with the editor holding back 87; at 620 it runs 462 px past, with 463 held
back. Nothing is unreachable and no ground is ragged, but the card leaves the
column and is cut at the edge of the pane, and the bar that reaches it is the
editor's own at the foot of the pane and not the block's.

Two cheaper variants were drawn and looked at rather than guessed:

- the card held to the column (`width: 100%`), which keeps the document's
  right margin and puts the tail of every long line on the page's own ground
  outside the card: the ground is a tidy rectangle and the code crosses its
  edge, which reads as text spilling out of a box;
- the card left as it is with a margin kept past it, which changes nothing
  until the reader has scrolled, since a card wider than the pane is cut at
  the pane's edge whatever is beyond it.

A bar on the block itself cannot be had in CSS: clipping the line at the
column (`overflow: hidden`, or a `clip-path` on `100cqi`) makes the tail
unreachable, since the clip travels with the line, and a scroll box per line
loses the caret, which drawSelection draws in a layer outside the lines. The
one road left is the block drawn as a card of its own while no caret is in it,
the way the exported page draws it and the way a score, an equation and a
table already behave in the editor, with the source lines coming back the
moment the caret enters. That undoes a decision taken on the record (D1 in
`vscode-mdm/docs/cm6-migration.md`: "code: never, it always renders"), and it
needs the colours drawn inside the widget, for which the vendored bundle
exports no tree highlighter: a read-only CodeMirror inside the widget is the
way that needs no vendor rebuild.

### A card of source scrolls inside itself (2026-09-12)

The owner asked for the code blocks the exported page has: "que si uno se pasa
del ancho de la página se habilita el scroll horizontal, que sería además la
misma barra que se activa al comprimir". The page had that already, and the
editor was the surface out of step, which is the export rule and was written
down as Pending 1 rather than fixed: at a 600 px window, both columns 500 px,
the page held back 91 px of the widest line inside its `pre` and the editor
scrolled 232 px of the whole document to reach the end of the same line.

The editor has no box to give that scroll to. A card of source is a run of
editable lines and CodeMirror owns their DOM, so there is nothing around them
to hang an `overflow` on, and four roads were measured before one was taken:

- **A clip on the line alone** takes the number in the margin with it. The
  number is a `::before` of the line, absolutely positioned against it, and a
  scroll box clips what stands outside it: read by screenshot, the margin beside
  a clipped card came out pixel for pixel what it is with the numbers painted
  transparent.
- **A wrapper span inside the line** (a mark decoration over the whole line,
  `display: inline-block`, the scroll box) keeps the number and costs a
  decoration per line, the baseline of an inline-block, and a card whose last
  line is empty has no box to draw the bar in.
- **The whole editor scrolling** is what it did, and what the owner asked to
  stop: the prose goes sideways with the code.
- **The block drawn as a widget when no caret is in it** undoes decision D1
  (code always renders) and needs colours inside the widget, which the
  vendored bundle cannot give (no `highlightTree`, no `classHighlighter`).

What was taken is the first road with the number let out of the clip: the
lines of a card are `position: static`, so the number's containing block is
`.cm-content` and not the line, and the clip does not reach it. The number's
place is unchanged because it never had a `top` (it rides on the static
position of the line's first row), and `right: 100%` against the column is the
same x as against the line, since a line is exactly as wide as the column and
starts where it starts. Measured by screenshot: the margin is what it was.

The rest of the round is what that costs, and every piece of it is a
measurement:

- **The run of boxes has to move as one.** Every line of the card gets the
  card's own width as scrollable room through an `::after` of
  `--mdm-card-chars * 1ch + 1.8em` (the same arithmetic the old `min-width`
  used, since the card's width was already counted in characters), and
  `syncCards` in main.js writes one offset along the run. Without it the short
  lines of a card do not scroll at all and the text shears line by line.
- **One bar for the card, on its last line**, where the page draws it: the
  other lines carry `scrollbar-width: none`. The bar is added to that row
  instead of being taken out of it, 28.8 px to 38.8 with the text where it
  was, which is the lesson the score's box learned this morning.
- **The caret and the selection are drawn outside the lines.** drawSelection
  writes them in layers of the scroller, so a card scrolled without a redraw
  leaves them over the glyphs they were written against (149 px of drift after
  a 150 px scroll, measured), and `view.requestMeasure()` does not redraw them
  (a no-op selection dispatch does, and is not used: it would fire on the
  scroll the browser makes while typing, which is where an IME composition
  lives). What is remembered instead is where drawSelection put each mark and
  the offset the card stood at, and every mark of that card is then moved by
  the difference and cut to the card's window. A mark left outside the window
  is not drawn and not left standing there either: a caret past the column
  made the whole document scrollable sideways again (34 px, measured).
- **A caret set past the window has to be brought back in.** CodeMirror
  reveals a caret by scrolling the boxes the text is in, and the caret is not
  in them, so what it scrolled was the document, with the caret still out of
  sight. `revealCaret` scrolls the card instead, keeping 12 px of the card's
  own air between the caret and the edge.
- **Home and End had to be taken over inside a card.** CodeMirror finds the
  start of a visual line by asking the browser which character sits at the
  editor's own left edge, because the editor wraps; over a card scrolled 166 px
  the browser answered with the character at the edge of the card's window, 20
  into the line, so Home stopped short and Shift-Home selected from there. A
  line of source does not wrap, so the ends of the line are the answer, which
  is what CodeMirror itself does when nothing in the editor wraps.
- **The copy button is the one piece of furniture the card cannot hold.** It is
  placed against the column instead (it already reached for the container query
  once, for a different reason), and its `top: auto` puts it on the static
  position of the card's first row: 4 px under the top of the card before and
  after, measured. Those two declarations had to move below the chrome's own
  rules to win against them, which is why they now sit there.

The bar is 10 px in the webview and 15 in a browser, and puppeteer hides the
bars of every headless browser it launches, so the bar assertions read with
`bars: true` (`withBars` in webview-narrow.test.js). That trap cost this
morning's round a measurement and it cost this one a false green: the first
version of the bar test read 0 for every row.

And a second thing about bars in the harness, found while trying to take a
picture of this one: with the bars asked for, the page reserves the room (10
px, which is what every assertion here reads) and Chrome paints nothing in
it. Read in the pixels, the strip under the card's last line is the page's
own ground across its whole width, with no thumb and no track, and this
morning's pictures of the score's bar have the same empty strip while the
owner sees that bar in VS Code. A plain file with a plain scroll box in the
same browser does paint one, so it is something about this page rather than
about the build. What follows is that the bar's geometry is testable here and
its look is not: that one is judged in a real window, which is what CLAUDE.md
asks for anyway.

Tests: `webview-narrow.test.js` "a line of source keeps its line, and its card
scrolls to the end of it" (rewritten: the card holds the line, the document
holds nothing, the card is the column at every pane and whatever is written in
it, the lines of one card hold back the same amount, the button at the
column's edge and 4 px down), "the caret and the selection follow the card they
stand in" (new: the reveal, the drift after a scroll of the bar, one card not
moving another, a caret out of the window not drawn and not scrolling the
document, a selection cut to the window and over its own letters, Home and End
on the line's ends, and the prose left to CodeMirror), "the bar of a score is
drawn under the music and not over it" (extended with the card's bar: one bar,
on the last line, added and not taken), and `html.test.js` "a wide line of code
scrolls inside its own block on both surfaces" (the export rule: the same size,
padding and column, each surface holding the end of its own longest line, and
neither moving its column; the editor holds 25 px more, its own padding, and 13
more that are the slack of the `ch` it counts in).

Mutations run, each applied, run and restored in one command:

| what was broken | what failed |
| --- | --- |
| the card does not scroll (both axes of `overflow`, since a `visible` axis beside one that is not computes to `auto` and the box goes on scrolling) | the document scrolled sideways for a card; and on the page's side, the editor scrolls the document sideways for a line of code |
| the lines of a card do not share a width (the `::after` at `width: 0`) | the lines of one card do not scroll together: 0 against 316 |
| every line of the card draws a bar (`scrollbar-width: auto`) | a line of the card other than the last drew a bar: [15,10] |
| the last line draws no bar (`scrollbar-width: none`) | the last line of the card draws no bar: [0,0] |
| the line is the frame of its own number (`position: relative` back) | the card clipped the number of its own line away |
| the column is not the frame of the furniture (`.cm-content` static) | the copy button is not 8 px inside the column at 900: 792 |
| the button hangs off the column's top (its `top: auto` gone) | the copy button is not 4 px under the top of the card: -293.9 |
| the marks are not placed on a scroll | the caret stayed where the card had left: 39.4 |
| the card is not scrolled to show the caret | the caret was left outside the card's window |
| a mark outside the card's window is drawn anyway | a caret out of the card's window was drawn anyway |
| a row rendered for the first time is left where it came back (`syncCards` gone) | a row the pane brought in came back at another offset: 60/60/60/0/0/0/0 |
| the lines of a card are not kept in step (the scroll handler's sibling write gone) | the lines of the card did not follow the one that was scrolled |
| Home and End are left to CodeMirror | Home stopped short of the start of the line: column 17 |
| the caret is left at the height CodeMirror drew it | the foot of the caret is 2.4 px off the descenders |
| the caret keeps the foot of the box it was drawn in | the foot of the caret is 10.79 px off the descenders |
| the used size of the face is not read (`k = 1`) | the caret is shorter than the letters, by 5.2 px |

Two of them had to be written twice. `overflow-x: visible` on its own changed
no measurement, because a `visible` axis beside an `overflow-y: hidden`
computes to `auto`: the card went on scrolling and the test went on passing.
And the first version of the row-that-came-back mutation was not caught at
all: a caret entering the block brings the fences out of hiding, and the
scroll the reveal makes syncs the new rows on its own, so the case that needs
`syncCards` is the one where nothing scrolls, which is the rows the pane
builds as the reader goes down a card taller than itself. That is the test
now, and it fails with the card sheared 60/60/60/0/0/0.

### The caret, cut to the ink of its row (2026-09-12)

The owner read the caret of the morning's round in a real window and reported
it still too low with the roman. Measured, the low part was the foot: the box
CodeMirror draws the caret in ends below the letters on both faces (0.084em
under them in the roman, 0.004 in the sans), and a cut that keeps the foot
where the box ends keeps the caret down there with it.

Eight variants were drawn in `design-caret.html` (at the root, not
committed), each in both faces and in four kinds of row, with the numbers
under every picture. The owner picked **G**, the face's own ink box: the top
on the ascenders of the plain lowercase (bdfhklt), the foot on the descenders
(gjpqy). Measured in the harness after the change: the foot lands on the
deepest ink to within a fortieth of a pixel in all eight rows, the top a
pixel over the ink of a capital (which is the hair by which those ascenders
stand over one), and the caret is 19.5 px on a 16 px row of the roman's prose
against the 28 CodeMirror draws, 36 against 54 on a `#`, 15 against 19 on a
line of code, 15 against 17 on the sans's prose.

Two things had to be measured rather than assumed:

- **The used size of the face.** `font-size-adjust` changes the used size and
  not the computed one, so a canvas asked for the size the sheet names
  measures Latin Modern 22 per cent small. What says how big the face came
  out is the box the browser gave the row's own text, which is the face's
  ascent and descent at that used size; the ratio is kept per face, because a
  row with no text on it has no box to read it from.
- **Which row the caret stands in.** The first version read the baseline off
  the row's first letter, and a paragraph is one line of the document and as
  many rows as the column gives it: a caret three rows down was placed
  against the baseline of the first and jumped 28.4 px up the paragraph. The
  hyphenation tests caught it, because they delete through a divided word row
  by row. The baseline comes from the box the caret itself was drawn in now,
  which is the box of the text of its own row.

### The caret takes the accents, and the page stops sliding (2026-09-12)

Two reports, one round.

**The caret is variant C now, not G.** Having seen G in a window, the owner
picked **C** from the same `design-caret.html`: the face's ink box with the
accents in it, so the probe for the top is `bdfhkltÁÉ` and not `bdfhklt`, and
an `Á` no longer stands over the caret. The foot is unchanged, on the
descenders of `gjpqy`. Measured in the harness after the change: the top
lands on the accent and the foot on the deepest ink, both to within a
fiftieth of a pixel in all eight rows, and the caret is 23.1 px on a 16 px
row of the roman's prose against the 28 CodeMirror draws, 43.2 against 54 on
a `#`, 31.8 against 40 on a `##`, 18 against 19 on a line of code.

The sans is where this stopped being a cut. Its box and its ink very nearly
coincide, so covering the accent asks for a pixel more than CodeMirror drew
(18 against 17 in prose here, 35 against 36 on a `#`, 27 against 27 on a
`##`), and the rule that the caret is only ever made shorter had to go. That
rule was also what kept a fitted caret from being fitted again, since the
foot is read off the box the caret stands in and after a pass that box is the
fitted one, so it was replaced by a record of what the last pass wrote
(`caretFitted` in main.js). Without it the caret walks 1.2 px up the row per
pass in the roman's prose, measured.

**The page itself no longer scrolls sideways.** The owner sent two shots: a
horizontal bar under the editor, and what dragging it uncovers, which is
blank page beside the text. The editor's own scroller holds nothing back at
any width (every block that outgrows the column scrolls inside its own box),
so the overflow was the chrome: a tooltip is an absolutely placed `::after`
laid out at the width of its label whether it shows or not, and the ones near
the right edge of a wrapped toolbar hang past it. Measured on `example.mdm`:
8 px of page at a 480 px pane, 15 at 560, 20 at 700 and 68 at 420, all of it
blank. `#app` takes `overflow-x: clip` (not `hidden`, so it makes no scroll
container and the y axis stays visible); the labels are still laid out, and a
tooltip at the right edge is cut there instead of being scrolled to.

Tests, and the mutations run against them:

- `webview-look.test.js`, "the caret is the ink of the row it stands in",
  rewritten for C: the top against the ink of `Áhgy` on the row's own face,
  the foot against the descenders, and the height against the box CodeMirror
  drew, shorter in the roman and within a pixel either way in the sans.
  **Mutation**: `CARET_ASCENDERS` back to `"bdfhklt"` (variant G) → *a
  heading in the roman: the top of the caret is -7.19 px off the accent*.
- `webview-look.test.js`, "a caret the fit has drawn is not drawn again":
  four fit passes forced by writing to the cursor layer, the caret's own
  `style` read before and after. **Mutation**: the `caretFitted` lookup
  removed → *the caret moved under a second pass of the fit* (top 259.433 →
  254.537 over four passes).
- `webview-look.test.js`, "the page never scrolls sideways, whatever the
  toolbar hangs over the edge", beside the one about the column and the
  equation: `example.mdm` at 700, 560, 480 and 420, the page asked to scroll
  and read back, the editor's own scroller held to nothing, the toolbar's
  overflow asserted non-zero so the test is about the clip and not about a
  shorter label. **Mutation**: `overflow-x: clip` deleted from `#app` → *the
  page held something back sideways at a pane of 700: 20*.

The exported page was measured for the same thing and has it not: its four
tooltips are the ones on a score's player bar, and at 900, 700, 560, 480 and
420 px of window the page holds nothing back sideways and does not move when
asked to. So there is nothing to mirror in `mdm-look.css` this time.

Not seen in a real VS Code window yet: both of these are chrome, so the rule
of the project is that they are not finished until they have been.

### Justified text, and a note for the scores' alignment (2026-09-12)

`mdm.textAlign`, justified by default: the prose lines of the editor (a
paragraph, a list item, a quotation, a callout) out to both edges, a heading
and every line of source ragged; the page and the paper following. And the
score alignment toggle redrawn as a quarter note between two lines of text,
the owner's pick of `design-text-align-icon.html`, with their corrections
pinned: the stem on the head's rightmost point and down to its centre, and both
the stem and the lines a shade heavier than the playhead toggle's rules.

What was measured before a test was written, and what the tests read:

- Chromium justifies after it chooses the breaks, under CodeMirror's
  `pre-wrap` too: `example.mdm` at 1200 px, every row of a paragraph but the
  last at the column's edge to the pixel, and every row ending on the same
  word ragged and justified. So `LINE_ENDS` in html.test.js holds for the
  justified page, and the new `ROW_GAPS` compares which rows reach the edge.
- The carets are drawn by CodeMirror from its last measure, and justifying
  changes no height and no width it looks at: without re-dispatching the
  selection the caret stood 34 px off its letter after the toggle.
- On paper TeX weighs the whole paragraph and may shrink spaces: two rows of
  `example.mdm` take one word more justified than the editor (`integer` for
  `an`, `the` for `over`), and they are the only rows where the justified and
  the ragged paper differ. Taking the shrink out made it worse. Open, and
  written where the code is (look_tex).
- A wrapped heading under titlesec came out justified with the prose (both
  lines at 561.3 bp), hence `\filright` in every format and `\raggedright` in
  `\mdmheadsix`.
- A narrow justified column stays inside its margin on the template's own
  `\emergencystretch{3em}`; set to 0pt, the 200 pt fixture ran two lines 11
  and 28 pt over. A stretch of a whole column, tried first, set "This document
  is ordinary" as a line of badness 10000 and was taken out. Lines ending in a
  comma or a full stop stand up to 2.4 bp out of the column, which is
  microtype's protrusion, so the tolerance there is 3 bp.

Mutations, each by exact string, restored and checked by hash in the same
command:

- **J1** `text-align: justify` → `start` in style.css → *A paragraph has a row
  37.4px short of the edge*.
- **J2** `.mdm-h` out of the rule's `:not()` → *A heading wr was justified*.
- **J3** `.mdm-src-line` out of it → *A table cell was justified*. The first
  version of J3 took `.mdm-table-line` out and was not caught, because a
  table's source lines carry `mdm-src-line` besides, as maths does: the two
  names were dropped from the selector as dead weight.
- **J21** `.mdm-html-line` out of it → *<!-- A comme was justified*.
- **J4** the re-dispatch of the selection deleted from applyTextAlign → *the
  caret stayed where the justified letter was: drawn 161.9, letter 159*.
- **J5** the lamp lit on `justify` → *mdm-text-align is lit on its own
  default* (and the twin in "every toggle lights").
- **J6** `textAlign` not read from the settings message → the class never
  leaves (*Waiting failed: 30000ms exceeded*).
- **J7** the two tips swapped → both justification tests.
- **J8** the export sends `mdm-text-align:justify` whatever the setting → *the
  export carries the look the editor is showing*.
- **J9** `["left", "justify"]` in SETTINGS → *hostile setting values never
  reach the webview HTML*.
- **J10** the `text-align: var(--mdm-text-align)` rule deleted from
  mdm-look.css → *the rows of "This document is ordinary Mark..." reach the edge
  differently: editor [0,0], page [13.7,15.8]*.
- **J11** `put("text-align", ...)` deleted from look_css → *the look metadata
  is read*.
- **J12** the filter's fallback `left` → `justify` → *a page with no look came
  out justified* (and the bogus-word test).
- **J13** the justified branch of look_tex never taken → *the justified paper
  is still ragged*.
- **J14** `\filright` deleted → *the heading was justified* (both lines at
  561.29 bp).
- **J15** `\setlength{\parindent}{0pt}` deleted → *a justified paragraph is
  indented* (65.65 against 50.71 bp, under `indent: true`). The first run of
  J14 and J15 "failed" on a fixture of mine: pdftotext set two paragraphs in
  one block and the test could not find the second. The test now reads from
  the line a text opens on, and the first paragraph under the heading is
  there because LaTeX indents none after a heading, which had let J15 pass
  the indent assertion and fail on something else.
- **J16** `\raggedright` deleted from the article's `\mdmheadsix` → *the heading
  was justified* (the sixth level at 561.29).
- **J17** the stem moved off the head's edge → *the other state's note is not
  joined*.
- **J18** one line of text or the stem put back at 1.3 → *the lines and stem are
  not a shade heavier than the playhead toggle's rules*.
- **J19** the justify toggle drawn with the staff glyph → *mdm-staff-lines
  draws the glyph of mdm-text-align*.
- **J20** `overflow-x: clip` deleted from `#app` → *the page held something back
  sideways at a pane of 720: 29*. The test itself was changed in this round:
  with one button more, no label hung past the bar at 700 or 560 and its
  guard failed with nothing broken; every width is held to the rule now and
  one of them has to have a label hanging.

Not seen in a real VS Code window yet.

### The notices of a missing tool (2026-09-12)

A report came from a Mac: an export on a machine with no Quarto, sent in as a
bug. The notice had done what it was built to do, and that was the trouble.
It named Quarto and nothing more ("Quarto is not installed, so there is
nothing to export with"), and where to get it was in the log, on the line
after a PATH of 33 folders. The reader of this editor is a musician, so a
notice of a missing tool now says what to install, carries a button to the
page it is installed from, and is a warning rather than an error, since
nothing has failed. Its log opens on the steps and ends on where the tool
was looked for.

Four things turned up on the way, each checked at its source:

- **A Quarto installed while the editor was open was still "not
  installed".** VS Code reads the shell's environment once and keeps it
  (`getResolvedShellEnv` in `src/vs/platform/shell/node/shellEnv.ts`), and
  Quarto's macOS installer links `quarto` into `/usr/local/bin` with an
  `ln -fs` that fails where that folder does not exist (its `postinstall`).
  The export now looks in the folders Quarto's installers write when the
  PATH has none: the list Quarto's own VS Code extension scans (`context.ts`
  in quarto-dev/quarto) less the RStudio bundles, so "install it and export
  again" holds without a restart.
- **The check before a PDF with scores let through PDFs that could not draw
  them.** It asked for Chrome or abcm2ps. The filter's Chrome road also trims
  with `pdfcrop`, its abcm2ps road goes through `epstopdf`, and both run
  Ghostscript; with Chrome and no `pdfcrop` the filter falls back to abcm2ps
  and, without that, leaves the scores as text in a PDF announced as
  exported. With no Chrome the check still stops and names what is missing;
  with Chrome but without those TeX helpers the HTML is printed instead, so
  the score stays the one the editor draws.
- **TinyTeX is not the TeX to offer**, although Quarto's own message points
  at it: neither of its package lists (`tools/pkgs-custom.txt` and
  `tools/pkgs-yihui.txt` in rstudio/tinytex) holds `pdfcrop`, and the Mac
  bundle Quarto installs, listed file by file (TinyTeX-darwin-v2026.09,
  19,994 entries), has no `pdfcrop` and no Ghostscript, only `rungs`, which
  calls the system's `gs`. The TeX button
  opens MacTeX on a Mac (which installs Ghostscript as well, tug.org/mactex),
  TeX Live's Windows page on Windows and TeX Live elsewhere. What Quarto says
  was read off a real render, not its source alone: Quarto 1.9.37 run with no
  TeX on the PATH exits 1 with "No TeX installation was detected.", the words
  the export matches. The same run through the extension's own code, with the
  mock for VS Code, gave the TeX notice for a document without scores and the
  printed-HTML notice and a real PDF for one with them.
- **A PDF does not have to be typeset.** `cweijan.vscode-office` was inspected
  after it printed a Markdown file on this machine: it renders Markdown and
  KaTeX to HTML and asks Puppeteer's Chrome for `page.pdf()`, with no LaTeX in
  the path. MDM now takes the same road when Quarto reports no TeX, and also
  when Chrome is present but the TeX helpers for scores are not. A real run on
  `example.mdm` produced a four-page, 220126-byte PDF whose title, prose and
  equations were read back with `pdfinfo` and `pdftotext`. A PDF-only export
  renders from a private `.mdm-print-*` copy beside the document, so it keeps
  relative paths without overwriting or deleting an HTML, `.tex` or `_files`
  directory already there; Chrome prints to a staged PDF, which replaces the
  destination only after a successful exit.

Tests, and the mutations run against them, all in `extension-host.test.js`,
whose mock gained `showWarningMessage`, `env.appName` and `Uri.parse`:

- "without Quarto the export names it, offers its page and logs where it
  looked", run as a Mac with HOME in a folder of the test's own: this machine
  has a Quarto in `/opt/quarto/bin`, one of the folders now looked in, which
  a test that means "no Quarto anywhere" would find and run (and the test is
  skipped on a Mac with a Quarto in `/Applications`). **M1** the notice back
  to `exportFailed` → *a missing program was reported as a failure*. **M10**
  the page button opens nothing → *Download Quarto did not open the page
  Quarto is installed from*. **M11** "Show log" on a warning opens nothing →
  *the Show log button did not open the channel*. **M12** the PATH put first
  in the log → *the log does not open on what to do*.
- "a Quarto installed while the editor was open is found where its installer
  put it". **M2** the installer's folders taken out of `findQuarto` → *the
  export said Quarto is not installed*. **M3** the folder under HOME dropped
  → the same, and the next test's list.
- "Quarto is looked for in the folders its installers write, on each
  system". **M4** Linux's folder dropped → *Expected values to be strictly
  deep-equal*.
- "a PDF with scores names what it lacks when no Chrome can print it".
  **M6** Ghostscript taken for granted → *nothing but Quarto: the log does
  not name what is missing*. The former Chrome-without-TeX case of this test
  (M5) is superseded by the printed fallback below.
- "a PDF with scores exports when one of the filter's roads is whole".
  **M7** abcm2ps's road dropped → *abcm2ps's road was refused*.
- "a PDF Quarto finds no TeX for names TeX and offers the page for the system
  in hand". **M8** the TeX branch switched off → *a machine without TeX was
  told the export failed*. **M9** a Mac sent to TeX Live's general page →
  *Expected values to be strictly deep-equal* (the page opened).
- The four printed-fallback tests cover a PDF requested alone (including
  preservation of existing outputs and cleanup of its private files), both
  formats reusing and keeping the HTML Quarto already made, a score printed
  when Chrome exists without `pdfcrop` or Ghostscript, and a failed Chrome
  returning to the TeX notice with its exit in the log.
- "a .qmd already in the way stops the export instead of overwriting it",
  now a warning that says to rename or move the file. **M13** back to
  `exportFailed` → *Expected values to be strictly deep-equal* (an error was
  shown).

Every mutation was applied, run and reverted in one command, and
`extension.js` had the same md5 before and after the thirteen.

Not seen in a real VS Code window: the notices are VS Code's own
notifications, and on this machine the Quarto one cannot be reached, since
`/opt/quarto/bin` is looked in whatever the PATH says. A PDF with scores on
Windows has not been tried; the filter finds Chrome with `command -v` and
sends output to `/dev/null`, which a Windows shell has not got, so it is not
expected to work, and the scores notice says so in its log on Windows.

### The page on paper, and the road that prints it (2026-09-13)

The PDF printed from the page when there is no TeX was looked at next to the
PDF LaTeX typesets from the same document, and they were not the same
document. `example.mdm` rendered both ways at the editor's defaults, on Quarto
1.9.37, LuaTeX 1.21.0 and Chrome 151:

| | typeset | printed |
| --- | --- | --- |
| pages | 3 | 4 |
| measure | 511.5 bp | 482.6 bp |
| ground | to all four edges | a white frame |
| the ratios row under the partials | 384.3 bp | 423.3 bp |
| `8:7`, and the whole A7 bar | on the paper | cut off it |
| the audio transport | never drawn | printed |

So no line broke where the editor breaks it, the reader lost music the typeset
page keeps, and a scrollbar and a play button were printed onto paper. None of
it was anybody's oversight: there was no `@media print` in either stylesheet at
all, so Chrome printed the page on its own default box, and the card that holds
a wide score back on screen, which is the narrow editor's own decision, has
nowhere to hold it on a sheet.

The block that answers it is at the end of `mdm-look.css`, in both copies. The
decision inside it worth recording is **scaled, not re-flowed**. The typeset
page sets the editor's own measure, 51.25 em, at the class's 10 pt, where the
editor sets it at 16 px; so the print scales the page by the ratio between
those two ems (`zoom: calc(10 / 12 * 800 / 803)`, the 800/803 being TeX's point
in CSS's) and everything on it arrives at the size it has on screen. The other
road was measured and rejected: setting the body to 10 pt and letting the
column find its own width gives the same text block to a tenth of a point, but
abcjs engraves a score at the width of the box it is drawn in, so the engraving
is then stretched to fill the measure and the ratios row comes out 424.8 bp,
10 % over what the typeset page draws. After the block: 3 pages, measure
510.6 bp, ratios row 383.4 bp, ground `#f2f2f2` to every edge, `8:7` and `A7`
back in the text layer, no transport. The page on screen is pixel for pixel
what it was, at 1400, 900 and 600 px.

Five things in the road itself came out of reading it against the real
programs, and two of them lose work:

- **A `.tex` of the reader's was written over.** Quarto names its LaTeX after
  the copy's stem and leaves it there when the engine fails, so it has already
  overwritten `doc.tex` by the time anything here can decline to delete it: an
  11-byte file of the reader's came back 14,160 bytes of Pandoc's preamble. It
  is moved aside for the length of the render now. The test that said otherwise
  could not have failed, because the fake Quarto in it wrote no `.tex`; it
  writes one now, as Quarto does.
- **A Chrome that never exits hung the export for good.** `--virtual-time-budget`
  is the page's clock and stops no process. Without a wall clock the run never
  came back, no notice was ever shown, and the copy stayed beside the document,
  where it refuses every later export of it. Two minutes now, against a worst
  measured print of 7.2 s (200 scores over 102 pages).
- **A folder the export cannot write to** said "Quarto exited with -1", naming
  a program that had never started.
- **A page Quarto could not render inside the fallback** was reported as a
  missing TeX, which would have sent the reader to install a distribution and
  get the same failure back.
- **Two exports of one document at once**: the second found the first's copy
  and told the reader that a file of their own was in the way of the export.

Nine mutations, each applied, run and reverted in one command, `extension.js`
and both copies of `mdm-look.css` with the same md5 before and after:

- **M1** `if (wantsPdf && hadTex)` → `if (false && …)`, the reader's `.tex` not
  put aside → *the render wrote over a .tex of the reader's*, and "with Chrome
  but no TeX, a PDF asked alone is printed from a page rendered just for it"
  fell with it (2 of 2).
- **M2** the print's wall clock set to a day → *The input did not match the
  regular expression /Chrome did not finish printing within 0.4 seconds, and
  was stopped./*
- **M3** the unwritable folder's reason dropped → *The input did not match the
  regular expression /^MDM: the export could not write beside doc\.mdm\./*
- **M4** the one-at-a-time guard turned off → *Expected values to be strictly
  deep-equal* (both runs went through, and the second accused the reader).
- **M5** the `why === "render"` branch removed → *Expected values to be
  strictly deep-equal* (a render error came out as a missing program).
- **M6** the page that landed not offered → *The input did not match the
  regular expression /^MDM: a PDF needs TeX.\*doc\.html was exported\.$/*
- **M7** `zoom: 1` in the print block → *Expected values to be strictly equal*
  (the paper was not scaled).
- **M8** the player bar printed → *the player bar is drawn on paper*.
- **M9** the score clamp taken off → *the wide score hangs 313px past the
  paper's card*.

M9 was green the first time it ran, and that was the test's fault and not the
block's: with the column at the editor's own 820 px nothing in the existing
fixtures asks for more width than the measure, so the clamp was never reached.
`widestaff.mdm` was added for it, a `%%staffwidth 900pt` score, 1200 px against
an 820 px column, which no window can make fit.

Not covered, and named so it is not taken for covered:

- One browser, `google-chrome` 151 headless on Linux, and one paper, Letter.
  A document that asks for `papersize: a4` is typeset on A4 and still printed
  on Letter; the measure is the same either way, since the column is a fixed
  width centred on the sheet, so what differs is the sheet.
- `box-decoration-break: clone` is what repeats the 2.5 cm margin on the inner
  sheets. Proved in this Chrome; a browser that parses it and ignores it in
  fragmentation would leave the inner pages of a reader's Ctrl+P without their
  head and foot margins.
- A line of code longer than its card is still cut at the card's edge on
  paper, and with the scrollbar gone there is nothing left on the sheet to say
  it was cut. The typeset page breaks such a line instead.
- A score taller than the sheet is still sliced across the page turn and
  overprinted by what follows. Every candidate rule was printed and measured
  (`break-inside: avoid` on the figure, `overflow: visible` on the card, both
  together): all three print the same slices. Only `break-after: page` clears
  it, and that puts every score on a page of its own.
- The notices themselves have still not been seen in a real VS Code window.

### The name of a page (2026-09-13)

The print turned this up, and it is about the exported page rather than the
paper. **The page went by a machine name.** `pdfinfo` on the printed PDF gave
`quarto-inputdae4994f30dfed2f`, and the page it was printed from said the same
in its `<title>`, so Chrome was only copying what it was given. Pandoc writes
`$pagetitle$` there and Quarto fills it from the document's title; the filter
takes the title away when the editor is hiding the header, which is the
editor's default, so nearly every page the extension exported was named after
a temporary of Quarto's. Two ends to it, and both were needed:

- The filter copies the title into `pagetitle` before the title block goes.
  `pagetitle` is not in `TITLE_BLOCK`, so the page keeps its name and still
  opens without the block.
- A document with no title at all is named by the export, which writes a
  `pagetitle` into the copy it renders. It cannot be done from the filter:
  Quarto settles the page title after the filters run, from the stem of the
  file it was handed, which on the print road is that road's private stem. The
  three roads were measured against each other on Quarto 1.9.37: a
  `pagetitle` in the copy's header gives `song notes @ work` whole, spaces and
  all; `-M pagetitle:My Tune` gives `quarto-inputd921f1d56f4c3069`, worse than
  doing nothing; and setting `meta.pagetitle` from the filter is overwritten.

Three mutations, each applied, run and reverted in one command:

- **M10** the copy not named after the document → *the copy carries no name
  for the page*.
- **M11** the guard on a `pagetitle` of the reader's own removed → *a page the
  document named itself was renamed*.
- **M12** the filter not carrying the title over the hidden block → *Expected
  values to be strictly equal* (the tab went back to Quarto's temporary).

`widestaff.mdm` is rendered with the header hidden for M12, which costs no
extra render: it is the fixture the score clamp already needed.

### The link on a heading (2026-09-13)

**The link on a heading cost the heading a line.** AnchorJS hangs one on every
heading of a Quarto page, drawn at opacity 0 until the heading is pointed at,
and in the flow it is an inline box 24 px wide at the end of the last line.
Swept the window from 600 to 916 px in 2 px steps over fourteen headings of
growing length, 2,226 measurements: 74 of them, 3.3 %, are a 36 px heading
standing 67 px for that reason alone, and since the editor carries no AnchorJS
at all, each of those is a heading of one line in the editor and two on the
page, which is the export rule's own case.

The owner asked for the link kept rather than hidden, standing in the margin
and taking no width, and not making a narrow window scroll sideways. Measured
with `position: absolute; top: 0; left: -1.4rem`: the same 74 come back to
36 px, exactly as they do with the link taken out of the document altogether,
and at 1400, 900, 700, 520, 420 and 360 px the document's `scrollWidth` equals
its `clientWidth` and the icon is whole, standing in the 50 px the column
leaves either side of itself.

One mutation, applied, run and reverted in one command:

- **M13** the heading's link back in the flow → *the link is in the flow at
  1400*.

### The rail of buttons beside a block (2026-09-14)

**A score's buttons took 28 px of the document.** The headphones and the copy
of every score stood in a strip in the flow over the engraving, so a score
stood 28 px further from the text over it than the page stands it; the owner
asked for the buttons of a block to be the editor's and not the document's, in
a rail in the margin right of the column, up on the block the caret is in and
on no other, and then for the same rail on a display equation (a copy button
it did not have) and on a block of code (whose copy rode the top corner of its
card). The rail is `position: absolute`, 10 px off the column, level with the
top of the block, hidden with `visibility` and no pointer, shown with a fade
and hidden at once, and the block that wears it is the one holding the head of
the main selection.

Measured with the strip gone, at 1200 px against the exported page: the editor
draws the blank line, 16 px, over and under a score, where the page gives the
figure 25.5 px (the old strip, put back as a style, reproduces the 18.5 and
9.5 px the stylesheet recorded, which is what vouches for the method). A
heading under a score collapses into the figure's margin and matches the
editor; a score written straight under a paragraph is flush with it in the
editor and 25.5 px under it on the page, which two of the three scores of
example.mdm are. Written in mdm-look.css, open.

A review of the change found three things the first round passed: a selection
over several blocks (Shift+Arrow, Ctrl+A) stood every rail it covered, because
the active block was read off the main range and not its head; the rail of a
fence inside a list item or a quote stood one row of code (21 px) below its
card, its static position taken as a block's after the indent on its line;
and four assertions that could not fail for the reason they named (the old
rail read after the new one had faded in, a hanging button probed beside its
own score instead of the next one's rail, a comparison of rails up and down
that a rail always in the flow passes, and nothing reading that a score or an
equation is not drawn again when its rail switches). All four were rewritten
before the second half of the round.

27 mutations, each applied, run and reverted in one command with the md5 of
`style.css` and `main.js` the same before and after, each with the tests that
failed under it (the thirteen tests of the rail, run by name across the four
webview files; M1 to M21 ran before the review, and M2, M3 and M11 again
after it):

- **M1** the rail back in the flow (`position: relative`) → *every block's
  buttons stand beside it*, *a block's rail takes no room*, *the buttons of a
  score keep clear of the engraving*, and four more.
- **M2** hidden rails drawn at opacity 0 and taking the pointer → *the rail
  goes with the caret … a hidden one takes no click*, *a rail longer than its
  score … answers there*, *a code block carries a copy button*, and two more.
- **M3** a fade-out on hiding → *the rail goes with the caret* (the old rail
  read in the task the caret landed in) and *every block's buttons stand
  beside it*.
- **M4** the rail inside the column (`left: calc(100% - 34px)`) → *every
  score gets a player toggle over the copy button*, *every block's buttons
  stand beside it*, *keep clear of the engraving*.
- **M5** the rail 40 px off the column → ten of the thirteen (past the pane,
  the document scrolled sideways).
- **M6** the code rail back at the corner of its card → *the copy button
  copies the source*, *every block's buttons stand beside it*, *a line of
  source keeps its line* (webview-narrow).
- **M7** the code rail without its `margin-top` → *every block's buttons stand
  beside it*, *a line of source keeps its line*.
- **M8** a height of 50 px on the rail → *a rail longer than its score*.
- **M9** the rail laid out in a row → seven, *the two little buttons of a
  score* among them.
- **M10** `position: relative` taken off `.mdm-math--block` → *every block's
  buttons stand beside it*.
- **M11** the `z-index` taken off the rail → **passes**. Nothing that takes
  the pointer reaches the margin today (the selection and the caret layers are
  cut to the column and to a card's window), so the rule is kept for the rail
  that hangs over another block and is not something a test can see.
- **M12** `:focus-within` taken out of the rule that shows a rail → *every
  block's buttons stand beside it* (the focused button).
- **M13** the pulse of an equation taken out → *the copy button copies the
  source and pulses the block*.
- **M14** every open block active, not the main one → *the rail goes with the
  caret* (two carets).
- **M15** the score's `updateDOM` not switching the class → ten of the
  thirteen.
- **M16** an equation's `eq` ignoring `active` → *the copy button copies the
  source*, *every block's buttons stand beside it*.
- **M17** the code chrome's `eq` answering true → the same two.
- **M18** the code chrome left on the first line of code while the fence
  shows → *a code block carries a copy button*, and the same two.
- **M19** the guard for a press on the rail outside its buttons removed → *a
  rail longer than its score* (the press between two buttons).
- **M20** the equation branch of `chromeSource` removed → *the copy button
  copies the source*.
- **M21** the copy over the headphones → *every score gets a player toggle
  over the copy button*, *every block's buttons stand beside it*.
- **M22** the active block read off the main range again → *a selection over
  several blocks stands one rail*.
- **M23** the code rail laid out as a block (`display: inline-flex` taken off)
  → *a selection over several blocks … a nested fence carries its own*.
- **M24** the score's `updateDOM` answering false → *every block's buttons
  stand beside it* (the score drawn again).
- **M25** the equation's `updateDOM` answering false → the same (the equation
  drawn again).
- **M26** an equation's rail in the flow → *every block's buttons stand beside
  it*, *a block's rail takes no room* (against no rail at all).
- **M27** a code rail in the flow → those two, *a selection over several
  blocks*, and *a line of source keeps its line*.

The same day the owner asked for the rail to come up under the pointer as
well: on the block the pointer is on, staying while it is on the block or on
the rail (whose 10 px towards the column are its own padding, so the pointer
crosses them without the rail going out), and on the block a click put the
caret in until a click outside closes it, the pointer's rail drawn over the
caret's. Six mutations more, run against the five tests the pointer reaches
(*the rail of the block under the pointer comes up*, *a code block carries a
copy button*, *every score gets a player toggle*, *every block's buttons stand
beside it*, *keep clear of the engraving*):

- **H1** the `mousemove` on the scroller not listened to → *under the
  pointer*, *a code block carries a copy button*, *every score gets a player
  toggle*.
- **H2** the padding bridge taken off, the rail 10 px off the column again →
  *under the pointer* (the pointer crossed the gap). It passed at first: the
  test moved the pointer to the button in 75 px strides and never set it down
  in the gap, so the crossing is now walked 2 px at a time.
- **H3** the pointer's rail at the caret's `z-index` → *under the pointer*.
- **H4** the rail kept when the pointer goes into the margin → *under the
  pointer*, *a code block carries a copy button*.
- **H5** a line of code finding its chrome only on itself → *under the
  pointer* (a line below the first).
- **H6** `.mdm-chrome--hover` taken out of the rule that shows a rail → the
  same three as H1.

And four more requests that day: the copy at the top of a score's rail and
the headphones under it; a score whose player is open keeping its rail up
wherever the caret and the pointer go; the score fill menu lit while a fill
is on; and the toggle that sets the prose ragged working as the score
alignment toggle does, never lit, its glyph naming what the click does (rows
flush left while justified, the justify glyph while ragged). Five mutations,
run against the tests those reach:

- **N1** the headphones back over the copy → *every block's buttons stand
  beside it*, *every score gets a player toggle under the copy button*.
- **N2** the text alignment glyph never swapped → *the prose is justified to
  both edges, and the button sets it ragged*.
- **N3** the text alignment toggle lit again on the ragged right → the same.
- **N4** the fill menu never lit → *a score is cleared by default and the menu
  fills it*, *every toggle lights on the setting that was asked for*.
- **N5** the rule keeping the rail of a score with an open player taken out
  → *a rail longer than its score* (the caret and the pointer gone, the player
  open).

Later still the owner asked for every rail to be drawn all the time, since
the margin is the editor's and covers nothing: the rounds above that hide a
rail (M2, M3, M12, H1 to H6 as showing, N5) describe a rule that is gone, and
the padding that bridged the gap for the pointer went with it, the 10 px being
margin again. The two marks stay, to stack rails that meet. Five mutations,
run against the rail tests of the four files:

- **V1** rails hidden again → *every block's buttons stand beside it … drawn
  on every block*, *every score gets a player toggle*, *the caret's mark goes
  with it*, *a rail longer than its score*, *a code block carries a copy
  button*, *under the pointer is drawn over the rest*.
- **V2** the pointer's rail at the base `z-index` → *under the pointer is drawn
  over the rest*, *a rail longer than its score*.
- **V3** the caret's rail at the base `z-index` → the same two (the hanging
  button no longer on top of the next score's rail).
- **V4** rails taking no pointer → five, *the caret's mark goes with it … every
  rail takes a press* among them.
- **V5** the padding bridge put back → *every block's buttons stand beside it*
  (the buttons' rail box off the column by 0).

Known and not changed here, found by the same review: a fenced block inside a
list item or a quote copies only its first line (its CodeText is several
nodes and `chromeSource` reads one), and a score in a quote is engraved from
its first line alone; both are older than the rail.

### Both formats, and a card of code across a sheet (2026-09-14)

Two things seen in the PDF printed without TeX, from the separate window
`~/mdm-check/sin-tex.sh` opens (TeX taken off the PATH), on the example with its
scores taken out and its prose three times over:

- **Exported as HTML + PDF, the PDF came out in Liberation Serif with every
  equation in its LaTeX source**, and exported as PDF alone it was right. The
  cause is Quarto and not the print: a render of two formats is given up at
  the first format that fails, and the page it had begun is left as it stood,
  before its resources are put in. From the same copy on Quarto 1.9.37, with
  no TeX, `--to html,pdf` left a page of 49,682 bytes with no KaTeX and no look
  in it, and `--to html` wrote 1,876,897; with TeX and a LaTeX error in the
  document, 17,103 against 1,843,445. The export printed that page and kept it
  as the HTML, and the second case is older than the print: a PDF that failed
  for any reason left the unfinished page in place of the reader's. Both is now
  the page rendered on its own and then the PDF (`EXPORT_TARGETS` in
  `extension.js`), which costs a second start of Quarto (7.75 and 7.80 s against
  7.42 and 7.35 for `example.mdm` with TeX and a warm cache) and loses nothing
  of the page to the PDF's render, measured with its resources left beside it.
  The suite had stayed green because `fakeQuartoTexFallback` wrote the finished
  page for `--to html,pdf`; it writes an unfinished one now, as Quarto does, and
  the Chrome stand-in keeps a copy of the page it was handed
  (`chromePage`).
- **A card of code that went on past the foot of a sheet opened the next one
  with its first line against the card's edge**: 1.0 pt from it, where the card
  opens 7.2 pt under its top. Chrome gives a box broken across sheets its
  padding once, over the first piece and under the last. The rule is `clone` on
  the card and the two boxes inside it, in the paper block of `mdm-look.css`;
  the code inside the pre carries 1.83px of padding of its own, so `clone` on
  the pre alone left 5.5 pt.

Tests, in `extension-host.test.js`: *exporting both formats asks for both and
offers both files* reads the two renders off the log in order; *with Chrome but
no TeX, both formats print the PDF from the HTML already made and keep it* holds
the printed page and the kept one to the finished page and the calls to
`html` then `pdf` (it used to hold them to one call); *when both were asked and
only the page landed, the notice offers the page* holds the page offered to the
finished one; and a new one, *when both were asked and LaTeX failed, the page
left is a finished one*. In `html.test.js`, *on paper a card of code that goes
on past the foot of a sheet opens the next sheet as it opens anywhere* prints a
card of 150 lines with the extension's own Chrome flags and reads the paper: the
card painted magenta by a sheet that changes colours only, the sheets rasterized
at 144 dpi with `pdftoppm`, and the first line's box from `pdftotext -bbox`; it
skips without poppler. Every piece has to open within 0.6 pt of the card's own
opening, and there have to be three pieces for it to read anything.

Each was broken, run, and the file restored and compared, in one command:

- **M1** `both: { args: ["--to", "html,pdf"] }` back in `extension.js` → the
  four both tests fail, each on its own message: *both was not the page and then
  the PDF*, *the PDF was printed from a page Quarto had not finished*, *the page
  offered is one Quarto had not finished*, *the page left beside the document
  is one Quarto had not finished*.
- **M2** the `clone` rule taken out of `_extensions/mdm/resources/mdm-look.css`
  → *on sheet 2 the card's first line stands 1.0 pt under its top edge, where
  the card opens with it 7.2 pt under*.
- **M3** `clone` on the pre alone → the same, at 5.5 pt.

Known and not changed here: a PDF that fails beside a document leaves an empty
`<name>_files/mediabag` and the filter's `mdm_cache/` there, as it did before
(a both keeps the files folder because a page rendered without
`embed-resources` needs its `libs`).

### What a failed PDF leaves, and a list under a line of text (2026-09-14)

**The folders a failed PDF leaves.** With no TeX, and after a LaTeX error alike,
Quarto 1.9.37 leaves an empty `<name>_files/mediabag` and the filter's
`mdm_cache` beside the document (a LaTeX error also leaves the `.tex`, `.aux`
and `.log`, which say what went wrong and are left). `removeFailedFolders` in
`extension.js` takes away the two folders when the failed step is the PDF, and
only what that export made: a folder that was there before stays, the files
folder of a page asked for beside the PDF keeps the page's own resources (only
the mediabag goes, and the folder if nothing is left in it), and the cache stays
while another document of the same folder is exporting. The Quarto stand-in now
leaves both folders when its PDF fails, as the real one does, and can write a
page's own `libs` (`pageLibs`) and hold one document's page back (`slowPage`).
Tests: *a PDF that fails takes away the folders it made, whatever it failed on*
(pdf and both, no TeX and a LaTeX error), *a PDF that fails leaves the folders
the reader had, and a page's own resources*, and *a PDF that fails leaves the
cache to another document of its folder still exporting*.

- **K1** `removeFailedFolders` returning at once → all three fail.
- **K2** the cache removed whether or not it was there before → the reader's
  folders test fails (its earlier engraving is gone).
- **K3** the cache removed with another export running beside it → *the cache
  was taken from under an export still running beside it*.
- **K4** the files folder removed whole when a page was asked for too → the
  reader's folders test fails (the page's `libs` are gone).
- **K5** no folders removed after a failure that is not a missing TeX → all
  three fail, on the LaTeX error cases.

**A list straight under a line of text.** example.mdm now opens with a line and
three items under it, which the editor draws as a list and Pandoc's Markdown
read as one paragraph with the dashes written into it (measured with the
export's reader on Pandoc 3.8.3). CommonMark lets a list interrupt a paragraph
and Pandoc does not. The copy is given a blank line where CommonMark starts a
list, a bullet or an item numbered 1 with something after the marker, up to
three spaces in, under text that is not in a list and is not a heading, and
nowhere inside a fence or a `$$` block; `withBreaks` in `extension.js` and its
awk twin `breaks()` in `bin/mdm`. Pandoc's `lists_without_preceding_blankline`
was measured and not taken: it lets any ordered item interrupt, so a wrapped
line starting "2026. Then" became a list numbered from 2026 where CommonMark
keeps the paragraph. Checked against Pandoc's own CommonMark reader on the
cases below, the block structure is the same in every one of them; two older
differences that are not about a blank line are left as they were (`* * *`
under a paragraph, and two lists with different bullets one under the other).
The awk agreed with the JavaScript on 31 cases under mawk 1.3.4 and on a subset
under busybox awk.

Tests: *a list straight under a line of text gets the blank line the copy
needs* (the case table `COPY_BREAKS`), *the command line's copy is given the
same blank lines as the export's*, which reads `breaks()` out of `bin/mdm` and
runs every case through it (skipped on Windows), and in `render.test.js` *a list
straight under a line of text reaches the page as a list*.

- **L1** `interruptsText` returning false → the case table and the parity test
  fail on the example's opening.
- **L2** the awk's `interrupts` returning 0 → the parity test and the rendered
  page fail.
- **L3** any ordered number allowed to interrupt → *for "The year was\n2026.
  Then\n"*.
- **L4** the `$$` block not stepped over → *for "$$\na\n- b\n$$\n"*.
- **L5** the awk's list-item look-back taken out → the parity test fails.

The example's title and subtitle were swapped by the owner at the same time,
and `html.test.js` reads them in that order now.

### Buttons at the block, and where they stand as a source opens (2026-09-14)

The owner asked for the rails to be put away again, having had them drawn on
every block all the time: a rail is up while the pointer is on its block (the
drawing, its source lines, or the rail itself) and while the block's source is
open, and a score's headphones stay up on their own while its player is open.
`.mdm-chrome--open` comes from the three widgets beside `--active`; the buttons
of a rail that is neither hovered nor open are `visibility: hidden`, the rail
takes no pointer, and a `::before` over the 10px to the column carries the
pointer from the block to the buttons while the rail is up, the rail's own box
keeping its place 10px off the column. And the rail of an open score or display
equation stood under the source with the drawing, a source's height below where
it had been when a click opened it: `placeOpenRails` in `main.js` lifts it onto
the first line of the source after every redraw. In the document's own
coordinates it no longer moves (1030.45 before and after on the first score of
example.mdm, 683.66 on the equation); a block opened near the foot of the pane
still scrolls the view to show the caret, which moves the text with it.

Tests: *every block's buttons stand beside it in the margin, up while the reader
is at the block* (was *drawn on every block*; the pointer on each kind of block
now as well), *every score gets a player toggle under the copy button; other
code does not*, *the caret's mark goes with it from one score to the next, and
every rail takes a press* (the presses now bring the pointer across the score
and the gap, as a hand does), *a rail longer than its score hangs past it, adds
nothing, and answers there* (as many buttons added as reach the next score's
rail, the rail of an open score standing on its fence; the lit headphones on
their own, the copy put away), and two new ones in `webview-look.test.js`: *a
block's buttons stay where they stood when its source opens* (a score, an
equation, a row typed into each, and a card of code) and *a put-away rail brings
nothing up and takes no press*.

- **R1** the buttons never put away → the put-away test, the toggle test, the
  caret's mark test and the hanging rail test fail.
- **R2** an open source not bringing its rail up → the rail test in
  `webview-look`, the toggle, the caret's mark and the hanging rail tests.
- **R3** the headphones of an open player put away with the rest → the hanging
  rail test (*the lit headphones of the open player went out of view*).
- **R4** `placeOpenRails` never called → the rail stays under the source: the
  new position test and the toggle test (its rail no longer level with the
  fence).
- **R5** the bridge taken out → the caret's mark test, whose press crosses the
  gap and finds the rail gone.
- **R6** a put-away rail taking the pointer → the put-away test.
- **R7** a card of code not told it is open → the rail test in `webview-look`.

### The audio of a score, and of every score (2026-09-15)

The owner asked for a button under the headphones of every score that writes
its audio, drawn with the export glyph of the toolbar, and for the toolbar's
export to grow a second branch that writes every score of the document. MIDI
and WAV are what the editor can write on its own; MP3 is put off (no browser
encodes it) and the reason is beside `AUDIO_FORMATS` in `main.js`. The files go
beside the document, one per score, named by the score's place in the document
and its `T:`, overwritten without asking, as the HTML and the PDF are.

Three of abcjs's own MIDI defects are corrected in `media/mdm-audio.js`, all
three measured against the events its synth sounds: the tempo of every meter
whose denominator is not 4 or 8 (the file came out at twice the length in 2/2
and 3/2, three times in 6/4 with a `Q:`, a quarter in 3/16, and a hundred
combinations of meter and tempo now agree with the player to within a
thousandth); the gap of a staccato or a slur, which the writer subtracted with
no cap while the synth caps it at two thirds of the note, so that above about
95 beats a minute the note-off landed before the note-on and the eight notes of
the bench came out as sixteen unpaired events; and the channel of a program
change, which the renderer always wrote as `%00%C0`, leaving both voices of a
duet naming channel 0. A title or voice name over 127 characters, or with a
character over U+00FF in it, is cut and folded: abcjs writes the length in one
byte and one byte per character, and a title of exactly 128 wrote a length no
reader can read.

A run is a conversation between the page and the host, one score at a time:
`start` says how many files to expect and is answered before a note is
rendered, each `file` or `skip` is acknowledged before the next score is begun,
and `done` always follows, from the last link of
the chain, which runs whatever happened before it. Nothing is rendered for a host that
has said no, the peak in the page is one file, and a throw cannot leave the
host's progress notification up and its lock held.

Tests, in four files. `audio-export.test.js` (Node, in `test:fast`): *a WAV is
16-bit PCM at the rate it was rendered at, interleaved and clamped*, *the MIDI
of a score plays at the tempo the editor plays it at* (20 meters x 5 tempos),
*a staccato or a slurred note lasts in the MIDI what it lasts in the player*,
*a MIDI carries the written notes, on the channel its voice is on*, *a title or
a voice name too long for MIDI is cut, not written broken*, *a score the piano
cannot sound is named before a note is fetched*.
`webview-audio-export.test.js` (Chrome): the rail's menu and what closes it,
the glyph, the numbering of scores on screen and off, a document too long to
have been read yet, the bytes as a typed array, *a WAV is the tune the player
plays, sample for sample* (the file against the buffer the player primed:
57,600 frames and 48kHz both ways, the RMS apart by the 16 bits it was written
in), a MIDI export opening no output at all, the output going back to sleep, a
score the piano cannot sound, a document with no score, a run the host turns
away, a file the host could not write, a run that needs no animation frame, and
*a score's own button writes its file beside the document, end to end* (the
real `extension.js` on the other end of the wire, the file read back off the
disk). `extension-host.test.js` gained 20 tests for the host's half, and
`webview-player.test.js` and `webview-look.test.js` were brought up to the
third button.

Four rounds of mutations. The module, against `audio-export.test.js`:

- **AU1** the byte rate without the channel count, **AU2** the channels written
  one after the other instead of interleaved, **AU3** the clamp removed, **AU4**
  a `DataView` returned instead of a `Uint8Array` -> the WAV test.
- **AU5** `withTempo` never applied and **AU6** the meter dropped out of
  `microsPerQuarter` -> the tempo test (6/4 at three times the length).
- **AU7** the gap left uncapped and **AU8** the same-pitch clamp removed -> the
  staccato test.
- **AU9** `withChannels` never applied and **AU10** `chordsOff` turned off ->
  the notes test.
- **AU11** the 127-character cut removed and **AU12** the fold of characters
  over U+00FF removed -> the meta test, which walks every event of the file.
- **AU13** only `%%MIDI program` read as an instrument (percussion and the
  bagpipe key let through) and **AU14** the pitch check removed -> the piano
  test.

The page, against `webview-audio-export.test.js`:

- **AX1** the `closeLine` the decorations read deleted -> every test in the
  file (this was a real fault, found by the agent updating the other suites:
  the fixtures here had no ordinary code fence, and one was added for it).
- **AX2** `syntaxTree` in place of `ensureSyntaxTree` -> SURVIVED on a document
  of 30 scores, which the parser reads in one go. **AX2b**, the same mutation
  against the new test that dispatches 2,000 scores (200KB, of which the parser
  had read 1,489 when the export asked) -> CAUGHT.
- **AX3** the scores counted off the widgets on screen -> the numbering test.
- **AX4** `millisecondsPerMeasure` not passed to the synth and **AX5** the
  player's own options replaced -> the sample-for-sample test.
- **AX6** the loop yielding with `requestAnimationFrame` -> the test that runs
  with none.
- **AX7** the instrument check removed -> the piano test (a violin was
  fetched).
- **AX8** the audio graph opened for a MIDI -> the silent-export test.
- **AX9** the host's refusal ignored -> the turned-away test.
- **AX10** the output never put back to sleep -> the sleep test.
- **AX11** the rail not held up while its menu is open, **AX13** the menu under
  the button instead of beside it, **AX14** the font reset removed (the prose's
  size adjustment reaching the rows), **AX12** `closeMenus` removed from the
  copy -> the menu test.
- **AX15** the copy glyph drawn in the export button -> the glyph test.
- **AX17** the rail asking for score 0, which means the whole document -> the
  end-to-end test.

The rail, against the two suites that were brought up to date: **R1** the
export out of the put-away list (the toggle test reads 1 of 3 buttons drawn
with nobody in the document), **R2** the export kept up with the lit headphones
(the hanging rail test), **R3** the export out of the 24px box list (the sizes
test reads 24 by 17, the flex column stretching what the rule no longer sizes,
and both chrome ink tests), **R4** `exportButton()` never appended (five
tests), **R5** a rail that never lets the pointer go (the layers test, whose
probe now measures from the rail's own bottom: a 76px rail had left it 14px of
clearance).

The host, against `extension-host.test.js`, 25 mutations and no survivors:
the name builder's separator, the characters a title is stripped of, the guard
that stops the byte cap spinning on a document whose own name is 251 bytes, the
allowlists for the format and the number, `EXPORT_TARGETS` read off
`Object.prototype`, saving the document first, the buttons the two notices
carry, the magic bytes of each format, the bounds on a file's number, the lock
and its separateness from the document export's, the scheme guard, the raw
title reaching a notification, the zero-score branch, the four endings of a run
(done, cancel, reload, dispose) and the throw inside a step, the `.part` left
behind, the three write-error branches, the script tag, and the last
`basename`/`dirname` guard. Three things that round found: `node:test`'s
timeout cannot interrupt a synchronous spin (the name test now runs in a child
process, so a regression comes back as a killed child instead of a hung run);
the untitled test was asserting against the wrong name, since the mock's
`fsPath` for a non-`file:` URI is the whole URI; and a document called `a:b.mdm`
is read by the Windows rules as a drive letter, which was answered with the
wording for a name that is too long.

A round of adversarial review over the finished change, four lenses with two
skeptics on every finding, brought back six faults worth the name. Each one is
now a test of its own, and each of those tests was seen to fail:

- **AX19** the minute after a player closes is a single timer, and an export
  still running when it fired swallowed it: the run held the output, the timer
  was gone, and the pilot tone went on sounding into an editor nobody was
  playing anything in. The timer now starts its minute again while a run holds
  the output, and the end of a run hands the output back to the same rules
  (asleep if nothing holds it, the minute again if the editor was inside one,
  and asleep at once if the panel went out of sight meanwhile) -> *an export
  that crosses the idle minute does not spend it*.
- **AX20** a cancel from the host set the run's flag without answering the
  reply it was standing on, so a cancelled run sat out the whole minute of
  AUDIO_ACK_MS holding the output -> *a cancelled run stops at once instead of
  waiting out its answer*.
- **AX21** everything before the synth is synchronous, so a tune abcjs could
  not read threw out of the run and took the scores after it with it. One
  score that throws is one score skipped -> *a score that cannot be read is
  skipped, and the scores after it are written*.
- **AX22** the host writes `<name>.part` and moves it into place, so a name at
  the 255-byte bound exactly was the one file that could not be written. The
  name is held five bytes short of the bound -> the hostile-title test, on a
  document name long enough to reach it.
- **AX23** the rows are spans in the rail and buttons in the toolbar, and a
  span inside the text takes the content-box the document's own boxes are
  drawn with: each row stood 17px past the panel's rounded edge (measured).
  **AX24b** the panel inherited `max-height: 60vh` and an auto overflow from
  the toolbar's tall menus, which kept 12px of empty panel for a scrollbar two
  rows never need -> both in *a score's export offers MIDI and WAV in a menu
  that behaves like the toolbar's*.
- **AX25** a run with no file to write was read as a document with no score,
  so a rail press on a score that had moved answered "no score to export" on a
  document with thirty -> *a score that is no longer where it was is not read
  as a document without scores*.

The toolbar's own branch was written once the owner had picked a variant off
`design-export-menu.html` (A′ for the panel, R2 for the rail's, and greyed
rows for a document with no score). Three tests cover it, and each of the eight
mutations below was seen to be caught:

- **AX27** the headers dropped from the panel, **AX28** the line under the
  Audio header dropped, **AX34** a header built as a row (a header is a div and
  takes no pointer; a row is a button), **AX29** the toolbar's MIDI row asking
  for score 1 instead of the whole document -> *the export panel names its two
  branches, and audio is one file per score*.
- **AX30** a row's `off` never read, **AX32** it read only when the panel is
  filled and not when it opens (so a document that gained a score kept its rows
  grey), **AX33** the greying split into a rule of its own instead of the one
  the bar's own buttons are greyed by -> *with no score to write, the audio
  rows grey out and the document's do not*.
- **AX31** an unread document read as a document with no score, which would
  grey the rows of a document nobody has counted yet -> *a document too long to
  read in the time the panel has keeps its rows live*.

Three claims that overstated what the code does were corrected rather than
tested: the README said the files sort as the document reads (the number is
not padded, so they do not past nine), that a score the piano cannot sound is
written as MIDI (it is left out of a WAV run, and exports as MIDI if that is
what is asked for), and this file said `done` follows from a `finally` (it
follows from the last link of the chain).

The Markdown conformance file (`webview-markdown.test.js`) opened the
`feat/markdown-editor` branch on 2026-09-15 with its 16 passing cases seen
to fail, two mutations of `main.js` and both caught: **MD1** the bullet
widget drawing `◦` instead of `•` -> *bullet items draw a bullet for any
marker* and *task items draw their boxes*; **MD2** the `HeaderMark` of an ATX
heading left in the flow (`hide(from, r.to)` skipped) -> *ATX headings one
to six, hashes hidden*, with the setext case still green, since its underline
goes through `hideLines`. The `todo` cases are the record of what the branch
owes and are not mutated until their fix lands.

The pointer, on the same branch, 2026-09-16. While a button is down over
the editor the drawing is held: `renderField` rebuilds for the text, the
tree and the hidden lines, but not for a selection or a focus that moved
under the button, and the release rebuilds once (`pointerReleased`). The
second and third press of a double and a triple click are answered by the
editor from the caret the first press placed (`repeatedPress`), since by
then the reveal has moved the text under a pointer that has not moved (65 px
on a heading). Five mutations of `main.js`, all caught: **PG1** the hold
taken off (a gesture rebuilding at once) -> *a click into an unfocused
document puts a caret where it lands, not a range*, *a wobble of the hand
between press and release selects no more than it crosses* and *a double
click selects the word under the pointer, hidden marks and all*; **PG2**
`repeatedPress` never answering -> *a double click ...*; **PG3** the release
never rebuilding -> *a click into an unfocused document ...* (the marks not
revealed once the button is up) and *a double click ...*; **PG4** the triple
click stopping short of the line break -> *a triple click selects the line
under the pointer, line break included*; **PG5** the group not widened to
the left of the caret -> *a double click ...*. The helper sends a double
click as two presses, the second labelled as the second (puppeteer's
`count: 2`): its `clickCount` option is overwritten inside `mouse.click`
(puppeteer-core 25.8) and a press sent with it comes out as a first press,
which kept the double-click test red until the helper was corrected.

Enter, the same day. CodeMirror's two commands for it read whitespace with
`\s`, which takes U+00A0 along with the space, so one press of Enter beside
a no-break space deleted it or wrote it back as an ASCII space through the
indent, and both readers print it. Enter is the editor's own now (`mdmEnter`
in `main.js`): lang-markdown's continuation of lists and quotes ported with
`[ \t]` for its whitespace and its shape kept, a plain newline with the same
class, and CodeMirror's own command left the job inside a fence, where the
code's language may have an indentation to offer. The language no longer
installs its keymap (`addKeymap: false`, which went in at high precedence
over the editor's), and its Backspace is bound on its own until P4. Five
mutations of `main.js`, all caught: **EN1** the newline's forward trim
back to `\s` -> *Enter beside a no-break space keeps it, on either side*
and *Enter on a line of one no-break space keeps the line*; **EN2**
`isBlank` back to `\S` -> the line of one no-break space and *Enter in a
list item keeps a no-break space and carries the list on*; **EN3** the
continuation's trailing trim back to `\s` -> the list item; **EN4**
`addKeymap` back to true (lang-markdown's Enter over the editor's) -> the
list item; **EN5** the Enter binding removed -> all three. Enter between
`[]` or `{}` no longer opens three lines: that was CodeMirror's bracket
"explode", and in Markdown `[]` is a label.

The frame a line stands in (P2 of the branch, 2026-09-16). A line inside a
quote or a callout is drawn inside every level around it: `buildDecorations`
gathers the levels as it enters the container nodes and writes them on the
line as a gradient of bars (3 px a bar, 17 px a level) and an inset, a
transparent border so the padding of a card or a heading in a frame stays
its own; a block drawn instead of its source (a rule, an equation, a table,
a score) takes the frame on a wrapper. With it: blank lines inside a
container are the em-tall gap (`mdm-blank`), the rule carries the number of
its line, the `>` of a quote inside a fence is hidden with the rest, and the
fading of a callout fence is the text's and not the row's. Six mutations,
all caught: **FR1** the quote adding no level -> *Q03*, *Q05*, *Q08* and the
look's *a quote in a quote and a callout in a quote wear one bar per level,
and a drawn block stands inside them*; **FR2** `framed` handing the block
back bare -> *Q05* (the rule in the quote without the quote's roles) and the
look test (the wrapper's inset, the rule's place); **FR3** the rule without
its number -> *T01* and *Q05*; **FR4** the fence's fading mark not added ->
the look test; **FR5** a blank line in a frame read with the prose's rule
(so `>` alone is not blank) -> *Q03* and *Q05*; **FR6** the inset border
dropped from `style.css` -> the look test. The page already sets a quote in
a quote 17 px a level (Bootstrap's blockquote under mdm-look.css, measured
at 17 and 34), and the list rules follow in the next round with a test on
both surfaces; the page's callouts are Quarto's own, a header with an icon
on a 5 px bar in a smaller face, which the editor's bar and tint do not
match, and that difference stands until it is decided.

Lists, the same day. An item hangs under its text: every list level sets
its lines 1.5em in through the frame, the first row of an item comes back
by the same 1.5em (`mdm-li-first`) and the marker is drawn in that gap as a
box of 1.5em (`MarkerWidget`, in place of the marker as typed, its
indentation and the space after it): a bullet, the number the list gives
the item (its start and its place, not the digits typed), or a task's box
alone, followed by a gap of a set width; the indentation a continuation
line carries in the source is hidden, level by level; a block opening on
the item's line (`- ***`, `- $$`) takes the marker into its wrapper's gap.
The page draws its lists on the same measures (mdm-look.css, both copies):
1.5em a level, the browser's marker off and a `li::before` box of 1.5em in
its place, the `list-item` counter for the number (it follows Pandoc's
`start`), and a task's box, bare, in a `<label>` or in a `<p>` as Pandoc
writes it, pulled into the gap by its 13px and the 0.28em the editor's gap
is. Six mutations, all caught: **LI1** the marker never drawn -> *L01*,
*L02*, *L14*, *L15*, *TL01* and the look's *a list hangs under its text,
level by level, with the marker drawn in the gap*; **LI2** the number
taken from the digits typed -> *L02* and the look test; **LI3** the list
adding no level to the frame -> every list case and the look test; **LI4**
the continuation indentation left in the flow -> *L07* and *L15*; **LI5**
`text-indent` back to 0 in `style.css` -> the look test; **LI6** the page's
lists back at Bootstrap's 2rem in `_extensions/mdm/resources/mdm-look.css`
-> `html.test.js`'s *the page hangs a list under its text where the editor
does, level by level* (34 px against 24). Two differences stand: the
editor draws the delimiter typed on an ordered item (`3)`) where Pandoc
writes every list with a point; the fence opening on an item's line is
answered below.

The blocks read whole, the same day. Inside a list item or a quote Lezer
gives a fence one `CodeText` per line, the container's indentation and `>`
left out, and the editor read the first alone: a score in a list was
engraved from its first line, Copy copied one line and a card's bottom edge
landed on its second line. `fenceSource` joins the parts line by line, a
line break for every line of the block Lezer gives no part for (a blank
line in a quoted fence), and feeds the score, the card, Copy and the count
of scores the export reads; `blockTex` gives KaTeX the content of a
display block past the `>` and the item's indentation of every line. With
them an empty fence is drawn as an empty card carrying its number
(`EmptyCardWidget`), a setext heading of several lines puts its air above
the first line and its rule under the last (`mdm-h-first`, `mdm-h-last`;
an ATX heading is both), and a fence opening on an item's line, whose
hidden first line took the marker with it, draws the marker in the gap
beside the card's first line. Six mutations, all caught: **SC1** the
source read from the first part again -> the look's *a score and a card
inside a list or a quote are read whole: engraved, and copied without the
marks* (no notes engraved, one line copied; the conformance rows cannot
tell, a score row being ⟦score⟧ either way); **SC2** KaTeX handed the raw
content -> *M10b*; **SC3** the empty fence hidden again -> *F06*; **SC4**
`mdm-h-last` put on the first line -> *H09b* and the look's *a setext
heading of two lines draws its air above the first line and its rule under
the last*; **SC5** the floating marker not drawn -> *L14b*; **SC6** the
h1's rule back on every line of the heading in `style.css` -> the setext
look test.

The inline marks, the links and the figures (P3 of the branch, 2026-09-17).
A link goes where the URL after its closing bracket says, not where the
first URL in it does (a bare address in the label is one, found by GFM's
autolinker), or by reference to a definition of the document, read once
per rebuild into a map keyed as CommonMark 4.7 matches labels; the tooltip
is that destination, with the Markdown title beside it in `data-mdm-title`,
and the whole tail folds, spaces and angle brackets included; a definition
line is set like an HTML block. An escape's backslash is hidden and the
character keeps the ink, an entity is drawn as its character (decoded by
the browser through a `textarea`) and one that stands for nothing stays as
written, a hard break is marked ↵ at the end of its row, a code span loses
the space CommonMark strips from each end, a subscript and a superscript
are `<sub>` and `<sup>` on Bootstrap's measures, and an image alone in its
paragraph is a figure with the alt text under it (Pandoc's implicit
figure), a block over its covered source like a table, opened by a click
at the head of the source. Sixteen mutations, all caught: **IN1** the
first URL of the link taken -> *K03*; **IN2** the tail hidden only to the
closing bracket -> *K01*, *K02*, *K05*; **IN3** `unbracket` handing the
brackets back -> *K02*, *I06*; **IN4** the definitions never read -> *K05*
(no tooltip), *I06* (no picture); **IN5** the backslash kept -> *X01*;
**IN6** the entity left undecoded -> *X04*; **IN7** the hard break's mark
not drawn -> *B01*; **IN8** the code span's spaces kept -> *C01*; **IN9**
the sub and sup boxes not made -> *S02*; **IN10** the figure never drawn
(every image inline) -> *I01*, *I06*, `html.test.js`'s *the page lowers a
subscript, raises a superscript and captions a figure as the editor does*
and the editing suite's *a picture that arrives after its line was
measured is measured again*; **IN11** the click on a figure resolving no
node (the caret at the end of the line, where it was) -> the look's *a
figure carries the pointer, and a click on it opens its source*; **IN12**
`file:` taken for a path -> *a relative image hangs from the folder of the
document, an absolute one from the root*; **IN13** the sub and sup back at
1em in `style.css`, **IN14** the caption's colour dropped and **IN16** the
figure given 0.2em of padding (19px of air against the page's 16) -> the
page test; **IN15** the `.mdm-link *` selector dropped (the highlighter's
own colour on the glyphs of an address, G016) -> *A01*, *A03*. Two
differences are by design and stand: a soft break, one line ending inside
a paragraph, is a row of its own in the editor (as Typora and Obsidian
draw it while editing) where the page runs the lines on, so *B01* holds
the rows and the page is not compared; and a link's tooltip is its
destination, where a browser shows the Markdown title, since the address
is what a reader hovering a link in an editor is asking for.

Tables, the same day. Lezer gives no node for an empty cell, so a row read
off its `TableCell` nodes lost its columns and every value after a gap slid
left; `tableModel` reads the cells between the pipes instead (a stretch
between two pipes is a cell whatever it holds, the stretch before the first
and after the last only when it holds something), fits every row to the
header as GFM and Pandoc do (a short row given empty cells, a long one
losing the excess) and points a cell it added at the end of its row for the
click. A `<br>` in a cell is a `br` part painted as a break, as the page
writes it; any other raw tag stays as written, as in the prose. And the
cells take `overflow-wrap: normal` back from CodeMirror's `anywhere`, so a
squeezed column breaks between words and never inside one. Four mutations,
all caught: **TB1** a blank stretch between pipes dropped -> *TB10*;
**TB2** the rows not fitted to the header -> *TB05*; **TB3** the `<br>`
pushed as text -> *TB04*; **TB4** the cells' wrapping rule dropped from
`style.css` -> the look's *a wide table squeezes its columns to their
longest word and scrolls the rest, breaking no word*. One difference
stands, and it follows from the rule of 2026-09-12 (intact, and then a
scroll): for a table wider than Pandoc's column Pandoc writes relative
widths (`width:100%` with fourteen columns of 7%), so the page wraps the
words of every cell into its share of the measure, where the editor keeps
the table at its content width and scrolls it inside its box (measured
2026-09-17 on the fourteen-column table of the bench, TB08).

Links by definition (the parser, the same day). Lezer closes every `[...]`
into a Link, so `[sic]`, `[Ctrl]`, `[^1]` and `[@key]` were blue links with
their brackets hidden and `[Sonata [K. 331]](url)` was no link at all, the
inner brackets closing first and spending the outer opener. `links.js` in
`vendor-src` replaces LinkEnd alone: a shortcut, collapsed or full
reference is a link only when its label is defined, the definitions being
read raw off the whole input once per parse by a block parser that claims
nothing (a paragraph is started and finished inside one `advance()`, so
the set read at its first line is the one its inline content sees); an
undefined reference leaves its opener spent and the brackets as text, and
an opener outside them live. The openers stay Lezer's own, told apart by
shape, so the GFM autolinker's `hasOpenLink` keeps stopping a bare URL at
the link's bracket. Emoji is taken out of the language (`:tada:` is text
on the page). And since the fragments an edit leaves untouched are not
parsed again, a definition typed under a paragraph left the `[foo]` above
as text: the language sits in a Compartment and is reconfigured, which
starts the parse over, when a change alters the set of definitions
(`definitionsChanged` in `main.js`, reading the whole document only when
a changed line holds `]:`). Six mutations, all caught: **LK1** the
definitions ignored (every reference a link) -> four vendor tests and
*K11*, *K13*; **LK2** the outer openers left live when a link is formed ->
the vendor's *balanced brackets* (the defined inner reference case);
**LK3** Emoji back in -> the vendor's *emoji* test; **LK4** the label not
case-folded -> two vendor tests and *K05* (`[Ref][]` under `[ref]:`);
**LK5** the reconfigure never dispatched in `main.js` -> the editing
suite's *a definition typed below turns the brackets above into a link,
and its loss turns them back*, whose paragraph stands more than 128
characters from the edit, the gap under which CodeMirror keeps no
fragment and the test passed for nothing; **LK6** images never recognised
as openers -> the vendor's *image by reference* and *I06*. A vendor
mutation rebuilds the bundle for the webview tests and rebuilds it again
on restore (the build is deterministic, and the hash says so). Two
approximations stand: a definition inside a fenced code block, or
indented four spaces, counts for the parser and not for the page; and a
label defined only through a definition Lezer would reject (a bad
destination) counts too.

The maths closer, the fenced divs and the tab heading (the parser, the
same day). A `$$` closer with text after it (`$$ {#eq-mass}`, a Quarto
label; `$$ where *c* is the hypotenuse.`) broke the block in `math.js`,
and since the block parser resumed on the same line the closer was read
again as an opener and took the next block's `$$` (G052); now the block
closes at the `$$` and the rest of the line is a Paragraph of its own,
which `MathWidget` draws under the equation, painted as a cell of a table
is (`cellParts`), where the page runs it on after the display maths; the
cover over the block takes the tail's marks with it, and a click on the
drawing finds the maths past that paragraph. `callout.js` takes Pandoc's
colons after the attributes and a brace inside a quoted value, no longer
interrupts a paragraph (Pandoc's fenced_divs need a blank line before the
opener, G053), and `calloutKind` answers null for a div that is no
`callout-*`, which the editor draws bare, fences put away and no bar or
tint, as the page prints it (G051). And `heading.js` reads `#\tTitle` as
the heading CommonMark 4.2 and the page make of it, the editor hiding the
run of spaces and tabs after the hashes with them (G042). Ten mutations,
all caught: **MT1** the tail never emitted -> the vendor's *closer with
text* and *M11*, *M12*; **MT2** the closer with text breaking the block
again -> the vendor test and *M11*; **MT3** `calloutKind` back to "note"
for every div -> the vendor's *calloutKind* and *D05*; **MT4** the old
opener pattern -> the vendor's *opening forms* and *D06*; **MT5** the
paragraph interrupted again -> the vendor's *straight under a paragraph*
and *D07*; **MT6** the tab heading left out of the extensions -> the
vendor's *atx heading* and *H03*; **MT7** the tail not painted in
`main.js` -> *M11*, *M12*; **MT8** every div framed as a callout -> *D05*;
**MT9** the whitespace after the hashes left in view -> *H03* (the `###
\tSpace then tab` row); **MT10** the click on a labelled equation resolving
no node -> the look's *a click on an equation whose closer carries a label
opens its source at the head of the maths*. What stands: the label of an
equation is drawn as the text it is on the page, `{#eq-mass}` under the
maths, until the attributes package draws it as a reference.

The table parser, the same day. GFM's table parser splits a row at every
unescaped pipe, inside `$|x|$` and inside `` `x || y` `` too, and the
drawn table had four cells under a two-column header (G011); `table.js`
takes its place by name, Lezer's parser ported with a `|` inside inline
maths (Pandoc's rules, the ones `math.js` reads by) or a code span (a run
of backticks closed by a run of the same length) left to the cell. Lezer
keeps every `endLeaf` ever registered, so GFM's own still helps decide
whether a pipe line under a paragraph starts a table; the two count alike
unless a pipe sits inside code or maths on that very line, which the bench
has not met. Four mutations, all caught: **TP1** no span shielding its
pipes -> the vendor's *a pipe inside inline maths or a code span is the
cell's* and *TB11*, *TB03*; **TP2** the escaped pipe read as a pipe -> the
vendor's *an escaped pipe is text* and *TB03*; **TP3** the digit rule
dropped from the maths closer (`$5|$6` shielded) -> the vendor test, by
the `$5|$6` row put in for it, the `$5 | $6` row failing on the space
before the closer already; **TP4** the parser left out of the extensions
-> the vendor test and *TB11*. What stands: a table straight under a
paragraph line starts a table in the editor (GFM) and not on the page
(Pandoc), until the export's copy puts the blank line in (P6, `withBreaks`).

The editing drills of the bench (section 22), Enter and deletion, the same
day (P4-a of the branch). Enter is decided range by range, where any caret
outside markup used to send every caret to the plain newline (G072). An
empty item is unmade with a blank line put between it and the item before,
so that what is typed next is the paragraph it reads as and not a lazy
continuation of that item, which every reader joins into the item's line
(G068), and a list of one item is not made loose on the way (G069); an
empty nested item is unnested one level, with no line of spaces left behind;
a task carries on unchecked, on an ordered item too, and a tab after the
marker is read, both of which lang-markdown's reading left out (G084);
Enter at the head of a heading's text opens a line above it, where it used
to leave an empty heading over a paragraph (G073); in a fence held by a
quote or an item the new line carries the container's marks (G071), and
the fence is asked before the language, since a fence of JavaScript has
JavaScript active at the caret and the first run of the drill found that
caret fall to the plain newline; a bare fence keeps CodeMirror's own
newline, which indents by the code's language. Ctrl+Enter out of a
paragraph of two source lines leaves it whole (a paragraph is leavable
now; G084). Backspace and Delete are the editor's own, and lang-markdown's
Backspace is unbound: at the head of the line under a hidden block, and at
the end of the line over one, the block opens and nothing is deleted, where
the line break used to go into the fence and break the block (G062); after
the marks of a heading the whole run goes, as a list item loses its whole
marker, which is the by-design verdict the plan changes for this branch
(G077, on the record here for the owner); after the marker of a later item
or the `>` of a quote the marker goes whole, and when the line before holds
text a blank line parts them, so that the text left is the paragraph it
reads as (G078; lang-markdown blanked the marker with spaces), an ordered
list renumbered past it, a nested item's text kept in the item around it,
and spaces beyond the one after the marker taken back to that space first;
an emoji with a skin tone, a keycap, the variation selector, a joiner or a
tag goes whole, as Chrome's textarea takes it, and a combining accent alone
comes off its letter, as CodeMirror, the textarea and VS Code all have it
(G056). Eighteen mutations of `main.js`, all caught: **EN1** the blank line
under an unmade item dropped -> *Enter twice at the end of a list ends it
with a blank line, so the next text is a paragraph*; **EN2** the unnesting
branch off -> the same, by its nested item; **EN3** the heading branch off
-> *Enter at the head of a heading's text opens a line above it*; **EN4**
the container's marks left off the fence's new line -> *Enter in a fence
inside a quote keeps the new line in the quote*; **EN5** the fence asked
after the language -> the same; **EN6** the task box dropped from the
reading of an ordered marker -> *Enter continues a task unchecked, an
ordered task too, and a marker followed by a tab*; **EN7** a bare fence
sent to the editor's newline -> the fence drill, by its bare fence;
**EN8** a caret outside markup given nothing -> *Enter with two carets
answers each on its own*; **EN9** a tab after a bullet marker refused ->
the task drill; **BS1** the hidden block at the head of the line not looked
for -> *Delete and Backspace at the edge of a hidden block open it and take
nothing*; **BS2** the heading's marks taken from anywhere in the run ->
*Backspace after the hashes of a heading takes them all*, by its step
further in; **BS3** no blank line parting the unmarked line from the item
above -> *Backspace after a later item's marker takes the marker and parts
the line from the item above*; **BS4** the ordered list not renumbered
past it -> the same; **BS5** the emoji rule off -> *Backspace after an
emoji with a skin tone or a keycap takes the whole glyph*; **BS6** the
extra-space rule off -> the marker drill; **BS7** the combining accent
counted as an extender -> the emoji drill, by its accent; **DL1** Delete's
look at the block off -> the edge drill; **KM1** Backspace and Delete
unbound -> the four deletion drills.

Tab and Shift+Tab, the same day (P4-b). CodeMirror's `indentWithTab` put
two spaces at the head of every selected line, whatever the caret was in:
under `1. parent` that left `2. child` beside it, since a child block of an
item stands at the item's content column (three for `1. `, CommonMark
5.2), a quoted item got its spaces before the `>`, a nested item's children
stayed behind as its siblings, and two presses in the middle of a
paragraph made an indented code block of it (G070). Tab is the editor's
own now: on an item it moves the item, its children and the selected
siblings after it under the item above, at that item's content column
(read off its marker and the one to four spaces after it), and in an
ordered list numbers the block from one, or on from the nested list the
item above ends with, and closes up the items left behind; Shift+Tab moves
a nested block out to the column of the item that held it, right after
that item, numbered on from it, and the siblings it leaves behind become
its children, numbered from one; a top-level item stays put. In a fence the
unit of indentation goes in at the caret (at the head of each line of a
selection), and Shift+Tab takes one unit off the line. In prose a tab
goes in at the caret in the middle of a line and nothing at the head of
its text, where four columns would make code of the paragraph; the key is
taken either way, since an unhandled Tab moves the focus out of the
editor. Blank lines and lazy continuations at the margin are left where
they are, so no line of spaces is written. Sixteen mutations of `main.js`,
all caught: **TA1** the width pinned to two -> *Tab nests an item under
the one above at its content column, and Shift+Tab brings it back*; **TA2**
the marker line moved alone -> *Tab and Shift+Tab take an item's children
along and renumber the lists they cross*; **TA3** a nested ordered block
not numbered from one -> the same; **TA4** the items left behind not
closing up -> the same; **TA5** a block joining a nested list numbered from
one instead of on -> the same; **TA6** the spaces put before the quote's
mark -> the same; **TA7** the block brought out not numbered after its
parent -> the same; **TA8** the siblings left behind not numbered from one
-> the same; **TA9** the outer items after the parent not renumbered ->
the same; **TA10** a selection taking its first item alone -> the same;
**TA11** the head-of-line guard off -> *Tab in prose puts a tab at the
caret and never makes code of the paragraph*; **TA12** the key handed back
when nothing changes -> the same, by the focus; **TA13** the unit put at
the head of the code line -> the same; **TA14** Shift+Tab taking nothing
off a code line -> the same; **KM2** Shift+Tab bound to the nesting -> the
two item drills; **KM3** Tab unbound -> the item drill and the prose drill.

The shortcuts and the buttons, the same day (P4-c). `toggleInline`
looked at nothing but the characters either side of the range, so a caret
inside bold wrote a new pair into it, Ctrl+I on the text of bold took one
star off each side and made it italic, and a selection was wrapped whole
across paragraphs, edge spaces and all, which no reader reads as marks
(G063, G075). The three commands read the tree now: a caret inside a run
of their kind takes the run's marks off, and at the end of its text steps
out past the closing mark, so bold typed after Ctrl+B is closed by the
next Ctrl+B with no empty pair left; a caret in the middle of a word wraps
the word and anywhere else writes an empty pair, which the same key takes
off again; a selection of the whole of a run's text takes the marks off,
one inside a run is taken out of it, the run closed before it and opened
again after it with the spaces beside it outside the marks, and any other
is wrapped line by line, each line's own text past its quote marks, list
marker and hashes, spaces at the edges left outside, merged with the runs
of the kind it touches, and a code span holding backticks fenced by one
more (CommonMark 6.1). The results were put through Pandoc's export
reader and its CommonMark reader on the way: `***half bold** plain*` is
`em(strong(half bold) plain)` in both. `insertLink` inside a link nested a
second one, and the outer link was lost to the inner (G074): now the
link's address is selected, or the caret goes between the parentheses of
an empty one, and a selected address becomes the destination with the
caret in the label (ED29). The Bold button with a word selected in a
table cell wrote `****` on the line under the table, since the mousedown
on any button first put the open block away and the caret with it
(G064): the buttons that work on the selection (`mdm-btn--caret`: heading,
bold, italic, code, link, the lists) are exempt from `dismissFromOutside`,
and the theme button and the bare bar still put a block away, which the
test above them keeps. The list buttons put their marker on top of the
other kind's, of a `>` and of a `#`, and numbered blank lines (G065): a
line changes kind now, a heading's hashes make way for the marker, a task
box keeps its place, the `>` stays in front, blank lines are left blank
and uncounted, and the numbers run from one over the lines taken; the
heading button puts its hashes after a quote's mark, in place of a list
marker (an item is not a heading of the document), and makes the ATX
heading of the next level of a setext heading, underline gone. Twenty-two
mutations of `main.js`, all caught: **IL1** the run around the range
unread -> *Ctrl+B with the caret inside bold takes the bold off, and at
its end steps out of it*, *Ctrl+B and Ctrl+I on a selection write marks
the readers read as meant* and *Ctrl+B wraps every range and unwraps it
again*; **IL2** the step out off -> the caret drill; **IL3** the strong
run's stars taken for a bare pair -> the selection drill; **IL4** the
word not wrapped -> the caret drill; **IL5** the edge spaces wrapped ->
the selection drill; **IL6** a selection wrapped whole across lines ->
the same; **IL7** the line's prefix wrapped -> the same; **IL8** a run
the selection starts inside not extended -> the same; **IL9** the code
fence not lengthened -> the same; **IL10** the space beside a selection
inside a run put inside the marks -> the same; **LK1** the link around
the caret ignored -> *Ctrl+K edits the link around the caret instead of
nesting one, and makes a selected address the destination*; **LK2** the
caret not put between empty parentheses -> the same; **LK3** an address
made a label -> the same; **HD1** the hashes stacked on a list marker ->
*the heading button puts its hashes after a quote's mark and in place of a
list marker, and makes ATX of a setext heading*; **HD2** setext left as
it was -> the same; **HD3** the hashes put before the quote's mark -> the
same; **LS1** blank lines numbered -> *the list buttons change the kind of
a list, take it off again, and leave blank lines and quote marks as they
are*; **LS2** the other kind's marker kept under the new one -> the same;
**LS3** the second press not taking the list off -> the same; **LS4** a
heading's hashes kept under the marker -> the same; **DM1** the caret
buttons not exempt from the dismiss -> *a toolbar button works on the
selection where it is, in a table cell or over inline maths*; **DM2** the
class not put on the buttons -> the same.

The clicks, the same day (P4-d). The bullet and the number an item is
drawn with took the click as text: CodeMirror put the caret on one side of
the hidden `- `, and the letter typed next made `x- Viola`, which no reader
reads as an item (G066); the marker widget ignores events now and the
editor's own mousedown handler puts the caret where the item's text starts,
the editor focused first, since a selection put in place from inside an
update pulls the focus in and `syncFocus` answers the focus event with a
dispatch CodeMirror refuses there. The task box was re-read off the line
with a regex that knew `- [ ]` and `1. [ ]` at the head of the line alone,
so a box inside a quote or on a `2)` item was drawn and did nothing (G076):
the marker is read off the tree. A link could not be followed at all
(G083): Ctrl+click (Cmd on a Mac, or Alt+click when
editor.multiCursorModifier is ctrlCmd and Ctrl adds a caret, the swap VS
Code makes) posts the destination to the host, which opens an address
outside and a file in VS Code, a link to a heading of the document moves
the caret to the heading, and a plain click edits the link as VS Code's own
editor does. A paste with no text on the clipboard, a picture or rich text
alone, replaced the selection with the empty string CodeMirror was given
and sent the emptied text to the host (G082): a paste with neither
`text/plain` nor `text/uri-list` is taken and leaves the selection alone.
And a rule glued to a table, a score or an equation shielded the block from
Up and Down, which asked the neighbouring line alone (G101): a drawn rule
is walked past and the block beyond it stepped into. Fourteen mutations,
ten of `main.js` and four of `extension.js`, thirteen caught: **CK1** the
marker widget taking events again -> not caught, and kept: the handler
prevents the default, which CodeMirror's own mousedown honours, so the
`ignoreEvent` is belt and braces and the caret is pinned by **CK2** the
caret put at the widget's start -> *a click on the drawn bullet or number
puts the caret at the item's text*; **CK3** the box read off the line's
head again -> *a task box flips its own text inside a quote and on a `2)`
item*; **CK4** the ctrlCmd swap dropped -> *Ctrl+click follows a link,
Alt+click when Ctrl adds a caret, and a plain click edits it*; **CK5** mail
not given its scheme -> the same; **CK6** a fragment sent to the host ->
the same; **CK7** the heading's identifier without its hyphens -> the
same; **PS1** the paste handed on -> *a paste that carries no text leaves
the selection as it was*; **RL1** the rule not walked past -> *Up and Down
step into a hidden block past a rule glued to it*; **RL2** a cover counted
as a rule -> the same; **OL1** a `www.` address opened as a file -> *a link
followed from the editor opens an address outside and a file in VS Code*;
**OL2** the fragment kept on the path -> the same; **OL3** the escapes
kept -> the same; **OL4** the message unanswered -> the same.

The outline and the search, the same day (P5). The panel opened at
startup listed the headings of the first 3000 characters, CodeMirror's
initial parse, and nothing refreshed it when the background parse landed
(G111): while the panel is open and the parse is not done, the rest is
parsed for the panel in slices of 40 ms between frames, the list drawn
from the tree each slice reaches, which also takes it past the parser's
own reach of the viewport and 100000 characters. Three mechanisms were
written first, a refresh on every transaction the background parse lands,
a forced slice inside every refresh and this loop, and none of the three
could be seen to fail while the other two stood; the loop alone stays.
The rows printed the heading's source, with the `#` runs stripped by a
regex that took the sharp off `Sonata in F#` and the first line alone of
a setext heading (G112, G113): a row is now the heading's inline content
read as a table cell is, marks off, a link its label, an equation set by
KaTeX, a setext heading whole with its line breaks as spaces, and an
attribute block on the heading (`{#sec-x}`) left off, as Pandoc's table
of contents leaves it; the tooltip is the plain text, an equation as its
source. Three differences on the record: Pandoc's Markdown reads
`## Sonata in F#` as "Sonata in F" and CommonMark keeps the sharp, which
the editor follows and the export's copy will escape (P6, `withBreaks`);
Pandoc reads a setext heading of two lines as a paragraph, and the editor
lists it as the heading CommonMark makes of it; headings inside a quote or
a list item are listed, as VS Code's outline lists them, where Pandoc's
contents leave them out. Ctrl+F reached no handler while the document was
unfocused, the state it opens in (G118): a document-level Ctrl+F opens the
search panel, the document counted as entered ahead of it, since the field
takes the focus inside the update that mounts the panel, where syncFocus
cannot dispatch the effect; a match inside a hidden block then opens the
block when it is the current one. That the hidden YAML header is not
searched stays as it is: the search runs over the editor's text, and the
header is the host's. Nine mutations of `main.js`, all caught: **OT1** the
parse loop off -> *the outline lists every heading of a long document as
the parse lands, with no caret move*; **OT2** the slice's tree not handed
to the refresh -> the same; **OT3** the heading read as its source -> *an
outline row reads as the editor draws the heading*; **OT4** the attribute
block kept -> the same; **OT5** the setext line break kept -> the same;
**OT6** the row drawn as text -> the same, by the equation and the marks;
**OT7** an equation empty in the tooltip -> the same; **SR1** the
document-level Ctrl+F off -> *Ctrl+F opens the search from an unfocused
document, and a match inside a hidden block opens the block*; **SR2** the
document not entered ahead of the panel -> the same, by the block.

The dialect, second part (P6-b), the same day: the Pandoc syntax the
export reads and the editor had no node for, in `pandoc.js`. Raw TeX
(G013): a backslash before letters, with its brace and bracket groups, is
a raw inline to Pandoc's reader, which the HTML writer drops and the
LaTeX writer copies through, and CommonMark read a literal backslash, so
`\alpha` and `C:\Users\bach` were words in the editor and gone from
the page; the node is drawn as the source it is, faint and in the code
face, with what becomes of it in the tooltip, and `\begin{env}` down to
its `\end{env}` is the block form, at the top level only, since the
look-ahead reads raw lines past a quote's end. Attributes (G014):
`{#id .class key=val}` after an image, a link, a code span or a bracketed
span, and alone as the tail of a `$$` closer, is a node, hidden while
untouched (the page prints none of it) and small and faint under the
caret; an image's `width` is the picture's, on the figure and inline; a
bracketed span `[text]{.smallcaps}` hides its brackets and draws the
classes the page turns into a look, small caps by the face and a mark by
the browser's own colours; a heading's attributes are no node, an inline
parser not knowing a heading's line, and are hidden off the heading's
text instead; and the label of a labelled equation is drawn no more,
where it stood as text under the equation until now (M11 changed). A
`{...}` in prose stays text, as it is on the page. Citations and Quarto's
cross-references (PX04): `[@key, p. 33]` and `@fig-x` are a node, drawn
as written in the link colour with what they are in the tooltip, since
the page resolves them and the editor has no bibliography to; a `@`
inside a word, a mail address, opens none. Fourteen mutations, seven of
the parser with the bundle rebuilt each way, seven of `main.js`, all
caught: **PX1** any backslash raw -> the vendor's *raw TeX*; **PX2** the
block committed without its closer -> the same; **PX3** an attribute taken
anywhere -> the vendor's *attributes*; **PX4** any brace group an
attribute -> the same; **PX5** the span hook off -> the same and *AT01*;
**PX6** the in-word guard off -> the vendor's *citations* alone, since in
the editor GFM's autolink takes the mail address before the `@` is
reached, and *CT01* could not see it; **PX7** trailing punctuation kept in
a key -> the vendor's *citations*; **ED1** a heading's attributes shown
-> *AT01*; **ED2** the width ignored -> the same; **ED3** the label drawn
under the equation -> *M11*; **ED4** small caps not drawn -> *AT01*;
**ED5** an attribute shown untouched -> the same; **ED6** the tooltip
without its kind -> *CT01*; **ED7** the block's lines not faint -> *RT01*.

The footnotes (P6-c, PX01), the same day, in `footnote.js`: `[^1]` was a
bracketed text (and, with its definition below, a reference link),
`^[note]` a caret and a bracket, `[^1]: text` a link reference definition
with `^1` for its label, drawn small and faint, and the note's second
paragraph, indented four, an indented code block; Pandoc reads a
reference, an inline note and a note with its paragraphs. The nodes are
those: the reference drawn raised in the link colour with its marks
hidden, as the page raises the number it gives the note; the inline note
drawn where it stands, in a small card, its marks hidden; the note itself
a faint block under the prose face, its `[^1]:` replaced by the raised
label and the indentation of its later paragraphs hidden, its blank lines
left to the blank rows they are. The definition is read at the top level
only and only at the head of a block: under a paragraph line it is the
paragraph's, as Pandoc has it, and inside a quote it stays the link
reference it was. Ten mutations, five of the parser with the bundle
rebuilt each way and five of `main.js`, nine caught: **FN1** an empty
label a reference -> the vendor's *footnotes*; **FN2** the inline note's
content not parsed -> the same; **FN3** the note running on past its
indented lines -> the same; **FN4** the parser's place among the block
parsers moved -> not caught, and rightly: the link reference is read off a
paragraph's leaf, so a block parser claims the line first wherever it
stands, and the claim itself is what the vendor test pins; **FN5** the
reference parser put after the link opener -> the vendor's *footnotes* and
*FN01*; **NF1** the reference's marks shown -> *FN01*; **NF2** the `[^1]:`
left in the note -> the same; **NF3** the indentation shown -> the same;
**NF4** the inline note without its card -> the same; **NF5** the note's
blank lines drawn as note lines -> the same.

The punctuation (P6-d, G015), 2026-09-18: Pandoc's Markdown keeps `smart`
on, so the page prints curly quotes, an apostrophe, an en dash for `--`, an
em dash for `---` and an ellipsis for `...`, and the editor drew the ASCII.
While a line is untouched its prose is now drawn as the page prints it, as
widgets over the source, which comes back under the caret; code, maths, an
address, a tag, a comment, an entity, an escape, raw TeX, an attribute, a
citation, an image and a link's destination and title are left alone. The
rules of the quotes are Pandoc's reader's, read off pandoc 3.8.3 with the
export's reader on the very texts of the cases and not supposed: a quote
opens when it follows no letter or digit and no space follows it; a `"` that
cannot open closes, open or not; a `'` that cannot open is an apostrophe, and
so is one that opens and never closes ('90s, 'tis), where a `"` that never
closes stays an opening one; a `'` closes only when no letter follows
('quoted's') and not right after its opener (''); the context runs over the
block, past line ends and code spans, a pair in a pair nests and is stepped
over whole, and an emphasis, a link's text, a span and a note are each one
inline, so a pair opened outside one does not close inside it. What is drawn
from a string takes the glyphs into the string: a table's cell, a figure's
caption (and the picture's alt, as on the page), the prose after an
equation's closer and an outline row. Measured on the bench's 22 805-line
document: a rebuild of the decorations went from a median of 94 ms to 106;
the rebuild itself is P7's. Twenty-one mutations, twenty caught: **SM1** a
quote opening after a letter -> *SP02*; **SM2** a single quote that never
closes drawn as an opening one -> *SP02*; **SM3** `--` read before `---` ->
*SP01*; **SM4** a code span read -> *SP01*; **SM5** the line under the caret
drawn too -> *SP01*; **SM6** a `'` closing before a letter -> *SP02*; **SM7**
an emphasis not one inline -> *SP02*; **SM8** `-smart` on the reader of
`bin/mdm` -> the page test (G015) of `html.test.js`; **SM9** an escape read
-> *SP03*; **SM10** a heading left out -> *SP03*; **SM11** a task's
paragraph left out -> *SP03*; **SM12** a `'` closing right after its opener
-> *SP02*; **SM13** a `"` that cannot open drawn as an opening one ->
*SP02*; **SM14** a pair not stepped over -> *SP02*; **SM15** the cells
without it -> *SP04*; **SM16** the caption -> *SP04*; **SM17** the prose
after an equation -> *SP04*; **SM18** the outline row -> *SP04*; **SM19** a
heading's text running into its attributes -> *AT01*; **SM20** a link's
title read -> not caught, and nothing to catch: the title is a group of its
own inside the link, so its quotes pair with nothing outside it, and the
widgets it would be given stand inside the link's hidden tail, which draws
none of them; it stays a leaf so that none are made; **SM21** a paragraph
left out -> *SP01*.

Differences left on the record: an image inside a table's cell keeps its alt
as written; a setext heading's attributes are still drawn as text (only an
ATX heading's are hidden, P6-b); and Pandoc reads `*b 'c* d'` as a quoted run
that swallows the emphasis closer where CommonMark, and the editor, read the
emphasis first, one of the emphasis differences that are not replicated.

The small ones of the drawing (P7: G048, G046, and two found on the way),
the same day. A processing instruction's block, `<?...?>`, is CommonMark's
HTML block 3 and Lezer's ProcessingInstructionBlock, which no place in
`main.js` named: it was drawn as prose in the text face, a mark could be
written into it, and Ctrl+Enter left it from the caret's line and not from
its end; a comment's block was drawn right and missing from the last two. One
list, `RAW_HTML`, now serves the four places that name raw HTML. The line of
one no-break space (G046) was already a paragraph since P2, and had no test:
*NB01* is it. Found on the way: the division into syllables read the source,
where `word---word` is one word the segmenter leaves whole, and the page,
which prints a dash there, divided both words (checked against the segmenter
itself: no cut in the source's reading, nine in the page's); the dashes are
blanked at their own length before the words are cut. And raw TeX, an
attribute, a citation and a footnote's label were divided as prose, which
the page does not print as the words they are written with. Eight mutations,
all caught: **RH1** the processing instruction off the list -> *HB01* and the
editing test *a comment and a processing instruction are raw HTML to the
marks and to Ctrl+Enter*; **RH2** the comment off it -> the same two; **RH3**
the list off the lines no mark belongs on -> the editing test; **RH4** the
list off what Ctrl+Enter leaves -> the same; **NB1** blank read with `\s` ->
*NB01*; **HY1** the dashes not blanked -> the look test *the words beside a
closed dash are divided as the page divides them*; **HY2** raw TeX divided ->
the same; **HY3** a citation divided -> the same. Not mutated: the list in
what the hyphenation skips among blocks, which is inert, since only a
Paragraph is ever divided and raw HTML holds none. Left on the record:
Pandoc reads the inside of a `<div>` as Markdown (`markdown_in_html_blocks`)
where the editor, with CommonMark, draws it as raw lines to the next blank
line; the case in *HB01* holds HTML alone for that reason.

The characters that draw nothing (P7, G058), the same day: a bidi override,
a zero-width space, a soft hyphen or a control character had no mark
anywhere, a line opened as source included. CodeMirror's
highlightSpecialChars marks them everywhere, the reading state too, where a
soft hyphen the author put in a word on purpose would stand as a dot in the
prose and the row would part from the page's; so the reading state draws
what the page draws, and under the caret, where a line shows its source,
each is a mark over its one character that names it in its tooltip (a control
character as its picture, the rest as a dot), in the brass the marks of a
line are drawn in. CodeMirror's own set, and the rest of the bidi embeddings
and isolates. A decision of look taken by default, the colour and the dot,
which the owner may want otherwise. Four mutations, all caught by *SC01*:
**SC1** marked in the reading state too; **SC2** the soft hyphen off the set;
**SC3** the tooltip without the name; **SC4** the mark in the ink of the
text. The editing test *Backspace and Delete beside a character that draws
nothing* pins that the keys take it as any other character; it passes with
and without the marks, CodeMirror treating a replaced character as one step
either way, and is there for what a later change to the marks might break.

The inside of a table cell (2026-09-18), found by re-probing the bench at the
close of the branch: four of the groups the branch had fixed in the prose were
still unfixed inside a cell, because `cellParts` is a second reader of the
inline tree and the fixes had gone into the first one. It now asks the same
questions: `linkTarget` and `decodeEntity` moved out of `buildDecorations` to
where both readers can call them, the cell is given the document's definitions
(`definitionsOf`), and `LINK_SKIP` learned that the `[ref]` of a full
reference is not part of the text. Five mutations against TB12 and TB12b, all caught:
**CL1** the label of a full reference back in the drawn text -> *a cell reads
its links, its entities and its pictures as the prose does*; **CL2** the
entity branch removed -> the same; **CL3** `unbracket` giving the destination
back with its angle brackets -> the same; **CL4** a cell link taking the first
URL it finds instead of its target -> the same; **CL5** the Markdown title
dropped in a cell -> the same. Then the same reading of the two readers found
three more of the branch's own inlines missing from the cell, and Pandoc was
asked what it gives for each (`<sup>1</sup>` for the note, a `span.citation`
for the citation, and an empty cell for the raw TeX, which its HTML writer
drops): five more mutations against TB12c, all caught. **CL6** the note back
to plain text -> *a note, a citation and raw TeX in a cell are drawn as the
prose draws them*; **CL7** the citation back to plain text -> the same;
**CL8** the raw TeX back to plain text -> the same; **CL9** a mark's own
class dropped when it is painted -> the same; **CL10** a mark's tooltip
dropped when it is painted -> the same. The same reading carried to the
figure: its caption was the alt as a string, where the page sets it as
inline content (`![A *fine* photo &copy; 1741]` gives `<figcaption>A
<em>fine</em> photo © 1741</figcaption>` and `alt="A fine photo © 1741"`),
so the caption is read by `cellParts` too and the alt attribute is what
`partsText` says. Four mutations: **CP1** the caption back to the alt as
written -> *I01b*; **CP2** the caption painted as flat text -> the same;
**CP3** the alt attribute given the marks back -> the same; **CP4** two
figures told apart by the words they draw and not by the alt as written ->
not caught at first, and it is a real hole: CodeMirror keeps the DOM of a
widget that says it is equal, so an emphasis deleted from the file stayed
on screen. *a caption drawn again when its marks go, though the words are
the same* (`webview-editing.test.js`) was written for it, and the mutation
is caught.

### The shortcut in the tip (2026-09-19)

Bold, Italic, Inline code and Link name the Mod- binding they share in
their tip, `Bold (Ctrl+B)`, or `Bold (⌘B)` where CodeMirror binds `Mod` to
Cmd (the same `/Mac/` test on navigator.platform), with
`aria-keyshortcuts` beside it. `open()` in `webview/helpers.js` takes a
`platform` to say what navigator.platform reads. *the bold, italic, code and
link buttons name the shortcut that does what they do*
(`webview-editing.test.js`) reads the four tips, presses the chord each one
names on a selected word against a click of the button, and on MacIntel
reads ⌘ and presses Meta+B. **KT1** the tips without the shortcut -> caught;
**KT2** the platform test answering "not a Mac" always -> caught; **KT3**
Inline code naming K -> caught.

### The search panel takes the pointer (2026-09-19)

A click on the search field (CodeMirror's panel, Ctrl+F) left the focus on
the body: `deadMargin` in `main.js` takes a press inside the view and outside
`.cm-content` as a press in the margin beside the text, and the panel is
both. What was typed went nowhere and Escape could not close the panel. The
panels are exempt now. *the search panel takes the pointer: a click on its
field types there, and Escape or its button closes it*
(`webview-editing.test.js`) clicks the field, the replace field, Replace all
and the close button, and presses Escape from the field. **SP1** the
`.cm-panels` exemption removed -> caught, the field does not take the focus.

### The search as a row of the toolbar (2026-09-19)

The owner chose variant C of `design-search.html`: the search is a row
under the toolbar, as the player's is, built by `searchPanel` in `main.js`
(CodeMirror's `createPanel`, `top: true`) on the query and the commands of
`@codemirror/search`, which the bundle now exports (`SearchQuery`,
`getSearchQuery`, `setSearchQuery`, `searchPanelOpen`, `findNext`,
`findPrevious`, `selectMatches`, `replaceNext`, `replaceAll`; the bundle was
rebuilt byte for byte first to check the build still reproduces). The
controls keep CodeMirror's names, so the two tests above only moved from
`.cm-search` to `.mdm-search`. *the search is a row under the toolbar that
counts its matches and keeps its options on the disc*
(`webview-editing.test.js`) reads where the row stands, that every control
is a brass toolbar button, the count through Enter, Shift+Enter, the case
and whole-word options and a search with no match. **SR1** the field not
focused on mount -> caught (the first version had exactly this, and typing
went into the document); **SR2** the panel at the foot -> caught, no top
row; **SR3** the options never on the disc -> caught; **SR4** the count
never finding its place -> caught.

The theme menu then opened under the search row: CodeMirror's base theme
stacks `.cm-panels` at 300, over the toolbar (2) that holds the drop-downs.
The row is at 1, over the scroller's own layer at 0. *a drop-down of the
toolbar opens over the search row, and the text scrolls under it* reads
`elementFromPoint` where the menu and the row overlap and over text scrolled
under the row. **SR5** the rule removed -> caught, the field over the menu;
**SR6** the row at -1 -> caught, the text over the row.
The focused field's ring went from 2px (its border and a 1px box-shadow)
to its 1px border alone, at the owner's asking; the same test reads the
width, the brass and that there is no shadow. **SR7** the shadow back ->
caught.

### The code block button and Ctrl+Shift+8 (2026-09-19)

The block twin of inline code, beside it in the bar, drawn with the glyph
the owner picked in `design-code-block.html` (B, the chevrons between two
rules), and `Ctrl+Shift+8` (`⌥⌘8` on a Mac), Notion's key for a code block,
which the owner asked for as "a standard key, if there is one" (Typora's
`Ctrl+Shift+K` is Delete Line here; D19 in `vscode-mdm/docs/cm6-migration.md`).
`toggleCodeBlock` in `main.js`: on a blank line, an empty block with the
caret right after the opening backticks; with a bare caret in text, the
block under the paragraph or block it stands in; a selection into the block,
with a block of one piece it cuts into taken whole and a longer fence over a
fence among its lines; inside a block, the fences off, and an empty one
leaves one blank line. A blank line parts the new block from text beside it,
except inside a list; the marks of a quote and of an item go on its lines,
and in a task it stands at the item's column and not past the box, where
Pandoc 3.8.3 reads a fence as paragraph text. Enter in a fence inside a task
owed the same column and set the new line four spaces past the box:
`continueMarkup` takes `blockPrefix` now.

The first version merged the blank lines around an empty block into it on
the way out, so that a second press gave back what the first was pressed on.
It cannot: a blank line under a paragraph and two blank lines under it come
out as the same block, and in the second case the merge glued the paragraph
below to the one above. An empty block leaves one blank line, and nothing
around it goes.

In `webview-editing.test.js`: *the code block button opens an empty block
with the caret after its backticks, and a second press leaves a blank line*;
*with a bare caret in text the code block opens under the paragraph,
heading, table or equation, never through it*; *the code block button puts
the selected lines in a block, under a longer fence when a fence is among
them, and takes a block it cuts into whole*; *inside a fenced block the code
block button takes the fences off and leaves the lines, in a quote and in a
list as well*; *the code block carries the marks of the quote or the item it
opens in, and Enter after the language goes on inside it*; *Enter in a fence
inside a task keeps to the item's column, not past its box (G071)*;
*Ctrl+Shift+8 does what the code block button does, the tip names it, and
abc typed after the backticks makes a score*; and `code-block` in `BAR`.

### Strikethrough, task list and quote buttons (2026-09-19)

G085's missing buttons, with no key (D19 in `vscode-mdm/docs/cm6-migration.md`;
glyphs and the key schemes in `design-markdown-buttons.html`, variant A of
each applied as my pick). Strikethrough is `toggleInline("~~")`, bold's rules
with `Strikethrough`/`StrikethroughMark`. `toggleTask` boxes the item a line
is, numbered ones too (Pandoc 3.8.3 ticks both), makes a bulleted task of a
line with none and takes only the box off. `toggleQuote` quotes the whole of
every block the selection touches (`blockOfLine`, read from the root down,
because walked up from inside, the header's mounted YAML tree stopped the
walk at a `Document` of its own and the header was quoted), the blank lines
between them with a bare `>`, not the header, not a line a triple click's
selection only reaches the head of; and one level off when every line is
quoted, a lazy line counted as quoted. On an empty line the four line
buttons (the two lists as well, which did nothing there) write their marker
for the caret, parted by a blank line from a paragraph above (Pandoc reads
`Text.` over `- a` as `Text. - a`), except an item under an item.

In `webview-editing.test.js`: *the strikethrough button writes Pandoc's ~~
and takes it off by the same rules as bold*; *the task button puts a box
behind the marker a line has, makes a bulleted task of a line with none, and
takes only the box off*; *the quote button quotes the whole of the blocks it
touches and takes a quote off again*; *on an empty line the line buttons
start a line of their kind, parted from a paragraph above as Pandoc needs*;
and `strikethrough`, `task-list`, `quote` in `BAR`. Round, each against those
four and the list test, the file restored and its hash checked after:
**MB1** no `~~` in `INLINE_KIND`, **MB2** the strike marks looked up as
`EmphasisMark`, **MB3** a boxed line boxed again, **MB4** the task off takes
the marker, **MB5** the block is the innermost node, **MB6** a triple click
takes the next line, **MB7** the header quoted, **MB8** a blank line quoted
as `> `, **MB9** the `>` behind an item's marker not found, **MB10** never
parted from a paragraph, **MB11** an item parted from an item, **MB12** the
empty line ignored, **MB13** a lazy line not counted as quoted, **MB14** an
empty line in a fence started, **MB15** the caret left before the marker:
all 15 caught.

The owner changed the task glyph the same day: the first row a check mark
alone and no box, since a tick cut out of a box could not be seen at 15px.

Not answered: the list buttons on a line WITH text right under a paragraph
(`Text.` over `Flute`) still write `- Flute` glued to it, which the editor
draws as a list and Pandoc reads as `Text. - Flute`; that was so before
this change. Not seen in a real VS Code window.

### The heading button as a menu (2026-09-19)

At the owner's request the heading button opens a menu, a paragraph and the
six levels, instead of stepping each line one level up. `setHeading(level)`
keeps `cycleHeading`'s rules (the hashes after a quote's `>` and in place of
a list marker, a setext heading made ATX) and sets the level over any a line
had; a paragraph takes the hashes or the underline off and leaves a list
item an item. `headingMenuItems` ticks the level of the caret's line, read
at each opening (`build`). The panel of a menu whose button acts on the
caret carries `mdm-btn--caret`, so a press on a row does not put the open
block away first: inline maths is one, and the heading went to the line
below it.

In `webview-editing.test.js`, replacing *the heading button cycles the level
of every selected line* and the G065 test of the cycle: *the heading menu
lists the six levels, the level of the caret's line ticked, and no
paragraph* (named so since the row went, below);
*a heading level from the menu goes after a quote's mark, in place of a list
marker, over the level a line had, and makes ATX of a setext heading
(G065)*; *a heading level from the menu lands on the line the caret was in,
inside inline maths*. Round: **MH1** the panel not exempt, **MH2** hashes
added over hashes, **MH3** the setext underline kept, **MH4** a paragraph
takes the list marker, **MH5** the level never read, **MH6** the menu filled
once, **MH7** the focus not given back to the text (not caught at first;
`headingOn` now asserts the focus, and then caught), **MH8** blank lines
made headings: all 8 caught.

The Paragraph row taken off at the owner's word, the same day: the ticked
level picked again makes every selected line a paragraph, as a list button
pressed twice takes its list off. The tests ask it of `## Title` and of a
setext heading with level 2, and of `## Title` over `- Violin`, which keeps
its item; the empty-line case of a paragraph went, since no row asks it
now. **MH9** the ticked level set again instead of taken off -> caught,
`## Title` left as it was. The icon went with the row: the H with a 1
named the level the button used to make, so it is two H now, one the height
of the other's cap (`design-heading-icon.html`, A of five, the owner's pick
over the H alone, the H with an outline, the `#` and the H with a menu
caret). No test reads the glyph; the toolbar tests that draw every button in
the chrome's brass pass with it.

### Keys that stop at the text, and a heading on an empty line (2026-09-19)

The owner saw Ctrl+B set bold and hide the Explorer. VS Code's webview host
page (1.133.0) listens for keydown on the page's window, bubble phase, with
no look at defaultPrevented, and posts every key to the workbench. The five
formatting bindings now carry CodeMirror's `stopPropagation`; Ctrl+S and
Ctrl+Z do not, since VS Code saves and undoes from that message. *the
formatting keys stop at the text, and reach VS Code from anywhere else*
stands a window keydown listener in for the host's. The owner also found
that a heading from the menu did nothing on an empty line, where the four
line buttons write their marker; now it writes the hashes, parted from a
paragraph or an item above (Pandoc 3.8.3: `Text.` over `## H` is `Text. ##
H`, and so is an item's text): *a heading level from the menu on an empty
line writes the hashes to type after, parted from a paragraph or an item
above*. Round: **MK1** Ctrl+B, **MK2** Ctrl+K, **MK3** Ctrl+Shift+8 not
stopped, **MH9** the empty line skipped, **MH10** a heading under an item
not parted: all 5 caught. Both seen in a real VS Code through the
demo-clips rig (a probe in the scratchpad, not kept): Ctrl+B in the text
bold with the side bar shut, and in the margin the side bar opened; the
menu's Heading 2 on an empty line under a paragraph left the blank line and
wrote `## ` on the next. Trap met on the way: the rig's eased pointer
crossed the editor tab and VS Code's own hover (monaco-hover) came down
over the toolbar and took the click; `warp` straight to the button does
not raise it.

### The rest of the block keys, and a bar that stops taking the focus (2026-09-19)

The owner's call after the schemes were weighed (D19): the digit is the
heading's level and a letter names the block that has none, all on the code
block's second modifier. `Ctrl+Shift+0` to `6` and `Ctrl+Shift+U`, `O`, `T`,
`Q`, and `Ctrl+Shift+C` for the code block; `Cmd+Option` on a Mac, where the
system keeps `Cmd+Shift+3`, `4` and `5` for screenshots and `Cmd+Shift+Q`
logs the account out. Strikethrough keeps none. The Paragraph row is back in
the heading menu with them, at the owner's word: at the keyboard there is no
tick to read, so a hand that cannot see the level needs one key that says
paragraph whatever the line was. Every row and every button names its key,
written once (`shortcutLabel`), and the toggle a row and a key share is
written once too (`applyHeading`).

What was read before binding any of it, in VS Code 1.133.0's
`workbench.desktop.main.js` and in the vendored CodeMirror: of
`Ctrl+Shift+0` to `9` the workbench binds only 1 (replace, inside the search
view) and 5 (split, with the terminal focused); of the letters,
`Ctrl+Shift+T` is Reopen Closed Editor and `Ctrl+Shift+O` is Go to Symbol in
Editor, both of which a .mdm gives up only while the caret is in the text;
no built-in extension binds `ctrl+shift+<digit>`. `Ctrl+Shift+L` was left
alone because it is `selectSelectionMatches` in CodeMirror's own search
keymap, which *Ctrl+D selects the next occurrence, Ctrl+Shift+L all of them*
holds.

Tests: *the heading menu lists Paragraph and the six levels, the caret's
line ticked, each naming its key*; *Ctrl+Shift+<digit> sets the heading of
that level, the level a line has takes it off, and 0 is the paragraph*;
*Ctrl+Shift+U, O, T and Q do what their buttons do, and every tip names its
key*; the block keys added to *the formatting keys stop at the text, and
reach VS Code from anywhere else*; and, in `webview-look.test.js`, *the keys
of the heading menu make one quiet column at the right edge*.

A trap that cost the first round: `page.keyboard.press("u")` with Shift held
sends `key: "u"`, and a browser sends `"U"`. CodeMirror resolves those
through different branches of its keymap (`runHandlers` tries the binding
without Shift first, then falls back to the key's base name by keyCode), and
with Puppeteer's `"u"` the first branch ran `Ctrl+U`, which is
`undoSelection` in `historyKeymap`, so the bullets never saw the key and the
test failed against a binding that works. The block keys are pressed through
CDP now (`blockChord`), with the character the layout writes over the key,
and the layout is the owner's Spanish one, where none of the digits is the
character it is named after (`Ctrl+Shift+2` arrives as `"`, and
`Ctrl+Shift+8` did as `(` while the code block was still on it). That was
also the first time the code block's key had been pressed on a Spanish board
here, and it worked; inside a real VS Code window it still has not been.

Round: **BK1** the menu loses its Paragraph row, **BK2** a menu row stops
naming its key, **BK3** the tick never lands on Paragraph, **BK4** a heading
key stops toggling back to a paragraph, **BK5** `Ctrl+Shift+0` gone, **BK6**
the sixth level has no key, **BK7** the bullets moved to L over
selectSelectionMatches, **BK8** the task and quote keys swapped, **BK9** a
block key without `stopPropagation`, **BK10** the Mac row on Cmd+Shift,
**BK11** the list button stops naming its key, **BK12** the key column not
pushed to the panel's edge: all 12 caught.

Then the code block off `Ctrl+Shift+8` and onto `Ctrl+Shift+C`, at the
owner's word and for the symmetry: every digit a heading level, every block
without one a letter, and no exception left. Not E, its inline twin's
letter, which is Show Explorer in VS Code, against the external terminal C
takes; it never shipped on the digit, so nothing had to be migrated. The
button moved with the key, out of the marks and to the head of the blocks,
so inline code and the code block stand either side of the toolbar's
separator, which is the same cut the keys make. *Ctrl+Shift+8 does what the
code block button does* is now *Ctrl+Shift+C ...* and presses it through
`blockChord`; *the toolbar is grouped by what a button is about* holds the
order. Round: **BK14** the key back on the digit, **BK15** the button still
naming the digit, **BK16** the two code buttons parted again: all 3
caught.

The owner then saw the `##` of a heading go and come back when he pressed
the heading button. Measured in the harness with the button held down: the
focus was the button's, `view.hasFocus` false, and the line drawn as a
heading with its source away, since an unfocused document draws itself with
nobody in it. It was every button of the bar and not that menu, and the
`view.focus()` each handler already called was putting it back after the
fact. Cured at the press: `mousedown` on a chrome button is prevented, so
the focus never leaves the text. Buttons only, not the player's progress bar
(a div abcjs drags by hand) nor the panels CodeMirror puts inside the view
(the search field is there to be typed in); the rail does it another way
already, with spans that cannot take the focus at all. Test: *a button held
down leaves the caret's line showing its source, and the focus in the text*,
which holds the button down, reads the line, and takes the pointer off the
button before letting go so no press is made. **BK13** the guard removed ->
caught.

### Underline and highlight, Pandoc's two bracketed spans (2026-09-19)

The owner picked the two glyphs off `design-annotation-icons.html` (A, the U
over its rule; C, the marker nib) and asked for the buttons. What they write
is `[word]{.underline}` and `[word]{.mark}`, which the Pandoc 3.8.3 that the
Quarto here ships turns into `<u>` and `<mark>`; `==word==` comes out as the
four equals signs, so GitHub's spelling is nobody's here. Checked by hand
before the code went in, not taken from the sheet:
`echo 'a [x]{.underline} b and a [y]{.mark} c and ==z==' | pandoc -f markdown
-t html` gives `a <u>x</u> b and a <mark>y</mark> c and ==z==`.

The edit is not a pair of marks, so `toggleSpan` is its own shape: a class
goes on or off the attribute of the span the range is already in, which
makes the two buttons stack into `{.mark .underline}` instead of nesting a
span in a span, and the span itself comes off with the last of its classes.
Elsewhere the range is wrapped, the word at a bare caret as the marks do,
each line's own text across a selection that spans lines, an empty span to
type into where there is no word, and nothing at all where no mark belongs.

One of the two was a difference and not a gap, which is why the button came
with a fix: the page underlined `[word]{.underline}` and the editor drew it
as plain text. One class in the `Span` branch and one rule in style.css;
nothing in either copy of mdm-look.css, since the page's line is the one the
browser gives `<u>` and the same declaration draws the same line here.

Tests: *the underline and highlight buttons write Pandoc's bracketed spans,
and take them off again*; *the two spans stack on one attribute instead of
nesting, and either class comes off it whole*; AT01 in
`webview-markdown.test.js` grew the span and now reads the drawn
`text-decoration`, not just the class; and the bar's order holds the two new
buttons. Round: **SP1** the span nested instead of stacked, **SP2** the
class taken off with the space against the brace, **SP3** the last class
leaving an empty span behind, **SP4** a selection across lines wrapped
whole, **SP5** the highlight button writing the underline's class, **SP6**
the editor not drawing the underline, **SP7** the rule dropped from the
stylesheet, **SP8** the buttons off the bar: all 8 caught.

Not done here, and left on the record by the sheet: superscript, subscript,
small caps, and the Insert menu for equation, table, picture, footnote and
rule. The two spans have no key; the letter row of D19 is spent.

### The underline button off again, and the list glyphs made one family (2026-09-19, later)

Two decisions of the owner's, the same day as the two sections above.

**The underline button is gone; what it wrote is still read.** The reasons
are his, and they are not "it is not Markdown", which would take half the
bar with it (the strikethrough, the task list, the tables, the footnotes,
the maths and the score are all extensions of one dialect or another). They
are that a bracketed span leaks its own class into any reader that is not
Pandoc, where `[word]{.underline}` shows as those characters while `2^nd^`
at least leaves the word readable, and that an underline is the typewriter's
italic, which a document set in Latin Modern through TeX has no use for. The
highlight pays the same toll for something the other marks cannot do, so it
stays. `.mdm-underline`, the `Span` branch and AT01 all stay too: the page
underlines the span whether or not a button writes it, and that difference
is not to be reopened.

The two tests of the pair became one button's: *the highlight button writes
Pandoc's bracketed span, and takes it off again*, and *a class joins the
span it finds instead of nesting, and the last one off takes the span*,
which now proves the general shape of `toggleSpan` against spans written by
hand with both classes rather than by pressing two buttons.

**The three list buttons are one drawing.** The bulleted and the numbered
glyphs had three thin rows where the task one had two thick ones, so at the
15px the toolbar draws they did not read as a family. All three now carry
the task glyph's own two bar paths, at its rows of 4 and 12, with a marker
of the bars' weight in the column its check and box stand in: a disc 3.8
across, and the figures 1 and 2 of DejaVu Sans Bold at 5.8 units. The 5.8 is
measured and not chosen by eye: the stem of that font's 1 is 364/1493 of the
glyph's own height, so at 5.8 it draws 1.41 units, the bars' 1.4. The
figures hang to the right, as the numbers of a list hang in the margin the
editor draws them in. The two buttons are *Unordered list* and *Ordered
list* now, the words the format uses, and the id of the first went with the
name (`list` -> `unordered-list`, named call site by call site in the
suites and not by a blanket replace, which is how a fixture that looked
like this one has been broken before).

Test: *the three list glyphs are one drawing: the task bars, and a marker of
their weight*, in `webview-look.test.js` beside the glyph tests. Round:
**LG1** the bullet at r 1.6 instead of 1.9, **LG2** a bar of its own instead
of the task glyph's path, **LG3** the figures grown to 6.6 so the stem
outweighs the bar, **LG4** the tip back to "Bulleted list", **LG5** the id
back to `list`, **LG6** an underline button put back on the bar: all 6
caught, and the file restored after each.

### Small caps, the raised pair, and the Insert menu (2026-09-19, later)

The rest of `design-annotation-icons.html`, which the entry above left on
the record. The owner picked the glyphs (the raised figure after a word for
the footnote, two columns and three rows for the table, the frame with the
sun and the hill for the picture; the sheet's own pick, A, for the letter
and its figure, the two T, the radical and the rule between two lines), and
asked for the buttons and what they do. The set is the sheet's: small caps,
superscript and subscript as buttons in the word group, and the other six
behind one Insert menu at the end of the block group, because six more
buttons would have made the bar a second row and the row under it is the
player's.

Measured before the code went in, on the pandoc 3.8.3 the Quarto here
ships, since three of these could not be written from the syntax alone:

- `a ~~~x~~~ b` gives `a <sub>x</sub> b`. Three tildes are a subscript and
  the strikeout is gone, so a subscript asked for over the whole text of a
  strikethrough cannot be written at all; over part of it, `c ~~H~2~O~~ d`
  gives `<del>H<sub>2</sub>O</del>`, so that one is written. The button
  leaves the run alone in the first case and says nothing, which is the one
  gesture on the bar that can do nothing on purpose.
- `g x^a b^ h` gives `g x^a b^ h` and `e x^a\ b^ f` gives `e x<sup>a b</sup>
  f`. A bare space breaks both marks, so a space inside one is written
  escaped, and Pandoc sets it as a no-break space.
- `a x^[b]^ c` gives an inline footnote and a stray caret; `a x^\[b]^ c`
  gives `a x<sup>[b]</sup> c`. So a bracket at the head of the content is
  escaped too, and the editor's own parser agrees with both forms (`^\[`
  cannot open a `FootnoteInline`).

Three things in the code are worth knowing:

- `$`, `^` and `~` went into `INLINE_KIND` as marks like `**`, so the
  superscript, the subscript and the Equation row are `toggleInline` and
  come off at a second press for free. What that cost was ordering:
  `ChangeSet.of` composes a change that starts before the one before it and
  then reads the later one's positions in the document the earlier one has
  already changed, so `wrapPart` now collects the changes inside the part,
  sorts them and writes them between the two marks. Out of order, an escape
  beside an inserted mark lands a character out of place.
- The empty block `toggleCodeBlock` writes with a bare caret is now three
  functions of its own (`blockOn`, `blockAfter`, `blockEnd`), which is what
  the equation block, the table and the rule are written with: the same
  reading of the paragraph, score or table the caret is in, the same quote
  marks and item indentation, the same blank line. The code block tests
  hold that road as they did.
- A footnote's note goes at the end of the document because Pandoc reads a
  definition at the top level alone (`parseFootnoteDef`, `cx.depth == 1`),
  so none may be written inside the quote or the item the caret stands in.
  The reference goes after the words the caret is in, which is where the
  glyph shows it, and the caret is left in the note.

Tests: *the superscript and subscript buttons write Pandoc's marks, and
escape what cannot stand inside them*; *the subscript button never writes
the strikethrough's pair of tildes*; *the small caps button writes Pandoc's
span and joins the one it finds*; *the Insert menu lists the six
annotations, each with its glyph*; *the Equation row wraps the selection in
dollars and takes them off again*; *the Equation block, Table and Horizontal
rule rows write a block of their own where a block belongs*; *the Picture
row writes an image and puts a file name where the address goes*; *the
Footnote row numbers the reference and opens its note at the end of the
document*, all in `webview-editing.test.js`, where the bar's order holds the
four new buttons; and *the rows of the Insert menu draw their glyph in the
bar's brass, at the bar's size* in `webview-look.test.js`.

Round: **AN1** the escapes dropped from a superscript's content, **AN2** the
tilde guard dropped, so a subscript is written over a strikethrough, **AN3**
the escapes left behind when the marks come off, **AN4** the small caps
button writing the highlight's class, **AN5** the block written through the
paragraph instead of under it, **AN6** the footnote always numbered 1,
**AN7** the picture written as a link, **AN8** a row drawing another row's
glyph, **AN9** the row glyphs left off the brass, **AN10** the Insert button
off the bar: all 10 caught, and the file restored after each.

**Same day, the bar in two rows.** The owner asked to see it: the six of
the menu spelled out as buttons closing the first row after the quote, and
the second row opening under the outline button with the multicursor, which
is where the switches over the whole document begin. The break is one child
of the bar asking for the whole width (`rowBreak`, `.mdm-toolbar__break`),
which is how the player's row has always taken a line of its own inside a
toolbar that wraps; it draws nothing and takes no height, so the two rows
stand exactly a row apart. The Insert menu and its glyph went with it, the
`.mdm-menu__icon` rule with them, and the roster test now reads `/` where
the row ends. Test: *the bar stands in two rows, the first closing on the
rule and the second opening under the outline*, measured at 900 and 1400 px
so the break is the bar's own and not the pane's wrap. Round: **AN11** the
break back to a separator, **AN12** the break without its width: both
caught, and **AN13** the separator before the six dropped, caught by the
roster. The test that read the glyph of a menu row is gone with the menu;
the six are buttons, so *every button draws a glyph of its own* covers them.
Shown both ways and settled the same day: the six carry a separator of their
own after the quote, the owner's call on the two pictures. The buttons
before it change what a line already is and these put something new in the
document, so the roster reads `quote`, `|`, then the six.

Left on the record:

- None of the four has a key, as the two spans before them have none: the
  letter row of D19 is spent, and the pair with some claim to being standard
  (Google Docs' `Ctrl+.` and `Ctrl+,`, Word's `Ctrl+Shift+=` and `Ctrl+=`)
  is remembered and not checked against a running copy.
- The table is written with its cells empty, the caret in the first of the
  head. Nothing moves the caret from cell to cell yet (`Tab` indents), so a
  reader fills it by clicking. A table left empty is next to nothing on
  screen: with the caret away, the two 2-column rows of the drawing measure
  a few pixels and read as two hairlines (seen in the harness), where the
  page would draw Quarto's own row rules across the measure. Nothing
  invented goes into the reader's document, so the cells stay empty; if the
  empty state is to look like a table, it is the drawing that has to say so,
  and that is a look round of its own.
- The subscript over the whole of a strikethrough does nothing and says
  nothing. The editor has no way to tell a reader that what was asked for
  cannot be written; the feedback it has is scoped to a block.
- The escaped space the pair writes is a no-break space on the page and an
  ordinary space in the editor: the editor hides the backslash of an escape
  while the node is untouched (G008) and draws the character behind it as
  it stands, so `x^a\ b^` reads as a raised "a b" on both surfaces, but a
  line could break inside that superscript here and cannot there. Seen in
  the code, not measured on a line long enough to break.
- The footnote's reference and the picture are written wherever the caret
  is, inside a fence included, because both are the link gesture's road
  (`Ctrl+K` has always done that) where the marks of the bar refuse on a
  line no mark belongs on. Nothing tests either case.
- The score block still has no insert gesture, and is left out of the menu
  on purpose: the quarter note is spent twice on the bar already, so a
  ```abc row wants a round of its own.

### The highlight's colour, the small caps glyph, the quote glyph, the order of the marks (2026-09-19, later still)

Four of the owner's calls in one pass.

**The highlight is the document's colour now.** It was the browser's
`Mark`, which Chrome draws as pure `#ffff00` with black letters in both
colour schemes (measured), and `lua-ul` draws Pandoc's `\hl` in its own
`yellow`, so the three surfaces agreed on a colour nobody had chosen. The
owner picked B on `design-highlight-colour.html`, butter over the ground the
document has: 34% of `#f2c94c` on a light side, 26% on the dark, where the
same strength glares. The words keep the document's ink.

The measure that sheet is judged by is a distance in CIE Lab and not the
WCAG ratio, and that is worth keeping: for a yellow the ratio says nothing,
since `#ffff00` scores 1.04:1 against the light page, lower than any
candidate, while sitting dE 97 away from it. The butter is dE 23.

One value, three files, because the editor is the reference: `--mdm-highlight`
in style.css, the same token written by `look_css` for the page (with a
`mark` rule in both copies of mdm-look.css), and `mdmhighlight` in the
preamble `look_tex` writes. The paper had a trap worth writing down: Quarto's
template loads `lua-ul` only when the document carries a strikeout, an
underline or a highlight (`$if(strikeout)$` in `pandoc.tex`), so the setter
is asked for with `\@ifundefined` and not assumed, and it wants a colour with
a name, since `\LuaULSetHighLightColor[HTML]{F2C94C}` stops the render with
"Undefined color".

**The small caps glyph stacks its pair.** The owner read the two T of two
sizes as the heading button, which is two H of two sizes; the shape is the
same and no letter escapes it (the two A and the two K were drawn and are
that shape again). A baseline rule under the pair was tried first and read as
the heading button too, which is the lesson: the rhythm is the thing and
furniture does not change it. So the pair is stacked now, one letter over the
other, an arrangement nothing else on the bar uses, and the test holds the
arrangement on both buttons: small caps stacked, the heading in a row,
neither drifting into the other's. Also drawn and not taken
(`design-smallcaps-icon.html`): a cap crossed by the small-cap line, which
reads as a strikethrough; the word abstracted as one tall stroke and three
short ones, which reads as a bar chart; and `aA`, the lowercase and the small
cap it becomes, the most legible of the lot and side by side again. The cost
of the stack is honest and worth knowing: two letters in half the height each
make the lightest glyph in that row.

**The quote glyph joins the three beside it**: the task glyph's two bars at
its rows, with the quote's rule as the marker in the column the check and the
box stand in. One rule and not one a row, which is the owner's word: a quote's
bar is a single line down the whole of it.

**The word group is in the order of the marks**: bold, italic, strikethrough,
then the superscript and subscript, then small caps and the highlight. The
pairs of punctuation together, the two bracketed spans after them.

Tests: *a highlight is the document's own wash, weaker on the dark side, and
never black on the words* and *the small caps glyph stacks its pair, where the
heading glyph sets its two in a row* in `webview-look.test.js`; the block-glyph
test grew the quote and is now *the four block glyphs are one drawing*; *the
page marks a word in the same colour the editor marks it* in `html.test.js`,
which fills each surface's wash over its own ground on a canvas and compares
the pixel, since both draw an alpha and neither a flat colour; and *the look
rides on every PDF render* grew the three lines of the preamble. Round:
**HL1** the editor back on `Mark`, **HL2** the dark side at the light
strength, **HL3** the page's `mark` rule dropped, **HL4** `look_css` not
writing the token, **HL5** the setter dropped from the preamble, **HL6** the
setter handed the colour in the form that fails, **SC1** the small caps
glyph set back in a row (against the rule it had then; the round was re-run
against the stack as **SC2** the pair back in a row and **SC3** the stack
with the small cap on top), **Q1** the quote's rule cut into one a row, **Q2** the quote drawing
bars of its own, **OR1** the word group back to its old order: all caught, 12 with the two
the stack added.

One restore was refused and done by hand: another session wrote `mdm.lua`
while HL4's test was running, so the guard saw the file change under the
mutation and left it alone rather than clobber the other edit. The line went
back on the content that was then on disk. The guard earned its keep; a
mutation script that touches a shared tree wants one.

### The small caps glyph again, by its letters (2026-09-19, after all the above)

The stack of two T lasted a day. Asked for more of them, six further
arrangements went on `design/design-smallcaps-icon-2.html` and the owner took
G off the first sheet instead: `aA`, a lowercase a and the small cap it
becomes, which is what the button does to a selection. So the pair is back in
a row, the heading button's arrangement, and the thing that keeps the two
apart is no longer the arrangement but the letters: the heading is one shape
at two heights, small caps is two shapes at one, 6.93 of the 16 box each,
because a small cap IS a capital at the x-height.

Placement was decided with a measurement and not by eye
(`design/design-smallcaps-placement.html`): as drawn on the round 1 sheet the
pair sat low in its square and 0.08 over the right edge, so it is grown 5%,
which is as large as a pair this wide goes, and sat on y 13.6, which is the
baseline the H, the B and the I stand on. `the small caps glyph sets two
shapes at one height, where the heading glyph sets one shape at two` in
`webview-look.test.js` replaces the test that held the stack, and holds the
placement too. Three mutations, all caught:

- **M1** `main.js`, the stacked pair of T back in `SMALLCAPS_ICON`: "small
  caps is not a row", with the two boxes printed.
- **M2** `main.js`, the glyph lifted 1.5 off the baseline by a group
  transform: "the small caps pair is off the heading's baseline", 12.1
  against 13.5.
- **M3** `main.js`, the small cap squashed to 72%: "the small caps pair is
  not at one height", 6.93 against 4.99.

M2 is the one worth keeping. It passed on the first attempt, because the test
read `el.getBBox()`, which measures a path in its own coordinates: a
`transform` on the glyph or on a group inside it moves the drawing and leaves
the numbers alone, so the test would have signed off an icon visibly floating
off the row. The read goes through `getScreenCTM()` now, from the path's
space into the 16x16 the viewBox sets, and M2 fails as it should. Any other
test that measures an icon by `getBBox()` has the same hole.

### The bullets, the numbers and the quote give their keys back (2026-09-19, after the small caps round)

`Ctrl+Shift+U`, `O` and `Q` lasted a day. The owner took them off, and the
reason is his: `- `, `1. ` and `> ` are so little to type at the head of a
line that the chord buys nothing. What raised it is that `Ctrl+Shift+U`
opened a `U+` prompt on his own desktop instead of the bullets, which is
fcitx5's unicode addon: `libunicode.so` carries `Control+Shift+U` as the
default of its "Type unicode in Hex number", beside `Control+Alt+Shift+U`
for the search by character name, and nothing overrides either in
`~/.config/fcitx5/conf/`. That is the risk Pending 4 was holding, settled by
removal and not by another letter.

Read in VS Code 1.133.0's `workbench.desktop.main.js` on the way, since a
key given back goes wherever the workbench sends it: `Ctrl+Shift+U` (3123)
is Toggle Output on the other platforms and a `linux` override moves it
there to the chord `Ctrl+K Ctrl+H`, so on Linux the chord is the desktop's
and nobody else's; `Ctrl+Shift+Q` (3119) is bound nowhere; `Ctrl+Shift+O`
(3117) is Go to Symbol in Editor, which a custom editor has none of.
`Ctrl+Shift+C`, `Ctrl+Shift+T` and the seven digits stay.

The three buttons name no key now, in the tip and in `aria-keyshortcuts`
both: a tip that names a key the editor no longer answers is a tip that
lies. *Ctrl+Shift+U, O, T and Q do what their buttons do, and every tip
names its key* becomes *Ctrl+Shift+T does what its button does, and the
lists and the quote name no key*, which presses the three to prove they do
nothing and clicks all four buttons to prove the gestures are whole; and
*the formatting keys stop at the text, and reach VS Code from anywhere
else* carries the other half, that a chord the page does not bind is heard
by the window listener standing in for the webview host. Round, all in
`main.js`:

- **BK1** `Mod-Shift-u` bound again in the keymap: both tests, the bullets
  written where the text was to be left alone, and `Shift+KeyU` never
  reaching the listener.
- **BK2** the ordered-list button given its `key: "O"` back: the tips,
  "Ordered list (Ctrl+Shift+O)" against "Ordered list".
- **BK3** `Mod-Shift-q` bound again: the keys that reach VS Code, with
  `Shift+KeyQ` missing from what was heard.

All 3 caught, and the file restored after each.

## Pending

1. A long line of code is whole on both surfaces and each of them now
   scrolls the block it is written in, the page 91 px of it and the editor
   116 at a 600 px window (the 25 between them are the card's own padding).
   The PDF is the third road and is still unmeasured: what `listings` does
   with a line too long for the measure has not been looked at.
2. `h.errors` is asserted empty in many tests but not all; moving it to the
   helper's `close()` would cover the rest for free.
3. Images: how a path resolves against the document's folder, the root and
   a `file://` URL, the late measure and the figure's measures against the
   page are tested; a picture that fails to load (the `error` listener that
   asks for the measure again, and the broken-image glyph the row keeps)
   and a figure inside a list item or a quote (drawn through `framed`, like
   a table) are not.
4. The keyboard path inside a real VS Code window (the webview host replays
   the workbench `undo` into the page as `execCommand("undo")`, which the
   editor now ignores; copy, paste and select-all replayed the same way) is
   covered in Chrome by emulating the replay, not in VS Code itself. The
   workbench's own undo of the text model (see "Ctrl+Z answered twice") is
   inferred from a report and emulated the same way. If it is what happens,
   Ctrl+Z after the header button or the language the hyphenation menu writes
   may still take them off inside VS Code, whatever *Ctrl+Z leaves what the
   host wrote in place* says: that test holds CodeMirror's history only. Not
   looked at in a real window. The block keys are pressed on the owner's
   Spanish layout in the harness now (`blockChord`, through CDP) and not in
   a real window either. The one the desktop was known to take is gone: the
   bullets, the numbers and the quote have no key at all since
   `Ctrl+Shift+U` opened fcitx5's `U+` prompt on his machine (see the
   section on it), so what is left to press on his own keyboard is
   `Ctrl+Shift+0` to `6`, `C` and `T`.
5. The three webview files share `webview/helpers.js`; a cold-start flake
   was seen once (the first `open()` of a run timing out on its three SVGs)
   and not reproduced. A second flake, *the caret keeps its place in the
   line while the outline opens and shuts*, went red twice on 2026-09-19
   and green twice after, same code: one sampled frame had the caret 126 px
   (the panel's own width) off its line and the rest were right. Both reds
   were measured with a second Chrome suite running beside it, so it reads
   as the frame sampling losing a race under load and not as the caret
   staying behind, which is what the test was written for. Worth knowing
   before it is read as a regression: run it alone.
6. The audio export. The toolbar's Audio branch is written and covered, the
   shape of its menu included; what is left here is what no test holds. MP3
   is put off, with the reason beside `AUDIO_FORMATS` in `main.js`. The host's table of 129 General MIDI instrument names was read
   off the vendored abcjs and is not pinned by a test (parsing the minified
   bundle for it would break on the next bump); only `program 40 -> violin` is
   held, by the message a skipped score gives. EBUSY is injected in the host
   tests, since Linux will not produce it on a rename over an open file, so the
   Windows behaviour behind that message is reasoned and not measured. And
   nothing of this has been seen in a real VS Code window yet.
7. The score's face. Four things are measured and not tested. (a) The three
   waits for the face, in `main.js`, `resources/mdm.js` and `mdm.lua`, are
   each unobservable while the metric overrides hold, as the eighth mutation
   of *The words on a staff in the document's face* records. (b) Two pixels
   of the engraving cannot be had at all, and which two is measured and
   written down in *The chord symbols in too*: Chrome takes an SVG text's box
   as the union of the declared box and the ink, so a part name is a pixel
   short and a row of chords carrying a "j" a pixel tall. Only the total is
   asserted, within a pixel, and no test names either row. (c) The degrade
   when the four woff2 are not on disk was measured by hand (the engraving is
   named `3b3bf2ba…` and carries Liberation Serif, and `b15a2e7c…` with
   LMRoman10 once they are back) and no test exercises it. (d) Chrome writes
   the Latin Modern faces into a score PDF as Type 3 where it writes the sans
   ones as CID TrueType; poppler warns "Bad bounding box in Type 3 glyph"
   while rasterising, the outlines are clean at 1200 dpi and `pdftotext`
   reads the words, but the two faces do not make the same kind of PDF object
   and a stricter consumer may care. What used to be (a) here, the chord
   symbols leaving the machine's sans in the printed file, is gone: they are
   in the table since 2026-09-19 and the fixture of *the words on a printed
   score are the document's face* carries one.
8. Player seek: measured in the harness (a scratch run under `tests/tmp/`),
   the audio lands on a single source with no overlap, but the head is drawn
   1 to 5 per cent ahead of where abcjs seeks the sound (larger on a short
   tune), because the head uses the buffer duration, release tail included,
   while abcjs seeks against the musical duration. Same code as the Vditor
   editor, so not a rewrite regression, and the report of the head drifting
   as it is dragged is not yet reproduced as a fault of its own. No test
   added.
