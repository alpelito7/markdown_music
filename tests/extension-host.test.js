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
  });
});

test("the webview HTML carries a CSP and the icon sprite preload", () => {
  const h = boot("Body\n", {});
  assert.ok(h.html.includes("Content-Security-Policy"));
  assert.ok(h.html.includes("default-src 'none'"));
  assert.ok(h.html.includes('id="vditorIconScript"'));
  // The sprite must load inside <body> (ant.js writes to document.body).
  const body = h.html.slice(h.html.indexOf("<body>"));
  assert.ok(body.includes("vditorIconScript"));
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

test("ready is answered with tokenized text and the header kept aside", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  assert.equal(h.posted.length, 1);
  const msg = h.posted[0];
  assert.equal(msg.type, "update");
  assert.equal(msg.withFrontMatter, false);
  assert.equal(msg.frontMatter, "---\ntitle: t\n---\n");
  assert.ok(msg.text.includes("```mdm-abc-play\n"));
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
  // A hand-typed ```{.abc} goes to disk verbatim (fromEditor only restores
  // this editor's own tokens), but the host's re-tokenized view of that text
  // (mdm-abc) differs from what was sent, so an echo must follow: it hands the
  // editor the token, and the next save normalizes the file to ```abc.
  await h.receive({
    type: "edit",
    text: "```{.abc}\nX:1\n```\n",
    withFrontMatter: false,
  });
  assert.equal(
    h.document.getText(),
    "---\ntitle: t\n---\n\n```{.abc}\nX:1\n```\n"
  );
  assert.equal(h.posted.length, before + 1);
  const echo = h.posted[h.posted.length - 1];
  assert.equal(echo.type, "update");
  assert.ok(echo.text.includes("```mdm-abc\n"));
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
  assert.match(
    h.html,
    /window\.MDM_ABCJS6 = "[^"]*\/vendor\/abcjs\/abcjs-basic-min\.js"/
  );
  assert.match(
    h.html,
    /window\.MDM_SOUNDFONT = "[^"]*\/vendor\/soundfont\/"/
  );
  assert.ok(h.html.includes("/vendor/abcjs/abcjs-audio.css"));
  // The loader in main.js evaluates abcjs 6 with Function(), and the soundfont
  // arrives over XHR: both die without these two CSP grants.
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(h.html)[1];
  assert.match(csp, /script-src [^;]*'unsafe-eval'/);
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
  assert.equal(log[0], "render " + doc + " --to html");
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
  assert.equal(args, "render " + doc);
  assert.deepEqual(vscode._state.infoMessages[0].buttons, ["Open HTML", "Open PDF"]);
  fs.rmSync(tmp, { recursive: true, force: true });
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
