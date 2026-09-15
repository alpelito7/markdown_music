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

function activate(context) {
  globalState = context.globalState;
  context.subscriptions.push(channel());
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

// What each export entry asks Quarto for, and what it leaves on disk.
//
// The two formats are named on the command line rather than left to the
// document. Quarto renders the formats the header declares, and a header that
// declares none, or none at all, is HTML and nothing else: the button said
// HTML + PDF and one file came out. Naming them takes nothing away from a
// document that does declare both, since `--to` picks the formats and the
// options written under each one still apply.
//
// Both is the two exports one after the other, and not one render of two
// formats. Quarto 1.9.37 gives up a render of several formats at the first
// one that fails and leaves the page it had begun as it stood, before its
// resources are put in: with no TeX, `--to html,pdf` left a page of 49,682
// bytes with no KaTeX and no look in it, where `--to html` alone wrote
// 1,876,897 of the finished page from the same copy; and with TeX and a LaTeX
// error it left 17,103 bytes against 1,843,445 (both measured 2026-09-14).
// That page was printed into the PDF with no TeX, and kept as the HTML either
// way. Rendered in a step of its own, the page is finished before the PDF is
// tried, whatever becomes of the PDF. The cost is a second start of Quarto:
// 7.75 and 7.80 s against 7.42 and 7.35 for example.mdm with TeX and a warm
// cache. The PDF's render takes nothing of the page's with it, measured with
// the resources left beside the page rather than embedded.
const EXPORT_TARGETS = {
  html: { args: ["--to", "html"], outputs: [".html"] },
  pdf: { args: ["--to", "pdf"], outputs: [".pdf"] },
  both: { steps: ["html", "pdf"], outputs: [".html", ".pdf"] },
};

// ---------- The look the export is dressed in ----------
//
// What comes out reads as the editor does, on the page and on paper alike (the
// ground, the ink, the code cards and their colours, the scores, the player
// bar in the HTML and the heading sizes in the PDF), and what the editor is
// showing right now travels to the renderer as metadata the Lua filter reads:
// see the look section of _extensions/mdm/mdm.lua, which holds the other end
// of this in look_css for the page and look_tex for the paper. A render with none of it, `bin/mdm render` from a
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
// say, would go to TeX with division on and be divided on paper alone.
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

// What engraves the scores of a PDF, and what the filter needs around it
// (render_latex in mdm.lua). Its first choice is a Chrome, into which it
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
  if (platform === "darwin") {
    const out = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
    if (env.HOME) {
      out.push(
        path.posix.join(
          env.HOME,
          "Applications",
          "Google Chrome.app",
          "Contents",
          "MacOS",
          "Google Chrome"
        )
      );
    }
    return out;
  }
  if (platform === "win32") {
    const roots = [
      env.LOCALAPPDATA,
      env.ProgramFiles || "C:\\Program Files",
      env["ProgramFiles(x86)"],
    ].filter(Boolean);
    return Array.from(new Set(roots)).map(function (root) {
      return path.win32.join(root, "Google", "Chrome", "Application", "chrome.exe");
    });
  }
  return [];
}

function findChrome() {
  const names = [
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome",
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

// What a PDF with scores still lacks, or null when one of the filter's two
// roads is whole: `chrome` when there is no Chrome, and in `tex` the helpers
// of a complete TeX that are missing, by the names they go by on the PATH.
// What is asked for is always Chrome's road, the one that draws the scores
// the editor draws; abcm2ps is offered in the log and nowhere else.
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
// engraves, so it exports to PDF with none of the tools the scores need.
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
function exportFailed(summary, detail) {
  channel().appendLine(detail);
  vscode.window
    .showErrorMessage("MDM: " + summary, "Show log")
    .then(function (choice) {
      if (choice === "Show log") channel().show(true);
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
// "both" whose PDF wants TeX still wrote its page, and a notice that only
// names what is missing leaves the reader looking for it. Those buttons come
// first, since they are the only ones that do something now.
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

// The pages a notice sends its reader to, each seen to answer on 2026-09-12.
const QUARTO_PAGE = "https://quarto.org/docs/get-started/";
const CHROME_PAGE = "https://www.google.com/chrome/";

// For TeX, the distribution that brings everything a PDF of this filter leans
// on, for the system in hand. On a Mac that is MacTeX, which installs
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

// What Quarto says when a PDF is asked of a machine with no TeX at all
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

// The three notices of a missing tool. Each log opens on the way out and
// ends on where the tool was looked for, which is for whoever helps.

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

// A PDF with scores that neither road of the filter can draw (scoresLack).
// What TeX brings is found on the PATH, which the editor reads only when it
// starts, so a notice that asks for TeX asks for a restart as well. One that
// asks for Chrome alone does not: on a Mac Chrome is found in /Applications,
// where its installer puts it, and on Linux its package links it into
// /usr/bin, which is on the PATH already.
// `printed` says a Chrome was there and the page was printed with it and that
// did not work either, which is the only way the TeX-only wording is reached
// now: with a Chrome and without it, the export prints the page rather than
// stop (printInstead). Without saying so the notice sent the reader off to
// install TeX for a PDF that had just failed for a second reason, which is in
// the log. `page` is the HTML of a "both" that did land.
function scoresMissing(lack, dir, printed, page) {
  const app = appName();
  const platform = process.platform;
  const installs = chromeInstalls(platform, process.env);
  const tex = lack.tex.length > 0;
  let summary;
  if (printed) {
    summary =
      "the PDF could not be made. Its scores need a complete TeX, and " +
      "printing the page with Chrome instead did not work either. The log " +
      "says what Chrome said.";
  } else if (lack.chrome && tex) {
    summary =
      "a PDF with scores needs Google Chrome and a complete TeX to draw them, " +
      "and this computer does not have them. Install both, then quit " + app +
      ", open it again and export.";
  } else if (lack.chrome) {
    summary =
      "a PDF with scores needs Google Chrome to draw them, and it is not " +
      "installed on this computer. Install it and export again.";
  } else {
    summary =
      "a PDF with scores needs a complete TeX to draw them, and this computer " +
      "does not have one. Install it, then quit " + app + ", open it again and export.";
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
    "A PDF draws its scores as the editor does with three programs: Google " +
      "Chrome prints them, and pdfcrop, with Ghostscript, trims them to the ink.",
    "Not found on this computer: " + missing.join(", ") + ".",
  ]
    .concat(steps(todo))
    .concat([
      "An export to HTML draws the scores with none of them.",
      "abcm2ps can draw the scores instead of Chrome, in a look of its own (on a " +
        "Mac: brew install abcm2ps; on Debian or Ubuntu: sudo apt install " +
        "abcm2ps). It needs epstopdf and Ghostscript as well, which come with TeX.",
    ]);
  if (platform === "win32") {
    lines.push(
      "On Windows the scores of a PDF have not been tried, and may not come out " +
        "even with all of this installed."
    );
  }
  lines.push(
    "Looked for Chrome as google-chrome, google-chrome-stable, chromium and " +
      "chromium-browser or chrome in every folder of the PATH" +
      (installs.length ? ", and at:" : ".")
  );
  installs.forEach(function (p) {
    lines.push("  " + p);
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

// A PDF Quarto found no TeX for (NO_TEX). Quarto's own words are already in
// the log, above this. Called only when printInstead (below) found no
// Chrome to print with either, or printed and it still failed.
// `page` is the HTML of a "both" that did land: Quarto writes the page before
// it reports that the PDF half found no TeX (measured on 1.9.37), so the run
// that ends here has still produced something, and a notice that says only
// what is missing leaves the reader hunting for it.
function texMissing(page) {
  const app = appName();
  const platform = process.platform;
  const lines = ["A PDF needs TeX, and Quarto found none on this computer (its own words are above)."]
    .concat(
      steps([
        texStep(platform),
        "Quit " + app + " completely and open it again, so it finds what was installed.",
        "Export again.",
      ])
    )
    .concat(["An export to HTML needs no TeX."]);
  if (page) lines.push(path.basename(page) + " was exported and is beside the document.");
  exportNeeds(
    "a PDF needs TeX, a free program that lays out the pages, and it is not " +
      "installed on this computer. Install it, then quit " + app +
      ", open it again and export." +
      (page ? " " + path.basename(page) + " was exported." : ""),
    lines.join("\n"),
    { "Download TeX": texPage(platform) },
    page ? { "Open HTML": page } : null
  );
}

// ---------- Printing the page, when there is no TeX to typeset it ----------
//
// A PDF Quarto could not draw for want of TeX is not the only page this
// project already prints rather than typesets: the filter does the same for
// one score at a time, loading the editor's own abcjs into a headless Chrome
// and asking it to print (engrave_abcjs in mdm.lua) or, for a figure, one SVG
// (svg_as_pdf). This does the same for the whole document: it prints the
// HTML export Quarto already makes, which the export rule already holds to
// the editor's own look, so the reader gets a real PDF instead of a
// notification with nothing behind it. It is a page, not a typeset book: no
// hyphenation to the measure, no TeX-quality justification, nothing beyond
// what a browser's own print does. Verified end to end on 2026-09-12:
// `quarto render --to html` on example.mdm, printed with the flags below,
// came back a real four-page PDF with its title and its equations, read back
// with pdftotext; the reader that suggested it had just gotten a PDF the same
// way, of a document with none of this filter's own KaTeX or scores, from
// cweijan.vscode-office (out/extension.js: markdown-it and KaTeX render the
// page, puppeteer-core's page.pdf() prints it, no TeX anywhere in it).

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
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
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
      child = cp.spawn(chrome, args);
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

// What the reader is told when this ran and produced the PDF: still a
// warning, and not the plain "exported" of a render that went as asked,
// because what was asked for was a LaTeX PDF and what came out is a page
// printed by a browser. Offers the file it made alongside the way to the
// real one.
function printedNotice(pretty, pdfPath, htmlPath, lack) {
  const app = appName();
  const platform = process.platform;
  const missing = lack
    ? lack.tex.map(function (name) {
        return name === "gs" ? "Ghostscript (gs)" : name;
      })
    : [];
  const lines = [
    lack
      ? "This computer lacks " + missing.join(" and ") + ", so " + pretty +
        " could not typeset its scores with LaTeX."
      : "This computer has no TeX, so " + pretty + " could not be typeset with LaTeX.",
    path.basename(pdfPath) + " was printed from the exported HTML page instead: a " +
      "real PDF, but with the page's own line breaks and spacing, not LaTeX's.",
  ]
    .concat(
      steps([
        texStep(platform),
        "Quit " + app + " completely and open it again, so it finds what was installed.",
        "Export again for the LaTeX PDF.",
      ])
    );
  const buttons = ["Open PDF"];
  if (htmlPath) buttons.push("Open HTML");
  buttons.push("Download TeX", "Show log", "Don't show again");
  channel().appendLine(lines.join("\n"));
  if (vscode.workspace.getConfiguration("mdm").get("showPdfFallbackNotice") === false) {
    return;
  }
  vscode.window
    .showWarningMessage(
      "MDM: " + (lack ? "a complete TeX was not found" : "no TeX was found") +
        ", so " +
        pretty.replace(/\.[^.]+$/, "") +
        ".pdf was printed from the HTML page instead of typeset with LaTeX. " +
        "Install TeX for a typeset PDF.",
      ...buttons
    )
    .then(function (choice) {
      if (choice === "Open PDF") vscode.env.openExternal(vscode.Uri.file(pdfPath));
      else if (choice === "Open HTML") vscode.env.openExternal(vscode.Uri.file(htmlPath));
      else if (choice === "Download TeX") {
        vscode.env.openExternal(vscode.Uri.parse(texPage(platform)));
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
    if (at === -1) lines.splice(i + 1, 0, "  - " + item);
    else lines[at] = lines[at].replace(/-[ \t]*.*$/, "- " + item);
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
const READER = "markdown-blank_before_header-blank_before_blockquote";

// The dialect goes in the header of the copy rather than in a `--from` on the
// command line, which Quarto 1.9.37 does not survive: it dies in its own
// readqmd.lua on a nil metadata table before the document is read.
//
// A document that names a dialect itself keeps it, whether at the top level
// or under a format; only the header is searched, so a line of prose or of
// code that opens with `from:` is not mistaken for that.
function withReader(text, from) {
  const line = "from: " + from;
  const header = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!header) return "---\n" + line + "\n---\n\n" + text;
  if (/^[ \t]*from[ \t]*:/m.test(header[1])) return text;
  return (
    "---\n" + line + "\n" + header[1] + "\n---\n" + text.slice(header[0].length)
  );
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
  const header = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (header && /^[ \t]*pagetitle[ \t]*:/m.test(header[1])) return text;
  const line = "pagetitle: " + quoteYaml(name);
  if (!header) return "---\n" + line + "\n---\n\n" + text;
  return (
    "---\n" + line + "\n" + header[1] + "\n---\n" + text.slice(header[0].length)
  );
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
  const header = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const head = header ? text.slice(0, header[0].length) : "";
  const lines = (header ? text.slice(header[0].length) : text).split(/\r?\n/);
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
    if (interruptsText(lines, i) && out[out.length - 1].trim()) out.push("");
    out.push(line);
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
function renderArgs(text, copy, extra) {
  const args = ["render", copy];
  if (!/^[ \t]*format-links[ \t]*:/m.test(text)) {
    args.push("-M", "format-links:false");
  }
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
  const target = EXPORT_TARGETS[to];
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
    text = fs.readFileSync(file, "utf8");
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
  let printLack = null;
  if (wantsPdf && hasScores(text) && !namesChrome(text)) {
    const lack = scoresLack(dir);
    if (lack) {
      // Chrome can print the finished HTML, scores included, without the TeX
      // helpers its LaTeX road uses. With no Chrome there is no such fallback
      // and the export still has to stop before producing score source as PDF.
      if (!lack.chrome) printLack = lack;
      else {
        scoresMissing(lack, dir);
        return;
      }
    }
  }
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
  const texPath = base + ".tex";
  const filesPath = base + "_files";
  const hadTex = fs.existsSync(texPath);
  const hadFiles = fs.existsSync(filesPath);
  const mediabagPath = path.join(filesPath, "mediabag");
  const hadMediabag = fs.existsSync(mediabagPath);
  // The filter's cache of engravings, CACHE_DIR in mdm.lua, which it writes
  // in the folder Quarto runs in (runQuartoStep: the document's).
  const cachePath = path.join(dir, "mdm_cache");
  const hadCache = fs.existsSync(cachePath);
  // The export opens its own entry in the log here, above anything the guard
  // below or the render itself has to say, so no line of theirs lands under
  // the previous export's header.
  channel().appendLine(
    "[" + new Date().toISOString() + "] " + pretty + " \u2192 " + to
  );
  // Quarto names its LaTeX after the copy's own stem and leaves it there when
  // the engine fails, so a .tex of the reader's at that name is written over
  // before any guard here can spare it: an 11-byte file came back 14,160
  // bytes of Pandoc's preamble (measured on Quarto 1.9.37, 2026-09-13, with
  // no TeX on the PATH). cleanFailedLatex below only declines to delete it,
  // which is too late. Nothing can stop Quarto writing there, so the file is
  // moved out of the way for the length of the render and put back after it.
  // Only for a render that goes to LaTeX; an HTML one never touches it.
  const keptTex = texPath + ".mdm-kept-" + process.pid;
  let texAside = false;
  if (wantsPdf && hadTex) {
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
  const steps = (target.steps || [to]).map(function (name) {
    return { name: name, args: renderArgs(text, copy, EXPORT_TARGETS[name].args.concat(look)) };
  });

  // Every Quarto call, announced and logged as it happens: normally the one
  // render asked for, or for both the page and then the PDF; an HTML-only call
  // instead when the score preflight has already found that LaTeX's road is
  // incomplete; and a second HTML call after a PDF-only render reports that no
  // TeX exists. A .qmd that fails to write never spawns.
  function runQuartoStep(stepArgs) {
    channel().appendLine("  " + quarto + " " + stepArgs.join(" ") + "  (in " + dir + ")");
    return new Promise(function (resolve) {
      let log = "";
      let child;
      try {
        child = cp.spawn(quarto, stepArgs, { cwd: dir });
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

  // Reached whenever a PDF cannot be typeset: before rendering when a score
  // lacks LaTeX's helper programs, or after Quarto reports no TeX. `ok` says
  // a PDF now sits at the requested path anyway, printed rather than typeset.
  // Otherwise `why` is what stopped it, so that the caller does not report
  // one failure as another: "render" carries Quarto's own exit code, since a
  // page Quarto could not render is not a missing program and a reader sent
  // to install one would get the same failure back.
  async function printInstead(htmlReady) {
    const chrome = findChrome();
    if (!chrome) return { ok: false, why: "nochrome" };
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
    const htmlPath = wantsHtml ? base + ".html" : scratchHtml;
    try {
      if (!htmlReady) {
        const htmlCopy = wantsHtml ? copy : scratchCopy;
        if (!wantsHtml) fs.copyFileSync(copy, scratchCopy, fs.constants.COPYFILE_EXCL);
        const htmlArgs = renderArgs(
          text,
          htmlCopy,
          EXPORT_TARGETS.html.args.concat(exportLook(document, text))
        );
        const step = await runQuartoStep(htmlArgs);
        if (step.code !== 0) return { ok: false, why: "render", code: step.code };
        if (!isFile(htmlPath)) return { ok: false, why: "nohtml" };
      } else if (!isFile(htmlPath)) {
        // Both renders its page in a step of its own before the PDF is tried
        // (EXPORT_TARGETS); nothing can be printed without it.
        return { ok: false, why: "nohtml" };
      }
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
        return { ok: false, why: "print" };
      }
      return { ok: true };
    } catch (e) {
      channel().appendLine("Printing the HTML fallback failed: " + String(e.message || e));
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
            withPageTitle(
              withReader(withFilter(withBreaks(text), FILTER), READER),
              path.basename(base)
            )
          );
        } catch (e) {
          // A read-only folder, or a full disk. Quarto never ran, so the
          // "Quarto exited with -1" this used to end in named a program that
          // had not started and left the reader nothing to act on (measured
          // on 2026-09-13 with the document's folder at mode 555).
          return { code: -1, unwritable: String(e.message || e) };
        }
        if (printLack) {
          const print = await printInstead(false);
          if (print.ok) return { code: 0, printed: true, printLack: printLack };
          if (print.why === "render") return { code: print.code };
          if (print.why === "nohtml") {
            return {
              code: -1,
              detail:
                "Quarto finished without writing the page the PDF was to be " +
                "printed from.",
            };
          }
          return { code: -1, scoresLack: printLack, printTried: true };
        }
        let primary;
        let failed = null;
        for (const step of steps) {
          primary = await runQuartoStep(step.args);
          if (primary.code !== 0) {
            failed = step.name;
            break;
          }
        }
        if (primary.code === 0) return { code: 0 };
        if (failed === "pdf" && NO_TEX.test(primary.log)) {
          const print = await printInstead(wantsHtml);
          cleanFailedLatex();
          if (print.ok) return { code: 0, printed: true };
          return { code: primary.code, noTex: true };
        }
        if (failed === "pdf") removeFailedFolders();
        return { code: primary.code };
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
  if (outcome.scoresLack) {
    scoresMissing(outcome.scoresLack, dir, outcome.printTried, page);
    return;
  }
  if (outcome.noTex) {
    texMissing(page);
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
    exportFailed(
      "the export of " + pretty + " failed.",
      outcome.detail ||
        (outcome.code === -1
          ? "Quarto did not run to the end; the reason is above."
          : "Quarto exited with " + outcome.code + ".")
    );
    return;
  }
  const produced = target.outputs.map(function (ext) {
    return base + ext;
  });
  if (outcome.printed) {
    printedNotice(
      pretty,
      base + ".pdf",
      wantsHtml ? base + ".html" : null,
      outcome.printLack
    );
    return;
  }
  const names = produced.map(function (p) {
    return path.basename(p);
  });
  const buttons = produced.map(function (p) {
    return "Open " + path.extname(p).slice(1).toUpperCase();
  });
  vscode.window
    .showInformationMessage("MDM: exported " + names.join(" and "), ...buttons)
    .then(function (choice) {
      const i = buttons.indexOf(choice);
      if (i !== -1) vscode.env.openExternal(vscode.Uri.file(produced[i]));
    });
}

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
    const updateMsg = () => {
      const withFrontMatter = readSettings().frontMatter === "shown";
      const text = document.getText();
      return {
        type: "update",
        text: toEditor(text, withFrontMatter),
        frontMatter: toLf(frontMatter(text)),
        withFrontMatter: withFrontMatter,
        hiddenLines: hiddenLines(text, withFrontMatter),
      };
    };

    // The line ending of the file, the one every text written back to it
    // carries. Everything that travels to the webview is LF (see
    // transforms.js), so this is the host's business alone.
    const eol = () =>
      document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (
        e.document.uri.toString() === document.uri.toString() &&
        applyingFromWebview === 0
      ) {
        webview.postMessage(updateMsg());
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
    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      configSub.dispose();
      themeSub.dispose();
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
        webview.postMessage(updateMsg());
      } else if (msg.type === "setSetting") {
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
        if (own) sendSettings();
      } else if (msg.type === "export") {
        try {
          await exportDocument(document, msg.to);
        } catch (e) {
          vscode.window.showErrorMessage("MDM: export failed (" + e.message + ")");
        }
      } else if (msg.type === "edit") {
        await inTurn(async () => {
          const newText = fromEditor(
            msg.text,
            document.getText(),
            !!msg.withFrontMatter,
            eol()
          );
          if (newText === document.getText()) return;
          applyingFromWebview++;
          try {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
            edit.replace(document.uri, fullRange, newText);
            await vscode.workspace.applyEdit(edit);
          } finally {
            applyingFromWebview--;
          }
          // Convergence echo, ONLY when the document ended up differing from
          // what the webview sent (an external update crossed in flight, or a
          // host-side canonicalization changed the body). Echoing
          // unconditionally re-rendered the editor after every first edit,
          // destroying the fresh empty paragraph a lone Enter creates (empty
          // paragraphs do not serialize), which read as "my Enter got
          // reverted".
          const echo = updateMsg();
          if (echo.text !== msg.text) {
            webview.postMessage(echo);
          }
        });
      } else if (msg.type === "setLanguage") {
        if (LANGUAGES.indexOf(msg.lang) === -1) return;
        await inTurn(() => writeLanguage(msg.lang));
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
</head>
<body>
<div id="app"></div>
<script src="${mediaUri}/main.js"></script>
</body>
</html>`;
  }
}

function deactivate() {}

// withFilter, withReader, withBreaks, hasScores and renderArgs are pure and
// are exported for the tests: they decide what Quarto is handed, which is the
// half of the export that can be checked without running anything. So are
// quartoInstalls and texPage, which say where a missing tool is looked for
// and where its reader is sent on each system; chromeInstalls does the same
// for Chrome, and a test can only run on one system. The key and the bound of
// the divisions kept go out for the tests as
// well, which seed and read VS Code's globalState through them.
module.exports = {
  activate,
  deactivate,
  withFilter,
  withReader,
  withBreaks,
  withPageTitle,
  hasScores,
  renderArgs,
  quartoInstalls,
  chromeInstalls,
  texPage,
  FILTER,
  READER,
  LANGUAGES,
  DOCUMENT_HYPHENATION,
  DOCUMENTS_KEPT,
};
