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
      set options(v) {
        this._options = v;
      },
      get options() {
        return this._options;
      },
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
    options: webviewPanel.webview.options,
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
    "mdm.outline": { shown: true },
    "mdm.outlineWidth": "</script>",
    "mdm.multicursorMatch": ["substring"],
    "mdm.followMusic": 0,
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
    outline: "hidden",
    multicursorMatch: "word",
    followMusic: "follow",
    outlineWidth: 250,
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
    "mdm.outline": "shown",
    "mdm.outlineWidth": 480,
    "mdm.multicursorMatch": "substring",
    "mdm.followMusic": "still",
  });
  const m = /window\.MDM_SETTINGS = (\{.*?\});/.exec(h.html);
  assert.deepEqual(JSON.parse(m[1]), {
    theme: "dark",
    scoreFill: "brass",
    staffLines: "ink",
    scoreAlign: "left",
    frontMatter: "shown",
    outline: "shown",
    multicursorMatch: "substring",
    followMusic: "still",
    outlineWidth: 480,
    multiCursorModifier: "alt",
  });
});

// The width of the outline panel is the one setting that is a number, so it is
// held to a band instead of to a list of words: the two jobs the allowlist does
// (a settings.json carries anything, and these values are written into the
// webview HTML) are done here by a clamp.
test("the outline width is clamped to the band the grip can reach", () => {
  const width = (value) => {
    const h = boot("Body\n", { "mdm.outlineWidth": value });
    return JSON.parse(/window\.MDM_SETTINGS = (\{.*?\});/.exec(h.html)[1]).outlineWidth;
  };
  assert.equal(width(320), 320);
  assert.equal(width(320.6), 321, "a fractional width is rounded");
  assert.equal(width(10), 140, "under the floor");
  assert.equal(width(9000), 1200, "over the ceiling");
  assert.equal(width(undefined), 250, "unset");
  assert.equal(width("320"), 250, "a string is not a width");
  assert.equal(width(NaN), 250);
  assert.equal(width(Infinity), 250);
});

test("setSetting stores a width, clamped, and refuses what is not a number", async () => {
  const h = boot("Body\n", {});
  await h.receive({ type: "setSetting", key: "outlineWidth", value: 3000 });
  await h.receive({ type: "setSetting", key: "outlineWidth", value: 317.4 });
  await h.receive({ type: "setSetting", key: "outlineWidth", value: "320" });
  await h.receive({ type: "setSetting", key: "outlineWidth", value: null });
  assert.deepEqual(
    vscode._state.updates.map((u) => [u.key, u.value]),
    [
      ["mdm.outlineWidth", 1200],
      ["mdm.outlineWidth", 317],
    ]
  );
});

test("setSetting writes the outline and the Ctrl+D toggle, and no other word", async () => {
  const h = boot("Body\n", {});
  await h.receive({ type: "setSetting", key: "outline", value: "shown" });
  await h.receive({ type: "setSetting", key: "multicursorMatch", value: "substring" });
  await h.receive({ type: "setSetting", key: "outline", value: "peek" });
  await h.receive({ type: "setSetting", key: "multicursorMatch", value: "regex" });
  assert.deepEqual(
    vscode._state.updates.map((u) => [u.key, u.value]),
    [
      ["mdm.outline", "shown"],
      ["mdm.multicursorMatch", "substring"],
    ]
  );
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

test("both image bases are handed over, and the disk root is a resource root", () => {
  const h = boot("Body\n", {}, undefined, "file:///home/me/papers/note.mdm");
  // The folder for a relative path, the root of the filesystem for an
  // absolute one: a figure written by another project is not under the
  // folder of the document, and used to come out as that folder with the
  // absolute path glued behind it.
  const doc = /window\.MDM_DOC_BASE = "([^"]*)"/.exec(h.html)[1];
  const root = /window\.MDM_FILE_BASE = "([^"]*)"/.exec(h.html)[1];
  assert.equal(doc, "/home/me/papers");
  assert.equal(root, "file:///");
  // And the webview is allowed to load from that root, or the URI would be
  // right and the picture still refused.
  const roots = h.options.localResourceRoots.map((u) => u.toString());
  assert.ok(roots.some((r) => /\/media$/.test(r)), "the media folder");
  assert.ok(roots.includes("/home/me/papers"), "the folder of the document");
  assert.ok(roots.includes("file:///"), "the root of the filesystem");
});

test("a document that is not a file on disk gets no filesystem root", () => {
  const h = boot("Body\n", {}, undefined, "untitled:Untitled-1");
  assert.match(h.html, /window\.MDM_FILE_BASE = ""/);
  const roots = h.options.localResourceRoots.map((u) => u.toString());
  assert.ok(!roots.includes("file:///"));
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

test("the update says how many lines of the file the editor is not being sent", async () => {
  // The editor draws the file's line numbers in its margin, and only the host
  // holds both texts: with the header hidden, DOC's editor text starts at the
  // file's fifth line (three of header, one blank), so the count is four.
  const hidden = boot(DOC, {});
  await hidden.receive({ type: "ready" });
  assert.equal(hidden.posted[0].hiddenLines, 4);
  assert.ok(hidden.posted[0].text.startsWith("Intro\n"));
  // Shown, the editor holds the file and there is nothing to count.
  const shown = boot(DOC, { "mdm.frontMatter": "shown" });
  await shown.receive({ type: "ready" });
  assert.equal(shown.posted[0].hiddenLines, 0);
  // A file with no header: the two modes agree and both count nothing.
  const bare = boot("Intro\n", {});
  await bare.receive({ type: "ready" });
  assert.equal(bare.posted[0].hiddenLines, 0);
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

// ---------- CRLF (the caret jump on Windows) ----------

// A .mdm written on Windows has CRLF endings, and the editor is CodeMirror,
// which holds no CR. Handed the file as it was, it sent LF back, and the
// host's own view of the document (getText is the lines joined with the
// document's EOL) came back CRLF: the edit never matched what was sent, so
// every keystroke was echoed and the editor rewrote itself from the first CR
// on. The caret landed at the end of line 1 and the document gained a blank
// line per echo, which is what the user saw as "the cursor goes mad and types
// Enter by itself".
const CRLF_DOC = DOC.replace(/\n/g, "\r\n");

test("a CRLF document reaches the editor in LF, header and all", async () => {
  const h = boot(CRLF_DOC, {});
  await h.receive({ type: "ready" });
  assert.ok(!h.posted[0].text.includes("\r"));
  assert.ok(!h.posted[0].frontMatter.includes("\r"));
  const shown = boot(CRLF_DOC, { "mdm.frontMatter": "shown" });
  await shown.receive({ type: "ready" });
  assert.ok(!shown.posted[0].text.includes("\r"));
});

test("an edit on a CRLF document is written back with its CRLFs", async () => {
  const h = boot(CRLF_DOC, {});
  await h.receive({ type: "ready" });
  const editorText = h.posted[0].text.replace("Intro", "Edited");
  await h.receive({ type: "edit", text: editorText, withFrontMatter: false });
  assert.equal(h.document.getText(), CRLF_DOC.replace("Intro", "Edited"));
  // Read raw, out of the mock's store rather than through the document:
  // getText() is the mirror, which glues the document's EOL back on and so
  // says nothing about what the host actually wrote.
  const written = vscode._state.documents.get(h.document.uri.toString());
  assert.equal(written, CRLF_DOC.replace("Intro", "Edited"));
  assert.ok(!/[^\r]\n/.test(written), "an LF was written into a CRLF file");
});

test("a converged edit on a CRLF document gets no echo", async () => {
  const h = boot(CRLF_DOC, {});
  await h.receive({ type: "ready" });
  const before = h.posted.length;
  const editorText = h.posted[0].text.replace("Intro", "Edited");
  await h.receive({ type: "edit", text: editorText, withFrontMatter: false });
  assert.equal(h.posted.length, before);
});

test("an identical edit does not touch a CRLF document either", async () => {
  const h = boot(CRLF_DOC, {});
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

test("a CRLF document typed into over and over neither grows nor echoes", async () => {
  const h = boot(CRLF_DOC, {});
  await h.receive({ type: "ready" });
  let text = h.posted[0].text;
  const before = h.posted.length;
  for (let i = 0; i < 5; i++) {
    text = text + "x\n";
    await h.receive({ type: "edit", text: text, withFrontMatter: false });
  }
  assert.equal(h.posted.length, before, "the host echoed");
  assert.equal(h.document.getText(), CRLF_DOC + "x\r\n".repeat(5));
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
  assert.ok(vscode._state.errorMessages[0].message.includes("mdm.theme"));
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

// A fake Quarto on the PATH. The extension looks the real one up there
// (onPath), so a directory holding this one, and a PATH holding only that
// directory, is the whole of the substitution and leaves nothing of the real
// machine in the way. Shell builtins only, for the same reason: under that
// PATH there is no cat and no cp. It writes down its arguments and its
// working directory, and keeps a copy of the file it was handed, which is the
// one whose header the extension has just rewritten and deletes afterwards.
function fakeBin(tmp, opts) {
  const options = opts || {};
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const quarto = path.join(bin, "quarto");
  fs.writeFileSync(
    quarto,
    "#!/bin/sh\n" +
      'echo "$@" > "' + tmp + '/args.txt"\n' +
      'pwd >> "' + tmp + '/args.txt"\n' +
      ': > "' + tmp + '/copy.qmd"\n' +
      'while IFS= read -r line; do echo "$line" >> "' + tmp + '/copy.qmd"; done < "$2"\n' +
      (options.say ? 'echo "' + options.say + '" >&2\n' : "") +
      "exit " + (options.code || 0) + "\n"
  );
  fs.chmodSync(quarto, 0o755);
  if (options.abcm2ps) {
    const engraver = path.join(bin, "abcm2ps");
    fs.writeFileSync(engraver, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(engraver, 0o755);
  }
  if (options.chrome) {
    const chrome = path.join(bin, "google-chrome");
    fs.writeFileSync(chrome, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(chrome, 0o755);
  }
  return bin;
}

// The PATH the export searches, put back when the test is done with it.
function usePath(dir) {
  const before = process.env.PATH;
  process.env.PATH = dir;
  return function () {
    process.env.PATH = before;
  };
}

// The MDM channel as the extension left it.
function exportLog() {
  const channel = vscode._state.outputChannels.find((c) => c.name === "MDM");
  return channel ? channel : { lines: [], shown: 0 };
}

// The buttons of an error notification are answered on a microtask; let it run.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

const SOURCE = "---\ntitle: T\nfilters:\n  - mdm\n---\n\nBody\n";

test("export saves a dirty document and runs Quarto on a copy of it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;
  vscode._state.dirtyDocuments.add("file://" + doc);

  await h.receive({ type: "export", to: "html" });
  restore();

  assert.deepEqual(vscode._state.savedUris, ["file://" + doc], "the document was not saved first");
  const log = fs.readFileSync(path.join(tmp, "args.txt"), "utf8").trim().split("\n");
  const args = log[0].split(" ");
  assert.equal(args[0], "render");
  assert.equal(args[1], path.join(tmp, "doc.qmd"), "Quarto renders the copy, not the .mdm itself");
  assert.ok(log[0].includes("-M format-links:false"), "the format links were left on");
  assert.ok(log[0].includes("--to html"));
  assert.equal(log[1], tmp, "the render did not run in the document's folder");
  assert.ok(!fs.existsSync(path.join(tmp, "doc.qmd")), "the copy was left behind");
  assert.equal(vscode._state.progressTitles.length, 1);
  assert.match(vscode._state.progressTitles[0], /doc\.mdm/);
  assert.equal(vscode._state.infoMessages.length, 1);
  assert.match(vscode._state.infoMessages[0].message, /doc\.html/);
  assert.deepEqual(vscode._state.infoMessages[0].buttons, ["Open HTML"]);
  assert.deepEqual(vscode._state.errorMessages, []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("the export is named after the document, whatever its extension", async () => {
  // A document opened through "Open With" need not be a .mdm, and the name of
  // the copy and of everything the render leaves behind used to keep the
  // extension it did have: notes.md came out as notes.md.qmd, notes.md.html.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "notes.md");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "html" });
  restore();

  const log = fs.readFileSync(path.join(tmp, "args.txt"), "utf8").trim().split("\n");
  assert.equal(
    log[0].split(" ")[1],
    path.join(tmp, "notes.qmd"),
    "the copy kept the document's own extension in its name"
  );
  assert.equal(vscode._state.infoMessages.length, 1);
  assert.match(
    vscode._state.infoMessages[0].message,
    /notes\.html/,
    "the file the export offers to open is not notes.html"
  );
  assert.ok(!/notes\.md\.html/.test(vscode._state.infoMessages[0].message));
  assert.deepEqual(vscode._state.errorMessages, []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("the copy names the filter by absolute path, and the .mdm is left alone", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "html" });
  restore();

  const copy = fs.readFileSync(path.join(tmp, "copy.qmd"), "utf8");
  assert.ok(
    copy.includes("- '" + ext.FILTER + "'"),
    "the copy does not point at the filter this extension ships"
  );
  assert.ok(
    !/^\s*-\s*mdm\s*$/m.test(copy),
    "the bare mdm entry is still there, so Quarto would go looking for an _extensions folder"
  );
  assert.ok(copy.includes("title: T"), "the rest of the header did not survive");
  assert.ok(
    copy.includes("from: " + ext.READER),
    "the copy is read in Pandoc's own dialect, not the editor's"
  );
  assert.equal(fs.readFileSync(doc, "utf8"), SOURCE, "the document itself was rewritten");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("exporting both formats asks for both and offers both files", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp, { abcm2ps: true }));
  const doc = path.join(tmp, "doc.mdm");
  // A header that declares no format at all, which is what the button used to
  // come back from with the HTML alone: Quarto renders the formats the header
  // names, and a header that names none is HTML.
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "both" });
  restore();

  assert.deepEqual(vscode._state.savedUris, []); // a clean document skips the save
  const args = fs.readFileSync(path.join(tmp, "args.txt"), "utf8").trim().split("\n")[0];
  assert.ok(args.includes("--to html,pdf"), "both formats were left to the document");
  assert.deepEqual(vscode._state.infoMessages[0].buttons, ["Open HTML", "Open PDF"]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("the copy is read in the dialect of the editor, and a document that names one keeps it", () => {
  const from = "markdown-x";

  // No header: one is written, with the dialect and nothing else in it.
  const none = ext.withReader("plain body\n", from);
  assert.equal(none, "---\nfrom: markdown-x\n---\n\nplain body\n");

  // A header: the dialect joins it and the rest of it is left alone.
  const some = ext.withReader("---\ntitle: T\n---\n\nb\n", from);
  assert.equal(some, "---\nfrom: markdown-x\ntitle: T\n---\n\nb\n");

  // A document that names a dialect itself is obeyed, at the top level and
  // under a format, and is not given a second `from`.
  const own = "---\nfrom: gfm\n---\nb\n";
  assert.equal(ext.withReader(own, from), own);
  const nested = "---\nformat:\n  html:\n    from: gfm\n---\nb\n";
  assert.equal(ext.withReader(nested, from), nested);

  // Only the header is read: a body line that opens with `from:` is prose.
  const prose = "---\ntitle: T\n---\n\nfrom: the top\n";
  assert.ok(ext.withReader(prose, from).startsWith("---\nfrom: markdown-x\ntitle: T\n"));

  // What the export actually asks for: Pandoc's Markdown without the two
  // rules that make it disagree with the CommonMark the editor reads.
  assert.match(ext.READER, /^markdown-blank_before_header-blank_before_blockquote$/);
});

test("a rule with a line straight under it gets the blank line the copy needs", () => {
  // The bug this settles: the editor draws a rule, Pandoc reads the fence of a
  // YAML metadata block that runs to the next `---` and takes the score with
  // it, and Quarto dies in its own reader with "Error parsing YAML metadata".
  assert.equal(
    ext.withBreaks("Intro\n\n---\n```abc\nX:1\n```\n"),
    "Intro\n\n---\n\n```abc\nX:1\n```\n"
  );
  // A rule that already has its blank line, and one at the end of the file,
  // are left exactly as they are.
  const clean = "a\n\n---\n\nb\n";
  assert.equal(ext.withBreaks(clean), clean);
  assert.equal(ext.withBreaks("a\n\n---\n"), "a\n\n---\n");

  // Two rules running into each other: the second one is served as well.
  assert.equal(ext.withBreaks("a\n\n---\n---\nb\n"), "a\n\n---\n\n---\n\nb\n");

  // Inside a fence the dashes are code, and a blank line in an ABC block would
  // end the tune. Backticks and tildes both, and the fence that closes is the
  // one of the same character.
  const fenced = "```md\nA\n---\nB\n```\n";
  assert.equal(ext.withBreaks(fenced), fenced);
  const tilde = "~~~md\n```\n---\nB\n~~~\n";
  assert.equal(ext.withBreaks(tilde), tilde);

  // Only an unbroken run of dashes: a spaced rule is how Pandoc rules the
  // columns of a simple table, and `***` is a rule to Pandoc whatever follows.
  const spaced = "a\n\n- - -\nb\n";
  assert.equal(ext.withBreaks(spaced), spaced);
  const stars = "a\n\n***\nb\n";
  assert.equal(ext.withBreaks(stars), stars);
  // Four spaces in is an indented code block, not a rule.
  const code = "a\n\n    ---\n    b\n";
  assert.equal(ext.withBreaks(code), code);

  // The header is not the body: its own fences are left where they are, and
  // the first line under it counts as the start of the document.
  assert.equal(
    ext.withBreaks("---\ntitle: T\n---\n---\nb\n"),
    "---\ntitle: T\n---\n---\n\nb\n"
  );

  // A CRLF document comes back CRLF, blank line included.
  assert.equal(
    ext.withBreaks("a\r\n\r\n---\r\nb\r\n"),
    "a\r\n\r\n---\r\n\r\nb\r\n"
  );
});

test("the blank line a rule needs goes into the copy and not into the document", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  const source = "---\ntitle: T\nfilters:\n  - mdm\n---\n\nIntro\n\n---\n```abc\nX:1\nK:C\nCDEF|\n```\n";
  fs.writeFileSync(doc, source);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "html" });
  restore();

  const copy = fs.readFileSync(path.join(tmp, "copy.qmd"), "utf8");
  assert.ok(
    copy.includes("Intro\n\n---\n\n```abc\n"),
    "Quarto was handed the rule with the score still glued under it"
  );
  assert.equal(fs.readFileSync(doc, "utf8"), source, "the document itself was rewritten");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a document that asks for the format links keeps them", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, "---\nformat-links: true\nfilters:\n  - mdm\n---\n\nBody\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "html" });
  restore();

  const args = fs.readFileSync(path.join(tmp, "args.txt"), "utf8").trim().split("\n")[0];
  assert.ok(!args.includes("format-links:false"), "the document's own choice was overruled");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- The export as the light half of the extension ----------
//
// None of these tools is looked for when the extension starts: the editor
// draws and plays scores knowing nothing about Quarto. An export is the only
// thing that asks, and what it has to do when the answer is no is say which
// tool is missing and where the whole story is.

test("without Quarto the export says which tool is missing and logs where to get it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const empty = path.join(tmp, "empty");
  fs.mkdirSync(empty);
  const restore = usePath(empty);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;
  vscode._state.errorChoices["Quarto is not installed"] = "Show log";

  await h.receive({ type: "export", to: "html" });
  await settle();
  restore();

  assert.equal(vscode._state.errorMessages.length, 1);
  assert.match(vscode._state.errorMessages[0].message, /Quarto is not installed/);
  assert.match(vscode._state.errorMessages[0].message, /editor works without it/);
  assert.deepEqual(vscode._state.errorMessages[0].buttons, ["Show log"]);
  const channel = exportLog();
  assert.match(channel.lines.join("\n"), /quarto\.org/, "the log does not say where to get it");
  assert.equal(channel.shown, 1, "the Show log button did not open the channel");
  assert.equal(vscode._state.progressTitles.length, 0, "a render was started with no Quarto");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a PDF of a document with scores says both engravers are missing before rendering", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE + "\n```{.abc}\nX:1\nK:C\nCDEF|\n```\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "pdf" });
  restore();

  assert.equal(vscode._state.errorMessages.length, 1);
  assert.match(
    vscode._state.errorMessages[0].message,
    /neither Chrome nor abcm2ps is installed/);
  assert.match(exportLog().lines.join("\n"), /apt install abcm2ps/);
  assert.equal(vscode._state.progressTitles.length, 0, "the PDF would have come out with no scores");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// A document that points mdm.chrome somewhere is waved through even when
// the pre-flight sees neither engraver: the filter is the one that resolves
// that path (and degrades with a log line if it is wrong), and the
// pre-flight used to refuse the export for a Chrome it could not see.
test("a document that names mdm.chrome is left to the filter", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(
    doc,
    "---\ntitle: T\nmdm:\n  chrome: /opt/somewhere/chrome\nfilters:\n  - mdm\n---\n\n" +
      "```{.abc}\nX:1\nK:C\nCDEF|\n```\n"
  );
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "pdf" });
  restore();

  assert.deepEqual(vscode._state.errorMessages, []);
  assert.equal(vscode._state.progressTitles.length, 1, "the export did not start");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Chrome alone carries the export: it is the engraver the filter prefers,
// and abcm2ps is only the fallback, so neither being on the machine is the
// one state that stops a PDF.
test("a PDF of a document with scores exports with Chrome alone", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp, { chrome: true }));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE + "\n```{.abc}\nX:1\nK:C\nCDEF|\n```\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "pdf" });
  restore();

  assert.deepEqual(vscode._state.errorMessages, []);
  assert.equal(vscode._state.progressTitles.length, 1, "the export did not start");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a document with no scores exports to PDF without abcm2ps", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "pdf" });
  restore();

  assert.deepEqual(vscode._state.errorMessages, []);
  assert.equal(vscode._state.progressTitles.length, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a render that fails keeps its whole log and offers to show it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const noise = "line of quarto output";
  const restore = usePath(fakeBin(tmp, { code: 1, say: noise }));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "html" });
  await settle();
  restore();

  assert.equal(vscode._state.errorMessages.length, 1);
  assert.match(vscode._state.errorMessages[0].message, /export of doc\.mdm failed/);
  assert.deepEqual(vscode._state.errorMessages[0].buttons, ["Show log"]);
  const lines = exportLog().lines.join("\n");
  assert.ok(lines.includes(noise), "Quarto's own output is not in the channel");
  assert.match(lines, /exited with 1/);
  assert.ok(lines.includes(path.join(tmp, "doc.qmd")), "the call itself was not written down");
  assert.ok(!fs.existsSync(path.join(tmp, "doc.qmd")), "a failed render left the copy behind");
  assert.deepEqual(vscode._state.infoMessages, [], "a failed export announced a file");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a .qmd already in the way stops the export instead of overwriting it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  fs.writeFileSync(path.join(tmp, "doc.qmd"), "someone else's file\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "html" });
  restore();

  assert.match(vscode._state.errorMessages[0].message, /doc\.qmd is in the way/);
  assert.equal(
    fs.readFileSync(path.join(tmp, "doc.qmd"), "utf8"),
    "someone else's file\n",
    "the file in the way was overwritten"
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- The header the copy carries ----------

test("the filter entry is put in whatever shape the header has", () => {
  const lua = "/x/mdm.lua";
  const block = ext.withFilter("---\ntitle: T\nfilters:\n  - mdm\n---\n\nb\n", lua);
  assert.ok(block.includes("  - '/x/mdm.lua'"));
  assert.ok(!/-\s*mdm\s*$/m.test(block));
  assert.ok(block.includes("title: T"));

  // A flow list keeps the filters the document names beside ours.
  const flow = ext.withFilter("---\nfilters: [mdm, other]\n---\nb\n", lua);
  assert.ok(flow.includes("filters: ['/x/mdm.lua', other]"));

  // No filters key: one is added, and the rest of the header is untouched.
  const bare = ext.withFilter("---\ntitle: T\n---\nb\n", lua);
  assert.ok(bare.includes("title: T") && bare.includes("filters:\n  - '/x/mdm.lua'"));

  // No header at all: one is written, and the body follows it.
  const none = ext.withFilter("plain body\n", lua);
  assert.ok(none.startsWith("---\nfilters:\n  - '/x/mdm.lua'\n---\n"));
  assert.ok(none.endsWith("plain body\n"));

  // A path with a quote in it cannot break out of the YAML scalar.
  assert.ok(ext.withFilter("plain\n", "/a'b/mdm.lua").includes("'/a''b/mdm.lua'"));
});

test("a score is recognised in both fence forms, and nothing else is", () => {
  assert.equal(ext.hasScores("```{.abc}\nX:1\n```\n"), true);
  assert.equal(ext.hasScores("```abc\nX:1\n```\n"), true);
  assert.equal(ext.hasScores("```{.abc .play}\nX:1\n```\n"), true);
  assert.equal(ext.hasScores("```python\nabc = 1\n```\n"), false);
  assert.equal(ext.hasScores("```{.abcd}\n```\n"), false);
  assert.equal(ext.hasScores("An abc in a paragraph.\n"), false);
});

// ---------- The renderer the extension ships ----------

test("the Quarto filter inside the extension is the one the repository renders with", () => {
  const shipped = path.join(__dirname, "..", "vscode-mdm", "render", "mdm");
  const source = path.join(__dirname, "..", "_extensions", "mdm");
  const walk = (root, base) =>
    fs.readdirSync(root, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(root, e.name), path.join(base, e.name))
        : [path.join(base, e.name)]
    );
  const names = walk(source, "").sort();
  assert.deepEqual(walk(shipped, "").sort(), names, "the two filter copies hold different files");
  assert.ok(names.includes("mdm.lua"), "the filter itself is not there");
  for (const name of names) {
    const a = fs.readFileSync(path.join(shipped, name));
    const b = fs.readFileSync(path.join(source, name));
    assert.ok(a.equals(b), name + " drifted between the extension and _extensions");
  }
  // And it is the file the export actually points at.
  assert.equal(ext.FILTER, path.join(__dirname, "..", "vscode-mdm", "render", "mdm", "mdm.lua"));
});

// ---------- The look the export carries ----------

// One export against a fake Quarto that writes down its arguments, and what
// it was called with. `themeKind` is what VS Code itself is showing
// (vscode.ColorThemeKind), which mdm.theme = "auto" follows.
async function exportWith(to, settings, extensions, themeKind) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", settings, extensions, "file://" + doc);
  vscode._state.workspaceFolder = tmp;
  if (themeKind !== undefined) vscode._state.activeColorThemeKind = themeKind;
  await h.receive({ type: "export", to });
  restore();
  const args = fs.readFileSync(path.join(tmp, "args.txt"), "utf8").trim().split("\n")[0];
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
      "mdm.frontMatter": "shown",
    },
    seedTheme("#e6db74")
  );
  const look = lookOf(args);
  assert.equal(look["mdm-look"], "dark", "the named theme's side did not travel");
  assert.equal(look["mdm-score-fill"], "brass");
  assert.equal(look["mdm-staff-lines"], "ink");
  assert.equal(look["mdm-score-align"], "left");
  // What the editor is showing of the header travels too: the title block
  // Quarto draws from the YAML comes out only when the YAML is on screen.
  assert.equal(look["mdm-front-matter"], "shown");
  const hidden = lookOf(await exportWith("html", {}, seedTheme("#e6db74")));
  assert.equal(hidden["mdm-front-matter"], "hidden", "the default is a hidden header");
  // The palette of that same theme, spelt without the `#` a -M value cannot
  // carry (it would open a YAML comment).
  assert.equal(look["mdm-syn-string"], "e6db74");
  assert.equal(look["mdm-syn-base"], "f8f8f2");
  assert.equal(look["mdm-syn-bg"], "272822");
});

test("the editor's own looks export with their own colours, not VS Code's", async () => {
  // MDM Light, MDM Dark and MDM White carry palettes of their own and the
  // webview refuses VS Code's outright while one of them is chosen
  // (applyPalette and OWN_LOOKS in media/main.js). The export used to send it
  // anyway whenever the sides happened to agree, so an editor showing MDM Dark
  // exported a page dressed in whatever theme VS Code was wearing: another
  // ground, another code card and ten other syntax colours.
  //
  // The side must still travel, or the page comes out light.
  for (const own of ["light", "dark", "white"]) {
    const args = await exportWith(
      "html",
      { "mdm.theme": own, "workbench.colorTheme": "Test Theme" },
      seedTheme("#e6db74"),
      own === "dark" ? 2 : 1
    );
    const look = lookOf(args);
    assert.equal(look["mdm-look"], own, "the side of " + own + " did not travel");
    assert.deepEqual(
      Object.keys(look).filter((k) => k.startsWith("mdm-syn-")),
      [],
      "VS Code's colours were sent for MDM " + own
    );
  }
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

test("a format the webview made up is refused before anything runs", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  // The wire value comes from the webview, which a compromised document could
  // script: an unknown format is dropped before a process is started.
  await h.receive({ type: "export", to: "html; rm -rf /" });
  restore();

  assert.equal(vscode._state.progressTitles.length, 0, "a bogus format started a render");
  assert.deepEqual(vscode._state.errorMessages, []);
  assert.deepEqual(vscode._state.infoMessages, []);
  assert.ok(!fs.existsSync(path.join(tmp, "args.txt")), "a bogus format reached Quarto");
  fs.rmSync(tmp, { recursive: true, force: true });
});
