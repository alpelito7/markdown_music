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
  clickAt,
  dblClickAt,
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

// ---- The pointer and the reveal ----

test("a click into an unfocused document puts a caret where it lands, not a range", { skip }, async () => {
  // The selection an untouched document carries sits at 0, inside the
  // heading. The press focuses the editor, which reveals the `# `, and the
  // heading's text used to move 65 px right between the two readings
  // CodeMirror makes of the same pointer, so the click came out as a range.
  const h = await open({ text: "# The Title Here\n\nSome text.\n", scores: 0 });
  const title = await posOf(h.page, "Title");
  await clickAt(h.page, title + 2);
  const ranges = await selectionRanges(h.page);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0][0], ranges[0][1], "a caret, not a range: " + JSON.stringify(ranges));
  assert.ok(ranges[0][0] >= title && ranges[0][0] <= title + 5, "in the word that was clicked");
  // And the marks are revealed once the button is up.
  assert.equal((await lineAt(h.page, title)).text.indexOf("# "), 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a wobble of the hand between press and release selects no more than it crosses", { skip }, async () => {
  // A drag of 3 px is a drag, and may take the one character it crosses, as
  // in any editor. What it must not do is take the 65 px the `## ` of the
  // heading moved the word by when the press revealed it: that used to
  // select most of the word under a pointer that had barely moved.
  const h = await open({ text: "## Some Title Here\n\nAnd a line.\n", scores: 0 });
  await setSelection(h.page, 24); // the caret elsewhere, the heading at rest
  const title = await posOf(h.page, "Title");
  await clickAt(h.page, title + 2, { move: 3 });
  const ranges = await selectionRanges(h.page);
  assert.equal(ranges.length, 1);
  const [from, to] = ranges[0];
  assert.ok(to - from <= 1, "at most one character: " + JSON.stringify(ranges));
  assert.ok(from >= title && to <= title + 5, "inside the word that was pressed: " + JSON.stringify(ranges));
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a double click selects the word under the pointer, hidden marks and all", { skip }, async () => {
  // The first press reveals the marks and the text moves; the second is
  // read against the word the first put the caret in, not against the
  // pointer, which has not moved but stands over a different character now.
  const h = await open({ text: "## Some Title\n\nA **bold** word here.\n", scores: 0 });
  const title = await posOf(h.page, "Title");
  await dblClickAt(h.page, title + 2);
  assert.deepEqual(await selectionRanges(h.page), [[title, title + 5]]);
  const bold = await posOf(h.page, "bold");
  await dblClickAt(h.page, bold + 2);
  assert.deepEqual(await selectionRanges(h.page), [[bold, bold + 4]]);
  // On a run of punctuation the double click takes the run, as CodeMirror's
  // own does, and not nothing.
  await dblClickAt(h.page, bold - 1);
  assert.deepEqual(await selectionRanges(h.page), [[bold - 2, bold]]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a triple click selects the line under the pointer, line break included", { skip }, async () => {
  const h = await open({ text: "## Some Title\n\nA **bold** word here.\n", scores: 0 });
  const word = await posOf(h.page, "word");
  await clickAt(h.page, word + 1, { count: 3 });
  const line = await h.page.evaluate((pos) => {
    const l = window.__mdm.view.state.doc.lineAt(pos);
    return [l.from, l.to];
  }, word);
  assert.deepEqual(await selectionRanges(h.page), [[line[0], line[1] + 1]]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a caption drawn again when its marks go, though the words are the same", { skip }, async () => {
  // The caption is inline content now, so two figures can draw the same
  // words from different sources (`![*a* b]` and `![a b]`). CodeMirror
  // keeps the DOM of a widget that says it is equal to the new one, so the
  // figure is told apart by the alt as written and not by the words it
  // draws; comparing the words left the emphasis on screen after it was
  // deleted from the file.
  const base = "file://" + path.resolve(__dirname, "../vscode-mdm/media") + "/";
  const h = await open({ text: "![*a* b](icon.png)\n", scores: 0, seed: { docBase: base } });
  const caption = () =>
    h.page.evaluate(() => {
      const c = document.querySelector("#app .mdm-figcaption");
      return c ? c.innerHTML : null;
    });
  await sleep(200);
  assert.equal(await caption(), "<em>a</em> b");
  await update(h.page, "![a b](icon.png)\n", true, 0);
  await sleep(200);
  assert.equal(await caption(), "a b", "the emphasis stayed on screen after it left the file");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- Links by definition ----

test("a definition typed below turns the brackets above into a link, and its loss turns them back", { skip }, async () => {
  // `[foo]` is a link only while a `[foo]: url` line exists (links.js in
  // vendor-src reads the definitions once per parse). The parse of an edit
  // keeps the fragments of the tree the edit did not touch, so a definition
  // typed under a paragraph left the `[foo]` above it as text: the editor
  // starts the parse over when the set of definitions changes. The filler
  // keeps the paragraph more than 128 characters from the edit: closer than
  // that CodeMirror keeps no fragment at all (TreeFragment.applyChanges and
  // its minGap), and the test would pass with nothing started over.
  const filler = Array.from({ length: 40 }, () => "Filler.").join(" ");
  const h = await open({ text: "See [foo] here.\n\n" + filler + "\n\nEnd.\n", scores: 0 });
  const links = () =>
    h.page.evaluate(() => Array.from(document.querySelectorAll("#app .cm-line .mdm-link")).map((e) => e.textContent));
  assert.deepEqual(await links(), [], "text with no definition");
  const end = await h.page.evaluate(() => window.__mdm.view.state.doc.length);
  await setSelection(h.page, end);
  await h.page.keyboard.type("\n[foo]: https://foo.example");
  await sleep(400);
  // The brackets hidden: the caret is on the definition, not on the link.
  assert.deepEqual(await links(), ["foo"], "a link once its definition is typed");
  const text = await docText(h.page);
  const from = text.indexOf("[foo]: https://foo.example");
  await setSelection(h.page, [{ anchor: from, head: text.length }]);
  await h.page.keyboard.press("Backspace");
  await sleep(400);
  assert.deepEqual(await links(), [], "text again once the definition is gone");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- Enter ----

// Each document is opened afresh: the harness answers no `applied`, so an
// `update` posted after a press would be merged with the press still
// unconfirmed, which is the sync doing its job and not what these test.
async function enterOn(text, pos) {
  const h = await open({ text, scores: 0 });
  await setSelection(h.page, pos);
  await h.page.keyboard.press("Enter");
  const out = await docText(h.page);
  assert.deepEqual(h.errors, []);
  await h.close();
  return out;
}

test("Enter beside a no-break space keeps it, on either side", { skip }, async () => {
  // CodeMirror's newline took whitespace with \s, which is U+00A0 too: the
  // space of "Op. 27" went with the press. CommonMark and Pandoc both read
  // it as content, and print it.
  const nbsp = "\u00a0";
  assert.equal(await enterOn("Op." + nbsp + "27 was written.\n", 4), "Op." + nbsp + "\n27 was written.\n");
  assert.equal(await enterOn("Op." + nbsp + "27 was written.\n", 3), "Op.\n" + nbsp + "27 was written.\n");
  // The spaces and tabs after the caret still go with the press, and the
  // indentation of the line is carried on, as before.
  assert.equal(await enterOn("  two   words\n", 5), "  two\n  words\n");
});

test("Enter on a line of one no-break space keeps the line", { skip }, async () => {
  // A line of U+00A0 is a paragraph to both readers (blank is spaces and
  // tabs alone), and used to be read as blank: the character was deleted,
  // or written back as an ASCII space through the indent.
  const nbsp = "\u00a0";
  assert.equal(await enterOn(nbsp + "\nAfter.\n", 1), nbsp + "\n\nAfter.\n");
  assert.equal(await enterOn(nbsp + "\nAfter.\n", 0), "\n" + nbsp + "\nAfter.\n");
  // Whereas a line of spaces alone is blank, and Enter at its end takes
  // them over to the new line.
  assert.equal(await enterOn("   \nAfter.\n", 3), "\n   \nAfter.\n");
});

test("Enter in a list item keeps a no-break space and carries the list on", { skip }, async () => {
  const nbsp = "\u00a0";
  assert.equal(await enterOn("- Op." + nbsp + "\n", 6), "- Op." + nbsp + "\n- \n");
  // An item of one no-break space is not an empty item.
  assert.equal(await enterOn("- " + nbsp + "\n", 3), "- " + nbsp + "\n- \n");
  // And the list gestures: a new numbered item; an empty item unmade with
  // a blank line put before the caret's line, whether it is the second
  // item or a later one (lang-markdown loosened a tight list of two first,
  // which P4 of the branch took out: see the drills below); a quote carried
  // on.
  assert.equal(await enterOn("1. one\n", 6), "1. one\n2. \n");
  assert.equal(await enterOn("1. one\n2. two\n3. \n", 17), "1. one\n2. two\n\n\n");
  assert.equal(await enterOn("1. one\n2. \n", 10), "1. one\n\n\n");
  assert.equal(await enterOn("> quoted\n", 8), "> quoted\n> \n");
});

// ---- The editing drills of the bench (section 22), Enter and deletion ----

// Presses `keys` (names, {type: text} or {chord: [modifiers], key}) with
// the caret at `pos`, or with the carets or ranges of `pos` when it is a
// list, and hands back the text, the head of the main selection and
// whether the editor still has the focus.
async function pressOn(text, pos, keys) {
  const h = await open({ text, scores: 0 });
  await setSelection(h.page, Array.isArray(pos) ? pos.map((p) => (typeof p === "number" ? { anchor: p } : p)) : pos);
  for (const key of keys) {
    if (typeof key === "string") await h.page.keyboard.press(key);
    else if (key.chord) await chord(h.page, key.chord, key.key);
    else await h.page.keyboard.type(key.type);
  }
  const out = await docText(h.page);
  const head = await h.page.evaluate(() => window.__mdm.view.state.selection.main.head);
  const focused = await h.page.evaluate(() => window.__mdm.view.hasFocus);
  const ranges = await selectionRanges(h.page);
  assert.deepEqual(h.errors, []);
  await h.close();
  return { text: out, head, focused, ranges };
}

// The toolbar button `name` pressed `times` times with the selection at
// `pos`, as pressOn takes it.
async function buttonOn(text, pos, name, times) {
  const h = await open({ text, scores: 0 });
  await setSelection(h.page, Array.isArray(pos) ? pos.map((p) => (typeof p === "number" ? { anchor: p } : p)) : pos);
  for (let i = 0; i < (times || 1); i++) {
    await h.page.click('#app button[data-type="' + name + '"]');
    await sleep(120);
  }
  const out = await docText(h.page);
  const ranges = await selectionRanges(h.page);
  assert.deepEqual(h.errors, []);
  await h.close();
  return { text: out, ranges };
}
const B = { chord: ["Control"], key: "b" };
const I = { chord: ["Control"], key: "i" };
const E = { chord: ["Control"], key: "e" };
const K = { chord: ["Control"], key: "k" };

// VS Code's webview host listens for keydown on the page's window, in the
// bubble phase and whatever the page did with the default, and hands every
// key to the workbench (did-keydown in VS Code 1.133.0's host page): Ctrl+B
// set bold and hid the Explorer. The listener here stands in for it.
test("the formatting keys stop at the text, and reach VS Code from anywhere else", { skip }, async () => {
  const h = await open({ text: "one word here\n", scores: 0 });
  await h.page.evaluate(() => {
    window.__heard = [];
    window.addEventListener("keydown", (e) => {
      // The modifiers go down on their own first, and are no one's keys.
      if (e.ctrlKey && !/^(Control|Shift|Alt|Meta)$/.test(e.key)) window.__heard.push((e.shiftKey ? "Shift+" : "") + e.code);
    });
  });
  const heard = () => h.page.evaluate(() => window.__heard.splice(0));
  await setSelection(h.page, 5);
  for (const [mods, key] of [[["Control"], "b"], [["Control"], "i"], [["Control"], "e"], [["Control"], "k"]]) {
    await chord(h.page, mods, key);
  }
  assert.notEqual(await docText(h.page), "one word here\n");
  assert.deepEqual(await heard(), []);
  // The block keys too, pressed as a keyboard presses them (blockChord): of
  // these VS Code keeps Ctrl+Shift+T for Reopen Closed Editor and
  // Ctrl+Shift+C for an external terminal, and neither may fire from the
  // text.
  for (const name of [2, "c", "t"]) await blockChord(h.page, name);
  assert.deepEqual(await heard(), []);
  // And the other way for the three the editor gave back: a chord the page
  // does not bind is VS Code's from the text as well, which is the whole of
  // what taking U, O and Q off is worth (Ctrl+Shift+O is its Go to Symbol).
  const before2 = await docText(h.page);
  for (const name of ["u", "o", "q"]) await blockChord(h.page, name);
  assert.deepEqual(await heard(), ["Shift+KeyU", "Shift+KeyO", "Shift+KeyQ"]);
  assert.equal(await docText(h.page), before2);
  // Ctrl+S is VS Code's to save, from the text as well.
  await chord(h.page, ["Control"], "s");
  assert.deepEqual(await heard(), ["KeyS"]);
  // Out of the text the key is VS Code's, and the text is left alone.
  const before = await docText(h.page);
  await h.page.evaluate(() => document.activeElement.blur());
  await chord(h.page, ["Control"], "b");
  assert.deepEqual(await heard(), ["KeyB"]);
  assert.equal(await docText(h.page), before);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Enter continues a numbered list and renumbers what follows (ED01)", { skip }, async () => {
  const out = await pressOn("1. first\n2. second\n3. third\n", 18, ["Enter"]);
  assert.equal(out.text, "1. first\n2. second\n3. \n4. third\n");
  assert.equal(out.head, 22);
});

test("Enter twice at the end of a list ends it with a blank line, so the next text is a paragraph (ED02, ED18)", { skip }, async () => {
  // A lazy continuation is what the readers made of the text typed under
  // the last item when no blank line parted them (G068).
  let out = await pressOn("- only\n- last\n", 13, ["Enter", "Enter", { type: "para" }]);
  assert.equal(out.text, "- only\n- last\n\npara\n");
  // A list of one item: the same two presses, and the list is never made
  // loose on the way (G069).
  out = await pressOn("- Violin\n", 8, ["Enter", "Enter", { type: "text" }]);
  assert.equal(out.text, "- Violin\n\ntext\n");
  // Inside a quote the blank line is the quote's.
  out = await pressOn("> - a\n", 5, ["Enter", "Enter", { type: "p" }]);
  assert.equal(out.text, "> - a\n> \n> p\n");
  // An empty nested item is unnested, with no line of spaces left behind.
  out = await pressOn("- a\n  - b\n", 9, ["Enter", "Enter"]);
  assert.equal(out.text, "- a\n  - b\n- \n");
});

test("Enter continues a task unchecked, an ordered task too, and a marker followed by a tab (ED03, G084)", { skip }, async () => {
  assert.equal((await pressOn("- [x] write tests\n", 17, ["Enter"])).text, "- [x] write tests\n- [ ] \n");
  assert.equal((await pressOn("1. [ ] Tune\n", 11, ["Enter"])).text, "1. [ ] Tune\n2. [ ] \n");
  assert.equal((await pressOn("-\tItem\n", 6, ["Enter"])).text, "-\tItem\n-\t\n");
});

test("Enter with two carets answers each on its own (ED19)", { skip }, async () => {
  // One in a list, one in a paragraph: the item continued, the paragraph
  // given a plain newline, where any caret outside markup used to send
  // every caret to the plain newline (G072).
  const text = "- apples\n\nA paragraph.\n";
  const out = await pressOn(text, [8, text.indexOf("A paragraph.") + 12], ["Enter"]);
  assert.equal(out.text, "- apples\n- \n\nA paragraph.\n\n");
});

test("Enter at the head of a heading's text opens a line above it (ED32)", { skip }, async () => {
  const out = await pressOn("## Scales again\n", 3, ["Enter"]);
  assert.equal(out.text, "\n## Scales again\n");
  assert.equal(out.head, 4);
});

test("Enter in a fence inside a quote keeps the new line in the quote (ED33)", { skip }, async () => {
  const text = "> ```js\n> let a = 1;\n> ```\n";
  const out = await pressOn(text, 20, ["Enter", { type: "let b = 2;" }]);
  assert.equal(out.text, "> ```js\n> let a = 1;\n> let b = 2;\n> ```\n");
  // And in an item, the item's indentation; a bare fence keeps CodeMirror's
  // own newline, which indents by the code's language.
  assert.equal((await pressOn("- item\n\n  ```js\n  let a = 1;\n  ```\n", 28, ["Enter"])).text, "- item\n\n  ```js\n  let a = 1;\n  \n  ```\n");
  assert.equal((await pressOn("```js\nif (a) {\n```\n", 14, ["Enter"])).text, "```js\nif (a) {\n  \n```\n");
});

test("Ctrl+Enter leaves a paragraph of two source lines whole (G084)", { skip }, async () => {
  const out = await pressOn("Line one\nline two\n\nAfter.\n", 4, [{ chord: ["Control"], key: "Enter" }]);
  assert.equal(out.text.slice(0, 19), "Line one\nline two\n\n");
  assert.ok(out.head > 18, "the caret is not below the paragraph: " + out.head);
});

test("Backspace and Delete beside a character that draws nothing take that character alone (G058)", { skip }, async () => {
  // Under the caret a soft hyphen is a mark over one character, and the keys
  // take it as they take any other.
  let out = await pressOn("soft\u00adhyphen\n", 5, ["Backspace"]);
  assert.equal(out.text, "softhyphen\n");
  assert.equal(out.head, 4);
  out = await pressOn("soft\u00adhyphen\n", 4, ["Delete"]);
  assert.equal(out.text, "softhyphen\n");
  assert.equal(out.head, 4);
});

test("a comment and a processing instruction are raw HTML to the marks and to Ctrl+Enter (G048)", { skip }, async () => {
  const text = "One.\n\n<!-- a\ncomment -->\n\n<?php echo 1; ?>\n\nTwo.\n";
  // Ctrl+B over everything wraps the prose and leaves the raw lines alone.
  let out = await pressOn(text, [{ anchor: 0, head: text.length - 1 }], [B]);
  assert.equal(out.text, "**One.**\n\n<!-- a\ncomment -->\n\n<?php echo 1; ?>\n\n**Two.**\n");
  // Ctrl+Enter on the first line of the comment leaves the comment whole.
  out = await pressOn(text, text.indexOf("<!--") + 5, [{ chord: ["Control"], key: "Enter" }]);
  assert.equal(out.text, "One.\n\n<!-- a\ncomment -->\n\n\n\n<?php echo 1; ?>\n\nTwo.\n");
});

test("Backspace after a later item's marker takes the marker and parts the line from the item above (ED06)", { skip }, async () => {
  // The readers join a line of text under an item into that item; a blank
  // line makes it the paragraph it reads as (G078).
  let out = await pressOn("- keep\n- delete my marker\n", 9, ["Backspace"]);
  assert.equal(out.text, "- keep\n\ndelete my marker\n");
  assert.equal(out.head, 8);
  // The first item of a list: its marker alone goes.
  out = await pressOn("- keep\n", 2, ["Backspace"]);
  assert.equal(out.text, "keep\n");
  // A nested item: the text stays in the item around it, as its paragraph.
  out = await pressOn("- a\n  - b\n", 8, ["Backspace"]);
  assert.equal(out.text, "- a\n\n  b\n");
  // An ordered list renumbers past the item that left it.
  out = await pressOn("1. a\n2. b\n3. c\n", 8, ["Backspace"]);
  assert.equal(out.text, "1. a\n\nb\n2. c\n");
  // A quote's mark goes the same way.
  out = await pressOn("> a\n> b\n", 6, ["Backspace"]);
  assert.equal(out.text, "> a\n\nb\n");
  // Spaces beyond the one after the marker: back to that one space first.
  out = await pressOn("- keep\n-   x\n", 11, ["Backspace"]);
  assert.equal(out.text, "- keep\n- x\n");
  assert.equal(out.head, 9);
});

test("Backspace after the hashes of a heading takes them all (ED21)", { skip }, async () => {
  const out = await pressOn("## Scales\n", 3, ["Backspace"]);
  assert.equal(out.text, "Scales\n");
  assert.equal(out.head, 0);
  // A step further in, the ordinary deletion.
  assert.equal((await pressOn("## Scales\n", 4, ["Backspace"])).text, "## cales\n");
});

test("Delete and Backspace at the edge of a hidden block open it and take nothing (ED24)", { skip }, async () => {
  const text = "Before the code.\n```text\ncode\n```\nAfter the code.\n";
  let out = await pressOn(text, 16, ["Delete"]);
  assert.equal(out.text, text, "Delete took the line break into the fence");
  assert.equal(out.head, 17, "the caret is not on the opening fence");
  out = await pressOn(text, text.indexOf("After"), ["Backspace"]);
  assert.equal(out.text, text, "Backspace took the line break into the fence");
  assert.equal(out.head, text.indexOf("After") - 1, "the caret is not at the end of the closing fence");
});

test("Backspace after an emoji with a skin tone or a keycap takes the whole glyph (G056)", { skip }, async () => {
  assert.equal((await pressOn("Thumbs \u{1F44D}\u{1F3FD} up\n", 11, ["Backspace"])).text, "Thumbs  up\n");
  assert.equal((await pressOn("Key 1\uFE0F\u20E3 end\n", 7, ["Backspace"])).text, "Key  end\n");
  // An accent alone comes off its letter, as everywhere.
  assert.equal((await pressOn("caf\u0065\u0301\n", 5, ["Backspace"])).text, "cafe\n");
});

test("Tab nests an item under the one above at its content column, and Shift+Tab brings it back (ED05)", { skip }, async () => {
  // Two columns under `- `, three under `1. `: what every reader nests by
  // (G070; the plain indent put two spaces under `1. parent`, which left
  // `2. child` beside it).
  let text = "- parent\n- child\n";
  let out = await pressOn(text, text.indexOf("child"), ["Tab"]);
  assert.equal(out.text, "- parent\n  - child\n");
  out = await pressOn(text, text.indexOf("child"), ["Tab", { chord: ["Shift"], key: "Tab" }]);
  assert.equal(out.text, text);
  text = "1. parent\n2. child\n";
  out = await pressOn(text, text.indexOf("child") + 5, ["Tab"]);
  assert.equal(out.text, "1. parent\n   1. child\n");
  assert.equal(out.head, text.indexOf("child") + 5 + 3, "the caret did not move with its text");
  // A second Tab has nothing to nest under and changes nothing; Shift+Tab
  // brings the item back, numbered after its parent again.
  out = await pressOn(text, text.indexOf("child"), ["Tab", "Tab"]);
  assert.equal(out.text, "1. parent\n   1. child\n");
  out = await pressOn(text, text.indexOf("child"), ["Tab", { chord: ["Shift"], key: "Tab" }]);
  assert.equal(out.text, text);
});

test("Tab and Shift+Tab take an item's children along and renumber the lists they cross", { skip }, async () => {
  // The children go with their item, where the plain indent left them
  // behind as its siblings.
  let text = "- Strings\n- Violin\n  - Tuning\n  - Rosin\n";
  let out = await pressOn(text, text.indexOf("Violin"), ["Tab"]);
  assert.equal(out.text, "- Strings\n  - Violin\n    - Tuning\n    - Rosin\n");
  // Inside a quote, past the quote's own mark.
  text = "> - Violin\n> - Viola\n";
  out = await pressOn(text, text.indexOf("Viola"), ["Tab"]);
  assert.equal(out.text, "> - Violin\n>   - Viola\n");
  // An ordered item nested starts a list of its own at one, and the items
  // it leaves behind close up.
  text = "1. a\n2. b\n3. c\n";
  out = await pressOn(text, text.indexOf("b"), ["Tab"]);
  assert.equal(out.text, "1. a\n   1. b\n2. c\n");
  // Joining the nested list the item above ends with: numbered on from it.
  text = "1. a\n   1. a1\n2. b\n3. c\n";
  out = await pressOn(text, text.indexOf("b"), ["Tab"]);
  assert.equal(out.text, "1. a\n   1. a1\n   2. b\n2. c\n");
  // Out again: after the item that held it, numbered on from it, and the
  // siblings left behind are its children now, numbered from one.
  text = "1. Tune\n   1. Low E\n   2. High E\n2. Play\n";
  out = await pressOn(text, text.indexOf("Low"), [{ chord: ["Shift"], key: "Tab" }]);
  assert.equal(out.text, "1. Tune\n2. Low E\n   1. High E\n3. Play\n");
  // A top-level item has nowhere to go.
  out = await pressOn("- a\n- b\n", 5, [{ chord: ["Shift"], key: "Tab" }]);
  assert.equal(out.text, "- a\n- b\n");
  // A selection over two items takes both.
  text = "- a\n- b\n- c\n";
  out = await pressOn(text, [{ anchor: text.indexOf("b"), head: text.indexOf("c") + 1 }], ["Tab"]);
  assert.equal(out.text, "- a\n  - b\n  - c\n");
});

test("Tab in prose puts a tab at the caret and never makes code of the paragraph (ED20)", { skip }, async () => {
  const text = "First paragraph.\n\nA line of prose that must stay prose.\n";
  let out = await pressOn(text, text.indexOf("that"), ["Tab", "Tab"]);
  assert.equal(out.text, "First paragraph.\n\nA line of prose \t\tthat must stay prose.\n");
  // At the head of the line's text nothing is written, since four columns
  // there would make an indented code block of the paragraph; the key is
  // taken all the same, so the focus stays in the editor.
  out = await pressOn(text, text.indexOf("A line"), ["Tab", "Tab"]);
  assert.equal(out.text, text);
  assert.equal(out.focused, true, "Tab moved the focus out of the editor");
  // In a fence, the unit of indentation at the caret, and Shift+Tab takes
  // one unit off the head of the line.
  out = await pressOn("```python\nx = 1\n```\n", 12, ["Tab"]);
  assert.equal(out.text, "```python\nx   = 1\n```\n");
  out = await pressOn("```python\n  x = 1\n```\n", 14, [{ chord: ["Shift"], key: "Tab" }]);
  assert.equal(out.text, "```python\nx = 1\n```\n");
});

test("Ctrl+B with the caret inside bold takes the bold off, and at its end steps out of it (ED07, ED22)", { skip }, async () => {
  let text = "This is **already bold** text.\n";
  let out = await pressOn(text, text.indexOf("ready"), [B]);
  assert.equal(out.text, "This is already bold text.\n");
  assert.equal(out.head, text.indexOf("ready") - 2);
  // Italic and code take off the run of their own kind.
  out = await pressOn("An *italic* word\n", 6, [I]);
  assert.equal(out.text, "An italic word\n");
  out = await pressOn("Run `make all` now\n", 8, [E]);
  assert.equal(out.text, "Run make all now\n");
  // Bold typed after Ctrl+B is closed by the next Ctrl+B, a step past the
  // closing marks, and no empty pair is left (ED22).
  out = await pressOn("Say\n", 3, [B, { type: "loud" }, B, { type: " soft" }]);
  assert.equal(out.text, "Say**loud** soft\n");
  out = await pressOn("Say\n", 3, [E, { type: "loud" }, E, { type: " soft" }]);
  assert.equal(out.text, "Say`loud` soft\n");
  // A caret in the middle of a word wraps the word.
  out = await pressOn("Make this longer.\n", 7, [B]);
  assert.equal(out.text, "Make **this** longer.\n");
});

test("Ctrl+B and Ctrl+I on a selection write marks the readers read as meant (ED08)", { skip }, async () => {
  // Spaces at the edge of the selection stay outside the marks.
  let out = await pressOn("word next\n", [{ anchor: 0, head: 5 }], [B]);
  assert.equal(out.text, "**word** next\n");
  // Across two paragraphs, or two items: each line's own text is wrapped.
  out = await pressOn("First paragraph.\n\nSecond paragraph.\n", [{ anchor: 0, head: 35 }], [B]);
  assert.equal(out.text, "**First paragraph.**\n\n**Second paragraph.**\n");
  out = await pressOn("- one\n- two\n", [{ anchor: 0, head: 11 }], [B]);
  assert.equal(out.text, "- **one**\n- **two**\n");
  // A selection running out of a bold run extends the run over it.
  let text = "a **bold** word\n";
  out = await pressOn(text, [{ anchor: text.indexOf("ld**"), head: text.indexOf("rd") }], [B]);
  assert.equal(out.text, "a **bold wo**rd\n");
  // Ctrl+I on the text of a bold run makes it bold italic, not italic.
  out = await pressOn("**forte**\n", [{ anchor: 2, head: 7 }], [I]);
  assert.equal(out.text, "***forte***\n");
  // Italic over a selection that starts in bold and runs past it (ED08).
  text = "Some **half bold** plain words.\n";
  out = await pressOn(text, [{ anchor: text.indexOf("half"), head: text.indexOf("plain") + 5 }], [I]);
  assert.equal(out.text, "Some ***half bold** plain* words.\n");
  // A selection inside a bold run comes out of it, the spaces beside it
  // left outside the marks.
  text = "**already bold text**\n";
  out = await pressOn(text, [{ anchor: text.indexOf("bold"), head: text.indexOf("bold") + 4 }], [B]);
  assert.equal(out.text, "**already** bold **text**\n");
  // Code holding a backtick gets a longer fence.
  out = await pressOn("a`b\n", [{ anchor: 0, head: 3 }], [E]);
  assert.equal(out.text, "``a`b``\n");
});

test("Ctrl+K edits the link around the caret instead of nesting one, and makes a selected address the destination (ED29)", { skip }, async () => {
  let text = "Read [the standard](https://abcnotation.com/wiki) first.\n";
  let out = await pressOn(text, text.indexOf("standard"), [K]);
  assert.equal(out.text, text);
  assert.deepEqual(out.ranges, [[text.indexOf("https"), text.indexOf(")")]]);
  // An empty address: the caret between its parentheses.
  text = "See [here]() now.\n";
  out = await pressOn(text, 6, [K]);
  assert.equal(out.text, text);
  assert.deepEqual(out.ranges, [[11, 11]]);
  // An address selected goes where the address goes, the caret in the label.
  text = "See https://abcnotation.com today.\n";
  out = await pressOn(text, [{ anchor: 4, head: 27 }], [K]);
  assert.equal(out.text, "See [](https://abcnotation.com) today.\n");
  assert.deepEqual(out.ranges, [[5, 5]]);
  // Words selected are the label, the caret where the address goes.
  out = await pressOn("See here now.\n", [{ anchor: 4, head: 8 }], [K]);
  assert.equal(out.text, "See [here]() now.\n");
  assert.deepEqual(out.ranges, [[11, 11]]);
});

test("a toolbar button works on the selection where it is, in a table cell or over inline maths (G064)", { skip }, async () => {
  let text = "| a | b |\n|---|---|\n| cell | 2 |\n\nAfter.\n";
  let out = await buttonOn(text, [{ anchor: text.indexOf("cell"), head: text.indexOf("cell") + 4 }], "bold");
  assert.equal(out.text, "| a | b |\n|---|---|\n| **cell** | 2 |\n\nAfter.\n");
  text = "Energy $E=mc^2$ is famous.\n";
  out = await buttonOn(text, [{ anchor: 7, head: 15 }], "bold");
  assert.equal(out.text, "Energy **$E=mc^2$** is famous.\n");
});

test("the list buttons change the kind of a list, take it off again, and leave blank lines and quote marks as they are (ED23)", { skip }, async () => {
  const text = "- Violin\n- Viola\n\n> Cello\n";
  let out = await buttonOn(text, [{ anchor: 0, head: text.length }], "ordered-list");
  assert.equal(out.text, "1. Violin\n2. Viola\n\n> 3. Cello\n");
  out = await buttonOn("1. Violin\n2. Viola\n\n> 3. Cello\n", [{ anchor: 0, head: 29 }], "unordered-list");
  assert.equal(out.text, "- Violin\n- Viola\n\n> - Cello\n");
  out = await buttonOn("- Violin\n- Viola\n\n> - Cello\n", [{ anchor: 0, head: 27 }], "unordered-list");
  assert.equal(out.text, "Violin\nViola\n\n> Cello\n");
  // A heading's hashes make way for the marker, and a task box keeps its
  // place behind the new one.
  out = await buttonOn("# Cello\n", 3, "unordered-list");
  assert.equal(out.text, "- Cello\n");
  out = await buttonOn("- [ ] Violin\n", 8, "ordered-list");
  assert.equal(out.text, "1. [ ] Violin\n");
  // The numbers run from one over the lines taken, blank lines not counted.
  out = await buttonOn("Flute\n\nOboe\n", [{ anchor: 0, head: 12 }], "ordered-list");
  assert.equal(out.text, "1. Flute\n\n2. Oboe\n");
});

test("the strikethrough button writes Pandoc's ~~ and takes it off by the same rules as bold", { skip }, async () => {
  let out = await buttonOn("Some words here.\n", [{ anchor: 5, head: 10 }], "strikethrough");
  assert.equal(out.text, "Some ~~words~~ here.\n");
  // A caret inside the run takes its marks off; one inside a word wraps it.
  out = await buttonOn("Some ~~words~~ here.\n", 9, "strikethrough");
  assert.equal(out.text, "Some words here.\n");
  out = await buttonOn("Some words here.\n", 7, "strikethrough");
  assert.equal(out.text, "Some ~~words~~ here.\n");
  // Not the single ~ of a subscript, which is Pandoc's and stays.
  out = await buttonOn("H~2~O is water.\n", [{ anchor: 6, head: 8 }], "strikethrough");
  assert.equal(out.text, "H~2~O ~~is~~ water.\n");
});

// Pandoc's bracketed span, `[x]{.mark}`, which the page writes as `<mark>`
// (checked with the Pandoc 3.8.3 that the Quarto here ships: `==x==` comes
// out as the four equals signs, so it is not this). The edit is not a pair
// of marks, so it has its own shape. The underline button that wrote the
// other span was taken off on 2026-09-19; what it wrote is still read, which
// AT01 in webview-markdown.test.js holds.
test("the highlight button writes Pandoc's bracketed span, and takes it off again", { skip }, async () => {
  let out = await buttonOn("Some words here.\n", [{ anchor: 5, head: 10 }], "highlight");
  assert.equal(out.text, "Some [words]{.mark} here.\n");
  // A caret inside the span takes it off, class and brackets and attribute.
  out = await buttonOn("Some [words]{.mark} here.\n", 8, "highlight");
  assert.equal(out.text, "Some words here.\n");
  // A caret inside a word wraps the word, as the marks do.
  out = await buttonOn("Some words here.\n", 7, "highlight");
  assert.equal(out.text, "Some [words]{.mark} here.\n");
  // Nowhere to wrap: an empty span with the caret inside it, to type into.
  out = await buttonOn("Words here.\n", 0, "highlight");
  assert.equal(out.text, "[]{.mark}Words here.\n");
  assert.deepEqual(out.ranges, [[1, 1]]);
  // Each line's own text across a selection that spans lines, as the marks
  // do, and blank lines left alone.
  out = await buttonOn("Flute\n\nOboe\n", [{ anchor: 0, head: 12 }], "highlight");
  assert.equal(out.text, "[Flute]{.mark}\n\n[Oboe]{.mark}\n");
  // Not where no mark belongs: inside a fence the line is code.
  out = await buttonOn("```\nx\n```\n", [{ anchor: 4, head: 5 }], "highlight");
  assert.equal(out.text, "```\nx\n```\n");
});

// One button writes a span now, and the shape of the edit is still the
// general one: a class joins the attribute of the span the range is already
// in instead of nesting a second span, and the span goes with its last
// class. The document that proves it is one written by hand with both
// classes, which Pandoc reads and the editor draws whether or not a button
// writes it.
test("a class joins the span it finds instead of nesting, and the last one off takes the span", { skip }, async () => {
  const sel = [{ anchor: 5, head: 10 }];
  // Onto a span that is already there: one attribute, two classes.
  let out = await buttonOn("Some [words]{.underline} here.\n", sel, "highlight");
  assert.equal(out.text, "Some [words]{.underline .mark} here.\n");
  // Off again, and the other class keeps the span with no space at the brace.
  out = await buttonOn("Some [words]{.underline .mark} here.\n", 8, "highlight");
  assert.equal(out.text, "Some [words]{.underline} here.\n");
  out = await buttonOn("Some [words]{.mark .underline} here.\n", 8, "highlight");
  assert.equal(out.text, "Some [words]{.underline} here.\n");
  // And the last class takes the span with it.
  out = await buttonOn("Some [words]{.mark} here.\n", 8, "highlight");
  assert.equal(out.text, "Some words here.\n");
});

// Pandoc's superscript and subscript, `x^2^` and `H~2~O`, which the editor
// draws raised and lowered and the page writes as <sup> and <sub>. The pair
// came to the bar on 2026-09-19 (design-annotation-icons.html). Two things
// are theirs alone and were measured on the pandoc 3.8.3 the Quarto here
// ships: neither mark carries a bare space, so a space inside goes in as
// `\ ` (a no-break space on the page), and neither carries a bracket at the
// head of its content, since `x^[b]^` is an inline footnote there.
test("the superscript and subscript buttons write Pandoc's marks, and escape what cannot stand inside them", { skip }, async () => {
  let out = await buttonOn("The 2nd violin.\n", [{ anchor: 5, head: 7 }], "superscript");
  assert.equal(out.text, "The 2^nd^ violin.\n");
  // A caret inside the run takes its marks off again.
  out = await buttonOn("The 2^nd^ violin.\n", 7, "superscript");
  assert.equal(out.text, "The 2nd violin.\n");
  out = await buttonOn("H2O is water.\n", [{ anchor: 1, head: 2 }], "subscript");
  assert.equal(out.text, "H~2~O is water.\n");
  out = await buttonOn("H~2~O is water.\n", 2, "subscript");
  assert.equal(out.text, "H2O is water.\n");
  // A space inside the content is escaped, and the escape comes off with
  // the marks.
  out = await buttonOn("x a b y\n", [{ anchor: 2, head: 5 }], "superscript");
  assert.equal(out.text, "x ^a\\ b^ y\n");
  out = await buttonOn("x ^a\\ b^ y\n", 4, "superscript");
  assert.equal(out.text, "x a b y\n");
  // And a bracket at the head of it, which would be an inline footnote.
  out = await buttonOn("see [x] here\n", [{ anchor: 4, head: 7 }], "superscript");
  assert.equal(out.text, "see ^\\[x]^ here\n");
});

// Two tildes are the strikethrough and one is the subscript, and the two
// buttons stand three places apart on the same bar. Measured on pandoc
// 3.8.3: `~~~x~~~` is a subscript with the strikeout gone, so a subscript
// asked for over the whole text of a strikethrough cannot be written at all
// and the button leaves the run as it stands; over part of that text it is
// written, and `~~H~2~O~~` is read as the strikeout of H, a subscript 2 and
// an O.
test("the subscript button never writes the strikethrough's pair of tildes", { skip }, async () => {
  let out = await buttonOn("a ~~x~~ b\n", [{ anchor: 4, head: 5 }], "subscript");
  assert.equal(out.text, "a ~~x~~ b\n");
  out = await buttonOn("a ~~H2O~~ b\n", [{ anchor: 5, head: 6 }], "subscript");
  assert.equal(out.text, "a ~~H~2~O~~ b\n");
  // And the strikethrough button is still the one that writes two, over a
  // subscript's single tildes.
  out = await buttonOn("H~2~O is water.\n", [{ anchor: 6, head: 8 }], "strikethrough");
  assert.equal(out.text, "H~2~O ~~is~~ water.\n");
});

// The third of the bracketed spans the editor draws, the same gesture as the
// highlight (toggleSpan), which is what the sheet argued for: the class
// joins the attribute of a span the range is already in instead of nesting a
// second one.
test("the small caps button writes Pandoc's span and joins the one it finds", { skip }, async () => {
  let out = await buttonOn("Some words here.\n", [{ anchor: 5, head: 10 }], "small-caps");
  assert.equal(out.text, "Some [words]{.smallcaps} here.\n");
  out = await buttonOn("Some [words]{.smallcaps} here.\n", 8, "small-caps");
  assert.equal(out.text, "Some words here.\n");
  out = await buttonOn("Some [words]{.mark} here.\n", [{ anchor: 5, head: 10 }], "small-caps");
  assert.equal(out.text, "Some [words]{.mark .smallcaps} here.\n");
});

// The six of the Insert group, the buttons that close the first row of the
// bar (design-annotation-icons.html, the set the owner picked; they were one
// menu button until the bar went to two rows).
async function insertOn(text, pos, row) {
  const h = await open({ text, scores: 0 });
  await setSelection(h.page, Array.isArray(pos) ? pos.map((p) => (typeof p === "number" ? { anchor: p } : p)) : pos);
  await h.page.click('#app button[data-type="insert-' + row + '"]');
  await sleep(120);
  const out = await docText(h.page);
  const ranges = await selectionRanges(h.page);
  const open_ = await h.page.$$eval("#app .mdm-toolbar__item--open", (els) => els.length);
  const focused = await h.page.evaluate(() => !!document.activeElement.closest(".cm-content"));
  assert.deepEqual(h.errors, []);
  await h.close();
  return { text: out, ranges, open: open_, focused };
}

// The bar stands in two rows, and where it breaks is a decision: the first
// row is what a reader writes (the words, the blocks, and the six things a
// document holds beside them), the second what the document as a whole is
// set in. So the first row ends on the rule and the second begins under the
// outline button, at the same left edge, whatever the width of the pane.
test("the bar stands in two rows, the first closing on the rule and the second opening under the outline", { skip }, async () => {
  const h = await open({ text: "Text.\n", scores: 0 });
  for (const width of [900, 1400]) {
    await h.page.setViewport({ width, height: 900 });
    await sleep(250);
    const seen = await h.page.evaluate(() => {
      const bar = document.querySelector("#app .mdm-toolbar");
      const rows = new Map();
      [...bar.children].forEach((el) => {
        const box = el.getBoundingClientRect();
        const button = el.querySelector("button");
        if (!button || !box.height) return;
        const top = Math.round(box.top);
        if (!rows.has(top)) rows.set(top, []);
        rows.get(top).push({ name: button.getAttribute("data-type"), left: Math.round(box.left) });
      });
      return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([top, items]) => ({ top, items }));
    });
    assert.equal(seen.length, 2, "the bar is not in two rows at " + width + ": " + JSON.stringify(seen.map((r) => r.items.length)));
    const first = seen[0].items.map((i) => i.name);
    const second = seen[1].items.map((i) => i.name);
    assert.equal(first[0], "outline", width + ": the first row does not open on the outline");
    assert.equal(first[first.length - 1], "insert-rule", width + ": the first row does not close on the rule");
    assert.deepEqual(first.slice(-6), [
      "insert-equation",
      "insert-equation-block",
      "insert-table",
      "insert-picture",
      "insert-footnote",
      "insert-rule",
    ], width + ": the six do not close the first row");
    assert.equal(second[0], "mdm-match-substring", width + ": the second row does not open on the multicursor");
    assert.equal(second[second.length - 1], "mdm-follow", width + ": the second row does not close on the playhead");
    assert.equal(seen[1].items[0].left, seen[0].items[0].left, width + ": the second row does not start under the outline");
    // Two rows of buttons and nothing between them: the break draws nothing
    // and takes no height, so the rows stand a row apart and no more.
    assert.ok(seen[1].top - seen[0].top <= 32, width + ": the rows stand " + (seen[1].top - seen[0].top) + "px apart");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The equation button is a toggle, `$` being a pair of marks like the rest
// (INLINE_KIND): the selection is wrapped, and pressed inside an equation it
// takes the dollars off.
test("the Equation button wraps the selection in dollars and takes them off again", { skip }, async () => {
  let out = await insertOn("Energy is famous.\n", [{ anchor: 0, head: 6 }], "equation");
  assert.equal(out.text, "$Energy$ is famous.\n");
  assert.equal(out.open, 0);
  assert.equal(out.focused, true);
  out = await insertOn("$Energy$ is famous.\n", 4, "equation");
  assert.equal(out.text, "Energy is famous.\n");
  // Nowhere to wrap: an empty pair with the caret inside it, to type into.
  out = await insertOn("Text.\n", 0, "equation");
  assert.equal(out.text, "$$Text.\n");
  assert.deepEqual(out.ranges, [[1, 1]]);
});

// The three that stand on lines of their own go where the code block's empty
// block goes: under the whole of the block the caret is in, never through
// it, on a blank line when the caret is on one, and inside the quote or the
// item around them.
test("the Equation block, Table and Horizontal rule buttons write a block of their own where a block belongs", { skip }, async () => {
  let out = await insertOn("Text.\n", 2, "equation-block");
  assert.equal(out.text, "Text.\n\n$$\n\n$$\n");
  assert.deepEqual(out.ranges, [[10, 10]]);
  out = await insertOn("Text.\n", 2, "table");
  assert.equal(out.text, "Text.\n\n|  |  |\n| --- | --- |\n|  |  |\n|  |  |\n");
  assert.deepEqual(out.ranges, [[9, 9]]);
  out = await insertOn("Text.\n", 2, "rule");
  assert.equal(out.text, "Text.\n\n***\n");
  assert.deepEqual(out.ranges, [[10, 10]]);
  // A paragraph of two lines is not cut in two: the rule goes under it.
  out = await insertOn("One\ntwo\n", 1, "rule");
  assert.equal(out.text, "One\ntwo\n\n***\n");
  // On a blank line the block is written there.
  out = await insertOn("Text.\n\n", 6, "rule");
  assert.equal(out.text, "Text.\n\n***\n");
  // Inside a quote the block carries the quote's mark, parted from the text
  // above by a line of the quote's own.
  out = await insertOn("> Cello\n", 3, "rule");
  assert.equal(out.text, "> Cello\n>\n> ***\n");
  // Inside a list item no blank line is written, which would be all the
  // block added to the list besides itself.
  out = await insertOn("- Violin\n", 4, "rule");
  assert.equal(out.text, "- Violin\n  ***\n");
});

// The picture row is the link gesture with a `!` in front (linkGesture), so
// what Ctrl+K does with a selection it does with one too, and a file name
// counts as an address, which is what a picture's address usually is.
test("the Picture button writes an image and puts a file name where the address goes", { skip }, async () => {
  let out = await insertOn("See here.\n", [{ anchor: 4, head: 8 }], "picture");
  assert.equal(out.text, "See ![here]().\n");
  assert.deepEqual(out.ranges, [[12, 12]]);
  out = await insertOn("score.png\n", [{ anchor: 0, head: 9 }], "picture");
  assert.equal(out.text, "![](score.png)\n");
  assert.deepEqual(out.ranges, [[2, 2]]);
  // Inside an image already, its address is selected to be typed over, and
  // no second image is nested in it.
  const text = "A ![staff](score.png) here.\n";
  out = await insertOn(text, 5, "picture");
  assert.equal(out.text, text);
  assert.deepEqual(out.ranges, [[text.indexOf("score.png"), text.indexOf(")")]]);
});

// The footnote row writes the reference after the words the caret is in,
// which is where its glyph shows it, and the note at the end of the
// document, because Pandoc reads a definition at the top level alone
// (parseFootnoteDef): nothing is written inside the quote or the item the
// caret stands in. The caret is left in the note, which is what a reader
// types next.
test("the Footnote button numbers the reference and opens its note at the end of the document", { skip }, async () => {
  let out = await insertOn("The tune is old.\n", 8, "footnote");
  assert.equal(out.text, "The tune[^1] is old.\n\n[^1]: \n");
  assert.deepEqual(out.ranges, [[28, 28]]);
  // The lowest number the document has not used, references and notes alike.
  out = await insertOn("A[^1] tune.\n\n[^1]: First.\n", 10, "footnote");
  assert.equal(out.text, "A[^1] tune[^2].\n\n[^1]: First.\n\n[^2]: \n");
  // From inside a quote the note still goes to the top level, under it.
  out = await insertOn("> Cello\n", 7, "footnote");
  assert.equal(out.text, "> Cello[^1]\n\n[^1]: \n");
});

test("the task button puts a box behind the marker a line has, makes a bulleted task of a line with none, and takes only the box off", { skip }, async () => {
  const text = "- Violin\n1. Viola\n# Cello\nFlute\n";
  let out = await buttonOn(text, [{ anchor: 0, head: text.length }], "task-list");
  assert.equal(out.text, "- [ ] Violin\n1. [ ] Viola\n- [ ] Cello\n- [ ] Flute\n");
  // Every line a task already: the boxes go, ticked or not, the items stay.
  out = await buttonOn("- [ ] Violin\n1. [x] Viola\n", [{ anchor: 0, head: 25 }], "task-list");
  assert.equal(out.text, "- Violin\n1. Viola\n");
  // Some a task and some not: the rest get a box, the ticked one keeps it.
  out = await buttonOn("- [x] Violin\n- Viola\n", [{ anchor: 0, head: 20 }], "task-list");
  assert.equal(out.text, "- [x] Violin\n- [ ] Viola\n");
  // Inside a quote the box goes behind the quote's > and the marker.
  out = await buttonOn("> - Cello\n", 6, "task-list");
  assert.equal(out.text, "> - [ ] Cello\n");
});

test("the quote button quotes the whole of the blocks it touches and takes a quote off again", { skip }, async () => {
  // A caret quotes its whole paragraph: a line left out would stay in the
  // quote as lazy continuation.
  let out = await buttonOn("First line\nsecond line.\n\nNext.\n", 3, "quote");
  assert.equal(out.text, "> First line\n> second line.\n\nNext.\n");
  out = await buttonOn("> First line\n> second line.\n\nNext.\n", 20, "quote");
  assert.equal(out.text, "First line\nsecond line.\n\nNext.\n");
  // Two blocks selected are one quote, the blank line between them marked;
  // the blank lines at the edges are not.
  let text = "\nOne.\n\n- a\n- b\n\nAfter.\n";
  out = await buttonOn(text, [{ anchor: 0, head: 15 }], "quote");
  assert.equal(out.text, "\n> One.\n>\n> - a\n> - b\n\nAfter.\n");
  // A fence touched is taken whole, fences and all.
  text = "```\ncode\n```\n";
  out = await buttonOn(text, 6, "quote");
  assert.equal(out.text, "> ```\n> code\n> ```\n");
  // A score is a fence like any other, taken whole from any of its lines.
  out = await buttonOn("```abc\nX:1\nK:C\n```\n", 12, "quote");
  assert.equal(out.text, "> ```abc\n> X:1\n> K:C\n> ```\n");
  // A lazy line has no > of its own and is in the quote all the same, so
  // the quote comes off rather than going a level deeper.
  out = await buttonOn("> a\nb\n", 2, "quote");
  assert.equal(out.text, "a\nb\n");
  // Off takes one level: a quote in a quote comes out one level up, and a
  // quote inside a list item loses the > behind the marker.
  out = await buttonOn("> > deep\n", 5, "quote");
  assert.equal(out.text, "> deep\n");
  out = await buttonOn("- > quoted item\n", 6, "quote");
  assert.equal(out.text, "- quoted item\n");
  // A triple click's selection, ending at the head of the next line, does
  // not take that line.
  out = await buttonOn("One.\n\nTwo.\n", [{ anchor: 0, head: 6 }], "quote");
  assert.equal(out.text, "> One.\n\nTwo.\n");
  // The header is never quoted.
  out = await buttonOn("---\ntitle: T\n---\n\nText.\n", [{ anchor: 0, head: 23 }], "quote");
  assert.equal(out.text, "---\ntitle: T\n---\n\n> Text.\n");
});

test("on an empty line the line buttons start a line of their kind, parted from a paragraph above as Pandoc needs", { skip }, async () => {
  // Under a blank line: the marker on the line, the caret after it.
  let out = await buttonOn("Text.\n\n\n", 7, "task-list");
  assert.equal(out.text, "Text.\n\n- [ ] \n");
  assert.deepEqual(out.ranges, [[13, 13]]);
  out = await buttonOn("Text.\n\n\n", 7, "quote");
  assert.equal(out.text, "Text.\n\n> \n");
  out = await buttonOn("Text.\n\n\n", 7, "unordered-list");
  assert.equal(out.text, "Text.\n\n- \n");
  out = await buttonOn("Text.\n\n\n", 7, "ordered-list");
  assert.equal(out.text, "Text.\n\n1. \n");
  // Right under a paragraph the line stays blank and the marker goes on
  // the next one: Pandoc 3.8.3 reads `Text.` over `- a` as `Text. - a`.
  out = await buttonOn("Text.\n\n", 6, "unordered-list");
  assert.equal(out.text, "Text.\n\n- \n");
  assert.deepEqual(out.ranges, [[9, 9]]);
  // In a quote, with the quote's marks on both lines.
  out = await buttonOn("> Text.\n>\n", 9, "unordered-list");
  assert.equal(out.text, "> Text.\n>\n> - \n");
  // Under an item an item is the list's next one, with no blank line; a
  // quote there would be read into the item's text, and is parted.
  out = await buttonOn("- a\n\n", 4, "task-list");
  assert.equal(out.text, "- a\n- [ ] \n");
  out = await buttonOn("- a\n\n", 4, "quote");
  assert.equal(out.text, "- a\n\n> \n");
  // Not in a fence, where a line is code.
  out = await buttonOn("```\n\n```\n", 4, "unordered-list");
  assert.equal(out.text, "```\n\n```\n");
});

// The heading button opens a menu of Paragraph and the six levels; a row sets
// the level of every selected line, and the level the caret's line has
// already, picked again, takes the heading off. Level 0 is the Paragraph row.
async function headingOn(text, pos, level) {
  const h = await open({ text, scores: 0 });
  await setSelection(h.page, Array.isArray(pos) ? pos.map((p) => (typeof p === "number" ? { anchor: p } : p)) : pos);
  await h.page.click('#app button[data-type="headings"]');
  await h.page.click('#app .mdm-menu__item[data-type="' + (level ? "heading-" + level : "paragraph") + '"]');
  await sleep(120);
  const out = await docText(h.page);
  const ranges = await selectionRanges(h.page);
  const open_ = await h.page.$$eval("#app .mdm-toolbar__item--open", (els) => els.length);
  // The focus back in the text, as from every button that acts on the caret.
  const focused = await h.page.evaluate(() => !!document.activeElement.closest(".cm-content"));
  assert.deepEqual(h.errors, []);
  await h.close();
  return { text: out, ranges, open: open_, focused };
}

const menuRows = (page) =>
  page.$$eval('#app button[data-type="headings"] + .mdm-menu .mdm-menu__item', (els) =>
    els.map((el) => [el.getAttribute("data-type"), el.textContent])
  );

// The Paragraph row went when the ticked level picked again started taking
// the heading off, and it is back with the keys: at the keyboard there is no
// tick to read, so a hand needs one key that says paragraph whatever the line
// was. Every row names its key, written as VS Code writes it per platform.
test("the heading menu lists Paragraph and the six levels, the caret's line ticked, each naming its key", { skip }, async () => {
  const h = await open({ text: "## Title\n\nBody.\n", scores: 0 });
  await setSelection(h.page, 4);
  await h.page.click('#app button[data-type="headings"]');
  assert.deepEqual(await menuRows(h.page), [
    ["paragraph", "ParagraphCtrl+Shift+0"],
    ["heading-1", "Heading 1Ctrl+Shift+1"],
    ["heading-2", "Heading 2✓Ctrl+Shift+2"],
    ["heading-3", "Heading 3Ctrl+Shift+3"],
    ["heading-4", "Heading 4Ctrl+Shift+4"],
    ["heading-5", "Heading 5Ctrl+Shift+5"],
    ["heading-6", "Heading 6Ctrl+Shift+6"],
  ]);
  // Read again at each opening: on a paragraph the tick is on Paragraph.
  await h.page.click('#app button[data-type="headings"]');
  await setSelection(h.page, 12);
  await h.page.click('#app button[data-type="headings"]');
  assert.deepEqual(
    (await menuRows(h.page)).filter((r) => r[1].includes("✓")).map((r) => r[0]),
    ["paragraph"]
  );
  assert.deepEqual(h.errors, []);
  await h.close();

  // On a Mac the row names Cmd+Option, which is what the keymap binds there.
  const mac = await open({ text: "Body.\n", scores: 0, platform: "MacIntel" });
  await setSelection(mac.page, 2);
  await mac.page.click('#app button[data-type="headings"]');
  assert.deepEqual((await menuRows(mac.page))[0], ["paragraph", "Paragraph✓⌥⌘0"]);
  assert.deepEqual(mac.errors, []);
  await mac.close();
});

test("a heading level from the menu goes after a quote's mark, in place of a list marker, over the level a line had, and makes ATX of a setext heading (G065)", { skip }, async () => {
  let out = await headingOn("> Cello\n", 3, 1);
  assert.equal(out.text, "> # Cello\n");
  assert.equal(out.open, 0);
  assert.equal(out.focused, true);
  out = await headingOn("- Violin\n", 3, 1);
  assert.equal(out.text, "# Violin\n");
  out = await headingOn("## Title\n", 4, 5);
  assert.equal(out.text, "##### Title\n");
  out = await headingOn("Title\n=====\n\nBody.\n", 2, 3);
  assert.equal(out.text, "### Title\n\nBody.\n");
  // The ticked level again: a paragraph, the hashes or the underline gone,
  // and for every selected line, a list item staying an item.
  out = await headingOn("## Title\n", 4, 2);
  assert.equal(out.text, "Title\n");
  out = await headingOn("Title\n-----\n\nBody.\n", 2, 2);
  assert.equal(out.text, "Title\n\nBody.\n");
  out = await headingOn("## Title\n- Violin\n", [{ anchor: 12, head: 3 }], 2);
  assert.equal(out.text, "Title\n- Violin\n");
  // Every selected line, whatever it was, blank lines left alone.
  out = await headingOn("one\n\ntwo\n###### six\n", [{ anchor: 0, head: 19 }], 2);
  assert.equal(out.text, "## one\n\n## two\n## six\n");
});

test("a heading level from the menu on an empty line writes the hashes to type after, parted from a paragraph or an item above", { skip }, async () => {
  let out = await headingOn("Text.\n\n\n", 7, 2);
  assert.equal(out.text, "Text.\n\n## \n");
  assert.deepEqual(out.ranges, [[10, 10]]);
  // Right under a paragraph, and right under an item, Pandoc would read the
  // hashes into the text above.
  out = await headingOn("Text.\n\n", 6, 1);
  assert.equal(out.text, "Text.\n\n# \n");
  out = await headingOn("- a\n\n", 4, 3);
  assert.equal(out.text, "- a\n\n### \n");
});

// A row of the menu works on the selection where it is: with the caret in
// inline maths, which shows its source while the caret is in it, a press on
// the row put the maths away first and the caret with it onto the line below.
test("a heading level from the menu lands on the line the caret was in, inside inline maths", { skip }, async () => {
  const out = await headingOn("Energy $E=mc^2$ here.\n\nAfter.\n", 9, 2);
  assert.equal(out.text, "## Energy $E=mc^2$ here.\n\nAfter.\n");
});

// ---- The code block button and Ctrl+Shift+C ----
//
// The block twin of inline code, its rules a level up: on a blank line an
// empty block with the caret right after the opening backticks, where the
// language is typed; with a bare caret in text, a block under the paragraph
// or block it is in, never through it; a selection put in a block; from
// inside a block, its fences taken off, an empty one leaving a blank line.

test("the code block button opens an empty block with the caret after its backticks, and a second press leaves a blank line", { skip }, async () => {
  let out = await buttonOn("Some prose.\n\n", 13, "code-block");
  assert.equal(out.text, "Some prose.\n\n```\n```");
  assert.deepEqual(out.ranges, [[16, 16]]);
  out = await buttonOn("Some prose.\n\n", 13, "code-block", 2);
  assert.equal(out.text, "Some prose.\n\n");
  assert.deepEqual(out.ranges, [[13, 13]]);
  // Text on both sides of the blank line: a blank line parts the block from
  // each, the air the page leaves around a block. A second press leaves
  // those two where they are: taking them would have glued the paragraphs
  // together in the case that reads the same, the caret two lines under
  // the text.
  out = await buttonOn("Before.\n\nAfter.\n", 8, "code-block");
  assert.equal(out.text, "Before.\n\n```\n```\n\nAfter.\n");
  assert.deepEqual(out.ranges, [[12, 12]]);
  out = await buttonOn("Before.\n\nAfter.\n", 8, "code-block", 2);
  assert.equal(out.text, "Before.\n\n\n\nAfter.\n");
  assert.deepEqual(out.ranges, [[9, 9]]);
});

test("with a bare caret in text the code block opens under the paragraph, heading, table or equation, never through it", { skip }, async () => {
  // Two lines, one paragraph.
  let out = await buttonOn("Here is the tune:\nstill the same paragraph.\n", 5, "code-block");
  assert.equal(out.text, "Here is the tune:\nstill the same paragraph.\n\n```\n```\n");
  assert.deepEqual(out.ranges, [[48, 48]]);
  out = await buttonOn("# Title\nText.\n", 3, "code-block");
  assert.equal(out.text, "# Title\n\n```\n```\n\nText.\n");
  out = await buttonOn("| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter.\n", 22, "code-block");
  assert.equal(out.text, "| a | b |\n|---|---|\n| 1 | 2 |\n\n```\n```\n\nAfter.\n");
  out = await buttonOn("$$\nE=mc^2\n$$\n\nAfter.\n", 5, "code-block");
  assert.equal(out.text, "$$\nE=mc^2\n$$\n\n```\n```\n\nAfter.\n");
  // Inside a callout, before its closing :::.
  out = await buttonOn("::: {.callout-note}\ninside\n:::\n", 26, "code-block");
  assert.equal(out.text, "::: {.callout-note}\ninside\n\n```\n```\n\n:::\n");
});

test("the code block button puts the selected lines in a block, under a longer fence when a fence is among them, and takes a block it cuts into whole", { skip }, async () => {
  let out = await buttonOn('print("hi")\nx = 1\n', [{ anchor: 0, head: 17 }], "code-block");
  assert.equal(out.text, '```\nprint("hi")\nx = 1\n```\n');
  assert.deepEqual(out.ranges, [[3, 3]]);
  // Blank lines at the edges stay outside, and so does the line a selection
  // ends at the head of (a triple click takes the line break).
  out = await buttonOn("\n\nx = 1\n\nnext\n", [{ anchor: 0, head: 9 }], "code-block");
  assert.equal(out.text, "\n\n```\nx = 1\n```\n\nnext\n");
  assert.deepEqual(out.ranges, [[5, 5]]);
  // A fence among the lines: one backtick more outside, as inline code
  // around a backtick gets a longer run.
  out = await buttonOn("para\n\n```\ncode\n```\n", [{ anchor: 0, head: 19 }], "code-block");
  assert.equal(out.text, "````\npara\n\n```\ncode\n```\n````\n");
  // Ending inside that fence takes the fence whole.
  out = await buttonOn("para\n\n```\ncode\n```\n", [{ anchor: 0, head: 12 }], "code-block");
  assert.equal(out.text, "````\npara\n\n```\ncode\n```\n````\n");
  // And a callout it runs into.
  out = await buttonOn("before\n\n::: {.callout-note}\ninside\n:::\n", [{ anchor: 0, head: 30 }], "code-block");
  assert.equal(out.text, "```\nbefore\n\n::: {.callout-note}\ninside\n:::\n```\n");
});

test("inside a fenced block the code block button takes the fences off and leaves the lines, in a quote and in a list as well", { skip }, async () => {
  let out = await buttonOn("```abc\nX:1\nK:C\n```\n", 10, "code-block");
  assert.equal(out.text, "X:1\nK:C\n");
  assert.deepEqual(out.ranges, [[3, 3]]);
  // From the fence line the caret lands at the head of what was the first
  // line of the block.
  out = await buttonOn("```abc\nX:1\n```\n", 6, "code-block");
  assert.equal(out.text, "X:1\n");
  assert.deepEqual(out.ranges, [[0, 0]]);
  out = await buttonOn("```abc\nX:1\n```\n", [{ anchor: 0, head: 14 }], "code-block");
  assert.equal(out.text, "X:1\n");
  out = await buttonOn("> ```abc\n> X:1\n> ```\n", 14, "code-block");
  assert.equal(out.text, "> X:1\n");
  out = await buttonOn("- ```\n  code\n  ```\n", 10, "code-block");
  assert.equal(out.text, "- code\n");
});

test("the code block carries the marks of the quote or the item it opens in, and Enter after the language goes on inside it", { skip }, async () => {
  let out = await buttonOn("> A quote.\n", 10, "code-block");
  assert.equal(out.text, "> A quote.\n>\n> ```\n> ```\n");
  // An empty quoted line takes the block, and gives back a bare > for it,
  // with no space left after the mark.
  out = await buttonOn("> T\n>\n> U\n", 5, "code-block");
  assert.equal(out.text, "> T\n>\n> ```\n> ```\n>\n> U\n");
  out = await buttonOn("> T\n>\n> U\n", 5, "code-block", 2);
  assert.equal(out.text, "> T\n>\n>\n>\n> U\n");
  // In a list no blank line: it would be all the block added to the list
  // besides itself.
  out = await buttonOn("- Violin\n- Viola\n", 8, "code-block");
  assert.equal(out.text, "- Violin\n  ```\n  ```\n- Viola\n");
  // An empty item takes the fence on its marker's line.
  out = await buttonOn("- Violin\n- \n", 11, "code-block");
  assert.equal(out.text, "- Violin\n- ```\n  ```\n");
  out = await buttonOn("- Violin\n- \n", 11, "code-block", 2);
  assert.equal(out.text, "- Violin\n- \n");
  // A task's box is content: the block stands at the item's column, where
  // Pandoc reads it as the item's; set past the box it is paragraph text.
  out = await buttonOn("- [ ] Buy milk\n", 14, "code-block");
  assert.equal(out.text, "- [ ] Buy milk\n  ```\n  ```\n");
  for (const [text, at, typed] of [
    ["> A quote.\n", 10, "> A quote.\n>\n> ```abc\n> X:1\n> ```\n"],
    ["- [ ] Buy milk\n", 14, "- [ ] Buy milk\n  ```abc\n  X:1\n  ```\n"],
  ]) {
    const h = await open({ text, scores: 0 });
    await setSelection(h.page, at);
    await h.page.click('#app button[data-type="code-block"]');
    await sleep(120);
    await h.page.keyboard.type("abc");
    await h.page.keyboard.press("Enter");
    await h.page.keyboard.type("X:1");
    assert.equal(await docText(h.page), typed);
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

// Enter's continuation counts a task's box, for the text after it, and the
// new line of a fence in a task was set past the box: four spaces of the
// item's own went into every line of the code, and a score's `X:1` was read
// indented (measured with Pandoc 3.8.3).
test("Enter in a fence inside a task keeps to the item's column, not past its box (G071)", { skip }, async () => {
  const out = await pressOn("- [ ] a\n  ```\n  x\n  ```\n", 17, ["Enter", { type: "y" }]);
  assert.equal(out.text, "- [ ] a\n  ```\n  x\n  y\n  ```\n");
});

// C, with the second modifier every block key has: the code block was on
// Notion's Ctrl+Shift+8 for a day and moved for the symmetry, so that every
// digit is a heading level and every block without one is a letter. Not E,
// the letter of its inline twin, which is Show Explorer in VS Code. The tip
// names the key as VS Code writes it on each platform.
test("Ctrl+Shift+C does what the code block button does, the tip names it, and abc typed after the backticks makes a score", { skip }, async () => {
  const text = "Some prose.\n\n";
  const tipOf = (page) =>
    page.evaluate(() => {
      const b = document.querySelector('#app button[data-type="code-block"]');
      return [b.getAttribute("aria-label"), b.getAttribute("aria-keyshortcuts")];
    });
  const h = await open({ text, scores: 0 });
  assert.deepEqual(await tipOf(h.page), ["Code block (Ctrl+Shift+C)", "Control+Shift+C"]);
  await setSelection(h.page, 13);
  await blockChord(h.page, "c");
  assert.equal(await docText(h.page), "Some prose.\n\n```\n```");
  assert.deepEqual(await selectionRanges(h.page), [[16, 16]]);
  await h.page.keyboard.type("abc");
  for (const line of ["X:1", "K:C", "CDEF|"]) {
    await h.page.keyboard.press("Enter");
    await h.page.keyboard.type(line);
  }
  assert.equal(await docText(h.page), "Some prose.\n\n```abc\nX:1\nK:C\nCDEF|\n```");
  await setSelection(h.page, 0);
  await h.page.waitForFunction(() => document.querySelectorAll("#app .mdm-score svg").length > 0, { timeout: 5000 });
  assert.deepEqual(h.errors, []);
  await h.close();

  const mac = await open({ text, scores: 0, platform: "MacIntel" });
  assert.deepEqual(await tipOf(mac.page), ["Code block (⌥⌘C)", "Meta+Alt+C"]);
  await setSelection(mac.page, 13);
  await chord(mac.page, ["Meta", "Alt"], "c");
  assert.equal(await docText(mac.page), "Some prose.\n\n```\n```");
  assert.deepEqual(mac.errors, []);
  await mac.close();
});

// The bar does not take the focus off the text. Unfocused the document draws
// itself with nobody in it, so the source of the caret's line went away for
// as long as a button was held down and came back when it was let go: the
// owner saw the `##` of a heading go and return around a press on the
// heading menu (2026-09-19), and it was every button of the bar. Measured
// with the button held, which is where it shows; the pointer leaves the
// button before it is let go, so no press is made and the text is the same
// one throughout.
test("a button held down leaves the caret's line showing its source, and the focus in the text", { skip }, async () => {
  const h = await open({ text: "## From equations to score\n\nBody.\n", scores: 0 });
  await setSelection(h.page, 6);
  await sleep(150);
  const state = () =>
    h.page.evaluate(() => [document.querySelector("#app .cm-line").textContent, window.__mdm.view.hasFocus]);
  assert.deepEqual(await state(), ["## From equations to score", true]);
  for (const name of ["headings", "bold", "unordered-list", "mdm-theme"]) {
    const at = await h.page.evaluate((n) => {
      const b = document.querySelector('#app button[data-type="' + n + '"]').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, name);
    await h.page.mouse.move(at.x, at.y);
    await h.page.mouse.down();
    await sleep(60);
    assert.deepEqual(await state(), ["## From equations to score", true], name + " held down");
    await h.page.mouse.move(at.x, at.y + 300);
    await h.page.mouse.up();
    await sleep(80);
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---- The rest of the block keys ----

// The digit is the level, 0 the paragraph, and a letter names the block that
// has no level (D19). The keys are the page's own keymap and carry
// CodeMirror's stopPropagation, so a key answered here never reaches the
// workbench as well. Two of the letters are left: C for the code block and T
// for the boxes. U, O and Q were the bullets, the numbers and the quote for
// a day and were given back on 2026-09-19 (the marks are so little to type
// that the chord bought nothing, and on Linux fcitx5 takes Ctrl+Shift+U for
// its `U+` prompt before any editor sees it), so they are pressed here to
// prove they do nothing and reach VS Code instead.
//
// Pressed the way a keyboard presses them, which is not the way
// page.keyboard.press does: a browser applies Shift to `key` itself, so
// Ctrl+Shift+U arrives as "U" and Ctrl+Shift+2 as whatever the layout writes
// over the 2, while press("2") with Shift held sends a plain "2".
// CodeMirror reads those through different branches of its keymap (it falls
// back to the key's base name by keyCode), and one of them is not the branch
// a keyboard reaches: with Puppeteer's own "u", Ctrl+Shift+U ran Ctrl+U
// first, which is undoSelection in historyKeymap. The owner's board is the
// Spanish one, where none of these digits is the character it is named
// after, so that is the layout the keys are pressed in here.
const LAYOUTS = {
  // code and keyCode of the key, then what each layout writes with Shift.
  0: ["Digit0", 48, { us: ")", es: "=" }],
  1: ["Digit1", 49, { us: "!", es: "!" }],
  2: ["Digit2", 50, { us: "@", es: '"' }],
  3: ["Digit3", 51, { us: "#", es: "\u00b7" }],
  5: ["Digit5", 53, { us: "%", es: "%" }],
  6: ["Digit6", 54, { us: "^", es: "&" }],
  c: ["KeyC", 67, { us: "C", es: "C" }],
  u: ["KeyU", 85, { us: "U", es: "U" }],
  o: ["KeyO", 79, { us: "O", es: "O" }],
  t: ["KeyT", 84, { us: "T", es: "T" }],
  q: ["KeyQ", 81, { us: "Q", es: "Q" }],
};

// Ctrl+Shift+<name> on `layout`, dispatched through CDP because Puppeteer's
// keyboard cannot send a shifted character with its own keyCode.
async function blockChord(page, name, layout) {
  const [code, keyCode, shifted] = LAYOUTS[name];
  const cdp = await page.createCDPSession();
  for (const type of ["rawKeyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", {
      type: type,
      key: shifted[layout || "es"],
      code: code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      // Ctrl and Shift, as CDP numbers the modifiers.
      modifiers: 2 | 8,
    });
  }
  await cdp.detach();
}

// `text` with the caret at `pos` and Ctrl+Shift+<name> pressed on `layout`.
async function blockKeyOn(text, pos, name, layout) {
  const h = await open({ text, scores: 0 });
  await setSelection(h.page, Array.isArray(pos) ? pos.map((p) => (typeof p === "number" ? { anchor: p } : p)) : pos);
  await blockChord(h.page, name, layout);
  await sleep(120);
  const out = await docText(h.page);
  assert.deepEqual(h.errors, []);
  await h.close();
  return out;
}

test("Ctrl+Shift+<digit> sets the heading of that level, the level a line has takes it off, and 0 is the paragraph", { skip }, async () => {
  assert.equal(await blockKeyOn("Title\n\nBody.\n", 2, 2), "## Title\n\nBody.\n");
  // The level the line already is, as the ticked row of the menu does.
  assert.equal(await blockKeyOn("## Title\n", 4, 2), "Title\n");
  // Another level over it, and the levels past Notion's row of three.
  assert.equal(await blockKeyOn("## Title\n", 4, 5), "##### Title\n");
  assert.equal(await blockKeyOn("## Title\n", 4, 6), "###### Title\n");
  // 0 is the paragraph whatever the level was, which is what it is for: at
  // the keyboard nothing says what level the line is.
  assert.equal(await blockKeyOn("###### Title\n", 8, 0), "Title\n");
  assert.equal(await blockKeyOn("Body.\n", 2, 0), "Body.\n");
  // Every selected line, blank lines left alone, as a row does.
  assert.equal(await blockKeyOn("one\n\ntwo\n", [{ anchor: 0, head: 8 }], 3), "### one\n\n### two\n");
  // Not in a score, where no heading belongs: the line is left as it is.
  assert.equal(await blockKeyOn("```abc\nX:1\n```\n", 9, 1), "```abc\nX:1\n```\n");
  // The same key on a US board, where the 2 writes an at sign and not a
  // quote: the level is the key's own, not the character it prints.
  assert.equal(await blockKeyOn("Title\n", 2, 2, "us"), "## Title\n");
});

test("Ctrl+Shift+T does what its button does, and the lists and the quote name no key", { skip }, async () => {
  const tips = (page) =>
    page.evaluate(() =>
      ["unordered-list", "ordered-list", "task-list", "quote"].map((name) => {
        const b = document.querySelector('#app button[data-type="' + name + '"]');
        return [b.getAttribute("aria-label"), b.getAttribute("aria-keyshortcuts")];
      })
    );
  const h = await open({ text: "Violin\n", scores: 0 });
  // U, O and Q were theirs for a day and went on 2026-09-19: a tip that
  // names a key the editor no longer answers is a tip that lies, so the
  // three name none, and carry no aria-keyshortcuts for a screen reader
  // either.
  assert.deepEqual(await tips(h.page), [
    ["Unordered list", null],
    ["Ordered list", null],
    ["Task list (Ctrl+Shift+T)", "Control+Shift+T"],
    ["Quote", null],
  ]);
  assert.deepEqual(h.errors, []);
  await h.close();

  // Every button writes its own mark, key or no key.
  const pairs = [
    ["unordered-list", "- Violin\n"],
    ["ordered-list", "1. Violin\n"],
    ["task-list", "- [ ] Violin\n"],
    ["quote", "> Violin\n"],
  ];
  for (const [button, written] of pairs) {
    const byButton = await buttonOn("Violin\n", 3, button);
    assert.equal(byButton.text, written, button);
  }
  // The one key left boxes the line and, pressed again, takes the box off
  // and leaves the item, as its button does.
  assert.equal(await blockKeyOn("Violin\n", 3, "t"), "- [ ] Violin\n");
  assert.equal(await blockKeyOn("- [ ] Violin\n", 8, "t"), "- Violin\n");
  // The three that went leave the text alone now.
  for (const name of ["u", "o", "q"]) assert.equal(await blockKeyOn("Violin\n", 3, name), "Violin\n", name);

  // On a Mac the row is Cmd+Option, where Cmd+Shift+3, 4 and 5 are the
  // system's screenshots.
  const mac = await open({ text: "Violin\n", scores: 0, platform: "MacIntel" });
  assert.deepEqual((await tips(mac.page))[2], ["Task list (\u2325\u2318T)", "Meta+Alt+T"]);
  await setSelection(mac.page, 3);
  await chord(mac.page, ["Meta", "Alt"], "t");
  assert.equal(await docText(mac.page), "- [ ] Violin\n");
  assert.deepEqual(mac.errors, []);
  await mac.close();
});

// ---- The clicks of the bench (section 22) ----

// The centre of the first element under #app that `selector` matches and
// whose text holds `needle`, shifted by `dx` from its left edge when given.
function centerOf(page, selector, needle, dx) {
  return page.evaluate(
    (selector, needle, dx) => {
      const el = Array.from(document.querySelectorAll("#app " + selector)).find(
        (e) => needle === null || e.textContent.includes(needle)
      );
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: dx === null ? b.left + b.width / 2 : b.left + dx, y: b.top + b.height / 2 };
    },
    selector,
    needle === undefined ? null : needle,
    dx === undefined ? null : dx
  );
}

test("a click on the drawn bullet or number puts the caret at the item's text (ED25, G066)", { skip }, async () => {
  // The drawing stands for `- `: the caret used to land beside the hidden
  // dash, and the letter typed next unmade the item (`x- Viola`).
  let h = await open({ text: "- Violin\n- Viola\n", scores: 0 });
  await sleep(200);
  let at = await h.page.evaluate(() => {
    const b = document.querySelectorAll("#app .mdm-bullet")[1].getBoundingClientRect();
    return { x: b.left + 3, y: b.top + b.height / 2 };
  });
  await h.page.mouse.click(at.x, at.y);
  await sleep(150);
  await h.page.keyboard.type("x");
  assert.equal(await docText(h.page), "- Violin\n- xViola\n");
  assert.deepEqual(h.errors, []);
  await h.close();
  // The number of an ordered item, clicked on its right half.
  h = await open({ text: "1. one\n2. two\n", scores: 0 });
  await sleep(200);
  at = await h.page.evaluate(() => {
    const b = document.querySelectorAll("#app .mdm-li-number")[1].getBoundingClientRect();
    return { x: b.right - 3, y: b.top + b.height / 2 };
  });
  await h.page.mouse.click(at.x, at.y);
  await sleep(150);
  await h.page.keyboard.type("x");
  assert.equal(await docText(h.page), "1. one\n2. xtwo\n");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a task box flips its own text inside a quote and on a `2)` item (G076)", { skip }, async () => {
  const text = "> - [ ] quoted task\n\n2) [x] paren task\n\n> 1. [x] quote ordered\n";
  const h = await open({ text, scores: 0 });
  await sleep(200);
  for (let i = 0; i < 3; i++) {
    const at = await h.page.evaluate((i) => {
      const b = document.querySelectorAll("#app input.mdm-task")[i].getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, i);
    await h.page.mouse.click(at.x, at.y);
    await sleep(700);
  }
  assert.equal(await docText(h.page), "> - [x] quoted task\n\n2) [ ] paren task\n\n> 1. [ ] quote ordered\n");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Ctrl+click follows a link, Alt+click when Ctrl adds a caret, and a plain click edits it (ED12, G083)", { skip }, async () => {
  const text = "See [CommonMark](https://spec.commonmark.org/0.31.2/) and <https://x.org> and https://y.org and <a@b.org>.\n";
  let h = await open({ text, scores: 0 });
  await sleep(200);
  const posts = () => h.page.evaluate(() => window.__posts.filter((m) => m.type === "openLink").map((m) => m.href));
  const ctrlClick = async (needle, mod) => {
    const at = await centerOf(h.page, ".mdm-link", needle);
    assert.ok(at, "no link drawn for " + needle);
    await h.page.keyboard.down(mod || "Control");
    await h.page.mouse.click(at.x, at.y);
    await h.page.keyboard.up(mod || "Control");
    await sleep(700);
  };
  // A plain click puts the caret in the label and follows nothing.
  let at = await centerOf(h.page, ".mdm-link", "CommonMark");
  await h.page.mouse.click(at.x, at.y);
  await sleep(700);
  const head = (await selectionRanges(h.page))[0][0];
  assert.ok(head >= 5 && head <= 15, "the caret is not in the label: " + head);
  assert.deepEqual(await posts(), []);
  // Ctrl+click follows it, and moves no caret.
  const before = await selectionRanges(h.page);
  await ctrlClick("CommonMark");
  assert.deepEqual(await posts(), ["https://spec.commonmark.org/0.31.2/"]);
  assert.deepEqual(await selectionRanges(h.page), before, "Ctrl+click moved the caret");
  // An autolink and a bare address are their own destination, and an
  // address with an @ and no scheme is mail.
  await ctrlClick("x.org");
  await ctrlClick("y.org");
  await ctrlClick("a@b.org");
  assert.deepEqual(await posts(), [
    "https://spec.commonmark.org/0.31.2/",
    "https://x.org",
    "https://y.org",
    "mailto:a@b.org",
  ]);
  assert.deepEqual(h.errors, []);
  await h.close();
  // With editor.multiCursorModifier = ctrlCmd, Ctrl+click adds a caret and
  // Alt+click is what follows, as VS Code swaps them.
  h = await open({ text, scores: 0, seed: { settings: { multiCursorModifier: "ctrlCmd" } } });
  await sleep(200);
  await setSelection(h.page, 0);
  await ctrlClick("CommonMark");
  assert.deepEqual(await posts(), []);
  assert.equal((await selectionRanges(h.page)).length, 2, "Ctrl+click did not add a caret");
  await ctrlClick("CommonMark", "Alt");
  assert.deepEqual(await posts(), ["https://spec.commonmark.org/0.31.2/"]);
  assert.deepEqual(h.errors, []);
  await h.close();
  // A link to a heading of this document moves the caret to the heading,
  // and nothing goes to the host.
  h = await open({ text: "# Scales again\n\nSee [the scales](#scales-again) below.\n", scores: 0 });
  await sleep(200);
  await ctrlClick("the scales");
  assert.deepEqual(await posts(), []);
  assert.deepEqual(await selectionRanges(h.page), [[2, 2]]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a paste that carries no text leaves the selection as it was (G082)", { skip }, async () => {
  const h = await open({ text: "Insert placeholder here\n", scores: 0 });
  await setSelection(h.page, [{ anchor: 7, head: 18 }]);
  const paste = (types) =>
    h.page.evaluate((types) => {
      const dt = new DataTransfer();
      for (const [type, value] of types) dt.setData(type, value);
      const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      window.__mdm.view.contentDOM.dispatchEvent(ev);
    }, types);
  // Rich text alone, as a page copies it: the word stays, selected still.
  await paste([["text/html", "<b>rich</b>"]]);
  await sleep(100);
  assert.equal(await docText(h.page), "Insert placeholder here\n");
  assert.deepEqual(await selectionRanges(h.page), [[7, 18]]);
  // Text on the clipboard is pasted as ever.
  await paste([["text/plain", "a word"]]);
  await sleep(100);
  assert.equal(await docText(h.page), "Insert a word here\n");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Up and Down step into a hidden block past a rule glued to it (G101)", { skip }, async () => {
  let text = "Before.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n***\nAfter.\n";
  let out = await pressOn(text, text.indexOf("After"), ["ArrowUp"]);
  assert.equal(out.text, text);
  const last = text.indexOf("| 1 | 2 |");
  assert.ok(out.head >= last && out.head <= last + 9, "Up did not enter the table past the rule: " + out.head);
  text = "Before.\n***\n| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter.\n";
  out = await pressOn(text, 3, ["ArrowDown"]);
  assert.equal(out.text, text);
  const first = text.indexOf("| a | b |");
  assert.ok(out.head >= first && out.head <= first + 9, "Down did not enter the table past the rule: " + out.head);
});

// ---- The outline and the search ----

test("the outline lists every heading of a long document as the parse lands, with no caret move (G111)", { skip }, async () => {
  // Opened with the panel shown, the list was filled once from the first
  // 3000 characters parsed and stayed there until a keystroke.
  const filler = "Some prose to fill the section with words enough to matter. ".repeat(6) + "\n\n";
  let text = "";
  for (let i = 1; i <= 80; i++) text += "## Section " + i + "\n\n" + filler;
  let h = await open({ text, scores: 0, seed: { settings: { outline: "shown", frontMatter: "hidden" } } });
  await sleep(600);
  const rows = (page) => page.evaluate(() => document.querySelectorAll("#app .mdm-outline__row").length);
  assert.equal(await rows(h.page), 80);
  assert.deepEqual(h.errors, []);
  await h.close();
  // Past the parser's own reach, the viewport and 100000 characters after
  // it: the rest is parsed for the panel between frames.
  const big = "Words of prose that fill the section with text enough to count. ".repeat(16) + "\n\n";
  text = "";
  for (let i = 1; i <= 300; i++) text += "## Section " + i + "\n\n" + big;
  assert.ok(text.length > 250000, "the document is not past the parser's reach: " + text.length);
  h = await open({ text, scores: 0, seed: { settings: { outline: "shown", frontMatter: "hidden" } } });
  await h.page.waitForFunction(() => document.querySelectorAll("#app .mdm-outline__row").length === 300, { timeout: 15000 });
  assert.equal(await rows(h.page), 300);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an outline row reads as the editor draws the heading: marks off, a link its label, maths set, a sharp kept, a setext heading whole, attributes off (G112, G113)", { skip }, async () => {
  const text =
    [
      "## Sonata in F#",
      "",
      "## Title ##",
      "",
      "# A *heading* with `code`, $e^{i\\pi}+1=0$, a [link](https://commonmark.org)",
      "",
      "Theme and",
      "variations",
      "=========",
      "",
      "## Attributed {#sec-attr .unnumbered}",
      "",
      "> ## Quoted",
      "",
      "- ## In a list",
      "",
    ].join("\n") + "\n";
  const h = await open({ text, scores: 0, seed: { settings: { outline: "shown", frontMatter: "hidden" } } });
  await sleep(400);
  const rows = await h.page.evaluate(() =>
    Array.from(document.querySelectorAll("#app .mdm-outline__row")).map((r) => ({
      text: r.textContent,
      title: r.title,
      katex: r.querySelectorAll(".katex").length,
      marks: Array.from(r.querySelectorAll("em, code, .mdm-link")).map((e) => e.tagName.toLowerCase()),
    }))
  );
  assert.deepEqual(
    rows.map((r) => r.title),
    [
      "Sonata in F#",
      "Title",
      "A heading with code, $e^{i\\pi}+1=0$, a link",
      "Theme and variations",
      "Attributed",
      "Quoted",
      "In a list",
    ]
  );
  assert.deepEqual(rows.map((r) => r.text).filter((t, i) => i !== 2), ["Sonata in F#", "Title", "Theme and variations", "Attributed", "Quoted", "In a list"]);
  assert.ok(rows[2].text.startsWith("A heading with code, ") && rows[2].text.endsWith(", a link"), "the row shows source: " + rows[2].text);
  assert.equal(rows[2].katex, 1, "the equation is not set in the row");
  assert.deepEqual(rows[2].marks, ["em", "code", "span"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("Ctrl+F opens the search from an unfocused document, and a match inside a hidden block opens the block (G118)", { skip }, async () => {
  const text = "Prose with GABc in it.\n\n```text\nGABc again\n```\n\nAfter.\n";
  const h = await open({ text, scores: 0 });
  await sleep(200);
  assert.equal(await h.page.evaluate(() => window.__mdm.view.hasFocus), false, "the document opened focused");
  await chord(h.page, ["Control"], "f");
  await sleep(200);
  assert.equal(await h.page.evaluate(() => !!document.querySelector("#app .mdm-search")), true, "no search panel opened");
  assert.equal(
    await h.page.evaluate(() => document.activeElement && document.activeElement.getAttribute("name") === "search"),
    true,
    "the search field did not take the focus"
  );
  await h.page.keyboard.type("GABc");
  await h.page.keyboard.press("Enter");
  await sleep(200);
  assert.deepEqual(await selectionRanges(h.page), [[text.indexOf("GABc"), text.indexOf("GABc") + 4]]);
  // The next match sits in a hidden code block: selected, it is in view,
  // with the block open around it.
  await h.page.keyboard.press("Enter");
  await sleep(300);
  const second = text.indexOf("GABc again");
  assert.deepEqual(await selectionRanges(h.page), [[second, second + 4]]);
  assert.ok(
    (await h.page.evaluate(() => document.querySelectorAll("#app .cm-line.mdm-fence-line").length)) > 0,
    "the code block did not open on its match"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The panel is inside the view and outside the text, and the handler that
// takes a press in the margin beside the text (deadMargin in main.js) took a
// press on it too: a click on the search field left the focus on the body,
// so what was typed went nowhere and Escape could not close the panel. Each
// control of the panel is pressed with the pointer here, as a reader does.
test("the search panel takes the pointer: a click on its field types there, and Escape or its button closes it", { skip }, async () => {
  const text = "Prose with a word in it, and another word.\n";
  const h = await open({ text, scores: 0 });
  await setSelection(h.page, 2);
  await chord(h.page, ["Control"], "f");
  await sleep(200);
  // Back into the text, and then to the field by the pointer.
  await h.page.click("#app .cm-content");
  await h.page.click('#app .mdm-search [name="search"]');
  assert.equal(
    await h.page.evaluate(() => document.activeElement && document.activeElement.getAttribute("name")),
    "search",
    "a click on the search field did not give it the focus"
  );
  await h.page.keyboard.type("word");
  assert.equal(await h.page.$eval('#app .mdm-search [name="search"]', (f) => f.value), "word");
  await h.page.click('#app .mdm-search [name="replace"]');
  await h.page.keyboard.type("term");
  assert.equal(await h.page.$eval('#app .mdm-search [name="replace"]', (f) => f.value), "term");
  await h.page.click('#app .mdm-search [name="replaceAll"]');
  assert.equal(await docText(h.page), text.replace(/word/g, "term"));
  // Escape from the field closes the panel.
  await h.page.click('#app .mdm-search [name="search"]');
  await h.page.keyboard.press("Escape");
  await sleep(100);
  assert.equal(await h.page.evaluate(() => !!document.querySelector("#app .mdm-search")), false, "Escape left the panel open");
  // And so does its own button.
  await chord(h.page, ["Control"], "f");
  await sleep(200);
  await h.page.click('#app .mdm-search [name="close"]');
  await sleep(100);
  assert.equal(await h.page.evaluate(() => !!document.querySelector("#app .mdm-search")), false, "the close button left the panel open");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The search is a row under the toolbar, the way the player's row is
// (searchPanel in main.js, design-search.html variant C): it stands between
// the bar and the text rather than over the text, its controls are the
// toolbar's brass buttons, an option that is on sits on the disc, and it
// counts the matches as VS Code does ("2 of 5", "? of 5" off every match).
test("the search is a row under the toolbar that counts its matches and keeps its options on the disc", { skip }, async () => {
  const text = "A word, a Word, a WORD.\n\nMore words and a word.\n";
  const h = await open({ text, scores: 0 });
  // Ctrl+F over a selected word searches for it.
  await setSelection(h.page, [{ anchor: 2, head: 6 }]);
  await chord(h.page, ["Control"], "f");
  await sleep(200);
  const panel = () =>
    h.page.evaluate(() => {
      const p = document.querySelector("#app .mdm-search");
      const bar = document.querySelector("#app .mdm-toolbar").getBoundingClientRect();
      const row = document.querySelector("#app .cm-panels-top").getBoundingClientRect();
      const first = document.querySelector("#app .cm-content .cm-line").getBoundingClientRect();
      const ink = getComputedStyle(document.querySelector("#app .mdm-toolbar .mdm-btn")).color;
      return {
        value: p.querySelector('[name="search"]').value,
        focus: document.activeElement && document.activeElement.getAttribute("name"),
        count: p.querySelector(".mdm-search__count").textContent,
        on: [...p.querySelectorAll(".mdm-btn--on")].map((b) => b.name),
        gap: row.top - bar.bottom,
        clear: first.top - row.bottom,
        glyphs: [...p.querySelectorAll("button")].map((b) => [b.name, b.classList.contains("mdm-btn"), getComputedStyle(b).color === ink]),
      };
    });
  let seen = await panel();
  assert.equal(seen.value, "word");
  assert.equal(seen.focus, "search");
  // The field with the keyboard is ringed in the brass by its own 1px border
  // and nothing over it: a box-shadow made it a 2px ring, which the owner
  // found too heavy (2026-09-19).
  const ring = await h.page.evaluate(() => {
    const f = getComputedStyle(document.querySelector("#app .mdm-search__field--find"));
    const brass = getComputedStyle(document.querySelector("#app")).getPropertyValue("--mdm-play-accent").trim();
    const probe = document.createElement("span");
    probe.style.color = brass;
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return { width: f.borderTopWidth, color: f.borderTopColor, want, shadow: f.boxShadow };
  });
  assert.equal(ring.width, "1px");
  assert.equal(ring.color, ring.want, "the focused field is not ringed in the brass");
  assert.equal(ring.shadow, "none", "the focused field has a second ring over its border");
  assert.ok(Math.abs(seen.gap) <= 1, "the row does not stand under the toolbar: " + seen.gap);
  assert.ok(seen.clear >= 0, "the row covers the text by " + -seen.clear + "px");
  for (const [name, btn, brass] of seen.glyphs) {
    assert.ok(btn && brass, "the " + name + " button is not one of the toolbar's brass buttons");
  }
  assert.deepEqual(
    seen.glyphs.map((g) => g[0]),
    ["case", "word", "re", "prev", "next", "select", "replace", "replaceAll", "close"]
  );
  // Five matches without the case, the selection on the first.
  assert.equal(seen.count, "1 of 5");
  await h.page.keyboard.press("Enter");
  assert.equal((await panel()).count, "2 of 5");
  await h.page.keyboard.down("Shift");
  await h.page.keyboard.press("Enter");
  await h.page.keyboard.up("Shift");
  assert.equal((await panel()).count, "1 of 5");
  // The case on: the disc, and three matches.
  await h.page.click('#app .mdm-search [name="case"]');
  seen = await panel();
  assert.deepEqual(seen.on, ["case"]);
  assert.equal(seen.focus, "search", "a press on an option took the focus out of the field");
  assert.equal(seen.count, "1 of 3");
  // Whole words as well: "words" goes.
  await h.page.click('#app .mdm-search [name="word"]');
  assert.equal((await panel()).count, "1 of 2");
  // Off every match, the place is unknown.
  await setSelection(h.page, 0);
  assert.equal((await panel()).count, "? of 2");
  await h.page.click('#app .mdm-search [name="search"]');
  await h.page.keyboard.press("End");
  await h.page.keyboard.type("zz");
  assert.equal((await panel()).count, "No results");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The row is under the toolbar's drop-downs and over the text. CodeMirror's
// base theme stacks its panels at 300, and the theme menu, which hangs from
// the toolbar (z-index 2), opened under the search row (seen 2026-09-19);
// the row is at 1 now, still over the scroller, which is a layer of its own
// at 0. Read with elementFromPoint where the two overlap, and over the text
// scrolled under the row.
test("a drop-down of the toolbar opens over the search row, and the text scrolls under it", { skip }, async () => {
  const text = Array.from({ length: 80 }, (_, i) => "Line " + i + " with a word in it.").join("\n\n") + "\n";
  const h = await open({ text, scores: 0 });
  await setSelection(h.page, 3);
  await chord(h.page, ["Control"], "f");
  await sleep(200);
  await h.page.click('#app button[data-type="mdm-theme"]');
  await sleep(200);
  const hit = await h.page.evaluate(() => {
    const row = document.querySelector("#app .cm-panels-top").getBoundingClientRect();
    const menu = document.querySelector("#app .mdm-toolbar__item--open .mdm-menu").getBoundingClientRect();
    const x = Math.max(row.left, menu.left) + 10;
    const y = (Math.max(row.top, menu.top) + Math.min(row.bottom, menu.bottom)) / 2;
    const el = document.elementFromPoint(x, y);
    return { overlap: menu.top < row.bottom && menu.bottom > row.top, inMenu: !!(el && el.closest(".mdm-menu")), el: el && el.className };
  });
  assert.ok(hit.overlap, "the menu does not reach down over the search row, so this reads nothing");
  assert.ok(hit.inMenu, "the search row is drawn over the theme menu: " + hit.el);
  // A click on the text puts the menu away and leaves the search open.
  await h.page.click("#app .cm-content");
  await h.page.evaluate(() => {
    window.__mdm.view.scrollDOM.scrollTop = 600;
  });
  await sleep(200);
  const over = await h.page.evaluate(() => {
    const row = document.querySelector("#app .cm-panels-top").getBoundingClientRect();
    const content = document.querySelector("#app .cm-content").getBoundingClientRect();
    const el = document.elementFromPoint(content.left + 20, (row.top + row.bottom) / 2);
    return { under: content.top < row.top, inRow: !!(el && el.closest(".cm-panels")), el: el && el.className };
  });
  assert.ok(over.under, "the text was not scrolled under the row, so this reads nothing");
  assert.ok(over.inRow, "the text is drawn over the search row: " + over.el);
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
    return {
      contenteditable: prev.getAttribute("contenteditable"),
      height: prev.offsetHeight,
      className: prev.className,
      line: prev.getAttribute("data-mdm-line"),
    };
  });
  // The cover over the source takes no height and is not editable, as
  // CodeMirror's own placeholder was; what it adds is the number of the first
  // line it swallows, drawn in the margin beside the drawing (the `$$` of MATH
  // is line 3).
  assert.deepEqual(hidden, {
    contenteditable: "false",
    height: 0,
    className: "mdm-blockline",
    line: "3",
  });
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

test("an update carrying CRs gains no line and moves no caret", { skip }, async () => {
  // The host sends LF (see transforms.js), but a CR that got through used to
  // rewrite the document from the first line break on: CodeMirror splits an
  // inserted string on /\r\n?|\n/, so the CR left dangling at the end of the
  // replacement came out as one more line, and the caret was mapped to the
  // start of the change, which is the end of line 1.
  const h = await open({ text: "alpha\nbeta\ngamma\n", scores: 0 });
  await setSelection(h.page, 8); // after "be"
  await hostUpdate(h.page, "alpha\r\nbeta\r\ngamma\r\n");
  await sleep(100);
  // The caret first: it is the half the text assertion would hide by failing
  // ahead of it, and the half the bug was named after.
  assert.deepEqual(await selectionRanges(h.page), [[8, 8]]);
  assert.equal(await docText(h.page), "alpha\nbeta\ngamma\n");
  // And a real change inside a CRLF text still lands, in LF.
  await hostUpdate(h.page, "alpha\r\nbeta\r\ngammas\r\n");
  await sleep(100);
  assert.equal(await docText(h.page), "alpha\nbeta\ngammas\n");
  assert.deepEqual(await selectionRanges(h.page), [[8, 8]]);
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

// The four buttons that share a Mod- binding name it in their tip, and the
// chord a tip names is the one that does what the button does: each is
// pressed on a selected word and the file compared with a click of the button
// on the same selection. On a Mac the tip says the Cmd CodeMirror binds `Mod`
// to there, read under a navigator.platform that says Mac.
test("the bold, italic, code and link buttons name the shortcut that does what they do", { skip }, async () => {
  const text = "one word here\n";
  const h = await open({ text, scores: 0 });
  const buttons = ["bold", "italic", "inline-code", "link"];
  const tips = await h.page.evaluate((names) =>
    names.map((n) => {
      const b = document.querySelector('#app button[data-type="' + n + '"]');
      return [b.getAttribute("aria-label"), b.getAttribute("aria-keyshortcuts")];
    }), buttons);
  assert.deepEqual(tips, [
    ["Bold (Ctrl+B)", "Control+B"],
    ["Italic (Ctrl+I)", "Control+I"],
    ["Inline code (Ctrl+E)", "Control+E"],
    ["Link (Ctrl+K)", "Control+K"],
  ]);
  const word = [{ anchor: 4, head: 8 }];
  for (let i = 0; i < buttons.length; i++) {
    const key = /\(Ctrl\+(.)\)$/.exec(tips[i][0])[1].toLowerCase();
    await setSelection(h.page, word);
    await h.page.click('#app button[data-type="' + buttons[i] + '"]');
    const clicked = await docText(h.page);
    assert.notEqual(clicked, text, buttons[i] + " changed nothing, so the comparison reads nothing");
    await h.page.evaluate((t) => {
      const view = window.__mdm.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
    }, text);
    await setSelection(h.page, word);
    await chord(h.page, ["Control"], key);
    assert.equal(await docText(h.page), clicked, "Ctrl+" + key.toUpperCase() + " does not do what " + buttons[i] + " does");
    await h.page.evaluate((t) => {
      const view = window.__mdm.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
    }, text);
  }
  assert.deepEqual(h.errors, []);
  await h.close();

  const mac = await open({ text, scores: 0, platform: "MacIntel" });
  const macTips = await mac.page.evaluate(() => {
    const b = document.querySelector('#app button[data-type="bold"]');
    return [navigator.platform, b.getAttribute("aria-label"), b.getAttribute("aria-keyshortcuts")];
  });
  assert.deepEqual(macTips, ["MacIntel", "Bold (\u2318B)", "Meta+B"]);
  // And the Cmd it names is what CodeMirror binds there.
  await setSelection(mac.page, word);
  await chord(mac.page, ["Meta"], "b");
  assert.equal(await docText(mac.page), "one **word** here\n");
  await mac.close();
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

test("ArrowDown crosses every wrapped row before opening an adjacent score", { skip }, async () => {
  const paragraph =
    "That is what the score below draws, one note per mode: each n is a partial, the name acoustics gives to a single component of a complex sound. The upper system is the first eight partials of a low C, the lower one pairs each partial with the next and names the ratio underneath; the seventh is the odd one out, 31 cents flat of the tempered minor seventh, hence the mark over the B flat.";
  const text = paragraph + "\n```abc\nX:1\nK:C\nCDEF|\n```\n";
  const h = await open({ text: text, scores: 1 });
  await h.page.setViewport({ width: 480, height: 900 });
  await sleep(150);

  // Pick one position near the left edge of every visual row. There is no
  // blank document line between this paragraph and the hidden ABC source:
  // that is the case in which the block handler used to mistake every row
  // for the last one and jump straight to the score.
  const rows = await h.page.evaluate(() => {
    const { view } = window.__mdm;
    const line = view.state.doc.line(1);
    const byTop = [];
    for (let pos = line.from; pos <= line.to; pos++) {
      const c = view.coordsAtPos(pos, 1);
      if (!c) continue;
      const top = Math.round(c.top);
      let row = byTop.find((r) => Math.abs(r.top - top) <= 1);
      if (!row) {
        row = { top: top, pos: pos, left: c.left };
        byTop.push(row);
      } else if (c.left < row.left) {
        row.pos = pos;
        row.left = c.left;
      }
    }
    return byTop.sort((a, b) => a.top - b.top);
  });
  assert.ok(rows.length >= 3, "the paragraph did not wrap: " + JSON.stringify(rows));

  for (let i = 0; i < rows.length - 1; i++) {
    await setSelection(h.page, rows[i].pos);
    await h.page.keyboard.press("ArrowDown");
    const landed = await h.page.evaluate(() => {
      const { view } = window.__mdm;
      const head = view.state.selection.main.head;
      const c = view.coordsAtPos(head);
      return { line: view.state.doc.lineAt(head).number, top: Math.round(c.top) };
    });
    assert.equal(landed.line, 1, "row " + (i + 1) + " jumped into the score");
    assert.ok(landed.top > rows[i].top, "ArrowDown did not leave visual row " + (i + 1));
  }

  await setSelection(h.page, rows[rows.length - 1].pos);
  await h.page.keyboard.press("ArrowDown");
  assert.equal(
    await h.page.evaluate(() => {
      const { view } = window.__mdm;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    }),
    2,
    "the last visual row did not open the adjacent score"
  );
  assert.ok((await count(h.page, ".cm-line.mdm-abc-line")) > 0);
  assert.deepEqual(h.errors, []);
  await h.close();
});

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

test("a code block carries a copy button, and nothing else, beside it", { skip }, async () => {
  const h = await open({ text: CODE, scores: 0 });
  assert.equal(await count(h.page, ".cm-line.mdm-code-line"), 1);
  assert.equal(await count(h.page, ".cm-line.mdm-fence-line"), 0);
  // The corner used to name the language as well ("python", beside the
  // button); the chrome is the button alone now, in the rail in the margin,
  // put away at rest and up while the pointer is on the block or its source
  // is open. What is put away is the button, and the rail keeps its box.
  const chrome = () =>
    h.page.evaluate(() => {
      const all = document.querySelectorAll("#app .mdm-chrome.mdm-chrome--code");
      const c = all[0];
      return c
        ? {
            rails: all.length,
            text: c.textContent,
            buttons: Array.from(c.children).map((b) => b.classList[0]),
            shown: Array.from(c.children).every((b) => getComputedStyle(b).visibility === "visible"),
          }
        : null;
    });
  const away = await coordsAt(h.page, 2);
  await h.page.mouse.move(away.x, away.y);
  await sleep(100);
  assert.deepEqual(await chrome(), { rails: 1, text: "", buttons: ["mdm-copy"], shown: false });
  const over = await coordsAt(h.page, (await posOf(h.page, "x = 1")) + 2);
  await h.page.mouse.move(over.x, over.y);
  await sleep(200);
  assert.equal((await chrome()).shown, true, "the copy did not come up with the pointer on the block");
  await h.page.mouse.move(away.x, away.y);
  await sleep(100);
  assert.equal((await chrome()).shown, false, "the copy stayed up with the pointer off the block");
  // A caret in the block shows the fences.
  await setSelection(h.page, await posOf(h.page, "x = 1"));
  assert.equal(await count(h.page, ".cm-line.mdm-fence-line"), 2);
  assert.equal(await count(h.page, ".cm-line.mdm-code-line"), 3);
  // And takes the rail, still one for the block, to the top of the card, up
  // with the pointer still off the block.
  await sleep(200);
  assert.deepEqual(await chrome(), { rails: 1, text: "", buttons: ["mdm-copy"], shown: true });
  assert.equal(await count(h.page, ".cm-line.mdm-fence-line .mdm-chrome--code"), 1);
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

// ---- The numbers in the margin ----

// The number is an attribute on the line, printed by the stylesheet in the
// margin of the text column, so what the tests read is the attribute (what a
// line is numbered) and the class list (which must not have grown).

test("every line carries its number, and a paragraph that wraps carries one", { skip }, async () => {
  const long =
    "A paragraph long enough to wrap over more than one row of the column, " +
    "which is one line of the document and takes one number for all of it.";
  const h = await open({ text: "Alpha.\n\n" + long + "\n\nOmega.\n", scores: 0 });
  const seen = await h.page.evaluate(() => {
    const lines = [...document.querySelectorAll("#app .cm-content .cm-line")];
    return {
      numbers: lines.map((l) => l.getAttribute("data-mdm-line")),
      classes: lines.map((l) => l.className),
      heights: lines.map((l) => l.getBoundingClientRect().height),
    };
  });
  // Six: the file ends in a newline, so there is a last empty line.
  assert.deepEqual(seen.numbers, ["1", "2", "3", "4", "5", "6"]);
  // The long one really did wrap (a .cm-line is one box however many rows it
  // draws, so what says it wrapped is its height), and it still took one
  // number, at its first row.
  assert.ok(
    seen.heights[2] > seen.heights[0] * 1.5,
    "the paragraph did not wrap: " + seen.heights[2] + " against " + seen.heights[0]
  );
  // The number rides on an attribute; the classes say what the line is and
  // are what the rest of the suite reads.
  assert.deepEqual(seen.classes, [
    "cm-line",
    "cm-line mdm-blank",
    "cm-line",
    "cm-line mdm-blank",
    "cm-line",
    "cm-line mdm-blank",
  ]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a drawn block is numbered by its first line, and by every line once a caret opens it", { skip }, async () => {
  const h = await open({ text: MATH, scores: 0 });
  // Every number on screen, in the order they are drawn, marking the ones
  // that ride on the cover over hidden source rather than on a line.
  const numbers = () =>
    h.page.evaluate(() =>
      [...document.querySelectorAll("#app .cm-content [data-mdm-line]")].map(
        (e) =>
          e.getAttribute("data-mdm-line") +
          (e.classList.contains("mdm-blockline") ? "*" : "")
      )
    );
  // Closed: the three lines of the equation are out of the flow and carry no
  // number of their own, and the cover over them says where the block starts.
  // Nothing here special-cases a block: a decoration inside a block
  // replacement is never reached, so the cover is the only thing left to say
  // it.
  assert.deepEqual(await numbers(), ["1", "2", "3*", "6", "7", "8"]);
  await setSelection(h.page, await posOf(h.page, "a^2"));
  assert.deepEqual(await numbers(), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  // And back to the cover when the caret leaves.
  await setSelection(h.page, 0);
  assert.deepEqual(await numbers(), ["1", "2", "3*", "6", "7", "8"]);
  // The numbering follows an edit above it, the cover included: the number is
  // the whole state of the cover, so it is updated in place and the drawing
  // beside it, an engraving in the case of a score, is never rebuilt for it.
  await h.page.keyboard.type("New line.\n");
  assert.deepEqual(await numbers(), ["1", "2", "3", "4*", "7", "8", "9"]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The bar is grouped by concept, the separators are where the concept
// changes, and since 2026-09-19 it stands in two rows: `/` is where the
// first one ends (rowBreak in main.js). The small caps, superscript and
// subscript buttons came in with the words that day
// (design-annotation-icons.html) and the six of the Insert group close the
// first row behind a separator of their own, spelled out as buttons where
// one menu button held them while the bar was a single row: that row is what they cost, and the owner asked
// to see the bar in two rather than pay it. The second row starts under the
// outline button, with everything that switches the document as a whole.
// Written out in full because the order carries a decision that no
// single button can hold on its own: outline leads, because its panel opens
// down the left edge and the button sits on the side the panel appears; the
// export follows alone, being the one button that leaves the editor; then the
// history, then the marks that act on the caret, then the blocks, then the one
// that changes what a selection matches. Inline code is the last of the marks
// and the code block the first of the blocks, so the two chevrons meet at the
// separator: one marks words inside a line, the other makes the line a block,
// which is the cut that separator makes. The last three groups are the ones
// that used to be a single run of seven: the page (what it is painted in,
// what it is set in, whether it shows the block at the top that is not prose),
// then the score (the three that dress the music and touch nothing else), then
// the playing, alone at the end because it is the only button here that
// changes what the editor does rather than what anything looks like.
const BAR = [
  "outline",
  "|",
  "mdm-export",
  "|",
  "undo",
  "redo",
  "|",
  "headings",
  "bold",
  "italic",
  "strikethrough",
  "superscript",
  "subscript",
  "small-caps",
  "highlight",
  "link",
  "inline-code",
  "|",
  "code-block",
  "unordered-list",
  "ordered-list",
  "task-list",
  "quote",
  "|",
  "insert-equation",
  "insert-equation-block",
  "insert-table",
  "insert-picture",
  "insert-footnote",
  "insert-rule",
  "/",
  "mdm-match-substring",
  "|",
  "mdm-theme",
  "mdm-text-font",
  "mdm-text-align",
  "mdm-hyphenation",
  "mdm-front-matter",
  "|",
  "mdm-score-fill",
  "mdm-staff-lines",
  "mdm-score-align",
  "|",
  "mdm-follow",
];

test("the toolbar is grouped by what a button is about", { skip }, async () => {
  const h = await open({});
  const seen = await h.page.evaluate(() =>
    Array.from(document.querySelectorAll("#app .mdm-toolbar > *")).map((el) =>
      el.classList.contains("mdm-toolbar__sep")
        ? "|"
        : el.classList.contains("mdm-toolbar__break")
        ? "/"
        : el.querySelector("button").getAttribute("data-type")
    )
  );
  assert.deepEqual(seen, BAR);
  assert.deepEqual(h.errors, []);
  await h.close();
});
