# Markdown Music

Markdown you read and write in the same window: prose with its
**emphasis**, LaTeX equations, source code, and music blocks that engrave
as a score and play it back. The editor around them is a full one, with
multicursor, an outline down the left edge, a look set from the toolbar and
an export to HTML or PDF.

The music is written in [ABC notation](https://abcnotation.com/wiki/abc:standard:v2.1) inside ordinary fenced blocks, so an
`.mdm` file is valid Markdown throughout and any other editor shows it as
code with nothing broken. Every part is drawn in place and every part is still
plain text underneath.

A document to open it on: **[example.mdm](https://github.com/alpelito7/markdown_music/blob/main/example.mdm)**, the sample of the project, with
equations, code, scores and player. Download it from the [raw file](https://raw.githubusercontent.com/alpelito7/markdown_music/main/example.mdm), save it
anywhere with the `.mdm` extension and open it in VS Code: it comes up
in this editor.

![An equation and a score rendered in the editor, dark side](https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/screenshot-dark.png)

## How it edits

The editor holds the Markdown of the document and nothing else. Every
character, the `$$` of an equation, the backticks of a fence, the `#` of a
heading, is an ordinary character that can be typed and deleted; there is no
serialization step between what is typed and what is saved, beyond the line
endings, which are LF in the editor and go back to the file's own when it is
written. What is drawn
where follows the carets, the way Obsidian's live preview does:

- A block no caret touches is rendered: an equation as KaTeX, a score as its
  engraving, a fenced block as a card of highlighted code, bold as bold.
- A block a caret is in shows its source, with the rendered equation or the
  score kept under it as a live preview. Every caret counts, so each of
  several opens the thing it edits.
- An equation whose source does not compile stays as source with a red edge,
  and shows KaTeX's message while it is edited; the moment it compiles, it
  renders.

Multicursor works as in VS Code's own editor: `Alt+click` adds a caret
(following the `editor.multiCursorModifier` setting), `Shift+Alt+drag`
selects a column, `Ctrl+D` takes the next occurrence, `Ctrl+Shift+L` every
one, `Escape` goes back to one caret. `Ctrl+B`, `Ctrl+I`, `Ctrl+E` and
`Ctrl+K` format each selection, and the toolbar carries the same commands
with heading and list buttons beside them.

## Music that sounds

A fenced block with the class `abc` renders as a score; the headphones in its
corner open a player in the toolbar, as a row of its own under the buttons:
play, pause, stop, repeat, a second pair of headphones that shuts the player
again, a draggable progress bar, volume and mute. It sits up there rather than
under the score because a score can be a page long, and the controls should
not have to be scrolled to. Dragging the progress head brings the pane to the
part that is sounding, so scrubbing through a long score is something you can
watch, and a tune left to play is followed the same way: the page keeps the
staff system that is sounding whole on screen and asks nothing more of it, so
it is still while a line of music is played, a play made with the score under
the fold brings the page to the head and one made with it already in front of
you moves nothing, a page you take away from the music comes straight back,
and a pause hands it to you for good. A toolbar toggle turns the whole of that
off, and then a long score can sound while you read past it, since the music
never moves the page. The piano is the Musyng Kite soundfont, all 88 notes vendored with the
extension, so playback touches no network. A caret in the block opens its ABC
above the engraving, and while a tune plays a brass cursor glides across the
score and the notes light up under it as they sound, every voice of them:

![A duet playing with its ABC source open above the engraving: the player bar across the top of the toolbar, under the row of buttons, with its pause button, its lit headphones and the played half of its progress in brass; below, the brass cursor standing across both staves, the two notes it has just reached lit in brass under it, one on each staff, and the lit headphones of the block that is sounding](https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/screenshot-player.png)

    ```{.abc .play}
    X:1
    T:C major scale
    M:4/4
    L:1/8
    K:C
    CDEF GABc | cBAG FEDC |]
    ```

A short score can fix its own width with `%%staffwidth 200pt` as the first
line of the block, and it is then set compact and centred, the way a display
equation is.

Opening a score's source shows the ABC itself highlighted, and the block is
read the way the engraving under it is drawn: the staff and its bar lines in
ink, the field labels with them, and the notes in the brass of the note in
this extension's icon, the same brass a note lights up in while it sounds.
Around them the rest of the family: accidentals and the key and meter a
step lighter, note lengths in copper, ornaments in olive, titles and lyrics
as text, rests and comments quiet. ABC is the extension's own notation, so
these colours are its own on both sides, light and dark, whatever theme
paints the code around them.

## Themes

The editor follows the VS Code theme by default, and the toolbar's theme
menu offers MDM Light, MDM Dark, MDM White (the light look on a sheet of
paper), or any colour theme installed in VS Code. The three MDM looks are the
editor's own and no theme paints them; pick a theme by name instead and the
syntax colours of the code blocks are read from the theme itself, Monokai's
from Monokai. Staff lines can be drawn grey (Guitar Pro style) or
in ink, scores can take a paper, slate or brass fill, and every toolbar
state persists as an `mdm.*` setting, so a document reopens the way it was
left.

## Export

The export button renders the document to HTML, PDF or both through
[Quarto](https://quarto.org), and both come out dressed as the editor they
were exported from: the HTML with its theme, palette and players, the PDF with
the same ground, ink, headings, measure and code cards on the page, and its
scores engraved in the same colours, staff lines and fill included. The title
block belongs to the YAML header: it comes out only if the header is on screen
when the export is asked for. The document is
read in the dialect the editor reads, so a heading written straight under a
paragraph or under a score is a heading in the output as well. The editor itself
needs nothing installed: Quarto (>= 1.4) is looked for only when an export
is asked for, a PDF needs a TeX installation, and a PDF of a document with
scores needs Chrome or Chromium, into which the export loads the editor's
own abcjs and KaTeX, so the scores and the equations in the PDF are the
very drawings the editor shows (without a Chrome the scores fall back to
[abcm2ps](https://github.com/lewdlime/abcm2ps), Debian and Ubuntu
`apt install abcm2ps`, macOS `brew install abcm2ps`, whose engraving reads
differently, and the equations to LaTeX's own setting). Whichever is
missing is named in a notification, with the full story one "Show log"
away.

## Settings


| Setting                | What it holds                                                              |
| ------------------------ | ---------------------------------------------------------------------------- |
| `mdm.theme`            | `auto`, `light`, `dark`, `white`, or the name of an installed colour theme |
| `mdm.staffLines`       | `gray` or `ink`                                                            |
| `mdm.scoreFill`        | `none`, `paper`, `slate`, `brass`                                          |
| `mdm.scoreAlign`       | `center` or `left`                                                         |
| `mdm.frontMatter`      | whether the YAML header is shown in the document                           |
| `mdm.outline`          | whether the outline panel is open                                          |
| `mdm.outlineWidth`     | the outline panel's width in pixels                                        |
| `mdm.multicursorMatch` | whether `Ctrl+D` matches whole words or inside them                        |
| `mdm.followMusic`      | `follow` or `still`: whether the page keeps up with a sounding tune        |

## Notes

- The plain text editor stays available: right click the file, "Open
  With...". Both can be open at once on the same file; they share the
  document.
- Tables are drawn, with the maths of their cells set and the alignment
  their second row asks for; a caret in one brings back the pipes, in a
  monospace grid, with the drawing below as the preview.
- Images render for `https:` addresses and for local paths, relative to the
  document or absolute. A click on a figure opens its source, as it does on a
  score or an equation. An export carries the figure with it: one named by an
  absolute path is copied beside the output, and an SVG is printed to PDF for
  the paper by the same headless Chrome that engraves the scores.
- The formulas of an exported page are set by the KaTeX this extension
  carries, the one the editor draws with, sent along with the page: it asks
  nothing of the network, breaks its lines where the editor does, and a
  self-contained export carries the engine inside the file.
- Only the piano is vendored: a different `%%MIDI program` will not find its
  notes.

The format, the Quarto filter that renders it outside VS Code and the full
documentation live in the
[markdown_music repository](https://github.com/alpelito7/markdown_music).
The extension is MIT; what it vendors (abcjs, CodeMirror 6, KaTeX, the
Musyng Kite soundfont) is credited in `THIRD-PARTY-NOTICES.md`.
