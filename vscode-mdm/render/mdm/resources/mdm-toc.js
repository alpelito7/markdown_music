// The table of contents, once more, for paper.
//
// A page that is asked for one (`toc: true`) carries it in its margin, where
// Quarto draws it beside the text, and Quarto's own print rules take it away
// (`#TOC { display: none }` under print media), so the PDF the extension
// prints from this page had no contents at all where the typeset one opens
// with them (measured 2026-10-02 on a document of twelve headings). A sheet
// has no margin to keep them in, so they go into the flow, where LaTeX sets
// them: under the title block, or at the head of the document when the
// header is hidden.
//
// It is a copy of the page's own contents and not a list the filter writes.
// Quarto numbers the sections and builds its contents after the filters have
// run (PANDOC_WRITER_OPTIONS.number_sections is false in mdm.lua for a
// document that numbers them, Quarto 1.9.37), so a list made there would
// have to work out the numbers, the depth and the unlisted headings again,
// and could disagree with the page it is printed from. Copied, it is the
// page's by construction, a formula in a title included. Contents asked of
// the PDF alone, under `format: pdf:`, are not on the page a browser shows;
// the extension has the page it prints rendered with them, and keeps off the
// paper those asked of the page alone (pdfAsks in vscode-mdm/extension.js,
// and mdm-print-toc in mdm.lua, which does not load this script then).
//
// The copy is in the page from the start and is drawn on paper alone
// (nav.mdm-print-toc in mdm-look.css, which also sets it as the typeset
// contents are set). Three things are changed in it:
//
// - Every id goes, and what Quarto's scroll spy hangs on a link, since the
//   margin's contents keep theirs and an id is one element's.
// - The classes that fold a level away in the margin go, where paper has
//   nothing to unfold.
// - The title becomes an h1, the size the typeset PDF heads its contents at
//   (LaTeX's \section*), and one without a heading's role, so that it is
//   drawn as a heading and is no bookmark of the PDF: Chrome makes the
//   bookmarks from the headings of the page, and the typeset PDF has none
//   for its contents either.
//
// No entry has the number of its page. Chrome 151 drops a declaration that
// uses target-counter() whole (probed 2026-10-02), so the entries are the
// links they are on the page and nothing more.
(function () {
  "use strict";

  function printToc() {
    var nav = document.querySelector("nav#TOC");
    var main = document.querySelector("main.content");
    if (!nav || !main || main.querySelector("nav.mdm-print-toc")) return;
    var copy = nav.cloneNode(true);
    copy.removeAttribute("id");
    copy.removeAttribute("role");
    copy.className = "mdm-print-toc";
    var title = copy.querySelector("h2");
    if (title) {
      var head = document.createElement("h1");
      head.setAttribute("role", "none");
      while (title.firstChild) head.appendChild(title.firstChild);
      title.replaceWith(head);
    }
    copy.querySelectorAll("*").forEach(function (el) {
      el.removeAttribute("id");
      el.removeAttribute("data-scroll-target");
      el.classList.remove("collapse", "nav-link", "active");
      if (!el.classList.length) el.removeAttribute("class");
    });
    var header = main.querySelector(":scope > #title-block-header");
    if (header) header.after(copy);
    else main.prepend(copy);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", printToc);
  } else {
    printToc();
  }
})();
