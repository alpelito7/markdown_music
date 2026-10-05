-- mdm-after.lua: the part of the MDM filter that reads what Quarto wrote.
--
-- mdm.lua runs before Quarto's own filters (`pre-quarto`, where a filter the
-- document names lands unless it says otherwise), which is where the scores,
-- the look and the equations have to be settled. What is here corrects
-- something Quarto prints, so it has to come after: _extension.yml hands it
-- in at `post-quarto`, and the VS Code export, which names the filter by its
-- path and not by the extension, passes it as a --lua-filter, which Pandoc
-- runs after all of Quarto's (renderArgs in vscode-mdm/extension.js). It
-- finds the same headings and the same references at either place (measured
-- on 1.9.37), and it is written with Pandoc's own API alone: the second
-- place is outside Quarto's Lua and has no `quarto` table.

-- ---------- The sections under a title ----------
--
-- `number-sections: true` over a document that opens on `# Title {-}` and
-- writes its sections from `##` down. Quarto takes the unnumbered `#` for the
-- document's first level all the same, so every number under it opens with
-- that level's counter, which no heading ever moved: 0.1, 0.1.1, 0.2 (its
-- sectionNumber puts the first counter in front whenever any heading of the
-- document is of the first level; read and measured on 1.9.37). The editor
-- draws them 1, 1.1, 2 (sectionNumbers in vscode-mdm/media/mdm-crossref.js,
-- on the owner's word of 2026-10-03: a first level whose number was turned
-- off is not counted from), and the page follows the editor, so the first
-- counter comes off here.
--
-- It is read off what Quarto printed and not counted again. A number that
-- opens with the first counter has one part for each level down to its
-- heading's own, as many parts as the heading has `#`s, and one that starts
-- at the second level has one fewer; the numbers of a document all open the
-- same way. So where one of them is as long as its heading is deep they are
-- all shortened, and the count keeps every rule of Quarto's (the title of a
-- callout, the offsets, the depth) with no copy of them here. Nothing is
-- touched where a `#` carries a number, which is a document with a first
-- level to Quarto and to the editor alike, nor under `crossref: chapters:
-- true`, which asks for the first counter whatever the document has.
--
-- What changes is the number in the heading, which the contents are made
-- from, the `number` attribute beside it (the page's data-number), and the
-- number in a reference to the heading (`@sec-intro` reads "Section 1").
-- Only a page is corrected: Quarto writes the number into a span on the
-- formats that are HTML, and LaTeX numbers its own headings (title_sections
-- in mdm.lua). Left as Quarto prints them, and open: the formats where the
-- number is plain text in the heading (docx, epub), and a reference under
-- `crossref: ref-hyperlink: false`, which is text with nothing around it to
-- know it by.

-- How many parts a number has: 3 for 0.1.2.
local function parts(number)
  local n = 0
  for _ in number:gmatch("[^.]+") do n = n + 1 end
  return n
end

-- The number Quarto wrote into a heading of a page, or nil.
local function printed(h)
  local lead = h.content[1]
  if lead and lead.t == "Span" and lead.classes:includes("header-section-number") then
    return h.attributes["number"]
  end
  return nil
end

local function title_sections(doc)
  local crossref = doc.meta.crossref
  if pandoc.utils.type(crossref) == "table" and crossref.chapters then return nil end
  local first, long = false, false
  doc:walk({
    Header = function(h)
      local number = printed(h)
      if not number then return nil end
      if h.level == 1 then
        first = true
      elseif parts(number) == h.level then
        long = true
      end
    end,
  })
  if first or not long then return nil end

  -- The headings first and the references after them, since a reference may
  -- stand above the heading it names.
  local shortened = {}
  doc = doc:walk({
    Header = function(h)
      local number = printed(h)
      if not number then return nil end
      local short = (number:gsub("^[^.]*%.", ""))
      local content = h.content
      content[1] = pandoc.Span({ pandoc.Str(short) }, content[1].attr)
      h.content = content
      h.attributes["number"] = short
      if h.identifier ~= "" then shortened[h.identifier] = { number, short } end
      return h
    end,
  })
  -- A reference is a link of Quarto's to the heading, and the number is the
  -- last word in it that is the heading's number: after the prefix
  -- ("Section 0.1"), or alone (`[-@sec-intro]`).
  return doc:walk({
    Link = function(l)
      if not l.classes:includes("quarto-xref") or l.target:sub(1, 1) ~= "#" then return nil end
      local to = shortened[l.target:sub(2)]
      if not to then return nil end
      local content = l.content
      for i = #content, 1, -1 do
        if content[i].t == "Str" and content[i].text == to[1] then
          content[i] = pandoc.Str(to[2])
          l.content = content
          return l
        end
      end
      return nil
    end,
  })
end

return {
  { Pandoc = title_sections },
}
