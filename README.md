# Markdown Music

A document format for technical writing that mixes mathematics and music:
standard Markdown (with LaTeX equations) plus music blocks in ABC notation
that render as a score. An `.mdm` file with no music in it is valid
Markdown; the music blocks live in fences, so a viewer that knows nothing
about the format shows them as code and nothing breaks.

Implemented as a Quarto extension, which brings everything else for free
(HTML + PDF, theorems, cross-references, bibliography).

The editor for it is a **VS Code extension**, "Markdown Music", published on
the [Marketplace](https://marketplace.visualstudio.com/items?itemName=alpelito7.mdm-editor): it opens an `.mdm` file as a rendered, editable document,
with the equations as KaTeX, the scores engraved in place and a player on the
ones that ask for one, and every part still plain Markdown underneath. Its
source is in [`vscode-mdm/`](vscode-mdm/) and it has [a section of its own below](#visual-editor-for-vs-code-vscode-mdm). The format
does not depend on it: the Quarto filter renders an `.mdm` from the command
line with no editor anywhere.

## Installation

The Quarto filter installs into a project the way any Quarto extension does:

```sh
quarto add alpelito7/markdown_music
```

after which a `.qmd` in that project renders music blocks by declaring
`filters: [mdm]` in its header. The visual editor is a VS Code extension
(below) and installs from the Marketplace or from a `.vsix`; it carries the
filter with it, so it exports with no clone of this repository anywhere.
Cloning the repository is only needed for `bin/mdm`, the render CLI, and for
working on MDM itself.

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
in HTML and in PDF. The unit is best written out (`%%staffwidth 200pt`),
though both engravers read the bare number the same way (measured: abcjs
lays the staff out at about a point per unit, and abcm2ps takes the value
as points and prints it at its default 0.75 scale, so the same directive
comes out a shade smaller under the fallback):

    ```abc
    %%staffwidth 200pt
    X:1
    ...
    ```

A block that names neither its reference number (`X:`) nor its key (`K:`) is
engraved all the same: abcjs, which draws the HTML, the editor and the PDF,
falls back to the empty key signature on a treble staff, and when abcm2ps is
the one engraving the PDF the filter hands it the `X:1` and the `K:C` that
draw the same thing, since the standard makes both compulsory and abcm2ps
engraves nothing without them.

There is no *inline* music notation inside a paragraph (Markdown fences are
blocks); a compact width is the practical equivalent.

Every line break in the ABC body opens a new system, so several lines give
several stacked staves. To label them use the `P:` field rather than an
annotation (`"^text"`): an annotation is attached to the first note and
abcjs reserves the width of the text for it, which opens an extra gap right
there (measured in `example.mdm`: 75 units between the first and the second
note, against 42 everywhere else). With `P:` the notes sit exactly where
they would with no label at all.

### The dialect

The editor reads CommonMark and Quarto reads Pandoc's Markdown, which asks for
a blank line before a heading and before a block quote where CommonMark asks
for none. `bin/mdm` and the export button of the editor render the copy with
those two rules off, so a `### Title` written straight under a paragraph or
under the closing fence of a score is a heading on screen and a heading in the
output. A document that declares a `from:` of its own is rendered in the
dialect it names.

One difference is left standing, and no Pandoc option governs it: Pandoc wants
the `#` in the first column, while CommonMark allows up to three spaces before
it. A heading written with a space in front of it is a heading in the editor
and a paragraph of text in the HTML and the PDF. Rendering a `.qmd` with
`filters: [mdm]` straight from Quarto, rather than through `bin/mdm` or the
editor, gets Pandoc's own dialect and its blank lines.

## How it works

- **HTML**: the Lua filter (`_extensions/mdm/mdm.lua`) emits the ABC source
  and `_extensions/mdm/resources/mdm.js` renders it to SVG with
  [abcjs](https://github.com/paulrosen/abcjs) (vendored, v6.7.0) once the
  page has loaded, on a page dressed as the visual editor (below).
- **PDF**: the filter engraves each block with the same vendored abcjs,
  loaded into a headless Chrome and printed to a vector PDF, then trimmed to
  the ink with `pdfcrop`, so the engraving on paper is the drawing the
  editor and the HTML show. It is inserted at text width if it is wide, at
  its natural size and centred if it is narrow (< 330 pt). A score of more
  than one staff system goes down as one clipped image per system, stacked
  into the drawing it was cut from, so a page break can fall between two
  systems instead of throwing the whole engraving onto the next page. The
  equations go the same way, set by the vendored KaTeX. Results are cached
  by a hash of the content in `mdm_cache/`. Without a Chrome (or without
  `pdfcrop`) the filter names in the render log the tool it missed and falls
  back: the scores to `abcm2ps`, which draws with glyphs of its own and
  reads differently, and the equations to LaTeX's own setting.

### The output looks like the editor

The page a render produces is dressed as the VS Code editor rather than as a
stock Quarto document: the same ground under the document and the same ink on
it, prose at the editor's measure, code on the same cards in the same
colours, scores drawn and filled the same way, and the same player bar under
a `.play` block. `_extensions/mdm/resources/mdm-look.css` is that look, a
port of the editor's own stylesheet (`vscode-mdm/media/style.css`) onto the
HTML Quarto produces; it spends a handful of custom properties, and the
filter writes them into the page from what it is told.

What varies travels as plain metadata. The look keys and the front matter
are what the VS Code extension passes when it exports (`exportLook` in
`vscode-mdm/extension.js`) and a plain `bin/mdm render` does not pass at
all; `mdm-engraver` is the document's own to write:

| Key               | Values                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mdm-look`        | `light`, `dark`, `white`: the side the editor is on, and with it the two grounds, the ink and the accents                                                                                 |
| `mdm-staff-lines` | `gray`, `ink`                                                                                                                                                                             |
| `mdm-score-fill`  | `none`, `paper`, `slate`, `brass`                                                                                                                                                         |
| `mdm-score-align` | `center`, `left`                                                                                                                                                                          |
| `mdm-engraver`    | `abcjs` (the default: the editor's engines, abcjs and KaTeX, through a headless Chrome), `abcm2ps` (the fallback for scores and LaTeX's own maths, picked outright)                       |
| `mdm-front-matter`| `shown`, `hidden`: whether the title block is drawn from the YAML                                                                                                                         |
| `mdm-syn-*`       | the ten syntax slots (`base`, `bg`, `comment`, `string`, `number`, `keyword`, `attr`, `name`, `type`, `variable`), as six hex digits **without** the `#`, which would open a YAML comment |

So a render from a terminal comes out in the editor's default look with the
palette the editor itself falls back to (stackoverflow-light), and one from
the toolbar comes out in whatever the editor was showing, its colour theme
included:

```sh
./bin/mdm render example.mdm --to html \
  -M mdm-look:dark -M mdm-score-fill:paper -M mdm-syn-keyword:f92672
```

Metadata is whatever the command line carried, and these values reach a
`<style>` block, so the filter lets nothing through that is not one of the
words above or six hex digits.

Two things are as close as they get rather than identical, and in both cases
the reason is the engine underneath. The code is tokenized by skylighting
here and by Lezer in the editor, so the palette is shared but the cut into
tokens is not, and a line the two read differently comes out coloured
differently. The equations are set by MathJax here, Quarto's own, against
KaTeX in the editor.

The PDF is dressed from the same metadata, by a LaTeX preamble the filter
writes (`look_tex` in `mdm.lua`, the other half of the stylesheet): the page
takes the ground of the side the editor is on, the text its ink, the headings
its sizes and weight, and code the same card with the same ten slots over it.
The measure travels in ems, the editor's 51.25 of them, centred; on paper too
narrow to hold it the text keeps 3 cm of margin instead. A document that sets
a `geometry`, a `mathfont` or a `fontsize` of its own keeps what it asked for.

Prose breaks where the editor breaks it: the PDF is set ragged right with
microtype's expansion off, the way a browser sets text. A line carrying
inline code can still break elsewhere, since the editor sets code in the
system's monospace and the PDF in DejaVu Sans Mono.

The block Quarto draws at the top from the YAML (the title, the subtitle,
whoever wrote it and when) belongs to the header, so it comes out only when
the header does. An export from an editor that is hiding the YAML
(`mdm.frontMatter`) renders a document that does not open with the block
either; a `bin/mdm render` has no editor behind it and keeps whatever the
document declares.

One thing the render drops rather than dresses: the margin block Quarto adds
with the document's other formats ("Other Formats", one link per format the
header declares). An `.mdm` usually declares both, so every HTML page carried
a link to a PDF that is only on disk if a PDF was asked for as well, and with
`--to html` it pointed at nothing. `bin/mdm` passes `-M format-links:false`
for it, and only when the document says nothing about `format-links`, so a
document that wants the links keeps them by asking for them itself. The
block is furniture of the HTML page; a printed one has no margin column to
put it in.

## Requirements

- Quarto >= 1.4 and a TeX installation (for PDF; `pdfcrop`, `epstopdf` and
  the ghostscript they and the filter lean on all ship with TeX Live).
- Chrome or Chromium (for PDF): it is what draws the scores and the
  equations with the editor's own abcjs and KaTeX. The filter looks for it
  under its common names in the PATH (and in `/Applications` on macOS);
  another binary can be named in the YAML header, and `mdm-engraver:
  abcm2ps` picks the fallbacks outright:

  ```yaml
  mdm:
    chrome: /path/to/chrome
  ```
- `abcm2ps` (for PDF on a machine without a Chrome). Not included: install
  it from the system's packages (Debian and Ubuntu `apt install abcm2ps`,
  macOS `brew install abcm2ps`) or build it from
  [https://github.com/lewdlime/abcm2ps](https://github.com/lewdlime/abcm2ps). The filter looks for
  it at `tools/bin/abcm2ps` beside the document first and then in the PATH,
  so a local build can be dropped there; another path can be set in the
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

Installation: from the VS Code Marketplace (search "Markdown Music"), or
build the package with `npx @vscode/vsce package` inside `vscode-mdm/` and
install the `.vsix` it leaves there (Extensions panel > "..." > "Install from
VSIX..."). For working on the extension itself, a symlink of the directory
into `~/.vscode/extensions/alpelito7.mdm-editor-0.3.0` (the version has to
match the manifest's) and a reload (`Developer: Reload Window`) does the
same. The editor needs nothing else; an export needs Quarto, and a PDF of a
document with scores in it needs TeX and a Chrome (or abcm2ps, the fallback
engraver). To go back to the plain text editor: right click the file, `Open
With...`. Both can be open at once on the same file (Reopen Editor With... in
a second group): they share the document.

What it does:

- **The text is the file.** The editor holds the Markdown of the document and
  nothing else, so every character of it, the `$$` of an equation, the
  backticks of a fence, the `#` of a heading, is an ordinary character: delete
  one `$` of a closing `$$` and the block is a paragraph with three dollar
  signs in it until the fourth is typed back. There is no serialization step
  between what is typed and what is saved, the YAML header while it is hidden
  aside.
- **Rendering follows the carets.** A block no selection range touches is
  drawn: an equation as KaTeX, a score as its engraving, a fence as a card of
  highlighted code. A block a caret is in shows its source, with the rendered
  form under it as a live preview. Every selection range counts, so each of
  several carets opens the thing it edits. An equation whose source KaTeX
  refuses stays as source with a red edge, and shows KaTeX's message while a
  caret is in it.
- **Nobody in it, nothing open.** The carets count only while somebody is in
  the document: with the focus off it every block goes back to its drawing,
  which is the document as it reads. The selection is left as it was, so
  clicking back in resumes at the same caret with the same source open.
  Leaving the window is not leaving the document.
- **Getting in and out.** A click on a rendered equation or score puts the
  caret at the start of its source. The arrow keys walk into a rendered block
  from the line above or below and out again past its last line;
  `Ctrl+Enter` leaves the block the caret is in (a fence, an equation, a
  list, a quote, a callout, a heading) into a fresh paragraph below it. A
  click out in the dead margin puts away what was open.
- **Multicursor**, as in VS Code's own editor: `Alt+click` adds a caret (or
  `Ctrl+click`, following the `editor.multiCursorModifier` setting),
  `Shift+Alt+drag` selects a column, `Ctrl+D` the next occurrence of the
  selection, `Ctrl+Shift+L` every occurrence, `Ctrl+Alt+Up/Down` a caret on
  the line above or below, `Escape` goes back to one. Typing, the formatting
  commands and undo act at every caret at once.
- **Formatting**: `Ctrl+B`, `Ctrl+I` and `Ctrl+E` wrap (or unwrap) each
  selection in `**`, `*` or backticks; `Ctrl+K` makes a link with the caret
  in the address. The toolbar has the same three, a link, a heading button
  that takes each selected line one level up, and bulleted and numbered
  lists. The bar leads with export, then undo and redo, and ends with the
  editor's own buttons: theme, score fill, staff lines, score alignment and
  the YAML header.
- **Export from the toolbar**: HTML / PDF / HTML + PDF. Each entry saves the
  document first, so what reaches the output is always what is on screen, and
  renders it with the Lua filter the extension carries, which is what lets a
  document export from wherever it lives with no clone of this repository
  anywhere. The look of the editor goes with the call (see [The output looks
  like the editor](#the-output-looks-like-the-editor)). `Ctrl+S` still saves
  as in any VS Code editor.
- **Nothing but the export needs anything installed.** The editor carries
  everything it draws and plays, so it opens and works on a machine with no
  Quarto, no TeX, no Chrome and no abcm2ps. Those are looked for the moment
  an export is asked for and never at start-up: whichever is missing is named
  in the notification, with the whole story (the command, Quarto's own
  output) in the MDM output channel, one "Show log" away. A PDF asks for an
  engraver only when the document actually holds a score.
- **Playback**: beside the copy button of every score (both appear on hover)
  a pair of headphones unfolds a player bar under it, with play/pause, stop,
  repeat, a draggable progress bar, volume and mute. A real piano sounds
  without touching the network: the 88 notes of the Musyng Kite soundfont
  (CC BY-SA 3.0) are vendored, and the synthesis is the vendored abcjs. One
  player at a time. While a tune plays the notes light up on the engraving,
  every voice of a duet on its own staff, with a cursor that walks the score
  and can be dragged to seek. Resuming after a pause lands on the beat. What
  is written is what sounds and nothing else: chord symbols in quotes
  (`"Dm7"`) are drawn but not synthesized. Only the piano is vendored, so a
  different `%%MIDI program` will not find its notes.
- **Theme menu**: a toolbar button opens, in this order, *Follow VS Code*
  (the default), *Light*, *Dark*, *White* and every colour theme installed in
  VS Code. A named theme brings a syntax palette of its own and a side of its
  own: Monokai leaves the editor dark, Solarized Light leaves it light. The
  setting is `mdm.theme`, shared by every open `.mdm` editor. The list is
  read when the editor opens.
- **Two backgrounds**, both derived from the chosen theme, and on both sides
  the code rests on the darker of the two, the way a notebook draws its
  cells. *White* is the light arrangement on a blank sheet whatever the theme
  says.
- **Syntax colours inherited from VS Code**: the YAML header and the code
  blocks are painted with the colours of the theme chosen above. The
  TextMate token colours are in no API, so `theme.js` reads the theme itself
  on the host (JSON with comments, the `include` chain, and
  `editor.tokenColorCustomizations` on top) and sends the webview a palette
  of ten colours, spent over the tokens of each fenced language (Python,
  JavaScript, JSON, YAML, HTML, CSS and C++ with full parsers; a couple of
  dozen more with the lighter stream modes). With no usable palette the
  fallbacks of `style.css` come in: Monokai on the dark side and
  stackoverflow-light on the light one.
- **Scores**: no background by default, so a score reads as part of the
  document the way an equation does (`mdm.scoreFill`: `none`, `paper`,
  `slate`, `brass`); centred like a display equation or lined up left
  (`mdm.scoreAlign`); staff lines grey Guitar Pro style or in ink
  (`mdm.staffLines`), with notes, clefs and barlines always in ink; scaled to
  the width of the panel, and narrow ones (`%%staffwidth`) centred.
- **Tables drawn**: a pipe table is set as a table, the maths of its cells
  rendered and each column taking the alignment its second row asks for. A
  caret in one brings the pipes back, in a monospace grid the columns line up
  in, with the drawing below as the live preview; a click on a cell opens the
  source at that cell.
- **Outline panel**: the button leading the bar opens a column down the left
  edge with the headings of the document, indented by level, the section the
  caret is in marked and every row a jump to it. The grip on its edge sets
  how wide it is (`mdm.outline`, `mdm.outlineWidth`).
- **YAML header, shown and editable**: the last toolbar button shows and
  hides it (`mdm.frontMatter`, hidden by default; disabled if the file has no
  header). Shown, it is the first lines of the text, `---` fences included,
  on a card and highlighted as YAML. Hidden, the header and the blank lines
  under it are kept outside the editor's text and spliced back on every save
  (`transforms.js`), so the file is byte-identical around whatever was
  edited.
- **Quarto callouts decorated**: `::: {.callout-note title="..."}` is parsed
  as a block of its own; the range carries an accent bar and a tint by type
  (note/tip/warning/important/caution), and the `:::` lines are drawn small
  and faint until the caret is on them. An unclosed `:::` stays plain text.
- **Copying a block flashes the block, not the page**: the copy button in the
  corner of any code block or score puts the source on the clipboard through
  the API, with nothing selected and the caret left where it was. A score is
  copied without its layout directives (`%%staffwidth` and the like), which
  size it for this document and mean nothing pasted elsewhere.
- **The buttons remember what they were left on.** Every toolbar button that
  holds a state writes it as an `mdm.*` setting instead of repainting itself,
  which is what makes a document open showing what it was closed with and
  keeps two editors on two files in step. Also `mdm.multicursorMatch`, which
  decides whether `Ctrl+D` walks whole words as VS Code does or lands inside
  them too. The one state deliberately left out is the player's volume: it
  lasts as long as the editor is open. Values are written where they already
  live, so a workspace that pinned one goes on overriding the user's own.
- **English interface**, tooltips included. A tooltip names what the click
  leads to rather than the state in force.

The reasoning behind all of this lives beside the code it explains, in the
comments of `vscode-mdm/media/main.js` and `extension.js`.

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
dragging API of abcjs is the identified route; untested); CodeMirror draws
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

The one program that is not vendored is abcm2ps, which engraves the scores
of a PDF on a machine without a Chrome: somebody else's work
(LGPL-3.0-or-later, copyright Jean-Francois Moine, adapted from Michael
Methfessel's abc2ps), called as a separate process and never linked into
anything here. Neither the repository nor the `.vsix` carries the binary;
the search order and the source are in `THIRD-PARTY-NOTICES.md`, and the
LGPL and GPL texts are kept in `licenses/`
for reference. So the `.vsix` is MIT throughout except for the soundfont.

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

A preview that follows the document as it is typed, looking like the visual
editor and playing its ` ```{.abc .play} ` blocks. Half of it is already in
the export, which is dressed as the editor and plays its scores; what is
missing is the loop. VS Code's Markdown preview opens an `.mdm` today (the
extension maps `.mdm` to the `markdown` language id) but renders it with
markdown-it, which knows nothing about ABC, so music blocks come out as code
and Quarto callouts as raw text. Three routes were surveyed: a plugin for
that preview through `markdown.markdownItPlugins`, which is the cheapest and
matches the scores but not the rest of the Quarto syntax nor the editor's
typography; a read-only webview of our own loading the same CodeMirror view,
the only one that gives pixel for pixel equality with the editor without
duplicating the render pipeline; and `quarto preview` over the temporary
`.qmd`, full fidelity at the price of a render per change. Which route, what
"the same" should mean (the same as the editor or the same as the final
HTML, which are not the same thing), and whether the preview should be
editable, are all undecided.
