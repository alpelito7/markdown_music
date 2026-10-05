#!/usr/bin/env python3
"""The roman's four faces again, with TrueType outlines, for a page that is
going to be printed.

    python3 tools/lm-print-faces/make.py

Reads the four faces the editor and the exported page draw with
(_extensions/mdm/resources/lm/fonts/), whose outlines are the CFF ones of the
OpenType originals, and writes them beside that folder, in lm/print/, in both
render trees, with every glyph's cubic curves turned into TrueType's
quadratic ones.

Why there are two sets. Chrome writes a PDF through Skia, and Skia embeds a
face with CFF outlines as a Type 3 font: every glyph a drawing and no font at
all. A viewer then fills the letters as shapes instead of setting them as
text, and they come out lighter than the editor draws them and lighter than
the equations beside them, whose faces are KaTeX's and have TrueType
outlines: 9 % less ink than the editor in pdf.js, which is what VS Code's PDF
viewers and Firefox draw with, and 8 % less in Chrome's own viewer, against
1 % and 6 % with the faces embedded as fonts (measured on one row of prose,
2026-10-04, MDM Dark). With TrueType outlines the same face goes into the PDF
as the font it is.

Why the screen does not use them. FreeType hints a CFF face from the hints it
carries, and these faces drawn from TrueType outlines carry none: on a screen
the rows of ink stand a pixel taller and softer (18 px against 19 on a row of
the roman at the editor's size), 54,215 pixels of a 1100 by 1200 page
differing. Paper has no pixels to snap to, so the difference is only on the
screen, and the screen keeps the faces it has.

What changes and what does not. The outlines are approximated to within
MAX_ERR of a font unit (a thousandth of an em: at the size of the prose on
paper that is under a hundredth of a point). Nothing else is touched: the
advance of every glyph, the kerning and the ligatures, the character map and
the names are those of the files read, which the checks at the end hold. The
recipe is fontTools' own otf2ttf.

Needs fontTools and brotli (`pip install fonttools brotli`).
"""

import os
import sys

from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable

# Half a font unit, a two-thousandth of an em. fontmake's default is a whole
# unit; the four files weigh 201 KB at 1, 212 KB at 0.5 and 224 KB at 0.25,
# against 196 KB for the ones they are made from.
MAX_ERR = 0.5

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TREES = [
    os.path.join(ROOT, "_extensions", "mdm", "resources", "lm"),
    os.path.join(ROOT, "vscode-mdm", "render", "mdm", "resources", "lm"),
]
FACES = ["Regular", "Italic", "Bold", "BoldItalic"]
# Tables that have to come out of the conversion byte for byte.
KEPT = ["cmap", "name", "OS/2", "hhea", "GSUB", "GPOS", "GDEF", "kern"]


def convert(src, dst):
    # The date the face says it was last changed stays the original's, so the
    # same input makes the same file byte for byte.
    font = TTFont(src, recalcTimestamp=False)
    if font.sfntVersion != "OTTO" or "CFF " not in font:
        sys.exit(src + " does not carry CFF outlines")
    order = font.getGlyphOrder()
    glyphs = font.getGlyphSet()
    quadratic = {}
    for name in glyphs.keys():
        pen = TTGlyphPen(glyphs)
        glyphs[name].draw(Cu2QuPen(pen, MAX_ERR, reverse_direction=True))
        quadratic[name] = pen.glyph()
    font["loca"] = newTable("loca")
    font["glyf"] = glyf = newTable("glyf")
    glyf.glyphOrder = order
    glyf.glyphs = quadratic
    del font["CFF "]
    glyf.compile(font)
    # A TrueType glyph's left side bearing is the left edge of its outline.
    hmtx = font["hmtx"]
    for name, glyph in glyf.glyphs.items():
        if hasattr(glyph, "xMin"):
            hmtx[name] = (hmtx[name][0], glyph.xMin)
    font["maxp"] = maxp = newTable("maxp")
    maxp.tableVersion = 0x00010000
    maxp.maxZones = 1
    maxp.maxTwilightPoints = 0
    maxp.maxStorage = 0
    maxp.maxFunctionDefs = 0
    maxp.maxInstructionDefs = 0
    maxp.maxStackElements = 0
    maxp.maxSizeOfInstructions = 0
    maxp.maxComponentElements = max(
        len(getattr(g, "components", [])) for g in glyf.glyphs.values()
    )
    maxp.compile(font)
    # The glyphs keep their names, which the CFF table carried until now.
    post = font["post"]
    post.formatType = 2.0
    post.extraNames = []
    post.mapping = {}
    post.glyphOrder = order
    font.sfntVersion = "\000\001\000\000"
    font.flavor = "woff2"
    font.save(dst)


def check(src, dst):
    a, b = TTFont(src), TTFont(dst)
    if b.sfntVersion != "\000\001\000\000" or "glyf" not in b or "CFF " in b:
        sys.exit(dst + " did not come out with TrueType outlines")
    if a.getGlyphOrder() != b.getGlyphOrder():
        sys.exit(dst + ": the glyphs are not the ones read, in their order")
    for name in a.getGlyphOrder():
        if a["hmtx"][name][0] != b["hmtx"][name][0]:
            sys.exit(dst + ": the advance of " + name + " moved")
    for tag in KEPT:
        if (tag in a) != (tag in b) or (tag in a and a.getTableData(tag) != b.getTableData(tag)):
            sys.exit(dst + ": the table " + tag + " is not the one read")
    # Each outline within a unit of the one it was made from, read off the
    # boxes: the curves are within MAX_ERR by construction, and a box is where
    # a wrong winding or a lost contour would show.
    glyphs_a, glyphs_b = a.getGlyphSet(), b.getGlyphSet()
    from fontTools.pens.boundsPen import BoundsPen
    worst = 0.0
    for name in a.getGlyphOrder():
        pa, pb = BoundsPen(glyphs_a), BoundsPen(glyphs_b)
        glyphs_a[name].draw(pa)
        glyphs_b[name].draw(pb)
        if (pa.bounds is None) != (pb.bounds is None):
            sys.exit(dst + ": " + name + " lost or gained its outline")
        if pa.bounds:
            worst = max(worst, max(abs(x - y) for x, y in zip(pa.bounds, pb.bounds)))
    if worst > 1.0:
        sys.exit(dst + ": an outline's box moved by " + str(worst) + " units")
    return worst


def main():
    source = os.path.join(TREES[0], "fonts")
    made = {}
    for face in FACES:
        name = "LatinModernRoman-" + face + ".woff2"
        src = os.path.join(source, name)
        dst = os.path.join(TREES[0], "print", name)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        convert(src, dst)
        worst = check(src, dst)
        made[name] = open(dst, "rb").read()
        print("%s: %d bytes from %d, boxes within %.2f of a unit" % (
            name, len(made[name]), os.path.getsize(src), worst))
    # The two render trees are copies of each other.
    for tree in TREES[1:]:
        os.makedirs(os.path.join(tree, "print"), exist_ok=True)
        for name, data in made.items():
            with open(os.path.join(tree, "print", name), "wb") as f:
                f.write(data)


if __name__ == "__main__":
    main()
