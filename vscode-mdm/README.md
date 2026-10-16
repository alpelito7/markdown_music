# Markdown Music

Markdown Music is an editor for `.mdm` files: Markdown with equations, code and playable scores, drawn as you write. Scores are written in [ABC notation](https://abcnotation.com/wiki/abc:standard:v2.1) inside a ```` ```abc ```` block, so the file stays plain Markdown. To try it, download **[example.mdm](https://cdn.jsdelivr.net/gh/alpelito7/markdown_music@main/example.mdm)** (or [read it on GitHub](https://github.com/alpelito7/markdown_music/blob/main/example.mdm)), save it with the `.mdm` extension and open it in VS Code.

<!-- clip: tour -->
![The toolbar sets the document in Latin Modern, switches it to MDM Light, draws the staff lines in ink and lets Ctrl+D match inside words. A click on the score opens its ABC, and Ctrl+D selects its four E's, which typing turns into E flats an octave up while the drawing follows. The player sounds the edited tune with a brass playhead on the staff, and the score's export button offers it as MIDI or WAV.](https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/clip-tour.gif)

## Writing a score

With a caret inside a score's block, the editor shows its ABC in the extension's colours and the score drawn under it, as below; the grey comments say what each line does.

<img src="https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/abc-card.png" alt="A score block as the editor shows it with a caret inside, its ABC coloured and the score engraved under it. X:1 % reference number, the first line of a tune / T:Four bars % title / M:4/4 % metre / L:1/8 % unit note length: a plain letter is an eighth / Q:1/4=100 % tempo, in quarter notes a minute / K:C % key, the last line of the header / % C is middle C and c the octave above; a 2 after a note doubles its length / % ^ sharp, _ flat, = natural, z a rest, [CEG] a chord, |] the end / CDEF GABc | c2 B2 A2 G2 | ^F2 _B2 =B2 z2 | [CEG]8 |]">

Repeats, ties, lyrics, several voices and the rest of the notation are in the [ABC standard](https://abcnotation.com/wiki/abc:standard:v2.1). The headphones on a score open a player, whose piano comes with the extension and is the only instrument it has. Under them, a third button writes that score's audio beside the document as MIDI or as WAV: the WAV is the piano you hear, the MIDI the notes at the tempo the editor plays them at, and neither needs anything installed. A block fenced as ```` ```{.abc .play} ```` also gets a player on the exported page.

## Writing Markdown

<!-- clip: markdown -->
![In Latin Modern on MDM Light, the Page menu justifies the text, and English chosen under Hyphenation divides its words and writes lang: en into the YAML header, which the YAML header row shows and hides. Three words turn bold as two asterisks are typed over them, three lines become a list, a phrase is highlighted, a table is filled cell by cell and a pasted picture is saved beside the document. Under an equation numbered at the margin, a citation typed as its key is drawn as the page prints it, and a click on its work, listed at the end, opens the bibliography beside the document at its entry.](https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/clip-markdown.gif)

The text is the file, and the editor reads it as the export does: Pandoc's Markdown, with CommonMark's blank lines. Lists, quotes, callouts, tables, footnotes, numbered equations, figures, tables and sections are drawn in place, and a line shows its source while the caret is on it. With a bibliography in the header and Quarto installed, a citation reads as the page prints it, "Knuth (1984)". A pasted picture is saved in a folder beside the document. `Ctrl+B` and `Ctrl+I` mark words, `Ctrl+1` to `Ctrl+6` set a heading's level and `Ctrl+F` searches.

## Score navigation

<!-- clip: score-navigation -->
![With Score navigation on, a click puts a cursor on an empty organ score and the keys write it: 3, 2 and 1 a quarter, a half and a whole note where the arrows stand, Alt or Ctrl with them a note after or before, Ctrl+↓ the part below and Enter a second note in a chord. Ctrl+Shift with the arrows selects two bars in all three parts and walks up to the left hand, which Space leaves out, and Ctrl+C and Ctrl+V copy the right hand and the pedal into the next two bars. The end of the line, dragged to a barline, sets the four bars on two lines, and Space plays the second as the mode is left.](https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/clip-score-navigation.gif)

**Score navigation**, the first row of the **Score** menu, freezes the text and gives the keys to the scores: a cursor stands on a staff, and what is written there is written into the score's ABC. The row again gives the text back.

| Keys | What they do |
|---|---|
| `←` `→`, `↑` `↓` | Walk the cursor along its part, and up and down the staff. A click puts it where it is made. |
| `Ctrl+↑` `↓`, `Ctrl+Shift+↑` `↓` | The staff above or below; with nothing selected, the same part a line away. |
| `1` to `7`, `0` | Write a note where the cursor stands, from a whole note down to a sixty-fourth, or a rest. |
| `Ctrl` or `Alt` with them | Put it in before the cursor's note, or after it. |
| `Enter`, `Delete`, `Backspace` | Add a note to a chord, and take one or a rest out; `Backspace` steps back. |
| `Shift+←` `→` | Select in the cursor's part; with `Ctrl`, in every part. |
| `Ctrl+Shift+↑` `↓` `Space` | With a selection: walk the parts, and leave one out or take it back. |
| `Ctrl+A`, `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+Z` | Select all, copy, cut, paste, undo. |
| `Space` | Play from the cursor, or the selection alone. |
| `Ctrl+←` `→` | Add a bar beside the cursor's, or beside a selection in its parts. |

With the pointer on a score, two arrows at the end of each line send its last bar down or bring the next one up, or drag to any barline, and a `+` under a barline adds a bar.

## The toolbar

One row. The button at its left opens the outline of the headings, and seven words each open a menu. A row of a menu names its key where it has one, and a row that is a switch is ticked while it is on.

- **Edit**: undo and redo, find and replace, the carets and the lines. `Ctrl+D` adds the next match of the selection, whole words only unless **Match inside words** is ticked. `Alt+click` adds a caret.
- **Format**: the marks on words, from bold to a link and inline code.
- **Paragraph**: the heading levels, the code block, the lists and the quote.
- **Insert**: an equation, a table, a picture, a footnote, a rule, a music symbol.
- **Page**: settings shared by every document, except the hyphenation, which each file keeps.
  - **Theme**: follows VS Code by default; MDM Light, MDM Dark and MDM White are the editor's own.
  - **LaTeX font**: Latin Modern Roman, the face of a LaTeX document, which comes with the extension; turned off, the system's sans. Code keeps its monospace.
  - **Justified text**: paragraphs justified, or ragged on the right. The lines break on the same words either way.
  - **Hyphenation**: words stay whole until a language is chosen here. It is written into the YAML header as `lang:`, in a new, hidden header if the file had none; the hyphen is only drawn, never saved.
  - **YAML header**: a header with a title, an author or an abstract is drawn as the page's title block, and a click on the block opens its YAML, as a table opens. This row shows the YAML in place of the block, in every document, until it is unticked.
- **Score**: the music.
  - **Score navigation** (above), and **Side panel**, on unless you turn it off, which keeps the mode in sight down the right edge while it is on, with both switches at its head, on one of two faces: **Buttons**, the note lengths and what the keys do as buttons, or **Keys**, the keys of the mode, to read beside the score as you write.
  - **Notes**, **Bars**, **Move and select**: what the keys of Score navigation do, each beside its key.
  - **Follow the playhead**: the page scrolls to keep the sounding system in view while a tune plays; turned off, it stays where you are reading.
  - **Score fill**, **Ink staff lines**, **Scores at the left**: a paper, slate or brass ground under the scores, staff lines in ink rather than gray, and scores at the left rather than centred.
- **Export**: the document, and the audio of its scores (below).

### Export

**Document** writes HTML or PDF with the editor's font, justification and hyphenation, and needs [Quarto](https://quarto.org) 1.4 or later. The PDF is the HTML page printed by Chrome, Chromium or Microsoft Edge, so it needs no TeX: its sheets are numbered, its headings are its bookmarks and it is printed on the header's `papersize` (Letter when none is named), with its notes at the end of the document. Set `mdm.pdfEngine` to `latex` to have LaTeX typeset it instead, which needs TeX. **Audio** writes every score beside the document as MIDI or WAV and needs nothing installed. The editor itself needs none of these.

## Documentation and licence

The documentation is in the [markdown_music repository](https://github.com/alpelito7/markdown_music). The extension is under the MIT licence, and the third-party work it includes is credited in `THIRD-PARTY-NOTICES.md`.
