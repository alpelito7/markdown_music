// The memory of word division, end to end: the editor in Chrome, the real
// extension.js in Node on the other end of the wire (the harness's __toHost
// hook, through open({ toHost })), and VS Code's globalState under both.
//
// The rule, as the owner put it on 2026-09-11: a reader keeps documents in
// several languages, so the division is the one button of the bar each
// document remembers of its own, and every other button is the editor's and
// shared by all of them. So: a file left dividing comes back dividing, the
// file beside it does not start dividing however its header reads, and a
// look pressed in one shows in the other. The host's half on its own is in
// extension-host.test.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { open, skip } = require("./webview/helpers.js");

// require("vscode") is the mock, as in extension-host.test.js.
const MOCK = path.join(__dirname, "mocks", "vscode.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "vscode") return MOCK;
  return origResolve.call(this, request, ...rest);
};
const vscode = require("vscode");
const ext = require("../vscode-mdm/extension.js");

// Two files of one shape: a header, a sentence to divide and a score. B names
// its language already, so that its lamp staying dark is B's own division
// speaking and not a header with nothing to divide by; A names none until the
// menu writes one.
const PROSE = "The representation extraordinarily internationalization continues.";
const A = ["---", "title: A", "---", "", PROSE, "", "```abc", "X:1", "K:C", "CDEF|", "```", ""].join("\n");
const B = ["---", "title: B", "lang: en", "---", "", PROSE, "", "```abc", "X:1", "K:C", "GABc|", "```", ""].join("\n");

// The buttons that light on what was asked for, in the order the bar has them.
const LAMPS = [
  "outline",
  "mdm-match-substring",
  "mdm-text-font",
  "mdm-hyphenation",
  "mdm-front-matter",
  "mdm-staff-lines",
  "mdm-follow",
];

const lit = (page) =>
  page.evaluate(
    (names) =>
      names.filter((n) =>
        document.querySelector('#app button[data-type="' + n + '"]').classList.contains("mdm-btn--on")
      ),
    LAMPS
  );

// The lamps once they read `want`, or as they are when ten seconds have not
// brought them there, so that a failure shows the bar it found.
async function lampsReach(page, want) {
  try {
    await page.waitForFunction(
      (names, w) =>
        JSON.stringify(
          names.filter((n) =>
            document.querySelector('#app button[data-type="' + n + '"]').classList.contains("mdm-btn--on")
          )
        ) === JSON.stringify(w),
      { timeout: 10000 },
      LAMPS,
      want
    );
  } catch (e) {
    // what they read is the answer
  }
  return lit(page);
}

// What VS Code does after a write to settings.json and the mock does not: the
// configuration event that carries it to every open editor. A division needs
// none of it, since nothing is written there and the host answers that press
// itself, which is half of what this test is about.
function settingsChanged() {
  vscode._state.configurationListeners.forEach((l) =>
    l({ affectsConfiguration: (s) => s === "mdm" })
  );
}

// VS Code started on `globalState`: the extension activated, and the provider
// it registered for .mdm files.
function start(globalState) {
  ext.activate({ subscriptions: [], extensionUri: vscode.Uri.file("/ext"), globalState });
  const providers = vscode._state.registeredProviders;
  return providers[providers.length - 1].provider;
}

// A file opened in the editor: the host resolves the panel, the page comes up
// on the settings the host wrote into its HTML, and from then on every
// message crosses the wire both ways, the host answering the page's `ready`
// itself. Closing it is the tab closed: the panel's listeners go with it.
async function openFile(provider, uri) {
  let page = null;
  let receive = null;
  let dispose = null;
  const panel = {
    webview: {
      asWebviewUri: (u) => u,
      cspSource: "vscode-resource:",
      // Nothing waits on this, as nothing waits on it in VS Code: a message
      // posted to a page already closed is dropped rather than thrown.
      postMessage(msg) {
        if (!page) return Promise.resolve(false);
        return page.evaluate((m) => window.postMessage(m, "*"), msg).then(
          () => true,
          () => false
        );
      },
      onDidReceiveMessage(handler) {
        receive = handler;
      },
    },
    onDidDispose(handler) {
      dispose = handler;
    },
  };
  provider.resolveCustomTextEditor(vscode._makeDocument(uri), panel);
  const settings = JSON.parse(/window\.MDM_SETTINGS = (\{.*?\});/.exec(panel.webview.html)[1]);
  const h = await open({
    seed: { settings },
    scores: 1,
    toHost: (msg, p) => {
      page = p;
      return receive(msg);
    },
  });
  return {
    page: h.page,
    errors: h.errors,
    close: async () => {
      dispose();
      await h.close();
    },
  };
}

test("the division is each file's own, and the rest of the bar is the editor's", { skip }, async () => {
  vscode._reset();
  vscode._state.documents.set("file:///a.mdm", A);
  vscode._state.documents.set("file:///b.mdm", B);
  const globalState = vscode._memento();
  let provider = start(globalState);

  // A: the staff lines in ink, which is the editor's, and Spanish dividing
  // its words, which is A's own.
  const BOTH = ["mdm-hyphenation", "mdm-staff-lines"];
  let a = await openFile(provider, "file:///a.mdm");
  assert.deepEqual(await lit(a.page), [], "a file opened for the first time came up with a lamp lit");
  await a.page.click('#app button[data-type="mdm-staff-lines"]');
  await new Promise((r) => setTimeout(r, 200));
  settingsChanged();
  assert.deepEqual(await lampsReach(a.page, ["mdm-staff-lines"]), ["mdm-staff-lines"]);
  await a.page.click('#app button[data-type="mdm-hyphenation"]');
  await a.page.click('#app button[data-type="mdm-hyphenation-es"]');
  assert.deepEqual(await lampsReach(a.page, BOTH), BOTH);
  assert.deepEqual(a.errors, []);
  await a.close();

  // B: the ink is there, since that one is the editor's; the division is not,
  // though B's header names a language of its own.
  let b = await openFile(provider, "file:///b.mdm");
  assert.deepEqual(
    await lampsReach(b.page, ["mdm-staff-lines"]),
    ["mdm-staff-lines"],
    "B took A's division, or did not take the editor's ink"
  );
  assert.equal(
    await b.page.evaluate(() => document.querySelectorAll("#app .mdm-hyphen").length),
    0,
    "B divided its words"
  );
  assert.deepEqual(b.errors, []);
  await b.close();

  // VS Code closed and opened again: a new activation on the same globalState.
  provider = start(globalState);
  a = await openFile(provider, "file:///a.mdm");
  assert.deepEqual(await lampsReach(a.page, BOTH), BOTH, "A did not come back dividing");
  assert.deepEqual(a.errors, []);
  await a.close();
  b = await openFile(provider, "file:///b.mdm");
  assert.deepEqual(
    await lampsReach(b.page, ["mdm-staff-lines"]),
    ["mdm-staff-lines"],
    "B came back on a division nobody chose in it"
  );
  assert.deepEqual(b.errors, []);
  await b.close();

  // The ink went to settings.json, as every look does, and the division
  // never did.
  assert.deepEqual(
    vscode._state.updates.map((u) => [u.key, u.value]),
    [["mdm.staffLines", "ink"]]
  );
});
