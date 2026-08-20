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
  page has loaded.
- **PDF**: the filter engraves each block with `abcm2ps` to EPS, trims the
  BoundingBox to the real ink with ghostscript (abcm2ps writes it at the
  full page width, which shrank the scores when they were scaled), converts
  it with `epstopdf` and inserts it: at text width if it is wide, at its
  natural size and centred if it is narrow (< 330 pt). Results are cached
  by a hash of the content in `mdm_cache/`.

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
document (in the manner of Typora or Office Viewer): text, KaTeX equations
and scores are shown rendered; clicking a block reveals its source, and the
rendering follows every keystroke. It uses the Custom Editors API with
[Vditor](https://github.com/Vanessa219/vditor) in IR mode (vendored,
v3.11.3, works with no network); the ` ```abc ` blocks are engraved by the
abcjs that ships inside Vditor, called from the webview.

Installation: symlink the directory into
`~/.vscode/extensions/alpelito7.mdm-editor-0.1.0` and reload the window
(`Developer: Reload Window`). To go back to the plain text editor: right
click the file, `Open With...`.

Ergonomics (verified with an automated suite in Chrome):

- **Leaving a code block**: `Ctrl+Enter` inserts a paragraph below the
  current block from any position; `Enter` on an empty last line with the
  caret at the end leaves the block and removes that line (the Typora
  gesture). Arrow-down on the last line (Vditor's own) and the "insert
  before/after" toolbar buttons work too.
- **Clicking a score** opens its ABC source with the caret at the end; the
  score is redrawn as you type. abcjs, on its own, paints the note you
  clicked red (`fill="#ff0000"` plus the class `abcjs-note_selected`): that
  is its internal selection, which here was never undone because nothing
  calls its `unhighlight`. The webview clears it, since the click means
  something else here and no function of ours reads that selection. If note
  dragging is ever wired up, that is the hook.
- **Clicking the empty area below the end** of the document adds a
  paragraph and keeps writing.
- **Deleting against an equation or a code block enters it** instead of
  wrecking it. Vditor does not handle forward Delete: with the caret at the
  end of the paragraph above, the browser's native deletion melted the
  source into the paragraph, left the drawing (KaTeX or score) orphaned on
  screen, and the next serialization wrote the text of the glyphs into the
  file. Checked against a bare Vditor 3.11.3, and the same in equations,
  code and scores. That key now opens the block with the caret at the start
  of its source, symmetric to the Backspace from the paragraph below, which
  already entered it (that one is Vditor's and has been left alone, as have
  the arrow keys). Inside an open source, Backspace at the start and Delete
  at the end leave the block rather than dissolving it into a paragraph of
  raw code. Once the source is empty, the next keystroke removes the whole
  block and `Ctrl+Z` brings it back. And a selection covering the whole
  source is deleted by hand, because the native one wrecked it the same way
  Delete did (the comparison is by range positions and not by drawn text:
  `Selection.toString()` comes out empty while the block is shut, measured).

  The `$$` themselves still cannot be edited character by character: lute
  derives the fences again from the structure of the block on every key, so
  the broken-fence state a plain text editor would show simply does not
  exist. To write a new formula, empty the block and type inside it.
  Reaching Obsidian's level there means changing the block editing engine
  (CodeMirror per block, the way the Office Viewer fork does it, or a full
  migration).
- **Export from the toolbar**: the first button opens HTML / PDF / HTML +
  PDF. Each entry saves the document first (which makes export a save as
  well: what reaches the HTML and the PDF is always what is on screen) and
  runs the same `bin/mdm render` as the command line, with a progress
  notice and buttons to open what it produced. `Ctrl+S` still saves as in
  any VS Code editor; "save as" is VS Code's own (File > Save As). The
  renderer is looked up in the `bin/mdm` of the document's workspace and,
  failing that, next to the extension.
- **Undo and redo sit at the head of the toolbar**, after export, as in any
  editor, and with rotating arrows drawn for them (Vditor's were bent
  arrows); the wiring and the disabled state are still Vditor's.
- **Resuming after a pause keeps the beat**: the resuming play restarts the
  sound exactly where it stopped but MUTED, what was left of the cut note
  passes in real silence with the clock running, and the gain comes back a
  hair before the next note attacks, scheduled on the AudioContext's own
  clock (sample accurate): the note that is due lands on its beat, in ink
  and in sound together, the way a conductor counts you in. Nothing of the
  past is heard again (the cut tail stays silenced) and nothing jumps
  ahead. How the design got there: stock abcjs replayed the tail with no
  attack and its cursor painted the NEXT note at once (it restarts its
  clock by advancing the event pointer); the first attempt at a fix jumped
  straight to the following onset, and near a barline the drift between the
  visual clock and the audio could skip a whole bar, besides not waiting
  for the beat. The held ink and the silence share one teardown: pausing
  again, stop, a drag of the bar or closing the player lift it at once (a
  scrub has to sound where it lands).
- **A click outside a block that is open for editing closes it**, at the
  sides too. Above and below already worked, but only because the click
  lands on another block there and the caret goes with it; at the sides
  there is no block to land on, since a block spans the whole width and the
  page has margins of its own (measured: 50 px), so the click landed on the
  editable root and the source stayed open. The webview takes the focus off
  that root, which is the gesture Vditor itself closes an open block with,
  rather than undoing its work from outside. That rule holds for a real
  click only: selecting a long line of ABC with the mouse runs out of the
  block and the button comes up in the margin, and the `click` that arrives
  there has the editable root as its target, exactly like a click beside
  the block. Read as a click, it closed the block and threw away the
  selection just made (the caret jumped to the top of the collapsed score),
  which is what made a whole line impossible to select. The webview
  compares where the button went down with where it came up: if they differ,
  or the pointer moved more than 3 px, the gesture is a drag and is let
  through.
- **Nothing is written in the margins, so nothing is offered there**: in
  the two strips beside the blocks (the padding of the editable root, 50 px
  a side) the pointer stops being a text beam and goes back to the arrow, a
  press does not place the caret, and a click does not open the source of
  the block beside it. It used to: a click 20 px from the left edge took
  the caret to the nearest line and Vditor opened the ABC of the score
  (measured). The one thing that click still does is close a block that was
  open. The strip is told apart from the gap between two blocks, which is
  the root as well and where placing the caret in the line beside it is the
  ordinary thing to do: only a pointer outside the content box counts.
- **Playback**: beside the copy button of every score (both appear on
  hover) there is a pair of headphones that unfolds a player bar under the
  score, with play/pause, stop, repeat, a draggable progress bar and
  volume. Stop is not abcjs's (it has play/pause and repeat only, and a
  pause leaves the tune half way): it is composed of the pause of the play
  button itself, so the widget keeps its state, plus `restart()`, which
  rewinds the clock and the sound to the top. The headphones have a single
  face, and the lit disc behind them says that this score's player is open,
  the way the repeat button does; the tooltip still names the destination
  of the click ("Show player", "Hide player"). They were a speaker until
  the bar got a mute of its own: a struck-through cone in the corner
  meaning "click to hide", beside another struck-through cone in the bar
  meaning "no sound is coming out", are two readings of one drawing.
  Headphones say sound without being a loudspeaker, so the family of the
  cone is left to the mute alone. A real piano sounds without touching the
  network: the 88 notes of the Musyng Kite soundfont (CC BY-SA 3.0) are
  vendored in `media/vendor/soundfont/`, and the synthesis is the vendored
  abcjs 6.7.0, the same engine as the Quarto HTML output. That abcjs is
  fetched by XHR and evaluated with its module/exports pair so that it does
  not overwrite `window.ABCJS`, where the 5.10.3 that engraves the scores
  lives. One player at a time: opening another score's closes the previous
  one. The bar survives edits of its own block and external updates,
  rebuilt paused and on the new source. Only the piano is vendored: a
  different `%%MIDI program` will not find its notes.
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
    engines meet. The colour is brass, the one on the note of the
    extension's icon, and it lives in `--mdm-play-accent` with one value
    per side (`#a0740f` light, `#d9a94f` dark, as the score backgrounds
    do): it paints the class `.abcjs-note_selected` from the stylesheet, so
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
    their face are the toolbar buttons (the theme with its sun and moon,
    the staff lines with "Ink staff lines" and "Gray staff lines"), which
    sit far from what they govern and cannot show their state any other
    way.
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
  - **The caret does not move while the player is used**, and whether it
    sounds at all depends on that: a `<button>` is focusable, so its
    `mousedown` took the focus off the editable root, Vditor answers that
    `blur` by collapsing the open block (and reassigning the range, which
    is what moved the document), and in rebuilding the preview the button
    disappeared between the `mousedown` and the `click`, which never
    reached the synthesizer. That is why the first play after looking at a
    score's source did nothing. The default of `mousedown` inside the bar
    is prevented, except on the form controls, which need the native drag,
    and on the progress bar, which answers the arrow keys once it has been
    clicked. Measured before the fix: no playback and the document shifted
    by 258 px. The volume slider, which does need the focus, goes another
    way: its `blur` is stopped in the capture phase before it reaches
    Vditor's listener (`blur` does not bubble and Vditor listens on the root
    itself, so capture is the only place it can be caught).
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
    shown; the CSS tooltip of Vditor is used instead, the same one the copy
    button has. The volume slider carries `outline: none`: VS Code injects
    a sheet of its own into every webview with `a:focus, input:focus,
    select:focus, textarea:focus { outline: 1px solid
    -webkit-focus-ring-color }` (it is in the preload of the installed
    build), and that system colour is amber in Chromium, so setting the
    volume drew a yellow box. Keyboard focus keeps a mark, in the ink of
    the bar. And the bar stops the propagation of `keyup` as well: it is
    inserted inside the score's `<pre>`, and Vditor keeps a listener there
    that puts the focus back on the editable root, so the first arrow key
    pressed on the progress bar was answered and the focus was lost on the
    release of that same key.
- **Theme menu**: a toolbar button opens, in this order, *Follow VS Code*
  (the default), *Light*, *Dark*, *White* and every colour theme installed
  in VS Code (Monokai, Solarized Light, Abyss and whatever the user
  installs). A named theme brings a syntax palette of its own and a side of
  its own: choosing Monokai leaves the editor dark and Solarized Light
  leaves it light. The setting is still `mdm.theme`, which now takes theme
  names besides `auto`/`light`/`dark`/`white`; the webview does not repaint
  by itself, it asks the host to write the setting, so the choice persists
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

  The ground of the document used to come from Vditor's content theme
  (`#24292e` on the dark side) rather than from the theme, so the code card
  and the ground were two greys from different families.
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
  `#app`. Only hex colours get through the filter: those values end up
  inside the HTML of the webview. With no usable palette (a theme in
  `.tmTheme`, which is not parsed, or the editor forced to the opposite
  side of the VS Code theme with `mdm.theme`) the fallback palettes of
  `style.css` come in: Monokai on the dark side and stackoverflow-light on
  the light one.
- **Score background**: none by default, so that the score reads as part of
  the document the way an equation does. Vditor's content theme paints
  every `<code>` with a wash (a blue box on the dark side) that framed it;
  the extension's stylesheet cancels that. The second to last toolbar
  button, **Score fill**, opens the options (`none`, `paper`, `slate`,
  `brass`, setting `mdm.scoreFill`); each carries a light value and a dark
  one, and the one for the active theme is applied. The other background
  that crept behind the score was the card of code blocks: Vditor puts the
  class `hljs` on the `<code>` of every block it renders again, scores
  included, so from the first edit inside a music block the score sat on
  the card (invisible in a light theme, obvious in a dark one: card
  rgb(52,52,46) on a rgb(36,41,46) ground, measured). The card rule excludes
  `.language-abc` by name, and that also leaves out the `color`, which the
  score does read: the dark content theme paints the shapes inside
  `.language-abc` with `currentColor`.
- **The score fits the width of the panel**: abcjs draws it at a fixed size
  with `width`/`height` attributes and no `viewBox`, so narrowing the
  window shrank the element but not the drawing, and it was cut off at the
  bottom and on the right. The webview adds the `viewBox` and then it
  scales whole. It does not come from those two attributes alone, because
  the abcjs embedded in Vditor (5.10.3) measures the SVG by the engraved
  music only and centres the title above it: with a narrow staff
  (`%%staffwidth 200pt`) the title ran out of the box and lost its first
  and last letter (measured: a box of 266 units, ink from −6 to 272). The
  `viewBox` is the union of the declared box and the real `getBBox()`, so
  nothing is cut and a score that already fitted does not change size. The
  abcjs 6.7.0 on the Quarto side does count the title, checked with the
  same block: this is the editor's business only.
- **Score centred or left aligned**: centred by default, like a display
  equation; the alignment button on the toolbar takes it to the left margin
  and back (setting `mdm.scoreAlign`, `center`/`left`). The icon and the
  tooltip name the destination of the click, as on the theme button. Only
  scores narrower than the panel move: one that takes the whole width looks
  the same either way.
- **Scores set into the text**: spacing identical to a paragraph's
  (verified to the pixel), no red flash when a note is clicked (the SVG is
  transparent to the pointer, the click means "open the source"), and
  narrow ones (`%%staffwidth`) centred like an equation.
- **Staff lines in grey**, Guitar Pro style, which is how they are drawn by
  default: a button of its own on the toolbar (a staff icon, unlit while
  the default holds and lit when the lines go to ink, with a tooltip naming
  the destination of the click) or the setting `mdm.staffLines`
  (`gray`/`ink`); notes, clefs and barlines stay in ink.
- **Copying a block flashes the block, not the page**: Vditor's mechanism
  selects a hidden textarea holding the whole source, and that lights up
  the selection of the entire page for an instant. The webview intercepts
  the click on the copy button of any code block: the source goes to the
  clipboard through the API, nothing is selected, and the confirmation is a
  brief pulse of the block's own background (the code card rises towards
  the text colour and comes back; a score, which has no background, takes
  the accent tint and fades). A score is also copied without its layout
  directives (`%%staffwidth` and the like), which size it for this document
  and mean nothing pasted somewhere else.
- **Quarto callouts decorated**: `::: {.callout-note title="..."}` is no
  longer shown as raw text; the range carries an accent bar and a tint by
  type (note/tip/warning/important/caution) and the `:::` lines are drawn
  small and faint (they stay editable; with the caret inside the paragraph
  they go back to full size).
- **English interface**, tooltips included, drawn downwards.
- **YAML header, shown and editable**: the last toolbar button shows and
  hides it (setting `mdm.frontMatter`, hidden by default; the button is
  disabled if the file has no header). Shown, it is one more block of the
  document: lute parses it as a node of its own (`yaml-front-matter`, the
  YAML in an editable `<code>` between two `---`) and whatever is typed
  there goes to the file. Hidden, the header is kept intact outside the
  editor's model and the host splices it back on save. In both cases the
  host restores the blank line after the closing `---`, which lute removes
  and Pandoc wants; without restoring it, every edit came back one
  character shorter than what was sent and the document and the editor were
  permanently out of sync. The header is shown **coloured**, with the same
  palette as the rest of the code: the editable `<code>` cannot be touched
  (lute reads the content of the block from the first child of that
  `<code>`, so splitting it into highlight spans serializes the first span
  alone and the whole header is lost on the next keystroke, anywhere in the
  document), so the webview gives the block the shape Vditor uses for code
  blocks: the source marked as a *marker*, of zero size while the caret is
  outside, and beside it a read-only `.vditor-ir__preview` with the painted
  copy. When the caret enters, the two swap and the header is edited plain.
  Turning the button on also takes the editor to the top of the file, which
  is where what has just been shown lives. The block is added and removed
  **on its own**, not by rebuilding the document: a full `setValue`
  repaints every block (a blank frame) and engraves every score again, so
  the webview builds the node lute would have produced and inserts it, or
  deletes the one that is there. Only when the incoming text differs in
  more than the header is a full render used.

Round-trip armour (`transforms.js`): Vditor's lute engine truncates the
info-string of a fence at the first space, which destroyed the
` ```{.abc .play} ` blocks. The host translates those fences into one-word
tokens before they enter the editor (`mdm-abc-play`, or `mdm-attr-…` in
base64url for generic Pandoc attributes) and restores them on save; it also
restores the blank line after the front matter that lute removes. Verified:
editing `example.mdm` in the editor and saving leaves the file
byte-identical (apart from what was edited).

The ` ```abc ` blocks with no attributes travel the same way, as
`mdm-abc`, for a second reason: Vditor renders any `.language-abc` block by
itself with an `ABCJS.renderAbc` and no options, and that render would get
ahead of the webview's, which is the one that trims the paddings to
paragraph spacing and asks for the semantic classes the grey staff lines
depend on. Under the token Vditor leaves them alone and `main.js` relabels
them to `.language-abc` when it engraves them. Side effect: a block written
by hand as ` ```mdm-abc ` is saved as ` ```abc `.

Editor limitations: no multicursor, and not for want of wiring it up:
Chromium keeps a single Range per selection in a `contenteditable`
(measured: after adding three, `rangeCount` is still 1 and typing changes
the first one only), so the webview would have to emulate the whole thing;
the way round it meanwhile is Reopen Editor With… → Text Editor, where VS
Code's multicursor works. No editing notes by dragging them with the mouse
(the dragging API of abcjs is the identified route; untested); footnote
definitions are moved to the end of the document on save (semantics
intact); hard line breaks made of two trailing spaces do not survive lute's
round trip; CRLF files are converted to LF on the first save (the fence
armour does work over CRLF); fences with Pandoc attributes inside
blockquotes or deeply indented lists are not armoured (the scanner is
linear): avoid attributes there; if the file changes from outside (git, a
search and replace) while you are typing in the visual editor, what was
typed wins (last writer).

## Known limitations (prototype)

- One tune per `abc` block (only the first is inserted in PDF).
- Playback in HTML downloads the soundfonts from the network the first time
  (the VS Code editor does not: it carries the piano vendored).
- No LilyPond support yet for typographically demanding scores; the natural
  route would be a `lilypond` block the filter compiles the way it does ABC.
- `bin/mdm` renders single files; for a whole book (a Quarto `book`
  project) the chapters would go as `.qmd` with the filter.

## Ideas for later

### A preview identical to the MDM Editor, with audio

The goal: that the preview of an `.mdm` look exactly like the visual editor
and play the ` ```{.abc .play} ` blocks as well. Today VS Code's Markdown
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
  cross-refs and shortcodes would stay raw) nor Vditor's typography.
- **A webview of our own in preview mode** (a "MDM: Open Preview" command)
  loading Vditor with `style.css` and the editor's own `renderScores()`.
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
