# Changelog

## 0.5.5

- The words a score carries are sized against the prose beside them: the
  title a quarter over the body text, a part name exactly on it, and every
  lyric, chord and annotation at or below it. Left alone abcjs uses the sizes
  abcm2ps has had since the nineties, stated in points and drawn at 4/3, so a
  title landed at 27 px beside a 16 px paragraph and read as a headline over
  the page rather than as the name of a figure in it. A lyric is set roman
  rather than in abcjs's bold: it is a word of the language the page is
  written in, and a bold Times under every note was the one thing on the staff
  heavier than the sentence above it.
- The sizes are worked out from the x-height of the prose and not from its
  nominal size, and each face is measured for it, because Times, Helvetica and
  the roman do not agree on how much of an em their lowercase is. The
  engraving itself never moves: the staff, the notes and the clefs are drawn
  from abcjs's own units and no font property reaches them.
- The exported page engraves at the width the editor engraves at. It used to
  ask for a staff the width of the column, 820 px against the editor's 740,
  and a responsive SVG scales its whole drawing, so every note and every word
  on a page came out 11% larger than in the editor. A `%%staffwidth` in the
  source still decides, and a narrow score is still not stretched.
- The two screenshots are retaken: they were made before the roman and before
  the toolbar was cut into groups.

Known, and written where the code is: the printed PDF still draws a score's
words at abcjs's own sizes. It engraves through Chrome at a width the document
decides and scales the drawing to fit, so the right sizes there are these
divided by that scale, and that measurement has not been made yet.

## 0.5.4

- The document is set in Latin Modern Roman, the face TeX sets a document in.
  The extension carries it, four woff2 files of 191 KB: nothing is installed
  for it and no LaTeX is involved. It is the drawing the equations were
  already in, KaTeX's own faces being Computer Modern and Latin Modern being
  Computer Modern redrawn as OpenType, so the words and the maths of a page
  read as one design instead of two. A toolbar button hands the text back to
  the interface sans of the system, and the choice persists as `mdm.textFont`.
- It is drawn at the reading size the sans had. What a reader sees as the size
  of a text is its x-height, and Latin Modern's is 0.431 em against the sans's
  0.528, so at the same nominal size it reads about a fifth small and leaves
  the headings, the maths and the words on a staff looking oversized beside
  it. The page is set at the sans's x-height instead, which keeps the
  proportions it was designed with and leaves KaTeX's 1.21, made for exactly
  that measurement, landing within 2% of the prose.
- On paper the roman is drawn at that same x-height. fontspec's Scale is the
  lever font-size-adjust is on screen: `\f@size`, and every length hung from
  it, stays where it was and only the glyphs grow. Left at Latin Modern's own
  0.431 the paper's roman read a fifth smaller than the maths set into it, the
  words at 9.96 pt against formulas at 12.06, measured on example.pdf. The two
  bold files take a Scale of their own, since the editor weighs each face by
  its own x-height and under one Scale for the four the bold stood 3% taller
  on paper than on screen. Under pdfTeX there is no fontspec to scale with and
  the maths still comes out about a fifth larger than the words: that is the
  one engine this does not reach, and not the one Quarto renders with.
- The headings take one ladder, the same in either face and on the three
  surfaces: 2, 1.5 and 1.25 at the top, which are the sizes VS Code's own
  Markdown preview gives h1 to h3 and the levels a document written in
  Markdown is headed with, and from there each level halves what the one above
  stands over the body, so `###### Heading` and `**Heading**` draw the same.
  The rule under h1 and h2 hangs from the baseline of the heading's last line
  rather than from its depth, so a heading with descenders no longer pushes it
  down. And the air the page leaves around a heading is the air the editor
  leaves: six levels, each over a line of prose, measured 458 px from the
  first heading to the last line on the page against 573 in the editor.
- The level a heading is written as is read off the class instead of assumed,
  so a `#` is a \chapter under report, book, memoir, scrreprt and scrbook, a
  \part under `top-level-division: part`, and a \section elsewhere. A sixth
  level reaches the paper as a heading with its label instead of stopping the
  PDF with titlesec's "No format for this command", and a chapter stands where
  an article's `#` stands, where the class's own shape had put its baseline
  6.05 em under the top of the text against 1.82.
- Only the text moves. The toolbar, the menus and the outline panel keep the
  interface sans, and code, the numbers in the margin and the source of an
  open block keep their monospace.
- An export carries the face to the page and to the paper. The four faces ride
  with a page only when that page is set in them, and on paper the preamble
  stops pushing LaTeX to the sans and leaves it in the Computer Modern it
  already is, where the maths needs no compensation and loses the 1.21 it
  carries beside a sans.
- The toolbar is cut into groups by what a button touches: the page it is
  painted and set on, the score, and the playing.
- `mdm.followMusic` is now `mdm.followPlayhead`. The playhead is the thing
  that moves and the thing the page is chasing, and the tooltip is one verb
  and its negation. Anyone who had set the old id goes back to following:
  nothing migrates it. Its lamp lights while the page is NOT following, which
  is the convention of every other toggle on the bar, the setting that was
  asked for rather than the one that came with the editor.

## 0.5.3

- A page exported on the dark side carries the dark side's own fallback
  palette. The ten slots the editor paints code with had one fallback set for
  both sides, stackoverflow-light's, so a dark page with no palette behind it
  came out with the dark side's ink, #d4d4d4, over a ground mixed from the
  light side's #f6f6f6: light grey on near-white, with nothing readable on it.
  That was every export made from an editor held to dark while VS Code was on
  a light theme, and every `bin/mdm render -M mdm-look:dark` from a terminal.
- The code card on the dark side is lifted 4% of the ink off the page instead
  of sunk into the theme's own background, which is the step the editor draws.
  Under a theme whose editor is near black, and Dark 2026 is #121314, a block
  of code read as a hole in the sheet.
- An export made while the editor is showing MDM Light, MDM Dark or MDM White
  is dressed in that look. The editor refuses VS Code's palette outright while
  one of its own is on and the export did not, so a document read in MDM Dark
  came out wearing whatever theme VS Code happened to have on: the ground, the
  code card and all ten syntax colours differing between the screen and the
  page.
- The text column of the exported page is the editor's measure. `width: 100%`
  inside Quarto's grid resolved against a track of 802 px and never reached
  the 820 the maximum allowed, and eighteen pixels is a word: example.mdm's
  first paragraph reached "LaTeX" in the editor and only "emphasis" on the
  page. They break in the same place now, and a test walks the paragraph
  character by character to say so.
- A quotation on the page is indented from its bar by the editor's 14 px.
  Quarto stamps `.blockquote` on it, Bootstrap gives that class a padding of
  its own, and its 1rem is Quarto's 17 px rather than the body's 16.

- A line of the page ends on the word the editor ends it on. CodeMirror
  wraps with `break-spaces`, in which the space after the last word of a line
  takes room and has to fit, while a page lets that space hang past the edge:
  a word ending within a space of the margin stayed on the page's line and
  went down one in the editor. Measured on example.mdm with the column at
  820 px, "The boundary" ended 1.05 px inside it. The editor wraps with
  `pre-wrap` now, which keeps every space the source has and lets the last
  one of a line hang, and the test walks every paragraph of the two surfaces
  line by line.

## 0.5.2

- The caret keeps its place in its line while the outline panel opens and
  shuts. The panel is a flex sibling of the text, so opening it, closing it or
  dragging its sash moves the whole column sideways without touching a line of
  the document, and CodeMirror draws the caret as a box of its own placed from
  coordinates it measured against the geometry that was there before. For four
  painted frames after the panel moved, the caret stood where the column used
  to be, which coming back from an open panel is 93px left of its line, out in
  the dead margin past the number. The measure is asked for where the width is
  written now, and spent in the same frame, so the wrong position is never
  painted at all.
- A toolbar toggle says whether the page follows a sounding tune. A score can
  be longer than the pane and worth listening to while the document around it
  is read, and there was no way to ask for that: the page went with the music
  and that was the whole of it. On by default, so nothing changes for a reader
  who never touches it; off, the music never moves the page, not when the
  sounding system leaves it, not at a play made with the score under the fold,
  and not at a scrub of the progress bar. It sits with the other things that
  are set once and left, after the alignment toggle, since it says what the
  editor does with a tune rather than what this tune is doing, and it is worth
  setting before a player is open at all. Turning it back on brings a sounding
  tune under the pane at once. The setting is `mdm.followMusic`.
- The page moves only when the staff system that is sounding would leave it.
  Two things used to keep a reader waiting for a page they could not read. The
  first was that the page turned at the crossing from one system to the next
  and nowhere else, so a reader who could not see the head had a line of music
  to wait through; that rule was paying for the one case it protected, and the
  toggle pays for it now, so the follow is asked every frame instead. The
  second was the guard that decides whether the page is already where it
  should be, which wanted the head clear of both edges by 24px and so took a
  system resting a dozen pixels off an edge, whole on the pane and perfectly
  readable, and threw the page half a pane to centre it. What it asks now is
  that the band the cursor stands in, the reach of the whole staff group,
  shows top to bottom: a system showing whole is one the reader can follow,
  wherever on the pane it happens to sit. A score that fits the pane is still
  never scrolled, the page is still while a line of music is played, since the
  head does not go down the page inside a system, and a pause hands the page
  back for good.

## 0.5.1

- Every glyph of the chrome is drawn in brass: a button of the toolbar, the
  copy and the headphones in the corner of a block, the whole transport of the
  player row. One colour for everything that can be pressed, at rest and under
  the pointer alike, so a control reads as a control before it is read at all,
  and what a control is doing is said by the ground under it: the light wash
  under whatever is pointed at, the state weight under what is held or
  sounding. Hover no longer brightens a glyph and a held state no longer
  repaints one, since the ground has already said both. It is not the accent
  itself, which reads loud on a near-white page and yellow on a dark one, but
  that accent with two fifths of its chroma taken out at the same lightness,
  which leaves the accent to mean what it means. The numbers in the margin are
  the part of the chrome nobody presses, so they take an ink of their own, the
  same idea carried to the 4.5:1 that governs text at 11px with a third of its
  chroma out again: grey enough to read as furniture, and still the amber the
  rest of the chrome is written in. Neither colour is written by the theme, so
  a palette cannot take the chrome with it. The copy in the corner of a block
  is drawn a little larger, since two thin rectangles carry less ink than the
  solid band of the headphones beside it at the same box, and the headphones
  in the player row are drawn at the size of the pair on the block they echo.
  The player's glyphs are filled and no longer stroked: every shape abcjs
  draws there is a filled one, so the stroke added half its width all the way
  round the outline and made the transport read heavier than the row above it.
  The exported page is drawn the same way.
- The first three entries of the theme menu are MDM Light, MDM Dark and MDM
  White, and they are the editor's own looks. What sits under them is the list
  of colour themes installed in VS Code, by their own names, so "Dark" read as
  one of those rather than as this editor's dark. They are painted as their
  names say now: a palette read off the VS Code theme was still spent on them
  whenever that theme happened to sit on the same side, which made MDM Dark
  under Monokai a different editor from MDM Dark under Tomorrow Night, and
  picking one of the three takes the palettes the extension bakes in, whatever
  VS Code is wearing. Follow VS Code and the named themes under it are the
  entries that bring colours from outside. The ground of the dark one is no
  longer Monokai's either: its syntax colours are Monokai's own, taken from
  the theme VS Code ships, but its #272822 is a warm olive, and MDM Dark
  stands on the editor.background of Dark 2026, #121314, which is what the
  text editor beside it stands on. The setting is unchanged, so a
  `"mdm.theme": "dark"` already written down still means what it meant. They
  select in a colour of their own as well, the brass of the accent at a
  quarter strength on the light side and a third on the dark one, half that
  out of focus: a theme's selection belongs to that theme's side, and MDM
  Light inside Dark Modern selected in Dark Modern's blue on paper.
- A selected letter keeps its contrast, whatever colour it is taken in. The
  selection layer is drawn above the text, since a card is opaque and a
  selection behind one is hidden under it, and laid over the words it counted
  on the theme's selection colour being translucent, which VS Code's own
  themes do not give it (#add6ff in Light Modern, #264f78 in Dark Modern).
  Every letter a selection took came out as a solid box, the four notes
  Ctrl+D picks in a tune among them. The layer is blended into what is under
  it instead, multiply on a light page and screen on a dark one, which tints
  the ground and leaves each letter readable whatever the alpha.
- A dark block of code sits on the material the outline panel is drawn in
  instead of in a hole. The card took `editor.background` itself on that side,
  the colour VS Code paints behind the same code, which put it a step darker
  than the page the way a notebook draws its cells; under a theme that draws
  its editor near black there is nothing under that to be darker than, and the
  block read as a hole at the bottom of the page. It is the ink carried 4%
  over the page now, the mix the outline panel is already drawn with, so the
  code sits a step lighter than the prose on the dark side and a step darker
  on the light one: the step is made of ink, and the ink changes ends.
- The word that names the language of a fence is drawn in the brass of the
  notes, on every fence and not only on the score fences. It is the one thing
  on that line that says what the block is, and it took the theme's name
  colour, which said as much about it as the grey of the backticks around it
  did.

## 0.5.0

- The player opens in the toolbar, as a row of its own under the buttons,
  instead of under the score it plays. A score can be a page long, and on one
  of those the bar was off the bottom of the pane while the music was on
  screen: playing meant scrolling to the foot of the engraving, pressing play
  and scrolling back up to read what was sounding. The row is there whatever
  the reader is looking at, the score scrolled clean out of the viewport
  included, and it is as wide as the pane, so the progress is worth scrubbing
  on a long tune. Which score is playing is still said where it can be seen:
  the headphones of that block stay lit. The row is drawn flush on the
  toolbar's own ground rather than as the card-coloured pill it was, since
  card material means source in this editor and the player is chrome; its
  tooltips point south with the toolbar's; and its quiet ink comes off the
  chrome's --mdm-ink rather than the code palette, which on a dark theme had
  been drawing the player's glyphs brighter than the buttons a row above
  them. The row follows the pane as it is dragged, and past the widths where
  everything no longer fits it gives up the volume slider first (the mute
  stays), then the clock, then the volume altogether; play, stop, repeat and
  the progress never go. The row is chrome, so it takes its height off the
  top of the pane and the text moves down with it and back up when the player
  closes; what does not move is the reader's place in the document, since a
  row that held the page still would be paying for its own height out of the
  line and a half at the top of the pane. Beside repeat sit the same
  headphones the corner of the score carries, lit the way that one is lit
  while its player is open, and they do the same thing: the player can be shut
  from the bar without going to look for the block again. Dragging the
  progress head brings the pane to the part that is sounding, so a scrub
  through a page-long score is something you can watch, and a tune left to
  play is followed the same way: the page turns at the crossing from one staff
  system to the next, and only there, so a score that fits the pane is never
  scrolled, the page is still while a line of music is played, and a pause
  hands it straight back. What the music never does is take a page the reader
  has gone to: the system a tune starts on is taken as read rather than
  revealed, and a score scrolled clean out of the viewport is one the reader
  has left, so it plays on unfollowed until it comes back within the pane's
  reach. The exported page is unchanged: it has no toolbar, and its bar stays
  under the score.
- The lines of the source are numbered in the margin. The number rides on the
  line itself, in an attribute the stylesheet prints, and not in a gutter: a
  gutter of CodeMirror's is a column at the head of the scroller, and the text
  of this editor is a centred column, so the two would stand as far apart as
  the pane is wide. A paragraph that wraps carries one number for all its
  rows, the way a line of a text editor does, and a block that is drawn
  instead of its source is numbered by the line it starts at, on the cover
  over that source, until a caret opens the block and every line of it comes
  back numbered. What the numbers count is the file's lines and not the
  editor's: with the YAML header hidden the editor's first line is not the
  file's first, so the host says how many lines it kept back and the numbering
  starts from there, which is what makes a line read the same here as in the
  text editor beside it on the same file. The number stands in the middle of
  the row it counts, its box taking the line's own line height: handed the
  line's ratio to inherit instead, the number's 11px multiplied it into an
  18.7px box in a row of 27.2 and 14.3 in a heading's row of 41.6, and every
  number rode at the top of its row.
- A file with CRLF line endings is edited like any other. That is what a .mdm
  written on Windows has, and the editor is CodeMirror, which splits an
  incoming text on any of the three line breaks and holds no CR at all, so a
  CRLF file handed over as it was came back LF, while the host's own view of
  the document came back CRLF (VS Code gives an extension the lines joined
  with the document's ending, whatever was written into it). The two texts
  never agreed again: every keystroke was read as a change and echoed back,
  and the echo rewrote the document from the first CR on, which threw the
  caret to the end of line 1 and left one blank line more behind each time.
  The text that travels between the host and the editor is LF now, and the
  ending of the file, which only the host knows, is put back on whatever is
  written to it.

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
