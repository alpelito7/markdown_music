const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const os = require("os");
const cp = require("child_process");
const {
  toEditor,
  fromEditor,
  frontMatter,
  hiddenLines,
  toLf,
  withLang,
  langOf,
  splitFrontMatter,
} = require("./transforms");
const { syntaxPalette, listThemes } = require("./theme");

// The log of every export, kept out of the notifications: a toast truncates,
// does not scroll and cannot be copied, and what an export has to say when it
// fails is a page of Quarto's own output. Created on the first call rather
// than at load, so requiring this module runs nothing.
let output = null;
function channel() {
  if (!output) output = vscode.window.createOutputChannel("MDM");
  return output;
}

// A link followed from the editor (Ctrl+click on it, G083). An address with
// a scheme, or a `www.` one, goes out through the desktop, to the browser or
// the mail client, as VS Code's own Markdown editor sends it; a `file:` one
// and a path beside the document open in VS Code, with whatever editor their
// kind has (an .mdm in this one, a picture in the image preview). A fragment
// on a file path is dropped: nothing here can scroll another editor to a
// heading, and a fragment alone never gets this far, since the editor
// answers it by moving its own caret. The href is the document's own text,
// so there is nothing to open that the author did not write.
function openLink(document, href) {
  if (typeof href !== "string") return;
  const target = href.trim();
  if (!target) return;
  if (/^file:/i.test(target)) {
    return vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(target));
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
    return vscode.env.openExternal(vscode.Uri.parse(target));
  }
  if (/^www\./i.test(target)) {
    return vscode.env.openExternal(vscode.Uri.parse("https://" + target));
  }
  let file = target.replace(/[#?].*$/, "");
  try {
    file = decodeURI(file);
  } catch (e) {
    // Left as written: a path with a stray percent sign is still a path.
  }
  if (!file) return;
  const at = path.resolve(path.dirname(document.uri.fsPath), file);
  return vscode.commands.executeCommand("vscode.open", vscode.Uri.file(at));
}

function activate(context) {
  globalState = context.globalState;
  context.subscriptions.push(channel());
  // The pictures a document was given, taken back when it is saved without
  // them and put back when an undo brings them into the text again
  // (sweepPictures, restorePictures). Here and not in an editor, so that a
  // save from the text editor beside it, or after the MDM editor is closed,
  // counts the same.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => pictureTurn(() => sweepPictures(document))),
    vscode.workspace.onDidChangeTextDocument((e) => restorePictures(e.document))
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "mdm.editor",
      new MdmEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );
  // TEMPORARY, with the section it names: a document VS Code opened in the
  // text editor because it was started on it goes to the MDM editor.
  watchTextTabs(context);
}

// Every setting the webview reads or writes, with its allowed values; the
// first one is the fallback. The allowlist earns its keep twice: these values
// are interpolated into the webview HTML, and a workspace settings.json can
// carry any string at all.
//
// This table is also the editor's memory: every toolbar button that holds a
// state writes it here rather than painting itself, which is what makes a
// document reopen looking as it was left, and what keeps two editors open on
// two files in step. Word division is the one exception, kept for each
// document of its own ("Word division is the document's own", below).
const SETTINGS = {
  theme: ["auto", "light", "dark", "white"],
  scoreFill: ["none", "paper", "slate", "brass"],
  staffLines: ["gray", "ink"],
  scoreAlign: ["center", "left"],
  frontMatter: ["hidden", "shown"],
  outline: ["hidden", "shown"],
  multicursorMatch: ["word", "substring"],
  followPlayhead: ["follow", "still"],
  textFont: ["roman", "sans"],
  // Justified first: the prose is set to both edges until the toggle asks
  // for a ragged right.
  textAlign: ["justify", "left"],
  // Off first, and so the fallback as well as the default: words stay whole
  // until a language is chosen from the hyphenation menu.
  hyphenation: ["none", "auto"],
};

// The languages the hyphenation menu offers, which are the ones
// media/hyphenation-patterns.js carries patterns for; the tests hold the menu,
// this list and the patterns together. The tag a setLanguage message names is
// written into the document, so a tag outside this list never is.
const LANGUAGES = ["de", "en", "es", "fr", "it", "nl", "pl", "pt", "ru", "uk"];

// The three values of mdm.theme that are looks of this editor rather than
// names of VS Code themes. They carry their own palettes, so nothing of VS
// Code's colours travels while one of them is on. The webview keeps the same
// list (OWN_LOOKS in media/main.js).
const OWN_LOOKS = ["light", "dark", "white"];

// A setting whose value is a number and not one of a handful of words. The
// allowlist above does two jobs at once, and here a clamp does both: a
// settings.json carries whatever it carries, and these values are written into
// the webview HTML. The band is the webview's own (OUTLINE_MIN and
// OUTLINE_MAX in media/main.js), so a width that comes back from here is one
// the panel would have let the grip reach.
const NUMBER_SETTINGS = {
  outlineWidth: { min: 140, max: 1200, fallback: 250 },
};

function numberSetting(key, value) {
  const spec = NUMBER_SETTINGS[key];
  if (!spec) return undefined;
  if (typeof value !== "number" || !isFinite(value)) return spec.fallback;
  return Math.min(spec.max, Math.max(spec.min, Math.round(value)));
}

// mdm.theme takes the name of a VS Code colour theme as well as its three
// fixed values, and those names cannot be listed in advance. The allowlist
// grows with the themes actually installed, which keeps its whole point: a
// value that no extension contributes never reaches the webview HTML.
function themes() {
  try {
    return listThemes(vscode.extensions.all);
  } catch (e) {
    return [];
  }
}

function allowedValues(key, installed) {
  const allowed = SETTINGS[key];
  if (key !== "theme") return allowed;
  return allowed.concat((installed || themes()).map((t) => t.name));
}

function readSettings(installed) {
  const config = vscode.workspace.getConfiguration("mdm");
  const out = {};
  Object.keys(SETTINGS).forEach((key) => {
    const allowed = allowedValues(key, installed);
    const value = config.get(key);
    out[key] = allowed.indexOf(value) !== -1 ? value : allowed[0];
  });
  Object.keys(NUMBER_SETTINGS).forEach((key) => {
    out[key] = numberSetting(key, config.get(key));
  });
  // VS Code's own choice of the click that adds a caret (Alt or Ctrl/Cmd),
  // so the gesture is the same here as in the text editors beside this one.
  // Not an mdm setting: read-only here, never written by writeSetting.
  const modifier = vscode.workspace
    .getConfiguration("editor")
    .get("multiCursorModifier");
  out.multiCursorModifier = modifier === "ctrlCmd" ? "ctrlCmd" : "alt";
  return out;
}

// ---------- Word division is the document's own ----------
//
// Every other button of the bar is the editor's: one value in settings.json
// for all the documents at once, which is what keeps two editors open on two
// files in step. Word division is not, because the language a document is
// written in belongs to the document, and a reader keeps documents in
// several languages at once (the owner, 2026-09-11). So mdm.hyphenation is
// where a document starts, and what a document was left on is kept here: in
// the extension's globalState, which VS Code keeps across restarts and apart
// from any workspace, under DOCUMENT_HYPHENATION, one entry per document URI.
//
// Nothing about it goes into the file, since turning division on is not an
// edit; the language itself does, as `lang:` in the YAML header, which is
// the document's own business either way (writeLanguage below).
//
// The URI is the document here, so a file renamed or moved starts over on
// the setting. The object keeps its keys in the order the documents were
// last used, opened or pressed in, and holds the DOCUMENTS_KEPT most recent:
// an entry under an 80-character path is 89 bytes of JSON, so the 500 come
// to about 46 KB.
const DOCUMENT_HYPHENATION = "documentHyphenation";
const DOCUMENTS_KEPT = 500;

// context.globalState, handed over on activation.
let globalState = null;

// The divisions kept, by document URI. Anything but an object is read as
// nothing kept: it can only be what a hand or an older version left.
function keptDivisions() {
  const all = globalState ? globalState.get(DOCUMENT_HYPHENATION) : undefined;
  return all && typeof all === "object" && !Array.isArray(all) ? all : {};
}

// What this document was left on, or undefined. Read as an own key, since
// what comes back is JSON off the disk and is data and not a prototype.
function ownDivision(document) {
  const all = keptDivisions();
  const uri = document.uri.toString();
  return Object.prototype.hasOwnProperty.call(all, uri) ? all[uri] : undefined;
}

// The division kept for this document, with the document moved to the end as
// the one used last; the documents at the front are forgotten once there are
// more than DOCUMENTS_KEPT.
function keepDivision(document, value) {
  const uri = document.uri.toString();
  const all = Object.assign({}, keptDivisions());
  delete all[uri];
  all[uri] = value;
  const uris = Object.keys(all);
  uris.slice(0, Math.max(0, uris.length - DOCUMENTS_KEPT)).forEach((u) => {
    delete all[u];
  });
  return globalState.update(DOCUMENT_HYPHENATION, all);
}

// The settings in force for one document: the editor's own (readSettings),
// with the division this document was left on over the setting. A kept value
// meets the same allowlist as one out of settings.json, since it is written
// into the webview HTML just the same.
function documentSettings(document, installed) {
  const out = readSettings(installed);
  const own = ownDivision(document);
  if (SETTINGS.hyphenation.indexOf(own) !== -1) out.hyphenation = own;
  return out;
}

// The syntax colours the webview paints the YAML header and the code blocks
// with (theme.js): those of the theme chosen in mdm.theme, or of the VS Code
// theme in use while that setting names no theme of its own. `palette` is
// null when the theme cannot be read, and the webview then uses the palettes
// of its own; `side` is the light or dark of a chosen theme, which the editor
// follows even then.
function readPalette(installed) {
  try {
    const list = installed || themes();
    const chosen = readSettings(list).theme;
    const named = list.find((t) => t.name === chosen);
    const name = named
      ? chosen
      : vscode.workspace.getConfiguration("workbench").get("colorTheme");
    return {
      palette: syntaxPalette({
        name: name,
        extensions: vscode.extensions.all,
        customizations: vscode.workspace
          .getConfiguration("editor")
          .get("tokenColorCustomizations"),
      }),
      side: named ? named.kind : null,
    };
  } catch (e) {
    return { palette: null, side: null }; // not worth an error message
  }
}

// JSON on its way into a <script> block: the theme names come from installed
// extensions, so `</script>` in one of them would close the block early.
function inlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// The toolbar buttons in the webview change settings through here instead of
// repainting themselves, so a choice is persisted and reaches every open
// editor via onDidChangeConfiguration. The value is written where it already
// lives: a workspace that pinned the setting keeps overriding user settings,
// so writing globally there would look like the button did nothing.
//
// Word division is the exception: it is kept for the document the button was
// pressed in (keepDivision above) and nothing is written to settings.json, so
// no other document is touched. What comes back says which of the two
// happened, and that is what tells the caller whether this editor has to be
// told by hand: a write to settings.json reaches every editor by itself.
async function writeSetting(document, key, value) {
  let stored;
  if (SETTINGS[key]) {
    if (allowedValues(key).indexOf(value) === -1) return false;
    stored = value;
  } else if (NUMBER_SETTINGS[key]) {
    if (typeof value !== "number" || !isFinite(value)) return false;
    stored = numberSetting(key, value);
  } else {
    return false;
  }
  if (key === "hyphenation") {
    await keepDivision(document, stored);
    return true;
  }
  const config = vscode.workspace.getConfiguration("mdm");
  const inspected = config.inspect(key);
  const target =
    inspected && inspected.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await config.update(key, stored, target);
  return false;
}

// ---------- Export ----------

// What each export entry leaves on disk, and what a render of its format asks
// Quarto for. A PDF is asked of Quarto only when LaTeX typesets it: printed,
// it is the page's render and a browser ("The two roads to a PDF", below).
//
// The two formats are named on the command line rather than left to the
// document. Quarto renders the formats the header declares, and a header that
// declares none, or none at all, is HTML and nothing else: the button said
// HTML + PDF and one file came out. Naming them takes nothing away from a
// document that does declare both, since `--to` picks the formats and the
// options written under each one still apply.
//
// Both is the page and then the PDF, and never one render of two formats.
// Printed, the PDF is that page on paper: rendered once and printed, unless
// the print needs a page of its own, which a document set in the roman does
// (PRINT_FACES below) and so does one whose header asks the PDF for what it
// does not ask the page (pdfAsks). Typeset, it is a render of its own after
// the page's: Quarto 1.9.37
// gives up a render of several formats at the first one that fails and leaves
// the page it had begun as it stood, before its resources are put in: with no
// TeX, `--to html,pdf` left a page of 49,682 bytes with no KaTeX and no look
// in it, where `--to html` alone wrote 1,876,897 of the finished page from
// the same copy; and with TeX and a LaTeX error it left 17,103 bytes against
// 1,843,445 (both measured 2026-09-14). That page was printed into the PDF
// with no TeX, and kept as the HTML either way. Rendered in a step of its
// own, the page is finished before the PDF is tried, whatever becomes of the
// PDF. The cost is a second start of Quarto: 7.75 and 7.80 s against 7.42 and
// 7.35 for example.mdm with TeX and a warm cache. The PDF's render takes
// nothing of the page's with it, measured with the resources left beside the
// page rather than embedded.
const EXPORT_TARGETS = {
  html: { args: ["--to", "html"], outputs: [".html"] },
  pdf: { args: ["--to", "pdf"], outputs: [".pdf"] },
  both: { outputs: [".html", ".pdf"] },
};

// A target the webview named, or null. The lookup goes through
// hasOwnProperty because `to` is a wire value: `{type:"export",
// to:"constructor"}` picked Object off the prototype and the export went on
// with a function in place of its target, reaching `.outputs.indexOf` on
// undefined and ending in "MDM: export failed (...)" instead of being dropped
// the way every other name nobody offers is.
function exportTarget(to) {
  if (typeof to !== "string") return null;
  return Object.prototype.hasOwnProperty.call(EXPORT_TARGETS, to)
    ? EXPORT_TARGETS[to]
    : null;
}

// The two shapes a score's audio comes out in, and what a file of each may
// weigh. Built on a null prototype, and read with hasOwnProperty as well, for
// the reason above: `format` comes from the webview, and a literal would
// answer "toString" and "__proto__" with something truthy that has no `ext` on
// it. The caps are a guard and not a limit anybody should reach: the MIDI of a
// long tune is a few kilobytes, and a WAV is 172 kB a second of it, so an hour
// of music is about 600 MB.
const AUDIO_FORMATS = Object.create(null);
AUDIO_FORMATS.midi = { ext: ".mid", label: "MIDI", max: 16 * 1024 * 1024 };
AUDIO_FORMATS.wav = { ext: ".wav", label: "WAV", max: 1024 * 1024 * 1024 };

function audioFormat(format) {
  if (typeof format !== "string") return null;
  return Object.prototype.hasOwnProperty.call(AUDIO_FORMATS, format)
    ? AUDIO_FORMATS[format]
    : null;
}

// ---------- The look the export is dressed in ----------
//
// What comes out reads as the editor does, on the page and on paper alike (the
// ground, the ink, the code cards and their colours, the scores, the player
// bar in the HTML and the heading sizes in the PDF), and what the editor is
// showing right now travels to the renderer as metadata the Lua filter reads:
// see the look section of _extensions/mdm/mdm.lua, which holds the other end
// of this in look_css for the page, and so for the PDF printed from it, and
// look_tex for a PDF typeset with LaTeX. A render with none of it, `bin/mdm render` from a
// terminal, comes out in the editor's default look with the palette it falls
// back to.

// The ten slots the editor paints code with (theme.js).
const SYNTAX_SLOTS = [
  "base",
  "bg",
  "comment",
  "string",
  "number",
  "keyword",
  "attr",
  "name",
  "type",
  "variable",
];

// vscode.ColorThemeKind: Light, Dark, HighContrast (dark), HighContrastLight.
// A high contrast theme counts as the side it sits on, which is what the
// webview compares against as well.
const LIGHT_THEME_KINDS = [1, 4];

// Which side the editor is on, worked out here the way the webview works it
// out (isDark in main.js), the host being the one that knows what VS Code is
// showing: the three fixed values of mdm.theme say it themselves, a named
// colour theme brings its own, and "auto" follows the workbench.
function exportSide(settings, installed) {
  const chosen = settings.theme;
  if (chosen === "light" || chosen === "dark" || chosen === "white") {
    return chosen;
  }
  const named = (installed || []).find((t) => t.name === chosen);
  if (named) return named.kind;
  const active = vscode.window.activeColorTheme;
  const kind = active && active.kind;
  return LIGHT_THEME_KINDS.indexOf(kind) !== -1 ? "light" : "dark";
}

// A colour on its way into a `-M` value: six hex digits and no `#`, which
// would open a YAML comment and take the rest of the argument with it. A
// three-digit colour, which theme.js also lets through, is spelt out; the
// four and eight digit forms carry an alpha the page has no use for.
function metaColor(value) {
  const full = /^#([0-9a-fA-F]{6})$/.exec(value || "");
  if (full) return full[1].toLowerCase();
  const short = /^#([0-9a-fA-F]{3})$/.exec(value || "");
  if (!short) return null;
  return short[1]
    .toLowerCase()
    .replace(/./g, (digit) => digit + digit);
}

// Word division as the editor draws it, which is while its button is lit:
// division on, and the header naming a language the extension has patterns
// for. The setting alone would say more than the editor shows. A header that
// names no language keeps its words whole on screen, yet Quarto hands the
// filter `lang: en` for it (measured on 1.9.37), so the page and the paper
// would divide it as English; and a language without patterns here, Catalan
// say, would go to TeX with division on and be divided in a typeset PDF
// alone.
function exportHyphenation(setting, text) {
  const lang = langOf(text).split("-")[0];
  return setting === "auto" && LANGUAGES.indexOf(lang) !== -1 ? "auto" : "none";
}

// The metadata arguments for one render. The palette goes only while it is on
// the same side as the editor, again as the webview does (applyPalette):
// mdm.theme can hold this editor to light with VS Code on a dark theme, and
// dark syntax colours on a light ground are unreadable. `document` is the one
// being exported, for the word division it keeps of its own
// (documentSettings), and `text` its file, for the language its header names.
function exportLook(document, text) {
  try {
    const installed = themes();
    const settings = documentSettings(document, installed);
    const side = exportSide(settings, installed);
    const args = [
      "-M",
      "mdm-look:" + side,
      "-M",
      "mdm-staff-lines:" + settings.staffLines,
      "-M",
      "mdm-score-fill:" + settings.scoreFill,
      "-M",
      "mdm-score-align:" + settings.scoreAlign,
      // The face the editor is showing the words in. Named on every render,
      // the roman included, because the filter's own fallback is the sans:
      // `bin/mdm render` passes no look at all and keeps the page it always
      // had, while a document exported from this toolbar comes out set in
      // whatever it was being read in.
      "-M",
      "mdm-text-font:" + settings.textFont,
      // And how its lines meet the right edge, named on every render for the
      // same reason: the filter falls back to the ragged right a page has
      // always had, and the editor justifies by default.
      "-M",
      "mdm-text-align:" + settings.textAlign,
      // Word division as the editor draws it, not the setting alone
      // (exportHyphenation above).
      "-M",
      "mdm-hyphenation:" + exportHyphenation(settings.hyphenation, text),
      // Not a colour, but the same kind of thing: what the editor is showing.
      // The title block Quarto draws from the YAML belongs to the header, so
      // an export from an editor that is hiding the header renders a document
      // that does not open with it either (the TITLE_BLOCK of mdm.lua).
      "-M",
      "mdm-front-matter:" + settings.frontMatter,
    ];
    const palette = readPalette(installed).palette;
    // MDM Light, MDM Dark and MDM White are the editor's own looks and take no
    // colours from VS Code: the webview refuses the palette outright while one
    // of them is chosen (applyPalette and OWN_LOOKS in media/main.js), and
    // paints with the fallbacks its stylesheet carries. Without the same
    // refusal here the export was dressed in the colours of whatever theme VS
    // Code happened to be wearing while the editor was showing its own, which
    // is the ground, the code card and the ten syntax colours all differing
    // between the screen and the page.
    const own = OWN_LOOKS.indexOf(settings.theme) !== -1;
    const usable =
      !own &&
      palette &&
      palette.colors &&
      palette.kind === (side === "dark" ? "dark" : "light");
    if (usable) {
      SYNTAX_SLOTS.forEach((slot) => {
        const color = metaColor(palette.colors[slot]);
        if (color) args.push("-M", "mdm-syn-" + slot + ":" + color);
      });
    }
    return args;
  } catch (e) {
    return []; // an export never fails over the look it would have had
  }
}

// ---------- What an export needs, and what to say when it is missing ----------

// An executable on the PATH, or null. Looked up rather than spawned to see
// whether it answers: what the message has to name is WHICH tool is missing,
// and a spawn that fails with ENOENT says only that something did.
function onPath(name) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names =
    process.platform === "win32"
      ? [name + ".exe", name + ".cmd", name + ".bat", name]
      : [name];
  for (const dir of dirs) {
    for (const n of names) {
      const full = path.join(dir, n);
      if (isFile(full)) return full;
    }
  }
  return null;
}

function isFile(full) {
  try {
    return fs.statSync(full).isFile();
  } catch (e) {
    return false; // absent, or unreadable, which is no match either
  }
}

// Where Quarto's own installers put it on the system in hand, looked in after
// the PATH, because the PATH an editor runs with is the one it started with.
// VS Code reads the shell's environment once and keeps it for as long as it
// runs (getResolvedShellEnv, src/vs/platform/shell/node/shellEnv.ts), and on
// Windows it keeps the environment it was launched in, so neither a Reload
// Window nor a new window sees a program installed in the meantime. The
// macOS installer does link quarto into /usr/local/bin, which is on most
// PATHs already, but with an `ln -fs` that fails where that folder does not
// exist, and then only /etc/paths.d or ~/.zshrc bring Quarto in, for the
// next shell to read (package/scripts/macos/pkg/postinstall in
// quarto-dev/quarto-cli). Without this a reader who does what the notice
// says, installs Quarto and exports again, can be told once more that Quarto
// is not installed. The folders are the ones Quarto's own VS Code extension scans
// (packages/quarto-core/src/context.ts in quarto-dev/quarto), less the copies
// bundled inside RStudio: the notice sends its reader to Quarto's installer,
// and these are the folders that installer writes.
function quartoInstalls(platform, env) {
  if (platform === "darwin") {
    const out = ["/Applications/quarto/bin/quarto"];
    if (env.HOME) {
      out.push(path.posix.join(env.HOME, "Applications", "quarto", "bin", "quarto"));
    }
    return out;
  }
  if (platform === "win32") {
    const programs = env.ProgramFiles || "C:\\Program Files";
    const out = [path.win32.join(programs, "Quarto", "bin", "quarto.exe")];
    if (env.LOCALAPPDATA) {
      out.push(path.win32.join(env.LOCALAPPDATA, "Programs", "Quarto", "bin", "quarto.exe"));
    }
    return out;
  }
  if (platform === "linux") return ["/opt/quarto/bin/quarto"];
  return [];
}

// Quarto, on the PATH or where its installer left it, or null.
function findQuarto() {
  return (
    onPath("quarto") ||
    quartoInstalls(process.platform, process.env).find(isFile) ||
    null
  );
}

// The Lua filter that turns .abc fences into scores, shipped inside this
// extension. The same directory is _extensions/mdm in the repository and a
// test pins the two byte for byte, so this copy is the one that runs whether
// the extension was installed from a .vsix or symlinked from a clone.
const FILTER = path.join(__dirname, "render", "mdm", "mdm.lua");

// The part of the filter that reads what Quarto wrote, which has to run
// after Quarto's own filters where mdm.lua runs before them (mdm-after.lua
// says what it corrects). The extension in a repository hands it in from its
// _extension.yml; the copy names its filter by path, so it is named here.
const FILTER_AFTER = path.join(__dirname, "render", "mdm", "mdm-after.lua");

// What engraves the scores of a PDF that LaTeX typesets, and what the filter
// needs around it (render_latex in mdm.lua). A printed PDF asks for none of
// this: its scores are the ones the page draws, printed with the rest of it.
// The filter's first choice is a Chrome, into which it
// loads the editor's own abcjs and prints, and the print is trimmed to the
// ink with pdfcrop; failing that it is abcm2ps, a separate LGPL-3.0-or-later
// program credited in THIRD-PARTY-NOTICES.md, whose EPS goes through
// epstopdf. Both roads measure the drawing with Ghostscript, which pdfcrop
// and epstopdf run as well. None of it is shipped: Chrome and abcm2ps are
// programs of their own, and pdfcrop, epstopdf and Ghostscript come with a
// complete TeX (MacTeX installs all three, tug.org/mactex). These searches
// mirror the filter's (find_chrome, find_abcm2ps, command_exists) as far as
// they can from here: the filter alone resolves a `mdm.chrome` or a
// `mdm.abcm2ps` named in the YAML header, which is why a document that names
// a chrome of its own is waved through below rather than refused for a
// Chrome this search cannot see. Run before Quarto so a machine that cannot
// draw the scores is told out loud. A road with a piece missing is no road:
// with Chrome and no pdfcrop the filter falls back to abcm2ps, and with
// neither road whole it only warns and the PDF comes out with its scores
// left as text, which is worse than not exporting. The check used to ask for
// a Chrome or an abcm2ps and nothing else, which a machine with Chrome and a
// TeX without pdfcrop passes on its way to exactly that (read off the filter,
// not seen happen; TinyTeX's package lists hold no pdfcrop).
// Where Chrome's own installers put it. Chrome does not normally add itself
// to PATH on Windows, so looking only for the command there reports a normal
// per-user installation as missing. macOS likewise keeps the application out
// of PATH; include both its system-wide and per-user Applications folders.
function chromeInstalls(platform, env) {
  // Microsoft Edge after Chrome, everywhere: it is Chromium, it prints a page
  // with the same flags, and every Windows 10 and 11 has it, where a machine
  // with no Chrome and no TeX made no PDF at all (2026-09-28, when LaTeX was
  // still asked first).
  if (platform === "darwin") {
    const out = [];
    [
      ["Google Chrome.app", "Google Chrome"],
      ["Microsoft Edge.app", "Microsoft Edge"],
    ].forEach(function (app) {
      out.push(path.posix.join("/Applications", app[0], "Contents", "MacOS", app[1]));
      if (env.HOME) {
        out.push(path.posix.join(env.HOME, "Applications", app[0], "Contents", "MacOS", app[1]));
      }
    });
    return out;
  }
  if (platform === "win32") {
    const roots = Array.from(
      new Set(
        [env.LOCALAPPDATA, env.ProgramFiles || "C:\\Program Files", env["ProgramFiles(x86)"]].filter(Boolean)
      )
    );
    const under = function (parts) {
      return roots.map(function (root) {
        return path.win32.join.apply(path.win32, [root].concat(parts));
      });
    };
    return under(["Google", "Chrome", "Application", "chrome.exe"]).concat(
      under(["Microsoft", "Edge", "Application", "msedge.exe"])
    );
  }
  return [];
}

function findChrome() {
  const names = [
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome",
    "microsoft-edge", "microsoft-edge-stable",
  ];
  for (const name of names) {
    const hit = onPath(name);
    if (hit) return hit;
  }
  return chromeInstalls(process.platform, process.env).find(isFile) || null;
}

function findAbcm2ps(dir) {
  const local = path.join(dir, "tools", "bin", "abcm2ps");
  try {
    if (fs.existsSync(local)) return local;
  } catch (e) {
    // unreadable: the PATH is the other half of the search
  }
  return onPath("abcm2ps");
}

// What a typeset PDF with scores still lacks, or null when one of the filter's
// two roads is whole: `chrome` when there is no Chrome, and in `tex` the
// helpers of a complete TeX that are missing, by the names they go by on the
// PATH. What is asked for is always Chrome's road, the one that draws the
// scores the editor draws; abcm2ps is offered in the log and nowhere else.
function scoresLack(dir) {
  const gs = onPath("gs");
  const chrome = findChrome();
  const pdfcrop = onPath("pdfcrop");
  if (gs && chrome && pdfcrop) return null;
  if (gs && findAbcm2ps(dir) && onPath("epstopdf")) return null;
  return {
    chrome: !chrome,
    tex: [pdfcrop ? null : "pdfcrop", gs ? null : "gs"].filter(Boolean),
  };
}

// Whether the document holds a score at all, in either of the two forms that
// give Pandoc the class: ```abc and ```{.abc}. One that holds none never
// engraves, so LaTeX typesets it with none of the tools the scores need.
function hasScores(text) {
  return /^[ \t]*(?:`{3,}|~{3,})[ \t]*(?:\{[^}\n]*\.abc\b|abc\b)/m.test(text);
}

// Whether the YAML header names a chrome of its own (mdm.chrome). The
// filter resolves it, so the export is let through to it.
function namesChrome(text) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return !!header && /^[ \t]+chrome[ \t]*:/m.test(header[1]);
}

// One way out for every export that fails: the whole story to the channel,
// one line to the notification, and a button to get from the one to the
// other. A toast truncates, does not scroll
// and cannot be copied, and Quarto's answer when something is wrong is a page
// of it.
// `files` (label to path) is for what the same run did land, as in
// exportNeeds below: a "both" whose PDF failed has still written its page.
function exportFailed(summary, detail, files) {
  channel().appendLine(detail);
  const opens = Object.keys(files || {});
  vscode.window
    .showErrorMessage("MDM: " + summary, ...opens, "Show log")
    .then(function (choice) {
      if (choice === "Show log") channel().show(true);
      else if (opens.indexOf(choice) !== -1) {
        vscode.env.openExternal(vscode.Uri.file(files[choice]));
      }
    });
}

// And one for every export that cannot start until something is installed or
// moved out of its way: a warning rather than an error, since nothing has
// failed, and beside "Show log" a button to the page that fixes it, one per
// entry of `pages` (label to address). The reader is a musician and not a
// programmer. The notice this replaces named the missing program and kept
// where to get it in the log, on the line after a PATH of 33 folders in the
// report that came from a Mac on 2026-09-12.
// `files` (label to path) is for what the same run did land: an export of
// "both" whose PDF wants a program that is not there still wrote its page,
// and a notice that only names what is missing leaves the reader looking for
// it. Those buttons come first, since they are the only ones that do
// something now.
function exportNeeds(summary, detail, pages, files) {
  channel().appendLine(detail);
  const opens = Object.keys(files || {});
  const labels = opens.concat(Object.keys(pages));
  vscode.window
    .showWarningMessage("MDM: " + summary, ...labels, "Show log")
    .then(function (choice) {
      if (choice === "Show log") channel().show(true);
      else if (opens.indexOf(choice) !== -1) {
        vscode.env.openExternal(vscode.Uri.file(files[choice]));
      } else if (labels.indexOf(choice) !== -1) {
        vscode.env.openExternal(vscode.Uri.parse(pages[choice]));
      }
    });
}

// ---------- What a render's log has to tell the reader ----------

// Quarto colours its log (six escapes in one failed render, 2026-09-29), and
// what is read out of it is the words.
function plainLog(log) {
  return String(log || "").replace(/\x1b\[[0-9;]*m/g, "");
}

// "a", "a and b", "a, b and c", "a, b, c and 2 more".
function namesOf(list) {
  const shown = list.slice(0, 3);
  const more = list.length - shown.length;
  if (more > 0) return shown.join(", ") + " and " + more + " more";
  if (shown.length < 2) return shown.join("");
  return shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1];
}

// The citations a render went through without. A key citeproc did not find
// prints as "(nokey2020?)" in bold and a cross-reference Quarto could not
// resolve as "?@fig-x"; neither stops the render, and the notice said
// "exported" over both, so the reader found them by reading the page
// (2026-09-29). A word written with an @ in front of it is one of them in a
// document with a bibliography: `@alpelito7` is a citation of a key that is
// not there. Null when there is nothing to say; otherwise the words for the
// notice and, at more length, for the log.
function citationWarnings(log) {
  const text = plainLog(log);
  const keys = [];
  const refs = [];
  const collect = function (re, list) {
    let m;
    while ((m = re.exec(text))) {
      if (list.indexOf(m[1]) === -1) list.push(m[1]);
    }
  };
  collect(/\[WARNING\] Citeproc: citation (\S+) not found/g, keys);
  collect(/Unable to resolve crossref @(\S+)/g, refs);
  if (!keys.length && !refs.length) return null;
  const at = function (key) {
    return "@" + key;
  };
  const said = [];
  const told = [];
  if (keys.length) {
    said.push(
      namesOf(keys.map(at)) +
        (keys.length === 1 ? " is" : " are") +
        " not in the bibliography and came out as “(" + keys[0] + "?)”"
    );
    told.push(
      "Not in the bibliography: " + keys.map(at).join(", ") + ". A key is written as the " +
        "bibliography spells it. An @ that is not meant as a citation (a name, an " +
        "address) keeps it as text with a backslash in front: \\@" + keys[0] + "."
    );
  }
  if (refs.length) {
    said.push(
      namesOf(refs.map(at)) +
        (refs.length === 1 ? " points" : " point") +
        " at nothing in the document and came out as “?@" + refs[0] + "”"
    );
    told.push(
      "Cross-references that point at nothing: " + refs.map(at).join(", ") + ". A " +
        "cross-reference names the label a figure, a table or an equation of the " +
        "document carries, such as {#fig-name}."
    );
  }
  return { summary: said.join(", and "), detail: told.join("\n") };
}

// What stopped a render, when it is something in the reader's own document
// that the notice can name: a bibliography or a style the header names and
// the folder has not got, a bibliography Pandoc could not read, a header that
// is not YAML. The notice was "the export of doc.mdm failed" for all of them,
// over a log that said "File missing.bib not found in resource path" about a
// line of a header the editor keeps hidden (measured 2026-09-29). Pandoc
// places a fault in a .bib where it gave up reading, which is past it: an
// unclosed brace on line 3 was reported at line 7, the start of the next
// entry, and a comma missing on line 7 at line 8. Null for anything else,
// which keeps the plain notice and the log.
function exportTrouble(log, pretty, dir, text) {
  const words = plainLog(log);
  const shows = "The toolbar's Show YAML header button shows the header.";
  let m = /File (.+?) not found in resource path/.exec(words);
  if (m) {
    const what = /\.csl$/i.test(m[1]) ? "citation style" : "bibliography";
    return {
      summary:
        "the export of " + pretty + " failed: the " + what + " " + m[1] + " is not in its folder.",
      detail:
        "The header of " + pretty + " names " + m[1] + ", and there is no such file in " + dir +
        ". Put the file there, or correct the name in the header. " + shows,
    };
  }
  m = /Error reading bibliography file (.+?):\s*\(line (\d+), column (\d+)\):\s*([^\n]*)/.exec(words);
  if (m) {
    return {
      summary:
        "the export of " + pretty + " failed: " + m[1] + " could not be read, near its line " +
        m[2] + ".",
      detail:
        "Pandoc stopped reading " + m[1] + " at line " + m[2] + ", column " + m[3] + " (" + m[4] +
        "). The fault is usually in the entry above that line: a brace left open, or the " +
        "comma missing after an entry's key.",
    };
  }
  m = /YAMLException: ([^\n]*?) \((\d+):(\d+)\)/.exec(words);
  if (m) {
    const line = String(text || "").split(/\r?\n/)[Number(m[2]) - 1] || "";
    const quote = /:[ \t]*@/.test(line)
      ? " A value that starts with @, a key under nocite: for one, is written in " +
        "quotes: nocite: \"@key\"."
      : "";
    return {
      summary:
        "the export of " + pretty + " failed: its header could not be read, at line " + m[2] + ".",
      detail:
        "The YAML header of " + pretty + " could not be read at line " + m[2] + ", column " +
        m[3] + ": " + m[1] + "." + quote + " " + shows,
    };
  }
  return null;
}

// The pages a notice sends its reader to, each seen to answer on 2026-09-12.
const QUARTO_PAGE = "https://quarto.org/docs/get-started/";
const CHROME_PAGE = "https://www.google.com/chrome/";

// For TeX, the distribution that brings everything a typeset PDF of this
// filter leans on, for the system in hand. On a Mac that is MacTeX, which installs
// Ghostscript beside TeX Live (tug.org/mactex). TinyTeX, the TeX Quarto
// itself suggests, is not the one offered: neither of its package lists
// (tools/pkgs-custom.txt and tools/pkgs-yihui.txt in rstudio/tinytex) holds
// pdfcrop, so a PDF made with it alone does not draw its scores as the editor
// does. Listed on 2026-09-12, the Mac bundle Quarto installs
// (TinyTeX-darwin-v2026.09, 19,994 files) has no pdfcrop and no Ghostscript
// either, only `rungs`, which calls the system's `gs`.
function texPage(platform) {
  if (platform === "darwin") return "https://www.tug.org/mactex/";
  if (platform === "win32") return "https://www.tug.org/texlive/windows.html";
  return "https://www.tug.org/texlive/";
}

// The same, as a step of the log.
function texStep(platform) {
  if (platform === "darwin") {
    return "Install MacTeX from " + texPage(platform) + " (it brings pdfcrop and Ghostscript as well).";
  }
  if (platform === "win32") return "Install TeX Live from " + texPage(platform) + ".";
  return (
    "Install TeX Live from the system's packages (on Debian or Ubuntu: " +
    "sudo apt install texlive-full ghostscript), or from " + texPage(platform) + "."
  );
}

// What Quarto says when a PDF is asked of it on a machine with no TeX at all
// (src/command/render/latexmk/latex.ts in quarto-dev/quarto-cli, worded the
// same in 1.9.37 and on main on 2026-09-12). Read out of its log rather than
// looked for beforehand: Quarto finds a TeX in more places than the PATH
// (TinyTeX in a folder of its own, for one), and a search of our own that
// missed one would refuse a PDF that exports. A Quarto that words it
// otherwise gets the notice every failed render gets.
const NO_TEX = /No TeX installation was detected/;

// The editor a notice tells its reader to quit, by the name it goes by: the
// extension runs in the editors built on VS Code as well.
function appName() {
  return vscode.env.appName || "VS Code";
}

// Steps of the log, numbered from 1.
function steps(lines) {
  return lines.map(function (line, i) {
    return "  " + (i + 1) + ". " + line;
  });
}

// The notices of a missing tool. Each log opens on the way out and ends on
// where the tool was looked for, which is for whoever helps.

// Where a browser to print with was looked for, for the foot of a log.
function browserSearch() {
  const installs = chromeInstalls(process.platform, process.env);
  return [
    "Looked for Chrome, or Microsoft Edge, as google-chrome, google-chrome-stable, " +
      "chromium, chromium-browser, chrome, microsoft-edge or microsoft-edge-stable " +
      "in every folder of the PATH" +
      (installs.length ? ", and at:" : "."),
  ].concat(
    installs.map(function (p) {
      return "  " + p;
    })
  );
}

// What the log says of the setting behind a notice that asks for TeX: it is
// reached only with mdm.pdfEngine on latex, and whoever reads it may not be
// the one who set it, or may have set it long ago.
const LATEX_ASKED =
  "mdm.pdfEngine is set to latex in the Settings, which is what asks LaTeX for " +
  "the PDF. Left at browser, its default, the PDF is the HTML page printed by " +
  "Chrome, Chromium or Microsoft Edge, and needs no TeX.";

// No Quarto, so no export of any kind. Installing it is the whole way out:
// its installer writes a folder quartoInstalls looks in, so no restart.
function quartoMissing() {
  const app = appName();
  const installs = quartoInstalls(process.platform, process.env);
  const lines = ["Exporting needs Quarto, and it was not found on this computer."]
    .concat(
      steps([
        "Download Quarto from " + QUARTO_PAGE + " and install it.",
        "Export again.",
      ])
    )
    .concat([
      "If Quarto is installed and this still appears, quit " + app +
        " completely and open it again: it learns where programs are only when it starts.",
      installs.length
        ? "Looked for quarto in every folder of the PATH below, and at:"
        : "Looked for quarto in every folder of the PATH below.",
    ])
    .concat(
      installs.map(function (p) {
        return "  " + p;
      })
    )
    .concat(["PATH: " + (process.env.PATH || "")]);
  exportNeeds(
    "exporting needs Quarto, a free program, and it is not installed on this " +
      "computer. Install it and export again. The editor works without it.",
    lines.join("\n"),
    { "Download Quarto": QUARTO_PAGE }
  );
}

// A PDF asked of LaTeX, with scores that neither road of the filter can draw
// (scoresLack).
// What TeX brings is found on the PATH, which the editor reads only when it
// starts, so a notice that asks for TeX asks for a restart as well. One that
// asks for Chrome alone does not: on a Mac Chrome is found in /Applications,
// where its installer puts it, and on Linux its package links it into
// /usr/bin, which is on the PATH already.
// `printed` says a Chrome was there and the page was printed with it and that
// did not work either, which is the only way the TeX-only wording is reached:
// with a Chrome and without the whole of TeX, the export prints the page
// rather than stop (printPage). Without saying so the notice sent the reader
// off to install TeX for a PDF that had just failed for a second reason, which
// is in the log. `page` is the HTML of a "both" that did land.
function scoresMissing(lack, dir, printed, page) {
  const app = appName();
  const platform = process.platform;
  const tex = lack.tex.length > 0;
  let summary;
  if (printed) {
    summary =
      "the PDF could not be made. Typeset with LaTeX, its scores need a " +
      "complete TeX, and printing the page with Chrome instead did not work " +
      "either. The log says what Chrome said.";
  } else if (lack.chrome && tex) {
    summary =
      "a PDF typeset with LaTeX needs Google Chrome and a complete TeX to draw " +
      "its scores, and this computer does not have them. Install both, then " +
      "quit " + app + ", open it again and export.";
  } else if (lack.chrome) {
    summary =
      "a PDF typeset with LaTeX needs Google Chrome to draw its scores, and it " +
      "is not installed on this computer. Install it and export again.";
  } else {
    summary =
      "a PDF typeset with LaTeX needs a complete TeX to draw its scores, and " +
      "this computer does not have one. Install it, then quit " + app +
      ", open it again and export.";
  }
  const pages = {};
  if (lack.chrome) pages["Download Chrome"] = CHROME_PAGE;
  if (tex) pages["Download TeX"] = texPage(platform);
  const named = { pdfcrop: "pdfcrop", gs: "Ghostscript (gs)" };
  const missing = (lack.chrome ? ["Google Chrome"] : []).concat(
    lack.tex.map(function (name) {
      return named[name];
    })
  );
  const todo = [];
  if (lack.chrome) todo.push("Install Google Chrome from " + CHROME_PAGE + ".");
  if (tex) {
    todo.push(texStep(platform));
    todo.push("Quit " + app + " completely and open it again, so it finds what was installed.");
  }
  todo.push("Export again.");
  const lines = [
    "A PDF typeset with LaTeX draws its scores as the editor does with three " +
      "programs: Google Chrome prints them, and pdfcrop, with Ghostscript, " +
      "trims them to the ink.",
    "Not found on this computer: " + missing.join(", ") + ".",
  ]
    .concat(steps(todo))
    .concat([
      "An export to HTML draws the scores with none of them.",
      "abcm2ps can draw the scores instead of Chrome, in a look of its own (on a " +
        "Mac: brew install abcm2ps; on Debian or Ubuntu: sudo apt install " +
        "abcm2ps). It needs epstopdf and Ghostscript as well, which come with TeX.",
      LATEX_ASKED,
    ]);
  if (platform === "win32") {
    lines.push(
      "On Windows the scores of a typeset PDF have not been tried, and may not " +
        "come out even with all of this installed."
    );
  }
  browserSearch().forEach(function (line) {
    lines.push(line);
  });
  lines.push(
    "Looked for abcm2ps at " + path.join(dir, "tools", "bin", "abcm2ps") +
      " and in the PATH; for pdfcrop, epstopdf and gs in the PATH.",
    "PATH: " + (process.env.PATH || "")
  );
  exportNeeds(
    summary,
    lines.join("\n"),
    pages,
    page ? { "Open HTML": page } : null
  );
}

// A PDF asked of LaTeX that Quarto found no TeX for (NO_TEX). Quarto's own
// words are already in the log, above this. Called only when no browser was
// found to print the page instead (printPage), or one printed it and that
// failed.
// `page` is the HTML of a "both" that did land: the page is rendered before
// the PDF is tried, so the run that ends here has still produced something,
// and a notice that says only what is missing leaves the reader hunting for
// it.
function texMissing(page) {
  const app = appName();
  const platform = process.platform;
  const lines = [
    "A PDF typeset with LaTeX needs TeX, and Quarto found none on this computer " +
      "(its own words are above).",
  ]
    .concat(
      steps([
        texStep(platform),
        "Quit " + app + " completely and open it again, so it finds what was installed.",
        "Export again.",
      ])
    )
    .concat(["An export to HTML needs no TeX.", LATEX_ASKED]);
  if (page) lines.push(path.basename(page) + " was exported and is beside the document.");
  exportNeeds(
    "a PDF typeset with LaTeX needs TeX, a free program that lays out the " +
      "pages, and it is not installed on this computer. Install it, then quit " +
      app + ", open it again and export." +
      (page ? " " + path.basename(page) + " was exported." : ""),
    lines.join("\n"),
    { "Download TeX": texPage(platform) },
    page ? { "Open HTML": page } : null
  );
}

// A PDF asked of the browser, which is what a PDF is asked of unless
// mdm.pdfEngine says latex, on a computer with none to print it, where LaTeX
// could not make it in its place either: had it, the PDF would be there and
// fallbackNotice would be saying how it was made. `why` is what stopped
// LaTeX: "notex" when Quarto found no TeX, "scores" when the document holds
// scores a typeset PDF cannot draw on this computer (scoresLack), and "latex"
// when it ran and failed, which is the one the notice itself speaks of, since
// the reader has just waited for it and its words are in the log.
// What is asked for is the browser, whatever stopped LaTeX: it is the road
// the reader was on, and the one program that brings the PDF by itself. It
// asks for no restart, a browser being found where its installer puts it
// (chromeInstalls) or on a PATH that already held its folder.
// `page` is the HTML of a "both" that did land.
function browserMissing(why, page) {
  const tried = why === "latex";
  const lines = [
    "A PDF is printed from the exported HTML page by Google Chrome, Chromium or " +
      "Microsoft Edge, and none of them was found on this computer.",
  ]
    .concat(
      steps([
        "Install Google Chrome from " + CHROME_PAGE +
          " (Chromium and Microsoft Edge print it as well).",
        "Export again.",
      ])
    )
    .concat([
      why === "scores"
        ? "With no browser the PDF is typeset with LaTeX instead, and LaTeX cannot " +
          "draw the scores of this document on this computer: that takes a " +
          "browser as well, or abcm2ps with epstopdf and Ghostscript."
        : tried
          ? "With no browser the PDF was typeset with LaTeX instead, and that " +
            "failed: what it said is above."
          : "With no browser the PDF is typeset with LaTeX instead, and Quarto " +
            "found no TeX on this computer either (its own words are above).",
      "An export to HTML needs no browser.",
    ]);
  if (page) lines.push(path.basename(page) + " was exported and is beside the document.");
  exportNeeds(
    (tried
      ? "the PDF could not be made. It is printed by Google Chrome, Chromium or " +
        "Microsoft Edge, and none of them is installed on this computer; " +
        "typesetting it with LaTeX instead did not work either. Install one of " +
        "them and export again."
      : "a PDF is printed by Google Chrome, Chromium or Microsoft Edge, and none " +
        "of them is installed on this computer. Install one and export again.") +
      (page ? " " + path.basename(page) + " was exported." : ""),
    lines.concat(browserSearch(), ["PATH: " + (process.env.PATH || "")]).join("\n"),
    { "Download Chrome": CHROME_PAGE },
    page ? { "Open HTML": page } : null
  );
}

// ---------- The two roads to a PDF ----------
//
// A PDF is made one of two ways, and mdm.pdfEngine says which one is asked
// for.
//
// `browser` prints the page. Quarto renders the HTML export, which the export
// rule already holds to the editor's own look, and a headless Chrome,
// Chromium or Microsoft Edge prints it: the document the reader has on
// screen, in its faces and with its scores and its equations as the editor
// draws them. The filter does the same for one score at a time, loading the
// editor's own abcjs into a headless Chrome and asking it to print
// (engrave_abcjs in mdm.lua) or, for a figure, one SVG (svg_as_pdf). It is a
// page, not a typeset book: no hyphenation to the measure, no TeX-quality
// justification, nothing beyond what a browser's own print does. Verified end
// to end on 2026-09-12: `quarto render --to html` on example.mdm, printed
// with the flags below, came back a real four-page PDF with its title and its
// equations, read back with pdftotext; the reader that suggested it had just
// gotten a PDF the same way, of a document with none of this filter's own
// KaTeX or scores, from cweijan.vscode-office (out/extension.js: markdown-it
// and KaTeX render the page, puppeteer-core's page.pdf() prints it, no TeX
// anywhere in it).
//
// `latex` has Quarto typeset it: TeX's line breaking and page layout, the
// document's own class and packages, the raw LaTeX the page leaves out, and a
// TeX to install first.
//
// The printed one is the default, with TeX on the computer or without (the
// owner's call, 2026-10-02). Until then every PDF was asked of LaTeX, and the
// print stood in where Quarto found no TeX, under a warning that sent the
// reader to install one; now a reader who wants LaTeX says so in the
// Settings, and the export button asks for nothing a browser cannot do.
//
// Each road stands in for the other when what it needs is not on the
// computer, and a notice says so (fallbackNotice): asked of the browser with
// none to be found, the PDF is typeset; asked of LaTeX with no TeX, or
// without the helpers of a complete TeX its scores are drawn with, it is
// printed. A road that was taken and failed is not replaced: a LaTeX error
// and a browser that did not print are the failures they are, each with its
// own words in the log, and a second try by other means would cover them.

// The values of mdm.pdfEngine. The first is the fallback as well as the
// default, so a settings.json that carries anything else prints.
const PDF_ENGINES = ["browser", "latex"];

function pdfEngine() {
  const value = vscode.workspace.getConfiguration("mdm").get("pdfEngine");
  return PDF_ENGINES.indexOf(value) !== -1 ? value : PDF_ENGINES[0];
}

// What the header asks of the PDF and does not ask of the page. A printed PDF
// is the page, and Quarto gives a render to HTML the options of `format:
// html:` alone: contents or numbered sections written under `format: pdf:`,
// where example.mdm keeps its PDF options, made a typeset PDF that had them
// and a printed one that had neither (seen 2026-10-03). So Quarto is asked
// what the header comes to for each format (`quarto inspect`, 0.55 s on
// example.mdm, which also reads a _quarto.yml over the document), and the
// page that is printed is rendered with what the PDF has over it.
//
// `page` holds what changes the page itself: Pandoc's own flags, which a
// render takes over what the header says of the page (`-M toc:true` loses to
// a `toc` under `format: html:`, measured on Quarto 1.9.37). A page rendered
// with them is no longer the page the header asks for, so an export of both
// prints from a page of its own (printPage) and keeps the other beside the
// document. `paper` holds what changes the paper alone: contents asked of
// the page and not of the PDF stay in the page's margin and are kept off the
// sheet (mdm-print-toc, read by the filter), which no flag can do, since
// `--toc=false` stops Quarto.
//
// Three things are carried: the contents, their depth and the numbered
// sections. Not carried, and said here because it is a difference: numbers
// the page has and the PDF does not ask for stay on the paper, there being
// no flag to take them off. A Quarto that does not answer, or answers
// something else, changes nothing: the PDF is the page as it is.
const NO_ASKS = Object.freeze({ page: Object.freeze([]), paper: Object.freeze([]) });

function asksFrom(inspected) {
  let formats;
  try {
    const text = String(inspected);
    formats = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).formats;
  } catch (e) {
    return NO_ASKS;
  }
  const html = formats && formats.html && formats.html.pandoc;
  const pdf = formats && formats.pdf && formats.pdf.pandoc;
  if (!html || !pdf) return NO_ASKS;
  // Three levels where the header names none, which is Quarto's own default
  // for the page and for the PDF.
  const depth = function (format) {
    const named = format["toc-depth"];
    return Number.isInteger(named) && named >= 1 && named <= 6 ? named : 3;
  };
  const page = [];
  const paper = [];
  if (pdf.toc === true) {
    if (html.toc !== true) page.push("--toc");
    if (depth(pdf) !== depth(html)) page.push("--toc-depth=" + depth(pdf));
  } else if (html.toc === true) {
    paper.push("-M", "mdm-print-toc:hidden");
  }
  if (pdf["number-sections"] === true && html["number-sections"] !== true) {
    page.push("--number-sections");
  }
  return { page: page, paper: paper };
}

// A wall clock on it, as on the print: an export must not wait for good on a
// question whose answer it can do without.
const INSPECT_TIMEOUT = 20000;

function pdfAsks(quarto, copy, dir) {
  channel().appendLine("  " + quarto + " inspect " + copy + "  (in " + dir + ")");
  return new Promise(function (resolve) {
    let out = "";
    let child;
    try {
      child = cp.spawn(quarto, ["inspect", copy], {
        cwd: dir,
        windowsHide: true,
        timeout: INSPECT_TIMEOUT,
      });
    } catch (e) {
      resolve(NO_ASKS);
      return;
    }
    child.stdout.on("data", function (d) {
      out += d;
    });
    child.on("error", function () {
      resolve(NO_ASKS);
    });
    child.on("close", function (code) {
      const asks = code === 0 ? asksFrom(out) : NO_ASKS;
      if (asks.page.length) {
        channel().appendLine(
          "The header asks the PDF for what it does not ask the page (" + asks.page.join(" ") +
            "), so the PDF is printed from a page rendered for it."
        );
      }
      if (asks.paper.length) {
        channel().appendLine(
          "The header asks the page for contents and not the PDF, so the paper carries none."
        );
      }
      resolve(asks);
    });
  });
}


// Chrome refuses to start as root without this, the normal case inside a
// container; harmless everywhere else. Mirrors chrome_sandbox_flag in
// mdm.lua, which the filter needs for the same reason to print a score.
function sandboxFlag() {
  return typeof process.getuid === "function" && process.getuid() === 0
    ? ["--no-sandbox"]
    : [];
}

// One page, printed whole. Chrome is handed the file's own path with no
// file:// in front, which is what engrave_abcjs and svg_as_pdf already do in
// mdm.lua and a Chrome answers the same way here: the page's relative links
// (doc_files/…) resolve against its own folder, as they do when a reader
// opens the export by hand. --virtual-time-budget gives KaTeX and abcjs,
// both run from script, time to finish before the print; the filter's own
// budget for one score is 4000, and the whole page of example.mdm printed
// clean well inside 6000.
// The headless process gets a profile of its own. Without one Chrome uses the
// normal profile, and on Windows a Chrome already holding it makes the new
// process exit with 21 before --print-to-pdf writes anything. It can therefore
// work once and fail merely because Chrome was opened in between. A fresh
// user-data-dir also keeps this throwaway page out of the reader's history and
// is removed when the process answers, on success or failure.
let printSerial = 0;

// A Chrome that never exits would otherwise hang the export for good: the
// progress notification stays up, no notice is ever shown, and the copy and
// the private page stay beside the document, where the copy alone refuses
// every later export of it ("a file named song.qmd is in the way"). Seen on
// 2026-09-13 with a stand-in that slept instead of printing. The cap is wall
// clock, which --virtual-time-budget is not: that one is the page's own clock
// and stops nothing. Printing example.mdm took 1.3 to 1.7 s and a document of
// 200 scores over 102 pages took 7.2 s on this machine, so two minutes is
// over fifteen times the worst measured and still ends.
// The kill reaches the process started here and not the group under it: a
// Chrome hung inside a renderer can leave that renderer behind.
// MDM_PRINT_TIMEOUT shortens it, read at the call and not at load, which is
// how the test watches the clock fire without waiting two minutes for it.
const PRINT_TIMEOUT = 120000;

function printTimeout() {
  return Number(process.env.MDM_PRINT_TIMEOUT) || PRINT_TIMEOUT;
}

function printHtmlToPdf(chrome, htmlPath, pdfPath) {
  return new Promise(function (resolve) {
    let profile;
    try {
      profile = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-chrome-"));
    } catch (e) {
      channel().appendLine(
        "Creating Chrome's temporary profile failed: " + String(e.message || e)
      );
      resolve(false);
      return;
    }
    // The bookmarks: the outline of the headings, which the typeset PDF has
    // always carried and a printed one had none of (0 entries against 12 on a
    // document of twelve headings, measured 2026-10-02). Chrome builds it from
    // the tagged structure of the page. A heading that opens a sheet came out
    // with its title twice ("From code to scoresFrom code to scores"), which
    // the clip on the headings in mdm-look.css's print rules is there for.
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      "--generate-pdf-document-outline",
      "--virtual-time-budget=6000",
      "--user-data-dir=" + profile,
    ]
      .concat(sandboxFlag())
      .concat(["--print-to-pdf=" + pdfPath, htmlPath]);
    channel().appendLine("  " + chrome + " " + args.join(" "));
    let log = "";
    let finished = false;
    let clock = null;
    const finish = function (ok, reason) {
      if (finished) return;
      finished = true;
      if (clock) clearTimeout(clock);
      if (log) channel().appendLine(log.trimEnd());
      if (reason) channel().appendLine(reason);
      try {
        fs.rmSync(profile, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      } catch (e) {
        // Chrome has answered, but one of its short-lived helpers can still
        // hold a file on Windows. The next export has another profile, so a
        // delayed best-effort removal is enough and must not turn a PDF that
        // was made into a failed export.
        const cleanup = setTimeout(function () {
          try {
            fs.rmSync(profile, { recursive: true, force: true });
          } catch (_) {
            // The system's temporary-file cleanup can take the last resort.
          }
        }, 1000);
        if (typeof cleanup.unref === "function") cleanup.unref();
      }
      resolve(ok);
    };
    let child;
    try {
      // In its own profile, where the debug.log Chrome writes into its working
      // folder on Windows goes away with the profile (one was found in a
      // document's folder on Windows, 2026-09-14), and with no console window.
      child = cp.spawn(chrome, args, { cwd: profile, windowsHide: true });
    } catch (e) {
      finish(false, "Starting Chrome failed: " + String(e.message || e));
      return;
    }
    const cap = printTimeout();
    clock = setTimeout(function () {
      try {
        child.kill("SIGKILL");
      } catch (e) {
        // already gone: the close below answers either way
      }
      finish(
        false,
        "Chrome did not finish printing within " +
          cap / 1000 +
          " seconds, and was stopped."
      );
    }, cap);
    if (typeof clock.unref === "function") clock.unref();
    child.stdout.on("data", function (d) {
      log += d;
    });
    child.stderr.on("data", function (d) {
      log += d;
    });
    child.on("error", function (e) {
      finish(false, "Starting Chrome failed: " + String(e.message || e));
    });
    child.on("close", function (code) {
      const made = code === 0 && isFile(pdfPath);
      finish(
        made,
        made
          ? null
          : code === 0
            ? "Chrome exited without writing the PDF."
            : "Chrome exited with " + code + "."
      );
    });
  });
}

// What the reader is told when the PDF was made, and by the other road than
// the one mdm.pdfEngine asks for: still a warning, and not the plain
// "exported" of an export that went as asked, because what came out is not
// what was asked for. `made` is the road it came by. "printed" is a PDF asked
// of LaTeX on a computer with no TeX, or without the helpers of a complete
// TeX its scores are drawn with (`lack`, as scoresLack names them);
// "typeset" is one asked of the browser on a computer with none. Offers the
// file it made alongside the way to the one that was asked for, and a button
// that turns the notice off for good, in both directions
// (mdm.showPdfFallbackNotice): the log is written either way.
function fallbackNotice(made, pretty, pdfPath, htmlPath, lack) {
  const app = appName();
  const platform = process.platform;
  const pdfName = path.basename(pdfPath);
  const typeset = made === "typeset";
  const missing = lack
    ? lack.tex.map(function (name) {
        return name === "gs" ? "Ghostscript (gs)" : name;
      })
    : [];
  const lines = typeset
    ? [
        "No Google Chrome, Chromium or Microsoft Edge was found on this computer, " +
          "so " + pretty + " could not be printed from its HTML page.",
        pdfName + " was typeset with LaTeX instead: a real PDF, but with LaTeX's " +
          "own line breaks and page layout, not the page's.",
      ]
        .concat(
          steps([
            "Install Google Chrome from " + CHROME_PAGE +
              " (Chromium and Microsoft Edge print it as well).",
            "Export again for the printed PDF.",
          ])
        )
        .concat([
          "To have LaTeX typeset every PDF, set mdm.pdfEngine to latex in the " +
            "Settings: this notice is for a PDF that was asked of the browser.",
        ])
        .concat(browserSearch(), ["PATH: " + (process.env.PATH || "")])
    : [
        lack
          ? "This computer lacks " + missing.join(" and ") + ", so " + pretty +
            " could not typeset its scores with LaTeX."
          : "This computer has no TeX, so " + pretty + " could not be typeset with LaTeX.",
        pdfName + " was printed from the exported HTML page instead: a " +
          "real PDF, but with the page's own line breaks and spacing, not LaTeX's.",
      ]
        .concat(
          steps([
            texStep(platform),
            "Quit " + app + " completely and open it again, so it finds what was installed.",
            "Export again for the LaTeX PDF.",
          ])
        )
        .concat([LATEX_ASKED]);
  // The way to the road that was asked for: the page of the program it lacks.
  const get = typeset ? "Download Chrome" : "Download TeX";
  const buttons = ["Open PDF"];
  if (htmlPath) buttons.push("Open HTML");
  buttons.push(get, "Show log", "Don't show again");
  channel().appendLine(lines.join("\n"));
  if (vscode.workspace.getConfiguration("mdm").get("showPdfFallbackNotice") === false) {
    return;
  }
  vscode.window
    .showWarningMessage(
      "MDM: " +
        (typeset
          ? "no Chrome or Edge was found, so " + pdfName +
            " was typeset with LaTeX instead of printed from the HTML page. " +
            "Install Chrome for the printed PDF."
          : (lack ? "a complete TeX was not found" : "no TeX was found") +
            ", so " + pdfName +
            " was printed from the HTML page instead of typeset with LaTeX. " +
            "Install TeX for a typeset PDF."),
      ...buttons
    )
    .then(function (choice) {
      if (choice === "Open PDF") vscode.env.openExternal(vscode.Uri.file(pdfPath));
      else if (choice === "Open HTML") vscode.env.openExternal(vscode.Uri.file(htmlPath));
      else if (choice === get) {
        vscode.env.openExternal(
          vscode.Uri.parse(typeset ? CHROME_PAGE : texPage(platform))
        );
      } else if (choice === "Show log") channel().show(true);
      else if (choice === "Don't show again") {
        vscode.workspace
          .getConfiguration("mdm")
          .update("showPdfFallbackNotice", false, vscode.ConfigurationTarget.Global)
          .then(undefined, function (e) {
            channel().appendLine(
              "Saving mdm.showPdfFallbackNotice failed: " + String(e.message || e)
            );
          });
      }
    });
}

// ---------- The copy Quarto renders ----------

// A value going into the YAML of the copy. Single quotes, since a Windows
// path in double quotes would read its backslashes as escapes.
function quoteYaml(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

// Quarto resolves `filters: [mdm]` against an _extensions directory in the
// folder of the file it renders, and nowhere else: it does not walk up the
// tree, and a --metadata-file does not outrank the header (both measured on
// 1.9.37). So the copy names the filter by absolute path instead, and the
// document renders wherever it happens to live with no _extensions beside it.
// Its own `- mdm` entry is what gets replaced, since leaving it there would
// send Quarto looking for the extension all the same.
function withFilter(text, lua) {
  const item = quoteYaml(lua);
  const bare = function (v) {
    return v.replace(/^['"]|['"]$/g, "");
  };
  const header = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!header) {
    return "---\nfilters:\n  - " + item + "\n---\n\n" + text;
  }
  const lines = header[1].split("\n");
  let done = false;
  for (let i = 0; i < lines.length && !done; i++) {
    const line = lines[i].replace(/\r$/, "");
    const flow = /^filters:[ \t]*\[(.*)\][ \t]*$/.exec(line);
    if (flow) {
      const items = flow[1]
        .split(",")
        .map(function (v) {
          return v.trim();
        })
        .filter(function (v) {
          return v.length;
        });
      const at = items.findIndex(function (v) {
        return bare(v) === "mdm";
      });
      if (at === -1) items.unshift(item);
      else items[at] = item;
      lines[i] = "filters: [" + items.join(", ") + "]";
      done = true;
      break;
    }
    if (!/^filters:[ \t]*$/.test(line)) continue;
    // A block list: the indented `- ` lines that follow the key.
    let at = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const entry = /^[ \t]+-[ \t]*(.*?)[ \t]*$/.exec(lines[j].replace(/\r$/, ""));
      if (!entry) break;
      if (bare(entry[1]) === "mdm") {
        at = j;
        break;
      }
    }
    // The entry is rewritten up to the line's own \r and not past it: a file
    // saved on Windows ends its lines in \r\n, the split above leaves the \r
    // on each, and `.*$` found no end in front of it, so a CRLF header kept
    // its bare `- mdm` whenever another key followed the list (the language
    // menu writes `lang:` there) and Quarto went looking for an _extensions
    // folder that is not there.
    if (at === -1) lines.splice(i + 1, 0, "  - " + item);
    else lines[at] = lines[at].replace(/-[ \t]*[^\r]*/, "- " + item);
    done = true;
  }
  if (!done) lines.push("filters:", "  - " + item);
  return "---\n" + lines.join("\n") + "\n---\n" + text.slice(header[0].length);
}

// ---------- The dialect the copy is read as ----------

// The editor reads CommonMark (the Lezer parser under CodeMirror) and Quarto
// reads Pandoc's Markdown, and the two disagree on what opens a block. Pandoc
// asks for a blank line before a heading and before a block quote, where
// CommonMark, and GitHub with it, asks for none. A `### Title` written under
// the last line of a paragraph, or under the closing fence of a score, came
// out of the export as a line of text with three hashes on it while the
// editor showed a heading.
//
// Turning the two rules off costs nothing: the Pandoc tree of example.mdm, of
// both documents under vscode-mdm/docs and of the README comes out identical
// with them and without them (measured on Pandoc 3.8.3).
//
// One difference is left standing, and no reader option governs it: Pandoc
// wants the `#` in the first column, while CommonMark lets up to three spaces
// stand before it. A heading written with a space in front of it is a heading
// in the editor and a paragraph in the export.
// Plus the bare addresses the editor draws as links (GFM's autolinks, which
// Pandoc's Markdown reads as text unless told: G017). An address with a
// scheme and a bare mail address (measured on Pandoc 3.8.3); a `www.` one is
// text on the page, and the editor draws it as text too, since Pandoc has no
// switch for it.
const READER = "markdown-blank_before_header-blank_before_blockquote+autolink_bare_uris";

// The dialect goes in the header of the copy rather than in a `--from` on the
// command line, which Quarto 1.9.37 does not survive: it dies in its own
// readqmd.lua on a nil metadata table before the document is read.
//
// A document that names a dialect itself keeps it, whether at the top level
// or under a format; only the header is searched, so a line of prose or of
// code that opens with `from:` is not mistaken for that.
function withReader(text, from) {
  const fm = splitFrontMatter(text)[0];
  if (fm && /^[ \t]*from[ \t]*:/m.test(headerInner(fm))) return text;
  return withHeaderLines(text, ["from: " + from]);
}

// What is between a header's two fences. The header is taken as Pandoc
// reads it (splitFrontMatter in transforms.js), so that a `...` closer, a
// closer with a space after it and an empty header are the header and a
// leading rule is not one (G040).
function headerInner(fm) {
  return fm
    .replace(/^---[ \t]*\r?\n/, "")
    .replace(/(?:---|\.\.\.)[ \t]*(?:\r?\n|$)$/, "")
    .replace(/\r?\n$/, "");
}

// The copy's header with `lines` added at its foot, where every line of the
// author's keeps the number it has in the file. They went in at the top
// until 2026-09-29, and an error in the header came back two lines below the
// line it was about ("bad indentation of a mapping entry (5:9)" for line 3),
// with the `from:` and the `pagetitle:` of the copy over it. A document with
// no header is given one, with a blank line under it.
function withHeaderLines(text, lines) {
  const fm = splitFrontMatter(text)[0];
  if (!fm) return "---\n" + lines.join("\n") + "\n---\n\n" + text;
  const inner = headerInner(fm);
  return (
    "---\n" + (inner ? inner + "\n" : "") + lines.join("\n") + "\n---\n" + text.slice(fm.length)
  );
}

// Two settings of the page that every export asks for, unless the document
// names its own, anywhere in its header:
//
// - `appendix-style: none`. The notes and the reference list stay where
//   Pandoc puts them, in the flow of the page, as the editor keeps them in
//   the document. Quarto's appendix took them into a white card under
//   headings of its own making ("References", "Notes"), at 0.9 of the text
//   and 0.9 opacity, and the card stayed white under the dark look while the
//   ink went pale: 1.42:1 (measured 2026-09-29). It has to be in the header:
//   a `-M appendix-style:none` does not reach the step that builds the
//   appendix, which went on building it (measured on Quarto 1.9.37).
// - `html-math-method: gladtex`. Citeproc runs after every filter, so a
//   formula it writes out of a BibTeX title never becomes the filter's
//   `span.math` (Math in mdm.lua). The writer set it for Quarto's default,
//   MathJax, which the page then fetched from cdn.jsdelivr.net, and which
//   KaTeX drew in red. GladTeX's markup keeps the formula's own LaTeX in an
//   `<eq>` and brings no engine at all; mdm-math.js sets it. Only citeproc's
//   formulas ever meet it, since the prose's are the filter's spans by then.
const PAGE_KEYS = [
  ["appendix-style", "none"],
  ["html-math-method", "gladtex"],
];

function withPageKeys(text) {
  const fm = splitFrontMatter(text)[0];
  const inner = fm ? headerInner(fm) : "";
  const lines = PAGE_KEYS.filter(function (kv) {
    return !new RegExp("^[ \\t]*" + kv[0] + "[ \\t]*:", "m").test(inner);
  }).map(function (kv) {
    return kv[0] + ": " + kv[1];
  });
  return lines.length ? withHeaderLines(text, lines) : text;
}

// The name the page goes by, when the document itself gives it none: the
// browser's tab, and the Title a PDF printed from that page carries, since
// Chrome copies <title> into it. Left alone, Quarto falls back to the stem of
// the file it was handed, which is the copy, and on the print road the copy
// has a private stem: an untitled document came out of it called
// `doc.mdm-print-17284-1789330020713-1` (measured 2026-09-13).
//
// It goes in the header of the copy and not in a `-M pagetitle:`, which is
// worse than doing nothing: Quarto settles the page title after the filters
// and the `-M` came out `quarto-inputd921f1d56f4c3069`, its own temporary.
// From the header it arrives whole, spaces and all, which is what a file name
// is full of. A document that names a `pagetitle` itself keeps it, and one
// that has a title keeps that, since the filter copies the title over this
// (page_name in mdm.lua).
function withPageTitle(text, name) {
  const fm = splitFrontMatter(text)[0];
  if (fm && /^[ \t]*pagetitle[ \t]*:/m.test(headerInner(fm))) return text;
  return withHeaderLines(text, ["pagetitle: " + quoteYaml(name)]);
}

// ---------- The rules the copy draws ----------

// A line of nothing but dashes, which is how a thematic break is written, and
// the fence a fenced block opens with. Only dashes, and only in an unbroken
// run: `***` and `___` are a rule to Pandoc whatever follows them, and a rule
// written spaced out (`- - -`) is also how Pandoc rules the columns of a
// simple table, which the copy has no business taking apart.
const DASH_BREAK = /^ {0,3}-{3,}[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// The first item of a list that CommonMark lets interrupt a paragraph: a
// bullet, or an ordered item numbered 1, with something after its marker.
const LIST_START = /^ {0,3}(?:[-*+]|1[.)])[ \t]+\S/;
// Any item of a list, at any depth, which is what says a line is in one.
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
// A thematic break drawn with spaces, `* * *` or `- - -`, which is not a list.
const SPACED_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// A thematic break that is not a line of bare dashes: `***`, `___`, and any
// spaced one. Under a line of text CommonMark reads the break and Pandoc
// reads more of the paragraph (G039); a line of bare dashes there is a setext
// underline to both, and is left to the rule below.
const OTHER_BREAK = /^ {0,3}(?:([*_])(?:[ \t]*\1){2,}|-(?:[ \t]+-){2,})[ \t]*$/;
// A heading indented one to three spaces, which CommonMark reads as a heading
// and Pandoc as a paragraph of text with the hashes on it (G027).
const INDENTED_HEADING = /^ {1,3}(#{1,6}(?:[ \t]|$))/;
// A heading whose text ends in a `#` run with no space before it, `## Sonata
// in F#`: CommonMark keeps the sharp (a closing sequence needs a space before
// it, 4.2) and Pandoc takes it off (G027, G112).
const TRAILING_SHARP = /^( {0,3}#{1,6}[ \t]+.*?[^ \t#\\])(#+)[ \t]*$/;
// The line a `$$` block opens on, as the editor's grammar reads it
// (vendor-src/src/markdown/math.js, isBlockMathStart).
const MATH_OPEN = /^ {0,3}\$\$/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;

// A thematic break with a line of text straight under it. In the CommonMark
// the editor reads, a line of dashes is a rule and nothing else (the
// HorizontalRule branch of media/main.js, drawn by the RULE widget). Pandoc
// reads that same line as the opening fence of a YAML metadata block as soon
// as what follows it is not blank, and the block runs to the next `---` and
// swallows everything in between: a `---` written straight above a ```abc
// fence took the score into one, and the render died in Quarto's own reader
// with "Error parsing YAML metadata"; the same thing closed by a `...` was
// dropped without a word (measured on Pandoc 3.8.3 through Quarto 1.9.37).
//
// The blank line that makes the two dialects agree goes into the copy Quarto
// renders and never into the document: it only spells out what the editor
// already draws there, and the copy is taken away when the render is over.
// This is the same bargain as READER above, one rule further on: what comes
// out is what the editor showed.
//
// Every line of dashes outside a fence is served, and the line above it is not
// consulted, because there is no case where the blank line costs anything. On
// a rule it is what Pandoc was missing; on a setext underline, which is what a
// line of dashes under a paragraph is in both dialects, the underline has
// already taken the paragraph above it and a blank line under it changes
// nothing. Inside a fence the dashes are code, and a blank line in an ABC
// block would end the tune, so a fence is stepped over whole.
//
// A list straight under a line of text is the other place the two dialects
// part. CommonMark lets a list interrupt a paragraph and Pandoc's Markdown
// does not: example.mdm's opening line with its three items under it was a
// list in the editor and one paragraph with the dashes written into it on the
// page, "rendered and editable at once: - text, emphasis, ..." (measured on
// Pandoc 3.8.3, 2026-09-14). The blank line goes in only where CommonMark
// would start the list: a bullet, or an ordered item numbered 1, with
// something after the marker, up to three spaces in, under a line of text
// (or of a quotation) that is not itself in a list. Everywhere else the two
// already agree and nothing is added: an item under an item, a sublist, a
// list under a heading. Pandoc's own `lists_without_preceding_blankline` was
// measured and not taken, since it lets any ordered item interrupt: a line of
// prose wrapped at "The year was / 2026. Then" came out a list numbered from
// 2026, where CommonMark keeps the paragraph. Inside a `$$` block a line is
// LaTeX and a blank line would end the formula, so the block is stepped over
// whole as a fence is.
function withBreaks(text) {
  const head = splitFrontMatter(text)[0];
  const lines = text.slice(head.length).split(/\r?\n/);
  // The document's own line ending, so a copy of a CRLF file stays CRLF.
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const out = [];
  let open = null; // the run of ` or ~ the fence now standing was opened with
  let math = false; // inside a `$$` block
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (open) {
      out.push(line);
      // A closing fence: the same character, no shorter, and nothing after it.
      const closes =
        fence &&
        fence[1][0] === open[0] &&
        fence[1].length >= open.length &&
        !fence[2].trim();
      if (closes) open = null;
      continue;
    }
    if (math) {
      out.push(line);
      // The first `$$` closes it, and a blank line ends it unclosed.
      if (line.includes("$$") || !line.trim()) math = false;
      continue;
    }
    // Unless a blank line is there already, the one the rule above put in.
    if (needsBlankAbove(lines, i) && out[out.length - 1].trim()) out.push("");
    out.push(copyLine(lines, i));
    if (fence) {
      open = fence[1];
      continue;
    }
    if (MATH_OPEN.test(line)) {
      // Closed on its own line when a second `$$` follows the first.
      math = !line.trim().slice(2).includes("$$");
      continue;
    }
    if (!DASH_BREAK.test(line)) continue;
    const below = i + 1 < lines.length ? lines[i + 1] : "";
    if (!below.trim()) continue; // the blank line is already there
    out.push("");
  }
  return head + out.join(eol);
}

// The changes an outside edit made, in the editor's own lines. The text the
// editor holds is the file's from `hidden` lines down, line endings apart, so
// a range below the header is the same range `hidden` lines up. With them the
// webview puts a change where it was made: from the two texts alone it can
// only tell where they start to differ, and a line inserted among lines like
// it was put at the end of the run, every caret of the run left on the copy
// above its own (G090). Nothing when a change reaches into the lines the
// editor does not hold, or when the event names none: the webview compares
// the texts then, as it always did.
function editorChanges(contentChanges, hidden) {
  if (!contentChanges || !contentChanges.length) return undefined;
  const out = [];
  for (const change of contentChanges) {
    if (!change.range || change.range.start.line < hidden) return undefined;
    out.push({
      from: { line: change.range.start.line - hidden, ch: change.range.start.character },
      to: { line: change.range.end.line - hidden, ch: change.range.end.character },
      text: toLf(change.text),
    });
  }
  return out;
}

// The stretch two texts differ over: what stands between their common head
// and their common tail, as offsets into the first and the text the second
// holds there. Neither edge parts a CR from its LF, which a position cannot
// name (the workbench reads an offset between the two as the end of the
// line), nor the halves of a surrogate pair.
function changedSpan(before, after) {
  const max = Math.min(before.length, after.length);
  let head = 0;
  while (head < max && before.charCodeAt(head) === after.charCodeAt(head)) head++;
  let tail = 0;
  while (
    tail < max - head &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  ) {
    tail++;
  }
  const inPair = function (text, at) {
    if (at <= 0 || at >= text.length) return false;
    const a = text.charCodeAt(at - 1);
    const b = text.charCodeAt(at);
    return (a === 13 && b === 10) || (a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff);
  };
  while (head > 0 && (inPair(before, head) || inPair(after, head))) head--;
  while (tail > 0 && (inPair(before, before.length - tail) || inPair(after, after.length - tail))) tail--;
  return { from: head, to: before.length - tail, insert: after.slice(head, after.length - tail) };
}

// Whether lines[i] needs a blank line over it in the copy: a list that
// interrupts text (below); a table whose header row stands straight under a
// line of text, which CommonMark and GitHub draw and Pandoc reads as more of
// the paragraph, pipes and all; a `***` or a spaced rule under a line of
// text, read the same way; and a line of dashes under an item, which is a
// rule to CommonMark (the paragraph it would underline is inside the item)
// and a second-level heading inside the item to Pandoc (G039, all four
// measured on Pandoc 3.8.3 through Quarto 1.9.37).
function needsBlankAbove(lines, i) {
  if (i === 0 || !lines[i - 1].trim()) return false;
  if (interruptsText(lines, i)) return true;
  if (OTHER_BREAK.test(lines[i])) return true;
  if (DASH_BREAK.test(lines[i]) && inList(lines, i - 1)) return true;
  return tableStartsAt(lines, i) && !LIST_ITEM.test(lines[i - 1]);
}

// The line as the copy carries it: a heading indented up to three spaces is
// brought to the margin, unless it stands inside a list, where the indent is
// the item's (G027); and a heading ending in a `#` run with no space before
// it gets a backslash before the run, so that Pandoc keeps the sharp
// CommonMark keeps (G027, G112).
function copyLine(lines, i) {
  let line = lines[i];
  const indented = INDENTED_HEADING.exec(line);
  if (indented && !listContext(lines, i)) line = line.slice(line.length - line.trimStart().length);
  if (INDENTED_UNDERLINE.test(line) && underlines(lines, i)) line = line.trimStart();
  const sharp = TRAILING_SHARP.exec(line);
  if (sharp) line = sharp[1] + "\\" + sharp[2];
  return line;
}

// A setext underline set in one to three spaces. CommonMark reads the
// heading and Pandoc a paragraph with the `=====` in it (`Title` over
// `  =====`, measured on pandoc 3.8.3; the text's own indentation it takes),
// so the copy brings the underline to the margin (G041).
const INDENTED_UNDERLINE = /^ {1,3}(?:=+|-+)[ \t]*$/;

// Whether lines[i], a run of = or -, stands under a line of a paragraph's
// text outside a list, which is what makes it an underline: not under a
// blank line, code, a heading, a fence, an item, a quote or a rule.
function underlines(lines, i) {
  if (i === 0) return false;
  const above = lines[i - 1];
  if (!above.trim() || /^(?: {4}|\t)/.test(above)) return false;
  if (HEADING.test(above) || FENCE.test(above) || LIST_ITEM.test(above) || /^ {0,3}>/.test(above)) return false;
  if (OTHER_BREAK.test(above) || DASH_BREAK.test(above)) return false;
  return !listContext(lines, i);
}

// Whether the paragraph lines[i] ends belongs to a list item: read back over
// the lines of the paragraph to the item's marker, stopping at a heading or
// a fence.
function inList(lines, i) {
  for (let j = i; j >= 0 && lines[j].trim(); j--) {
    if (LIST_ITEM.test(lines[j])) return true;
    if (HEADING.test(lines[j]) || FENCE.test(lines[j])) return false;
  }
  return false;
}

// Whether lines[i] stands inside a list: the nearest line above that is
// neither blank nor a continuation indented two or more is an item.
function listContext(lines, i) {
  for (let j = i - 1; j >= 0; j--) {
    if (!lines[j].trim()) continue;
    if (LIST_ITEM.test(lines[j])) return true;
    if (/^ {2}|^\t/.test(lines[j])) continue;
    return false;
  }
  return false;
}

// The cells of a pipe-table row: the outer pipes off, the row split at every
// pipe not escaped with a backslash.
function tableCells(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/);
}

// Whether lines[i] is the header row of a pipe table: a row with a pipe in
// it, over a delimiter row of as many cells (GFM's rule for a table).
function tableStartsAt(lines, i) {
  if (i + 1 >= lines.length || lines[i].indexOf("|") === -1) return false;
  const delims = tableCells(lines[i + 1]);
  if (!delims.every((c) => /^[ \t]*:?-+:?[ \t]*$/.test(c))) return false;
  if (!/[|-]/.test(lines[i + 1]) || lines[i + 1].indexOf("|") === -1 && delims.length < 2) return false;
  return tableCells(lines[i]).length === delims.length;
}

// Whether lines[i] opens a list that CommonMark starts there and Pandoc reads
// as more of the text above it. Not when the text above is in a list already
// (an item, a sublist, a line carried on under one: read back to the blank
// line over it), and not under a heading, which is a block of its own that
// Pandoc starts a list under with no blank line, as CommonMark does.
function interruptsText(lines, i) {
  if (!LIST_START.test(lines[i]) || SPACED_BREAK.test(lines[i])) return false;
  if (i === 0 || !lines[i - 1].trim() || HEADING.test(lines[i - 1])) return false;
  for (let j = i - 1; j >= 0 && lines[j].trim(); j--) {
    if (LIST_ITEM.test(lines[j])) return false;
    if (HEADING.test(lines[j]) || FENCE.test(lines[j])) break;
  }
  return true;
}

// The path without its extension, which is what the copy and everything the
// render leaves behind are named after. Whatever the extension is: the editor
// opens a document of another name through "Open With", and a `.md` used to
// keep its own extension in the middle of every name the export produced
// (`notes.md.qmd`, `notes.md.html`, `notes.md.pdf`).
function withoutExtension(file) {
  const ext = path.extname(file);
  return ext ? file.slice(0, file.length - ext.length) : file;
}

// The stem Quarto gives the LaTeX of a PDF, each character TeX cannot take in
// a file name made a hyphen (texSafeFilename in Quarto 1.9.37's core/tex.ts):
// `my song (draft).qmd` is typeset as `my-song--draft-.tex`, and its PDF came
// out as `my-song--draft-.pdf` until the render named it (--output, in
// runExport).
function texSafeFilename(name) {
  return name.replace(/[ <>()|:&;#?*'\\/]/g, "-");
}

// ---------- The name a score's audio is written under ----------

// At most this many code points of the title, and at most this many bytes of
// name. 255 bytes is the bound every filesystem the editor meets keeps for one
// name: ext4 counts bytes, APFS and NTFS count units of their own, but 255 of
// those is never fewer bytes than 255. The title is cut long before that so
// that a file manager can show the whole name.
const AUDIO_TITLE_MAX = 80;
// 255 bytes is what a name may weigh on ext4, APFS and NTFS alike, and the
// file is written under its own name plus ".part" before it is moved into
// place (writeAudioFile), so the name itself is held five bytes short of it.
// At the bound exactly, the part file was the one thing too long to write.
const AUDIO_PART_SUFFIX = ".part";
const AUDIO_NAME_MAX = 255 - AUDIO_PART_SUFFIX.length;

// The title of a score, fit to be part of a file name and to be read out in a
// notification. It is the score's T: line, which is the reader's own text and
// reaches this side exactly as it was typed, so everything a filesystem, a
// file manager or a notification would read as something other than letters
// comes out of it here.
function cleanAudioTitle(raw) {
  const title = String(raw)
    // Composed first, so that what is counted and cut below is what is drawn:
    // a decomposed "e" plus an accent is two code points and one letter.
    .normalize("NFC")
    // C0, C1 and DEL. A newline in a file name is legal on Linux and
    // unreadable everywhere.
    .replace(/[\x00-\x1F\x7F-\x9F]/g, " ")
    // A surrogate with no partner. vscode.Uri.toString() runs
    // encodeURIComponent, which throws URIError on a lone surrogate, and the
    // oldest Node the extension runs on has no String.prototype.toWellFormed
    // to repair one with.
    .replace(/\p{Cs}/gu, "")
    // The bidi controls, which reorder what a file manager draws: a name can
    // be made to read as ending in ".mid" on screen and in something else on
    // disk. U+200C and U+200D stay: they are letters' business (Persian, the
    // Indic scripts) and they hold emoji sequences together.
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    // What Windows forbids in a name, and the separators of both systems. The
    // colon is what also keeps a title out of VS Code's hands: a notification
    // renders [text](command:...) as a link it will run, and with no colon in
    // the title no such link can be spelt.
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return trimDotsAndSpaces(Array.from(title).slice(0, AUDIO_TITLE_MAX).join(""));
}

// Leading and trailing runs of spaces and dots. Windows drops a trailing dot
// or space from a name without saying so, which would make "Reel..." and
// "Reel" the same file, and a title of nothing but dots would name the folder
// above.
function trimDotsAndSpaces(title) {
  return title.replace(/^[\s.]+/, "").replace(/[\s.]+$/, "");
}

// The name a score's audio is written under, beside the document and after it:
// "tunes 3 - The Kesh.mid" for the third score of tunes.mdm. The number comes
// first because it is the one part that is always there and always different,
// and it is the score's place in the document, so a score keeps its own name
// whichever button asked for it. It is not padded: past nine scores a file
// manager does not sort by it, which nobody has asked it to. A reserved Windows name (CON, PRN, LPT1) cannot come out of
// this, since the name always begins with the document's own stem and a
// number.
//
// Null when the format is not one of the two, when the number is not one a
// document could have, or when the document's own name leaves no room for a
// file beside it.
function audioFileName(stem, number, title, format) {
  const spec = audioFormat(format);
  if (!spec) return null;
  if (!Number.isSafeInteger(number) || number < 1 || number > 9999) return null;
  const build = function (part) {
    return stem + " " + number + (part ? " - " + part : "") + spec.ext;
  };
  let clean =
    title === null || title === undefined ? "" : cleanAudioTitle(title);
  let name = build(clean);
  // Over the bound, the title gives way a code point at a time, never half a
  // surrogate pair. When it has given everything and the name is still too
  // long, it is the document's own name that does not fit and no file can be
  // written beside it: the caller says so rather than writing a name it made
  // up. The guard on the empty title is not tidiness. Without it a 251-byte
  // stem spun this loop for ever, having nothing left to take away.
  while (Buffer.byteLength(name, "utf8") > AUDIO_NAME_MAX) {
    if (!clean) return null;
    clean = trimDotsAndSpaces(Array.from(clean).slice(0, -1).join(""));
    name = build(clean);
  }
  return name;
}

// The render itself, which is what bin/mdm does from a terminal: copy the
// .mdm to a .qmd beside it, point the copy at the filter, call Quarto, and
// take the copy away again. Done here rather than shelled out to that script
// so that the export needs no bash, which Windows has not got, and no clone
// of the repository. The copy stays in the document's own folder, so a
// relative path inside it (an image, an include) still points where it did.
//
// Quarto offers the document's other formats in the margin of the HTML, one
// link per format the header declares, and an .mdm usually declares both, so
// `--to html` alone left every page pointing at a PDF that is not there. It
// goes on the command line because Quarto settles the format options before
// the filters run. A document that wants the links keeps them by saying so.
//
// The second filter (FILTER_AFTER) goes on the command line too, and not in
// the header beside the first: Pandoc runs a --lua-filter after the filters
// of the defaults file, which are Quarto's, so it comes last without a word
// about where (measured on 1.9.37), and an entry in the header's list would
// be a line more in it, with every line of the author's under it one off in
// an error about it (withHeaderLines).
function renderArgs(text, copy, extra) {
  const args = ["render", copy];
  if (!/^[ \t]*format-links[ \t]*:/m.test(text)) {
    args.push("-M", "format-links:false");
  }
  args.push("--lua-filter", FILTER_AFTER);
  return args.concat(extra);
}

// One export of a document at a time. Nothing serialises the webview's
// messages: onDidReceiveMessage starts a run of its own for each, and the
// second run found the first run's copy and told the reader that "a file named
// song.qmd is in the way of the export. Rename it or move it", about a file
// the export itself had written and was about to take away (seen on
// 2026-09-13 by sending two export messages in a row). The one that is turned
// away says so, rather than going quiet on a reader who pressed a button.
// Each running export is kept by its document's URI, with the path the
// document is at, which exportingBeside reads.
const exporting = new Map();

// Whether a document other than this one, in the same folder, is being
// exported right now.
function exportingBeside(document, dir) {
  const own = document.uri.toString();
  for (const [key, file] of exporting) {
    if (key !== own && path.dirname(file) === dir) return true;
  }
  return false;
}

async function exportDocument(document, to) {
  const key = document.uri.toString();
  if (exporting.has(key)) {
    vscode.window.showInformationMessage(
      "MDM: " + path.basename(document.uri.fsPath) +
        " is already being exported. Wait for that one to finish."
    );
    return;
  }
  exporting.set(key, document.uri.fsPath);
  try {
    await runExport(document, to);
  } finally {
    exporting.delete(key);
  }
}

// Export = save, then render. Saving first is what makes the export button a
// save button too: what lands in the HTML and the PDF is always what is on
// screen, never a stale file. The look of the editor travels with the call
// (exportLook above), so the HTML comes out dressed as the editor it was
// exported from.
//
// Nothing here is checked when the extension starts. The editor renders and
// plays scores on its own and knows nothing about Quarto; an export is the
// only thing that asks for it, and asking is what tells the user what is
// missing.

async function runExport(document, to) {
  const target = exportTarget(to);
  if (!target) return;
  const wantsPdf = target.outputs.indexOf(".pdf") !== -1;
  const wantsHtml = target.outputs.indexOf(".html") !== -1;
  if (document.isDirty) {
    const saved = await vscode.workspace.save(document.uri);
    if (!saved) return; // an unsaved untitled document, or the user backed out
  }
  const file = document.uri.fsPath;
  const dir = path.dirname(file);
  let text;
  try {
    // Without the byte order mark a file can open with (PowerShell's
    // `-Encoding UTF8`, an old Notepad): VS Code hands the editor the text
    // without it, and with it here no header was found at the head of the
    // file, so the copy was given a header of its own and the document's
    // came out on the page as a paragraph of text.
    text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch (e) {
    exportFailed(
      "the file could not be read for export.",
      "Reading " + file + " failed: " + String(e.message || e)
    );
    return;
  }
  const quarto = findQuarto();
  if (!quarto) {
    quartoMissing();
    return;
  }
  // The road the PDF is asked of ("The two roads to a PDF", above).
  const engine = wantsPdf ? pdfEngine() : null;
  const copy = withoutExtension(file) + ".qmd";
  if (fs.existsSync(copy)) {
    exportNeeds(
      "a file named " + path.basename(copy) + " is in the way of the export. " +
        "Rename it or move it, and export again.",
      "The export renders a copy of the document named " +
        copy +
        ", and something of that name is already there. It is not overwritten.",
      {}
    );
    return;
  }
  const pretty = path.basename(file);
  const base = withoutExtension(file);
  // The LaTeX goes under the name Quarto spells it with, so a document named
  // with a space or a bracket found its `.tex` left beside it after every PDF
  // asked of LaTeX with no TeX, and a reader's own file of that name written
  // over.
  const texPath = path.join(dir, texSafeFilename(path.basename(base)) + ".tex");
  const filesPath = base + "_files";
  const hadTex = fs.existsSync(texPath);
  const hadFiles = fs.existsSync(filesPath);
  const mediabagPath = path.join(filesPath, "mediabag");
  const hadMediabag = fs.existsSync(mediabagPath);
  // The filter's cache of engravings, CACHE_DIR in mdm.lua, which it writes
  // in the folder Quarto runs in (runQuartoStep: the document's).
  const cachePath = path.join(dir, "mdm_cache");
  const hadCache = fs.existsSync(cachePath);
  // The export opens its own entry in the log here, above anything the render
  // itself has to say, so no line of theirs lands under the previous export's
  // header. A PDF's entry names the road it is asked of, which is the first
  // thing whoever reads the log of one has to know.
  channel().appendLine(
    "[" + new Date().toISOString() + "] " + pretty + " \u2192 " + to +
      (engine ? " (mdm.pdfEngine: " + engine + ")" : "")
  );
  // Quarto names its LaTeX after the copy's own stem and leaves it there when
  // the engine fails, so a .tex of the reader's at that name is written over
  // before any guard here can spare it: an 11-byte file came back 14,160
  // bytes of Pandoc's preamble (measured on Quarto 1.9.37, 2026-09-13, with
  // no TeX on the PATH). cleanFailedLatex below only declines to delete it,
  // which is too late. Nothing can stop Quarto writing there, so the file is
  // moved out of the way for the length of the render and put back after it.
  // Only for a render that goes to LaTeX (typesetPdf calls this): the page's
  // never touches it, and neither does a PDF printed from the page.
  const keptTex = texPath + ".mdm-kept-" + process.pid;
  let texAside = false;
  function setTexAside() {
    if (!hadTex || texAside) return;
    try {
      fs.renameSync(texPath, keptTex);
      texAside = true;
    } catch (e) {
      // Not movable: the render will write over it, and saying so is all
      // that is left to do about it.
      channel().appendLine(
        "Could not move " +
          texPath +
          " out of the render's way: " +
          String(e.message || e) +
          ". Quarto may write over it."
      );
    }
  }
  function restoreTex() {
    if (!texAside) return;
    texAside = false;
    try {
      fs.rmSync(texPath, { force: true });
      fs.renameSync(keptTex, texPath);
    } catch (e) {
      channel().appendLine(
        "Could not put " +
          texPath +
          " back: " +
          String(e.message || e) +
          ". It is at " +
          keptTex +
          "."
      );
    }
  }
  const look = exportLook(document, text);
  // Set once the copy is there for Quarto to read (pdfAsks).
  let asks = NO_ASKS;
  // The command line of a render of the copy to one format, the page or a
  // typeset PDF. The PDF is named after the document: Quarto names it after
  // the stem of its LaTeX (texSafeFilename), and a document with a space, a
  // bracket or an apostrophe in its name came out under another name than
  // the one the notice offered to open.
  function argsFor(name) {
    const named = name === "pdf" ? ["--output", path.basename(base) + ".pdf"] : [];
    return renderArgs(text, copy, EXPORT_TARGETS[name].args.concat(named, look));
  }

  // Every Quarto call, announced and logged as it happens: the page, when it
  // is asked for, and a page of its own for a PDF asked alone and printed
  // (printPage); the PDF, when LaTeX typesets it (typesetPdf). A .qmd that
  // fails to write never spawns.
  function runQuartoStep(stepArgs) {
    channel().appendLine("  " + quarto + " " + stepArgs.join(" ") + "  (in " + dir + ")");
    return new Promise(function (resolve) {
      let log = "";
      let child;
      try {
        // windowsHide: Windows opens a console window for a console program
        // started by one that has none, as the extension host has none, and
        // it stood open over the editor for the length of the render.
        child = cp.spawn(quarto, stepArgs, { cwd: dir, windowsHide: true });
      } catch (e) {
        // The same silence as the `error` handler below had, and the report
        // for code -1 now sends the reader to the log: the reason has to be
        // in it.
        const reason = "Quarto could not be started: " + String(e.message || e);
        channel().appendLine(reason);
        resolve({ code: -1, log: reason });
        return;
      }
      child.stdout.on("data", function (d) {
        log += d;
      });
      child.stderr.on("data", function (d) {
        log += d;
      });
      child.on("error", function (e) {
        resolve({ code: -1, log: log + "\n" + String(e.message || e) });
      });
      child.on("close", function (code) {
        if (log) channel().appendLine(log.trimEnd());
        resolve({ code: code, log: log });
      });
    });
  }

  // The printed road: the page, rendered by Quarto and printed by a browser.
  // `ok` says the PDF is at the path asked for. Otherwise `why` is what
  // stopped it, so that the caller does not report one failure as another:
  // "nobrowser" when there is none to print with; "render" with Quarto's own
  // exit code, since a page Quarto could not render is not a missing program
  // and a reader sent to install one would get the same failure back;
  // "nohtml" when Quarto went through without writing the page; "print" when
  // the browser did not print it; and "write" when the PDF it made could not
  // take its place.
  async function printPage() {
    const chrome = findChrome();
    if (!chrome) return { ok: false, why: "nobrowser" };
    // A PDF-only export must not render its intermediate page as doc.html:
    // that could be a previous export the reader means to keep. A temporary
    // .qmd beside the document preserves relative links and gives Quarto a
    // private HTML and _files stem of its own. The serial separates two
    // exports begun in the same millisecond.
    printSerial += 1;
    const scratch =
      base + ".mdm-print-" + process.pid + "-" + Date.now() + "-" + printSerial;
    const scratchCopy = scratch + ".qmd";
    const scratchHtml = scratch + ".html";
    const scratchFiles = scratch + "_files";
    const stagedPdf = scratch + ".pdf";
    // And a page of its own for the print of a "both" whose PDF is asked for
    // what its page is not (pdfAsks): the page beside the document stays the
    // one the header asks for. And for one set in the roman, whose faces on
    // paper are not the ones a screen draws with (PRINT_FACES): the page
    // beside the document keeps the screen's.
    const own = !wantsHtml || asks.page.length > 0 || inRoman(look);
    const htmlPath = own ? scratchHtml : base + ".html";
    // The page's own render, when this is what renders it, for the notices
    // that read the log (citationWarnings).
    let log = "";
    try {
      if (own) {
        fs.copyFileSync(copy, scratchCopy, fs.constants.COPYFILE_EXCL);
        const step = await runQuartoStep(
          renderArgs(
            text,
            scratchCopy,
            EXPORT_TARGETS.html.args.concat(look, asks.page, asks.paper, PRINT_FACES)
          )
        );
        log = step.log;
        if (step.code !== 0) return { ok: false, why: "render", code: step.code, log: log };
      }
      // Otherwise a "both" has rendered its page beside the document before
      // the PDF is tried; nothing can be printed without one.
      if (!isFile(htmlPath)) return { ok: false, why: "nohtml" };
      if (!(await printHtmlToPdf(chrome, htmlPath, stagedPdf))) {
        return { ok: false, why: "print" };
      }
      try {
        fs.renameSync(stagedPdf, base + ".pdf");
      } catch (e) {
        channel().appendLine(
          "Could not put the printed PDF at " +
            base +
            ".pdf: " +
            String(e.message || e)
        );
        // The PDF was made and could not take its place: on Windows a PDF
        // open in a viewer that holds it (Acrobat does) cannot be replaced.
        // That is said as what it is, and not as a program that is missing.
        return { ok: false, why: "write", code: e.code || "" };
      }
      return { ok: true, log: log };
    } catch (e) {
      channel().appendLine("Printing the page failed: " + String(e.message || e));
      return { ok: false, why: "print" };
    } finally {
      [scratchCopy, scratchHtml, stagedPdf].forEach(function (p) {
        try {
          fs.unlinkSync(p);
        } catch (e) {
          // never written, already renamed, or already gone
        }
      });
      try {
        fs.rmSync(scratchFiles, { recursive: true, force: true });
      } catch (e) {
        // the temporary HTML was self-contained, or never rendered
      }
    }
  }

  // The typeset road: LaTeX, through Quarto. `ok` as above. Otherwise `why`
  // is "scores" when the document holds scores that neither road of the
  // filter can draw on this computer (`lack`, from scoresLack), found before
  // Quarto is started, since the filter would only warn and leave them in
  // the PDF as text; "notex" when Quarto found no TeX; and "render" when
  // LaTeX ran and failed, with Quarto's exit code and its log. A document
  // that names a chrome of its own (mdm.chrome) is let through to the
  // filter, which resolves it.
  async function typesetPdf() {
    if (hasScores(text) && !namesChrome(text)) {
      const lack = scoresLack(dir);
      if (lack) return { ok: false, why: "scores", lack: lack };
    }
    setTexAside();
    const step = await runQuartoStep(argsFor("pdf"));
    if (step.code === 0) return { ok: true, log: step.log };
    if (NO_TEX.test(step.log)) {
      cleanFailedLatex();
      return { ok: false, why: "notex", code: step.code, log: step.log };
    }
    removeFailedFolders();
    return { ok: false, why: "render", code: step.code, log: step.log };
  }

  // What a print that did not land ends the export in, whichever road the
  // PDF was asked of. Null for the two the roads answer each in its own way:
  // no browser, and a browser that did not print.
  function printFailure(print, log) {
    if (print.why === "render") return { code: print.code, log: log + print.log };
    if (print.why === "write") return { code: -1, pdfHeld: print.code };
    if (print.why === "nohtml") {
      return {
        code: -1,
        detail: "Quarto finished without writing the page the PDF was to be printed from.",
      };
    }
    return null;
  }

  // A failed LaTeX render leaves these beside the document (measured on
  // Quarto 1.9.37). Remove only artifacts this run created, and never an
  // existing .tex or resource folder belonging to the reader. With no TeX the
  // .tex says nothing, since no LaTeX ever read it.
  function cleanFailedLatex() {
    if (!hadTex) {
      try {
        fs.unlinkSync(texPath);
      } catch (e) {
        // none was left, or it is already gone
      }
    }
    removeFailedFolders();
  }

  // And the folders a failed PDF leaves, whatever it failed on: an empty
  // `<name>_files/mediabag` and the filter's cache, which a reader with no TeX
  // found beside the document after every export, and which a LaTeX error
  // leaves as well, beside the .tex, .aux and .log that say what went wrong
  // and stay (measured on Quarto 1.9.37, 2026-09-14). Only what this run
  // created goes: a folder that was there before is the reader's, or another
  // export's. The files folder of a page asked for beside the PDF can hold
  // that page's resources (a page not self-contained keeps its libs there),
  // so there the mediabag goes, and the folder with it only if nothing else
  // is left in it. The cache is shared by every document of the folder, so it
  // stays while another of them is exporting and may be writing into it.
  function removeFailedFolders() {
    const rm = function (p) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch (e) {
        // none was left, or it is already gone
      }
    };
    if (!hadFiles && !wantsHtml) rm(filesPath);
    else if (!hadMediabag) {
      rm(mediabagPath);
      if (!hadFiles) {
        try {
          fs.rmdirSync(filesPath);
        } catch (e) {
          // not there, or holding the page's own resources
        }
      }
    }
    if (!hadCache && !exportingBeside(document, dir)) rm(cachePath);
  }

  let outcome;
  try {
    outcome = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "MDM: exporting " + pretty + "\u2026",
      },
      async function () {
        try {
          fs.writeFileSync(
            copy,
            withPageKeys(
              withPageTitle(
                withReader(withFilter(withBreaks(text), FILTER), READER),
                path.basename(base)
              )
            )
          );
        } catch (e) {
          // A read-only folder, or a full disk. Quarto never ran, so the
          // "Quarto exited with -1" this used to end in named a program that
          // had not started and left the reader nothing to act on (measured
          // on 2026-09-13 with the document's folder at mode 555).
          return { code: -1, unwritable: String(e.message || e) };
        }
        // What the header asks of the PDF and not of the page (pdfAsks),
        // before any render: the page of a "both" is told what its paper
        // leaves out, and the print what its page needs.
        if (wantsPdf) asks = await pdfAsks(quarto, copy, dir);
        // Every render's log, for what the notices read out of it at the end
        // (citationWarnings, exportTrouble): a "both" warns in each.
        let log = "";
        // The page first, when it is asked for: alone, or ahead of the PDF,
        // which is printed from it or typeset after it.
        if (wantsHtml) {
          const step = await runQuartoStep(argsFor("html").concat(asks.paper));
          log = step.log;
          if (step.code !== 0) {
            // A failed page leaves its empty `_files/mediabag` as a failed PDF
            // does (a bibliography that is not there, measured 2026-09-29), and
            // the same care takes it away.
            removeFailedFolders();
            return { code: step.code, log: log };
          }
        }
        if (!wantsPdf) return { code: 0, log: log };
        if (engine === "latex") {
          const set = await typesetPdf();
          if (set.ok) return { code: 0, log: log + set.log };
          if (set.why === "render") return { code: set.code, log: log + set.log };
          // No TeX, or not the whole of one the scores need: the page is
          // printed in the PDF's place, when a browser is there to print it.
          channel().appendLine(
            set.why === "scores"
              ? "LaTeX cannot draw the scores on this computer, so the page is printed instead."
              : "Quarto found no TeX, so the page is printed instead."
          );
          const print = await printPage();
          if (print.ok) {
            return { code: 0, fallback: "printed", lack: set.lack, log: log + print.log };
          }
          const failed = printFailure(print, log);
          if (failed) return failed;
          return set.why === "scores"
            ? { code: -1, scoresLack: set.lack, printTried: print.why === "print" }
            : { code: set.code, noTex: true };
        }
        const print = await printPage();
        if (print.ok) return { code: 0, log: log + print.log };
        const failed = printFailure(print, log);
        if (failed) return failed;
        if (print.why === "print") return { code: -1, printFailed: true };
        // No browser on this computer: LaTeX typesets the PDF in its place,
        // when it can.
        channel().appendLine(
          "No Chrome, Chromium or Microsoft Edge was found to print the page, so LaTeX typesets the PDF instead."
        );
        const set = await typesetPdf();
        if (set.ok) return { code: 0, fallback: "typeset", log: log + set.log };
        // A render stopped by something of the document's own, a bibliography
        // that is not in its folder or a header that is not YAML, is told as
        // that: a browser would have met it as well.
        if (set.why === "render" && exportTrouble(set.log, pretty, dir, text)) {
          return { code: set.code, log: log + set.log };
        }
        return { code: -1, noBrowser: set.why === "render" ? "latex" : set.why };
      }
    );
  } finally {
    // Whatever happened, and whatever it threw: the copy goes and the
    // reader's own .tex comes back.
    try {
      fs.unlinkSync(copy);
    } catch (e) {
      // never rendered, or already gone: nothing to take away
    }
    restoreTex();
  }
  // What this run did land, for the notices that end in something missing: a
  // "both" writes its page before the PDF half fails.
  const page = wantsHtml && isFile(base + ".html") ? base + ".html" : null;
  if (outcome.pdfHeld !== undefined) {
    const pdfName = path.basename(base) + ".pdf";
    exportFailed(
      "the PDF was made but could not be written over " + pdfName + ". " +
        writeHelp(outcome.pdfHeld, pdfName, dir, "export again", "The reason is in the log."),
      "The printed PDF could not take the place of " + base + ".pdf (" + outcome.pdfHeld + ")."
    );
    return;
  }
  if (outcome.scoresLack) {
    scoresMissing(outcome.scoresLack, dir, outcome.printTried, page);
    return;
  }
  if (outcome.noTex) {
    texMissing(page);
    return;
  }
  if (outcome.noBrowser) {
    browserMissing(outcome.noBrowser, page);
    return;
  }
  // A browser that was there and did not print: a failure, with the
  // browser's own words in the log, and not a road to replace. Its way out is
  // in the log too, since nothing here knows what kept it from printing.
  if (outcome.printFailed) {
    exportFailed(
      "the PDF of " + pretty + " could not be printed. The log says what the browser said." +
        (page ? " " + path.basename(page) + " was exported." : ""),
      "The browser did not print " + pretty + "; what it said is above. To have " +
        "LaTeX typeset the PDF instead, which needs TeX, set mdm.pdfEngine to " +
        "latex in the Settings.",
      page ? { "Open HTML": page } : null
    );
    return;
  }
  if (outcome.unwritable) {
    exportFailed(
      "the export could not write beside " + pretty + ". It has to be in a " +
        "folder this computer can write to.",
      "Writing the copy the export renders, " + copy + ", failed: " +
        outcome.unwritable
    );
    return;
  }
  if (outcome.code !== 0) {
    const trouble = exportTrouble(outcome.log, pretty, dir, text);
    exportFailed(
      trouble ? trouble.summary : "the export of " + pretty + " failed.",
      outcome.detail ||
        (trouble
          ? trouble.detail
          : outcome.code === -1
            ? "Quarto did not run to the end; the reason is above."
            : "Quarto exited with " + outcome.code + ".")
    );
    return;
  }
  const produced = target.outputs.map(function (ext) {
    return base + ext;
  });
  const warned = citationWarnings(outcome.log);
  if (outcome.fallback) {
    fallbackNotice(
      outcome.fallback,
      pretty,
      base + ".pdf",
      wantsHtml ? base + ".html" : null,
      outcome.lack
    );
    // The notice of the other road has its own news to give; what went wrong
    // in the citations comes after it, on its own.
    if (warned) {
      channel().appendLine(warned.detail);
      vscode.window
        .showWarningMessage("MDM: in " + pretty + ", " + warned.summary + ".", "Show log")
        .then(function (choice) {
          if (choice === "Show log") channel().show(true);
        });
    }
    return;
  }
  const names = produced.map(function (p) {
    return path.basename(p);
  });
  const buttons = produced.map(function (p) {
    return "Open " + path.extname(p).slice(1).toUpperCase();
  });
  const opened = function (choice) {
    const i = buttons.indexOf(choice);
    if (i !== -1) vscode.env.openExternal(vscode.Uri.file(produced[i]));
    else if (choice === "Show log") channel().show(true);
  };
  if (warned) {
    channel().appendLine(warned.detail);
    vscode.window
      .showWarningMessage(
        "MDM: exported " + names.join(" and ") + ", but " + warned.summary + ".",
        ...buttons,
        "Show log"
      )
      .then(opened);
    return;
  }
  vscode.window
    .showInformationMessage("MDM: exported " + names.join(" and "), ...buttons)
    .then(opened);
}


// ---------- The audio of a score, as files beside the document ----------
//
// The bytes are made in the webview (media/mdm-audio.js and the export in
// media/main.js): only a browser can sound a tune, since abcjs renders its
// samples through Web Audio. What is left for this side is everything that
// touches the disk, and it is written as though the webview were a stranger,
// because what drives it is a document somebody else may have written: a
// score's T: line reaches here exactly as it was typed, and every name, count
// and payload below is checked before anything is written or shown.
//
// One run is a conversation and not a call. The webview sends `start`, then
// one `file` or `skip` per score, waiting each time for this side to answer,
// and `done` at the end. The waiting is what keeps the memory flat: a WAV is
// 172 kB a second of music and the editor holds one at a time.
//
// Nothing here saves the document first, and that is deliberate. The audio is
// rendered from the text on screen, which is ahead of the file on disk by
// whatever has not been saved, so saving would change nothing about the files
// that come out and would run format-on-save as a side effect of pressing a
// play-and-export button. The document export saves because Quarto reads the
// file from disk (runExport above); this one reads nothing from disk at all.

// Every run of the audio export, by the URI of its document. Its own map and
// not `exporting` above: the audio writes no .qmd, no mdm_cache and no _files,
// so a document can be rendered to PDF and sounded to WAV at the same time
// without either run touching what the other left. One run per document all
// the same, since two would write the same names.
const exportingAudio = new Map();

// The General MIDI programs by the names abcjs knows them under
// (instrumentIndexToName in the vendored bundle, 129 entries: the 128 of the
// standard, and "percussion" at 128 for channel 10). Kept here because a score
// that was skipped has to say which instrument it asked for, and this side has
// no abcjs to ask: the webview sends the number, and the reader reads "violin".
const GM_INSTRUMENTS = (
  "acoustic_grand_piano bright_acoustic_piano electric_grand_piano " +
  "honkytonk_piano electric_piano_1 electric_piano_2 harpsichord " +
  "clavinet celesta glockenspiel music_box vibraphone marimba xylophone " +
  "tubular_bells dulcimer drawbar_organ percussive_organ rock_organ " +
  "church_organ reed_organ accordion harmonica tango_accordion " +
  "acoustic_guitar_nylon acoustic_guitar_steel electric_guitar_jazz " +
  "electric_guitar_clean electric_guitar_muted overdriven_guitar " +
  "distortion_guitar guitar_harmonics acoustic_bass " +
  "electric_bass_finger electric_bass_pick fretless_bass slap_bass_1 " +
  "slap_bass_2 synth_bass_1 synth_bass_2 violin viola cello contrabass " +
  "tremolo_strings pizzicato_strings orchestral_harp timpani " +
  "string_ensemble_1 string_ensemble_2 synth_strings_1 synth_strings_2 " +
  "choir_aahs voice_oohs synth_choir orchestra_hit trumpet trombone " +
  "tuba muted_trumpet french_horn brass_section synth_brass_1 " +
  "synth_brass_2 soprano_sax alto_sax tenor_sax baritone_sax oboe " +
  "english_horn bassoon clarinet piccolo flute recorder pan_flute " +
  "blown_bottle shakuhachi whistle ocarina lead_1_square " +
  "lead_2_sawtooth lead_3_calliope lead_4_chiff lead_5_charang " +
  "lead_6_voice lead_7_fifths lead_8_bass_lead pad_1_new_age pad_2_warm " +
  "pad_3_polysynth pad_4_choir pad_5_bowed pad_6_metallic pad_7_halo " +
  "pad_8_sweep fx_1_rain fx_2_soundtrack fx_3_crystal fx_4_atmosphere " +
  "fx_5_brightness fx_6_goblins fx_7_echoes fx_8_scifi sitar banjo " +
  "shamisen koto kalimba bagpipe fiddle shanai tinkle_bell agogo " +
  "steel_drums woodblock taiko_drum melodic_tom synth_drum " +
  "reverse_cymbal guitar_fret_noise breath_noise seashore bird_tweet " +
  "telephone_ring helicopter applause gunshot percussion"
).split(" ");

function instrumentName(program) {
  if (!Number.isSafeInteger(program)) return null;
  if (program < 0 || program >= GM_INSTRUMENTS.length) return null;
  return GM_INSTRUMENTS[program].replace(/_/g, " ");
}

// The reasons a score can come back unsounded. Anything else the webview says
// is read as "failed", which is the one of these that sends the reader to the
// log: an unknown word must never be repeated into a notification.
const AUDIO_SKIPS = ["empty", "instrument", "range", "unsupported", "failed"];

// Everything the audio export says to the reader, in one place. The wording is
// the owner's and is being settled on a design sheet, so a line that changes
// changes here and not in five branches of the run below. exportFailed and
// exportNeeds put "MDM: " in front of what they are given, and the two that go
// straight to a notification carry it themselves.
const AUDIO_SAYS = {
  progress: function (pretty) {
    return "MDM: exporting the audio of " + pretty + "\u2026";
  },
  one: function (name) {
    return "MDM: exported " + name;
  },
  many: function (n, label, pretty) {
    return "MDM: exported " + n + " " + label + " files beside " + pretty;
  },
  busy: function (pretty) {
    return (
      "MDM: the audio of " + pretty + " is already being exported. " +
      "Wait for that one to finish."
    );
  },
  unsaved: function (pretty) {
    return (
      "MDM: save " + pretty + " first. The audio files are written in the " +
      "folder the document is saved in."
    );
  },
  // The editor counts the scores off the syntax tree, and a document long
  // enough that the parser has not reached the end of it yet has no count to
  // give. Saying "no score" there would be a lie, and writing what has been
  // read so far would be half a document.
  unread: function (pretty) {
    return (
      "MDM: " + pretty + " is still being read. Try the export again in a " +
      "moment."
    );
  },
  // The document has scores and the run has no file to write: the score the
  // button belonged to was not where the editor last saw it, which is what an
  // edit from another window, or a source still settling, leaves behind.
  gone: function (pretty) {
    return (
      "MDM: that score is not where it was in " + pretty + ". Press its " +
      "button again."
    );
  },
  noScore: function (pretty) {
    return (
      "MDM: " + pretty + " has no score to export as audio. A score is a " +
      "block fenced as ```abc."
    );
  },
  // After the sentences about what was skipped, so that the reader is told
  // first what needs doing and then what is already there.
  rest: function (n, label, pretty) {
    return (
      " The other " + (n === 1 ? "score was" : n + " scores were") +
      " written as " + label + " beside " + pretty + "."
    );
  },
  failed: function (pretty, help) {
    return "the audio of " + pretty + " could not be written. " + help;
  },
  // For what only the log can explain: bytes that were not a file of the
  // format asked for, and a code the system gave that has no advice of its
  // own. The notice carries a "Show log" button either way.
  look: "The log says what went wrong.",
};

// What a score that was not written says, and what the reader can do about it.
// One sentence per score, named by its place in the document and by its title,
// which is how the reader finds it again.
function audioSkipLine(skip) {
  const at = "score " + skip.number + (skip.title ? " (" + skip.title + ")" : "");
  if (skip.reason === "instrument") {
    const name = instrumentName(skip.program);
    return (
      at + " asks for an instrument the editor does not have" +
      (name ? " (" + name + ")" : "") +
      ". Only the piano comes with it: export that score as MIDI, or take " +
      "its %%MIDI program line out."
    );
  }
  if (skip.reason === "range") {
    return (
      at + " has a note above C8, the top key of the piano the editor " +
      "carries. Move it down an octave, or export that score as MIDI."
    );
  }
  if (skip.reason === "empty") return at + " has no notes to play.";
  if (skip.reason === "unsupported") {
    return (
      at + " could not be sounded: this window has no audio. Run " +
      "Developer: Reload Window and export again."
    );
  }
  return at + " could not be rendered. " + AUDIO_SAYS.look;
}

// What a failed write tells the reader to do, by the code the system gave
// back. It names the file and the folder rather than the call that failed: the
// thing to do about EBUSY is to close whatever is holding the file, and a
// musician has no use for the name of a system call.
// `again` is what to do once the cause is seen to, "export again" for the
// audio and "paste again" for a picture (pasteImageStep), and `fallback`
// what to say for a code with no advice of its own.
function writeHelp(code, name, dir, again, fallback) {
  if (code === "EBUSY" || code === "EPERM") {
    return "Close " + name + " in the program that has it open, and " + again + ".";
  }
  if (code === "EACCES" || code === "EROFS") {
    return (
      "The folder " + dir + " cannot be written to. Save the document in a " +
      "folder this computer can write to, and " + again + "."
    );
  }
  if (code === "ENOSPC") return "The disk is full.";
  if (code === "ENAMETOOLONG") {
    return (
      "The name of the document is too long for a file to be written beside " +
      "it. Rename it shorter and " + again + "."
    );
  }
  // The guard below the name, which no title can trip: what reaches it is a
  // document whose own name is not a plain name on one of the two systems.
  // "a:b.mdm" is the case that exists, legal on Linux and read by the Windows
  // rules as the drive a: and a file b on it.
  if (code === "EINVAL") {
    return (
      "The name of the document cannot be made part of a file name beside " +
      "it. Rename it and " + again + "."
    );
  }
  return fallback;
}
function audioWriteHelp(code, name, dir) {
  return writeHelp(code, name, dir, "export again", AUDIO_SAYS.look);
}

// "MThd" and a header six bytes long, which is how every standard MIDI file
// begins and what media/mdm-audio.js writes (midiBytes).
function midiLooksRight(bytes) {
  return (
    bytes.length >= 14 &&
    bytes.toString("latin1", 0, 4) === "MThd" &&
    bytes.readUInt32BE(4) === 6
  );
}

// A RIFF/WAVE header whose size field agrees with the length of what arrived,
// 16-bit PCM as mdm-audio.js writes it (wavBytes). The size is what a player
// reads to know where the file ends, so a payload that was cut in flight is
// caught here rather than written as a file that opens and plays silence.
function wavLooksRight(bytes) {
  return (
    bytes.length >= 44 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WAVE" &&
    bytes.readUInt32LE(4) === bytes.length - 8 &&
    bytes.readUInt16LE(20) === 1 &&
    bytes.readUInt16LE(34) === 16
  );
}

// The bytes of one file, or null. Only a real Uint8Array or ArrayBuffer is
// taken: Buffer.from is glad to make something out of a plain array, an object
// with number keys, a string (read as latin1) and anything carrying a
// byteLength, and this is the one door into the extension that a document
// could shape what comes through. The magic is checked too, so that a run that
// asked for WAV cannot write MIDI into a .wav no player will open.
function audioBytes(value, format) {
  const spec = audioFormat(format);
  if (!spec) return null;
  let bytes = null;
  if (value instanceof Uint8Array) {
    // The view and not the buffer under it: what the webview sends can be a
    // window into a larger buffer, and Buffer.from(value.buffer) alone would
    // write the whole of it.
    bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } else if (value instanceof ArrayBuffer) {
    bytes = Buffer.from(value, 0, value.byteLength);
  }
  if (!bytes || bytes.length > spec.max) return null;
  if (format === "midi") return midiLooksRight(bytes) ? bytes : null;
  return wavLooksRight(bytes) ? bytes : null;
}

// A title on the wire: null, undefined or a string, and nothing else. Cut
// before it is cleaned, so that a megabyte of T: line is not normalised and
// scanned five times over on its way to being thrown away.
const AUDIO_TITLE_WIRE = 1000;

function audioTitleOf(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") return null;
  return cleanAudioTitle(raw.slice(0, AUDIO_TITLE_WIRE));
}

// One line of the run's own entry in the log, under the header start wrote.
function audioLog(line) {
  channel().appendLine("  " + line);
}

// One report per score, written or skipped, on the notification the run put
// up. Nothing else moves it: the webview sends one message per score and the
// count on screen is the count of scores dealt with.
function audioProgress(run) {
  if (!run.progress) return;
  run.progress.report({
    message: run.written.length + run.skipped.length + " of " + run.total,
  });
}

// The end of a run, however it comes: `done` from the webview, the reader
// pressing cancel, the webview reloading, the panel closing, or something
// throwing in the middle. The lock and the notification are released here and
// nowhere else, and only a run that reached `done` reports what it did: a
// reader who cancelled or closed the editor has said what they think of the
// run and does not need a toast about it, and the log keeps the count either
// way.
function endAudioRun(key, why) {
  const run = exportingAudio.get(key);
  if (!run) return null;
  exportingAudio.delete(key);
  run.live = false;
  if (run.close) run.close();
  audioLog(
    why + ": " + run.written.length + " written, " + run.skipped.length +
      " skipped, of " + run.total + "."
  );
  if (why === "done") audioRunReport(run);
  return run;
}

// What the reader is told when a run has finished: one notification, whichever
// it is. A run with something skipped says so through exportNeeds, which is
// the warning that names what is missing and offers the way to it, because a
// score that was not written is exactly that; the file that was written all
// the same is offered beside it.
function audioRunReport(run) {
  const label = run.spec.label;
  const wrote = run.written.length;
  if (run.skipped.length) {
    const files = {};
    if (wrote) files["Open folder"] = run.dir;
    exportNeeds(
      run.skipped.map(audioSkipLine).join(" ") +
        (wrote ? AUDIO_SAYS.rest(wrote, label, run.pretty) : ""),
      run.skipped.length + " of " + run.total + " scores were not written.",
      {},
      files
    );
    return;
  }
  if (wrote === 1) {
    const button = "Open " + label;
    const at = path.join(run.dir, run.written[0].name);
    vscode.window
      .showInformationMessage(AUDIO_SAYS.one(run.written[0].name), button)
      .then(function (choice) {
        if (choice === button) vscode.env.openExternal(vscode.Uri.file(at));
      });
    return;
  }
  if (wrote > 1) {
    vscode.window
      .showInformationMessage(
        AUDIO_SAYS.many(wrote, label, run.pretty),
        "Open folder"
      )
      .then(function (choice) {
        if (choice === "Open folder") {
          vscode.env.openExternal(vscode.Uri.file(run.dir));
        }
      });
  }
  // Nothing written and nothing skipped: the webview found nothing to send
  // after all, and the log above is the whole of it.
}

// A run that cannot go on: the file in hand could not be written, or what
// arrived for it was not a file of the format asked for. The webview is told
// so that it stops rendering the scores after this one, since the next would
// fail the same way, and the reader gets the error with the log behind it.
function stopAudioRun(run, webview, number, help, detail) {
  webview.postMessage({
    type: "exportAudio",
    id: run.id,
    number: number,
    ok: false,
    error: help,
  });
  endAudioRun(run.key, "stopped");
  exportFailed(AUDIO_SAYS.failed(run.pretty, help), detail);
}

// Written under a name of its own and moved into place, so that a reader
// watching the folder never sees a half-written .wav and a run that dies in
// the middle leaves nothing that looks playable. Returns the error, or null.
// An existing file of the same name is written over without asking, which is
// what the HTML and PDF export does with its own two names.
function writeAudioFile(dir, name, bytes) {
  const full = path.join(dir, name);
  const part = full + AUDIO_PART_SUFFIX;
  try {
    fs.writeFileSync(part, bytes);
    fs.renameSync(part, full);
    return null;
  } catch (e) {
    try {
      fs.rmSync(part, { force: true });
    } catch (e2) {
      // never written, or already renamed away
    }
    return e;
  }
}

// A message of a run, from the webview. onDidReceiveMessage does not serialise
// its calls (see `exporting` above, and applyingFromWebview below), so `start`
// registers the run before anything that could yield, or a `file` arriving in
// the same tick would find no run to belong to. Keeping the whole step
// synchronous is the simplest way to hold that true: the bytes go out through
// the synchronous fs calls, and the notification is started and left running.
function exportAudioStep(document, webview, msg) {
  const key = document.uri.toString();
  try {
    const id = msg.id;
    // The id is the webview's own and is only ever compared, but its shape is
    // checked all the same, so that a message of a run that is over cannot be
    // taken for one of the run that is open.
    if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id)) return;
    if (msg.step === "start") {
      audioRunStart(document, webview, key, id, msg);
      return;
    }
    const run = exportingAudio.get(key);
    if (!run || !run.live || run.id !== id) return;
    if (msg.step === "file") audioRunFile(run, webview, msg);
    else if (msg.step === "skip") audioRunSkip(run, webview, msg);
    else if (msg.step === "done") endAudioRun(key, "done");
  } catch (e) {
    // Whatever threw in there, and a field of the message that is a getter is
    // enough, the lock must not be left held and the notification must not be
    // left turning for ever.
    const detail = "The audio export stopped: " + String((e && e.stack) || e);
    const run = endAudioRun(key, "stopped");
    if (!run) {
      channel().appendLine(detail);
      return;
    }
    webview.postMessage({
      type: "exportAudio",
      id: run.id,
      ok: false,
      error: AUDIO_SAYS.look,
    });
    exportFailed(AUDIO_SAYS.failed(run.pretty, AUDIO_SAYS.look), detail);
  }
}

// `start`: the first message of a run, and the only one that can refuse it.
function audioRunStart(document, webview, key, id, msg) {
  const spec = audioFormat(msg.format);
  const count = msg.count;
  const total = msg.total;
  const answer = function (ok) {
    webview.postMessage({ type: "exportAudio", id: id, ok: ok });
  };
  // The shape of the message first, and in silence: this is the extension's
  // own protocol and not anything the reader did, so a message that does not
  // keep it is dropped the way runExport drops a format nobody offers.
  if (!spec) return;
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(total)) return;
  if (count < 0 || count > 9999 || total < 0 || total > count) return;
  const pretty =
    document.uri.scheme === "file"
      ? path.basename(document.uri.fsPath)
      : path.basename(document.uri.path) || "this document";
  // The files go in the folder the document is saved in, so a document that is
  // not saved has nowhere to put them. An untitled document is the case that
  // reaches this.
  if (document.uri.scheme !== "file") {
    answer(false);
    vscode.window.showInformationMessage(AUDIO_SAYS.unsaved(pretty));
    return;
  }
  if (exportingAudio.has(key)) {
    answer(false);
    vscode.window.showInformationMessage(AUDIO_SAYS.busy(pretty));
    return;
  }
  // Nothing to do, and a notification that came up and went again would be the
  // only sign of a button that did nothing. The reader is told what a score is
  // instead, which is what somebody pressing this on a document without one
  // needs to know.
  if (total === 0) {
    answer(false);
    vscode.window.showInformationMessage(
      msg.unread === true
        ? AUDIO_SAYS.unread(pretty)
        : count > 0
        ? AUDIO_SAYS.gone(pretty)
        : AUDIO_SAYS.noScore(pretty)
    );
    return;
  }
  const file = document.uri.fsPath;
  const run = {
    id: id,
    key: key,
    format: msg.format,
    spec: spec,
    count: count,
    total: total,
    dir: path.dirname(file),
    stem: withoutExtension(path.basename(file)),
    pretty: pretty,
    seen: new Set(),
    written: [],
    skipped: [],
    live: true,
    progress: null,
    close: null,
  };
  // In the map before the answer goes out and before the notification is asked
  // for: the webview sends its first `file` as soon as it has one, and nothing
  // between here and there may leave the run unfindable.
  exportingAudio.set(key, run);
  answer(true);
  channel().appendLine(
    "[" + new Date().toISOString() + "] " + pretty + " \u2192 " + spec.label +
      " audio (" + total + " of " + count + (count === 1 ? " score)" : " scores)")
  );
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: AUDIO_SAYS.progress(pretty),
      cancellable: true,
    },
    function (progress, token) {
      run.progress = progress;
      if (token && token.onCancellationRequested) {
        token.onCancellationRequested(function () {
          if (!run.live) return;
          webview.postMessage({ type: "exportAudio", id: run.id, cancel: true });
          endAudioRun(run.key, "cancelled");
        });
      }
      // Not awaited anywhere: a run is a conversation, so the notification is
      // held open by hand and taken down by endAudioRun when the last message
      // arrives. The guard is for a VS Code that calls this back later than it
      // is asked to, which would otherwise leave a notification nobody can
      // resolve.
      return new Promise(function (resolve) {
        if (!run.live) resolve();
        else run.close = resolve;
      });
    }
  );
}

// `file`: the bytes of one score. Everything that could be wrong with it is
// wrong with the message and not with the music, so it ends the run rather
// than being counted as a score that could not be sounded.
function audioRunFile(run, webview, msg) {
  const number = msg.number;
  if (!Number.isSafeInteger(number) || number < 1 || number > run.count) return;
  if (run.seen.has(number)) return;
  const title = audioTitleOf(msg.title);
  if (title === null) {
    stopAudioRun(
      run,
      webview,
      number,
      AUDIO_SAYS.look,
      "Score " + number + " came with a title that is not text; nothing was written."
    );
    return;
  }
  const bytes = audioBytes(msg.bytes, run.format);
  if (!bytes) {
    stopAudioRun(
      run,
      webview,
      number,
      AUDIO_SAYS.look,
      "What arrived for score " + number + " is not a " + run.spec.label +
        " file; nothing was written."
    );
    return;
  }
  const name = audioFileName(run.stem, number, title, run.format);
  // No name means the document's own name fills the whole of what a file name
  // may be (audioFileName), which is what the system would answer with
  // ENAMETOOLONG. A name that is not a plain name on both systems is the other
  // thing that can be wrong with the document's own name, and it is not the
  // same thing, so it does not send the reader to shorten a name that is
  // already short.
  const plain =
    !!name &&
    path.posix.basename(name) === name &&
    path.win32.basename(name) === name &&
    path.dirname(path.join(run.dir, name)) === run.dir;
  if (!plain) {
    const help = audioWriteHelp(name ? "EINVAL" : "ENAMETOOLONG", "", run.dir);
    stopAudioRun(
      run,
      webview,
      number,
      help,
      "No file name could be made for score " + number + " beside " +
        run.pretty + "."
    );
    return;
  }
  const failure = writeAudioFile(run.dir, name, bytes);
  if (failure) {
    const help = audioWriteHelp(failure.code, name, run.dir);
    stopAudioRun(
      run,
      webview,
      number,
      help,
      "Writing " + path.join(run.dir, name) + " failed: " +
        String(failure.message || failure)
    );
    return;
  }
  run.seen.add(number);
  run.written.push({ number: number, name: name, size: bytes.length });
  audioLog("wrote " + name + " (" + bytes.length + " bytes)");
  audioProgress(run);
  webview.postMessage({
    type: "exportAudio",
    id: run.id,
    number: number,
    ok: true,
  });
}

// `skip`: a score the webview could not sound, which is not a failure of the
// run. It is counted, logged with whatever detail came with it, and named to
// the reader at the end.
function audioRunSkip(run, webview, msg) {
  const number = msg.number;
  if (!Number.isSafeInteger(number) || number < 1 || number > run.count) return;
  if (run.seen.has(number)) return;
  const title = audioTitleOf(msg.title);
  const reason =
    AUDIO_SKIPS.indexOf(msg.reason) === -1 ? "failed" : msg.reason;
  const program = Number.isSafeInteger(msg.program) &&
    msg.program >= 0 &&
    msg.program <= 128
      ? msg.program
      : null;
  // The detail is the webview's own account of what went wrong, and it goes to
  // the log and never to a notification: it is the one string here that
  // nothing shortens into a sentence a reader can act on.
  const detail =
    typeof msg.detail === "string"
      ? msg.detail.slice(0, 2000).replace(/\s+/g, " ").trim()
      : "";
  run.seen.add(number);
  run.skipped.push({
    number: number,
    title: title === null ? "" : title,
    reason: reason,
    program: program,
  });
  audioLog(
    "score " + number + " skipped (" + reason + ")" + (detail ? ": " + detail : "")
  );
  audioProgress(run);
  webview.postMessage({
    type: "exportAudio",
    id: run.id,
    number: number,
    ok: true,
  });
}

// ---------- A picture pasted or dropped, as a file beside the document ----------
//
// The webview sends the bytes of a picture from the clipboard or a drop
// (pastePictures in media/main.js), and the host writes them beside the
// document and answers with the path it wrote them under, which the editor
// writes into the text as `![](path)`. Beside the document because that is
// where a relative path resolves from, for the editor and for Quarto alike;
// in a folder of the document's own, named after it (`songbook-images` beside
// `songbook.mdm`), so that two documents in one folder keep their pictures
// apart and the folder says whose it is. A file already there is never
// written over: the picture is new, and the one under that name may be in
// the text already. The name is the file's own when a drop gave it one, and
// `image` otherwise, which is what Chrome names a screenshot on the
// clipboard; a name taken is numbered on from 2.

// The kinds written, by the type the browser reports, and the file name
// extension each is written under; media/main.js sends these and no other.
const PICTURE_KINDS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};
const PICTURE_FOLDER_SUFFIX = "-images";
// A cap on what one paste may write: a screenshot is under a megabyte and a
// photograph under twenty, and a document is not the place for more.
const PICTURE_MAX = 64 * 1024 * 1024;
const PICTURE_NAME_MAX = 64;

const PICTURE_SAYS = {
  unsaved: function (pretty) {
    return (
      "MDM: save " + pretty + " first. A pasted picture is written in the " +
      "folder the document is saved in."
    );
  },
  notPicture: function (pretty) {
    return (
      "MDM: what was pasted into " + pretty + " is not a picture the editor " +
      "writes (PNG, JPEG, GIF, WebP, SVG or BMP), and nothing was written."
    );
  },
  tooLarge: function (pretty) {
    return (
      "MDM: the picture pasted into " + pretty + " is over 64 MB and was not " +
      "written. Save it beside the document by hand and link it with the " +
      "picture button."
    );
  },
  failed: function (pretty, help) {
    return "MDM: the picture pasted into " + pretty + " could not be written. " + help;
  },
  look: "See the MDM output for what went wrong (View > Output, MDM).",
};

// Whether the bytes open as a file of the kind the browser said, so that
// what is written under `.png` is a PNG: the signatures of the binary kinds
// (PNG, JPEG, GIF, WebP and BMP each begin the same way in every file), and
// for SVG the `<svg` or `<?xml` a text file of it opens with, anywhere in
// its first kilobyte since a comment or a doctype may come first.
function pictureLooksRight(bytes, ext) {
  const head = function (text) {
    return bytes.length >= text.length && bytes.toString("latin1", 0, text.length) === text;
  };
  if (ext === "png") return head("\x89PNG\r\n\x1a\n");
  if (ext === "jpg") return head("\xff\xd8\xff");
  if (ext === "gif") return head("GIF87a") || head("GIF89a");
  if (ext === "webp") return head("RIFF") && bytes.length >= 12 && bytes.toString("latin1", 8, 12) === "WEBP";
  if (ext === "bmp") return head("BM");
  if (ext === "svg") return /<svg[\s>]|<\?xml[\s>]/i.test(bytes.toString("utf8", 0, Math.min(bytes.length, 1024)));
  return false;
}

// The bytes of one picture, or null. Only a real Uint8Array or ArrayBuffer is
// taken, for the reason audioBytes gives: Buffer.from would make something
// out of a string or an array too, and this is a door into the extension.
function pictureBytes(value) {
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value, 0, value.byteLength);
  return null;
}

// The stem a picture is written under, from the name the browser gave the
// file: its own folder and extension off (the kind decides the extension),
// what no filesystem takes out of it, and `image` when nothing is left or
// what is left is a name Windows keeps for a device; cut to a length, since
// a name off a web page can run to hundreds of characters.
function pictureStem(given) {
  let stem = typeof given === "string" ? given.normalize("NFC") : "";
  stem = stem.replace(/\\/g, "/");
  stem = stem.slice(stem.lastIndexOf("/") + 1);
  stem = stem.replace(/\.[^.]*$/, "");
  stem = stem.replace(/[\x00-\x1f\x7f-\x9f<>:"|?*]/g, "");
  stem = trimDotsAndSpaces(Array.from(stem).slice(0, PICTURE_NAME_MAX).join(""));
  if (!stem || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem)) return "image";
  return stem;
}

// A relative path as it goes into a link destination: each segment
// percent-encoded past the letters, digits and `-._~` that need no escape,
// so a space or a parenthesis in the document's own name does not end the
// destination (CommonMark 6.3 stops at a space, and counts parentheses).
// Pandoc undoes the escapes when it fetches a local file, and the editor
// resolves the path as a URL, so both find the file under its own name.
function encodedPath(rel) {
  return rel
    .split("/")
    .map(function (segment) {
      return encodeURIComponent(segment).replace(/[!'()*]/g, function (c) {
        return "%" + c.charCodeAt(0).toString(16).toUpperCase();
      });
    })
    .join("/");
}

// The file created and written, under the first free name: the stem, then
// the stem numbered on from 2. Created exclusively (`wx`), so that a name
// taken between the look and the write is a name taken and not a file
// overwritten. Returns the name written, or throws the error the system gave.
function writePictureFile(dir, stem, ext, bytes) {
  for (let n = 1; ; n++) {
    const name = stem + (n > 1 ? "-" + n : "") + "." + ext;
    let fd;
    try {
      fd = fs.openSync(path.join(dir, name), "wx");
    } catch (e) {
      if (e.code === "EEXIST") continue;
      throw e;
    }
    try {
      fs.writeSync(fd, bytes);
    } finally {
      fs.closeSync(fd);
    }
    return name;
  }
}

// `pasteImage`, from the webview: one picture, answered with the path it was
// written under or with `ok: false`, the reason said in a message, since the
// webview has no notifications of its own. The shape of the message first,
// and in silence, as the audio's steps are: it is the extension's own
// protocol and not anything the reader did.
function pasteImageStep(document, webview, msg) {
  if (typeof msg.id !== "string" || !msg.id || msg.id.length > 64) return;
  const ext = PICTURE_KINDS[msg.mime];
  if (!ext) return;
  const answer = function (ok, rel) {
    webview.postMessage({ type: "pasteImage", id: msg.id, ok: ok, path: ok ? rel : null });
  };
  const pretty =
    document.uri.scheme === "file"
      ? path.basename(document.uri.fsPath)
      : path.basename(document.uri.path) || "this document";
  // The folder is the document's, so a document that is not saved has none.
  if (document.uri.scheme !== "file") {
    answer(false);
    vscode.window.showInformationMessage(PICTURE_SAYS.unsaved(pretty));
    return;
  }
  const bytes = pictureBytes(msg.bytes);
  if (!bytes) return;
  if (bytes.length > PICTURE_MAX) {
    answer(false);
    vscode.window.showWarningMessage(PICTURE_SAYS.tooLarge(pretty));
    return;
  }
  if (!bytes.length || !pictureLooksRight(bytes, ext)) {
    answer(false);
    vscode.window.showWarningMessage(PICTURE_SAYS.notPicture(pretty));
    return;
  }
  const file = document.uri.fsPath;
  const folder = path.basename(file, path.extname(file)) + PICTURE_FOLDER_SUFFIX;
  const dir = path.join(path.dirname(file), folder);
  const stem = pictureStem(msg.name);
  let name;
  try {
    fs.mkdirSync(dir, { recursive: true });
    name = writePictureFile(dir, stem, ext, bytes);
  } catch (e) {
    answer(false);
    channel().appendLine("Writing a picture beside " + file + " failed: " + String(e.message || e));
    vscode.window
      .showErrorMessage(
        PICTURE_SAYS.failed(pretty, writeHelp(e.code, stem + "." + ext, dir, "paste again", PICTURE_SAYS.look)),
        "Show log"
      )
      .then(function (choice) {
        if (choice === "Show log") channel().show(true);
      });
    return;
  }
  channel().appendLine("wrote " + path.join(dir, name) + " (" + bytes.length + " bytes), pasted into " + pretty);
  answer(true, encodedPath(folder + "/" + name));
  pictureTurn(() => givePicture(document.uri.toString(), folder + "/" + name));
}

// ---------- The pictures a document was given, taken back when it is saved without them ----------
//
// A pasted picture stays in its folder while the text changes: a picture
// deleted from the text may come back with an undo, and nothing is lost
// until the reader says the document is what it should be, which is a save.
// A document saved without a picture it was given sends that file to the
// system's trash, and its folder after it once nothing is left in the folder
// (the owner's call, 2026-09-27). To the trash and not deleted, so a picture
// wanted back after all is where a reader looks for a file they threw away;
// and while the editor runs its bytes are kept as well, so an undo that
// brings the picture back into the text puts the file back beside it at
// once, where the reader would otherwise find a broken picture.
//
// Only the files the editor wrote are ever touched: the paths are kept per
// document, by URI, in globalState (DOCUMENT_PICTURES), from the paste that
// wrote them to the save that no longer mentions them. A picture the reader
// put in the folder by hand, or one the list lost with a document renamed or
// moved, is left alone; the folder is taken away only when it is empty, or
// holds nothing but the files a file browser leaves in any folder it opens.
const DOCUMENT_PICTURES = "documentPictures";
const FOLDER_LITTER = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
// The bytes of the pictures sent to the trash, kept for an undo while the
// editor runs, the oldest let go past this much: they are in the trash still.
const TRASHED_KEPT_MAX = 64 * 1024 * 1024;

// The pictures given, by document URI. Anything but an object of lists of
// strings is read as nothing given, as keptDivisions reads its own.
function givenPictures() {
  const all = globalState ? globalState.get(DOCUMENT_PICTURES) : undefined;
  return all && typeof all === "object" && !Array.isArray(all) ? all : {};
}
// Only a path of the shape the paste writes, a folder ending in the suffix
// and a name in it, is ever read back: the sweep sends what it names to the
// trash, and globalState is JSON off the disk, so a path that climbs out of
// the document's folder (`..`) or into another is not taken on trust.
const GIVEN_PICTURE = new RegExp("^[^/\\\\]+" + PICTURE_FOLDER_SUFFIX + "/[^/\\\\]+$");
function picturesOf(uri) {
  const all = givenPictures();
  const list = Object.prototype.hasOwnProperty.call(all, uri) ? all[uri] : null;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (rel) => typeof rel === "string" && GIVEN_PICTURE.test(rel) && !rel.split("/").some((seg) => seg === ".." || seg === ".")
  );
}
// The list of a document written back, the document moved to the end as the
// one used last and the oldest forgotten past DOCUMENTS_KEPT; an empty list
// takes the document out.
function keepPictures(uri, list) {
  if (!globalState) return Promise.resolve();
  const all = Object.assign({}, givenPictures());
  delete all[uri];
  if (list.length) all[uri] = list;
  const uris = Object.keys(all);
  uris.slice(0, Math.max(0, uris.length - DOCUMENTS_KEPT)).forEach((u) => {
    delete all[u];
  });
  return globalState.update(DOCUMENT_PICTURES, all);
}
function givePicture(uri, rel) {
  const list = picturesOf(uri).filter((r) => r !== rel);
  list.push(rel);
  return keepPictures(uri, list);
}

// Every change to the lists goes through one turn, so that a save's sweep and
// a paste that lands while it waits on the trash do not write over each other.
let pictureQueue = Promise.resolve();
function pictureTurn(task) {
  const run = pictureQueue.then(task, task);
  pictureQueue = run.catch(() => {});
  return run;
}

// Whether the text still points at a picture, read wide: its path or its
// name alone, as written or as the paste escaped it, in the text as it
// stands or with its escapes undone. A picture named anywhere is kept, in a
// definition, in raw HTML, in a link of another folder that shares its name:
// keeping a file the text no longer needs costs a file, and taking one it
// still needs costs the picture.
function pictureMentioned(text, rel) {
  let decoded = text;
  try {
    decoded = decodeURI(text);
  } catch (e) {
    // A stray percent sign: the text as it stands is read twice.
  }
  const name = path.posix.basename(rel);
  const forms = [rel, encodedPath(rel), name, encodedPath(name)];
  return forms.some((form) => text.includes(form) || decoded.includes(form));
}

// The folder taken away when nothing is left in it but a file browser's own
// litter. rmdir refuses a folder that is not empty, so a file that arrives
// between the look and the removal keeps the folder.
function removeIfEmpty(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return;
  }
  if (names.some((n) => !FOLDER_LITTER.has(n))) return;
  try {
    names.forEach((n) => fs.rmSync(path.join(dir, n), { force: true }));
    fs.rmdirSync(dir);
    channel().appendLine("removed " + dir + ", which held no picture any more");
  } catch (e) {
    // In use, or no longer empty: left where it is.
  }
}

// The bytes of the pictures sent to the trash, by "uri\npath", oldest first.
const trashedPictures = new Map();
let trashedBytes = 0;
function keepTrashed(uri, rel, bytes) {
  const key = uri + "\n" + rel;
  const old = trashedPictures.get(key);
  if (old) trashedBytes -= old.length;
  trashedPictures.delete(key);
  trashedPictures.set(key, bytes);
  trashedBytes += bytes.length;
  for (const [k, b] of trashedPictures) {
    if (trashedBytes <= TRASHED_KEPT_MAX) break;
    trashedPictures.delete(k);
    trashedBytes -= b.length;
  }
}

// A save: every picture the document was given and no longer mentions goes to
// the trash, and its folder after it when it is left empty.
async function sweepPictures(document) {
  if (document.uri.scheme !== "file") return;
  const uri = document.uri.toString();
  const given = picturesOf(uri);
  if (!given.length) return;
  const text = document.getText();
  const base = path.dirname(document.uri.fsPath);
  const pretty = path.basename(document.uri.fsPath);
  const kept = [];
  const folders = new Set();
  for (const rel of given) {
    if (pictureMentioned(text, rel)) {
      kept.push(rel);
      continue;
    }
    const full = path.join(base, rel);
    let bytes;
    try {
      bytes = fs.readFileSync(full);
    } catch (e) {
      // Gone already, taken away by hand: nothing to send, and nothing to
      // keep a name for. Unreadable: left, and asked about again next save.
      if (e.code !== "ENOENT") kept.push(rel);
      continue;
    }
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(full), { useTrash: true });
    } catch (e) {
      // A trash the system has not got, or a file held open: the picture
      // stays, and so does its name, for the next save to try again.
      kept.push(rel);
      channel().appendLine(
        full + " is no longer in " + pretty + " but could not be moved to the trash (" +
          String((e && e.message) || e) + "); it stays."
      );
      continue;
    }
    keepTrashed(uri, rel, bytes);
    folders.add(path.dirname(full));
    channel().appendLine("moved " + full + " to the trash: " + pretty + " was saved without it");
  }
  await keepPictures(uri, kept);
  folders.forEach(removeIfEmpty);
}

// A change: a picture sent to the trash that the text mentions again (an undo
// after the save, or the link typed back) is written back beside the
// document, into its folder made again if need be, and is the document's once
// more. Never over a file of that name, which is the picture put back by hand.
function restorePictures(document) {
  const uri = document.uri.toString();
  if (document.uri.scheme !== "file" || !trashedPictures.size) return;
  const prefix = uri + "\n";
  const text = document.getText();
  const base = path.dirname(document.uri.fsPath);
  for (const [key, bytes] of Array.from(trashedPictures)) {
    if (!key.startsWith(prefix)) continue;
    const rel = key.slice(prefix.length);
    if (!pictureMentioned(text, rel)) continue;
    trashedPictures.delete(key);
    trashedBytes -= bytes.length;
    const full = path.join(base, rel);
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const fd = fs.openSync(full, "wx");
      try {
        fs.writeSync(fd, bytes);
      } finally {
        fs.closeSync(fd);
      }
      channel().appendLine("put back " + full + ": " + path.basename(document.uri.fsPath) + " mentions it again");
    } catch (e) {
      if (e.code !== "EEXIST") {
        channel().appendLine("could not put back " + full + " (" + String(e.message || e) + ")");
        continue;
      }
    }
    pictureTurn(() => givePicture(uri, rel));
  }
}

// ---------- Citations, as the page will print them ----------
//
// The page prints what citeproc makes of a citation, "Knuth (1984)", and a
// list of the works cited; the editor drew `@knuth1984` as written and no
// list at all. Every paragraph that held a citation broke on other words in
// the editor than on the page (one holding three, on every line; a single
// citation 111 px wide in the editor and 221 px on the page, 13 % of the
// measure; measured 2026-09-29), which is the difference the export rule is
// stated in. The editor asks this side what the page will print, and this
// side asks the engine the export asks, the Pandoc that comes with Quarto,
// run with citeproc under the document's own header: the bibliography, the
// style and the language are the export's.
//
// The same engine, and over every citation at once and in order, because
// what a citation prints depends on the others: a numeric style numbers by
// first appearance, a year takes a letter when an author has two works in it
// (2001a), names are added after "et al." to tell two works apart, and a note
// style writes "Ibid." after a citation of the same work. Of twenty
// citations formatted one at a time, four came out otherwise than in their
// document. Another engine differs from Pandoc where it matters: citeproc-js,
// the one other editors draw with, matched it in Chicago and APA and not in
// IEEE or OSCOLA, and hayagriva told works apart otherwise (measured against
// Pandoc 3.8.3). The webview writes the citations out in their order and in
// their notes (citationBody in media/main.js), each in a span that names it,
// and reads back what Pandoc printed in each span.
//
// Without Quarto nothing is resolved and the editor draws the citations as
// written, as it always has: the editor runs as though export did not exist.
// Nor is a bibliography or a style named by an address, which citeproc
// would fetch: nothing here goes to the network.

// The Pandoc Quarto carries beside its launcher: bin/tools/pandoc, a link to
// bin/tools/<arch>/pandoc (both on Linux, Quarto 1.9.37), or the file in
// bin/tools/<arch>; pandoc.exe on Windows. Run directly it starts in about
// 9 ms. Where neither is there, `quarto pandoc` runs the same program after
// starting Quarto, about 250 ms later (measured 2026-09-29).
function findPandoc() {
  const quarto = findQuarto();
  if (!quarto) return null;
  let bin = path.dirname(quarto);
  try {
    bin = path.dirname(fs.realpathSync(quarto));
  } catch (e) {
    // a launcher that does not resolve: its own folder is the guess
  }
  const exe = process.platform === "win32" ? "pandoc.exe" : "pandoc";
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const own = [path.join(bin, "tools", exe), path.join(bin, "tools", arch, exe)].find(isFile);
  return own ? { cmd: own, args: [] } : { cmd: quarto, args: ["pandoc"] };
}

// A name that is an address and not a file of the folder.
const REMOTE = /^[a-z][a-z0-9+.-]*:\/\//i;

// The files a header names for citeproc to read, `bibliography` (one, or a
// list, in either of YAML's two ways of writing one) and `csl`, at its top
// level and as written.
function citationFiles(header) {
  const files = [];
  const bare = function (v) {
    return v.trim().replace(/^(['"])(.*)\1$/, "$2");
  };
  const lines = header.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:bibliography|csl)[ \t]*:[ \t]*(.*?)[ \t]*$/.exec(lines[i]);
    if (!m) continue;
    if (m[1].startsWith("[")) {
      m[1]
        .replace(/^\[|\]$/g, "")
        .split(",")
        .forEach(function (v) {
          if (bare(v)) files.push(bare(v));
        });
    } else if (m[1]) {
      files.push(bare(m[1]));
    } else {
      for (let j = i + 1; j < lines.length && /^[ \t]+-/.test(lines[j]); j++) {
        files.push(bare(lines[j].replace(/^[ \t]+-[ \t]*/, "")));
      }
    }
  }
  return files;
}

// Where each entry of the bibliography is written, for a click on it in the
// editor's list to open it there: the key of every entry in the files the
// header names, a BibTeX or BibLaTeX `@book{key,`, a CSL JSON `"id": "key"`,
// a CSL YAML `id: key` and a RIS `ID  - key`, and of the references written
// in the header itself (`references:`), each with the file and the place its
// key stands at. Found with patterns and not parsed: what a click needs is
// the line the key is written on, and an entry not found this way stays
// words in the list (RefsWidget in main.js) rather than opening somewhere
// else. A key written twice opens where it is first found.
const ENTRY_KEYS = [
  { file: /\.(?:bib|bibtex)$/i, re: /^[ \t]*@[A-Za-z]+[ \t]*[{(][ \t]*(?<key>[^\s,{}()"]+)[ \t]*,/dgm },
  { file: /\.json$/i, re: /"id"[ \t]*:[ \t]*"(?<key>[^"\\]+)"/dg },
  { file: /\.ya?ml$/i, re: /^[ \t]*(?:-[ \t]+)?id[ \t]*:[ \t]*(['"]?)(?<key>[^'"\s#]+)\1[ \t]*$/dgm },
  { file: /\.ris$/i, re: /^ID  - (?<key>\S+)[ \t]*$/dgm },
];
function entryPlaces(dir, header) {
  const places = {};
  const note = function (text, re, file, offset) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const key = m.groups.key;
      if (Object.prototype.hasOwnProperty.call(places, key)) continue;
      const at = offset + m.indices.groups.key[0];
      const all = file ? text : header;
      const before = all.slice(0, at);
      const line = (before.match(/\n/g) || []).length;
      places[key] = { file: file, line: line, character: at - (before.lastIndexOf("\n") + 1) };
    }
  };
  citationFiles(header)
    .filter(function (f) {
      return !REMOTE.test(f) && !/\.csl$/i.test(f);
    })
    .forEach(function (f) {
      const kind = ENTRY_KEYS.find(function (k) {
        return k.file.test(f);
      });
      if (!kind) return;
      const full = path.resolve(dir, f);
      let text;
      try {
        text = fs.readFileSync(full, "utf8");
      } catch (e) {
        return;
      }
      note(text, kind.re, full, 0);
    });
  // The header's own references, from `references:` to the next key of the
  // header's top level: an `id:` anywhere else in it is not an entry's.
  const refs = /^references[ \t]*:.*$/m.exec(header);
  if (refs) {
    const start = refs.index + refs[0].length;
    const rest = header.slice(start);
    const end = /\n(?=[^\s#-])/.exec(rest);
    note(rest.slice(0, end ? end.index : rest.length), ENTRY_KEYS[2].re, null, start);
  }
  return places;
}

// Which group an entry opens in. The tab the file already has in another
// group than the document's, so that a second entry opens in the tab the
// first one did: opened "beside" the active group, every click after the
// first opened one more group to the right, since the click on the list
// leaves the file's group the active one (three clicks, three groups, seen
// in VS Code 1.133 on 2026-09-30). Otherwise the group to the right of the
// document's, whichever group is active. A tab of the file behind the
// document, in its own group, is passed over: shown there, it would hide
// the list that was clicked. A text tab only: the document's own tab is a
// custom editor on the same address, and is never the one to show.
function entryColumn(target, own) {
  const same = function (uri) {
    return !!uri && uri.toString() === target.toString();
  };
  const groups = (vscode.window.tabGroups && vscode.window.tabGroups.all) || [];
  const holding = groups.find(function (g) {
    return (
      g.viewColumn !== own &&
      g.tabs.some(function (t) {
        const input = t.input;
        return !!input && same(input.uri) && !input.viewType && !input.notebookType;
      })
    );
  });
  if (holding) return holding.viewColumn;
  return own ? own + 1 : vscode.ViewColumn.Beside;
}

// The keys of the entries Pandoc listed, and what the editor's tooltip on
// each names as where a click opens it: the file's name, or the header.
function citationSources(html, places) {
  const sources = {};
  const re = /<div id="ref-([^"]+)" class="csl-entry"/g;
  let m;
  while ((m = re.exec(html))) {
    const key = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const place = places[key];
    if (place) sources[key] = place.file ? path.basename(place.file) : "The header of this document";
  }
  return sources;
}

// Pandoc over the header and the webview's citations: the export's reader,
// the links a page gives its citations (Quarto sets link-citations for HTML,
// and mdm.lua for the paper), each formula as its own LaTeX for KaTeX
// (--katex writes no engine into a fragment), and no wrapping, so a span is
// never cut. Its warnings name the keys the bibliography has not got.
function runPandoc(pandoc, dir, input) {
  return new Promise(function (resolve) {
    const args = pandoc.args.concat([
      "-f", READER, "-t", "html", "--citeproc", "--katex", "--wrap=none",
      "-M", "link-citations=true",
    ]);
    let out = "";
    let err = "";
    let child;
    try {
      child = cp.spawn(pandoc.cmd, args, { cwd: dir, windowsHide: true });
    } catch (e) {
      resolve({ state: "error", message: String(e.message || e) });
      return;
    }
    // A bibliography of thousands of entries is read in under a second; a
    // Pandoc still at work after this is not coming back.
    const timer = setTimeout(function () {
      try {
        child.kill();
      } catch (e) {
        // already gone
      }
    }, 20000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", function (d) {
      out += d;
    });
    child.stderr.on("data", function (d) {
      err += d;
    });
    child.on("error", function (e) {
      clearTimeout(timer);
      resolve({ state: "error", message: String(e.message || e) });
    });
    child.on("close", function (code) {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ state: "error", message: plainLog(err).trim() });
        return;
      }
      const missing = [];
      const re = /\[WARNING\] Citeproc: citation (\S+) not found/g;
      let m;
      while ((m = re.exec(plainLog(err)))) {
        if (missing.indexOf(m[1]) === -1) missing.push(m[1]);
      }
      resolve({ state: "ok", html: out, missing: missing });
    });
    child.stdin.on("error", function () {
      // a Pandoc that died before reading all of it answers in "close"
    });
    child.stdin.end(input, "utf8");
  });
}

// One document's citations, for the editor that shows it: the last body the
// webview sent, what Pandoc made of it, and the files the header names,
// watched so that an entry corrected in the .bib reaches the editor without a
// keystroke in the document. A header edited (a style named, a file added)
// asks again with the same body.
function citationService(document, webview, column) {
  let last = null; // { body, seq }, the webview's latest
  let key = null; // what `answer` was made from
  let answer = null;
  let working = false;
  let again = false;
  let watched = [];
  let timer = null;
  let header = null;
  let toldNoQuarto = false;
  const dir = document.uri.scheme === "file" ? path.dirname(document.uri.fsPath) : null;

  // An answer goes out under the number of the request it answers: one asked
  // while Pandoc was still at work on an earlier body waits its turn, and the
  // earlier answer must not pass for its.
  const post = function (reply, seq) {
    if (last) webview.postMessage(Object.assign({ type: "cites", seq: seq }, reply));
  };
  const onFile = function () {
    schedule();
  };
  const watch = function (files) {
    const full = files
      .filter(function (f) {
        return !REMOTE.test(f);
      })
      .map(function (f) {
        return path.resolve(dir, f);
      });
    if (full.join("\n") === watched.join("\n")) return;
    watched.forEach(function (p) {
      fs.unwatchFile(p, onFile);
    });
    watched = full;
    watched.forEach(function (p) {
      fs.watchFile(p, { interval: 1500, persistent: false }, onFile);
    });
  };
  const schedule = function () {
    if (!last) return;
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  };

  async function run() {
    if (!last) return;
    if (working) {
      again = true;
      return;
    }
    const asked = last;
    header = frontMatter(document.getText());
    if (!dir || !/^(?:bibliography|references)[ \t]*:/m.test(header)) {
      watch([]);
      post({ state: "none" }, asked.seq);
      return;
    }
    const files = citationFiles(header);
    watch(files);
    if (files.some(function (f) {
      return REMOTE.test(f);
    })) {
      post({ state: "remote" }, asked.seq);
      return;
    }
    const pandoc = findPandoc();
    if (!pandoc) {
      if (!toldNoQuarto) {
        toldNoQuarto = true;
        channel().appendLine(
          "Citations are drawn as written: resolving them as the page will print them " +
            "takes the Pandoc that comes with Quarto, and Quarto was not found (" +
            QUARTO_PAGE + ")."
        );
      }
      post({ state: "noquarto" }, asked.seq);
      return;
    }
    const stamps = files.map(function (f) {
      try {
        return fs.statSync(path.resolve(dir, f)).mtimeMs;
      } catch (e) {
        return -1;
      }
    });
    const input = header + "\n" + asked.body;
    const made = input + "\u0000" + stamps.join(",");
    if (made !== key || !answer) {
      working = true;
      try {
        answer = await runPandoc(pandoc, dir, input);
        if (answer.state === "ok") answer.sources = citationSources(answer.html, entryPlaces(dir, header));
        key = made;
      } finally {
        working = false;
      }
    }
    post(answer, asked.seq);
    if (again) {
      again = false;
      run();
    }
  }

  return {
    request(body, seq) {
      last = { body: String(body || ""), seq: seq };
      clearTimeout(timer);
      run();
    },
    documentChanged() {
      if (last && frontMatter(document.getText()) !== header) schedule();
    },
    // A click on an entry of the editor's list: the file it is written in,
    // at its key, or the document's own header for an entry written there,
    // which opens in the text editor since the header is what this editor
    // keeps out of sight. Looked for again, so that a file saved since the
    // list was drawn opens where it is now. Where it opens is entryColumn's.
    openEntry(entryKey) {
      if (!dir || typeof entryKey !== "string" || !entryKey) return;
      const place = entryPlaces(dir, frontMatter(document.getText()))[entryKey];
      if (!place) {
        vscode.window.showInformationMessage(
          "The entry @" + entryKey + " was not found in the bibliography files the header names."
        );
        return;
      }
      const at = new vscode.Range(place.line, place.character, place.line, place.character);
      const target = place.file ? vscode.Uri.file(place.file) : document.uri;
      return vscode.window.showTextDocument(target, {
        viewColumn: entryColumn(target, column && column()),
        selection: at,
      });
    },
    dispose() {
      clearTimeout(timer);
      last = null;
      watch([]);
    },
  };
}

// How long a save is held for the webview to post the edit it was holding
// back. VS Code gives a save participant a short while and then writes the
// file regardless, and the edit is one message and one write away, so a
// second is far more than it takes and short enough for a webview that never
// answers (one being torn down) not to be felt.
const FLUSH_WAIT_MS = 1000;

class MdmEditorProvider {
  constructor(context) {
    this.context = context;
  }

  resolveCustomTextEditor(document, webviewPanel) {
    const webview = webviewPanel.webview;
    // The folder of the document is a resource root too: images the text
    // refers to by a relative path are shown from there.
    const docDir = vscode.Uri.joinPath(document.uri, "..");
    // And so is the root of the document's own filesystem, for the images the
    // text names by an absolute path: a figure written by the code of another
    // project lives wherever that project keeps it, and the folder of the
    // document says nothing about where that is. Only for a document on disk;
    // anything else keeps its folder and nothing more.
    const fileRoot =
      document.uri.scheme === "file"
        ? vscode.Uri.file(path.parse(document.uri.fsPath).root)
        : null;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        docDir,
      ].concat(fileRoot ? [fileRoot] : []),
    };
    webview.html = this.getHtml(webview, document, docDir, fileRoot);
    // Opening a document that keeps a division of its own counts as using it,
    // so the ones forgotten first are the ones not opened for longest
    // (keepDivision). One that keeps none gains no entry by being opened. A
    // failure here costs only that order, which is not worth a message.
    const openedOn = ownDivision(document);
    if (openedOn !== undefined) {
      Promise.resolve(keepDivision(document, openedOn)).catch(() => {});
    }

    // >0 while we apply changes that came from the webview to the
    // TextDocument, so we do not send them back (infinite echo). A counter and
    // not a boolean: two onDidReceiveMessage calls can overlap on their await.
    let applyingFromWebview = 0;

    // `withFrontMatter` travels with the text it describes, so an edit written
    // under the previous setting is still read as what it was (see
    // transforms.js). `frontMatter` carries the header itself, which the
    // webview only needs to know whether the file has one. `hiddenLines` says
    // how many lines of the file are not in that text, which is what the
    // numbers the editor draws in its margin count from: the host is the only
    // side that has both texts to compare.
    // A header the editor typed into a file that had none, while the setting
    // keeps headers out of the editor. The edit is written as it came, and
    // the file now has a header; mapping the text back under the setting
    // would strip it and the echo would take the typed lines off the screen
    // (the caret went to line 1 and the margin jumped to 4). The text stays
    // in the editor with its header, as though the setting were "shown", for
    // this document and until the setting is touched: the button then offers
    // to hide it, and a press does.
    let headerFromEditor = false;

    // `version` is the document's, which the webview hands back as the `base`
    // of every edit it sends (see "Synchronization" in media/main.js).
    const updateMsg = () => {
      const withFrontMatter = readSettings().frontMatter === "shown" || headerFromEditor;
      const text = document.getText();
      return {
        type: "update",
        text: toEditor(text, withFrontMatter),
        frontMatter: toLf(frontMatter(text)),
        withFrontMatter: withFrontMatter,
        hiddenLines: hiddenLines(text, withFrontMatter),
        version: document.version,
      };
    };

    // The version of the document after the last change that was not the
    // webview's own (the text editor beside it, a formatter, the language the
    // menu writes). An edit the webview based on a version before it was
    // written without knowing of that change, and its whole text would put
    // the document back the way the webview last saw it: such an edit is not
    // applied, the document is sent instead, and the webview merges the two
    // and sends again. An edit based on a version the webview's own earlier
    // edits produced is fine to apply, since each edit carries the whole
    // text and the later one supersedes the earlier.
    let externalVersion = document.version;

    // The line ending of the file, the one every text written back to it
    // carries. Everything that travels to the webview is LF (see
    // transforms.js), so this is the host's business alone.
    const eol = () =>
      document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

    // What the page will print for the citations (citationService).
    const cites = citationService(document, webview, function () {
      return webviewPanel.viewColumn;
    });

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      // Every change, the webview's own included: a header typed in the
      // editor changes what the citations print as much as one written in
      // the text editor beside it.
      cites.documentChanged();
      if (applyingFromWebview === 0) {
        externalVersion = document.version;
        const msg = updateMsg();
        const changes = editorChanges(e.contentChanges, msg.hiddenLines);
        if (changes) msg.changes = changes;
        webview.postMessage(msg);
      }
    });
    const paletteMsg = () =>
      Object.assign({ type: "palette" }, readPalette());

    // The settings in force for this document, the division it keeps of its
    // own included, and the document again behind them: mdm.frontMatter
    // decides what the editor text holds, so the text is re-sent in whichever
    // mode is now in force. The other settings only repaint, and for them
    // this update lands on identical text and the webview drops it.
    const sendSettings = () => {
      webview.postMessage({
        type: "settings",
        settings: documentSettings(document),
      });
      webview.postMessage(updateMsg());
    };

    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      // The setting speaks for the header again once it is touched.
      if (e.affectsConfiguration("mdm.frontMatter")) headerFromEditor = false;
      if (
        e.affectsConfiguration("mdm") ||
        e.affectsConfiguration("editor.multiCursorModifier")
      ) {
        // Every editor hears a settings change, each with the division its
        // own document keeps over what just changed.
        sendSettings();
      }
      // mdm.theme can name a colour theme, and then it decides the palette.
      // Only that key: sending a palette after every mdm change made the
      // webview repaint the whole editor for settings that touch no colour.
      if (e.affectsConfiguration("mdm.theme")) {
        webview.postMessage(paletteMsg());
      }
      // Switching theme fires onDidChangeActiveColorTheme below, but editing
      // the setting by hand or changing the token customizations does not.
      if (
        e.affectsConfiguration("workbench.colorTheme") ||
        e.affectsConfiguration("editor.tokenColorCustomizations")
      ) {
        webview.postMessage(paletteMsg());
      }
    });
    const themeSub = vscode.window.onDidChangeActiveColorTheme(() => {
      webview.postMessage(paletteMsg());
    });

    // The file is about to be written. The webview holds a keystroke back
    // for 300 ms before it posts it, and a save made inside that window
    // wrote the file without it, the late edit dirtying the tab again. The
    // save is held until the webview has posted what it was holding and
    // this side has written it (the edit travels ahead of the answer on the
    // same ordered wire, and lands in the writing turn before the answer is
    // read), or for FLUSH_WAIT_MS at most.
    let flushId = 0;
    const flushes = new Map();
    const saveSub = vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      const id = ++flushId;
      e.waitUntil(
        new Promise((resolve) => {
          const done = () => {
            clearTimeout(timer);
            flushes.delete(id);
            resolve();
          };
          const timer = setTimeout(done, FLUSH_WAIT_MS);
          flushes.set(id, done);
          webview.postMessage({ type: "flush", id: id });
        })
      );
    });
    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      cites.dispose();
      configSub.dispose();
      themeSub.dispose();
      saveSub.dispose();
      // The page that was rendering the audio has gone with the panel and
      // nothing will answer, so the lock and the notification are let go here.
      // Added to this block rather than registered as a second onDidDispose:
      // the panel the tests drive keeps only the last handler it was given
      // (openPanel in tests/extension-host.test.js), so another one would
      // quietly take the place of the three lines above.
      endAudioRun(document.uri.toString(), "the editor was closed");
    });

    // What this side writes into the document, one write at a time: an edit
    // typed in the editor, and the language the hyphenation menu puts in the
    // header. Each reads the text as it stands and writes a whole new one,
    // and a message's handler starts without waiting for the one before it
    // to finish (see applyingFromWebview), so two writes in flight at once
    // would both read the text from before either landed, and the later one
    // would put back what the earlier one replaced.
    let writing = Promise.resolve();
    const inTurn = (write) => {
      const turn = writing.then(write);
      writing = turn.catch(() => {});
      return turn;
    };

    // The language the hyphenation menu chose, as `lang:` in the header
    // (withLang in transforms.js). Not counted as coming from the webview:
    // the update this change sends back is how the editor learns the header
    // it now has, and with the header hidden it has no other way to.
    //
    // A file that had none is given a header here, and what was asked for was
    // word division and not three lines of YAML over the document: the
    // document is put on the hidden mode first, so the header never appears
    // on screen, and the button beside the menu, which greys out only for a
    // file that has no header at all, is what opens it from then on. Before
    // the edit, so that no frame of the document is drawn with the header in
    // it. A file that already had one is left showing what it was showing.
    const writeLanguage = async (lang) => {
      const text = document.getText();
      const newText = withLang(text, lang, eol());
      if (newText === text) return;
      // The header about to be written is not one the reader asked to see, so
      // the editor is put on the hidden mode before the line lands and told at
      // once. mdm.frontMatter is the editor's own setting and not the
      // document's, so this hides the header of every open document; the YAML
      // button of the toolbar, which a file with no header leaves greyed, is
      // what opens it again from here on.
      if (frontMatter(text) === "" && readSettings().frontMatter === "shown") {
        await writeSetting(document, "frontMatter", "hidden");
        sendSettings();
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), newText);
      await vscode.workspace.applyEdit(edit);
    };

    webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "ready") {
        // The webview has been built again, and whatever it was doing it is
        // not doing now: an audio run of this document belonged to a page
        // that no longer exists and will never answer.
        endAudioRun(document.uri.toString(), "the editor reloaded");
        webview.postMessage(updateMsg());
      } else if (msg.type === "setSetting") {
        // A press on the header button while a typed header is being kept
        // on screen over the setting: the setting takes over again, and it
        // is re-sent even where the stored value does not change, since no
        // configuration event says anything then.
        let headerHanded = false;
        if (msg.key === "frontMatter" && headerFromEditor) {
          headerFromEditor = false;
          headerHanded = true;
        }
        let own = false;
        try {
          own = await writeSetting(document, msg.key, msg.value);
        } catch (e) {
          vscode.window.showErrorMessage(
            "MDM: could not save mdm." + msg.key + " (" + e.message + ")"
          );
        }
        // A setting written to settings.json reaches this editor and every
        // other through onDidChangeConfiguration below; a division kept for
        // this document alone is this editor's to be told of.
        if (own || headerHanded) sendSettings();
      } else if (msg.type === "flushed") {
        // The edit it may have posted ahead of this is in the writing turn
        // already; the save goes on once that turn is over.
        const done = flushes.get(msg.id);
        if (done) writing.then(done, done);
      } else if (msg.type === "export") {
        try {
          await exportDocument(document, msg.to);
        } catch (e) {
          vscode.window.showErrorMessage("MDM: export failed (" + e.message + ")");
        }
      } else if (msg.type === "exportAudio") {
        exportAudioStep(document, webview, msg);
      } else if (msg.type === "cites") {
        cites.request(msg.body, msg.seq);
      } else if (msg.type === "openEntry") {
        cites.openEntry(msg.key);
      } else if (msg.type === "edit") {
        await inTurn(async () => {
          // Written without knowing of a change made here since: the
          // document goes back to the webview instead (see externalVersion).
          if (msg.base !== undefined && msg.base < externalVersion) {
            webview.postMessage(updateMsg());
            return;
          }
          const newText = fromEditor(
            msg.text,
            document.getText(),
            !!msg.withFrontMatter,
            eol()
          );
          // A header typed into a file that had none, with the setting
          // keeping headers out: the file gains it as typed, and the text
          // stays on screen with it (headerFromEditor).
          const typedHeader =
            !msg.withFrontMatter &&
            frontMatter(document.getText()) === "" &&
            frontMatter(newText) !== "";
          if (typedHeader) headerFromEditor = true;
          if (newText !== document.getText()) {
            applyingFromWebview++;
            try {
              // Over the stretch that changed and not over the whole
              // document: every keystroke used to be written as one replace
              // of all the text, which is what the workbench then hands its
              // model, its undo stack and whoever else has the file open
              // (G092).
              const span = changedSpan(document.getText(), newText);
              const edit = new vscode.WorkspaceEdit();
              edit.replace(
                document.uri,
                new vscode.Range(document.positionAt(span.from), document.positionAt(span.to)),
                span.insert
              );
              await vscode.workspace.applyEdit(edit);
            } finally {
              applyingFromWebview--;
            }
          }
          // The text is in the document: the webview takes it as what the
          // two sides agree on from here.
          if (msg.seq !== undefined) {
            webview.postMessage({ type: "applied", seq: msg.seq, version: document.version });
          }
          // Convergence echo, ONLY when the document ended up differing from
          // what the webview sent (an external update crossed in flight, or a
          // host-side canonicalization changed the body). Echoing
          // unconditionally re-rendered the editor after every first edit,
          // destroying the fresh empty paragraph a lone Enter creates (empty
          // paragraphs do not serialize), which read as "my Enter got
          // reverted".
          // And once more when the text is the same but its mode is not: the
          // editor learns that the header it typed is part of its text now.
          const echo = updateMsg();
          if (echo.text !== msg.text || typedHeader) {
            webview.postMessage(echo);
          }
        });
      } else if (msg.type === "setLanguage") {
        if (LANGUAGES.indexOf(msg.lang) === -1) return;
        await inTurn(() => writeLanguage(msg.lang));
      } else if (msg.type === "openLink") {
        openLink(document, msg.href);
      } else if (msg.type === "pasteImage") {
        pasteImageStep(document, webview, msg);
      }
    });
  }

  getHtml(webview, document, docDir, fileRoot) {
    const mediaUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media")
    );
    const docBase = docDir ? webview.asWebviewUri(docDir).toString() : "";
    // The two bases an image path hangs from: the folder of the document for
    // a relative one, the root of the filesystem for an absolute one.
    const fileBase = fileRoot ? webview.asWebviewUri(fileRoot).toString() : "";
    // No 'unsafe-eval': CodeMirror, KaTeX and abcjs run without it.
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `connect-src ${webview.cspSource} https:`,
      "media-src https: data:",
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${mediaUri}/vendor/cm6/katex.min.css">
<link rel="stylesheet" href="${mediaUri}/vendor/abcjs/abcjs-audio.css">
<link rel="stylesheet" href="${mediaUri}/style.css">
<script>
window.MDM_DOC_BASE = ${inlineJson(docBase)};
window.MDM_FILE_BASE = ${inlineJson(fileBase)};
window.MDM_SOUNDFONT = "${mediaUri}/vendor/soundfont/";
window.MDM_SETTINGS = ${inlineJson(documentSettings(document))};
window.MDM_THEMES = ${inlineJson(themes())};
window.MDM_PALETTE = ${inlineJson(readPalette())};
</script>
<script src="${mediaUri}/vendor/cm6/cm6.bundle.js"></script>
<script src="${mediaUri}/vendor/abcjs/abcjs-basic-min.js"></script>
<script src="${mediaUri}/hyphenation-patterns.js"></script>
<script src="${mediaUri}/mdm-hyphenation.js"></script>
<script src="${mediaUri}/mdm-audio.js"></script>
<script src="${mediaUri}/mdm-crossref.js"></script>
</head>
<body>
<div id="app"></div>
<script src="${mediaUri}/main.js"></script>
</body>
</html>`;
  }
}

// ---------- A document the start of VS Code left in the text editor ----------
//
// TEMPORARY: a way round a fault of VS Code's, to be taken out when it is
// mended (https://github.com/microsoft/vscode/issues/325506, reported on
// 1.128.0 and open on 2026-10-02). What goes with it: this section, its
// call in activate(), the two activationEvents in package.json, the tests named
// "started as text" and their fixtures in the mock, and Pending 15 in
// tests/README.md, which says how to tell that the fault is gone.
//
// VS Code started on a file, which is what a double click on a document does
// while VS Code is shut, opens it in the text editor whatever editor its kind
// has: 13 starts of 14 in VS Code 1.133.0 on 2026-10-02, with the reader's
// `"*.mdm": "mdm.editor"` association and with no settings at all, and a
// .png the same (the text editor's notice of a binary file where the image
// preview belongs). A file opened into a window already running gets the
// editor of its kind, so nothing in the manifest or the settings is wrong
// and nothing in them mends it.
//
// So the extension is woken at the start of the window and looks at the
// tabs: a text tab on an .mdm that the reader did not ask for is opened in
// the MDM editor and closed. Two events wake it. "onLanguage:markdown" is the
// quick one: an .mdm in the text editor is a Markdown document to VS Code, so
// it comes as soon as the extension host is up, where "onStartupFinished"
// waits for every extension that starts with the window (2.0 and 2.4 s
// later in two starts on the owner's machine, read off its log on
// 2026-10-02, and the text editor was on screen all that while). "onStartupFinished" is the one that keeps the
// reader's choice: without it, in a window that started with no Markdown
// open, the extension would be woken by the very tab the reader opens in the
// text editor, and its look at the start would take that tab back.
//
// What the reader did ask for is kept apart, since "Reopen Editor With...
// Text Editor" is theirs to choose and has to hold (the owner, 2026-10-02):
// once the start has been looked at, every text tab on an .mdm in this
// window is one the reader put there, a running window opening none by
// itself, and their addresses are kept in workspaceState under KEPT_AS_TEXT,
// which is this window's own and outlives a restart. A tab restored as text
// at the next start is found in that list and left.
//
// Not covered, and known: the first start after this is installed has no
// list, so a text tab left open on an .mdm before it is reopened once; and a
// tab that shows up after the look at the start (none was seen to) would be
// taken for the reader's and stay, which is what VS Code does today.
const KEPT_AS_TEXT = "keptAsText";

// context.workspaceState, handed over on activation.
let workspaceState = null;

// The text tabs on an .mdm, each with the group it is in. A text tab's input
// has an address and neither a viewType (a custom editor's) nor a
// notebookType; a diff has two addresses under other names and is not one.
// The ending is matched as VS Code matches the manifest's `*.mdm`, whatever
// its capitals.
function textTabs() {
  const out = [];
  const groups = (vscode.window.tabGroups && vscode.window.tabGroups.all) || [];
  groups.forEach(function (group) {
    group.tabs.forEach(function (tab) {
      const input = tab.input;
      if (!input || !input.uri || input.viewType || input.notebookType) return;
      if (/\.mdm$/i.test(input.uri.path || "")) out.push({ group, tab });
    });
  });
  return out;
}

// The addresses kept. Anything but a list is read as nothing kept.
function keptAsText() {
  const kept = workspaceState ? workspaceState.get(KEPT_AS_TEXT) : undefined;
  return Array.isArray(kept) ? kept : [];
}

// The text tabs open now, written down as the reader's. Called on every
// change of the tabs, so a tab closed, or reopened in the MDM editor, leaves
// the list as it goes.
function keepTextTabs() {
  if (!workspaceState) return Promise.resolve();
  const now = [];
  textTabs().forEach(function (t) {
    const uri = t.tab.input.uri.toString();
    if (now.indexOf(uri) === -1) now.push(uri);
  });
  const before = keptAsText();
  if (now.length === before.length && now.every((uri, i) => uri === before[i])) return Promise.resolve();
  return Promise.resolve(workspaceState.update(KEPT_AS_TEXT, now));
}

// One tab moved to the MDM editor: opened there first, in its own group and
// as it stood (a preview stays a preview, and only the tab that had the
// focus takes it), and the text tab closed only once the MDM editor's is
// there, so a failure leaves the document where VS Code had put it.
function reopenInEditor(stray) {
  const uri = stray.tab.input.uri;
  const column = stray.group.viewColumn;
  const here = function (input) {
    return !!input && !!input.uri && input.uri.toString() === uri.toString();
  };
  return Promise.resolve(
    vscode.commands.executeCommand("vscode.openWith", uri, "mdm.editor", {
      viewColumn: column,
      preview: !!stray.tab.isPreview,
      preserveFocus: !stray.focused,
    })
  ).then(
    function () {
      const group = vscode.window.tabGroups.all.find((g) => g.viewColumn === column);
      const tabs = group ? group.tabs : [];
      if (!tabs.some((t) => here(t.input) && t.input.viewType === "mdm.editor")) return;
      const left = tabs.filter((t) => here(t.input) && !t.input.viewType && !t.input.notebookType);
      if (left.length) return vscode.window.tabGroups.close(left, true);
    },
    function (e) {
      channel().appendLine("Could not reopen " + uri.toString() + " in the MDM editor: " + (e && e.message ? e.message : e));
    }
  );
}

// The look at the start. A tab with unsaved changes is left: closing it would
// ask about them. One at a time, and the tab shown in its group last, so the
// group ends on the document it started on; which tab is shown and which has
// the focus is read before the first is moved, since moving one changes it
// for the rest.
function reopenStartedAsText() {
  const kept = keptAsText();
  const strays = textTabs()
    .filter(function (t) {
      return !t.tab.isDirty && kept.indexOf(t.tab.input.uri.toString()) === -1;
    })
    .map(function (t) {
      return { group: t.group, tab: t.tab, shown: !!t.tab.isActive, focused: !!(t.tab.isActive && t.group.isActive) };
    });
  strays.sort((a, b) => (a.shown ? 1 : 0) - (b.shown ? 1 : 0));
  return strays.reduce(function (turn, stray) {
    return turn.then(() => reopenInEditor(stray));
  }, Promise.resolve());
}

// What activate() runs: the look at the start, and from then on the list.
// The tabs are listened to only after the look, so the text tab that is
// about to be closed is never written down as the reader's.
function watchTextTabs(context) {
  workspaceState = context.workspaceState || null;
  if (!vscode.window.tabGroups || !workspaceState) return Promise.resolve();
  return reopenStartedAsText()
    .then(keepTextTabs)
    .then(function () {
      context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(keepTextTabs));
    });
}

function deactivate() {}

// withFilter, withReader, withBreaks, hasScores and renderArgs are pure and
// are exported for the tests: they decide what Quarto is handed, which is the
// half of the export that can be checked without running anything. So are
// quartoInstalls and texPage, which say where a missing tool is looked for
// and where its reader is sent on each system; chromeInstalls does the same
// for Chrome, and a test can only run on one system. The key and the bound of
// the divisions kept go out for the tests as
// well, which seed and read VS Code's globalState through them. changedSpan
// is what an edit is written over and editorChanges what an outside change
// is told to the webview as, both pure. audioFileName
// is pure in the same way and is the half of the audio export that decides
// what lands on the disk: what a score's title may put in a file name, and
// what a document whose own name is too long gets instead. KEPT_AS_TEXT is
// the key of the text tabs kept, TEMPORARY with the section that names it.
module.exports = {
  audioFileName,
  activate,
  deactivate,
  withFilter,
  withReader,
  withBreaks,
  changedSpan,
  editorChanges,
  withPageTitle,
  withPageKeys,
  exportTrouble,
  citationWarnings,
  citationFiles,
  citationService,
  entryPlaces,
  citationSources,
  entryColumn,
  findPandoc,
  hasScores,
  renderArgs,
  quartoInstalls,
  chromeInstalls,
  findChrome,
  texPage,
  PDF_ENGINES,
  asksFrom,
  FILTER,
  FILTER_AFTER,
  READER,
  LANGUAGES,
  DOCUMENT_HYPHENATION,
  DOCUMENTS_KEPT,
  KEPT_AS_TEXT,
};
