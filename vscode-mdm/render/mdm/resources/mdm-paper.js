// mdm-paper.js: what a sheet of paper needs measured, measured when the
// page is about to be printed.
//
// On a screen a table or a display equation the column cannot hold scrolls
// in its own box, as it does in the editor. Paper has nothing to scroll, and
// what stood past the column was cut off the sheet: the fourteenth column of
// a table, 10 of the 28 terms of an equation (measured 2026-10-04). The print
// rules of mdm-look.css draw such a block smaller, whole, at the scale of
// what the column has room for over what the block needs, and this script
// writes on each one what it needs, in two custom properties:
//
//   --mdm-natural  the width it cannot go under: a table squeezed until its
//                  cells are their longest words, a formula as KaTeX set it;
//   --mdm-taken    what stands beside it in its row and is not the block's
//                  to scale: the indent of the list or the quotation it is
//                  in, and for a numbered equation its number with the gap
//                  before it and the padding of the formula's own box.
//
// Both are lengths of the page and no ratio, because the window the page is
// in when it is read is not the sheet it is printed on: the extension's
// Chrome opens the page in its default window and then prints it on Letter
// or on the sheet the header names. The ratio is taken where the sheet is
// known, in the stylesheet, against the measure of that sheet.
//
// On `beforeprint`, which a browser sends before it lays the page out for
// paper, the extension's headless Chrome included (the table and the two
// equations of a fixture came out whole from `--print-to-pdf`, 2026-10-04).
// A reader's Ctrl+P sends it as well. Nothing is measured, and nothing is
// written, on a page that is only read.
(function () {
  "use strict";

  function measure() {
    var main = document.querySelector("main.content");
    if (!main) return;
    var column = main.clientWidth;

    Array.prototype.forEach.call(main.querySelectorAll("table"), function (table) {
      var row = table.rows[0];
      if (!row) return;
      // Squeezed to what it cannot go under, for the length of one reading:
      // the table is a block that holds its rows (mdm-look.css), and at
      // `min-content` the rows are as narrow as their longest words let them.
      var kept = table.style.width;
      table.style.width = "min-content";
      var natural = row.getBoundingClientRect().width;
      table.style.width = kept;
      table.style.setProperty("--mdm-natural", natural + "px");
      table.style.setProperty("--mdm-taken", Math.max(0, column - table.clientWidth) + "px");
    });

    Array.prototype.forEach.call(main.querySelectorAll(".katex-display > .katex"), function (formula) {
      var set = formula.querySelector(".katex-html");
      if (!set) return;
      // The formula's own width: the box around it is as wide as the column
      // whatever it holds, so what is read is the run of what KaTeX drew.
      var range = document.createRange();
      range.selectNodeContents(set);
      var box = formula.parentNode;
      var style = getComputedStyle(box);
      var eq = box.closest ? box.closest(".mdm-eq") : null;
      var number = eq ? eq.querySelector(".mdm-eq-number") : null;
      var taken = column - (eq || box).clientWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      if (number) {
        taken += number.getBoundingClientRect().width + parseFloat(getComputedStyle(number).marginLeft);
      }
      formula.style.setProperty("--mdm-natural", range.getBoundingClientRect().width + "px");
      formula.style.setProperty("--mdm-taken", Math.max(0, taken) + "px");
    });
  }

  window.addEventListener("beforeprint", measure);
})();
