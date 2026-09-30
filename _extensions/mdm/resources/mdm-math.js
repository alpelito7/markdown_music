// mdm-math.js: sets the formulas of the page with KaTeX, the engine the MDM
// editor draws with. The filter leaves each one as its own LaTeX inside a
// `span.math`, the way Pandoc's KaTeX writer does, and this reads them back
// and renders them in place.
//
// Quarto's own default is MathJax fetched from a CDN: the page needed the
// network to show a formula at all, and MathJax sets them to other widths
// than the editor does, so the same paragraph broke at a different word on
// the page than in the editor. KaTeX and this script ride with the page as
// an HTML dependency, which is what lets a self-contained export carry them
// inside the file.
(function () {
  "use strict";

  // A formula citeproc wrote out of the bibliography comes in two other
  // shapes. It runs after the filter and hands its formulas to the writer
  // (mdm.lua, bibliography_has_math): through the export they are GladTeX's
  // `<eq>` with their LaTeX inside (withPageKeys in extension.js), and a page
  // rendered without the export gets Pandoc's MathJax span, whose LaTeX is
  // wrapped in `\(...\)` or `\[...\]`. KaTeX read those delimiters as part of
  // the formula and drew it as an error, in red (measured on a BibTeX title
  // holding `$3/2$`, 2026-09-29).
  function source(el) {
    var tex = el.textContent;
    var wrapped = /^\s*\\([([])([\s\S]*)\\([)\]])\s*$/.exec(tex);
    return wrapped ? wrapped[2] : tex;
  }

  function render() {
    if (typeof katex === "undefined") return; // nothing to set them with
    var nodes = document.querySelectorAll("span.math, div.math, eq");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var tex = source(el);
      try {
        katex.render(tex, el, {
          displayMode:
            el.classList.contains("display") || el.getAttribute("env") === "displaymath",
          throwOnError: false,
        });
      } catch (e) {
        // A formula KaTeX will not read keeps its source, which is what the
        // editor shows for one that does not compile.
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
