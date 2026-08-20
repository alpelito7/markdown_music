// mdm.js: renders the MDM music blocks with abcjs once the page has loaded.
document.addEventListener("DOMContentLoaded", function () {
  if (typeof ABCJS === "undefined") return;
  document.querySelectorAll(".mdm-block").forEach(function (block) {
    var srcEl = block.querySelector(".mdm-src");
    var paper = block.querySelector(".mdm-paper");
    if (!srcEl || !paper) return;
    var source = srcEl.textContent;
    // A first render without responsive, to measure the natural width of the
    // engraving: a narrow score (%%staffwidth, say) must not be stretched to
    // the width of the page, no more than a display equation is. The
    // container is then held at that width, so the responsive render that
    // follows can only shrink it on a small screen, never blow it up.
    ABCJS.renderAbc(paper, source, {});
    var svgEl = paper.querySelector("svg");
    var natural = svgEl ? parseFloat(svgEl.getAttribute("width")) : 0;
    if (natural && natural < paper.clientWidth) {
      // The limit goes on a wrapper and not on the paper itself: abcjs keeps
      // the ratio of the drawing in a percentage padding-bottom, and a
      // percentage is resolved against the width of the containing block. With
      // the max-width on the paper, that padding went on being computed from
      // the width of the page and left a vertical gap under the score.
      var fit = document.createElement("div");
      fit.className = "mdm-fit";
      fit.style.maxWidth = Math.ceil(natural) + "px";
      paper.parentNode.insertBefore(fit, paper);
      fit.appendChild(paper);
    }
    var visual = ABCJS.renderAbc(paper, source, {
      responsive: "resize",
    })[0];
    if (
      block.classList.contains("mdm-play") &&
      ABCJS.synth &&
      ABCJS.synth.supportsAudio()
    ) {
      var controls = block.querySelector(".mdm-audio");
      var controller = new ABCJS.synth.SynthController();
      controller.load(controls, null, {
        displayPlay: true,
        displayProgress: true,
        displayLoop: true,
      });
      // What is written is what sounds: without this, abcjs turns the chord
      // symbols ("Dm7") into a strummed accompaniment of its own, four
      // crotchets filling the bar under a written semibreve. Same rule as the
      // editor.
      controller.setTune(visual, false, { chordsOff: true });
    }
  });
});
