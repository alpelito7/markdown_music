-- mdm.lua: Quarto filter for music blocks (ABC notation).
-- HTML: rendered by abcjs in the browser (SVG, playback optional), on a page
-- dressed as the VS Code editor (see the look section below).
-- PDF (LaTeX): engraved by the same abcjs, loaded into a headless Chrome and
-- printed to a vector PDF (see the engraver section); a machine without a
-- Chrome falls back to abcm2ps -> EPS -> epstopdf. Either way the engraving
-- is inserted as an image, cached by a hash of the source.

local CACHE_DIR = "mdm_cache"

local deps_added = false
local look_added = false

-- ---------- The look of the editor ----------
--
-- The exported HTML is meant to read as the editor does: the same ground and
-- the same ink, the same syntax colours over the same code cards, the same
-- scores and the same player bar. The rules live in resources/mdm-look.css,
-- which is a port of the editor's own stylesheet (vscode-mdm/media/style.css)
-- and spends the custom properties below; what varies from one document to
-- the next, the side the editor is on and the colours it read from the VS
-- Code theme, travels as plain metadata and is written out here.
--
-- The VS Code extension passes those keys when it renders from the toolbar
-- (extension.js, exportLook). A plain `bin/mdm render` passes none, and the
-- fallbacks in the stylesheet take over: they are the editor's own, the ones
-- it shows when it cannot read a theme.
--
-- These values are interpolated into a <style> block, and metadata is
-- whatever the command line carried, so only what is listed gets through: one
-- of the words named here, or a six-digit hex colour written WITHOUT its `#`
-- (a `#` inside a -M value opens a YAML comment and would take the rest of
-- the argument with it).

-- The two grounds, the ink and the accents, per side. `card` and `page` are
-- the arrangement the editor makes of its two mixes: on the light side the
-- code sits on the tint and the page takes the wash, on the dark one the code
-- drops to the theme's own background and the page rises to the tint, and
-- white is the light arrangement on a sheet of paper.
local SIDES = {
  light = {
    ink = "#24292e",
    link = "#0969da",
    accent = "#a0740f",
    accent_ink = "#8a5f00",
    svg_ink = "#000000",
    staff = "#a3a3a3",
    card = "var(--mdm-syn-tint)",
    page = "var(--mdm-syn-wash)",
    card_tex = "mdmtint",
    page_tex = "mdmwash",
  },
  dark = {
    ink = "#d4d4d4",
    link = "#58a6ff",
    accent = "#d9a94f",
    accent_ink = "#d9a94f",
    svg_ink = "#d4d4d4",
    staff = "#6f6f6f",
    -- The card is lifted off the page and not sunk into it: a theme that
    -- draws its editor near black (Dark 2026 is #121314) leaves a block of
    -- code looking like a hole in the sheet, which is not what it is. The
    -- editor changed to this and the filter was left behind (style.css,
    -- `#app.mdm--dark`). In TeX the mix is written against mdmtint rather
    -- than mdmpage because mdmcard is defined first.
    card = "color-mix(in srgb, var(--mdm-ink) 4%, var(--mdm-syn-page))",
    page = "var(--mdm-syn-tint)",
    card_tex = "mdmink!4!mdmtint",
    page_tex = "mdmtint",
  },
  white = {
    ink = "#24292e",
    link = "#0969da",
    accent = "#a0740f",
    accent_ink = "#8a5f00",
    svg_ink = "#000000",
    staff = "#a3a3a3",
    card = "var(--mdm-syn-tint)",
    page = "#fff",
    card_tex = "mdmtint",
    page_tex = "white",
  },
}

-- mdm.scoreFill: the background a score can be given, one value per side.
local SCORE_FILLS = {
  none = nil,
  paper = { light = "#f4efe2", dark = "#2a2723" },
  slate = { light = "#eceef1", dark = "#2c3138" },
  brass = { light = "#f7edd8", dark = "#332c1c" },
}

-- What the stylesheet leaves to its own `:root` block, the fallback palette a
-- render with no editor behind it gets (stackoverflow-light, the editor's own
-- when it cannot read a theme). LaTeX has no cascade to fall back through, so
-- the ten slots and the error colour are written out whether they arrived or
-- not.
-- One set per side, which is what the editor's stylesheet carries (style.css,
-- `#app` and `#app.mdm--dark`): stackoverflow-light on the light side and
-- Monokai on the dark one, over the ground of VS Code's Dark 2026. The dark
-- set used to be missing here, and a dark render that carried no palette came
-- out with the dark side's ink, #d4d4d4, over a ground mixed from the LIGHT
-- side's #f6f6f6: light grey on near-white, a page with nothing readable on
-- it. That is not a rare corner, it is every export made from an editor held
-- to dark while VS Code is on a light theme, and every `bin/mdm render -M
-- mdm-look:dark` from a terminal.
local FALLBACK_COLORS = {
  light = {
    base = "#2f3337",
    bg = "#f6f6f6",
    comment = "#656e77",
    string = "#54790d",
    number = "#b75501",
    keyword = "#015692",
    attr = "#015692",
    name = "#b75501",
    type = "#b75501",
    variable = "#54790d",
  },
  dark = {
    base = "#f8f8f2",
    bg = "#121314",
    comment = "#88846f",
    string = "#e6db74",
    number = "#ae81ff",
    keyword = "#f92672",
    attr = "#f92672",
    name = "#a6e22e",
    type = "#66d9ef",
    variable = "#f8f8f2",
  },
}

-- Which of the two a side reads. White is a light look on a sheet of paper,
-- so it takes the light palette and only the ground changes.
local PALETTE_SIDES = { light = "light", white = "light", dark = "dark" }

-- The ten slots the editor paints code with (theme.js), in the order they are
-- written out.
local SYNTAX_SLOTS = {
  "base", "bg", "comment", "string", "number",
  "keyword", "attr", "name", "type", "variable",
}

local look = nil -- the metadata that arrived, once Meta has read it

local function meta_string(meta, key)
  local value = meta[key]
  if value == nil then return nil end
  local ok, text = pcall(function() return pandoc.utils.stringify(value) end)
  if not ok or type(text) ~= "string" or text == "" then return nil end
  return text
end

-- A word from a fixed list, or nil. `default` is what an unknown value falls
-- back to, which is also what a document rendered from the command line gets.
local function meta_word(meta, key, allowed, default)
  local text = meta_string(meta, key)
  if text and allowed[text] ~= nil then return text end
  return default
end

-- A six-digit hex colour written without its `#`, given one back.
local function meta_color(meta, key)
  local text = meta_string(meta, key)
  if text and text:match("^%x%x%x%x%x%x$") then return "#" .. text end
  return nil
end

local function read_look(meta)
  local side = meta_word(meta, "mdm-look", SIDES, "light")
  local out = {
    side = side,
    staff_lines = meta_word(meta, "mdm-staff-lines", { gray = true, ink = true }, "gray"),
    score_fill = meta_word(meta, "mdm-score-fill", SCORE_FILLS, "none"),
    score_align = meta_word(meta, "mdm-score-align", { center = true, left = true }, "center"),
    -- The face the words are set in: the roman is Latin Modern, carried by
    -- this extension, and the sans is what the page and the paper have always
    -- been set in, which is why it is the fallback here. The editor names it
    -- on every render it makes (exportLook), so a document exported from the
    -- toolbar comes out in the face it was being read in; a plain
    -- `bin/mdm render`, which passes no look at all, keeps the sans.
    text_font = meta_word(meta, "mdm-text-font", { roman = true, sans = true }, "sans"),
    -- Which engraver draws the PDF: the editor's own abcjs through Chrome,
    -- unless the document asks for abcm2ps (or no Chrome is found).
    engraver = meta_word(meta, "mdm-engraver", { abcjs = true, abcm2ps = true }, "abcjs"),
    -- Not a look of the editor's: whether the document names a maths font of
    -- its own, which the scale below leaves alone.
    mathfont = meta_string(meta, "mathfont") ~= nil,
    mainfont = meta_string(meta, "mainfont") ~= nil,
    colors = {},
  }
  for _, slot in ipairs(SYNTAX_SLOTS) do
    out.colors[slot] = meta_color(meta, "mdm-syn-" .. slot)
  end
  return out
end

-- The custom properties the stylesheet spends, as the look in force sets
-- them. Written on `html:root` and not on `:root`: the stylesheet carries the
-- same properties as its fallbacks, and where in the head this block lands
-- with respect to it is Quarto's business, so the two are told apart by
-- weight instead of by order (a selector with an element in it outranks the
-- bare pseudo-class, whichever is read first).
local function look_css(l)
  local side = SIDES[l.side] or SIDES.light
  local dark = l.side == "dark"
  local lines = {}
  local function put(name, value)
    lines[#lines + 1] = "  --mdm-" .. name .. ": " .. value .. ";"
  end
  -- A slot the palette carried, and on the dark side every slot it did not.
  -- The stylesheet's own `:root` block holds the light set alone, so on the
  -- light side there is a cascade to leave the rest to and nothing is written
  -- (a render with no editor behind it says nothing about colours, which is
  -- what the tests read); on the dark side there is nothing under it to fall
  -- to, and leaving a slot out is what put the dark ink on the light ground.
  local fallback = FALLBACK_COLORS[PALETTE_SIDES[l.side] or "light"]
  for _, slot in ipairs(SYNTAX_SLOTS) do
    local value = l.colors[slot] or (dark and fallback[slot] or nil)
    if value then put("syn-" .. slot, value) end
  end
  put("ink", side.ink)
  put("link", side.link)
  -- What the browser paints itself (the scrollbars above all) follows the
  -- side the document is on, not the one the reader's system is set to.
  if dark then put("scheme", "dark") end
  put("play-accent", side.accent)
  -- The deep form of the accent, which the chrome writes its held states in.
  -- On the dark side it is the accent itself: it already reads there.
  put("play-accent-ink", side.accent_ink)
  put("svg-ink", side.svg_ink)
  put("syn-card", side.card)
  put("syn-page", side.page)
  -- Gray staff lines are drawn in a gray of their own; in ink they are left
  -- to the colour the score is drawn in, which is what the editor does by
  -- letting its rule miss them.
  put("staff-fill", l.staff_lines == "gray" and side.staff or "currentColor")
  local fill = SCORE_FILLS[l.score_fill]
  if fill then
    put("score-fill", dark and fill.dark or fill.light)
    put("score-pad", "0.6em 0.8em")
    put("score-radius", "4px")
  end
  -- A score sits centred like a display equation, unless the editor was set
  -- to line them up with the text.
  if l.score_align == "left" then put("score-margin", "0") end
  -- The roman, when the editor was in it. The faces themselves ride with the
  -- page as their own dependency (ensure_look), and this is the line that
  -- spends them: mdm-look.css sets --mdm-text to the sans and reads it on the
  -- body and the headings, so the words move and the chrome does not.
  if l.text_font == "roman" then
    put("text", '"Latin Modern Roman", Georgia, "Times New Roman", serif')
  end
  return "<style>\nhtml:root {\n" .. table.concat(lines, "\n") .. "\n}\n</style>"
end


-- ---------- The same look, on paper ----------

local ERROR_COLOR = "#c94f4f"

-- Every token class Pandoc paints code with, on the slot the stylesheet gives
-- it (the `body code span.xx` rules of mdm-look.css, class for class). What is
-- not named here Pandoc leaves to \NormalTok, which is the base slot.
local TOKENS = {
  { "AlertTok", "error" }, { "AnnotationTok", "comment" },
  { "AttributeTok", "attr" }, { "BaseNTok", "number" },
  { "BuiltInTok", "name" }, { "CharTok", "string" },
  { "CommentTok", "comment" }, { "CommentVarTok", "comment" },
  { "ConstantTok", "number" }, { "ControlFlowTok", "keyword" },
  { "DataTypeTok", "type" }, { "DecValTok", "number" },
  { "DocumentationTok", "comment" }, { "ErrorTok", "error" },
  { "ExtensionTok", "base" }, { "FloatTok", "number" },
  { "FunctionTok", "name" }, { "ImportTok", "keyword" },
  { "InformationTok", "comment" }, { "KeywordTok", "keyword" },
  { "NormalTok", "base" }, { "OperatorTok", "base" },
  { "OtherTok", "base" }, { "PreprocessorTok", "keyword" },
  { "RegionMarkerTok", "comment" }, { "SpecialCharTok", "string" },
  { "SpecialStringTok", "string" }, { "StringTok", "string" },
  { "VariableTok", "variable" }, { "VerbatimStringTok", "string" },
  { "WarningTok", "error" },
}

-- A colour on its way into \definecolor: the six hex digits, no `#`.
local function tex_hex(value)
  return (value or "#000000"):gsub("^#", ""):upper()
end

-- The preamble the PDF is dressed with: the LaTeX half of mdm-look.css, and
-- the same look travels to both. The page takes the ground of the side the
-- editor is on, the text its ink, code the card with the ten slots over it,
-- and the headings the sizes, the weight and the hairlines of the editor.
--
-- What the browser computes from the custom properties, the two mixes of the
-- palette, is computed here by xcolor, which mixes the same way (`A!6!B` is
-- six parts of A in a hundred, as `color-mix(in srgb, A 6%, B)` is).
--
-- The measure travels as well, in ems: the editor's column is 820 px of text
-- set at 16 px, which is 51.25 of its own ems whatever the body size turns out
-- to be. What the paper cannot hold it clamps (see the geometry block below).
--
-- One thing of the editor does not travel: the card behind inline code, which
-- would take a \colorbox and stop the line from breaking inside it. The fill
-- and the alignment a score can be given are the score's and not the page's,
-- and are written around the engraving instead (the \mdmscore below).
--
-- The colours of an engraving are not written here but into the EPS itself,
-- since what the page says has no bearing on a graphic that carries its own
-- (paint_eps, further down).
-- Where the rule under h1 and h2 stands: a fixed distance under the baseline
-- of the heading's last line, whatever its letters, in ems of the body, as
-- the editor draws it. There the rule is the line's border, under its padding
-- (0.2 and 0.15 of the heading's own size) and the part of its 1.3 line that
-- falls under the baseline, which depends on the face: 0.749 and 0.486 em in
-- the roman, 1.062 and 0.674 in the sans (measured in the editor twice over;
-- the sans there is Noto Sans, the face this machine gives system-ui, and
-- another platform's interface face puts it elsewhere).
-- On paper the rule used to hang from the depth of the last line, with the
-- class's own spacing over it, so it stood at a different distance in each
-- class and went down under a last line with descenders (1.05 em under an h1
-- in the roman against 0.58 with none, measured). \mdmheadrule takes the
-- depth back out, and the distance is the one named here in either class.
local HEAD_RULE_AIR = { roman = { "0.749", "0.486" }, sans = { "1.062", "0.674" } }

-- How much larger than its size the paper draws the roman: the x-height the
-- editor holds the roman to (0.528 em, `font-size-adjust` in style.css and in
-- mdm-roman.css) over the one Latin Modern has of its own (0.431 em, read off
-- lmroman10-regular.otf with fontTools). 1.2251.
local ROMAN_SCALE = string.format("%.4f", 0.528 / 0.431)
-- And the bold's, which is not the same number: font-size-adjust holds each
-- face of the family to 0.528 by that face's own OS/2 sxHeight, and the two
-- bold files carry 0.444 where the regular and the italic carry 0.431 (read
-- with fontTools off the four woff2 and the four lmroman10 .otf alike, and
-- Chrome's `ex` reads the same four in the editor). Under the one Scale the
-- four files used to share, the bold stood 3% taller on paper than on
-- screen: its lowercase at 0.5439 of \mdmem against the regular's 0.528,
-- measured with txtwrite and off the page's pixels, article and KOMA alike.
-- The italic keeps the regular's Scale, its sxHeight being the regular's.
-- 1.1892.
local ROMAN_BOLD_SCALE = string.format("%.4f", 0.528 / 0.444)

-- The LaTeX command each level of Markdown heading is written as, which is
-- the writer's to decide and not the class's alone. Measured with Pandoc 3.8.3
-- through Quarto 1.9.37 (keep-tex): `#` is \section under article, scrartcl,
-- amsart and amsbook, \chapter under report, book, memoir, scrreprt and
-- scrbook, \part under `top-level-division: part`, and \section again on a
-- book given `top-level-division: section`. The levels under it follow one
-- step at a time down to \subparagraph, and a level past that is written as a
-- plain paragraph (`######` in an article).
--
-- So the writer is asked, with a document of one heading that carries this
-- document's metadata and the two options the choice reads (the
-- `documentclass` variable first, then the metadata, then the division, in
-- Writers/LaTeX.hs), and the rule is not copied here. A copy would have to
-- keep Pandoc's list of chapter classes, which leaves amsbook out, and one of
-- its quirks besides: a class given on the command line
-- (`-M documentclass:report`) arrives as a plain string, which Pandoc's own
-- stringify reads as empty, so the page is \documentclass{report} and `#` is
-- still \section (measured), where pandoc.utils.stringify reads "report".
-- The probe carries the document's own metadata for the same reason: a
-- pandoc.Meta rebuilt around a stringified class answers \section under
-- report as well (measured). The template is left out of the options: the
-- choice does not read it, and without it the answer is one line and not a
-- whole preamble (0.3 to 0.7 ms of CPU against 0.9 to 2.9 with it, measured
-- over eighteen renders). PANDOC_WRITER_OPTIONS reaches Quarto's filters
-- (measured in Meta); without it the article's commands are the answer.
--
-- What it cannot see is `shift-heading-level-by`, which Pandoc applies after
-- the filters and which reaches neither the metadata nor the options a filter
-- is handed: with a shift of 1, `#` is written \subsection and this still
-- answers \section, so every level is drawn at the size of the one under it.
-- Open.
local DIVISIONS = { "part", "chapter", "section", "subsection",
  "subsubsection", "paragraph", "subparagraph" }

local function heading_commands(meta)
  local top = "section"
  if PANDOC_WRITER_OPTIONS then
    local probe = pandoc.Pandoc({ pandoc.Header(1, "mdmprobe") }, meta)
    local ok, tex = pcall(pandoc.write, probe, "latex", pandoc.WriterOptions{
      top_level_division = PANDOC_WRITER_OPTIONS.top_level_division,
      variables = PANDOC_WRITER_OPTIONS.variables,
    })
    top = ok and tex:match("\\(%a+)%*?{mdmprobe}") or "section"
  end
  local first = 3
  for i, name in ipairs(DIVISIONS) do
    if name == top then first = i end
  end
  local heads = {}
  for level = 1, 6 do heads[level] = DIVISIONS[first + level - 1] end
  return heads
end

local function look_tex(l)
  local side = SIDES[l.side] or SIDES.light
  local out = {}
  local function put(line) out[#out + 1] = line end
  local function color(name, value)
    put("\\definecolor{" .. name .. "}{HTML}{" .. tex_hex(value) .. "}")
  end

  put("%% ---------- MDM: the page dressed as the editor ----------")
  local fallback = FALLBACK_COLORS[PALETTE_SIDES[l.side] or "light"]
  for _, slot in ipairs(SYNTAX_SLOTS) do
    color("mdmsyn" .. slot, l.colors[slot] or fallback[slot])
  end
  color("mdmerror", ERROR_COLOR)
  color("mdmink", side.ink)
  color("mdmlink", side.link)
  put("\\colorlet{mdmtint}{mdmsynbase!6!mdmsynbg}")
  put("\\colorlet{mdmwash}{mdmsynbase!2!mdmsynbg}")
  put("\\colorlet{mdmcard}{" .. side.card_tex .. "}")
  put("\\colorlet{mdmpage}{" .. side.page_tex .. "}")
  put("\\colorlet{mdmrule}{mdmink!14!mdmpage}")
  put("\\colorlet{mdmquiet}{mdmink!72!mdmpage}")

  -- The face of the words, and the whole of what mdm-text-font decides on
  -- paper. In the sans the editor asks the platform for its own interface font
  -- and falls back to Helvetica, which is what TeX Gyre Heros is: under pdfTeX
  -- it comes as an NFSS family, under XeTeX and LuaTeX through fontspec, since
  -- the Unicode engines look for a font by name and would otherwise fall back
  -- to the roman. A distribution without it keeps whatever it has.
  --
  -- In the roman the face is LaTeX's own already, Latin Modern, and what the
  -- paper was missing is the size it is drawn at. The editor does not draw
  -- the roman at its own proportions: it holds its lowercase to 0.528 of the
  -- em (`font-size-adjust`, style.css and mdm-roman.css), the x-height of the
  -- sans it replaced, because every other size on the page was designed
  -- against that one, the equations first. KaTeX sets them at 1.21 of the
  -- text in Computer Modern shapes, whose lowercase is 0.431 to 0.442 of an
  -- em, so beside the adjusted words they land within 2%. Left at its own
  -- 0.431, the paper's roman read a fifth smaller than the maths set into it:
  -- measured on example.pdf, the words at 9.96 pt and the formulas at 12.06.
  --
  -- fontspec's Scale is the same lever as font-size-adjust. \\f@size, and so
  -- \\mdmem and every length hung from it, stays where it was, and only the
  -- glyphs grow, by ROMAN_SCALE, and the two bold files by ROMAN_BOLD_SCALE,
  -- since the editor weighs each face by its own x-height (over look_tex).
  -- The four files are the ones the editor
  -- carries (lmroman10, the 10 pt optical size), named one by one so the
  -- paper is set in the drawing the screen is: asked for by family name,
  -- luaotfload picks the optical size by the scaled size, which is Latin
  -- Modern 12 for the body and 17 for the title, narrower drawings than the
  -- one the editor breaks its lines with. A document that names a `mainfont`
  -- of its own keeps it as it asked.
  --
  -- Under pdfTeX there is no fontspec to scale with and the roman keeps its
  -- own x-height, so the maths comes out about a fifth larger than the words
  -- there. It is the one engine this does not reach, and not the one Quarto
  -- renders with. The sans is still declared either way, so a \\textsf in
  -- the document has Helvetica to reach for.
  local roman = l.text_font == "roman"
  put("\\ifPDFTeX")
  if not roman then
    put("  \\IfFileExists{tgheros.sty}{\\usepackage{tgheros}}{\\usepackage{helvet}}")
    put("  \\renewcommand{\\familydefault}{\\sfdefault}")
  end
  put("  \\IfFileExists{DejaVuSansMono.sty}{\\usepackage[scaled=0.88]{DejaVuSansMono}}{}")
  put("\\else")
  put("  \\usepackage{fontspec}")
  if roman then
    if not l.mainfont then
      put("  \\IfFontExistsTF{lmroman10-regular.otf}{%")
      put("    \\setmainfont{lmroman10-regular.otf}[Scale=" .. ROMAN_SCALE .. ",")
      put("      ItalicFont=lmroman10-italic.otf, BoldFont=lmroman10-bold.otf,")
      put("      BoldItalicFont=lmroman10-bolditalic.otf,")
      put("      BoldFeatures={Scale=" .. ROMAN_BOLD_SCALE .. "},")
      put("      BoldItalicFeatures={Scale=" .. ROMAN_BOLD_SCALE .. "},")
      put("      SmallCapsFont=lmromancaps10-regular.otf,")
      put("      SlantedFont=lmromanslant10-regular.otf]}{}")
    end
    put("  \\IfFontExistsTF{TeX Gyre Heros}{\\setsansfont{TeX Gyre Heros}}{}")
  else
    put("  \\IfFontExistsTF{TeX Gyre Heros}{\\setmainfont{TeX Gyre Heros}\\setsansfont{TeX Gyre Heros}}{}")
  end
  -- Code at 0.88 of the text, which is the size the stylesheet gives it.
  put("  \\IfFontExistsTF{DejaVu Sans Mono}{\\setmonofont{DejaVu Sans Mono}[Scale=0.88]}{}")
  -- The maths at 1.21 of the text, which is what KaTeX sets its own at
  -- (`.katex{font: normal 1.21em KaTeX_Main}`): it draws with Computer Modern
  -- shapes as LaTeX does, and 1.21 is the compensation both need beside a sans
  -- with the x-height of Helvetica. Without it the maths came out visibly
  -- smaller than the words around it and a \\sqrt over a fraction came out
  -- cramped. A document that names a `mathfont` of its own is left alone:
  -- Quarto writes that into the preamble before this block is read.
  --
  -- The face is New Computer Modern in its Book weight, not Latin Modern:
  -- KaTeX's fonts are Computer Modern thickened for the screen, and NewCM
  -- Book is the same correction cut for paper, where Latin Modern beside a
  -- sans with the weight of Helvetica came out starved of ink, and its
  -- radical sign met the vinculum with a visible gap at this scale (measured
  -- on the \\sqrt of example.mdm). Latin Modern stays as the fallback for a
  -- distribution without NewCM.
  --
  -- \\setmathrm besides: unicode-math takes the words of an operator (\\sin,
  -- \\cos, \\mathrm) from the text font, which here is the sans, where KaTeX
  -- sets them in its upright serif; the roman of the same family puts them
  -- back.
  --
  -- In the roman the face changes and the reason for the scale does not. The
  -- words are Latin Modern held to the sans's x-height (above), so the maths
  -- standing in for KaTeX's grows by the same ROMAN_SCALE to stay the size of
  -- the words: the same drawing scaled the same, Latin Modern Math's
  -- lowercase being Latin Modern's, 0.431 em on both (read off the files).
  -- Pandoc's template reaches the same size by another road, which is worth
  -- knowing before this Scale is taken for dead weight: it sets
  -- `\\defaultfontfeatures{Scale=MatchLowercase}` before this block is read,
  -- and that scales a maths face asked for with no Scale of its own to the
  -- lowercase of the main font, landing it at 12.21 pt beside words at 12.21
  -- either way. The explicit Scale is what holds under a template without
  -- that default: in a plain document an unscaled Latin Modern Math came out
  -- at 9.96 pt beside the same words.
  -- The face goes to Latin
  -- Modern Math rather than NewCM Book: Book is Computer Modern thickened, and
  -- it was picked to hold its own beside Helvetica's weight, which is not what
  -- stands beside it here. NewCM stays as the fallback for a distribution
  -- without the Latin Modern maths. No \\setmathrm either: unicode-math takes
  -- the words of an operator from the text font, and here that is already the
  -- roman KaTeX sets them in.
  if not l.mathfont then
    if roman then
      put("  \\IfFontExistsTF{Latin Modern Math}" ..
          "{\\setmathfont{Latin Modern Math}[Scale=" .. ROMAN_SCALE .. "]}{%")
      put("    \\IfFontExistsTF{NewCMMath-Book.otf}" ..
          "{\\setmathfont{NewCMMath-Book.otf}[Scale=" .. ROMAN_SCALE .. "]}{}%")
      put("  }")
    else
      put("  \\IfFontExistsTF{NewCMMath-Book.otf}{%")
      put("    \\setmathfont{NewCMMath-Book.otf}[Scale=1.21]%")
      put("    \\IfFontExistsTF{NewCM10-Book.otf}" ..
          "{\\setmathrm{NewCM10-Book.otf}[Scale=1.21]}{}%")
      put("  }{%")
      put("    \\IfFontExistsTF{Latin Modern Math}{%")
      put("      \\setmathfont{Latin Modern Math}[Scale=1.21]%")
      put("      \\setmathrm{Latin Modern Roman}[Scale=1.21]}{}%")
      put("  }")
    end
  end
  -- Inline code sits on a chip of the card material, as in the editor. A
  -- \\colorbox would refuse to break at the end of a line, which is why the
  -- chip did not travel at first; lua-ul paints the ground under the glyphs
  -- without boxing them, so a long piece of code wraps as it does in the
  -- browser. LuaTeX only, which is the engine Quarto renders with unless the
  -- document names another; under XeTeX the code keeps its bare mono, as
  -- before. The \\hspace on either side is the 0.3em padding of the chip.
  put("  \\ifLuaTeX")
  put("    \\usepackage{luacolor}\\usepackage{lua-ul}")
  put("    \\NewCommandCopy{\\mdmtexttt}{\\texttt}")
  put("    \\renewcommand{\\texttt}[1]{\\highLight[mdmcard]" ..
      "{\\textcolor{mdmsynbase}{\\mdmtexttt{\\hspace{0.3em}#1\\hspace{0.3em}}}}}")
  put("  \\fi")
  put("\\fi")

  -- The editor sets its text at 1.7 line heights, LaTeX at 1.2 of its own.
  put("\\linespread{1.417}")
  put("\\pagecolor{mdmpage}")
  put("\\colorlet{shadecolor}{mdmcard}")
  put("\\AtBeginDocument{\\color{mdmink}}")
  put("\\AtBeginDocument{\\hypersetup{colorlinks=true,linkcolor=mdmlink," ..
      "urlcolor=mdmlink,citecolor=mdmlink,filecolor=mdmlink}}")

  put("\\makeatletter")
  -- The heading sizes are the editor's, which are multiples of the body size:
  -- it is read off the class once, at the start of the document, since inside
  -- a heading the size in force is already the heading's own.
  put("\\newlength{\\mdmem}")
  put("\\newlength{\\mdmmeasure}")
  put("\\AtBeginDocument{\\setlength{\\mdmem}{\\f@size pt}}")
  -- The measure of the editor: its column is 820 px wide with the text at
  -- 16 px, which is 51.25 of its own ems, and that is what the page is given,
  -- centred on the sheet. The clamp is what keeps a narrow paper from losing
  -- its margins to it. A document that sets a `geometry` of its own keeps the
  -- page it asked for, which is why the whole block is asked first.
  put("\\@ifpackageloaded{geometry}{}{%")
  put("  \\RequirePackage{geometry}%")
  put("  \\AtBeginDocument{%")
  put("    \\setlength{\\mdmmeasure}{51.25\\mdmem}%")
  put("    \\ifdim\\mdmmeasure>\\dimexpr\\paperwidth-3cm\\relax")
  put("      \\setlength{\\mdmmeasure}{\\dimexpr\\paperwidth-3cm\\relax}%")
  put("    \\fi")
  put("    \\newgeometry{textwidth=\\mdmmeasure,vmargin=2.5cm,includefoot,centering}%")
  put("  }%")
  put("}")
  -- The code font is already 0.88 of the text (above), so the blocks take the
  -- body size and land where the editor puts them; \\small on top of that
  -- would shrink them twice.
  put("\\@ifundefined{fvset}{}{\\fvset{fontsize=\\normalsize}}")
  -- The editor sets its text ragged right, as a browser does, and squeezes no
  -- glyph to fit one more word into a line. Justified, and with microtype
  -- expanding the font, the same paragraph at the same measure took a word
  -- more per line than the editor showed (measured on the opening paragraph of
  -- example.mdm: `source code` where the editor breaks after `source`).
  put("\\@ifpackageloaded{microtype}{\\microtypesetup{expansion=false}}{}")
  put("\\AtBeginDocument{\\raggedright}")
  -- The rule under a heading, #1 ems of the body under the baseline of its
  -- last line (HEAD_RULE_AIR has the distances and where they come from). The
  -- skip is taken from the baseline and not from the bottom of the line:
  -- \prevdepth is the last line's depth, so it comes off, and a line with
  -- descenders no longer pushes the rule down, as in the editor, where the
  -- rule is the border of a line box of a fixed height (measured with an air
  -- of 0.57: the rule stood 0.571 em under a one-line h1 and 0.573 under a
  -- wrapped one whose last line had descenders, where the depth had put it at
  -- 0.58 and 1.05).
  put("\\newcommand*{\\mdmheadrule}[1]{\\par\\nobreak" ..
      "\\vskip\\dimexpr #1\\mdmem-\\prevdepth\\relax" ..
      "{\\color{mdmrule}\\hrule height 0.8pt}}")
  -- Two ways in, since the class is the document's to choose: KOMA, which is
  -- what Quarto gives a document that names none, restyles through its own
  -- hooks, and a standard class through titlesec, which KOMA is not on
  -- speaking terms with.
  -- The folio is set by the output routine, which the \AtBeginDocument ink
  -- above does not reach: on the dark side the page number came out black
  -- on the dark ground (measured, article and KOMA alike). The standard
  -- classes get their \ps@plain rebuilt with the ink in it (redefining
  -- \@oddfoot alone would not last: \maketitle's \thispagestyle{plain}
  -- runs \ps@plain again and puts the black one back); KOMA fonts its
  -- footer through an element of its own.
  -- The air over the author. Pandoc hangs the subtitle off \@title, so the
  -- \vskip 1.5em that article.cls puts between the title and the author is
  -- spent under the subtitle instead: 23.6 pt of it, against the 7.1 pt
  -- between the title and the subtitle (measured on example.pdf), which read
  -- as the name having come loose from the block it belongs to. Patched, not
  -- redefined, so a class whose \@maketitle is shaped otherwise (KOMA's, for
  -- one) is left with the spacing it has: the failure branch is deliberately
  -- empty, and the patch is a no-op there rather than an error.
  put("\\RequirePackage{etoolbox}")
  put("\\patchcmd{\\@maketitle}{\\vskip 1.5em}{\\vskip 0.5em}{}{}")
  -- The title at the size and weight the page gives it, 2 ems of the body at
  -- a 1.3 leading and bold (`body .title` in mdm-look.css draws it as an h1:
  -- 32px and 600 on the 16px body, measured), where the class drew it at its
  -- own \LARGE in an article, 1.728 of the body, and \huge under KOMA, 1.894
  -- (measured). Patched in both shapes of \@maketitle; a class that has
  -- neither keeps its own, the failure branches being empty. The subtitle
  -- Pandoc hangs off \@title in \large would take the title's bold with it,
  -- where the page sets it at 300, so it goes back to the medium weight. Its
  -- size and the author's stay the class's, \large, against the page's 1.33
  -- and 0.9 of the body, and the block stays centred where the page sets it
  -- flush left (measured). Open.
  local title = "\\fontsize{2\\mdmem}{2.6\\mdmem}\\linespread{1}\\selectfont\\bfseries"
  put("\\patchcmd{\\@maketitle}{\\LARGE \\@title}{" .. title .. " \\@title}{}{}")
  put("\\patchcmd{\\@maketitle}{\\huge \\@title}{" .. title .. " \\@title}{}{}")
  put("\\AtBeginDocument{\\patchcmd{\\@title}{\\large}{\\mdseries\\large}{}{}}")
  -- The heading sizes, in ems of the body text and by the level of the
  -- Markdown heading, not by what LaTeX calls the command that draws it. One
  -- ladder for both faces, the editor's (style.css, after
  -- `#app .cm-line.mdm-h6`): Markdown's 2 / 1.5 / 1.25 at the top, then each
  -- level halving what the one above stands over the body, 1.125 and 1.0625,
  -- down to the body at h6. Leading is 1.3 of the size, the editor's, written
  -- to the last digit: rounded to two places it set a wrapped h3's lines
  -- 1.304 of its size apart (measured).
  local HEAD = {
    { "2", "2.6" }, { "1.5", "1.95" }, { "1.25", "1.625" },
    { "1.125", "1.4625" }, { "1.0625", "1.38125" }, { "1", "1.3" },
  }
  -- The command each level is drawn with (heading_commands, over look_tex):
  -- `#` is \section in an article and \chapter in a class with chapters, and
  -- every level under it one command further down. Sized by the command's
  -- name, as this used to be, a class with chapters drew `#` at its own size
  -- (2.488 under report and book, 1.894 under scrreprt and scrbook, 2.074
  -- under memoir) and every level from `##` down at the size of the level
  -- above it (measured). A sixth level has a command only under chapters,
  -- where it is \subparagraph; in an article Pandoc has none for it and
  -- writes a plain paragraph, so the Header filter (sixth_heading) sends it
  -- to \mdmheadsix below, bold at the body's size as the editor draws it.
  -- Every level has a format of its own, so Quarto's block-headings wrapper
  -- decides nothing any more. It rewraps \paragraph and \subparagraph to
  -- stand free of the text, titlesec then had no format for the rewrapped
  -- \subparagraph, and a `#####` under `documentclass: article`, or a `######`
  -- under report or book, stopped the PDF with "titlesec Error: No format for
  -- this command" (reproduced with the filter as it stood).
  -- \linespread{1} goes before \selectfont in every heading's font, so that
  -- the leading written in HEAD is the one drawn: the \linespread{1.417} of
  -- the prose was multiplied into it, and a heading that wrapped was measured
  -- at 1.84 of its size from one line to the next. Now 1.300 at every level,
  -- in both faces, under article, report, book, scrartcl, scrreprt and
  -- scrbook (measured). The heading's strut comes from the same leading, so
  -- the air over a heading shrank with it: an h2 stood 4.48 em under the
  -- prose over it in an article and 5.10 under KOMA, and stands 3.67 and 4.29
  -- now, where the editor leaves 3.91 (baseline to baseline, measured).
  local heads = l.heads or { "section", "subsection", "subsubsection", "paragraph", "subparagraph" }
  local LEAD = "\\linespread{1}"
  put("\\@ifundefined{sectionlinesformat}{%")
  put("  \\def\\ps@plain{\\let\\@mkboth\\@gobbletwo")
  put("    \\let\\@oddhead\\@empty\\let\\@evenhead\\@empty")
  put("    \\def\\@oddfoot{{\\color{mdmink}\\reset@font\\hfil\\thepage\\hfil}}%")
  put("    \\let\\@evenfoot\\@oddfoot}%")
  put("  \\pagestyle{plain}%")
  put("  \\RequirePackage{titlesec}%")
  -- Under a standard class the air around a heading goes by its level too,
  -- so that a level has the same air whichever command draws it: left to its
  -- command, a `##` under report is a \section and took the air of an
  -- article's `#`. These are article.cls's own skips for \section,
  -- \subsection and \subsubsection, and for the levels under them the 3ex
  -- and 2ex titlesec falls back to, which is what an article has drawn them
  -- with so far. An ex is the body's here, titlesec reading these before it
  -- sets the heading's own size. The 0pt on the left takes out the
  -- \parindent article.cls indents a \subparagraph by.
  -- Against the editor the paper stands 0.18 to 0.26 em short over h2 to h6,
  -- and from 0.74 em short to 0.20 over under them (in the sans, which the
  -- editor's roman matches once its heading lines keep their height;
  -- baseline to baseline, measured). Open.
  local AIR = {
    { "3.5ex plus 1ex minus .2ex", "2.3ex plus .2ex" },
    { "3.25ex plus 1ex minus .2ex", "1.5ex plus .2ex" },
    { "3.25ex plus 1ex minus .2ex", "1.5ex plus .2ex" },
    { "3ex plus .9ex minus .18ex", "2ex plus .2ex" },
    { "3ex plus .9ex minus .18ex", "2ex plus .2ex" },
    { "3ex plus .9ex minus .18ex", "2ex plus .2ex" },
  }
  -- A chapter is drawn the way an article draws its `#`, which takes
  -- titlesec's straight class. In the top class titlesec keeps \chapter in,
  -- the air over it goes in through a \vspace* that stays at the top of the
  -- page, and Quarto's \parskip goes in over and under it besides: the
  -- chapter's baseline stood 6.05 em under the top of the text where an
  -- article's `#` stands 1.82 (measured in the roman; the sans within 0.02
  -- em), and in the straight class it stands where the article's does, to
  -- the thousandth of an em in both faces (pdftotext's word boxes, measured
  -- under report and book). The page break is the class's own, the first
  -- three things report.cls and book.cls do in \chapter: a fresh page (a
  -- right-hand one where the class opens chapters there), the plain style on
  -- it, and no float over the heading. The straight class leaves out the
  -- break under a heading that has just been set, and a `#` straight under
  -- another `#` came out on the same page as it (measured under report); the
  -- \@nobreakfalse puts the class's behaviour back. A number, when the
  -- document asks for them, hangs before the title as a section's does, `1
  -- Introduction` on one line, where report.cls sets `Chapter 1` on a line
  -- of its own over it.
  if heads[1] == "chapter" then
    put("  \\titleclass{\\chapter}{straight}%")
    put("  \\providecommand*{\\chapterbreak}{\\if@openright\\cleardoublepage\\else\\clearpage\\fi")
    put("    \\thispagestyle{plain}\\global\\@topnum\\z@}%")
    put("  \\preto\\chapter{\\global\\@nobreakfalse}%")
  end
  for level = 1, 6 do
    local cmd = heads[level]
    if cmd then
      put("  \\titleformat{\\" .. cmd .. "}[hang]{\\color{mdmink}\\bfseries" .. LEAD ..
          "\\fontsize{" .. HEAD[level][1] .. "\\mdmem}{" .. HEAD[level][2] ..
          "\\mdmem}\\selectfont}{\\the" .. cmd .. "}{1em}{}" ..
          (level <= 2 and "[\\mdmheadrule{" .. HEAD_RULE_AIR[roman and "roman" or "sans"][level] ..
            "}]" or "") .. "%")
      put("  \\titlespacing*{\\" .. cmd .. "}{0pt}{" .. AIR[level][1] .. "}{" ..
          AIR[level][2] .. "}%")
    end
  end
  -- The sixth level in an article, where Pandoc has no command for it and
  -- writes it as a plain paragraph (the Header filter, further down, hands it
  -- here instead): bold, at the body's size and leading, flush, with the air
  -- the levels over it have, and the paragraph after it neither indented nor
  -- parted from it by a page.
  put("  \\newcommand*{\\mdmheadsix}[1]{\\par\\addvspace{" .. AIR[6][1] .. "}" ..
      "{\\noindent\\color{mdmink}\\bfseries" .. LEAD .. "\\fontsize{" .. HEAD[6][1] ..
      "\\mdmem}{" .. HEAD[6][2] .. "\\mdmem}\\selectfont #1\\par}" ..
      "\\nobreak\\vskip " .. AIR[6][2] .. "\\relax\\@afterheading}%")
  put("}{%")
  put("  \\setkomafont{disposition}{\\bfseries\\color{mdmink}}%")
  -- pagenumber and not pageheadfoot alone: KOMA's pagenumber element opens
  -- with \normalcolor, which threw away any ink the head-and-foot element
  -- set before it (measured: the folio stayed black on the dark side).
  put("  \\setkomafont{pageheadfoot}{\\color{mdmink}}%")
  put("  \\addtokomafont{pagenumber}{\\color{mdmink}}%")
  -- KOMA sets a subtitle with an element of its own, which takes the title's
  -- font and with it the bold of the disposition above; the page sets the
  -- subtitle at 300 (measured), so it goes back to the medium weight here as
  -- it does under a standard class (the \@title patch over the headings).
  put("  \\addtokomafont{subtitle}{\\mdseries}%")
  for level = 1, 6 do
    local cmd = heads[level]
    if cmd then
      put("  \\addtokomafont{" .. cmd .. "}{\\fontsize{" .. HEAD[level][1] .. "\\mdmem}{" ..
          HEAD[level][2] .. "\\mdmem}" .. LEAD .. "\\selectfont}%")
    end
  end
  -- Under KOMA every level under the first stands on a line of its own,
  -- flush with the text, with the skips KOMA gives a \subsection, whatever
  -- command draws it; under chapters that is what gives \section the air of
  -- the h2 it is (with its own skips it stood 0.13 em further from the prose
  -- over it and 0.42 em further from the prose under it than the same `##`
  -- in an article). KOMA runs \paragraph and \subparagraph in, the text going
  -- on after them on the same line; Quarto's template stands them apart by
  -- closing each with an empty \mbox, but the heading is then the start of a
  -- paragraph that ends after its font has closed, so a wrapped one took the
  -- body's leading, 1.564 and 1.656 of its size (measured). Redeclared with a
  -- positive afterskip they are displayed headings as \subsubsection is, and
  -- the redeclaration defines the command anew, so Quarto's wrapper goes with
  -- it. indent=\z@: KOMA indents a \subparagraph by the paragraph indent it
  -- keeps aside, which under `indent: true` set `#####` 14.2 bp in from the
  -- text in the roman and 11.6 in the sans (measured; the prose itself is
  -- never indented here, the \raggedright above setting \parindent to zero).
  -- The air under h3 to h6 is left open: 3.17 em from a heading's baseline to
  -- the prose's on paper, 2.5 to 2.6 in the editor (measured, both faces).
  local below = {}
  for level = 2, 6 do
    local cmd = heads[level]
    if cmd and cmd ~= "chapter" and cmd ~= "part" then below[#below + 1] = cmd end
  end
  put("  \\RedeclareSectionCommands[beforeskip=-3.25ex\\@plus -1ex \\@minus -.2ex," ..
      "afterskip=1.5ex \\@plus .2ex,indent=\\z@]{" .. table.concat(below, ",") .. "}%")
  -- The sixth level in an article (the Header filter, further down), with
  -- the skips every level under the first has here.
  put("  \\newcommand*{\\mdmheadsix}[1]{\\par\\addvspace{3.25ex\\@plus 1ex\\@minus .2ex}" ..
      "{\\noindent\\color{mdmink}\\bfseries" .. LEAD .. "\\fontsize{" .. HEAD[6][1] ..
      "\\mdmem}{" .. HEAD[6][2] .. "\\mdmem}\\selectfont #1\\par}" ..
      "\\nobreak\\vskip 1.5ex\\@plus .2ex\\relax\\@afterheading}%")
  -- The rule goes under h1 and h2, whichever commands draw them, at the
  -- distance the editor draws it at in this face (HEAD_RULE_AIR).
  local air = HEAD_RULE_AIR[roman and "roman" or "sans"]
  local ruled = "\\Ifstr{#1}{" .. heads[1] .. "}{\\mdmheadrule{" .. air[1] ..
    "}}{\\Ifstr{#1}{" .. heads[2] .. "}{\\mdmheadrule{" .. air[2] .. "}}{}}"
  put("  \\renewcommand*{\\sectionlinesformat}[4]{%")
  put("    \\@hangfrom{\\hskip #2#3}{#4}" .. ruled .. "%")
  put("  }%")
  -- A \chapter, where there are chapters, is the h1 the editor draws: the
  -- size, the rule and the afterskip of the \section it stands for in an
  -- article, the class's page break kept (a new page, and a right-hand one
  -- under scrbook's open=right). beforeskip is nothing, since a chapter
  -- always opens a page and a section that opens one loses its skip there:
  -- with KOMA's default the title stood 7.2 em lower than an article's first
  -- \section, and with nothing it is 0.187 em lower than KOMA's article sets
  -- its `#` in the roman and 0.363 in the sans, KOMA hanging a chapter's first
  -- line from \topskip and the heading's leading where the top of a page
  -- hangs a section's from the height of its letters (pdftotext's word boxes,
  -- measured under scrreprt and scrbook); that much is left. afterindent=false
  -- says what the sign of a negative beforeskip used to, that the paragraph
  -- after it is not indented. Under `chapterprefix=true`, where "Chapter 1"
  -- stands on a line of its own over the title, the prefix format puts the
  -- same rule under the title.
  if heads[1] == "chapter" then
    put("  \\@ifundefined{chapterlinesformat}{}{%")
    put("    \\RedeclareSectionCommand[beforeskip=\\z@,afterindent=false," ..
        "afterskip=2.3ex \\@plus .2ex]{chapter}%")
    put("    \\renewcommand*{\\chapterlinesformat}[3]{\\@hangfrom{#2}{#3}" .. ruled .. "}%")
    put("    \\renewcommand*{\\chapterlineswithprefixformat}[3]{#2#3" .. ruled .. "}%")
    put("  }%")
  end
  put("}")
  put("\\makeatother")

  -- A document with no code block at all is written with none of these
  -- commands defined, so the whole group is asked for first.
  put("\\makeatletter")
  put("\\@ifundefined{KeywordTok}{}{%")
  for _, token in ipairs(TOKENS) do
    -- Weight and slant go with the colour: the editor paints its code with
    -- ten colours and nothing else, where Pandoc bolds a keyword and slants a
    -- comment (the `font-weight: inherit` of the stylesheet). The error slot
    -- is not one of the ten and carries its own name.
    local slot = token[2] == "error" and "mdmerror" or ("mdmsyn" .. token[2])
    put("  \\renewcommand{\\" .. token[1] .. "}[1]{\\textcolor{" .. slot .. "}{#1}}%")
  end
  put("}")
  put("\\makeatother")
  -- A quote carries the editor's left border as well as its quieter ink: 3px
  -- of the rule colour at 22% (0.19em at a 16px text), 14px of air after it
  -- (0.88em), and the 40px the browser indents a blockquote by on either side
  -- (2.5em). framed draws the rule, so a long quote still breaks across
  -- pages; without framed the colour travels alone, as it did before.
  put("\\colorlet{mdmquoterule}{mdmink!22!mdmpage}")
  put("\\usepackage{etoolbox}")
  put("\\IfFileExists{framed.sty}{%")
  put("  \\usepackage{framed}%")
  put("  \\renewenvironment{quote}{%")
  put("    \\def\\FrameCommand{\\hspace{2.5\\mdmem}" ..
      "{\\color{mdmquoterule}\\vrule width 0.19\\mdmem}\\hspace{0.88\\mdmem}}%")
  put("    \\MakeFramed{\\advance\\hsize-\\width" ..
      "\\advance\\hsize-2.5\\mdmem\\FrameRestore}\\color{mdmquiet}}%")
  put("  {\\endMakeFramed}%")
  put("}{\\AtBeginEnvironment{quote}{\\color{mdmquiet}}}")
  -- A thematic break the way the editor draws it: a hairline of the ink at
  -- 16%, the full measure wide, 0.6em of air on either side (the 2px and the
  -- margins of `body hr` in mdm-look.css), where LaTeX's own is a black rule
  -- half the line long. The HorizontalRule filter below spends it.
  put("\\colorlet{mdmhrrule}{mdmink!16!mdmpage}")
  put("\\newcommand{\\mdmthematicbreak}{\\par\\vspace{0.6\\mdmem}" ..
      "{\\color{mdmhrrule}\\hrule height 0.125\\mdmem}\\vspace{0.6\\mdmem}}")

  -- The fill a score can be given (mdm.scoreFill), one colour per side, as a
  -- box the block below puts the engraving in. With no fill the box is the
  -- engraving and nothing else, so the two cases read the same further down.
  -- The corner the browser rounds by 4 px is not rounded here, which would
  -- take a package for the sake of two pixels on paper.
  local fill = SCORE_FILLS[l.score_fill]
  if fill then
    color("mdmscorefill", (l.side == "dark") and fill.dark or fill.light)
    put("\\newcommand{\\mdmscore}[1]{{\\setlength{\\fboxsep}{0.7em}" ..
        "\\colorbox{mdmscorefill}{#1}}}")
    -- A score at the text width has to give the padding back, or the box it
    -- sits in would hang 0.7 em over either margin.
    put("\\newcommand{\\mdmscorewidth}{\\dimexpr\\linewidth-1.4em\\relax}")
    -- The same fill under a score that goes down in slices: the box hugs
    -- each slice, with the 0.7 em of side padding written out instead of
    -- left to \fboxsep, which would open a gap between one slice and the
    -- next; the air above the first and below the last is a rule of the
    -- fill. So the ground runs unbroken behind the whole score, and stops
    -- at the foot of the page when the score is broken there.
    put("\\newcommand{\\mdmslice}[1]{{\\setlength{\\fboxsep}{0pt}" ..
        "\\colorbox{mdmscorefill}{\\hspace{0.7em}#1\\hspace{0.7em}}}}")
    put("\\newcommand{\\mdmslicepad}[1]{\\noindent{\\color{mdmscorefill}" ..
        "\\rule{#1}{0.7em}}\\par}")
  else
    put("\\newcommand{\\mdmscore}[1]{#1}")
    put("\\newcommand{\\mdmscorewidth}{\\linewidth}")
    put("\\newcommand{\\mdmslice}[1]{#1}")
    put("\\newcommand{\\mdmslicepad}[1]{}")
  end
  -- The band of air around a score: the editor gives every block 1.5em of
  -- vertical margin (`.mdm-block` in mdm.css), where the PDF set one down
  -- with no more than the gap of a paragraph. The page already puts its
  -- \\parskip in front of the engraving (KOMA's parskip=half, about 0.85em
  -- here), and the \\addvspace tops it up to the editor's 1.5; being
  -- \\addvspace and not \\vspace, it does not pile onto the skip of a heading
  -- just above. The group keeps a \\centering to the engraving it centres.
  put("\\newcommand{\\mdmscoreband}[1]{\\par\\addvspace{0.65\\mdmem}" ..
      "{#1\\par}\\addvspace{0.65\\mdmem}}")
  -- What holds the slices of a score together: every skip TeX would put
  -- between two paragraphs and between two lines, zeroed. \parskip is half
  -- a line here (KOMA's parskip=half) and \baselineskip a whole one, and
  -- either would open a seam across the staff. What is left between two
  -- slices is a legal breakpoint with no glue in it, which is the whole
  -- point: the page may break there, and if it does not, the slices tile
  -- into one drawing.
  put("\\newcommand{\\mdmslicestack}[1]{{\\parskip=0pt\\parindent=0pt" ..
      "\\baselineskip=0pt\\lineskip=0pt\\lineskiplimit=0pt\\relax#1\\par}}")
  return table.concat(out, "\n")
end


local function is_abc_block(el)
  return el.classes:includes("abc")
end

local function sha1(s)
  local ok, digest = pcall(function() return pandoc.utils.sha1(s) end)
  if ok then return digest end
  return pandoc.sha1(s)
end

local function file_exists(path)
  local f = io.open(path, "r")
  if f then f:close() return true end
  return false
end

local function find_abcm2ps(meta_path)
  if meta_path and file_exists(meta_path) then return meta_path end
  if file_exists("tools/bin/abcm2ps") then return "tools/bin/abcm2ps" end
  if quarto.project and quarto.project.directory then
    local p = quarto.project.directory .. "/tools/bin/abcm2ps"
    if file_exists(p) then return p end
  end
  return "abcm2ps" -- trust the PATH
end

local abcm2ps_path = nil

local function html_escape(s)
  s = s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;")
  return s
end

-- The look goes on every HTML render, music or no music: the ground, the ink
-- and the code cards are the document's, not the scores'. The stylesheet is
-- the port of the editor's own; the block written beside it carries the
-- values of the look in force.
local function ensure_look()
  if look_added then return end
  look_added = true
  if quarto.doc.is_format("latex") then
    quarto.doc.include_text("in-header", look_tex(look))
    return
  end
  quarto.doc.add_html_dependency({
    name = "mdm-look",
    version = "0.1.0",
    stylesheets = { "resources/mdm-look.css" },
  })
  -- The roman travels only for a page set in it: four faces are 191 KB, and a
  -- self-contained export takes every dependency inside the file, so a page in
  -- the sans would carry a face it never draws a letter with.
  if look.text_font == "roman" then
    quarto.doc.add_html_dependency({
      name = "mdm-roman",
      version = "2.004",
      stylesheets = { "resources/lm/mdm-roman.css" },
      resources = {
        { name = "fonts/LatinModernRoman-Regular.woff2", path = "resources/lm/fonts/LatinModernRoman-Regular.woff2" },
        { name = "fonts/LatinModernRoman-Italic.woff2", path = "resources/lm/fonts/LatinModernRoman-Italic.woff2" },
        { name = "fonts/LatinModernRoman-Bold.woff2", path = "resources/lm/fonts/LatinModernRoman-Bold.woff2" },
        { name = "fonts/LatinModernRoman-BoldItalic.woff2", path = "resources/lm/fonts/LatinModernRoman-BoldItalic.woff2" },
      },
    })
  end
  quarto.doc.include_text("in-header", look_css(look))
end

local function ensure_html_deps()
  if deps_added then return end
  deps_added = true
  quarto.doc.add_html_dependency({
    name = "mdm-abcjs",
    version = "6.7.0",
    scripts = { "resources/abcjs-basic-min.js", "resources/mdm.js" },
    stylesheets = { "resources/abcjs-audio.css", "resources/mdm.css" },
  })
end

-- The engine the formulas are set with, riding with the page: KaTeX, the one
-- the editor draws with and the one the PDF is set in, the script that reads
-- the formulas back out of the page (resources/mdm-math.js) and the faces the
-- stylesheet names. A dependency and not a folder beside the output, because
-- that is what a self-contained export knows how to take inside the file:
-- `embed-resources: true` inlines a dependency and rewrites the faces into it,
-- while a folder of our own it only leaves where it is, and a page moved away
-- from it showed its formulas as LaTeX source.
local katex_added = false
local function ensure_katex_dep()
  if katex_added then return end
  katex_added = true
  quarto.doc.add_html_dependency({
    name = "mdm-katex",
    version = "0.18.4",
    scripts = { "resources/katex/katex.min.js", "resources/mdm-math.js" },
    stylesheets = { "resources/katex/katex.min.css" },
    resources = {
      { name = "fonts/KaTeX_AMS-Regular.woff2", path = "resources/katex/fonts/KaTeX_AMS-Regular.woff2" },
      { name = "fonts/KaTeX_Caligraphic-Bold.woff2", path = "resources/katex/fonts/KaTeX_Caligraphic-Bold.woff2" },
      { name = "fonts/KaTeX_Caligraphic-Regular.woff2", path = "resources/katex/fonts/KaTeX_Caligraphic-Regular.woff2" },
      { name = "fonts/KaTeX_Fraktur-Bold.woff2", path = "resources/katex/fonts/KaTeX_Fraktur-Bold.woff2" },
      { name = "fonts/KaTeX_Fraktur-Regular.woff2", path = "resources/katex/fonts/KaTeX_Fraktur-Regular.woff2" },
      { name = "fonts/KaTeX_Main-Bold.woff2", path = "resources/katex/fonts/KaTeX_Main-Bold.woff2" },
      { name = "fonts/KaTeX_Main-BoldItalic.woff2", path = "resources/katex/fonts/KaTeX_Main-BoldItalic.woff2" },
      { name = "fonts/KaTeX_Main-Italic.woff2", path = "resources/katex/fonts/KaTeX_Main-Italic.woff2" },
      { name = "fonts/KaTeX_Main-Regular.woff2", path = "resources/katex/fonts/KaTeX_Main-Regular.woff2" },
      { name = "fonts/KaTeX_Math-BoldItalic.woff2", path = "resources/katex/fonts/KaTeX_Math-BoldItalic.woff2" },
      { name = "fonts/KaTeX_Math-Italic.woff2", path = "resources/katex/fonts/KaTeX_Math-Italic.woff2" },
      { name = "fonts/KaTeX_SansSerif-Bold.woff2", path = "resources/katex/fonts/KaTeX_SansSerif-Bold.woff2" },
      { name = "fonts/KaTeX_SansSerif-Italic.woff2", path = "resources/katex/fonts/KaTeX_SansSerif-Italic.woff2" },
      { name = "fonts/KaTeX_SansSerif-Regular.woff2", path = "resources/katex/fonts/KaTeX_SansSerif-Regular.woff2" },
      { name = "fonts/KaTeX_Script-Regular.woff2", path = "resources/katex/fonts/KaTeX_Script-Regular.woff2" },
      { name = "fonts/KaTeX_Size1-Regular.woff2", path = "resources/katex/fonts/KaTeX_Size1-Regular.woff2" },
      { name = "fonts/KaTeX_Size2-Regular.woff2", path = "resources/katex/fonts/KaTeX_Size2-Regular.woff2" },
      { name = "fonts/KaTeX_Size3-Regular.woff2", path = "resources/katex/fonts/KaTeX_Size3-Regular.woff2" },
      { name = "fonts/KaTeX_Size4-Regular.woff2", path = "resources/katex/fonts/KaTeX_Size4-Regular.woff2" },
      { name = "fonts/KaTeX_Typewriter-Regular.woff2", path = "resources/katex/fonts/KaTeX_Typewriter-Regular.woff2" }
    },
  })
end

local function render_html(el)
  ensure_html_deps()
  local playable = el.classes:includes("play")
  local html = string.format(
    '<figure class="mdm-block%s">' ..
    '<pre class="mdm-src" style="display:none">%s</pre>' ..
    '<div class="mdm-paper"></div>' ..
    '<div class="mdm-audio"></div>' ..
    '</figure>',
    playable and " mdm-play" or "",
    html_escape(el.text))
  return pandoc.RawBlock("html", html)
end

local function run(cmd)
  local ok, _, code = os.execute(cmd)
  return ok == true or code == 0
end

-- abcjs engraves a tune that names neither its number nor its key; abcm2ps,
-- which goes by the standard, engraves nothing at all from one, and it says so
-- by leaving with a status of 0 and no EPS behind it. The same block would
-- then be a staff in the editor and in the HTML and a paragraph of ABC source
-- in the PDF, so what the engraver insists on is supplied here when the block
-- has not got it: `X:1` for the reference number, and `K:C` for the key, which
-- draws the empty key signature and the treble clef abcjs falls back to
-- (measured on abcjs 6.7.0: clef treble, no accidentals). A block that names
-- either of them itself is passed through untouched.
--
-- The key is the field that closes the header, so it goes in front of the
-- first line that is none of them: not a comment or a directive (both open
-- with a `%`), not blank, and not a field of its own (a letter and a colon).
local function with_engraver_header(source)
  local has_x, has_k = false, false
  for line in source:gmatch("(.-)\n") do
    if line:match("^X%s*:") then has_x = true end
    if line:match("^K%s*:") then has_k = true end
  end
  if has_x and has_k then return source end
  local out = {}
  if not has_x then out[#out + 1] = "X:1" end
  local keyed = has_k
  for line in source:gmatch("(.-)\n") do
    if not keyed
      and not line:match("^%%")
      and not line:match("^%s*$")
      and not line:match("^%a%s*:")
    then
      out[#out + 1] = "K:C"
      keyed = true
    end
    out[#out + 1] = line
  end
  if not keyed then out[#out + 1] = "K:C" end
  return table.concat(out, "\n") .. "\n"
end

-- The two colours an engraving is drawn in, read off the look the way the
-- stylesheet reads them: the score takes the ink of the side (black on paper,
-- the editor's own light ink on the dark side), and the staff lines take the
-- grey of the side unless the editor was set to draw them in ink, where they
-- take the colour of the score itself (`currentColor` in the browser).
local function engraving_colors()
  local l = look or { side = "light", staff_lines = "gray" }
  local side = SIDES[l.side] or SIDES.light
  local ink = side.svg_ink
  if l.staff_lines == "gray" then return ink, side.staff end
  return ink, ink
end

-- The colours painted into the EPS, before it is turned into a PDF.
--
-- abcm2ps writes no colour of its own, and Ghostscript, which is what makes
-- the PDF of it, bakes the default black into everything it converts. So the
-- engraving arrived black whatever the page under it was: on the dark side the
-- score came out a shadow while the words abcm2ps sets around it, which are
-- shown and not stroked, came out in the ink like the rest of the text.
--
-- The ink goes in once, at the head of the page. The staff lines are the only
-- thing the engraver draws as a run of horizontals opened by `dlw` and closed
-- by `stroke`, and that run is what the grey wraps; the ledger lines under a
-- low note are `hl` and stay in the ink, exactly as in the browser, where the
-- stylesheet paints `.abcjs-staff` and nothing else.
--
-- The same run also has its width rewritten. abcm2ps strokes the staff at
-- `dlw`, 0.7 pt, which on a 96 dpi screen is 0.93 of a pixel: a viewer that
-- snaps thin strokes instead of anti-aliasing them then keeps or drops each
-- line by where it lands on the pixel grid, and whole staves came out with
-- one line left (reproduced with poppler at 96 dpi with anti-aliasing off:
-- the lower staff of the piano score in example.mdm lost four of its five).
-- The editor never shows this, since the browser gives an SVG stroke its
-- pixel whatever its width. 0.9 pt is 1.2 px at 96 dpi, a row of pixels at
-- any landing; against the 6 pt between lines it is a little heavier than
-- the editor's own ratio (0.7 over 7.75 SVG units, measured on abcjs 6.7.0),
-- which is the price of a line that cannot vanish. It goes into the cache
-- key below, so a width change re-engraves.
local STAFF_LINE_WIDTH = "0.9"

local function ps_color(hex)
  local r, g, b = hex:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then return "0 0 0 setrgbcolor" end
  return string.format(
    "%.3f %.3f %.3f setrgbcolor",
    tonumber(r, 16) / 255, tonumber(g, 16) / 255, tonumber(b, 16) / 255)
end

local function paint_eps(text, ink, staff)
  local painted = text:gsub("(%%%%EndSetup\n)", "%1" .. ps_color(ink) .. "\n", 1)
  local open, close = "", ""
  if staff ~= ink then
    open = ps_color(staff) .. " "
    close = " " .. ps_color(ink)
  end
  -- The run keeps everything but its `dlw`, whose width is replaced by the
  -- one above; the procedures that draw after it set their own before they
  -- stroke, so nothing needs putting back.
  painted = painted:gsub(
    "\ndlw ([^\n]-stroke)",
    "\n" .. open .. STAFF_LINE_WIDTH .. " SLW %1" .. close)
  return painted
end

-- The four corners of the ink of a graphic, EPS or PDF alike, measured by
-- ghostscript. What is read is text: the bbox device reports on stderr.
local function ink_bbox(path)
  local gs = io.popen(string.format(
    "gs -q -dBATCH -dNOPAUSE -sDEVICE=bbox %s 2>&1", path))
  local bbox_out = gs and gs:read("*a") or ""
  if gs then gs:close() end
  return bbox_out:match(
    "%%%%BoundingBox:%s+(%-?%d+)%s+(%-?%d+)%s+(%-?%d+)%s+(%-?%d+)")
end

-- ---------- The editor's engraver, on paper ----------
--
-- What engraves the editor and the HTML is abcjs, and abcm2ps is another
-- engraver with glyphs of its own: the figures of its time signatures, its
-- clefs, every sign drawn by its own PostScript procedures, so however the
-- page around it was dressed, a score in the PDF did not read as the one in
-- the editor. So the PDF is engraved by the same abcjs: the bundled script
-- the HTML ships is loaded into a page in a headless Chrome, the page is
-- printed to PDF (vector, with the fonts of the browser embedded, which are
-- the faces the editor resolves), and the sheet is trimmed to the ink with
-- pdfcrop. A machine without a Chrome, or a document that asks for it
-- (mdm-engraver: abcm2ps), keeps the abcm2ps engraving: the render degrades
-- rather than dying, and says so in the log.

-- Chrome by any of its common names, or wherever the document points
-- (mdm.chrome in the YAML header). macOS keeps its browser out of the PATH.
local CHROME_NAMES = {
  "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
}
local MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

local function command_exists(name)
  local p = io.popen("command -v " .. name .. " 2>/dev/null")
  if not p then return false end
  local out = p:read("*a") or ""
  p:close()
  return out ~= ""
end

-- mdm.chrome names a file, and only an existing file is taken: the value
-- comes from the document's YAML and is never handed to a shell to resolve
-- (quoting a name for `command -v` is how a crafted header would smuggle a
-- command of its own into the render).
local function find_chrome(meta_path)
  if meta_path and file_exists(meta_path) then return meta_path end
  for _, name in ipairs(CHROME_NAMES) do
    if command_exists(name) then return name end
  end
  if file_exists(MAC_CHROME) then return MAC_CHROME end
  return nil
end

local chrome_path = nil
local has_pdfcrop = nil

-- The engraving is asked for at the measure of the page: 51.25 ems at the
-- default 11 pt, clamped by letter paper, is 527.4 pt of text, and a CSS px
-- is 0.75 pt. A document set to another measure only rescales the drawing
-- (width=\mdmscorewidth below), which is the same shrink `responsive:
-- resize` performs in the browser.
--
-- The line breaks of the engraving are NOT the ones the exported HTML shows,
-- and were only ever close: the page asks abcjs for no width at all now
-- (resources/mdm.js, renderBlock), which it draws at its own 740 px, and this
-- is 703. A tune that fills its line can therefore wrap a note earlier on
-- paper than on the page. Two engravers on two measures is the part of the
-- export rule the PDF is allowed to be close on rather than equal, and the
-- 5% between them is what "close" is here.
local ABCJS_STAFFWIDTH = 703

-- The sheet the engraving is printed on, and the scale it is printed at. A
-- CSS pixel is 0.75 pt, so this page is 900 x 4500 pt. Both numbers are
-- spent twice: in the page below, and in the arithmetic that turns a
-- position measured in the browser into a position in the printed PDF.
local CHROME_PAGE_PX = { w = 1200, h = 6000 }
local PX_TO_PT = 0.75

-- The bundle rides inside the page rather than beside it, so nothing depends
-- on where Chrome resolves a relative src from. What closes a <script> is
-- the literal tag, so a build that ever carried one cannot be embedded and
-- says so by failing over to abcm2ps.
local FILTER_DIR = (debug.getinfo(1, "S").source or ""):match("^@(.*)[/\\]") or "."
local abcjs_bundle = nil
local function read_abcjs()
  if abcjs_bundle ~= nil then return abcjs_bundle end
  abcjs_bundle = false
  local f = io.open(FILTER_DIR .. "/resources/abcjs-basic-min.js", "r")
  if f then
    local text = f:read("*a")
    f:close()
    if text and text ~= "" and not text:find("</script>", 1, true) then
      abcjs_bundle = text
    end
  end
  return abcjs_bundle
end

-- The ABC source on its way into a <script>: a JS string literal, with the
-- sequences the HTML parser would act on inside it broken up: `</` (which
-- could close the script) and `<!` (which can open the script-data escaped
-- state and carry the real closer past the parser). A NUL is dropped
-- outright: the tokenizer would turn it into U+FFFD and corrupt the source.
local function js_string(s)
  s = s:gsub("%z", "")
  s = s:gsub("\\", "\\\\"):gsub('"', '\\"')
  s = s:gsub("\r", "\\r"):gsub("\n", "\\n")
  s = s:gsub("</", "<\\/")
  s = s:gsub("<!", "<\\!")
  return '"' .. s .. '"'
end

-- Chrome refuses to start as root without --no-sandbox, which is the normal
-- state of a container. The flag is added there and only there: the print
-- is a local, throwaway page of the user's own document.
local sandbox_flag = nil
local function chrome_sandbox_flag()
  if sandbox_flag ~= nil then return sandbox_flag end
  sandbox_flag = ""
  local p = io.popen("id -u 2>/dev/null")
  if p then
    local uid = p:read("*a") or ""
    p:close()
    if uid:match("^0%s*$") then sandbox_flag = " --no-sandbox" end
  end
  return sandbox_flag
end

-- The page Chrome prints: the engraving alone, on a sheet big enough for any
-- score and trimmed to the ink afterwards.
--
-- Two things it does not share with the page the browser draws (mdm.js,
-- renderBlock), and both are open. It asks for a staffwidth, which that one
-- no longer does, so the two wrap at 703 px and 740; and it passes no
-- `format`, so every title, part name, lyric and annotation on paper keeps
-- the sizes abcjs has had since abcm2ps (a title at 20 pt, drawn at 4/3, so
-- 27 px against the 23 the screen asks for) where the editor and the page
-- hold each one to a fraction of the prose's x-height. The score is inserted
-- at a width the document decides and the drawing scales with it, so the
-- right sizes here are not the screen's own numbers but those numbers
-- divided by that scale, which is a measurement this has not been given yet.
-- Until it is, the words on a printed staff are the one place the paper is
-- knowingly out of proportion with the screen.
--
-- The stylesheet is the
-- svg slice of mdm-look.css, rule for rule, with one addition: the staff
-- lines take a hairline stroke of their own colour, which lifts them from
-- the 0.7 px abcjs fills them at (0.53 pt) to about the 0.9 pt the abcm2ps
-- engraving is guarded to, past the pixel grid of a screen. The body is
-- left transparent and Chrome is not asked to print backgrounds, so the
-- page colour of the document shows through, as it does under an EPS.
local function chrome_page(source, ink, staff)
  local abcjs = read_abcjs()
  if not abcjs then return nil end
  return table.concat({
    '<!doctype html><meta charset="utf-8">',
    "<style>",
    "  html, body { margin: 0; padding: 0; background: transparent; }",
    "  @page { margin: 0; size: " .. CHROME_PAGE_PX.w .. "px " ..
      CHROME_PAGE_PX.h .. "px; }",
    -- `color` besides `fill`: abcjs fills a good part of the drawing with
    -- currentColor, which reads the CSS colour, not the fill. The editor
    -- gets it from the body ink; here there is no body ink to inherit.
    "  .mdm-paper { width: " .. ABCJS_STAFFWIDTH .. "px; color: " .. ink .. "; }",
    "  .mdm-paper svg { fill: " .. ink .. "; }",
    '  .mdm-paper svg [fill="#000000"] { fill: ' .. ink .. "; }",
    '  .mdm-paper svg [stroke="#000000"] { stroke: ' .. ink .. "; }",
    '  .mdm-paper svg [fill="none"],',
    '  .mdm-paper svg [fill="transparent"],',
    '  .mdm-paper svg [fill="rgba(0,0,0,0)"] { fill: none; }',
    "  .mdm-paper svg .abcjs-staff,",
    "  .mdm-paper svg .abcjs-staff path { fill: " .. staff ..
      "; stroke: " .. staff .. "; stroke-width: 0.5; }",
    "</style>",
    '<div class="mdm-paper" id="paper"></div>',
    "<script>",
    abcjs,
    "</script>",
    "<script>",
    'ABCJS.renderAbc(document.getElementById("paper"), ' ..
      js_string(source) .. ", {",
    "  add_classes: true,",
    "  staffwidth: " .. ABCJS_STAFFWIDTH .. ",",
    "  paddingtop: 2, paddingbottom: 2, paddingleft: 0, paddingright: 0,",
    "});",
    -- Where one staff system ends and the next begins: the gaps the
    -- engraving itself leaves, which is where the page may break the
    -- drawing (insert_score cuts it there). abcjs wraps each system in a
    -- <g> of its own directly under the svg, lyrics, part label and all,
    -- so the boxes of those wrappers are the systems.
    --
    -- Measured once the faces are in, as the formulas are: the lyrics and
    -- the annotations inside a wrapper are text, and before the fonts
    -- arrive they are measured in fallback metrics. Nothing waits on this
    -- attribute; a run that never writes it engraves a score in one piece,
    -- which is what every score was until now.
    "document.fonts.ready.then(function () {",
    '  var svg = document.querySelector("#paper svg");',
    "  var lines = [];",
    "  if (svg) {",
    '    svg.querySelectorAll(":scope > g.abcjs-staff-wrapper").forEach(',
    "      function (g) {",
    "        var r = g.getBoundingClientRect();",
    "        lines.push([+r.top.toFixed(2), +r.bottom.toFixed(2)]);",
    "      });",
    "  }",
    '  document.documentElement.setAttribute(',
    '    "data-mdm-lines", JSON.stringify(lines));',
    "});",
    "</script>",
  }, "\n")
end

-- The staff systems out of the dumped DOM: a JSON array of [top, bottom]
-- pairs, in CSS pixels from the top of the printed page. Numbers alone, so
-- nothing the serialiser escapes inside an attribute can reach this.
local function parse_lines(dom_line)
  local raw = dom_line and dom_line:match('data%-mdm%-lines="([^"]*)"')
  if not raw then return nil end
  local out = {}
  for t, b in raw:gmatch("%[(%-?[%d%.]+),(%-?[%d%.]+)%]") do
    out[#out + 1] = { t = tonumber(t), b = tonumber(b) }
  end
  return out
end

-- Where the drawing can be cut, from the systems measured in the page and
-- the box the sheet was cropped to: one position per gap between two
-- systems, in points from the bottom edge of the cropped drawing, top to
-- bottom. The page is printed downwards and PDF coordinates count up from
-- the bottom, hence the subtraction; `bottom` is the foot of the ink box
-- pdfcrop cut to, which is where the cropped drawing's own coordinates
-- start (it crops to the integer bounding box, measured).
--
-- The cut goes down the middle of a gap, so neither system loses ink to
-- it. A pair that overlaps (a note hanging below the staff above a title,
-- say) leaves no clean gap and is offered no break at all: the drawing is
-- broken only where it is already blank.
local function score_cuts(lines, bottom, height)
  if not lines or #lines < 2 then return nil end
  local cuts = {}
  for i = 1, #lines - 1 do
    local above, below = lines[i].b, lines[i + 1].t
    if above and below and below > above then
      local middle = (above + below) / 2
      local pt = (CHROME_PAGE_PX.h - middle) * PX_TO_PT - bottom
      -- Inside the drawing and below the cut before it: a position the
      -- crop left outside would slice off a piece with no ink in it.
      if pt > 0 and pt < height and (not cuts[#cuts] or pt < cuts[#cuts]) then
        cuts[#cuts + 1] = pt
      end
    end
  end
  if #cuts == 0 then return nil end
  return cuts
end

-- One engraving through Chrome: the page written into the cache, printed,
-- trimmed, measured. True when the cached PDF and its width sidecar are in
-- place; the run also reports where the staff systems fell, which goes
-- beside them in a .cuts sidecar and is what lets a long score break
-- across a page. Printing and measuring are the one run: Chrome honours
-- --print-to-pdf and --dump-dom together. The sheet is 6000 px tall and
-- Chrome paginates what will not fit one sheet, of which only the first is
-- inserted, exactly the one page abcm2ps -E writes; a score that long has
-- outgrown a paragraph anyway.
local function engrave_abcjs(source, ink, staff, digest)
  local page = chrome_page(source, ink, staff)
  if not page or not chrome_path or not has_pdfcrop then return false end
  local html = CACHE_DIR .. "/" .. digest .. ".html"
  local raw = CACHE_DIR .. "/" .. digest .. ".chrome.pdf"
  local pdf = CACHE_DIR .. "/" .. digest .. ".pdf"
  local f = io.open(html, "w")
  if not f then return false end
  f:write(page)
  f:close()
  -- The virtual time budget is what lets the render script run to its end
  -- before the print; with the bundle inline it is settled at load, and the
  -- budget is a ceiling, not a wait.
  local pipe = io.popen(string.format(
    '"%s" --headless=new --disable-gpu --no-pdf-header-footer%s' ..
    " --virtual-time-budget=4000 --print-to-pdf=%s --dump-dom %s 2>/dev/null" ..
    ' | grep -o \'data-mdm-lines="[^"]*"\'',
    chrome_path, chrome_sandbox_flag(), raw, html))
  local dom_line = pipe and pipe:read("*a") or ""
  if pipe then pipe:close() end
  local ok = file_exists(raw)
    and run(string.format("pdfcrop --margins 0 %s %s >/dev/null 2>&1", raw, pdf))
    and file_exists(pdf)
  if ok then
    -- A block abcjs drew nothing from (empty, or directives alone) still
    -- prints a page, which pdfcrop cannot trim ("Empty Bounding Box", the
    -- sheet kept whole): a degenerate box is refused here, or a blank
    -- 900 x 4500 pt page would be cached and inserted at natural size.
    local x0, _, x1 = ink_bbox(pdf)
    if x0 and tonumber(x1) > tonumber(x0) then
      local wf = io.open(CACHE_DIR .. "/" .. digest .. ".w", "w")
      if wf then
        wf:write(tostring(tonumber(x1) - tonumber(x0)))
        wf:close()
      end
      -- The cuts want the box on the sheet, not the cropped drawing: the
      -- systems were measured on the sheet, and the foot of that box is
      -- where the two coordinate systems meet.
      local _, ry0, _, ry1 = ink_bbox(raw)
      local cuts = ry0 and score_cuts(
        parse_lines(dom_line), tonumber(ry0), tonumber(ry1) - tonumber(ry0))
      if cuts then
        local cf = io.open(CACHE_DIR .. "/" .. digest .. ".cuts", "w")
        if cf then
          local out = { string.format("%.3f", tonumber(ry1) - tonumber(ry0)) }
          for _, c in ipairs(cuts) do
            out[#out + 1] = string.format("%.3f", c)
          end
          cf:write(table.concat(out, " "))
          cf:close()
        end
      end
    else
      os.remove(pdf)
      ok = false
    end
  end
  os.remove(html)
  os.remove(raw)
  return ok
end

-- ---------- The editor's equations, on paper ----------
--
-- The same argument as the scores, for the maths: the editor and the HTML
-- set every formula with KaTeX, and KaTeX draws things no TeX font carries,
-- the radical above all, which it builds from paths of its own past a
-- certain height. However close a Computer Modern came (NewCM Book, below),
-- a \sqrt in the PDF was visibly another drawing. So the PDF sets its
-- formulas with the same vendored KaTeX: every formula of the document goes
-- into one page in the same headless Chrome, each on a named @page cut to
-- its exact size, the whole batch is printed in one run, and the pages are
-- split into one cached PDF per formula. The run also reports each
-- formula's width, height and depth below the baseline (measured in the
-- page, from a zero-size inline marker that sits on the very baseline), and
-- an inline formula is put back into the line lowered by that depth, so it
-- sits on the text's own baseline. Everything is measured in the editor's
-- CSS pixels at its 16 px body and inserted in ems of the body (\mdmem),
-- which is what keeps the proportion whatever size the document is set at.
--
-- A formula KaTeX refuses (throwOnError, as the editor calls it) makes no
-- page and keeps LaTeX's own setting, as does the whole document when there
-- is no Chrome or when the document asked for abcm2ps: NewCM Book below is
-- that fallback's face.

-- Bumped whenever the page below changes shape: a warm cache would
-- otherwise keep serving formulas measured under the old recipe.
local KATEX_RECIPE = "katex 2"

-- The fonts are named by absolute URL, and the filter's own directory is
-- absolute only when Quarto handed it so: rooted here otherwise, on the
-- working directory the render runs in.
local function abs_path(p)
  if p:sub(1, 1) == "/" then return p end
  return pandoc.system.get_working_directory() .. "/" .. p
end

local katex_assets = nil
local function read_katex()
  if katex_assets ~= nil then return katex_assets end
  katex_assets = false
  local dir = abs_path(FILTER_DIR) .. "/resources/katex"
  local jsf = io.open(dir .. "/katex.min.js", "r")
  local cssf = io.open(dir .. "/katex.min.css", "r")
  local js = jsf and jsf:read("*a") or nil
  local css = cssf and cssf:read("*a") or nil
  if jsf then jsf:close() end
  if cssf then cssf:close() end
  if js and css and js ~= "" and not js:find("</script>", 1, true) then
    -- The fonts by absolute URL (quoted, for a path with spaces in it), so
    -- the page can live in the cache directory and still find them.
    css = css:gsub('url%(fonts/([^%)]+)%)', 'url("file://' .. dir .. '/fonts/%1")')
    katex_assets = { js = js, css = css }
  end
  return katex_assets
end

local function math_digest(mode, tex, ink)
  return sha1(KATEX_RECIPE .. " " .. mode .. "\n" .. tex .. "\n" .. ink)
end

-- The one page the whole batch renders in. Each formula lands in a flex
-- div of its own, put on a named @page: flex is what anchors the drawing
-- to the very top-left of its pagelet, and the nowrap on the span keeps an
-- inline formula from folding into two lines of it (which fragmented it
-- across two pages). The pagelet is padded out to a multiple of 8 px:
-- Chrome quantises a page size to 1/300 in, and a page that came out a
-- hair SMALLER than its content was shrunk whole to fit, notes, letters
-- and baseline alike; every multiple of 8 px is a whole number of 300ths
-- (8 px = 25/300 in), so the printed page is exactly the asked-for one and
-- the drawing goes down at scale 1. The slack the padding leaves is blank,
-- and the insertion below hides it behind the true measures.
--
-- Everything is measured only once document.fonts is ready: before the
-- KaTeX faces arrive the line is set in fallback metrics, and the height
-- and depth read then were about 2 px off the printed truth (measured on
-- the `L` of example.mdm). The print fires after load, so the styles the
-- callback injects are in force by then. A formula KaTeX refuses takes its
-- div away and reports null: the printed pages are exactly the rendered
-- formulas, in order.
local function katex_page(formulas, ink)
  local assets = read_katex()
  if not assets then return nil end
  local list = {}
  for _, f in ipairs(formulas) do
    list[#list + 1] = "[" .. js_string(f.mode) .. "," .. js_string(f.tex) .. "]"
  end
  return table.concat({
    '<!doctype html><meta charset="utf-8">',
    "<style>",
    "html, body { margin: 0; padding: 0; background: transparent; }",
    "body { font-size: 16px; color: " .. ink .. "; }",
    assets.css,
    -- The display margin is the band's to give, not the graphic's; the
    -- band below spends it in \mdmem, as the scores do.
    ".katex-display { margin: 0; }",
    ".mdm-math { display: flex; align-items: flex-start; }",
    ".mdm-math > span { white-space: nowrap; }",
    "</style>",
    '<div id="mdm-root"></div>',
    "<script>",
    assets.js,
    "</script>",
    "<script>",
    "var FORMULAS = [" .. table.concat(list, ",") .. "];",
    'var root = document.getElementById("mdm-root");',
    "var CELLS = [];",
    "function pad8(x) { return Math.ceil((x + 2) / 8) * 8; }",
    "FORMULAS.forEach(function (f, i) {",
    '  var div = document.createElement("div");',
    '  div.className = "mdm-math";',
    '  div.style.setProperty("page", "m" + i);',
    '  var span = document.createElement("span");',
    "  div.appendChild(span);",
    "  root.appendChild(div);",
    "  var ok = true;",
    "  try {",
    '    katex.render(f[1], span, { displayMode: f[0] === "D", throwOnError: true });',
    "  } catch (e) { ok = false; }",
    "  if (!ok) { CELLS.push(null); root.removeChild(div); return; }",
    '  var mark = document.createElement("span");',
    '  mark.style.display = "inline-block";',
    '  mark.style.width = "0";',
    '  mark.style.height = "0";',
    "  span.appendChild(mark);",
    "  CELLS.push({ div: div, span: span, mark: mark, i: i });",
    "});",
    "document.fonts.ready.then(function () {",
    "  var dims = [];",
    "  var rules = [];",
    "  CELLS.forEach(function (c) {",
    "    if (!c) { dims.push(null); return; }",
    "    var r = c.span.getBoundingClientRect();",
    "    if (r.width < 1 || r.height < 1) { dims.push(null); root.removeChild(c.div); return; }",
    "    var m = c.mark.getBoundingClientRect();",
    "    var pw = pad8(r.width);",
    "    var ph = pad8(r.height);",
    "    dims.push({ w: r.width, h: r.height, d: r.bottom - m.top, pw: pw, ph: ph });",
    '    c.div.style.width = pw + "px";',
    '    c.div.style.height = ph + "px";',
    '    rules.push("@page m" + c.i + "{size:" + pw + "px " + ph + "px;margin:0}");',
    "  });",
    '  var style = document.createElement("style");',
    '  style.textContent = rules.join(" ");',
    "  document.head.appendChild(style);",
    '  document.documentElement.setAttribute("data-mdm-dims", JSON.stringify(dims));',
    "});",
    "</script>",
  }, "\n")
end

-- The dims attribute out of the dumped DOM: a JSON array of {w,h,d} and
-- null, parsed positionally (a null is turned into an empty object first,
-- so the balanced-braces walk keeps the order). Nothing of the document's
-- own text is in it, only numbers, so the one entity the serialiser writes
-- into an attribute that matters here is the quote.
local function parse_dims(dom_line)
  local raw = dom_line and dom_line:match('data%-mdm%-dims="([^"]*)"')
  if not raw then return nil end
  raw = raw:gsub("&quot;", '"'):gsub("&amp;", "&")
  local out = {}
  for token in raw:gsub("null", "{}"):gmatch("%b{}") do
    local w, h, d, pw, ph = token:match(
      '"w":([%d%.]+),"h":([%d%.]+),"d":(%-?[%d%.]+),"pw":(%d+),"ph":(%d+)')
    out[#out + 1] = w and {
      w = tonumber(w), h = tonumber(h), d = tonumber(d),
      pw = tonumber(pw), ph = tonumber(ph),
    } or false
  end
  return out
end

-- One batch through Chrome: print and measure in the same run (Chrome
-- honours --print-to-pdf and --dump-dom together), then split the pages
-- with ghostscript into one cached PDF per formula, each beside a .dim
-- sidecar carrying "w h d" in the editor's pixels.
local function engrave_math(formulas, ink)
  local page = katex_page(formulas, ink)
  if not page or not chrome_path then return end
  -- The batch files are named after the batch, so two renders sharing one
  -- cache do not print over each other's page.
  local names = {}
  for _, f in ipairs(formulas) do names[#names + 1] = f.digest end
  local bid = sha1(table.concat(names, " "))
  local html = CACHE_DIR .. "/" .. bid .. ".batch.html"
  local batch = CACHE_DIR .. "/" .. bid .. ".batch.pdf"
  local f = io.open(html, "w")
  if not f then return end
  f:write(page)
  f:close()
  local pipe = io.popen(string.format(
    '"%s" --headless=new --disable-gpu --no-pdf-header-footer%s' ..
    " --allow-file-access-from-files --virtual-time-budget=6000" ..
    " --print-to-pdf=%s --dump-dom %s 2>/dev/null" ..
    ' | grep -o \'data-mdm-dims="[^"]*"\'',
    chrome_path, chrome_sandbox_flag(), batch, html))
  local dom_line = pipe and pipe:read("*a") or ""
  if pipe then pipe:close() end
  local dims = parse_dims(dom_line)
  if dims and #dims == #formulas and file_exists(batch) then
    local at = 0
    for i, f in ipairs(formulas) do
      local dim = dims[i]
      if dim then
        at = at + 1
        local pdf = CACHE_DIR .. "/" .. f.digest .. ".pdf"
        if run(string.format(
          "gs -q -dBATCH -dNOPAUSE -sDEVICE=pdfwrite" ..
          " -dFirstPage=%d -dLastPage=%d -o %s %s", at, at, pdf, batch))
          and file_exists(pdf)
        then
          local df = io.open(CACHE_DIR .. "/" .. f.digest .. ".dim", "w")
          if df then
            df:write(string.format(
              "%.6g %.6g %.6g %d %d", dim.w, dim.h, dim.d, dim.pw, dim.ph))
            df:close()
          end
        end
      end
    end
  else
    quarto.log.warning(
      "mdm: Chrome could not set the equations with KaTeX;" ..
      " they keep LaTeX's own faces.")
  end
  os.remove(html)
  os.remove(batch)
end

-- A formula from the cache, into the line or onto one of its own. The
-- widths and the drop below the baseline travel in ems of the body: what
-- was w pixels beside the editor's 16 px text is w/16 of an em beside any
-- text. A display formula goes down centred inside a small band, as the
-- editor gives its block a breath of padding; one wider than the measure
-- takes the text width instead, the shrink the editor's sideways scroll
-- stands in for.
local function insert_math(mathtype, digest)
  local df = io.open(CACHE_DIR .. "/" .. digest .. ".dim", "r")
  if not df then return nil end
  local w, h, d, pw, ph = df:read("*a"):match(
    "([%d%.]+) ([%d%.]+) (%-?[%d%.]+) (%d+) (%d+)")
  df:close()
  if not w then return nil end
  local pdf = CACHE_DIR .. "/" .. digest .. ".pdf"
  w, h, d, pw, ph = tonumber(w), tonumber(h), tonumber(d), tonumber(pw), tonumber(ph)
  -- The graphic is the padded pagelet; the line is told the truth. The
  -- \makebox takes the formula's own width, so the pagelet's blank slack
  -- overhangs to the right where there is no ink to show; the \raisebox
  -- drops the graphic until the drawing's baseline (h - d below its top)
  -- meets the line's, and its optional arguments report the formula's real
  -- ascent and depth, so the leading is what the formula would take, not
  -- what the padding would.
  local ascent = (h - d) / 16
  local drop = (ph - (h - d)) / 16
  local graphic = string.format(
    "\\makebox[%.4f\\mdmem][l]{\\raisebox{-%.4f\\mdmem}[%.4f\\mdmem][%.4f\\mdmem]" ..
    "{\\includegraphics[width=%.4f\\mdmem]{%s}}}",
    w / 16, drop, ascent, d / 16, pw / 16, pdf)
  if mathtype == "DisplayMath" then
    -- A display wider than the measure takes the text width instead, the
    -- shrink the editor's sideways scroll stands in for.
    if w / 16 > 51 then
      graphic = string.format("\\includegraphics[width=\\linewidth]{%s}", pdf)
    end
    return pandoc.RawInline("latex", string.format(
      "\\par\\addvspace{0.25\\mdmem}{\\centering%s\\par}\\addvspace{0.25\\mdmem}",
      graphic))
  end
  return pandoc.RawInline("latex", graphic)
end

-- The maths pass over the whole document: collect what is not yet in the
-- cache, engrave it all in the one Chrome run, then put every formula the
-- cache now holds into the page. What the cache has not got (a formula
-- KaTeX refused, a batch that failed) stays a Math element, and LaTeX sets
-- it as before.
local function render_math_pass(doc)
  local side = SIDES[(look and look.side)] or SIDES.light
  local ink = side.ink
  local jobs, seen = {}, {}
  doc:walk({
    Math = function(m)
      local mode = m.mathtype == "DisplayMath" and "D" or "I"
      local digest = math_digest(mode, m.text, ink)
      if not seen[digest] and not file_exists(CACHE_DIR .. "/" .. digest .. ".pdf") then
        seen[digest] = true
        jobs[#jobs + 1] = { mode = mode, tex = m.text, digest = digest }
      end
    end,
  })
  if #jobs > 0 then
    run("mkdir -p " .. CACHE_DIR)
    engrave_math(jobs, ink)
  end
  return doc:walk({
    Math = function(m)
      local mode = m.mathtype == "DisplayMath" and "D" or "I"
      local digest = math_digest(mode, m.text, ink)
      if file_exists(CACHE_DIR .. "/" .. digest .. ".pdf") then
        return insert_math(m.mathtype, digest)
      end
      return nil
    end,
  })
end

-- The positions the drawing may be broken at, from the sidecar the
-- engraver wrote: the height of the cropped drawing first, then one
-- position per gap between two staff systems. A score of one system, and
-- one abcm2ps engraved (no browser measured it), has no sidecar and goes
-- down whole.
local function read_cuts(digest)
  local f = io.open(CACHE_DIR .. "/" .. digest .. ".cuts", "r")
  if not f then return nil end
  local text = f:read("*a") or ""
  f:close()
  local nums = {}
  for n in text:gmatch("[%d%.]+") do nums[#nums + 1] = tonumber(n) end
  local height = table.remove(nums, 1)
  if not height or height <= 0 or #nums == 0 then return nil end
  return height, nums
end

-- The engraving inserted into the page, from the cache: a narrow score
-- (%%staffwidth, say) is set at its natural size and centred, the way a
-- display equation is, and a wide one takes the text width. Centred like a
-- display equation, unless the editor was set to line the scores up with
-- the text (mdm.scoreAlign). Every score goes down inside the band
-- (\mdmscoreband, in the preamble), which is what gives it the editor's
-- 1.5em of air above and below; the centred one takes a plain \centering
-- rather than the center environment, whose own topsep would stack a
-- second gap onto the band's.
--
-- A score of several staff systems goes down as one image per system, the
-- one drawing clipped to each of them (trim + clip, at the cuts the
-- engraver measured) and the pieces stacked with no glue between them, so
-- they tile into the engraving they were cut from and the page can break
-- between two systems. A picture is atomic to LaTeX: whole, a score longer
-- than the space left on the page jumps to the next one entire and leaves
-- the rest of the page blank, and a score longer than a page has nowhere
-- to go at all. Music is written to be read across a page turn, so the
-- break belongs where the engraving already leaves a gap.
local function insert_score(digest)
  local pdf = CACHE_DIR .. "/" .. digest .. ".pdf"
  local width_pt = nil
  local wf = io.open(CACHE_DIR .. "/" .. digest .. ".w", "r")
  if wf then
    width_pt = tonumber(wf:read("*a"))
    wf:close()
  end
  local left = look and look.score_align == "left"
  local narrow = width_pt and width_pt < 330
  local height, cuts = read_cuts(digest)
  if not height then
    if narrow then
      return pandoc.RawBlock("latex", string.format(
        left and "\\mdmscoreband{\\noindent\\mdmscore{\\includegraphics{%s}}}"
          or "\\mdmscoreband{\\centering\\mdmscore{\\includegraphics{%s}}}",
        pdf))
    end
    return pandoc.RawBlock("latex", string.format(
      "\\mdmscoreband{\\noindent\\mdmscore{\\includegraphics[width=\\mdmscorewidth]{%s}}}", pdf))
  end
  -- Centred, the paragraphs need no \noindent: \centering zeroes the
  -- indent itself. The fill under the slices is padded out to the same
  -- width the one-piece box has, the drawing plus its 0.7em on either
  -- side, which is the measure when the score is set at the text width.
  local centred = narrow and not left
  local indent = centred and "" or "\\noindent"
  local pad = narrow
    and string.format("\\dimexpr %.3fbp+1.4em\\relax", width_pt)
    or "\\linewidth"
  local out = { "\\mdmscoreband{\\mdmslicestack{%" }
  if centred then out[#out + 1] = "\\centering" end
  out[#out + 1] = "\\mdmslicepad{" .. pad .. "}"
  for i = 1, #cuts + 1 do
    local trim = string.format("trim=0bp %.3fbp 0bp %.3fbp,clip",
      cuts[i] or 0, i == 1 and 0 or (height - cuts[i - 1]))
    out[#out + 1] = string.format("%s\\mdmslice{\\includegraphics[%s]{%s}}\\par",
      indent, narrow and trim or (trim .. ",width=\\mdmscorewidth"), pdf)
  end
  out[#out + 1] = "\\mdmslicepad{" .. pad .. "}"
  out[#out + 1] = "}}"
  return pandoc.RawBlock("latex", table.concat(out, "\n"))
end

-- The abcm2ps engraving, EPS to PDF, painted on the way. True when the
-- cached PDF is in place.
local function engrave_abcm2ps(source, ink, staff, digest)
  local pdf = CACHE_DIR .. "/" .. digest .. ".pdf"
  local abc = CACHE_DIR .. "/" .. digest .. ".abc"
  local f = assert(io.open(abc, "w"))
  f:write(with_engraver_header(source))
  f:close()
  local prefix = CACHE_DIR .. "/" .. digest .. "_"
  local eps = prefix .. "001.eps"
  -- A tune abcm2ps will not have is refused with a status of 0 and no EPS
  -- written, so the file is what says whether it engraved anything.
  if not run(string.format("%s -E -q -O %s %s", abcm2ps_path, prefix, abc))
    or not file_exists(eps)
  then
    quarto.log.warning("mdm: abcm2ps engraved nothing from a music block; its source is left as it is.")
    return false
  end
  local ef = assert(io.open(eps, "r"))
  local engraved = ef:read("*a")
  ef:close()
  ef = assert(io.open(eps, "w"))
  ef:write(paint_eps(engraved, ink, staff))
  ef:close()
  -- abcm2ps writes the EPS at the full page width even when the staff is
  -- shorter than that (%%staffwidth, say). The BoundingBox is trimmed to
  -- the real ink with ghostscript, and the width that comes out is kept in
  -- a sidecar file, so the inserted size can be decided from the cache.
  local x0, y0, x1, y1 = ink_bbox(eps)
  -- A tune with a header but nothing to draw (the injected X:/K: over an
  -- empty body, say) comes back as an EPS with no ink in it: writing its
  -- zero box into the header sent ghostscript a [0 0] page and epstopdf
  -- died of it. It is the same refusal as no EPS at all.
  if not x0 or tonumber(x1) <= tonumber(x0) then
    quarto.log.warning("mdm: abcm2ps engraved nothing from a music block; its source is left as it is.")
    return false
  end
  if x0 then
    local ef = assert(io.open(eps, "r"))
    local content = ef:read("*a")
    ef:close()
    -- Replaced through a function: a replacement string would have its %%
    -- read again, and "%%BoundingBox" would come out as "%BoundingBox",
    -- which breaks the DSC header.
    local bbox_line = "%%BoundingBox: " .. x0 .. " " .. y0 .. " " .. x1 .. " " .. y1
    content = content:gsub("%%%%BoundingBox:[^\n]*", function()
      return bbox_line
    end, 1)
    content = content:gsub("%%%%HiResBoundingBox:[^\n]*", function()
      return "%%HiRes" .. bbox_line:sub(3)
    end, 1)
    ef = assert(io.open(eps, "w"))
    ef:write(content)
    ef:close()
    local wf = io.open(CACHE_DIR .. "/" .. digest .. ".w", "w")
    if wf then
      wf:write(tostring(tonumber(x1) - tonumber(x0)))
      wf:close()
    end
  end
  if not run(string.format("epstopdf %s --outfile=%s", eps, pdf)) then
    quarto.log.warning("mdm: epstopdf failed on a music block; its source is left as it is.")
    return false
  end
  return true
end

local chrome_warned = false

local function render_latex(el)
  local source = el.text
  if not source:match("\n$") then source = source .. "\n" end
  -- What names a cache entry is the engraver, its parameters, the block and
  -- the two colours it was drawn in: the same score on the two sides of the
  -- look is two engravings and cannot share one file, and the two engravers
  -- cannot share one either. What with_engraver_header adds for abcm2ps is
  -- not part of the name, so a block that needed it keeps the name it would
  -- have had without it.
  local ink, staff = engraving_colors()
  local wants_abcjs = not (look and look.engraver == "abcm2ps")

  if wants_abcjs and chrome_path and has_pdfcrop then
    -- The leading `abcjs 1` is the engraver and the recipe: a change to the
    -- page it prints from (chrome_page) has to bump it, or a warm cache
    -- would keep serving the old drawing.
    local digest = sha1(
      "abcjs 2 " .. ABCJS_STAFFWIDTH .. "\n" .. source .. "\n" .. ink .. " " .. staff)
    if file_exists(CACHE_DIR .. "/" .. digest .. ".pdf") then
      return insert_score(digest)
    end
    run("mkdir -p " .. CACHE_DIR)
    if engrave_abcjs(source, ink, staff, digest) then
      return insert_score(digest)
    end
    quarto.log.warning(
      "mdm: Chrome could not print a music block; it falls back to abcm2ps.")
  elseif wants_abcjs and not chrome_warned then
    chrome_warned = true
    -- What is missing is named: pdfcrop can be the absent one on a machine
    -- with a perfectly good Chrome, and "no Chrome found" then sent its
    -- reader hunting the wrong tool.
    if chrome_path then
      quarto.log.warning(
        "mdm: pdfcrop was not found (it ships with TeX Live), so the scores" ..
        " cannot be engraved with the editor's abcjs; they fall back to abcm2ps.")
    else
      quarto.log.warning(
        "mdm: no Chrome found to engrave the scores with the editor's abcjs;" ..
        " they fall back to abcm2ps. Point mdm.chrome at a Chrome, or set" ..
        " mdm-engraver: abcm2ps to quiet this.")
    end
  end

  local digest = sha1(
    source .. "\n" .. ink .. " " .. staff .. " " .. STAFF_LINE_WIDTH)
  if file_exists(CACHE_DIR .. "/" .. digest .. ".pdf") then
    return insert_score(digest)
  end
  run("mkdir -p " .. CACHE_DIR)
  if engrave_abcm2ps(source, ink, staff, digest) then
    return insert_score(digest)
  end
  return nil
end

-- A thematic break (`---`), drawn as the editor draws its <hr>: the hairline
-- the preamble defines. HTML keeps Quarto's own <hr>, which mdm-look.css
-- already paints; any other format keeps Pandoc's.
local function horizontal_rule()
  if quarto.doc.is_format("latex") then
    return pandoc.RawBlock("latex", "\\mdmthematicbreak")
  end
  return nil
end

-- The block Quarto draws at the top of a rendered document from the YAML: the
-- title, the subtitle, whoever wrote it and when. It belongs to the header, so
-- it comes out only when the header does. The editor can keep the YAML out of
-- the text it shows (mdm.frontMatter), and an export from an editor that is
-- hiding it renders a document that does not open with it either; what the
-- editor is showing travels as the metadata read here. A render from the
-- command line has no editor behind it and keeps what the document declares.
-- Quarto normalises whoever wrote the document into three keys of its own
-- before a filter sees the metadata, so taking `author` away and leaving the
-- other two behind still draws the block, with the name under it (measured).
local TITLE_BLOCK = {
  "title", "subtitle", "author", "authors", "by-author",
  "date", "abstract", "doi", "keywords",
}

function Meta(meta)
  local opt = meta.mdm
  if opt and opt.abcm2ps then
    abcm2ps_path = find_abcm2ps(pandoc.utils.stringify(opt.abcm2ps))
  else
    abcm2ps_path = find_abcm2ps(nil)
  end
  -- The engraver's browser and its trimmer, looked for once and only where
  -- they could be spent: a render to HTML engraves in the reader's browser
  -- and needs neither.
  if quarto.doc.is_format("latex") then
    chrome_path = find_chrome(opt and opt.chrome and
      pandoc.utils.stringify(opt.chrome) or nil)
    has_pdfcrop = command_exists("pdfcrop")
  end
  look = read_look(meta)
  -- Which command each level of heading is written as, for the paper to size
  -- the headings by level (heading_commands, over look_tex). A page has h1 to
  -- h6 and nothing to ask.
  if quarto.doc.is_format("latex") then look.heads = heading_commands(meta) end
  -- The look rides on every render, HTML or PDF, music in the document or
  -- none: the ground, the ink and the code cards are the document's.
  if quarto.doc.is_format("html") or quarto.doc.is_format("latex") then
    ensure_look()
  end
  local header = meta_word(
    meta, "mdm-front-matter", { shown = true, hidden = true }, "shown")
  if header == "hidden" then
    for _, key in ipairs(TITLE_BLOCK) do meta[key] = nil end
    return meta
  end
  return nil
end

-- ---------- An SVG figure on paper ----------

-- LaTeX cannot read an SVG. Quarto converts one with rsvg-convert, a program
-- it does not ship and does not look for until it is too late to do without:
-- the render dies there ("Could not convert a SVG to a PDF for output",
-- measured on Quarto 1.9.37), so a document with a drawn figure in it had no
-- PDF at all on a machine carrying everything the editor itself needs. The
-- headless Chrome that engraves the scores prints the figure instead, and the
-- PDF goes in the cache beside them.
--
-- The page is the size of the drawing, so what comes out is the drawing and
-- nothing around it, and it is not trimmed to its ink: the white an author
-- left around a figure is part of the figure, unlike the sheet a score is
-- engraved on. `<base>` points at the folder the SVG came from, so anything
-- it names relatively (another image, a font) is found where it would be.
local function svg_size(text)
  local w = tonumber((text:match('%swidth%s*=%s*"([%d%.]+)') or ""))
  local h = tonumber((text:match('%sheight%s*=%s*"([%d%.]+)') or ""))
  if w and h and w > 0 and h > 0 then return w, h end
  local vb = text:match('viewBox%s*=%s*"([^"]+)"')
  if vb then
    local nums = {}
    for n in vb:gmatch("[-%d%.]+") do nums[#nums + 1] = tonumber(n) end
    if #nums >= 4 and nums[3] > 0 and nums[4] > 0 then return nums[3], nums[4] end
  end
  return nil
end

local function svg_page(svg, dir, w, h)
  return table.concat({
    '<!doctype html><meta charset="utf-8">',
    '<base href="file://' .. dir .. '/">',
    "<style>",
    "  html, body { margin: 0; padding: 0; background: transparent; }",
    "  @page { margin: 0; size: " .. w .. "px " .. h .. "px; }",
    "  svg { display: block; width: " .. w .. "px; height: " .. h .. "px; }",
    "</style>",
    svg,
  }, "\n")
end

-- The printed figure, or nil when there is nothing to print with, when the
-- file is not an SVG, or when it does not say how big it is. The caller then
-- leaves the image as it was and Quarto tries its own converter.
local function svg_as_pdf(src)
  if not src:lower():match("%.svg$") then return nil end
  if not chrome_path then return nil end
  local f = io.open(src, "rb")
  if not f then return nil end
  local svg = f:read("a")
  f:close()
  local w, h = svg_size(svg)
  if not w then return nil end
  local digest = sha1(svg)
  local pdf = CACHE_DIR .. "/" .. digest .. ".pdf"
  if file_exists(pdf) then return pdf end
  run("mkdir -p " .. CACHE_DIR)
  local html = CACHE_DIR .. "/" .. digest .. ".svg.html"
  local page = io.open(html, "w")
  if not page then return nil end
  page:write(svg_page(svg, abs_path(src):match("^(.*)/[^/]*$") or ".", w, h))
  page:close()
  run(string.format(
    '"%s" --headless=new --disable-gpu --no-pdf-header-footer%s' ..
    " --virtual-time-budget=4000 --print-to-pdf=%s %s >/dev/null 2>&1",
    chrome_path, chrome_sandbox_flag(), pdf, html))
  os.remove(html)
  if file_exists(pdf) then return pdf end
  return nil
end

-- ---------- Figures named by an absolute path ----------

-- Quarto rewrites the src of an image that sits outside the render directory
-- into a relative one by dropping its leading slash: `/home/me/fig.svg` comes
-- out of the HTML as `./home/me/fig.svg`, which points at nothing (measured on
-- Quarto 1.9.37 through Pandoc 3.8.3, with no filter of ours in the way). The
-- figure was missing from the page, and the PDF died in LaTeX looking for a
-- file of that name in the render directory.
--
-- The file is copied into the cache the filter keeps its own drawings in, and
-- the image is pointed at the copy: a path inside the render directory, which
-- both formats carry the way they carry a figure written beside the document.
-- The copy is named after the digest of its contents, so a figure that has
-- been redrawn is copied again and one that has not is not.
local function copy_figure(el)
  local src = el.src
  if src:match("^%a[%w+.-]*:") then return nil end -- a URL, or a data: image
  if not src:match("^/") and not src:match("^%a:[/\\]") then return nil end
  local from = io.open(src, "rb")
  if not from then return nil end -- named but not there: left as it was
  local bytes = from:read("a")
  from:close()
  local ext = src:match("(%.[%w]+)$") or ""
  local copy = CACHE_DIR .. "/" .. sha1(bytes) .. ext
  if not file_exists(copy) then
    run("mkdir -p " .. CACHE_DIR)
    local to = io.open(copy, "wb")
    if not to then return nil end
    to:write(bytes)
    to:close()
  end
  el.src = copy
  return el
end

function Image(el)
  if not quarto.doc.is_format("html") and not quarto.doc.is_format("latex") then
    return nil
  end
  -- The figure first, since what is printed on paper is the file itself and
  -- the cache is where the print lands anyway.
  if quarto.doc.is_format("latex") then
    local pdf = svg_as_pdf(el.src)
    if pdf then
      el.src = pdf
      return el
    end
  end
  return copy_figure(el)
end

-- The formula as the page carries it: its own LaTeX inside a `span.math`,
-- which is what mdm-math.js reads and KaTeX sets. Written out here rather
-- than left to Quarto, whose engines are MathJax from a CDN (the default) and
-- a KaTeX loaded by a path beside the output, which a page moved away from
-- that folder could not follow. With no Math left in the document Pandoc
-- writes no engine of its own into the page.
function Math(m)
  if not quarto.doc.is_format("html") then return nil end
  ensure_katex_dep()
  local kind = m.mathtype == "DisplayMath" and "display" or "inline"
  return pandoc.RawInline(
    "html",
    '<span class="math ' .. kind .. '">' .. html_escape(m.text) .. "</span>"
  )
end

function CodeBlock(el)
  if not is_abc_block(el) then return nil end
  if quarto.doc.is_format("html") then
    return render_html(el)
  elseif quarto.doc.is_format("latex") then
    return render_latex(el)
  end
  return nil -- any other format: leave the block alone
end

-- The maths pass, over the whole document at once so the batch is one
-- Chrome run. It rides the same switch as the scores: the editor's engines
-- through Chrome unless the document asked for abcm2ps or there is no
-- Chrome to run, where every Math element stays LaTeX's.
local function document(doc)
  if not quarto.doc.is_format("latex") then return nil end
  if look and look.engraver == "abcm2ps" then return nil end
  if not chrome_path then return nil end
  return render_math_pass(doc)
end

-- A sixth-level heading on paper. Pandoc writes a level past \subparagraph
-- as a plain paragraph, which in an article is `######`, and on paper it read
-- as a line of prose: the regular face, with no more air over it than two
-- paragraphs leave (measured). Where the class has no command for the sixth
-- level (look.heads, from heading_commands) it goes out as the preamble's
-- \mdmheadsix with its label, so that a link to it still lands; under a class
-- with chapters it is \subparagraph, a heading already, and is left to it.
local function sixth_heading(el)
  if el.level ~= 6 or not quarto.doc.is_format("latex") then return nil end
  if look and look.heads and look.heads[6] then return nil end
  local inlines = pandoc.Inlines({ pandoc.RawInline("latex", "\\mdmheadsix{") })
  inlines:extend(el.content)
  local label = el.identifier:match("^[%w%-_.:]+$") and ("\\label{" .. el.identifier .. "}") or ""
  inlines:insert(pandoc.RawInline("latex", "}" .. label))
  return pandoc.Plain(inlines)
end

-- Meta has to run before the CodeBlocks, since it settles the abcm2ps path,
-- and before the headings, since it settles which command each level of them
-- is written as (look.heads). Within the second table the Pandoc function
-- runs after the element ones.
return {
  { Meta = Meta },
  { CodeBlock = CodeBlock, Header = sixth_heading, HorizontalRule = horizontal_rule,
    Image = Image, Math = Math, Pandoc = document },
}
