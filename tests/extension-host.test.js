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
// the mock state. `globalState` is what VS Code keeps for the extension from
// one run to the next (vscode._memento()): a test that hands the same one to
// two boots has closed VS Code and opened it again in between, and one that
// hands none starts on a machine where nothing was ever kept.
function boot(initialText, settings, extensions, uriString, globalState) {
  vscode._reset();
  Object.assign(vscode._state.settings, settings || {});
  if (extensions) vscode._state.extensions = extensions;
  const context = {
    subscriptions: [],
    extensionUri: vscode.Uri.file("/ext"),
    globalState: globalState || vscode._memento(),
  };
  ext.activate(context);
  const provider = vscode._state.registeredProviders[0].provider;
  const h = openPanel(provider, initialText, uriString || "file:///doc.mdm");
  return Object.assign(h, { provider, globalState: context.globalState });
}

// A document opened in an editor of the extension already running, with the
// handles boot returns. A second document beside the first is another call
// on the provider boot hands back.
function openPanel(provider, initialText, uri) {
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

// The settings the host wrote into a panel's page, which is what the editor
// comes up showing.
function settingsOf(h) {
  return JSON.parse(/window\.MDM_SETTINGS = (\{.*?\});/.exec(h.html)[1]);
}

// The word division the host keeps of its own for the document of a panel,
// read the way VS Code hands it back.
function keptDivision(h) {
  const all = h.globalState.get(ext.DOCUMENT_HYPHENATION) || {};
  return all[h.document.uri.toString()];
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
    "mdm.followPlayhead": 0,
    "mdm.textFont": "roman; drop",
    "mdm.textAlign": "justify; drop",
    "mdm.hyphenation": "auto; drop",
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
    followPlayhead: "follow",
    textFont: "roman",
    textAlign: "justify",
    hyphenation: "none",
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
    "mdm.followPlayhead": "still",
    "mdm.textFont": "sans",
    "mdm.textAlign": "left",
    "mdm.hyphenation": "auto",
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
    followPlayhead: "still",
    textFont: "sans",
    textAlign: "left",
    hyphenation: "auto",
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

// ---------- Word division is the document's own ----------

// Every other button of the bar is the editor's, one value in settings.json
// for all the documents at once. Word division is the document's, because a
// reader keeps documents in several languages (the owner, 2026-09-11), so
// mdm.hyphenation is where a document starts and what it was left on is kept
// in globalState under the document's URI. Two boots on one globalState are
// VS Code closed and opened again between them; the same case with the
// editor in Chrome is webview-memory.test.js.
test("the division of one document is not another's, and comes back with it", async () => {
  const memory = vscode._memento();
  const a = boot(DOC, {}, undefined, "file:///a.mdm", memory);
  await a.receive({ type: "setSetting", key: "hyphenation", value: "auto" });
  assert.equal(keptDivision(a), "auto");
  assert.deepEqual(vscode._state.updates, [], "the division went into settings.json");
  // The editor that pressed it is told, since no setting changed for the
  // configuration listener to carry.
  const told = a.posted.filter((m) => m.type === "settings").pop();
  assert.equal(told.settings.hyphenation, "auto");
  a.dispose();

  const b = boot(DOC, {}, undefined, "file:///b.mdm", memory);
  assert.equal(settingsOf(b).hyphenation, "none", "another document took its division");
  b.dispose();

  const again = boot(DOC, {}, undefined, "file:///a.mdm", memory);
  assert.equal(settingsOf(again).hyphenation, "auto", "the document came back whole");
});

test("a division pressed in one document leaves the document beside it alone", async () => {
  const a = boot(DOC, {}, undefined, "file:///a.mdm");
  const b = openPanel(a.provider, DOC, "file:///b.mdm");
  await a.receive({ type: "ready" });
  await b.receive({ type: "ready" });
  a.posted.length = 0;
  b.posted.length = 0;
  await a.receive({ type: "setSetting", key: "hyphenation", value: "auto" });
  assert.deepEqual(b.posted, [], "the document beside was told of a press it did not have");
  assert.equal(a.posted.filter((m) => m.type === "settings").pop().settings.hyphenation, "auto");
  // A look, on the other hand, is the editor's: it goes to settings.json and
  // reaches both editors, each with its own division over it.
  await a.receive({ type: "setSetting", key: "staffLines", value: "ink" });
  assert.deepEqual(
    vscode._state.updates.map((u) => [u.key, u.value]),
    [["mdm.staffLines", "ink"]]
  );
  a.posted.length = 0;
  b.posted.length = 0;
  vscode._state.configurationListeners.forEach((l) =>
    l({ affectsConfiguration: (s) => s === "mdm" })
  );
  const toldA = a.posted.find((m) => m.type === "settings").settings;
  const toldB = b.posted.find((m) => m.type === "settings").settings;
  assert.deepEqual([toldA.staffLines, toldB.staffLines], ["ink", "ink"]);
  assert.deepEqual([toldA.hyphenation, toldB.hyphenation], ["auto", "none"]);
  a.dispose();
  b.dispose();
});

test("mdm.hyphenation is where a document starts, and what it was left on outranks it", async () => {
  const memory = vscode._memento();
  const on = { "mdm.hyphenation": "auto" };
  const a = boot(DOC, on, undefined, "file:///a.mdm", memory);
  assert.equal(settingsOf(a).hyphenation, "auto", "the setting was not where the document started");
  await a.receive({ type: "setSetting", key: "hyphenation", value: "none" });
  a.posted.length = 0;
  vscode._state.configurationListeners.forEach((l) =>
    l({ affectsConfiguration: (s) => s === "mdm" })
  );
  assert.equal(
    a.posted.find((m) => m.type === "settings").settings.hyphenation,
    "none",
    "the setting outranked what the document was left on"
  );
  a.dispose();
  const again = boot(DOC, on, undefined, "file:///a.mdm", memory);
  assert.equal(settingsOf(again).hyphenation, "none");
});

test("a division kept for a document meets the allowlist on its way into the HTML", async () => {
  // Kept by an older version, or by a hand in the storage: whatever it holds,
  // the page is only ever given a value on the list, and one that is not
  // falls back to the setting under it.
  const memory = vscode._memento();
  for (const junk of ["auto; drop", 42, null, { auto: true }]) {
    await memory.update(ext.DOCUMENT_HYPHENATION, { "file:///doc.mdm": junk });
    const h = boot("Body\n", { "mdm.hyphenation": "auto" }, undefined, undefined, memory);
    assert.equal(settingsOf(h).hyphenation, "auto", JSON.stringify(junk) + " reached the page");
    assert.ok(!h.html.includes("drop"));
  }
  // And a memory that is not an object of URIs reads as nothing kept, with
  // the next press starting it again.
  for (const junk of ["junk", 7, ["file:///doc.mdm"], null]) {
    await memory.update(ext.DOCUMENT_HYPHENATION, junk);
    const h = boot("Body\n", {}, undefined, undefined, memory);
    assert.equal(settingsOf(h).hyphenation, "none", JSON.stringify(junk) + " was read as a division");
    await h.receive({ type: "setSetting", key: "hyphenation", value: "auto" });
    assert.equal(keptDivision(h), "auto");
  }
});

test("the documents whose division was used longest ago are the ones forgotten", async () => {
  const memory = vscode._memento();
  const old = {};
  for (let i = 0; i < ext.DOCUMENTS_KEPT; i++) old["file:///old/" + i + ".mdm"] = "auto";
  await memory.update(ext.DOCUMENT_HYPHENATION, old);
  // Opening one that keeps a division counts as using it, and opening one
  // that keeps none adds nothing.
  boot("Body\n", {}, undefined, "file:///old/0.mdm", memory).dispose();
  boot("Body\n", {}, undefined, "file:///never-pressed.mdm", memory).dispose();
  await settle();
  const fresh = boot("Body\n", {}, undefined, "file:///new.mdm", memory);
  await fresh.receive({ type: "setSetting", key: "hyphenation", value: "auto" });
  const uris = Object.keys(memory.get(ext.DOCUMENT_HYPHENATION));
  assert.equal(uris.length, ext.DOCUMENTS_KEPT);
  assert.ok(uris.includes("file:///old/0.mdm"), "a document just opened was forgotten");
  assert.ok(!uris.includes("file:///old/1.mdm"), "the one used longest ago was kept");
  assert.ok(!uris.includes("file:///never-pressed.mdm"), "a document with nothing to keep was kept");
  assert.equal(uris[uris.length - 1], "file:///new.mdm");
  // And the one forgotten opens on the setting again.
  const gone = boot("Body\n", {}, undefined, "file:///old/1.mdm", memory);
  assert.equal(settingsOf(gone).hyphenation, "none");
});
// ---------- Syntax palette ----------

// A theme contributed the way the built-in ones are, with its file on the
// real disk so that the extension reads it as it would in VS Code. The
// folders go when the file's tests are done: left behind, each run of the
// suite added about fifteen mdm-theme-* folders to the system's temp
// directory, and 562 had piled up there by 2026-09-11.
const THEME_DIRS = [];
test.after(() => {
  for (const dir of THEME_DIRS) fs.rmSync(dir, { recursive: true, force: true });
});
function seedTheme(stringColor) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-theme-"));
  THEME_DIRS.push(dir);
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

// A fake Quarto on the PATH. The extension looks the real one up there first
// (findQuarto), so a directory holding this one, and a PATH holding only that
// directory, is the whole of the substitution and leaves nothing of the real
// machine in the way; the folders Quarto's installers write are looked in
// only after it, and a test about them says which machine it runs on
// (useMachine). Shell builtins only, for the same reason: under that PATH
// there is no cat and no cp. It writes down its arguments and its working
// directory, and keeps a copy of the file it was handed, which is the one
// whose header the extension has just rewritten and deletes afterwards. The
// other tools a PDF with scores looks for are empty stand-ins, by the names
// the export searches the PATH for.
const STAND_INS = {
  abcm2ps: "abcm2ps",
  chrome: "google-chrome",
  pdfcrop: "pdfcrop",
  gs: "gs",
  epstopdf: "epstopdf",
};

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
  Object.keys(STAND_INS).forEach((key) => {
    if (!options[key]) return;
    const tool = path.join(bin, STAND_INS[key]);
    fs.writeFileSync(tool, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(tool, 0o755);
  });
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

// Chrome refuses --no-sandbox only when the extension host runs as root.
// Both sides of that platform branch are exercised without depending on the
// account that launched the tests, and the real process function is restored
// before the next test sees it.
function useUid(uid) {
  const before = Object.getOwnPropertyDescriptor(process, "getuid");
  Object.defineProperty(process, "getuid", {
    configurable: true,
    writable: true,
    value: function () {
      return uid;
    },
  });
  return function () {
    if (before) Object.defineProperty(process, "getuid", before);
    else delete process.getuid;
  };
}

// The machine the export believes it runs on: process.platform, and the
// variables the folders it looks in are built from, put back when the test is
// done with them. It matters for Quarto, which is looked for where its
// installer writes when the PATH has none, and those folders are fixed on
// Linux: the machine these tests were written on has a Quarto at
// /opt/quarto/bin, which a test that meant "no Quarto anywhere" would find and
// run. A Mac's second folder is under HOME, which a test can point at a folder
// of its own.
function useMachine(platform, env) {
  const platformBefore = Object.getOwnPropertyDescriptor(process, "platform");
  const envBefore = {};
  Object.defineProperty(
    process,
    "platform",
    Object.assign({}, platformBefore, { value: platform })
  );
  Object.keys(env || {}).forEach((key) => {
    envBefore[key] = process.env[key];
    process.env[key] = env[key];
  });
  return function () {
    Object.defineProperty(process, "platform", platformBefore);
    Object.keys(envBefore).forEach((key) => {
      if (envBefore[key] === undefined) delete process.env[key];
      else process.env[key] = envBefore[key];
    });
  };
}

// A real Mac with Quarto installed has it in the one folder a test cannot
// point elsewhere, and a test that needs no Quarto there is skipped on it.
const MAC_QUARTO = "/Applications/quarto/bin/quarto";

// The MDM channel as the extension left it.
function exportLog() {
  const channel = vscode._state.outputChannels.find((c) => c.name === "MDM");
  return channel ? channel : { lines: [], shown: 0 };
}

// The buttons of a notification are answered on a microtask; let it run.
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
  assert.deepEqual(vscode._state.warningMessages, []);
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
  assert.deepEqual(vscode._state.warningMessages, []);
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
// tool is missing, where to get it, and where the whole story is. The reader
// is a musician: a notice of a missing tool is a warning with a button to the
// page that fixes it, and its log opens on the steps. Settled on 2026-09-12,
// after a Mac reported the old notice, which named Quarto and kept the page to
// get it from in the log, behind a PATH of 33 folders.

test("without Quarto the export names it, offers its page and logs where it looked", async (t) => {
  if (fs.existsSync(MAC_QUARTO)) {
    t.skip("this machine has a Quarto at " + MAC_QUARTO);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const empty = path.join(tmp, "empty");
  fs.mkdirSync(empty);
  const home = path.join(tmp, "home");
  fs.mkdirSync(home);
  const restorePath = usePath(empty);
  const restoreMachine = useMachine("darwin", { HOME: home });
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  vscode._state.warningChoices["needs Quarto"] = "Download Quarto";
  await h.receive({ type: "export", to: "html" });
  await settle();
  vscode._state.warningChoices["needs Quarto"] = "Show log";
  await h.receive({ type: "export", to: "html" });
  await settle();
  restoreMachine();
  restorePath();

  assert.deepEqual(vscode._state.errorMessages, [], "a missing program was reported as a failure");
  assert.equal(vscode._state.warningMessages.length, 2);
  const notice = vscode._state.warningMessages[0];
  assert.match(notice.message, /^MDM: exporting needs Quarto, a free program/);
  assert.match(notice.message, /Install it and export again\./);
  assert.match(notice.message, /The editor works without it\.$/);
  assert.deepEqual(notice.buttons, ["Download Quarto", "Show log"]);
  assert.deepEqual(
    vscode._state.openedExternal,
    ["https://quarto.org/docs/get-started/"],
    "Download Quarto did not open the page Quarto is installed from"
  );
  const channel = exportLog();
  assert.equal(channel.shown, 1, "the Show log button did not open the channel");
  const log = channel.lines.join("\n");
  assert.match(log, /^Exporting needs Quarto/, "the log does not open on what to do");
  assert.match(log, /1\. Download Quarto from https:\/\/quarto\.org\/docs\/get-started\/ and install it\./);
  assert.match(log, /quit Visual Studio Code completely and open it again/);
  assert.ok(log.includes("  " + MAC_QUARTO + "\n"), "the installer's folder was not named");
  assert.ok(
    log.includes("  " + path.join(home, "Applications", "quarto", "bin", "quarto") + "\n"),
    "the installer's folder under HOME was not named"
  );
  assert.ok(
    log.indexOf("Download Quarto from") < log.indexOf("PATH: " + empty),
    "the PATH comes before the way out"
  );
  assert.equal(vscode._state.progressTitles.length, 0, "a render was started with no Quarto");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// The PATH the editor runs with is the one it started with (VS Code reads the
// shell's environment once), so a Quarto installed while it was open is on
// disk and not on it, and the macOS installer's link into /usr/local/bin fails
// where that folder does not exist. The notice asks the reader to install
// Quarto and export again; this is what makes the second half true.
test("a Quarto installed while the editor was open is found where its installer put it", async (t) => {
  if (fs.existsSync(MAC_QUARTO)) {
    t.skip("this machine has a Quarto at " + MAC_QUARTO + ", which is looked in first");
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const empty = path.join(tmp, "empty");
  fs.mkdirSync(empty);
  const installed = path.join(tmp, "Applications", "quarto", "bin");
  fs.mkdirSync(installed, { recursive: true });
  fs.renameSync(path.join(fakeBin(tmp), "quarto"), path.join(installed, "quarto"));
  const restorePath = usePath(empty);
  const restoreMachine = useMachine("darwin", { HOME: tmp });
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "html" });
  restoreMachine();
  restorePath();

  assert.deepEqual(vscode._state.warningMessages, [], "the export said Quarto is not installed");
  assert.equal(vscode._state.progressTitles.length, 1, "the export did not start");
  assert.ok(
    fs.existsSync(path.join(tmp, "args.txt")),
    "the Quarto in the installer's folder was not the one that ran"
  );
  assert.ok(
    exportLog().lines.join("\n").includes(path.join(installed, "quarto") + " render"),
    "the log does not say which Quarto ran"
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

// The folders of the systems a test cannot run on. The list is the one
// Quarto's own VS Code extension scans (context.ts in quarto-dev/quarto)
// less the RStudio bundles, and the macOS and Windows paths are the install
// locations of Quarto's .pkg (installer.ts) and .msi (quarto.wxs).
test("Quarto is looked for in the folders its installers write, on each system", () => {
  assert.deepEqual(ext.quartoInstalls("darwin", { HOME: "/Users/u" }), [
    "/Applications/quarto/bin/quarto",
    "/Users/u/Applications/quarto/bin/quarto",
  ]);
  assert.deepEqual(
    ext.quartoInstalls("win32", {
      ProgramFiles: "D:\\Programs",
      LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
    }),
    [
      "D:\\Programs\\Quarto\\bin\\quarto.exe",
      "C:\\Users\\u\\AppData\\Local\\Programs\\Quarto\\bin\\quarto.exe",
    ]
  );
  // Without the variables: the folder Windows puts programs in by default,
  // and no folder of the user's.
  assert.deepEqual(ext.quartoInstalls("win32", {}), [
    "C:\\Program Files\\Quarto\\bin\\quarto.exe",
  ]);
  assert.deepEqual(ext.quartoInstalls("linux", { HOME: "/home/u" }), [
    "/opt/quarto/bin/quarto",
  ]);
  // A system Quarto ships no installer for has nowhere to look but the PATH.
  assert.deepEqual(ext.quartoInstalls("freebsd", { HOME: "/home/u" }), []);
});

// What the filter needs to draw the scores of a PDF, and what the notice asks
// for when the machine lacks it. The filter's first road is Chrome, trimmed
// by pdfcrop, and its second abcm2ps through epstopdf; both run Ghostscript.
// The check used to ask for Chrome or abcm2ps and nothing else, and let a
// machine with Chrome and no pdfcrop through to a PDF with its scores left as
// text. The notice always asks for Chrome's road, the one that draws the
// scores the editor draws.
test("a PDF with scores names what it lacks when no Chrome can print it", async () => {
  const cases = [
    {
      what: "nothing but Quarto",
      tools: {},
      message: /^MDM: a PDF with scores needs Google Chrome and a complete TeX to draw them, and this computer does not have them\. Install both, then quit Visual Studio Code, open it again and export\.$/,
      buttons: ["Download Chrome", "Download TeX", "Show log"],
      missing: "Not found on this computer: Google Chrome, pdfcrop, Ghostscript (gs).",
    },
    {
      what: "TeX, and no Chrome",
      tools: { pdfcrop: true, gs: true },
      message: /^MDM: a PDF with scores needs Google Chrome to draw them, and it is not installed on this computer\. Install it and export again\.$/,
      buttons: ["Download Chrome", "Show log"],
      missing: "Not found on this computer: Google Chrome.",
      press: "Download Chrome",
      opens: ["https://www.google.com/chrome/"],
    },
  ];
  for (const c of cases) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
    const restore = usePath(fakeBin(tmp, c.tools));
    const doc = path.join(tmp, "doc.mdm");
    fs.writeFileSync(doc, SOURCE + "\n```{.abc}\nX:1\nK:C\nCDEF|\n```\n");
    const h = boot("Body\n", {}, null, "file://" + doc);
    vscode._state.workspaceFolder = tmp;
    if (c.press) vscode._state.warningChoices["with scores"] = c.press;

    await h.receive({ type: "export", to: "pdf" });
    await settle();
    restore();

    assert.deepEqual(vscode._state.errorMessages, [], c.what + ": reported as a failure");
    assert.equal(vscode._state.warningMessages.length, 1, c.what + ": no notice");
    assert.match(vscode._state.warningMessages[0].message, c.message, c.what);
    assert.deepEqual(vscode._state.warningMessages[0].buttons, c.buttons, c.what);
    const log = exportLog().lines.join("\n");
    assert.ok(log.includes(c.missing), c.what + ": the log does not name what is missing");
    assert.match(log, /sudo apt install abcm2ps/, c.what + ": the other road is not offered");
    if (c.opens) assert.deepEqual(vscode._state.openedExternal, c.opens, c.what);
    assert.equal(
      vscode._state.progressTitles.length,
      0,
      c.what + ": the PDF was rendered with scores it cannot draw"
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
  assert.deepEqual(vscode._state.warningMessages, []);
  assert.equal(vscode._state.progressTitles.length, 1, "the export did not start");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Either road of the filter carries the export when it is whole: Chrome with
// pdfcrop and Ghostscript, the one that draws the editor's own scores, or
// abcm2ps with epstopdf and Ghostscript, without a Chrome.
test("a PDF with scores exports when one of the filter's roads is whole", async () => {
  const roads = [
    { what: "Chrome's", tools: { chrome: true, pdfcrop: true, gs: true } },
    { what: "abcm2ps's", tools: { abcm2ps: true, epstopdf: true, gs: true } },
  ];
  for (const road of roads) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
    const restore = usePath(fakeBin(tmp, road.tools));
    const doc = path.join(tmp, "doc.mdm");
    fs.writeFileSync(doc, SOURCE + "\n```{.abc}\nX:1\nK:C\nCDEF|\n```\n");
    const h = boot("Body\n", {}, null, "file://" + doc);
    vscode._state.workspaceFolder = tmp;

    await h.receive({ type: "export", to: "pdf" });
    restore();

    assert.deepEqual(vscode._state.errorMessages, [], road.what + " road");
    assert.deepEqual(vscode._state.warningMessages, [], road.what + " road was refused");
    assert.equal(vscode._state.progressTitles.length, 1, road.what + " road: the export did not start");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
  assert.deepEqual(vscode._state.warningMessages, []);
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
  assert.deepEqual(vscode._state.warningMessages, [], "a failed render was taken for a missing tool");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// A PDF Quarto finds no TeX for is a missing tool and not a failure: the
// notice names TeX and sends its reader to the TeX for the system in hand.
// On a Mac that is MacTeX, which brings the pdfcrop and the Ghostscript the
// scores need; TinyTeX, the one Quarto's own words suggest, holds no pdfcrop
// in either of its package lists (rstudio/tinytex, tools/pkgs-custom.txt and
// tools/pkgs-yihui.txt). The words are Quarto's (latex.ts in
// quarto-dev/quarto-cli), the same in 1.9.37 and on main.
test("a PDF Quarto finds no TeX for names TeX and offers the page for the system in hand", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const quartoSays =
    "No TeX installation was detected. Please run 'quarto install tinytex' to install TinyTex.";
  const restorePath = usePath(fakeBin(tmp, { code: 1, say: quartoSays }));
  const restoreMachine = useMachine("darwin", {});
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;
  vscode._state.warningChoices["needs TeX"] = "Download TeX";

  await h.receive({ type: "export", to: "pdf" });
  await settle();
  restoreMachine();
  restorePath();

  assert.deepEqual(vscode._state.errorMessages, [], "a machine without TeX was told the export failed");
  assert.equal(vscode._state.warningMessages.length, 1);
  assert.match(
    vscode._state.warningMessages[0].message,
    /^MDM: a PDF needs TeX, a free program that lays out the pages, and it is not installed on this computer\. Install it, then quit Visual Studio Code, open it again and export\.$/
  );
  assert.deepEqual(vscode._state.warningMessages[0].buttons, ["Download TeX", "Show log"]);
  assert.deepEqual(vscode._state.openedExternal, ["https://www.tug.org/mactex/"]);
  const log = exportLog().lines.join("\n");
  assert.ok(
    log.indexOf(quartoSays) !== -1 && log.indexOf(quartoSays) < log.indexOf("A PDF needs TeX"),
    "Quarto's own words are not above the way out"
  );
  assert.match(log, /1\. Install MacTeX from https:\/\/www\.tug\.org\/mactex\/ \(it brings pdfcrop and Ghostscript as well\)\./);
  assert.match(log, /2\. Quit Visual Studio Code completely and open it again/);
  assert.ok(!fs.existsSync(path.join(tmp, "doc.qmd")), "the copy was left behind");
  assert.deepEqual(vscode._state.infoMessages, [], "an export with no PDF announced one");
  // The other systems, which a test cannot run on.
  assert.equal(ext.texPage("win32"), "https://www.tug.org/texlive/windows.html");
  assert.equal(ext.texPage("linux"), "https://www.tug.org/texlive/");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- Printed instead of typeset, when there is a Chrome but no TeX ----------
//
// A quarto stand-in whose behaviour depends on --to, matching a real 1.9.37
// measured on 2026-09-12: it fails on a lone --to pdf with Quarto's own
// words and writes nothing; --to html,pdf writes the .html and fails the
// same way; --to html alone writes the .html and succeeds. And a chrome
// stand-in that writes real bytes to whatever --print-to-pdf names, standing
// in for the filter's own Chrome invocation for a score.
function fakeQuartoTexFallback(tmp) {
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const quarto = path.join(bin, "quarto");
  const noTex = "No TeX installation was detected. Please run quarto install tinytex.";
  fs.writeFileSync(
    quarto,
    "#!/bin/sh\n" +
      'echo "$@" >> "' + tmp + '/calls.txt"\n' +
      'file=${2##*/}\n' +
      'base=${file%.qmd}\n' +
      // The .tex goes down the way Quarto's own does: named after the copy's
      // stem and left there when the engine fails. Without it the test that
      // says the reader's .tex survives cannot fail, and it did not: an
      // 11-byte file of the reader's came back 14,160 bytes of preamble from
      // a real Quarto 1.9.37 while the suite stayed green (2026-09-13).
      'case " $* " in\n' +
      '  *" --to pdf "*)\n' +
      "    printf 'quarto wrote this\\n' > \"$base.tex\"\n" +
      '    echo "' + noTex + '" >&2\n' +
      "    exit 1 ;;\n" +
      '  *" --to html,pdf "*)\n' +
      "    printf '<!doctype html><title>printed</title><p>hi</p>' > \"$base.html\"\n" +
      "    printf 'quarto wrote this\\n' > \"$base.tex\"\n" +
      '    echo "' + noTex + '" >&2\n' +
      "    exit 1 ;;\n" +
      '  *" --to html "*)\n' +
      "    printf '<!doctype html><title>printed</title><p>hi</p>' > \"$base.html\"\n" +
      "    exit 0 ;;\n" +
      "esac\n" +
      "exit 0\n"
  );
  fs.chmodSync(quarto, 0o755);
  return bin;
}

function fakeChromePrint(bin, opts) {
  const options = opts || {};
  const chrome = path.join(bin, "google-chrome");
  fs.writeFileSync(
    chrome,
    "#!/bin/sh\n" +
      'echo "$@" >> "' + path.dirname(bin) + '/chrome-calls.txt"\n' +
      "pdf=\"\"\nprofile=\"\"\n" +
      'for a in "$@"; do case "$a" in\n' +
      '  --print-to-pdf=*) pdf="${a#--print-to-pdf=}";;\n' +
      '  --user-data-dir=*) profile="${a#--user-data-dir=}";;\n' +
      "esac; done\n" +
      '[ -n "$profile" ] && [ -d "$profile" ] || exit 22\n' +
      'printf "%s\\n" "$profile" > "' + path.dirname(bin) + '/chrome-profile.txt"\n' +
      (options.hang
        ? // By absolute path: the PATH a test runs under holds the stand-ins
          // and nothing else, so a bare `sleep` is not found and the
          // stand-in exits at once, which is the opposite of the case.
          (["/bin/sleep", "/usr/bin/sleep"].find((p) => fs.existsSync(p)) ||
            "sleep") + " 30\n"
        : options.fail
          ? "exit 1\n"
          : "printf '%s\\n' '%PDF-1.4 fake' > \"$pdf\"\nexit 0\n")
  );
  fs.chmodSync(chrome, 0o755);
}

// A Quarto whose HTML render fails, which is what the print fallback meets
// when the document itself is what Quarto cannot read.
function fakeQuartoHtmlFails(tmp) {
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const quarto = path.join(bin, "quarto");
  fs.writeFileSync(
    quarto,
    "#!/bin/sh\n" +
      'echo "$@" >> "' + tmp + '/calls.txt"\n' +
      'echo "ERROR: could not parse YAML" >&2\n' +
      "exit 1\n"
  );
  fs.chmodSync(quarto, 0o755);
  return bin;
}

function chromeCalls(tmp) {
  try {
    return fs.readFileSync(path.join(tmp, "chrome-calls.txt"), "utf8").trim().split("\n");
  } catch (e) {
    return [];
  }
}

function chromeProfile(tmp) {
  try {
    return fs.readFileSync(path.join(tmp, "chrome-profile.txt"), "utf8").trim();
  } catch (e) {
    return "";
  }
}

test("with Chrome but no TeX, a PDF asked alone is printed from a page rendered just for it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const bin = fakeQuartoTexFallback(tmp);
  fakeChromePrint(bin);
  const restorePath = usePath(bin);
  const restoreUid = useUid(0);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  fs.writeFileSync(path.join(tmp, "doc.html"), "an earlier HTML export\n");
  fs.writeFileSync(path.join(tmp, "doc.tex"), "a file that was already here\n");
  fs.mkdirSync(path.join(tmp, "doc_files"));
  fs.writeFileSync(path.join(tmp, "doc_files", "keep.txt"), "keep\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;
  vscode._state.warningChoices["was printed from the HTML page"] = "Open PDF";

  await h.receive({ type: "export", to: "pdf" });
  await settle();
  restoreUid();
  restorePath();

  assert.deepEqual(vscode._state.errorMessages, []);
  assert.deepEqual(vscode._state.infoMessages, [], "the plain success toast fired instead");
  assert.equal(vscode._state.warningMessages.length, 1);
  assert.equal(
    vscode._state.warningMessages[0].message,
    "MDM: no TeX was found, so doc.pdf was printed from the HTML page instead of typeset with LaTeX. Install TeX for a typeset PDF."
  );
  // "pdf" alone never asked for an HTML, so there is no "Open HTML" to offer.
  assert.deepEqual(vscode._state.warningMessages[0].buttons, [
    "Open PDF", "Download TeX", "Show log", "Don't show again",
  ]);
  assert.ok(fs.existsSync(path.join(tmp, "doc.pdf")), "no PDF was left at the requested path");
  assert.equal(fs.readFileSync(path.join(tmp, "doc.pdf"), "utf8"), "%PDF-1.4 fake\n");
  assert.deepEqual(
    vscode._state.openedExternal,
    ["file://" + path.join(tmp, "doc.pdf")],
    "Open PDF did not open the file that was printed"
  );
  // The page rendered only to be printed has a private name and leaves no
  // debris. Files already beside the document belong to the reader and stay
  // byte for byte as they were.
  assert.equal(fs.readFileSync(path.join(tmp, "doc.html"), "utf8"), "an earlier HTML export\n");
  assert.equal(fs.readFileSync(path.join(tmp, "doc.tex"), "utf8"), "a file that was already here\n");
  assert.equal(fs.readFileSync(path.join(tmp, "doc_files", "keep.txt"), "utf8"), "keep\n");
  assert.deepEqual(
    fs.readdirSync(tmp).filter((name) => name.includes(".mdm-print-")),
    [],
    "the private page or staged PDF was left behind"
  );
  assert.ok(!fs.existsSync(path.join(tmp, "doc.qmd")), "the copy was left behind");
  const calls = fs.readFileSync(path.join(tmp, "calls.txt"), "utf8").trim().split("\n");
  assert.equal(calls.length, 2, "one call for the PDF that failed, one for the page to print");
  assert.match(calls[0], /--to pdf/);
  assert.match(calls[1], /--to html(?! ?,)/, "the fallback did not ask for exactly the HTML");
  // Root is the one case a container runs this as; Chrome refuses to start
  // without being told so.
  assert.match(chromeCalls(tmp)[0], /--no-sandbox/);
  const profile = chromeProfile(tmp);
  assert.ok(profile, "Chrome was not given a private profile");
  assert.ok(!fs.existsSync(profile), "Chrome's temporary profile was left behind");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("with Chrome but incomplete TeX, a PDF with scores is printed from HTML", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const bin = fakeQuartoTexFallback(tmp);
  fakeChromePrint(bin);
  const restorePath = usePath(bin);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE + "\n```abc\nX:1\nK:C\nCDEF|\n```\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;
  vscode._state.warningChoices["was printed from the HTML page"] = "Don't show again";

  await h.receive({ type: "export", to: "pdf" });
  await settle();

  assert.deepEqual(vscode._state.errorMessages, []);
  assert.equal(vscode._state.warningMessages.length, 1);
  assert.match(
    vscode._state.warningMessages[0].message,
    /^MDM: a complete TeX was not found, so doc\.pdf was printed from the HTML page/
  );
  assert.deepEqual(
    vscode._state.warningMessages[0].buttons,
    ["Open PDF", "Download TeX", "Show log", "Don't show again"]
  );
  assert.deepEqual(vscode._state.updates, [
    {
      key: "mdm.showPdfFallbackNotice",
      value: false,
      target: vscode.ConfigurationTarget.Global,
    },
  ]);
  assert.ok(fs.existsSync(path.join(tmp, "doc.pdf")), "the score PDF was not printed");
  const calls = fs.readFileSync(path.join(tmp, "calls.txt"), "utf8").trim().split("\n");
  assert.equal(calls.length, 1, "the LaTeX render ran even though its score tools were missing");
  assert.match(calls[0], /--to html(?! ?,)/);
  assert.match(
    exportLog().lines.join("\n"),
    /lacks pdfcrop and Ghostscript \(gs\)/,
    "the warning log did not name the missing score tools"
  );
  // The setting hides only the notice: the next export still makes its PDF
  // through exactly the same fallback and records the road in the MDM log.
  vscode._state.warningMessages = [];
  fs.unlinkSync(path.join(tmp, "doc.pdf"));
  await h.receive({ type: "export", to: "pdf" });
  await settle();
  assert.deepEqual(vscode._state.warningMessages, [], "the fallback notice came back");
  assert.ok(fs.existsSync(path.join(tmp, "doc.pdf")), "hiding the notice hid the export");
  assert.equal(
    fs.readFileSync(path.join(tmp, "calls.txt"), "utf8").trim().split("\n").length,
    2,
    "the silent export did not run"
  );
  restorePath();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("with Chrome but no TeX, both formats print the PDF from the HTML already made and keep it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const bin = fakeQuartoTexFallback(tmp);
  fakeChromePrint(bin);
  const restorePath = usePath(bin);
  const restoreUid = useUid(1000); // not root: no --no-sandbox
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "both" });
  await settle();
  restoreUid();
  restorePath();

  assert.equal(vscode._state.warningMessages.length, 1);
  assert.deepEqual(
    vscode._state.warningMessages[0].buttons,
    ["Open PDF", "Open HTML", "Download TeX", "Show log", "Don't show again"],
    "both wanted the HTML too, and it is real"
  );
  assert.ok(fs.existsSync(path.join(tmp, "doc.html")), "both asked for the HTML and it was thrown away");
  assert.ok(fs.existsSync(path.join(tmp, "doc.pdf")));
  assert.ok(!fs.existsSync(path.join(tmp, "doc.tex")), "the stray .tex was left behind");
  const calls = fs.readFileSync(path.join(tmp, "calls.txt"), "utf8").trim().split("\n");
  assert.equal(calls.length, 1, "both already made the HTML the PDF was printed from; no second call was needed");
  assert.doesNotMatch(chromeCalls(tmp)[0], /--no-sandbox/, "a non-root call carried the flag anyway");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("with Chrome but no TeX, a print that itself fails falls back to naming TeX", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const bin = fakeQuartoTexFallback(tmp);
  fakeChromePrint(bin, { fail: true });
  const restorePath = usePath(bin);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "pdf" });
  await settle();
  restorePath();

  assert.deepEqual(vscode._state.errorMessages, []);
  assert.equal(vscode._state.warningMessages.length, 1);
  assert.match(vscode._state.warningMessages[0].message, /^MDM: a PDF needs TeX/, "the print's own failure was not folded back into the TeX notice");
  assert.match(exportLog().lines.join("\n"), /Chrome exited with 1\./);
  assert.ok(!fs.existsSync(path.join(tmp, "doc.pdf")), "a PDF was left at the path Chrome failed to write");
  assert.ok(!fs.existsSync(path.join(tmp, "doc.html")), "the page rendered to print from was left behind");
  assert.ok(!fs.existsSync(chromeProfile(tmp)), "a failed Chrome left its profile behind");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a Chrome that never finishes printing is stopped, and the export says so", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const bin = fakeQuartoTexFallback(tmp);
  fakeChromePrint(bin, { hang: true });
  const restorePath = usePath(bin);
  // Without a wall clock the export never came back at all: the progress
  // notification stayed up, no notice was ever shown, and the copy stayed
  // beside the document, where it refuses every later export of it.
  const before = process.env.MDM_PRINT_TIMEOUT;
  process.env.MDM_PRINT_TIMEOUT = "400";
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "pdf" });
  await settle();
  if (before === undefined) delete process.env.MDM_PRINT_TIMEOUT;
  else process.env.MDM_PRINT_TIMEOUT = before;
  restorePath();

  assert.equal(vscode._state.warningMessages.length, 1, "the export did not come back");
  assert.match(vscode._state.warningMessages[0].message, /^MDM: a PDF needs TeX/);
  assert.match(
    exportLog().lines.join("\n"),
    /Chrome did not finish printing within 0\.4 seconds, and was stopped\./
  );
  // And nothing of the run is left to refuse the next one.
  assert.ok(!fs.existsSync(path.join(tmp, "doc.qmd")), "the copy was left behind");
  assert.deepEqual(
    fs.readdirSync(tmp).filter((name) => name.includes(".mdm-print-")),
    [],
    "the private page was left behind"
  );
  assert.ok(!fs.existsSync(chromeProfile(tmp)), "a stopped Chrome left its profile behind");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a document whose .tex the reader wrote comes back untouched from a failed render", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const bin = fakeQuartoTexFallback(tmp);
  fakeChromePrint(bin, { fail: true }); // no PDF either way: the .tex is the point
  const restorePath = usePath(bin);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  fs.writeFileSync(path.join(tmp, "doc.tex"), "the reader's own LaTeX\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "pdf" });
  await settle();
  restorePath();

  // Quarto names its LaTeX after the copy's stem and writes it before
  // anything here can decline to delete it, so the only guard is to move the
  // reader's out of the way for the length of the render.
  assert.equal(
    fs.readFileSync(path.join(tmp, "doc.tex"), "utf8"),
    "the reader's own LaTeX\n",
    "the render wrote over a .tex of the reader's"
  );
  assert.deepEqual(
    fs.readdirSync(tmp).filter((name) => name.includes(".mdm-kept-")),
    [],
    "the file put aside was not put back"
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a folder the export cannot write to names the folder, and not Quarto", {
  // Root writes into a read-only folder all the same, so the case cannot be
  // built there.
  skip: typeof process.getuid === "function" && process.getuid() === 0
    ? "runs as root"
    : false,
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const bin = fakeBin(tmp);
  const restorePath = usePath(bin);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;
  fs.chmodSync(tmp, 0o555);

  await h.receive({ type: "export", to: "html" });
  await settle();
  fs.chmodSync(tmp, 0o755);
  restorePath();

  // It used to end in "Quarto exited with -1", naming a program that was
  // never started and leaving the reader nothing to act on.
  assert.equal(vscode._state.errorMessages.length, 1);
  assert.match(
    vscode._state.errorMessages[0].message,
    /^MDM: the export could not write beside doc\.mdm\./
  );
  const log = exportLog().lines.join("\n");
  assert.match(log, /Writing the copy the export renders, .*doc\.qmd, failed: /);
  assert.doesNotMatch(log, /Quarto exited with/, "it blamed a Quarto that never ran");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a second export of one document while the first runs is turned away, and says so", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const bin = fakeQuartoTexFallback(tmp);
  fakeChromePrint(bin);
  const restorePath = usePath(bin);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  const first = h.receive({ type: "export", to: "html" });
  const second = h.receive({ type: "export", to: "html" });
  await Promise.all([first, second]);
  await settle();
  restorePath();

  // The second run used to find the first run's copy and tell the reader
  // that a file of their own was in the way of the export.
  assert.deepEqual(vscode._state.warningMessages, []);
  assert.equal(vscode._state.infoMessages.length, 2);
  const said = vscode._state.infoMessages.map((m) => m.message).sort();
  assert.match(said[0], /^MDM: doc\.mdm is already being exported\./);
  assert.match(said[1], /^MDM: exported doc\.html$/);
  const calls = fs.readFileSync(path.join(tmp, "calls.txt"), "utf8").trim().split("\n");
  assert.equal(calls.length, 1, "the export ran twice over the same copy");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a page the fallback cannot render is not reported as a missing program", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const bin = fakeQuartoHtmlFails(tmp);
  fakeChromePrint(bin);
  const restorePath = usePath(bin);
  const doc = path.join(tmp, "doc.mdm");
  // Scores, and none of the programs LaTeX draws them with: the export goes
  // straight to printing the page, and here Quarto cannot render that page.
  fs.writeFileSync(doc, SOURCE + "\n```abc\nX:1\nK:C\nCDEF|\n```\n");
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;

  await h.receive({ type: "export", to: "pdf" });
  await settle();
  restorePath();

  // A reader told to install TeX here would install it and get the same
  // failure back: what stopped this was the document, and Quarto said so.
  assert.deepEqual(vscode._state.warningMessages, []);
  assert.equal(vscode._state.errorMessages.length, 1);
  assert.match(vscode._state.errorMessages[0].message, /^MDM: the export of doc\.mdm failed\.$/);
  assert.match(exportLog().lines.join("\n"), /Quarto exited with 1\./);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("when both were asked and only the page landed, the notice offers the page", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const bin = fakeQuartoTexFallback(tmp);
  fakeChromePrint(bin, { fail: true });
  const restorePath = usePath(bin);
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, SOURCE);
  const h = boot("Body\n", {}, null, "file://" + doc);
  vscode._state.workspaceFolder = tmp;
  vscode._state.warningChoices["a PDF needs TeX"] = "Open HTML";

  await h.receive({ type: "export", to: "both" });
  await settle();
  restorePath();

  // Quarto writes the page before the PDF half reports that it found no TeX,
  // so this run did produce something and the notice has to say where it is.
  assert.equal(vscode._state.warningMessages.length, 1);
  assert.match(
    vscode._state.warningMessages[0].message,
    /^MDM: a PDF needs TeX.*doc\.html was exported\.$/
  );
  assert.deepEqual(
    vscode._state.warningMessages[0].buttons,
    ["Open HTML", "Download TeX", "Show log"]
  );
  assert.deepEqual(
    vscode._state.openedExternal,
    ["file://" + path.join(tmp, "doc.html")],
    "Open HTML did not open the page that landed"
  );
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

  // Something the reader moves out of the way, like a tool the reader
  // installs: a warning that says what to do, and not a failure.
  assert.deepEqual(vscode._state.errorMessages, []);
  assert.match(
    vscode._state.warningMessages[0].message,
    /^MDM: a file named doc\.qmd is in the way of the export\. Rename it or move it, and export again\.$/
  );
  assert.deepEqual(vscode._state.warningMessages[0].buttons, ["Show log"]);
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
async function exportWith(to, settings, extensions, themeKind, source, division) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-export-"));
  const restore = usePath(fakeBin(tmp));
  const doc = path.join(tmp, "doc.mdm");
  fs.writeFileSync(doc, source === undefined ? SOURCE : source);
  // `division` is the word division the document keeps of its own, as its
  // hyphenation menu left it.
  const memory = vscode._memento();
  if (division) {
    await memory.update(ext.DOCUMENT_HYPHENATION, { ["file://" + doc]: division });
  }
  const h = boot("Body\n", settings, extensions, "file://" + doc, memory);  vscode._state.workspaceFolder = tmp;
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

test("the export divides the words the editor divides, and no others", async () => {
  // Division on, and the header naming a language there are patterns for:
  // the two together are what lights the button. Quarto gives a document
  // without a `lang` its default `en` before the filter reads it, so a look
  // that sent the setting alone would divide as English a page the editor
  // keeps whole.
  const on = { "mdm.hyphenation": "auto" };
  const named = (lang) => SOURCE.replace("title: T\n", "title: T\nlang: " + lang + "\n");
  const sent = async (settings, source) =>
    lookOf(await exportWith("html", settings, seedTheme("#e6db74"), undefined, source))["mdm-hyphenation"];
  assert.equal(await sent(on, named("es")), "auto");
  assert.equal(await sent(on, named("es-CU")), "auto", "a regional tag is not its base language");
  assert.equal(await sent(on, named("es").replace(/\n/g, "\r\n")), "auto", "CRLF hid the language");
  assert.equal(await sent(on, SOURCE), "none", "a header naming no language was divided");
  assert.equal(await sent(on, "Body\n"), "none", "a file without a header was divided");
  assert.equal(await sent(on, named("ca")), "none", "a language without patterns was divided");
  assert.equal(await sent({}, named("es")), "none", "division off was divided");
});

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
  // And the face the words are in. It is named on every render, the default
  // included, because the filter's own fallback is the other one: `bin/mdm
  // render` passes no look at all and keeps the sans page it always had, so
  // an export that said nothing would come out in a face the editor is not
  // showing.
  assert.equal(look["mdm-text-font"], "roman", "the default face did not travel");
  const sans = lookOf(
    await exportWith("html", { "mdm.textFont": "sans" }, seedTheme("#e6db74"))
  );
  assert.equal(sans["mdm-text-font"], "sans");
  // How the prose meets the right edge, on every render for the same reason:
  // the editor justifies by default and the filter falls back to the ragged
  // right a page from the command line has always had.
  assert.equal(look["mdm-text-align"], "justify", "the default justification did not travel");
  const ragged = lookOf(
    await exportWith("html", { "mdm.textAlign": "left" }, seedTheme("#e6db74"))
  );
  assert.equal(ragged["mdm-text-align"], "left");
  // Word division is named on every render as well, off included. Off is
  // both the editor's default and the filter's fallback, but the look says
  // what the editor shows rather than trusting the two to stay equal.
  // Division on is pinned beside this test, since what it sends depends on
  // the document's language as well.
  assert.equal(look["mdm-hyphenation"], "none", "the default word division did not travel");
  // The palette of that same theme, spelt without the `#` a -M value cannot
  // carry (it would open a YAML comment).
  assert.equal(look["mdm-syn-string"], "e6db74");
  assert.equal(look["mdm-syn-base"], "f8f8f2");
  assert.equal(look["mdm-syn-bg"], "272822");
});

// The look of an export is the editor's, and its word division the
// document's: a file left dividing is divided on the page and on paper
// whatever settings.json says, and one left whole is left whole.
test("the export divides as the document it is exported from", async () => {
  const spanish = SOURCE.replace("title: T\n", "title: T\nlang: es\n");
  const mine = lookOf(await exportWith("html", {}, null, undefined, spanish, "auto"));
  assert.equal(mine["mdm-hyphenation"], "auto", "the document's own division did not travel");
  const other = lookOf(
    await exportWith("html", { "mdm.hyphenation": "auto" }, null, undefined, spanish, "none")
  );
  assert.equal(other["mdm-hyphenation"], "none", "a document left whole was divided by the setting");
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
  assert.deepEqual(vscode._state.warningMessages, []);
  assert.deepEqual(vscode._state.infoMessages, []);
  assert.ok(!fs.existsSync(path.join(tmp, "args.txt")), "a bogus format reached Quarto");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- The hyphenation menu writes the document's language ----------

// A language chosen from the menu turns word division on, which the document
// keeps of its own (above), and goes into the YAML header as `lang:`, which is
// the document's and travels with it. The host writes the line, header shown or
// hidden, and the update that change sends back is how the editor learns the
// header it now has.

test("a language from the menu goes into the header, and the editor is told", async () => {
  const written = DOC.replace("title: t\n", "title: t\nlang: es\n");
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  await h.receive({ type: "setLanguage", lang: "es" });
  assert.equal(h.document.getText(), written);
  const msg = h.posted[h.posted.length - 1];
  assert.equal(msg.type, "update");
  assert.equal(msg.frontMatter, "---\ntitle: t\nlang: es\n---\n");
  assert.ok(msg.text.startsWith("Intro\n"), "the hidden header reached the editor's text");
  // Shown, the same line lands, and the editor's text carries it.
  const shown = boot(DOC, { "mdm.frontMatter": "shown" });
  await shown.receive({ type: "ready" });
  await shown.receive({ type: "setLanguage", lang: "es" });
  assert.equal(shown.document.getText(), written);
  assert.ok(shown.posted[shown.posted.length - 1].text.startsWith("---\ntitle: t\nlang: es\n---\n"));
});

test("a file with no header gains one, and the margin numbers move with it", async () => {
  const h = boot("Intro\n", {});
  await h.receive({ type: "ready" });
  await h.receive({ type: "setLanguage", lang: "fr" });
  assert.equal(h.document.getText(), "---\nlang: fr\n---\n\nIntro\n");
  const msg = h.posted[h.posted.length - 1];
  assert.equal(msg.text, "Intro\n");
  assert.equal(msg.hiddenLines, 4);
  assert.equal(msg.frontMatter, "---\nlang: fr\n---\n");
  // The document was already hiding the header, so nothing about the mode
  // was written or said.
  assert.deepEqual(h.posted.filter((m) => m.type === "settings"), []);
  assert.deepEqual(vscode._state.updates, []);
});

// A reader who picks a language for a file with no header asked for word
// division and not for three lines of YAML over the document. The header is
// written all the same, since that is where the language of a document goes,
// and the document is put on the hidden mode as it goes in, so the header
// never appears on screen; the button beside the menu, greyed while the file
// had no header, is what opens it from then on. The mode is the editor's own
// setting and not the document's, so it goes into settings.json and every
// open document hides its header with it.
test("a header the menu creates comes up hidden, and the button can open it", async () => {
  const h = boot("Intro\n", { "mdm.frontMatter": "shown" });
  await h.receive({ type: "ready" });
  assert.equal(h.posted[0].withFrontMatter, true, "the file had a header already");
  await h.receive({ type: "setLanguage", lang: "en" });
  assert.equal(h.document.getText(), "---\nlang: en\n---\n\nIntro\n");
  assert.deepEqual(
    vscode._state.updates.map((u) => [u.key, u.value]),
    [["mdm.frontMatter", "hidden"]],
    "the mode was not written"
  );
  const settings = h.posted.filter((m) => m.type === "settings").pop();
  assert.equal(settings.settings.frontMatter, "hidden", "the editor was not told");
  const msg = h.posted[h.posted.length - 1];
  assert.equal(msg.type, "update");
  assert.equal(msg.text, "Intro\n");
  assert.equal(msg.withFrontMatter, false);
  // What greys the button out is a file with no header at all, so this one
  // can be opened by it now, and the margin counts the lines it cannot see.
  assert.equal(msg.frontMatter, "---\nlang: en\n---\n");
  assert.equal(msg.hiddenLines, 4);
  // No frame of the document is ever drawn with the header in it: the mode
  // is written before the line is.
  assert.ok(
    h.posted
      .filter((m) => m.type === "update")
      .every((m) => !m.text.includes("lang: en")),
    "the header was on screen for a moment"
  );
});

// A file that has a header is one whose header the reader has seen and may be
// working in: the language goes into it and the mode is left alone.
test("a language written into a header already showing leaves it showing", async () => {
  const h = boot(DOC, { "mdm.frontMatter": "shown" });
  await h.receive({ type: "ready" });
  await h.receive({ type: "setLanguage", lang: "es" });
  assert.deepEqual(
    h.posted.filter((m) => m.type === "settings"),
    [],
    "the mode was changed under the reader"
  );
  assert.deepEqual(vscode._state.updates, [], "the mode was written all the same");
  const msg = h.posted[h.posted.length - 1];
  assert.equal(msg.withFrontMatter, true);
  assert.ok(msg.text.startsWith("---\ntitle: t\nlang: es\n---\n"));
});

test("a language the header already names writes nothing", async () => {
  const h = boot("---\nlang: es-CU\n---\n\nIntro\n", {});
  await h.receive({ type: "ready" });
  const changes = [];
  vscode._state.textDocumentListeners.push((e) => changes.push(e));
  await h.receive({ type: "setLanguage", lang: "es" });
  assert.equal(changes.length, 0);
});

test("a tag the menu does not offer never reaches the file", async () => {
  const h = boot(DOC, {});
  await h.receive({ type: "ready" });
  for (const lang of ["ja", "es\nevil: 1", "ES", "__proto__", "", null, 42, ["es"]]) {
    await h.receive({ type: "setLanguage", lang });
  }
  assert.equal(h.document.getText(), DOC);
});

test("the menu offers the languages there are patterns for", () => {
  const patterns = require("../vscode-mdm/media/hyphenation-patterns.js");
  assert.deepEqual([...ext.LANGUAGES].sort(), Object.keys(patterns).sort());
});

test("an edit in flight and a language chosen beside it both land", async () => {
  // VS Code applies an edit asynchronously and starts a message's handler
  // without waiting for the one before it, so each write waits its turn.
  // Read too early, the language would be written over the text from before
  // the edit and undo it; and an edit read while the language was landing
  // would splice the header back without it.
  const apply = vscode.workspace.applyEdit;
  const slow = () => {
    vscode.workspace.applyEdit = async function (edit) {
      await new Promise((r) => setTimeout(r, 20));
      return apply.call(this, edit);
    };
  };
  const both = DOC.replace("Intro", "Edited").replace("title: t\n", "title: t\nlang: es\n");
  try {
    const shown = boot(DOC, { "mdm.frontMatter": "shown" });
    slow();
    await shown.receive({ type: "ready" });
    const typed = shown.posted[0].text.replace("Intro", "Edited");
    await Promise.all([
      shown.receive({ type: "edit", text: typed, withFrontMatter: true }),
      shown.receive({ type: "setLanguage", lang: "es" }),
    ]);
    assert.equal(shown.document.getText(), both, "the language undid the edit before it");
    const hidden = boot(DOC, {});
    slow();
    await hidden.receive({ type: "ready" });
    const body = hidden.posted[0].text.replace("Intro", "Edited");
    await Promise.all([
      hidden.receive({ type: "setLanguage", lang: "es" }),
      hidden.receive({ type: "edit", text: body, withFrontMatter: false }),
    ]);
    assert.equal(hidden.document.getText(), both, "the edit took the language back out");
  } finally {
    vscode.workspace.applyEdit = apply;
  }
});
