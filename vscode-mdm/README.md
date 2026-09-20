# Markdown Music

Markdown Music is an editor for `.mdm` files: Markdown with equations, code and playable scores, drawn as you write. Scores are written in [ABC notation](https://abcnotation.com/wiki/abc:standard:v2.1) inside a ```` ```abc ```` block, so the file stays plain Markdown. To try it, download **[example.mdm](https://cdn.jsdelivr.net/gh/alpelito7/markdown_music@main/example.mdm)** (or [read it on GitHub](https://github.com/alpelito7/markdown_music/blob/main/example.mdm)), save it with the `.mdm` extension and open it in VS Code.

<!-- clip: tour -->
![The document opens at its top in MDM Dark, set in the font Markdown is usually written in. The toolbar's font button sets the text in Latin Modern, the face of a LaTeX document, and every word of the page is redrawn in it. The theme menu then switches to MDM Light, another button draws the staff lines in ink and a third turns on multicursor matches inside words. The page scrolls to the score, and a click on the engraved score opens its ABC above the drawing. A click on a bare E, then Ctrl+D four times, selects the four E's of the tune, two of them inside chords; typing e moves all four up an octave, and a flat typed in front of them makes them E flats, each step showing at once in the drawing underneath. The headphones open the player, and play moves a brass playhead across the edited staff, each note turning brass as it sounds.](https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/clip-tour.gif)

## Writing a score

With a caret inside a score's block, the editor shows its ABC in the extension's colours and the score drawn under it, as below; the grey comments say what each line does.

<img src="https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/abc-card.png" alt="A score block as the editor shows it with a caret inside, its ABC coloured and the score engraved under it. X:1 % reference number, the first line of a tune / T:Four bars % title / M:4/4 % metre / L:1/8 % unit note length: a plain letter is an eighth / Q:1/4=100 % tempo, in quarter notes a minute / K:C % key, the last line of the header / % C is middle C and c the octave above; a 2 after a note doubles its length / % ^ sharp, _ flat, = natural, z a rest, [CEG] a chord, |] the end / CDEF GABc | c2 B2 A2 G2 | ^F2 _B2 =B2 z2 | [CEG]8 |]">

Repeats, ties, lyrics, several voices and the rest of the notation are in the [ABC standard](https://abcnotation.com/wiki/abc:standard:v2.1). The headphones on a score open a player, whose piano comes with the extension and is the only instrument it has. Under them, a third button writes that score's audio beside the document as MIDI or as WAV: the WAV is the piano you hear, the MIDI the notes at the tempo the editor plays them at, and neither needs anything installed. A block fenced as ```` ```{.abc .play} ```` also gets a player on the exported page.

## Writing Markdown

The text is the file, and the editor reads it as the export does: Pandoc's Markdown, with CommonMark's blank lines. Lists, quotes and callouts are drawn nested as the page nests them; links and images work by reference as well as inline; footnotes, citations, attributes, raw TeX and Pandoc's curly quotes and dashes are drawn, and the source of a line comes back when the caret is on it. `Enter`, `Backspace`, `Tab` and `Shift+Tab` continue, end, nest and unnest lists; `Ctrl+B`, `Ctrl+I`, `Ctrl+E` and `Ctrl+K` put a mark on and take it off; `Ctrl+Shift+0` to `Ctrl+Shift+6` make the line a paragraph or a heading of that level, `Ctrl+Shift+C` a code block with the caret where its language goes (`abc` for a score) and `Ctrl+Shift+T` a task list; each is a toolbar button too, which names its key where it has one, and the toolbar also strikes words through, raises or lowers them (`x^2^`, `H~2~O`), sets them in small caps and highlights them (Pandoc's `[word]{.mark}`, which the page writes as `<mark>`, drawn in a wash of the document's own on all three surfaces), and six buttons close its first row with what a document holds beside its words: an equation inline or on lines of its own, a table, a picture, a footnote with its note, and a horizontal rule; a click ticks a task's box, and `Ctrl+click` follows a link (`Alt+click` where `Ctrl+click` adds a caret). `Ctrl+F` searches, and the outline button lists the headings.

## The toolbar

### Font

The text is set in Latin Modern Roman, the face of a LaTeX document, which comes with the extension and needs no LaTeX installed. The font button switches it to the system's sans, the face Markdown is usually written in; code keeps its monospace either way.

### Justified text

Paragraphs, list items and quotations are justified: every line but the last of each reaches both edges of the text, and the spaces between its words are widened as you type. The justify button sets them ragged on the right instead. Lines break on the same words either way, and headings, code, tables and scores are never justified.

### Hyphenation

Words are kept whole at line endings until a language is chosen from the hyphenation menu: German, English, Spanish, French, Italian, Dutch, Polish, Portuguese, Russian or Ukrainian. Choosing one divides the prose and writes the language into the YAML header (`lang: en` for English), adding a header if the file had none, which comes up hidden until the YAML button beside the menu opens it. The hyphen is only drawn at the wrap, so copying and saving keep each word as it was typed. Division is remembered per file, since a document in Spanish and one in English can be open side by side; every other button of the bar is the editor's and is shared by all of them.

### Multicursor

Ctrl+D adds the next occurrence of the selection, as in VS Code, and matches whole words: from "score" it steps over "scores". The multicursor button makes it match inside words too. Alt+click adds a caret, or Ctrl+click when VS Code's multi-cursor modifier is set to it.

### Following the playhead

While a tune plays, a brass playhead walks the staff and the page scrolls to keep the system being played whole on screen. The follow button turns that off, so a long score can go on sounding while you read elsewhere in the document.

### Export

The export button has two branches. **Document** writes the document as HTML or PDF, with the font, the justification and the hyphenation the editor is using, and needs [Quarto](https://quarto.org) 1.4 or later. With Chrome or Chromium it can print a PDF from the HTML page without TeX, including scores and equations; installing TeX adds its typeset line breaking and page layout. The first kind of PDF says which road it took. Its **Don't show again** button hides that notice, and `mdm.showPdfFallbackNotice` in Settings turns it back on. The editor itself needs none of them. **Audio** writes every score of the document as MIDI or as WAV beside it, one file per score, which is what a score's own button above does for the one score it stands by; it needs nothing installed at all, and in a document with no score its rows are greyed out.

## Documentation and licence

The documentation is in the [markdown_music repository](https://github.com/alpelito7/markdown_music). The extension is under the MIT licence, and the third-party work it includes is credited in `THIRD-PARTY-NOTICES.md`.
