// How a clip is written into the README: the one place that knows it, shared
// by apply.js, which writes it, and the review page, which reads it back.
//
// A clip is a marker comment on a line of its own and the media element on
// the line after it. The scripts key on the marker because it survives a
// change of format (a GIF line and a <video> line have nothing in common) and
// no page the README is shown on draws it.

"use strict";

const { RAW_BASE } = require("./paths.js");

const MARKER = /^<!-- clip: ([a-z0-9-]+) -->[ \t]*$/;
const MEDIA = /^(?:<video\b.*<\/video>|!\[[^\]]*\]\([^)]*\))[ \t]*$/;

function attr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// The two places a README is read keep different attributes. VS Code's
// Extensions view keeps all of these (markdownRenderer.ts allows autoplay,
// loop, muted, playsinline, poster). The Marketplace web page keeps src,
// poster, title, autoplay and loop and strips muted, controls and
// playsinline: traced on 2026-09-10 from the README eleven extensions uploaded
// (the gallery's Content.Details asset) to the page as served, and all eleven
// lost muted. Without muted, Chrome does not autoplay a reader who lands from
// outside the Marketplace, and with controls gone that reader gets the poster
// as a still. Firefox and Safari autoplay a file with no audio track, which is
// why encodeMp4 in rig.js encodes with -an. So the poster is the clip for
// those Chrome readers, and the GIF is the one format every reader sees move:
// apply.js writes only the GIF. The <video> line is kept for the review page,
// which shows what each reader would get from one.
function media(clip, format) {
  const base = `${RAW_BASE}clip-${clip.id}`;
  if (format === "gif") return `![${clip.alt}](${base}.gif)`;
  return (
    `<video src="${base}.mp4" poster="${base}.jpg" autoplay loop muted playsinline ` +
    `title="${attr(clip.alt)}"></video>`
  );
}

// The clip ids a README names, in the order it names them.
function markers(md) {
  return md
    .split("\n")
    .map((line) => (line.match(MARKER) || [])[1])
    .filter(Boolean);
}

// The README with each marker followed by render(id) instead of whatever media
// line followed it before (none, a GIF or a video).
function expand(md, render) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MARKER);
    out.push(lines[i]);
    if (!m) continue;
    if (i + 1 < lines.length && MEDIA.test(lines[i + 1])) i++;
    out.push(render(m[1]));
  }
  return out.join("\n");
}

module.exports = { media, markers, expand };
