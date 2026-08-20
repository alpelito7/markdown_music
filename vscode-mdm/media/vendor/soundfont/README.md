# Vendored soundfont

`acoustic_grand_piano-mp3/` (88 files, A0–C8) is the piano of the **Musyng
Kite** soundfont, in the pre-rendered MIDI.js format abcjs consumes, taken
from <https://github.com/gleitz/midi-js-soundfonts> (gh-pages, MusyngKite
set). It is what the editor's player sounds with, served from disk so
playback works offline.

Musyng Kite is released under the Creative Commons Attribution Share-Alike
3.0 license (<https://creativecommons.org/licenses/by-sa/3.0/>), as stated in
that repository's README. The mp3 files are unmodified.

abcjs plays this same soundfont from its CDN with a 3x volume boost keyed on
the URL; the local copy misses that check, so the webview passes
`soundFontVolumeMultiplier: 3` itself (see mountSynth in media/main.js).
