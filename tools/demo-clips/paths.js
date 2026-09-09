// Where everything the clips need is, in one place, so the scripts agree.
//
// Two homes, on purpose. What is kept (the scripts, the demo document, the
// review page's sources) sits here in the repository. What a take produces on
// the way (a VS Code profile, the link to the extension, one PNG per frame,
// about 50 MB a take) goes to ~/.cache, outside the tree and, unlike /tmp, not
// emptied at boot: a first version of these scripts was kept in /tmp and was
// lost at a reboot.

"use strict";

const os = require("node:os");
const path = require("node:path");

const HERE = __dirname;
const REPO = path.resolve(HERE, "..", "..");
const STATE = process.env.MDM_DEMO_STATE || path.join(os.homedir(), ".cache", "mdm-demo-clips");

module.exports = {
  HERE,
  REPO,
  STATE,
  SETTINGS: path.join(STATE, "profile", "User", "settings.json"),
  FRAMES: path.join(STATE, "frames"),
  // The document every clip is recorded on, and the copy of it VS Code opens.
  // The copy is put back from DEMO before every take (record.js), so no take
  // can start on a document the one before it edited, and none can write
  // into the repository.
  DEMO: path.join(HERE, "demo.mdm"),
  WORKSPACE: path.join(STATE, "workspace"),
  BUILD: path.join(HERE, "build"),
  CLIPS_OUT: path.join(HERE, "build", "clips"),
  DRAFTS: path.join(HERE, "drafts"),
  README: path.join(REPO, "vscode-mdm", "README.md"),
  DOCS: path.join(REPO, "vscode-mdm", "docs"),
  PACKAGE: path.join(REPO, "vscode-mdm", "package.json"),
  PUPPETEER: path.join(REPO, "tests", "node_modules", "puppeteer-core"),
  PORT: Number(process.env.MDM_DEMO_PORT || 9333),
  // Where the Marketplace fetches a clip from. The README names abc-card.png
  // and the clip in this absolute form, and it is the only form that works for
  // a video's poster: vsce rewrites a relative src on <img> and <video> but
  // leaves poster alone (its rewrite regex in src/package.ts matches src only).
  RAW_BASE: "https://raw.githubusercontent.com/alpelito7/markdown_music/main/vscode-mdm/docs/",
};
