// node apply.js --look light|dark [--draft <name>] [--prune]
//
// Puts the clips into the extension's README, as GIFs. With --draft,
// drafts/<name>.md replaces vscode-mdm/README.md first. Then every clip the
// README marks (<!-- clip: <id> --> on a line of its own) is copied from
// build/clips/ into vscode-mdm/docs/ as clip-<id>.gif, the name the README
// links to, and the GIF line after each marker is written. --prune deletes
// the clip files in docs/ that the README no longer names; without it they
// are only listed.
//
// Only the GIF, though record.js encodes an mp4 of every take as well: the
// Marketplace page strips muted from a <video>, and Chrome then shows a reader
// who lands from outside the Marketplace nothing but its poster (markup.js has
// the trace). The mp4 takes are for the review page, and
// tests/packaging.test.js holds the README to a GIF after every marker.
//
// This writes into the repository. The Marketplace fetches the files from
// main on GitHub, so what it copies has to be committed and pushed together
// with the README that names it, before the package is built.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { clips } = require("./clips.js");
const { media, markers, expand } = require("./markup.js");
const { CLIPS_OUT, DOCS, README, DRAFTS } = require("./paths.js");

// Printed with every call this cannot follow, so that one asking for another
// format learns why there is none.
const USAGE =
  "usage: node apply.js --look light|dark [--draft <name>] [--prune]\n" +
  "It writes each clip into the README as a GIF, the one format there is: the Marketplace strips\n" +
  "muted from a <video>, so Chrome shows only its poster, and tests/packaging.test.js requires the GIF.";

function main() {
  const args = process.argv.slice(2);
  const opt = { prune: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--prune") opt.prune = true;
    else if (args[i] === "--look" || args[i] === "--draft") opt[args[i].slice(2)] = args[++i];
    else throw new Error(`unknown argument ${args[i]}\n${USAGE}`);
  }
  if (!["light", "dark"].includes(opt.look)) throw new Error(`--look light or --look dark\n${USAGE}`);

  const source = opt.draft ? path.join(DRAFTS, `${opt.draft}.md`) : README;
  const md = fs.readFileSync(source, "utf8");
  const byId = Object.fromEntries(clips.map((c) => [c.id, c]));
  const ids = markers(md);
  const unknown = ids.filter((id) => !byId[id]);
  if (unknown.length) throw new Error("the README marks clips that do not exist: " + unknown.join(", "));
  if (!ids.length) throw new Error(`${source} marks no clips`);

  const wanted = new Set();
  for (const id of ids) {
    const from = path.join(CLIPS_OUT, `${id}-${opt.look}.gif`);
    if (!fs.existsSync(from)) throw new Error(`not recorded: ${from} (node record.js --look ${opt.look} ${id})`);
    const to = `clip-${id}.gif`;
    fs.copyFileSync(from, path.join(DOCS, to));
    wanted.add(to);
  }

  fs.writeFileSync(README, expand(md, (id) => media(byId[id], "gif")));
  console.log(`README: ${ids.length} clips as GIF, recorded ${opt.look}${opt.draft ? `, from drafts/${opt.draft}.md` : ""}`);
  console.log("docs:   " + [...wanted].join(" "));

  // Clips the README no longer names, left from an earlier apply. mp4 and jpg
  // are still matched: an older apply could write a clip as a video with its
  // poster, and those files are as stale as a GIF nobody names.
  const stale = fs.readdirSync(DOCS).filter((f) => /^clip-.*\.(mp4|gif|jpg)$/.test(f) && !wanted.has(f));
  if (stale.length) {
    if (opt.prune) stale.forEach((f) => fs.unlinkSync(path.join(DOCS, f)));
    console.log((opt.prune ? "pruned: " : "stale (--prune removes them): ") + stale.join(" "));
  }
}

main();
