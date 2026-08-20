# MDM regression suite

Tests that pin down the verified behaviour of the project: the round-trip
armour of the editor, the host↔webview protocol and the Quarto render chain
(HTML and PDF). They run on the native Node runner (>= 20), with no
frameworks.

## How to run

```sh
cd tests
npm install          # first time only (puppeteer-core, for the webview suite)
npm test             # everything
npm run test:fast    # unit only (transforms + host + theme + audio assets), < 1 s
npm run test:render  # Quarto integration only (HTML + PDF, ~20 s, compiles LaTeX)
npm run test:webview # the webview suite in Chrome only (~90 s)
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
| `transforms.test.js` | 37 tests of `vscode-mdm/transforms.js`: byte-identical round trip of `example.mdm` (header hidden and shown), the `mdm-abc`/`mdm-abc-play`/`mdm-attr-…` tokens, CRLF armour, nested/tilde/indented fences, forged tokens that must not mutate, splicing the YAML header back. | Node |
| `extension-host.test.js` | 34 tests of `vscode-mdm/extension.js` against a mock of the API (`mocks/vscode.js`): the settings allowlist against injection from `settings.json`, the Workspace/Global target when writing, the ready/update/edit protocol, the conditional echo (the first-Enter regression), the `withFrontMatter` flag travelling with the text, external and configuration changes, the syntax palette in the HTML and in the `palette` messages, dispose, and the audio wiring in the HTML (synth and soundfont URIs, the widget css, `unsafe-eval` and `connect-src` in the CSP). And export: it saves a dirty document before rendering (and leaves a clean one alone), runs `bin/mdm render <doc> [--to html|pdf]` from the document's folder (a fake shell bin/mdm records arguments and cwd), offers the Open HTML/PDF buttons that fit, shows the stderr if the renderer fails, and refuses a format that is not in the table (the value comes from the webview). | Node |
| `audio-assets.test.js` | 4 tests of the player's vendored assets: the copies of abcjs 6.7.0 and abcjs-audio.css under `vscode-mdm/media` byte-identical to those in `_extensions` (so they cannot drift), the loading mechanism in `main.js` (a Function with module/exports produces the synth WITHOUT touching the global where 5.10.3 lives), the 88 keys A0–C8 of the piano present and carrying a real mp3 signature, and the harness mirroring the audio globals. | Node |
| `theme.test.js` | 26 tests of `vscode-mdm/theme.js`: JSON with comments and trailing commas, TextMate scope matching (prefix by dot, the most specific wins, a tie goes to the last, selectors with a space ignored), the `include` chain, finding a theme by id and by `%nls%` label, sanitizing down to hex colours (those values go into the HTML of the webview), `tokenColorCustomizations`, and VS Code's built-in Monokai read from disk when it is installed. | Node |
| `render.test.js` | 6 tests of `bin/mdm` + `_extensions/mdm/mdm.lua`: the CLI guards, HTML (2 figures, `mdm-play`, escaping of `&`/`<`, abcjs deps, and that ` ```music ` is NO LONGER an alias), PDF (cache by sha1 of the source with its trailing newline, the `.w` sidecar, a BoundingBox trimmed and consistent with `.w`, a narrow score < 330 pt centred in the `.tex`, a wide one at `width=100%`, a warm cache that does not run abcm2ps again). It renders in `tests/tmp/` with symlinks to `_extensions/` and `tools/`; it never touches the repo. | quarto, TeX, gs |
| `webview.test.js` | 72 tests of the webview (`vscode-mdm/media/`) in a real Chrome, with `webview/harness.html` as the page of the webview and a shim of `acquireVsCodeApi` that records what is posted to the host: the YAML header painted with its editable `<code>` intact (lute's serialization trap), typing inside the header (caret and round trip), an edit elsewhere not breaking the header, gaps between blocks equal to a paragraph's, the equation not collapsing, the YAML button taking the editor to the top of the document, a setting with no colour in it not repainting the theme, the theme menu, the header toggle as a loose block (with no re-render: the scores keep their nodes) and its round trip, the copy button (source to the clipboard, a pulse on the block, no page selection), the three grounds (light/dark/white) with the code on a floor darker than the page, the `viewBox` crop with a wide title, score alignment, and click to open the source. Plus what the palette round added: the ten `--mdm-syn-*` applied and used (the `.hljs-attr` of the header takes the colour of the palette), a palette from the opposite side discarded and the fallbacks of `style.css` coming back, the `palette` message repainting live, a named theme dragging its side along, the staff lines (grey by default, notes in ink, the button lit for *ink*, a darker grey on the dark side) and the score background (clean by default, a menu with the four values and a tick, light value `#f7edd8` and dark `#332c1c`, the `mdm-copy-pulse-filled` pulse). And the player suite: a toggle on every score (and only there) to the left of the copy button, shown on hover; opening and closing the bar without expanding the block and with the tooltips naming the destination; play sounding from the local soundfont (notes over `file://`, nothing to the network, and the block not expanding when it is pressed); a byte-identical round trip with the player open; one player at a time; the bar surviving, paused, edits of its block and full external updates (and closing with no residue if the scores disappear); silent chord symbols (`chordsOff`: playing the chord block asks for the 14 written notes only, no low accompaniment octaves); the session volume (the slider at 100 to begin with, a real GainNode on the playback path, which a spy on `AudioBufferSourceNode.connect` tells apart from stock abcjs, the gain following the slider live, and the level coming back on the next player); and the notes lighting up while they sound (a **computed** colour, not the attribute alone: the dark content theme paints `fill: currentColor` over the score and ate the mark; and no staff line lights up with the note), with the ink back when it closes. Plus the ergonomics round: **play with the block open for editing** (the case that did not sound: it checks that the point clicked lands on the button, that playback starts, that the block does not collapse and that the scroll does not move), the tooltips of the two buttons naming the destination and following the state (with no `title`, which is never shown in the webview), the repeat button's background really painting (the `!important` of abcjs), the chrome taking no syntax colour (with Monokai as the fallback, the hover cannot be `#f92672`) and the two faces of the speaker. And the accent round: stop (the play/stop/repeat order, it really stops, it rewinds the progress to 0, it puts out the lit note and it does not restart by itself), the slider with no focus box (the test **injects the sheet VS Code puts into the webview** and checks that our `outline: none` wins) and the brass per side (`rgb(160,116,15)` light, `rgb(217,169,79)` dark, computed on `.abcjs-note_selected`). And the player ergonomics round: the volume can be set without closing the open block or moving the scroll (the capture-phase `blur` guard), a click in the side margin closes the open block (score and equation, checking first with `elementFromPoint` that the point lands in the margin), progress is reported >= 10 times a second (`beatSubdivisions`, which is where the cursor resumes from after a pause) and the size of the two buttons on a score (a 16 px speaker, larger than the copy one, centred on the same line). And the progress drag round: the head follows the pointer **with the button still down** (which is what abcjs did not do) and the tune lands where it is dropped (the clock at 0:07 at 75 % of a tune of about 9.6 s), the grab band reaches 5 px above and below the 4 px line, the playback clock does not take the head away from the pointer while it is dragged (two identical readings 700 ms apart), the arrows answer after the bar is clicked (focus included) and End takes it to 100 %, the steps asked for before the tune is primed add up in strict order (`aria-valuenow` goes 2, 4, 6 and nothing else: a seek served out of turn walks the head back down the steps it has just climbed) and it can be dragged with the block open for editing without closing it or moving the scroll. And the resume and file bar round: on resuming after a pause the sound restarts AT THE SAME POINT but muted (the buffer offset == the pause position, ±60 ms), the silence stage holds it at 0, no note lights up during the gap, and the note that is due lands on its beat with the gain back at 1, measured against the onset grid frozen at the pause (under the bug the ink lit up when play was pressed and would have recorded a false onset); a scrub inside the silent gap lifts it at once (a synthetic pointerdown/up gesture in the same tick as the resume, because the gap lasts about 150 ms); export/undo/redo head the toolbar in that order and undo/redo carry rotating arrows of their own (path `M3.32…`/`M12.6…`, with Vditor's disabled state intact); and the three entries of the export menu post `{type:"export", to}` with their exact format. And the suite of the rendered block borders (nine tests): a Delete at the end of the paragraph above **enters** the equation and the code block instead of melting the source into the paragraph (with no edit posted, and typing afterwards the round trip comes out exact); Backspace at the start of the open source and Delete at the end leave the block without dissolving it; a selection of the whole source is spliced by hand leaving the fences, with the block **shut** as well (where `Selection.toString()` comes out empty because the source `pre` measures 10×5 px: the comparison is by range positions); the next key on the empty source removes the block and `Ctrl+Z` brings it back; an equation alone in the document is removed and writing can go on (the spare paragraph branch); an equation inside a blockquote is entered the same way (the climb by levels, which corrupts without it); and two false-positive controls, the Delete in the middle of a paragraph and a partial selection inside the source, which have to stay the browser's. | google-chrome |
| `html.test.js` | 5 tests of the **rendered** HTML page, in Chrome: what `_extensions/mdm/resources/mdm.js` does on load, which the pandoc output does not say. The three blocks engraved; only the narrow one wrapped in `.mdm-fit` with its `max-width` and centred; the gap under the score equal to the height of the drawing (the percentage padding fix plus `height:0`); the audio controls on the `.play` block only (three buttons, `abcjs-inline-audio`); no script errors. Verified to bite: commenting out `height: 0 !important` fails the gap test, and removing the `.mdm-fit` wrapper fails two. | quarto, google-chrome |

The expected values come from real measurements: the `.w` widths of
`example.mdm` are 378 / 512 / 143 pt, and a "wide" fixture block needs two
systems (512 pt), because the crop is to real ink and a lone bar with a
short title stays around 275 pt. abcm2ps 8.14.15 does not emit
`%%HiResBoundingBox` (the rewrite in `mdm.lua` is defensive).

## Traps of the webview harness

Measured in earlier sessions, to be respected when cases are added: the
first SVG of abcjs 5 measures 0×0; the copy button only exists visibly on
hover (hover before measuring); `new Vditor('app')` turns `#app` INTO the
root `.vditor` (selectors like `#app .vditor` do not match); the copy
interceptor is registered BEFORE the general click handler.
`Selection.toString()` returns what is **drawn**, so it comes out empty over
the source of a shut block (measured: 10×5 px), while `Range.toString()` and
`compareBoundaryPoints` do not depend on layout; and
`div[data-type="math-block"]` matches the div inside the preview too, which
has to be narrowed with `.vditor-ir__node`. The `open()` helper takes
`scores: 0` for a document with no scores (otherwise `update()` waits for
three to be engraved). The harness seeds
`window.__settings/__palette/__side/__themes` with `evaluateOnNewDocument`,
and the host messages come in through `window.postMessage`, the same channel
VS Code uses. `harness.html` also leaves a `window.__toHost` hook for running
the real `extension.js` in Node and closing the host↔webview circle; nothing
uses it today.

## Pending

In order of value, with the gap identified in the review of 2026-08-17:

1. **Callouts**: the whole subsystem (~110 lines of `main.js`) without a
   single test, and with a recent fix inside it, the `p.normalize()` that
   puts back together the text node Vditor splits when it reinserts the
   `<wbr>`. Cases: the `mdm-co-open/body/close` classes, `data-mdm-co` by
   type, a small faint fence, a fence at full size with the caret inside,
   and an intact round trip.
2. **Keyboard ergonomics**: `Ctrl+Enter` and the double Enter for leaving a
   code block; a click in the empty area below the last block; `Ctrl+X`
   (the nested `execCommand` fix). Delete and Backspace on the borders of a
   rendered block are covered already (the `webview.test.js` row).
3. **Synchronization plumbing**: the `withFrontMatter` flag of the `edit`
   messages (the tests read `.text` only), `if (pending) return` with an
   edit in flight, `flushEdit` on blur and visibilitychange, and keeping the
   scroll position on a full external update (the case that motivated
   `scroller()`).
4. **No red flash** when a note is clicked (`pointer-events: none` plus
   `clearScoreSelection`).
5. `h.errors` is only asserted empty in a few tests; moving it to the
   helper's `close()` would cover the rest for free.
