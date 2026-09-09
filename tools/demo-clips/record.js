// node record.js [--look light|dark|both] [--keep-frames] [clip-id ...]
//
// One take per clip against the VS Code that launch.sh started. Each take is
// encoded into build/clips/ as <id>-<look>.mp4, .gif and -poster.jpg, with a
// .json of what it measured. The frames, one PNG each and about 50 MB a take,
// are deleted once the encodes have succeeded, unless --keep-frames is given.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Rig, sleep, encodeMp4, encodeGif, encodePoster, seam, dissolveHome } = require("./rig.js");
const { clips, clearLayout, closeAll, openDoc, pinCaret, warmPiano, settleCaret, rest } = require("./clips.js");
const { SETTINGS, FRAMES, CLIPS_OUT, DEMO, WORKSPACE } = require("./paths.js");

// The two grounds a clip can be shot on. mdm.theme is the editor's own look
// and workbench.colorTheme the window around it; at rest the two agree, or the
// clip opens on a light page inside a dark window. That combination is real
// and supported, and the tour shot in the dark look ends in it: it turns the
// page to MDM Light inside the dark window.
const LOOKS = {
  light: { "workbench.colorTheme": "Default Light Modern", "mdm.theme": "light" },
  dark: { "workbench.colorTheme": "Default Dark Modern", "mdm.theme": "dark" },
};

// extra is a clip's own starting state, laid over the look: the tour opens on
// MDM Dark whichever window it is shot in.
function writeSettings(look, extra) {
  const settings = {
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "workbench.enableExperiments": false,
    "window.titleBarStyle": "custom",
    "window.commandCenter": false,
    "window.menuBarVisibility": "hidden",
    "workbench.layoutControl.enabled": false,
    "security.workspace.trust.enabled": false,
    "git.enabled": false,
    "chat.commandCenter.enabled": false,
    "chat.disableAIFeatures": true,
    "breadcrumbs.enabled": false,
    "editor.minimap.enabled": false,
    "window.restoreWindows": "none",
    // The logical size of the frame: see the note in rig.js.
    "window.zoomLevel": 2,
    // Every mdm.* back to its shipped default, so a take never inherits the
    // state the take before it left behind.
    "mdm.staffLines": "gray",
    "mdm.scoreFill": "none",
    "mdm.scoreAlign": "center",
    "mdm.frontMatter": "hidden",
    "mdm.outline": "hidden",
    "mdm.multicursorMatch": "word",
    "mdm.followPlayhead": "follow",
    "mdm.textFont": "roman",
    ...LOOKS[look],
    ...(extra || {}),
  };
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
}

// What the editor holds for demo.mdm: the file without its YAML header, which
// mdm.frontMatter "hidden" keeps out of the view, and without the blank line
// after it.
function pristine() {
  return fs.readFileSync(DEMO, "utf8").replace(/^---\n[\s\S]*?\n---\n\n/, "");
}

async function editorText(rig) {
  return rig.evalFrame(() => window.__mdm.view.state.doc.toString());
}

// A VS Code toast over the frame is in the first frame and the last alike, so
// the seam passes it (clearToasts in rig.js has the take that went out so).
async function noToast(rig, when) {
  const up = await rig.toasts();
  if (up.length) throw new Error(`${when} under a VS Code notification: ${up[0]}`);
}

// How far a take's last frame may be from its first and still loop. A caret
// drawn one character over, the one difference allowed, is in hundredths of a
// percent: 0.012% in the roman prose, measured on the editor's page in the
// test harness at the takes' density (2026-09-11).
const SEAM_LIMIT = 0.002;

async function take(rig, clip, look, keepFrames) {
  const tag = `${clip.id}-${look}`;
  process.stdout.write(`\n=== ${tag} ===\n`);
  writeSettings(look, clip.settings);
  await sleep(1600);
  await rig.overlay();
  await rig.clearToasts();
  await clearLayout(rig);
  await closeAll(rig);
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.copyFileSync(DEMO, path.join(WORKSPACE, "demo.mdm"));
  await openDoc(rig, "demo.mdm");
  await rig.webview();
  await rig.waitFor(() => !!document.querySelector("#app .mdm-toolbar"), { timeout: 15000 });
  if ((await editorText(rig)) !== pristine()) throw new Error("demo.mdm did not open as it is in the repository");
  await pinCaret(rig);
  await rig.overlay();
  if (clip.needsPiano) {
    await warmPiano(rig);
    await sleep(600);
  }
  // Framed first and the caret put down after, so the click lands on prose
  // the frame shows and nothing scrolls between the settling and the take.
  await clip.frame(rig);
  await settleCaret(rig);
  const at = await rest(rig);
  await rig.warp(at.x, at.y);
  await sleep(700);

  await noToast(rig, `${tag} would start`);
  const dir = path.join(FRAMES, tag);
  await rig.startRec(dir);
  await sleep(300);
  await clip.beats(rig, { look });
  let frames = await rig.stopRec();
  await noToast(rig, `${tag} ended`);
  // A clip that ends away from where it began puts the editor back off camera
  // and dissolves its last stretch into its first frame, so the loop closes
  // all the same (the tour, in clips.js). The text check below still holds it
  // to the document it opened on; its seam, taken after the dissolve, measures
  // 0, since its last frame is then its first. The seam check stays for any
  // clip that closes on its own first frame.
  if (clip.after) await clip.after(rig, { look, isPristine: async () => (await editorText(rig)) === pristine() });
  if (clip.dissolve) frames = dissolveHome(frames, clip.dissolve);
  // A take that changes the text ends on a different frame from the one it
  // began on, so its loop has a seam; and the next take would inherit it.
  if ((await editorText(rig)) !== pristine()) {
    throw new Error(`${tag} left the document edited: its last frame is not its first`);
  }
  const seconds = frames[frames.length - 1].t - frames[0].t;
  const gap = seam(frames);
  console.log(
    `  ${frames.length} frames, ${seconds.toFixed(1)} s, ${(frames.length / seconds).toFixed(0)} fps, ` +
      `seam ${(gap * 100).toFixed(3)}%` + (gap > SEAM_LIMIT ? "  <- DOES NOT LOOP" : "")
  );

  fs.mkdirSync(CLIPS_OUT, { recursive: true });
  const out = (suffix) => path.join(CLIPS_OUT, `${tag}${suffix}`);
  encodeMp4(dir, frames, out(".mp4"), { width: 1000, fps: 30, crf: 20 });
  encodeGif(dir, frames, out(".gif"), { width: 900, fps: clip.frameRate || 14 });
  encodePoster(frames, out("-poster.jpg"), { width: 1000 });
  const size = (suffix) => fs.statSync(out(suffix)).size;
  console.log(`  mp4 ${(size(".mp4") / 1024).toFixed(0)} KB   gif ${(size(".gif") / 1024).toFixed(0)} KB`);
  fs.writeFileSync(
    out(".json"),
    JSON.stringify(
      {
        id: clip.id,
        look,
        seconds: +seconds.toFixed(2),
        frames: frames.length,
        mp4: size(".mp4"),
        gif: size(".gif"),
        poster: size("-poster.jpg"),
        seam: +gap.toFixed(5),
      },
      null,
      1
    )
  );
  if (!keepFrames && gap <= SEAM_LIMIT) fs.rmSync(dir, { recursive: true, force: true });
  return gap <= SEAM_LIMIT ? null : `${tag}: last frame differs from the first in ${(gap * 100).toFixed(2)}% of its pixels`;
}

async function main() {
  const args = process.argv.slice(2);
  let looks = ["light"];
  let keepFrames = false;
  const ids = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--look") {
      const v = args[++i];
      looks = v === "both" ? ["light", "dark"] : [v];
    } else if (args[i] === "--keep-frames") keepFrames = true;
    else ids.push(args[i]);
  }
  for (const l of looks) if (!LOOKS[l]) throw new Error(`--look is light, dark or both, not ${l}`);
  const chosen = ids.length ? clips.filter((c) => ids.includes(c.id)) : clips;
  const unknown = ids.filter((id) => !clips.some((c) => c.id === id));
  if (unknown.length) throw new Error("no clip is called " + unknown.join(", "));

  const rig = await new Rig().connect();
  console.log("viewport", JSON.stringify(await rig.viewport()));
  const seams = [];
  for (const look of looks) {
    for (const clip of chosen) {
      const problem = await take(rig, clip, look, keepFrames);
      if (problem) seams.push(problem);
    }
  }
  await rig.close();
  // A seam does not stop the run (the takes after it are sound), but it fails
  // it, and the frames of the take are kept to look at.
  if (seams.length) {
    console.error("\nclips that do not loop (frames kept in " + FRAMES + "):\n  " + seams.join("\n  "));
    process.exitCode = 1;
  }
}

// A script and not a module: nothing requires it, and a require() of it
// starts a recording session.
main().catch((e) => {
  console.error("FAILED", e.stack);
  process.exit(1);
});
