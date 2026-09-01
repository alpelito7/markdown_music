const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const { toEditor, fromEditor, frontMatter } = require("./transforms");
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
// two files in step.
const SETTINGS = {
  theme: ["auto", "light", "dark", "white"],
  scoreFill: ["none", "paper", "slate", "brass"],
  staffLines: ["gray", "ink"],
  scoreAlign: ["center", "left"],
  frontMatter: ["hidden", "shown"],
  outline: ["hidden", "shown"],
  multicursorMatch: ["word", "substring"],
};

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
async function writeSetting(key, value) {
  let stored;
  if (SETTINGS[key]) {
    if (allowedValues(key).indexOf(value) === -1) return;
    stored = value;
  } else if (NUMBER_SETTINGS[key]) {
    if (typeof value !== "number" || !isFinite(value)) return;
    stored = numberSetting(key, value);
  } else {
    return;
  }
  const config = vscode.workspace.getConfiguration("mdm");
  const inspected = config.inspect(key);
  const target =
    inspected && inspected.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await config.update(key, stored, target);
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
const EXPORT_TARGETS = {
  html: { args: ["--to", "html"], outputs: [".html"] },
  pdf: { args: ["--to", "pdf"], outputs: [".pdf"] },
  both: { args: ["--to", "html,pdf"], outputs: [".html", ".pdf"] },
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

// The metadata arguments for one render. The palette goes only while it is on
// the same side as the editor, again as the webview does (applyPalette):
// mdm.theme can hold this editor to light with VS Code on a dark theme, and
// dark syntax colours on a light ground are unreadable.
function exportLook() {
  try {
    const installed = themes();
    const settings = readSettings(installed);
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
      // Not a colour, but the same kind of thing: what the editor is showing.
      // The title block Quarto draws from the YAML belongs to the header, so
      // an export from an editor that is hiding the header renders a document
      // that does not open with it either (the TITLE_BLOCK of mdm.lua).
      "-M",
      "mdm-front-matter:" + settings.frontMatter,
    ];
    const palette = readPalette(installed).palette;
    const usable =
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
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch (e) {
        // an unreadable entry of the PATH is not a match
      }
    }
  }
  return null;
}

// The Lua filter that turns .abc fences into scores, shipped inside this
// extension. The same directory is _extensions/mdm in the repository and a
// test pins the two byte for byte, so this copy is the one that runs whether
// the extension was installed from a .vsix or symlinked from a clone.
const FILTER = path.join(__dirname, "render", "mdm", "mdm.lua");

// What engraves the scores of a PDF: a Chrome, into which the filter loads
// the editor's own abcjs and prints, or failing that abcm2ps, a separate
// LGPL-3.0-or-later program credited in THIRD-PARTY-NOTICES.md. Neither is
// shipped. These searches mirror mdm.lua's (find_chrome and find_abcm2ps)
// as far as they can from here: the filter alone resolves a `mdm.chrome`
// or a `mdm.abcm2ps` named in the YAML header, which is why a document
// that names a chrome of its own is waved through below rather than
// refused for a Chrome this search cannot see. Run before Quarto so a
// machine with neither engraver is told out loud: with only one of the two
// the filter manages by itself, and without both it only warns and the
// PDF comes out with its scores left as text, which is worse than not
// exporting.
function findChrome() {
  const names = [
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
  ];
  for (const name of names) {
    const hit = onPath(name);
    if (hit) return hit;
  }
  if (process.platform === "darwin") {
    const app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try {
      if (fs.existsSync(app)) return app;
    } catch (e) {
      // unreadable: then it is not the export's to spend
    }
  }
  return null;
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

// Whether the document holds a score at all, in either of the two forms that
// give Pandoc the class: ```abc and ```{.abc}. One that holds none never
// engraves, so it exports to PDF with neither Chrome nor abcm2ps.
function hasScores(text) {
  return /^[ \t]*(?:`{3,}|~{3,})[ \t]*(?:\{[^}\n]*\.abc\b|abc\b)/m.test(text);
}

// Whether the YAML header names a chrome of its own (mdm.chrome). The
// filter resolves it, so the export is let through to it.
function namesChrome(text) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return !!header && /^[ \t]+chrome[ \t]*:/m.test(header[1]);
}

// One way out for every export that cannot go on, and for every one that
// fails: the whole story to the channel, one line to the notification, and a
// button to get from the one to the other. A toast truncates, does not scroll
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
async function exportDocument(document, to) {
  const target = EXPORT_TARGETS[to];
  if (!target) return;
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
  const quarto = onPath("quarto");
  if (!quarto) {
    exportFailed(
      "Quarto is not installed, so there is nothing to export with. The editor works without it.",
      "quarto was not found on the PATH.\nPATH: " +
        (process.env.PATH || "") +
        "\nInstall it from https://quarto.org/docs/get-started/ and reopen the window."
    );
    return;
  }
  if (
    target.outputs.indexOf(".pdf") !== -1 &&
    hasScores(text) &&
    !findChrome() &&
    !findAbcm2ps(dir) &&
    !namesChrome(text)
  ) {
    exportFailed(
      "neither Chrome nor abcm2ps is installed, and a PDF needs one of them to engrave the scores.",
      "No Chrome or Chromium was found on the PATH to engrave the scores " +
        "with the editor's own abcjs, and no abcm2ps in " +
        path.join(dir, "tools", "bin") +
        " nor on the PATH to fall back to, and this document has scores in " +
        "it. Without either the PDF would come out with them left as text.\n" +
        "Install Chrome or Chromium (preferred: the PDF then shows the very " +
        "scores the editor does), or Debian and Ubuntu: apt install " +
        "abcm2ps. macOS: brew install abcm2ps."
    );
    return;
  }
  const copy = file.replace(/\.mdm$/i, "") + ".qmd";
  if (fs.existsSync(copy)) {
    exportFailed(
      "a file named " + path.basename(copy) + " is in the way of the export.",
      "The export renders a copy of the document named " +
        copy +
        ", and something of that name is already there. It is not overwritten."
    );
    return;
  }
  const pretty = path.basename(file);
  const args = renderArgs(text, copy, target.args.concat(exportLook()));
  channel().appendLine(
    "[" + new Date().toISOString() + "] " + pretty + " \u2192 " + to
  );
  channel().appendLine("  " + quarto + " " + args.join(" ") + "  (in " + dir + ")");
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "MDM: exporting " + pretty + "\u2026",
    },
    function () {
      return new Promise(function (resolve) {
        let log = "";
        let child;
        try {
          fs.writeFileSync(copy, withReader(withFilter(text, FILTER), READER));
          child = cp.spawn(quarto, args, { cwd: dir });
        } catch (e) {
          resolve({ code: -1, log: String(e.message || e) });
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
          resolve({ code: code, log: log });
        });
      });
    }
  );
  try {
    fs.unlinkSync(copy);
  } catch (e) {
    // never rendered, or already gone: nothing to take away
  }
  if (result.log) channel().appendLine(result.log.trimEnd());
  if (result.code !== 0) {
    exportFailed(
      "the export of " + pretty + " failed.",
      "Quarto exited with " + result.code + "."
    );
    return;
  }
  const base = file.replace(/\.mdm$/i, "");
  const produced = target.outputs.map(function (ext) {
    return base + ext;
  });
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
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        docDir,
      ],
    };
    webview.html = this.getHtml(webview, docDir);

    // >0 while we apply changes that came from the webview to the
    // TextDocument, so we do not send them back (infinite echo). A counter and
    // not a boolean: two onDidReceiveMessage calls can overlap on their await.
    let applyingFromWebview = 0;

    // `withFrontMatter` travels with the text it describes, so an edit written
    // under the previous setting is still read as what it was (see
    // transforms.js). `frontMatter` carries the header itself, which the
    // webview only needs to know whether the file has one.
    const updateMsg = () => {
      const withFrontMatter = readSettings().frontMatter === "shown";
      return {
        type: "update",
        text: toEditor(document.getText(), withFrontMatter),
        frontMatter: frontMatter(document.getText()),
        withFrontMatter: withFrontMatter,
      };
    };

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

    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("mdm") ||
        e.affectsConfiguration("editor.multiCursorModifier")
      ) {
        webview.postMessage({ type: "settings", settings: readSettings() });
        // mdm.frontMatter decides what the editor text holds, so the document
        // is re-sent in whichever mode is now in force. The other settings only
        // repaint, and for them this update lands on identical text and the
        // webview drops it.
        webview.postMessage(updateMsg());
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

    webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "ready") {
        webview.postMessage(updateMsg());
      } else if (msg.type === "setSetting") {
        try {
          await writeSetting(msg.key, msg.value);
        } catch (e) {
          vscode.window.showErrorMessage(
            "MDM: could not save mdm." + msg.key + " (" + e.message + ")"
          );
        }
      } else if (msg.type === "export") {
        try {
          await exportDocument(document, msg.to);
        } catch (e) {
          vscode.window.showErrorMessage("MDM: export failed (" + e.message + ")");
        }
      } else if (msg.type === "edit") {
        const newText = fromEditor(
          msg.text,
          document.getText(),
          !!msg.withFrontMatter
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
        // host-side canonicalization changed the body). Echoing unconditionally
        // re-rendered the editor after every first edit, destroying the fresh
        // empty paragraph a lone Enter creates (empty paragraphs do not
        // serialize), which read as "my Enter got reverted".
        const echo = updateMsg();
        if (echo.text !== msg.text) {
          webview.postMessage(echo);
        }
      }
    });
  }

  getHtml(webview, docDir) {
    const mediaUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media")
    );
    const docBase = docDir ? webview.asWebviewUri(docDir).toString() : "";
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
window.MDM_SOUNDFONT = "${mediaUri}/vendor/soundfont/";
window.MDM_SETTINGS = ${inlineJson(readSettings())};
window.MDM_THEMES = ${inlineJson(themes())};
window.MDM_PALETTE = ${inlineJson(readPalette())};
</script>
<script src="${mediaUri}/vendor/cm6/cm6.bundle.js"></script>
<script src="${mediaUri}/vendor/abcjs/abcjs-basic-min.js"></script>
</head>
<body>
<div id="app"></div>
<script src="${mediaUri}/main.js"></script>
</body>
</html>`;
  }
}

function deactivate() {}

// withFilter, withReader, hasScores and renderArgs are pure and are exported
// for the tests: they decide what Quarto is handed, which is the half of the
// export that can be checked without running anything.
module.exports = {
  activate,
  deactivate,
  withFilter,
  withReader,
  hasScores,
  renderArgs,
  FILTER,
  READER,
};
