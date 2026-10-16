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
const { clips, clearLayout, closeAll, openDoc, pinCaret, warmPiano, settleCaret, rest, picturesOf } = require("./clips.js");
const { SETTINGS, FRAMES, CLIPS_OUT, DEMO, HERE, WORKSPACE } = require("./paths.js");

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
    // No toast offering an extension for a kind of file a take opens, as
    // the Markdown clip opens its .bib: a take that ends under a
    // notification is refused (noToast, below).
    "extensions.ignoreRecommendations": true,
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
    // VS Code's own dialogs, drawn in the workbench, and not the system's.
    // On Linux the save prompt is a native window by default, which nothing
    // driving the workbench can see: a take that left a document edited
    // stood behind one that closeAll's check never found (2026-09-28).
    "window.dialogStyle": "custom",
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
    "mdm.textAlign": "justify",
    // The score mode's side panel, up with the mode as it ships (2026-10-14),
    // on the face of buttons. The score's take shows it (the owner's word of
    // 2026-10-15), and no take may inherit it hidden.
    "mdm.scorePanel": "shown",
    "mdm.scorePanelFace": "buttons",
    ...LOOKS[look],
    ...(extra || {}),
  };
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
}

// The document a clip is shot on: demo.mdm unless it names another beside it.
function docOf(clip) {
  return clip.doc ? path.join(HERE, clip.doc) : DEMO;
}

// What the editor holds for a clip's document: the file without its YAML
// header, which mdm.frontMatter "hidden" keeps out of the view, and without
// the blank line after it.
function pristine(clip) {
  return fs.readFileSync(docOf(clip), "utf8").replace(/^---\n[\s\S]*?\n---\n\n/, "");
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
  // The window in the look asked for, and not only its settings. A VS Code
  // started on a profile whose last take was the dark one writes the theme's
  // name back into the settings in the form it now gives it ("Dark Modern"
  // for "Default Dark Modern"), and did so over the light theme this had
  // just written: a take of 2026-10-05 was recorded as a light page in a
  // dark window, with nothing here the wiser. Read off the workbench, and
  // the settings written again until it agrees.
  for (let i = 0; ; i++) {
    const dark = await rig.page.evaluate(() => {
      const bench = document.querySelector(".monaco-workbench");
      return !!bench && (bench.classList.contains("vs-dark") || bench.classList.contains("hc-black"));
    });
    if (dark === /Dark/.test(LOOKS[look]["workbench.colorTheme"])) break;
    if (i >= 3) throw new Error(`the window is not in the ${look} look after the settings were written ${i + 1} times`);
    writeSettings(look, clip.settings);
    await sleep(1600);
  }
  await rig.overlay();
  await rig.clearToasts();
  await clearLayout(rig);
  await closeAll(rig);
  const doc = path.basename(docOf(clip));
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.copyFileSync(docOf(clip), path.join(WORKSPACE, doc));
  // What the document reads beside it, the Markdown clip's bibliography.
  for (const f of clip.files || []) fs.copyFileSync(path.join(HERE, f), path.join(WORKSPACE, f));
  // A picture a take pasted is written beside the copy, and one left there
  // from a take that stopped halfway would make the next paste image-2.png.
  fs.rmSync(picturesOf(doc), { recursive: true, force: true });
  await openDoc(rig, doc);
  await rig.webview();
  await rig.waitFor(() => !!document.querySelector("#app .mdm-toolbar"), { timeout: 15000 });
  if ((await editorText(rig)) !== pristine(clip)) throw new Error(`${doc} did not open as it is in the repository`);
  await pinCaret(rig);
  await rig.overlay();
  if (clip.needsPiano) {
    await warmPiano(rig);
    await sleep(600);
  }
  // Framed first and the caret put down after, so the click lands on prose
  // the frame shows and nothing scrolls between the settling and the take.
  await clip.frame(rig);
  await (clip.settle || settleCaret)(rig);
  // The workbench shown the pointer over its title bar, where nothing
  // answers one, before the pointer goes to wait over the document. A move
  // over the webview goes to the webview's frame and tells the workbench
  // nothing, so the workbench goes on believing the pointer is where it
  // last saw it: on the close button of the .bib's tab, once a Markdown take
  // had pressed it, and every take after that one showed VS Code's "Close
  // (Ctrl+W)" over the entry half a second after the .bib opened, with the
  // pointer a window away on the document (the takes of 2026-10-06; the
  // first of a session was clean, which is how the published one got by).
  const bar = await rig.page.evaluate(() => {
    const el = document.querySelector(".part.titlebar");
    const r = el && el.getBoundingClientRect();
    return r && r.width ? { x: Math.round(r.left + r.width * 0.62), y: Math.round(r.top + r.height / 2) } : null;
  });
  if (bar) {
    await rig.warp(bar.x, bar.y);
    await sleep(200);
  }
  // Where the pointer stands in the first frame: at the foot of the pane,
  // unless the clip has it wait somewhere nearer its first errand.
  const at = await (clip.rest || rest)(rig);
  await rig.warp(at.x, at.y);
  await sleep(700);

  await noToast(rig, `${tag} would start`);
  const dir = path.join(FRAMES, tag);
  await rig.startRec(dir);
  await sleep(300);
  await clip.beats(rig, { look });
  let frames = await rig.stopRec();
  const lag = rig.lag;
  // The camera held to having looked all the while. It is sent a frame when
  // the window changes, and pulsed 25 times a second besides (rig.js,
  // startRec), so the longest it goes without one is a few hundredths of a
  // second; half a second with none is a camera that missed whatever came
  // up in it, as it missed a tooltip for 1.155 s on 2026-10-06.
  let blind = 0;
  for (let i = 1; i < frames.length; i++) blind = Math.max(blind, frames[i].t - frames[i - 1].t);
  if (blind > 0.5) throw new Error(`${tag}: the camera went ${blind.toFixed(2)} s without a frame`);
  await noToast(rig, `${tag} ended`);
  // A clip that ends away from where it began puts the editor back off camera
  // and dissolves its last stretch into its first frame, so the loop closes
  // all the same (the tour, in clips.js). The text check below still holds it
  // to the document it opened on; its seam, taken after the dissolve, measures
  // 0, since its last frame is then its first. The seam check stays for any
  // clip that closes on its own first frame.
  if (clip.after) await clip.after(rig, { look, isPristine: async () => (await editorText(rig)) === pristine(clip) });
  if (clip.dissolve) frames = dissolveHome(frames, clip.dissolve);
  // A take that changes the text ends on a different frame from the one it
  // began on, so its loop has a seam; and the next take would inherit it.
  if ((await editorText(rig)) !== pristine(clip)) {
    throw new Error(`${tag} left the document edited: its last frame is not its first`);
  }
  const seconds = frames[frames.length - 1].t - frames[0].t;
  const gap = seam(frames);
  console.log(
    `  ${frames.length} frames, ${seconds.toFixed(1)} s, ${(frames.length / seconds).toFixed(0)} fps, ` +
      `seam ${(gap * 100).toFixed(3)}%` + (gap > SEAM_LIMIT ? "  <- DOES NOT LOOP" : "") +
      `, camera at most ${lag.toFixed(2)} s behind`
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
