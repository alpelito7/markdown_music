// Editing tests for the CodeMirror 6 webview (vscode-mdm/media/main.js),
// driven in a real browser through tests/webview/harness.html: the gestures
// that add carets, what each caret reveals, the delimiters that must stay
// literal when broken, the sync with the host and the editing commands.
//
// The editor text IS the file text; what renders where depends on the carets
// (see "Rendering: decorations over the syntax tree" in main.js). Most tests
// open a small fixture of their own rather than example.mdm, so the position
// of every caret is plain to read.
// Run with: node --test --test-concurrency=1 tests/webview-editing.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  open,
  update,
  lastEdit,
  skip,
  docText,
  posOf,
  setSelection,
  selectionRanges,
  coordsAt,
  lineAt,
  postSettings,
  setSettingPosts,
} = require("./webview/helpers.js");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// The outline button asks the host to store mdm.outline and the panel opens
// when the value comes back, the way every other button that holds a state
// works. Nothing here is inside VS Code to answer, so the test posts the
// answer itself; `seeded` carries whatever the test seeded, since the host
// sends every setting in that message and the defaults would undo them.
async function pressOutline(page, shown, seeded) {
  await page.click('#app button[data-type="outline"]');
  await postSettings(page, Object.assign({ outline: shown ? "shown" : "hidden" }, seeded || {}));
  await sleep(200);
}

// A key with a modifier held, the way a user chords it.
async function chord(page, mods, key) {
  for (const m of mods) await page.keyboard.down(m);
  await page.keyboard.press(key);
  for (const m of mods.slice().reverse()) await page.keyboard.up(m);
}

// Counts matching elements inside the editor.
function count(page, selector) {
  return page.evaluate((s) => document.querySelectorAll("#app " + s).length, selector);
}

// The edit messages the webview posted, whole.
function edits(page) {
  return page.evaluate(() => window.__posts.filter((m) => m.type === "edit"));
}

// The host's update, as it arrives in VS Code: only the stretch that differs
// is replaced in the editor.
function hostUpdate(page, text, withFrontMatter) {
  return page.evaluate(
    (text, fm) =>
      window.postMessage({ type: "update", text: text, frontMatter: "x", withFrontMatter: fm }, "*"),
    text,
    withFrontMatter !== false
  );
}

const MATH = "Before.\n\n$$\na^2 + b^2 = c^2\n$$\n\nAfter.\n";
const CODE = "Intro.\n\n```python\nx = 1\n```\n\nAfter.\n";

// ---- Multicursor gestures ----

test("Alt+click adds a caret and typing lands at both", { skip }, async () => {
  const h = await open({ text: "alpha\nbeta\ngamma\n", scores: 0 });
  const first = await coordsAt(h.page, 0);
  const third = await coordsAt(h.page, await posOf(h.page, "gamma"));
  await h.page.mouse.click(first.x, first.y);
  // Two clicks within Chrome's double-click window would read as one double.
  await sleep(600);
  await h.page.keyboard.down("Alt");
  await h.page.mouse.click(third.x, third.y);
  await h.page.keyboard.up("Alt");
  assert.deepEqual(await selectionRanges(h.page), [[0, 0], [11, 11]]);
  await h.page.keyboard.type("X");
  assert.equal(await docText(h.page), "Xalpha\nbeta\nXgamma\n");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an Alt used with the mouse keeps its release out of the host's menu bar", { skip }, async () => {
  const h = await open({ text: "alpha\nbeta\ngamma\n", scores: 0 });
  // A stand-in for the VS Code preload, which forwards the keys of a webview
  // to the workbench from a bubble listener on the window
  // (contentWindow.addEventListener('keyup', handleInnerKeyup)). What reaches
  // it is what the workbench's menu bar reads: a clean Alt press AND release
  // is what takes the focus into the File menu.
  await h.page.evaluate(() => {
    window.__host = [];
    window.addEventListener("keydown", (e) => window.__host.push("down:" + e.key));
    window.addEventListener("keyup", (e) => window.__host.push("up:" + e.key));
    // And a probe below the document, to show the page itself is untouched.
    window.__page = [];
    window.__mdm.view.contentDOM.addEventListener("keyup", (e) =>
      window.__page.push("up:" + e.key)
    );
  });
  const first = await coordsAt(h.page, 0);
  const third = await coordsAt(h.page, await posOf(h.page, "gamma"));
  await h.page.mouse.click(first.x, first.y);
  await sleep(600);

  // A tap on its own still leaves the page: the File menu is VS Code's and it
  // keeps working from in here.
  await h.page.keyboard.down("Alt");
  await h.page.keyboard.up("Alt");
  assert.deepEqual(await h.page.evaluate(() => window.__host), [
    "down:Alt",
    "up:Alt",
  ]);

  // Used with a click it does not: the press is forwarded, the release is
  // held back, so the workbench never sees the clean pair that focuses the
  // menu bar and the carets stay here.
  await h.page.evaluate(() => {
    window.__host = [];
    window.__page = [];
  });
  await h.page.keyboard.down("Alt");
  await h.page.mouse.click(third.x, third.y);
  await h.page.keyboard.up("Alt");
  assert.deepEqual(await h.page.evaluate(() => window.__host), ["down:Alt"]);
  assert.deepEqual(await h.page.evaluate(() => window.__page), ["up:Alt"]);
  assert.deepEqual(await selectionRanges(h.page), [[0, 0], [11, 11]]);
  await h.page.keyboard.type("X");
  assert.equal(await docText(h.page), "Xalpha\nbeta\nXgamma\n");

  // The next tap is a tap again: what was held back is one release, not the
  // key.
  await h.page.evaluate(() => {
    window.__host = [];
  });
  await h.page.keyboard.down("Alt");
  await h.page.keyboard.up("Alt");
  assert.deepEqual(await h.page.evaluate(() => window.__host), [
    "down:Alt",
    "up:Alt",
  ]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("under ctrlCmd it is Ctrl+click that adds the caret, and Alt+click only moves it", { skip }, async () => {
  const h = await open({
    text: "alpha\nbeta\ngamma\n",
    scores: 0,
    seed: { settings: { multiCursorModifier: "ctrlCmd" } },
  });
  const first = await coordsAt(h.page, 0);
  const second = await coordsAt(h.page, await posOf(h.page, "beta"));
  const third = await coordsAt(h.page, await posOf(h.page, "gamma"));
  await h.page.mouse.click(first.x, first.y);
  await sleep(600);
  await h.page.keyboard.down("Alt");
  await h.page.mouse.click(second.x, second.y);
  await h.page.keyboard.up("Alt");
  assert.deepEqual(await selectionRanges(h.page), [[6, 6]]);
  await sleep(600);
  await h.page.keyboard.down("Control");
  await h.page.mouse.click(third.x, third.y);
  await h.page.keyboard.up("Control");
  assert.deepEqual(await selectionRanges(h.page), [[6, 6], [11, 11]]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the settings message switches the caret modifier live", { skip }, async () => {
  const h = await open({ text: "alpha\nbeta\ngamma\n", scores: 0 });
  await h.page.evaluate(() =>
    window.postMessage(
      {
        type: "settings",
        settings: {
          theme: "light",
          scoreFill: "none",
          staffLines: "gray",
          scoreAlign: "center",
          frontMatter: "shown",
          multiCursorModifier: "ctrlCmd",
        },
      },
      "*"
    )
  );
  await sleep(200);
  const first = await coordsAt(h.page, 0);
  const third = await coordsAt(h.page, await posOf(h.page, "gamma"));
  await h.page.mouse.click(first.x, first.y);
  await sleep(600);
  await h.page.keyboard.down("Control");
  await h.page.mouse.click(third.x, third.y);
  await h.page.keyboard.up("Control");
  assert.deepEqual(await selectionRanges(h.page), [[0, 0], [11, 11]]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Shift+Alt+drag selects a column", { skip }, async () => {
  const h = await open({ text: "one two\nthree four\nfive six\n", scores: 0 });
  const from = await coordsAt(h.page, 0);
  const to = await coordsAt(h.page, (await posOf(h.page, "five")) + 3);
  await h.page.mouse.move(from.x, from.y);
  await h.page.keyboard.down("Shift");
  await h.page.keyboard.down("Alt");
  await h.page.mouse.down();
  await h.page.mouse.move(to.x, to.y, { steps: 8 });
  await h.page.mouse.up();
  await h.page.keyboard.up("Alt");
  await h.page.keyboard.up("Shift");
  assert.deepEqual(await selectionRanges(h.page), [[0, 3], [8, 11], [19, 22]]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Ctrl+D selects the next occurrence, Ctrl+Shift+L all of them", { skip }, async () => {
  const h = await open({ text: "foo bar foo baz foo\n", scores: 0 });
  await setSelection(h.page, [{ anchor: 0, head: 3 }]);
  await chord(h.page, ["Control"], "d");
  assert.deepEqual(await selectionRanges(h.page), [[0, 3], [8, 11]]);
  await chord(h.page, ["Control"], "d");
  assert.deepEqual(await selectionRanges(h.page), [[0, 3], [8, 11], [16, 19]]);
  await setSelection(h.page, [{ anchor: 8, head: 11 }]);
  await chord(h.page, ["Control", "Shift"], "l");
  assert.deepEqual(await selectionRanges(h.page), [[0, 3], [8, 11], [16, 19]]);
  await h.page.keyboard.type("q");
  assert.equal(await docText(h.page), "q bar q baz q\n");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Ctrl+Alt+Down adds a caret below, Ctrl+Alt+Up above, Escape goes back to one", { skip }, async () => {
  const h = await open({ text: "abc\ndef\nghi\n", scores: 0 });
  await setSelection(h.page, 5);
  await chord(h.page, ["Control", "Alt"], "ArrowDown");
  assert.deepEqual(await selectionRanges(h.page), [[5, 5], [9, 9]]);
  await chord(h.page, ["Control", "Alt"], "ArrowUp");
  assert.deepEqual(await selectionRanges(h.page), [[1, 1], [5, 5], [9, 9]]);
  await h.page.keyboard.press("Escape");
  assert.equal((await selectionRanges(h.page)).length, 1);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a multi-caret insert is one undo step", { skip }, async () => {
  const h = await open({ text: "abc\ndef\n", scores: 0 });
  await setSelection(h.page, [{ anchor: 0 }, { anchor: 4 }]);
  await h.page.keyboard.type("Q");
  assert.equal(await docText(h.page), "Qabc\nQdef\n");
  await chord(h.page, ["Control"], "z");
  assert.equal(await docText(h.page), "abc\ndef\n");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- Reveal semantics ----

test("a display equation is a widget over hidden source until a caret enters it", { skip }, async () => {
  const h = await open({ text: MATH, scores: 0 });
  // Untouched: the three source lines are out of the flow, the widget stands.
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 0);
  assert.equal(await count(h.page, ".mdm-math.mdm-math--block .katex-display"), 1);
  const hidden = await h.page.evaluate(() => {
    const w = document.querySelector("#app .mdm-math--block");
    const prev = w.previousElementSibling;
    return { contenteditable: prev.getAttribute("contenteditable"), height: prev.offsetHeight, className: prev.className };
  });
  assert.deepEqual(hidden, { contenteditable: "false", height: 0, className: "" });
  // A caret in the equation: the source shows, the widget stays as preview.
  await setSelection(h.page, await posOf(h.page, "a^2"));
  assert.equal(await count(h.page, ".cm-line.mdm-math-line.mdm-src-line"), 3);
  assert.equal(await count(h.page, ".cm-line.mdm-math-first"), 1);
  assert.equal(await count(h.page, ".cm-line.mdm-math-last"), 1);
  assert.equal(await count(h.page, ".mdm-math--block .katex-display"), 1);
  assert.equal((await lineAt(h.page, await posOf(h.page, "a^2"))).text, "a^2 + b^2 = c^2");
  // Out again: hidden again.
  await setSelection(h.page, 0);
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 0);
  assert.equal(await count(h.page, ".mdm-math--block"), 1);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an equation that does not compile shows KaTeX's message while open and its source when left", { skip }, async () => {
  const h = await open({ text: "Before.\n\n$$\n\\frac{a\n$$\n\nAfter.\n", scores: 0 });
  // Untouched and broken: the source, marked, and no drawing.
  assert.equal(await count(h.page, ".cm-line.mdm-math-line.mdm-math--broken"), 3);
  assert.equal(await count(h.page, ".mdm-math--block"), 0);
  // Touched: the widget carries the error instead of a drawing.
  await setSelection(h.page, await posOf(h.page, "\\frac"));
  const error = await h.page.evaluate(() => {
    const w = document.querySelector("#app .mdm-math--block");
    return w ? { error: w.classList.contains("mdm-math--error"), text: w.textContent } : null;
  });
  assert.ok(error, "no widget while the broken block is open");
  assert.equal(error.error, true);
  assert.match(error.text, /KaTeX parse error/);
  // Fixed by typing: the drawing takes the widget's place.
  await h.page.keyboard.press("End");
  await h.page.keyboard.type("}{b}");
  assert.equal(await count(h.page, ".mdm-math--error"), 0);
  assert.equal(await count(h.page, ".mdm-math--block .katex-display"), 1);
  assert.equal(await count(h.page, ".mdm-math--broken"), 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("inline math renders in place and shows its source when touched", { skip }, async () => {
  const h = await open({ text: "Take $x^2$ here.\n\nOther.\n", scores: 0 });
  // Caret off it: a rendered widget replaces the source, no preview beside it.
  await setSelection(h.page, await posOf(h.page, "Other"));
  assert.equal(await count(h.page, "span.mdm-math:not(.mdm-math--preview) .katex"), 1);
  assert.equal(await count(h.page, ".mdm-math-src"), 0);
  assert.equal(await count(h.page, ".mdm-math--preview"), 0);
  // Caret on it: the replace goes, the source shows, and a live preview of the
  // rendered equation appears beside it.
  await setSelection(h.page, await posOf(h.page, "x^2"));
  assert.equal(await count(h.page, "span.mdm-math:not(.mdm-math--preview)"), 0);
  assert.equal(await count(h.page, ".mdm-math-src"), 1);
  assert.equal(await count(h.page, ".mdm-math--preview .katex"), 1);
  // The source itself is the literal delimiters and body (the preview is a
  // widget after it, so it is not part of the document text).
  assert.equal(await docText(h.page), "Take $x^2$ here.\n\nOther.\n");
  assert.equal(
    await h.page.evaluate(() => document.querySelector("#app .mdm-math-src").textContent),
    "$x^2$"
  );
  // Broken inline math keeps its source with the broken class, and the preview
  // goes while there is nothing to draw.
  await h.page.keyboard.type("\\frac{");
  assert.equal(await count(h.page, ".mdm-math-src.mdm-math--broken"), 1);
  assert.equal(await count(h.page, ".mdm-math--preview"), 0);
  // Off a broken one, the source stays (no render to replace it with).
  await setSelection(h.page, await posOf(h.page, "Other"));
  assert.equal(await count(h.page, ".mdm-math-src.mdm-math--broken"), 1);
  assert.equal(await count(h.page, "span.mdm-math"), 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("two carets open two equations at once", { skip }, async () => {
  const h = await open({
    text: "One.\n\n$$\na = 1\n$$\n\nTwo.\n\n$$\nb = 2\n$$\n\nEnd.\n",
    scores: 0,
  });
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 0);
  assert.equal(await count(h.page, ".mdm-math--block"), 2);
  await setSelection(h.page, [
    { anchor: await posOf(h.page, "a = 1") },
    { anchor: await posOf(h.page, "b = 2") },
  ]);
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 6);
  assert.equal(await count(h.page, ".mdm-math--block"), 2);
  await setSelection(h.page, await posOf(h.page, "b = 2"));
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 3);
  assert.equal((await lineAt(h.page, await posOf(h.page, "b = 2"))).text, "b = 2");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a heading hides its # until the caret is on its line", { skip }, async () => {
  const h = await open({ text: "# Title\n\ntext\n", scores: 0 });
  await setSelection(h.page, await posOf(h.page, "text"));
  let line = await lineAt(h.page, 0);
  assert.match(line.className, /\bmdm-h\b/);
  assert.match(line.className, /\bmdm-h1\b/);
  assert.equal(line.text, "Title");
  await setSelection(h.page, 3);
  line = await lineAt(h.page, 0);
  assert.equal(line.text, "# Title");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("emphasis, strong and inline code hide their marks unless touched", { skip }, async () => {
  const h = await open({ text: "Some **bold** and *it* and `code` words.\n\nOther.\n", scores: 0 });
  await setSelection(h.page, await posOf(h.page, "Other"));
  assert.equal((await lineAt(h.page, 0)).text, "Some bold and it and code words.");
  assert.equal(await count(h.page, ".mdm-inline-code"), 1);
  await setSelection(h.page, await posOf(h.page, "bold"));
  assert.equal((await lineAt(h.page, 0)).text, "Some **bold** and it and code words.");
  await setSelection(h.page, await posOf(h.page, "code"));
  assert.equal((await lineAt(h.page, 0)).text, "Some bold and it and `code` words.");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("bullets and rules render unless their line is touched", { skip }, async () => {
  const h = await open({ text: "Intro.\n\n- one\n- two\n\n---\n\nEnd.\n", scores: 0 });
  assert.equal(await count(h.page, ".cm-line.mdm-li"), 2);
  assert.equal(await count(h.page, "span.mdm-bullet"), 2);
  assert.equal(await count(h.page, "div.mdm-hr"), 1);
  await setSelection(h.page, await posOf(h.page, "one"));
  assert.equal(await count(h.page, "span.mdm-bullet"), 1);
  assert.equal((await lineAt(h.page, await posOf(h.page, "one"))).text, "- one");
  await setSelection(h.page, await posOf(h.page, "---"));
  assert.equal(await count(h.page, "div.mdm-hr"), 0);
  assert.equal((await lineAt(h.page, await posOf(h.page, "---"))).text, "---");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test(
  "a task checkbox click flips the text and posts the edit",
  { skip },
  async () => {
  const h = await open({ text: "Tasks:\n\n- [ ] milk\n- [x] eggs\n", scores: 0 });
  assert.equal(await count(h.page, "input.mdm-task"), 2);
  const checked = await h.page.evaluate(() =>
    Array.from(document.querySelectorAll("#app input.mdm-task")).map((b) => b.checked)
  );
  assert.deepEqual(checked, [false, true]);
  await h.page.click("#app input.mdm-task");
  assert.equal(await docText(h.page), "Tasks:\n\n- [x] milk\n- [x] eggs\n");
  assert.equal(await lastEdit(h.page), "Tasks:\n\n- [x] milk\n- [x] eggs\n");
  // The click did not drop the caret into the line: the box still renders.
  assert.equal(await count(h.page, "input.mdm-task"), 2);
  assert.deepEqual(h.errors, []);
  await h.close();
  }
);

test("a callout paints its kind and shows a fence only on a touched line", { skip }, async () => {
  const h = await open({ text: "Intro.\n\n::: {.callout-warning}\nMind the gap.\n:::\n\nAfter.\n", scores: 0 });
  assert.equal(await count(h.page, ".cm-line.mdm-co-line.mdm-co--warning"), 3);
  assert.equal(await count(h.page, ".cm-line.mdm-co-first"), 1);
  assert.equal(await count(h.page, ".cm-line.mdm-co-last"), 1);
  assert.equal(await count(h.page, ".cm-line.mdm-co-fence"), 2);
  await setSelection(h.page, await posOf(h.page, "callout-warning"));
  assert.equal(await count(h.page, ".cm-line.mdm-co-fence"), 1);
  assert.match((await lineAt(h.page, await posOf(h.page, "Mind"))).className, /\bmdm-co-line\b/);
  // Without its closing fence the callout is plain text.
  await update(h.page, "Intro.\n\n::: {.callout-warning}\nMind the gap.\n\nAfter.\n", true, 0);
  assert.equal(await count(h.page, ".mdm-co-line"), 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a blockquote hides its > until the caret is on that line", { skip }, async () => {
  const h = await open({ text: "Intro.\n\n> first\n\n> second\n", scores: 0 });
  let line = await lineAt(h.page, await posOf(h.page, "first"));
  assert.match(line.className, /\bmdm-quote\b/);
  assert.equal(line.text, "first");
  assert.equal((await lineAt(h.page, await posOf(h.page, "second"))).text, "second");
  await setSelection(h.page, await posOf(h.page, "first"));
  assert.equal((await lineAt(h.page, await posOf(h.page, "first"))).text, "> first");
  assert.equal((await lineAt(h.page, await posOf(h.page, "second"))).text, "second");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test(
  "the > of a blockquote's continuation line is hidden too",
  { skip },
  async () => {
    const h = await open({ text: "Intro.\n\n> first\n> second\n", scores: 0 });
    assert.equal((await lineAt(h.page, await posOf(h.page, "first"))).text, "first");
    assert.equal((await lineAt(h.page, await posOf(h.page, "second"))).text, "second");
    await setSelection(h.page, await posOf(h.page, "first"));
    assert.equal((await lineAt(h.page, await posOf(h.page, "first"))).text, "> first");
    assert.equal((await lineAt(h.page, await posOf(h.page, "second"))).text, "second");
    assert.deepEqual(h.errors, []);
    await h.close();
  }
);

test("front matter lines carry the header classes and keep their --- visible", { skip }, async () => {
  const h = await open({ text: "---\ntitle: A\nauthor: B\n---\n\nBody.\n", scores: 0 });
  await setSelection(h.page, await posOf(h.page, "Body"));
  assert.equal(await count(h.page, ".cm-line.mdm-fm-line"), 4);
  const first = await lineAt(h.page, 0);
  assert.match(first.className, /\bmdm-fm-first\b/);
  assert.match(first.className, /\bmdm-fm-mark\b/);
  assert.equal(first.text, "---");
  const last = await lineAt(h.page, await posOf(h.page, "---", 0, 1));
  assert.match(last.className, /\bmdm-fm-last\b/);
  assert.match(last.className, /\bmdm-fm-mark\b/);
  assert.equal(last.text, "---");
  assert.equal((await lineAt(h.page, await posOf(h.page, "title"))).text, "title: A");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- Literal delimiters ----

test("deleting one $ of the closing $$ leaves plain text, retyping it renders, undo restores", { skip }, async () => {
  const h = await open({ text: MATH, scores: 0 });
  await setSelection(h.page, await posOf(h.page, "$$", 2, 1));
  await h.page.keyboard.press("Backspace");
  const broken = "Before.\n\n$$\na^2 + b^2 = c^2\n$\n\nAfter.\n";
  assert.equal(await docText(h.page), broken);
  assert.equal(await count(h.page, ".mdm-math-line"), 0);
  assert.equal(await count(h.page, ".mdm-math--block"), 0);
  assert.equal(await count(h.page, ".mdm-math--broken"), 0);
  const line = await lineAt(h.page, await posOf(h.page, "a^2"));
  assert.equal(line.className, "cm-line");
  assert.equal(line.text, "a^2 + b^2 = c^2");
  // Nothing puts the $ back: a second later the text is what was typed.
  await sleep(700);
  assert.equal(await docText(h.page), broken);
  await h.page.keyboard.type("$");
  assert.equal(await docText(h.page), MATH);
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 3);
  assert.equal(await count(h.page, ".mdm-math--block .katex-display"), 1);
  await chord(h.page, ["Control"], "z");
  assert.equal(await docText(h.page), broken);
  await chord(h.page, ["Control"], "z");
  assert.equal(await docText(h.page), MATH);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("deleting a backtick of a closing fence leaves literal text that nothing regenerates", { skip }, async () => {
  const h = await open({ text: CODE, scores: 0 });
  await setSelection(h.page, await posOf(h.page, "```", 3, 1));
  await h.page.keyboard.press("Backspace");
  const broken = "Intro.\n\n```python\nx = 1\n``\n\nAfter.\n";
  assert.equal(await docText(h.page), broken);
  await sleep(700);
  assert.equal(await docText(h.page), broken);
  assert.equal((await lineAt(h.page, await posOf(h.page, "``\n"))).text, "``");
  await h.page.keyboard.type("`");
  assert.equal(await docText(h.page), CODE);
  // Back to a fence, open because the caret is on it.
  assert.equal(await count(h.page, ".cm-line.mdm-fence-line"), 2);
  assert.equal(await count(h.page, ".cm-line.mdm-code-line"), 3);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("typing $$, a formula and $$ in a paragraph ends rendered", { skip }, async () => {
  const h = await open({ text: "Start.\n\n\n\nEnd.\n", scores: 0 });
  await setSelection(h.page, 8);
  await h.page.keyboard.type("$$");
  await h.page.keyboard.press("Enter");
  await h.page.keyboard.type("e = mc^2");
  await h.page.keyboard.press("Enter");
  await h.page.keyboard.type("$$");
  assert.equal(await docText(h.page), "Start.\n\n$$\ne = mc^2\n$$\n\nEnd.\n");
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 3);
  assert.equal(await count(h.page, ".mdm-math--block .katex-display"), 1);
  await setSelection(h.page, 0);
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 0);
  assert.equal(await count(h.page, ".mdm-math--block .katex-display"), 1);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- Sync with the host ----

test("a keystroke posts an edit with the typed text", { skip }, async () => {
  const h = await open({ text: "Hello\n", scores: 0 });
  await setSelection(h.page, 5);
  await h.page.keyboard.type(" world");
  assert.equal(await lastEdit(h.page), "Hello world\n");
  const last = (await edits(h.page)).pop();
  assert.equal(last.withFrontMatter, true);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an external update keeps a caret outside the change in place and is not echoed", { skip }, async () => {
  const h = await open({ text: "alpha\nbeta\ngamma\n", scores: 0 });
  await setSelection(h.page, 8); // after "be"
  await hostUpdate(h.page, "alpha\nbeta\ngammas\n");
  await sleep(100);
  assert.equal(await docText(h.page), "alpha\nbeta\ngammas\n");
  assert.deepEqual(await selectionRanges(h.page), [[8, 8]]);
  await hostUpdate(h.page, "alphas\nbeta\ngammas\n");
  await sleep(100);
  assert.equal(await docText(h.page), "alphas\nbeta\ngammas\n");
  const ranges = await selectionRanges(h.page);
  assert.equal((await docText(h.page)).slice(0, ranges[0][0]), "alphas\nbe");
  await sleep(500);
  assert.deepEqual(await edits(h.page), []);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("with the header hidden the text has no front matter and edits say so", { skip }, async () => {
  const h = await open({
    text: "---\ntitle: A\n---\n\nBody.\n",
    scores: 0,
    withFrontMatter: false,
    seed: { settings: { frontMatter: "hidden" } },
  });
  assert.equal(await docText(h.page), "Body.\n");
  assert.equal(await count(h.page, ".mdm-fm-line"), 0);
  await setSelection(h.page, 5);
  await h.page.keyboard.type("!");
  assert.equal(await lastEdit(h.page), "Body.!\n");
  assert.equal((await edits(h.page)).pop().withFrontMatter, false);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- Commands ----

test("Ctrl+B wraps every range and unwraps it again", { skip }, async () => {
  const h = await open({ text: "abc\ndef\n", scores: 0 });
  await setSelection(h.page, [
    { anchor: 0, head: 3 },
    { anchor: 4, head: 7 },
  ]);
  await chord(h.page, ["Control"], "b");
  assert.equal(await docText(h.page), "**abc**\n**def**\n");
  assert.deepEqual(await selectionRanges(h.page), [[2, 5], [10, 13]]);
  await chord(h.page, ["Control"], "b");
  assert.equal(await docText(h.page), "abc\ndef\n");
  // A collapsed caret gets the pair and lands inside it.
  await setSelection(h.page, 3);
  await chord(h.page, ["Control"], "i");
  assert.equal(await docText(h.page), "abc**\ndef\n");
  assert.deepEqual(await selectionRanges(h.page), [[4, 4]]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the heading button cycles the level of every selected line", { skip }, async () => {
  const h = await open({ text: "one\ntwo\n###### six\n", scores: 0 });
  await setSelection(h.page, [{ anchor: 0 }, { anchor: 4 }, { anchor: 10 }]);
  await h.page.click('#app button[data-type="headings"]');
  assert.equal(await docText(h.page), "# one\n# two\nsix\n");
  await h.page.click('#app button[data-type="headings"]');
  assert.equal(await docText(h.page), "## one\n## two\n# six\n");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Ctrl+Enter leaves a fenced block into a fresh paragraph below it", { skip }, async () => {
  const h = await open({ text: CODE, scores: 0 });
  await setSelection(h.page, (await posOf(h.page, "x = 1")) + 2);
  await chord(h.page, ["Control"], "Enter");
  assert.equal(await docText(h.page), "Intro.\n\n```python\nx = 1\n```\n\n\n\nAfter.\n");
  const head = (await selectionRanges(h.page))[0][0];
  assert.equal(head, (await posOf(h.page, "```", 3, 1)) + 2);
  // A plain line of prose, out of the fence. It is empty, so it also carries
  // the class that draws the gap between paragraphs at an em.
  assert.equal((await lineAt(h.page, head)).className, "cm-line mdm-blank");
  await h.page.keyboard.type("New.");
  assert.equal(await docText(h.page), "Intro.\n\n```python\nx = 1\n```\n\nNew.\n\nAfter.\n");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("ArrowDown from the line above a hidden equation puts the caret inside it", { skip }, async () => {
  const h = await open({ text: MATH, scores: 0 });
  await setSelection(h.page, 3);
  await h.page.keyboard.press("ArrowDown");
  assert.deepEqual(await selectionRanges(h.page), [[8, 8]]);
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 0);
  await h.page.keyboard.press("ArrowDown");
  assert.deepEqual(await selectionRanges(h.page), [[9, 9]]);
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 3);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test(
  "ArrowUp from below a hidden equation steps onto the blank line, then into its last line",
  { skip },
  async () => {
    const h = await open({ text: MATH, scores: 0 });
    await setSelection(h.page, await posOf(h.page, "After"));
    await h.page.keyboard.press("ArrowUp");
    assert.deepEqual(await selectionRanges(h.page), [[31, 31]]);
    await h.page.keyboard.press("ArrowUp");
    assert.deepEqual(await selectionRanges(h.page), [[await posOf(h.page, "$$", 0, 1), await posOf(h.page, "$$", 0, 1)]]);
    assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 3);
    assert.deepEqual(h.errors, []);
    await h.close();
  }
);

test("a click on a rendered equation or score opens it at the start of its source", { skip }, async () => {
  const h = await open({});
  const math = await h.page.evaluate(() => {
    const r = document.querySelector("#app .mdm-math--block").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await h.page.mouse.click(math.x, math.y);
  assert.deepEqual(await selectionRanges(h.page), [[await posOf(h.page, "y(x,t) = \\sum"), await posOf(h.page, "y(x,t) = \\sum")]]);
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 5);
  const score = await h.page.evaluate(() => {
    const r = document.querySelector("#app .mdm-score code.language-abc svg").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await h.page.mouse.click(score.x, score.y);
  const at = await posOf(h.page, "%%stretchlast");
  assert.deepEqual(await selectionRanges(h.page), [[at, at]]);
  assert.equal(await count(h.page, ".cm-line.mdm-math-line"), 0);
  assert.ok((await count(h.page, ".cm-line.mdm-code-line.mdm-src-line")) > 0);
  assert.equal(await count(h.page, ".mdm-score"), 3);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- Code chrome ----

test("a code block carries a copy button, and nothing else, on hover", { skip }, async () => {
  const h = await open({ text: CODE, scores: 0 });
  assert.equal(await count(h.page, ".cm-line.mdm-code-line"), 1);
  assert.equal(await count(h.page, ".cm-line.mdm-fence-line"), 0);
  // The corner used to name the language as well ("python", beside the
  // button); the chrome is the button alone now.
  const chrome = await h.page.evaluate(() => {
    const c = document.querySelector("#app .cm-line.mdm-code-line span.mdm-chrome.mdm-chrome--code");
    return c
      ? {
          text: c.textContent,
          copy: !!c.querySelector(".mdm-copy"),
          shown: c.classList.contains("mdm-chrome--show"),
        }
      : null;
  });
  assert.deepEqual(chrome, { text: "", copy: true, shown: false });
  const over = await coordsAt(h.page, (await posOf(h.page, "x = 1")) + 2);
  await h.page.mouse.move(over.x, over.y);
  await sleep(100);
  assert.equal(await count(h.page, ".mdm-chrome--code.mdm-chrome--show"), 1);
  const away = await coordsAt(h.page, 2);
  await h.page.mouse.move(away.x, away.y);
  await sleep(100);
  assert.equal(await count(h.page, ".mdm-chrome--code.mdm-chrome--show"), 0);
  // A caret in the block shows the fences.
  await setSelection(h.page, await posOf(h.page, "x = 1"));
  assert.equal(await count(h.page, ".cm-line.mdm-fence-line"), 2);
  assert.equal(await count(h.page, ".cm-line.mdm-code-line"), 3);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A line box must not drift from CodeMirror's height map, or a click and a
// vertical caret move land on the wrong line. Heading lines used to carry a
// top margin, which the height map does not see (it measures the line box):
// every line below a heading sat lower on screen than the map believed, so a
// click on the lower half of a paragraph fell through to the line beneath it.
// The fix draws the spacing with padding, which is inside the box. This holds
// the invariant: for every line, the painted top equals the mapped top.
test("no line drifts from the height map (a click lands on the line clicked)", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light", frontMatter: "hidden" } } });
  const drift = await h.page.evaluate(() => {
    const { view } = window.__mdm;
    const doc = view.state.doc;
    const contentTop =
      view.contentDOM.getBoundingClientRect().top + view.documentPadding.top;
    let worst = 0;
    let worstLine = 0;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      // The box CodeMirror hit-tests against is the .cm-line element. Its top
      // must match the height map; a margin (outside the box) shifts the
      // element without the map knowing, a padding (inside it) does not.
      let node = view.domAtPos(line.from).node;
      if (node.nodeType !== 1) node = node.parentElement;
      const el = node && node.closest ? node.closest(".cm-line") : null;
      if (!el) continue;
      const mapped = contentTop + view.lineBlockAt(line.from).top;
      const d = Math.abs(el.getBoundingClientRect().top - mapped);
      if (d > worst) {
        worst = d;
        worstLine = i;
      }
    }
    return { worst, worstLine };
  });
  // A pixel or two of rounding is fine; the margin bug drove this past 30.
  assert.ok(
    drift.worst <= 3,
    "line " + drift.worstLine + " drifts " + drift.worst + "px from the map"
  );
  // And a click just right of the end of a heading, and of the first paragraph
  // after it, lands the caret on that very line. The two lines are read off the
  // syntax tree rather than matched by their words: example.mdm is written and
  // rewritten by hand and the wording drifts.
  const numbers = await h.page.evaluate(() => {
    const { view, CM } = window.__mdm;
    const doc = view.state.doc;
    let heading = 0;
    let para = 0;
    CM.syntaxTree(view.state).iterate({
      enter(n) {
        if (!heading) {
          if (/^ATXHeading[1-6]$/.test(n.name)) heading = doc.lineAt(n.from).number;
          return;
        }
        if (!para && n.name === "Paragraph") para = doc.lineAt(n.from).number;
      },
    });
    return [heading, para];
  });
  assert.ok(numbers[0] && numbers[1], "no heading with a paragraph under it: " + numbers);
  for (const number of numbers) {
    await setSelection(h.page, 0);
    await sleep(60);
    const to = await h.page.evaluate((n) => {
      const { view } = window.__mdm;
      const line = view.state.doc.line(n);
      const c = view.coordsAtPos(line.to, -1);
      return { line: n, x: c.right, y: (c.top + c.bottom) / 2 };
    }, number);
    await h.page.mouse.click(to.x + 40, to.y);
    await sleep(80);
    const landed = await h.page.evaluate(
      () => window.__mdm.view.state.doc.lineAt(window.__mdm.view.state.selection.main.head).number
    );
    assert.equal(landed, to.line, "a click near line " + to.line + " missed it");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The outline is a panel down the left edge (as in the Vditor version, not a
// drop-down): its button leads the bar and toggles the panel, which lists the
// headings, marks the section the caret is in, jumps to the one picked and
// stays open while the document is navigated.
test("the outline panel lists the headings, marks the section and jumps", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light", frontMatter: "hidden" } } });
  // The button leads the toolbar.
  assert.equal(
    await h.page.evaluate(() =>
      document.querySelector("#app .mdm-toolbar__item button").getAttribute("data-type")
    ),
    "outline"
  );
  // Hidden until pressed.
  assert.equal(
    await h.page.evaluate(() =>
      getComputedStyle(document.querySelector("#app .mdm-outline")).display
    ),
    "none"
  );
  // The press asks the host and repaints nothing by itself.
  await h.page.click('#app button[data-type="outline"]');
  await sleep(150);
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "outline", value: "shown" },
  ]);
  assert.equal(
    await h.page.evaluate(() =>
      document.getElementById("app").classList.contains("mdm-outline--open")
    ),
    false,
    "the panel opened before the host answered"
  );
  await postSettings(h.page, { outline: "shown", theme: "light", frontMatter: "hidden" });
  await sleep(200);
  const panel = await h.page.evaluate(() => ({
    open: document.getElementById("app").classList.contains("mdm-outline--open"),
    display: getComputedStyle(document.querySelector("#app .mdm-outline")).display,
    width: Math.round(document.querySelector("#app .mdm-outline").getBoundingClientRect().width),
    btnOn: document.querySelector('#app button[data-type="outline"]').classList.contains("mdm-btn--on"),
    rows: Array.from(document.querySelectorAll("#app .mdm-outline__row")).map((r) => r.textContent),
  }));
  assert.equal(panel.open, true);
  assert.equal(panel.display, "block");
  assert.ok(panel.width >= 240, "the panel is a side column, was " + panel.width + "px");
  assert.equal(panel.btnOn, true);
  assert.deepEqual(panel.rows, [
    "From equations to score",
    "From code to scores",
    "From score to sound",
  ]);
  // The caret in the second section marks it.
  await h.page.evaluate(() => {
    const { view } = window.__mdm;
    const at = view.state.doc.toString().indexOf("From code to scores");
    view.dispatch({ selection: { anchor: at + 5 } });
  });
  await sleep(120);
  assert.equal(
    await h.page.evaluate(() =>
      Array.from(document.querySelectorAll("#app .mdm-outline__row")).findIndex((r) =>
        r.className.includes("current")
      )
    ),
    1,
    "the section in view is not marked"
  );
  // A pick does not merely bring the heading into view: it pulls it up to the
  // top of the pane, so the section starts where the eye already is. Read on
  // the middle heading, which has document enough under it to fill the pane.
  const landing = async (nth) => {
    await h.page.click("#app .mdm-outline__row:nth-child(" + nth + ")");
    await sleep(250);
    return h.page.evaluate(() => {
      const { view } = window.__mdm;
      const head = view.state.selection.main.head;
      const pane = view.scrollDOM;
      const box = pane.getBoundingClientRect();
      return {
        text: view.state.doc.lineAt(head).text,
        top: Math.round(view.coordsAtPos(head).top - box.top),
        bottomed: pane.scrollTop >= pane.scrollHeight - pane.clientHeight - 2,
        open: document.getElementById("app").classList.contains("mdm-outline--open"),
      };
    });
  };
  const middle = await landing(2);
  assert.equal(middle.text, "## From code to scores");
  assert.equal(middle.open, true, "the panel closed after a pick");
  assert.ok(!middle.bottomed, "the pane ran to its end on a heading with room under it");
  assert.ok(
    middle.top >= 0 && middle.top <= 24,
    "the heading landed " + middle.top + "px from the top of the pane, not at it"
  );
  // Picking the last heading jumps there and leaves the panel open. There is
  // not enough document under it to fill the pane, so the scroll clamps: the
  // heading lands as high as it can and the document ends at the bottom edge,
  // which is the whole of what "as high as it can" means here.
  const last = await landing(3);
  assert.equal(last.text, "## From score to sound");
  assert.equal(last.open, true, "the panel closed after a pick");
  assert.ok(
    last.bottomed || (last.top >= 0 && last.top <= 24),
    "the last heading neither reached the top nor ran the pane to its end"
  );
  // A document with no headings shows the empty note.
  await h.page.evaluate(() =>
    window.__mdm.view.dispatch({
      changes: { from: 0, to: window.__mdm.view.state.doc.length, insert: "no headings here\n" },
    })
  );
  await sleep(120);
  assert.equal(
    await h.page.evaluate(() => {
      const e = document.querySelector("#app .mdm-outline__empty");
      return e ? e.textContent : null;
    }),
    "No headings"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Inline maths shows a live render beside its source while the caret is in it,
// the way the Vditor editor did: with the caret off it, a rendered widget
// replaces the source; with the caret in it the source stays and, once the
// LaTeX compiles, the render appears just after the closing delimiter; while
// it does not compile the source stands alone.
test("inline maths shows a live preview beside the source while editing", { skip }, async () => {
  const h = await open({
    text: "Here is $f_n = n f_1$ inline.\n",
    scores: 0,
    seed: { settings: { frontMatter: "hidden" } },
  });
  await h.page.evaluate(() => window.__mdm.view.focus());
  // Caret off it: a rendered widget, no source, no preview.
  await h.page.evaluate(() => window.__mdm.view.dispatch({ selection: { anchor: 0 } }));
  await sleep(150);
  assert.deepEqual(
    await h.page.evaluate(() => ({
      rendered: document.querySelectorAll("#app .mdm-math:not(.mdm-math--preview)").length,
      src: document.querySelectorAll("#app .mdm-math-src").length,
      preview: document.querySelectorAll("#app .mdm-math--preview").length,
    })),
    { rendered: 1, src: 0, preview: 0 }
  );
  // Caret inside: source shown and a compiled preview after it.
  await h.page.evaluate(() => {
    const at = window.__mdm.view.state.doc.toString().indexOf("f_n") + 1;
    window.__mdm.view.dispatch({ selection: { anchor: at } });
  });
  await sleep(200);
  const on = await h.page.evaluate(() => {
    const prev = document.querySelector("#app .mdm-math--preview");
    return {
      src: !!document.querySelector("#app .mdm-math-src"),
      preview: !!prev,
      katex: prev ? !!prev.querySelector(".katex") : false,
    };
  });
  assert.deepEqual(on, { src: true, preview: true, katex: true });
  // Break the LaTeX: the source stays (marked broken) and the preview goes.
  await h.page.evaluate(() => {
    const at = window.__mdm.view.state.doc.toString().indexOf("f_n") + 1;
    window.__mdm.view.dispatch({ changes: { from: at, insert: "\\zq{" } });
  });
  await sleep(200);
  const broken = await h.page.evaluate(() => ({
    src: !!document.querySelector("#app .mdm-math-src"),
    broken: !!document.querySelector("#app .mdm-math-src.mdm-math--broken"),
    preview: !!document.querySelector("#app .mdm-math--preview"),
  }));
  assert.deepEqual(broken, { src: true, broken: true, preview: false });
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Outside the text column there is no document: the strip of pane either side
// of it is dead, and the pointer says so before a click is made. What made it
// worth spelling out is that CodeMirror listens on its scroller, so the strip
// used to answer a click like any other part of the pane, and not even
// consistently: the box of .cm-content stood 50px out from the text, and over
// a block widget a click inside that invisible edge opened the score's source
// while one a finger's width further out landed on the line after the block.
// The box is now the column itself, so the boundary the pointer changes at and
// the boundary a click stops at are the same one (main.js, style.css).
const MARGINS = [
  "Short line.",
  "",
  "A second paragraph, somewhere quiet for the caret to go back to.",
  "",
  "```python",
  "x = 1",
  "```",
  "",
  "```abc",
  "X:1",
  "K:C",
  "CDEF|",
  "```",
  "",
  "Tail.",
  "",
].join("\n");

// The one thing a click out in the dead margin does: put away whatever is open
// for editing. A caret in a fenced block or in an equation carries its source,
// and the click takes the caret out of it, so the drawing comes back, the way a
// click in the text below it would leave things.
const DISMISS = [
  "A paragraph with $x^2 + y^2$ inside it, and words after the equation.",
  "",
  "$$",
  "e^{i\\pi} + 1 = 0",
  "$$",
  "",
  "```python",
  "x = 1",
  "```",
  "",
  "```abc",
  "X:1",
  "K:C",
  "CDEF|",
  "```",
  "",
  "Tail paragraph.",
  "",
].join("\n");

// The same, ending at the score: there is no line after the block for the
// caret to take, so it goes to the one above instead.
const DISMISS_AT_END = ["Text above.", "", "```abc", "X:1", "K:C", "CDEF|", "```"].join(
  "\n"
);

test("a click outside the text puts away what is open for editing", { skip }, async () => {
  const h = await open({ text: DISMISS, withFrontMatter: false, scores: 1 });
  await h.page.setViewport({ width: 1400, height: 1200 });
  await sleep(400);
  const margin = await h.page.evaluate(() => {
    const c = window.__mdm.view.contentDOM.getBoundingClientRect();
    return { x: c.right + 60, y: c.top + 20 };
  });
  // What is open: the source lines of a score or a display equation, the
  // fences a code block shows only while a caret is in it, and the source of
  // an inline equation.
  const shown = () =>
    h.page.evaluate(() => ({
      source: document.querySelectorAll("#app .cm-line.mdm-src-line").length,
      fences: document.querySelectorAll("#app .cm-line.mdm-fence-line").length,
      inline: document.querySelectorAll("#app .mdm-math-src").length,
    }));
  const cases = [
    { name: "an inline equation", needle: "x^2", open: (v) => v.inline > 0 },
    { name: "a display equation", needle: "e^{i", open: (v) => v.source > 0 },
    { name: "a code block", needle: "x = 1", open: (v) => v.fences > 0 },
    { name: "a score", needle: "CDEF", open: (v) => v.source > 0 },
  ];
  for (const one of cases) {
    const at = await posOf(h.page, one.needle, 1);
    await setSelection(h.page, at);
    await sleep(250);
    const before = await shown();
    assert.ok(one.open(before), one.name + " never opened: " + JSON.stringify(before));
    await h.page.mouse.click(margin.x, margin.y);
    await sleep(250);
    assert.deepEqual(
      await shown(),
      { source: 0, fences: 0, inline: 0 },
      one.name + " stayed open after a click in the margin"
    );
    const head = await h.page.evaluate(
      () => window.__mdm.view.state.selection.main.head
    );
    assert.ok(head !== at, one.name + " left the caret where it was");
  }
  // Not only the margin: the outline, the toolbar and its buttons are outside
  // the text too, and a click on any of them puts the block away before it is
  // answered by whatever it was for.
  const elsewhere = [
    ["the outline panel", "#app .mdm-outline__title"],
    ["a toolbar button", '#app button[data-type="mdm-theme"]'],
    ["the toolbar itself", "#app .mdm-toolbar"],
  ];
  await pressOutline(h.page, true);
  for (const [name, selector] of elsewhere) {
    await setSelection(h.page, await posOf(h.page, "CDEF", 1));
    await sleep(250);
    assert.ok((await shown()).source > 0, "the score never opened for " + name);
    const box = await h.page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, selector);
    await h.page.mouse.click(box.x, box.y);
    await sleep(250);
    assert.deepEqual(
      await shown(),
      { source: 0, fences: 0, inline: 0 },
      "the score stayed open after a click on " + name
    );
  }
  await pressOutline(h.page, false);

  // Nothing open: the margin does nothing at all, not even move the caret.
  await setSelection(h.page, 2);
  await sleep(150);
  await h.page.mouse.click(margin.x, margin.y);
  await sleep(200);
  assert.equal(
    await h.page.evaluate(() => window.__mdm.view.state.selection.main.head),
    2,
    "the margin moved the caret with nothing open"
  );

  // A block that ends the document has no line after it: the caret takes the
  // one above. Left where the old gutter handler put it, the start of the
  // block's own first line, the block counted as touched and stayed open.
  await update(h.page, DISMISS_AT_END, false, 1);
  await sleep(300);
  const inScore = await posOf(h.page, "CDEF", 1);
  await setSelection(h.page, inScore);
  await sleep(250);
  assert.ok((await shown()).source > 0, "the score at the end never opened");
  await h.page.mouse.click(margin.x, margin.y);
  await sleep(250);
  assert.deepEqual(
    await shown(),
    { source: 0, fences: 0, inline: 0 },
    "a score ending the document stayed open"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a click that closes a block, or lands on a drawing, keeps the other carets", { skip }, async () => {
  const h = await open({ text: DISMISS, withFrontMatter: false, scores: 1 });
  await h.page.setViewport({ width: 1400, height: 1200 });
  await sleep(400);
  const drawing = () =>
    h.page.evaluate(() => {
      const svg = document.querySelector("#app .mdm-score code.language-abc svg");
      const r = svg.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  const srcLines = () =>
    h.page.evaluate(
      () => document.querySelectorAll("#app .cm-line.mdm-src-line").length
    );

  // Two carets out in the prose, and the score clicked with the multicursor
  // modifier down: the caret at its source is ADDED. Replacing the selection
  // here, which is what it used to do, wiped both of them.
  const first = await posOf(h.page, "paragraph");
  const tail = await posOf(h.page, "Tail");
  await setSelection(h.page, [{ anchor: first }, { anchor: tail }]);
  await sleep(250);
  const score = await drawing();
  await h.page.keyboard.down("Alt");
  await h.page.mouse.click(score.x, score.y);
  await h.page.keyboard.up("Alt");
  await sleep(250);
  const added = await selectionRanges(h.page);
  assert.equal(added.length, 3, "the drawing swallowed the other carets");
  assert.deepEqual(added[0], [first, first]);
  assert.deepEqual(added[2], [tail, tail]);
  assert.ok((await srcLines()) > 0, "the score never opened at its source");

  // Without the modifier it still replaces them: a plain click means "put the
  // caret here", as it does anywhere else in the document.
  await sleep(600); // two clicks in a row on one spot read as a double
  const again = await drawing();
  await h.page.mouse.click(again.x, again.y);
  await sleep(250);
  assert.equal((await selectionRanges(h.page)).length, 1);

  // And the click that closes an open block moves the caret that is in it,
  // not the ones that are not: three carets, one of them inside the code
  // block, used to come back as the single caret that left the block.
  const margin = await h.page.evaluate(() => {
    const c = window.__mdm.view.contentDOM.getBoundingClientRect();
    return { x: c.right + 60, y: c.top + 20 };
  });
  const inCode = await posOf(h.page, "x = 1");
  await setSelection(h.page, [
    { anchor: first },
    { anchor: inCode },
    { anchor: tail },
  ]);
  await sleep(250);
  await h.page.mouse.click(margin.x, margin.y);
  await sleep(250);
  const kept = await selectionRanges(h.page);
  assert.equal(kept.length, 3, "the margin swallowed the other carets");
  assert.deepEqual(kept[0], [first, first]);
  assert.deepEqual(kept[2], [tail, tail]);
  assert.notDeepEqual(kept[1], [inCode, inCode], "the caret never left the block");
  assert.equal(
    await h.page.evaluate(
      () => document.querySelectorAll("#app .cm-line.mdm-fence-line").length
    ),
    0,
    "the code block stayed open"
  );

  // The margin took the focus with the click, which is what draws the
  // document with nobody in it; what it did not do is forget the carets.
  assert.equal(
    await h.page.evaluate(() => window.__mdm.view.hasFocus),
    false,
    "the margin left the document focused"
  );

  // All three still edit, once somebody is in the document again.
  await h.page.evaluate(() => window.__mdm.view.focus());
  await sleep(150);
  const before = await docText(h.page);
  await h.page.keyboard.type("Z");
  await sleep(200);
  const after = await docText(h.page);
  assert.equal(
    after.split("Z").length - before.split("Z").length,
    3,
    "typing did not land at every caret"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Visual mode. What a caret reveals hangs on the selection, and a selection
// outlives the focus: a click on the bare part of the toolbar took the focus
// away and the heading went on showing its `##`, with no caret left in it to
// account for them.
const VISUAL = [
  "## From equations to score",
  "",
  "A paragraph with **bold** and $x^2$ in it.",
  "",
  "$$",
  "e^{i\\pi} + 1 = 0",
  "$$",
  "",
  "```python",
  "x = 1",
  "```",
  "",
  "```abc",
  "X:1",
  "K:C",
  "CDEF|",
  "```",
  "",
  "Tail.",
  "",
].join("\n");

test("a click off the text puts the document in visual mode", { skip }, async () => {
  const h = await open({ text: VISUAL, withFrontMatter: false, scores: 1 });
  await h.page.setViewport({ width: 1400, height: 1200 });
  await sleep(400);

  // The document as it looks from outside: the marks that only show under a
  // caret, and whether a caret is drawn at all.
  const look = () =>
    h.page.evaluate(() => {
      const v = window.__mdm.view;
      const lines = Array.from(document.querySelectorAll("#app .cm-line")).map(
        (l) => l.textContent
      );
      return {
        focus: v.hasFocus,
        head: v.state.selection.main.head,
        heading: lines.some((t) => t.indexOf("## ") === 0),
        bold: lines.some((t) => t.indexOf("**") !== -1),
        fences: document.querySelectorAll("#app .cm-line.mdm-fence-line").length,
        source: document.querySelectorAll("#app .cm-line.mdm-src-line").length,
        inline: document.querySelectorAll("#app .mdm-math-src").length,
        carets: Array.from(document.querySelectorAll("#app .cm-cursor")).filter(
          (c) => getComputedStyle(c).display !== "none"
        ).length,
      };
    });

  const margin = await h.page.evaluate(() => {
    const c = window.__mdm.view.contentDOM.getBoundingClientRect();
    return { x: c.right + 60, y: c.top + 20 };
  });
  // The bare strip of the bar, past the last button.
  const bare = await h.page.evaluate(() => {
    const bar = document.querySelector("#app .mdm-toolbar").getBoundingClientRect();
    const items = document.querySelectorAll("#app .mdm-toolbar__item");
    const last = items[items.length - 1].getBoundingClientRect();
    return { x: (last.right + bar.right) / 2, y: bar.top + bar.height / 2 };
  });

  // A caret in the heading shows its `##`, the case this was reported from.
  const inHeading = await posOf(h.page, "From equations", 4);
  await setSelection(h.page, inHeading);
  await sleep(250);
  const open1 = await look();
  assert.ok(open1.heading, "the heading never showed its marks");
  assert.equal(open1.carets, 1, "no caret was drawn in the heading");

  await h.page.mouse.click(margin.x, margin.y);
  await sleep(250);
  const away = await look();
  assert.equal(away.focus, false, "the margin left the document focused");
  assert.equal(away.heading, false, "the heading kept its marks with nobody in it");
  assert.equal(away.carets, 0, "a caret was still drawn with nobody in it");
  assert.equal(away.head, inHeading, "the margin moved the caret out of the heading");

  // And back: the same caret, the same marks. Nothing was thrown away.
  const back = await coordsAt(h.page, inHeading);
  await h.page.mouse.click(back.x, back.y);
  await sleep(250);
  const again = await look();
  assert.equal(again.focus, true, "the click back never focused the document");
  assert.ok(again.heading, "the marks never came back");

  // The bare part of the bar is outside the text as much as the margin is.
  const inBold = await posOf(h.page, "bold", 1);
  await setSelection(h.page, inBold);
  await sleep(250);
  assert.ok((await look()).bold, "the bold never showed its marks");
  await h.page.mouse.click(bare.x, bare.y);
  await sleep(250);
  const afterBar = await look();
  assert.equal(afterBar.focus, false, "the bare bar left the document focused");
  assert.equal(afterBar.bold, false, "the bold kept its marks with nobody in it");

  // Leaving the window is not leaving the document. The focus stays on the
  // element while the desktop hands the window over, so an Alt+Tab away and
  // back finds the document exactly as it was left, open block and all.
  for (const one of [
    { name: "an inline equation", needle: "x^2", open: (v) => v.inline > 0 },
    { name: "a display equation", needle: "e^{i", open: (v) => v.source > 0 },
    { name: "a code block", needle: "x = 1", open: (v) => v.fences > 0 },
    { name: "a score", needle: "CDEF", open: (v) => v.source > 0 },
  ]) {
    const at = await posOf(h.page, one.needle, 1);
    await setSelection(h.page, at);
    await sleep(250);
    assert.ok(one.open(await look()), one.name + " never opened");
    const other = await h.browser.newPage();
    await other.bringToFront();
    await sleep(300);
    assert.ok(one.open(await look()), one.name + " was put away with the window gone");
    await other.close();
    await h.page.bringToFront();
    await sleep(300);
    const back2 = await look();
    assert.ok(one.open(back2), one.name + " never came back");
    assert.equal(back2.head, at, one.name + " came back with the caret moved");
  }

  // And the same if the focus is taken off the text as the window goes: a
  // blur nobody in the page asked for is not somebody leaving the document.
  const inScore = await posOf(h.page, "CDEF", 1);
  await setSelection(h.page, inScore);
  await sleep(250);
  assert.ok((await look()).source > 0, "the score never opened");
  await h.page.evaluate(() => document.activeElement.blur());
  await sleep(300);
  const dropped = await look();
  assert.equal(dropped.focus, false, "the blur never landed");
  assert.ok(dropped.source > 0, "a blur nobody asked for put the score away");
  assert.equal(dropped.head, inScore, "a blur nobody asked for moved the caret");

  assert.deepEqual(h.errors, []);
  await h.close();
});

test("the margins beside the text are dead, and the pointer says so", { skip }, async () => {
  const h = await open({ text: MARGINS, withFrontMatter: false, scores: 1 });
  // A wide pane, so there is a real margin beside the 820px column.
  await h.page.setViewport({ width: 1400, height: 1000 });
  await sleep(400);
  // The heights to probe at: a short paragraph line, a line of code, and the
  // score, a block widget with no text of its own.
  const spots = await h.page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll("#app .cm-line"));
    const mid = (el) => {
      const r = el.getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    };
    const para = lines.find((l) => l.textContent === "Short line.");
    // The chrome of a code block (its language tag and copy button) is an
    // inline widget in the first line, so that line's text reads "pythonx = 1".
    const code = lines.find(
      (l) => l.classList.contains("mdm-code-line") && l.textContent.endsWith("x = 1")
    );
    const score = document.querySelector("#app .mdm-score");
    const view = window.__mdm.view;
    const content = view.contentDOM.getBoundingClientRect();
    const column = para.getBoundingClientRect();
    const scroller = view.scrollDOM.getBoundingClientRect();
    return {
      para: mid(para),
      code: mid(code),
      score: mid(score),
      content: { left: content.left, right: content.right },
      column: { left: column.left, right: column.right },
      scroller: { left: scroller.left, right: scroller.right },
      cursorContent: getComputedStyle(view.contentDOM).cursor,
      cursorScroller: getComputedStyle(view.scrollDOM).cursor,
    };
  });
  // One boundary for the two: what the pointer changes at is the edge of the
  // live area, and both are the edge of the text.
  assert.equal(spots.cursorContent, "text", "the text lost its I-beam");
  assert.equal(spots.cursorScroller, "default", "the margin does not show a pointer");
  assert.ok(
    Math.abs(spots.content.left - spots.column.left) < 1 &&
      Math.abs(spots.content.right - spots.column.right) < 1,
    "the live box is not the text column: " +
      JSON.stringify(spots.content) +
      " vs " +
      JSON.stringify(spots.column)
  );

  const caretAfterClick = async (x, y) => {
    await setSelection(h.page, 0);
    await sleep(120);
    await h.page.evaluate(() => document.activeElement.blur());
    await sleep(60);
    await h.page.mouse.click(x, y);
    await sleep(160);
    return h.page.evaluate(() => ({
      head: window.__mdm.view.state.selection.main.head,
      focus: window.__mdm.view.hasFocus,
      src: document.querySelectorAll("#app .mdm-src-line").length,
    }));
  };

  // Inside the column, a hair from its edge: the click lands, so nothing below
  // can pass by everything being dead.
  for (const where of ["para", "code"]) {
    const live = await caretAfterClick(spots.column.right - 8, spots[where]);
    assert.ok(live.head > 0, "a click inside the column did nothing at the " + where);
    assert.equal(live.focus, true, "a click inside the column did not focus the editor");
  }
  const onScore = await caretAfterClick(spots.column.right - 8, spots.score);
  assert.ok(onScore.src > 0, "a click on the score did not open its source");

  // Out in either margin, from a hair past the text to the far edge of the
  // pane: no caret, no focus, and no score opened.
  const outside = [
    spots.column.right + 8,
    spots.column.right + 60,
    spots.scroller.right - 40,
    spots.column.left - 8,
    spots.column.left - 60,
    spots.scroller.left + 15,
  ];
  for (const where of ["para", "code", "score"]) {
    for (const x of outside) {
      const dead = await caretAfterClick(x, spots[where]);
      assert.deepEqual(
        dead,
        { head: 0, focus: false, src: 0 },
        "a click at x=" + Math.round(x) + " beside the " + where + " was answered"
      );
    }
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The outline is as wide as the user drags it. The grip is a strip over the
// panel's edge, a flex item of no width so it takes nothing from the row (a
// child of the panel would be clipped by its own scroll), and what it sets is
// a custom property on #app, in force for as long as the editor is open.
test("the outline panel is as wide as the grip is dragged", { skip }, async () => {
  const h = await open({ seed: { settings: { frontMatter: "hidden" } } });
  await h.page.setViewport({ width: 1200, height: 900 });
  await sleep(300);
  const gripShown = () =>
    h.page.evaluate(
      () => getComputedStyle(document.querySelector("#app .mdm-outline__grip")).display
    );
  const panel = () =>
    h.page.evaluate(() => {
      const r = document.querySelector("#app .mdm-outline").getBoundingClientRect();
      return { width: Math.round(r.width), edge: r.right };
    });
  // Closed, there is nothing to take hold of.
  assert.equal(await gripShown(), "none", "the grip shows with the panel closed");
  await pressOutline(h.page, true, { frontMatter: "hidden" });
  assert.equal(await gripShown(), "block", "the grip did not come with the panel");
  const open250 = await panel();
  assert.ok(
    Math.abs(open250.width - 250) <= 2,
    "the panel did not open at its 250px: " + open250.width
  );
  const drag = async (from, to) => {
    await h.page.mouse.move(from, 400);
    await h.page.mouse.down();
    await h.page.mouse.move(to, 400, { steps: 8 });
    await h.page.mouse.up();
    await sleep(150);
  };
  await drag(open250.edge, open250.edge + 120);
  const wider = await panel();
  assert.ok(
    Math.abs(wider.width - (open250.width + 120)) <= 3,
    "the panel did not follow the grip: " + wider.width
  );
  // Dragged past its floor it stops there, and the editor keeps a column of
  // its own however far the grip is pushed the other way.
  await drag(wider.edge, 10);
  const narrow = await panel();
  // A pixel of slack throughout: the box the test measures carries the
  // panel's border, the width the grip sets does not.
  assert.ok(
    Math.abs(narrow.width - 140) <= 2,
    "the panel went past its floor: " + narrow.width
  );
  await drag(narrow.edge, 1190);
  const widest = await panel();
  assert.ok(
    widest.width <= 1200 - 200 + 2,
    "the panel left the editor no room: " + widest.width
  );
  // Every drop leaves the width with the host, once per gesture and not once
  // per frame, and what it stores is the width the panel came to rest at.
  const stored = (await setSettingPosts(h.page)).filter((m) => m.key === "outlineWidth");
  assert.equal(stored.length, 3, "one write per drag: " + JSON.stringify(stored));
  assert.ok(
    Math.abs(stored[2].value - widest.width) <= 2,
    "the width stored is not the one on screen: " + stored[2].value
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// Ctrl+D matches whole words by default, like VS Code: "score" walks the
// standalone occurrences and steps over "scores". The toolbar toggle turns on
// substring matching, where "score" also lands inside "scores". Regression
// guard for the toggle the user asked for.
test("the Ctrl+D toggle switches whole-word matching to substring", { skip }, async () => {
  const h = await open({ text: "score and scores and a score here\n", scores: 0, seed: { settings: { frontMatter: "hidden" } } });
  await h.page.evaluate(() => window.__mdm.view.focus());
  const ranges = () => h.page.evaluate(() => window.__mdm.view.state.selection.ranges.map((r) => [r.from, r.to]));
  // Default: whole word. The "score" inside "scores" (10-16) is skipped.
  await h.page.evaluate(() => window.__mdm.view.dispatch({ selection: { anchor: 2 } }));
  await chord(h.page, ["Control"], "d");
  await chord(h.page, ["Control"], "d");
  await chord(h.page, ["Control"], "d");
  assert.deepEqual(await ranges(), [[0, 5], [23, 28]]);
  // The button carries a text for each state, naming what the click switches
  // to rather than the state in use, the way the staff, alignment and header
  // buttons do. It names the feature and not the chord: the key is one way of
  // reaching a multicursor and the button is another.
  const matchButton = () =>
    h.page.evaluate(() => {
      const b = document.querySelector('#app button[data-type="mdm-match-substring"]');
      return { tip: b.getAttribute("aria-label"), lit: b.classList.contains("mdm-btn--on") };
    });
  assert.deepEqual(await matchButton(), { tip: "Multicursor matches inside words", lit: false });
  // Toggle on. The press asks the host (mdm.multicursorMatch) and the button
  // lights when the value comes back, the way the rest of the bar works, so
  // the toggle is still on when the document is opened again.
  await h.page.click('#app button[data-type="mdm-match-substring"]');
  await sleep(150);
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "multicursorMatch", value: "substring" },
  ]);
  assert.equal((await matchButton()).lit, false, "lit before the host answered");
  await postSettings(h.page, { multicursorMatch: "substring", frontMatter: "hidden" });
  await sleep(200);
  await h.page.evaluate(() => window.__mdm.view.focus());
  assert.deepEqual(await matchButton(), { tip: "Multicursor matches whole words", lit: true });
  // Now the "score" inside "scores" is caught too.
  await h.page.evaluate(() => window.__mdm.view.dispatch({ selection: { anchor: 2 } }));
  await chord(h.page, ["Control"], "d");
  await chord(h.page, ["Control"], "d");
  await chord(h.page, ["Control"], "d");
  assert.deepEqual(await ranges(), [[0, 5], [10, 15], [23, 28]]);
  await h.page.keyboard.type("Q");
  assert.equal(await docText(h.page), "Q and Qs and a Q here\n");
  assert.deepEqual(h.errors, []);
  await h.close();
});
