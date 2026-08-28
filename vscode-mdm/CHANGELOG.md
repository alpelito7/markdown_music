# Changelog

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
