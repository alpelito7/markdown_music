// Tests for the host side of the VS Code extension (vscode-mdm/extension.js):
// the settings allowlist that guards the webview HTML against injection from a
// workspace settings.json, the write-target choice, and the update/edit/echo
// message protocol. The vscode API is replaced by tests/mocks/vscode.js.
// Run with: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const Module = require("node:module");

// Route require("vscode") to the mock before the extension is loaded.
const MOCK = path.join(__dirname, "mocks", "vscode.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "vscode") return MOCK;
  return origResolve.call(this, request, ...rest);
};

const vscode = require("vscode");
const ext = require("../vscode-mdm/extension.js");

// Boot the provider against a fake document and webview, returning handles to
// drive it: the messages it posted, a way to deliver webview messages, and
// the mock state.
function boot(initialText, settings, extensions, uriString) {
  vscode._reset();
  Object.assign(vscode._state.settings, settings || {});
  if (extensions) vscode._state.extensions = extensions;
  const context = {
    subscriptions: [],
    extensionUri: vscode.Uri.file("/ext"),
  };
  ext.activate(context);
  const provider = vscode._state.registeredProviders[0].provider;

  const uri = uriString || "file:///doc.mdm";
  vscode._state.documents.set(uri, initialText);
  const document = vscode._makeDocument(uri);

  const posted = [];
  let receive = null;
  let disposed = null;
  const webviewPanel = {
    webview: {
      set options(v) {},
      set html(v) {
        this._html = v;
      },
      get html() {
        return this._html;
      },
      asWebviewUri: (u) => u,
      cspSource: "vscode-resource:",
      postMessage(msg) {
        posted.push(msg);
        return Promise.resolve(true);
      },
      onDidReceiveMessage(handler) {
        receive = handler;
      },
    },
    onDidDispose(handler) {
      disposed = handler;
    },
  };
  provider.resolveCustomTextEditor(document, webviewPanel);
  return {
    document,
    posted,
    receive: (msg) => receive(msg),
    dispose: () => disposed(),
    html: webviewPanel.webview.html,
  };
}

// ---------- Settings allowlist ----------

test("hostile setting values never reach the webview HTML", () => {
  const h = boot("Body\n", {
    "mdm.theme": '</script><script>alert(1)</script>',
    "mdm.scoreFill": "x y",
    "mdm.staffLines": 42,
    "mdm.scoreAlign": "left; drop",
    "mdm.frontMatter": null,
  });
  assert.ok(!h.html.includes("alert(1)"));
  const m = /window\.MDM_SETTINGS = (\{.*?\});/.exec(h.html);
  assert.ok(m, "MDM_SETTINGS must be present");
  assert.deepEqual(JSON.parse(m[1]), {
    theme: "auto",
    scoreFill: "none",
    staffLines: "gray",
    scoreAlign: "center",
    frontMatter: "hidden",
    multiCursorModifier: "alt",
  });
});

test("valid setting values pass through to the webview HTML", () => {
  const h = boot("Body\n", {
    "mdm.theme": "dark",
    "mdm.scoreFill": "brass",
    "mdm.staffLines": "ink",
    "mdm.scoreAlign": "left",
    "mdm.frontMatter": "shown",
  });
  const m = /window\.MDM_SETTINGS = (\{.*?\});/.exec(h.html);
  assert.deepEqual(JSON.parse(m[1]), {
    theme: "dark",
    scoreFill: "brass",
    staffLines: "ink",
    scoreAlign: "left",
    frontMatter: "shown",
    multiCursorModifier: "alt",
  });
});

test("the webview HTML carries a CSP without eval, and the editor bundle", () => {
  const h = boot("Body\n", {});
  assert.ok(h.html.includes("Content-Security-Policy"));
  assert.ok(h.html.includes("default-src 'none'"));
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(h.html)[1];
  // CodeMirror, KaTeX and abcjs run without eval; the grant is gone.
  assert.doesNotMatch(csp, /unsafe-eval/);
  // The bundle and KaTeX's stylesheet come from the vendor folder; nothing
  // of the old engine is left in the page.
  assert.ok(h.html.includes("/vendor/cm6/cm6.bundle.js"));
  assert.ok(h.html.includes("/vendor/cm6/katex.min.css"));
  assert.ok(!/vditor/i.test(h.html));
  // The folder of the document is handed over for relative images.
  assert.match(h.html, /window\.MDM_DOC_BASE = "[^"]+"/);
});

test("VS Code's multiCursorModifier is passed along, ctrlCmd or alt", () => {
  const h = boot("Body\n", { "editor.multiCursorModifier": "ctrlCmd" });
  const m = /window\.MDM_SETTINGS = (\{.*?\});/.exec(h.html);
  assert.equal(JSON.parse(m[1]).multiCursorModifier, "ctrlCmd");
  const h2 = boot("Body\n", { "editor.multiCursorModifier": "bogus" });
  const m2 = /window\.MDM_SETTINGS = (\{.*?\});/.exec(h2.html);
  assert.equal(JSON.parse(m2[1]).multiCursorModifier, "alt");
});

// ---------- setSetting ----------

test("setSetting writes an allowed value and picks the Global target", async () => {
  const h = boot("Body\n", {});
  await h.receive({ type: "setSetting", key: "theme", value: "dark" });
  assert.deepEqual(vscode._state.updates, [
    {
      key: "mdm.theme",
      value: "dark",
      target: vscode.ConfigurationTarget.Global,
    },
  ]);
});

test("setSetting keeps writing at Workspace level when pinned there", async () => {
  const h = boot("Body\n", {});
  vscode._state.settingsWorkspace["mdm.theme"] = "light";
  await h.receive({ type: "setSetting", key: "theme", value: "dark" });
  assert.equal(
    vscode._state.updates[0].target,
    vscode.ConfigurationTarget.Workspace
  );
});

test("white is a theme value of its own, not a name to look up", async () => {
  const h = boot("Body\n", { "mdm.theme": "white" });
  const m = /window\.MDM_SETTINGS = (\{.*?\});/.exec(h.html);
  assert.equal(JSON.parse(m[1]).theme, "white");
  await h.receive({ type: "setSetting", key: "theme", value: "white" });
  assert.equal(vscode._state.updates[0].value, "white");
});

test("setSetting drops unknown keys and disallowed values", async () => {
  const h = boot("Body\n", {});
  await h.receive({ type: "setSetting", key: "evil", value: "dark" });
  await h.receive({ type: "setSetting", key: "theme", value: "neon" });
  await h.receive({ type: "setSetting", key: "__proto__", value: "dark" });
  assert.deepEqual(vscode._state.updates, []);
});

// ---------- ready / update ----------

const DOC = "---\ntitle: t\n---\n\nIntro\n\n```{.abc .play}\nX:1\nK:C\nC\n```\n";

test("ready is answered with the text as written and the header kept aside", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  assert.equal(h.posted.length, 1);
  const msg = h.posted[0];
  assert.equal(msg.type, "update");
  assert.equal(msg.withFrontMatter, false);
  assert.equal(msg.frontMatter, "---\ntitle: t\n---\n");
  // The fence info string is the file's own: nothing is tokenized.
  assert.ok(msg.text.includes("```{.abc .play}\n"));
  assert.ok(!msg.text.includes("title:"));
});

test("with mdm.frontMatter shown, the update carries the header inline", async () => {
  const h = boot(DOC, { "mdm.frontMatter": "shown" });
  await h.receive({ type: "ready" });
  const msg = h.posted[0];
  assert.equal(msg.withFrontMatter, true);
  assert.ok(msg.text.startsWith("---\ntitle: t\n---\n"));
});

// ---------- edit / echo ----------

test("an edit is written to the document with fences and header restored", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  const editorText = h.posted[0].text.replace("Intro", "Edited");
  await h.receive({ type: "edit", text: editorText, withFrontMatter: false });
  assert.equal(h.document.getText(), DOC.replace("Intro", "Edited"));
});

test("a converged edit gets no echo (the first-Enter regression)", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  const before = h.posted.length;
  const editorText = h.posted[0].text.replace("Intro", "Edited");
  await h.receive({ type: "edit", text: editorText, withFrontMatter: false });
  // No update message may follow the edit: an unconditional echo is what used
  // to destroy the fresh empty paragraph a first Enter creates.
  assert.equal(h.posted.length, before);
});

test("an identical edit does not touch the document at all", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  const changes = [];
  vscode._state.textDocumentListeners.push((e) => changes.push(e));
  await h.receive({
    type: "edit",
    text: h.posted[0].text,
    withFrontMatter: false,
  });
  assert.equal(changes.length, 0);
});

test("an edit that the host canonicalizes is echoed back once", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  const before = h.posted.length;
  // With the header hidden, blank lines typed at the very top of the body
  // join the gap under the header on disk, and the host's view of that text
  // (the body without them) differs from what was sent, so an echo must
  // follow: it hands the editor the converged text.
  await h.receive({
    type: "edit",
    text: "\n\nBody\n",
    withFrontMatter: false,
  });
  assert.equal(h.document.getText(), "---\ntitle: t\n---\n\n\n\nBody\n");
  assert.equal(h.posted.length, before + 1);
  const echo = h.posted[h.posted.length - 1];
  assert.equal(echo.type, "update");
  assert.equal(echo.text, "Body\n");
});

test("an edit made in shown mode is honoured after a toggle to hidden", async () => {
  // The withFrontMatter flag travels with the text: an edit written while the
  // header was shown must not be reinterpreted under the new setting.
  const h = boot(DOC, { "mdm.frontMatter": "shown" });
  await h.receive({ type: "ready" });
  const editorText = h.posted[0].text.replace("Intro", "Edited");
  vscode._state.settings["mdm.frontMatter"] = "hidden";
  await h.receive({ type: "edit", text: editorText, withFrontMatter: true });
  assert.equal(h.document.getText(), DOC.replace("Intro", "Edited"));
});

// ---------- external changes and configuration ----------

test("an external document change is forwarded to the webview", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  const before = h.posted.length;
  const newText = DOC.replace("Intro", "External");
  vscode._state.documents.set("file:///doc.mdm", newText);
  vscode._state.textDocumentListeners.forEach((l) =>
    l({ document: h.document })
  );
  assert.equal(h.posted.length, before + 1);
  assert.ok(h.posted[h.posted.length - 1].text.includes("External"));
});

test("changes to other documents are ignored", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  const before = h.posted.length;
  const other = vscode._makeDocument("file:///other.mdm");
  vscode._state.textDocumentListeners.forEach((l) => l({ document: other }));
  assert.equal(h.posted.length, before);
});

test("an mdm configuration change posts settings and a re-mapped update", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  const before = h.posted.length;
  vscode._state.settings["mdm.frontMatter"] = "shown";
  vscode._state.configurationListeners.forEach((l) =>
    l({ affectsConfiguration: (s) => s === "mdm" })
  );
  assert.equal(h.posted.length, before + 2);
  const settingsMsg = h.posted[before];
  assert.equal(settingsMsg.type, "settings");
  assert.equal(settingsMsg.settings.frontMatter, "shown");
  const update = h.posted[before + 1];
  assert.equal(update.type, "update");
  assert.equal(update.withFrontMatter, true);
  assert.ok(update.text.startsWith("---\ntitle: t\n---\n"));
});

test("non-mdm configuration changes are ignored", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  const before = h.posted.length;
  vscode._state.configurationListeners.forEach((l) =>
    l({ affectsConfiguration: () => false })
  );
  assert.equal(h.posted.length, before);
});

test("disposing the panel unsubscribes every listener", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  assert.equal(vscode._state.textDocumentListeners.length, 1);
  assert.equal(vscode._state.configurationListeners.length, 1);
  assert.equal(vscode._state.colorThemeListeners.length, 1);
  h.dispose();
  assert.equal(vscode._state.textDocumentListeners.length, 0);
  assert.equal(vscode._state.configurationListeners.length, 0);
  assert.equal(vscode._state.colorThemeListeners.length, 0);
});

// ---------- Syntax palette ----------

// A theme contributed the way the built-in ones are, with its file on the
// real disk so that the extension reads it as it would in VS Code.
function seedTheme(stringColor) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-theme-"));
  fs.mkdirSync(path.join(dir, "themes"));
  fs.writeFileSync(
    path.join(dir, "themes", "t.json"),
    JSON.stringify({
      type: "dark",
      colors: { "editor.foreground": "#f8f8f2", "editor.background": "#272822" },
      tokenColors: [{ scope: "string", settings: { foreground: stringColor } }],
    })
  );
  return [
    {
      extensionPath: dir,
      packageJSON: {
        contributes: {
          themes: [
            { id: "Test Theme", uiTheme: "vs-dark", path: "./themes/t.json" },
          ],
        },
      },
    },
  ];
}

const THEME_IN_USE = { "workbench.colorTheme": "Test Theme" };

test("the webview HTML carries the palette of the theme in use", async () => {
  const h = boot(DOC, THEME_IN_USE, seedTheme("#e6db74"));
  assert.match(h.html, /window\.MDM_PALETTE = \{"palette":\{"kind":"dark"/);
  assert.match(h.html, /"string":"#e6db74"/);
  h.dispose();
});

test("the installed themes travel to the webview for the toolbar menu", async () => {
  const h = boot(DOC, {}, seedTheme("#e6db74"));
  const m = /window\.MDM_THEMES = (\[.*?\]);/.exec(h.html);
  assert.ok(m, "MDM_THEMES must be present");
  assert.deepEqual(JSON.parse(m[1]), [{ name: "Test Theme", kind: "dark" }]);
  h.dispose();
});

test("mdm.theme accepts the name of an installed theme, and its palette wins", async () => {
  const installed = seedTheme("#e6db74");
  const h = boot(
    DOC,
    { "mdm.theme": "Test Theme", "workbench.colorTheme": "Something Else" },
    installed
  );
  const m = /window\.MDM_SETTINGS = (\{.*?\});/.exec(h.html);
  assert.equal(JSON.parse(m[1]).theme, "Test Theme");
  // The palette is the chosen theme's, not the one VS Code is showing, and it
  // carries the side the editor has to follow.
  const p = /window\.MDM_PALETTE = (\{.*\});/.exec(h.html);
  const payload = JSON.parse(p[1]);
  assert.equal(payload.side, "dark");
  assert.equal(payload.palette.colors.string, "#e6db74");
  h.dispose();
});

test("a theme name nobody contributes falls back to auto", async () => {
  const h = boot(DOC, { "mdm.theme": "Neon Dreams" }, seedTheme("#e6db74"));
  const m = /window\.MDM_SETTINGS = (\{.*?\});/.exec(h.html);
  assert.equal(JSON.parse(m[1]).theme, "auto");
  h.dispose();
});

test("setSetting writes a theme name and refuses one that is not installed", async () => {
  const h = boot(DOC, {}, seedTheme("#e6db74"));
  await h.receive({ type: "setSetting", key: "theme", value: "Test Theme" });
  await h.receive({ type: "setSetting", key: "theme", value: "Neon Dreams" });
  assert.deepEqual(
    vscode._state.updates.map((u) => u.value),
    ["Test Theme"]
  );
  h.dispose();
});

test("a theme name cannot close the script block it is written into", async () => {
  const installed = seedTheme("#e6db74");
  installed[0].packageJSON.contributes.themes[0].id =
    "</script><script>alert(1)</script>";
  const h = boot(DOC, {}, installed);
  assert.ok(!h.html.includes("alert(1)</script>"));
  assert.ok(h.html.includes("\\u003c/script>"));
  h.dispose();
});

test("an unknown theme leaves the palette null, and the webview falls back", async () => {
  const h = boot(DOC, { "workbench.colorTheme": "Nobody's Theme" });
  assert.match(h.html, /window\.MDM_PALETTE = \{"palette":null,"side":null\};/);
  h.dispose();
});

test("switching the VS Code theme sends a new palette", async () => {
  const h = boot(DOC, THEME_IN_USE, seedTheme("#010203"));
  await h.receive({ type: "ready" });
  h.posted.length = 0;
  vscode._state.colorThemeListeners.forEach((l) => l({ kind: 2 }));
  const msg = h.posted.find((m) => m.type === "palette");
  assert.ok(msg, "no palette message was posted");
  assert.equal(msg.palette.colors.string, "#010203");
  h.dispose();
});

test("a change to mdm.theme sends a palette, other mdm changes do not", async () => {
  const h = boot(DOC, THEME_IN_USE, seedTheme("#070809"));
  await h.receive({ type: "ready" });
  h.posted.length = 0;
  vscode._state.configurationListeners.forEach((l) =>
    l({ affectsConfiguration: (s) => s === "mdm" || s === "mdm.frontMatter" })
  );
  assert.equal(h.posted.filter((m) => m.type === "palette").length, 0);
  h.posted.length = 0;
  vscode._state.configurationListeners.forEach((l) =>
    l({ affectsConfiguration: (s) => s === "mdm" || s === "mdm.theme" })
  );
  assert.equal(h.posted.filter((m) => m.type === "palette").length, 1);
  h.dispose();
});

test("editing workbench.colorTheme by hand sends a new palette too", async () => {
  const h = boot(DOC, THEME_IN_USE, seedTheme("#040506"));
  await h.receive({ type: "ready" });
  h.posted.length = 0;
  vscode._state.configurationListeners.forEach((l) =>
    l({ affectsConfiguration: (s) => s === "workbench.colorTheme" })
  );
  const msg = h.posted.find((m) => m.type === "palette");
  assert.ok(msg, "no palette message was posted");
  assert.equal(msg.palette.colors.string, "#040506");
  h.dispose();
});

test("a failing settings write surfaces as an error message", async () => {
  const h = boot("Body\n", {});
  const config = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: () => undefined,
    inspect: () => ({}),
    update: async () => {
      throw new Error("boom");
    },
  });
  try {
    await h.receive({ type: "setSetting", key: "theme", value: "dark" });
  } finally {
    vscode.workspace.getConfiguration = config;
  }
  assert.equal(vscode._state.errorMessages.length, 1);
  assert.ok(vscode._state.errorMessages[0].includes("mdm.theme"));
});

// ---------- Audio wiring ----------

test("the webview HTML wires the synth engine, the soundfont and the widget stylesheet", () => {
  const h = boot("Body\n");
  // abcjs is a plain script of the page now (it engraves and plays).
  assert.match(
    h.html,
    /<script src="[^"]*\/vendor\/abcjs\/abcjs-basic-min\.js"><\/script>/
  );
  assert.match(
    h.html,
    /window\.MDM_SOUNDFONT = "[^"]*\/vendor\/soundfont\/"/
  );
  assert.ok(h.html.includes("/vendor/abcjs/abcjs-audio.css"));
  // The soundfont arrives over XHR: it dies without this CSP grant.
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(h.html)[1];
  assert.match(csp, /connect-src [^;]*vscode-resource:/);
});

// ---------- Export ----------

test("export saves a dirty document and runs bin/mdm on it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  fs.mkdirSync(path.join(tmp, "bin"));
  const renderer = path.join(tmp, "bin", "mdm");
  fs.writeFileSync(
    renderer,
    '#!/bin/sh\necho "$@" > "$(dirname "$0")/args.txt"\npwd >> "$(dirname "$0")/args.txt"\nexit 0\n'
  );
  fs.chmodSync(renderer, 0o755);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, "Body\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;
  vscode._state.dirtyDocuments.add("file://" + doc);

  await h.receive({ type: "export", to: "html" });

  assert.deepEqual(vscode._state.savedUris, ["file://" + doc], "the document was not saved first");
  const log = fs.readFileSync(path.join(tmp, "bin", "args.txt"), "utf8").trim().split("\n");
  // The look of the editor rides along after the format (see the look tests
  // below); what is pinned here is the call itself.
  assert.equal(log[0].split(" -M ")[0], "render " + doc + " --to html");
  assert.equal(log[1], tmp, "the renderer did not run in the document's folder");
  assert.equal(vscode._state.progressTitles.length, 1);
  assert.match(vscode._state.progressTitles[0], /doc\.mdm/);
  assert.equal(vscode._state.infoMessages.length, 1);
  assert.match(vscode._state.infoMessages[0].message, /doc\.html/);
  assert.deepEqual(vscode._state.infoMessages[0].buttons, ["Open HTML"]);
  assert.deepEqual(vscode._state.errorMessages, []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("exporting both formats passes no --to and offers both files", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  fs.mkdirSync(path.join(tmp, "bin"));
  const renderer = path.join(tmp, "bin", "mdm");
  fs.writeFileSync(renderer, '#!/bin/sh\necho "$@" > "$(dirname "$0")/args.txt"\nexit 0\n');
  fs.chmodSync(renderer, 0o755);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, "Body\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "both" });

  // Clean documents skip the save; bin/mdm's default is already HTML + PDF.
  assert.deepEqual(vscode._state.savedUris, []);
  const args = fs.readFileSync(path.join(tmp, "bin", "args.txt"), "utf8").trim();
  assert.equal(args.split(" -M ")[0], "render " + doc);
  assert.deepEqual(vscode._state.infoMessages[0].buttons, ["Open HTML", "Open PDF"]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- The look the export carries ----------

// One export against a fake bin/mdm that writes down its arguments, and what
// it was called with. `themeKind` is what VS Code itself is showing
// (vscode.ColorThemeKind), which mdm.theme = "auto" follows.
async function exportWith(to, settings, extensions, themeKind) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  fs.mkdirSync(path.join(tmp, "bin"));
  const renderer = path.join(tmp, "bin", "mdm");
  fs.writeFileSync(
    renderer,
    '#!/bin/sh\necho "$@" > "$(dirname "$0")/args.txt"\nexit 0\n'
  );
  fs.chmodSync(renderer, 0o755);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, "Body\n");
  const h = boot("Body\n", settings, extensions, "file://" + doc);
  vscode._state.workspaceFolder = tmp;
  if (themeKind !== undefined) vscode._state.activeColorThemeKind = themeKind;
  await h.receive({ type: "export", to });
  const args = fs.readFileSync(path.join(tmp, "bin", "args.txt"), "utf8").trim();
  fs.rmSync(tmp, { recursive: true, force: true });
  return args;
}

// The -M key:value pairs of a call, as the Lua filter will read them.
function lookOf(args) {
  const parts = args.split(/\s+/);
  const out = {};
  parts.forEach((part, i) => {
    if (parts[i - 1] !== "-M") return;
    const at = part.indexOf(":");
    out[part.slice(0, at)] = part.slice(at + 1);
  });
  return out;
}

test("the export carries the look the editor is showing", async () => {
  const args = await exportWith(
    "html",
    {
      "mdm.theme": "Test Theme",
      "mdm.scoreFill": "brass",
      "mdm.staffLines": "ink",
      "mdm.scoreAlign": "left",
    },
    seedTheme("#e6db74")
  );
  const look = lookOf(args);
  assert.equal(look["mdm-look"], "dark", "the named theme's side did not travel");
  assert.equal(look["mdm-score-fill"], "brass");
  assert.equal(look["mdm-staff-lines"], "ink");
  assert.equal(look["mdm-score-align"], "left");
  // The palette of that same theme, spelt without the `#` a -M value cannot
  // carry (it would open a YAML comment).
  assert.equal(look["mdm-syn-string"], "e6db74");
  assert.equal(look["mdm-syn-base"], "f8f8f2");
  assert.equal(look["mdm-syn-bg"], "272822");
});

test("a palette from the other side is left out of the export", async () => {
  // The editor held to light while VS Code is on a dark theme: the side
  // travels, its colours do not, and the render falls back to the palette the
  // editor itself falls back to.
  const args = await exportWith(
    "html",
    { "mdm.theme": "light", "workbench.colorTheme": "Test Theme" },
    seedTheme("#e6db74")
  );
  const look = lookOf(args);
  assert.equal(look["mdm-look"], "light");
  assert.deepEqual(
    Object.keys(look).filter((k) => k.startsWith("mdm-syn-")),
    [],
    "dark syntax colours were sent for a light page"
  );
});

test("the white page look travels as itself", async () => {
  const args = await exportWith("html", { "mdm.theme": "white" }, null);
  assert.equal(lookOf(args)["mdm-look"], "white");
});

test("on auto the export follows the side VS Code is on", async () => {
  const dark = await exportWith("html", {}, null, vscode.ColorThemeKind.Dark);
  assert.equal(lookOf(dark)["mdm-look"], "dark");
  const light = await exportWith(
    "html",
    {},
    null,
    vscode.ColorThemeKind.HighContrastLight
  );
  assert.equal(lookOf(light)["mdm-look"], "light");
});

test("a failing renderer surfaces its stderr, and a bogus format does nothing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  fs.mkdirSync(path.join(tmp, "bin"));
  const renderer = path.join(tmp, "bin", "mdm");
  fs.writeFileSync(renderer, '#!/bin/sh\necho "quarto exploded" >&2\nexit 3\n');
  fs.chmodSync(renderer, 0o755);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, "Body\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "pdf" });
  assert.equal(vscode._state.errorMessages.length, 1);
  assert.match(vscode._state.errorMessages[0], /export failed/);
  assert.match(vscode._state.errorMessages[0], /quarto exploded/);
  assert.deepEqual(vscode._state.infoMessages, []);

  // An unknown format is refused before anything runs: the wire value comes
  // from the webview, which a compromised document could script.
  await h.receive({ type: "export", to: "html; rm -rf /" });
  assert.equal(vscode._state.errorMessages.length, 1, "a bogus format did something");
  fs.rmSync(tmp, { recursive: true, force: true });
});
