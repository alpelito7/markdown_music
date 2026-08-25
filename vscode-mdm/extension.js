const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const { toEditor, fromEditor, frontMatter } = require("./transforms");
const { syntaxPalette, listThemes } = require("./theme");

function activate(context) {
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

// What each export entry asks bin/mdm for, and what it leaves on disk.
const EXPORT_TARGETS = {
  html: { args: ["--to", "html"], outputs: [".html"] },
  pdf: { args: ["--to", "pdf"], outputs: [".pdf"] },
  both: { args: [], outputs: [".html", ".pdf"] },
};

// ---------- The look the export is dressed in ----------
//
// The exported HTML reads as the editor does (the page's ground, the ink, the
// code cards and their colours, the scores and the player bar), and what the
// editor is showing right now travels to the renderer as metadata the Lua
// filter reads: see the look section of _extensions/mdm/mdm.lua, which holds
// the other end of this. A render with none of it, `bin/mdm render` from a
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

// The same renderer the command line uses. Looked for in the workspace of
// the document first; failing that, next to this extension, which during
// development is a symlink into the repo, so ../bin/mdm is the real one.
function findRenderer(documentUri) {
  const candidates = [];
  const folder =
    vscode.workspace.getWorkspaceFolder &&
    vscode.workspace.getWorkspaceFolder(documentUri);
  if (folder) candidates.push(path.join(folder.uri.fsPath, "bin", "mdm"));
  candidates.push(path.resolve(__dirname, "..", "bin", "mdm"));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (e) {
      // unreadable candidate: try the next
    }
  }
  return null;
}

// Export = save, then render. Saving first is what makes the export button a
// save button too: what lands in the HTML and the PDF is always what is on
// screen, never a stale file. Rendering goes through bin/mdm (Quarto under
// it), with a progress notice while it runs, since a PDF takes seconds. The
// look of the editor travels with the call (exportLook above), so the HTML
// comes out dressed as the editor it was exported from.
async function exportDocument(document, to) {
  const target = EXPORT_TARGETS[to];
  if (!target) return;
  if (document.isDirty) {
    const saved = await vscode.workspace.save(document.uri);
    if (!saved) return; // an unsaved untitled document, or the user backed out
  }
  const renderer = findRenderer(document.uri);
  if (!renderer) {
    vscode.window.showErrorMessage(
      "MDM: bin/mdm was not found (looked in the workspace and next to the extension)."
    );
    return;
  }
  const file = document.uri.fsPath;
  const pretty = path.basename(file);
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
          child = cp.spawn(
            renderer,
            ["render", file].concat(target.args).concat(exportLook()),
            { cwd: path.dirname(file) }
          );
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
  if (result.code !== 0) {
    vscode.window.showErrorMessage(
      "MDM: export failed: " + result.log.slice(-300).trim()
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

module.exports = { activate, deactivate };
