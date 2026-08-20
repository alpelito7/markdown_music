-- mdm.lua: Quarto filter for music blocks (ABC notation).
-- HTML: rendered by abcjs in the browser (SVG, playback optional).
-- PDF (LaTeX): engraved by abcm2ps to EPS, turned into PDF by epstopdf and
-- inserted as an image, cached by a hash of the source.

local CACHE_DIR = "mdm_cache"

local deps_added = false

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
