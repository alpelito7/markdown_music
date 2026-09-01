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
serialization step between what is typed and what is saved. What is drawn
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

A fenced block with the class `abc` renders as a score; with `{.abc .play}`
it also carries a player: play, pause, stop, repeat, a draggable progress
bar, volume and mute. The piano is the Musyng Kite soundfont, all 88 notes
vendored with the extension, so playback touches no network. A caret in
the block opens its ABC above the engraving, and while a tune plays a
brass cursor glides across the score and the notes light up under it as
they sound, every voice of them:

![A duet playing with its ABC source open above the engraving: the brass cursor standing across both staves, the two notes it has just reached lit in brass under it, one on each staff, and the player bar underneath, its play button, its progress and its open headphones lit in that same brass](https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/screenshot-player.png)

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
menu offers light, dark, white paper, or any colour theme installed in VS
Code: the syntax colours of the code blocks are read from the theme itself,
Monokai's from Monokai. Staff lines can be drawn grey (Guitar Pro style) or
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

## Notes

- The plain text editor stays available: right click the file, "Open
  With...". Both can be open at once on the same file; they share the
  document.
- Tables are edited as their source, in a monospace grid. Images render for
  paths relative to the document and for `https:` addresses.
- Only the piano is vendored: a different `%%MIDI program` will not find its
  notes.

The format, the Quarto filter that renders it outside VS Code and the full
documentation live in the
[markdown_music repository](https://github.com/alpelito7/markdown_music).
The extension is MIT; what it vendors (abcjs, CodeMirror 6, KaTeX, the
Musyng Kite soundfont) is credited in `THIRD-PARTY-NOTICES.md`.
