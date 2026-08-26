# MDM (Markdown Music)

A document format for technical writing that mixes mathematics and music:
standard Markdown (with LaTeX equations) plus music blocks in ABC notation
that render as a score. An `.mdm` file with no music in it is valid
Markdown; the music blocks live in fences, so a viewer that knows nothing
about the format shows them as code and nothing breaks.

Implemented as a Quarto extension, which brings everything else for free
(HTML + PDF, theorems, cross-references, bibliography).

## Usage

```sh
./bin/mdm render example.mdm            # HTML + PDF
./bin/mdm render example.mdm --to html  # HTML only
```

`bin/mdm` copies the `.mdm` to a temporary `.qmd` and calls `quarto render`.
You can also work directly with `.qmd` files that declare
`filters: [mdm]`.

## Syntax

Everything from Markdown and Quarto works as usual (`$...$`, `$$...$$`,
callouts and the rest). Music goes in fenced blocks with the class `abc`,
written in [ABC notation](https://abcnotation.com/wiki/abc:standard:v2.1):

    ```abc
    X:1
    T:C major scale
    M:4/4
    L:1/8
    K:C
    CDEF GABc | cBAG FEDC |]
    ```

With the class `play` the block gets playback controls in HTML (synthesis
in the browser through abcjs; the PDF shows the score alone):

    ```{.abc .play}
    ...
    ```

A short score (an interval, a chord) can fix its own width with the ABC
directive `%%staffwidth` as the first line of the block, and it is then
inserted compact and centred, the way a display equation is, in the editor,
in HTML and in PDF. Careful: with an explicit unit (`%%staffwidth 200pt`),
since abcm2ps ignores a value without one (abcjs reads it as px):

    ```abc
    %%staffwidth 200pt
    X:1
    ...
    ```

There is no *inline* music notation inside a paragraph (Markdown fences are
blocks); a compact width is the practical equivalent.

Every line break in the ABC body opens a new system, so several lines give
several stacked staves. To label them use the `P:` field rather than an
annotation (`"^text"`): an annotation is attached to the first note and
abcjs reserves the width of the text for it, which opens an extra gap right
there (measured in `example.mdm`: 75 units between the first and the second
note, against 42 everywhere else). With `P:` the notes sit exactly where
they would with no label at all.

## How it works

- **HTML**: the Lua filter (`_extensions/mdm/mdm.lua`) emits the ABC source
  and `_extensions/mdm/resources/mdm.js` renders it to SVG with
  [abcjs](https://github.com/paulrosen/abcjs) (vendored, v6.7.0) once the
  page has loaded, on a page dressed as the visual editor (below).
- **PDF**: the filter engraves each block with `abcm2ps` to EPS, trims the
  BoundingBox to the real ink with ghostscript (abcm2ps writes it at the
  full page width, which shrank the scores when they were scaled), converts
  it with `epstopdf` and inserts it: at text width if it is wide, at its
  natural size and centred if it is narrow (< 330 pt). Results are cached
  by a hash of the content in `mdm_cache/`.

### The HTML looks like the editor

The page a render produces is dressed as the VS Code editor rather than as a
stock Quarto document: the same ground under the document and the same ink on
it, prose at the editor's measure, code on the same cards in the same
colours, scores drawn and filled the same way, and the same player bar under
a `.play` block. `_extensions/mdm/resources/mdm-look.css` is that look, a
port of the editor's own stylesheet (`vscode-mdm/media/style.css`) onto the
HTML Quarto produces; it spends a handful of custom properties, and the
filter writes them into the page from what it is told.

What varies travels as plain metadata, which the VS Code extension passes
when it exports (`exportLook` in `vscode-mdm/extension.js`) and a plain
`bin/mdm render` does not pass at all:

| Key | Values |
|---|---|
| `mdm-look` | `light`, `dark`, `white`: the side the editor is on, and with it the two grounds, the ink and the accents |
| `mdm-staff-lines` | `gray`, `ink` |
| `mdm-score-fill` | `none`, `paper`, `slate`, `brass` |
| `mdm-score-align` | `center`, `left` |
| `mdm-syn-*` | the ten syntax slots (`base`, `bg`, `comment`, `string`, `number`, `keyword`, `attr`, `name`, `type`, `variable`), as six hex digits **without** the `#`, which would open a YAML comment |

So a render from a terminal comes out in the editor's default look with the
palette the editor itself falls back to (stackoverflow-light), and one from
the toolbar comes out in whatever the editor was showing, its colour theme
included:

```sh
./bin/mdm render example.mdm --to html \
  -M mdm-look:dark -M mdm-score-fill:paper -M mdm-syn-keyword:f92672
```

These values reach a `<style>` block, and metadata is whatever the command
line carried, so the filter lets nothing through that is not one of the words
above or six hex digits. The block is written on `html:root` rather than on
`:root`, so it outranks the stylesheet's own fallbacks by weight and not by
the order Quarto happens to put the two in.

Two things are as close as they get rather than identical, and in both cases
the reason is the engine underneath. The code is tokenized by skylighting
here and by Lezer in the editor, so the palette is shared but the cut into
tokens is not, and a line the two read differently comes out coloured
differently. The equations are set by MathJax here, Quarto's own, against
KaTeX in the editor.

One thing the render drops rather than dresses: the margin block Quarto adds
with the document's other formats ("Other Formats", one link per format the
header declares). An `.mdm` usually declares both, so every HTML page carried
a link to a PDF that is only on disk if a PDF was asked for as well, and with
`--to html` it pointed at nothing; the editor has no such column either.
`bin/mdm` passes `-M format-links:false` for it, and only when the document
says nothing about `format-links`, so a document that wants the links keeps
them by asking for them itself. It goes on the command line and not in the
filter because Quarto settles the format options before the filters run: a
`format-links` written from `mdm.lua` arrives too late and the block comes out
all the same (measured).

The PDF is untouched by all this: it is a printed page, and the filter writes
the look for the HTML format alone.

## Requirements

- Quarto >= 1.4 and a TeX installation (for PDF; `epstopdf` ships with
  TeX Live).
- `abcm2ps` (for PDF). A build is included in `tools/bin/abcm2ps`
  (v8.14.15, built from <https://github.com/lewdlime/abcm2ps>); the filter
  looks there first and then in the PATH. Another path can be set in the
  YAML header of the document:

  ```yaml
  mdm:
    abcm2ps: /path/to/abcm2ps
  ```

## Visual editor for VS Code (`vscode-mdm/`)

A VS Code extension that opens `.mdm` files as a rendered, editable
document: text, KaTeX equations and scores are shown rendered, and the
source of each shows where a caret is, so the document edits like prose in
Typora or in Obsidian's live preview and like code wherever the caret
stands. It uses the Custom Editors API over a [CodeMirror 6](https://codemirror.net)
view of the Markdown text (vendored, works with no network); the scores are
engraved and played by the vendored abcjs 6.7.0, the same engine the Quarto
HTML output uses, and the equations by KaTeX 0.18.

Installation: symlink the directory into
`~/.vscode/extensions/alpelito7.mdm-editor-0.1.0` and reload the window
(`Developer: Reload Window`). The editor needs nothing else; an export needs
Quarto, and a PDF of a document with scores in it needs TeX and abcm2ps. To go back to the plain text editor: right
click the file, `Open With...`. Both can be open at once on the same file
(Reopen Editor With... in a second group): they share the document.

How the editing works:

- **The text is the file.** The editor holds the Markdown of the document
  and nothing else, so every character of it, the `$$` of an equation, the
  backticks of a fence, the `#` of a heading, is an ordinary character:
  delete one `$` of a closing `$$` and the block is no longer an equation,
  it is a paragraph with three dollar signs in it, shown as such, and
  nothing regenerates the fourth; type it back and the equation renders
  again. There is no serialization step between what is typed and what is
  saved (the one exception is the YAML header while it is hidden, below).
- **Rendering follows the carets.** What is drawn where depends on the
  Markdown structure (the Lezer tree CodeMirror keeps) and on where the
  selection is. A block no selection range touches is drawn: an equation
  as KaTeX, a score as its engraving, a fenced block as a card of
  highlighted code with its fences hidden, bold as bold with the `**`
  hidden, a `- ` as a bullet, a link as its text. A block a caret is in
  shows its source: the equation's `$$` lines on a monospace card with the
  rendered equation right under them as a live preview, the score's ABC
  with the score and its player under it, the fences of a code block,
  the `**` of the bold span. Every selection range counts, not just the
  main one, so each of several carets opens the thing it edits; the edges
  count too, so arriving at a block from outside opens it before the next
  keystroke lands in it. An equation whose source KaTeX refuses stays as
  source with a red edge while no caret is in it, and shows KaTeX's message
  under the source while one is; the moment it compiles, it renders.
  Inline maths and inline marks show only their source while the caret is
  in them, there being no room for two copies in a line.
- **Getting in and out.** A click on a rendered equation or score puts the
  caret at the start of its source; with the multicursor modifier held it
  adds a caret there and leaves the others where they are, the way a click
  anywhere else in the document does. The arrow keys walk into a rendered
  block from the line above or below (Down into its first line, Up into
  its last), and out again past its last line. `Ctrl+Enter` leaves the
  block the caret is in (a fence, an equation, a list, a quote, a callout,
  a heading line) into a fresh paragraph below it; inside a code block
  plain `Enter` is a newline, as in any code editor, since the closing
  fence is a line of text the caret can walk past.
- **Multicursor**, as in VS Code's own editor: `Alt+click` adds a caret
  (or `Ctrl+click`, following the `editor.multiCursorModifier` setting),
  `Shift+Alt+drag` selects a column, `Ctrl+D` selects the next occurrence
  of the selection, `Ctrl+Shift+L` every occurrence, `Ctrl+Alt+Up/Down`
  adds a caret on the line above or below, `Escape` goes back to one.
  Typing, the formatting commands and undo act at every caret at once (one
  `Ctrl+Z` takes back a multi-caret insert). The clicks that answer something
  other than "put the caret here" leave the rest of the carets alone: one that
  closes a block open for editing (in the dead margin, on the outline, on the
  toolbar) moves only the caret that was inside that block, and one on a
  drawing adds its caret instead of replacing them. Both used to dispatch a
  single caret of their own, which threw away every other one, and read from
  the outside as the multicursor losing its carets and refusing to edit.
  Alt itself is VS Code's as much as this editor's: a tap on it focuses the
  menu bar (File, Edit), and the workbench reads that off a clean press and
  release, cancelling it on any mousedown of its own. A click made inside a
  webview never reaches the workbench, so a held Alt read there as a tap and
  the release pulled the focus into the File menu: the caret had been added
  and then the carets stopped being drawn and the typing went to the menu,
  which is why the gesture only worked on the second try. An Alt release that
  followed a mouse press is now held back at the document, one stop before
  the window the host forwards keys from; a tap on its own still leaves the
  page, so the File menu still answers it. This is what moved the editor
  off its previous engine: a `contenteditable` in Chromium keeps a single
  selection range (measured: after adding three, `rangeCount` is still 1),
  so a multicursor there could only have been an emulation, redone after
  every keystroke.
- **Formatting**: `Ctrl+B`, `Ctrl+I` and `Ctrl+E` wrap (or unwrap) each
  selection in `**`, `*` or backticks; `Ctrl+K` makes a link with the caret
  in the address; the toolbar has the same three, a link, a heading button
  that takes each selected line one level up (and a level-six heading back
  to a paragraph), and bulleted and numbered lists that toggle their
  markers on the selected lines. The bar leads with export, then undo and
  redo (rotating arrows, grey when there is nothing to do), and ends with
  the editor's own buttons: theme, score fill, staff lines, score
  alignment and the YAML header.
- **Undo inside VS Code, once.** The webview host replays the workbench's
  `undo` command into the page as `document.execCommand("undo")` after the
  keystroke has already reached the editor, which ran its own undo; the
  replay would run the browser's native undo over CodeMirror's DOM on top
  of it (measured: it ate the end of the line). Undo and redo are taken
  off `execCommand` in the page; copy, cut, paste and select-all keep
  theirs, which CodeMirror answers through the events they fire.
- **Export from the toolbar**: the first button opens HTML / PDF / HTML +
  PDF. Each entry saves the document first (which makes export a save as
  well: what reaches the HTML and the PDF is always what is on screen) and
  runs the same `bin/mdm render` as the command line, with a progress
  notice and buttons to open what it produced. The look of the editor goes
  with the call, so the HTML comes out dressed as the editor it was exported
  from, theme and all (see [The HTML looks like the
  editor](#the-html-looks-like-the-editor)). `Ctrl+S` still saves as in
  any VS Code editor; "save as" is VS Code's own (File > Save As). The
  extension renders on its own rather than calling `bin/mdm`: it copies the
  document to a `.qmd` beside it, points that copy at the Lua filter the
  extension carries (`vscode-mdm/render/mdm/mdm.lua`, the same file as
  `_extensions/mdm/mdm.lua` and pinned to it byte for byte by a test), calls
  `quarto render` in the document's folder and takes the copy away. Quarto
  resolves `filters: [mdm]` against an `_extensions` folder in the folder of
  the file it renders and nowhere else, so naming the filter by its path is
  what lets a document export from wherever it lives, with no clone of this
  repository anywhere.
- **Nothing but the export needs anything installed.** The editor carries
  everything it draws and plays, so it opens and works on a machine with no
  Quarto, no TeX and no abcm2ps. Those are looked for the moment an export is
  asked for and never at start-up: whichever is missing is named in the
  notification, with the whole story (the command, Quarto's own output) in
  the MDM output channel, one "Show log" away. A PDF asks for abcm2ps only
  when the document actually holds a score, since without it the scores would
  come out as text and the export would look like it had worked.
- **Playback**: beside the copy button of every score (both appear on
  hover) there is a pair of headphones that unfolds a player bar under the
  score, with play/pause, stop, repeat, a draggable progress bar and
  volume. Stop is not abcjs's (it has play/pause and repeat only, and a
  pause leaves the tune half way): it is composed of the pause of the play
  button itself, so the widget keeps its state, plus `restart()`, which
  rewinds the clock and the sound to the top. The headphones have a single
  face, and the lit disc behind them says that this score's player is open,
  the way the repeat button does; the tooltip still names the destination
  of the click ("Show player", "Hide player"). A real piano sounds without
  touching the network: the 88 notes of the Musyng Kite soundfont (CC BY-SA
  3.0) are vendored in `media/vendor/soundfont/`, and the synthesis is the
  vendored abcjs 6.7.0. One player at a time: opening another score's
  closes the previous one. The bar lives in the score's widget, which
  CodeMirror keeps while the ABC source is the same: a caret going into
  the block and out again, or the block scrolling off screen and back,
  leaves the player where it was, sounding. An edit of the ABC rebuilds
  the widget and the player reopens on it, paused and on the new source.
  Only the piano is vendored: a different `%%MIDI program` will not find
  its notes.
  - **Resuming after a pause keeps the beat**: the resuming play restarts
    the sound exactly where it stopped but MUTED, what was left of the cut
    note passes in real silence with the clock running, and the gain comes
    back a hair before the next note attacks, scheduled on the
    AudioContext's own clock (sample accurate): the note that is due lands
    on its beat, in ink and in sound together, the way a conductor counts
    you in. Nothing of the past is heard again (the cut tail stays
    silenced) and nothing jumps ahead. How the design got there: stock
    abcjs replayed the tail with no attack and its cursor painted the NEXT
    note at once (it restarts its clock by advancing the event pointer);
    the first attempt at a fix jumped straight to the following onset, and
    near a barline the drift between the visual clock and the audio could
    skip a whole bar, besides not waiting for the beat. The held ink and
    the silence share one teardown: pausing again, stop, a drag of the bar
    or closing the player lift it at once (a scrub has to sound where it
    lands).
  - **The first note of the first play was sometimes not heard** (and it
    sounded whole once the tune went back to the top). The note is
    synthesized correctly from millisecond zero, measured by taking the
    signal off the audio graph: what is lost is further downstream, in the
    card or the device, which fall asleep on the silence before the play
    and wake up late, Bluetooth headphones especially. Opening the bar now
    does two things: it creates the `AudioContext` inside the click itself
    (a context born in a gesture starts running, rather than suspended by
    the autoplay policy) and it lights a pilot, an 8 Hz sine at about
    -48 dBFS straight to the output, below what an ear or a speaker
    reproduces but with samples other than zero, which is what the silence
    detection of the device reads to stay awake. The seconds between
    opening the bar and pressing play give the hardware time to wake. The
    pilot goes out and the context is suspended a minute after the last
    player closes, or as soon as the webview is hidden with nothing
    sounding, so that leaving the editor open does not keep a headset
    awake. The two numbers to touch if some device resists (raise the
    level) or lets the pilot through (lower it) are `PILOT_LEVEL` and
    `PILOT_HZ` in main.js. Along the way, abcjs creating an `AudioContext`
    of its own inside `supportsAudio()` before ours was registered got
    fixed: that was two contexts and two output streams per editor, now
    one.
  - While a tune plays, the notes light up on the score: the synth reports
    the characters of the source that are sounding and the engraving on
    screen lights the elements over that same range, which is where the two
    meet. The colour is brass, the one on the note of the extension's
    icon, and it lives in `--mdm-play-accent` with one value per side
    (`#a0740f` light, `#d9a94f` dark, as the score backgrounds do): it
    paints the class `.abcjs-note_selected` from the stylesheet, so
    changing it is two lines. That brass belongs to the score and to
    nothing else: the bar carries no colour of its own.
  - The volume is one for the whole session: set it on one score and the
    next player opens at the same level. It resets when the document
    closes, deliberately (it is not an `mdm.*` setting). Underneath it is a
    master GainNode in front of the output, hung off a Proxy of the
    AudioContext, because abcjs connects straight to `destination` and
    offers no volume hook; the slider moves the gain live, mid playback
    included.
  - **The little speaker at the end of the bar silences the score** and
    another click brings it back. Mute is a state of its own and not a
    level of zero, so what comes back is the level the slider was left at;
    and touching the slider while muted lifts the silence, because reaching
    for the level is asking for sound. The gain does not jump to zero, it
    is ramped over 20 ms: a dry cut in the middle of a wave clicks. The
    silence belongs to the session, as the level does. The icon reports the
    state (a struck-through speaker while no sound is coming out) and not
    the destination of the click, which is how everybody reads a volume
    control; the tooltip does name the destination ("Mute", "Unmute"), the
    pairing of every player. The ones that still name the destination with
    their face are the toolbar buttons (the staff lines with "Ink staff
    lines" and "Gray staff lines"), which sit far from what they govern and
    cannot show their state any other way.
  - **The whole bar is drawn in the ink of the editor, at four weights**:
    the hairline of a track (18 %), what has been played (52 %), the disc
    under a button beneath the pointer (10 %) and the disc of a button that
    holds a state (20 %). No colour of its own: the discs were brass for a
    while and a row of coloured circles reads as an alarm.
  - **The state of a button is drawn where its drawing cannot say it**:
    repeat never changes shape, so the disc marks it, and the headphones in
    the corner do the same; play already turns into pause and the little
    speaker is struck through, so those two carry no lit disc and nothing
    is marked twice.
  - **Answers to the pointer**: a hand cursor over the buttons, a disc on
    hover, a denser disc while the button is held (before that, the only
    answer to a press was whatever the press did, and on the first play,
    which waits for the soundfont to come down, the button looked dead)
    and, for whoever arrives by keyboard, the same discreet ring the
    progress bar and the volume already used, never the amber box VS Code
    injects.
  - **What has been played is filled in** on the progress bar, and the
    level on the volume slider. The fill comes off the same number that
    places the head (`paint()` in main.js, which both the clock and the
    drag go through), so the two cannot come apart. The head grows by 25 %
    under the pointer and while it is dragged: the track is a 4 px
    hairline and what has to be grabbed has to say so. It grows through
    `transform`, because abcjs centres it with a margin of half its width
    and resizing it would put it off centre.
  - The progress bar can be dragged, like the volume slider next to it.
    abcjs gives it a `click` and nothing else, so the head could be jumped
    to a point but never taken hold of. It now answers a drag (with pointer
    capture, so it follows the mouse even once that has left the bar), the
    keyboard (arrows of 2 %, PageUp and PageDown of 10 %, Home and End) and
    has a 20 px grab band around the 4 px line it draws. During the drag
    the head and the clock follow the pointer and the seek lands on release:
    with this engine, seeking on every `pointermove` would mean stopping and
    relaunching every sound source, which is what `midiBuffer.seek` does.
    While dragging, the control's `setProgress` is silenced, since that is
    where the playback clock reports 16 times a beat and it would take the
    head away from the pointer. The click is handled by the webview too,
    with the abcjs one covered in the capture phase: two owners of the same
    seek trip over each other while the tune is primed, because abcjs parks
    what it is asked during a load and looks at it again every 500 ms
    (measured: a click at 40 %, three arrows and an End left the head back
    at 40 %, with the click landing last). Seeks go one at a time through
    `runWhenReady`, which is where abcjs defers its own controls, and the
    position is read once the engine is free, so what lands is the last
    thing asked for.
  - What is written is what sounds, and nothing else: chord symbols in
    quotes (`"Dm7"`) are drawn but not synthesized (`chordsOff`). Without
    that, abcjs turned them into a strummed accompaniment of its own, four
    crotchets filling the bar under a written semibreve. Same rule in the
    Quarto HTML output (`resources/mdm.js`).
  - **The caret does not move while the player is used**: a `<button>` is
    focusable, so its `mousedown` would take the focus off the editor; the
    default of `mousedown` inside the bar is prevented, except on the form
    controls, which need the native drag, and on the progress bar, which
    answers the arrow keys once it has been clicked. The widget the bar
    lives in tells CodeMirror to ignore every event inside it, so a click
    on play never becomes a caret placement. What the headphones do move is
    the focus, and only the focus: opening a player hands it to the bar, so
    the selection stays exactly where it was and the caret simply stops
    being drawn until the document is clicked again. That is what Space
    rides on.
  - **Space is the play and the pause of the open player**, and only while
    the player holds the keyboard. This is a text editor first, and a space
    typed into the document has to stay a space: what the key is read off
    is the element the focus is on, never the branch the node hangs from
    (the bar is a widget of the editor, so it sits inside the very element
    a caret focuses, and an ancestor test read every press as the
    document's). The content is editable and the bar is not, which is what
    tells the two apart; a focused control keeps its own press, so the
    buttons of the toolbar and of the bar and the volume slider still
    answer Space with what they do. Escape hands the keyboard back to the
    text, and so does closing the player. The press goes through the
    widget's own play button and not through the controller, so the face of
    the button, its label and the resume in silence follow a key exactly as
    they follow a click.
  - The cursor is told 16 times a beat (`beatSubdivisions`). abcjs reports
    once a beat by default, and that same number is where its cursor
    resumes from after a pause, while the sound goes on exactly where it
    stopped: measured on the third score of `example.mdm`, the median gap
    after pausing and resuming was 22 ms and came down to 8, under one
    frame.
  - The bar is dressed in the colours of the theme and not in the syntax
    ones: it took the *keyword* colour, which in Monokai is a strong pink,
    and on the dark side the buttons looked like an error. Warning for
    whoever touches this: abcjs declares `background: none !important` on
    its buttons, so any background of ours has to be marked the same or it
    is not painted (that was why the repeat button looked dead), and its
    tooltips live in `title`, which inside a VS Code webview is never
    shown; the CSS tooltip of the editor (`.mdm-tip`, drawn from
    `aria-label`) is used instead, the same one the copy button has. The
    volume slider carries `outline: none`: VS Code injects a sheet of its
    own into every webview with `a:focus, input:focus, select:focus,
    textarea:focus { outline: 1px solid -webkit-focus-ring-color }` (it is
    in the preload of the installed build), and that system colour is
    amber in Chromium, so setting the volume drew a yellow box. Keyboard
    focus keeps a mark, in the ink of the bar.
- **Theme menu**: a toolbar button opens, in this order, *Follow VS Code*
  (the default), *Light*, *Dark*, *White* and every colour theme installed
  in VS Code (Monokai, Solarized Light, Abyss and whatever the user
  installs). A named theme brings a syntax palette of its own and a side of
  its own: choosing Monokai leaves the editor dark and Solarized Light
  leaves it light. The setting is `mdm.theme`, which takes theme names
  besides `auto`/`light`/`dark`/`white`; the webview does not repaint by
  itself, it asks the host to write the setting, so the choice persists
  and every open `.mdm` editor shares it. The list is read when the editor
  opens: a theme installed with the editor already open shows up after
  reloading the window. A name no extension provides is discarded and falls
  back to `auto`: the setting is validated against the themes actually
  installed, because its value is interpolated into the HTML of the
  webview.
- **The two backgrounds of the editor**, both derived from the chosen
  theme, so the theme menu moves them together, and on both sides the code
  rests on the darker of the two, the way a notebook draws its cells.
  Everything comes from two mixes of the theme's own colours: the *tint*,
  which is `editor.background` taken 6% towards the foreground, and the
  *wash*, the same mix at 2%.
  - *Light*: the code keeps its usual slate (the tint) and the page takes
    the wash, so it sits a step below the white the theme gives. Measured
    with the stackoverflow-light fallback palette: page rgb(242,242,242),
    code rgb(234,234,235); with a theme whose `editor.background` is pure
    white, 251 and 243.
  - *Dark*: the code drops to the theme's `editor.background`, which is the
    colour VS Code paints that same code on, and the page rises to the tint
    (with the Monokai fallback palette: page rgb(52,52,46), code
    rgb(39,40,34)).
  - *White*: the light arrangement on a blank sheet, a white page whatever
    the theme says and the code with its slate. A score with no background
    of its own (`mdm.scoreFill` at `none`) is drawn on the page, so there
    it comes out on white.
- **Syntax colours inherited from VS Code**: the code of the document (the
  YAML header and the code blocks) is painted with the colours of the theme
  chosen in the menu above, which by default is the one the user has set in
  VS Code. A webview receives every colour of the VS Code *registry* as
  `--vscode-*` variables, but the TextMate token colours, the ones that
  actually colour code, are not in that registry and no API exposes them;
  what can be done is to read the theme itself, and that is what `theme.js`
  does on the host: it resolves `workbench.colorTheme` against the
  installed extensions (the built-in themes are an extension too), reads
  its JSON (with comments, and following the `include` chain), applies
  `editor.tokenColorCustomizations` on top and sends the webview a palette
  of ten colours, which `main.js` sets as `--mdm-syn-*` properties on
  `#app` and spends through a CodeMirror highlight style over the tokens
  of each fenced language (Python, JavaScript, JSON, YAML, HTML, CSS, C++
  with full parsers; R, Julia, shell, LaTeX, Lua, Ruby, Octave, Haskell,
  C, Java, C#, SQL, TOML, XML and diffs with the lighter stream modes).
  Only hex colours get through the filter: those values end up inside the
  HTML of the webview. With no usable palette (a theme in `.tmTheme`, which
  is not parsed, or the editor forced to the opposite side of the VS Code
  theme with `mdm.theme`) the fallback palettes of `style.css` come in:
  Monokai on the dark side and stackoverflow-light on the light one.
- **Score background**: none by default, so that the score reads as part of
  the document the way an equation does. The **Score fill** toolbar button
  opens the options (`none`, `paper`, `slate`, `brass`, setting
  `mdm.scoreFill`); each carries a light value and a dark one, and the one
  for the active theme is applied.
- **The score fits the width of the panel**: abcjs draws it at a fixed size
  with `width`/`height` attributes and no `viewBox`, so narrowing the
  window shrank the element but not the drawing, and it was cut off at the
  bottom and on the right. The webview adds the `viewBox` and then it
  scales whole, as the union of the declared box and the real `getBBox()`,
  so nothing is cut and a score that already fitted does not change size.
- **Score centred or left aligned**: centred by default, like a display
  equation; the alignment button on the toolbar takes it to the left margin
  and back (setting `mdm.scoreAlign`, `center`/`left`). The icon and the
  tooltip name the destination of the click. Only scores narrower than the
  panel move: one that takes the whole width looks the same either way.
- **Paragraph spacing of a rendered page**: the blank line that separates
  two paragraphs of Markdown is drawn an em tall rather than as another line
  of prose, which puts the paragraphs 16px apart on the 16px body. That is
  the figure a rendered document uses (`p { margin-bottom: 16px }` in
  Vditor's sheet, which is what the Office Viewer preview draws with, and
  what the editor that came before this one showed), and it is what the
  gaps around headings, code blocks and scores come out at too. The lines of
  the text keep their own leading, wider than that.
- **Scores set into the text**: spacing identical to a paragraph's, no red
  flash when a note is clicked (the SVG is transparent to the pointer, the
  click means "open the source"), and narrow ones (`%%staffwidth`) centred
  like an equation.
- **Staff lines in grey**, Guitar Pro style, which is how they are drawn by
  default: a button of its own on the toolbar (a staff icon, unlit while
  the default holds and lit when the lines go to ink, with a tooltip naming
  the destination of the click) or the setting `mdm.staffLines`
  (`gray`/`ink`); notes, clefs and barlines stay in ink.
- **Copying a block flashes the block, not the page**: the copy button in
  the corner of any code block or score puts the source on the clipboard
  through the API, nothing is selected, and the confirmation is a brief
  pulse of the block's own background (the code card rises towards the
  text colour and comes back; a score, which has no background, takes the
  accent tint and fades) plus the button's own tooltip, which says "Copied"
  for a second and a half and then goes, leaving "Copy" behind it for the
  next hover. A score is also copied without its layout
  directives (`%%staffwidth` and the like), which size it for this document
  and mean nothing pasted somewhere else.
- **Quarto callouts decorated**: `::: {.callout-note title="..."}` is
  parsed as a block of its own (a Lezer extension in `vendor-src/`); the
  range carries an accent bar and a tint by type
  (note/tip/warning/important/caution) and the `:::` lines are drawn small
  and faint until the caret is on them. An unclosed `:::` stays plain text.
- **English interface**, tooltips included, drawn downwards. A tooltip names
  what the click leads to rather than the state in force, so a click on a
  button that carries two texts (the headphones, the staff lines, the score
  alignment, the YAML header) would leave the other one showing under a
  pointer that has not moved: the click puts the tooltip away instead, and it
  comes back when the pointer leaves the button and returns.
- **YAML header, shown and editable**: the last toolbar button shows and
  hides it (setting `mdm.frontMatter`, hidden by default; the button is
  disabled if the file has no header). Shown, it is the first lines of the
  text, `---` fences included, on a card and highlighted as YAML, and
  whatever is typed there goes to the file. Hidden, the header and the
  blank lines under it are kept outside the editor's text and the host
  splices them back on every save (`transforms.js`), so the file is
  byte-identical around whatever was edited; blank lines typed at the very
  top of the body in that mode join the gap under the header. Turning the
  button on also takes the editor to the top of the file, which is where
  what has just been shown lives. Verified: editing `example.mdm` in the
  editor and saving leaves the file byte-identical apart from what was
  edited, in both modes.
- **Outline panel**: the button that leads the bar opens a column down the
  left edge with the headings of the document, indented by level, the section
  the caret is in marked and every row a jump to it. It stays open while the
  document is navigated, and the grip on its edge sets how wide it is, the
  editor keeping a column of its own however far the grip is pushed. Both are
  settings (`mdm.outline`, `mdm.outlineWidth`), so the panel comes back the
  way it was left; a width that does not fit the pane is narrowed to fit while
  it is open, and the setting is not touched, so it grows back as soon as
  there is room.
- **The buttons remember what they were left on.** Every toolbar button that
  holds a state writes it as an `mdm.*` setting instead of repainting itself,
  and the editor draws from the value the host sends back. That is what makes
  a document open showing what it was closed with, and what keeps two editors
  open on two files in step: the theme, the score fill, the staff lines, the
  score alignment, the YAML header, the outline with its width, and the
  multicursor toggle (`mdm.multicursorMatch`), which decides whether `Ctrl+D`
  walks whole words, as VS Code does, or lands inside them too, so that
  "score" also matches in "scores". The one state deliberately left out is the
  player's volume: it lasts as long as the editor is open, the way a player's
  volume does. The values are written where they already live, so a workspace
  that pinned one goes on overriding the user's own.

What is in the bundle: `vscode-mdm/media/vendor/cm6/cm6.bundle.js` is built
by `vscode-mdm/vendor-src/` (`npm install && npm run vendor`, the one place
that needs the network) from CodeMirror 6, its Markdown and language
packages, KaTeX and the three Lezer extensions of this project, maths
(`$…$`, `$$…$$` inline and as a block, Pandoc's rules for the dollars, an
unterminated pair stays text), the YAML header and the callouts; the
bundle, KaTeX's stylesheet and fonts are committed, and the extension at
run time is plain JS with no build step. `VERSIONS.json` beside the bundle
says what went in. The decisions behind the engine change, and the ones
still open for review, are in `vscode-mdm/docs/cm6-migration.md`.

Editor limitations: no editing notes by dragging them with the mouse (the
dragging API of abcjs is the identified route; untested); tables are edited
as their source in a monospace grid (no rendered widget yet); images are
shown for paths relative to the document and for `https:` addresses, not
for arbitrary local paths outside the document's folder; CodeMirror draws
only the part of the document in view, so a player whose score scrolls far
off screen keeps sounding and its bar comes back with the score; if the
file changes from outside (git, a search and replace) while you are typing
in the visual editor, what was typed wins (last writer), and an outside
change that arrives between keystrokes is merged at the stretch that
differs, carets and undo history kept.

## Licence

MDM is MIT (`LICENSE`). What it vendors is credited one by one in
`THIRD-PARTY-NOTICES.md`, with the version of each copy actually in the tree:
abcjs 6.7.0, CodeMirror 6 with its Lezer packages, and KaTeX 0.18.4 are all
MIT; the piano the editor plays with is the Musyng Kite soundfont, which is
CC BY-SA 3.0 and is included unmodified, so the notice is the attribution the
licence asks for.

`tools/bin/abcm2ps` is the one binary in the tree, and it is somebody else's
program: abcm2ps 8.14.15, LGPL-3.0-or-later, copyright Jean-Francois Moine,
adapted from Michael Methfessel's abc2ps. It is called as a separate process,
never linked into anything here. Its licence texts are in `licenses/`, and
the source it was built from is <https://github.com/lewdlime/abcm2ps>. The VS
Code extension does not carry it: it looks for abcm2ps on the PATH, so the
`.vsix` is MIT throughout except for the soundfont.

## Known limitations (prototype)

- One tune per `abc` block (only the first is inserted in PDF).
- Playback in HTML downloads the soundfonts from the network the first time
  (the VS Code editor does not: it carries the piano vendored).
- No LilyPond support yet for typographically demanding scores; the natural
  route would be a `lilypond` block the filter compiles the way it does ABC.
- The exported HTML matches the editor as far as two different engines let
  it: the code is highlighted by skylighting rather than by Lezer and the
  equations are set by MathJax rather than by KaTeX, so the palette and the
  spacing are shared while the tokenizing and the glyphs are not. Callouts
  are left to Quarto as well, which draws them with a heading and an icon
  where the editor draws an accent bar over the source.
- `bin/mdm` renders single files; for a whole book (a Quarto `book`
  project) the chapters would go as `.qmd` with the filter.

## Ideas for later

### A preview identical to the MDM Editor, with audio

The goal: that the preview of an `.mdm` look exactly like the visual editor
and play the ` ```{.abc .play} ` blocks as well. Half of that is already
there in the export, which is dressed as the editor and plays its scores
(above); what is missing is the loop, a preview that follows the document as
it is typed rather than a render asked for by hand. Today VS Code's Markdown
preview opens on an `.mdm` (the extension already maps `.mdm` to the
`markdown` language id), but it renders with markdown-it, which knows
nothing about ABC: music blocks come out as code and Quarto callouts as raw
text. Three routes, with the work each one takes:

- **A plugin for the VS Code preview.** VS Code allows injecting into its
  preview through `markdown.markdownItPlugins`, `markdown.previewScripts`
  and `markdown.previewStyles`, with an `activate` that returns
  `extendMarkdownIt`. It would need a fence rule that reads the whole
  `token.info` (markdown-it cuts the "language" at the first space, so
  `{.abc .play}` has to be handled by hand) and emits the same HTML as the
  Lua filter: `.mdm-block` with `.mdm-src` and `.mdm-paper`, which reuses
  `resources/mdm.js`. The assets have to live inside `vscode-mdm/`, so they
  would be vendored copies of `mdm.js`, `mdm.css` and abcjs. The settings
  (`mdm.staffLines`, `mdm.scoreFill`, `mdm.scoreAlign`, `mdm.theme`) can be
  honoured: `extendMarkdownIt` runs in the extension host, can read the
  configuration and write it out as classes on the container, though a
  change of setting means refreshing the preview. It would be worth adding
  `"activationEvents": ["onLanguage:markdown"]`, since today the extension
  is only activated by opening the custom editor. The ceiling of this
  route: it matches the scores, not the rest of the Quarto syntax (callouts,
  cross-refs and shortcodes would stay raw) nor the editor's typography.
- **A webview of our own in preview mode** (a "MDM: Open Preview" command)
  loading the same CodeMirror view read-only, with `style.css` and the
  editor's own score rendering.
  It is the only route that gives pixel for pixel equality with the editor
  without duplicating the render pipeline, and it inherits the decorated
  callouts.
- **`quarto preview`** over the temporary `.qmd` that `bin/mdm` already
  generates: fidelity with the real final document, audio and numbering
  included, at the price of a full render per change.

Open decisions: which of the three routes (or which combination) is the
right one; what "the same" means exactly, the same as the editor or the
same as the final HTML, which are not the same thing; and whether the
preview should be editable or read only.

Unchecked, to be measured when this is taken on: whether the CSP of the
Markdown preview lets `ABCJS.synth` download the soundfonts (if not, the
piano is already vendored in `vscode-mdm/media/vendor/soundfont/` and would
serve there too), and whether `previewScripts` guarantees load order (to be
safe, wait for `window.ABCJS` rather than assume it).
