-- mdm.lua: Quarto filter for music blocks (ABC notation).
-- HTML: rendered by abcjs in the browser (SVG, playback optional), on a page
-- dressed as the VS Code editor (see the look section below).
-- PDF (LaTeX): engraved by abcm2ps to EPS, turned into PDF by epstopdf and
-- inserted as an image, cached by a hash of the source.

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
    svg_ink = "#000000",
    staff = "#a3a3a3",
    card = "var(--mdm-syn-tint)",
    page = "var(--mdm-syn-wash)",
  },
  dark = {
    ink = "#d4d4d4",
    link = "#58a6ff",
    accent = "#d9a94f",
    svg_ink = "#d4d4d4",
    staff = "#6f6f6f",
    card = "var(--mdm-syn-bg)",
    page = "var(--mdm-syn-tint)",
  },
  white = {
    ink = "#24292e",
    link = "#0969da",
    accent = "#a0740f",
    svg_ink = "#000000",
    staff = "#a3a3a3",
    card = "var(--mdm-syn-tint)",
    page = "#fff",
  },
}

-- mdm.scoreFill: the background a score can be given, one value per side.
local SCORE_FILLS = {
  none = nil,
  paper = { light = "#f4efe2", dark = "#2a2723" },
  slate = { light = "#eceef1", dark = "#2c3138" },
  brass = { light = "#f7edd8", dark = "#332c1c" },
}

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
  for _, slot in ipairs(SYNTAX_SLOTS) do
    if l.colors[slot] then put("syn-" .. slot, l.colors[slot]) end
  end
  put("ink", side.ink)
  put("link", side.link)
  -- What the browser paints itself (the scrollbars above all) follows the
  -- side the document is on, not the one the reader's system is set to.
  if dark then put("scheme", "dark") end
  put("play-accent", side.accent)
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
  return "<style>\nhtml:root {\n" .. table.concat(lines, "\n") .. "\n}\n</style>"
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
  quarto.doc.add_html_dependency({
    name = "mdm-look",
    version = "0.1.0",
    stylesheets = { "resources/mdm-look.css" },
  })
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

local function render_latex(el)
  local source = el.text
  if not source:match("\n$") then source = source .. "\n" end
  local digest = sha1(source)
  local pdf = CACHE_DIR .. "/" .. digest .. ".pdf"

  if not file_exists(pdf) then
    run("mkdir -p " .. CACHE_DIR)
    local abc = CACHE_DIR .. "/" .. digest .. ".abc"
    local f = assert(io.open(abc, "w"))
    f:write(source)
    f:close()
    local prefix = CACHE_DIR .. "/" .. digest .. "_"
    local eps = prefix .. "001.eps"
    if not run(string.format("%s -E -q -O %s %s", abcm2ps_path, prefix, abc)) then
      quarto.log.warning("mdm: abcm2ps failed on a music block; its source is left as it is.")
      return nil
    end
    -- abcm2ps writes the EPS at the full page width even when the staff is
    -- shorter than that (%%staffwidth, say). The BoundingBox is trimmed to
    -- the real ink with ghostscript, and the width that comes out is kept in
    -- a sidecar file, so the inserted size can be decided from the cache.
    local gs = io.popen(string.format(
      "gs -q -dBATCH -dNOPAUSE -sDEVICE=bbox %s 2>&1", eps))
    local bbox_out = gs and gs:read("*a") or ""
    if gs then gs:close() end
    local x0, y0, x1, y1 = bbox_out:match(
      "%%%%BoundingBox:%s+(%-?%d+)%s+(%-?%d+)%s+(%-?%d+)%s+(%-?%d+)")
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
      return nil
    end
  end

  -- A narrow score (%%staffwidth, say) is set at its natural size and
  -- centred, the way a display equation is. A wide one takes the text width.
  local width_pt = nil
  local wf = io.open(CACHE_DIR .. "/" .. digest .. ".w", "r")
  if wf then
    width_pt = tonumber(wf:read("*a"))
    wf:close()
  end
  if width_pt and width_pt < 330 then
    return pandoc.RawBlock("latex", string.format(
      "\\begin{center}\\includegraphics{%s}\\end{center}", pdf))
  end
  local img = pandoc.Image({}, pdf, "", pandoc.Attr("", {}, { width = "100%" }))
  return pandoc.Para({ img })
end

function Meta(meta)
  local opt = meta.mdm
  if opt and opt.abcm2ps then
    abcm2ps_path = find_abcm2ps(pandoc.utils.stringify(opt.abcm2ps))
  else
    abcm2ps_path = find_abcm2ps(nil)
  end
  look = read_look(meta)
  if quarto.doc.is_format("html") then ensure_look() end
  return nil
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

-- Meta has to run before the CodeBlocks, since it settles the abcm2ps path.
return {
  { Meta = Meta },
  { CodeBlock = CodeBlock },
}
