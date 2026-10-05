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
![In Latin Modern on MDM Light, the toolbar justifies the text, and English chosen from the hyphenation menu divides its words and writes lang: en into the YAML header that the YAML button shows and hides. Three words turn bold as two asterisks are typed over them, three lines become a list, a phrase is highlighted, a table is filled cell by cell and a pasted picture is saved beside the document. Under an equation numbered at the margin, a citation typed as its key is drawn as the page prints it, and a click on its work, listed at the end, opens the bibliography beside the document at its entry.](https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/clip-markdown.gif)

The text is the file, and the editor reads it as the export does: Pandoc's Markdown, with CommonMark's blank lines. Lists, quotes, callouts, tables, footnotes, citations and numbered equations are drawn in place, and a line shows its source while the caret is on it. With a bibliography in the header and Quarto installed, a citation reads as the page prints it, "Knuth (1984)", and the list of works cited stands where the page sets it; `Ctrl+click` on a citation goes to its entry. `Ctrl+B`, `Ctrl+I`, `Ctrl+E` and `Ctrl+K` mark words; `Ctrl+Shift+0` to `Ctrl+Shift+6` make the line a paragraph or a heading, `Ctrl+Shift+C` a code block (`abc` for a score) and `Ctrl+Shift+T` a task list. A mark typed over selected words wraps them, an address pasted over them links them, and `Shift+Enter` breaks a line inside its paragraph. A picture pasted, or dropped with Shift held, is saved in a folder beside the document; saving the document without it moves the file to the trash. `Ctrl+click` follows a link (`Alt+click` where `Ctrl+click` adds a caret), `Ctrl+F` searches and `Ctrl+H` replaces.

## The toolbar

The first row writes: headings, marks on words, blocks, and what a document holds beside its words (a music symbol, an equation, a table, a picture, a footnote, a rule). A tooltip names the button's key where it has one. The two buttons at its left open the outline of the headings and export the document.

The second row holds settings shared by every document, except the hyphenation, which each file keeps:

- **Multicursor**: `Ctrl+D` adds the next match of the selection, whole words only unless this button is on. `Alt+click` adds a caret.
- **Theme**: follows VS Code by default; MDM Light, MDM Dark and MDM White are the editor's own.
- **Font**: Latin Modern Roman, the face of a LaTeX document, which comes with the extension, or the system's sans. Code keeps its monospace.
- **Justify**: paragraphs justified, or ragged on the right. The lines break on the same words either way.
- **Hyphenation**: words stay whole until a language is chosen here. It is written into the YAML header as `lang:`, in a new, hidden header if the file had none; the hyphen is only drawn, never saved.
- **YAML**: shows or hides the header.
- **Score fill**, **staff lines** and **score alignment**: a paper, slate or brass ground under the scores, staff lines in gray or in ink, and scores centred or at the left.
- **Follow**: while a tune plays, the page scrolls to keep the sounding system in view; turned off, it stays where you are reading.

### Export

**Document** writes HTML or PDF with the editor's font, justification and hyphenation, and needs [Quarto](https://quarto.org) 1.4 or later. The PDF is the HTML page printed by Chrome, Chromium or Microsoft Edge, scores and equations included, so it needs no TeX: its sheets are numbered, its headings are its bookmarks, a `toc: true` opens it with the table of contents, what the header says under `format: pdf:` about contents, numbered sections and `papersize` holds for it (Letter when no paper is named), though its notes come at the end of the document and its contents carry no page numbers. Set `mdm.pdfEngine` to `latex` in the Settings to have LaTeX typeset it instead, with TeX's line breaking and page layout and each note at the foot of its page; that needs TeX. **Audio** writes every score beside the document as MIDI or WAV and needs nothing installed. The editor itself needs none of these.

## Documentation and licence

The documentation is in the [markdown_music repository](https://github.com/alpelito7/markdown_music). The extension is under the MIT licence, and the third-party work it includes is credited in `THIRD-PARTY-NOTICES.md`.
