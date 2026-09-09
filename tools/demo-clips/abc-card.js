// node abc-card.js
//
// The picture of a score block in the extension's README: abc-card.mdm's
// block as the editor draws it with a caret inside, its ABC in the
// extension's own colours and the score engraved under it, on MDM Light. A
// picture and not a fenced block because a fenced block on the Marketplace
// page is drawn by the page's own stylesheet, and what the README shows is
// the editor's colouring. (Whether the page would keep colours written into
// the README as inline styles has not been tried.)
//
// Drawn by the editor's own style.css in the test harness (tests/webview), at
// twice the density so the Marketplace's 710.5 px column shows it sharp,
// framed with the hairline the clips carry (rig.js) at nearly the same weight
// on the page (see HAIRLINE), and written to vscode-mdm/docs/abc-card.png.
// Retake it when the ABC colours or the engraving change. It prints the <img>
// line for the README, whose alt text is the block itself, so a reader who
// cannot see the picture still gets the ABC.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { REPO, BUILD, DOCS, RAW_BASE } = require("./paths.js");
const H = require(path.join(REPO, "tests", "webview", "helpers.js"));

const SOURCE = path.join(__dirname, "abc-card.mdm");
const OUT = path.join(DOCS, "abc-card.png");
const SCALE = 2;
// rig.js draws 1 px of #c8c8c8 round the clip, whose 900 px GIF the 710.5 px
// column shows at 79%, so that line comes to 0.79 of a screen pixel. This
// picture came out 1600 px wide (2026-09-11: the block's 800 CSS px at SCALE
// 2) and is shown at 44%, so 2 px of the same grey come to 0.89 of a screen
// pixel, about #cecece on the white against the clip's #d4d4d4: a shade
// heavier, and the nearest a whole number of pixels gets (1 px would be 0.44).
const HAIRLINE = `drawbox=x=0:y=0:w=iw:h=ih:color=0xc8c8c8:t=${SCALE}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function altText(md) {
  const block = md.match(/```abc\n([\s\S]*?)\n```/);
  if (!block) throw new Error("abc-card.mdm has no ```abc block");
  const lines = block[1].split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  return "A score block as the editor shows it with a caret inside, its ABC coloured and the score engraved under it. " + lines.join(" / ");
}

const attr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

async function main() {
  const text = fs.readFileSync(SOURCE, "utf8");
  const h = await H.open({ text, scores: 1, seed: { settings: { theme: "light", frontMatter: "hidden" } } });
  try {
    await h.page.setViewport({ width: 900, height: 1200, deviceScaleFactor: SCALE });
    await sleep(800);
    // A caret in the block opens its source over the drawing; the caret itself
    // is left out of the picture.
    await h.page.evaluate(() => {
      const s = document.createElement("style");
      s.textContent = "#app .cm-cursorLayer{display:none!important}";
      document.head.appendChild(s);
      const { view } = window.__mdm;
      const at = view.state.doc.toString().indexOf("X:1");
      view.focus();
      view.dispatch({ selection: { anchor: at } });
    });
    await sleep(900);
    const box = await h.page.evaluate(() => {
      const { view } = window.__mdm;
      const doc = view.state.doc.toString();
      const line = (pos) => {
        const n = view.domAtPos(pos).node;
        return (n.nodeType === 1 ? n : n.parentElement).closest(".cm-line");
      };
      const first = line(doc.indexOf("```abc")).getBoundingClientRect();
      const last = line(doc.lastIndexOf("```")).getBoundingClientRect();
      // The tallest svg is the engraving; the first one is a 17 px icon.
      const svg = [...document.querySelectorAll("#app .mdm-score svg")].sort(
        (a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height
      )[0];
      const s = svg.getBoundingClientRect();
      const bottom = Math.max(last.bottom, s.bottom) + 10;
      return { x: first.left, y: first.top, width: first.width, height: bottom - first.top, svg: { top: s.top, h: s.height }, lastBottom: last.bottom };
    });
    fs.mkdirSync(BUILD, { recursive: true });
    const raw = path.join(BUILD, "abc-card-raw.png");
    await h.page.screenshot({ path: raw, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", raw, "-vf", HAIRLINE, OUT]);
    if (h.errors.length) console.log("page errors:", h.errors);
    console.log(`wrote ${OUT} (${Math.round(box.width * SCALE)}x${Math.round(box.height * SCALE)}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
    console.log(`<img src="${RAW_BASE}abc-card.png" alt="${attr(altText(text))}">`);
  } finally {
    await h.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
