// main.js: webview for the MDM editor. Mounts Vditor in IR mode (instant
// rendering, Typora style) and keeps it in sync both ways with the VS Code
// TextDocument. On top of Vditor it adds: a comfortable way out of code blocks
// (Ctrl+Enter, and Enter on a trailing empty line), click on a score to edit
// its source, click below the last block to keep writing, and a light/dark
// theme synced with VS Code.
(function () {
  const vscode = acquireVsCodeApi();
  const CDN = window.MDM_VDITOR_CDN;
  const CONTENT_THEME_PATH = CDN + "/dist/css/content-theme";

  let vditor = null;
  let applying = false; // applying an incoming update; do not send it back as an edit
  let pending = null; // debounce for outgoing edits
  let scrollToTop = false; // the next update goes to the top of the document
  const SETTINGS = window.MDM_SETTINGS || {};
  let themeSetting = SETTINGS.theme || "auto";
  let scoreFill = SETTINGS.scoreFill || "none";
  let staffLines = SETTINGS.staffLines || "gray";
  let scoreAlign = SETTINGS.scoreAlign || "center";
  let frontMatter = SETTINGS.frontMatter || "hidden";

  // The webview never writes a setting itself: it asks the host, which stores
  // it and echoes the stored value back as a "settings" message. That keeps
  // every open .mdm editor in step and makes a choice survive a reload.
  function askSetting(key, value) {
    vscode.postMessage({ type: "setSetting", key: key, value: value });
  }

  // ---------- Theme ----------

  function isDark() {
    if (themeSetting === "dark") return true;
    if (themeSetting === "light" || themeSetting === "white") return false;
    // A named colour theme brings its own side, which the host reads from the
    // extension that contributes it.
    if (themeSetting !== "auto" && themeSide) return themeSide === "dark";
    const kind = document.body.getAttribute("data-vscode-theme-kind") || "";
    if (kind) return kind === "vscode-dark" || kind === "vscode-high-contrast";
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  // The side the editor was last painted for, so that setTheme is called only
  // when it has something to change. It swaps the content stylesheet, and it
  // used to run on every message that touched a setting: pressing the YAML
  // button, which changes no colour at all, went through it too.
  let appliedSide = null;

  function applyTheme() {
    if (!vditor) return;
    const dark = isDark();
    if (appliedSide !== dark) {
      appliedSide = dark;
      vditor.setTheme(
        dark ? "dark" : "classic",
        dark ? "dark" : "light",
        dark ? "github-dark" : "github",
        CONTENT_THEME_PATH
      );
    }
    // The toolbar renders in terms of the effective theme, so it follows every
    // path that can change it: the mdm.theme setting, the VS Code theme while
    // on "auto", and the OS preference.
    updateThemeMenu();
    applyScoreFill();
    applyPage();
    // The palette is only usable while the editor is on the same side, light
    // or dark, as the VS Code theme it came from.
    applyPalette();
  }

  // Whether the page is the sheet of paper of the white look or the ground the
  // theme gives it. The colours themselves live in style.css; this only says
  // which of the arrangements is in force.
  function applyPage() {
    const root = document.getElementById("app");
    if (!root) return;
    root.classList.toggle("mdm-page--white", themeSetting === "white");
  }

  function watchTheme() {
    new MutationObserver(applyTheme).observe(document.body, {
      attributes: true,
      attributeFilter: ["data-vscode-theme-kind", "class"],
    });
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", applyTheme);
    }
  }

  // ---------- Syntax colours ----------

  // Code in this editor is painted with the colours of the VS Code theme in
  // use, read from the theme file on the host side (theme.js) and handed over
  // as a handful of colours. They are set as CSS custom properties on #app, so
  // the rules in style.css that spend them need to know nothing about where
  // they came from; with no palette to set, the fallbacks in that sheet take
  // over (Monokai for dark, stackoverflow-light for light).
  //
  // A palette is used only while the editor is on the same side as the theme
  // it was read from: mdm.theme can hold this editor to light with VS Code on
  // a dark theme, and dark syntax colours on a light ground are unreadable.
  const SYNTAX_SLOTS = [
    "base",
    "bg",
    "comment",
    "string",
    "number",
    "keyword",
    "attr",
    "name",
    "type",
    "variable",
  ];

  // Both come from the host in one message: the colours themselves, and the
  // side of a theme named in mdm.theme (null while the setting is one of the
  // three plain values, which say all there is to say about the side).
  let palette = (window.MDM_PALETTE || {}).palette || null;
  let themeSide = (window.MDM_PALETTE || {}).side || null;

  function applyPalette() {
    const root = document.getElementById("app");
    if (!root) return;
    const usable =
      palette && palette.colors && palette.kind === (isDark() ? "dark" : "light");
    SYNTAX_SLOTS.forEach(function (slot) {
      const value = usable ? palette.colors[slot] : null;
      if (value) root.style.setProperty("--mdm-syn-" + slot, value);
      else root.style.removeProperty("--mdm-syn-" + slot);
    });
  }

  // ---------- YAML header highlighting ----------

  // lute gives the header a block of its own, with the YAML in an editable
  // <code> inside a pre.vditor-ir__marker--pre, and Vditor's own highlighter
  // skips exactly those (it paints the read-only previews and leaves editable
  // sources alone), so the header showed as one flat run of monospace. It is
  // painted here with the same highlight.js Vditor loads for the previews, so
  // both go through one palette.
  //
  // The colours CANNOT go into that editable <code>: lute reads the block's
  // content from the first child of the code element, so a text node broken
  // into highlight.js spans serializes as the first span alone. Measured: the
  // whole header collapsed to `title:` on the next keystroke ANYWHERE in the
  // document, since every edit serializes the whole DOM. What the block gets
  // instead is the second half of the shape Vditor gives a code block: the
  // source pre marked as a marker, so it is zero-sized while the caret is
  // elsewhere, and a read-only .vditor-ir__preview beside it carrying the
  // painted copy. Extra elements in the block are ignored by lute (checked),
  // and the source keeps the single text node it needs to serialize.
  let hljsLoaded = false;
  function ensureHljs() {
    if (window.hljs) return true;
    // Vditor loads highlight.js under this id for the code previews; whichever
    // of the two gets there first, the file is fetched once.
    let script = document.getElementById("vditorHljsScript");
    if (!script) {
      script = document.createElement("script");
      script.id = "vditorHljsScript";
      script.src = CDN + "/dist/js/highlight.js/highlight.min.js";
      document.head.appendChild(script);
    }
    if (!hljsLoaded) {
      hljsLoaded = true;
      script.addEventListener("load", function () {
        highlightFrontMatter();
      });
    }
    return false;
  }

  // The header as one block of text, `---` fences and all, at the very start
  // of the document.
  const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

  // The block lute writes for a header, built here so that showing or hiding
  // the header costs one node instead of a whole re-render. The shape is the
  // one lute produces (checked against its own output); the YAML goes in as
  // text, so nothing in it can be read as markup.
  function frontMatterBlock(header) {
    const yaml = header.replace(FRONT_MATTER, function (whole) {
      return whole.replace(/^---\r?\n/, "").replace(/\r?\n---\r?\n$/, "");
    });
    const block = document.createElement("div");
    block.setAttribute("data-block", "0");
    block.setAttribute("data-type", "yaml-front-matter");
    block.className = "vditor-ir__node";
    const open = document.createElement("span");
    open.setAttribute("data-type", "yaml-front-matter-open-marker");
    open.textContent = "---";
    const pre = document.createElement("pre");
    pre.className = "vditor-ir__marker--pre";
    const code = document.createElement("code");
    code.setAttribute("data-type", "yaml-front-matter");
    code.className = "language-yaml";
    code.textContent = yaml;
    pre.appendChild(code);
    const close = document.createElement("span");
    close.setAttribute("data-type", "yaml-front-matter-close-marker");
    close.textContent = "---";
    block.appendChild(open);
    block.appendChild(pre);
    block.appendChild(close);
    return block;
  }

  // True when the incoming text is the one in the editor with the header put
  // on or taken off, and the DOM has been patched to match. Anything else is
  // left to the caller.
  function patchFrontMatter(current, next) {
    const root = contentRoot();
    if (!root) return false;
    const added = FRONT_MATTER.exec(next);
    if (added && next.slice(added[0].length) === current) {
      root.insertBefore(frontMatterBlock(added[0]), root.firstChild);
      return true;
    }
    const removed = FRONT_MATTER.exec(current);
    if (removed && current.slice(removed[0].length) === next) {
      const first = root.firstElementChild;
      if (!first || first.getAttribute("data-type") !== "yaml-front-matter") {
        return false;
      }
      root.removeChild(first);
      return true;
    }
    return false;
  }

  function highlightFrontMatter() {
    try {
      const block = document.querySelector(
        '#app div[data-type="yaml-front-matter"]'
      );
      if (!block) return;
      const pre = block.querySelector("pre.vditor-ir__marker--pre");
      const code = pre && pre.querySelector("code");
      if (!code) return;
      const source = code.textContent;
      let preview = block.querySelector("pre.mdm-fm-preview");
      // Already painted for this text: leave it alone, or the pass that this
      // very rewrite triggers in the observer would loop.
      if (preview && preview.getAttribute("data-mdm-hl") === source) return;
      if (!ensureHljs()) return;
      if (!preview) {
        preview = document.createElement("pre");
        preview.className = "vditor-ir__preview mdm-fm-preview";
        preview.setAttribute("data-render", "1");
        // language-yaml and not a name of our own: Vditor's highlighter walks
        // every pre > code outside the editable sources, and under an unknown
        // language it would repaint this one as plain text. Under this one it
        // reaches the very markup written here.
        preview.appendChild(document.createElement("code"));
        preview.firstChild.className = "language-yaml";
      }
      preview.firstChild.innerHTML = window.hljs.highlight(source, {
        language: "yaml",
        ignoreIllegals: true,
      }).value;
      preview.setAttribute("data-mdm-hl", source);
      // Marked like the source of a code block: Vditor's own rules then shrink
      // it to nothing while the caret is elsewhere and give it back its size
      // the moment the block opens for editing.
      pre.classList.add("vditor-ir__marker");
      if (preview.parentElement !== block) {
        block.insertBefore(preview, pre.nextSibling);
      }
    } catch (e) {
      // Highlighting must never break editing.
    }
  }

  // ---------- Theme menu ----------

  // One menu for the whole look of the editor. The first three entries are
  // the sides on their own (VS Code's, light, dark), and under them come the
  // colour themes installed in VS Code, each painting the code with its own
  // colours and bringing its own side: picking Monokai turns the editor dark,
  // picking Solarized Light turns it light. It replaced a plain light/dark
  // toggle, which meant one setting, mdm.theme, gains theme names alongside
  // its three old values; those still mean what they meant.
  //
  // The list is read once, when the webview opens: a theme installed while it
  // is open shows up after a reload.
  //
  // Icon drawn to fill with currentColor: the toolbar stylesheet sets
  // stroke-width 0, so stroked shapes would come out invisible. A disc half
  // in ink and half in outline, the usual glyph for a theme.
  const THEME_ICON =
    '<svg viewBox="0 0 16 16"><path d="M8 .8A7.2 7.2 0 1 0 8 15.2 7.2 7.2 0 1 0 8 .8zm0 1.5v11.4a5.7 5.7 0 0 1 0-11.4z"/></svg>';

  // White is the light look on a sheet of paper: the page goes to white
  // instead of the wash the theme gives it, and the code keeps its slate (see
  // --mdm-syn-page in style.css). It sits with the sides rather than in a
  // switch of its own: what it changes is how the editor looks, which is what
  // this menu is for, and every other entry rules it out anyway, since a sheet
  // of paper under a dark theme would leave dark syntax colours on white.
  const THEME_SIDES = [
    { value: "auto", label: "Follow VS Code" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "white", label: "White" },
  ];

  const THEMES = (window.MDM_THEMES || []).filter(function (theme) {
    return theme && typeof theme.name === "string";
  });

  function themeEntries() {
    return THEME_SIDES.concat(
      THEMES.map(function (theme) {
        return { value: theme.name, label: theme.name, kind: theme.kind };
      })
    );
  }

  // The menu entry: the name, and a tick on the one in use. The names come
  // from the manifests of installed extensions, so they go in as text.
  function themeMenuLabel(entry) {
    const label = document.createElement("span");
    label.textContent = entry.label;
    if (entry.value === themeSetting) {
      const tick = document.createElement("span");
      tick.className = "mdm-swatch__tick";
      tick.textContent = "✓";
      label.appendChild(tick);
    }
    return label.innerHTML;
  }

  function updateThemeMenu() {
    themeEntries().forEach(function (entry, i) {
      const btn = document.querySelector(
        '#app button[data-type="mdm-theme-' + i + '"]'
      );
      if (btn) btn.innerHTML = themeMenuLabel(entry);
    });
  }

  // The entries are numbered rather than named after the theme: the name goes
  // into a data-type attribute and then into a selector, and theme names carry
  // spaces and punctuation.
  function themeMenuItems() {
    return themeEntries().map(function (entry, i) {
      return {
        name: "mdm-theme-" + i,
        tip: entry.label,
        icon: themeMenuLabel(entry),
        click: function () {
          askSetting("theme", entry.value);
        },
      };
    });
  }

  // ---------- Score fill ----------

  // A score renders as an SVG inside a <code>, so the content theme washes it
  // with the code background (a blue box in dark) and frames it like a card.
  // By default nothing is drawn and the score sits in the text the way an
  // equation does; these are the backgrounds available if one is wanted. Every
  // option carries both themes, so the choice survives a theme switch.
  const SCORE_FILL = {
    none: null,
    paper: { light: "#f4efe2", dark: "#2a2723" },
    slate: { light: "#eceef1", dark: "#2c3138" },
    brass: { light: "#f7edd8", dark: "#332c1c" },
  };

  const FILL_LABEL = {
    none: "None",
    paper: "Paper",
    slate: "Slate",
    brass: "Brass",
  };

  // The graphics-editor fill tool: a tilted paint bucket pouring a drop,
  // redrawn from Material Symbols' format_color_fill (Apache 2.0) onto the
  // same 16-unit grid as the other icons, with the handle tip and the corners
  // of the opening rounded off (every Q takes the sharp corner as its control
  // point). Fitting it to the grid is what makes it read larger than the
  // original, which left a quarter of its box empty under the bucket.
  const SCORE_ICON =
    '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M11.566 8.1 5.005 1.544Q4.651 1.19 4.297 1.544L3.914 1.927Q3.56 2.281 3.914 2.635L4.906 3.627Q5.401 4.122 4.906 4.617L1.418 8.1Q.598 8.92 1.418 9.74L5.672 14Q6.492 14.82 7.312 14L11.566 9.74Q12.386 8.92 11.566 8.1ZM3.211 8.496 6.103 5.609Q6.492 5.22 6.881 5.609L9.773 8.496Q10.197 8.92 9.597 8.92L3.387 8.92Q2.787 8.92 3.211 8.496ZM13.454 10.085s-1.547 1.678-1.547 2.707c0 .851.696 1.547 1.547 1.547s1.547-.696 1.547-1.547c0-1.029-1.547-2.707-1.547-2.707z"/></svg>';

  function fillColor(key) {
    const option = SCORE_FILL[key];
    return option ? option[isDark() ? "dark" : "light"] : "";
  }

  // Menu entry: a swatch of the colour as it looks under the current theme,
  // the name, and a tick on the one in use. "none" gets the struck-through
  // swatch that colour pickers use for no fill.
  function fillMenuLabel(key) {
    const color = fillColor(key);
    const swatch = color
      ? "background:" + color
      : "background:linear-gradient(to top right,transparent 44%,currentColor 44%,currentColor 56%,transparent 56%)";
    return (
      '<span class="mdm-swatch" style="' +
      swatch +
      '"></span>' +
      FILL_LABEL[key] +
      (key === scoreFill ? '<span class="mdm-swatch__tick">✓</span>' : "")
    );
  }

  // ---------- Staff lines button ----------

  // Top-level toolbar toggle for the Guitar-Pro-style gray staff lines scores
  // are drawn with by default. Following the theme button convention, the
  // tooltip names what the click switches to, not the state in use. Vditor's
  // active-button class marks ink, not gray: the button stays quiet for as
  // long as the default holds, and lights up only once the lines have been
  // put back in ink.
  //
  // Staff lines closed off by a barline at each end. Rects rather than
  // strokes, since the toolbar stylesheet sets stroke-width 0 and a stroked
  // path would come out invisible. Four lines instead of the five of a real
  // staff: at the 15px the toolbar draws icons at, five lines leave gaps of
  // about 1.3px and the icon silts up into a striped block.
  const STAFF_ICON =
    '<svg viewBox="0 0 16 16"><rect x="1" y="2.4" width="14" height="1" rx=".5"/><rect x="1" y="5.8" width="14" height="1" rx=".5"/><rect x="1" y="9.2" width="14" height="1" rx=".5"/><rect x="1" y="12.6" width="14" height="1" rx=".5"/><rect x="1" y="2.4" width="1" height="11.2" rx=".5"/><rect x="14" y="2.4" width="1" height="11.2" rx=".5"/></svg>';

  function staffTip() {
    return staffLines === "gray" ? "Ink staff lines" : "Gray staff lines";
  }

  function updateStaffButton() {
    const btn = document.querySelector(
      '#app button[data-type="mdm-staff-lines"]'
    );
    if (!btn) return;
    btn.setAttribute("aria-label", staffTip());
    btn.classList.toggle("vditor-menu--current", staffLines === "ink");
  }

  // ---------- Score alignment button ----------

  // Where a score sits across the page. Centred by default, like display maths;
  // left aligns it with the text, which is what a run of narrow scores wants so
  // they do not wander from block to block. Only scores narrower than the pane
  // move: a full-width one fills the line either way.
  //
  // Same convention as the theme button: the icon and the tooltip name what the
  // click does, not the state in use, so the centred glyph shows while the
  // scores are left-aligned. Text-alignment glyphs, four bars of two lengths,
  // drawn as rects because the toolbar stylesheet sets stroke-width 0.
  const ALIGN_ICON = {
    center:
      '<svg viewBox="0 0 16 16"><rect x="1" y="2.4" width="14" height="1.2" rx=".6"/><rect x="4" y="5.8" width="8" height="1.2" rx=".6"/><rect x="1" y="9.2" width="14" height="1.2" rx=".6"/><rect x="4" y="12.6" width="8" height="1.2" rx=".6"/></svg>',
    left:
      '<svg viewBox="0 0 16 16"><rect x="1" y="2.4" width="14" height="1.2" rx=".6"/><rect x="1" y="5.8" width="8" height="1.2" rx=".6"/><rect x="1" y="9.2" width="14" height="1.2" rx=".6"/><rect x="1" y="12.6" width="8" height="1.2" rx=".6"/></svg>',
  };

  // The other side of the toggle: what the click leads to.
  function alignTarget() {
    return scoreAlign === "center" ? "left" : "center";
  }

  function alignTip() {
    return alignTarget() === "left" ? "Align scores left" : "Centre scores";
  }

  function applyScoreAlign() {
    const root = document.getElementById("app");
    if (!root) return;
    root.classList.toggle("mdm-score--left", scoreAlign === "left");
    const btn = document.querySelector(
      '#app button[data-type="mdm-score-align"]'
    );
    if (!btn) return;
    btn.setAttribute("aria-label", alignTip());
    btn.innerHTML = ALIGN_ICON[alignTarget()];
  }

  // ---------- Front matter button ----------

  // Whether the YAML header is part of the document in the editor. lute parses
  // it into a block of its own (data-type="yaml-front-matter", the YAML in an
  // editable <code> between two --- markers), so shown it is one more block to
  // write in. What the host has to undo on the way to disk is the blank line
  // after the closing ---, which lute drops and Pandoc wants (transforms.js).
  //
  // The glyph is the header as typed: a --- fence, a line of YAML, and the
  // closing --- fence.
  const FM_ICON =
    '<svg viewBox="0 0 16 16"><rect x="1" y="2.8" width="3.6" height="1.4" rx=".7"/><rect x="6.2" y="2.8" width="3.6" height="1.4" rx=".7"/><rect x="11.4" y="2.8" width="3.6" height="1.4" rx=".7"/><rect x="1" y="7.3" width="14" height="1.4" rx=".7"/><rect x="1" y="11.8" width="3.6" height="1.4" rx=".7"/><rect x="6.2" y="11.8" width="3.6" height="1.4" rx=".7"/><rect x="11.4" y="11.8" width="3.6" height="1.4" rx=".7"/></svg>';

  let headerText = "";

  function fmTip() {
    if (headerText === "") return "No YAML header in this file";
    return frontMatter === "shown" ? "Hide YAML header" : "Show YAML header";
  }

  function updateFrontMatter() {
    const btn = document.querySelector(
      '#app button[data-type="mdm-front-matter"]'
    );
    if (!btn) return;
    btn.setAttribute("aria-label", fmTip());
    btn.classList.toggle(
      "vditor-menu--current",
      frontMatter === "shown" && headerText !== ""
    );
    // Nothing to show for a file without a header, so the button greys out.
    btn.classList.toggle("vditor-menu--disabled", headerText === "");
  }

  function updateFillMenu() {
    Object.keys(SCORE_FILL).forEach(function (key) {
      const btn = document.querySelector(
        '#app button[data-type="mdm-score-' + key + '"]'
      );
      if (btn) btn.innerHTML = fillMenuLabel(key);
    });
    updateStaffButton();
  }

  function applyScoreFill() {
    const root = document.getElementById("app");
    if (!root) return;
    const color = fillColor(scoreFill);
    root.classList.toggle("mdm-score--filled", !!color);
    root.classList.toggle("mdm-staff--gray", staffLines === "gray");
    root.style.setProperty("--mdm-score-fill", color || "transparent");
    updateFillMenu();
  }

  // A clicked toolbar button keeps the DOM focus, and Vditor styles :focus the
  // same as :hover: the tooltip stays up and the icon stays in the hover
  // colour (blue under the light theme). Both outlived the click, so a button
  // read as pressed long after it had been let go, and the tooltip covered the
  // panel the click had just opened. Dropping the focus settles both. Only
  // for pointer clicks: a click from the keyboard reports detail 0, and taking
  // the focus away from someone tabbing through the toolbar would send them
  // back to the top of the document.
  //
  // The class is the other half: with the pointer still resting on the button,
  // :hover alone would raise the tooltip over the panel again. It holds until
  // the pointer leaves.
  function dismissTooltipOnClick() {
    const bar = document.querySelector("#app .vditor-toolbar");
    if (!bar) return;
    // Capture phase on purpose: the handler that opens a drop-down panel calls
    // stopPropagation, so a bubbling listener would never see those clicks,
    // which are exactly the ones that need the tooltip out of the way.
    bar.addEventListener(
      "click",
      function (e) {
        const btn = e.target.closest && e.target.closest(".vditor-tooltipped");
        if (!btn) return;
        btn.classList.add("mdm-tip--off");
        const restore = function () {
          btn.classList.remove("mdm-tip--off");
          btn.removeEventListener("mouseleave", restore);
        };
        btn.addEventListener("mouseleave", restore);
        // After the button's own handler, which may well put the focus back in
        // the editor itself; by then this is a no-op.
        if (e.detail > 0)
          setTimeout(function () {
            btn.blur();
          }, 0);
      },
      true
    );
  }

  function fillMenuItems() {
    const items = Object.keys(SCORE_FILL).map(function (key) {
      return {
        name: "mdm-score-" + key,
        tip: FILL_LABEL[key],
        icon: fillMenuLabel(key),
        click: function () {
          askSetting("scoreFill", key);
        },
      };
    });
    return items;
  }

  // ---------- Synchronization ----------

  // Whether the text in the editor carries the YAML header. It is read from
  // the update that brought that text in and travels back with every edit, so
  // the host reads an edit in the mode it was written in even if the setting
  // changed in between (see transforms.js).
  let editorFrontMatter = false;

  function sendEdit(value) {
    vscode.postMessage({
      type: "edit",
      text: value,
      withFrontMatter: editorFrontMatter,
    });
  }

  function queueEdit(value) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      pending = null;
      sendEdit(value);
    }, 300);
  }

  // On blur, or when the webview is hidden, the pending debounce is sent right
  // away: otherwise closing the tab just after typing would lose the last
  // ~300 ms of writing.
  function flushEdit() {
    if (!pending || !vditor) return;
    clearTimeout(pending);
    pending = null;
    sendEdit(vditor.getValue());
  }
  window.addEventListener("blur", flushEdit);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushEdit();
  });

  // ---------- Scores ----------

  // The ```abc blocks of an .mdm file reach the editor under the internal
  // tokens mdm-abc and mdm-abc-play (see transforms.js). Here they are
  // relabelled to .language-abc and engraved with the abcjs that ships inside
  // Vditor, but through our own renderAbc call instead of Vditor's abcRender
  // wrapper. Owning the call buys: trimmed paddings (the defaults padded every
  // score with a gap far wider than a paragraph break), add_classes (semantic
  // classes like .abcjs-staff, which the gray staff lines option colours), and
  // the same lazy loading of the abcjs script that Vditor would do.
  // data-processed, written the moment the node is relabelled, is what keeps
  // Vditor's own abcRender off it in the window before abcjs has loaded.
  let abcjsLoading = false;
  function ensureAbcjs() {
    if (window.ABCJS) return true;
    if (!abcjsLoading) {
      abcjsLoading = true;
      const s = document.createElement("script");
      s.src = CDN + "/dist/js/abcjs/abcjs_basic.min.js";
      s.onload = function () {
        renderScores();
      };
      document.head.appendChild(s);
    }
    return false;
  }

  function renderScores() {
    try {
      document
        .querySelectorAll(
          ".vditor-ir__preview code.language-mdm-abc, .vditor-ir__preview code.language-mdm-abc-play, .vditor-preview code.language-mdm-abc, .vditor-preview code.language-mdm-abc-play"
        )
        .forEach(function (el) {
          el.classList.remove("language-mdm-abc", "language-mdm-abc-play");
          el.classList.add("language-abc");
          el.setAttribute("data-processed", "true");
        });
      const fresh = document.querySelectorAll(
        ".vditor-ir__preview code.language-abc:not([data-mdm-abc]), .vditor-preview code.language-abc:not([data-mdm-abc])"
      );
      if (fresh.length && ensureAbcjs()) {
        fresh.forEach(function (el) {
          const parent = el.parentElement;
          if (
            parent.classList.contains("vditor-ir__marker--pre") ||
            parent.classList.contains("vditor-wysiwyg__pre")
          ) {
            return; // editable source, not a preview
          }
          const source = el.textContent;
          el.setAttribute("data-mdm-abc", "1");
          el.setAttribute("data-processed", "true");
          el.innerHTML = "";
          const visual = ABCJS.renderAbc(el, source, {
            add_classes: true,
            paddingtop: 2,
            paddingbottom: 2,
            paddingleft: 0,
            paddingright: 0,
          })[0];
          // Kept for the player: its engraved elements remember the source
          // chars they came from, which is how the notes light up while the
          // synth plays them (see highlightPlaying below).
          if (visual) SCORE_VISUALS.set(el, visual);
          el.style.overflowX = "auto";
        });
      }
      fitScores();
      ensureAudioToggles();
      syncPlayer();
    } catch (e) {
      // Score rendering must never break editing.
    }
  }

  // abcjs sizes its SVG with width/height attributes and leaves out the
  // viewBox, so a score wider than the pane gets its viewport shrunk by the
  // max-width rule while the drawing keeps its original coordinates: the
  // bottom and the right end are cropped. The viewBox rebuilt from those two
  // attributes makes the whole thing scale down instead. Runs on every render
  // pass, so scores that appear later are covered as well.
  //
  // Those attributes are not the whole drawing either. The abcjs bundled with
  // Vditor (5.10.3) sizes the SVG from the engraved music alone and centres the
  // title over it, so a title wider than the staff hangs outside the viewport
  // and is cut off at both ends: with %%staffwidth 200pt the box came out 266
  // units wide while the ink ran from -6 to 272 (measured). getBBox() gives
  // that real extent, and the box written here is the union of the two, so
  // nothing is ever cropped and a score that already fits keeps its size. The
  // width/height attributes grow with it: leaving them at the declared value
  // would squeeze the union into a narrower viewport, scaling the score down.
  // (abcjs 6.7.0, the one the Quarto side uses, already accounts for the title,
  // checked on the same block.)
  function fitScores() {
    document
      .querySelectorAll("code.language-abc svg:not([data-mdm-fit])")
      .forEach(function (svg) {
        const width = parseFloat(svg.getAttribute("width"));
        const height = parseFloat(svg.getAttribute("height"));
        if (!width || !height) return;
        let box = null;
        try {
          const ink = svg.getBBox();
          if (ink.width > 0 && ink.height > 0) box = ink;
        } catch (e) {
          // Not laid out yet (a hidden panel measures every box at zero): the
          // fallback below still keeps the old behaviour, and the attribute is
          // left off so a later pass can measure it for real.
        }
        const x = box ? Math.min(0, box.x) : 0;
        const y = box ? Math.min(0, box.y) : 0;
        const w = (box ? Math.max(width, box.x + box.width) : width) - x;
        const h = (box ? Math.max(height, box.y + box.height) : height) - y;
        svg.setAttribute("viewBox", x + " " + y + " " + w + " " + h);
        svg.setAttribute("width", w);
        svg.setAttribute("height", h);
        if (box) svg.setAttribute("data-mdm-fit", "1");
      });
  }

  // Clicking a note makes abcjs highlight it: it writes fill="#ff0000" on the
  // shape and tags it abcjs-note_selected. The engine has the matching
  // unhighlight (it puts the fill back to #000000), but nothing calls it here,
  // because Vditor renders the score for display and never wires abcjs's
  // selection controller, so the red stays for good. In this editor a click on
  // a score already means something else, open its ABC source, and nothing
  // reads the selection, so it is undone right after abcjs writes it. Restore
  // black rather than clearing the attribute: that is the value abcjs itself
  // returns to, and the one the dark recolouring looks for.
  function clearScoreSelection() {
    document
      .querySelectorAll("code.language-abc .abcjs-note_selected")
      .forEach(function (el) {
        el.setAttribute("fill", "#000000");
        el.setAttribute(
          "class",
          (el.getAttribute("class") || "")
            .replace("abcjs-note_selected", "")
            .trim()
        );
      });
  }

  // The highlight is an attribute change, which the render observer below does
  // not watch, and abcjs writes it from its own handler on the shape. Hence a
  // listener of our own, and a timeout so the undo lands after the event has
  // been dispatched.
  function watchScoreSelection() {
    document.addEventListener(
      "click",
      function (e) {
        if (!e.target.closest || !e.target.closest("code.language-abc")) return;
        setTimeout(clearScoreSelection, 0);
      },
      true
    );
  }

  // ---------- Copy ----------

  // Vditor's copy button pushes the raw source into a hidden textarea and
  // copies it with select() + execCommand, which flashes a page-wide
  // selection: the whole document lights up for an instant. The click is
  // intercepted in capture phase before the inline handler, for every code
  // block and not only the scores: the source goes to the clipboard through
  // the clipboard API, nothing is selected, and the block that was copied
  // gives a brief pulse of its own background as the feedback.
  //
  // A score also loses its layout directives (%%staffwidth and friends) on
  // the way out: they size the block for this document and mean nothing
  // pasted elsewhere.
  const LAYOUT_DIRECTIVE =
    /^%%(staffwidth|pagewidth|pageheight|scale|leftmargin|rightmargin|topmargin|botmargin|staffsep|sysstaffsep)\b.*\n?/gim;

  function stripLayoutDirectives(source) {
    return source.replace(LAYOUT_DIRECTIVE, "");
  }

  // The element carrying the background of the block: the score itself, or
  // the rendered code the card is painted on.
  function copiedCard(block) {
    return (
      block.querySelector("code.language-abc") ||
      block.querySelector(".vditor-ir__preview code")
    );
  }

  function pulseBlock(block) {
    const code = copiedCard(block);
    if (!code) return;
    code.classList.remove("mdm-copy-pulse");
    void code.offsetWidth; // restart the animation
    code.classList.add("mdm-copy-pulse");
    setTimeout(function () {
      code.classList.remove("mdm-copy-pulse");
    }, 600);
  }

  function copyPlain(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        copyFallback(text);
      });
    }
    copyFallback(text);
  }

  // Off-screen textarea fallback: same mechanism Vditor uses, but the
  // element sits outside the viewport, so nothing visible gets selected.
  function copyFallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-10000px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      // no clipboard available: nothing else to do
    }
    document.body.removeChild(ta);
  }

  function handleCopyClick(e) {
    if (!e.target.closest) return;
    const span = e.target.closest(".vditor-copy span");
    if (!span) return;
    const block = span.closest('[data-type="code-block"]');
    if (!block) return;
    const codeEl = block.querySelector("pre.vditor-ir__marker--pre > code");
    if (!codeEl) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const source = codeEl.textContent;
    copyPlain(
      block.querySelector("code.language-abc")
        ? stripLayoutDirectives(source)
        : source
    );
    span.setAttribute(
      "aria-label",
      (window.VditorI18n && window.VditorI18n.copied) || "Copied"
    );
    pulseBlock(block);
  }

  // ---------- Audio ----------

  // Each score gets a small button beside the copy button that opens a player
  // bar under the score; play sounds the tune. The synthesizer is the abcjs
  // 6.7.0 vendored in media/vendor/abcjs (the same engine the Quarto HTML
  // uses), NOT the 5.10.3 bundled with Vditor that engraves the scores: the
  // 6.x synth is the one maintained, and its tune objects must come from the
  // engine that plays them, so the tune is engraved again invisibly at mount.
  // The soundfont is a piano vendored in media/vendor/soundfont, so playback
  // needs no network at all.
  //
  // Loaded over XHR and evaluated with the module/exports pair the UMD wrapper
  // looks for, instead of a <script> tag: the tag would assign window.ABCJS,
  // the global the 5.10.3 engraver lives in, and every score rendered from
  // that moment on would silently change engine. The webview CSP already
  // carries 'unsafe-eval' (Vditor wants it), so Function() is available.
  let abcjs6 = null;
  let abcjs6Loading = null;

  function loadAbcjs6() {
    if (abcjs6) return Promise.resolve(abcjs6);
    if (!abcjs6Loading) {
      abcjs6Loading = new Promise(function (resolve, reject) {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", window.MDM_ABCJS6, true);
        xhr.onload = function () {
          try {
            const module = { exports: {} };
            new Function("module", "exports", xhr.responseText)(
              module,
              module.exports
            );
            abcjs6 = module.exports;
            resolve(abcjs6);
          } catch (e) {
            reject(e);
          }
        };
        xhr.onerror = function () {
          reject(new Error("abcjs unreachable"));
        };
        xhr.send();
      });
    }
    return abcjs6Loading;
  }

  // The one open player: { index, bar, controller, source }. One at a time on
  // purpose, two tunes sounding over each other serve nobody; opening a second
  // score closes the first. `index` is the block's position among the score
  // blocks, the identity that survives Vditor rebuilding the block's DOM.
  let player = null;

  // The on-screen engraving of each score, keyed by its <code>. The player
  // needs it to light up the notes as they sound: the engraved elements
  // remember the chars of source they came from, and so do the synth's
  // events, so the two engravings (5.10.3 on screen, 6.7.0 in the synth)
  // meet on the source text.
  const SCORE_VISUALS = new WeakMap();

  // One volume for the whole webview: set it on one score and every player
  // opened after (or still open) sounds at that level. Deliberately not a
  // setting: it resets when the document closes. Mute is a state of its own
  // and not a level of zero, so silencing a score and bringing it back does
  // not cost the level that was set.
  let audioVolume = 1;
  let audioMuted = false;
  let audioCtx = null;
  let audioGain = null;
  let audioMute = null;
  let audioProxy = null;

  // The realtime graph: one AudioContext for the session, with a master gain
  // (the volume) and a mute stage in front of it feeding the real output.
  // Built the moment a player opens, inside the click that opens it, and
  // not later when the engine has loaded: a context made inside a gesture is
  // allowed to run under any autoplay policy, and the first play then finds
  // the output already awake (see wakeAudio). Cheap to call again.
  function ensureAudioGraph() {
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      audioCtx = new Ctor();
      audioGain = audioCtx.createGain();
      audioGain.gain.value = audioMuted ? 0 : audioVolume;
      audioGain.connect(audioCtx.destination);
      // A second gain in front of the volume, for the resume silence alone
      // (scheduleSilentGap): the two never share an AudioParam, so the slider
      // and the scheduled automation cannot fight over one value.
      audioMute = audioCtx.createGain();
      audioMute.connect(audioGain);
    }
    wakeAudio();
  }

  // abcjs plays straight into activeAudioContext().destination and offers no
  // volume hook, so the context it is handed is a Proxy whose destination is
  // the mute stage, behind which sits the volume and then the real output;
  // the slider moves that gain live, mid playback included. Everything else
  // forwards to the real context, bound so the native methods keep their
  // receiver. The bundle runs no instanceof checks on the context (grepped),
  // and its per-note gains live in the OfflineAudioContext it renders with,
  // out of this path.
  //
  // Registered before anything in the engine asks for a context: its
  // supportsAudio() goes through activeAudioContext(), which makes a context
  // of its own when none is registered, and that one would then run for the
  // rest of the session beside ours, holding a second output stream open for
  // nothing (seen in VS Code: two playback streams per editor).
  function registerAudioGraph(A) {
    if (!audioCtx) return;
    if (!audioProxy) {
      audioProxy = new Proxy(audioCtx, {
        get: function (target, prop) {
          if (prop === "destination") return audioMute;
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    A.synth.registerAudioContext(audioProxy);
  }

  // ---- Keeping the output awake ----
  //
  // The synth does its part: measured on the realtime graph, the first note
  // of a tune is in the rendered signal from the first millisecond of the
  // first play, the same as on every replay. What ate it was the far end of
  // the audio path, past the context: the OS sink and the device behind it
  // doze when nothing has sounded for a while and come back late, and some
  // devices (Bluetooth headsets above all) sleep on digital silence even
  // with the stream running, then wake a few hundred milliseconds after the
  // signal returns, which is the whole of a first note. The tune was fine
  // once the path was warm, hence "it plays right when I go back to the
  // start".
  //
  // So while a player is open the output is kept awake by a pilot: a sine
  // at 8 Hz, far below anything a driver can reproduce or an ear can hear,
  // at -48 dBFS, into the real output (past the volume and the mute, which
  // are about the tune). It keeps the stream running and the samples
  // non-zero, which is what the device's silence detection reads. Starting
  // it at the click that opens the bar buys the seconds between opening and
  // pressing play for the device to wake in; the idle minute after the last
  // player closes lets it sleep again, so an editor left open does not hold
  // a headset awake for good. The level and the rate are the two numbers to
  // tune if a device still dozes (raise the level) or lets the pilot through
  // (lower it).
  const PILOT_HZ = 8;
  const PILOT_LEVEL = 0.004; // about -48 dBFS
  const AUDIO_IDLE_MS = 60000;
  let audioPilot = null; // { osc, gain } while the output is being kept awake
  let audioAwake = false; // what the editor wants the output to be
  let audioIdleTimer = null;

  function wakeAudio() {
    if (!audioCtx) return;
    audioAwake = true;
    if (audioIdleTimer) {
      clearTimeout(audioIdleTimer);
      audioIdleTimer = null;
    }
    if (audioCtx.state !== "running") {
      try {
        audioCtx.resume().catch(function () {});
      } catch (e) {
        // a context that cannot be resumed here; play will try again
      }
    }
    if (audioPilot) return;
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = PILOT_HZ;
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    // Ramped in and out: a step, however small, is a click.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(PILOT_LEVEL, now + 0.1);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    audioPilot = { osc: osc, gain: gain };
  }

  // Stops the pilot and suspends the context, which lets the sink and the
  // device sleep. Anything that wants sound afterwards goes through
  // wakeAudio, the suspend included: a player opened while the suspend is in
  // flight is resumed behind it.
  function restAudio() {
    if (!audioCtx) return;
    audioAwake = false;
    if (audioIdleTimer) {
      clearTimeout(audioIdleTimer);
      audioIdleTimer = null;
    }
    if (audioPilot) {
      const pilot = audioPilot;
      audioPilot = null;
      const now = audioCtx.currentTime;
      try {
        pilot.gain.gain.cancelScheduledValues(now);
        pilot.gain.gain.setValueAtTime(pilot.gain.gain.value, now);
        pilot.gain.gain.linearRampToValueAtTime(0, now + 0.05);
        pilot.osc.stop(now + 0.06);
      } catch (e) {
        // a context torn down mid-flight
      }
    }
    try {
      audioCtx
        .suspend()
        .then(function () {
          if (audioAwake && audioCtx.state !== "running") audioCtx.resume();
        })
        .catch(function () {});
    } catch (e) {
      // same
    }
  }

  // A minute after the last player closes, the output is let go. Opening
  // another player inside that minute keeps it (wakeAudio clears the timer).
  function restAudioWhenIdle() {
    if (!audioCtx || audioIdleTimer) return;
    audioIdleTimer = setTimeout(function () {
      audioIdleTimer = null;
      if (!player) restAudio();
    }, AUDIO_IDLE_MS);
  }

  function playerSounding() {
    return !!(
      player &&
      player.bar &&
      player.bar.querySelector(".abcjs-midi-start.abcjs-pushed")
    );
  }

  // Out of sight, the pilot has nothing to keep ready: a hidden webview lets
  // the output go unless a tune is sounding (the editor keeps its context
  // when hidden, and music that was playing goes on), and takes it back the
  // moment it is shown with a player open.
  document.addEventListener("visibilitychange", function () {
    if (!audioCtx) return;
    if (document.visibilityState === "hidden") {
      if (!playerSounding()) restAudio();
    } else if (player) {
      wakeAudio();
    }
  });

  // A speaker drawn like the other icons: fill only, the sound wave as a
  // filled crescent rather than a stroked arc. It is the only speaker left in
  // the editor: the toggle beside the copy button used to be one too, and now
  // wears headphones so that a struck-through cone means one thing only.
  const SPEAKER_CONE =
    '<path d="M2 6.5Q2 6 2.5 6H4.6L7.9 3.2Q8.8 2.5 8.8 3.6V12.4Q8.8 13.5 7.9 12.8L4.6 10H2.5Q2 10 2 9.5Z"/>';
  const SPEAKER_WAVE =
    '<path d="M11 5.2q2 2.8 0 5.6l-.9-.62q1.55-2.18 0-4.36z"/>';
  const SPEAKER_SLASH =
    '<path d="M11.31 5.32 14.31 9.72 13.49 10.28 10.49 5.88Z"/>';
  const VOLUME_ICON =
    '<svg viewBox="0 0 16 16">' + SPEAKER_CONE + SPEAKER_WAVE + "</svg>";
  const VOLUME_OFF_ICON =
    '<svg viewBox="0 0 16 16">' + SPEAKER_CONE + SPEAKER_SLASH + "</svg>";

  // The level reaching the output. A jump straight to zero cuts the waveform
  // wherever it happens to be and clicks; a 20 ms ramp is short enough to
  // read as immediate and long enough to land quietly. The ramp is scheduled
  // from the value the gain has right now, so a mute pressed while a previous
  // one is still ramping picks up where that one got to.
  function applyVolume() {
    if (!audioGain || !audioCtx) return;
    const now = audioCtx.currentTime;
    audioGain.gain.cancelScheduledValues(now);
    audioGain.gain.setValueAtTime(audioGain.gain.value, now);
    audioGain.gain.linearRampToValueAtTime(audioMuted ? 0 : audioVolume, now + 0.02);
  }

  function volumeControl() {
    const wrap = document.createElement("div");
    wrap.className = "mdm-audio-vol";
    // The speaker is a button: it silences the score and brings it back.
    // Here the icon reports the state and not the destination of the click,
    // against the rule the toggles of this editor follow, and for a reason of
    // its own: those toggles are the only thing on screen when their block is
    // shut, so a face that named the state would be describing something
    // nobody can see, while this one sits in an open bar next to the level it
    // governs, where a struck-through speaker is read as "no sound is coming
    // out" by everybody. The tooltip still names the destination ("Mute",
    // "Unmute"), which is the pairing every player uses. Muting is a state of
    // the session, like the level, so it holds across the players opened
    // after it.
    const mute = document.createElement("span");
    mute.className = "mdm-audio-mute vditor-tooltipped vditor-tooltipped__n";
    mute.setAttribute("role", "button");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(Math.round(audioVolume * 100));
    slider.setAttribute("aria-label", "Volume");
    function paint() {
      mute.setAttribute("aria-label", audioMuted ? "Unmute" : "Mute");
      const face = audioMuted ? "off" : "on";
      if (mute.getAttribute("data-mdm-face") !== face) {
        mute.setAttribute("data-mdm-face", face);
        mute.innerHTML = audioMuted ? VOLUME_OFF_ICON : VOLUME_ICON;
      }
      wrap.classList.toggle("mdm-audio-vol--muted", audioMuted);
      // What the slider has been set to, for the fill of its track.
      slider.style.setProperty("--mdm-vol", slider.value + "%");
    }
    mute.addEventListener("click", function () {
      audioMuted = !audioMuted;
      applyVolume();
      paint();
    });
    slider.addEventListener("input", function () {
      audioVolume = Number(slider.value) / 100;
      // Reaching for the level is asking for sound: it lifts the mute rather
      // than setting a level nobody would hear.
      audioMuted = false;
      applyVolume();
      paint();
    });
    paint();
    wrap.appendChild(mute);
    wrap.appendChild(slider);
    return wrap;
  }

  // The progress bar, given the manners of the volume slider next to it.
  //
  // abcjs wires that bar to a single `click`: one listener on
  // .abcjs-midi-progress-background, and its handler reads nothing but the x
  // of that one event (both checked in the bundle). So the handle could be
  // jumped to but never taken hold of, while the volume beside it is a native
  // range that drags, keeps following the pointer once it has left the
  // control, and answers the arrow keys. What follows adds the missing half.
  //
  // The pointer owns the handle for as long as the button is down: the drag
  // moves the handle and the clock, and the seek lands on release. Seeking as
  // the pointer moves is not on with this engine, since midiBuffer.seek stops
  // every sounding source and kicks off a fresh one at the new offset
  // (checked in the bundle), and doing that at the rate pointermove arrives
  // stutters.
  //
  // The plain click is taken over too, and abcjs's own swallowed, rather than
  // leaving two owners to seek the same bar. abcjs sets aside a seek asked
  // for while a tune is loading and looks again every 500ms, so its own is
  // served whenever it gets round to it: measured, a click at 40% followed by
  // three arrow keys and an End left the head back at 40%, the click having
  // landed last and undone every press after it. What abcjs does around its
  // own handler is done here instead, the context resumed by the mousedown of
  // the bar and the spinner lit on play for as long as a priming lasts.
  //
  // While a tune sounds, its timer reports the playhead into
  // control.setProgress sixteen times a beat, which would pull the handle
  // out from under the pointer. That method is the one place the two writers
  // meet, so it is wrapped: silent for as long as the drag lasts, and called
  // by the drag itself.
  const SEEK_KEYS = {
    ArrowLeft: -0.02,
    ArrowRight: 0.02,
    ArrowDown: -0.02,
    ArrowUp: 0.02,
    PageDown: -0.1,
    PageUp: 0.1,
  };

  function clampPercent(percent) {
    return percent < 0 ? 0 : percent > 1 ? 1 : percent;
  }

  function makeProgressDraggable(bar, controller) {
    const track = bar.querySelector(".abcjs-midi-progress-background");
    const control = controller.control;
    if (!track || !control) return;
    const show = control.setProgress.bind(control);
    let dragging = false; // the button is down on the track
    let head = 0; // where the head is drawn, which is what a key steps from
    let announced = -1;
    let asked = null; // a position waiting for the engine to be free
    let seeking = false;

    // The fill starts empty and is written from paint() thereafter. Set here
    // as well so the track is painted from a value of its own from the first
    // frame, rather than from the fallback of the stylesheet.
    track.style.setProperty("--mdm-progress", "0.00%");
    track.setAttribute("tabindex", "0");
    track.setAttribute("role", "slider");
    track.setAttribute("aria-label", "Position");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");

    // Every move of the handle goes through here, the drag's included, so the
    // reading a screen reader is given follows the pointer as well as the
    // playhead. Written only when the whole per cent changes: the playhead
    // reports far oftener than that.
    function paint(percent, duration) {
      show(percent, duration);
      head = percent;
      // The fill of the track comes off the same number as the head, so the
      // two cannot drift apart: this is the one call every move goes through,
      // the playhead's and the drag's alike.
      track.style.setProperty(
        "--mdm-progress",
        (clampPercent(percent) * 100).toFixed(2) + "%"
      );
      const value = Math.round(percent * 100);
      if (value === announced) return;
      announced = value;
      track.setAttribute("aria-valuenow", String(value));
    }
    control.setProgress = function (percent, duration) {
      if (!dragging) paint(percent, duration);
    };

    // What the clock is drawn from. abcjs takes it off the primed buffer in
    // the one other place it sets the progress by hand (setWarp), and before
    // the tune is primed it has no duration to show either.
    function totalMs() {
      const buffer = controller.midiBuffer;
      return buffer && buffer.duration ? buffer.duration * 1000 : 0;
    }

    // offsetWidth, not the width of the box: the head is placed at
    // clientWidth * percent, and on a track with neither border nor padding
    // that is the same integer, so the head lands under the pointer to the
    // pixel rather than a fraction of one off it.
    function pointerPercent(clientX) {
      const width = track.offsetWidth;
      if (!width) return 0;
      return clampPercent(
        (clientX - track.getBoundingClientRect().left) / width
      );
    }

    // What the last gesture asked for is what the engine is told, and it is
    // told once. The head answers the hand at once, while a tune nobody has
    // played yet takes a second or more to prime, so a burst of gestures
    // inside that window has to collapse into the last of them: sending each
    // one as it came would have walked the head back down every step it had
    // just climbed as the older requests were served in turn.
    function seek(percent) {
      paint(percent, totalMs());
      asked = percent;
      if (!seeking) runSeek();
    }

    // runWhenReady is what abcjs defers its own controls through: it primes
    // the tune if it has not been played yet and waits out a priming already
    // under way. The position is read inside, once the engine is free, and
    // not at the point the gesture was made.
    function runSeek() {
      seeking = true;
      const start = bar.querySelector(".abcjs-midi-start");
      const priming = !!start && !controller.isLoaded;
      if (priming) start.classList.add("abcjs-loading");
      let served = false;
      function done() {
        seeking = false;
        if (priming) start.classList.remove("abcjs-loading");
        // Nothing was served: there is no tune to seek in, and asking again
        // would only spin.
        if (!served) asked = null;
        else if (asked !== null) runSeek();
      }
      controller
        .runWhenReady(function () {
          served = true;
          const percent = asked;
          asked = null;
          controller.seek(percent);
          // The seek moves the timer and the sound; the reading the widget is
          // drawn from is a field of its own on the controller. The timer
          // does write it back, but only when the new position falls in
          // another subdivision of the beat (timer.setProgress calls the beat
          // callback on i !== currentBeat), so this is what puts the head on
          // the point that was asked for rather than on the nearest one the
          // timer happens to report.
          controller.setProgress(percent, totalMs());
          return Promise.resolve();
        }, null)
        .then(done, done);
    }

    track.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      dragging = true;
      paint(pointerPercent(e.clientX), totalMs());
      // Moves that leave the bar keep arriving here, the way the browser goes
      // on feeding a range input it has taken hold of.
      try {
        track.setPointerCapture(e.pointerId);
      } catch (err) {
        // a pointer the browser has already let go of
      }
    });
    track.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      paint(pointerPercent(e.clientX), totalMs());
    });
    track.addEventListener("pointerup", function (e) {
      if (!dragging) return;
      dragging = false;
      seek(pointerPercent(e.clientX));
    });
    track.addEventListener("pointercancel", function () {
      if (!dragging) return;
      dragging = false;
      paint(controller.percent || 0, totalMs()); // back onto the playhead
    });
    // abcjs's listener on the same element cannot be outrun by another added
    // to it, since at the target the two are called in the order they were
    // registered; caught on the way down, at the bar, it never gets there.
    bar.addEventListener(
      "click",
      function (e) {
        if (track.contains(e.target)) e.stopPropagation();
      },
      true
    );
    track.addEventListener("keydown", function (e) {
      let percent = null;
      if (e.key === "Home") percent = 0;
      else if (e.key === "End") percent = 1;
      // Stepped from where the head is drawn, not from the controller's own
      // reading: that one is only written back once the seek has gone through,
      // and priming zeroes it on the way, so presses made before a tune is
      // ready would all have stepped off the same nought.
      else if (SEEK_KEYS[e.key] !== undefined) {
        percent = clampPercent(head + SEEK_KEYS[e.key]);
      }
      if (percent === null) return;
      e.preventDefault();
      seek(percent);
    });
  }

  // The widget abcjs builds, brought into this editor's manners. Two things
  // it does not do on its own:
  //
  //  - Tooltips. It labels its buttons with the `title` attribute, and a
  //    native tooltip never appears inside the VS Code webview, so the two
  //    buttons went unlabelled. They get the CSS tooltip the rest of this
  //    editor uses (the copy button included), which is drawn from
  //    aria-label; the title is dropped so that nothing shows it twice.
  //    Drawn north: the bar sits at the bottom of the block, and a tooltip
  //    below it would fall outside the score.
  //  - Labels that follow the state. As everywhere in this editor, they name
  //    what the click leads to, not the state in force.
  //
  // Play leads the bar, and repeat follows it: abcjs emits repeat first, and
  // it looks for its controls by class, never by position, so the two can be
  // swapped (checked in the bundle).
  // abcjs ships no stop, only play/pause and repeat: pausing leaves the tune
  // halfway and the next press carries on from there. Stop is built here out
  // of the two things the controller does have. The pause goes through the
  // play button itself rather than controller.pause(), so the widget's own
  // state follows the press, and restart() rewinds both the timer and the
  // sound to the top.
  //
  // A <g> around the shape because the rules that colour these buttons reach
  // for one: that is how abcjs draws its own.
  const STOP_ICON =
    '<svg viewBox="0 0 16 16"><g><rect x="3" y="3" width="10" height="10" rx="1.8"/></g></svg>';

  function stopButton(bar) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "abcjs-btn mdm-audio-stop vditor-tooltipped vditor-tooltipped__n";
    button.setAttribute("aria-label", "Stop");
    button.innerHTML = STOP_ICON;
    button.addEventListener("click", function () {
      const start = bar.querySelector(".abcjs-midi-start");
      if (start && start.classList.contains("abcjs-pushed")) start.click();
      if (player && player.bar === bar && player.controller) {
        try {
          player.controller.restart();
        } catch (e) {
          // a tune that never played has no timer to rewind
        }
      }
      clearResumeHold(); // a fresh start is never a resume
      clearPlayingHighlight();
    });
    return button;
  }

  function decorateWidget(bar, controller) {
    const widget = bar.querySelector(".abcjs-inline-audio");
    if (!widget) return;
    const start = widget.querySelector(".abcjs-midi-start");
    const loop = widget.querySelector(".abcjs-midi-loop");
    if (start && loop) widget.insertBefore(start, loop);
    if (start) start.insertAdjacentElement("afterend", stopButton(bar));
    [start, loop].forEach(function (button) {
      if (!button) return;
      button.classList.add("vditor-tooltipped", "vditor-tooltipped__n");
      button.removeAttribute("title");
    });
    widget.appendChild(volumeControl());
    makeProgressDraggable(bar, controller);
    syncWidgetLabels(bar);
    // Playing, pausing and finishing are class changes abcjs makes itself,
    // and the labels have to follow them. Only the class attribute is
    // watched, so writing the labels back cannot feed the observer.
    new MutationObserver(function () {
      syncWidgetLabels(bar);
    }).observe(widget, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
  }

  function syncWidgetLabels(bar) {
    const start = bar.querySelector(".abcjs-midi-start");
    const loop = bar.querySelector(".abcjs-midi-loop");
    if (start) {
      start.setAttribute(
        "aria-label",
        start.classList.contains("abcjs-pushed") ? "Pause" : "Play"
      );
    }
    if (loop) {
      loop.setAttribute(
        "aria-label",
        loop.classList.contains("abcjs-pushed") ? "Play once" : "Repeat"
      );
    }
  }

  // What abcjs writes into the fill attribute of a sounding note. The colour
  // on screen is NOT this one: the stylesheet paints .abcjs-note_selected
  // (--mdm-play-accent), which lets the mark carry one value for the light
  // side and another for the dark, the way the score fills do. This value is
  // what shows if that rule is ever missed, so it is the light one.
  const PLAY_HIGHLIGHT = "#a0740f";

  function playerDisplayEngraver() {
    const block = playerBlock();
    const code =
      block && block.querySelector(".vditor-ir__preview code.language-abc");
    const visual = code && SCORE_VISUALS.get(code);
    const engraver = visual && visual.engraver;
    return engraver && engraver.staffgroups ? engraver : null;
  }

  // What the engraver's own rangeHighlight does (walk the engraved elements,
  // light the ones whose chars intersect the sounding range), but with a
  // colour of ours: highlight() hardwires its default to the selection red.
  function highlightPlaying(start, end) {
    const engraver = playerDisplayEngraver();
    if (!engraver) return;
    engraver.clearSelection();
    let root = null;
    engraver.staffgroups.forEach(function (group) {
      group.voices.forEach(function (voice) {
        voice.children.forEach(function (child) {
          const elem = child.abcelem;
          if (elem && end > elem.startChar && start < elem.endChar) {
            engraver.selected.push(child);
            child.highlight(undefined, PLAY_HIGHLIGHT);
            if (!root && child.elemset && child.elemset[0]) {
              root = child.elemset[0].ownerSVGElement;
            }
          }
        });
      });
    });
    // A note is handed the shapes of the staff it sits on in the same set, so
    // marking one can put the accent on a staff line and draw a blue rule
    // across the system. The ink they carry is the black abcjs draws with,
    // which is what unhighlight would restore anyway.
    if (root) {
      root.querySelectorAll(".abcjs-staff.abcjs-note_selected").forEach(
        function (el) {
          el.classList.remove("abcjs-note_selected");
          el.setAttribute("fill", "#000000");
        }
      );
    }
  }

  // clearSelection puts the fill back to the black abcjs draws with, which is
  // also what the dark-side repaint keys on.
  function clearPlayingHighlight() {
    const engraver = playerDisplayEngraver();
    if (engraver) engraver.clearSelection();
  }

  function scoreBlocks() {
    return Array.prototype.filter.call(
      document.querySelectorAll('#app div[data-type="code-block"]'),
      function (block) {
        return block.querySelector(".vditor-ir__preview code.language-abc");
      }
    );
  }

  // The tune as it stands in the editable source, which is ahead of the
  // rendered SVG while an edit is being typed.
  function scoreSource(block) {
    const code = block.querySelector("pre.vditor-ir__marker--pre > code");
    return code ? code.textContent : "";
  }

  // The block the player is open on. While its bar is in the document the bar
  // itself says which block, which follows the score around edits that insert
  // or remove blocks above it; the stored index is the fallback for the moment
  // just after Vditor wiped the preview, when the bar is gone and the position
  // is all there is.
  function playerBlock() {
    if (!player) return null;
    if (player.bar && document.contains(player.bar)) {
      return player.bar.closest('[data-type="code-block"]');
    }
    return scoreBlocks()[player.index] || null;
  }

  function closePlayer() {
    if (!player) return;
    clearResumeHold();
    try {
      clearPlayingHighlight(); // while `player` still says which score
    } catch (e) {
      // a score already re-engraved without the old elements
    }
    const p = player;
    player = null;
    if (p.controller) {
      try {
        p.controller.destroy(); // stops the timer and the sounding notes
      } catch (e) {
        // a synth that never finished initializing
      }
    }
    if (p.bar && p.bar.parentElement) p.bar.parentElement.removeChild(p.bar);
    document.querySelectorAll("#app [data-mdm-audio]").forEach(function (el) {
      el.removeAttribute("data-mdm-audio");
    });
    syncToggleLabels();
    restAudioWhenIdle();
  }

  function openPlayer(block) {
    closePlayer();
    const preview = block.querySelector(".vditor-ir__preview");
    const code = preview && preview.querySelector("code.language-abc");
    if (!code) return;
    // First thing, inside the click: the output starts waking now, and the
    // engine that loads afterwards finds the context made.
    ensureAudioGraph();
    const bar = document.createElement("div");
    bar.className = "mdm-audio";
    bar.setAttribute("contenteditable", "false");
    // The player's events are its own: without this, Vditor's handlers on the
    // editable root expand the block and move the caret the moment play is
    // pressed, and the volume slider's input events would go through its
    // serialize-on-input path. Bubble phase, so the widget's own listeners,
    // which sit on the buttons and on the progress bar themselves, have all
    // run by then.
    //
    // keyup is on the list for a reason of its own. The bar is inserted inside
    // the score's <pre>, and Vditor keeps a listener there that puts the focus
    // back on the editable root; keydown never reaches it, so the first arrow
    // key pressed on the progress bar was answered and the bar then lost the
    // focus on the release of that same key, leaving every arrow after it with
    // nowhere to land (traced to vditor's index.min.js from a focus() the
    // <pre> listener calls).
    [
      "click",
      "mousedown",
      "mouseup",
      "input",
      "change",
      "keydown",
      "keyup",
    ].forEach(function (type) {
      bar.addEventListener(type, function (e) {
        e.stopPropagation();
      });
    });
    // The caret stays where it is while the player is used. A <button> is
    // focusable, so its mousedown pulls the focus out of the editable root,
    // and with the score's block open for editing Vditor answers that by
    // collapsing the block, which rebuilds the preview this bar lives in: the
    // button was destroyed between mousedown and click and the click never
    // reached the synth, so the first play after looking at a score's source
    // did nothing at all. Preventing the default of mousedown keeps the focus
    // (and the click, which fires regardless). Two controls keep theirs: the
    // volume slider, a form control that needs the browser's own drag, and
    // the progress bar, which answers the arrow keys once it has been clicked
    // just as the volume does. Neither closes the block, since a blur that
    // lands anywhere inside the bar is stopped before Vditor hears it (see
    // guardBlur), and neither takes a text selection with it (the two carry
    // user-select: none).
    //
    // The gesture is also one more place the output is woken (the click that
    // opened the bar was the first): abcjs resumes a suspended context on
    // play by itself, but only after the soundfont is primed, by which time
    // the gesture that allowed it may have passed.
    bar.addEventListener("mousedown", function (e) {
      if (audioCtx) wakeAudio();
      if (!e.target.closest("input, .abcjs-midi-progress-background")) {
        e.preventDefault();
      }
    });
    bar.addEventListener("click", watchPlayPresses, true);
    // The bar sits under the score at the score's width (with a floor so the
    // controls fit), which keeps it reading as part of the block.
    const svg = code.querySelector("svg");
    if (svg) {
      const width = svg.getBoundingClientRect().width;
      if (width) bar.style.maxWidth = Math.max(280, Math.ceil(width)) + "px";
    }
    code.insertAdjacentElement("afterend", bar);
    block.setAttribute("data-mdm-audio", "1"); // keeps the toggle shown
    player = {
      index: scoreBlocks().indexOf(block),
      bar: bar,
      controller: null,
      source: scoreSource(block),
    };
    syncToggleLabels();
    mountSynth(bar);
  }

  function mountSynth(bar) {
    loadAbcjs6()
      .then(function (A) {
        // Closed, or reopened elsewhere, while the engine was loading.
        if (!player || player.bar !== bar || !document.contains(bar)) return;
        ensureAudioGraph();
        if (A.synth) registerAudioGraph(A);
        if (!A.synth || !A.synth.supportsAudio()) {
          bar.textContent = "Audio is not supported here.";
          return;
        }
        // Engraved again, invisibly, by the engine that will play it. What
        // renderAbc("*") does, except abcjs leaves its scratch div in the
        // body for good and this one is taken out again.
        const scratch = document.createElement("div");
        scratch.style.cssText =
          "visibility:hidden;position:absolute;left:-10000px;top:0";
        document.body.appendChild(scratch);
        let visual = null;
        try {
          visual = A.renderAbc(scratch, player.source, {})[0];
        } finally {
          document.body.removeChild(scratch);
        }
        if (!visual) {
          bar.textContent = "Nothing to play in this block.";
          return;
        }
        const controller = new A.synth.SynthController();
        controller.load(
          bar,
          // The cursor control: the synth reports each note group with the
          // chars of source it came from, and the on-screen engraving lights
          // up the elements on that same range.
          {
            onEvent: function (ev) {
              try {
                if (!ev || typeof ev.startChar !== "number") return;
                // Inside a resume gap the sound is muted and this event is
                // the one the timer reported early; the ink waits with the
                // sound and lights when the gain comes back.
                const wait = inkHoldUntil - performance.now();
                if (wait > 0) {
                  pendingInk = ev;
                  if (!inkTimer) {
                    inkTimer = setTimeout(function () {
                      inkTimer = null;
                      const held = pendingInk;
                      pendingInk = null;
                      if (held && player) {
                        highlightPlaying(held.startChar, held.endChar);
                      }
                    }, wait);
                  }
                  return;
                }
                highlightPlaying(ev.startChar, ev.endChar);
              } catch (e) {
                // highlighting must never break playback
              }
            },
            onFinished: function () {
              try {
                clearPlayingHighlight();
              } catch (e) {
                // same
              }
            },
            // How often the controller is told where it has got to. abcjs
            // reports once per beat by default, and that number is also what
            // it restarts the cursor from after a pause (_play calls
            // timer.start(percent)), while the sound resumes from exactly
            // where it stopped: the cursor came back up to half a beat ahead
            // of the music. Measured on the third score of example.mdm, a
            // pause put the note it stood on 171 ms early. Sixteen readings
            // per beat leave that under one frame, and cost nothing: the
            // timer runs on requestAnimationFrame either way.
            beatSubdivisions: 16,
          },
          {
            displayPlay: true,
            displayProgress: true,
            displayLoop: true,
          }
        );
        controller.setTune(visual, false, {
          soundFontUrl: window.MDM_SOUNDFONT,
          // The boost abcjs applies to this same soundfont when fetched from
          // its own CDN: MusyngKite is rendered quiet, and the URL check that
          // triggers the boost never matches a local copy.
          soundFontVolumeMultiplier: 3,
          // What is written is what sounds: left on, abcjs turns the chord
          // symbols ("Dm7") into a strummed accompaniment of its own, four
          // quarters filling the measure under a written whole note.
          chordsOff: true,
        });
        decorateWidget(bar, controller);
        // Scrubbing wants sound at once: any seek, ours or the drag's,
        // discards the pause point and whatever silence was scheduled.
        const controllerSeek = controller.seek;
        controller.seek = function () {
          clearResumeHold();
          return controllerSeek.apply(controller, arguments);
        };
        player.controller = controller;
      })
      .catch(function () {
        if (player && player.bar === bar) {
          bar.textContent = "The synthesizer could not be loaded.";
        }
      });
  }

  // After every render pass: the bar is carried over Vditor's DOM rebuilds.
  // An edit inside the open block (or a full setValue) wipes the preview and
  // the bar with it; the player reopens on the block in the same position,
  // with the current source, stopped. A tune edited under a sounding player
  // should not keep playing the old notes.
  function syncPlayer() {
    if (player) {
      const block = playerBlock();
      if (!block) {
        closePlayer();
      } else if (
        !document.contains(player.bar) ||
        scoreSource(block) !== player.source
      ) {
        openPlayer(block);
      } else {
        player.index = scoreBlocks().indexOf(block);
        block.setAttribute("data-mdm-audio", "1");
      }
    }
    syncToggleLabels();
  }

  // The face of the toggle, drawn like the toolbar icons: fill only, since the
  // stylesheet zeroes strokes and a stroked shape would come out invisible.
  //
  // Headphones, and not the speaker it used to be: the player carries a
  // speaker of its own for the mute, and a struck-through cone in the corner
  // meaning "click to hide" beside a struck-through cone in the bar meaning
  // "no sound is coming out" is two readings of one drawing. Headphones say
  // sound without saying loudspeaker, so the family of the cone is left to
  // the mute alone.
  //
  // One face, not two: with a single drawing there is nothing to name the
  // destination with, so the state goes where the bar already puts it, on a
  // lit disc (the block carries data-mdm-audio while its player is open, and
  // the stylesheet paints from that). The tooltip keeps naming the
  // destination, "Show player" and "Hide player".
  const HEADPHONES_ICON =
    '<svg viewBox="0 0 16 16">' +
    '<path d="M1.6 10.6a6.4 6.4 0 0 1 12.8 0h-1.3a5.1 5.1 0 0 0-10.2 0Z"/>' +
    '<rect x="1.1" y="9.9" width="3" height="4.6" rx="1.3"/>' +
    '<rect x="11.9" y="9.9" width="3" height="4.6" rx="1.3"/></svg>';

  // The little button beside the copy button, on every score. Same manners as
  // Vditor's copy widget: absolute against the preview <pre>, shown on hover
  // (and while its player is open), tooltip drawn to the west.
  function ensureAudioToggles() {
    scoreBlocks().forEach(function (block) {
      const preview = block.querySelector(".vditor-ir__preview");
      if (!preview || preview.querySelector(".mdm-audio-toggle")) return;
      const code = preview.querySelector("code.language-abc");
      const toggle = document.createElement("div");
      toggle.className = "mdm-audio-toggle";
      toggle.setAttribute("contenteditable", "false");
      const span = document.createElement("span");
      span.setAttribute("role", "button");
      span.className = "vditor-tooltipped vditor-tooltipped__w";
      toggle.appendChild(span);
      preview.insertBefore(toggle, code);
    });
    syncToggleLabels();
  }

  // Tooltips name the destination of the click, as everywhere in this editor.
  // The drawing does not: there is only one of it (see HEADPHONES_ICON), and
  // what says whether this block's player is open is the lit disc the
  // stylesheet draws from data-mdm-audio.
  function syncToggleLabels() {
    const open = player ? playerBlock() : null;
    scoreBlocks().forEach(function (block) {
      const span = block.querySelector(".mdm-audio-toggle span");
      if (!span) return;
      span.setAttribute(
        "aria-label",
        block === open ? "Hide player" : "Show player"
      );
      // The drawing is written once. This runs on every render pass, and
      // rewriting the markup each time would throw it away and build it again
      // ten times a second while a tune plays.
      if (!span.firstChild) span.innerHTML = HEADPHONES_ICON;
    });
  }

  // Resume keeps the beat. A pause cuts a note short; pressing play again
  // must not replay its tail with no attack (abcjs's own resume), must not
  // jump ahead to the next note (this editor's first attempt, which near a
  // barline could land a full measure late, since the visual clock runs a
  // touch apart from the sound), and must not paint ink before its sound
  // (abcjs restarts its cursor by advancing the event pointer, which reported
  // the NEXT note the moment play was pressed). What it does instead is what
  // a count-in does: the sound resumes exactly where it stopped but MUTED,
  // the remainder of the cut note passes in true silence with the clock
  // running, and the gain comes back a hair before the next note attacks, on
  // the audio context's own clock, so the note that is due lands on its beat
  // in ink and in sound together.
  //
  // The pause position is remembered at the pause press; the gap is only
  // scheduled when play resumes from that same spot, so a seek in between
  // (the progress bar, stop) plays immediately, the way a scrub should.
  let resumePoint = null; // ms on the tune clock, set by the pause press
  let inkHoldUntil = 0; // wall clock; events before it wait for the beat
  let inkTimer = null;
  let pendingInk = null;

  function clearResumeHold() {
    resumePoint = null;
    inkHoldUntil = 0;
    pendingInk = null;
    if (inkTimer) {
      clearTimeout(inkTimer);
      inkTimer = null;
    }
    if (audioMute && audioCtx) {
      try {
        audioMute.gain.cancelScheduledValues(0);
        audioMute.gain.setValueAtTime(1, audioCtx.currentTime);
      } catch (e) {
        // a context torn down mid-flight
      }
    }
  }

  // Capture phase on the bar: runs before the handler abcjs put on the play
  // button, observes, and never swallows the click.
  function watchPlayPresses(e) {
    const button = e.target.closest && e.target.closest(".abcjs-midi-start");
    if (!button || !player || !player.controller) return;
    const timer = player.controller.timer;
    if (!timer || typeof timer.currentMillisecond !== "function") return;
    if (button.classList.contains("abcjs-pushed")) {
      resumePoint = timer.currentMillisecond(); // this press pauses
      return;
    }
    const at = timer.currentMillisecond();
    const fromPause =
      at > 0 && resumePoint !== null && Math.abs(at - resumePoint) <= 30;
    if (fromPause) scheduleSilentGap(timer, at);
    else clearResumeHold();
    resumePoint = null;
  }

  function scheduleSilentGap(timer, at) {
    clearResumeHold();
    if (!audioMute || !audioCtx) return;
    const timings = timer.noteTimings || [];
    let next = null;
    for (let i = 0; i < timings.length; i++) {
      const t = timings[i];
      if (
        t &&
        typeof t.milliseconds === "number" &&
        t.milliseconds > at + 1 &&
        t.midiPitches &&
        t.midiPitches.length
      ) {
        next = t.milliseconds;
        break;
      }
    }
    // Paused inside the last note: nothing will attack again, so the tail
    // stays silent to the end rather than replaying without its beginning.
    if (next === null) next = timer.lastMoment || 0;
    // A few ms early, so a clock skew clips a sliver of silence and never
    // the attack of the note that is due.
    const remaining = (next - at - 25) / 1000;
    if (remaining <= 0.03) return; // paused on the boundary: play as is
    try {
      const now = audioCtx.currentTime;
      audioMute.gain.cancelScheduledValues(now);
      audioMute.gain.setValueAtTime(0, now);
      audioMute.gain.setValueAtTime(1, now + remaining);
    } catch (e) {
      return; // no silence is better than no sound
    }
    // The ink falls silent with the sound: the cut note goes back to ink,
    // and the event the timer reports early (its restart advances the event
    // pointer to the next note at once) waits for the moment that note
    // really attacks.
    clearPlayingHighlight();
    inkHoldUntil = performance.now() + remaining * 1000;
  }

  // Vditor collapses whatever block is open for editing as soon as the
  // editable root loses the focus, and rebuilds its preview: that is what
  // used to swallow the first press of play, and the buttons of the bar are
  // kept off it by preventing the default of their mousedown. The volume
  // slider cannot be treated that way, since a form control needs the focus
  // for the browser's own drag, so its blur is stopped instead, before it
  // reaches Vditor's listener. Capture phase on the document is the only
  // place it can be caught: blur does not bubble, and Vditor listens on the
  // root itself, which the capture phase reaches first.
  function guardBlur(e) {
    if (!player || !player.bar || !e.relatedTarget) return;
    if (player.bar.contains(e.relatedTarget)) e.stopPropagation();
  }

  // In capture phase before the copy interceptor and the click-to-edit
  // handler, the same arrangement the copy button has: the toggle's clicks
  // belong to the toggle alone.
  function handleAudioToggle(e) {
    if (!e.target.closest) return;
    const span = e.target.closest(".mdm-audio-toggle span");
    if (!span) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const block = span.closest('[data-type="code-block"]');
    if (!block) return;
    if (player && playerBlock() === block) {
      closePlayer();
    } else {
      openPlayer(block);
    }
  }

  // ---------- Pandoc callouts ----------

  // Quarto callouts (::: {.callout-note} … :::) reach the editor as plain
  // text. The ::: lines are NOT standalone paragraphs: with no blank line in
  // between, lute keeps them as the first/last line of a paragraph (soft
  // break), so the detection is line-level. The paragraphs in the range are
  // classed (accent bar and tint via CSS), and the fence text itself is
  // wrapped in a small faint span. lute serializes a span by its text, so the
  // round-trip is untouched (checked in the battery); it also wipes all of
  // this while re-rendering a block, and the MutationObserver re-applies it.
  // A paragraph holding the caret is left unwrapped so typing is undisturbed.
  const CALLOUT_OPEN_LINE = /^(:{3,}[ \t]*\{([^}\n]*)\}[ \t]*)(?=\n|$)/;
  const CALLOUT_CLOSE_LINE = /(^|\n):{3,}[ \t]*$/;

  function calloutNorm(el) {
    return el.textContent.replace(/\u200B/g, "").replace(/\s+$/, "");
  }

  // Both wrappers want the whole fence line in one text node, and after an edit
  // it is not: Vditor marks the caret with a <wbr>, spins the block through
  // lute, and setRangeByWbr removes that element again without merging its
  // neighbours, so an edited fence comes back split in two or three nodes
  // ("::: {.callout-" + "" + "warning …}\n…"). firstChild/lastChild then held a
  // fragment, the marker stopped matching, and the fence kept its full size for
  // good, since Vditor only re-renders that block on a further edit inside it.
  // normalize() merges the pieces back and drops the empty ones; adjacent text
  // nodes serialize the same, so the round-trip is untouched. Only a paragraph
  // without the caret gets here, so there is no live range to disturb.
  function wrapFenceStart(p) {
    if (p.querySelector(".mdm-co-fence--open")) return;
    p.normalize();
    const n = p.firstChild;
    if (!n || n.nodeType !== 3) return; // marker not in a bare text node
    const m = /^(\u200B*:{3,}[ \t]*\{[^}\n]*\}[ \t]*)(\n|$)/.exec(n.textContent);
    if (!m) return;
    const rest = n.textContent.slice(m[1].length);
    const span = document.createElement("span");
    span.className = "mdm-co-fence mdm-co-fence--open";
    span.textContent = m[1];
    p.replaceChild(span, n);
    if (rest) p.insertBefore(document.createTextNode(rest), span.nextSibling);
  }

  function wrapFenceEnd(p) {
    if (p.querySelector(".mdm-co-fence--close")) return;
    p.normalize();
    const n = p.lastChild;
    if (!n || n.nodeType !== 3) return;
    const m = /(^|\n)(:{3,}[ \t]*\u200B*)$/.exec(n.textContent);
    if (!m) return;
    const before = n.textContent.slice(0, n.textContent.length - m[2].length);
    const span = document.createElement("span");
    span.className = "mdm-co-fence mdm-co-fence--close";
    span.textContent = m[2];
    p.replaceChild(span, n);
    if (before) p.insertBefore(document.createTextNode(before), span);
  }

  function decorateCallouts() {
    try {
      const root = contentRoot();
      if (!root) return;
      const kids = Array.prototype.slice.call(root.children);
      kids.forEach(function (el) {
        el.classList.remove("mdm-co-open", "mdm-co-close", "mdm-co-body");
      });
      const sel = window.getSelection();
      const anchor =
        sel && sel.rangeCount
          ? sel.anchorNode.nodeType === 1
            ? sel.anchorNode
            : sel.anchorNode.parentElement
          : null;

      let i = 0;
      while (i < kids.length) {
        const open =
          kids[i].tagName === "P"
            ? CALLOUT_OPEN_LINE.exec(calloutNorm(kids[i]))
            : null;
        if (!open) {
          i++;
          continue;
        }
        let j = i;
        while (
          j < kids.length &&
          !(
            kids[j].tagName === "P" &&
            CALLOUT_CLOSE_LINE.test(calloutNorm(kids[j]))
          )
        ) {
          j++;
        }
        if (j >= kids.length) {
          i++;
          continue; // unclosed: leave as plain text
        }
        const type = (open[2].match(/\.callout-([a-z]+)/) || [])[1] || "note";
        for (let k = i; k <= j; k++) {
          if (k === i) kids[k].classList.add("mdm-co-open");
          if (k === j) kids[k].classList.add("mdm-co-close");
          if (k !== i && k !== j) kids[k].classList.add("mdm-co-body");
          kids[k].setAttribute("data-mdm-co", type);
        }
        if (!anchor || !kids[i].contains(anchor)) wrapFenceStart(kids[i]);
        if (!anchor || !kids[j].contains(anchor)) wrapFenceEnd(kids[j]);
        i = j + 1;
      }
    } catch (e) {
      // Decoration must never break editing.
    }
  }

  // The fence of the paragraph holding the caret is left unwrapped so it can be
  // edited at full size, and Vditor wipes the wrapping itself while re-rendering
  // the block on every keystroke. Putting the caret back elsewhere is a
  // selection change and not a DOM mutation, so the observer below never saw it
  // and an edited fence kept its full size for good. Watched here, and only
  // when the caret crosses into or out of a callout, since selectionchange
  // fires on every cursor move.
  let calloutAnchor = null;
  function watchCallouts() {
    let scheduled = false;
    document.addEventListener("selectionchange", function () {
      const sel = window.getSelection();
      const node = sel && sel.anchorNode;
      const el = node
        ? node.nodeType === 1
          ? node
          : node.parentElement
        : null;
      const p = el && el.closest ? el.closest("[data-mdm-co]") : null;
      if (p === calloutAnchor) return;
      calloutAnchor = p;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        decorateCallouts();
      });
    });
  }

  let observer = null;
  function watchDocument() {
    const root = document.getElementById("app");
    if (!root || observer) return;
    let scheduled = false;
    observer = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        renderScores();
        decorateCallouts();
        highlightFrontMatter();
      });
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  // ---------- Code block ergonomics ----------

  function contentRoot() {
    return document.querySelector("#app .vditor-ir .vditor-reset");
  }

  // The element that scrolls. Vditor puts the scrollbar on .vditor-ir, but with
  // this stylesheet (the editable area stretched to the bottom of the pane) the
  // one that overflows is the .vditor-reset inside it, so reading .vditor-ir
  // gave a scrollTop stuck at 0 and restoring it after an update did nothing.
  function scroller() {
    const root = contentRoot();
    if (root && root.scrollHeight > root.clientHeight + 1) return root;
    return document.querySelector("#app .vditor-ir");
  }

  function caretInfo() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const node =
      range.startContainer.nodeType === 1
        ? range.startContainer
        : range.startContainer.parentElement;
    if (!node || !node.closest) return null;
    return { sel: sel, range: range, node: node };
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Ctrl+Enter: leave the current block, inserting a paragraph below it.
  // Enter with the last line empty and the caret at the end of a code block:
  // drop that empty line and leave the block (Typora behaviour).
  function handleKeydown(e) {
    if (!vditor || e.key !== "Enter" || e.altKey || e.shiftKey) return;
    const info = caretInfo();
    if (!info || !info.node.closest(".vditor-ir")) return;
    // With an extended selection, Enter must replace it (normal behaviour);
    // these shortcuts only apply with a collapsed caret.
    if (!info.sel.isCollapsed) return;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      vditor.insertEmptyBlock("afterend");
      return;
    }

    const pre = info.node.closest("pre.vditor-ir__marker--pre");
    if (!pre) return;
    const codeEl = pre.querySelector("code") || pre;
    const tail = document.createRange();
    tail.setStart(info.range.endContainer, info.range.endOffset);
    tail.setEnd(
      codeEl,
      codeEl.childNodes.length
    );
    const remaining = tail.toString();
    const text = codeEl.textContent;
    if ((remaining === "" || remaining === "\n") && /\n\n$/.test(text)) {
      e.preventDefault();
      e.stopPropagation();
      // Drop the tail of empty lines used to escape (Vditor may leave more
      // than one when inserting the line break). Accepted trade-off:
      // intentional trailing blank lines would also be dropped, the same way
      // Typora does when escaping with a double Enter.
      codeEl.textContent = text.replace(/\n\n+$/, "\n");
      placeCaretAtEnd(codeEl);
      vditor.insertEmptyBlock("afterend");
    }
  }

  // Where the button went down, so the end of a drag can be told from a plain
  // click: a click goes down and up on the same spot, a selection made with
  // the mouse does not.
  let mouseDownAt = null;
  function recordMouseDown(e) {
    mouseDownAt = { x: e.clientX, y: e.clientY, target: e.target };
    // A press in the gutter puts the caret in the nearest block, and Vditor
    // answers that by opening its source: a click 20px from the left edge
    // opened the ABC of the score beside it (measured). Preventing the
    // default leaves the caret where it was; the click still fires, and what
    // it does is below, in handleClick.
    if (inGutter(e)) e.preventDefault();
  }

  // The gutters: the strips of the editable root left and right of the
  // blocks, which are its own padding (measured: 50px a side). Nothing is
  // written there, so nothing is offered there. Told apart from the gaps
  // between blocks, which are the root as well and where placing the caret in
  // the nearest line is the ordinary thing to do: only a pointer outside the
  // content box counts.
  function inGutter(e) {
    const root = contentRoot();
    if (!root || e.target !== root) return false;
    const box = root.getBoundingClientRect();
    const style = window.getComputedStyle(root);
    const left = box.left + (parseFloat(style.paddingLeft) || 0);
    const right = box.right - (parseFloat(style.paddingRight) || 0);
    return e.clientX < left || e.clientX > right;
  }

  // The pointer keeps the arrow it has over any other chrome while it is out
  // there: the beam of an editable area would promise text where there is
  // none. A class on the root, since only the pointer knows which strip it is
  // over; the document observer watches childList and never sees it.
  let overGutter = false;
  function watchGutter() {
    document.addEventListener("mousemove", function (e) {
      const on = inGutter(e);
      if (on === overGutter) return;
      overGutter = on;
      const root = contentRoot();
      if (root) root.classList.toggle("mdm-gutter", on);
    });
  }

  // True when this click is the tail of a drag. The click event fires on the
  // common ancestor of the two endpoints, so a selection that starts inside a
  // block and ends outside it reports the editable root as its target, exactly
  // like a click on the empty area beside the block.
  function endsADrag(e) {
    if (!mouseDownAt) return false;
    if (mouseDownAt.target !== e.target) return true;
    return (
      Math.abs(e.clientX - mouseDownAt.x) > 3 ||
      Math.abs(e.clientY - mouseDownAt.y) > 3
    );
  }

  // Click on the rendered view of a code block (e.g. the score SVG): place the
  // caret at the end of its source so it can be edited. Without this, the
  // score is only reachable with the arrow keys.
  function handleClick(e) {
    if (!vditor || !e.target || !e.target.closest) return;
    if (e.target.closest(".vditor-copy")) return; // copy widget owns its clicks
    if (e.target.closest(".mdm-audio") || e.target.closest(".mdm-audio-toggle")) {
      return; // so do the player and its toggle
    }
    const preview = e.target.closest(".vditor-ir__preview");
    if (preview) {
      const block = preview.closest('[data-type="code-block"]');
      if (!block) return;
      const codeEl = block.querySelector("pre.vditor-ir__marker--pre > code");
      if (!codeEl) return;
      const root = contentRoot();
      if (root) root.focus({ preventScroll: true });
      placeCaretAtEnd(codeEl);
      // The event is not cancelled: Vditor's own click handler runs afterwards
      // and expands the block from the selection we just set (but moves the
      // caret back to the start of the source). For drawn views (SVG, with no
      // clickable text) we push it back to the end, which is where writing
      // usually continues.
      if (preview.querySelector("svg")) {
        setTimeout(function () {
          placeCaretAtEnd(codeEl);
        }, 50);
      }
      return;
    }
    // Click on the empty area below the last block: keep writing. Any empty
    // container counts (the editable area only extends a few px below the
    // content; the rest of the gap is the .vditor wrapper).
    const root = contentRoot();
    if (!root) return;
    const t = e.target;
    const isContainer =
      t === root ||
      t.id === "app" ||
      (t.classList &&
        ["vditor", "vditor-content", "vditor-ir"].some(function (c) {
          return t.classList.contains(c);
        }));
    if (!isContainer) return;
    // Selecting a whole line of a score runs past the edge of the block (the
    // page has gutters of its own), and the mouse comes up on the editable
    // root. Treated as a click, that closed the block and dropped the caret at
    // the top of the collapsed score, throwing away the selection just made;
    // below the last block it opened a paragraph instead. Neither is what the
    // drag asked for, so a drag ends here.
    if (endsADrag(e)) return;
    const last = root.lastElementChild;
    const belowLast =
      last && e.clientY >= last.getBoundingClientRect().bottom - 1;
    // A click beside a block that is open for editing closes it, the way one
    // above or below it already did. Those two worked only because they land
    // on another block and carry the caret out; to the sides there is no
    // block to land on, since a block spans the whole width and the page has
    // gutters of its own (measured: 50px), so the click fell on the editable
    // root and the source stayed open. Blurring hands it to Vditor, whose own
    // blur handler is what closes an open block, rather than undoing its
    // work from outside.
    if (!belowLast) {
      // Taken over whole in the gutter, open block or not: Vditor's own
      // handler would take the click to the nearest text and open the block
      // beside it, which is the thing the press just refused to do.
      const gutter = inGutter(e);
      const open = root.querySelector(".vditor-ir__node--expand");
      if (gutter || (open && !open.contains(e.target))) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (open && !open.contains(e.target)) root.blur();
      return;
    }
    if (!last) return;
    // We take over the click completely: otherwise Vditor's own handler moves
    // the caret to the pointer position and undoes this.
    e.preventDefault();
    e.stopPropagation();
    root.focus({ preventScroll: true });
    const isEmptyP =
      last.tagName === "P" &&
      last.textContent.replace(/\u200B/g, "").trim() === "";
    placeCaretAtEnd(last);
    if (!isEmptyP) {
      vditor.insertEmptyBlock("afterend");
    }
  }

  // ---------- Cut ----------

  // Ctrl+X copied but removed nothing. The key press never runs the browser's
  // own cut here: inside a webview on desktop VS Code the preload cancels it
  // (isCopyPasteOrCut -> preventDefault under Electron, see
  // resources/app/out/vs/workbench/contrib/webview/browser/pre/index.html) and
  // the workbench replays it by asking the frame to run
  // document.execCommand("cut"). Vditor answers the cut event by writing the
  // markdown to the clipboard itself and deleting the selection with
  // document.execCommand("delete"), and Blink refuses an execCommand called
  // from inside another one, so the deletion is dropped and the text stays.
  // Measured in headless Chrome: from a real key press that nested delete
  // returns true, from a cut started by execCommand it returns false.
  //
  // The deletion is repeated once the outer command has finished, and only
  // while the selection is still standing, which is precisely the case where
  // Vditor's own delete was the one refused. After a cut that did go through,
  // the selection is collapsed and this does nothing.
  function handleCut() {
    setTimeout(function () {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return;
      const node = sel.anchorNode;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!el || !el.closest || !el.closest(".vditor-ir")) return;
      document.execCommand("delete");
    }, 0);
  }


  // ---------- Rendered block edges ----------

  // Vditor's IR has no handling at all for a forward Delete at the edge of a
  // rendered block: the browser's raw delete merges the block's hidden source
  // into the paragraph above, the drawn view (KaTeX, or a score) stays on
  // screen orphaned, and the next serialization emits the rendered glyph text
  // as document content, which reaches the file. Measured on stock Vditor
  // 3.11.3, the same on math-block and code-block. A selection covering the
  // whole source of an open block mangles it the same way.
  //
  // These guards give the gesture Obsidian's reading instead: deleting into a
  // rendered block ENTERS it (the source opens with the caret at its start),
  // deleting at the inner edges of an open source STEPS OUT (Vditor's own
  // Backspace there dissolves the block into a paragraph of raw source), and
  // once the source has been emptied the next such key removes the block
  // whole. Entry from below (Backspace at the start of the next block) and
  // the arrow keys already do the right thing upstream and are left alone.
  // The $$ fences themselves stay out of reach: lute re-derives them from the
  // block structure on every keystroke, so there is no "broken fence" state
  // to edit; emptying the block is the way to type them anew.

  const EDGE_BLOCKS =
    'div[data-type="math-block"].vditor-ir__node, ' +
    'div[data-type="code-block"].vditor-ir__node';

  function sourceOf(block) {
    return block.querySelector("pre.vditor-ir__marker--pre > code");
  }

  // A caret put where the Range API says expands nothing on its own: Vditor
  // re-decides the --expand class only on a click or on the keyup of an
  // arrow or IME key. This is the IME branch, borrowed as a public door to
  // its expandMarker: it expands the node holding the caret and collapses
  // every other, which is the reconciliation wanted after every move made
  // here.
  function settleExpansion() {
    const root = contentRoot();
    if (!root) return;
    root.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Unidentified",
        code: "",
        keyCode: 229,
        bubbles: true,
      })
    );
  }

  function caretTo(el, atStart) {
    const root = contentRoot();
    if (root) root.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(atStart === true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    settleExpansion();
  }

  // Land beside a removed or stepped-over block: in a neighbour paragraph's
  // text, or in the source of a neighbouring rendered block. Never on such a
  // block's outer edge: lute throws an equation away when the caret token
  // lands there (measured: SpinVditorIRDOM returns a bare paragraph).
  function landOn(el, atStart) {
    const code = el.matches && el.matches(EDGE_BLOCKS) ? sourceOf(el) : null;
    caretTo(code || el, atStart);
  }

  // Serialize a change made outside Vditor's own editing path: its input()
  // re-spins the block that holds the caret, re-renders the previews, and
  // the `input` option above posts the edit to the host.
  function syncEdit() {
    const root = contentRoot();
    if (!root) return;
    root.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "",
      })
    );
  }

  // The neighbour of a block, at whatever depth: a rendered block can sit
  // inside a blockquote or a list item, where the thing before or after it is
  // not a child of the editable root.
  function neighbour(el, forward) {
    const root = contentRoot();
    let node = el;
    while (node && node !== root) {
      const sib = forward ? node.nextElementSibling : node.previousElementSibling;
      if (sib) return sib;
      node = node.parentElement;
    }
    return null;
  }

  function dropBlock(block) {
    const next = neighbour(block, true);
    const prev = neighbour(block, false);
    // Nothing beside it: the caret would be left in a detached node and the
    // document with no block at all, so a paragraph takes its place.
    let empty = null;
    if (!next && !prev) {
      empty = document.createElement("p");
      empty.setAttribute("data-block", "0");
      empty.appendChild(document.createElement("br"));
      block.parentElement.insertBefore(empty, block);
    }
    block.remove();
    if (empty) landOn(empty, true);
    else if (next) landOn(next, true);
    else landOn(prev, false);
    syncEdit();
  }

  function handleBlockEdges(e) {
    if (!vditor) return;
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    // The player bar and its track sit outside the editable tree and own
    // their keys.
    if (!e.target || !e.target.isContentEditable) return;
    const info = caretInfo();
    if (!info || !info.node.closest(".vditor-ir")) return;

    const code = info.node.closest("pre.vditor-ir__marker--pre > code");
    const block = code ? code.closest(EDGE_BLOCKS) : null;

    if (!info.sel.isCollapsed) {
      // Only the selection that covers the whole source is taken over (a
      // partial one deletes cleanly on its own): both ends inside the same
      // source, selected text equal to it.
      if (!block) return;
      const end =
        info.range.endContainer.nodeType === 1
          ? info.range.endContainer
          : info.range.endContainer.parentElement;
      if (!end || (end !== code && !code.contains(end))) return;
      // Structural, not by text: Selection.toString() reports what is drawn,
      // and a collapsed block draws its source in a 10x5px box, so it reads
      // empty there (measured). Boundary points do not depend on layout.
      const whole = document.createRange();
      whole.selectNodeContents(code);
      const head =
        info.range.compareBoundaryPoints(Range.START_TO_START, whole) <= 0;
      const tailEnd =
        info.range.compareBoundaryPoints(Range.END_TO_END, whole) >= 0 ||
        info.range.toString().replace(/[\u200B\n\r]/g, "") ===
          code.textContent.replace(/[\u200B\n\r]/g, "");
      if (!head || !tailEnd) return;
      e.preventDefault();
      e.stopPropagation();
      code.textContent = "\n";
      caretTo(code, true);
      syncEdit();
      return;
    }

    if (block) {
      const bare = code.textContent.replace(/[\u200B\n\r]/g, "");
      if (bare === "") {
        e.preventDefault();
        e.stopPropagation();
        dropBlock(block);
        return;
      }
      const side = document.createRange();
      side.selectNodeContents(code);
      if (e.key === "Backspace") {
        side.setEnd(info.range.startContainer, info.range.startOffset);
        if (side.toString().replace(/\u200B/g, "") !== "") return;
        e.preventDefault();
        e.stopPropagation();
        const prev = neighbour(block, false);
        if (prev) landOn(prev, false);
        return;
      }
      side.setStart(info.range.startContainer, info.range.startOffset);
      const tail = side.toString().replace(/\u200B/g, "");
      if (tail !== "" && tail !== "\n") return;
      e.preventDefault();
      e.stopPropagation();
      const next = neighbour(block, true);
      if (next) landOn(next, true);
      return;
    }

    // Forward Delete at the very end of the block before a rendered one:
    // enter it. Backspace from below is upstream's and already enters.
    if (e.key !== "Delete") return;
    const root = contentRoot();
    if (!root || !root.contains(info.node)) return;
    // Climb to the level that has a next sibling: inside a blockquote or a
    // list item that level is not a child of the root. The first sibling
    // found decides, and anything that is not a rendered block means an
    // ordinary delete.
    let level = info.node;
    let next = null;
    while (level && level !== root) {
      const sib = level.nextElementSibling;
      if (sib) {
        if (sib.matches(EDGE_BLOCKS)) next = sib;
        break;
      }
      level = level.parentElement;
    }
    if (!next) return;
    // Nothing of the caret's own block may be left after the caret.
    const tail = document.createRange();
    tail.selectNodeContents(level);
    tail.setStart(info.range.startContainer, info.range.startOffset);
    if (tail.toString().replace(/[\u200B\n\r]/g, "") !== "") return;
    const target = sourceOf(next);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    caretTo(target, true);
  }

  // ---------- Initialization ----------

  function toolbarItems() {
    const names = [
      // The file actions lead the bar, the way editors have always laid
      // them out: export (unshifted below), then undo and redo. Outline
      // follows; it used to lead for sitting on the side its panel appears,
      // and that still reads from third place.
      "undo",
      "redo",
      "|",
      "outline",
      "|",
      "headings",
      "bold",
      "italic",
      "|",
      "list",
      "ordered-list",
      "|",
      "code",
      "inline-code",
      "|",
      "insert-before",
      "insert-after",
      "|",
      "table",
      "link",
      "|",
    ];
    // The toolbar sits against the top edge of the webview: the default
    // tooltips are drawn upwards and end up out of view. Draw them downwards.
    const items = names.map(function (n) {
      return n === "|" ? n : { name: n, tipPosition: "s" };
    });
    // The export menu goes in front of everything: it is the one button
    // that leaves the editor. Each entry saves the document first, then runs
    // the same bin/mdm the command line uses (both on the host side).
    items.unshift("|");
    items.unshift({
      name: "mdm-export",
      icon: EXPORT_ICON,
      tip: "Export",
      tipPosition: "s",
      click: function () {}, // opening the panel is Vditor's job
      toolbar: EXPORT_FORMATS.map(function (format) {
        return {
          name: "mdm-export-" + format.to,
          tip: format.label,
          icon: format.label,
          click: function () {
            vscode.postMessage({ type: "export", to: format.to });
          },
        };
      }),
    });
    // Unknown names fall through to Vditor's Custom item, which renders `icon`
    // and calls `click`. An item carrying `toolbar` also gets a drop-down
    // panel, which is where the score fills are listed.
    // Theme first: the fill colours are defined per theme, so the wider switch
    // reads before the one that depends on it.
    items.push({
      name: "mdm-theme",
      icon: THEME_ICON,
      tip: "Theme",
      tipPosition: "s",
      click: function () {}, // opening the panel is Vditor's job
      toolbar: themeMenuItems(),
    });
    items.push({
      name: "mdm-score-fill",
      icon: SCORE_ICON,
      tip: "Score fill",
      tipPosition: "s",
      click: function () {}, // opening the panel is Vditor's job
      toolbar: fillMenuItems(),
    });
    items.push({
      name: "mdm-staff-lines",
      icon: STAFF_ICON,
      tip: staffTip(),
      tipPosition: "s",
      click: function () {
        askSetting("staffLines", staffLines === "gray" ? "ink" : "gray");
      },
    });
    items.push({
      name: "mdm-score-align",
      icon: ALIGN_ICON[alignTarget()],
      tip: alignTip(),
      tipPosition: "s",
      click: function () {
        askSetting("scoreAlign", alignTarget());
      },
    });
    items.push({
      name: "mdm-front-matter",
      icon: FM_ICON,
      tip: fmTip(),
      tipPosition: "s",
      click: function () {
        if (headerText === "") return;
        askSetting("frontMatter", frontMatter === "shown" ? "hidden" : "shown");
      },
    });
    return items;
  }

  // An arrow leaving an open tray, drawn like the other icons: fill only.
  const EXPORT_ICON =
    '<svg viewBox="0 0 16 16"><path d="M8 1.6 4.7 5.5h2.1v4.7h2.4V5.5h2.1Z"/><path d="M2.6 9.3h1.7v2.6q0 .7.7.7h6q.7 0 .7-.7V9.3h1.7v3q0 1.9-1.9 1.9H4.5q-1.9 0-1.9-1.9Z"/></svg>';

  // What bin/mdm can be asked for; `to` is the wire value the host expects.
  const EXPORT_FORMATS = [
    { to: "html", label: "HTML" },
    { to: "pdf", label: "PDF" },
    { to: "both", label: "HTML + PDF" },
  ];

  // Undo and redo as rotating arrows, a thick open ring with a fat
  // tangential head, in place of the bent arrows Vditor ships. Same 16-unit
  // grid and fill-only rules as every other icon here; redo mirrors undo.
  const UNDO_ICON =
    '<svg viewBox="0 0 16 16"><path d="M3.32 12.22A6.3 6.3 0 1 0 3.32 3.78L4.99 5.29A4.05 4.05 0 1 1 4.99 10.71Z"/><path d="M6.14 6.33L2.17 2.75L1.28 7.73Z"/></svg>';
  const REDO_ICON =
    '<svg viewBox="0 0 16 16"><path d="M12.68 12.22A6.3 6.3 0 1 1 12.68 3.78L11.01 5.29A4.05 4.05 0 1 0 11.01 10.71Z"/><path d="M9.86 6.33L13.83 2.75L14.72 7.73Z"/></svg>';

  // Vditor draws its built-in buttons from its icon sprite; these two get
  // the drawings above instead. The swap touches only the button's markup,
  // so the wiring and the disabled state Vditor manages stay its own.
  function replaceBuiltinIcons() {
    const faces = { undo: UNDO_ICON, redo: REDO_ICON };
    Object.keys(faces).forEach(function (name) {
      const button = document.querySelector(
        '#app .vditor-toolbar button[data-type="' + name + '"]'
      );
      if (button) button.innerHTML = faces[name];
    });
  }

  function init(text) {
    const dark = isDark();
    vditor = new Vditor("app", {
      cdn: CDN,
      mode: "ir",
      lang: "en_US",
      value: text,
      height: "100%",
      // Vditor waits this long after a keystroke before firing `input` (its
      // default is 800 ms); together with our own 300 ms debounce that read as
      // a very laggy dirty marker.
      undoDelay: 300,
      cache: { enable: false },
      theme: dark ? "dark" : "classic",
      toolbar: toolbarItems(),
      preview: {
        theme: {
          current: dark ? "dark" : "light",
          path: CONTENT_THEME_PATH,
        },
        hljs: { lineNumber: false, style: dark ? "github-dark" : "github" },
        math: { engine: "KaTeX", inlineDigit: true },
        markdown: {
          autoSpace: false,
          fixTermTypo: false,
          paragraphBeginningSpace: false,
        },
      },
      input: function (value) {
        if (!applying) queueEdit(value);
      },
      after: function () {
        replaceBuiltinIcons();
        watchDocument();
        renderScores();
        decorateCallouts();
        highlightFrontMatter();
        watchCallouts();
        // The first update lands before the toolbar exists, so the button state
        // is set once here, when there is a button to set it on.
        updateFrontMatter();
        watchGutter();
        watchTheme();
        applyTheme();
        applyScoreAlign();
        dismissTooltipOnClick();
        watchScoreSelection();
        document.addEventListener("keydown", handleKeydown, true);
        document.addEventListener("keydown", handleBlockEdges, true);
        document.addEventListener("cut", handleCut, true);
        document.addEventListener("blur", guardBlur, true);
        document.addEventListener("mousedown", recordMouseDown, true);
        document.addEventListener("click", handleAudioToggle, true);
        document.addEventListener("click", handleCopyClick, true);
        document.addEventListener("click", handleClick, true);
      },
    });
  }

  window.addEventListener("message", function (e) {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === "settings") {
      const next = msg.settings || {};
      themeSetting = next.theme || "auto";
      scoreFill = next.scoreFill || "none";
      staffLines = next.staffLines || "gray";
      scoreAlign = next.scoreAlign || "center";
      const nextFm = next.frontMatter || "hidden";
      if (nextFm !== frontMatter) {
        // The update that follows this message carries the document in the mode
        // just chosen, and it is dropped while an edit is still debounced. Send
        // that edit now so the toggle is never swallowed by a keystroke made a
        // moment earlier.
        flushEdit();
        // The button adds or removes a block at the very top of the document,
        // and what was pressed is a button about the header, so the update right
        // behind this message takes the editor there instead of holding the
        // scroll where it was. Both ways round: hiding the header from halfway
        // down the document used to leave the reader where they stood, looking
        // at the one part of the page the button had not touched.
        scrollToTop = true;
      }
      frontMatter = nextFm;
      // applyTheme repaints the toolbar and the score styling, whose colours
      // are picked from the effective theme. A theme chosen from the menu also
      // brings a palette message right behind this one, which repaints again
      // with the colours and the side of the theme that was picked.
      applyTheme();
      applyScoreAlign();
      updateFrontMatter();
      return;
    }
    if (msg.type === "palette") {
      palette = msg.palette || null;
      themeSide = msg.side || null;
      // The side may have changed with the palette (a theme picked from the
      // menu brings its own), so the whole look is repainted, not just the
      // colours of the code.
      applyTheme();
      return;
    }
    if (msg.type !== "update") return;
    headerText = msg.frontMatter || "";
    // Adopted even when the text below turns out to be the one already in the
    // editor: for a file with no header both modes produce the same text, and
    // the flag still has to follow the setting.
    editorFrontMatter = !!msg.withFrontMatter;
    updateFrontMatter();
    if (!vditor) {
      init(msg.text);
      return;
    }
    if (pending) return;
    const current = vditor.getValue();
    if (msg.text === current) return;
    const ir = scroller();
    const scrollTop = scrollToTop ? 0 : ir ? ir.scrollTop : 0;
    // The YAML button adds or removes one block at the top and leaves the rest
    // of the document alone, so that one block is what changes hands. A full
    // setValue would repaint every block instead: the editor blanks for a
    // frame and every score is engraved again.
    if (patchFrontMatter(current, msg.text)) {
      highlightFrontMatter();
    } else {
      // An external update re-renders the whole document; at least the scroll
      // position is preserved (the caret position is lost: known limitation,
      // same as in Office Viewer).
      applying = true;
      vditor.setValue(msg.text);
      applying = false;
      renderScores();
    }
    scrollToTop = false;
    if (ir) ir.scrollTop = scrollTop;
  });

  vscode.postMessage({ type: "ready" });
})();
