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

  function render() {
    if (typeof katex === "undefined") return; // nothing to set them with
    var nodes = document.querySelectorAll("span.math, div.math");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var tex = el.textContent;
      try {
        katex.render(tex, el, {
          displayMode: el.classList.contains("display"),
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
