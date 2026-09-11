# Third-party notices

MDM itself is MIT (see `LICENSE`). It carries copies of the work below, each
under its own licence. Versions are the ones actually in the tree, not the
newest released.

## abcjs 6.7.0

Engraves and plays the scores, in the editor and in the exported HTML.
Copyright (c) 2009-2026 Paul Rosen and Gregory Dyke, <https://abcjs.net>.
Licensed under the MIT licence.

In `_extensions/mdm/resources/`, `vscode-mdm/media/vendor/abcjs/` and
`vscode-mdm/render/mdm/resources/`. The three copies are pinned byte for byte
by the test suite.

## CodeMirror 6, Lezer and their language packages

The text editor of the VS Code webview. Copyright (C) 2018-2021 by Marijn
Haverbeke <marijn@haverbeke.berlin> and others. Each package is licensed under
the MIT licence.

Built into `vscode-mdm/media/vendor/cm6/cm6.bundle.js` from these versions
(the same list as `vscode-mdm/media/vendor/cm6/VERSIONS.json`, which the build
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

The build script and its lockfile are in `vscode-mdm/vendor-src/`.

## KaTeX 0.18.4

Renders the equations, in the editor and in a PDF export (where the Quarto
filter loads it into a headless Chrome and prints). Copyright (c) 2013-2020
Khan Academy and other contributors, <https://katex.org>. Licensed under the
MIT licence.

Inside `vscode-mdm/media/vendor/cm6/cm6.bundle.js`, with its stylesheet
`katex.min.css` and its fonts under `vscode-mdm/media/vendor/cm6/fonts/`;
and standalone (`katex.min.js`, `katex.min.css`, the woff2 fonts) under
`_extensions/mdm/resources/katex/` and the extension's copy of the filter,
`vscode-mdm/render/mdm/resources/katex/`.

## Latin Modern Roman 2.004

The face the text of a document is set in when `mdm.textFont` is `roman`, in
the editor and in an export. Copyright 2003, 2009 B. Jackowski and J. M.
Nowacki, on behalf of the TeX users groups. Released under the GUST Font
License, which is the LaTeX Project Public License 1.3c with one further
clause, asking (but not requiring) that a derived work rename the fonts it
carries. Full text in `licenses/GUST-FONT-LICENSE.txt`.

Four text faces, `LatinModernRoman-{Regular,Italic,Bold,BoldItalic}.woff2`,
under `vscode-mdm/media/fonts/`, `_extensions/mdm/resources/lm/fonts/` and the
extension's copy of the filter, `vscode-mdm/render/mdm/resources/lm/fonts/`.

Changes from the original Work, as clause 6b of the licence asks for them:
only these four files were taken from the Latin Modern 2.005 distribution,
where they are `lmroman10-{regular,italic,bold,bolditalic}.otf`, the 10 pt
optical size; each was converted from OpenType to WOFF2 and renamed, and
nothing else was touched. Outlines, metrics, name table and the 794 characters
of the character map are those of the originals. The files themselves still
report Version 2.004: the 2.005 release of the distribution changed the maths
fonts and not these.

The complete, unmodified Work is at <https://ctan.org/pkg/lm>, which is what
clause 6d of the licence asks be named. GUST and the authors provide no
support for this copy.

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

In `vscode-mdm/media/vendor/soundfont/acoustic_grand_piano-mp3/`. The files
are not modified; they are included as part of a collection, and this notice
is the attribution the licence asks for. Anyone redistributing the samples
themselves, apart from this collection, does so under CC BY-SA 3.0.

## abcm2ps 8.14.15

Engraves the scores of a PDF export when no Chrome is at hand (the default
engraver is the vendored abcjs, which the filter loads into a Chrome or
Chromium found on the machine; the browser is somebody else's separate
program too and is not distributed here). Called as a separate program.
Copyright (C) 1998-2019 Jean-Francois Moine, <http://moinejf.free.fr>,
adapted from abc2ps, Copyright (C) 1996-1998 Michael Methfessel.

Licence: GNU Lesser General Public License, either version 3 or (at the
reader's option) any later version. The texts are in `licenses/LGPL-3.0.txt`
and `licenses/GPL-3.0.txt`, which the LGPL refers to.

The binary itself is NOT distributed here: neither the repository nor the VS
Code extension package carries it. The Quarto filter searches for abcm2ps in
this order: a path named in the document's YAML header (`mdm.abcm2ps`), then
`tools/bin/abcm2ps` beside the document being rendered (where a local build
may be dropped), then the PATH; the VS Code extension's export pre-flight
checks the last two. abcm2ps 8.14.15 (2024-01-08) is available from
<https://github.com/lewdlime/abcm2ps>, and it is run over a pipe as a separate
executable, not linked into anything here.

## hyph-utf8 hyphenation patterns

Offline word division uses the English, Spanish, French, German (reformed),
Portuguese, Italian, Dutch, Polish, Russian and Ukrainian patterns from
[hyph-utf8](https://github.com/hyphenation/tex-hyphen). The complete source
notices, copyrights, versions and licences are preserved at the top of each
`hyphenation-patterns.js` bundle. English permits redistribution with its
notices; Portuguese uses BSD-3-Clause; Russian uses LPPL 1.2 or later
(distributed here under LPPL 1.3c); the other included patterns use MIT.
The Russian source and licence are included in the hyphenation licence
folders. The pattern weights are unchanged; only their storage is compacted.
The JavaScript engine is part of MDM and uses the project licence.
