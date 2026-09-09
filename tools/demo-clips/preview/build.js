// node preview/build.js
//
// Builds build/index.html: a local copy of the extension's page on the Visual
// Studio Marketplace, with the README rendered into it and the recorded clips
// in place, for judging a change to the README or to a clip before it is
// published.
//
// Measured rather than approximated: the shell, the two columns, the type and
// the palette are the values read off the live page on 2026-09-08 (build
// M279_20260831.9). The one that matters most is the README column, 710.5 px,
// the width every clip is finally seen at. The two known departures are noted
// at the top of mock.css.
//
// The README comes from vscode-mdm/README.md as it stands and from every
// Markdown file in ../drafts/; the review panel on the page switches between
// them. The banner reads vscode-mdm/package.json, so the name, version,
// categories and tags are the ones the package would publish.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { clips } = require("../clips.js");
const { media, markers, expand } = require("../markup.js");
const { REPO, BUILD, CLIPS_OUT, DRAFTS, README, PACKAGE, DOCS, RAW_BASE } = require("../paths.js");

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Quarto's pandoc, which the project needs for its exports anyway, so the page
// builds on any machine that can export.
function toHtml(md) {
  const tmp = path.join(BUILD, ".readme.md");
  fs.writeFileSync(tmp, md);
  try {
    return execFileSync("quarto", ["pandoc", "-f", "gfm+raw_html", "-t", "html5", "--wrap=none", tmp], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    fs.unlinkSync(tmp);
  }
}

// Pictures the README names in vscode-mdm/docs/ by their address on GitHub
// (RAW_BASE) are shown from a copy in build/docs/. The address resolves only
// once the file is pushed, which is after this page is meant to be read, and
// a viewer that lets the page read only its own folder (Office Viewer) could
// not reach the repository's copy either. A name docs/ does not have keeps
// its address, and shows broken here as it would there.
function localDocs(html) {
  return html
    .split(RAW_BASE)
    .map((part, i) => {
      if (i === 0) return part;
      const name = (part.match(/^[\w.-]+/) || [""])[0];
      const from = path.join(DOCS, name);
      if (!name || !fs.existsSync(from)) return RAW_BASE + part;
      fs.mkdirSync(path.join(BUILD, "docs"), { recursive: true });
      fs.copyFileSync(from, path.join(BUILD, "docs", name));
      return "docs/" + part;
    })
    .join("");
}

// The words a reader has to get through: code, tables, comments, media and
// link targets left out.
function proseWords(md) {
  const prose = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^ {4}.*$/gm, " ")
    .replace(/^\|.*$/gm, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<video\b[^>]*><\/video>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\]\([^)]*\)/g, "]");
  return (prose.match(/[A-Za-z0-9][\w'.-]*/g) || []).length;
}

function sources() {
  const list = [{ key: "live", label: "As it is", file: README }];
  if (fs.existsSync(DRAFTS)) {
    for (const f of fs.readdirSync(DRAFTS).filter((f) => f.endsWith(".md")).sort()) {
      list.push({ key: f.slice(0, -3), label: f.slice(0, -3), file: path.join(DRAFTS, f) });
    }
  }
  return list.map((s) => {
    const md = fs.readFileSync(s.file, "utf8");
    // The slot is a <p>, as the Marketplace wraps the media line in one: the
    // paragraph's margins are part of how a clip sits on that page.
    const slotted = expand(md, (id) => `<p class="mdm-slot" data-clip="${id}"></p>`);
    return { key: s.key, label: s.label, clips: markers(md), words: proseWords(md), html: localDocs(toHtml(slotted)) };
  });
}

function recorded() {
  const out = {};
  for (const c of clips) {
    out[c.id] = {};
    for (const look of ["light", "dark"]) {
      const name = (suffix) => `${c.id}-${look}${suffix}`;
      const has = (suffix) => fs.existsSync(path.join(CLIPS_OUT, name(suffix)));
      if (!has(".mp4") && !has(".gif")) continue;
      out[c.id][look] = {
        mp4: has(".mp4") ? `clips/${name(".mp4")}` : null,
        gif: has(".gif") ? `clips/${name(".gif")}` : null,
        poster: has("-poster.jpg") ? `clips/${name("-poster.jpg")}` : null,
        meta: has(".json") ? JSON.parse(fs.readFileSync(path.join(CLIPS_OUT, name(".json")), "utf8")) : null,
      };
    }
  }
  return out;
}

function main() {
  fs.mkdirSync(BUILD, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
  const srcs = sources();
  const rec = recorded();
  const data = {
    clips: clips.map((c) => ({ id: c.id, title: c.title, alt: c.alt, markup: { mp4: media(c, "mp4"), gif: media(c, "gif") } })),
    media: rec,
    sources: srcs.map((s) => ({ key: s.key, label: s.label, clips: s.clips, words: s.words })),
  };
  const pills = (xs) => (xs || []).map((x) => `<span class="pill">${esc(x)}</span>`).join("");
  const readmes = srcs
    .map((s) => `<div class="markdown" data-source="${esc(s.key)}" hidden>\n${s.html}\n</div>`)
    .join("\n");

  // The template's opening comment is about the file, not part of the page.
  let page = read("shell.html.tmpl").replace(/^<!--template[\s\S]*?-->\n/, "");
  const fields = {
    displayName: pkg.displayName,
    publisher: pkg.publisher,
    version: pkg.version,
    description: pkg.description,
    identifier: `${pkg.publisher}.${pkg.name}`,
    license: pkg.license || "",
  };
  for (const [k, v] of Object.entries(fields)) page = page.split(`{{${k}}}`).join(esc(v));
  page = page
    .replace("{{categories}}", () => pills(pkg.categories))
    .replace("{{tags}}", () => pills(pkg.keywords))
    .replace("/*CSS*/", () => read("mock.css"))
    .replace("<!--READMES-->", () => readmes)
    // "</" inside the data would close the <script> early; "<\/" is the same
    // string to JSON and nothing to the HTML parser.
    .replace("/*DATA*/", () => JSON.stringify(data).replace(/<\//g, "<\\/"))
    .replace("/*JS*/", () => read("mock.js"));
  fs.writeFileSync(path.join(BUILD, "index.html"), page);
  // Copied rather than linked at ../../../vscode-mdm/media: a viewer that lets
  // the page read only its own folder (Office Viewer in VS Code does) showed
  // the banner without it.
  fs.copyFileSync(path.join(REPO, "vscode-mdm", "media", "icon.png"), path.join(BUILD, "icon.png"));

  for (const s of srcs) {
    const missing = s.clips.filter((id) => !Object.keys(rec[id] || {}).length);
    console.log(
      `${s.key.padEnd(10)} ${String(s.words).padStart(5)} words, ${s.clips.length} clips` +
        (missing.length ? `  NOT RECORDED: ${missing.join(", ")}` : "")
    );
  }
  console.log("wrote " + path.join(BUILD, "index.html"));
}

main();
