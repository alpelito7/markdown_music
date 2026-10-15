// mdm-address.js: names the links of the page that print their own address.
//
// A link whose words are the address it goes to is set in the code face
// (mdm-look.css, `a.uri`), as the editor draws it and as LaTeX sets a \url.
// Pandoc's reader classes the ones written as an address, bare or in angle
// brackets: `uri`, and `email` for a mail address. Two kinds reach the page
// without a class: the URL and the DOI of an entry of the reference list,
// which citeproc writes after every filter of the extension has run (a
// filter handed in at `post-quarto` saw none of them, measured on Quarto
// 1.9.37, so the filter cannot name them), and a link written `[url](url)`.
// They are given Pandoc's own class here, by the question the editor asks
// (ownAddress in vscode-mdm/media/main.js) and that Pandoc's LaTeX writer
// answers for the paper, where such a link is a \url and any other an \href:
// are the words the address. A title citeproc makes a link of, for an entry
// whose style prints no address, is words and keeps the face of the prose,
// and so does a link that holds anything but text (code, a picture).
(function () {
  "use strict";

  function name() {
    var links = document.querySelectorAll("main.content a[href]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.children.length) continue;
      var href = a.getAttribute("href");
      var words = a.textContent;
      if (!href || a.classList.contains("uri") || a.classList.contains("email")) continue;
      if (words === href) a.classList.add("uri");
      else if ("mailto:" + words === href) a.classList.add("email");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", name);
  } else {
    name();
  }
})();
