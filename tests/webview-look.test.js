// The look and the settings of the webview (vscode-mdm/media/main.js +
// style.css), driven in a real browser through tests/webview/helpers.js: the
// YAML header, the spacing of the blocks, the toolbar buttons and their menus,
// the two grounds, the syntax palette, the scores and the copy button.
//
// The editor is CodeMirror 6: the text in it is the file text, the blocks
// render as widgets under their source lines, and what shows where depends on
// where the carets are (a caret inside a block reveals its source). The tests
// move the carets with the helpers and read the DOM the decorations build.
// Run with: node --test --test-concurrency=1 webview-look.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { toEditor, fromEditor } = require("../vscode-mdm/transforms.js");
const {
  EXAMPLE,
  open,
  lastEdit,
  skip,
  docText,
  posOf,
  setSelection,
  selectionRanges,
  lineAt,
  settingsMessage,
  postSettings,
  setSettingPosts,
} = require("./webview/helpers.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- The memory of the buttons ----------

// Every toolbar button that holds a state stores it as an mdm.* setting, so a
// document opens showing what it was closed with. The three that used to live
// in the page alone (the outline, its width and the Ctrl+D toggle) are the ones
// checked here: the editor is opened on a seeded settings object, which is what
// the host interpolates into the page, and nothing is clicked.
test("the outline and the Ctrl+D toggle come back as they were left", { skip }, async () => {
  const h = await open({
    seed: {
      settings: {
        frontMatter: "hidden",
        outline: "shown",
        outlineWidth: 320,
        multicursorMatch: "substring",
      },
    },
    text: "score and scores and a score here\n",
    scores: 0,
  });
  const panel = await h.page.evaluate(() => {
    const el = document.querySelector("#app .mdm-outline");
    return {
      open: document.getElementById("app").classList.contains("mdm-outline--open"),
      display: getComputedStyle(el).display,
      width: Math.round(el.getBoundingClientRect().width),
      lit: document
        .querySelector('#app button[data-type="outline"]')
        .classList.contains("mdm-btn--on"),
    };
  });
  assert.equal(panel.open, true, "the outline came back shut");
  assert.equal(panel.display, "block");
  assert.equal(panel.lit, true, "the button did not come back lit");
  // A pixel of slack: the box measured carries the panel's border, the width
  // the setting names does not.
  assert.ok(
    Math.abs(panel.width - 320) <= 2,
    "the panel came back at another width: " + panel.width
  );
  // The Ctrl+D toggle is lit, names the way back, and matches inside words
  // with nothing clicked: the setting is applied and not merely painted.
  assert.deepEqual(
    await h.page.evaluate(() => {
      const b = document.querySelector('#app button[data-type="mdm-match-substring"]');
      return { tip: b.getAttribute("aria-label"), lit: b.classList.contains("mdm-btn--on") };
    }),
    { tip: "Multicursor matches whole words", lit: true }
  );
  await h.page.evaluate(() => {
    window.__mdm.view.focus();
    window.__mdm.view.dispatch({ selection: { anchor: 2 } });
  });
  for (let i = 0; i < 3; i++) {
    await h.page.keyboard.down("Control");
    await h.page.keyboard.press("d");
    await h.page.keyboard.up("Control");
  }
  assert.deepEqual(
    await h.page.evaluate(() =>
      window.__mdm.view.state.selection.ranges.map((r) => [r.from, r.to])
    ),
    [[0, 5], [10, 15], [23, 28]],
    "Ctrl+D matched whole words with the setting on substring"
  );
  // Pressing the panel's button asks for the other side of the setting.
  await h.page.click('#app button[data-type="outline"]');
  await sleep(150);
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "outline", value: "hidden" },
  ]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A width dragged out on a wide window would swallow a narrow pane, so what is
// applied is the setting or the room there is, whichever is less. The setting
// itself is left alone: the panel goes back to its full width as soon as there
// is room for it again.
test("an outline wider than the pane is narrowed to fit, and grows back", { skip }, async () => {
  const h = await open({
    seed: { settings: { frontMatter: "hidden", outline: "shown", outlineWidth: 700 } },
    text: "# One\n\nText.\n",
    scores: 0,
  });
  const width = () =>
    h.page.evaluate(() =>
      Math.round(document.querySelector("#app .mdm-outline").getBoundingClientRect().width)
    );
  await h.page.setViewport({ width: 600, height: 900 });
  await sleep(300);
  const squeezed = await width();
  assert.ok(
    squeezed <= 600 - 200 + 2 && squeezed >= 140,
    "the panel left the editor no room: " + squeezed
  );
  assert.deepEqual(
    await setSettingPosts(h.page),
    [],
    "the fit was written back as if the user had asked for it"
  );
  await h.page.setViewport({ width: 1200, height: 900 });
  await sleep(300);
  assert.ok(
    Math.abs((await width()) - 700) <= 2,
    "the panel did not go back to the width it was left at: " + (await width())
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The panel is a flex sibling of the text, so opening or closing it moves the
// whole column sideways without touching a line of the document. CodeMirror
// draws the caret as a box of its own, placed from coordinates measured
// against the geometry that was there before, and left to itself it does not
// measure again until its resize observer notices, four painted frames later:
// for those four the caret stands where the column used to be, which coming
// back from an open panel is out in the dead margin, well left of the number
// of its line.
//
// What is read is the gap between the caret and the left edge of its own
// line, which is the one thing the panel must not move, sampled at the end of
// every frame: a timeout queued from inside a requestAnimationFrame runs after
// every animation callback of that frame, so what it reads is what the frame
// is painted with rather than the state halfway through its callbacks.
async function caretGapPerFrame(page, message) {
  await page.evaluate((msg) => {
    window.__gaps = [];
    const heading = () =>
      [...document.querySelectorAll("#app .cm-line")].find((l) =>
        l.textContent.includes("From equations to score")
      );
    let n = 0;
    const tick = () => {
      setTimeout(() => {
        const caret =
          document.querySelector("#app .cm-cursor-primary") ||
          document.querySelector("#app .cm-cursor");
        const line = heading();
        window.__gaps.push(
          caret && line
            ? Math.round(
                caret.getBoundingClientRect().left - line.getBoundingClientRect().left
              )
            : null
        );
      }, 0);
      if (++n < 20) requestAnimationFrame(tick);
    };
    window.postMessage(msg, "*");
    requestAnimationFrame(tick);
  }, message);
  await sleep(900);
  return page.evaluate(() => window.__gaps);
}

test("the caret keeps its place in the line while the outline opens and shuts", { skip }, async () => {
  // Wide enough that the text column is at its full 820px with the panel open
  // and shut alike: what the panel changes is then the position of the column
  // and nothing else, which is the case CodeMirror is slowest to notice.
  const h = await open({ seed: { settings: { outline: "hidden", theme: "light" } } });
  await h.page.setViewport({ width: 1400, height: 1200 });
  await sleep(600);
  await setSelection(h.page, await posOf(h.page, "From equations to score"));
  await sleep(300);

  const gap = () =>
    h.page.evaluate(() => {
      const caret = document.querySelector("#app .cm-cursor-primary");
      const line = [...document.querySelectorAll("#app .cm-line")].find((l) =>
        l.textContent.includes("From equations to score")
      );
      return Math.round(
        caret.getBoundingClientRect().left - line.getBoundingClientRect().left
      );
    });
  const rest = await gap();
  assert.ok(rest > 0, "the caret is not drawn inside its line to begin with");

  for (const [what, outline] of [["opens", "shown"], ["shuts", "hidden"]]) {
    const frames = await caretGapPerFrame(h.page, settingsMessage({ outline }));
    const strayed = frames.filter((g) => g !== rest);
    assert.deepEqual(
      strayed,
      [],
      "the caret left its place in the line while the panel " +
        what +
        ": " +
        JSON.stringify(frames.slice(0, 8))
    );
    assert.equal(await gap(), rest, "the caret did not come back to its place");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The YAML header ----------

test("typing inside the header keeps the caret and the text", { skip }, async () => {
  const h = await open({});
  // The header is the first lines of the text, painted as YAML; the caret
  // goes after the author's name and the typing is ordinary typing.
  const at = await posOf(h.page, "alpelito7", "alpelito7".length);
  assert.ok(at > 0, "the author line is not in the editor");
  await setSelection(h.page, at);
  await h.page.keyboard.type("ZZ");
  await sleep(900);
  const out = {
    ranges: await selectionRanges(h.page),
    text: await docText(h.page),
    line: await lineAt(h.page, at),
    sent: await h.page.evaluate(
      () => (window.__posts.filter((m) => m.type === "edit").pop() || {}).text
    ),
  };
  assert.deepEqual(out.ranges, [[at + 2, at + 2]]);
  assert.match(out.text, /author: alpelito7ZZ/);
  // The line is still the painted header (the YAML line class), with the
  // typed text in it.
  assert.match(out.line.className, /mdm-fm-line/);
  assert.match(out.line.text, /author: alpelito7ZZ/);
  assert.equal(
    fromEditor(out.sent, EXAMPLE, true),
    EXAMPLE.replace("author: alpelito7", "author: alpelito7ZZ")
  );
  await h.close();
});

// ---------- Spacing ----------

// A paragraph on each side of every kind of block, which is what this test
// measures. It used to read example.mdm, and the pairs it needs come and go as
// that document is rewritten: the run that caught this had no code block with a
// paragraph under it at all.
const SPACING = `---
title: "t"
---

One.

Two paragraphs in a row, which is the gap everything else is measured against.

\`\`\`python
x = 1
\`\`\`

Two.

$$
y = x
$$

Three.

\`\`\`abc
X:1
K:C
CDEF|
\`\`\`

Four.

\`\`\`abc
X:2
K:C
GABc|
\`\`\`

Five.

\`\`\`abc
X:3
K:C
cdef|
\`\`\`

Six.
`;

// The gap between consecutive blocks, keyed by their kinds, from the children
// of .cm-content: a blank line is the Markdown gap itself and separates the
// blocks, the zero-height placeholder of a hidden fence or source is skipped,
// and the lines of one card (code, header) are one block. The gap is from
// the bottom of the last element of a block to the top of the first of the
// next, which for two paragraphs is the height of the blank line between.
function blockGaps(page) {
  return page.evaluate(() => {
    const kids = Array.from(document.querySelector("#app .cm-content").children);
    const kindOf = (el) => {
      if (el.classList.contains("mdm-math--block")) return "math";
      if (el.classList.contains("mdm-score")) return "score";
      if (!el.classList.contains("cm-line")) return "hidden";
      if (el.classList.contains("mdm-code-line")) return "code";
      if (el.classList.contains("mdm-fm-line")) return "header";
      if (el.textContent === "") return "blank";
      return "p";
    };
    const blocks = [];
    let current = null;
    kids.forEach((el) => {
      const kind = kindOf(el);
      if (kind === "hidden") return;
      if (kind === "blank") {
        current = null;
        return;
      }
      const r = el.getBoundingClientRect();
      if (current && current.kind === kind) {
        current.bottom = r.bottom;
      } else {
        current = { kind: kind, top: r.top, bottom: r.bottom };
        blocks.push(current);
      }
    });
    const out = {};
    for (let i = 0; i + 1 < blocks.length; i++) {
      const key = blocks[i].kind + ">" + blocks[i + 1].kind;
      if (!(key in out)) out[key] = blocks[i + 1].top - blocks[i].bottom;
    }
    return out;
  });
}

// Observed: the gap above every block is the blank line, as between two
// paragraphs, but below it the card's (or widget's) margin-bottom of 1em adds
// to the blank line, so code>p, math>p and score>p come out 14-16px wider.
test(
  "code, scores and equations are spaced like paragraphs",
  { skip },
  async () => {
    const h = await open({ text: SPACING });
    const gaps = await blockGaps(h.page);
    const paragraph = gaps["p>p"];
    assert.ok(paragraph > 0, "no paragraph pair to measure against");
    ["p>code", "p>math", "p>score", "code>p", "math>p", "score>p"].forEach((key) => {
      assert.ok(key in gaps, "no " + key + " pair to measure");
      // The line boxes sit at fractional offsets; a pixel of slack.
      assert.ok(
        Math.abs(gaps[key] - paragraph) <= 1,
        key + " was " + gaps[key] + " against " + paragraph
      );
    });
    await h.close();
  }
);

test("a display equation is rendered, not collapsed", { skip }, async () => {
  // The rules that tighten a collapsed block used to reach the span KaTeX
  // renders into, and the equation vanished from the page.
  const h = await open({});
  const math = await h.page.evaluate(() => {
    const el = document.querySelector("#app .mdm-math--block .katex-display");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, h: Math.round(r.height) };
  });
  assert.ok(math, "no equation was rendered");
  assert.notEqual(math.display, "none");
  assert.ok(math.h > 20, "the equation is " + math.h + "px tall");
  await h.close();
});

// ---------- Buttons ----------

test("the header button takes the editor to the top, on and off", { skip }, async () => {
  const h = await open({
    seed: { settings: { frontMatter: "hidden" } },
    withFrontMatter: false,
  });
  const scrollDown = async () => {
    await h.page.evaluate(() => {
      document.querySelector("#app .cm-scroller").scrollTop = 800;
    });
    const at = await h.page.evaluate(
      () => document.querySelector("#app .cm-scroller").scrollTop
    );
    assert.ok(at > 400, "the document did not scroll: " + at);
  };
  // What the host sends when the button is pressed: the settings it stored,
  // and the document in the mode just chosen.
  const press = (shown) =>
    h.page.evaluate(
      (msg, text, isShown) => {
        window.postMessage(msg, "*");
        window.postMessage(
          {
            type: "update",
            text: text,
            frontMatter: "x",
            withFrontMatter: isShown,
          },
          "*"
        );
      },
      settingsMessage({ frontMatter: shown ? "shown" : "hidden" }),
      toEditor(EXAMPLE, shown),
      shown
    );
  // The header, when it is in the text, is the run of YAML lines at the top.
  const state = () =>
    h.page.evaluate(() => ({
      scrollTop: document.querySelector("#app .cm-scroller").scrollTop,
      header: !!document.querySelector("#app .cm-line.mdm-fm-line"),
    }));

  await scrollDown();
  await press(true);
  await sleep(900);
  assert.deepEqual(await state(), { scrollTop: 0, header: true });

  // And back: hiding the header takes the block off the top of the document,
  // so it goes to the top too instead of leaving the reader halfway down.
  await scrollDown();
  await press(false);
  await sleep(900);
  assert.deepEqual(await state(), { scrollTop: 0, header: false });
  await h.close();
});

// The link between that button and the export, which is the whole of what it
// is for: the header the editor is showing decides whether the page opens with
// the block Quarto draws from the YAML (TITLE_BLOCK in mdm.lua), and the only
// thing that carries the decision across is mdm.frontMatter. The host end is
// pinned in extension-host.test.js, where exportLook is read; the filter end in
// render.test.js and html.test.js, where the block is rendered and measured.
// This is the end nothing held: that pressing the button asks for the setting
// at all, in the right direction, and that a document with no header of its
// own asks for nothing.
test("the header button asks the host to store the choice", { skip }, async () => {
  const h = await open({
    seed: { settings: { frontMatter: "hidden" } },
    withFrontMatter: false,
  });
  const fm = () =>
    h.page.evaluate(() => {
      const btn = document.querySelector('#app button[data-type="mdm-front-matter"]');
      return {
        lit: btn.classList.contains("mdm-btn--on"),
        greyed: btn.classList.contains("mdm-btn--off"),
        tip: btn.getAttribute("aria-label"),
      };
    });

  // Hidden is the default, and a lamp lit from the first opening would say
  // nothing: the lamp means the reader has moved off it. The tooltip names
  // where the click goes and not where the editor is.
  assert.deepEqual(await fm(), {
    lit: false,
    greyed: false,
    tip: "Show YAML header",
  });
  await h.page.click('#app button[data-type="mdm-front-matter"]');
  await sleep(200);
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "frontMatter", value: "shown" },
  ]);
  // The webview does not move itself: the value comes back from the host, and
  // until it does the button is where it was.
  assert.equal((await fm()).lit, false, "the button moved before the host answered");

  await postSettings(h.page, { frontMatter: "shown" });
  await sleep(300);
  assert.deepEqual(await fm(), {
    lit: true,
    greyed: false,
    tip: "Hide YAML header",
  });
  // And back the other way, so the click is a toggle and not a one-way switch.
  await h.page.click('#app button[data-type="mdm-front-matter"]');
  await sleep(200);
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "frontMatter", value: "shown" },
    { type: "setSetting", key: "frontMatter", value: "hidden" },
  ]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A file with no header has nothing to show or hide, so the button greys out
// and a click on it asks for nothing. Storing "shown" here would leave the
// setting saying the editor is showing a header it has not got, and the next
// document opened would come up in a mode nobody chose.
test("a file with no YAML header greys the button out", { skip }, async () => {
  const h = await open({
    text: "Just prose, and no header at all.\n",
    scores: 0,
    seed: { settings: { frontMatter: "hidden" } },
    withFrontMatter: false,
    frontMatter: "",
  });
  const btn = '#app button[data-type="mdm-front-matter"]';
  assert.deepEqual(
    await h.page.evaluate((sel) => {
      const b = document.querySelector(sel);
      return {
        lit: b.classList.contains("mdm-btn--on"),
        greyed: b.classList.contains("mdm-btn--off"),
        tip: b.getAttribute("aria-label"),
        reachable: getComputedStyle(b).pointerEvents !== "none",
      };
    }, btn),
    {
      lit: false,
      greyed: true,
      tip: "No YAML header in this file",
      reachable: false,
    }
  );
  // Both locks, because there are two and each can be undone on its own: the
  // pointer cannot reach the button (the rule above), and the handler refuses
  // anyway. The click is dispatched on the element rather than aimed at the
  // screen, which is what gets past `pointer-events: none` and leaves the
  // handler itself as the thing under test.
  await h.page.evaluate((sel) => document.querySelector(sel).click(), btn);
  await sleep(200);
  assert.deepEqual(await setSettingPosts(h.page), []);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- Copy ----------

// The body of the python block of the example, which is what its copy button
// must hand over.
const PYTHON_SOURCE = (() => {
  const start = EXAMPLE.indexOf("```python\n") + "```python\n".length;
  return EXAMPLE.slice(start, EXAMPLE.indexOf("\n```", start));
})();

// Observed: a click on a copy button copies and labels, but its mousedown
// also moves the caret into the block (score and code alike: the block opens
// under the click). The score's pulse survives that, since its widget DOM is
// kept; on a code block the re-render resets the class list of every line
// and takes the pulse class with it within a frame. With the mousedown
// prevented the pulse runs and the caret stays (measured).
test(
  "the copy button copies the source and pulses the block, not the page",
  { skip },
  async () => {
    const h = await open({
      clipboard: true,
    });
    // Score: the chrome of the widget, shown while the pointer is on the score.
    // Code: the chrome rides the first line of the block and shows while the
    // pointer is on any of its lines. The score goes first so that the code
    // pulse, the part that fails today, is the last thing checked.
    for (const [kind, hoverSel, buttonSel] of [
      ["score", "#app .mdm-score", "#app .mdm-score .mdm-chrome .mdm-copy"],
      ["code", "#app .cm-line.mdm-code-line:has(.mdm-chrome--code)", "#app .mdm-chrome--code .mdm-copy"],
    ]) {
      // The button only exists visible while the pointer is over the block.
      const hover = await h.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + Math.min(30, r.height / 2) };
      }, hoverSel);
      await h.page.mouse.move(hover.x, hover.y);
      await sleep(300);
      const button = await h.page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        const r = btn.getBoundingClientRect();
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          w: r.width,
          opacity: getComputedStyle(btn.closest(".mdm-chrome")).opacity,
        };
      }, buttonSel);
      assert.ok(button.w > 0, kind + ": no copy button to click");
      assert.equal(button.opacity, "1", kind + ": the copy button is not shown on hover");
      await h.page.mouse.click(button.x, button.y);
      await sleep(200);
      const out = await h.page.evaluate((sel, kind) => {
        const names = (els) =>
          Array.from(new Set(Array.from(els).map((el) => getComputedStyle(el).animationName)));
        // The pulse runs on every line of the code block (the lines carry its
        // card; the python block is the only code block of the example, its
        // fences carry no pulse, and the source lines of an opened score are
        // code lines too), and on the score that was copied, not its
        // neighbours.
        const animations =
          kind === "code"
            ? names(
                document.querySelectorAll(
                  "#app .cm-line.mdm-code-line:not(.mdm-fence-line):not(.mdm-src-line)"
                )
              )
            : names(
                document.querySelector(sel).closest(".mdm-score").querySelectorAll("code.language-abc")
              );
        return {
          copied: window.__copied[window.__copied.length - 1] || "",
          animations: animations,
          selection: String(getSelection()).length,
          label: document.querySelector(sel).getAttribute("aria-label"),
        };
      }, buttonSel, kind);
      assert.equal(out.selection, 0, kind + ": the page was selected");
      assert.equal(out.label, "Copied");
      assert.ok(!out.animations.includes("none"), kind + ": the block did not pulse");
      if (kind === "code") {
        assert.equal(out.copied, PYTHON_SOURCE);
        assert.deepEqual(out.animations, ["mdm-copy-pulse-code"]);
      } else {
        // A score drops the directives that size it for this document.
        assert.ok(!/%%staffwidth/.test(out.copied));
        assert.deepEqual(out.animations, ["mdm-copy-pulse"]);
      }
      await sleep(700);
    }
    await h.close();
  }
);

// The copy button answers in its own tooltip, "Copied" where "Copy" was. A
// tooltip is drawn on :hover, so with the pointer resting on the button after
// the click the answer would sit there until the pointer moved off the block.
// It is held for a beat and then put away, and the label goes back to "Copy"
// so the next hover reads as it did. Only a pointer click leaves anything to
// put away: a synthetic one (the rest of the suite) has no hover to fight.
test("the copied sign is shown for a beat and then goes", { skip }, async () => {
  const h = await open({ clipboard: true });
  const SEL = "#app .mdm-score .mdm-chrome .mdm-copy";
  // The chrome is drawn at opacity 0 and shown while the pointer is on the
  // block, so the button has to be hovered before it can be clicked.
  const where = await h.page.evaluate(() => {
    const score = document.querySelector("#app .mdm-score");
    score.scrollIntoView({ block: "center" });
    const r = score.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(30, r.height / 2) };
  });
  await h.page.mouse.move(where.x, where.y);
  await sleep(300);
  const button = await h.page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, SEL);
  const read = () =>
    h.page.evaluate((sel) => {
      const btn = document.querySelector(sel);
      return {
        label: btn.getAttribute("aria-label"),
        drawn: getComputedStyle(btn, "::after").display !== "none",
        hovered: btn.matches(":hover"),
      };
    }, SEL);
  await h.page.mouse.click(button.x, button.y);
  await sleep(150);
  assert.deepEqual(
    await read(),
    { label: "Copied", drawn: true, hovered: true },
    "the sign did not come up on the button the pointer is on"
  );
  await sleep(1600);
  assert.deepEqual(
    await read(),
    { label: "Copy", drawn: false, hovered: true },
    "the sign stayed up under the pointer"
  );
  // The pointer leaves and comes back: the button says what it says again.
  await h.page.mouse.move(5, 5);
  await sleep(200);
  await h.page.mouse.move(button.x, button.y);
  await sleep(300);
  assert.deepEqual(
    await read(),
    { label: "Copy", drawn: true, hovered: true },
    "the tooltip never came back"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The gap between two paragraphs is the blank line of the Markdown, and it is
// drawn at an em rather than at the height of a line of prose: 16px on a 16px
// body, the space a rendered document leaves between two paragraphs (Vditor's
// `p { margin-bottom: 16px }`, which is what the Office Viewer preview and the
// editor that came before this one draw with). A blank line inside a fence is
// a line of the block and keeps the height of one.
test("a blank line between paragraphs is an em, not a line of prose", { skip }, async () => {
  const text = [
    "First paragraph.",
    "",
    "Second paragraph.",
    "",
    "```python",
    "a = 1",
    "",
    "b = 2",
    "c = 3",
    "```",
    "",
  ].join("\n");
  const h = await open({ text, scores: 0, seed: { settings: { frontMatter: "hidden" } } });
  const seen = await h.page.evaluate(() => {
    const view = window.__mdm.view, doc = view.state.doc;
    const boxOf = (n) => {
      const dom = view.domAtPos(doc.line(n).from).node;
      const el = dom.nodeType === 1 ? dom : dom.parentElement;
      const line = el.closest(".cm-line");
      const r = line.getBoundingClientRect();
      return { cls: line.className, top: r.top, bottom: r.bottom, height: r.height };
    };
    const em = parseFloat(getComputedStyle(document.querySelector("#app .cm-content")).fontSize);
    const prose = [boxOf(1), boxOf(2), boxOf(3)];
    // The blank line of the fence against a line of code beside it. Neither
    // the first line of the block nor the last: those carry the padding that
    // stands the card off its own edges.
    const code = [boxOf(8), boxOf(7)];
    return {
      em,
      blank: { cls: prose[1].cls, height: prose[1].height },
      gap: prose[2].top - prose[0].bottom,
      proseLine: prose[0].height,
      codeBlank: { cls: code[1].cls, height: code[1].height },
      codeLine: code[0].height,
    };
  });
  assert.match(seen.blank.cls, /mdm-blank/, "the blank line of the prose is not marked");
  assert.equal(seen.blank.height, seen.em, "the blank line is not an em tall");
  // What separates the paragraphs is that em and nothing else.
  assert.equal(Math.round(seen.gap), Math.round(seen.em), "the paragraphs are not an em apart");
  assert.ok(
    seen.proseLine > seen.em * 1.5,
    "a line of prose is no taller than the gap: " + seen.proseLine
  );
  // The fence keeps its own rhythm.
  assert.doesNotMatch(seen.codeBlank.cls, /mdm-blank/, "a blank line of the fence was marked");
  assert.equal(seen.codeBlank.height, seen.codeLine, "the fence's blank line was shortened");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a setting that touches no colour does not repaint the theme", { skip }, async () => {
  const h = await open({
    seed: { settings: { frontMatter: "hidden" } },
    withFrontMatter: false,
  });
  // Vditor had a setTheme to count calls of; here a repaint would rebuild
  // the view and with it every widget, so the engraved scores and the view
  // itself must come through the message untouched, and the side must not
  // flip.
  const before = await h.page.evaluate(() => {
    window.__view0 = window.__mdm.view;
    document
      .querySelectorAll("#app code.language-abc svg")
      .forEach((svg, i) => svg.setAttribute("data-marked", i));
    return document.querySelectorAll("svg[data-marked]").length;
  });
  assert.ok(before >= 3, "no scores to watch");
  await postSettings(h.page, { frontMatter: "shown" });
  await sleep(400);
  const after = await h.page.evaluate(() => ({
    marked: document.querySelectorAll("svg[data-marked]").length,
    sameView: window.__mdm.view === window.__view0,
    dark: document.getElementById("app").classList.contains("mdm--dark"),
  }));
  assert.deepEqual(after, { marked: before, sameView: true, dark: false });
  await h.close();
});

test("the theme menu lists what the host sent, and a click asks for it", { skip }, async () => {
  const themes = [
    { name: "Monokai", kind: "dark" },
    { name: "Solarized Light", kind: "light" },
  ];
  const h = await open({ seed: { themes: themes } });
  await h.page.click('#app button[data-type="mdm-theme"]');
  await sleep(200);
  const menu = await h.page.evaluate(() => {
    const btn = document.querySelector('#app button[data-type="mdm-theme"]');
    const item = btn.closest(".mdm-toolbar__item");
    return {
      open: item.classList.contains("mdm-toolbar__item--open"),
      shown: getComputedStyle(item.querySelector(".mdm-menu")).display,
      entries: Array.from(
        item.querySelectorAll('button.mdm-menu__item[data-type^="mdm-theme-"]')
      ).map((b) => b.textContent.trim()),
    };
  });
  assert.equal(menu.open, true, "the click did not open the menu");
  assert.equal(menu.shown, "block");
  // The entry in use carries a tick; the harness opens on "light".
  assert.deepEqual(
    menu.entries.map((e) => e.replace("✓", "")),
    ["Follow VS Code", "MDM Light", "MDM Dark", "MDM White", "Monokai", "Solarized Light"]
  );
  assert.deepEqual(menu.entries.filter((e) => e.includes("✓")), ["MDM Light✓"]);
  await h.page.click('#app button[data-type="mdm-theme-4"]');
  await sleep(200);
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "theme", value: "Monokai" },
  ]);
  await h.close();
});

// ---------- The two grounds ----------

// The luminance of a computed colour, enough to say which of two greys is the
// darker. getComputedStyle answers in color(srgb r g b) once a colour comes out
// of color-mix, so both spellings are read.
function luminance(color) {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(color);
  if (srgb) return (+srgb[1] * 0.2126 + +srgb[2] * 0.7152 + +srgb[3] * 0.0722) * 255;
  const rgb = /rgba?\((\d+), (\d+), (\d+)/.exec(color);
  assert.ok(rgb, "colour not understood: " + color);
  return +rgb[1] * 0.2126 + +rgb[2] * 0.7152 + +rgb[3] * 0.0722;
}

// The page the document is written on (the editor, --mdm-syn-page) and the
// ground under a block of code (its lines, --mdm-syn-card).
function grounds(page) {
  return page.evaluate(() => {
    const bg = (el) => (el ? getComputedStyle(el).backgroundColor : null);
    return {
      page: bg(document.querySelector("#app .cm-editor")),
      code: bg(document.querySelector("#app .cm-line.mdm-code-line")),
      outline: bg(document.querySelector("#app .mdm-outline")),
      header: bg(document.querySelector("#app .cm-line.mdm-fm-line")),
      score: bg(document.querySelector("#app code.language-abc")),
    };
  });
}

test("the code sits on the panel material, a step off the page either side", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const h = await open({
      seed: { settings: { theme: theme, scoreFill: "none", outline: "shown" } },
      // One score and not the three the helper waits for by default: with
      // the outline panel open the text column is 579px instead of 800, so
      // CodeMirror keeps fewer line widgets alive and never builds the third
      // block at all. Nothing here needs it.
      scores: 1,
    });
    const g = await grounds(h.page);
    assert.ok(g.code, theme + ": no code line to measure");
    // Both greys are mixes of the theme's own colours, and the step between
    // them is made of ink, which changes ends with the side: on the light one
    // the code keeps the slate it has always had and the page is a shade off
    // white, on the dark one the page rises to the tint and the code sits a
    // step above it, where editor.background would be a hole (a theme like
    // Dark 2026 paints that near black).
    assert.ok(
      Math.abs(luminance(g.code) - luminance(g.page)) > 4,
      theme + ": the two grounds are the same grey"
    );
    assert.equal(
      luminance(g.code) < luminance(g.page),
      theme === "light",
      theme + ": code " + g.code + " against page " + g.page
    );
    // And it is the material the outline panel is drawn in: a block of code
    // and a panel of chrome are the same kind of surface. The dark side takes
    // the panel's own mix, so the two are the same string; the light one
    // reaches it from the other direction (the tint) and lands within a level.
    assert.ok(
      Math.abs(luminance(g.code) - luminance(g.outline)) < 1,
      theme + ": code " + g.code + " against the outline " + g.outline
    );
    // The YAML header reads as a block of code, so it takes the same ground.
    assert.equal(g.header, g.code);
    await h.close();
  }
});

test("light leaves the page a shade off the white the theme gives it", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light", scoreFill: "none" } } });
  const g = await grounds(h.page);
  const page = luminance(g.page);
  assert.ok(page < 255, "the page is pure white: " + g.page);
  assert.ok(page > 235, "the page is more than a shade off white: " + g.page);
  await h.close();
});

test("white is a white page with the code keeping its slate", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "white", scoreFill: "none" } } });
  const g = await grounds(h.page);
  assert.equal(g.page, "rgb(255, 255, 255)");
  assert.ok(luminance(g.code) < 255, "the code has no ground of its own: " + g.code);
  assert.ok(luminance(g.code) > 200, "the code ground is not a light tint: " + g.code);
  // With no fill of its own a score draws straight on the page, so on paper it
  // comes out on white.
  assert.match(g.score, /rgba\(0, 0, 0, 0\)|transparent/);
  assert.equal(
    await h.page.evaluate(() =>
      document.getElementById("app").classList.contains("mdm--dark")
    ),
    false,
    "white must stay on the light side"
  );
  await h.close();
});

// ---------- Scores ----------

// Three blocks, so the wait in open() is satisfied, and the first of them is
// the shape that used to be cropped: a staff narrowed with %%staffwidth under a
// title wider than it.
const NARROW_TITLE = `---
title: "t"
---

\`\`\`abc
%%staffwidth 200pt
X:1
T:E(3,8): the tresillo, 3+3+2
M:4/4
L:1/8
K:C
|: c3 e3 g2 :|
\`\`\`

\`\`\`abc
X:2
T:Wide
M:4/4
L:1/8
K:Am
ABcd ef^ga | a^gfe dcBA |
\`\`\`

\`\`\`abc
X:3
K:C
CDEF|
\`\`\`
`;

// The box each score declares against the box its ink really occupies, and
// where it sits across its widget (the pane the score is laid out in).
function scoreBoxes(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#app code.language-abc svg")).map((svg) => {
      const ink = svg.getBBox();
      const view = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      const rect = svg.getBoundingClientRect();
      const pane = svg.closest(".mdm-score").getBoundingClientRect();
      return {
        view: { x: view[0], y: view[1], w: view[2], h: view[3] },
        ink: { x: ink.x, y: ink.y, w: ink.width, h: ink.height },
        left: rect.left - pane.left,
        right: pane.right - rect.right,
        width: rect.width,
        paneWidth: pane.width,
      };
    })
  );
}

test("a title wider than its staff is not cropped", { skip }, async () => {
  const h = await open({ text: NARROW_TITLE });
  const boxes = await scoreBoxes(h.page);
  assert.equal(boxes.length, 3);
  for (const b of boxes) {
    // abcjs 5.10.3 sizes the SVG from the engraved music alone: the centred
    // title of the narrow one ran from -6 to 272 inside a box declared 266
    // wide, and lost its first and last letters. Half a unit of slack for the
    // sub-pixel jitter of text measurement.
    assert.ok(b.view.x <= b.ink.x + 0.5, "left cropped: " + b.view.x + " vs " + b.ink.x);
    assert.ok(
      b.view.x + b.view.w >= b.ink.x + b.ink.w - 0.5,
      "right cropped: " + (b.view.x + b.view.w) + " vs " + (b.ink.x + b.ink.w)
    );
    assert.ok(b.view.y <= b.ink.y + 0.5, "top cropped");
    assert.ok(b.view.y + b.view.h >= b.ink.y + b.ink.h - 0.5, "bottom cropped");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("an edited score keeps no card behind it, in either theme", { skip }, async () => {
  // Vditor stamped `hljs` on the <code> of every block it re-rendered, a score
  // among them, and the card rule for code blocks then matched it: from the
  // first edit inside a score block the score sat on a card, invisible under a
  // light theme and plainly there under a dark one. Here an edit rebuilds the
  // score widget from the new source, and the rebuilt one must draw on
  // nothing as well.
  for (const theme of ["dark", "light"]) {
    const h = await open({ seed: { settings: { theme: theme, scoreFill: "none" } } });
    const score = () =>
      h.page.evaluate(() => {
        const code = document.querySelector("#app code.language-abc");
        return {
          source: code.closest(".mdm-score").getAttribute("data-mdm-source"),
          background: getComputedStyle(code).backgroundColor,
          engraved: !!code.querySelector("svg"),
        };
      });
    const fresh = await score();
    assert.match(fresh.background, /rgba\(0, 0, 0, 0\)|transparent/, theme + " fresh");
    // The edit, the way the user makes it: the caret into the score's source
    // (the title line of the first block), type, then take the caret out so
    // the block closes again.
    const at = await posOf(h.page, "vibrating string", "vibrating string".length);
    await setSelection(h.page, at);
    await sleep(400);
    const opened = await h.page.evaluate(() => ({
      source: document.querySelectorAll("#app .cm-line.mdm-code-line.mdm-src-line").length,
      widget: !!document.querySelector("#app .mdm-score code.language-abc svg"),
    }));
    assert.ok(opened.source > 0, theme + ": the caret did not open the score's source");
    assert.equal(opened.widget, true, theme + ": the score went away while its source is open");
    await h.page.keyboard.type(" ");
    await sleep(600);
    await setSelection(h.page, await posOf(h.page, "This document"));
    await sleep(900);
    const edited = await score();
    // The widget was rebuilt from the edited source (the new engine's
    // counterpart of the hljs stamp: proof the block went through an edit).
    assert.match(edited.source, /vibrating string \n/, theme + ": the score was not re-engraved");
    assert.equal(edited.engraved, true, theme + ": no score after the edit");
    assert.match(
      edited.background,
      /rgba\(0, 0, 0, 0\)|transparent/,
      theme + " after the edit: " + edited.background
    );
    await h.close();
  }
});

test("the alignment button moves narrow scores to the margin", { skip }, async () => {
  const h = await open({ text: NARROW_TITLE });
  const narrow = async () => (await scoreBoxes(h.page))[0];
  const tip = () =>
    h.page.$eval('#app button[data-type="mdm-score-align"]', (b) =>
      b.getAttribute("aria-label")
    );

  const centred = await narrow();
  assert.ok(centred.width < centred.paneWidth - 20, "the fixture is not narrow");
  assert.ok(
    Math.abs(centred.left - centred.right) < 1,
    "not centred: " + centred.left + " vs " + centred.right
  );
  // The tooltip names the destination of the click, not the state in use.
  assert.equal(await tip(), "Align scores left");

  await h.page.click('#app button[data-type="mdm-score-align"]');
  await sleep(200);
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "scoreAlign", value: "left" },
  ]);
  // The webview never repaints itself: the value comes back from the host.
  assert.ok((await narrow()).left > 1, "moved before the host answered");

  await postSettings(h.page, { scoreAlign: "left" });
  await h.page.waitForFunction(() =>
    document.getElementById("app").classList.contains("mdm-score--left")
  );
  assert.ok((await narrow()).left < 1, "did not reach the margin");
  assert.equal(await tip(), "Centre scores");
  await h.close();
});

// ---------- The face of the text ----------

// Everything the face decides, in one round trip: what the document is set in,
// what the toolbar is set in (which must not move), whether the vendored file
// actually arrived, and the size KaTeX gives a formula.
//
// The arrival is measured and not read off getComputedStyle, which reports the
// declared list whether or not the file was fetched: a woff2 that 404s leaves
// the fallback drawing every word and a naive test passes for the wrong
// reason. The canvas measures a real run of glyphs in each family, and Latin
// Modern is narrower than both the fallback serif and the sans.
async function faceOf(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const app = document.getElementById("app");
    const width = (family) => {
      const c = document.createElement("canvas").getContext("2d");
      c.font = '16px ' + family;
      return c.measureText("Take a string of length, tension and density").width;
    };
    // KaTeX's own size rule is on `.katex`, so a bare span of that class reads
    // it without needing an equation in the fixture.
    const content = document.querySelector(".cm-content");
    const probe = document.createElement("span");
    probe.className = "katex";
    probe.textContent = "x";
    content.appendChild(probe);
    const katex = getComputedStyle(probe).fontSize;
    probe.remove();
    // The factor font-size-adjust actually applies: the same run of prose
    // measured in place, then again with the adjust switched off. Declaring
    // the property is not applying it, and a computed value of "0.528" is
    // what the sheet said, not what the browser drew.
    const run = document.createElement("span");
    run.textContent = "abcdefghijklmnopqrstuvwxyz";
    run.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    content.appendChild(run);
    const withAdjust = run.getBoundingClientRect().width;
    run.style.fontSizeAdjust = "none";
    const without = run.getBoundingClientRect().width;
    run.remove();
    const btn = app.querySelector('button[data-type="mdm-text-font"]');
    return {
      roman: app.classList.contains("mdm-text--roman"),
      text: getComputedStyle(document.querySelector(".cm-scroller")).fontFamily,
      chrome: getComputedStyle(app.querySelector(".mdm-toolbar")).fontFamily,
      arrived: document.fonts.check('16px "Latin Modern Roman"'),
      lm: width('"Latin Modern Roman"'),
      georgia: width("Georgia"),
      // Every face, not just the one a paragraph of plain prose happens to
      // ask for. They are fetched by name at start-up so that CodeMirror
      // cannot measure a character against the fallback and draw the caret
      // where the text is not; left to be fetched when layout first wants
      // them, only the roman comes up loaded and the other three arrive
      // whenever a bold or an italic is first drawn.
      faces: [...document.fonts]
        .filter((f) => f.family === "Latin Modern Roman")
        .map((f) => f.style + "/" + f.weight + "=" + f.status)
        .sort(),
      adjust: getComputedStyle(content).fontSizeAdjust,
      factor: +(withAdjust / without).toFixed(3),
      katex,
      lit: btn.classList.contains("mdm-btn--on"),
      tip: btn.getAttribute("aria-label"),
    };
  });
}

test("the text is set in the roman, and the button hands it back to the sans", { skip }, async () => {
  const h = await open({ text: EXAMPLE });

  const first = await faceOf(h.page);
  // Nothing was clicked: this is what mdm.textFont is worth on a fresh editor.
  assert.ok(first.roman, "the editor did not come up in the roman");
  assert.match(first.text, /Latin Modern Roman/);
  assert.ok(first.arrived, "the face was declared but never loaded");
  assert.deepEqual(
    first.faces,
    [
      "italic/400=loaded",
      "italic/700=loaded",
      "normal/400=loaded",
      "normal/700=loaded",
    ],
    "a face was left to be fetched when something first needs it: " +
      JSON.stringify(first.faces)
  );
  assert.ok(
    Math.abs(first.lm - first.georgia) > 5,
    "the roman measures like its own fallback, so the woff2 did not arrive: " +
      first.lm + " vs " + first.georgia
  );
  // The chrome is the application's and not the page's: the toolbar keeps the
  // interface sans whichever face the words are in.
  assert.match(first.chrome, /-apple-system/);
  assert.ok(!/Latin Modern/.test(first.chrome), "the roman reached the toolbar");
  // The roman is drawn at the reading size the sans had. Its x-height is
  // 0.431 em against the sans's 0.528, so at a bare `font-size: 16px` it reads
  // about a fifth small and takes the page out of proportion: the headings are
  // ems of the same 16px and keep their size, and the text abcjs draws in a
  // score is its own pixels. font-size-adjust leaves the computed size at 16px
  // and scales the glyphs, so every em in the sheet stays where it was.
  assert.equal(first.adjust, "0.528", "the roman is left at its own x-height");
  // Declared is not applied: this is the factor the browser actually drew at,
  // measured, against the 0.528/0.431 = 1.225 the two faces ask for.
  assert.ok(
    first.factor > 1.2 && first.factor < 1.25,
    "the adjust was declared but not applied: factor " + first.factor
  );
  // And KaTeX is left exactly as it ships. Its 1.21 is the compensation a
  // Computer Modern needs beside a sans, and with the words now drawn at the
  // sans's x-height that is the measurement it was made against. The vendored
  // sheet's `font` shorthand keeps the adjust off the maths by itself.
  assert.equal(first.katex, "19.36px", "the maths was resized under the roman");
  // The lamp is off on the roman and on on the sans, which is the way round
  // the staff-line and multicursor toggles work: the roman is the default, so
  // a lamp lit from the first opening would say nothing.
  assert.ok(!first.lit, "the button is lit on the face the editor opens in");
  // The tooltip names the destination of the click, not the state in use, and
  // names it the way a reader would rather than by the name of the file.
  assert.equal(first.tip, "Usual Markdown font");

  await h.page.click('#app button[data-type="mdm-text-font"]');
  await sleep(200);
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "textFont", value: "sans" },
  ]);
  // The webview never repaints itself: the value comes back from the host.
  assert.ok((await faceOf(h.page)).roman, "moved before the host answered");

  await postSettings(h.page, { textFont: "sans" });
  await h.page.waitForFunction(
    () => !document.getElementById("app").classList.contains("mdm-text--roman")
  );
  const second = await faceOf(h.page);
  assert.match(second.text, /-apple-system/);
  assert.ok(!/Latin Modern/.test(second.text), "the roman stayed on the text");
  // The sans is drawn at its own size, with no adjust of any kind, and the
  // maths is the 1.21 it always was on both sides of the switch.
  assert.equal(second.adjust, "none", "the sans came out adjusted");
  assert.equal(second.factor, 1, "something is scaling the sans");
  assert.equal(second.katex, "19.36px", "the maths did not stay at 1.21");
  assert.ok(second.lit, "the button is not lit on the face that was asked for");
  assert.equal(second.tip, "LaTeX font");

  assert.deepEqual(h.errors, []);
  await h.close();
});

// The memory of the button, the other way round: an editor opened on a seeded
// `mdm.textFont` comes up in the sans with nothing clicked, the way a document
// reopens in the face it was left in.
test("an editor left in the sans comes back in the sans", { skip }, async () => {
  const h = await open({ text: EXAMPLE, seed: { settings: { textFont: "sans" } } });
  const face = await faceOf(h.page);
  assert.ok(!face.roman, "the seeded sans did not survive the opening");
  assert.match(face.text, /-apple-system/);
  assert.equal(face.adjust, "none");
  assert.equal(face.katex, "19.36px");
  assert.ok(face.lit, "the seeded sans did not light the button");
  assert.equal(face.tip, "LaTeX font");
  await h.page.click('#app button[data-type="mdm-text-font"]');
  await sleep(200);
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "textFont", value: "roman" },
  ]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The syntax palette ----------

// A palette shaped the way the host sends it (theme.js), with colours nothing
// else in the sheets uses, so a computed value can only have come from here.
function palette(kind) {
  return {
    kind: kind,
    colors: {
      base: "#112233",
      bg: "#445566",
      comment: "#010203",
      string: "#040506",
      number: "#070809",
      keyword: "#0a0b0c",
      attr: "#0d0e0f",
      name: "#101112",
      type: "#131415",
      variable: "#161718",
    },
  };
}

// The custom properties as they stand on #app: "" for a slot the webview left
// to the fallbacks in style.css.
function synVars(page) {
  return page.evaluate(() => {
    const root = document.getElementById("app");
    const out = {};
    ["base", "bg", "comment", "string", "number", "keyword", "attr", "name", "type", "variable"]
      .forEach((slot) => {
        out[slot] = root.style.getPropertyValue("--mdm-syn-" + slot);
      });
    return out;
  });
}

// Where the slots are spent: the colour of a YAML key of the header (the
// `attr` slot) and of a keyword of the python block (the `keyword` slot), as
// the CodeMirror highlight style paints the token spans.
function paintedCode(page) {
  return page.evaluate(() => {
    const token = (lineSel, word) =>
      Array.from(document.querySelectorAll(lineSel + " span")).find(
        (s) => s.textContent === word
      );
    const key = token("#app .cm-line.mdm-fm-line", "title");
    const keyword = token("#app .cm-line.mdm-code-line", "def");
    return {
      attr: key ? getComputedStyle(key).color : null,
      keyword: keyword ? getComputedStyle(keyword).color : null,
    };
  });
}

test("the palette of the theme in use paints the code", { skip }, async () => {
  // A named theme and not one of the three MDM looks: those are the editor's
  // own and no palette is spent on them (the test under this one pins that).
  const h = await open({
    seed: {
      settings: { theme: "Solarized Light" },
      themes: [{ name: "Solarized Light", kind: "light" }],
      palette: palette("light"),
      side: "light",
    },
  });
  const vars = await synVars(h.page);
  assert.deepEqual(vars, palette("light").colors);
  // And they are spent: the YAML keys of the header take the `attr` colour,
  // which is the slot the whole mechanism was built for, and the keywords of
  // the code the `keyword` one.
  assert.deepEqual(await paintedCode(h.page), {
    attr: "rgb(13, 14, 15)",
    keyword: "rgb(10, 11, 12)",
  });
  await h.close();
});

test("the editor's own looks take no palette at all", { skip }, async () => {
  // MDM Light, MDM Dark and MDM White are looks of this editor rather than of
  // a theme, which is what their names say: a palette from a dark VS Code
  // theme, with the editor on the dark side where it would otherwise be
  // usable, is still not spent on MDM Dark.
  const h = await open({
    seed: { settings: { theme: "dark" }, palette: palette("dark") },
  });
  assert.deepEqual(
    await synVars(h.page),
    Object.fromEntries(Object.keys(palette("dark").colors).map((k) => [k, ""])),
    "a theme painted one of the editor's own looks"
  );
  // What paints it instead: Monokai's keyword colour, baked into style.css as
  // the dark fallback, over the ground MDM Dark carries, which is the
  // editor.background of Dark 2026 and not Monokai's own #272822. The grounds
  // the reader sees are mixes of it (the page is that background carried 6%
  // towards the ink, the card the panel material over the page), so what is
  // read here is the value they are all derived from.
  assert.equal((await paintedCode(h.page)).keyword, "rgb(249, 38, 114)");
  assert.equal(
    await h.page.evaluate(() =>
      getComputedStyle(document.getElementById("app"))
        .getPropertyValue("--mdm-syn-bg")
        .trim()
    ),
    "#121314",
    "MDM Dark is not standing on Dark 2026's ground"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a palette from the other side is dropped, fallbacks stay", { skip }, async () => {
  // The editor held to the light side by a named light theme, with a palette
  // read off a dark one: dark syntax colours on a light ground are
  // unreadable, so it is dropped.
  const h = await open({
    seed: {
      settings: { theme: "Solarized Light" },
      themes: [{ name: "Solarized Light", kind: "light" }],
      palette: palette("dark"),
      side: "light",
    },
  });
  const vars = await synVars(h.page);
  assert.deepEqual(
    vars,
    Object.fromEntries(Object.keys(palette("light").colors).map((k) => [k, ""]))
  );
  // stackoverflow-light, the fallback in style.css for the light side.
  assert.deepEqual(await paintedCode(h.page), {
    attr: "rgb(1, 86, 146)",
    keyword: "rgb(1, 86, 146)",
  });
  await h.close();
});

test("a palette message repaints the code with no document update", { skip }, async () => {
  const h = await open({
    seed: {
      settings: { theme: "Solarized Light" },
      themes: [{ name: "Solarized Light", kind: "light" }],
      side: "light",
    },
  });
  // Nothing seeded: the editor opens on the fallbacks.
  assert.equal((await synVars(h.page)).string, "");
  await h.page.evaluate((p) => {
    window.postMessage({ type: "palette", palette: p, side: "light" }, "*");
  }, palette("light"));
  await sleep(300);
  assert.deepEqual(await synVars(h.page), palette("light").colors);
  assert.equal((await paintedCode(h.page)).keyword, "rgb(10, 11, 12)");
  // And a palette that no longer matches the side is taken back off.
  await h.page.evaluate((p) => {
    window.postMessage({ type: "palette", palette: p, side: "light" }, "*");
  }, palette("dark"));
  await sleep(300);
  assert.equal((await synVars(h.page)).string, "");
  assert.equal((await paintedCode(h.page)).keyword, "rgb(1, 86, 146)");
  await h.close();
});

test("a named theme brings its own side, palette and all", { skip }, async () => {
  // mdm.theme holding the name of a dark VS Code theme: the host says which
  // side it sits on, and the editor follows it without any VS Code theme kind
  // on the body.
  const h = await open({
    seed: {
      settings: { theme: "Monokai" },
      themes: [{ name: "Monokai", kind: "dark" }],
      palette: palette("dark"),
      side: "dark",
    },
  });
  assert.equal(
    await h.page.evaluate(() =>
      document.getElementById("app").classList.contains("mdm--dark")
    ),
    true,
    "the editor did not follow the theme to the dark side"
  );
  assert.deepEqual(await synVars(h.page), palette("dark").colors);
  assert.equal((await paintedCode(h.page)).keyword, "rgb(10, 11, 12)");
  await h.close();
});

// ---------- The ABC colours ----------

// The source of a score is painted apart from the code around it: its tags
// are the extension's own (abc.js in the bundle) and the classes take fixed
// colours from style.css, the brass of the icon and the ink beside it, so no
// VS Code palette ever reaches a score. The caret has to open the block
// first: the spans only exist while the source is on show.
function abcPaint(page) {
  return page.evaluate(() => {
    const token = (cls, word) => {
      const span = Array.from(
        document.querySelectorAll("#app .cm-line.mdm-abc-line span." + cls)
      ).find((s) => s.textContent === word);
      return span ? getComputedStyle(span).color : null;
    };
    const lyric = document.querySelector(
      "#app .cm-line.mdm-abc-line span.mdm-abc-lyric"
    );
    // The word the mark decoration wraps, measured where the paint lands:
    // the Markdown highlighting already put a span of its own inside it,
    // and an inner span with a colour rule wins on the text.
    const marked = document.querySelector("#app .cm-line.mdm-fence-line .mdm-fence-info");
    const info = marked ? marked.querySelector("span") || marked : null;
    const line = document.querySelector("#app .cm-line.mdm-abc-line");
    return {
      // The staff ink: the field labels and the bar lines, as on paper.
      field: token("mdm-abc-field", "T:"),
      bar: token("mdm-abc-bar", "|"),
      // The brass: the notes, and the word on the fence that says this
      // block is a score.
      note: token("mdm-abc-note", "C"),
      info: info ? getComputedStyle(info).color : null,
      // The rest of the family.
      setting: token("mdm-abc-fieldval", "C clef=treble"),
      text: token("mdm-abc-fieldtext", "Partials of a vibrating string"),
      comment: token("mdm-abc-comment", "%%stretchlast 1"),
      lyricStyle: lyric ? getComputedStyle(lyric).fontStyle : null,
      // The plumbing between the notes takes no token of its own and must
      // not be left to the theme: the line carries the staff ink.
      plumbing: line ? getComputedStyle(line).color : null,
    };
  });
}

test("the score source is painted in the extension's own brass, palette or none", { skip }, async () => {
  // Light, with a palette seeded: the code around takes the palette, the
  // score does not.
  let h = await open({
    seed: {
      settings: { theme: "Solarized Light" },
      themes: [{ name: "Solarized Light", kind: "light" }],
      palette: palette("light"),
      side: "light",
    },
  });
  await setSelection(h.page, await posOf(h.page, "vibrating string"));
  await sleep(400);
  assert.equal((await paintedCode(h.page)).keyword, "rgb(10, 11, 12)");
  assert.deepEqual(await abcPaint(h.page), {
    field: "rgb(58, 53, 43)",
    bar: "rgb(58, 53, 43)",
    note: "rgb(138, 95, 0)",
    info: "rgb(138, 95, 0)",
    setting: "rgb(141, 104, 22)",
    text: "rgb(90, 82, 71)",
    comment: "rgb(120, 114, 101)",
    lyricStyle: "italic",
    plumbing: "rgb(58, 53, 43)",
  });
  await h.close();

  // Dark: the brass of the sounding note (--mdm-play-accent) and the cream
  // of the icon's lettering, straight from style.css.
  h = await open({ seed: { settings: { theme: "dark" } } });
  await setSelection(h.page, await posOf(h.page, "vibrating string"));
  await sleep(400);
  assert.deepEqual(await abcPaint(h.page), {
    field: "rgb(240, 235, 221)",
    bar: "rgb(240, 235, 221)",
    note: "rgb(217, 169, 79)",
    info: "rgb(217, 169, 79)",
    setting: "rgb(214, 189, 131)",
    text: "rgb(201, 193, 175)",
    comment: "rgb(138, 130, 114)",
    lyricStyle: "italic",
    plumbing: "rgb(240, 235, 221)",
  });
  // The brass of the notes is the same value the note lit while it sounds
  // takes, which is what makes the source and the engraving one colour.
  assert.equal(
    await h.page.evaluate(() =>
      getComputedStyle(document.getElementById("app"))
        .getPropertyValue("--mdm-play-accent").trim()
    ),
    "#d9a94f"
  );
  await h.close();
});

// A run of `code` inside a sentence, which the Vditor content themes washed
// with a colour of their own: 5% black in light, barely visible on a page
// that is already off white, and 36% of a Google blue in dark. It takes the
// ground of the code cards instead, on both sides, and nothing else that is
// drawn as code picks up its hairline edge.
function inlineCodeColours(page) {
  return page.evaluate(() => {
    const chip = document.querySelector("#app .mdm-inline-code");
    const card = document.querySelector("#app .cm-line.mdm-code-line");
    const score = document.querySelector("#app code.language-abc");
    const header = document.querySelector("#app .cm-line.mdm-fm-line");
    const maths = document.querySelector("#app .mdm-math-src");
    const width = (el) => (el ? getComputedStyle(el).borderTopWidth : null);
    return {
      text: chip ? chip.textContent : null,
      chipBg: chip ? getComputedStyle(chip).backgroundColor : null,
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
      chipEdge: width(chip),
      scoreEdge: width(score),
      headerEdge: width(header),
      sourceEdge: width(card),
      mathsEdge: width(maths),
    };
  });
}

test("inline code sits on the code ground, not the theme's own wash", { skip }, async () => {
  for (const side of ["light", "dark"]) {
    const h = await open({ seed: { settings: { theme: side } } });
    // The source of a run of inline maths shows while the caret is in it. The
    // run is found in the syntax tree rather than by its LaTeX: example.mdm is
    // written and rewritten by hand and its wording drifts.
    const inlineMath = await h.page.evaluate(() => {
      const { view, CM } = window.__mdm;
      let at = -1;
      CM.syntaxTree(view.state).iterate({
        enter(n) {
          if (at < 0 && n.name === "InlineMath") at = n.from + 1;
        },
      });
      return at;
    });
    assert.ok(inlineMath > 0, "the example has no inline maths");
    await setSelection(h.page, inlineMath);
    await sleep(200);
    const c = await inlineCodeColours(h.page);
    // The backticks are marks, hidden while no caret is on the run: the chip
    // shows the code alone, and the document holds it between backticks.
    assert.ok(c.text && !c.text.includes("`"), "the chip kept its backticks: " + c.text);
    assert.ok(
      (await docText(h.page)).includes("`" + c.text + "`"),
      "the chip is not a run of the document: " + c.text
    );
    assert.equal(c.chipBg, c.cardBg, "chip and card on different grounds (" + side + ")");
    assert.equal(c.chipEdge, "1px", "the chip lost its edge (" + side + ")");
    // The blue the dark content theme painted it with, gone on both sides.
    assert.notEqual(c.chipBg, "rgba(66, 133, 244, 0.36)");
    // The edge belongs to the chip alone: a score is a <code> as well, and so
    // are the lines of code and of the YAML header, and the source of a run of
    // inline maths, which shows the moment the caret goes into it.
    assert.equal(c.scoreEdge, "0px", "a score took the chip edge (" + side + ")");
    assert.equal(c.headerEdge, "0px", "the header took the chip edge (" + side + ")");
    assert.equal(c.sourceEdge, "0px", "a code line took the chip edge (" + side + ")");
    assert.equal(c.mathsEdge, "0px", "inline maths took the chip edge (" + side + ")");
    await h.close();
  }
});

// ---------- Staff lines ----------

// The fill of the five staff lines, which carry the .abcjs-staff class that
// add_classes asks abcjs for, and of a note head, which must not follow them.
function staffColours(page) {
  return page.evaluate(() => {
    const svg = document.querySelector("#app code.language-abc svg");
    // abcjs 6 draws the five staff lines as <path> children of a
    // <g class="abcjs-staff">, each path carrying its own fill="currentColor"
    // attribute. A fill set on the group is not inherited past that attribute,
    // so the visible colour of a line is the path's, not the group's: the
    // measurement has to read the path or it reports gray while the lines
    // stay in ink.
    const staff = svg.querySelector(".abcjs-staff path") || svg.querySelector(".abcjs-staff");
    const note = svg.querySelector(".abcjs-note");
    const btn = document.querySelector('#app button[data-type="mdm-staff-lines"]');
    return {
      staff: staff ? getComputedStyle(staff).fill : null,
      note: note ? getComputedStyle(note).fill : null,
      // abcjs 6 engraves in currentColor, so the ink of a score is the ink
      // of the editor (--mdm-ink), not literal black.
      ink: getComputedStyle(document.getElementById("app")).color,
      gray: document.getElementById("app").classList.contains("mdm-staff--gray"),
      tip: btn.getAttribute("aria-label"),
      // The lit state of a toolbar button that holds one.
      current: btn.classList.contains("mdm-btn--on"),
    };
  });
}

test("staff lines are gray by default and the button puts them back in ink", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light" } } });
  const before = await staffColours(h.page);
  assert.equal(before.gray, true, "the default is not gray");
  assert.equal(before.staff, "rgb(163, 163, 163)");
  // Notes, clefs and bar lines keep the ink colour: that is the whole point.
  assert.equal(before.note, before.ink);
  assert.equal(before.ink, "rgb(36, 41, 46)", "the light ink");
  // The tooltip names where the click leads, and the button is quiet while the
  // default holds.
  assert.equal(before.tip, "Ink staff lines");
  assert.equal(before.current, false);

  await h.page.click('#app button[data-type="mdm-staff-lines"]');
  await sleep(200);
  assert.deepEqual(
    await setSettingPosts(h.page),
    [{ type: "setSetting", key: "staffLines", value: "ink" }],
    "the button did not ask the host for ink"
  );
  // Nothing moves until the host answers.
  assert.equal((await staffColours(h.page)).staff, "rgb(163, 163, 163)");

  await postSettings(h.page, { staffLines: "ink" });
  await sleep(300);
  const after = await staffColours(h.page);
  assert.equal(after.gray, false);
  assert.equal(after.staff, after.ink, "the staff did not go back to ink");
  assert.equal(after.tip, "Gray staff lines");
  assert.equal(after.current, true, "ink is the state the button marks");
  await h.close();
});

test("gray staff lines are a darker gray on the dark side", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "dark" } } });
  const out = await staffColours(h.page);
  assert.equal(out.gray, true);
  assert.equal(out.staff, "rgb(111, 111, 111)");
  // The dark repaint takes the notes, and the gray rule outranks it on the
  // staff lines alone.
  assert.equal(out.note, "rgb(212, 212, 212)");
  await h.close();
});

// ---------- Score fill ----------

function fillState(page) {
  return page.evaluate(() => {
    const root = document.getElementById("app");
    const code = document.querySelector("#app code.language-abc");
    return {
      filled: root.classList.contains("mdm-score--filled"),
      variable: root.style.getPropertyValue("--mdm-score-fill"),
      background: getComputedStyle(code).backgroundColor,
      // The pulse a copy plays on this card: both wash the same brass over
      // the block, and differ only in the ground they settle back onto,
      // which a cleared card does not have.
      pulse: (function () {
        code.classList.add("mdm-copy-pulse");
        const name = getComputedStyle(code).animationName;
        code.classList.remove("mdm-copy-pulse");
        return name;
      })(),
    };
  });
}

test("a score is cleared by default and the menu fills it", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light" } } });
  const before = await fillState(h.page);
  assert.equal(before.filled, false);
  assert.match(before.background, /rgba\(0, 0, 0, 0\)|transparent/);
  assert.equal(before.pulse, "mdm-copy-pulse");

  // The menu lists the four fills, with a tick on the one in use.
  await h.page.click('#app button[data-type="mdm-score-fill"]');
  await sleep(200);
  const entries = await h.page.evaluate(() =>
    Array.from(
      document.querySelectorAll('#app button.mdm-menu__item[data-type^="mdm-score-"]')
    ).map((b) => b.textContent.trim())
  );
  assert.deepEqual(entries, ["None✓", "Paper", "Slate", "Brass"]);

  await h.page.click('#app button[data-type="mdm-score-brass"]');
  await sleep(200);
  assert.deepEqual(await setSettingPosts(h.page), [
    { type: "setSetting", key: "scoreFill", value: "brass" },
  ]);

  await postSettings(h.page, { scoreFill: "brass" });
  await sleep(300);
  const after = await fillState(h.page);
  assert.equal(after.filled, true);
  assert.equal(after.variable, "#f7edd8", "the light brass value");
  assert.equal(after.background, "rgb(247, 237, 216)");
  // A card with a colour of its own settles the brass wash back onto that fill.
  assert.equal(after.pulse, "mdm-copy-pulse-filled");
  await h.close();
});

test("a fill carries a value for each side", { skip }, async () => {
  const h = await open({
    seed: { settings: { theme: "dark", scoreFill: "brass" } },
  });
  const out = await fillState(h.page);
  assert.equal(out.filled, true);
  assert.equal(out.variable, "#332c1c", "the dark brass value");
  assert.equal(out.background, "rgb(51, 44, 28)");
  await h.close();
});

// ---------- Click to edit ----------

test("clicking a rendered block opens its source", { skip }, async () => {
  // The YAML header is no longer a rendered block: its lines are always in
  // the text. A click on a display equation or a score puts the caret at
  // the start of its source, which opens above the drawing; the drawing
  // stays as the live preview.
  const h = await open({});
  for (const block of [
    { sel: "#app .mdm-math--block", src: "mdm-math-line" },
    { sel: "#app .mdm-score", src: "mdm-src-line" },
  ]) {
    const box = await h.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.scrollIntoView();
      const r = el.getBoundingClientRect();
      return { x: r.x + 30, y: r.y + Math.min(20, r.height / 2) };
    }, block.sel);
    await sleep(150);
    await h.page.mouse.click(box.x, box.y);
    await sleep(300);
    const state = await h.page.evaluate(
      (sel, src) => {
        const lines = Array.from(document.querySelectorAll("#app .cm-line." + src));
        return {
          widget: !!document.querySelector(sel),
          sourceHeight: Math.round(
            lines.reduce((sum, l) => sum + l.getBoundingClientRect().height, 0)
          ),
        };
      },
      block.sel,
      block.src
    );
    const ranges = await selectionRanges(h.page);
    const caret = await lineAt(h.page, ranges[0][0]);
    assert.ok(state.sourceHeight > 10, block.sel + " source stayed collapsed");
    assert.equal(state.widget, true, block.sel + " went away when opened");
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0][0], ranges[0][1], block.sel + ": the click left a selection");
    assert.match(caret.className, new RegExp(block.src), block.sel + ": the caret is not in the source");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- Rendered block edges ----------

// A forward Delete inside a paragraph is the browser's own, and must leave
// the rendered blocks around it as they were.
const EDGES = [
  "---",
  'title: "Edges"',
  "---",
  "",
  "Intro paragraph.",
  "",
  "$$",
  "E = mc^2",
  "$$",
  "",
  "Middle paragraph.",
  "",
  "```js",
  "let a = 1;",
  "```",
  "",
  "After code.",
  "",
  "```abc",
  "X:1",
  "K:C",
  "CDEF|",
  "```",
  "",
  "```abc",
  "X:1",
  "K:C",
  "GABc|",
  "```",
  "",
  "```abc",
  "X:1",
  "K:C",
  "cdef|",
  "```",
  "",
  "Outro paragraph.",
  "",
].join("\n");

// The display equation: rendered, and opened (its source lines showing) or not.
function mathState(page) {
  return page.evaluate(() => {
    const block = document.querySelector("#app .mdm-math--block");
    if (!block) return { present: false };
    return {
      present: true,
      expanded: document.querySelectorAll("#app .cm-line.mdm-math-line").length > 0,
      katex: !!block.querySelector(".katex"),
    };
  });
}

test("an ordinary delete inside a paragraph stays ordinary", { skip }, async () => {
  const h = await open({ text: EDGES });
  await setSelection(h.page, await posOf(h.page, "Intro paragraph.", 6));
  await h.page.keyboard.press("Delete");
  await sleep(400);
  const s = await mathState(h.page);
  assert.equal(s.present, true);
  assert.equal(s.expanded, false, "a mid-paragraph delete opened the equation");
  const disk = fromEditor(await lastEdit(h.page), EDGES, true);
  assert.equal(disk, EDGES.replace("Intro paragraph.", "Intro aragraph."));
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A drop-down panel keeps its contrast even when mdm.theme holds the editor
// to a side the VS Code theme does not share. The panel used the VS Code
// widget background, which under a dark VS Code theme came out dark behind
// the light-side ink of the menu text: dark on dark, unreadable. It now takes
// the editor's own ground, which moves with the same side as the ink.
test("a drop-down keeps its contrast when the editor and VS Code disagree on side", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light", frontMatter: "hidden" } } });
  // VS Code on a dark theme: seed the widget/background vars dark, as the host
  // would hand them over.
  await h.page.evaluate(() => {
    const a = document.getElementById("app");
    a.style.setProperty("--vscode-editorWidget-background", "#1e1e1e");
    a.style.setProperty("--vscode-editor-background", "#1e1e1e");
  });
  await h.page.click('#app button[data-type="mdm-theme"]');
  await sleep(150);
  const seen = await h.page.evaluate(() => {
    const panel = document.querySelector("#app .mdm-toolbar__item--open .mdm-menu");
    const item = document.querySelector('#app button[data-type="mdm-theme-0"]');
    const lum = (c) => {
      // rgb(...) gives 0-255 components; a color-mix result serializes as
      // color(srgb ...) with 0-1 components. Normalize both to 0-1.
      const m = c.match(/[\d.]+/g).map(Number);
      const scale = c.indexOf("color(") === 0 ? 1 : 255;
      return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / scale;
    };
    const bg = getComputedStyle(panel).backgroundColor;
    const fg = getComputedStyle(item).color;
    return {
      bgLum: lum(bg),
      fgLum: lum(fg),
      bg,
      fg,
      shadow: getComputedStyle(panel).boxShadow,
    };
  });
  // Light editor: the panel is light (near the page), the text dark, and the
  // two are far apart. The dark VS Code var must not have leaked in.
  assert.ok(seen.bgLum > 0.7, "the panel went dark under the editor's light side: " + seen.bg);
  assert.ok(seen.bgLum - seen.fgLum > 0.4, "panel and text do not contrast: " + seen.bg + " / " + seen.fg);
  // The border lifts the panel off the page on its own; the drop shadow it
  // used to carry read as a hard frame around a tall one.
  assert.equal(seen.shadow, "none", "the panel kept its shadow: " + seen.shadow);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// The scrollbars are the editor's own, painted in the ink of the side it is
// showing. They were the browser's, and the browser drew them from what VS
// Code puts on the webview root: its colour scheme, and its own
// scrollbar-color, which is inherited and which disables every
// ::-webkit-scrollbar rule it reaches. So the first two goes at this (a colour
// scheme on #app, then the bars painted with the webkit pseudo-elements) left
// the theme menu with a black track down a white panel under a dark VS Code,
// the third report of the same bar. The colours are set with the standard
// properties now, which is what the host sets and what the editor has to
// outrank; the harness replays the host's sheet so this is tested against it.
const MANY_THEMES = [
  "Abyss", "Dark Modern", "Dark+", "Default High Contrast",
  "Default High Contrast Light", "Kimbie Dark", "Light Modern", "Light+",
  "Monokai", "Monokai Dimmed", "Quiet Light", "Red", "Solarized Dark",
  "Solarized Light", "Tomorrow Night Blue",
].map((name) => ({ name, kind: /light|quiet/i.test(name) ? "light" : "dark" }));

test("the editor paints its own scrollbars, in the ink of the side it shows", { skip }, async () => {
  for (const [side, want] of [["light", "light"], ["dark", "dark"], ["white", "light"]]) {
    // A short pane on purpose: the panel is capped at 60vh, so a tall window
    // would show the whole list and there would be no bar to look at.
    const h = await open({
      height: 600,
      scores: 0,
      seed: { settings: { theme: side, frontMatter: "hidden" }, themes: MANY_THEMES },
    });
    // VS Code on a dark theme marks the root with its scheme.
    await h.page.evaluate(() => {
      document.documentElement.style.colorScheme = "dark";
    });
    await sleep(150);
    await h.page.click('#app button[data-type="mdm-theme"]');
    await sleep(200);
    const seen = await h.page.evaluate(() => {
      const scheme = (el) => (el ? getComputedStyle(el).colorScheme : null);
      // A colour as three 0-255 components, whether it serializes as rgb()
      // or as color(srgb ...), which is what a color-mix comes back as.
      const rgb = (c) => {
        const parts = (c.match(/[\d.]+/g) || []).map(Number);
        const scale = c.indexOf("color(") === 0 ? 255 : 1;
        return parts.slice(0, 3).map((v) => Math.round(v * scale));
      };
      // scrollbar-color is two colours, the thumb's and the track's. The
      // track's is transparent here, so the panel shows through it, and a
      // transparent colour serializes with its own channels at zero: what is
      // read off the thumb is the first of the two.
      const bar = (el) => {
        const both =
          getComputedStyle(el).scrollbarColor.match(/[a-z-]+\([^()]*\)|[a-z]+/gi) || [];
        return { thumb: rgb(both[0] || ""), track: both[1] || "" };
      };
      const app = document.getElementById("app");
      const menu = document.querySelector("#app .mdm-toolbar__item--open .mdm-menu");
      const scroller = document.querySelector("#app .cm-scroller");
      return {
        root: scheme(document.documentElement),
        app: scheme(app),
        scroller: scheme(scroller),
        menu: scheme(menu),
        ink: rgb(getComputedStyle(app).color),
        hostBar: getComputedStyle(document.documentElement).scrollbarColor,
        menuBar: bar(menu),
        pageBar: bar(scroller),
        // The room the bar reserves: what the panel's box holds over what its
        // content is given, less the border, which the first counts and the
        // second does not.
        bar: (() => {
          const cs = getComputedStyle(menu);
          const border =
            parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
          return menu.offsetWidth - menu.clientWidth - border;
        })(),
        width: getComputedStyle(menu).scrollbarWidth,
        scrolls: menu.scrollHeight > menu.clientHeight,
        acrossToo: menu.scrollWidth > menu.clientWidth,
        gutter: getComputedStyle(menu).scrollbarGutter,
      };
    });
    assert.equal(seen.root, "dark", "the harness did not put VS Code on the dark side");
    assert.equal(seen.app, want, "the editor took the root's scheme (" + side + ")");
    assert.equal(seen.scroller, want, "the page's scrollbar took the root's scheme (" + side + ")");
    assert.equal(seen.menu, want, "the drop-down took the root's scheme (" + side + ")");
    // The host is asking for bars of its own, as it does inside VS Code.
    assert.match(seen.hostBar, /^rgba?\(/, "the harness is not replaying the host's bars");
    // The bars are ours all the same, and the same ink as the text of the side
    // in force, over a track left transparent so the panel shows through.
    assert.deepEqual(seen.menuBar.thumb, seen.ink, "the drop-down's bar is not the editor's ink (" + side + ")");
    assert.deepEqual(seen.pageBar.thumb, seen.ink, "the page's bar is not the editor's ink (" + side + ")");
    assert.equal(seen.menuBar.track, "rgba(0, 0, 0, 0)", "the drop-down's bar has a track of its own (" + side + ")");
    // A thin bar, which is the 10px the editor used to ask for and no stepper
    // arrows at either end. Measured off the gutter, which is the room the bar
    // reserves: this browser floats its bars over the content, so the width
    // the stylesheet asks for shows up nowhere else.
    assert.equal(seen.width, "thin", "the bar is not the editor's own (" + side + ")");
    assert.equal(seen.bar, 10, "the bar is not 10px wide (" + side + ")");
    // A list long enough to scroll must not grow a bar across the bottom as
    // well: the panel is as wide as its widest entry, and the room the
    // vertical bar takes is reserved rather than taken out of that width.
    // The reservation is what is asserted: a bar that floats over the content,
    // which is what this browser draws when it is not told otherwise, takes no
    // width to begin with and so cannot push anything out of the panel here.
    assert.equal(seen.scrolls, true, "the theme list is too short to test with");
    assert.equal(seen.gutter, "stable", "the vertical bar's room is not reserved (" + side + ")");
    assert.equal(seen.acrossToo, false, "the drop-down grew a horizontal bar (" + side + ")");
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

// A selection inside a code block (or a heading, or the header) shows above
// the opaque card those lines sit on. CodeMirror draws the selection on a
// layer behind the content, so a match Ctrl+D found in a code comment was
// hidden under the card; the layer is lifted above the text (its colours are
// translucent). This checks the selection paints on top where a card is.
test("a selection inside a code block shows above its card", { skip }, async () => {
  const h = await open({ seed: { settings: { theme: "light", frontMatter: "hidden" } } });
  await h.page.evaluate(() => window.__mdm.view.focus());
  const top = await h.page.evaluate(() => {
    const { view, CM } = window.__mdm;
    const doc = view.state.doc.toString();
    const at = doc.indexOf("render the score") + "render the ".length;
    view.dispatch({ selection: CM.EditorSelection.range(at, at + 5) });
    return at;
  });
  await sleep(300);
  const painted = await h.page.evaluate((at) => {
    const { view } = window.__mdm;
    const c = view.coordsAtPos(at + 2);
    const el = document.elementsFromPoint(c.left, (c.top + c.bottom) / 2)[0];
    return el ? el.className : null;
  }, top);
  // The topmost box over the selected code word is the selection, not the code
  // line that would otherwise cover it.
  assert.equal(painted, "cm-selectionBackground");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A colour theme installed in VS Code, as the host describes it: named in
// mdm.theme, listed in the menu, and carrying its own side.
function namedTheme(name, side) {
  return { settings: { theme: name }, themes: [{ name, kind: side }], side };
}

// The selection's colour comes from VS Code under "Follow VS Code" and the
// themes installed in it, and VS Code's own themes give it opaque: #add6ff in
// Light Modern, #264f78 in Dark Modern. Lifted above the text by the rule the
// test before this one guards, an opaque colour hid every letter it selected;
// the four notes Ctrl+D took in a tune came out as four solid boxes. The layer
// is blended into the text instead. The editor's own looks select in a brass
// that is just as opaque (the test after this one pins its value). This
// selects a word in a code block under each look and checks that the ground
// under the word changed (the selection shows) and that its letters still
// stand out of that ground.
test("a word under an opaque selection colour keeps its letters", { skip }, async () => {
  for (const [look, seed, colour] of [
    ["Light Modern", namedTheme("Default Light Modern", "light"), "#add6ff"],
    ["Dark Modern", namedTheme("Default Dark Modern", "dark"), "#264f78"],
    ["MDM Light", { settings: { theme: "light" } }, "#add6ff"],
    ["MDM Dark", { settings: { theme: "dark" } }, "#264f78"],
  ]) {
    seed.settings.frontMatter = "hidden";
    const h = await open({ seed });
    await h.page.evaluate((c) => {
      document.documentElement.style.setProperty("--vscode-editor-selectionBackground", c);
      window.__mdm.view.focus();
    }, colour);
    const card = await h.page.evaluate(() => {
      const { view, CM } = window.__mdm;
      const doc = view.state.doc.toString();
      const from = doc.indexOf("render the score") + "render the ".length;
      view.dispatch({ selection: CM.EditorSelection.range(from, from + 5) });
      const line = view.domAtPos(from).node;
      const el = line.nodeType === 1 ? line : line.parentElement;
      return getComputedStyle(el.closest(".cm-line")).backgroundColor;
    });
    await sleep(300);
    const box = await h.page.evaluate(() => {
      const sel = document.querySelector("#app .cm-focused .cm-selectionBackground");
      if (!sel) return null;
      const b = sel.getBoundingClientRect();
      return {
        clip: { x: b.left + 1, y: b.top + 1, width: b.width - 2, height: b.height - 2 },
        paint: getComputedStyle(sel).backgroundColor,
      };
    });
    assert.ok(box, `no selection drawn (${look})`);
    const png = await h.page.screenshot({ clip: box.clip, encoding: "base64" });
    // The ground is the commonest colour in the box; a letter is a pixel whose
    // lightness is far from it.
    const seen = await h.page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = cv.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      const lum = (r, gr, b) => 0.2126 * r + 0.7152 * gr + 0.0722 * b;
      const counts = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const k = `${d[i] >> 2},${d[i + 1] >> 2},${d[i + 2] >> 2}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const ground = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map((v) => v * 4 + 2);
      const at = lum(...ground);
      let letters = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(lum(d[i], d[i + 1], d[i + 2]) - at) > 60) letters++;
      return { ground, letters: letters / (d.length / 4) };
    }, png);
    const unselected = card.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const moved = Math.max(...seen.ground.map((v, i) => Math.abs(v - unselected[i])));
    assert.ok(moved > 12, `the selection does not show on the card (${look}): ground ${seen.ground} against ${card}`);
    assert.ok(
      seen.letters > 0.04,
      `the selected letters are hidden under ${box.paint} (${look}): ${(seen.letters * 100).toFixed(1)}% of the box stands out`
    );
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

// MDM Light, MDM Dark and MDM White select in the editor's own colour, the
// brass of the accent (--mdm-play-accent-ink, #8a5f00 at 25% on white and
// #d9a94f at 30% on black), and not in the VS Code theme's. An own look is
// the same editor whatever VS Code wears, and the theme's colour belongs to
// the theme's side: MDM Light inside Dark Modern selected in Dark Modern's
// blue on paper. Out of focus the brass is at half strength, where VS Code
// greys its own. The colours VS Code hands over here are the other side's,
// the case that went wrong; a named theme goes on taking them.
test("the editor's own looks select in brass", { skip }, async () => {
  const DARK_MODERN = ["#264f78", "#3a3d41"];
  const LIGHT_MODERN = ["#add6ff", "#e5ebf1"];
  for (const [look, seed, vscode, focused, idle] of [
    ["MDM Light", { settings: { theme: "light" } }, DARK_MODERN, "rgb(226, 215, 191)", "rgb(240, 235, 223)"],
    ["MDM White", { settings: { theme: "white" } }, DARK_MODERN, "rgb(226, 215, 191)", "rgb(240, 235, 223)"],
    ["MDM Dark", { settings: { theme: "dark" } }, LIGHT_MODERN, "rgb(65, 51, 24)", "rgb(33, 25, 12)"],
    ["Light Modern", namedTheme("Default Light Modern", "light"), LIGHT_MODERN, "rgb(173, 214, 255)", "rgb(229, 235, 241)"],
  ]) {
    const h = await open({ seed });
    const painted = await h.page.evaluate(async ([active, inactive]) => {
      const root = document.documentElement.style;
      root.setProperty("--vscode-editor-selectionBackground", active);
      root.setProperty("--vscode-editor-inactiveSelectionBackground", inactive);
      const { view, CM } = window.__mdm;
      const until = async (ok) => {
        for (let i = 0; i < 50 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
      };
      const colour = () => {
        const sel = document.querySelector("#app .cm-selectionBackground");
        return sel && getComputedStyle(sel).backgroundColor;
      };
      view.focus();
      const from = view.state.doc.toString().indexOf("render the score");
      view.dispatch({ selection: CM.EditorSelection.range(from, from + 6) });
      await until(() => document.querySelector("#app .cm-focused .cm-selectionBackground"));
      const focused = colour();
      view.contentDOM.blur();
      await until(() => !document.querySelector("#app .cm-focused"));
      return { focused, idle: colour(), blurred: !document.querySelector("#app .cm-focused") };
    }, vscode);
    assert.ok(painted.blurred, `the editor kept its focus (${look})`);
    assert.deepEqual([painted.focused, painted.idle], [focused, idle], look);
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

// The LaTeX inside inline and block maths is syntax-highlighted while its
// source shows (a stex overlay on the math content, mounted in the Lezer tree
// and coloured by the same palette as code). Regression guard: the content
// used to be one flat monospace colour.
test("the LaTeX of a shown equation is syntax-highlighted", { skip }, async () => {
  const h = await open({
    text: "Inline $\\frac{a}{b} = 3$ and\n\n$$\ny = \\sum_{n=1}^{10} A_n\n$$\n\nend.\n",
    scores: 0,
    seed: { settings: { theme: "light", frontMatter: "hidden" } },
  });
  await h.page.evaluate(() => window.__mdm.view.focus());
  // Caret in the inline maths: its source shows, with the control sequence
  // coloured as a keyword and more than one colour in play.
  await h.page.evaluate(() => {
    const at = window.__mdm.view.state.doc.toString().indexOf("frac");
    window.__mdm.view.dispatch({ selection: { anchor: at } });
  });
  await sleep(200);
  const inline = await h.page.evaluate(() => {
    const src = document.querySelector("#app .mdm-math-src");
    const spans = Array.from(src.querySelectorAll("span"));
    const cmd = spans.find((s) => s.textContent === "\\frac");
    return {
      cmdColor: cmd ? getComputedStyle(cmd).color : null,
      colours: [...new Set(spans.map((s) => getComputedStyle(s).color))].length,
    };
  });
  // #015692, the keyword colour of the light palette.
  assert.equal(inline.cmdColor, "rgb(1, 86, 146)", "\\frac is not coloured as a keyword");
  assert.ok(inline.colours >= 2, "the inline maths has only " + inline.colours + " colour");
  // Caret in the block maths: the same, over its source lines.
  await h.page.evaluate(() => {
    const at = window.__mdm.view.state.doc.toString().indexOf("sum");
    window.__mdm.view.dispatch({ selection: { anchor: at } });
  });
  await sleep(200);
  const block = await h.page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll("#app .cm-line.mdm-math-line"));
    const spans = lines.flatMap((l) => Array.from(l.querySelectorAll("span")));
    const cmd = spans.find((s) => s.textContent.indexOf("\\sum") === 0);
    return {
      cmdColor: cmd ? getComputedStyle(cmd).color : null,
      colours: [...new Set(spans.map((s) => getComputedStyle(s).color))].length,
    };
  });
  assert.equal(block.cmdColor, "rgb(1, 86, 146)", "\\sum is not coloured as a keyword");
  assert.ok(block.colours >= 3, "the block maths has only " + block.colours + " colours");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- Tables ----------

// A pipe table with everything a table of a paper carries: maths in the
// cells, the three alignments and a column that asked for none, an inline
// mark and a piece of code.
const TABLE_DOC = [
  "---",
  'title: "Tables"',
  "---",
  "",
  "The fixtures of the chapter.",
  "",
  "| $i$ | $A_i$ | index and type | purpose |",
  "| ---: | :---: | :--- | --- |",
  "| 1 | $\\operatorname{diag}(-0.5)$ | 0, sink | **basic** attractor |",
  "| 2 | $\\mathcal{S}(0.5,1.2)$ | 2, saddle | a `code` cell |",
  "",
  "After the table.",
  "",
].join("\n");

test("a table is drawn, with the alignment of its columns and the maths in its cells", { skip }, async () => {
  const h = await open({ text: TABLE_DOC, scores: 0 });
  const drawn = await h.page.evaluate(() => {
    const cells = (sel) =>
      Array.from(document.querySelectorAll("#app .mdm-table " + sel)).map((c) => ({
        align: c.style.textAlign,
        katex: c.querySelectorAll(".katex").length,
        strong: c.querySelectorAll("strong").length,
        code: c.querySelectorAll("code").length,
      }));
    return {
      tables: document.querySelectorAll("#app .mdm-table table").length,
      head: cells("th"),
      body: cells("tbody td"),
      // The pipes are out of the flow while no caret is in them.
      source: document.querySelectorAll("#app .cm-line.mdm-table-line").length,
    };
  });
  assert.equal(drawn.tables, 1, "the table was not drawn");
  assert.equal(drawn.source, 0, "the source of the table stayed in the flow");
  assert.deepEqual(
    drawn.head.map((c) => c.align),
    ["right", "center", "left", ""],
    "the alignment row was not read"
  );
  assert.deepEqual(
    drawn.body.map((c) => c.align),
    ["right", "center", "left", "", "right", "center", "left", ""],
    "the body does not follow the alignment of its columns"
  );
  // The equations of the head and of the second column are rendered, and the
  // marks of the last column with them.
  assert.equal(drawn.head.filter((c) => c.katex === 1).length, 2);
  assert.equal(drawn.body.filter((c) => c.katex === 1).length, 2);
  assert.equal(drawn.body.filter((c) => c.strong === 1).length, 1);
  assert.equal(drawn.body.filter((c) => c.code === 1).length, 1);
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("a caret in a table shows the pipes, and the drawing stays as its preview", { skip }, async () => {
  const h = await open({ text: TABLE_DOC, scores: 0 });
  const at = await posOf(h.page, "0, sink");
  await setSelection(h.page, at);
  await sleep(250);
  const open1 = await h.page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll("#app .cm-line.mdm-table-line"));
    return {
      source: lines.map((l) => l.textContent),
      // A monospace grid, so the columns of a row line up under the ones above.
      mono: lines.length ? getComputedStyle(lines[0]).fontFamily : null,
      table: document.querySelectorAll("#app .mdm-table table").length,
    };
  });
  assert.equal(open1.source.length, 4, "the four lines of the table did not show");
  assert.equal(open1.source[0], "| $i$ | $A_i$ | index and type | purpose |");
  assert.match(open1.mono, /mono/i, "the source of the table is not monospaced");
  assert.equal(open1.table, 1, "the drawing went away while its source was open");
  // The caret out again and the source folds back under the drawing.
  await setSelection(h.page, 0);
  await sleep(250);
  const closed = await h.page.evaluate(() => ({
    source: document.querySelectorAll("#app .cm-line.mdm-table-line").length,
    table: document.querySelectorAll("#app .mdm-table table").length,
  }));
  assert.deepEqual(closed, { source: 0, table: 1 });
  assert.equal(await docText(h.page), TABLE_DOC, "the document was changed by looking at it");
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("clicking a drawn table opens its source at the cell that was clicked", { skip }, async () => {
  const h = await open({ text: TABLE_DOC, scores: 0 });
  const box = await h.page.evaluate(() => {
    const el = document.querySelector("#app .mdm-table td");
    el.scrollIntoView();
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await sleep(150);
  await h.page.mouse.click(box.x, box.y);
  await sleep(300);
  const ranges = await selectionRanges(h.page);
  const caret = await lineAt(h.page, ranges[0][0]);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0][0], ranges[0][1], "the click left a selection");
  assert.match(caret.text, /^\| 1 \|/, "the caret did not land on the row that was clicked");
  const cell = await h.page.evaluate(
    (pos) => window.__mdm.view.state.doc.sliceString(pos, pos + 1),
    ranges[0][0]
  );
  assert.equal(cell, "1", "the caret did not land on the first cell of that row");
  assert.equal(
    await h.page.evaluate(() => document.querySelectorAll("#app .cm-line.mdm-table-line").length),
    4,
    "the source did not open"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A table too tall for the pane, with prose above and below it, for the
// scroll the reveal used to cause.
const TALL_TABLE = [
  ...Array.from({ length: 20 }, (_, i) => "Paragraph " + (i + 1) + " above.\n"),
  "| $i$ | purpose |",
  "| ---: | :--- |",
  ...Array.from({ length: 14 }, (_, i) => "| " + (i + 1) + " | row " + (i + 1) + " |"),
  "",
  ...Array.from({ length: 20 }, (_, i) => "Paragraph " + (i + 1) + " below.\n"),
].join("\n");

test("opening a table from a click does not scroll the document out from under it", { skip }, async () => {
  const h = await open({ text: TALL_TABLE, withFrontMatter: false, scores: 0, height: 600 });
  // The head of the table off the top of the pane, which is the case the
  // source used to grow into: its lines are added above the drawing, so
  // everything under them moved down by the height they took.
  await h.page.evaluate(() => {
    const { EditorView } = window.__mdm.CM;
    const view = window.__mdm.view;
    const at = view.state.doc.toString().indexOf("| $i$");
    view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "start" }) });
  });
  await sleep(350);
  const click = await h.page.evaluate(() => {
    const scroller = window.__mdm.view.scrollDOM;
    const box = scroller.getBoundingClientRect();
    const table = document.querySelector("#app .mdm-table");
    const r = table.getBoundingClientRect();
    scroller.scrollTop += r.top - box.top + 100; // 100px of the table off the top
    const rows = document.querySelectorAll("#app .mdm-table tbody tr");
    const cell = rows[rows.length - 1].children[1].getBoundingClientRect();
    return { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
  });
  await sleep(250);
  await h.page.mouse.click(click.x, click.y);
  await sleep(350);
  const landed = await h.page.evaluate(() => {
    const view = window.__mdm.view;
    const coords = view.coordsAtPos(view.state.selection.main.head);
    return coords ? (coords.top + coords.bottom) / 2 : null;
  });
  assert.ok(landed !== null, "the caret is not on the screen");
  // The line of the cell that was clicked sits where that cell was.
  assert.ok(
    Math.abs(landed - click.y) <= 4,
    "the source opened " + Math.round(landed - click.y) + "px from the click"
  );
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- Images ----------

const IMAGE_DOC = [
  "Two figures.",
  "",
  "![One beside the text.](figures/near.svg)",
  "",
  "![One written by another project.](/data/runs/figures/far.svg)",
  "",
].join("\n");

test("a relative image hangs from the folder of the document, an absolute one from the root", { skip }, async () => {
  // The two bases the host hands over, as it builds them for a document in
  // /home/me/papers: the folder for a relative path, the root of the
  // filesystem for an absolute one.
  const h = await open({
    text: IMAGE_DOC,
    withFrontMatter: false,
    scores: 0,
    seed: { docBase: "https://vsc.test/home/me/papers", fileBase: "https://vsc.test/" },
  });
  const srcs = await h.page.evaluate(() =>
    Array.from(document.querySelectorAll("#app img.mdm-image")).map((i) => i.getAttribute("src"))
  );
  assert.deepEqual(srcs, [
    "https://vsc.test/home/me/papers/figures/near.svg",
    // Not the folder of the document with the absolute path glued behind it.
    "https://vsc.test/data/runs/figures/far.svg",
  ]);
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A figure small enough to write into the document, so the test has one that
// really loads: a 100x70 white PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABGCAYAAAAr1V1TAAAAKklEQVR4" +
  "nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAHwbLcQAAaHYVR0AAAAASUVORK5CYII=";

test("a figure carries the pointer, and a click on it opens its source", { skip }, async () => {
  const h = await open({
    text: ["Above.", "", "![A figure.](" + PNG + ")", "", "Below.", ""].join("\n"),
    withFrontMatter: false,
    scores: 0,
  });
  const cursor = await h.page.evaluate(
    () => getComputedStyle(document.querySelector("#app img.mdm-image")).cursor
  );
  // The caret of the text says "type here", and on a drawing that opens it
  // said the wrong thing: a score, an equation and a table all point.
  assert.equal(cursor, "pointer");
  const box = await h.page.evaluate(() => {
    const r = document.querySelector("#app img.mdm-image").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await h.page.mouse.click(box.x, box.y);
  await sleep(300);
  const opened = await h.page.evaluate(() => ({
    drawn: !!document.querySelector("#app img.mdm-image"),
    line: window.__mdm.view.state.doc
      .lineAt(window.__mdm.view.state.selection.main.head)
      .text.slice(0, 13),
  }));
  assert.equal(opened.drawn, false, "the figure stayed drawn with a caret in it");
  assert.equal(opened.line, "![A figure.](", "the caret is not in the source of the figure");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The numbers in the margin ----------

test("the numbers stand in one column beside the text, out of its flow", { skip }, async () => {
  const text = [
    "# A heading",
    "",
    "A line of prose.",
    "",
    "> A quoted line.",
    "",
    "::: {.callout-warning}",
    "Mind the gap.",
    ":::",
    "",
    "$$",
    "a^2 + b^2 = c^2",
    "$$",
    "",
  ].join("\n");
  const h = await open({ text, scores: 0, seed: { settings: { frontMatter: "hidden" } } });
  const seen = await h.page.evaluate(() => {
    // Every number, wherever it rides: the lines, and the cover over the
    // source of the equation, which is drawn instead of it.
    const lines = [...document.querySelectorAll("#app .cm-content [data-mdm-line]")];
    const content = document.querySelector("#app .cm-content").getBoundingClientRect();
    const scroller = document.querySelector("#app .cm-scroller").getBoundingClientRect();
    return {
      content: { left: content.left },
      scroller: { left: scroller.left },
      cover: lines.filter((l) => l.classList.contains("mdm-blockline")).length,
      numbers: lines.map((l) => {
        const before = getComputedStyle(l, "::before");
        // A pseudo-element cannot be measured, so its right edge is computed
        // the way the browser places it: `right: 100%` is the left edge of the
        // padding box, which starts inside whatever border the line draws,
        // less the margin the stylesheet sets. What is pinned is that the
        // edges agree line to line, whatever a line draws to its left.
        const r = l.getBoundingClientRect();
        const border = parseFloat(getComputedStyle(l).borderLeftWidth);
        return {
          n: l.getAttribute("data-mdm-line"),
          cls: l.className,
          content: before.content,
          right: r.left + border - parseFloat(before.marginRight),
          position: before.position,
          events: before.pointerEvents,
          select: before.userSelect,
          // Every number is drawn the same, whatever the line under it is
          // written in: the heading's 600 used to reach the number through
          // the pseudo-element.
          face: [
            before.color,
            before.fontWeight,
            before.fontStyle,
            before.fontSize,
            before.fontFamily,
          ].join(" "),
        };
      }),
      // What four digits would take in the face the numbers are set in, so
      // the room in the margin is measured rather than guessed.
      fourDigits: (() => {
        const before = getComputedStyle(lines[0], "::before");
        const probe = document.createElement("span");
        probe.style.font = before.font;
        probe.style.position = "absolute";
        probe.textContent = "8888";
        document.body.appendChild(probe);
        const w = probe.getBoundingClientRect().width;
        probe.remove();
        return w;
      })(),
    };
  });
  const numbers = seen.numbers;
  assert.equal(seen.cover, 1, "the equation's source is not covered by one number");
  // The number is the line's own, and it carries alt text of nothing so that
  // a screen reader does not read it before every line.
  assert.deepEqual(
    numbers.map((x) => x.content),
    numbers.map((x) => '"' + x.n + '" / ""')
  );
  // One column: the quote and the callout draw a 3px bar of their own inside
  // the box the number is placed against, and their margin gives it back.
  const rights = numbers.map((x) => Math.round(x.right));
  assert.deepEqual(
    rights,
    rights.map(() => rights[0]),
    "the numbers are not in one column: " + JSON.stringify(numbers.map((x) => [x.cls, x.right]))
  );
  // Beside the text and inside the margin the scroller carries, never over
  // the text itself.
  assert.ok(rights[0] < seen.content.left, "a number sits inside the text column");
  assert.ok(
    rights[0] - seen.fourDigits > seen.scroller.left,
    "a four-digit number would fall off the left edge of the pane: " +
      (rights[0] - seen.fourDigits) +
      " against " +
      seen.scroller.left
  );
  // One face for all of them: a title's line is bold, a card's is monospace
  // and smaller, a quote's is paler, and none of that reaches the number.
  assert.deepEqual(
    numbers.map((x) => x.face),
    numbers.map(() => numbers[0].face),
    "the numbers are not all drawn the same: " +
      JSON.stringify(numbers.map((x) => [x.cls, x.face]))
  );
  // Out of the flow and out of the way: nothing about the number can be
  // clicked, selected or measured into a line box.
  for (const x of numbers) {
    assert.equal(x.position, "absolute", "the number of line " + x.n + " is in the flow");
    assert.equal(x.events, "none", "the number of line " + x.n + " takes the pointer");
    assert.equal(x.select, "none", "the number of line " + x.n + " can be selected");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A number stands in the middle of the row it counts. Its box takes the
// line's own line height (`1lh` in style.css), so a heading's number sits
// halfway down the heading's row and a blank line's halfway down its em. It
// used to say `inherit`, which handed down the line's ratio (1.7, 1.3) for
// the number's 11px to multiply, and every number rode at the top of its row.
// What this holds is the number's place in the row, which is the same in both
// faces. The words sit where their face puts them, so how far the digits are
// from the words' baseline is the face's to decide (the comment over the rule
// gives the measurement) and is not held here.
// Read in the pixels, at two to the CSS pixel: the middle of the digits' ink
// against the middle of the line's first row, for prose, a paragraph that
// wraps, three levels of heading, a blank line, a quote, a line of code and
// the cover over a drawn equation.
test("a number stands in the middle of the row it counts, in either face", { skip }, async () => {
  const text = [
    "# A heading",
    "",
    "A line of prose.",
    "",
    "A paragraph long enough to wrap onto a second row, so that its number has a first row to stand in and a second one to keep out of. ".repeat(4).trim(),
    "",
    "## A section",
    "",
    "#### A smaller one",
    "",
    "> A quoted line.",
    "",
    "```",
    "let a = 1",
    "```",
    "",
    "$$",
    "a^2 + b^2 = c^2",
    "$$",
    "",
  ].join("\n");
  for (const face of ["roman", "sans"]) {
    const h = await open({ text, scores: 0, seed: { settings: { frontMatter: "hidden", textFont: face } } });
    await h.page.setViewport({ width: 900, height: 2400, deviceScaleFactor: 2 });
    await h.page.evaluate(async () => {
      await document.fonts.ready;
      const view = window.__mdm.view;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await sleep(400);
    const rows = await h.page.evaluate(() => {
      const content = document.querySelector("#app .cm-content").getBoundingClientRect();
      return [...document.querySelectorAll("#app .cm-content [data-mdm-line]")].map((l) => {
        const r = l.getBoundingClientRect();
        const cs = getComputedStyle(l);
        const top = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
        const lh = parseFloat(cs.lineHeight);
        return {
          n: l.getAttribute("data-mdm-line"),
          cls: l.className,
          top,
          lh,
          box: parseFloat(getComputedStyle(l, "::before").lineHeight),
          // The margin beside the first row and a little over it, which holds
          // the ink of this number and of nothing else: the row above ends
          // with its own number well clear of its bottom edge.
          clip: { x: content.left - 48, y: top - 2, width: 44, height: lh + 4 },
        };
      });
    });
    const kinds = rows.map((r) => r.cls).join(" ");
    for (const k of ["mdm-h1", "mdm-h2", "mdm-h4", "mdm-blank", "mdm-quote", "mdm-code-line", "mdm-blockline"]) {
      assert.ok(kinds.includes(k), `no ${k} to measure (${face})`);
    }
    for (const row of rows) {
      const where = `line ${row.n} (${row.cls}, ${face})`;
      assert.ok(Math.abs(row.box - row.lh) < 0.1, `the number of ${where} is ${row.box}px tall in a row of ${row.lh}`);
      const png = await h.page.screenshot({ clip: row.clip, encoding: "base64" });
      const ink = await h.page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const g = cv.getContext("2d");
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        // The ground is the commonest colour in the box, and ink is whatever
        // stands at least half as far from it as the farthest pixel does.
        const counts = new Map();
        for (let i = 0; i < d.length; i += 4) {
          const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
          counts.set(k, (counts.get(k) || 0) + 1);
        }
        const ground = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const far = (i) =>
          Math.abs(d[i] - (ground >> 16)) +
          Math.abs(d[i + 1] - ((ground >> 8) & 255)) +
          Math.abs(d[i + 2] - (ground & 255));
        let max = 0;
        for (let i = 0; i < d.length; i += 4) max = Math.max(max, far(i));
        if (max < 60) return null;
        let first = -1;
        let last = -1;
        for (let y = 0; y < bmp.height; y++) {
          for (let x = 0; x < bmp.width; x++) {
            if (far((y * bmp.width + x) * 4) >= max / 2) {
              if (first < 0) first = y;
              last = y;
              break;
            }
          }
        }
        return { first, last, height: bmp.height };
      }, png);
      assert.ok(ink, `no number drawn beside ${where}`);
      const scale = ink.height / row.clip.height;
      const middle = row.clip.y + (ink.first + ink.last + 1) / 2 / scale;
      const off = middle - (row.top + row.lh / 2);
      assert.ok(
        Math.abs(off) <= 1.5,
        `the number of ${where} stands ${off.toFixed(2)}px from the middle of its ${row.lh}px row`
      );
    }
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

test("with the header hidden the numbers are the file's lines, not the editor's", { skip }, async () => {
  const disk = ["---", "title: x", "author: y", "---", "", "First body line.", ""].join("\n");
  // Hidden is the default of mdm.frontMatter: the host keeps the header and
  // the blank line under it, so the editor's first line is the file's sixth,
  // and the margin must say six, which is what the text editor beside it says.
  const hidden = await open({ text: disk, withFrontMatter: false, scores: 0 });
  assert.equal(await docText(hidden.page), "First body line.\n");
  assert.deepEqual(
    await hidden.page.evaluate(() =>
      [...document.querySelectorAll("#app .cm-content .cm-line")].map((l) =>
        l.getAttribute("data-mdm-line")
      )
    ),
    ["6", "7"]
  );
  assert.deepEqual(hidden.errors, []);
  await hidden.close();
  // Shown, the editor holds the file and counts from one.
  const shown = await open({ text: disk, withFrontMatter: true, scores: 0 });
  assert.deepEqual(
    await shown.page.evaluate(() =>
      [...document.querySelectorAll("#app .cm-content .cm-line")].map((l) =>
        l.getAttribute("data-mdm-line")
      )
    ),
    ["1", "2", "3", "4", "5", "6", "7"]
  );
  assert.deepEqual(shown.errors, []);
  await shown.close();
});

// One colour for everything that can be pressed. Every glyph of the chrome is
// drawn in --mdm-chrome-ink, at rest and under the pointer alike, so a control
// reads as a control before it is read at all, and what a control is doing is
// said by the ground under it: the light wash under a pointer, the state
// weight under a held toggle. The numbers in the margin are chrome too, but
// they are the part of it nobody presses, so they take an ink of their own
// (--mdm-line-ink) that stands a step behind the glyphs. Neither of the two is
// --mdm-play-accent-ink, which is left to what is held or sounding: the disc,
// the played half of the progress, the caret, the outline rail and the cursor
// that walks a score. What this pins is that no part of the chrome is left in
// ink, that the margin is not drawn in the glyph colour, and that no rule
// paints a glyph a second colour on the way: the vendored abcjs sheet claims
// the player's glyphs (#f4f4f4, #cccccc under the pointer) at a specificity
// the editor's own rules have to outrank, and the two round buttons on a block
// used to carry a pair of hard-coded slate greys, one per side.
async function chromeColours(page) {
  return page.evaluate(() => {
    const root = document.getElementById("app");
    // The custom properties turned into the rgb() computed styles are read in.
    const token = (name) => {
      const probe = document.createElement("span");
      root.appendChild(probe);
      probe.style.color = getComputedStyle(root).getPropertyValue(name);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const fill = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).fill : null;
    };
    const colour = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).color : null;
    };
    const line = document.querySelector("#app .cm-content [data-mdm-line]");
    return {
      chrome: token("--mdm-chrome-ink"),
      margin: token("--mdm-line-ink"),
      accent: token("--mdm-play-accent-ink"),
      ink: getComputedStyle(root).getPropertyValue("--mdm-ink").trim(),
      glyphs: {
        toolbar: colour("#app .mdm-toolbar .mdm-btn"),
        copy: colour("#app .mdm-chrome .mdm-copy"),
        headphones: colour("#app .mdm-chrome .mdm-audio-toggle"),
        play: fill(".mdm-audio .abcjs-midi-start g"),
        hoveredPlay: fill(".mdm-audio .abcjs-midi-start:hover g"),
        repeat: fill(".mdm-audio .abcjs-midi-loop g"),
        close: fill(".mdm-audio .mdm-audio-close g"),
      },
      number: line ? getComputedStyle(line, "::before").color : null,
      // What the two held states are standing on, to tell a ground that
      // changes from a glyph that does not.
      grounds: {
        repeat: getComputedStyle(
          document.querySelector(".mdm-audio .abcjs-midi-loop")
        ).backgroundColor,
        headphones: getComputedStyle(
          document.querySelector("#app .mdm-chrome .mdm-audio-toggle")
        ).backgroundColor,
      },
    };
  });
}

for (const side of ["light", "dark"]) {
  test("every button of the chrome is the chrome ink on the " + side + " side, and the margin its own", { skip }, async () => {
    const h = await open({ seed: { settings: { theme: side } } });
    // A player open, so the transport is there to read, and the pointer on
    // its play button, which is where the vendored sheet would come in.
    await h.page.evaluate(() => {
      document
        .querySelectorAll("#app .mdm-score")[0]
        .querySelector(".mdm-audio-toggle")
        .click();
    });
    await h.page.waitForFunction(
      () => document.querySelector(".mdm-audio .abcjs-inline-audio"),
      { timeout: 20000 }
    );
    const aim = await h.page.evaluate(() => {
      const r = document
        .querySelector(".mdm-audio .abcjs-midi-start")
        .getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    await h.page.mouse.move(aim.x, aim.y);
    await sleep(250);
    const seen = await chromeColours(h.page);
    assert.notEqual(seen.chrome, "", "the chrome ink resolves to nothing");
    for (const [name, colour] of Object.entries(seen.glyphs)) {
      assert.ok(colour, "there is no " + name + " to read");
      assert.equal(
        colour,
        seen.chrome,
        "the " + name + " glyph is not the chrome ink: " + colour
      );
    }
    // The margin stands a step behind the glyphs, in an ink of its own, and
    // neither of the two is the accent that marks what is held or sounding.
    assert.ok(seen.number, "there is no number in the margin to read");
    assert.equal(seen.number, seen.margin, "the number is not the margin ink: " + seen.number);
    assert.notEqual(seen.number, seen.chrome, "the number is drawn in the glyph colour");
    assert.notEqual(seen.chrome, seen.accent, "the glyphs are drawn in the accent itself");
    // The block's headphones are lit while its player is open, and the repeat
    // is not running: two different grounds under two identical glyphs, which
    // is the whole of the rule.
    assert.notEqual(
      seen.grounds.headphones,
      seen.grounds.repeat,
      "the held state is not drawn as a ground at all"
    );
    assert.equal(seen.grounds.repeat, "rgba(0, 0, 0, 0)", "an idle button carries a disc");
    // Repeat turned on: the ground takes the state, the glyph does not move.
    await h.page.evaluate(() =>
      document.querySelector(".mdm-audio .abcjs-midi-loop").click()
    );
    await sleep(250);
    const looping = await chromeColours(h.page);
    assert.notEqual(
      looping.grounds.repeat,
      seen.grounds.repeat,
      "repeat turned on and its ground did not change"
    );
    assert.equal(
      looping.glyphs.repeat,
      seen.glyphs.repeat,
      "the held glyph changed colour: the state is meant to be the ground alone"
    );
    assert.deepEqual(h.errors, []);
    await h.close();
  });
}

// ---------- The words a score carries ----------

// Every piece of text abcjs draws around a staff keeps the size abcjs gives
// it: renderScore (main.js) hands it no `format` block. These words were held
// to a ladder over the prose's x-height for a while instead, and that was
// taken back on 2026-09-10, so what this section pins is that the editor
// draws exactly what abcjs draws when it is left alone, word for word.
//
// The comparison is against abcjs itself, in the same page, rather than
// against a table of sizes: the same tune rendered by the same vendored abcjs
// into a scratch div outside the editor, with the paddings renderScore passes
// and nothing else. A few sizes are asserted by number as well, so that the
// decision reads in the test.
const SCORE_TUNE = [
  "%%stretchlast 1",
  "X:1",
  "T:A tune with every word on it",
  "L:1/4",
  "K:C clef=treble",
  "P:partials",
  'C, C "Am"G "^over"c |',
  "w: one two three four",
].join("\n");

const scoreDoc = (tune) =>
  ["A paragraph of prose, which the words on the staff sit beside.",
   "", "```abc", tune, "```", ""].join("\n");

// Every drawn <text> of the editor's score and of abcjs's own, with the
// attributes that decide how it is drawn; the adjust the page could still
// impose on them; the width of ink the browser actually gives each title; and
// the boxes of the staff and the clef.
const scoreWords = (page, tune) =>
  page.evaluate(async (tune) => {
    await document.fonts.ready;
    const words = (svg) =>
      Array.from(svg.querySelectorAll("text"))
        .filter((t) => t.getAttribute("font-size"))
        .map((t) =>
          [
            (t.getAttribute("class") || "").split(" ")[0],
            t.textContent,
            t.getAttribute("font-size"),
            t.getAttribute("font-family"),
            t.getAttribute("font-weight"),
            t.getAttribute("font-style"),
          ].join(" | ")
        );
    const box = (svg, sel) => {
      const n = svg.querySelector(sel);
      if (!n) return null;
      const b = n.getBBox();
      return [+b.width.toFixed(2), +b.height.toFixed(2)];
    };
    const titleOf = (svg) =>
      Array.from(svg.querySelectorAll(".abcjs-title")).find((e) => e.getAttribute("font-size"));
    const ours = document.querySelector("#app code.language-abc svg");
    const scratch = document.createElement("div");
    scratch.style.cssText = "position:absolute;left:-10000px;top:0";
    document.body.appendChild(scratch);
    window.ABCJS.renderAbc(scratch, tune, {
      add_classes: true,
      paddingtop: 2,
      paddingbottom: 2,
      paddingleft: 0,
      paddingright: 0,
    });
    const stock = scratch.querySelector("svg");
    const out = {
      ours: words(ours),
      stock: words(stock),
      staff: [box(ours, ".abcjs-staff"), box(stock, ".abcjs-staff")],
      clef: [box(ours, ".abcjs-clef"), box(stock, ".abcjs-clef")],
      titleInk: [
        +titleOf(ours).getBoundingClientRect().width.toFixed(1),
        +titleOf(stock).getBoundingClientRect().width.toFixed(1),
      ],
      adjust: getComputedStyle(titleOf(ours)).fontSizeAdjust,
      proseAdjust: getComputedStyle(document.querySelector("#app .cm-content")).fontSizeAdjust,
    };
    scratch.remove();
    return out;
  }, tune);

// The size abcjs wrote on the first drawn word of a role.
const wordSize = (rows, cls) => {
  const row = rows.find((r) => r.startsWith(cls + " |"));
  return row ? row.split(" | ")[2] : null;
};

test("the words on a score keep abcjs's own sizes", { skip }, async () => {
  const h = await open({
    text: scoreDoc(SCORE_TUNE),
    scores: 1,
    seed: { settings: { textFont: "roman" } },
  });
  const w = await scoreWords(h.page, SCORE_TUNE);
  assert.ok(w.ours.length >= 5, "too few words drawn to compare: " + JSON.stringify(w.ours));
  // Word for word what abcjs draws when nobody hands it a format.
  assert.deepEqual(w.ours, w.stock, "the editor's score text is not abcjs's own");
  // abcjs states these in points and draws them at 4/3: a 20 pt title at
  // 27 px, a 15 pt part label at 20, a 13 pt lyric at 17 and in bold, a
  // 12 pt chord and annotation at 16.
  assert.equal(wordSize(w.ours, "abcjs-title"), "27");
  assert.equal(wordSize(w.ours, "abcjs-part"), "20");
  assert.equal(wordSize(w.ours, "abcjs-lyric"), "17");
  assert.equal(wordSize(w.ours, "abcjs-chord"), "16");
  assert.equal(wordSize(w.ours, "abcjs-annotation"), "16");
  // And drawn at those sizes. The roman prose carries font-size-adjust
  // 0.528, and the engraving is taken out of it (style.css): the attributes
  // above would otherwise draw Times a seventh larger than abcjs does.
  assert.equal(w.proseAdjust, "0.528", "the prose is not adjusted, so this proves nothing");
  assert.equal(w.adjust, "none", "the score's words inherit the prose's adjust");
  // Within a pixel, which is what sub-pixel placement leaves between the
  // editor's centred score and the scratch one (310.8 against 310.9 measured).
  // An inherited adjust would add a seventh, about 46 px on this title.
  assert.ok(
    Math.abs(w.titleInk[0] - w.titleInk[1]) <= 1,
    "the title is drawn " + w.titleInk[0] + " px wide where abcjs draws it " + w.titleInk[1]
  );
  // The engraving is abcjs's as well.
  assert.deepEqual(w.staff[0], w.staff[1], "the staff is not abcjs's");
  assert.deepEqual(w.clef[0], w.clef[1], "the clef is not abcjs's");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// A document that sets a size of its own gets it: abcjs applies the tune's
// own directives, and the editor hands it nothing to override them with. What
// the document does not name keeps abcjs's own size.
test("a score that names a font size of its own keeps it", { skip }, async () => {
  const tune = SCORE_TUNE.replace("X:1", "X:1\n%%titlefont Times-Roman 30");
  const h = await open({ text: scoreDoc(tune), scores: 1 });
  const w = await scoreWords(h.page, tune);
  // 30 points as abcjs draws them, which is 4/3 of that in pixels.
  assert.equal(wordSize(w.ours, "abcjs-title"), "40", "the document's own title size was overridden");
  assert.equal(wordSize(w.ours, "abcjs-part"), "20", "a size the document did not name moved");
  assert.deepEqual(h.errors, []);
  await h.close();
});

// ---------- The ladder of headings ----------

const HEADINGS_DOC = [1, 2, 3, 4, 5, 6]
  .map((n) => "#".repeat(n) + " Level " + n + "\n\nA line of prose under it.\n")
  .join("\n");

const headingSizes = (page) =>
  page.evaluate(() => {
    const out = {
      body: parseFloat(getComputedStyle(document.querySelector("#app .cm-content")).fontSize),
    };
    [1, 2, 3, 4, 5, 6].forEach((n) => {
      const el = document.querySelector("#app .cm-line.mdm-h" + n);
      out["h" + n] = el ? +parseFloat(getComputedStyle(el).fontSize).toFixed(3) : null;
    });
    return out;
  });

// One ladder for both faces: Markdown's own sizes at the top, where a
// document written in Markdown is headed (a title in `#`, its sections in
// `##`), and from there each level halving what the one above stands over the
// body, down to h6 at the body itself. Each face had one of its own at first:
// the sans stopped at the body a level early (1.1, then 1 and 1), and the
// roman took article.cls's sizes, which drew a `##` section at \LARGE, 1.728
// of the body.
for (const face of ["roman", "sans"]) {
  test("the " + face + " heads a document the way Markdown does, down to the body", { skip }, async () => {
    const h = await open({
      text: HEADINGS_DOC,
      scores: 0,
      seed: { settings: { textFont: face } },
    });
    const s = await headingSizes(h.page);
    assert.equal(s.body, 16);
    // Markdown's own three: the title, a section, a subsection.
    assert.deepEqual([s.h1, s.h2, s.h3], [32, 24, 20], "the " + face + " left Markdown's top three");
    // An eighth of the body over it, then a sixteenth.
    assert.deepEqual([s.h4, s.h5], [18, 17], "the " + face + " left the halving under them");
    // The anchor: `###### x` and `**x**` draw the same.
    assert.equal(s.h6, s.body, "the " + face + "'s sixth level left the size of the prose");
    assert.deepEqual(h.errors, []);
    await h.close();
  });
}

// A heading's line keeps the height its line-height gives it, with the caret
// away and in it. CodeMirror sets two buffers around the hidden `## ` of a
// heading (img.cm-widgetBuffer, 1em tall, text-top in its base theme), and in
// the roman they stood over the line: Latin Modern's content area at the
// adjusted size is taller than a heading's 1.3 line, so the line grew, 7px at
// h1, 5 at h2 and 4 at the rest, and the heading jumped when a caret came in
// and the buffers went (55.17 to 50.17px for an h2, measured). The exported
// page draws no buffer, so the two disagreed about where every heading sits.
const headingLines = (page) =>
  page.evaluate(() =>
    [1, 2, 3, 4, 5, 6].map((n) => {
      const el = document.querySelector("#app .cm-line.mdm-h" + n);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const inner =
        r.height -
        parseFloat(cs.paddingTop) -
        parseFloat(cs.paddingBottom) -
        parseFloat(cs.borderTopWidth) -
        parseFloat(cs.borderBottomWidth);
      return { size: parseFloat(cs.fontSize), inner: +inner.toFixed(2) };
    })
  );

test("a heading's line keeps its height, with the caret away and in it", { skip }, async () => {
  for (const face of ["roman", "sans"]) {
    const h = await open({ text: HEADINGS_DOC, scores: 0, seed: { settings: { textFont: face } } });
    const away = await headingLines(h.page);
    away.forEach((b, i) => {
      assert.ok(
        Math.abs(b.inner - 1.3 * b.size) < 0.5,
        face + ": h" + (i + 1) + "'s line is " + b.inner + "px where 1.3 of its size is " +
          (1.3 * b.size).toFixed(2)
      );
    });
    for (let n = 1; n <= 6; n++) {
      await h.page.evaluate((level) => {
        const { view } = window.__mdm;
        const at = view.state.doc.toString().indexOf("Level " + level);
        view.dispatch({ selection: { anchor: at } });
      }, n);
      await h.page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      );
      const inside = await headingLines(h.page);
      assert.ok(
        Math.abs(inside[n - 1].inner - away[n - 1].inner) < 0.5,
        face + ": h" + n + "'s line went from " + away[n - 1].inner + "px to " +
          inside[n - 1].inner + " with the caret in it"
      );
    }
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

// ---------- What a lit button means ----------

// One rule for the whole bar: a lamp marks the setting that was asked for, and
// stays dark on the one the editor does before anybody asks for anything. Two
// buttons used to light on their own default, which said nothing at all, and
// this is what keeps the next one from doing the same.
const TOGGLES = [
  { name: "mdm-staff-lines", key: "staffLines", asked: "ink" },
  { name: "mdm-match-substring", key: "multicursorMatch", asked: "substring" },
  { name: "mdm-text-font", key: "textFont", asked: "sans" },
  { name: "mdm-follow", key: "followPlayhead", asked: "still" },
  { name: "mdm-front-matter", key: "frontMatter", asked: "shown" },
];

const lampOf = (page, name) =>
  page.evaluate(
    (n) =>
      document
        .querySelector('#app button[data-type="' + n + '"]')
        .classList.contains("mdm-btn--on"),
    name
  );

test("no toggle is lit until it is asked for", { skip }, async () => {
  // Every setting at the value the extension ships, front matter included:
  // the helper seeds that one shown, and the default is hidden.
  const h = await open({ seed: { settings: { frontMatter: "hidden" } } });
  for (const t of TOGGLES) {
    assert.equal(await lampOf(h.page, t.name), false, t.name + " is lit on its own default");
  }
  assert.deepEqual(h.errors, []);
  await h.close();
});

test("every toggle lights on the setting that was asked for", { skip }, async () => {
  for (const t of TOGGLES) {
    const seed = { frontMatter: "hidden" };
    seed[t.key] = t.asked;
    const h = await open({ seed: { settings: seed } });
    assert.equal(
      await lampOf(h.page, t.name),
      true,
      t.name + " stayed dark on " + t.key + ": " + t.asked
    );
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});
