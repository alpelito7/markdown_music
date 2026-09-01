# Third-party notices

The MDM editor is MIT (see `LICENSE`). This package carries copies of the work
below, each under its own licence. Versions are the ones actually shipped.

## abcjs 6.7.0

Engraves and plays the scores, in the editor and in the exported HTML.
Copyright (c) 2009-2026 Paul Rosen and Gregory Dyke, <https://abcjs.net>.
Licensed under the MIT licence.

In `media/vendor/abcjs/` and `render/mdm/resources/`.

## CodeMirror 6, Lezer and their language packages

The text editor of the VS Code webview. Copyright (C) 2018-2021 by Marijn
Haverbeke <marijn@haverbeke.berlin> and others. Each package is licensed under
the MIT licence.

Built into `media/vendor/cm6/cm6.bundle.js` from these versions
(the same list as `media/vendor/cm6/VERSIONS.json`, which the build
writes):

  - @marijn/find-cluster-break 1.0.3
  - @codemirror/state 6.7.1
  - style-mod 4.1.3
  - w3c-keyname 2.2.8
  - crelt 1.0.7
  - @codemirror/view 6.43.9
  - @lezer/common 1.5.2
  - @lezer/highlight 1.2.3
  - @codemirror/language 6.12.4
  - @codemirror/commands 6.11.0
  - @codemirror/search 6.7.1
  - @codemirror/autocomplete 6.20.3
  - @lezer/markdown 1.7.2
  - @lezer/lr 1.4.10
  - @lezer/html 1.3.13
  - @lezer/css 1.3.6
  - @codemirror/lang-css 6.3.1
  - @lezer/javascript 1.5.4
  - @codemirror/lang-javascript 6.2.5
  - @codemirror/lang-html 6.4.12
  - @codemirror/lang-markdown 6.5.2
  - @lezer/yaml 1.0.4
  - @codemirror/lang-yaml 6.1.3
  - @lezer/python 1.1.19
  - @codemirror/lang-python 6.2.1
  - @lezer/json 1.0.3
  - @codemirror/lang-json 6.0.2
  - @lezer/cpp 1.1.6
  - @codemirror/lang-cpp 6.0.3
  - @codemirror/legacy-modes 6.5.3

The build script and its lockfile are in the repository, under `vscode-mdm/vendor-src/`.

## KaTeX 0.18.4

Renders the equations, in the editor and in a PDF export (where the bundled
Quarto filter loads it into a headless Chrome and prints). Copyright (c)
2013-2020 Khan Academy and other contributors, <https://katex.org>. Licensed
under the MIT licence.

Inside `media/vendor/cm6/cm6.bundle.js`, with its stylesheet
`katex.min.css` and its fonts under `media/vendor/cm6/fonts/`; and
standalone (`katex.min.js`, `katex.min.css`, the woff2 fonts) under
`render/mdm/resources/katex/`.

## The MIT licence

abcjs, CodeMirror, Lezer and KaTeX are all under the MIT licence, reproduced
once here. Each keeps its own copyright line, given above.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Musyng Kite soundfont (acoustic grand piano)

The 88 piano samples the editor's player sounds with, so that playback needs
no network. Taken unmodified from <https://github.com/gleitz/midi-js-soundfonts>
(gh-pages branch, MusyngKite set), which states: "Generated from Musyng
Kite.sfpack ... Released under Creative Commons Attribution Share-Alike 3.0
license".

Licence: Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0),
<https://creativecommons.org/licenses/by-sa/3.0/>.

In `media/vendor/soundfont/acoustic_grand_piano-mp3/`. The files
are not modified; they are included as part of a collection, and this notice
is the attribution the licence asks for. Anyone redistributing the samples
themselves, apart from this collection, does so under CC BY-SA 3.0.

## Not shipped, but needed for an export

An export calls Quarto, and a PDF of a document with scores calls a Chrome
or Chromium, into which the filter loads the vendored abcjs and KaTeX so
the PDF shows the very drawings the editor does; on a machine without one
it calls abcm2ps instead. None of the three is part of this package: they
are looked for on the machine when an export is asked for (Chrome by its
common names on the PATH, or at a path the document's YAML names in
`mdm.chrome`; abcm2ps at a path named in the document's YAML header, then
at `tools/bin/abcm2ps` beside the document, then on the PATH), and the
editor works without them. abcm2ps is
licensed under the GNU Lesser General Public License version 3 or later,
copyright (C) 1998-2019 Jean-Francois Moine, <http://moinejf.free.fr>.
