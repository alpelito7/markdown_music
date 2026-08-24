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
} = require("./webview/helpers.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The settings message the host sends back after a button press: every key,
// with the defaults of the harness unless overridden.
function settingsMessage(overrides) {
  return {
    type: "settings",
    settings: Object.assign(
      {
        theme: "light",
        scoreFill: "none",
        staffLines: "gray",
        scoreAlign: "center",
        frontMatter: "shown",
      },
      overrides || {}
    ),
  };
}

function postSettings(page, overrides) {
  return page.evaluate((msg) => window.postMessage(msg, "*"), settingsMessage(overrides));
}

function setSettingPosts(page) {
  return page.evaluate(() => window.__posts.filter((m) => m.type === "setSetting"));
}

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
    ["Follow VS Code", "Light", "Dark", "White", "Monokai", "Solarized Light"]
  );
  assert.deepEqual(menu.entries.filter((e) => e.includes("✓")), ["Light✓"]);
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
      header: bg(document.querySelector("#app .cm-line.mdm-fm-line")),
      score: bg(document.querySelector("#app code.language-abc")),
    };
  });
}

test("the code sits on a darker ground than the page, on either side", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const h = await open({ seed: { settings: { theme: theme, scoreFill: "none" } } });
    const g = await grounds(h.page);
    assert.ok(g.code, theme + ": no code line to measure");
    // Both greys are mixes of the theme's own colours, and whichever side is in
    // force the code is the darker of the two, the way a notebook draws its
    // cells: in light the code keeps its slate and the page is a shade off
    // white, in dark the code drops to editor.background and the page rises.
    assert.ok(
      luminance(g.code) < luminance(g.page),
      theme + ": code " + g.code + " against page " + g.page
    );
    assert.ok(
      Math.abs(luminance(g.code) - luminance(g.page)) > 4,
      theme + ": the two grounds are the same grey"
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
  const h = await open({
    seed: { settings: { theme: "light" }, palette: palette("light") },
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

test("a palette from the other side is dropped, fallbacks stay", { skip }, async () => {
  // mdm.theme can hold this editor to light while VS Code is on a dark theme,
  // and dark syntax colours on a light ground are unreadable.
  const h = await open({
    seed: { settings: { theme: "light" }, palette: palette("dark") },
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
  const h = await open({ seed: { settings: { theme: "light" } } });
  // Nothing seeded: the editor opens on the fallbacks.
  assert.equal((await synVars(h.page)).string, "");
  await h.page.evaluate((p) => {
    window.postMessage({ type: "palette", palette: p, side: null }, "*");
  }, palette("light"));
  await sleep(300);
  assert.deepEqual(await synVars(h.page), palette("light").colors);
  assert.equal((await paintedCode(h.page)).keyword, "rgb(10, 11, 12)");
  // And a palette that no longer matches the side is taken back off.
  await h.page.evaluate((p) => {
    window.postMessage({ type: "palette", palette: p, side: null }, "*");
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
    const staff = svg.querySelector(".abcjs-staff");
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
      // The pulse a copy plays on this card: the two are different animations,
      // since a cleared card has no colour of its own to flash.
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
  // A card with a colour of its own pulses that colour, not the accent tint.
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
