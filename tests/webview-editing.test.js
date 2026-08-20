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
} = require("./webview/helpers.js");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  await setSelection(h.page, await posOf(h.page, "Other"));
  assert.equal(await count(h.page, "span.mdm-math .katex"), 1);
  assert.equal(await count(h.page, ".mdm-math-src"), 0);
  await setSelection(h.page, await posOf(h.page, "x^2"));
  assert.equal(await count(h.page, "span.mdm-math"), 0);
  assert.equal(await count(h.page, ".mdm-math-src"), 1);
  assert.equal((await lineAt(h.page, 0)).text, "Take $x^2$ here.");
  // Broken inline math keeps its source with the broken class.
  await h.page.keyboard.type("\\frac{");
  assert.equal(await count(h.page, ".mdm-math-src.mdm-math--broken"), 1);
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
  assert.equal((await lineAt(h.page, head)).className, "cm-line");
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

test("a python block names its language and shows the copy button on hover", { skip }, async () => {
  const h = await open({ text: CODE, scores: 0 });
  assert.equal(await count(h.page, ".cm-line.mdm-code-line"), 1);
  assert.equal(await count(h.page, ".cm-line.mdm-fence-line"), 0);
  const chrome = await h.page.evaluate(() => {
    const c = document.querySelector("#app .cm-line.mdm-code-line span.mdm-chrome.mdm-chrome--code");
    return c
      ? {
          lang: c.querySelector(".mdm-lang").textContent,
          copy: !!c.querySelector(".mdm-copy"),
          shown: c.classList.contains("mdm-chrome--show"),
        }
      : null;
  });
  assert.deepEqual(chrome, { lang: "python", copy: true, shown: false });
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
