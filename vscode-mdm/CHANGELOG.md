# Changelog

## 0.4.2

- The formulas of an exported page are set by the vendored KaTeX, the same
  engine the editor draws them with. Quarto's default for the HTML is
  MathJax, fetched from a CDN: the page needed the network to show a formula
  at all, and the formulas it did show were not the editor's, since MathJax
  sets them to other widths and the same paragraph broke at a different word
  on the page than on screen, which is the one thing the export is supposed
  not to do. The filter leaves each formula as its own LaTeX inside a
  `span.math` and sends KaTeX, the faces its stylesheet names and a script
  that reads the formulas back and sets them, along with the page as an HTML
  dependency, which is what `embed-resources` takes into the file.
- An SVG figure is printed to the PDF by the headless Chrome that engraves
  the scores. LaTeX cannot read an SVG, and Quarto converts one with
  rsvg-convert, a program it does not ship and does not look for until the
  render is under way: without it the render died there, so a document with a
  drawn figure in it had no PDF at all on a machine carrying everything the
  editor itself needs. The page Chrome prints is the size of the drawing, so
  what comes out is the drawing and nothing around it, and it is not trimmed
  to its ink the way a score is: the white an author left around a figure is
  part of the figure. Without a Chrome the image is left as it was and Quarto
  tries its own converter, as it did before.
- A heading on paper gets the air the page leaves over its rule. The rule sat
  0.19 em under the ink of a 2 em heading in the PDF against the 0.625 em of
  the HTML, measured on the pixels of both, and read as stuck to the text.
  The page spends the padding of the heading plus the half of its leading
  that falls under the text; paper has no leading under a last line, so the
  whole gap is skipped now. Only under KOMA, the class a document that names
  none is given: a standard class rules its headings through titlesec, whose
  own spacing already leaves as much.

## 0.4.1

- The export is named after the document, whatever its extension. The copy
  the render works from, and everything it leaves behind, were named by
  taking `.mdm` off the end of the document, which takes nothing off
  anything else: a `.md` opened through "Open With" came out as
  `notes.md.qmd`, `notes.md.html` and `notes.md.pdf`, its own extension in
  the middle of every name. What comes off now is the extension that is
  there, and a `.mdm` is named as it always was.
- A figure named by an absolute path reaches the exported page. Quarto
  rewrites the src of an image that sits outside the render directory into a
  relative one by dropping its leading slash, so `/home/me/fig.svg` came out
  of the HTML as `./home/me/fig.svg`, which points at nothing: the figure was
  missing from the page and the PDF died in LaTeX looking for a file of that
  name beside the document. That is what a figure drawn by another project
  looks like from here. The filter copies the file into the cache it keeps
  its own drawings in, under the digest of its contents, and points the image
  at the copy, a path inside the render directory that both formats carry the
  way they carry a figure written beside the document.

## 0.4.0

- Tables are drawn. A pipe table was the one block the editor still showed
  as its source; it is a block widget now, under its source lines the way a
  score or a display equation is. The cells are set with the marks and the
  maths they carry, each column takes the alignment the second row asks for,
  and a caret in the table brings the pipes back, in the monospace grid the
  columns line up in, with the drawing left below as the live preview. A
  click lands on the cell it was on.
- An image named by an absolute path is shown. A figure drawn by the code of
  another project lives wherever that project keeps it, and every path that
  was not a URL used to hang from the folder of the document, so an absolute
  one came out as that folder with the path glued behind it. The webview is
  handed the root of the document's filesystem as a second base, and is
  allowed to read from it, whenever the document is a file on disk.
- A figure carries the pointer, since a click on it opens its source, as it
  does on a score or an equation.
- Opening a drawing no longer scrolls the document out from under the click.
  The source that opens is line after line of text the drawing did not take,
  so everything under it moved down: on a table of eight rows whose head was
  off the top of the pane, the line the click landed on opened 182 px from
  where the cell had been. The height of the click is held instead.
- A copy is answered in the brass the chrome is drawn in. The pulse was a
  blue of its own, the last colour left in the editor that came from
  somewhere else; it is the top step of the same ladder now, at the weight
  the old tint carried, so a copy speaks the colour of the button that asked
  for it.
- A thematic break with a line of text straight under it no longer breaks
  the export. The editor draws a rule there and Pandoc read the opening
  fence of a YAML metadata block, which ran to the next `---` and took a
  score into it; the render died in Quarto's reader. The copy that is
  rendered gets the blank line the two dialects need, and the document never
  does.
- A long score goes down the page as one clipped image per staff system,
  stacked into the drawing it was cut from, so a page break can fall between
  two systems instead of throwing the whole engraving onto the next page. A
  score taller than the page used to have nowhere to go at all.
- The word AUTHOR that Quarto sets over the name is gone from the HTML.
  LaTeX's title block writes no such word, so the two exports disagreed
  about what the page says, and its height was most of what left the author
  adrift under the subtitle.

## 0.3.0

- A PDF export is engraved by the engines the editor itself draws with. The
  scores used to go through abcm2ps and the equations through LaTeX, both
  somebody else's shapes, so the paper and the screen disagreed about what
  the same source looks like: different figures on a time signature,
  different weight on a radical. The filter now loads the vendored abcjs and
  KaTeX into a headless Chrome and prints, so the score in the PDF is the
  drawing the editor shows and the formula is KaTeX's own, radical for
  radical. Vector throughout, with the fonts embedded.
- An inline formula takes the width the browser measured for it and sits on
  the text's baseline, lowered by the depth KaTeX reports, so it no longer
  pushes a line break somewhere the editor does not break.
- Neither Chrome nor anything else is required to keep working. Without a
  Chrome, or without `pdfcrop`, the render says in the log which tool it
  missed and falls back to what it did before: abcm2ps for the scores, LaTeX
  for the maths. `mdm-engraver: abcm2ps` in the YAML picks that path
  outright, and `mdm.chrome` points at a browser the PATH does not carry.
  The export's pre-flight stops a PDF with scores in it only when the
  machine has neither engraver.
- The page number came out black on the dark side, on the dark ground. The
  folio is set by the output routine, which the ink of the look did not
  reach; it takes the ink of the side now, under both the standard classes
  and KOMA.
- The staff lines were stroked at 0.7 pt, which is 0.93 of a pixel at 96 dpi:
  a viewer that snaps thin strokes kept or dropped each line by where it
  landed, and whole staves came out of the PDF with a line or two missing.
  They are 0.9 pt now, past that grid, and the width is part of the cache key.
- The rest of the page moved closer to the editor as well: the maths in New
  Computer Modern Book at KaTeX's 1.21 scale, with operators in the upright
  serif of the family; inline code on a breakable chip of the card material;
  every score inside a band with the editor's 1.5 em of air; the quote with
  the editor's left border; and the thematic break as its full-measure
  hairline.

## 0.2.4

- The editor spends its own brass on what is held or sounding. It used to
  draw its chrome in four weights of the theme's ink, on the argument that
  the accent belongs to the score, which left it with no way of saying
  "this is on": a heavier grey disc is not a statement. There is one
  ladder now, two steps of the same brass: a light wash under whatever the
  pointer is on, and a heavier disc, with the glyph in brass, for what is
  held. Play wears it while the tune sounds, repeat while it loops, the
  headphones while their player is open, the toolbar toggles while they
  are on. The played half of the progress, its head and the volume take
  the deep form of the brass, so the two sliders say where they stand in
  one voice, and so do the caret and the section of the outline the caret
  is in. The exported HTML is drawn from the same ladder: the page and the
  editor are one bar.
- A rest stayed in ink under the playing cursor when the tune was reached
  by dragging the head or by pressing play from inside a note, while a
  rest sounding against a note on another staff lit as it always had. On a
  two-hand score that read as the highlight losing its place. The silence
  a seek opens runs to the next note that sounds, which is right for the
  sound and was carrying the ink with it; a written silence is lit on its
  own beat now, and a head dropped on a rest lights it where it lands.
- Picking a heading in the outline pulls it to the top of the pane instead
  of merely bringing it into view, so the section starts where the eye
  already is. Near the foot of a document the heading lands as high as
  what is left below it allows.

## 0.2.3

- An export comes out as the editor reads it. The editor reads CommonMark,
  where nothing has to stand above a heading, and Quarto reads Pandoc's
  Markdown, which asks for a blank line there and another one over a block
  quote: a `### Title` written straight under a paragraph, or under the
  closing fence of a score, showed as a heading on screen and came out of
  the HTML and the PDF as a line of text with three hashes on it. The copy
  the render is handed now names a dialect with those two rules off, and a
  document that declares a `from:` of its own keeps it. Pandoc wants the
  `#` in the first column all the same, and no option governs that: a
  heading written with a space in front of it is a heading in the editor
  and a paragraph in the output.
- HTML + PDF exported the HTML alone unless the document declared both
  formats in its header. Quarto renders the formats the header names, and a header
  that names none, or a document with no header at all, is HTML and nothing
  else; the entry asks for both by name now.
- A score naming neither its reference number (`X:`) nor its key (`K:`)
  came out of the PDF as a paragraph of ABC source while the editor and the
  HTML drew a staff. abcjs falls back to the empty key signature on a treble
  staff; abcm2ps goes by the standard, which makes both compulsory, and
  refuses the tune by leaving with a status of 0 and nothing engraved, which
  the filter read as success. It hands the engraver the `X:1` and the `K:C`
  that draw what abcjs draws, and a tune it really cannot engrave names
  abcm2ps in the warning instead of epstopdf.
- The PDF came out a stock Quarto article while the HTML came out dressed as
  the editor. It is dressed from the same metadata now: the ground of the
  side the editor is on, its ink, its sans, the heading sizes with the
  hairline under the first two levels, and code on the card with the ten
  colours of the palette over it, and the measure of its column, which is
  51.25 ems of whatever size the body is set at, clamped to what the sheet
  can hold. A score is engraved in the colours of the look as well: the ink
  of the side and, unless the editor asks for them in ink, the grey of the
  staff lines, painted into the drawing itself, since abcm2ps writes no
  colour and ghostscript bakes black into everything it converts. The fill
  and the alignment a score can be given travel too, as a box around the
  engraving. One thing stays on screen: the card behind inline code.
- The page reads as the editor's does, line for line. It is set ragged right
  and with no font expansion, as a browser sets text, so a paragraph of prose
  breaks where the editor breaks it instead of carrying a word more; code is
  at the 0.88 of the text the editor gives it, and mathematics at the 1.21
  KaTeX sets its own at, which is what the inline letters and the cramped
  square roots were missing.
- The title block, the one Quarto draws at the top from the YAML, now
  belongs to the YAML: it comes out of an export only if the header is on
  screen when the export is asked for, and a document exported with the
  header hidden opens on its first line, as the editor does.

## 0.2.2

- A playing cursor: while a tune sounds, a brass line walks the engraving
  the way sequencers draw their playhead, gliding between attacks so each
  note reads as drawn the moment the line reaches it. It freezes where a
  pause leaves the music, stands where a seek drops the head (played yet
  or not), follows the progress head live while it is dragged, and leaves
  with stop, with the end of the tune, and with the player. Grabbing the
  head silences a sounding tune for as long as the drag lasts and puts the
  lit note back in ink; the release lands the sound under the new head.

## 0.2.1

- Search terms on the listing: `notation` on its own, `staff`, `music
  notation` and `partitura` join the keywords. Measured against the
  Marketplace's own search before and after: a reader typing `notation`
  or `staff`, both of them natural words for this, found nothing of this
  extension, while `abc notation` and `sheet music` already placed it
  seventh and fourth. Nothing else changes; the editor is the 0.2.0 one.
- Both images on the listing are remade, each from a document kept beside
  it (`docs/eq_staff.mdm` and `docs/staff_sound.mdm`). The first is an
  equation with the score that draws it underneath; the second shows a
  score block as it is while somebody writes it: the ABC source open above
  the engraving it produces, both voices of a duet lit in brass as they
  sound, and the player bar under them. The one it replaces was the
  engraving alone, and its crop stopped short of the bar.

## 0.2.0

First public release.

- Editor rebuilt on CodeMirror 6: the text in the editor is the file text,
  rendering follows the carets, and delimiters are ordinary characters that
  can be deleted and retyped.
- Full multicursor (Alt+click, column selection, Ctrl+D, Ctrl+Shift+L,
  Ctrl+Alt+Up/Down), mirroring `editor.multiCursorModifier`.
- ABC syntax highlighting in the source of a score, painted like the
  engraving it becomes: staff, bar lines and field labels in ink, notes in
  the brass of the extension's icon, and accidentals, lengths, ornaments,
  lyrics and comments in the family around it. One pair of palettes, light
  and dark, untouched by the colour theme the rest of the code follows.
- Score playback with a player bar per score: play, pause, stop, repeat, a
  draggable progress bar, volume and mute, sounding from the vendored piano
  with no network. Notes light up as they sound; resuming after a pause
  lands on the beat.
- Themes: follow VS Code, light, dark, white paper, or any installed colour
  theme, with the syntax palette read from the theme itself. Staff line
  colour, score fill and score alignment as settings.
- Outline panel, YAML header shown or hidden and spliced back on save, and
  toolbar states persisted as `mdm.*` settings.
- Export to HTML and PDF through Quarto from the toolbar, the HTML dressed
  as the editor it was exported from. The filter travels with the
  extension, so exporting needs no clone of the repository.

## 0.1.0

Prototype on Vditor: rendered Markdown with ABC scores, first version of
the Quarto export.
