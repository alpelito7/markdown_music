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

The rule between the two is this: where Pandoc has a switch, or where the
copy that is rendered can be written the way Pandoc wants it, the export
follows the editor; where neither is possible, the editor follows Pandoc. The
document itself is never changed, only the temporary copy Quarto is handed.
That copy is given a blank line before a list, a table, a `***` or a spaced
rule written straight under a line of text, and after a line of dashes under
a list item; a heading set in one to three spaces is brought to the margin,
and so is the underline of a setext heading; a `#` that ends a heading with
no space before it (`## Sonata in F#`) is escaped so that Pandoc keeps it;
and the reader is asked for `autolink_bare_uris`, so an address written bare
is a link on the page as it is in the editor. The YAML header is read as
Pandoc reads it: closed by `---` or `...`, and a `---` over a blank line at
the top of the file is a rule and not a header.

Going the other way, the editor reads what Pandoc reads and CommonMark does
not: footnotes (`[^1]`, `^[inline]` and `[^1]: text`), citations and Quarto's
cross-references (`[@key, p. 3]`, `@fig-x`), attributes (`{#id .class
key=val}` after a heading, an image, a link, a code span or a bracketed span,
an image's `width` applied), bracketed spans (`[text]{.smallcaps}`), raw TeX
(`\command{...}` and `\begin{env}` to `\end{env}`, drawn as the source it is,
since the HTML page leaves it out and the PDF sets it), sub and superscript,
and the punctuation of Pandoc's `smart` extension: curly quotes, an
apostrophe, an en dash for `--`, an em dash for `---` and an ellipsis for
`...`, drawn while a line is untouched with the rules of Pandoc's own reader,
and never inside code, maths, an address, a tag or an escape. A `[text]`
whose label has no definition is text, as Pandoc has it, and `:tada:` is
text too, the export having no emoji extension.

Differences that are left standing, each on the record in `tests/README.md`:
the page's callouts are Quarto's, with a heading and an icon; a numbered list
written `3)` keeps its delimiter in the editor where Pandoc prints a point; a
setext heading written over several lines is a heading in the editor and a
paragraph to Pandoc; Pandoc reads the inside of a `<div>` as Markdown and the
editor draws it as raw lines; a `www.` address with no scheme is text on both
surfaces; and the ways Pandoc's emphasis parts from CommonMark's
(`**Tempo:**Allegro`) are not replicated. Definition lists, line blocks,
lists lettered `a.` or `i.`, grid and simple tables, raw `{=latex}` blocks
and shortcodes are not drawn yet. Rendering a `.qmd` with `filters: [mdm]`
straight from Quarto, rather than through `bin/mdm` or the editor, gets
Pandoc's own dialect and none of the copy's corrections.

## How it works

- **HTML**: the Lua filter (`_extensions/mdm/mdm.lua`) emits the ABC source
  and `_extensions/mdm/resources/mdm.js` renders it to SVG with
  [abcjs](https://github.com/paulrosen/abcjs) (vendored, v6.7.0) once the
  page has loaded, on a page dressed as the visual editor (below). The
  formulas are set by the vendored KaTeX, the one the editor draws with: the
  filter leaves each one as its own LaTeX in a span and sends KaTeX, its
  faces and `resources/mdm-math.js` along with the page as an HTML
  dependency, so a self-contained export carries the engine inside the file.
  Quarto's own default is MathJax from a CDN, which needed the network to
  show a formula at all and set them to widths the editor does not use, so
  the same paragraph broke at a different word on the page than in the
  editor.
- **PDF**: the filter engraves each block with the same vendored abcjs,
  loaded into a headless Chrome and printed to a vector PDF, then trimmed to
  the ink with `pdfcrop`, so the engraving on paper is the drawing the
  editor and the HTML show. It is inserted at text width if it is wide, at
  its natural size and centred if it is narrow (< 330 pt). A score of more
  than one staff system goes down as one clipped image per system, stacked
  into the drawing it was cut from, so a page break can fall between two
  systems instead of throwing the whole engraving onto the next page. The
  equations go the same way, set by the vendored KaTeX. A figure the document
  names is carried across too: one at an absolute path is copied into the
  cache, since Quarto rewrites such a path into a relative one that points at
  nothing, and an SVG is printed to PDF by the same Chrome, since LaTeX
  cannot read one and Quarto's own converter (`rsvg-convert`) is a program
  neither it nor this extension ships. Results are cached by a hash of the
  content in `mdm_cache/`. Without a Chrome (or without
  `pdfcrop`) the filter names in the render log the tool it missed and falls
  back: the scores to `abcm2ps`, which draws with glyphs of its own and
  reads differently, and the equations to LaTeX's own setting.

### The output looks like the editor

The page a render produces is dressed as the VS Code editor rather than as a
stock Quarto document: the same ground under the document and the same ink on
it, prose at the editor's measure, code on the same cards in the same
colours, scores drawn and filled the same way, and the same player controls
on a `.play` block (a page has no toolbar, so there the bar stays under the
score). `_extensions/mdm/resources/mdm-look.css` is that look, a
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

One thing is as close as it gets rather than identical, and the reason is
the engine underneath. The code is tokenized by skylighting here and by
Lezer in the editor, so the palette is shared but the cut into tokens is
not, and a line the two read differently comes out coloured differently.
The equations are the same on both sides: the filter puts the vendored
KaTeX on the page (`ensure_katex_dep` in `mdm.lua`), which is the editor's
own copy.

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
into `~/.vscode/extensions/alpelito7.mdm-editor` and a reload (`Developer:
Reload Window`) does the same. The folder name carries no version: VS Code
reads the version out of the manifest, so a name without one is a name that
does not go stale at the next release. The editor needs nothing else; an
export needs Quarto, and a PDF of a document with scores in it needs TeX and
a Chrome (or abcm2ps, the fallback engraver). To go back to the plain text
editor: right click the file, `Open With...`. Both can be open at once on the
same file (Reopen Editor With... in a second group): they share the document.

What it does:

- **The text is the file.** The editor holds the Markdown of the document and
  nothing else, so every character of it, the `$$` of an equation, the
  backticks of a fence, the `#` of a heading, is an ordinary character: delete
  one `$` of a closing `$$` and the block is a paragraph with three dollar
  signs in it until the fourth is typed back. There is no serialization step
  between what is typed and what is saved, two things aside: the YAML header
  while it is hidden, and the line endings, which are LF in the editor and go
  back to the file's own on the way out.
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
- **Formatting**: `Ctrl+B`, `Ctrl+I` and `Ctrl+E` read what the caret is
  in: inside bold they take the bold off, with no selection they wrap the
  word, beside the closing mark of a pair just typed they step out of it, and
  a selection that crosses paragraphs or list items is wrapped line by line,
  code, equations and raw HTML left alone. `Ctrl+K` makes a link with the
  caret in the address, edits the link the caret is in instead of nesting
  another, and puts a selected address where the address goes. These keys
  and the block keys below are the text's while the caret is in it and do
  not reach VS Code (`Ctrl+B` hid the side bar as well); after a click in
  the margin, with no caret, they are VS Code's. The toolbar
  has the same three, a link, a heading menu that makes every selected line
  a heading of any of the six levels, the caret's level ticked and a
  paragraph again when it is picked twice (it writes no `#` over a list
  marker or a `>`, and turns a setext
  heading into an ATX one), and unordered and ordered lists, which
  turn one kind into the other, come off at a second press, skip blank lines
  and keep a quote's `>`. A task list button puts a box behind the marker a
  line has (a numbered item keeps its number) or makes a bulleted task of a
  line with none, and takes only the box off again; a quote button quotes
  the whole of every block the selection touches (a line left out of a
  paragraph would stay in the quote as a lazy line, a fence or a score would
  be cut in two), with the blank lines between them, and takes one level of
  quote off when every line is quoted already. On an empty line the four of
  them write their marker for the caret to type after, and under a line of
  a paragraph they leave a blank line first, since Pandoc lets neither a list
  nor a quote break into a paragraph. A strikethrough button writes Pandoc's `~~` by
  the rules of bold. After it a pair raises and lowers words, Pandoc's
  `x^2^` and `H~2~O`, and then a highlight writes Pandoc's bracketed span,
  `[word]{.mark}`, which the page writes as `<mark>`: the selection or the
  word at the caret, off again at a second press, and its class joins the
  attribute of a span the words are already in rather than nesting a second
  one (GitHub's `==word==` is a different spelling, which Pandoc does not
  read). A highlight is drawn in a wash of the document's own, the same
  colour in the editor, on the page and on paper, and not in the browser's
  yellow with black letters, which is what `<mark>` is left to itself. An underline button beside it wrote `[word]{.underline}` for a day
  and was taken off again: a bracketed span shows its own class as text in
  any reader that is not Pandoc, and an underline is the typewriter's italic,
  which a document set in Latin Modern has no use for. What the span means is
  still read and drawn here, as the page draws it. A small caps button beside
  the highlight writes the third of those spans, `[word]{.smallcaps}`, its
  two letters of two sizes stacked rather than set in a row, which is what
  keeps the button off the heading button's shape. Neither of the two scripts carries a bare space, so a space inside one is written as
  Pandoc's escaped space (`x^a\ b^`, a no-break space on the page), and
  neither carries a bracket at the head of its content, since `x^[b]^` is an
  inline footnote there. Two tildes are the strikethrough and one is the
  subscript, and the subscript button never writes a pair: over the whole of
  a struck word, which Pandoc would read as the subscript alone, it leaves
  the word as it stands. The bar stands in two rows, and the first
  closes with six buttons for what a document holds beside its words: an
  equation, an equation block, a table, a picture, a footnote and a
  horizontal rule. The second row begins under the outline button, with
  everything that switches the document as a whole. The
  equation button wraps the selection in `$…$` and takes the dollars off again;
  the equation block, the table (two columns and three rows) and the rule
  (`***`, the one form that may stand under a line of text) are written
  where the code block button writes its block; the picture button is the link
  gesture with a `!` in front, so a selected file name goes where the
  address goes; and the footnote button writes the reference after the words
  the caret is in, numbered with the lowest number the document has not
  used, and opens its note at the end of the document, the only place Pandoc
  reads one from. Across the bar's
  separator from inline code, a code block button, also
  `Ctrl+Shift+C` (`⌥⌘C` on a Mac): on an empty line it opens a block with
  the caret after the opening backticks, where the language is typed (`abc`
  makes it a score), under the paragraph the caret is in otherwise, around
  the lines selected, and from inside a block it takes the fences off. A
  button that acts on the selection leaves the caret in the block it was in.
  What is worth a key has one, on one modifier: `Ctrl+Shift+0` to
  `Ctrl+Shift+6` for a paragraph and the six heading levels, the digit being
  the level, and `Ctrl+Shift+C` and `Ctrl+Shift+T` for the code block and
  the task list (`Cmd+Option` on a Mac, where the system takes `Cmd+Shift`
  with a digit for its screenshots). The bullets, the numbers and the quote
  had `U`, `O` and `Q` for a day and have no key: `- `, `1. ` and `> ` are
  so little to type at the head of a line that the chord bought nothing, and
  `Ctrl+Shift+U` is the desktop's on Linux before it is any editor's, where
  fcitx5's unicode addon opens its `U+` prompt on it. Strikethrough, small
  caps, the superscript and subscript pair and the six of the Insert group
  have none either. The bar leads with the outline, then export, then undo
  and redo, and the second row is the editor's own: multicursor, theme,
  font, alignment, hyphenation and the YAML header, then score fill, staff
  lines and score alignment, and the playhead toggle last.
- **The keys of a Markdown editor.** `Enter` continues a list, a task (left
  unchecked) or a quote, ends the list at an empty item with a blank line
  under it so that the next line is a paragraph, unnests an empty nested
  item, opens a line above a heading when pressed at the head of its text,
  keeps the `>` inside a fence that stands in a quote, and answers each of
  several carets on its own; it takes no no-break space with it. `Backspace`
  after the `## ` of a heading or after a list marker takes the whole mark,
  beside a rendered block it opens the block instead of eating its line
  break, and an emoji with a skin tone goes as one glyph. `Tab` and
  `Shift+Tab` nest and unnest a list item with its children, by the width of
  the marker above it, the numbers following; in prose `Tab` writes a tab in
  the middle of a line and nothing at its head, where it would make the line
  code.
- **Clicks.** A click on a bullet or a number puts the caret after the
  marker; a task's box is ticked by a click, in a quote and after `1)` as
  well; `Ctrl+click` on a link follows it (`Alt+click` where
  `editor.multiCursorModifier` gives `Ctrl+click` to the carets): an address
  opens outside, a relative path opens in VS Code, and `#heading` moves the
  caret to that heading. A click into a document that did not have the focus
  places a caret and selects nothing, and a double click selects the word.
- **Lists, quotes and callouts are drawn as the page draws them**: an item's
  text hangs under itself with the marker in the gap, numbers are the ones
  the list counts, a quote inside a quote and a callout inside a quote wear
  one bar per level, and a table, an equation, a rule or a score inside any
  of them stands inside the frame. Whitespace a reader drops is not drawn: a
  paragraph or a heading set in a space or three, the columns of indented
  code, the indent a fence shares with its body.
- **Links and images by reference** (`[text][label]`, `[label]`) know their
  definition, which is drawn faint; an image alone in its paragraph is a
  figure with its alt as the caption, as on the page; entities are drawn as
  the character they stand for and an escape without its backslash; a hard
  line break is marked at the end of its row. A soft break stays a row of
  its own while editing, as in Typora and Obsidian, where the page runs the
  lines on.
- **Characters that draw nothing** (a bidi override, a zero-width space, a
  soft hyphen) are left to the page's own drawing while a line is read, and
  named by a mark with a tooltip on the line the caret is on.
- **Search** opens with `Ctrl+F` wherever the focus is, and a match inside a
  rendered block opens the block. A YAML header that is hidden is not in the
  editor's text, so it is not searched.
- **Two writers of one file.** A change made by the text editor beside this
  one, or by the host, is merged with what is being typed here instead of
  one overwriting the other, lands where it was made, and stays out of this
  editor's undo; `Ctrl+S` waits for the keystrokes still held back; and the
  file is written over the stretch that changed, not rewritten whole.
- **Long documents.** A caret move or a keystroke rebuilds the drawing of the
  blocks it reaches and keeps the rest: on a file of 22 800 lines that is
  about 25 ms where it was over 100. A line added or taken out still redraws
  the whole, since every number below it moves.
- **Export from the toolbar**: one button with two branches, named in the
  panel. *Document* is HTML / PDF / HTML + PDF: each entry saves the document
  first, so what reaches the output is always what is on screen, and renders
  it with the Lua filter the extension carries, which is what lets a document
  export from wherever it lives with no clone of this repository anywhere. The
  look of the editor goes with the call (see [The output looks like the
  editor](#the-output-looks-like-the-editor)). *Audio* is MIDI / WAV, one file
  per score: it writes every score of the document at once, beside it, which
  is what a score's own button does for the one score it stands by (below). It
  saves nothing first, because what it writes is the music on screen, and in a
  document with no score its two rows are greyed out and take no press.
  `Ctrl+S` still saves as in any VS Code editor.
- **Nothing but the export needs anything installed.** The editor carries
  everything it draws and plays, so it opens and works on a machine with no
  Quarto, no TeX, no Chrome and no abcm2ps. Those are looked for the moment
  an export is asked for and never at start-up: whichever is missing is named
  in the notification, with the whole story (the command, Quarto's own
  output) in the MDM output channel, one "Show log" away. A PDF asks for an
  engraver only when the document actually holds a score.
- **Playback**: under the copy button of a score (the two stand in the margin
  right of the text, beside the top of the score, while the pointer is on it
  or its source is open) a pair of headphones
  opens a player in the toolbar, as a row of its own under the buttons, with
  play/pause, stop, repeat, a draggable progress bar,
  volume and mute. It sits there rather than under the score because a score
  can be a page long: the controls stay in view whatever part of the music
  the reader is looking at, and the progress runs the width of the pane. The
  headphones of the score being played stay up and lit while its player is
  open, which is what says which one it is. A real piano sounds
  without touching the network: the 88 notes of the Musyng Kite soundfont
  (CC BY-SA 3.0) are vendored, and the synthesis is the vendored abcjs. One
  player at a time. While a tune plays the notes light up on the engraving,
  every voice of a duet on its own staff, with a cursor that walks the score
  and can be dragged to seek. The page keeps the staff system that is sounding
  whole on the pane, and asks nothing more of it: a system showing top to
  bottom is one the reader can follow, wherever on the pane it sits, so a
  score that fits the pane is never scrolled, a play made with the score
  already in front of the reader moves nothing, one made with it under the
  fold brings the page to the head, the page is still while a line of music is
  played (the head does not go down the page inside a system), a page taken
  away from the music comes back at once, and a pause hands it back for good.
  A toolbar toggle (`mdm.followPlayhead`) turns all of that off, and then the
  music never moves the page at all, which is what it takes to leave a long
  score sounding while the document around it is read.
  Resuming after a pause lands on the beat. What
  is written is what sounds and nothing else: chord symbols in quotes
  (`"Dm7"`) are drawn but not synthesized. Only the piano is vendored, so a
  different `%%MIDI program` will not find its notes.
- **Export of a score's audio**: under the headphones, a third button in the
  same rail, drawn with the toolbar's export glyph, writes that score as MIDI
  or as WAV beside the document, named after it: the third score of
  `tunes.mdm` with `T:The Kesh` is written as `tunes 3 - The Kesh.mid`, and
  one with no title as `tunes 3.mid`. The number is the score's place among
  every score of the document, drawn on screen or not, so a score keeps its
  own number whichever button asked for the file. It is not padded, so past
  nine scores a file manager does not sort by it. Nothing is asked before an existing file of that name is
  written over, as with the HTML and the PDF, and the audio is made from what
  is on screen, unsaved edits and all, so the document is not saved first.
  Neither format needs anything installed.
  The WAV is the piano of the player, rendered from the same samples at the
  rate the machine's output runs at, which is about 30MB for three minutes.
  The MIDI is the written notes, at the tempo the editor plays them at: abcjs
  writes the tempo of a meter whose denominator is not 4 or 8 wrongly (2/2 and
  3/2 at half speed, 6/4 and 9/4 at a half or a third, 3/16 four times too
  fast), leaves a staccato note hanging above about 95 beats a minute, and
  puts the program change of every voice on channel 0; the editor corrects all
  three, so its MIDI is not byte for byte what abcjs would write. A score the
  vendored piano cannot sound, because it asks for another `%%MIDI program`,
  for the drums or for a note above C8, is left out of a WAV run and named in
  the notification, with what to do about it: that same score exports as MIDI,
  which carries the program number and asks for no samples at all. MP3 is not offered: no browser can encode it.
  The exported page has no rail of buttons, so it has no audio export either.
- **Theme menu**: a toolbar button opens, in this order, *Follow VS Code*
  (the default), *MDM Light*, *MDM Dark*, *MDM White* and every colour theme
  installed in VS Code. The first three are the editor's own looks, which is
  what the name says: no theme paints them, so one of them is the same editor
  on any machine, and the palettes baked into `style.css` are what they wear.
  The entries under them are themes by their own names, and a named one brings
  a syntax palette of its own and a side of its own: Monokai leaves the editor
  dark, Solarized Light leaves it light. The
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
  dozen more with the lighter stream modes). With no usable palette, and on
  the three MDM looks whatever the palette is, the fallbacks of `style.css`
  come in: Monokai's colours on the dark side and
  stackoverflow-light on the light one. The ground under the dark one is not
  Monokai's own olive but the `editor.background` of Dark 2026, `#121314`, so
  MDM Dark stands where the text editor beside it stands.
- **The face of the text**: the document is set in Latin Modern Roman, the
  face TeX sets a document in, which the extension carries as four woff2 files
  (191 KB). Nothing is installed for it and no LaTeX is involved: the equations
  beside it were already drawn in those shapes, KaTeX's own faces being
  Computer Modern, so the words and the maths of a page are one design rather
  than two. A toolbar toggle (`mdm.textFont`) hands the text back to the
  interface sans of the system. Only the text moves: the toolbar, the menus and
  the outline panel stay in the sans, and code, the numbers in the margin and
  the source of an open block keep their monospace.

  It is drawn at the reading size the sans had, not at the size it is asked
  for. What a reader sees as the size of a text is its x-height, and Latin
  Modern's is 0.431 em against the sans's 0.528, so at a bare 16 px it reads
  about a fifth small and pulls the page out of proportion with it: the
  headings are ems of that same 16 px and keep their size, and the text abcjs
  draws inside a score is its own pixels and no em of ours. In the editor,
  `font-size-adjust` fixes all three at once, leaving the computed size at
  16 px, so every em of the stylesheet stays where it was, and scaling the
  glyphs until their x-height is the sans's. The exported page carries the
  equivalent adjustment on each embedded font face: unlike an inherited
  `font-size-adjust`, Chrome preserves that scale when it prints the page to a
  PDF without TeX. The maths keeps KaTeX's own 1.21, which is the compensation
  a Computer Modern needs beside a sans and is exactly right for a page set at
  the sans's x-height; the engraving keeps its own pixels. With TeX, the roman
  is what LaTeX is already set in and fontspec applies the same scale.
- **Justified prose**: paragraphs, list items and quotations are set to both
  edges of the column, every row but the last, with the spaces widened as the
  text is typed; a toolbar toggle (`mdm.textAlign`) sets them ragged right.
  Headings and the source of a block stay ragged. Chromium justifies a row
  after choosing where it breaks, so the words each row ends on are the same
  either way, and the exported page ends them there too. On paper TeX
  justifies the whole paragraph at once and may take a word more into a row,
  which it does on two rows of `example.mdm`. The score alignment toggle beside
  it draws a quarter note between two lines of text, so the two alignments of
  the bar do not look alike.

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
  source at that cell, and the page is held where it was instead of sliding
  down by the height the source took.
- **Outline panel**: the button leading the bar opens a column down the left
  edge with the headings of the whole document, however long, indented by
  level, the section the caret is in marked and every row a jump to it. A row
  reads as the editor draws the heading: marks off, a link as its label,
  maths set, a closing sharp kept (`Sonata in F#`), attributes left out.
  Headings inside quotes and list items are listed, as VS Code's own outline
  lists them and Pandoc's contents do not. The grip on its edge sets how wide
  it is (`mdm.outline`, `mdm.outlineWidth`).
- **YAML header, shown and editable**: the YAML button on the second row,
  after the hyphenation menu, shows and hides it (`mdm.frontMatter`, hidden
  by default; disabled if the file has no header). Shown, it is the first lines of the text, `---` fences included,
  on a card and highlighted as YAML. Hidden, the header and the blank lines
  under it are kept outside the editor's text and spliced back on every save
  (`transforms.js`), so the file is byte-identical around whatever was
  edited.
- **Quarto callouts decorated**: `::: {.callout-note title="..."}` is parsed
  as a block of its own; the range carries an accent bar and a tint by type
  (note/tip/warning/important/caution), and the `:::` lines are drawn small
  and faint until the caret is on them. An unclosed `:::` stays plain text.
- **Copying a block flashes the block, not the page**: the copy button of a
  code block, a display equation or a score, in the margin right of the text
  beside the block the pointer is on or whose source is open, puts the source
  on the clipboard through
  the API, with nothing selected and the caret left where it was (the formula
  of an equation as written between its `$$`). A score is
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
- **Word division is the exception, and belongs to the document.** A reader
  keeps documents in several languages, so `mdm.hyphenation` is where a
  document starts and each document then remembers whether its words divide:
  the host keeps that in the extension's own storage (VS Code's
  `globalState`) under the document's URI, out of the file and out of
  `settings.json`, and an export divides the words the document it came from
  divides. The memory goes by the file's path, so a file renamed or moved
  starts again on the setting, and the 500 documents used last are kept.
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
only the part of the document in view, so a score that scrolls far off screen
keeps sounding with nothing lit, no cursor and no page turning until it comes
back (the player itself stays in the toolbar and answers throughout); if the
file changes from outside (git, a search and replace) while you are typing
in the visual editor, what was typed wins (last writer), and an outside
change that arrives between keystrokes is merged at the stretch that
differs, carets and undo history kept.
## Licence

MDM is MIT (`LICENSE`). What it vendors is credited one by one in
`THIRD-PARTY-NOTICES.md`, with the version of each copy actually in the tree:
abcjs 6.7.0, CodeMirror 6 with its Lezer packages, and KaTeX 0.18.4 are all
MIT. Three things are not. The piano the editor plays with is the Musyng
Kite soundfont, CC BY-SA 3.0, included unmodified, so the notice is the
attribution the licence asks for. The roman the prose and the scores are set
in is Latin Modern Roman 2.004, four woff2 files under the GUST Font
Licence, which is LPPL 1.3c with a renaming clause the notice names. The
words a document is divided at come from the hyph-utf8 patterns, which are
MIT but for Portuguese (BSD-3-Clause) and Russian (LPPL 1.3c).

The one program that is not vendored is abcm2ps, which engraves the scores
of a PDF on a machine without a Chrome: somebody else's work
(LGPL-3.0-or-later, copyright Jean-Francois Moine, adapted from Michael
Methfessel's abc2ps), called as a separate process and never linked into
anything here. Neither the repository nor the `.vsix` carries the binary;
the search order and the source are in `THIRD-PARTY-NOTICES.md`, and the
LGPL and GPL texts are kept in `licenses/`
for reference. So the `.vsix` is MIT but for the three above: the soundfont,
the Latin Modern faces and the hyphenation patterns.

## Known limitations (prototype)

- One tune per `abc` block (only the first is inserted in PDF).
- Playback in HTML downloads the soundfonts from the network the first time
  (the VS Code editor does not: it carries the piano vendored).
- No LilyPond support yet for typographically demanding scores; the natural
  route would be a `lilypond` block the filter compiles the way it does ABC.
- The exported HTML matches the editor as far as two different tokenizers
  let it: the code is highlighted by skylighting rather than by Lezer, so
  the palette is shared while the cut into tokens is not. Callouts are left
  to Quarto as well, which draws them with a heading and an icon where the
  editor draws an accent bar over the source.
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
