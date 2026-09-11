# Markdown Music

Markdown Music is an editor for `.mdm` files: Markdown with equations, code and playable scores, drawn as you write. Scores are written in [ABC notation](https://abcnotation.com/wiki/abc:standard:v2.1) inside a ```` ```abc ```` block, so the file stays plain Markdown. To try it, download **[example.mdm](https://raw.githubusercontent.com/alpelito7/markdown_music/main/example.mdm)** (or [read it on GitHub](https://github.com/alpelito7/markdown_music/blob/main/example.mdm)), save it with the `.mdm` extension and open it in VS Code.

<!-- clip: tour -->
![The document opens in MDM Dark. The theme menu switches it to MDM Light, one toolbar button draws the staff lines in ink and another turns on multicursor matches inside words. A click on the engraved score opens its ABC above the drawing. A click on a bare E, then Ctrl+D four times, selects the four E's of the tune, two of them inside chords; typing e moves all four up an octave, and a flat typed in front of them makes them E flats, each step showing at once in the drawing underneath. The headphones open the player, and play moves a brass playhead across the edited staff, each note turning brass as it sounds.](https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/clip-tour.gif)

## Writing a score

With a caret inside a score's block, the editor shows its ABC in the extension's colours and the score drawn under it, as below; the grey comments say what each line does.

<img src="https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/abc-card.png" alt="A score block as the editor shows it with a caret inside, its ABC coloured and the score engraved under it. X:1 % reference number, the first line of a tune / T:Four bars % title / M:4/4 % metre / L:1/8 % unit note length: a plain letter is an eighth / Q:1/4=100 % tempo, in quarter notes a minute / K:C % key, the last line of the header / % C is middle C and c the octave above; a 2 after a note doubles its length / % ^ sharp, _ flat, = natural, z a rest, [CEG] a chord, |] the end / CDEF GABc | c2 B2 A2 G2 | ^F2 _B2 =B2 z2 | [CEG]8 |]">

Repeats, ties, lyrics, several voices and the rest of the notation are in the [ABC standard](https://abcnotation.com/wiki/abc:standard:v2.1). The headphones on a score open a player, whose piano comes with the extension and is the only instrument it has. A block fenced as ```` ```{.abc .play} ```` also gets a player on the exported page.

## The toolbar

### Font

The text is set in Latin Modern Roman, the face of a LaTeX document, which comes with the extension and needs no LaTeX installed. The font button switches it to the system's sans, the face Markdown is usually written in; code keeps its monospace either way.

### Hyphenation

Words are kept whole at line endings until a language is chosen from the hyphenation menu: German, English, Spanish, French, Italian, Dutch, Polish, Portuguese, Russian or Ukrainian. Choosing one divides the prose and writes the language into the YAML header (`lang: en` for English), adding a header if the file had none, which comes up hidden until the YAML button beside the menu opens it. The hyphen is only drawn at the wrap, so copying and saving keep each word as it was typed. Division is remembered per file, since a document in Spanish and one in English can be open side by side; every other button of the bar is the editor's and is shared by all of them.

### Multicursor

Ctrl+D adds the next occurrence of the selection, as in VS Code, and matches whole words: from "score" it steps over "scores". The multicursor button makes it match inside words too. Alt+click adds a caret, or Ctrl+click when VS Code's multi-cursor modifier is set to it.

### Following the playhead

While a tune plays, a brass playhead walks the staff and the page scrolls to keep the system being played whole on screen. The follow button turns that off, so a long score can go on sounding while you read elsewhere in the document.

### Export

The export button writes the document as HTML or PDF, with the font and the hyphenation the editor is using. It needs [Quarto](https://quarto.org) 1.4 or later, and a PDF also needs TeX; with Chrome or Chromium, the PDF draws scores and equations as the editor does. The editor itself needs none of them.

## Documentation and licence

The documentation is in the [markdown_music repository](https://github.com/alpelito7/markdown_music). The extension is under the MIT licence, and the third-party work it includes is credited in `THIRD-PARTY-NOTICES.md`.
