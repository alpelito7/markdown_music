# Changelog

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
